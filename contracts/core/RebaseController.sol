// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IStakingPool.sol";
import "./interfaces/IPriorityPool.sol";
import "./interfaces/IStrategy.sol";
import "./interfaces/ISDLPoolCCIPControllerPrimary.sol";
import "./interfaces/IInsurancePool.sol";

/**
 * @title Rebase Controller
 * @notice Updates and distributes rewards across the staking pool and cross-chain SDL Pools
 * @dev Chainlink automation should call updateRewards periodically under normal circumstances and call performUpkeep
 * in the case of a negative rebase in the staking pool
 */
contract RebaseController is Ownable {
    IStakingPool public stakingPool;
    IPriorityPool public priorityPool;
    ISDLPoolCCIPControllerPrimary public sdlPoolCCIPController;
    IInsurancePool public insurancePool;

    address public rebaseBot;
    uint256 public maxRebaseLossBP;

    error NoStrategiesToUpdate();
    error PositiveDepositChange();
    error InvalidMaxRebaseLoss();
    error PoolClosed();
    error SenderNotAuthorized();

    constructor(
        address _stakingPool,
        address _priorityPool,
        address _sdlPoolCCIPController,
        address _insurancePool,
        address _rebaseBot,
        uint256 _maxRebaseLossBP
    ) {
        stakingPool = IStakingPool(_stakingPool);
        priorityPool = IPriorityPool(_priorityPool);
        sdlPoolCCIPController = ISDLPoolCCIPControllerPrimary(_sdlPoolCCIPController);
        insurancePool = IInsurancePool(_insurancePool);
        rebaseBot = _rebaseBot;
        if (_maxRebaseLossBP > 9000) revert InvalidMaxRebaseLoss();
        maxRebaseLossBP = _maxRebaseLossBP;
    }

    modifier onlyRebaseBot() {
        if (msg.sender != rebaseBot) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice updates strategy rewards in the staking pool and distributes rewards to cross-chain SDL pools
     * @param _strategyIdxs indexes of strategies to update rewards for
     * @param _data encoded data to be passed to each strategy
     * @param _gasLimits list of gas limits to use for CCIP messages on secondary chains
     **/
    function updateRewards(
        uint256[] calldata _strategyIdxs,
        bytes calldata _data,
        uint256[] calldata _gasLimits
    ) external onlyRebaseBot {
        if (priorityPool.poolStatus() == IPriorityPool.PoolStatus.CLOSED) revert PoolClosed();

        stakingPool.updateStrategyRewards(_strategyIdxs, _data);
        sdlPoolCCIPController.distributeRewards(_gasLimits);
    }

    /**
     * @notice returns whether or not rewards should be updated due to a neagtive rebase,
     * the strategies to update, and their total deposit change
     * @dev should be called by a custom bot (not CL automation)
     * @return upkeepNeeded whether or not rewards should be updated
     * @return performData abi encoded list of strategy indexes to update and their total deposit change
     **/
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        if (priorityPool.poolStatus() == IPriorityPool.PoolStatus.CLOSED) return (false, "0x");

        address[] memory strategies = stakingPool.getStrategies();
        bool[] memory strategiesToUpdate = new bool[](strategies.length);
        uint256 totalStrategiesToUpdate;
        int256 totalDepositChange;

        for (uint256 i = 0; i < strategies.length; ++i) {
            int256 depositChange = IStrategy(strategies[i]).getDepositChange();
            if (depositChange < 0) {
                strategiesToUpdate[i] = true;
                totalStrategiesToUpdate++;
                totalDepositChange += depositChange;
            }
        }

        if (totalStrategiesToUpdate != 0) {
            uint256[] memory strategyIdxs = new uint256[](totalStrategiesToUpdate);
            uint256 strategiesAdded;

            for (uint256 i = 0; i < strategiesToUpdate.length; ++i) {
                if (strategiesToUpdate[i]) {
                    strategyIdxs[strategiesAdded] = i;
                    strategiesAdded++;
                }
            }

            return (true, abi.encode(strategyIdxs, uint256(-1 * totalDepositChange)));
        }

        return (false, "0x");
    }

    /**
     * @notice Updates rewards in the case of a negative rebase or pauses the priority
     * pool if losses exceed the maximum
     * @dev should be called by a custom bot (not CL automation)
     * @param _performData abi encoded list of strategy indexes to update and their total deposit change
     */
    function performUpkeep(bytes calldata _performData) external onlyRebaseBot {
        if (priorityPool.poolStatus() == IPriorityPool.PoolStatus.CLOSED) revert PoolClosed();

        (uint256[] memory strategiesToUpdate, uint256 totalDepositChange) = abi.decode(
            _performData,
            (uint256[], uint256)
        );

        if (strategiesToUpdate.length == 0 || totalDepositChange == 0)
            revert NoStrategiesToUpdate();

        if ((10000 * totalDepositChange) / stakingPool.totalSupply() > maxRebaseLossBP) {
            priorityPool.setPoolStatus(IPriorityPool.PoolStatus.CLOSED);
            insurancePool.initiateClaim();
        } else {
            stakingPool.updateStrategyRewards(strategiesToUpdate, "");
        }
    }

    /**
     * @notice Reopens the priority pool and insurance pool after they were paused as a result
     * of a significant slashing event and rebases the staking pool
     * @dev sender should ensure all strategies with losses are included in the index list and
     * all strategies with gains are excluded
     * @param _strategyIdxs list of strategy indexes to update
     */
    function reopenPool(uint256[] calldata _strategyIdxs) external onlyOwner {
        priorityPool.setPoolStatus(IPriorityPool.PoolStatus.OPEN);
        insurancePool.resolveClaim();
        stakingPool.updateStrategyRewards(_strategyIdxs, "");
    }

    /**
     * @notice sets the rebase bot
     * @param _rebaseBot address of rebase bot
     */
    function setRebaseLossBot(address _rebaseBot) external onlyOwner {
        rebaseBot = _rebaseBot;
    }

    /**
     * @notice sets the maximum basis point amount of the total amount staked in the staking pool that can be
     * lost in a single rebase without pausing the pool
     * @param _maxRebaseLossBP max basis point loss
     */
    function setMaxRebaseLossBP(uint256 _maxRebaseLossBP) external onlyOwner {
        if (_maxRebaseLossBP > 9000) revert InvalidMaxRebaseLoss();
        maxRebaseLossBP = _maxRebaseLossBP;
    }
}
