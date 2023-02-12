<script setup>
import { computed, ref, watchEffect } from "vue";
import { useOnboard } from "@web3-onboard/vue";
import * as ethers from "ethers";
import { RelicClient, utils } from "@relicprotocol/client";

const { alreadyConnectedWallets, connectWallet, connectedWallet } =
  useOnboard();

const addresses = {
  RANDAO: import.meta.env.VITE_RANDAO ?? "0xDBC632Ad068C847B22D20005E4894ce52C12162c",
};

const loaded = ref(false);
const recent = ref([]);
const blockNumber = ref(null);
const randao = ref(null);
const errorMessage = ref(null);
const processing = ref(false);
const submitTx = ref(null);

const RANDAO = new ethers.Contract(addresses.RANDAO, [
  "function submitBlock(bytes calldata) external payable",
  "function values(uint256) external view returns (bytes32)",
  "event RANDAOValue(uint256 indexed block, bytes32 prevRandao)",
]);

const provider = computed(() => new ethers.providers.InfuraProvider(null, import.meta.env.VITE_INFURA_KEY));
const signer = computed(() => {
  if (connectedWallet.value === null) {
    return null;
  }
  return (new ethers.providers.Web3Provider(connectedWallet.value.provider)).getSigner();
});

const primaryAddress = computed(() => {
  const wallet = connectedWallet.value;
  if (wallet === null || wallet.accounts.length === 0) {
    return null;
  }
  return ethers.utils.getAddress(connectedWallet.value.accounts[0].address);
});

const refreshRecent = async () => {
  const contract = RANDAO.connect(provider.value);
  const logs = (await contract.queryFilter(contract.filters.RANDAOValue()))
    .sort((a, b) => b.blockNumber - a.blockNumber)
    .slice(0, 10);
  recent.value = logs;
};

const refreshStatus = async () => {
  randao.value = null;
  errorMessage.value = null;

  if (provider.value == null || !blockNumber.value) {
    return;
  }

  let block;
  try {
    block = await provider.value.send("eth_getBlockByNumber", ["0x" + blockNumber.value.toString(16), false]);
  } catch (e) {
    console.log("load status error", e);
  }
  if (!block) {
    errorMessage.value = "Invalid block or connectivity error";
    return;
  }
  if (block.difficulty != "0x0") {
    errorMessage.value = "Block number should be post-merge (15537394)"
    return;
  }
  try {
    const onchainValue = await RANDAO.connect(provider.value).values(blockNumber.value);
    if (onchainValue != '0x0000000000000000000000000000000000000000000000000000000000000000') {
      errorMessage.value = "RANDAO already proven: " + onchainValue;
      return;
    }
  } catch (e) {
    console.log(e);
    errorMessage.value = "Unknown error, try again later";
    return;
  }

  randao.value = block.mixHash;
};

const submit = async () => {
  submitTx.value = null;
  errorMessage.value = null;
  processing.value = true;
  try {
    const relicClient = await RelicClient.fromProvider(provider.value);
    const { proof } = await relicClient.blockHeaderProver.getProofData({
      block: blockNumber.value,
    });
    submitTx.value = await RANDAO.connect(signer.value).submitBlock(proof);
    await submitTx.value.wait();
    blockNumber.value = null;
    refreshRecent();
  } catch (e) {
    console.log(e);
    errorMessage.value = e.message || e.toString();
  }
  processing.value = false;
};

watchEffect(refreshRecent);
watchEffect(refreshStatus);

if (alreadyConnectedWallets.value.length) {
  connectWallet({
    autoSelect: {
      disableModals: true,
      label: alreadyConnectedWallets.value[0],
    },
  });
}
</script>

<style>
.connectButton {
  float: right;
}
</style>

<template>
  <main>
    <button class="connectButton" v-if="!connectedWallet" @click="connectWallet()">
      Connect Wallet
    </button>
    <div>
      <h3>RANDAO prover example</h3>
      <br />
      <p>
        Securely prove the RANDAO value from any previous Ethereum block.
      </p>
      <table>
        <tr>
          <th>Block</th>
          <th>RANDAO</th>
        </tr>
        <tr v-for="{ args } in recent">
          <td><a target="_blank" :href="'https://etherscan.io/block/' + args.block.toString() + '#consensusinfo'">{{ args.block.toString() }}</a></td>
          <td>{{ args.prevRandao }}</td>
        </tr>
      </table>
    </div>
    <form v-on:submit.prevent="!claimed && submit()">
      <div>
        <label>Block number</label>
      </div>
      <div>
        <input type="text" v-model.number="blockNumber">
      </div>
      <div v-if="randao">
        {{ randao }}
      </div>
      <div>
        <button :disabled="signer == null || randao == null || processing">
          {{ signer == null ? 'No wallet connected' : processing ? 'Please wait' : 'Submit' }}
        </button>
      </div>
      <div v-if="errorMessage" style="color: red;">
        {{ errorMessage }}
      </div>
      <div v-if="submitTx">
        Tx: <a target="_blank" :href="'https://etherscan.io/tx/' + submitTx.hash">{{ submitTx.hash }}</a>
      </div>
    </form>
  </main>
</template>
