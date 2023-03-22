// run the script with `npx hardhat run scripts/test-init.js` 
const { ethers } = require("hardhat");
const { RelicClient, utils } = require('@relicprotocol/client');
const helpers = require("@nomicfoundation/hardhat-network-helpers");

const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const ACCOUNT_STORAGE_PROVER = '0xa0334AD349c1D805BF6c9e42125845B7D4F63aDe';

async function main() {

    const [owner, otherAccount] = await ethers.getSigners();

    const storageProver = new ethers.Contract(ACCOUNT_STORAGE_PROVER, [
        "function prove(bytes calldata proof, bool store) public payable returns (bytes memory fact) ",
    ], owner);

    const relic = await RelicClient.fromProvider(ethers.provider)

    let rootdata = await relic.accountStorageProver.getProofData({ block: 15000000, account: USDT })
    let res = await storageProver.prove(rootdata.proof, true);

    console.log(await res.wait());

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
