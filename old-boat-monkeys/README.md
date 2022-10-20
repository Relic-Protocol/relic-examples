# Old Boat Monkeys

Are you a lover of disinterested lemur schooner troupes?
Maybe you were a member of another one, but sold your NFT, or worse, had it stolen?

You are in luck! With Old Boat Monkeys, you can convert your past membership
at any other point in time to the premiere association of fatigued seafaring primates!

## Details

This uses Relic Storage Facts. Users must prove the BAYC contract's list of owners
contained their address at the end of a block. Once this is done, the user is granted an
Old Boat Monkey NFT, and their redemption is stored for that tokenId to prevent multiple
redemptions.

The provided website code will perform this validation. It first checks etherscan for
historic ownership (only displaying the oldest transfer). Note that etherscan may show
transfers which would not leave one eligible for an OBM token (such as buying and selling
a BAYC token in the same block).
Then the Relic Storage Fact is proven and the OBM token is minted in the same transaction
by using the MakerDAO multicall contract.

## Tokenomics

You must have owned a BAYC token to redeem an Old Boat Monkey. However, someone could take
the same BAYC token and transfer it between several addresses, gaining them multiple tokens.

Each token has associated both the original BAYC ID, as well as the block when the original
token was owned. In general, tokens which with an earlier block should be considered more
valuable. Likewise, tokens corresponding to more rare BAYC tokens should be considered to have
higher value.

## More Information
For more information, check out http://relicprotocol.com
