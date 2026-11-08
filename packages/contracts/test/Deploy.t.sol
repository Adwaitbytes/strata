// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

contract DeployScriptTest is Test {
    Deploy internal script;
    address internal registry;
    address internal owner = makeAddr("owner");
    address internal attestor = makeAddr("attestor");

    function setUp() public {
        script = new Deploy();
        registry = address(new MockIdentityRegistry());
    }

    /// The only test that touches process env (vm.setEnv is global across parallel tests).
    function test_run_readsEnvAndWiresContracts() public {
        vm.chainId(1439);
        vm.setEnv("OWNER", vm.toString(owner));
        vm.setEnv("ATTESTOR", vm.toString(attestor));
        vm.setEnv("IDENTITY_REGISTRY", vm.toString(registry));
        Deploy.Deployment memory d = script.run();
        assertEq(d.arena.owner(), owner);
        assertEq(d.arena.attestor(), attestor);
        assertEq(d.arena.identityRegistry(), registry);
        assertEq(d.scoreAttestor.arena(), address(d.arena));
        assertEq(d.rewards.owner(), owner);
    }

    function test_deploy_refusesMainnetWithoutOptIn() public {
        vm.chainId(1776);
        vm.expectRevert(Deploy.MainnetBlocked.selector);
        script.deploy(owner, attestor, registry, false);
    }

    function test_deploy_mainnetOptInSkipsRewards() public {
        vm.chainId(1776);
        address safe = address(new MockIdentityRegistry()); // any contract stands in for a Safe
        Deploy.Deployment memory d = script.deploy(safe, attestor, registry, true);
        assertEq(d.arena.owner(), safe);
        assertEq(address(d.rewards), address(0));
    }

    function test_deploy_mainnetRefusesEoaOwner() public {
        vm.chainId(1776);
        vm.expectRevert(Deploy.OwnerNotContract.selector);
        script.deploy(owner, attestor, registry, true);
    }

    function test_deploy_mainnetRefusesOwnerAsAttestor() public {
        vm.chainId(1776);
        address safe = address(new MockIdentityRegistry());
        vm.expectRevert(Deploy.OwnerIsAttestor.selector);
        script.deploy(safe, safe, registry, true);
    }

    function test_deploy_testnetAllowsEoaOwnerAsAttestor() public {
        vm.chainId(1439);
        Deploy.Deployment memory d = script.deploy(owner, owner, registry, false);
        assertEq(d.arena.attestor(), owner);
    }

    function test_deploy_refusesRegistryWithoutCode() public {
        vm.chainId(1439);
        vm.expectRevert(Deploy.RegistryHasNoCode.selector);
        script.deploy(owner, attestor, makeAddr("eoa"), false);
    }
}
