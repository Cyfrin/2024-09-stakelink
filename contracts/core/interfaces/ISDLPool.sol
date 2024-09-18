// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./IRewardsPoolController.sol";

interface ISDLPool is IRewardsPoolController {
    struct RESDLToken {
        uint256 amount;
        uint256 boostAmount;
        uint64 startTime;
        uint64 duration;
        uint64 expiry;
    }

    function effectiveBalanceOf(address _account) external view returns (uint256);

    function ownerOf(uint256 _lockId) external view returns (address);

    function supportedTokens() external view returns (address[] memory);

    function handleOutgoingRESDL(
        address _sender,
        uint256 _reSDLToken,
        address _sdlReceiver
    ) external returns (RESDLToken memory);

    function handleIncomingRESDL(
        address _receiver,
        uint256 _tokenId,
        RESDLToken calldata _reSDLToken
    ) external;
}
