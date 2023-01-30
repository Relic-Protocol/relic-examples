import { expect } from 'chai'
import { ethers } from 'hardhat'

import { RelicClient } from '@relicprotocol/client'

const pLimit = require('p-limit')

const limit = pLimit(16)
const flatCache = require('flat-cache')

const RELIQUARY_ADDRESS = '0x5E4DE6Bb8c6824f29c44Bd3473d44da120387d08'
const BLOCK_HEADER_PROVER_ADDRESS = '0x9f9A1eb0CF9340538297c853915DCc06Eb6D72c4'
const GWEI = ethers.BigNumber.from("1000000000")
const ETHER = GWEI.mul(GWEI)
const CHUNK_SIZE = 8192

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

    let users = [1,2,3,4].map(v => {
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
        RELIQUARY_ADDRESS
    )
    await dgf.deployed()

    const relic = await RelicClient.fromProvider(ethers.provider)

    let proveFee = await relic.reliquary.getFee(BLOCK_HEADER_PROVER_ADDRESS)

    let round = await dgf.previousRound()
    let tx = await dgf.deposit({ value: ETHER })
    await tx.wait()

    await expect(
        dgf.settledPrice(round)
    ).to.be.revertedWith("round is not yet settled")

    // fetch two sample blocks, find which has lower base fee
    let blocks: Array<ethers.Block> = await Promise.all(
      [round * CHUNK_SIZE, round * CHUNK_SIZE + 1].map(ethers.provider.getBlock)
    )
    let max = Number(blocks[0].baseFeePerGas.lt(blocks[1].baseFeePerGas))

    // submit the higher base fee block
    let data = await relic.blockHeaderProver.getProofData({block: blocks[max].number})
    tx = await dgf.submit(BLOCK_HEADER_PROVER_ADDRESS, data.proof, { value: proveFee })

    // now submit the lower base fee block
    data = await relic.blockHeaderProver.getProofData({block: blocks[1-max].number})
    tx = await dgf.submit(BLOCK_HEADER_PROVER_ADDRESS, data.proof, { value: proveFee })

    await tx.wait()

    await expect(
        dgf.settledPrice(round)
    ).to.be.revertedWith("round is not yet settled")

    await hre.network.provider.send("hardhat_mine", ["0x2000"])

    // should succeed now
    await dgf.settledPrice(round)

    // should be able to claim reward
    await dgf.claimRewards([round])

    // should not be able to claim it twice
    await expect(
        dgf.claimRewards([round])
    ).to.be.revertedWith("Can only claim unclaimed rewards")
  })
})
