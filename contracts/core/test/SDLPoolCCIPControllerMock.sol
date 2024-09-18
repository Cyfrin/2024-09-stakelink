// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ISDLPool.sol";

contract SDLPoolCCIPControllerMock {
    using SafeERC20 for IERC20;

    IERC20 public sdlToken;
    ISDLPool public sdlPool;
    address public reSDLTokenBridge;

    uint256 public rewardsDistributed;

    error OnlyRESDLTokenBridge();

    modifier onlyBridge() {
        if (msg.sender != reSDLTokenBridge) revert OnlyRESDLTokenBridge();
        _;
    }

    constructor(address _sdlToken, address _sdlPool) {
        sdlToken = IERC20(_sdlToken);
        sdlPool = ISDLPool(_sdlPool);
    }

    function handleOutgoingRESDL(
        uint64,
        address _sender,
        uint256 _tokenId
    ) external onlyBridge returns (address, ISDLPool.RESDLToken memory) {
        return (address(0), sdlPool.handleOutgoingRESDL(_sender, _tokenId, reSDLTokenBridge));
    }

    function handleIncomingRESDL(
        uint64,
        address _receiver,
        uint256 _tokenId,
        ISDLPool.RESDLToken calldata _reSDLToken
    ) external onlyBridge {
        sdlToken.safeTransferFrom(reSDLTokenBridge, address(sdlPool), _reSDLToken.amount);
        sdlPool.handleIncomingRESDL(_receiver, _tokenId, _reSDLToken);
    }

    function distributeRewards(uint256[] calldata) external {
        rewardsDistributed++;
    }

    function setRESDLTokenBridge(address _reSDLTokenBridge) external {
        reSDLTokenBridge = _reSDLTokenBridge;
    }
}
