/// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

contract Rounds {
    uint256 public constant ROUND_SIZE = 8192;

    function blockToRound(uint256 blockNum) public pure returns (uint256) {
        return blockNum / ROUND_SIZE;
    }

    function currentRound() public view returns (uint256) {
        return blockToRound(block.number);
    }

    function previousRound() public view returns (uint256) {
        return currentRound() - 1;
    }

    function currentRoundOffset() public view returns (uint256) {
        return block.number % ROUND_SIZE;
    }
}
