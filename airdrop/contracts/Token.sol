/// SPDX-License-Identifier: MIT

pragma solidity >=0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "@relicprotocol/contracts/interfaces/IProver.sol";
import "@relicprotocol/contracts/lib/Facts.sol";
import "@relicprotocol/contracts/lib/FactSigs.sol";
import "@relicprotocol/contracts/lib/Storage.sol";
import "@relicprotocol/contracts/interfaces/IReliquary.sol";

import "./ClaimedERC20.sol";

/**
 * @title AirDropUSDT
 * @author Theori, Inc.
 * @notice A trustless, fully on-chain price airdrop for USDT tokens.
 * @notice Eligibility is based on the balance of USDT tokens at the specified
 *         block number. Functions as a generic ERC20 token.
 */
contract Token is ClaimedERC20 {
    IReliquary immutable reliquary;
    address immutable USDT;
    uint immutable blockNum;

    constructor(
        address _reliquary,
        address _USDT,
        uint _blockNum
    ) ERC20("AirDropExampleUSDT", "ADUSDT") ClaimedERC20() {
        reliquary = IReliquary(_reliquary);
        USDT = _USDT;
        blockNum = _blockNum;
    }

    /// @inheritdoc ERC20
    function decimals() public view virtual override returns (uint8) {
        // match the same value used in USDT
        return 6;
    }

    /**
     * @notice check if the given user has already claimed their airdrop
     * @param owner the owner for which to check the claim status
     */
    function claimed(address owner) public view returns (bool) {
        return _claimedBalance[owner].claimed;
    }

    /**
     * @notice the slot calculation that matches the slot for USDT balances
     * @param who the address parameter to the balanceOf function
     */
    function slotForUSDTBalance(address who) public pure returns (bytes32) {
        return
            Storage.mapElemSlot(
                bytes32(uint(2)),
                bytes32(uint256(uint160(who)))
            );
    }

    /**
     * @notice mint a token given a stored proof alread in the Reliquary
     * @param who the address of the user to whom tokens will be sent
     */
    function mintStoredProof(address who) external {
        require(_claimedBalance[who].claimed == false, "already claimed");

        (bool exists, , bytes memory data) = reliquary.verifyFactNoFee(
            USDT,
            FactSigs.storageSlotFactSig(slotForUSDTBalance(who), blockNum)
        );
        require(exists, "storage proof missing");
        _claimedBalance[who].claimed = true;

        uint priorUSDTBalance = Storage.parseUint256(data);
        _mint(who, priorUSDTBalance);
    }

    /**
     * @notice mint a token based on the proof passed in
     * @param who the address of the user to whom tokens will be sent
     * @param prover the address of the Reliquary approved slot storage prover
     * @param proof the opaque proof generated from the Relic API for storage
     */
    function proveAndMint(
        address who,
        address prover,
        bytes calldata proof
    ) public payable returns (uint256) {
        require(_claimedBalance[who].claimed == false, "already claimed");
        reliquary.checkProver(reliquary.provers(prover));

        Fact memory fact = IProver(prover).prove{value: msg.value}(
            proof,
            false
        );

        require(
            FactSignature.unwrap(fact.sig) ==
                FactSignature.unwrap(
                    FactSigs.storageSlotFactSig(
                        slotForUSDTBalance(who),
                        blockNum
                    )
                ),
            "prover returned unexpected fact signature"
        );

        _claimedBalance[who].claimed = true;
        uint priorUSDTBalance = Storage.parseUint256(fact.data);
        _mint(who, priorUSDTBalance);
        return priorUSDTBalance;
    }
}
