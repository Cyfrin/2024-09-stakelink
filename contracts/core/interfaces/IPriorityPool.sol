// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IPriorityPool {
    enum PoolStatus {
        OPEN,
        DRAINING,
        CLOSED
    }

    function paused() external view returns (bool);

    function depositsSinceLastUpdate() external view returns (uint256);

    function poolStatus() external view returns (PoolStatus);

    function canWithdraw(
        address _account,
        uint256 _distributionAmount
    ) external view returns (uint256);

    function pauseForUpdate() external;

    function setPoolStatus(PoolStatus _status) external;

    function updateDistribution(
        bytes32 _merkleRoot,
        bytes32 _ipfsHash,
        uint256 _amountDistributed,
        uint256 _sharesAmountDistributed
    ) external;

    function executeQueuedWithdrawals(uint256 _amount, bytes[] calldata _data) external;

    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory);

    function performUpkeep(bytes calldata _performData) external;
}
