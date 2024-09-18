// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface ISFRXETH {
    function pricePerShare() external view returns (uint256);
}
