<script setup>
import uniqBy from "lodash/uniqBy";
import { computed, ref, watchEffect } from "vue";
import { useOnboard } from "@web3-onboard/vue";
import * as ethers from "ethers";
import { RelicClient, utils } from "@relicprotocol/client";

// Etherscan API is rate-limited, use wretch to dedupe and throttle
import wretch from "wretch";
import { dedupe } from "wretch/middlewares/dedupe";
import { throttlingCache } from "wretch/middlewares/throttlingCache";

const { alreadyConnectedWallets, connectWallet, connectedWallet } =
  useOnboard();

const addresses = {
  OBM: import.meta.env.VITE_OBM ?? "0xF4c969714dE2face138DC6055D77D4D6436dB59D",
  BAYC: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
  MAKERDAOMULTICALL: "0xeefBa1e63905eF1D7ACbA5a8513c70307C1cE441",
};
const TOKEN_OWNERS_MAP_SLOT = 2;

const IPFSPROVIDER = "https://ipfs.io/ipfs/";
const OPENSEA = "https://opensea.io/assets/ethereum/";

const tokens = ref(null);
const tokenCache = ref({});

const BAYC = new ethers.Contract(addresses.BAYC, [
  "function tokenURI(uint256) external view returns (string)",
]);

const OBM = new ethers.Contract(addresses.OBM, [
  "function mint(address who, uint blockNum, uint tokenId) public",
  "function tokenURI(uint tokenId) public view returns (string memory)",
  "function ownerOf(uint tokenId) public view returns (address)",
  "function claimed(address owner, uint tokenId) public view returns (uint)",
]);

const Multicall = new ethers.Contract(addresses.MAKERDAOMULTICALL, [
  "function aggregate(tuple(address target, bytes callData)[] memory calls) public returns (uint256 blockNumber, bytes[] memory returnData)",
]);

const openseaLinkBAYC = (tokenID) => `${OPENSEA}${addresses.BAYC}/${tokenID}`;
const openseaLinkOBM = (tokenID) => `${OPENSEA}${addresses.OBM}/${tokenID}`;

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

const fetchNftTransfers = async (address) => {
  const data = await wretch()
    .middlewares([
      dedupe(),
      throttlingCache({
        throttle: 5000,
      }),
    ])
    .get(
      `https://api.etherscan.io/api?module=account&action=tokennfttx&contractaddress=${addresses.BAYC}&address=${address}&page=1&offset=1000&startblock=0&endblock=99999999&sort=asc`
    )
    .json();
  if (data.status === "0" && data.message === "NOTOK") {
    return null;
  }
  return data;
};

const refreshTokens = async () => {
  const address = primaryAddress.value;
  if (address === null) {
    return;
  }
  try {
    const data = await fetchNftTransfers(address);
    if (data === null) {
      setTimeout(async () => {
        console.log("retry");
        await refreshTokens();
        console.log("retried");
      }, 5 * 1000);
      return;
    }
    // filter to transfers TO address, and only the first transfer for each token
    const newTokens = uniqBy(
      data.result.filter(
        (entry) => ethers.utils.getAddress(entry.to) === address
      ),
      (entry) => entry.tokenID
    );
    for (const token of newTokens) {
      await claimed(token);
      loadTokenURI(token.tokenID);
    }
    tokens.value = newTokens;
  } catch (e) {
    console.log("token load error", e);
  }
};

const claimed = async (token) => {
  const obm = OBM.connect(provider.value);
  const claimedToken = (await obm.claimed(primaryAddress.value, token.tokenID)).toNumber();
  if (claimedToken === 0) {
    token.claimed = false;
    return;
  }
  token.claimed = claimedToken;
  token.claimedImg = JSON.parse(
    await wretch()
      .get(await obm.tokenURI(token.claimed))
      .text()
  ).image;
  token.owned = ethers.utils.getAddress(await obm.ownerOf(token.claimed)) === primaryAddress.value;
};

const loadTokenURI = async (tokenID) => {
  if (tokenCache.value[tokenID] !== undefined) {
    return;
  }
  tokenCache.value[tokenID] = {
    loading: true,
  };
  try {
    const tokenURI = await BAYC.connect(provider.value).tokenURI(tokenID);
    const metadata = await wretch()
      .get(tokenURI.replace("ipfs://", IPFSPROVIDER))
      .json();
    tokenCache.value[tokenID] = {
      loading: false,
      metadata,
      imageURI: metadata.image.replace("ipfs://", IPFSPROVIDER),
    };
  } catch (e) {
    console.log("uri error", e);
  }
};

const mint = async (token) => {
  const client = await RelicClient.fromProvider(provider.value);
  const prover = await client.storageSlotProver();

  const storageSlot = utils.structFieldSlot(
    utils.dynamicArrayElemSlot(
      utils.structFieldSlot(TOKEN_OWNERS_MAP_SLOT, 0),
      token.tokenID,
      2
    ),
    1
  );

  let proveTx;
  try {
    proveTx = await prover.prove({
      block: token.blockNumber,
      account: addresses.BAYC,
      slot: storageSlot,
      expected: primaryAddress.value
    });
  } catch (e) {
    alert(
      "storage slot mismatch (did you hold the NFT at the end of the block?)"
    );
    return;
  }

  const obm = OBM.connect(signer.value);
  const mintTx = await obm.populateTransaction.mint(
    primaryAddress.value,
    token.blockNumber,
    token.tokenID
  );

  // run the proving and minting TX in a single bundled TX
  const multicall = Multicall.connect(signer.value);
  const res = await multicall.aggregate([
    { target: proveTx.to, callData: proveTx.data },
    { target: mintTx.to, callData: mintTx.data },
  ]);

  await res.wait();

  refreshTokens();
};

watchEffect(refreshTokens);

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
th,
td {
  vertical-align: top;
  padding: 10px;
  border: 1px solid;
  border-collapse: separate;
  width: 20%;
}
.connectButton {
  float: right;
}
</style>

<template>
  <main>
    <button class="connectButton" v-if="!connectedWallet" @click="connectWallet()">Connect Wallet</button>
    <div>
      <br />
      <h3>Join Old Boat Monkeys</h3>
      <p>
        Are you a lover of disinterested lemur schooner troupes? Maybe you were
        a member of another one, but sold your NFT, or worse, had it stolen?
      </p>
      <p>
        You are in luck! With Old Boat Monkeys, you can convert your past
        membership at any other point in time to the <i>premiere</i> association
        of fatigued seafaring primates!
      </p>
      <p>
        How it works is simple: we use
        <a href="https://relicprotocol.com" target="_blank">Relic</a> to prove your historic
        ownership of unexcited barge baboon NFTs. For each one that you have
        owned in the past, you will be issued a single Old Boat Monkey NFT.
      </p>
      <p>
        You can also check out our awesome source code on
        <a href="https://github.com/Relic-Protocol/relic-examples" target="_blank">GitHub</a>.
      </p>
    </div>
    <div v-if="connectedWallet">
      <p><b>Connected Wallet:</b> {{ connectedWallet.label }}</p>
      <p><b>Primary Account:</b> {{ primaryAddress }}</p>
      <text v-if="tokens === null">Loading puckered pelagic primate posse status. Please wait a moment</text>
      <table v-else-if="tokens.length > 0">
        <tr>
          <th>Original</th>
          <th>Block Number</th>
          <th>TokenID</th>
          <th></th>
          <th>OBM</th>
        </tr>
        <tr v-for="token in tokens" :key="token.tokenID">
          <td>
            <a target="_blank" :href="openseaLinkBAYC(token.tokenID)">
              <img
                style="max-width: 100%"
                v-if="tokenCache[token.tokenID]"
                :src="tokenCache[token.tokenID].imageURI"/>
            </a>
          </td>
          <td>{{ token.blockNumber }}</td>
          <td>{{ token.tokenID }}</td>
          <td>
            <button @click="mint(token)" :disabled="token.claimed" autocomplete="off">
              Mint
            </button>
          </td>
          <td>
            <a v-if="token.claimed" target="_blank" :href="openseaLinkOBM(token.claimed)">
              <img style="max-width: 100%" v-if="token.claimed" :src="token.claimedImg" /></a>
            <text v-if="token.claimed && token.owned">Currently Owned</text>
            <text v-else-if="token.claimed && !token.owned">Not Currently Owned</text>
            <text v-else>Not Yet Minted</text>
          </td>
        </tr>
      </table>
      <text v-else>It seems you were never a member of any seafaring simian society!</text>
    </div>
  </main>
</template>
