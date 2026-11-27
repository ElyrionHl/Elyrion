// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal view of an ERC-8004-style agent identity registry.
interface IAgentRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function totalAgents() external view returns (uint256);
}
