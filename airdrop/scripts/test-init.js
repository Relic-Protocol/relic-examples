// run the script with `npx hardhat run scripts/test-init.js` 
const { ethers } = require("hardhat");
const helpers = require("@nomicfoundation/hardhat-network-helpers");

const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const RELIQUARY = '0x5E4DE6Bb8c6824f29c44Bd3473d44da120387d08';

async function main() {
    const ADUSDT = await ethers.getContractFactory("Token");
    const adusdt = await ADUSDT.deploy(RELIQUARY, USDT, 15000000);
    await adusdt.deployed();

    console.log("ADUSDT:", adusdt.address);

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
