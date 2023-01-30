import { HardhatUserConfig } from 'hardhat/config'
import '@nomiclabs/hardhat-ethers'
import '@nomicfoundation/hardhat-chai-matchers'
import 'hardhat-prettier'
import 'hardhat-gas-reporter'

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.12',
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
        url: process.env.MAINNET_RPC_URL || '',
      },
    },
    localhost: {
        url: 'http://localhost:8545/'
    }
  },
  mocha: {
    timeout: 10000000
  },
}

export default config
