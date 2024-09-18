// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IWithdrawalPool {
    function getTotalQueuedWithdrawals() external view returns (uint256);

    function deposit(uint256 _amount) external;

    function queueWithdrawal(address _account, uint256 _amount) external;
}
