import { ethers, BigNumber } from 'ethers'
import { RelicClient } from '@relicprotocol/client'

import { abi } from '../artifacts/contracts/UniV2TWAP.sol/UniV2TWAP.json'

const provider = new ethers.providers.WebSocketProvider(process.env.RPC_URL || 'please set RPC_URL')
const wallet = new ethers.Wallet(process.env.PRIV_KEY || 'please set PRIV_KEY', provider)
const UniV2TWAP = new ethers.Contract(
  process.env.TWAP_ADDR || 'please set TWAP_ADDR',
  abi,
  wallet
)

const price0CumulativeLastSlot = 9
const price1CumulativeLastSlot = 10

async function main() {
  const relic = await RelicClient.fromProvider(provider)
  let proveFee = await relic.storageSlotProver.fee()

  const [, , pair, zeroStr, startBlockStr, endBlockStr] = process.argv
  console.assert(zeroStr == "true" || zeroStr == "false")

  const zero = zeroStr == "true"
  const slot = zero ? price0CumulativeLastSlot : price1CumulativeLastSlot

  const startBlock = Number(startBlockStr)
  const endBlock = Number(endBlockStr)

  async function getUniV2StateProof(block) {
    const { proof } = await relic.multiStorageSlotProver.getProofData({
      block,
      account,
      includeHeader: true,
      slots: [cumulativePriceSlot, reservesTimeSlot]
    })
    return proof
  }

  const [startProof, endProof] = await Promise.all([
    getUniV2StateProof(startBlock),
    getUniV2StateProof(endBlock),
  ])

  let tx = await twap.submitPrice(
    { pair, zero, startBlock, endBlock },
    relic.addresses.multiStorageSlotProver,
    startProof,
    endProof
  )
  await tx.wait()
}
main()
