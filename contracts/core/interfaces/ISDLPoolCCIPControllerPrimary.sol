// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./ISDLPoolCCIPController.sol";

interface ISDLPoolCCIPControllerPrimary is ISDLPoolCCIPController {
    function distributeRewards(uint256[] calldata _gasLimits) external;
}
