// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ISDLPool.sol";
import "../interfaces/ISDLPoolCCIPController.sol";

/**
 * @title reSDL Token Bridge
 * @notice Handles CCIP transfers of reSDL NFTs
 */
contract RESDLTokenBridge {
    using SafeERC20 for IERC20;

    IERC20 public linkToken;

    IERC20 public sdlToken;
    ISDLPool public sdlPool;
    ISDLPoolCCIPController public sdlPoolCCIPController;

    event TokenTransferred(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address indexed sender,
        address receiver,
        uint256 tokenId,
        address feeToken,
        uint256 fees
    );
    event TokenReceived(
        bytes32 indexed messageId,
        uint64 indexed sourceChainSelector,
        address indexed sender,
        address receiver,
        uint256 tokenId
    );

    error InsufficientFee();
    error TransferFailed();
    error FeeExceedsLimit();
    error SenderNotAuthorized();
    error InvalidReceiver();
    error InvalidMsgValue();

    /**
     * @notice Initializes the contract
     * @param _linkToken address of the LINK token
     * @param _sdlToken address of the SDL token
     * @param _sdlPool address of the SDL Pool
     * @param _sdlPoolCCIPController address of the SDL Pool CCIP controller
     **/
    constructor(
        address _linkToken,
        address _sdlToken,
        address _sdlPool,
        address _sdlPoolCCIPController
    ) {
        linkToken = IERC20(_linkToken);
        sdlToken = IERC20(_sdlToken);
        sdlPool = ISDLPool(_sdlPool);
        sdlPoolCCIPController = ISDLPoolCCIPController(_sdlPoolCCIPController);
    }

    modifier onlySDLPoolCCIPController() {
        if (msg.sender != address(sdlPoolCCIPController)) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Transfers an reSDL token to a destination chain
     * @param _destinationChainSelector id of destination chain
     * @param _receiver address to receive reSDL on destination chain
     * @param _tokenId id of reSDL token
     * @param _payNative whether fee should be paid natively or with LINK
     * @param _maxLINKFee call will revert if LINK fee exceeds this value
     * @param _gasLimit gas limit to use for CCIP message on destination chain
     **/
    function transferRESDL(
        uint64 _destinationChainSelector,
        address _receiver,
        uint256 _tokenId,
        bool _payNative,
        uint256 _maxLINKFee,
        uint256 _gasLimit
    ) external payable returns (bytes32 messageId) {
        if (msg.sender != sdlPool.ownerOf(_tokenId)) revert SenderNotAuthorized();
        if (_receiver == address(0)) revert InvalidReceiver();
        if (_payNative == false && msg.value != 0) revert InvalidMsgValue();

        (address destination, ISDLPool.RESDLToken memory reSDLToken) = sdlPoolCCIPController
            .handleOutgoingRESDL(_destinationChainSelector, msg.sender, _tokenId);

        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            _receiver,
            _tokenId,
            reSDLToken,
            destination,
            _payNative ? address(0) : address(linkToken),
            _gasLimit
        );

        uint256 fees = IRouterClient(sdlPoolCCIPController.getRouter()).getFee(
            _destinationChainSelector,
            evm2AnyMessage
        );

        if (_payNative) {
            if (fees > msg.value) revert InsufficientFee();
            messageId = sdlPoolCCIPController.ccipSend{value: fees}(
                _destinationChainSelector,
                evm2AnyMessage
            );
            if (fees < msg.value) {
                (bool success, ) = msg.sender.call{value: msg.value - fees}("");
                if (!success) revert TransferFailed();
            }
        } else {
            if (fees > _maxLINKFee) revert FeeExceedsLimit();
            linkToken.safeTransferFrom(msg.sender, address(sdlPoolCCIPController), fees);
            messageId = sdlPoolCCIPController.ccipSend(_destinationChainSelector, evm2AnyMessage);
        }

        emit TokenTransferred(
            messageId,
            _destinationChainSelector,
            msg.sender,
            _receiver,
            _tokenId,
            _payNative ? address(0) : address(linkToken),
            fees
        );
    }

    /**
     * @notice Returns the current fee for an reSDL transfer
     * @param _destinationChainSelector id of destination chain
     * @param _payNative whether fee should be paid natively or with LINK
     * @param _gasLimit gas limit to use for CCIP message on destination chain
     * @return fee current fee
     **/
    function getFee(
        uint64 _destinationChainSelector,
        bool _payNative,
        uint256 _gasLimit
    ) external view returns (uint256) {
        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            address(this),
            0,
            ISDLPool.RESDLToken(0, 0, 0, 0, 0),
            address(this),
            _payNative ? address(0) : address(linkToken),
            _gasLimit
        );

        return
            IRouterClient(sdlPoolCCIPController.getRouter()).getFee(
                _destinationChainSelector,
                evm2AnyMessage
            );
    }

    /**
     * @notice Processes a received message
     * @dev handles incoming reSDL transfers
     * @param _message CCIP message
     **/
    function ccipReceive(Client.Any2EVMMessage memory _message) external onlySDLPoolCCIPController {
        address sender = abi.decode(_message.sender, (address));

        (
            address receiver,
            uint256 tokenId,
            uint256 amount,
            uint256 boostAmount,
            uint64 startTime,
            uint64 duration,
            uint64 expiry
        ) = abi.decode(_message.data, (address, uint256, uint256, uint256, uint64, uint64, uint64));

        sdlPoolCCIPController.handleIncomingRESDL(
            _message.sourceChainSelector,
            receiver,
            tokenId,
            ISDLPool.RESDLToken(amount, boostAmount, startTime, duration, expiry)
        );

        emit TokenReceived(
            _message.messageId,
            _message.sourceChainSelector,
            sender,
            receiver,
            tokenId
        );
    }

    /**
     * @notice Builds a CCIP message
     * @dev builds the message for outgoing reSDL transfers
     * @param _receiver address to receive reSDL token on destination chain
     * @param _tokenId id of reSDL token
     * @param _reSDLToken reSDL token
     * @param _destination address of destination contract
     * @param _feeTokenAddress address of token that fees will be paid in
     * @param _gasLimit gas limit to use for CCIP message on destination chain
     **/
    function _buildCCIPMessage(
        address _receiver,
        uint256 _tokenId,
        ISDLPool.RESDLToken memory _reSDLToken,
        address _destination,
        address _feeTokenAddress,
        uint256 _gasLimit
    ) internal view returns (Client.EVM2AnyMessage memory) {
        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        Client.EVMTokenAmount memory tokenAmount = Client.EVMTokenAmount({
            token: address(sdlToken),
            amount: _reSDLToken.amount
        });
        tokenAmounts[0] = tokenAmount;

        Client.EVM2AnyMessage memory evm2AnyMessage = Client.EVM2AnyMessage({
            receiver: abi.encode(_destination),
            data: abi.encode(
                _receiver,
                _tokenId,
                _reSDLToken.amount,
                _reSDLToken.boostAmount,
                _reSDLToken.startTime,
                _reSDLToken.duration,
                _reSDLToken.expiry
            ),
            tokenAmounts: tokenAmounts,
            extraArgs: Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: _gasLimit})),
            feeToken: _feeTokenAddress
        });

        return evm2AnyMessage;
    }
}
