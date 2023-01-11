/// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import '../BalanceManager.sol';

contract BalanceManagerTest is BalanceManager {
    function claim(uint256 amount) external {
        claimBalance(amount);
    }
}