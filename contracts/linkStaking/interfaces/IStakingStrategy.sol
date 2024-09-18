// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../../core/interfaces/IStrategy.sol";

interface IStakingStrategy is IStrategy {
    function migrate(bytes calldata data) external;
}
