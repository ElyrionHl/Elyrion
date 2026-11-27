// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/// @title ElyrionIdentity
/// @notice ERC-8004-compatible agent identity registry: one ERC-721 per agent.
contract ElyrionIdentity is ERC721("Elyrion Agent", "ELYA"), IAgentRegistry {
    uint256 private _nextId = 1;
    mapping(uint256 => string) private _agentURIs;

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event AgentURISet(uint256 indexed agentId, string agentURI);

    error NotAgentOwner();

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = _nextId++;
        _agentURIs[agentId] = agentURI;
        _mint(msg.sender, agentId);
        emit Registered(agentId, agentURI, msg.sender);
    }

    function setAgentURI(uint256 agentId, string calldata agentURI) external {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _agentURIs[agentId] = agentURI;
        emit AgentURISet(agentId, agentURI);
    }

    function tokenURI(uint256 agentId) public view override returns (string memory) {
        _requireOwned(agentId);
        return _agentURIs[agentId];
    }

    function totalAgents() external view returns (uint256) {
        return _nextId - 1;
    }

    function ownerOf(uint256 agentId) public view override(ERC721, IAgentRegistry) returns (address) {
        return super.ownerOf(agentId);
    }
}
