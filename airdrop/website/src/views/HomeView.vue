<script setup>
import { computed, ref, watchEffect } from "vue";
import { useOnboard } from "@web3-onboard/vue";
import * as ethers from "ethers";
import { RelicClient, utils } from "@relicprotocol/client";

const { alreadyConnectedWallets, connectWallet, connectedWallet } =
  useOnboard();

const addresses = {
  ADUSDT:
    import.meta.env.VITE_ADUSDT ?? "0xc2Ed14521e009FDe80FC610375769E0C292FC12d",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  MAKERDAOMULTICALL: "0xeefBa1e63905eF1D7ACbA5a8513c70307C1cE441",
};
const MAP_SLOT = 2;
const BLOCK = 15_000_000;

const loaded = ref(false);
const claimed = ref(null);
const balance = ref(null);
const eligible = ref(null);
var proveAndMintTx = null;

const ADUSDT = new ethers.Contract(addresses.ADUSDT, [
  "function mint(address who) public",
  "function balanceOf(address owner) public view returns (uint)",
  "function claimed(address owner) public view returns (bool)",
]);

const USDT = new ethers.Contract(addresses.USDT, [
  "function balanceOf(address owner) public view returns (uint)",
]);

const Multicall = new ethers.Contract(addresses.MAKERDAOMULTICALL, [
  "function aggregate(tuple(address target, bytes callData)[] memory calls) public returns (uint256 blockNumber, bytes[] memory returnData)",
]);

const provider = computed(() => {
  return new ethers.providers.Web3Provider(connectedWallet.value.provider);
});

const signer = computed(() => provider.value.getSigner());

const primaryAddress = computed(() => {
  const wallet = connectedWallet.value;
  if (wallet === null || wallet.accounts.length === 0) {
    return null;
  }
  return ethers.utils.getAddress(connectedWallet.value.accounts[0].address);
});

const refreshStatus = async () => {
  const address = primaryAddress.value;
  if (address === null) {
    return;
  }
  try {
    const adusdt = ADUSDT.connect(signer.value);
    claimed.value = await adusdt.claimed(address);
    balance.value = await adusdt.balanceOf(address);

    if (!claimed.value) {
      const client = await RelicClient.fromProvider(provider.value);
      const prover = await client.storageSlotProver();
      const storageSlot = utils.mapElemSlot(MAP_SLOT, primaryAddress.value);

      const proveTx = await prover.prove({
        block: BLOCK,
        account: addresses.USDT,
        slot: storageSlot,
      });

      const mintTx = await adusdt.populateTransaction.mint(primaryAddress.value);
      const balanceTx = await adusdt.populateTransaction.balanceOf(primaryAddress.value);

      // simulate the call and run balanceOf afterwards to determine how much
      // would be minted
      const multicall = Multicall.connect(signer.value);
      proveAndMintTx = [
        { target: proveTx.to, callData: proveTx.data },
        { target: mintTx.to, callData: mintTx.data },
      ]

      const res = await multicall.callStatic.aggregate([
        ...proveAndMintTx,
        { target: balanceTx.to, callData: balanceTx.data },
      ])

      // balance after we minted minus current balance = amount we will mint
      eligible.value = ethers.BigNumber.from(res.returnData[2]) - balance.value;
    }
    loaded.value = true;
  } catch (e) {
    console.log("load status error", e);
  }
};

const mint = async () => {
  if (loaded.value) {
    // run the saved, bundled proving and minting TX
    const multicall = Multicall.connect(signer.value);
    const res = await multicall.aggregate(proveAndMintTx);

    await res.wait();
  }

  refreshStatus();
};

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
      <router-link to="/slot">(view slot helper)</router-link>
      <h3>USDT Airdrop (example project)</h3>
      <br />
      <p>
        If you held USDT tokens at Ethereum block 15,000,000 you are entitled to
        an airdrop of ADUSDT tokens in the same quantity!
      </p>
    </div>
    <div v-if="connectedWallet">
      <p><b>Connected Wallet:</b> {{ connectedWallet.label }}</p>
      <p><b>Primary Account:</b> {{ primaryAddress }}</p>
      <text v-if="!loaded">Checking claim status</text>
      <div v-else>
        <button v-if="!claimed" @click="mint()" :disabled="eligible == 0" autocomplete="off">
          Mint {{ eligible / 1e6 }} ADUSDT
        </button>
        <text v-else>(Already claimed)</text>
        <br />
        <text>Current token balance: {{ balance / 1e6 }}</text>
      </div>
    </div>
  </main>
</template>
