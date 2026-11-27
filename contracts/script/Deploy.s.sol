// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ElyrionIdentity} from "../src/ElyrionIdentity.sol";
import {ElyrionPool} from "../src/ElyrionPool.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";

/// @notice Deploys ElyrionIdentity then ElyrionPool. Pool owner = the broadcaster (deployer).
/// @dev Env: USDC, TREASURY, GUARDIAN (all required, non-zero). Never put a private key in env or files;
///      sign with `--interactive` or `--account <keystore>`.
contract Deploy is Script {
    function run() external returns (ElyrionIdentity identity, ElyrionPool pool) {
        address usdc = vm.envOr("USDC", address(0));
        address treasury = vm.envOr("TREASURY", address(0));
        address guardian = vm.envOr("GUARDIAN", address(0));
        require(usdc != address(0), "Deploy: USDC env var missing or zero");
        require(treasury != address(0), "Deploy: TREASURY env var missing or zero");
        require(guardian != address(0), "Deploy: GUARDIAN env var missing or zero");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        identity = new ElyrionIdentity();
        pool = new ElyrionPool(IERC20(usdc), IAgentRegistry(address(identity)), treasury, guardian, deployer);
        vm.stopBroadcast();

        console.log("IDENTITY=%s", address(identity));
        console.log("POOL=%s", address(pool));
        console.log("OWNER=%s", deployer);
        console.log("DEPLOY_BLOCK=%s", block.number);
    }
}
