// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface ISequencerVCS {
    function rewardRecipient() external view returns (address);

    function operatorRewardPercentage() external view returns (uint256);

    function withdrawOperatorRewards(
        address _rewardsReceiver,
        uint256 _amount
    ) external returns (uint256);

    function handleIncomingL2Rewards(uint256 _amount) external;

    function getVaultDepositMax() external view returns (uint256);
}
