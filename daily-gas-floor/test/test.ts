import { expect } from 'chai'
import { ethers } from 'hardhat'
import { arrayify, concat, defaultAbiCoder, sha256,
    solidityPack, ParamType, RLP
} from 'ethers/lib/utils'

import { RelicClient } from '../packages/client/src'

import pLimit from 'p-limit'
const limit = pLimit(16)
const flatCache = require('flat-cache')

const RELIQUARY_ADDRESS = '0x5E4DE6Bb8c6824f29c44Bd3473d44da120387d08'
const BLOCK_HEADER_PROVER_ADDRESS = '0x9f9A1eb0CF9340538297c853915DCc06Eb6D72c4'
const GWEI = ethers.BigNumber.from("1000000000")
const ETHER = GWEI.mul(GWEI)
const CHUNK_SIZE = 8192

const MERKLE_PROOF_TYPE = 0
const SNARK_PROOF_TYPE = 1

function range(N) {
    return [...new Array(N).keys()]
}

async function getHeader(provider, blockNum) {
    return await provider.send("eth_getBlockByNumber", ["0x" + blockNum.toString(16), false])
}

function headerRlp(header) {
    let list = [
        header.parentHash,
        header.sha3Uncles,
        header.miner,
        header.stateRoot,
        header.transactionsRoot,
        header.receiptsRoot,
        header.logsBloom,
        header.difficulty,
        header.number,
        header.gasLimit,
        header.gasUsed,
        header.timestamp,
        header.extraData,
        header.mixHash,
        header.nonce,
    ]
    if (header.baseFeePerGas) {
        list.push(header.baseFeePerGas)
    }

    list = list.map((v) => {
        if (v == "0x0") {
            return "0x"
        }
        if (v.length % 2 == 0) {
            return v
        } else {
            return "0x0" + v.substring(2)
        }
    })
    return RLP.encode(list)
}

function buildMerkleProof(hashes, idx) {
    let count = hashes.length
    let temp = new Array(count / 2)
    let proof = new Array()
    for (let i = 0; i < count; i += 2) {
        if (idx == i) {
            proof.push(hashes[i + 1])
        } else if (idx == i + 1) {
            proof.push(hashes[i])
        }
        temp[i >> 1] = sha256(concat([hashes[i], hashes[i + 1]]))
    }
    idx >>= 1
    count >>= 1
    while (count > 1) {
        for (let i = 0; i < count; i += 2) {
            if (idx == i) {
                proof.push(temp[i + 1])
            } else if (idx == i + 1) {
                proof.push(temp[i])
            }
            temp[i >> 1] = sha256(concat([temp[i], temp[i + 1]]))
        }
        count >>= 1
        idx >>= 1
    }
    return proof
}

function buildMerkleRoot(hashes) {
    let count = hashes.length
    let temp = new Array(count / 2)
    for (let i = 0; i < count; i += 2) {
        temp[i >> 1] = sha256(concat([hashes[i], hashes[i + 1]]))
    }
    count >>= 1
    while (count > 1) {
        for (let i = 0; i < count; i += 2) {
            temp[i >> 1] = sha256(concat([temp[i], temp[i + 1]]))
        }
        count >>= 1
    }
    return temp[0]
}

function encodeValidBlockMerkleProof(wrap, merkle) {
    let writer = defaultAbiCoder._getWriter()
    let type = ParamType.from("bytes32[]")
    defaultAbiCoder._getCoder(type).encode(writer, merkle)
    let proof = writer.data
    if (wrap) return solidityPack(["uint8", "bytes"], [MERKLE_PROOF_TYPE, proof])
    return proof
}

async function getBlockHashes(startBlock, numBlocks) {
    const cache = flatCache.load('block-hashes')
    const result = await Promise.all(range(numBlocks).map((i) => limit(async () => {
        let blockNum = startBlock+i
        if (!cache.getKey(blockNum)) {
            try {
                let block = await ethers.provider.getBlock(blockNum)
                cache.setKey(blockNum, block.hash)
            } catch (e) {
                cache.save(true);
                throw e;
            }
        }
        return cache.getKey(blockNum)
    })))
    cache.save(true)
    return result
}

async function getMerkleProof(blockNum) {
    const idx = blockNum % CHUNK_SIZE
    const start = blockNum - idx
    const hashes = await getBlockHashes(start, CHUNK_SIZE)
    return encodeValidBlockMerkleProof(true, buildMerkleProof(hashes, idx))
}

describe('BalanceManager', function () {
  it('test linked list', async function () {
    const DailyGasFloor = await ethers.getContractFactory('BalanceManagerTest')
    const bmt = await DailyGasFloor.deploy()
    await bmt.deployed()

    const min = await bmt.MIN_DEPOSIT();

    await expect((await bmt.unclaimedBalance()).toNumber()).to.equal(0)
    await expect(bmt.claim(min)).to.be.revertedWith(
      'Cannot claim more than unclaimedBalance()'
    )

    let deposits: Record<string, ethers.BigNumber> = {}
    let depositors = new Array<string>()
    const ZERO = ethers.BigNumber.from(0)

    async function depositFor(address, amount) {
      await bmt.depositFor(address, { value: amount} )

      if (deposits[address] == undefined) {
        depositors = [address].concat(depositors)
        deposits[address] = ZERO
      }
      deposits[address] = deposits[address].add(amount)
    }

    async function claim(amount) {
      await bmt.claim(amount)

      while (amount.gt(0)) {
        expect(depositors.length).to.be.greaterThan(0)
        let [cur] = depositors.splice(0, 1)
        if (amount.lt(deposits[cur])) {
          deposits[cur] = deposits[cur].sub(amount)
          depositors.push(cur)
          amount = ZERO
        } else {
          amount = amount.sub(deposits[cur])
          delete deposits[cur]
        }
      }
    }

    async function check() {
      let last = await bmt.last()
      let cur = last;
      let cDeposits: Record<string, ethers.BigNumber> = {}
      let cDepositors = new Array<string>()
      if (last != '0x0000000000000000000000000000000000000000') {
        do {
          cur = (await bmt.nodes(cur)).next
          cDepositors.push(cur)
          let node = await bmt.nodes(cur)
          cDeposits[cur] = node.balance
        } while (cur != last)
      }

      expect(cDepositors.length).to.equal(depositors.length)
      for (let i = 0; i < cDepositors.length; i++) {
        expect(cDepositors[i]).to.equal(depositors[i])
      }

      for (let depositor in deposits) {
        expect(cDeposits[depositor].eq(deposits[depositor])).to.equal(true)
      }
    }

    let users = range(4).map(v => {
      let val = (v + 1).toString(16)
      return '0x' + '0'.repeat(40 - val.length) + val
    })

    await depositFor(users[0], min)
    await claim(min)
    await check()

    await depositFor(users[0], min)
    await depositFor(users[0], min)
    await claim(min)
    await check()
    await depositFor(users[1], min)
    await depositFor(users[0], min)
    await depositFor(users[2], min)
    await depositFor(users[3], min)
    await check()
    await claim(min)
    await check()

    await claim(min.mul(4))
    await check()
  })
})

describe('DailyGasFloor', function () {
  it('test rewards and settlement', async function () {
    const DailyGasFloor = await ethers.getContractFactory('DailyGasFloor')
    const dgf = await DailyGasFloor.deploy(
        RELIQUARY_ADDRESS, BLOCK_HEADER_PROVER_ADDRESS
    )
    await dgf.deployed()

    let bond = await dgf.bond()

    let round = await dgf.previousRound()
    let tx = await dgf.deposit({ value: ETHER })
    await tx.wait()

    await expect(
        dgf.settledFloorPrice(round)
    ).to.be.revertedWith("round is not yet settled")

    let blockNum = round * CHUNK_SIZE + 2
    let header = headerRlp(await getHeader(ethers.provider, blockNum))
    let proof = await getMerkleProof(blockNum)
    function encodeProof(header, proof) {
        return defaultAbiCoder.encode(["bytes", "bytes"], [header, proof])
    }
    tx = await dgf.submit(encodeProof(header, proof), { value: bond })

    blockNum++
    header = headerRlp(await getHeader(ethers.provider, blockNum))
    proof = await getMerkleProof(blockNum)
    tx = await dgf.submit(encodeProof(header, proof), { value: bond })
    await tx.wait()

    await expect(
        dgf.settledFloorPrice(round)
    ).to.be.revertedWith("round is not yet settled")

    await hre.network.provider.send("hardhat_mine", ["0x2000"])

    // should succeed now
    await dgf.settledFloorPrice(round)

    // should be able to claim reward
    await dgf.claimRewards([round])

    // should not be able to claim it twice
    await expect(
        dgf.claimRewards([round])
    ).to.be.revertedWith("Can only claim unclaimed rewards")
  })
})