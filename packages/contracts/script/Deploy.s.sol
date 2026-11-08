// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {StrataArena} from "../src/StrataArena.sol";
import {ScoreAttestor} from "../src/ScoreAttestor.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";

/// @notice Deploys StrataArena, ScoreAttestor and (testnet only) RewardsDistributor.
/// @dev Env: OWNER, ATTESTOR, IDENTITY_REGISTRY. Injective EVM needs legacy txs:
///      forge script script/Deploy.s.sol --rpc-url injective_testnet --legacy --with-gas-price 160000000 --broadcast
///      ERC-8004 identity registry (source: github.com/InjectiveLabs/injective-agent-sdk packages/sdk/src/config.ts):
///        testnet 1439: 0x8004A818BFB912233c491871b3d84c89A494BD9e
///        mainnet 1776: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
///      Mainnet (chain 1776) is refused unless STRATA_ALLOW_MAINNET=yes, which only the orchestrator sets after
///      the PRD Section 16 gate passes. RewardsDistributor is never deployed to mainnet in R0 (PRD 8.3).
contract Deploy is Script {
    uint256 internal constant INJECTIVE_MAINNET = 1776;

    struct Deployment {
        StrataArena arena;
        ScoreAttestor scoreAttestor;
        RewardsDistributor rewards;
    }

    error MainnetBlocked();
    error RegistryHasNoCode();

    function run() external returns (Deployment memory) {
        return deploy(
            vm.envAddress("OWNER"),
            vm.envAddress("ATTESTOR"),
            vm.envAddress("IDENTITY_REGISTRY"),
            _eq(vm.envOr("STRATA_ALLOW_MAINNET", string("")), "yes")
        );
    }

    function deploy(address owner, address attestor, address registry, bool allowMainnet)
        public
        returns (Deployment memory d)
    {
        bool mainnet = block.chainid == INJECTIVE_MAINNET;
        if (mainnet && !allowMainnet) revert MainnetBlocked();
        if (registry.code.length == 0) revert RegistryHasNoCode();

        vm.startBroadcast();
        d.arena = new StrataArena(owner, attestor, registry);
        d.scoreAttestor = new ScoreAttestor(address(d.arena));
        if (!mainnet) d.rewards = new RewardsDistributor(owner);
        vm.stopBroadcast();
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
