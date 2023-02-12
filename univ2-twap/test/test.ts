import { expect } from 'chai'
import { ethers, network } from 'hardhat'

import { RelicClient } from '@relicprotocol/client'

const reservesTimeSlot = 8
const price0CumulativeLastSlot = 9
const price1CumulativeLastSlot = 10

describe('UniV2TWAP', function () {
  it('test proving prices', async function () {
    const relic = await RelicClient.fromProvider(ethers.provider)

    const UniV2TWAP = await ethers.getContractFactory('UniV2TWAP')
    const twap = await UniV2TWAP.deploy(relic.addresses.reliquary);
    await twap.deployed()

    const zero = false
    const cumulativePriceSlot = zero ? price0CumulativeLastSlot : price1CumulativeLastSlot
    const pair = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc' // ETH - USDC
    const account = pair

    const startBlock = 10008566
    const endBlock = 16416686

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
    await expect(tx).to.emit(twap, "TWAP")

    let rawPrice = await twap.getPrice({ pair, zero, startBlock, endBlock })

    // get price with 6 digits of precision
    let price = rawPrice.mul(1e14).shr(112)

    // check price: should be $1874.28
    await expect(price).to.equal(187428)
  })
})
