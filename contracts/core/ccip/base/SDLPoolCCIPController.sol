// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../interfaces/IRESDLTokenBridge.sol";
import "../../interfaces/ISDLPool.sol";
import "./CCIPReceiver.sol";

/**
 * @title SDL Pool CCIP Controller
 * @notice Base contract for SDL Pool CCIP controllers
 */
abstract contract SDLPoolCCIPController is CCIPReceiver {
    using SafeERC20 for IERC20;

    IERC20 public immutable linkToken;

    IERC20 public immutable sdlToken;
    address public immutable sdlPool;
    address public reSDLTokenBridge;

    uint256 public maxLINKFee;

    event MessageSent(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        uint256 fees
    );
    event MessageReceived(bytes32 indexed messageId, uint64 indexed destinationChainSelector);

    error AlreadyAdded();
    error InvalidDestination();
    error SenderNotAuthorized();
    error FeeExceedsLimit(uint256 fee);
    error InvalidReceiver();

    /**
     * @notice Initializes the contract
     * @param _router address of the CCIP router
     * @param _linkToken address of the LINK token
     * @param _sdlToken address of the SDL token
     * @param _sdlPool address of the SDL Pool
     * @param _maxLINKFee max fee to be paid on an outgoing message
     **/
    constructor(
        address _router,
        address _linkToken,
        address _sdlToken,
        address _sdlPool,
        uint256 _maxLINKFee
    ) CCIPReceiver(_router) {
        linkToken = IERC20(_linkToken);
        sdlToken = IERC20(_sdlToken);
        sdlPool = _sdlPool;
        maxLINKFee = _maxLINKFee;
        linkToken.approve(_router, type(uint256).max);
        sdlToken.approve(_router, type(uint256).max);
    }

    modifier onlyBridge() {
        if (msg.sender != reSDLTokenBridge) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Handles the outgoing transfer of an reSDL token to another chain
     * @param _destinationChainSelector id of the destination chain
     * @param _sender sender of the transfer
     * @param _tokenId id of token
     * @return the destination address
     * @return the token being transferred
     **/
    function handleOutgoingRESDL(
        uint64 _destinationChainSelector,
        address _sender,
        uint256 _tokenId
    ) external virtual returns (address, ISDLPool.RESDLToken memory);

    /**
     * @notice Handles the incoming transfer of an reSDL token from another chain
     * @param _sourceChainSelector id of the source chain
     * @param _receiver receiver of the transfer
     * @param _tokenId id of reSDL token
     * @param _reSDLToken reSDL token
     **/
    function handleIncomingRESDL(
        uint64 _sourceChainSelector,
        address _receiver,
        uint256 _tokenId,
        ISDLPool.RESDLToken calldata _reSDLToken
    ) external virtual;

    /**
     * @notice Sends a CCIP message
     * @param _destinationChainSelector id of destination chain
     * @param _evmToAnyMessage CCIP message
     **/
    function ccipSend(
        uint64 _destinationChainSelector,
        Client.EVM2AnyMessage calldata _evmToAnyMessage
    ) external payable onlyBridge returns (bytes32) {
        if (msg.value != 0) {
            return
                IRouterClient(this.getRouter()).ccipSend{value: msg.value}(
                    _destinationChainSelector,
                    _evmToAnyMessage
                );
        } else {
            return
                IRouterClient(this.getRouter()).ccipSend(
                    _destinationChainSelector,
                    _evmToAnyMessage
                );
        }
    }

    /**
     * @notice Processes a received message
     * @param _message CCIP message
     **/
    function ccipReceive(Client.Any2EVMMessage calldata _message) external override onlyRouter {
        _verifyCCIPSender(_message);

        if (
            _message.destTokenAmounts.length == 1 &&
            _message.destTokenAmounts[0].token == address(sdlToken)
        ) {
            IRESDLTokenBridge(reSDLTokenBridge).ccipReceive(_message);
        } else {
            _ccipReceive(_message);
        }
    }

    /**
     * @notice Withdraws tokens held by this contract
     * @param _tokens list of tokens to withdraw
     * @param _amounts list of corresponding amounts to withdraw
     * @param _receiver address to receive tokens
     **/
    function recoverTokens(
        address[] calldata _tokens,
        uint256[] calldata _amounts,
        address _receiver
    ) external onlyOwner {
        if (_receiver == address(0)) revert InvalidReceiver();

        for (uint256 i = 0; i < _tokens.length; ++i) {
            IERC20(_tokens[i]).safeTransfer(_receiver, _amounts[i]);
        }
    }

    /**
     * @notice Sets the max LINK fee to be paid on an outgoing CCIP message
     * @param _maxLINKFee maximum fee in LINK
     **/
    function setMaxLINKFee(uint256 _maxLINKFee) external onlyOwner {
        maxLINKFee = _maxLINKFee;
    }

    /**
     * @notice Sets the address of the reSDL token bridge
     * @param _reSDLTokenBridge address of reSDL token bridge
     **/
    function setRESDLTokenBridge(address _reSDLTokenBridge) external onlyOwner {
        reSDLTokenBridge = _reSDLTokenBridge;
    }

    /**
     * @notice Sets the CCIP router
     * @param _router router address
     **/
    function setRouter(address _router) external override onlyOwner {
        if (_router == address(0)) revert InvalidRouter(address(0));

        address curRouter = getRouter();
        linkToken.approve(curRouter, 0);
        sdlToken.approve(curRouter, 0);

        linkToken.approve(_router, type(uint256).max);
        sdlToken.approve(_router, type(uint256).max);
        i_router = _router;
    }

    /**
     * @notice Verifies the sender of a CCIP message is whitelisted
     * @param _message CCIP message
     **/
    function _verifyCCIPSender(Client.Any2EVMMessage memory _message) internal view virtual;
}
