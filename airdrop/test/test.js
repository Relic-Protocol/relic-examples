const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");
const { loadFixture } = waffle;

const { RelicClient, utils } = require('@relicprotocol/client');

const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const RELIQUARY = '0x5E4DE6Bb8c6824f29c44Bd3473d44da120387d08';
const STORAGE_SLOT2_PROVER = '0xB8E9ebd4518E44eE66808ab27c9E09E5c5CCA2db';
const CACHED_STORAGE_SLOT_PROVER = '0x2e1A0F428624D85c2c86be18ccf57981b3e9b54D';
// owner lots of USDT tokens at block 15,000,000
const owner = '0x5041ed759dd4afc3a72b8192c143f72f4724081a';
// actual balance from block 15,000,000
const balance = 0x5a94a80f0d649;
// slot to use
const slot = utils.mapElemSlot(2, owner);


const PROVER = new ethers.Contract(CACHED_STORAGE_SLOT_PROVER, [
    "function prove(bytes calldata proof, bool store) public payable returns (bytes memory fact) ",
]);

describe("Airdrop", function () {
    async function fixture(_wallets, _provider) {

        const ADUSDT = await ethers.getContractFactory("Token");
        const adusdt = await ADUSDT.deploy(RELIQUARY, USDT, 15000000);
        await adusdt.deployed();

        return { adusdt };
    }

    it("ADUST", async function () {
        const { adusdt } = await loadFixture(fixture);


        await expect(await adusdt.balanceOf(owner)).equals(0);

        // prove slot value
        const relic = await RelicClient.fromProvider(ethers.provider)

        const signer = ethers.provider.getSigner();
        const txn = await signer.sendTransaction(
            await relic.storageSlotProver.prove({ block: 15000000, account: USDT, slot: slot })
        );
        await txn.wait();

        // mint token
        await adusdt.mintStoredProof(owner);

        await expect(adusdt.mintStoredProof(owner)).to.be.revertedWith("already claimed");
        await expect(await adusdt.balanceOf(owner)).equals(balance);
    });

    it("ADUSTv2", async function () {
        const { adusdt } = await loadFixture(fixture);

        await expect(await adusdt.balanceOf(owner)).equals(0);

        const relic = await RelicClient.fromProvider(ethers.provider)
        let data = await relic.storageSlotProver.getProofData({ block: 15000000, account: USDT, slot: slot });
        await adusdt.proveAndMint(owner, STORAGE_SLOT2_PROVER, data.proof);

        await expect(adusdt.proveAndMint(owner, STORAGE_SLOT2_PROVER, data.proof)).to.be.revertedWith("already claimed");
        await expect(await adusdt.balanceOf(owner)).equals(balance);
    });

    it("ADUST_cached", async function () {
        const { adusdt } = await loadFixture(fixture);

        await expect(await adusdt.balanceOf(owner)).equals(0);

        const relic = await RelicClient.fromProvider(ethers.provider)
        // prove account storage root
        const signer = ethers.provider.getSigner();
        await signer.sendTransaction(
            await relic.accountStorageProver.prove({ block: 15000000, account: USDT })
        )

        // prove storage slot off of that
        const data = await relic.cachedStorageSlotProver.getProofData({ block: 15000000, account: USDT, slot: slot });
        await adusdt.proveAndMint(owner, CACHED_STORAGE_SLOT_PROVER, data.proof);

        await expect(adusdt.proveAndMint(owner, CACHED_STORAGE_SLOT_PROVER, data.proof)).to.be.revertedWith("already claimed");
        await expect(await adusdt.balanceOf(owner)).equals(balance);
    });
});
