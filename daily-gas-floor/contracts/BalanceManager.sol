/// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

/**
 * @title BalanceManager
 * @author Theori, Inc.
 * @notice Manages the ETH balance of the price feed. Accepts deposits and sets
 *         aside balance for future claims. Deposits are tracked using a circular
 *         linked list. Depositors are charged for claims using a round-robin.
 */
contract BalanceManager {
    uint256 public constant MIN_DEPOSIT = 1 ether / 10;

    struct DepositNode {
        address next;
        uint96 balance;
    }

    /// @dev each depositor address has a linked-list node
    mapping(address => DepositNode) public nodes;

    /// @dev the address associated with last node of the circular linked-list
    /// @dev the last node is used for cheap insertion and removal at the front
    address public last;

    /// @dev the current amount of self.balance which is claimed
    uint96 public claimedBalance;

    /**
     * @notice returns the amount of self.balance which is unclaimed
     */
    function unclaimedBalance() public view returns (uint256) {
        return address(this).balance - claimedBalance;
    }

    /**
     * @notice returns the remaining deposit balance of the depositor
     * @param depositor the address of the depositor
     */
    function balanceOf(address depositor) public view returns (uint256) {
        return nodes[depositor].balance;
    }

    /**
     * @notice claims an amount of self.balance
     * @param amount the amount to claim
     * @dev reverts if amount is greater than unclaimedBalance()
     * @dev charges depositor in round-robin until the amount is satisfied
     */
    function claimBalance(uint256 amount) internal {
        require(
            amount <= unclaimedBalance(),
            "Cannot claim more than unclaimedBalance()"
        );
        claimedBalance += uint96(amount);

        address prev = last;

        require(prev != address(0), "Unexpected: no active depositors");
        address cur = nodes[prev].next;

        // loop until the amount is fully claimed, or no depositors remain
        // note that unclaimedBalance() may be higher than the sum of deposits
        // due to potential unavoidable donations (e.g. via selfdestruct)
        while (amount > 0 && prev != address(0)) {
            DepositNode memory node = nodes[cur];

            if (node.balance <= amount) {
                amount -= node.balance;

                // remove empty node
                delete nodes[cur];

                if (node.next == cur) {
                    // only one node, just reset to empty list
                    prev = address(0);
                } else {
                    // unlink current node
                    nodes[prev].next = node.next;
                }

                // move to the next node, prev stays the same
                cur = node.next;
            } else {
                nodes[cur].balance = node.balance - uint96(amount);
                amount = 0;
                prev = cur;
            }
        }

        // store the new last
        last = prev;
    }

    /**
     * @notice redeems some claimed balance and sends it to a recipient
     * @param recipient the address to receive the balance
     * @param amount the amount to transfer
     * @dev reverts if amount is greater than claimedBalance
     */
    function redeemClaimed(address recipient, uint256 amount) internal {
        claimedBalance -= uint96(amount);
        payable(recipient).transfer(amount);
    }

    /**
     * @notice adds a deposit for a given address. If the depositor address is new,
     *         it will be inserted into the circular linked-list.
     * @param depositor the depositor address
     */
    function depositFor(address depositor) public payable {
        require(depositor != address(0), "cannot deposit to zero address");
        require(msg.value >= MIN_DEPOSIT, "deposit amount too small");
        DepositNode memory node = nodes[depositor];

        // check if we need to insert the node
        if (node.balance == 0) {
            if (last == address(0)) {
                // new node is the only node
                last = depositor;
                node.next = depositor;
            } else {
                // new node is inserted at the front
                node.next = nodes[last].next;
                nodes[last].next = depositor;
            }
        }

        // update the balance and store the node
        node.balance += uint96(msg.value);
        nodes[depositor] = node;
    }

    /**
     * @notice calls depositFor(msg.sender)
     */
    function deposit() external payable {
        depositFor(msg.sender);
    }
}
