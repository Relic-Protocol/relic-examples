import { ethers, BigNumber } from 'ethers'
import { RelicClient } from '@relicprotocol/client'

const provider = new ethers.providers.WebSocketProvider(process.env.RPC_URL || 'please set RPC_URL')
const wallet = new ethers.Wallet(process.env.PRIV_KEY || 'please set PRIV_KEY')
const DGF = new ethers.Contract(
  process.env.DGF_ADDR || 'please set DGF_ADDR',
  [
    'function submit(address prover, bytes calldata proof) external payable',
    'function claimRewards(uint256[] memory rounds) external',
    'function winner(uint256 round) external view returns (address)',
    'function currentRewardETH() public view returns (uint256)',
    'function currentRound() public view returns (uint256)',
  ],
  provider
)

const ROUND_SIZE = 8192

interface RawHeader {
  hash: string
  parentHash: string
  number: string
  baseFeePerGas: string
}

interface PricedHeader {
  hash: string
  parentHash: string
  number: number,
  price: BigNumber
  prevMin?: WeakRef<PricedHeader>
}

type HashToBest = Record<string, PricedHeader>
type RoundMap = Record<number, HashToBest>

async function main() {
  const relic = await RelicClient.fromProvider(provider)

  // maps block hashes to the best price header in that block's round
  let mins: RoundMap = {}
  let handling: Record<string, Promise<void>> = {}

  function parseHeader(raw: RawHeader): PricedHeader {
    return {
      ...raw,
      number: Number(raw.number),
      price: BigNumber.from(raw.baseFeePerGas)
    }
  }

  function blockToRound(number: number) {
    return Math.floor(number / ROUND_SIZE)
  }

  // proof-of-concept price submission code
  // note that you can do much better than this by decreasing latency
  // and using MEV bundles to avoid landing reverting transactions
  async function maybeSubmitPrev(header: PricedHeader) {
    // check if we have a prevMin
    const min = header.prevMin?.deref()
    if (!min) return

    const prover = relic.blockHeaderProver.contract.address
    
    // fetch these concurrently
    const [curReward, curBlock, curGasPrice, fee, { proof }] = await Promise.all([
      DGF.currentRewardETH(),
      provider.getBlockNumber(),
      provider.getGasPrice(),
      relic.blockHeaderProver.fee(),
      relic.blockHeaderProver.getProofData({block: min.hash}),
    ])

    // make sure we're still on the same block, and that the
    // next block is part of the same submission round
    if (curBlock != header.number || (curBlock + 1) % ROUND_SIZE == 0) {
      return
    }

    const gas = await DGF.estimateGas.submit(prover, proof, { value: fee })
    const gasCost = gas.mul(curGasPrice)

    // if it will be profitable, submit it
    if (gasCost.add(fee).lt(curReward)) {
      // NOTE: this will revert if somebody beasts us or it takes too long
      // Use MEV bundles to avoid this
      await DGF.submit(prover, proof, { value: fee, maxFeePerGas: curGasPrice })
    }
  }

  async function _handleHeader(header: PricedHeader) {
    console.log('handling', header.number, header.hash)
    let round = blockToRound(header.number)

    // initialize round mapping if needed
    if (mins[round] === undefined) mins[round] = {}

    // allow GC of stale round data
    delete mins[round - 3]
    
    // first block in the round
    if (header.number % ROUND_SIZE == 0) {
      // if we have data for the prev round, use our parent data's min as prevMin
      if (mins[round - 1]) {
        if (mins[round - 1][header.parentHash] === undefined) {
          await handleHash(header.parentHash)
        }
        // allow GC of stale round data
        header.prevMin = new WeakRef(mins[round - 1][header.parentHash])
      }

      // first block in a round is the min
      mins[round][header.hash] = header
      return maybeSubmitPrev(header)
    }
    
    // we haven't seen this block's parent yet, so go handle it first
    if (mins[round][header.parentHash] === undefined) {
      await handleHash(header.parentHash)
    }

    let min = mins[round][header.parentHash]
    header.prevMin = min.prevMin
    mins[round][header.hash] = min.price.lt(header.price) ? min : header

    return maybeSubmitPrev(header)
  }

  // cache to ensure we only handle each header once concurrently
  async function handleHeader(header: PricedHeader) {
    if (handling[header.hash] === undefined) {
      handling[header.hash] = _handleHeader(header)
    }
    await handling[header.hash]
    delete handling[header.hash]
  }

  async function handleHash(hash: string) {
    const raw = await provider.send("eth_getBlockByHash", [hash, true])
    const header = parseHeader(raw)
    await handleHeader(header)
  }

  provider._subscribe("newHeads", ["newHeads"], (raw: RawHeader) => {
    handleHeader(parseHeader(raw))
  })
}

main()
