# Airdrop

Want to airdrop a new release of ERC-20 tokens, based on who owned tokens
in a particular block?

There are many ways to accomplish them, but one of the most simple is to
use Relic!

In this example, we create an airdrop of a new ERC-20 for all holders of
USDT at block 15,000,000.

## How it works
Users can access their storage slot value at the block, and generate a
storage proof easily, using the Relic API (handled in the website code).
This proof, along with a proof of the block and block header, are provided
to Relic on-chain to show the balance of the user's account at the block
in question.

The airdrop contract then needs only to query Relic for the proven value
of the storage slot. As long as the user hasn't already claimed their
airdrop, they will be granted the exact amount of tokens they had at
block 15,000,000.

## Modifying
The main things that need to change to use this for other tokens are the
storage slot location/layout and of course any relevant addresses.

You can use the slot helper to help figure out the layout for other
similar contracts.

## Comparison to other solutions
The most common airdrop technique is to multi-send tokens to all
eligible users, computed off-chain. The problem with this is the cost of
the airdrop is borne entirely by the protocol, and wallets which may be
inactive will still receive tokens.

For a contract like USDT with about 4.5 million account holders, it would
cost around 20k gas for each user to simply write the storage slots which
contain their new balances. With gas at 20 Gwei, that works out to a
minimum of 1,800 ETH, not counting any additional costs that each transaction
might incur (such as storage writes for updating a total balance, or the
actual transaction fee itself).

Using a multi-send service will also incur a cost of approximately 300 ETH
on top of the actual gas costs above.

Airdropping with Relic means the protocol costs will be free. However, the
costs for actual mints will be borne by users, with each user paying likely
a few hundred thousand gas (on the order of 0.005 ETH with gas at 20 Gwei).


The other common alternative would be to build a Merkle Tree of all
accounts eligible for an airdrop. In essence, this is what Relic is doing:
using the existing cryptographic commitment already contained in the
blockchain. However, there is no extra calculation needed by the protocol
to find the Merkle root, which means users need not trust the protocol
calculated everything correctly.

Whether using a custom Merkle Tree example or Relic, an interface or tool
will be needed for users to provide the proof of their eligibility. That
can be found in the website folder for this project.

## Improvements
Because an airdrop will use a proof about the same storage root in the same
block several times, Relic can store this information for cheaper repeated
access. This will bring gas costs down lower for users wishing to claim
their airdrop.
