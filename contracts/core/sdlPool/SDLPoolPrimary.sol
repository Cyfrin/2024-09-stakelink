// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./base/SDLPool.sol";

/**
 * @title SDL Pool Primary
 * @notice Allows users to stake/lock SDL tokens and receive a percentage of the protocol's earned rewards
 * @dev deployed only on the primary chain
 */
contract SDLPoolPrimary is SDLPool {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public delegatorPool;

    event IncomingUpdate(
        uint256 numNewRESDLTokens,
        int256 totalRESDLSupplyChange,
        uint256 mintStartIndex
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice initializes contract
     * @param _name name of the staking derivative token
     * @param _symbol symbol of the staking derivative token
     * @param _sdlToken address of the SDL token
     * @param _boostController address of the boost controller
     **/
    function initialize(
        string memory _name,
        string memory _symbol,
        address _sdlToken,
        address _boostController
    ) public reinitializer(2) {
        if (ccipController == address(0)) {
            __SDLPoolBase_init(_name, _symbol, _sdlToken, _boostController);
        } else {
            delegatorPool = ccipController;
            delete ccipController;
        }
    }

    /**
     * @notice ERC677 implementation to stake/lock SDL tokens or distribute rewards
     * @dev
     * - will update/create a lock if the token transferred is SDL or will distribute rewards otherwise
     *
     * For Non-SDL:
     * - reverts if token is unsupported
     *
     * For SDL:
     * - set lockId to 0 to create a new lock or set lockId to > 0 to stake more into an existing lock
     * - set lockingDuration to 0 to stake without locking or set lockingDuration to > 0 to lock for an amount
     *   time in seconds
     * - see _updateLock() for more details on updating an existing lock or _createLock() for more details on
     *   creating a new lock
     * @param _sender of the stake
     * @param _value of the token transfer
     * @param _calldata encoded lockId (uint256) and lockingDuration (uint64)
     **/
    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata _calldata
    ) external override {
        if (msg.sender != address(sdlToken) && !isTokenSupported(msg.sender))
            revert UnauthorizedToken();

        if (_value == 0) revert InvalidValue();

        if (msg.sender == address(sdlToken)) {
            (uint256 lockId, uint64 lockingDuration) = abi.decode(_calldata, (uint256, uint64));
            if (lockId != 0) {
                _storeUpdatedLock(_sender, lockId, _value, lockingDuration);
            } else {
                _storeNewLock(_sender, _value, lockingDuration);
            }
        } else {
            distributeToken(msg.sender);
        }
    }

    /**
     * @notice extends the locking duration of a lock
     * @dev
     * - reverts if `_lockId` is invalid or sender is not owner of lock
     * - reverts if `_lockingDuration` is less than current locking duration of lock
     * - reverts if `_lockingDuration` is 0 or exceeds the maximum
     * @param _lockId id of lock
     * @param _lockingDuration new locking duration to set
     **/
    function extendLockDuration(uint256 _lockId, uint64 _lockingDuration) external {
        if (_lockingDuration == 0) revert InvalidLockingDuration();
        _storeUpdatedLock(msg.sender, _lockId, 0, _lockingDuration);
    }

    /**
     * @notice initiates the unlock period for a lock
     * @dev
     * - at least half of the locking duration must have elapsed to initiate the unlock period
     * - the unlock period consists of half of the locking duration
     * - boost will be set to 0 upon initiation of the unlock period
     *
     * - reverts if `_lockId` is invalid or sender is not owner of lock
     * - reverts if a minimum of half the locking duration has not elapsed
     * @param _lockId id of lock
     **/
    function initiateUnlock(
        uint256 _lockId
    ) external onlyLockOwner(_lockId, msg.sender) updateRewards(msg.sender) {
        if (locks[_lockId].expiry != 0) revert UnlockAlreadyInitiated();
        uint64 halfDuration = locks[_lockId].duration / 2;
        if (locks[_lockId].startTime + halfDuration > block.timestamp)
            revert HalfDurationNotElapsed();

        uint64 expiry = uint64(block.timestamp) + halfDuration;
        locks[_lockId].expiry = expiry;

        uint256 boostAmount = locks[_lockId].boostAmount;
        locks[_lockId].boostAmount = 0;
        effectiveBalances[msg.sender] -= boostAmount;
        totalEffectiveBalance -= boostAmount;

        emit InitiateUnlock(msg.sender, _lockId, expiry);
    }

    /**
     * @notice withdraws unlocked SDL
     * @dev
     * - SDL can only be withdrawn if unlocked (once the unlock period has elapsed or if it was never
     *   locked in the first place)
     * - reverts if `_lockId` is invalid or sender is not owner of lock
     * - reverts if not unlocked
     * - reverts if `_amount` exceeds the amount staked in the lock
     * @param _lockId id of the lock
     * @param _amount amount to withdraw from the lock
     **/
    function withdraw(
        uint256 _lockId,
        uint256 _amount
    ) external onlyLockOwner(_lockId, msg.sender) updateRewards(msg.sender) {
        if (locks[_lockId].startTime != 0) {
            uint64 expiry = locks[_lockId].expiry;
            if (expiry == 0) revert UnlockNotInitiated();
            if (expiry > block.timestamp) revert TotalDurationNotElapsed();
        }

        uint256 baseAmount = locks[_lockId].amount;
        if (_amount > baseAmount) revert InsufficientBalance();

        emit Withdraw(msg.sender, _lockId, _amount);

        if (_amount == baseAmount) {
            delete locks[_lockId];
            delete lockOwners[_lockId];
            balances[msg.sender] -= 1;
            if (tokenApprovals[_lockId] != address(0)) delete tokenApprovals[_lockId];
            emit Transfer(msg.sender, address(0), _lockId);
        } else {
            locks[_lockId].amount = baseAmount - _amount;
        }

        effectiveBalances[msg.sender] -= _amount;
        totalEffectiveBalance -= _amount;

        sdlToken.safeTransfer(msg.sender, _amount);
    }

    /**
     * @notice handles an outgoing transfer of an reSDL lock to another chain
     * @param _sender sender of lock
     * @param _lockId id of lock
     * @param _sdlReceiver address to receive underlying SDL on this chain
     */
    function handleOutgoingRESDL(
        address _sender,
        uint256 _lockId,
        address _sdlReceiver
    )
        external
        onlyCCIPController
        onlyLockOwner(_lockId, _sender)
        updateRewards(_sender)
        updateRewards(ccipController)
        returns (Lock memory)
    {
        Lock memory lock = locks[_lockId];

        delete locks[_lockId].amount;
        delete lockOwners[_lockId];
        balances[_sender] -= 1;
        delete tokenApprovals[_lockId];

        uint256 totalAmount = lock.amount + lock.boostAmount;
        effectiveBalances[_sender] -= totalAmount;
        effectiveBalances[ccipController] += totalAmount;

        sdlToken.safeTransfer(_sdlReceiver, lock.amount);

        emit OutgoingRESDL(_sender, _lockId);

        return lock;
    }

    /**
     * @notice handles an incoming transfer of an reSDL lock from another chain
     * @param _receiver receiver of lock
     * @param _lockId id of lock
     * @param _lock lock
     */
    function handleIncomingRESDL(
        address _receiver,
        uint256 _lockId,
        Lock calldata _lock
    ) external onlyCCIPController updateRewards(_receiver) updateRewards(ccipController) {
        if (lockOwners[_lockId] != address(0)) revert InvalidLockId();

        locks[_lockId] = Lock(
            _lock.amount,
            _lock.boostAmount,
            _lock.startTime,
            _lock.duration,
            _lock.expiry
        );
        lockOwners[_lockId] = _receiver;
        balances[_receiver] += 1;

        uint256 totalAmount = _lock.amount + _lock.boostAmount;
        effectiveBalances[_receiver] += totalAmount;
        effectiveBalances[ccipController] -= totalAmount;

        emit IncomingRESDL(_receiver, _lockId);
    }

    /**
     * @notice handles an incoming update from a secondary chain
     * @dev updates the total reSDL supply and keeps reSDL lock ids consistent between chains
     * @param _numNewRESDLTokens number of new reSDL locks to be minted on other chain
     * @param _totalRESDLSupplyChange total reSDL supply change on other chain
     */
    function handleIncomingUpdate(
        uint256 _numNewRESDLTokens,
        int256 _totalRESDLSupplyChange
    ) external onlyCCIPController updateRewards(ccipController) returns (uint256) {
        uint256 mintStartIndex;
        if (_numNewRESDLTokens != 0) {
            mintStartIndex = lastLockId + 1;
            lastLockId += _numNewRESDLTokens;
        }

        if (_totalRESDLSupplyChange > 0) {
            effectiveBalances[ccipController] += uint256(_totalRESDLSupplyChange);
            totalEffectiveBalance += uint256(_totalRESDLSupplyChange);
        } else if (_totalRESDLSupplyChange < 0) {
            effectiveBalances[ccipController] -= uint256(-1 * _totalRESDLSupplyChange);
            totalEffectiveBalance -= uint256(-1 * _totalRESDLSupplyChange);
        }

        emit IncomingUpdate(_numNewRESDLTokens, _totalRESDLSupplyChange, mintStartIndex);

        return mintStartIndex;
    }

    /**
     * @notice used by the delegator pool to migrate user stakes to this contract
     * @dev
     * - creates a new lock to represent the migrated stake
     * - reverts if `_lockingDuration` exceeds maximum
     * @param _sender owner of lock
     * @param _amount amount to stake
     * @param _lockingDuration duration of lock
     */
    function migrate(address _sender, uint256 _amount, uint64 _lockingDuration) external {
        if (msg.sender != delegatorPool) revert SenderNotAuthorized();
        sdlToken.safeTransferFrom(delegatorPool, address(this), _amount);
        _storeNewLock(_sender, _amount, _lockingDuration);
    }

    /**
     * @notice sets the delegator pool addres
     * @param _delegatorPool address of delegator pool
     */
    function setDelegatorPool(address _delegatorPool) external onlyOwner {
        delegatorPool = _delegatorPool;
    }

    /**
     * @notice stores a new lock
     * @param _owner owner of lock
     * @param _amount amount to stake
     * @param _lockingDuration duration of lock
     */
    function _storeNewLock(
        address _owner,
        uint256 _amount,
        uint64 _lockingDuration
    ) internal updateRewards(_owner) {
        Lock memory lock = _createLock(_amount, _lockingDuration);
        uint256 lockId = lastLockId + 1;

        locks[lockId] = lock;
        lockOwners[lockId] = _owner;
        balances[_owner] += 1;
        lastLockId++;

        uint256 totalAmount = lock.amount + lock.boostAmount;
        effectiveBalances[_owner] += totalAmount;
        totalEffectiveBalance += totalAmount;

        emit CreateLock(_owner, lockId, lock.amount, lock.boostAmount, lock.duration);
        emit Transfer(address(0), _owner, lockId);
    }

    /**
     * @notice stores an updated lock
     * @param _owner owner of lock
     * @param _amount amount to stake
     * @param _lockingDuration duration of lock
     */
    function _storeUpdatedLock(
        address _owner,
        uint256 _lockId,
        uint256 _amount,
        uint64 _lockingDuration
    ) internal onlyLockOwner(_lockId, _owner) updateRewards(_owner) {
        Lock memory lock = _updateLock(locks[_lockId], _amount, _lockingDuration);

        int256 diffTotalAmount = int256(lock.amount + lock.boostAmount) -
            int256(locks[_lockId].amount + locks[_lockId].boostAmount);

        if (diffTotalAmount > 0) {
            effectiveBalances[_owner] += uint256(diffTotalAmount);
            totalEffectiveBalance += uint256(diffTotalAmount);
        } else if (diffTotalAmount < 0) {
            effectiveBalances[_owner] -= uint256(-1 * diffTotalAmount);
            totalEffectiveBalance -= uint256(-1 * diffTotalAmount);
        }

        locks[_lockId] = lock;

        emit UpdateLock(_owner, _lockId, lock.amount, lock.boostAmount, lock.duration);
    }
}
