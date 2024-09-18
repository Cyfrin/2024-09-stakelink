// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../core/ccip/base/CCIPReceiver.sol";
import "../interfaces/ISequencerVCS.sol";

/**
 * @title Sequencer Rewards CCIP Receiver
 * @notice Handles the receipt of sequencer rewards sent from METIS through CCIP
 */
contract SequencerRewardsCCIPReceiver is CCIPReceiver {
    using SafeERC20 for IERC20;

    IERC20 public metisToken;
    ISequencerVCS public sequencerVCS;
    address public stakingPool;

    address public whitelistedSender;

    event TokensReceived(bytes32 indexed messageId, uint256 tokenAmount);

    error InvalidMessage();
    error InvalidSender();

    /**
     * @notice Initializes the contract
     * @param _router address of the CCIP router
     * @param _metisToken address of the METIS token
     * @param _sequencerVCS address of the METIS staking strategy
     * @param _stakingPool address of the METIS staking pool
     * @param _whitelistedSender address authorized to send rewards to this contract
     **/
    constructor(
        address _router,
        address _metisToken,
        address _sequencerVCS,
        address _stakingPool,
        address _whitelistedSender
    ) CCIPReceiver(_router) {
        metisToken = IERC20(_metisToken);
        sequencerVCS = ISequencerVCS(_sequencerVCS);
        stakingPool = _stakingPool;
        whitelistedSender = _whitelistedSender;
    }

    /**
     * @notice Sets the l2 address authorized to send rewards to this contract
     * @param _whitelistedSender address of sender
     **/
    function setWhitelistedSender(address _whitelistedSender) external onlyOwner {
        whitelistedSender = _whitelistedSender;
    }

    /**
     * @notice Processes a received message
     * @param _message CCIP message
     **/
    function _ccipReceive(Client.Any2EVMMessage memory _message) internal override {
        if (_message.destTokenAmounts.length != 1) revert InvalidMessage();

        address sender = abi.decode(_message.sender, (address));
        address tokenAddress = _message.destTokenAmounts[0].token;
        uint256 tokenAmount = _message.destTokenAmounts[0].amount;

        if (tokenAddress != address(metisToken)) revert InvalidMessage();
        if (sender != whitelistedSender) revert InvalidSender();

        sequencerVCS.handleIncomingL2Rewards(tokenAmount);
        metisToken.safeTransfer(stakingPool, tokenAmount);

        emit TokensReceived(_message.messageId, tokenAmount);
    }
}
