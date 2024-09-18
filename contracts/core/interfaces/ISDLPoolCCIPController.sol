// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import "./ISDLPool.sol";

interface ISDLPoolCCIPController {
    function handleOutgoingRESDL(
        uint64 _destinationChainSelector,
        address _sender,
        uint256 _tokenId
    ) external returns (address destination, ISDLPool.RESDLToken memory reSDLToken);

    function handleIncomingRESDL(
        uint64 _sourceChainSelector,
        address _receiver,
        uint256 _tokenId,
        ISDLPool.RESDLToken calldata _reSDLToken
    ) external;

    function getRouter() external view returns (address);

    function ccipSend(
        uint64 _destinationChainSelector,
        Client.EVM2AnyMessage calldata _evmToAnyMessage
    ) external payable returns (bytes32);
}
