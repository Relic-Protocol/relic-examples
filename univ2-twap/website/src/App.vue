<script setup>
import { RouterView } from "vue-router";
import { init } from "@web3-onboard/vue";
import injectedModule from "@web3-onboard/injected-wallets";
import walletConnectModule from "@web3-onboard/walletconnect";

const injected = injectedModule();
const walletConnect = walletConnectModule();
init({
  wallets: [injected, walletConnect],
  chains: [
    {
      id: "0x1",
      token: "ETH",
      label: "Ethereum Mainnet",
      rpcUrl: import.meta.env.VITE_RPC_URL ?? "https://cloudflare-eth.com",
    },
  ],
});
</script>

<style>
body {
  max-width: 1200px;
  margin: auto auto;
  padding: 20px;
}

button {
  font-size: medium;
}
</style>

<template>
  <RouterView />
</template>
