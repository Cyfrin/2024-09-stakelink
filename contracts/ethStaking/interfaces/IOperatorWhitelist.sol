// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IOperatorWhitelist {
    function useWhitelist(address _ownerAddress) external;
}
