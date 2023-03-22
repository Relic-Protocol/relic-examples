<script setup>

import { computed, ref, watchEffect } from "vue";
import { useOnboard } from "@web3-onboard/vue";
import * as ethers from "ethers";
import { RelicClient, utils } from "@relicprotocol/client";

const { alreadyConnectedWallets, connectWallet, connectedWallet } =
    useOnboard();

const provider = computed(() => {
    return new ethers.providers.Web3Provider(connectedWallet.value.provider);
});

const signer = computed(() => provider.value.getSigner());

const contract = ref("");
const owner = ref("");
const slot = ref(null);

const guessSlot = async function () {
    const ERC20 = new ethers.Contract(contract.value, [
        "function balanceOf(address owner) public view returns (uint)",
    ], signer.value);
    const block = await provider.value.getBlockNumber();

    var balance;
    try {
        balance = await ERC20.balanceOf(owner.value, { blockTag: block });
    } catch (e) {
        alert("Could not call balanceOf on contract: " + e.reason);
        console.log(e);
        slot.value = -1;
        return;
    }
    if (balance <= 1) {
        alert("Balance too low, please try another address");
        slot.value = -1;
        return;
    }
    let found = false;
    for (let i = 0; i < 30; i++) {
        let val = await provider.value.getStorageAt(
            contract.value,
            utils.mapElemSlot(i, owner.value),
            block,
        );
        if (parseInt(val) == balance) {
            slot.value = i;
            found = true;
        }
    }
    if (!found) {
        slot.value = -1;
    }
};

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
        <a href="/">(back to example)</a>
        <div>
            <h3>Storage Slot Helper</h3>
            <br />
            <p>
                Enter a contract address (must have a <code>balanceOf(address)->(uint)</code> function like an ERC-20
                contract)
            </p>
            <input v-model="contract" size="50" />
            <p>
                And an account with a non-zero balance
            </p>
            <input v-model="owner" size="50" />
            <br />
            <br />
            <button @click="guessSlot()" :disabled="!connectedWallet" autocomplete="off">Guess Slot</button>

            <div v-if="slot != null && slot >= 0">
                <text>Plausible slot found at {{ slot }}</text>
                <br />
                <text>JS code: </text><code>utils.mapElemSlot({{ slot }}, owner_address)</code>
                <br />
                <text>Solidity
                    code:
                </text><code>Storage.mapElemSlot(bytes32(uint({{ slot }})), bytes32(uint256(uint160(owner_address))) )</code>
            </div>
            <div v-else-if="slot != null && slot < 0">
                <text>No matching slot found</text>
            </div>
        </div>
    </main>
</template>
