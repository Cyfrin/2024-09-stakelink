// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface ISequencerVault {
    function getTotalDeposits() external view returns (uint256);

    function getPendingRewards() external view returns (uint256);

    function updateDeposits(
        uint256 _minRewards,
        uint32 _l2Gas
    ) external payable returns (uint256, uint256, uint256);

    function deposit(uint256 _amount) external;

    function upgradeToAndCall(address _newImplementation, bytes memory _data) external;

    function upgradeTo(address _newImplementation) external;
}
