<script setup>
import { computed, markRaw, ref, watchEffect } from "vue";
import { useOnboard } from "@web3-onboard/vue";
import * as ethers from "ethers";
import { RelicClient } from "@relicprotocol/client";
import * as multicall from "@0xsequence/multicall";

import { abi } from '@/abi/UniV2TWAP.json';

const { alreadyConnectedWallets, connectWallet, connectedWallet } = useOnboard();

const addresses = {
  UniV2TWAP: import.meta.env.VITE_TWAP ?? "0xC78936Ad60A97e5Ae77f03b42E371823fcf230E2",
};

const reservesSlot = 8;
const price0CumulativeLastSlot = 9;
const price1CumulativeLastSlot = 10;

const loaded = ref(false);
const claimed = ref(null);
const balance = ref(null);
const eligible = ref(null);
const recent = ref([]);
const pairAddress = ref("0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc");
const tokenIdx = ref(null);
const startBlock = ref(null);
const endBlock = ref(null);
const pairInfo = ref(null);
const priceInfo = ref(null);
const processing = ref(false);
const submitPriceTx = ref(null);
const errorMessage = ref(null);

const Q112 = ethers.BigNumber.from(2).pow(112);

const UniV2TWAP = new ethers.Contract(addresses.UniV2TWAP, abi);

const provider = computed(() => new ethers.providers.InfuraProvider(null, import.meta.env.VITE_INFURA_KEY));

const signer = computed(() => {
  if (connectedWallet.value == null) {
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

const multicallProvider = computed(() => new multicall.providers.MulticallProvider(provider.value));

const ERC20Abi = [
  "function name() external view returns (string memory)",
  "function symbol() external view returns (string memory)",
  "function decimals() external view returns (uint8)",
];

const UniswapPairAbi = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112, uint112, uint32)",
  "function price0CumulativeLast() external view returns (uint)",
  "function price1CumulativeLast() external view returns (uint)",
].concat(ERC20Abi);

const pair = computed(() => {
  if (pairAddress.value == null) {
    return null;
  }
  return markRaw(new ethers.Contract(
    pairAddress.value,
    UniswapPairAbi,
  ).connect(multicallProvider.value));
})

const relicClient = ref(null);
const refreshStatus = async () => {
  if (multicallProvider.value == null || provider.value == null) {
    return;
  }
  const twap = UniV2TWAP.connect(provider.value);
  try {
    const logs = (await twap.queryFilter(twap.filters.TWAP()))
      .sort((a, b) => b.blockNumber - a.blockNumber)
      .slice(0, 10);
    // query pair information
    const recentPartial = await Promise.all(
      logs.map(async log => {
        const { cumulativePrice, params } = log.args;
        const p = new ethers.Contract(params.pair, UniswapPairAbi, multicallProvider.value);
        const [
          name, symbol, token0Address, token1Address,
        ] = await Promise.all([
          p.name(),
          p.symbol(),
          p.token0(),
          p.token1(),
        ]);
        return {
          cumulativePrice,
          params,
          tokens: [token0Address, token1Address],
        };
      })
    );
    // query token information
    recent.value = await Promise.all(
      recentPartial.map(async data => {
        const t0 = new ethers.Contract(data.tokens[0], ERC20Abi, multicallProvider.value);
        const t1 = new ethers.Contract(data.tokens[1], ERC20Abi, multicallProvider.value);
        const [
          name0, symbol0, decimals0,
          name1, symbol1, decimals1,
        ] = await Promise.all([
          t0.name(),
          t0.symbol(),
          t0.decimals(),
          t1.name(),
          t1.symbol(),
          t1.decimals(),
        ]);
        return {
          ...data,
          tokenAddress: data.params.zero ? data.tokens[0] : data.tokens[1],
          tokenName: data.params.zero ? name0 : name1,
          pairName: `${symbol0}-${symbol1}`,
          price: toFriendlyPrice(
            data.params.zero ? decimals0 : decimals1,
            data.params.zero ? decimals1 : decimals0,
            data.cumulativePrice,
          ),
        };
      })
    );
  } catch (e) {
    // if there is an error, we will just have an empty table
    console.log(e);
  }

  relicClient.value = await RelicClient.fromProvider(provider.value);

  loaded.value = true;
};

const loadPairInfo = async () => {
  if (!ethers.utils.isAddress(pairAddress.value)) {
    pairInfo.value = null;
    return;
  }
  if (pairInfo.value && pairInfo.value.address == pairAddress.value) {
    return;
  }
  if (provider.value == null) {
    return;
  }

  try {
    const [
      name, symbol, decimals, token0Address, token1Address,
    ] = await Promise.all([
      pair.value.name(),
      pair.value.symbol(),
      pair.value.decimals(),
      pair.value.token0(),
      pair.value.token1(),
    ]);
    const token0 = new ethers.Contract(token0Address, ERC20Abi).connect(multicallProvider.value);
    const token1 = new ethers.Contract(token1Address, ERC20Abi).connect(multicallProvider.value);
    const [
      token0Name, token0Symbol, token0Decimals, token1Name, token1Symbol, token1Decimals,
    ] = await Promise.all([
      token0.name(),
      token0.symbol(),
      token0.decimals(),
      token1.name(),
      token1.symbol(),
      token1.decimals(),
    ]);
    pairInfo.value = {
      address: pairAddress.value,
      name,
      symbol,
      decimals,
      tokens: [{
        address: token0Address,
        name: token0Name,
        symbol: token0Symbol,
        decimals: token0Decimals,
      }, {
        address: token1Address,
        name: token1Name,
        symbol: token1Symbol,
        decimals: token1Decimals,
      }],
    };
    console.log(pairInfo.value);
  } catch (e) {
    console.log(e);
    pairInfo.value = null;
  }
}

const loadSlotsAndPriceCumulative = async (blockNumber) => {
  const [
    blockHeader, reserves, price0CumulativeLast, price1CumulativeLast,
  ] = await Promise.all([
    provider.value.getBlock(blockNumber),
    pair.value.getReserves({ blockTag: blockNumber }),
    pair.value.price0CumulativeLast({ blockTag: blockNumber }),
    pair.value.price1CumulativeLast({ blockTag: blockNumber }),
  ]);
  const [reserves0, reserves1, timestampLast] = reserves;
  const dt = blockHeader.timestamp - timestampLast;
  console.log(dt);

  const price0 = reserves1.mul(Q112).div(reserves0);
  const price1 = reserves0.mul(Q112).div(reserves1);
  const price0Cumulative = price0CumulativeLast.add(price0.mul(dt));
  const price1Cumulative = price1CumulativeLast.add(price1.mul(dt));

  // timestampLast || reserves1 || reserves0
  const reservesSlot = ethers.BigNumber.from(timestampLast).mul(Q112).mul(Q112).add(reserves1.mul(Q112)).add(reserves0);

  return [
    reservesSlot,
    price0CumulativeLast,
    price1CumulativeLast,
    blockHeader.timestamp,
    price0Cumulative,
    price1Cumulative,
  ]
}

const loadPrices = async () => {
  if (startBlock.value == null || endBlock.value == null || pairInfo.value == null || tokenIdx.value == null) {
    priceInfo.value = null;
    return;
  }

  if (startBlock.value >= endBlock.value) {
    priceInfo.value = null;
    return;
  }

  priceInfo.value = null;

  try {
    const [
      startReservesSlot, startPrice0CumulativeLast, startPrice1CumulativeLast,
      startTimestamp, startPrice0Cumulative, startPrice1Cumulative,
    ] = await loadSlotsAndPriceCumulative(startBlock.value);
    const [
      endReservesSlot, endPrice0CumulativeLast, endPrice1CumulativeLast,
      endTimestamp, endPrice0Cumulative, endPrice1Cumulative,
    ] = await loadSlotsAndPriceCumulative(endBlock.value);

    let twap;
    if (tokenIdx.value === 0) {
      twap = endPrice0Cumulative.sub(startPrice0Cumulative).div(endTimestamp - startTimestamp);
    } else {
      twap = endPrice1Cumulative.sub(startPrice1Cumulative).div(endTimestamp - startTimestamp);
    }

    priceInfo.value = {
      twap,
      startSlots: {
        reserves: startReservesSlot,
        price0CumulativeLast: startPrice0CumulativeLast,
        price1CumulativeLast: startPrice1CumulativeLast,
      },
      endSlots: {
        reserves: endReservesSlot,
        price0CumulativeLast: endPrice0CumulativeLast,
        price1CumulativeLast: endPrice1CumulativeLast,
      },
    };
  } catch (e) {
    console.log(e);
  }
}

const toFriendlyPrice = (decimals, decimalsBase, twap) => {
  // adjust for difference in decimals
  if (decimals > decimalsBase) {
    twap = twap.mul(ethers.BigNumber.from(10).pow(decimals - decimalsBase));
  } else {
    twap = twap.div(ethers.BigNumber.from(10).pow(decimalsBase - decimals));
  }
  // convert from 112x112 to number with 8 digits of precision
  return twap.mul(1e8).div(Q112).toNumber() / 1e8;
}

const friendlyPrice = computed(() => {
  if (priceInfo.value == null) {
    return null;
  }

  let token = pairInfo.value.tokens[tokenIdx.value];
  let tokenBase = pairInfo.value.tokens[1 - tokenIdx.value];
  return toFriendlyPrice(token.decimals, tokenBase.decimals, priceInfo.value.twap);
});

const getUniV2StateProofs = async (blockNumber, slotValues) => {
  const { proof } = await relicClient.value.multiStorageSlotProver.getProofData({
    block: blockNumber,
    account: pairAddress.value,
    includeHeader: true,
    slots: [
      tokenIdx.value === 0 ? price0CumulativeLastSlot : price1CumulativeLastSlot,
      reservesSlot,
    ],
    expected: [
      tokenIdx.value === 0 ? slotValues.price0CumulativeLast : slotValues.price1CumulativeLast,
      slotValues.reserves,
    ],
  });
  return proof;
}

const submitPrice = async () => {
  if (priceInfo.value == null) {
    return;
  }
  
  errorMessage.value = null;
  processing.value = true;
  submitPriceTx.value = null;
  try {
    const [startProof, endProof] = await Promise.all([
      getUniV2StateProofs(startBlock.value, priceInfo.value.startSlots),
      getUniV2StateProofs(endBlock.value, priceInfo.value.endSlots),
    ]);
    const params = {
      pair: pairAddress.value,
      zero: tokenIdx.value === 0,
      startBlock: startBlock.value,
      endBlock: endBlock.value,
    };
    submitPriceTx.value = await UniV2TWAP.connect(signer.value).submitPrice(
      params,
      relicClient.value.addresses.multiStorageSlotProver,
      startProof,
      endProof,
    );
    await submitPriceTx.value.wait();
    refreshStatus();
  } catch (e) {
    console.log(e);
    errorMessage.value = e.message || e.toString();
  }
  processing.value = false;
};

watchEffect(refreshStatus);
watchEffect(loadPairInfo);
watchEffect(loadPrices);

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

form {
  width: 25rem;
}

form div {
  margin: 0.5rem 0;
}

select,input {
  width: 100%;
}
</style>

<template>
  <main>
    <button class="connectButton" v-if="!connectedWallet" @click="connectWallet()">
      Connect Wallet
    </button>
    <div>
      <h3>Uniswap V2 TWAP</h3>
      <br />
      <p>
        A trustless on-chain Uniswap V2 TWAP oracle that supports all pairs and all block ranges.
        The contract uses Relic Protocol to cryptographically verify the TWAP values and stores
        them on-chain for use in DeFi protocols.
      </p>
    </div>
    <text v-if="!loaded">Fetching proven prices...</text>
    <div v-else>
      <table>
        <tr>
          <th>Block Range</th>
          <th>Pair</th>
          <th>Token</th>
          <th>Price</th>
        </tr>
        <tr v-for="{ cumulativePrice, params, tokenAddress, tokenName, pairName, price } in recent">
          <td>{{ params.startBlock }} - {{ params.endBlock }}</td>
          <td><a target="_blank" :href="'https://etherscan.io/address/' + params.pair">{{ pairName }}</a></td>
          <td><a target="_blank" :href="'https://etherscan.io/token/' + tokenAddress">{{ tokenName }}</a></td>
          <td>{{ price }}</td>
        </tr>
      </table>
    </div>
    <form v-on:submit.prevent="!claimed && submitPrice()">
      <div><label>Address (Uniswap v2 Pair)</label></div>
      <div><input type="text" v-model.trim="pairAddress"></div>
      <div><label>Token</label></div>
      <div>
        <select :disabled="!pairInfo" v-model.number="tokenIdx">
          <option v-if="pairInfo" v-for="(token, idx) in pairInfo.tokens" :value="idx">{{ token.name }}</option>
        </select>
      </div>
      <div><label>Start Block</label></div>
      <div><input type="text" v-model.number="startBlock"></div>
      <div><label>End Block</label></div>
      <div><input type="text" v-model.number="endBlock"></div>
      <div><label>Price</label></div>
      <div v-if="priceInfo == null">???</div>
      <div v-else>
        {{ friendlyPrice }} {{ pairInfo.tokens[1 - tokenIdx].symbol }} / {{ pairInfo.tokens[tokenIdx].symbol }}
      </div>
      <button v-if="!claimed" :disabled="signer == null || priceInfo == null || processing" autocomplete="off">
        {{ signer == null ? 'Connect a wallet' : processing ? 'Please wait' : 'Submit price' }}
      </button>
    </form>
    <div v-if="submitPriceTx">
      Tx: <a target="_block" :href="'https://etherscan.io/tx/' + submitPriceTx.hash">{{ submitPriceTx.hash }}</a>
    </div>
    <div v-if="errorMessage" style="color: red;">
      {{ errorMessage }}
    </div>
  </main>
</template>
