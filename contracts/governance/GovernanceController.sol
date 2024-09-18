// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Governance Controller
 * @notice Proxies owners functions for all contracts and handles RBAC
 */
contract GovernanceController is Ownable {
    struct Role {
        string name;
        mapping(address => bool) members;
        mapping(bytes32 => bool) functions;
    }

    Role[] private roles;

    event CallFunction(address indexed sender, address indexed contractAddress);
    event AddRole(
        uint256 indexed roleId,
        string name,
        address[] members,
        address[] contracts,
        bytes4[][] functionSelectors
    );
    event GrantRole(uint256 indexed roleId, address indexed account);
    event RevokeRole(uint256 indexed roleId, address indexed account);
    event AddRoleFunctions(
        uint256 indexed roleId,
        address[] contracts,
        bytes4[][] functionSelectors
    );
    event RemoveRoleFunctions(
        uint256 indexed roleId,
        address[] contracts,
        bytes4[][] functionSelectors
    );

    modifier roleExists(uint256 _roleId) {
        require(_roleId < roles.length, "Role does not exist");
        _;
    }

    /**
     * @notice returns a list of all role names
     * @return roleNames list of all role names
     **/
    function getRoles() external view returns (string[] memory roleNames) {
        roleNames = new string[](roles.length);
        for (uint256 i = 0; i < roles.length; i++) {
            roleNames[i] = roles[i].name;
        }
    }

    /**
     * @notice returns whether an account holds a role
     * @param _roleId id of role
     * @param _account address of account
     * @return hasRole whether or not account holds tole
     **/
    function hasRole(uint256 _roleId, address _account) external view returns (bool) {
        return roles[_roleId].members[_account];
    }

    /**
     * @notice returns whether a role is authorized to call a function
     * @param _roleId id of role
     * @param _contract address of contract that function belongs to
     * @param _functionSelector function selector to check
     * @return isAuthorized whether or not role is authorized to call function
     **/
    function hasFunction(
        uint256 _roleId,
        address _contract,
        bytes4 _functionSelector
    ) external view returns (bool) {
        return roles[_roleId].functions[_getFunctionId(_contract, _functionSelector)];
    }

    /**
     * @notice executes a function call if sender is authorized
     * @param _roleId id of sender's role
     * @param _contract contract address to call
     * @param _encodedCalldata encoded function call
     **/
    function callFunction(
        uint256 _roleId,
        address _contract,
        bytes calldata _encodedCalldata
    ) external roleExists(_roleId) {
        require(roles[_roleId].members[msg.sender], "Sender does not hold specified role");

        bytes4 functionSelector = bytes4(_encodedCalldata[0:4]);
        require(
            roles[_roleId].functions[_getFunctionId(_contract, functionSelector)],
            "Role is not authorized to call specified function"
        );

        (bool status, bytes memory ret) = _contract.call(_encodedCalldata);
        require(status, string(ret));

        emit CallFunction(msg.sender, _contract);
    }

    /**
     * @notice adds a new role
     * @param _name name of role
     * @param _members list of accounts to grant this role to
     * @param _contracts list of contract addresses this role will govern
     * @param _functionSelectors list of function selectors for each contract this role will govern
     **/
    function addRole(
        string calldata _name,
        address[] calldata _members,
        address[] calldata _contracts,
        bytes4[][] calldata _functionSelectors
    ) external onlyOwner {
        Role storage role = roles.push();
        role.name = _name;

        for (uint256 i = 0; i < _members.length; i++) {
            role.members[_members[i]] = true;
        }

        for (uint256 i = 0; i < _contracts.length; i++) {
            address contractAddress = _contracts[i];
            for (uint256 j = 0; j < _functionSelectors[i].length; j++) {
                role.functions[_getFunctionId(contractAddress, _functionSelectors[i][j])] = true;
            }
        }

        emit AddRole(roles.length - 1, _name, _members, _contracts, _functionSelectors);
    }

    /**
     * @notice grants a role to an account
     * @param _roleId id of role to grant
     * @param _account address to grant role to
     **/
    function grantRole(uint256 _roleId, address _account) external onlyOwner roleExists(_roleId) {
        require(!roles[_roleId].members[_account], "Account already holds role");
        roles[_roleId].members[_account] = true;
        emit GrantRole(_roleId, _account);
    }

    /**
     * @notice revokes a role from an account
     * @param _roleId id of role to revoke
     * @param _account address to revoke role from
     **/
    function revokeRole(uint256 _roleId, address _account) external onlyOwner roleExists(_roleId) {
        _revokeRole(_roleId, _account);
    }

    /**
     * @notice renounces a role from the sender
     * @param _roleId id of role to renounce
     **/
    function renounceRole(uint256 _roleId) external roleExists(_roleId) {
        _revokeRole(_roleId, msg.sender);
    }

    /**
     * @notice adds functions to a role
     * @param _roleId id of role
     * @param _contracts list of contract addresses the functions belong to
     * @param _functionSelectors list of function selectors to add for each contract
     **/
    function addRoleFunctions(
        uint256 _roleId,
        address[] calldata _contracts,
        bytes4[][] calldata _functionSelectors
    ) external onlyOwner roleExists(_roleId) {
        for (uint256 i = 0; i < _contracts.length; i++) {
            address contractAddress = _contracts[i];

            for (uint256 j = 0; j < _functionSelectors[i].length; j++) {
                bytes32 functionId = _getFunctionId(contractAddress, _functionSelectors[i][j]);
                require(!roles[_roleId].functions[functionId], "Function is already part of role");
                roles[_roleId].functions[functionId] = true;
            }
        }

        emit AddRoleFunctions(_roleId, _contracts, _functionSelectors);
    }

    /**
     * @notice removes functions from a role
     * @param _roleId id of role
     * @param _contracts list of contract addresses the functions belong to
     * @param _functionSelectors list of function selectors to remove for each contract
     **/
    function removeRoleFunctions(
        uint256 _roleId,
        address[] calldata _contracts,
        bytes4[][] calldata _functionSelectors
    ) external onlyOwner roleExists(_roleId) {
        for (uint256 i = 0; i < _contracts.length; i++) {
            address contractAddress = _contracts[i];

            for (uint256 j = 0; j < _functionSelectors[i].length; j++) {
                bytes32 functionId = _getFunctionId(contractAddress, _functionSelectors[i][j]);
                require(roles[_roleId].functions[functionId], "Function is not part of role");
                roles[_roleId].functions[functionId] = false;
            }
        }

        emit RemoveRoleFunctions(_roleId, _contracts, _functionSelectors);
    }

    /**
     * @notice revokes a role from an account
     * @param _roleId id of role to revoke
     * @param _account address to revoke role from
     **/
    function _revokeRole(uint256 _roleId, address _account) private {
        require(roles[_roleId].members[_account], "Account does not hold role");
        roles[_roleId].members[_account] = false;
        emit RevokeRole(_roleId, _account);
    }

    /**
     * @notice returns a function id
     * @param _contract address of contract that function belongs to
     * @param _functionSelector function selector
     * @return functionId id of function
     **/
    function _getFunctionId(
        address _contract,
        bytes4 _functionSelector
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(_contract, _functionSelector));
    }
}
