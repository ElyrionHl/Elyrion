// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ElyrionIdentity} from "../src/ElyrionIdentity.sol";

contract ElyrionIdentityTest is Test {
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event AgentURISet(uint256 indexed agentId, string agentURI);

    ElyrionIdentity id;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        id = new ElyrionIdentity();
    }

    function test_registerMintsSequentialIdsAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit Registered(1, "ipfs://a", alice);
        vm.prank(alice);
        uint256 first = id.register("ipfs://a");
        assertEq(first, 1);
        assertEq(id.ownerOf(1), alice);
        assertEq(id.tokenURI(1), "ipfs://a");

        vm.prank(bob);
        uint256 second = id.register("ipfs://b");
        assertEq(second, 2);
        assertEq(id.ownerOf(2), bob);
        assertEq(id.totalAgents(), 2);
    }

    function test_setAgentURIOnlyOwner() public {
        vm.prank(alice);
        id.register("ipfs://a");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ElyrionIdentity.NotAgentOwner.selector));
        id.setAgentURI(1, "ipfs://evil");

        vm.expectEmit(true, false, false, true);
        emit AgentURISet(1, "ipfs://new");
        vm.prank(alice);
        id.setAgentURI(1, "ipfs://new");
        assertEq(id.tokenURI(1), "ipfs://new");
    }
}
