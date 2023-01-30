/// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@relicprotocol/contracts/interfaces/IProver.sol";
import "@relicprotocol/contracts/interfaces/IReliquary.sol";
import "@relicprotocol/contracts/lib/Facts.sol";
import "@relicprotocol/contracts/lib/FactSigs.sol";
import "@relicprotocol/contracts/lib/CoreTypes.sol";

import "./BalanceManager.sol";
import "./Rounds.sol";

/**
 * @title DailyGasFloor
 * @author Theori, Inc.
 * @notice A trustless, fully on-chain price feed for the minimum base fee from
 *         each 8192-block round. Given 12-second block times, 8192 blocks is
 *         approximately 27 hours, or very roughly 1 day.
 * @notice The base fees are proven on-chain by validating a block header using
 *         Relic Protocol. Users submit proofs of the claimed minimum price for
 *         a given round. After a settlement period, the submitter of the
 *         minimum price for the round can claim their reward. The reward scales
 *         up gradually throughout the settlement window, with the goal of
 *         finding the minimum reward to exceed the current proving fees.
 * @notice The funds for the rewards come from depositors. In order to query
 *         the price feed, you must be a depositor. The depositors are charged
 *         for the price submission rewards in a round-robin.
 */
contract DailyGasFloor is BalanceManager, Rounds {
    uint256 public constant REWARD_MULTIPLIER = 1 ether / 1000;
    uint16 public constant MIN_REWARD = 10;
    uint16 public constant SCALING_REWARD = 100;

    IReliquary immutable reliquary;

    event NewSubmission(
        uint256 indexed round,
        address indexed winner,
        uint256 price
    );

    // fits in a single storage slot
    struct Submission {
        address winner;
        uint80 price;
        uint16 reward;
    }

    mapping(uint256 => Submission) private submissions;

    constructor(IReliquary _reliquary) {
        reliquary = _reliquary;
    }

    /**
     * @notice the current reward units, based on the urgency for settlement
     * @dev the reward includes a minimum reward and scaling priority reward
     */
    function currentReward() public view returns (uint16 reward) {
        reward =
            MIN_REWARD +
            uint16((currentRoundOffset() * SCALING_REWARD) / ROUND_SIZE);
    }

    /**
     * @notice the current reward in ETH, based on the urgency for settlement
     * @dev the reward includes a minimum reward and scaling priority reward
     */
    function currentRewardETH() public view returns (uint256) {
        return uint256(currentReward()) * REWARD_MULTIPLIER;
    }

    /**
     * @notice returns whether the given round number is settled
     */
    function isSettled(uint256 round) public view returns (bool) {
        return submissions[round].price != 0 && round < previousRound();
    }

    /**
     * @notice returns the settled price for the given round, only callable
     *         by depositors with a remaining balance
     */
    function settledPrice(uint256 round) external view returns (uint256) {
        require(
            balanceOf(msg.sender) > 0,
            "cannot query with zero deposit balance"
        );
        require(isSettled(round), "round is not yet settled");
        return submissions[round].price;
    }

    /**
     * @notice returns the winning submitter of the given round
     */
    function winner(uint256 round) external view returns (address) {
        require(isSettled(round), "round is not yet settled");
        return submissions[round].winner;
    }

    /**
     * @notice submit a price to the price feed by proving a block header
     * @param prover the block header prover
     * @param proof the proof to verify a block header's validity, passed to Relic
     */
    function submit(address prover, bytes calldata proof) external payable {
        // check that it's a valid prover
        reliquary.checkProver(reliquary.provers(prover));

        // prove the fact, forwarding along any proving fee
        Fact memory fact = IProver(prover).prove{value: msg.value}(
            proof,
            false
        );
        CoreTypes.BlockHeaderData memory head = abi.decode(
            fact.data,
            (CoreTypes.BlockHeaderData)
        );
        require(
            FactSignature.unwrap(fact.sig) ==
            FactSignature.unwrap(FactSigs.blockHeaderSig(head.Number)),
            "prover returned unexpected fact signature"
        );

        uint256 round = previousRound();
        require(
            blockToRound(head.Number) == round,
            "Header does not belong to previous round"
        );

        Submission memory current = submissions[round];
        if (current.price != 0) {
            require(
                head.BaseFee < current.price,
                "lower price already submitted"
            );
        }

        uint16 reward = currentReward();
        submissions[round] = Submission(
            msg.sender,
            uint80(head.BaseFee),
            reward
        );
        uint256 toClaim = (reward - current.reward) * REWARD_MULTIPLIER;

        claimBalance(toClaim);

        emit NewSubmission(round, msg.sender, head.BaseFee);
    }

    /**
     * @notice claim a batch of rewards for rounds won by the caller
     * @param rounds the list of round numbers to claim rewards for
     */
    function claimRewards(uint256[] memory rounds) external {
        uint256 total = 0;
        for (uint256 i = 0; i < rounds.length; i++) {
            Submission memory sub = submissions[rounds[i]];
            require(
                sub.winner == msg.sender,
                "Can only claim rounds that you won"
            );
            require(sub.reward > 0, "Can only claim unclaimed rewards");
            require(isSettled(rounds[i]), "Can only claim for settled rounds");
            total += uint256(sub.reward) * REWARD_MULTIPLIER;

            // mark it as claimed
            sub.reward = 0;
            submissions[rounds[i]] = sub;
        }
        redeemClaimed(msg.sender, total);
    }
}
