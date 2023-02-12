import { expect } from 'chai'
import { ethers } from 'hardhat'

import { RelicClient } from '@relicprotocol/client'

describe('RANDAO', function () {
  it('test proving prices', async function () {
    const relic = await RelicClient.fromProvider(ethers.provider)

    const BLOCK_HISTORY_ADDR = "0xA00F3C13D60AD6a1a6e6d8Ebb4529408d7e87343"
    const RANDAO = await ethers.getContractFactory('RANDAO')
    const randao = await RANDAO.deploy(relic.addresses.reliquary, BLOCK_HISTORY_ADDR)
    await randao.deployed()

    const relicMultisig = "0xCCEf16C5ac53714512A5Acce5Fa1984A977351bE"
    await ethers.provider.send(
      "hardhat_impersonateAccount",
      [relicMultisig],
    )
    const signer = await ethers.getSigner(relicMultisig)
    // fund multisig for impersonation purposes
    await randao.signer.sendTransaction({
      to: relicMultisig,
      value: ethers.utils.parseEther("10")
    })
    const reliquary = await ethers.getContractAt(
        "IReliquary",
        relic.addresses.reliquary,
        signer
    )
    // make our oracle a subscriber
    await reliquary.grantRole(await reliquary.SUBSCRIPTION_ROLE(), relicMultisig)
    await reliquary.addSubscriber(randao.address, 0xfffffffffffffffn)

    const block = 15537394
    const { proof } = await relic.blockHeaderProver.getProofData({ block })

    let tx = await randao.submitBlock(proof)
    await expect(tx).to.emit(randao, "RANDAOValue")

    let header = await ethers.provider.send("eth_getBlockByNumber", ["0x"+block.toString(16), true])
    expect(await randao.values(block)).to.equal(header.mixHash)
  })
})
