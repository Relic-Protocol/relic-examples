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
  STORAGE_SLOT_PROVER: "0xB8E9ebd4518E44eE66808ab27c9E09E5c5CCA2db",
  CACHED_STORAGE_SLOT_PROVER: "0x2e1A0F428624D85c2c86be18ccf57981b3e9b54D",
};
const MAP_SLOT = 2;
const BLOCK = 15_000_000;

const loaded = ref(false);
const claimed = ref(null);
const balance = ref(null);
const txValue = ref({});

const provider = computed(() => {
  return new ethers.providers.Web3Provider(connectedWallet.value.provider);
});

const signer = computed(() => provider.value.getSigner());

const ADUSDT = computed(() => new ethers.Contract(addresses.ADUSDT, [
  "function proveAndMint(address who, address prover, bytes calldata proof) public payable returns (uint256)",
  "function balanceOf(address owner) public view returns (uint)",
  "function claimed(address owner) public view returns (bool)",
], signer.value));

const USDT = computed(() => new ethers.Contract(addresses.USDT, [
  "function balanceOf(address owner) public view returns (uint)",
], signer.value));

const primaryAddress = computed(() => {
  const wallet = connectedWallet.value;
  if (wallet === null || wallet.accounts.length === 0) {
    return null;
  }
  return ethers.utils.getAddress(connectedWallet.value.accounts[0].address);
});

const getEntitledAmount = async (address) => {
  try {
    return await USDT.value.balanceOf(address, { blockTag: BLOCK });
  } catch (e) {
    alert("Cannot query historic balance:" + e.reason);
    console.log(e);
    return undefined;
  }
};

/*
 * determine if we can used a cached storage prover for cheaper
 * proving costs. Otherwise use the normal storage slot prover.
 */
const getBestProver = async (client) => {
  const rootdata = await client.accountStorageProver.getProofData(
    { block: BLOCK, account: addresses.USDT }
  );
  const rootFactSig = utils.toFactSignature(0, rootdata.sigData);
  const rootStorage = await client.reliquary.getFact(addresses.USDT, rootFactSig);

  if (rootStorage.exists) {
    console.log("Using cached storage slot prover");
    return {
      prover: client.cachedStorageSlotProver,
      proverAddress: addresses.CACHED_STORAGE_SLOT_PROVER,
    };
  } else {
    console.log(
      "Using uncached storage slot prover; " +
      "consider caching storage root for gas efficiency"
    );
    return {
      prover: client.storageSlotProver,
      proverAddress: addresses.STORAGE_SLOT_PROVER,
    }
  }
}

// generate and test the proof of our balance
const generateClaim = async () => {
  const address = primaryAddress.value;
  const client = await RelicClient.fromProvider(provider.value);
  const storageSlot = utils.mapElemSlot(MAP_SLOT, address);

  // fetch historic USDT balance, which we expect to prove
  const expected = await getEntitledAmount(address);

  // use appropriate prover (cached or uncached)
  const { prover, proverAddress } = await getBestProver(client);

  // fetch proof of the storage slot value
  const proofData = await prover.getProofData({
    block: BLOCK,
    account: addresses.USDT,
    slot: storageSlot,
    expected: expected
  });

  // any applicable fee for the prover
  let proveFee = await client.reliquary.getFee(proverAddress)
  // return arguments for the proveAndMint function
  return [
    address,
    proverAddress,
    proofData.proof,
    { value: proveFee }
  ];
}

const refreshStatus = async () => {
  const address = primaryAddress.value;
  if (address === null) {
    return;
  }

  // determine current account status
  try {
    claimed.value = await ADUSDT.value.claimed(address);
    balance.value = await ADUSDT.value.balanceOf(address);
  } catch (e) {
    alert(e.reason);
    console.log(e);
  }

  // if unclaimed, generate and simulate a claim
  if (!claimed.value) {
    try {
      const args = await generateClaim();
      const res = await ADUSDT.value.callStatic.proveAndMint(...args);
      txValue.value = { expected: res, args: args };
    } catch (e) {
      if (e.name == "RelicError") {
        alert("Relic API error: " + e.message);
      } else {
        alert(e.reason);
      }
      console.log(e);
    }
  }
  loaded.value = true;
};

// perform the actual proof and mint on chain
const mint = async () => {
  if (txValue.value.args) {
    try {
      const res = await ADUSDT.value.proveAndMint(...txValue.value.args);
      await res.wait();
    } catch (e) {
      alert(e.reason);
      console.log(e);
    } finally {
      refreshStatus();
    }
  }
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
        <button v-if="!claimed" @click="mint()" :disabled="txValue.expected == 0" autocomplete="off">
          Mint {{
            txValue.expected / 1e6
          }} ADUSDT
        </button>
        <text v-else>(Already claimed)</text>
        <br />
        <text>Current token balance: {{ balance / 1e6 }}</text>
      </div>
    </div>
  </main>
</template>
