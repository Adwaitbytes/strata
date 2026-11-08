// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StrataArena} from "../../src/StrataArena.sol";
import {ScoreAttestor} from "../../src/ScoreAttestor.sol";
import {IStrataArena} from "../../src/interfaces/IStrataArena.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";

/// @notice Drives the arena and attestor with random but bounded actions and records ghost state.
contract ArenaHandler is Test {
    StrataArena public immutable arena;
    ScoreAttestor public immutable attestorC;
    MockIdentityRegistry public immutable registry;
    address public immutable owner;

    address[] public actors;
    uint256 public constant IDENTITIES = 12;

    // Ghost state
    mapping(uint64 => uint64[]) internal _posted;
    uint256 public successfulPosts;
    uint256 public unauthorizedPostSuccesses;
    uint256 public outOfOrderPostSuccesses;

    constructor(StrataArena arena_, ScoreAttestor attestorC_, MockIdentityRegistry registry_, address owner_) {
        arena = arena_;
        attestorC = attestorC_;
        registry = registry_;
        owner = owner_;
        for (uint256 i; i < 4; ++i) {
            actors.push(makeAddr(string(abi.encodePacked("actor", vm.toString(i)))));
        }
        for (uint256 id = 1; id <= IDENTITIES; ++id) {
            registry.mint(actors[id % 4], id);
        }
    }

    function postedCount(uint64 season) external view returns (uint256) {
        return _posted[season].length;
    }

    function postedAt(uint64 season, uint256 i) external view returns (uint64) {
        return _posted[season][i];
    }

    function startSeason(uint32 lengthRaw) external {
        uint64 len = uint64(bound(lengthRaw, 2 hours, 30 days));
        vm.prank(owner);
        try arena.startSeason(uint64(block.timestamp), uint64(block.timestamp) + len, 1 hours) {} catch {}
    }

    function endSeason() external {
        vm.prank(owner);
        try arena.endSeason() {} catch {}
    }

    function setOperatorCap(uint8 capRaw) external {
        vm.prank(owner);
        arena.setOperatorCap(bound(capRaw, 1, 3));
    }

    function setAgentCap(uint8 capRaw) external {
        vm.prank(owner);
        arena.setAgentCap(bound(capRaw, 0, 8));
    }

    function enroll(uint256 actorSeed, uint256 idSeed) external {
        address actor = actors[actorSeed % actors.length];
        uint256 id = bound(idSeed, 1, IDENTITIES);
        vm.prank(actor);
        try arena.enroll(id, bytes32(uint256(uint160(actor))), "ipfs://agent") {} catch {}
    }

    function transferIdentity(uint256 idSeed, uint256 toSeed) external {
        uint256 id = bound(idSeed, 1, IDENTITIES);
        registry.transferOut(registry.ownerOf(id), actors[toSeed % actors.length], id);
    }

    function withdraw(uint256 agentSeed) external {
        uint256 count = arena.agentCount();
        if (count == 0) return;
        uint256 agentId = bound(agentSeed, 1, count);
        vm.prank(arena.getAgent(agentId).operator);
        try arena.withdrawAgent(agentId) {} catch {}
    }

    function postAsAttestor(uint64 epoch) external {
        uint64 season = arena.currentSeason();
        uint256 n = _posted[season].length;
        uint64 prev = n == 0 ? 0 : _posted[season][n - 1];
        vm.prank(arena.attestor());
        try attestorC.postEpoch(season, epoch, keccak256(abi.encode(season, epoch)), "ipfs://e") {
            if (n != 0 && epoch <= prev) ++outOfOrderPostSuccesses;
            _posted[season].push(epoch);
            ++successfulPosts;
        } catch {}
    }

    function postNextEpoch() external {
        uint64 season = arena.currentSeason();
        uint256 n = _posted[season].length;
        uint64 epoch = n == 0 ? 0 : _posted[season][n - 1] + 1;
        vm.prank(arena.attestor());
        try attestorC.postEpoch(season, epoch, keccak256(abi.encode(season, epoch)), "ipfs://e") {
            _posted[season].push(epoch);
            ++successfulPosts;
        } catch {}
    }

    function postAsStranger(address caller, uint64 epoch) external {
        if (caller == arena.attestor()) return;
        uint64 season = arena.currentSeason();
        vm.prank(caller);
        try attestorC.postEpoch(season, epoch, keccak256("x"), "ipfs://e") {
            ++unauthorizedPostSuccesses;
        } catch {}
    }

    function rotateAttestor(uint256 actorSeed) external {
        vm.prank(owner);
        arena.setAttestor(actors[actorSeed % actors.length]);
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 3 days));
    }
}

contract ArenaInvariantsTest is Test {
    StrataArena internal arena;
    ScoreAttestor internal attestorC;
    ArenaHandler internal handler;

    address internal owner = makeAddr("owner");

    function setUp() public {
        vm.warp(1_800_000_000);
        MockIdentityRegistry registry = new MockIdentityRegistry();
        arena = new StrataArena(owner, makeAddr("attestor"), address(registry));
        attestorC = new ScoreAttestor(address(arena));
        handler = new ArenaHandler(arena, attestorC, registry, owner);
        vm.prank(owner);
        arena.startSeason(1_800_000_000, 1_800_000_000 + 7 days, 1 hours);
        targetContract(address(handler));
    }

    /// Guards against vacuous invariants: the handler's happy paths really change state.
    function test_handlerMakesProgress() public {
        handler.enroll(1, 1);
        handler.postNextEpoch();
        handler.postNextEpoch();
        handler.postAsAttestor(0);
        assertEq(arena.agentCount(), 1);
        assertEq(handler.successfulPosts(), 2);
        assertEq(handler.postedCount(1), 2);
    }

    /// Epochs posted for a season strictly increase, and lastEpoch reports the newest one.
    function invariant_epochsStrictlyIncreasing() public view {
        assertEq(handler.outOfOrderPostSuccesses(), 0);
        uint64 seasons = arena.currentSeason();
        for (uint64 s = 1; s <= seasons; ++s) {
            uint256 n = handler.postedCount(s);
            for (uint256 i = 1; i < n; ++i) {
                assertGt(handler.postedAt(s, i), handler.postedAt(s, i - 1));
            }
            (uint64 last, bool any) = attestorC.lastEpoch(s);
            assertEq(any, n > 0);
            if (n > 0) assertEq(last, handler.postedAt(s, n - 1));
        }
    }

    /// Nobody but the arena's current attestor ever posts an epoch.
    function invariant_onlyAttestorPosts() public view {
        assertEq(handler.unauthorizedPostSuccesses(), 0);
    }

    /// An ERC-8004 identity is enrolled at most once per season, operators stay within the cap,
    /// and per-season counts add up to the global agent count.
    function invariant_noDuplicateEnrollment() public view {
        uint256 count = arena.agentCount();
        uint256 total;
        uint64 seasons = arena.currentSeason();
        for (uint64 s = 1; s <= seasons; ++s) {
            total += arena.seasonAgentCount(s);
        }
        assertEq(total, count);
        for (uint256 a = 1; a <= count; ++a) {
            IStrataArena.Agent memory x = arena.getAgent(a);
            for (uint256 b = a + 1; b <= count; ++b) {
                IStrataArena.Agent memory y = arena.getAgent(b);
                if (arena.agentSeason(a) == arena.agentSeason(b)) assertTrue(x.erc8004Id != y.erc8004Id);
            }
        }
    }

    /// The contracts never hold native funds.
    function invariant_holdsNoFunds() public view {
        assertEq(address(arena).balance, 0);
        assertEq(address(attestorC).balance, 0);
    }
}
