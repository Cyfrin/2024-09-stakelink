// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./base/SDLPool.sol";

/**
 * @title SDL Pool Secondary
 * @notice Allows users to stake/lock SDL tokens and receive a percentage of the protocol's earned rewards
 * @dev deployed on all supported chains besides the primary chain
 */
contract SDLPoolSecondary is SDLPool {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct NewLockPointer {
        uint128 updateBatchIndex;
        uint128 index;
    }
    struct LockUpdate {
        uint128 updateBatchIndex;
        Lock lock;
    }

    mapping(uint256 => LockUpdate[]) internal queuedLockUpdates;

    uint256 public queuedNewLockLimit;
    uint256[] internal currentMintLockIdByBatch;
    Lock[][] internal queuedNewLocks;
    mapping(address => NewLockPointer[]) internal newLocksByOwner;

    uint128 public updateBatchIndex;
    uint64 internal updateInProgress;
    uint64 internal updateNeeded;
    int256 public queuedRESDLSupplyChange;

    event QueueInitiateUnlock(address indexed owner, uint256 indexed lockId, uint64 expiry);
    event QueueWithdraw(address indexed owner, uint256 indexed lockId, uint256 amount);
    event QueueCreateLock(
        address indexed owner,
        uint256 amount,
        uint256 boostAmount,
        uint64 lockingDuration
    );
    event QueueUpdateLock(
        address indexed owner,
        uint256 indexed lockId,
        uint256 amount,
        uint256 boostAmount,
        uint64 lockingDuration
    );
    event OutgoingUpdate(
        uint128 indexed batchIndex,
        uint256 numNewQueuedLocks,
        int256 reSDLSupplyChange
    );
    event IncomingUpdate(uint128 indexed batchIndex, uint256 mintStartIndex);

    error CannotTransferWithQueuedUpdates();
    error UpdateInProgress();
    error NoUpdateInProgress();
    error TooManyQueuedLocks();
    error LockWithdrawn();

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
     * @param _queuedNewLockLimit max amount of queued new locks an account can have
     **/
    function initialize(
        string memory _name,
        string memory _symbol,
        address _sdlToken,
        address _boostController,
        uint256 _queuedNewLockLimit
    ) public initializer {
        __SDLPoolBase_init(_name, _symbol, _sdlToken, _boostController);
        updateBatchIndex = 1;
        currentMintLockIdByBatch.push(0);
        queuedNewLocks.push();
        queuedNewLocks.push();
        queuedNewLockLimit = _queuedNewLockLimit;
    }

    /**
     * @notice returns a list of queued new locks for an owner
     * @param _owner owner of locks
     * @return list of queued locks and corresponding batch indexes
     **/
    function getQueuedNewLocksByOwner(
        address _owner
    ) external view returns (Lock[] memory, uint256[] memory) {
        uint256 numNewLocks = newLocksByOwner[_owner].length;
        Lock[] memory newLocks = new Lock[](numNewLocks);
        uint256[] memory batchIndexes = new uint256[](numNewLocks);

        for (uint256 i = 0; i < numNewLocks; ++i) {
            NewLockPointer memory pointer = newLocksByOwner[_owner][i];
            newLocks[i] = queuedNewLocks[pointer.updateBatchIndex][pointer.index];
            batchIndexes[i] = pointer.updateBatchIndex;
        }

        return (newLocks, batchIndexes);
    }

    /**
     * @notice returns queued lock updates for a list of lock ids
     * @param _lockIds list of lock ids
     * @return list of queued lock updates corresponding to each lock id
     **/
    function getQueuedLockUpdates(
        uint256[] calldata _lockIds
    ) external view returns (LockUpdate[][] memory) {
        LockUpdate[][] memory updates = new LockUpdate[][](_lockIds.length);

        for (uint256 i = 0; i < _lockIds.length; ++i) {
            updates[i] = queuedLockUpdates[_lockIds[i]];
        }

        return updates;
    }

    /**
     * @notice ERC677 implementation to stake/lock SDL tokens or distribute rewards
     * @dev operations will be queued until the next update at which point the user can execute (excludes reward distribution)
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
                _queueLockUpdate(_sender, lockId, _value, lockingDuration);
            } else {
                _queueNewLock(_sender, _value, lockingDuration);
            }
        } else {
            distributeToken(msg.sender);
        }
    }

    /**
     * @notice extends the locking duration of a lock
     * @dev operation will be queued until the next update at which point the user can execute
     * @dev
     * - reverts if `_lockId` is invalid or sender is not owner of lock
     * - reverts if `_lockingDuration` is less than current locking duration of lock
     * - reverts if `_lockingDuration` is 0 or exceeds the maximum
     * @param _lockId id of lock
     * @param _lockingDuration new locking duration to set
     **/
    function extendLockDuration(uint256 _lockId, uint64 _lockingDuration) external {
        if (_lockingDuration == 0) revert InvalidLockingDuration();
        _queueLockUpdate(msg.sender, _lockId, 0, _lockingDuration);
    }

    /**
     * @notice initiates the unlock period for a lock
     * @dev operation will be queued until the next update at which point the user can execute
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
        Lock memory lock = _getQueuedLockState(_lockId);

        if (lock.expiry != 0) revert UnlockAlreadyInitiated();
        uint64 halfDuration = lock.duration / 2;
        if (lock.startTime + halfDuration > block.timestamp) revert HalfDurationNotElapsed();

        uint64 expiry = uint64(block.timestamp) + halfDuration;
        lock.expiry = expiry;

        uint256 boostAmount = lock.boostAmount;
        lock.boostAmount = 0;
        effectiveBalances[msg.sender] -= boostAmount;
        totalEffectiveBalance -= boostAmount;

        queuedLockUpdates[_lockId].push(LockUpdate(updateBatchIndex, lock));
        queuedRESDLSupplyChange -= int256(boostAmount);
        if (updateNeeded == 0) updateNeeded = 1;

        emit QueueInitiateUnlock(msg.sender, _lockId, expiry);
    }

    /**
     * @notice withdraws unlocked SDL
     * @dev operation will be queued until the next update at which point the user can execute
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
        Lock memory lock = _getQueuedLockState(_lockId);

        if (lock.startTime != 0) {
            uint64 expiry = lock.expiry;
            if (expiry == 0) revert UnlockNotInitiated();
            if (expiry > block.timestamp) revert TotalDurationNotElapsed();
        }

        uint256 baseAmount = lock.amount;
        if (_amount > baseAmount) revert InsufficientBalance();

        lock.amount = baseAmount - _amount;
        effectiveBalances[msg.sender] -= _amount;
        totalEffectiveBalance -= _amount;

        queuedLockUpdates[_lockId].push(LockUpdate(updateBatchIndex, lock));
        queuedRESDLSupplyChange -= int256(_amount);
        if (updateNeeded == 0) updateNeeded = 1;

        emit QueueWithdraw(msg.sender, _lockId, _amount);
    }

    /**
     * @notice executes queued operations for the sender
     * @dev will mint new locks and update existing locks
     * @dev an operation can only be executed once its encompassing batch is finalized
     * @param _lockIds ids of locks to update
     **/
    function executeQueuedOperations(uint256[] memory _lockIds) external {
        _executeQueuedLockUpdates(msg.sender, _lockIds);
        _mintQueuedNewLocks(msg.sender);
    }

    /**
     * @notice handles the outgoing transfer of an reSDL lock to another chain
     * @param _sender sender of the transfer
     * @param _lockId id of lock
     * @param _sdlReceiver address to receive underlying SDL on this chain
     * @return lock the lock being transferred
     **/
    function handleOutgoingRESDL(
        address _sender,
        uint256 _lockId,
        address _sdlReceiver
    )
        external
        onlyCCIPController
        onlyLockOwner(_lockId, _sender)
        updateRewards(_sender)
        returns (Lock memory)
    {
        if (queuedLockUpdates[_lockId].length != 0) revert CannotTransferWithQueuedUpdates();

        Lock memory lock = locks[_lockId];

        delete locks[_lockId].amount;
        delete lockOwners[_lockId];
        balances[_sender] -= 1;
        delete tokenApprovals[_lockId];

        uint256 totalAmount = lock.amount + lock.boostAmount;
        effectiveBalances[_sender] -= totalAmount;
        totalEffectiveBalance -= totalAmount;

        sdlToken.safeTransfer(_sdlReceiver, lock.amount);

        emit OutgoingRESDL(_sender, _lockId);

        return lock;
    }

    /**
     * @notice handles the incoming transfer of an reSDL lock from another chain
     * @param _receiver receiver of the transfer
     * @param _lockId id of lock
     * @param _lock lock
     **/
    function handleIncomingRESDL(
        address _receiver,
        uint256 _lockId,
        Lock calldata _lock
    ) external onlyCCIPController updateRewards(_receiver) {
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
        totalEffectiveBalance += totalAmount;

        if (_lockId > lastLockId) lastLockId = _lockId;

        emit IncomingRESDL(_receiver, _lockId);
    }

    /**
     * @notice handles an outgoing update to the primary chain
     * @return the number of new locks to mint and the reSDL supply change since the last update
     **/
    function handleOutgoingUpdate() external onlyCCIPController returns (uint256, int256) {
        if (updateInProgress == 1) revert UpdateInProgress();

        uint256 numNewQueuedLocks = queuedNewLocks[updateBatchIndex].length;
        int256 reSDLSupplyChange = queuedRESDLSupplyChange;

        queuedRESDLSupplyChange = 0;
        updateBatchIndex++;
        updateInProgress = 1;
        updateNeeded = 0;
        queuedNewLocks.push();

        emit OutgoingUpdate(updateBatchIndex - 1, numNewQueuedLocks, reSDLSupplyChange);

        return (numNewQueuedLocks, reSDLSupplyChange);
    }

    /**
     * @notice handles an incoming update from the primary chain
     * @dev an outgoing update must be sent prior to receiving an incoming update
     * @dev finalizes the most recent batch of operations
     * @param _mintStartIndex start index to use for minting new locks in the lastest batch
     **/
    function handleIncomingUpdate(uint256 _mintStartIndex) external onlyCCIPController {
        if (updateInProgress == 0) revert NoUpdateInProgress();

        if (_mintStartIndex != 0) {
            uint256 newLastLockId = _mintStartIndex +
                queuedNewLocks[updateBatchIndex - 1].length -
                1;
            if (newLastLockId > lastLockId) lastLockId = newLastLockId;
        }

        currentMintLockIdByBatch.push(_mintStartIndex);
        updateInProgress = 0;
        emit IncomingUpdate(updateBatchIndex - 1, _mintStartIndex);
    }

    /**
     * @notice returns whether an update should be sent to the primary chain
     * @return whether update should be sent
     **/
    function shouldUpdate() external view returns (bool) {
        return updateNeeded == 1 && updateInProgress == 0;
    }

    /**
     * @notice returns whether an update is in progress
     * @return whether update is in progress
     **/
    function isUpdateInProgress() external view returns (bool) {
        return updateInProgress == 1;
    }

    /**
     * @notice queues a new lock to be minted
     * @param _owner owner of lock
     * @param _amount amount of underlying SDL
     * @param _lockingDuration locking duration
     **/
    function _queueNewLock(address _owner, uint256 _amount, uint64 _lockingDuration) internal {
        if (newLocksByOwner[_owner].length >= queuedNewLockLimit) revert TooManyQueuedLocks();

        Lock memory lock = _createLock(_amount, _lockingDuration);
        queuedNewLocks[updateBatchIndex].push(lock);
        newLocksByOwner[_owner].push(
            NewLockPointer(updateBatchIndex, uint128(queuedNewLocks[updateBatchIndex].length - 1))
        );
        queuedRESDLSupplyChange += int256(lock.amount + lock.boostAmount);
        if (updateNeeded == 0) updateNeeded = 1;

        emit QueueCreateLock(_owner, _amount, lock.boostAmount, _lockingDuration);
    }

    /**
     * @notice mints queued new locks for an owner
     * @dev will only mint locks that are part of finalized batches
     * @param _owner owner address
     **/
    function _mintQueuedNewLocks(address _owner) internal updateRewards(_owner) {
        uint256 finalizedBatchIndex = _getFinalizedUpdateBatchIndex();
        uint256 numNewLocks = newLocksByOwner[_owner].length;
        uint256 i = 0;
        while (i < numNewLocks) {
            NewLockPointer memory newLockPointer = newLocksByOwner[_owner][i];
            if (newLockPointer.updateBatchIndex > finalizedBatchIndex) break;

            uint256 lockId = currentMintLockIdByBatch[newLockPointer.updateBatchIndex];
            Lock memory lock = queuedNewLocks[newLockPointer.updateBatchIndex][
                newLockPointer.index
            ];

            currentMintLockIdByBatch[newLockPointer.updateBatchIndex] += 1;

            locks[lockId] = lock;
            lockOwners[lockId] = _owner;
            balances[_owner] += 1;

            uint256 totalAmount = lock.amount + lock.boostAmount;
            effectiveBalances[_owner] += totalAmount;
            totalEffectiveBalance += totalAmount;

            emit CreateLock(_owner, lockId, lock.amount, lock.boostAmount, lock.duration);
            emit Transfer(address(0), _owner, lockId);

            ++i;
        }

        for (uint256 j = 0; j < numNewLocks; ++j) {
            if (i == numNewLocks) {
                newLocksByOwner[_owner].pop();
            } else {
                newLocksByOwner[_owner][j] = newLocksByOwner[_owner][i];
                ++i;
            }
        }
    }

    /**
     * @notice queued an update for a lock
     * @param _owner owner of lock
     * @param _lockId id of lock
     * @param _amount new amount of underlying SDL
     * @param _lockingDuration new locking duration
     **/
    function _queueLockUpdate(
        address _owner,
        uint256 _lockId,
        uint256 _amount,
        uint64 _lockingDuration
    ) internal onlyLockOwner(_lockId, _owner) {
        Lock memory lock = _getQueuedLockState(_lockId);
        if (lock.amount == 0) revert LockWithdrawn();

        LockUpdate memory lockUpdate = LockUpdate(
            updateBatchIndex,
            _updateLock(lock, _amount, _lockingDuration)
        );
        queuedLockUpdates[_lockId].push(lockUpdate);
        queuedRESDLSupplyChange +=
            int256(lockUpdate.lock.amount + lockUpdate.lock.boostAmount) -
            int256(lock.amount + lock.boostAmount);
        if (updateNeeded == 0) updateNeeded = 1;

        emit QueueUpdateLock(
            _owner,
            _lockId,
            lockUpdate.lock.amount,
            lockUpdate.lock.boostAmount,
            lockUpdate.lock.duration
        );
    }

    /**
     * @notice executes a series of lock updates
     * @dev will only update locks that are part of finalized batches
     * @param _owner owner of locks
     * @param _lockIds list of ids for locks to update
     **/
    function _executeQueuedLockUpdates(
        address _owner,
        uint256[] memory _lockIds
    ) internal updateRewards(_owner) {
        uint256 finalizedBatchIndex = _getFinalizedUpdateBatchIndex();

        for (uint256 i = 0; i < _lockIds.length; ++i) {
            uint256 lockId = _lockIds[i];
            _onlyLockOwner(lockId, _owner);
            uint256 numUpdates = queuedLockUpdates[lockId].length;

            Lock memory curLockState = locks[lockId];
            uint256 j = 0;
            while (j < numUpdates) {
                if (queuedLockUpdates[lockId][j].updateBatchIndex > finalizedBatchIndex) break;

                Lock memory updateLockState = queuedLockUpdates[lockId][j].lock;
                int256 baseAmountDiff = int256(updateLockState.amount) -
                    int256(curLockState.amount);
                int256 boostAmountDiff = int256(updateLockState.boostAmount) -
                    int256(curLockState.boostAmount);

                if (baseAmountDiff < 0) {
                    emit Withdraw(_owner, lockId, uint256(-1 * baseAmountDiff));
                    if (updateLockState.amount == 0) {
                        delete locks[lockId];
                        delete lockOwners[lockId];
                        balances[_owner] -= 1;
                        delete tokenApprovals[lockId];
                        emit Transfer(_owner, address(0), lockId);
                    } else {
                        locks[lockId].amount = updateLockState.amount;
                    }
                    sdlToken.safeTransfer(_owner, uint256(-1 * baseAmountDiff));
                } else if (boostAmountDiff < 0 && updateLockState.boostAmount == 0) {
                    locks[lockId].expiry = updateLockState.expiry;
                    locks[lockId].boostAmount = 0;
                    emit InitiateUnlock(_owner, lockId, updateLockState.expiry);
                } else {
                    locks[lockId] = updateLockState;
                    int256 totalDiff = baseAmountDiff + boostAmountDiff;
                    effectiveBalances[_owner] = uint256(
                        int256(effectiveBalances[_owner]) + totalDiff
                    );
                    totalEffectiveBalance = uint256(int256(totalEffectiveBalance) + totalDiff);
                    emit UpdateLock(
                        _owner,
                        lockId,
                        updateLockState.amount,
                        updateLockState.boostAmount,
                        updateLockState.duration
                    );
                }
                curLockState = updateLockState;
                ++j;
            }

            for (uint256 k = 0; k < numUpdates; ++k) {
                if (j == numUpdates) {
                    queuedLockUpdates[lockId].pop();
                } else {
                    queuedLockUpdates[lockId][k] = queuedLockUpdates[lockId][j];
                    ++j;
                }
            }
        }
    }

    /**
     * @notice returns the current state of a lock
     * @dev will return the most recent queued update for a lock or the finalized state if there are no queued updates
     * @param _lockId id of lock
     * @return the current state of a lock
     **/
    function _getQueuedLockState(uint256 _lockId) internal view returns (Lock memory) {
        uint256 updatesLength = queuedLockUpdates[_lockId].length;

        if (updatesLength != 0) {
            return queuedLockUpdates[_lockId][updatesLength - 1].lock;
        } else {
            return locks[_lockId];
        }
    }

    /**
     * @notice returns the index of the latest finalized batch
     * @return latest finalized batch index
     **/
    function _getFinalizedUpdateBatchIndex() internal view returns (uint256) {
        return currentMintLockIdByBatch.length - 1;
    }

    /**
     * @notice transfers a lock between accounts
     * @param _from account to transfer from
     * @param _to account to transfer to
     * @param _lockId id of lock to tansfer
     **/
    function _transfer(address _from, address _to, uint256 _lockId) internal override {
        if (queuedLockUpdates[_lockId].length != 0) revert CannotTransferWithQueuedUpdates();
        super._transfer(_from, _to, _lockId);
    }
}
