/// SPDX-License-Identifier: MIT

pragma solidity >=0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "@relicprotocol/contracts/interfaces/IProver.sol";
import "@relicprotocol/contracts/lib/Facts.sol";
import "@relicprotocol/contracts/lib/FactSigs.sol";
import "@relicprotocol/contracts/lib/Storage.sol";
import "@relicprotocol/contracts/interfaces/IReliquary.sol";

struct ClaimedBalance {
    uint248 balance;
    bool claimed;
}

/**
 * @title ClaimedERC20
 * @author Theori, Inc.
 * @notice Track balances and claimed status in one storage slot to save on
 *         gas.
 * @dev Requires a separate contract due to private definitions in the
 *      OpenZeppelin ERC20 contract. Must ensure 248 bits is enough to fit
 *      any balance. For USDT this is correct, but for other tokens it may
 *      not be.
 */
abstract contract ClaimedERC20 is ERC20 {
    mapping(address => ClaimedBalance) public _claimedBalance;

    // initialize upper byte of this slot when deploying to save gas on first mint
    bool private initialized;
    uint248 public _totalSupply;

    constructor() {
        // set the slot to nonzero for gas savings on first mint
        initialized = true;
    }

    /// @inheritdoc ERC20
    function balanceOf(
        address account
    ) public view virtual override returns (uint256) {
        return _claimedBalance[account].balance;
    }

    /// @inheritdoc ERC20
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");

        _beforeTokenTransfer(from, to, amount);

        uint256 fromBalance = _claimedBalance[from].balance;
        require(
            fromBalance >= amount,
            "ERC20: transfer amount exceeds balance"
        );
        unchecked {
            _claimedBalance[from].balance = uint248(fromBalance - amount);
        }
        _claimedBalance[to].balance += uint248(amount);

        emit Transfer(from, to, amount);

        _afterTokenTransfer(from, to, amount);
    }

    /// @inheritdoc ERC20
    function _mint(address account, uint256 amount) internal override {
        require(account != address(0), "ERC20: mint to the zero address");
        require(amount <= uint248(2 ** 248 - 1), "Amount too large");

        _beforeTokenTransfer(address(0), account, amount);

        _totalSupply += uint248(amount);
        _claimedBalance[account].balance += uint248(amount);
        emit Transfer(address(0), account, amount);

        _afterTokenTransfer(address(0), account, amount);
    }

    /// @inheritdoc ERC20
    function _burn(address account, uint256 amount) internal override {
        require(account != address(0), "ERC20: burn from the zero address");

        _beforeTokenTransfer(account, address(0), amount);

        uint256 accountBalance = _claimedBalance[account].balance;
        require(accountBalance >= amount, "ERC20: burn amount exceeds balance");
        unchecked {
            _claimedBalance[account].balance = uint248(accountBalance - amount);
        }
        _totalSupply -= uint248(amount);

        emit Transfer(account, address(0), amount);

        _afterTokenTransfer(account, address(0), amount);
    }

    /// @inheritdoc ERC20
    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }
}
