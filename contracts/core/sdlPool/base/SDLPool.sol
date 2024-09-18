// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/IERC721MetadataUpgradeable.sol";

import "../../base/RewardsPoolController.sol";
import "../../interfaces/IBoostController.sol";
import "../../interfaces/IERC721Receiver.sol";

/**
 * @title SDL Pool
 * @notice Base SDL Pool contract to inherit from
 */
contract SDLPool is RewardsPoolController, IERC721Upgradeable, IERC721MetadataUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Lock {
        uint256 amount;
        uint256 boostAmount;
        uint64 startTime;
        uint64 duration;
        uint64 expiry;
    }

    string public name;
    string public symbol;

    mapping(address => mapping(address => bool)) internal operatorApprovals;
    mapping(uint256 => address) internal tokenApprovals;

    IERC20Upgradeable public sdlToken;
    IBoostController public boostController;

    uint256 public lastLockId;
    mapping(uint256 => Lock) internal locks;
    mapping(uint256 => address) internal lockOwners;
    mapping(address => uint256) internal balances;

    uint256 public totalEffectiveBalance;
    mapping(address => uint256) internal effectiveBalances;

    address public ccipController;

    string public baseURI;

    uint256[3] __gap;

    event InitiateUnlock(address indexed owner, uint256 indexed lockId, uint64 expiry);
    event Withdraw(address indexed owner, uint256 indexed lockId, uint256 amount);
    event CreateLock(
        address indexed owner,
        uint256 indexed lockId,
        uint256 amount,
        uint256 boostAmount,
        uint64 lockingDuration
    );
    event UpdateLock(
        address indexed owner,
        uint256 indexed lockId,
        uint256 amount,
        uint256 boostAmount,
        uint64 lockingDuration
    );
    event OutgoingRESDL(address indexed sender, uint256 indexed lockId);
    event IncomingRESDL(address indexed receiver, uint256 indexed lockId);

    error SenderNotAuthorized();
    error InvalidLockId();
    error InvalidLockingDuration();
    error TransferFromIncorrectOwner();
    error TransferToInvalidAddress();
    error TransferToNonERC721Implementer();
    error ApprovalToCurrentOwner();
    error ApprovalToCaller();
    error InvalidValue();
    error InvalidParams();
    error UnauthorizedToken();
    error TotalDurationNotElapsed();
    error HalfDurationNotElapsed();
    error InsufficientBalance();
    error UnlockNotInitiated();
    error DuplicateContract();
    error ContractNotFound();
    error UnlockAlreadyInitiated();

    /**
     * @notice initializes contract
     * @param _name name of the staking derivative token
     * @param _symbol symbol of the staking derivative token
     * @param _sdlToken address of the SDL token
     * @param _boostController address of the boost controller
     **/
    function __SDLPoolBase_init(
        string memory _name,
        string memory _symbol,
        address _sdlToken,
        address _boostController
    ) public onlyInitializing {
        __RewardsPoolController_init();
        name = _name;
        symbol = _symbol;
        sdlToken = IERC20Upgradeable(_sdlToken);
        boostController = IBoostController(_boostController);
    }

    /**
     * @notice reverts if `_owner` is not the owner of `_lockId`
     **/
    modifier onlyLockOwner(uint256 _lockId, address _owner) {
        _onlyLockOwner(_lockId, _owner);
        _;
    }

    /**
     * @notice reverts if sender is not the CCIP controller
     **/
    modifier onlyCCIPController() {
        if (msg.sender != ccipController) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice returns the effective stake balance of an account
     * @dev the effective stake balance includes the actual amount of tokens an
     * account has staked across all locks plus any applicable boost gained by locking
     * @param _account address of account
     * @return effective stake balance
     **/
    function effectiveBalanceOf(address _account) external view returns (uint256) {
        return effectiveBalances[_account];
    }

    /**
     * @notice returns the number of locks owned by an account
     * @param _account address of account
     * @return total number of locks owned by account
     **/
    function balanceOf(address _account) public view returns (uint256) {
        return balances[_account];
    }

    /**
     * @notice returns the owner of a lock
     * @dev reverts if `_lockId` is invalid
     * @param _lockId id of the lock
     * @return lock owner
     **/
    function ownerOf(uint256 _lockId) public view returns (address) {
        address owner = lockOwners[_lockId];
        if (owner == address(0)) revert InvalidLockId();
        return owner;
    }

    /**
     * @notice returns the list of locks that corresponds to `_lockIds`
     * @dev reverts if any lockId is invalid
     * @param _lockIds list of lock ids
     * @return list of locks
     **/
    function getLocks(uint256[] calldata _lockIds) external view returns (Lock[] memory) {
        Lock[] memory retLocks = new Lock[](_lockIds.length);

        for (uint256 i = 0; i < _lockIds.length; ++i) {
            uint256 lockId = _lockIds[i];
            if (lockOwners[lockId] == address(0)) revert InvalidLockId();
            retLocks[i] = locks[lockId];
        }

        return retLocks;
    }

    /**
     * @notice returns a list of lockIds owned by an account
     * @param _owner address of account
     * @return list of lockIds
     **/
    function getLockIdsByOwner(address _owner) external view returns (uint256[] memory) {
        uint256 maxLockId = lastLockId;
        uint256 lockCount = balanceOf(_owner);
        uint256 lockIdsFound;
        uint256[] memory lockIds = new uint256[](lockCount);

        for (uint256 i = 1; i <= maxLockId; ++i) {
            if (lockOwners[i] == _owner) {
                lockIds[lockIdsFound] = i;
                lockIdsFound++;
                if (lockIdsFound == lockCount) break;
            }
        }

        assert(lockIdsFound == lockCount);

        return lockIds;
    }

    /**
     * @notice transfers a lock between accounts
     * @dev reverts if sender is not the owner of and not approved to transfer the lock
     * @param _from address to transfer from
     * @param _to address to transfer to
     * @param _lockId id of lock to transfer
     **/
    function transferFrom(address _from, address _to, uint256 _lockId) external {
        if (!_isApprovedOrOwner(msg.sender, _lockId)) revert SenderNotAuthorized();
        _transfer(_from, _to, _lockId);
    }

    /**
     * @notice transfers a lock between accounts and validates that the receiver supports ERC721
     * @dev
     * - calls onERC721Received on `_to` if it is a contract or reverts if it is a contract
     *   and does not implemement onERC721Received
     * - reverts if sender is not the owner of and not approved to transfer the lock
     * - reverts if `_lockId` is invalid
     * @param _from address to transfer from
     * @param _to address to transfer to
     * @param _lockId id of lock to transfer
     **/
    function safeTransferFrom(address _from, address _to, uint256 _lockId) external {
        safeTransferFrom(_from, _to, _lockId, "");
    }

    /**
     * @notice transfers a lock between accounts and validates that the receiver supports ERC721
     * @dev
     * - calls onERC721Received on `_to` if it is a contract or reverts if it is a contract
     *   and does not implemement onERC721Received
     * - reverts if sender is not the owner of and not approved to transfer the lock
     * - reverts if `_lockId` is invalid
     * @param _from address to transfer from
     * @param _to address to transfer to
     * @param _lockId id of lock to transfer
     * @param _data optional data to pass to receiver
     **/
    function safeTransferFrom(
        address _from,
        address _to,
        uint256 _lockId,
        bytes memory _data
    ) public {
        if (!_isApprovedOrOwner(msg.sender, _lockId)) revert SenderNotAuthorized();
        _transfer(_from, _to, _lockId);
        if (!_checkOnERC721Received(_from, _to, _lockId, _data))
            revert TransferToNonERC721Implementer();
    }

    /**
     * @notice approves `_to` to transfer `_lockId` to another address
     * @dev
     * - approval is revoked on transfer and can also be revoked by approving zero address
     * - reverts if sender is not owner of lock and not an approved operator for the owner
     * - reverts if `_to` is owner of lock
     * - reverts if `_lockId` is invalid
     * @param _to address approved to transfer
     * @param _lockId id of lock
     **/
    function approve(address _to, uint256 _lockId) external {
        address owner = ownerOf(_lockId);

        if (_to == owner) revert ApprovalToCurrentOwner();
        if (msg.sender != owner && !isApprovedForAll(owner, msg.sender))
            revert SenderNotAuthorized();

        tokenApprovals[_lockId] = _to;
        emit Approval(owner, _to, _lockId);
    }

    /**
     * @notice returns the address approved to transfer a lock
     * @param _lockId id of lock
     * @return approved address
     **/
    function getApproved(uint256 _lockId) public view returns (address) {
        if (lockOwners[_lockId] == address(0)) revert InvalidLockId();

        return tokenApprovals[_lockId];
    }

    /**
     * @notice approves _operator to transfer all tokens owned by sender
     * @dev
     * - approval will not be revoked until this function is called again with
     *   `_approved` set to false
     * - reverts if sender is `_operator`
     * @param _operator address to approve/unapprove
     * @param _approved whether address is approved or not
     **/
    function setApprovalForAll(address _operator, bool _approved) external {
        address owner = msg.sender;
        if (owner == _operator) revert ApprovalToCaller();

        operatorApprovals[owner][_operator] = _approved;
        emit ApprovalForAll(owner, _operator, _approved);
    }

    /**
     * @notice returns whether `_operator` is approved to transfer all tokens owned by `_owner`
     * @param _owner owner of tokens
     * @param _operator address approved to transfer
     * @return whether address is approved or not
     **/
    function isApprovedForAll(address _owner, address _operator) public view returns (bool) {
        return operatorApprovals[_owner][_operator];
    }

    /**
     * @notice returns an account's staked amount for use by reward pools
     * controlled by this contract
     * @param _account account address
     * @return account's staked amount
     */
    function staked(address _account) external view override returns (uint256) {
        return effectiveBalances[_account];
    }

    /**
     * @notice returns the total staked amount for use by reward pools
     * controlled by this contract
     * @return total staked amount
     */
    function totalStaked() external view override returns (uint256) {
        return totalEffectiveBalance;
    }

    /**
     * @notice adds a new token
     * @param _token token to add
     * @param _rewardsPool token rewards pool to add
     **/
    function addToken(address _token, address _rewardsPool) public override onlyOwner {
        if (_token == address(sdlToken)) revert InvalidToken();
        super.addToken(_token, _rewardsPool);
    }

    /**
     * @notice returns whether this contract supports an interface
     * @param _interfaceId id of interface
     * @return whether contract supports interface or not
     */
    function supportsInterface(bytes4 _interfaceId) external view returns (bool) {
        return
            _interfaceId == type(IERC721Upgradeable).interfaceId ||
            _interfaceId == type(IERC721MetadataUpgradeable).interfaceId ||
            _interfaceId == type(IERC165Upgradeable).interfaceId;
    }

    /**
     * @dev returns the URI for a token
     */
    function tokenURI(uint256) external view returns (string memory) {
        return baseURI;
    }

    /**
     * @dev sets the base URI for all tokens
     */
    function setBaseURI(string calldata _baseURI) external onlyOwner {
        baseURI = _baseURI;
    }

    /**
     * @notice sets the boost controller
     * @dev this contract handles boost calculations for locking SDL
     * @param _boostController address of boost controller
     */
    function setBoostController(address _boostController) external onlyOwner {
        boostController = IBoostController(_boostController);
    }

    /**
     * @notice sets the CCIP controller
     * @dev this contract interfaces with CCIP
     * @param _ccipController address of CCIP controller
     */
    function setCCIPController(address _ccipController) external onlyOwner {
        ccipController = _ccipController;
    }

    /**
     * @notice creates a new lock
     * @dev reverts if `_lockingDuration` exceeds maximum
     * @param _amount amount to stake
     * @param _lockingDuration duration of lock
     */
    function _createLock(
        uint256 _amount,
        uint64 _lockingDuration
    ) internal view returns (Lock memory) {
        uint256 boostAmount = boostController.getBoostAmount(_amount, _lockingDuration);
        uint64 startTime = _lockingDuration != 0 ? uint64(block.timestamp) : 0;

        return Lock(_amount, boostAmount, startTime, _lockingDuration, 0);
    }

    /**
     * @notice updates an existing lock
     * @dev
     * - reverts if `_lockId` is invalid
     * - reverts if `_lockingDuration` is less than current locking duration of lock
     * - reverts if `_lockingDuration` exceeds maximum
     * @param _lock lock to update
     * @param _amount additional amount to stake
     * @param _lockingDuration duration of lock
     */
    function _updateLock(
        Lock memory _lock,
        uint256 _amount,
        uint64 _lockingDuration
    ) internal view returns (Lock memory) {
        if (
            (_lock.expiry == 0 || _lock.expiry > block.timestamp) &&
            _lockingDuration < _lock.duration
        ) {
            revert InvalidLockingDuration();
        }

        Lock memory lock = Lock(
            _lock.amount,
            _lock.boostAmount,
            _lock.startTime,
            _lock.duration,
            _lock.expiry
        );

        uint256 baseAmount = _lock.amount + _amount;
        uint256 boostAmount = boostController.getBoostAmount(baseAmount, _lockingDuration);

        if (_lockingDuration != 0) {
            lock.startTime = uint64(block.timestamp);
        } else {
            delete lock.startTime;
        }

        lock.amount = baseAmount;
        lock.boostAmount = boostAmount;
        lock.duration = _lockingDuration;
        lock.expiry = 0;

        return lock;
    }

    /**
     * @notice checks if a lock is owned by an certain account
     * @dev reverts if lock is not owner by account
     * @param _lockId id of lock
     * @param _owner owner address
     **/
    function _onlyLockOwner(uint256 _lockId, address _owner) internal view {
        if (_owner != ownerOf(_lockId)) revert SenderNotAuthorized();
    }

    /**
     * @notice transfers a lock between accounts
     * @dev
     * - reverts if `_from` is not the owner of the lock
     * - reverts if `to` is zero address
     * @param _from address to transfer from
     * @param _to address to transfer to
     * @param _lockId id of lock to transfer
     **/
    function _transfer(address _from, address _to, uint256 _lockId) internal virtual {
        if (_from != ownerOf(_lockId)) revert TransferFromIncorrectOwner();
        if (_to == address(0) || _to == ccipController || _to == _from)
            revert TransferToInvalidAddress();

        delete tokenApprovals[_lockId];

        _updateRewards(_from);
        _updateRewards(_to);

        uint256 effectiveBalanceChange = locks[_lockId].amount + locks[_lockId].boostAmount;
        effectiveBalances[_from] -= effectiveBalanceChange;
        effectiveBalances[_to] += effectiveBalanceChange;

        balances[_from] -= 1;
        balances[_to] += 1;
        lockOwners[_lockId] = _to;

        emit Transfer(_from, _to, _lockId);
    }

    /**
     * taken from https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC721/ERC721.sol
     * @notice verifies that an address supports ERC721 and calls onERC721Received if applicable
     * @dev
     * - called after a lock is safe transferred
     * - calls onERC721Received on `_to` if it is a contract or reverts if it is a contract
     *   and does not implemement onERC721Received
     * @param _from address that lock is being transferred from
     * @param _to address that lock is being transferred to
     * @param _lockId id of lock
     * @param _data optional data to be passed to receiver
     */
    function _checkOnERC721Received(
        address _from,
        address _to,
        uint256 _lockId,
        bytes memory _data
    ) internal returns (bool) {
        if (_to.code.length > 0) {
            try IERC721Receiver(_to).onERC721Received(msg.sender, _from, _lockId, _data) returns (
                bytes4 retval
            ) {
                return retval == IERC721Receiver.onERC721Received.selector;
            } catch (bytes memory reason) {
                if (reason.length == 0) {
                    revert TransferToNonERC721Implementer();
                } else {
                    assembly {
                        revert(add(32, reason), mload(reason))
                    }
                }
            }
        } else {
            return true;
        }
    }

    /**
     * @notice returns whether an account is authorized to transfer a lock
     * @dev returns true if `_spender` is approved to transfer `_lockId` or if `_spender` is
     * approved to transfer all locks owned by the owner of `_lockId`
     * @param _spender address of account
     * @param _lockId id of lock
     * @return whether address is authorized ot not
     **/
    function _isApprovedOrOwner(address _spender, uint256 _lockId) internal view returns (bool) {
        address owner = ownerOf(_lockId);
        return (_spender == owner ||
            isApprovedForAll(owner, _spender) ||
            getApproved(_lockId) == _spender);
    }
}
