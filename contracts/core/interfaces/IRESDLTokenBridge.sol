// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";

interface IRESDLTokenBridge {
    function ccipReceive(Client.Any2EVMMessage calldata _anyToEvmMessage) external;
}
