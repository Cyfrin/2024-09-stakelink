// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

/**
 * @title Sequencer Rewards CCIP Sender
 * @notice Receives sequencer rewards on METIS and transfers them back Ethereum through CCIP
 */
contract SequencerRewardsCCIPSender is UUPSUpgradeable, OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IRouterClient public router;
    IERC20Upgradeable public linkToken;
    IERC20Upgradeable public metisToken;

    address public transferInitiator;

    uint64 public destinationChainSelector;
    address public destinationReceiver;

    bytes public extraArgs;

    event RewardsTransferred(bytes32 indexed messageId, uint256 tokenAmount, uint256 fees);

    error FeeExceedsLimit();
    error ZeroAddress();
    error NoRewards();
    error SenderNotAuthorized();
    error AlreadySet();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract
     * @param _router address of the CCIP router
     * @param _linkToken address of the LINK token
     * @param _metisToken address of the METIS token
     * @param _transferInitiator address authorized to initiate rewards transfers
     * @param _destinationChainSelector id of destination chain
     * @param _extraArgs extra args for reward token CCIP transfer
     **/
    function initialize(
        address _router,
        address _linkToken,
        address _metisToken,
        address _transferInitiator,
        uint64 _destinationChainSelector,
        bytes memory _extraArgs
    ) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init();

        metisToken = IERC20Upgradeable(_metisToken);
        transferInitiator = _transferInitiator;
        destinationChainSelector = _destinationChainSelector;
        extraArgs = _extraArgs;

        if (_router != address(0)) {
            router = IRouterClient(_router);
            linkToken = IERC20Upgradeable(_linkToken);
            linkToken.approve(_router, type(uint256).max);
            metisToken.approve(_router, type(uint256).max);
        }
    }

    /**
     * @notice Reverts if sender is not transfer initiator
     **/
    modifier onlyTransferInitiator() {
        if (msg.sender != transferInitiator) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Returns the total available rewards
     * @return available rewards
     **/
    function getRewards() external view returns (uint256) {
        return metisToken.balanceOf(address(this));
    }

    /**
     * @notice Transfers reward tokens to the destination chain
     * @param _maxLINKFee call will revert if LINK fee exceeds this value
     **/
    function transferRewards(
        uint256 _maxLINKFee
    ) external onlyTransferInitiator returns (bytes32 messageId) {
        uint256 amount = metisToken.balanceOf(address(this));
        if (amount == 0) revert NoRewards();

        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(amount);

        uint256 fees = router.getFee(destinationChainSelector, evm2AnyMessage);
        if (fees > _maxLINKFee) revert FeeExceedsLimit();

        messageId = router.ccipSend(destinationChainSelector, evm2AnyMessage);

        emit RewardsTransferred(messageId, amount, fees);
        return messageId;
    }

    /**
     * @notice Withdraws fee tokens
     * @param _amount amount to withdraw
     **/
    function withdrawFeeTokens(uint256 _amount) external onlyOwner {
        linkToken.safeTransfer(msg.sender, _amount);
    }

    /**
     * @notice Sets the address authorized to initiate rewards transfers
     * @param _transferInitiator address of transfer initiator
     **/
    function setTransferInitiator(address _transferInitiator) external onlyOwner {
        transferInitiator = _transferInitiator;
    }

    /**
     * @notice Sets extra args for reward token CCIP transfers
     * @param _extraArgs extra args
     **/
    function setExtraArgs(bytes calldata _extraArgs) external onlyOwner {
        extraArgs = _extraArgs;
    }

    /**
     * @notice Sets the address on the destination chain that rewards are sent to
     * @param _destinationReceiver receiver address
     **/
    function setDestinationReceiver(address _destinationReceiver) external onlyOwner {
        if (_destinationReceiver == address(0)) revert ZeroAddress();
        destinationReceiver = _destinationReceiver;
    }

    /**
     * @notice Sets the CCIP router
     * @param _router router address
     **/
    function setRouter(address _router) external onlyOwner {
        if (_router == address(0)) revert ZeroAddress();

        if (address(router) != address(0)) {
            linkToken.approve(address(router), 0);
            metisToken.approve(address(router), 0);
        }

        linkToken.approve(_router, type(uint256).max);
        metisToken.approve(_router, type(uint256).max);
        router = IRouterClient(_router);
    }

    /**
     * @notice Sets the LINK token
     * @param _linkToken token address
     **/
    function setLINKToken(address _linkToken) external onlyOwner {
        if (address(linkToken) != address(0)) revert AlreadySet();
        linkToken = IERC20Upgradeable(_linkToken);
    }

    /**
     * @notice Builds a CCIP message
     * @param _amount amount of tokens to transfer
     **/
    function _buildCCIPMessage(
        uint256 _amount
    ) private view returns (Client.EVM2AnyMessage memory) {
        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({token: address(metisToken), amount: _amount});

        return
            Client.EVM2AnyMessage({
                receiver: abi.encode(destinationReceiver),
                data: "",
                tokenAmounts: tokenAmounts,
                extraArgs: extraArgs,
                feeToken: address(linkToken)
            });
    }

    /**
     * @dev Checks authorization for contract upgrades
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
