// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./base/StakingRewardsPool.sol";
import "./interfaces/IRewardsPool.sol";

/**
 * @title Insurance Pool
 * @notice Allows users to stake LP tokens to earn rewards while insuring the staking pool from significant slashing events
 */
contract InsurancePool is StakingRewardsPool {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint256 public totalDeposits;
    IRewardsPool public rewardsPool;

    address public rebaseController;
    uint256 public maxClaimAmountBP;
    bool public claimInProgress;

    uint64 public withdrawalDelayDuration;
    uint64 public withdrawalWindowDuration;
    mapping(address => uint64) private withdrawalRequests;

    event InitiateClaim();
    event ExecuteClaim(uint256 amount);
    event ResolveClaim();
    event RequestWithdrawal(address indexed account, uint64 withdrawalStartTime);
    event SetWithdrawalParams(uint64 withdrawalDelayDuration, uint64 withdrawalWindowDuration);

    error SenderNotAuthorized();
    error ClaimInProgress();
    error ExceedsMaxClaimAmount();
    error InvalidClaimAmount();
    error NoClaimInProgress();
    error WithdrawalWindowInactive();

    function initialize(
        address _lpToken,
        string memory _liquidTokenName,
        string memory _liquidTokenSymbol,
        address _rebaseController,
        uint256 _maxClaimAmountBP,
        uint64 _withdrawalDelayDuration,
        uint64 _withdrawalWindowDuration
    ) public initializer {
        __StakingRewardsPool_init(_lpToken, _liquidTokenName, _liquidTokenSymbol);
        rebaseController = _rebaseController;
        if (_maxClaimAmountBP > 9000) revert InvalidClaimAmount();
        maxClaimAmountBP = _maxClaimAmountBP;
        withdrawalDelayDuration = _withdrawalDelayDuration;
        withdrawalWindowDuration = _withdrawalWindowDuration;
    }

    modifier onlyRebaseController() {
        if (msg.sender != rebaseController) revert SenderNotAuthorized();
        _;
    }

    modifier whileNoClaimInProgress() {
        if (claimInProgress) revert ClaimInProgress();
        _;
    }

    /**
     * @notice deposits tokens into the pool
     * @dev will delete any active or upcoming withdrawal window
     * @param _amount amount of tokens to deposit
     */
    function deposit(uint256 _amount) external whileNoClaimInProgress {
        if (withdrawalRequests[msg.sender] != 0) delete withdrawalRequests[msg.sender];

        rewardsPool.updateReward(msg.sender);
        token.safeTransferFrom(msg.sender, address(this), _amount);
        _mint(msg.sender, _amount);
        totalDeposits += _amount;
    }

    /**
     * @notice withdraws tokens from the pool
     * @param _amount amount of tokens to withdraw
     */
    function withdraw(uint256 _amount) external whileNoClaimInProgress {
        if (!canWithdraw(msg.sender)) revert WithdrawalWindowInactive();

        rewardsPool.updateReward(msg.sender);
        _burn(msg.sender, _amount);
        totalDeposits -= _amount;
        token.safeTransfer(msg.sender, _amount);
    }

    /**
     * @notice requests a withdrawal and initiates the withdrawal delay period
     */
    function requestWithdrawal() external {
        uint64 withdrawalStartTime = uint64(block.timestamp) + withdrawalDelayDuration;
        withdrawalRequests[msg.sender] = withdrawalStartTime;
        emit RequestWithdrawal(msg.sender, withdrawalStartTime);
    }

    /**
     * @notice returns whether an account's withdrawal is active
     * @param _account address of account
     * @return canWithdraw whether withdrawal window is active
     */
    function canWithdraw(address _account) public view returns (bool) {
        if (withdrawalDelayDuration == 0) return true;
        (uint64 start, uint64 end) = getWithdrawalWindow(_account);
        return block.timestamp >= start && block.timestamp < end;
    }

    /**
     * @notice returns an account's current active or upcoming withdrawal window
     * @param _account address of account
     * @return start time and end time of withdrawal window
     */
    function getWithdrawalWindow(address _account) public view returns (uint64, uint64) {
        uint64 withdrawalStartTime = withdrawalRequests[_account];
        if (
            withdrawalDelayDuration == 0 ||
            block.timestamp >= withdrawalStartTime + withdrawalWindowDuration
        ) return (0, 0);
        return (withdrawalStartTime, withdrawalStartTime + withdrawalWindowDuration);
    }

    /**
     * @notice initiates the claim process
     */
    function initiateClaim() external onlyRebaseController whileNoClaimInProgress {
        claimInProgress = true;
        emit InitiateClaim();
    }

    /**
     * @notice executes a claim by withdrawing tokens from the pool
     * @dev will cause all stakers' balances to decrease by the percentage that is withdrawn
     * @param _amount amount of tokens to withdraw
     */
    function executeClaim(uint256 _amount) external onlyOwner {
        if (!claimInProgress) revert NoClaimInProgress();
        if (_amount > (totalDeposits * maxClaimAmountBP) / 10000) revert ExceedsMaxClaimAmount();

        totalDeposits -= _amount;
        token.safeTransfer(msg.sender, _amount);

        emit ExecuteClaim(_amount);
    }

    /**
     * @notice resolves the claim process
     */
    function resolveClaim() external onlyRebaseController {
        if (!claimInProgress) revert NoClaimInProgress();

        claimInProgress = false;
        emit ResolveClaim();
    }

    /**
     * @notice returns an account's staked amount for use by the rewards pool
     * controlled by this contract
     * @dev shares are used so this contract can rebase without affecting rewards
     * @param _account account address
     * @return account's staked amount
     */
    function staked(address _account) external view returns (uint256) {
        return sharesOf(_account);
    }

    /**
     * @notice returns the total staked amount for use by the rewards pool
     * controlled by this contract
     * @dev shares are used so this contract can rebase without affecting rewards
     * @return total staked amount
     */
    function totalStaked() external view returns (uint256) {
        return totalShares;
    }

    /**
     * @notice sets the address of the rewards pool
     * @param _rewardsPool address of rewards pool
     */
    function setRewardsPool(address _rewardsPool) external onlyOwner {
        rewardsPool = IRewardsPool(_rewardsPool);
    }

    /**
     * @notice sets the address of the rebase controller
     * @param _rebaseController address of rebase controller
     */
    function setRebaseController(address _rebaseController) external onlyOwner {
        rebaseController = _rebaseController;
    }

    /**
     * @notice sets the maximum size of a single claim in basis points with respect to the size of the pool
     * @param _maxClaimAmountBP max claim amount in basis points
     */
    function setMaxClaimAmountBP(uint256 _maxClaimAmountBP) external onlyOwner {
        if (_maxClaimAmountBP > 9000) revert InvalidClaimAmount();
        maxClaimAmountBP = _maxClaimAmountBP;
    }

    /**
     * @notice sets the withdrawal parameters
     * @param _withdrawalDelayDuration amount of time required to wait before withdrawaing
     * @param _withdrawalWindowDuration amount of time a withdrawal can be executed for after the delay has elapsed
     */
    function setWithdrawalParams(
        uint64 _withdrawalDelayDuration,
        uint64 _withdrawalWindowDuration
    ) external onlyOwner {
        withdrawalDelayDuration = _withdrawalDelayDuration;
        withdrawalWindowDuration = _withdrawalWindowDuration;
        emit SetWithdrawalParams(_withdrawalDelayDuration, _withdrawalWindowDuration);
    }

    /**
     * @notice returns the total amount of assets staked in the pool
     * @return total staked amount
     */
    function _totalStaked() internal view override returns (uint256) {
        return totalDeposits;
    }
}
