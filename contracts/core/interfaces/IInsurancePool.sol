// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IInsurancePool {
    function initiateClaim() external;

    function resolveClaim() external;
}
