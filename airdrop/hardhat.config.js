require("@nomiclabs/hardhat-waffle");
require('hardhat-dependency-compiler');
require('dotenv').config();


// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.8.12",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 1,
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_KEY}`,
      }
    }
  },
  dependencyCompiler: {
    paths: [
      '@relicprotocol/contracts/interfaces/IStorageSlotProver.sol',
    ],
  }
};
