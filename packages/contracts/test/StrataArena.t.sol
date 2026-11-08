// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {StrataArena} from "../src/StrataArena.sol";
import {IStrataArena} from "../src/interfaces/IStrataArena.sol";
import {MockIdentityRegistry, RevertingRegistry} from "./mocks/MockIdentityRegistry.sol";

contract StrataArenaTest is Test {
    StrataArena internal arena;
    MockIdentityRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal attestor = makeAddr("attestor");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    bytes32 internal constant SUB_A = bytes32(uint256(0xA11CE));
    bytes32 internal constant SUB_B = bytes32(uint256(0xB0B));
    bytes32 internal constant MARKET = keccak256("SICI/USDT PERP");

    uint64 internal constant T0 = 1_800_000_000;

    function setUp() public {
        vm.warp(T0);
        registry = new MockIdentityRegistry();
        arena = new StrataArena(owner, attestor, address(registry));
        registry.mint(alice, 1);
        registry.mint(alice, 2);
        registry.mint(bob, 3);
    }

    function _startSeason() internal returns (uint64) {
        vm.prank(owner);
        return arena.startSeason(T0, T0 + 7 days, 3600);
    }

    function _enroll(address who, uint256 id, bytes32 sub) internal returns (uint256) {
        vm.prank(who);
        return arena.enroll(id, sub, "ipfs://agent");
    }

    // ---------------------------------------------------------------- constructor

    function test_constructor_setsState() public view {
        assertEq(arena.owner(), owner);
        assertEq(arena.attestor(), attestor);
        assertEq(arena.identityRegistry(), address(registry));
        assertEq(arena.currentSeason(), 0);
        assertEq(arena.agentCount(), 0);
        assertEq(arena.agentCap(), 0);
        assertEq(arena.operatorCap(), 1);
    }

    function test_constructor_emitsAttestorChanged() public {
        vm.expectEmit(true, true, false, false);
        emit IStrataArena.AttestorChanged(address(0), attestor);
        new StrataArena(owner, attestor, address(registry));
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new StrataArena(address(0), attestor, address(registry));
    }

    function test_constructor_revertsOnZeroAttestor() public {
        vm.expectRevert(IStrataArena.ZeroAddress.selector);
        new StrataArena(owner, address(0), address(registry));
    }

    function test_constructor_revertsOnZeroRegistry() public {
        vm.expectRevert(IStrataArena.ZeroAddress.selector);
        new StrataArena(owner, attestor, address(0));
    }

    function test_holdsNoFunds_rejectsEther() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(arena).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(arena).balance, 0);
    }

    // ---------------------------------------------------------------- ownership

    function test_ownership_isTwoStep() public {
        vm.prank(owner);
        arena.transferOwnership(bob);
        assertEq(arena.owner(), owner);
        assertEq(arena.pendingOwner(), bob);
        vm.prank(bob);
        arena.acceptOwnership();
        assertEq(arena.owner(), bob);
    }

    function test_renounceOwnership_disabled() public {
        vm.prank(owner);
        vm.expectRevert(StrataArena.RenounceDisabled.selector);
        arena.renounceOwnership();
        assertEq(arena.owner(), owner);
    }

    // ---------------------------------------------------------------- seasons

    function test_startSeason_storesAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit IStrataArena.SeasonStarted(1, T0, T0 + 7 days, 3600);
        uint64 s = _startSeason();
        assertEq(s, 1);
        assertEq(arena.currentSeason(), 1);
        (uint64 start, uint64 end, uint32 epochSeconds, bool active) = arena.seasons(1);
        assertEq(start, T0);
        assertEq(end, T0 + 7 days);
        assertEq(epochSeconds, 3600);
        assertTrue(active);
    }

    function test_startSeason_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        arena.startSeason(T0, T0 + 1 days, 60);
    }

    function test_startSeason_revertsWhilePreviousActive() public {
        _startSeason();
        vm.prank(owner);
        vm.expectRevert(IStrataArena.SeasonStillActive.selector);
        arena.startSeason(T0, T0 + 1 days, 60);
    }

    function test_startSeason_revertsWhenEndNotAfterStart() public {
        vm.prank(owner);
        vm.expectRevert(IStrataArena.InvalidSeason.selector);
        arena.startSeason(T0 + 10, T0 + 10, 1);
    }

    function test_startSeason_revertsWhenEndInPast() public {
        vm.prank(owner);
        vm.expectRevert(IStrataArena.InvalidSeason.selector);
        arena.startSeason(T0 - 100, T0, 10);
    }

    function test_startSeason_revertsOnZeroEpoch() public {
        vm.prank(owner);
        vm.expectRevert(IStrataArena.InvalidSeason.selector);
        arena.startSeason(T0, T0 + 1 days, 0);
    }

    function test_startSeason_revertsWhenEpochLongerThanSeason() public {
        vm.prank(owner);
        vm.expectRevert(IStrataArena.InvalidSeason.selector);
        arena.startSeason(T0, T0 + 100, 101);
    }

    function test_endSeason_endsAndEmits() public {
        _startSeason();
        vm.warp(T0 + 1 days);
        vm.expectEmit(true, false, false, true);
        emit IStrataArena.SeasonEnded(1, T0 + 1 days);
        vm.prank(owner);
        arena.endSeason();
        (, uint64 end,, bool active) = arena.seasons(1);
        assertFalse(active);
        assertEq(end, T0 + 1 days, "early end clamps endTime");
    }

    function test_endSeason_afterScheduledEndKeepsEndTime() public {
        _startSeason();
        vm.warp(T0 + 8 days);
        vm.prank(owner);
        arena.endSeason();
        (, uint64 end,,) = arena.seasons(1);
        assertEq(end, T0 + 7 days);
    }

    function test_endSeason_revertsWithoutActiveSeason() public {
        vm.prank(owner);
        vm.expectRevert(IStrataArena.NoActiveSeason.selector);
        arena.endSeason();
    }

    function test_endSeason_onlyOwner() public {
        _startSeason();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        arena.endSeason();
    }

    function test_startSeason_afterEndIncrements() public {
        _startSeason();
        vm.startPrank(owner);
        arena.endSeason();
        uint64 s = arena.startSeason(T0, T0 + 1 days, 60);
        vm.stopPrank();
        assertEq(s, 2);
        assertEq(arena.currentSeason(), 2);
    }

    // ---------------------------------------------------------------- enroll

    function test_enroll_storesAgentAndEmits() public {
        _startSeason();
        vm.expectEmit(true, true, true, true);
        emit IStrataArena.AgentEnrolled(1, alice, 1, SUB_A, 1, "ipfs://agent");
        uint256 id = _enroll(alice, 1, SUB_A);
        assertEq(id, 1);
        assertEq(arena.agentCount(), 1);
        assertEq(arena.agentIdOf(alice), 1);
        assertEq(arena.agentSeason(1), 1);
        IStrataArena.Agent memory a = arena.getAgent(1);
        assertEq(a.operator, alice);
        assertEq(a.erc8004Id, 1);
        assertEq(a.subaccountId, SUB_A);
        assertEq(a.metadataURI, "ipfs://agent");
        assertEq(a.enrolledAt, T0);
        assertEq(uint8(a.status), uint8(IStrataArena.Status.Active));
    }

    function test_enroll_revertsWithoutSeason() public {
        vm.prank(alice);
        vm.expectRevert(IStrataArena.NoActiveSeason.selector);
        arena.enroll(1, SUB_A, "ipfs://agent");
    }

    function test_enroll_revertsAfterSeasonEnded() public {
        _startSeason();
        vm.prank(owner);
        arena.endSeason();
        vm.prank(alice);
        vm.expectRevert(IStrataArena.NoActiveSeason.selector);
        arena.enroll(1, SUB_A, "ipfs://agent");
    }

    function test_enroll_revertsPastScheduledEnd() public {
        _startSeason();
        vm.warp(T0 + 7 days);
        vm.prank(alice);
        vm.expectRevert(IStrataArena.NoActiveSeason.selector);
        arena.enroll(1, SUB_A, "ipfs://agent");
    }

    function test_enroll_revertsWhenNotIdentityOwner() public {
        _startSeason();
        vm.prank(bob);
        vm.expectRevert(IStrataArena.NotIdentityOwner.selector);
        arena.enroll(1, SUB_B, "ipfs://agent");
    }

    function test_enroll_revertsForNonexistentIdentity() public {
        _startSeason();
        vm.prank(alice);
        vm.expectRevert(IStrataArena.NotIdentityOwner.selector);
        arena.enroll(999, SUB_A, "ipfs://agent");
    }

    function test_enroll_revertsWhenRegistryReverts() public {
        StrataArena a2 = new StrataArena(owner, attestor, address(new RevertingRegistry()));
        vm.prank(owner);
        a2.startSeason(T0, T0 + 1 days, 60);
        vm.prank(alice);
        vm.expectRevert(IStrataArena.NotIdentityOwner.selector);
        a2.enroll(1, SUB_A, "ipfs://agent");
    }

    function test_enroll_revertsOnZeroSubaccount() public {
        _startSeason();
        vm.prank(alice);
        vm.expectRevert(StrataArena.ZeroSubaccount.selector);
        arena.enroll(1, bytes32(0), "ipfs://agent");
    }

    function test_enroll_revertsOnEmptyMetadata() public {
        _startSeason();
        vm.prank(alice);
        vm.expectRevert(StrataArena.InvalidMetadataURI.selector);
        arena.enroll(1, SUB_A, "");
    }

    function test_enroll_revertsOnOversizedMetadata() public {
        _startSeason();
        string memory tooLong = string(new bytes(arena.MAX_URI_LENGTH() + 1));
        vm.prank(alice);
        vm.expectRevert(StrataArena.InvalidMetadataURI.selector);
        arena.enroll(1, SUB_A, tooLong);
    }

    function test_enroll_acceptsMaxLengthMetadata() public {
        _startSeason();
        string memory maxLen = string(new bytes(arena.MAX_URI_LENGTH()));
        vm.prank(alice);
        arena.enroll(1, SUB_A, maxLen);
    }

    function test_enroll_onePerOperatorPerSeasonByDefault() public {
        _startSeason();
        _enroll(alice, 1, SUB_A);
        vm.prank(alice);
        vm.expectRevert(IStrataArena.AlreadyEnrolled.selector);
        arena.enroll(2, SUB_A, "ipfs://agent2");
    }

    function test_enroll_sameIdentityTwiceInSeasonReverts() public {
        _startSeason();
        vm.prank(owner);
        arena.setOperatorCap(5);
        _enroll(alice, 1, SUB_A);
        vm.prank(alice);
        vm.expectRevert(IStrataArena.AlreadyEnrolled.selector);
        arena.enroll(1, SUB_A, "ipfs://agent");
    }

    function test_enroll_identityTransferredCannotReenterSameSeason() public {
        _startSeason();
        _enroll(alice, 1, SUB_A);
        registry.transferOut(alice, bob, 1);
        vm.prank(bob);
        vm.expectRevert(IStrataArena.AlreadyEnrolled.selector);
        arena.enroll(1, SUB_B, "ipfs://agent");
    }

    function test_enroll_operatorCapAllowsMore() public {
        _startSeason();
        vm.prank(owner);
        arena.setOperatorCap(2);
        _enroll(alice, 1, SUB_A);
        uint256 second = _enroll(alice, 2, SUB_B);
        assertEq(second, 2);
        assertEq(arena.agentIdOf(alice), 2, "latest agent");
        assertEq(arena.operatorEnrollments(1, alice), 2);
    }

    function test_enroll_withdrawnAgentDoesNotFreeSlot() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.prank(alice);
        arena.withdrawAgent(id);
        vm.prank(alice);
        vm.expectRevert(IStrataArena.AlreadyEnrolled.selector);
        arena.enroll(2, SUB_A, "ipfs://agent");
    }

    function test_enroll_newSeasonAllowsReenrollment() public {
        _startSeason();
        _enroll(alice, 1, SUB_A);
        vm.startPrank(owner);
        arena.endSeason();
        arena.startSeason(T0, T0 + 1 days, 60);
        vm.stopPrank();
        uint256 id = _enroll(alice, 1, SUB_A);
        assertEq(id, 2);
        assertEq(arena.agentSeason(id), 2);
    }

    function test_enroll_seasonAgentCap() public {
        _startSeason();
        vm.prank(owner);
        arena.setAgentCap(1);
        _enroll(alice, 1, SUB_A);
        vm.prank(bob);
        vm.expectRevert(IStrataArena.AgentCapReached.selector);
        arena.enroll(3, SUB_B, "ipfs://agent");
        assertEq(arena.seasonAgentCount(1), 1);
    }

    function test_enroll_zeroAgentCapIsUnlimited() public {
        _startSeason();
        _enroll(alice, 1, SUB_A);
        _enroll(bob, 3, SUB_B);
        assertEq(arena.seasonAgentCount(1), 2);
    }

    function testFuzz_enroll_onlyIdentityOwner(address caller, uint256 erc8004Id) public {
        vm.assume(caller != address(0) && caller.code.length == 0);
        erc8004Id = bound(erc8004Id, 100, type(uint256).max);
        _startSeason();
        address holder = makeAddr("holder");
        registry.mint(holder, erc8004Id);
        vm.prank(caller);
        if (caller == holder) {
            uint256 id = arena.enroll(erc8004Id, SUB_A, "ipfs://x");
            assertEq(arena.getAgent(id).erc8004Id, erc8004Id);
        } else {
            vm.expectRevert(IStrataArena.NotIdentityOwner.selector);
            arena.enroll(erc8004Id, SUB_A, "ipfs://x");
        }
    }

    function testFuzz_enroll_holderAlwaysSucceedsOnce(uint256 erc8004Id, bytes32 sub) public {
        erc8004Id = bound(erc8004Id, 100, type(uint256).max);
        vm.assume(sub != bytes32(0));
        _startSeason();
        address holder = makeAddr("holder");
        registry.mint(holder, erc8004Id);
        vm.prank(holder);
        uint256 id = arena.enroll(erc8004Id, sub, "ipfs://x");
        assertEq(arena.getAgent(id).subaccountId, sub);
        vm.prank(holder);
        vm.expectRevert(IStrataArena.AlreadyEnrolled.selector);
        arena.enroll(erc8004Id, sub, "ipfs://x");
    }

    // ---------------------------------------------------------------- caps

    function test_setAgentCap_emits() public {
        vm.expectEmit(false, false, false, true);
        emit IStrataArena.AgentCapChanged(0, 50);
        vm.prank(owner);
        arena.setAgentCap(50);
        assertEq(arena.agentCap(), 50);
    }

    function test_setAgentCap_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        arena.setAgentCap(5);
    }

    function test_setOperatorCap_emits() public {
        vm.expectEmit(false, false, false, true);
        emit StrataArena.OperatorCapChanged(1, 3);
        vm.prank(owner);
        arena.setOperatorCap(3);
        assertEq(arena.operatorCap(), 3);
    }

    function test_setOperatorCap_revertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(StrataArena.InvalidOperatorCap.selector);
        arena.setOperatorCap(0);
    }

    function test_setOperatorCap_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        arena.setOperatorCap(2);
    }

    // ---------------------------------------------------------------- metadata

    function test_updateMetadata_updatesAndEmits() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.expectEmit(true, false, false, true);
        emit IStrataArena.AgentUpdated(id, "ipfs://v2");
        vm.prank(alice);
        arena.updateMetadata(id, "ipfs://v2");
        assertEq(arena.getAgent(id).metadataURI, "ipfs://v2");
    }

    function test_updateMetadata_onlyOperator() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.prank(bob);
        vm.expectRevert(IStrataArena.NotOperator.selector);
        arena.updateMetadata(id, "ipfs://v2");
    }

    function test_updateMetadata_revertsWhenNotActive() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.startPrank(alice);
        arena.withdrawAgent(id);
        vm.expectRevert(IStrataArena.AgentNotActive.selector);
        arena.updateMetadata(id, "ipfs://v2");
        vm.stopPrank();
    }

    function test_updateMetadata_revertsOnEmptyURI() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.prank(alice);
        vm.expectRevert(StrataArena.InvalidMetadataURI.selector);
        arena.updateMetadata(id, "");
    }

    // ---------------------------------------------------------------- withdraw

    function test_withdrawAgent_setsStatusAndEmits() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.expectEmit(true, false, false, false);
        emit IStrataArena.AgentWithdrawn(id);
        vm.prank(alice);
        arena.withdrawAgent(id);
        assertEq(uint8(arena.getAgent(id).status), uint8(IStrataArena.Status.Withdrawn));
    }

    function test_withdrawAgent_onlyOperator() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.prank(bob);
        vm.expectRevert(IStrataArena.NotOperator.selector);
        arena.withdrawAgent(id);
    }

    function test_withdrawAgent_unknownAgentReverts() public {
        vm.prank(alice);
        vm.expectRevert(IStrataArena.NotOperator.selector);
        arena.withdrawAgent(42);
    }

    function test_withdrawAgent_twiceReverts() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.startPrank(alice);
        arena.withdrawAgent(id);
        vm.expectRevert(IStrataArena.AgentNotActive.selector);
        arena.withdrawAgent(id);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- suspend

    function test_suspendAgent_setsStatusAndEmitsReason() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.expectEmit(true, false, false, true);
        emit IStrataArena.AgentSuspended(id, "wash trading, epochs 4-9");
        vm.prank(owner);
        arena.suspendAgent(id, "wash trading, epochs 4-9");
        assertEq(uint8(arena.getAgent(id).status), uint8(IStrataArena.Status.Suspended));
    }

    function test_suspendAgent_allowsWithdrawnAgent() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.prank(alice);
        arena.withdrawAgent(id);
        vm.prank(owner);
        arena.suspendAgent(id, "post-hoc finding");
        assertEq(uint8(arena.getAgent(id).status), uint8(IStrataArena.Status.Suspended));
    }

    function test_suspendAgent_revertsOnEmptyReason() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.prank(owner);
        vm.expectRevert(IStrataArena.EmptyReason.selector);
        arena.suspendAgent(id, "");
    }

    function test_suspendAgent_revertsOnUnknownAgent() public {
        vm.prank(owner);
        vm.expectRevert(IStrataArena.AgentNotActive.selector);
        arena.suspendAgent(7, "reason");
    }

    function test_suspendAgent_revertsWhenAlreadySuspended() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.startPrank(owner);
        arena.suspendAgent(id, "reason");
        vm.expectRevert(IStrataArena.AgentNotActive.selector);
        arena.suspendAgent(id, "again");
        vm.stopPrank();
    }

    function test_suspendAgent_onlyOwner() public {
        _startSeason();
        uint256 id = _enroll(alice, 1, SUB_A);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        arena.suspendAgent(id, "reason");
    }

    // ---------------------------------------------------------------- markets

    function _cfg(bool enabled, uint16 spread, string memory symbol)
        internal
        pure
        returns (IStrataArena.MarketCfg memory)
    {
        return IStrataArena.MarketCfg({enabled: enabled, maxSpreadBps: spread, minDepthUsd: 5_000, symbol: symbol});
    }

    function test_setMarket_storesAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit IStrataArena.MarketSet(MARKET, true, 25, 5_000, "SICI/USDT PERP");
        vm.prank(owner);
        arena.setMarket(MARKET, _cfg(true, 25, "SICI/USDT PERP"));
        IStrataArena.MarketCfg memory m = arena.getMarket(MARKET);
        assertTrue(m.enabled);
        assertEq(m.maxSpreadBps, 25);
        assertEq(m.minDepthUsd, 5_000);
        assertEq(m.symbol, "SICI/USDT PERP");
    }

    function test_setMarket_canDisable() public {
        vm.startPrank(owner);
        arena.setMarket(MARKET, _cfg(true, 25, "X"));
        arena.setMarket(MARKET, _cfg(false, 0, "X"));
        vm.stopPrank();
        assertFalse(arena.getMarket(MARKET).enabled);
    }

    function test_setMarket_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        arena.setMarket(MARKET, _cfg(true, 25, "X"));
    }

    function test_setMarket_revertsOnZeroId() public {
        vm.prank(owner);
        vm.expectRevert(IStrataArena.InvalidMarket.selector);
        arena.setMarket(bytes32(0), _cfg(true, 25, "X"));
    }

    function test_setMarket_revertsOnEmptySymbol() public {
        vm.prank(owner);
        vm.expectRevert(IStrataArena.InvalidMarket.selector);
        arena.setMarket(MARKET, _cfg(true, 25, ""));
    }

    function test_setMarket_revertsOnLongSymbol() public {
        string memory long = string(new bytes(arena.MAX_SYMBOL_LENGTH() + 1));
        vm.prank(owner);
        vm.expectRevert(IStrataArena.InvalidMarket.selector);
        arena.setMarket(MARKET, _cfg(true, 25, long));
    }

    function test_setMarket_revertsOnZeroSpreadWhenEnabled() public {
        vm.prank(owner);
        vm.expectRevert(IStrataArena.InvalidMarket.selector);
        arena.setMarket(MARKET, _cfg(true, 0, "X"));
    }

    function test_setMarket_revertsOnSpreadAbove100Pct() public {
        vm.prank(owner);
        vm.expectRevert(IStrataArena.InvalidMarket.selector);
        arena.setMarket(MARKET, _cfg(true, 10_001, "X"));
    }

    // ---------------------------------------------------------------- attestor

    function test_setAttestor_updatesAndEmits() public {
        vm.expectEmit(true, true, false, false);
        emit IStrataArena.AttestorChanged(attestor, bob);
        vm.prank(owner);
        arena.setAttestor(bob);
        assertEq(arena.attestor(), bob);
    }

    function test_setAttestor_revertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(IStrataArena.ZeroAddress.selector);
        arena.setAttestor(address(0));
    }

    function test_setAttestor_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        arena.setAttestor(bob);
    }

    function test_getAgent_unknownReturnsEmpty() public view {
        assertEq(uint8(arena.getAgent(99).status), uint8(IStrataArena.Status.None));
    }
}
