import { ethers, BigNumber } from 'ethers'
import { RelicClient } from '@relicprotocol/client'

import { abi } from '../artifacts/contracts/RANDAO.sol/RANDAO.json'

const provider = new ethers.providers.WebSocketProvider(process.env.RPC_URL || 'please set RPC_URL')
const wallet = new ethers.Wallet(process.env.PRIV_KEY || 'please set PRIV_KEY', provider)
const RANDAO = new ethers.Contract(
  process.env.RANDAO_ADDR || 'please set RANDAO_ADDR',
  abi,
  wallet
)

async function main() {
  const relic = await RelicClient.fromProvider(provider)
  let proveFee = await relic.storageSlotProver.fee()

  const block = Number(proecess.argv[2])

  const { proof } = await relic.blockHeaderProver.getData({block})

  let tx = await RANDAO.submitBlock(proof)
}
main()
