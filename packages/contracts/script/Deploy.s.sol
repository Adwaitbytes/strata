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
///      the PRD Section 16 gate passes; even then OWNER must be a contract (Safe) and differ from ATTESTOR.
///      RewardsDistributor is never deployed to mainnet in R0 (PRD 8.3).
contract Deploy is Script {
    uint256 internal constant INJECTIVE_MAINNET = 1776;

    struct Deployment {
        StrataArena arena;
        ScoreAttestor scoreAttestor;
        RewardsDistributor rewards;
    }

    error MainnetBlocked();
    error RegistryHasNoCode();
    error OwnerNotContract();
    error OwnerIsAttestor();

    /// @notice Deploy using OWNER, ATTESTOR, IDENTITY_REGISTRY and optional STRATA_ALLOW_MAINNET from env.
    function run() external returns (Deployment memory) {
        return deploy(
            vm.envAddress("OWNER"),
            vm.envAddress("ATTESTOR"),
            vm.envAddress("IDENTITY_REGISTRY"),
            _eq(vm.envOr("STRATA_ALLOW_MAINNET", string("")), "yes")
        );
    }

    /// @notice Deploy the arena, attestor and (off mainnet) the rewards distributor.
    function deploy(address owner, address attestor, address registry, bool allowMainnet)
        public
        returns (Deployment memory d)
    {
        bool mainnet = block.chainid == INJECTIVE_MAINNET;
        if (mainnet) {
            if (!allowMainnet) revert MainnetBlocked();
            // Mainnet owner must be a Safe (or other contract wallet), and the hot attestor key must never own
            // the arena (PRD 8.4, W11 I-3).
            if (owner.code.length == 0) revert OwnerNotContract();
            if (owner == attestor) revert OwnerIsAttestor();
        }
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
