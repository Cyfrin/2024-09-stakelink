// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../core/base/Strategy.sol";
import "./interfaces/ISequencerVault.sol";
import "./interfaces/IMetisLockingInfo.sol";

/**
 * @title Sequencer Vault Controller Strategy
 * @notice Strategy for managing multiple Metis sequencer staking vaults
 */
contract SequencerVCS is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Fee {
        address receiver;
        uint256 basisPoints;
    }

    IMetisLockingInfo public lockingInfo;
    address public depositController;
    address public ccipController;

    Fee[] private fees;

    address public vaultImplementation;
    ISequencerVault[] private vaults;
    mapping(address => bool) private vaultMapping;

    uint256 private totalDeposits;

    uint256 public l2Rewards;
    address public rewardRecipient;

    uint256 public operatorRewardPercentage;
    uint256 private unclaimedOperatorRewards;

    event VaultAdded(address signer);
    event SetOperatorRewardPercentage(uint256 operatorRewardPercentage);
    event SetVaultImplementation(address vaultImplementation);
    event UpgradedVaults(uint256[] vaults);

    error FeesTooLarge();
    error AddressNotContract();
    error SenderNotAuthorized();
    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes contract
     * @param _token address of METIS token
     * @param _stakingPool address of the staking pool that controls this strategy
     * @param _lockingInfo address of Metis locking info contract
     * @param _depositController address authorized to deposit queued tokens into vaults
     * @param _vaultImplementation address of the implementation contract to use when deploying new vaults
     * @param _rewardRecipient address on l2 that will receive rewards
     * @param _fees list of fees to be paid on rewards
     * @param _operatorRewardPercentage basis point amount of an operator's earned rewards that they receive
     **/
    function initialize(
        address _token,
        address _stakingPool,
        address _lockingInfo,
        address _depositController,
        address _vaultImplementation,
        address _rewardRecipient,
        Fee[] memory _fees,
        uint256 _operatorRewardPercentage
    ) public initializer {
        __Strategy_init(_token, _stakingPool);

        lockingInfo = IMetisLockingInfo(_lockingInfo);
        depositController = _depositController;

        if (!_isContract(_vaultImplementation)) revert AddressNotContract();
        vaultImplementation = _vaultImplementation;

        if (_rewardRecipient == address(0)) revert ZeroAddress();
        rewardRecipient = _rewardRecipient;

        for (uint256 i = 0; i < _fees.length; ++i) {
            fees.push(_fees[i]);
        }
        if (_totalFeesBasisPoints() > 3000) revert FeesTooLarge();

        if (_operatorRewardPercentage > 3000) revert FeesTooLarge();
        operatorRewardPercentage = _operatorRewardPercentage;
    }

    /**
     * @notice Reverts if sender is not deposit controller
     **/
    modifier onlyDepositController() {
        if (msg.sender != depositController) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Reverts if sender is not CCIP controller
     **/
    modifier onlyCCIPController() {
        if (msg.sender != ccipController) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Deposits tokens into this strategy from the staking pool
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount, bytes calldata) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        totalDeposits += _amount;
    }

    /**
     * @notice Withdrawals are not yet implemented
     */
    function withdraw(uint256, bytes calldata) external view onlyStakingPool {
        revert("withdrawals not yet implemented");
    }

    /**
     * @notice Returns a list of all vaults controlled by this contract
     * @return  list of vault addresses
     */
    function getVaults() external view returns (ISequencerVault[] memory) {
        return vaults;
    }

    /**
     * @notice ERC677 implementation to receive operator rewards
     * @dev rewards are paid in the stakingPool LST
     **/
    function onTokenTransfer(address, uint256, bytes calldata) external {
        if (msg.sender != address(stakingPool)) revert SenderNotAuthorized();
    }

    /**
     * @notice Returns the total unclaimed operator rewards across all vaults
     * @return unclaimed operator rewards
     * @return rewards available to withdraw
     */
    function getOperatorRewards() external view returns (uint256, uint256) {
        return (
            unclaimedOperatorRewards,
            IERC20Upgradeable(address(stakingPool)).balanceOf(address(this))
        );
    }

    /**
     * @notice Used by vaults to withdraw operator rewards
     * @param _receiver address to receive rewards
     * @param _amount amount to withdraw
     */
    function withdrawOperatorRewards(
        address _receiver,
        uint256 _amount
    ) external returns (uint256) {
        if (!vaultMapping[msg.sender]) revert SenderNotAuthorized();

        IERC20Upgradeable lst = IERC20Upgradeable(address(stakingPool));
        uint256 withdrawableRewards = lst.balanceOf(address(this));
        uint256 amountToWithdraw = _amount > withdrawableRewards ? withdrawableRewards : _amount;

        unclaimedOperatorRewards -= amountToWithdraw;
        lst.safeTransfer(_receiver, amountToWithdraw);

        return amountToWithdraw;
    }

    /**
     * @notice Returns the total amount of queued tokens
     * @return total queued tokens
     */
    function getTotalQueuedTokens() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /**
     * @notice Deposits queued tokens into vaults
     * @dev called by deposit controller bot once certain conditions are met as defined offchain
     * @param _vaults list of vaults to deposit into
     * @param _amounts amount to deposit into each vault
     */
    function depositQueuedTokens(
        uint256[] calldata _vaults,
        uint256[] calldata _amounts
    ) external onlyDepositController {
        for (uint256 i = 0; i < _vaults.length; ++i) {
            vaults[_vaults[i]].deposit(_amounts[i]);
        }
    }

    /**
     * @notice Returns the deposit change since deposits were last updated
     * @dev deposit change could be positive or negative depending on reward rate and whether
     * any slashing occurred
     * @return deposit change
     */
    function getDepositChange() public view returns (int) {
        uint256 totalBalance = token.balanceOf(address(this));
        for (uint256 i = 0; i < vaults.length; ++i) {
            totalBalance += vaults[i].getTotalDeposits();
        }
        return int(totalBalance) - int(totalDeposits);
    }

    /**
     * @notice Returns the total amount of fees that will be paid on the next call to updateDeposits()
     * @return total fees
     */
    function getPendingFees() external view override returns (uint256) {
        uint256 totalFees;

        uint256 vaultCount = vaults.length;
        for (uint256 i = 0; i < vaultCount; ++i) {
            totalFees += vaults[i].getPendingRewards();
        }

        int256 depositChange = getDepositChange();
        if (depositChange > 0) {
            for (uint256 i = 0; i < fees.length; ++i) {
                totalFees += (uint256(depositChange) * fees[i].basisPoints) / 10000;
            }
        }
        return totalFees;
    }

    /**
     * @notice Updates deposit accounting and calculates fees on newly earned rewards
     * @param _data encoded minRewards (uint256) - min amount of rewards required to relock/claim (set 0 to skip reward claiming),
     * l2Gas (uint32) - per vault gas limit for reward bridging, and l2Fee (uint256) - per vault fee to pay for reward bridging
     * @return depositChange change in deposits since last update
     * @return receivers list of fee receivers
     * @return amounts list of fee amounts
     */
    function updateDeposits(
        bytes calldata _data
    )
        external
        onlyStakingPool
        returns (int256 depositChange, address[] memory receivers, uint256[] memory amounts)
    {
        (uint256 minRewards, uint32 l2Gas, uint256 l2Fee) = _data.length == 0
            ? (0, 0, 0)
            : abi.decode(_data, (uint256, uint32, uint256));

        uint256 vaultDeposits;
        uint256 operatorRewards;
        uint256 claimedRewards;

        uint256 vaultCount = vaults.length;
        for (uint256 i = 0; i < vaultCount; ++i) {
            (uint256 deposits, uint256 opRewards, uint256 claimed) = vaults[i].updateDeposits{
                value: l2Fee
            }(minRewards, l2Gas);
            vaultDeposits += deposits;
            operatorRewards += opRewards;
            claimedRewards += claimed;
        }

        uint256 balance = token.balanceOf(address(this));
        depositChange = int256(vaultDeposits + claimedRewards + balance) - int256(totalDeposits);

        if (operatorRewards != 0) {
            receivers = new address[](1 + (depositChange > 0 ? fees.length : 0));
            amounts = new uint256[](receivers.length);
            receivers[0] = address(this);
            amounts[0] = operatorRewards;
            unclaimedOperatorRewards += operatorRewards;
        }

        if (depositChange > 0) {
            if (receivers.length == 0) {
                receivers = new address[](fees.length);
                amounts = new uint256[](receivers.length);

                for (uint256 i = 0; i < receivers.length; ++i) {
                    receivers[i] = fees[i].receiver;
                    amounts[i] = (uint256(depositChange) * fees[i].basisPoints) / 10000;
                }
            } else {
                for (uint256 i = 1; i < receivers.length; ++i) {
                    receivers[i] = fees[i - 1].receiver;
                    amounts[i] = (uint256(depositChange) * fees[i - 1].basisPoints) / 10000;
                }
            }
        }

        totalDeposits = vaultDeposits + balance;
        l2Rewards += claimedRewards;
    }

    /**
     * @notice Handles an incoming CCIP transfer of rewards from l2
     * @param _amount amount received
     */
    function handleIncomingL2Rewards(uint256 _amount) external onlyCCIPController {
        if (_amount >= l2Rewards) {
            l2Rewards = 0;
        } else {
            l2Rewards -= _amount;
        }
    }

    /**
     * @notice Returns the total amount of deposits as tracked in this strategy
     * @return total deposits
     */
    function getTotalDeposits() public view override returns (uint256) {
        return totalDeposits + l2Rewards;
    }

    /**
     * @notice Returns the maximum that can be deposited into this strategy
     * @return maximum deposits
     */
    function getMaxDeposits() public view override returns (uint256) {
        return vaults.length * getVaultDepositMax();
    }

    /**
     * @notice Returns the minimum that must remain this strategy
     * @return minimum deposits
     */
    function getMinDeposits() public view virtual override returns (uint256) {
        return getTotalDeposits();
    }

    /**
     * @notice Returns the minimum that can be deposited into a vault
     * @return minimum vault deposit
     */
    function getVaultDepositMin() public view returns (uint256) {
        return lockingInfo.minLock();
    }

    /**
     * @notice Returns the maximum that can be deposited into a vault
     * @return maximum vault deposit
     */
    function getVaultDepositMax() public view returns (uint256) {
        return lockingInfo.maxLock();
    }

    /**
     * @notice Receives ETH transfers
     */
    receive() external payable {}

    /**
     * @notice Withdraws ETH sitting in the contract
     * @param _amount amount to withdraw
     */
    function withdrawETH(uint256 _amount) external onlyOwner {
        payable(msg.sender).transfer(_amount);
    }

    /**
     * @notice Deploys a new vault and adds it to this strategy
     * @param _pubkey public key of sequencer
     * @param _signer signer address of sequencer
     * @param _rewardsReceiver address authorized to claim rewards for the vault
     */
    function addVault(
        bytes calldata _pubkey,
        address _signer,
        address _rewardsReceiver
    ) external onlyOwner {
        bytes memory data = abi.encodeWithSignature(
            "initialize(address,address,address,address,bytes,address,address)",
            address(token),
            address(this),
            lockingInfo.manager(),
            address(lockingInfo),
            _pubkey,
            _signer,
            _rewardsReceiver
        );
        address vault = address(new ERC1967Proxy(vaultImplementation, data));

        token.safeApprove(vault, type(uint256).max);
        vaults.push(ISequencerVault(vault));
        vaultMapping[address(vaults[vaults.length - 1])] = true;

        emit VaultAdded(_signer);
    }

    /**
     * @notice Upgrades vaults to a new implementation contract
     * @param _vaults list of vault indexes to upgrade
     * @param _data list of encoded function calls to be executed for each vault after upgrade
     */
    function upgradeVaults(uint256[] calldata _vaults, bytes[] memory _data) external onlyOwner {
        for (uint256 i = 0; i < _vaults.length; ++i) {
            if (_data[i].length == 0) {
                vaults[_vaults[i]].upgradeTo(vaultImplementation);
            } else {
                vaults[_vaults[i]].upgradeToAndCall(vaultImplementation, _data[i]);
            }
        }
        emit UpgradedVaults(_vaults);
    }

    /**
     * @notice Returns a list of all fees and fee receivers
     * @return list of fees
     */
    function getFees() external view returns (Fee[] memory) {
        return fees;
    }

    /**
     * @notice Adds a new fee
     * @dev stakingPool.updateStrategyRewards is called to credit all past fees at
     * the old rate before the percentage changes
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function addFee(address _receiver, uint256 _feeBasisPoints) external onlyOwner {
        _updateStrategyRewards();
        fees.push(Fee(_receiver, _feeBasisPoints));
        if (_totalFeesBasisPoints() > 3000) revert FeesTooLarge();
    }

    /**
     * @notice Updates an existing fee
     * @dev stakingPool.updateStrategyRewards is called to credit all past fees at
     * the old rate before the percentage changes
     * @param _index index of fee
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function updateFee(
        uint256 _index,
        address _receiver,
        uint256 _feeBasisPoints
    ) external onlyOwner {
        _updateStrategyRewards();

        if (_feeBasisPoints == 0) {
            fees[_index] = fees[fees.length - 1];
            fees.pop();
        } else {
            fees[_index].receiver = _receiver;
            fees[_index].basisPoints = _feeBasisPoints;
        }

        if (_totalFeesBasisPoints() > 3000) revert FeesTooLarge();
    }

    /**
     * @notice Sets the basis point amount of an operator's earned rewards that they receive
     * @dev stakingPool.updateStrategyRewards is called to credit all past operator rewards at
     * the old rate before the reward percentage changes
     * @param _operatorRewardPercentage basis point amount
     */
    function setOperatorRewardPercentage(uint256 _operatorRewardPercentage) public onlyOwner {
        if (_operatorRewardPercentage > 3000) revert FeesTooLarge();

        _updateStrategyRewards();

        operatorRewardPercentage = _operatorRewardPercentage;
        emit SetOperatorRewardPercentage(_operatorRewardPercentage);
    }

    /**
     * @notice Sets a new vault implementation contract to be used when deploying/upgrading vaults
     * @param _vaultImplementation address of implementation contract
     */
    function setVaultImplementation(address _vaultImplementation) external onlyOwner {
        if (!_isContract(_vaultImplementation)) revert AddressNotContract();
        vaultImplementation = _vaultImplementation;
        emit SetVaultImplementation(_vaultImplementation);
    }

    /**
     * @notice Sets the deposit controller
     * @dev this address is authorized to deposit queued tokens
     * @param _depositController address of deposit controller
     */
    function setDepositController(address _depositController) external onlyOwner {
        depositController = _depositController;
    }

    /**
     * @notice Sets the CCIP controller
     * @param _ccipController address of CCIP controller
     */
    function setCCIPController(address _ccipController) external onlyOwner {
        ccipController = _ccipController;
    }

    /**
     * @notice Updates rewards for all strategies controlled by the staking pool
     * @dev called before fees are changed to credit any past rewards at the old rate
     */
    function _updateStrategyRewards() private {
        address[] memory strategies = stakingPool.getStrategies();
        uint256[] memory strategyIdxs = new uint256[](strategies.length);
        for (uint256 i = 0; i < strategies.length; ++i) {
            strategyIdxs[i] = i;
        }
        stakingPool.updateStrategyRewards(strategyIdxs, "");
    }

    /**
     * @notice Returns the sum of all fees
     * @return sum of fees in basis points
     **/
    function _totalFeesBasisPoints() private view returns (uint256) {
        uint256 totalFees;
        for (uint i = 0; i < fees.length; ++i) {
            totalFees += fees[i].basisPoints;
        }
        return totalFees;
    }

    /**
     * @notice Returns whether an address belongs to a contract
     * @param _address address to check
     * @return true if address is contract, false otherwise
     */
    function _isContract(address _address) private view returns (bool) {
        uint256 length;
        assembly {
            length := extcodesize(_address)
        }
        return length > 0;
    }
}
