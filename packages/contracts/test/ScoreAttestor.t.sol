// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Merkle} from "./utils/Merkle.sol";
import {StrataArena} from "../src/StrataArena.sol";
import {ScoreAttestor} from "../src/ScoreAttestor.sol";
import {IScoreAttestor} from "../src/interfaces/IScoreAttestor.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";
import {MerkleGoldenVectors, ScoreLeaf} from "./generated/MerkleGoldenVectors.sol";

contract ScoreAttestorTest is Test {
    StrataArena internal arena;
    ScoreAttestor internal attestorC;

    address internal owner = makeAddr("owner");
    address internal attestor = makeAddr("attestor");
    address internal rando = makeAddr("rando");

    bytes32 internal constant ROOT = keccak256("root");
    uint64 internal constant T0 = 1_800_000_000;

    function setUp() public {
        vm.warp(T0);
        arena = new StrataArena(owner, attestor, address(new MockIdentityRegistry()));
        attestorC = new ScoreAttestor(address(arena));
        vm.prank(owner);
        arena.startSeason(T0, T0 + 30 days, 3600);
    }

    function _post(uint64 season, uint64 epoch, bytes32 root) internal {
        vm.prank(attestor);
        attestorC.postEpoch(season, epoch, root, "ipfs://epoch");
    }

    /// @dev ScoreLeaf is a static struct laid out as (season, epoch, agentId, ..., flags), so
    ///      abi.encode(leaf, proof) is byte-identical to verifyScore's argument encoding. Avoids stack-too-deep.
    function _verify(uint64 season, uint64 epoch, ScoreLeaf memory l, bytes32[] memory proof)
        internal
        view
        returns (bool)
    {
        l.season = season;
        l.epoch = epoch;
        (bool ok, bytes memory ret) =
            address(attestorC).staticcall(abi.encodePacked(IScoreAttestor.verifyScore.selector, abi.encode(l, proof)));
        require(ok, "verifyScore reverted");
        return abi.decode(ret, (bool));
    }

    function _computeLeaf(ScoreLeaf memory l) internal view returns (bytes32) {
        (bool ok, bytes memory ret) =
            address(attestorC).staticcall(abi.encodePacked(ScoreAttestor.computeLeaf.selector, abi.encode(l)));
        require(ok, "computeLeaf reverted");
        return abi.decode(ret, (bytes32));
    }

    // ---------------------------------------------------------------- constructor

    function test_constructor_setsArena() public view {
        assertEq(attestorC.arena(), address(arena));
    }

    function test_constructor_revertsOnZeroArena() public {
        vm.expectRevert(ScoreAttestor.ZeroAddress.selector);
        new ScoreAttestor(address(0));
    }

    function test_holdsNoFunds_rejectsEther() public {
        vm.deal(rando, 1 ether);
        vm.prank(rando);
        (bool ok,) = address(attestorC).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ---------------------------------------------------------------- postEpoch

    function test_postEpoch_storesAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit IScoreAttestor.EpochPosted(1, 0, ROOT, "ipfs://epoch");
        _post(1, 0, ROOT);
        IScoreAttestor.EpochRecord memory r = attestorC.getEpoch(1, 0);
        assertEq(r.merkleRoot, ROOT);
        assertEq(r.postedAt, T0);
        assertEq(r.dataURI, "ipfs://epoch");
        (uint64 last, bool any) = attestorC.lastEpoch(1);
        assertEq(last, 0);
        assertTrue(any);
    }

    function test_lastEpoch_noneBeforeFirstPost() public view {
        (uint64 last, bool any) = attestorC.lastEpoch(1);
        assertEq(last, 0);
        assertFalse(any);
    }

    function test_postEpoch_onlyAttestor() public {
        vm.prank(rando);
        vm.expectRevert(IScoreAttestor.NotAttestor.selector);
        attestorC.postEpoch(1, 1, ROOT, "ipfs://epoch");
    }

    function test_postEpoch_ownerIsNotAttestor() public {
        vm.prank(owner);
        vm.expectRevert(IScoreAttestor.NotAttestor.selector);
        attestorC.postEpoch(1, 1, ROOT, "ipfs://epoch");
    }

    function test_postEpoch_followsArenaAttestorChange() public {
        address next = makeAddr("next");
        vm.prank(owner);
        arena.setAttestor(next);
        vm.prank(attestor);
        vm.expectRevert(IScoreAttestor.NotAttestor.selector);
        attestorC.postEpoch(1, 1, ROOT, "ipfs://epoch");
        vm.prank(next);
        attestorC.postEpoch(1, 1, ROOT, "ipfs://epoch");
    }

    function test_postEpoch_revertsOnZeroRoot() public {
        vm.prank(attestor);
        vm.expectRevert(IScoreAttestor.ZeroRoot.selector);
        attestorC.postEpoch(1, 1, bytes32(0), "ipfs://epoch");
    }

    function test_postEpoch_revertsOnEmptyURI() public {
        vm.prank(attestor);
        vm.expectRevert(IScoreAttestor.EmptyURI.selector);
        attestorC.postEpoch(1, 1, ROOT, "");
    }

    function test_postEpoch_revertsOnDuplicate() public {
        _post(1, 5, ROOT);
        vm.prank(attestor);
        vm.expectRevert(abi.encodeWithSelector(IScoreAttestor.EpochOutOfOrder.selector, 1, 6, 5));
        attestorC.postEpoch(1, 5, ROOT, "ipfs://epoch");
    }

    function test_postEpoch_revertsOnOlderEpoch() public {
        _post(1, 5, ROOT);
        vm.prank(attestor);
        vm.expectRevert(abi.encodeWithSelector(IScoreAttestor.EpochOutOfOrder.selector, 1, 6, 4));
        attestorC.postEpoch(1, 4, ROOT, "ipfs://epoch");
    }

    function test_postEpoch_allowsGaps() public {
        _post(1, 1, ROOT);
        _post(1, 9, ROOT);
        (uint64 last,) = attestorC.lastEpoch(1);
        assertEq(last, 9);
    }

    function test_postEpoch_maxEpochThenAnyReverts() public {
        _post(1, type(uint64).max, ROOT);
        vm.prank(attestor);
        vm.expectRevert(
            abi.encodeWithSelector(IScoreAttestor.EpochOutOfOrder.selector, 1, type(uint64).max, type(uint64).max)
        );
        attestorC.postEpoch(1, type(uint64).max, ROOT, "ipfs://epoch");
    }

    function test_postEpoch_seasonsAreIndependent() public {
        _post(1, 5, ROOT);
        vm.startPrank(owner);
        arena.endSeason();
        arena.startSeason(T0, T0 + 1 days, 60);
        vm.stopPrank();
        _post(2, 0, ROOT);
        _post(1, 6, ROOT);
    }

    function test_postEpoch_revertsOnSeasonZero() public {
        vm.prank(attestor);
        vm.expectRevert(abi.encodeWithSelector(ScoreAttestor.UnknownSeason.selector, 0));
        attestorC.postEpoch(0, 1, ROOT, "ipfs://epoch");
    }

    function test_postEpoch_revertsOnFutureSeason() public {
        vm.prank(attestor);
        vm.expectRevert(abi.encodeWithSelector(ScoreAttestor.UnknownSeason.selector, 2));
        attestorC.postEpoch(2, 1, ROOT, "ipfs://epoch");
    }

    function testFuzz_postEpoch_strictlyIncreasing(uint64 first, uint64 second) public {
        _post(1, first, ROOT);
        vm.prank(attestor);
        if (second > first) {
            attestorC.postEpoch(1, second, ROOT, "ipfs://epoch");
            (uint64 last,) = attestorC.lastEpoch(1);
            assertEq(last, second);
        } else {
            vm.expectRevert();
            attestorC.postEpoch(1, second, ROOT, "ipfs://epoch");
        }
    }

    // ---------------------------------------------------------------- golden vectors (TS <-> Solidity)

    function test_golden_leafHashMatchesSdk() public view {
        for (uint256 i; i < MerkleGoldenVectors.COUNT; ++i) {
            assertEq(_computeLeaf(MerkleGoldenVectors.leaf(i)), MerkleGoldenVectors.leafHash(i));
        }
    }

    function test_golden_everyProofVerifies() public {
        _post(1, 7, MerkleGoldenVectors.ROOT);
        for (uint256 i; i < MerkleGoldenVectors.COUNT; ++i) {
            assertTrue(_verify(1, 7, MerkleGoldenVectors.leaf(i), MerkleGoldenVectors.proof(i)), "verifyScore");
            assertTrue(
                attestorC.verifyLeaf(1, 7, MerkleGoldenVectors.leafHash(i), MerkleGoldenVectors.proof(i)), "verifyLeaf"
            );
        }
    }

    function test_golden_singleLeafTreeRootIsLeaf() public {
        assertEq(MerkleGoldenVectors.SINGLE_ROOT, MerkleGoldenVectors.leafHash(0));
        _post(1, 7, MerkleGoldenVectors.SINGLE_ROOT);
        assertTrue(_verify(1, 7, MerkleGoldenVectors.leaf(0), new bytes32[](0)));
    }

    function test_golden_tamperedFieldFails() public {
        _post(1, 7, MerkleGoldenVectors.ROOT);
        ScoreLeaf memory l = MerkleGoldenVectors.leaf(1);
        l.pnlUsdCents = -l.pnlUsdCents;
        assertFalse(_verify(1, 7, l, MerkleGoldenVectors.proof(1)));
    }

    function test_golden_wrongEpochFails() public {
        _post(1, 7, MerkleGoldenVectors.ROOT);
        _post(1, 8, MerkleGoldenVectors.ROOT);
        // Leaf commits to epoch 7, so the same root posted for epoch 8 does not accept it as epoch 8.
        assertFalse(_verify(1, 8, MerkleGoldenVectors.leaf(0), MerkleGoldenVectors.proof(0)));
    }

    function test_verify_unpostedEpochReturnsFalse() public view {
        assertFalse(_verify(1, 7, MerkleGoldenVectors.leaf(0), MerkleGoldenVectors.proof(0)));
        assertFalse(attestorC.verifyLeaf(1, 7, MerkleGoldenVectors.leafHash(0), MerkleGoldenVectors.proof(0)));
    }

    function test_verify_proofFromOtherLeafFails() public {
        _post(1, 7, MerkleGoldenVectors.ROOT);
        assertFalse(_verify(1, 7, MerkleGoldenVectors.leaf(0), MerkleGoldenVectors.proof(1)));
    }

    // ---------------------------------------------------------------- fuzz on merkle verification

    function _leafOf(uint64 epoch, uint256 agentId, uint256 score, int256 pnl) internal view returns (bytes32) {
        return attestorC.computeLeaf(1, epoch, agentId, score, 100, 1_000, 9_000, pnl, 0);
    }

    function testFuzz_verify_randomTreeAllLeavesVerify(uint256 seed, uint8 sizeRaw, uint64 epoch) public {
        uint256 size = bound(sizeRaw, 2, 32);
        bytes32[] memory leaves = new bytes32[](size);
        for (uint256 i; i < size; ++i) {
            leaves[i] = _leafOf(epoch, i + 1, uint256(keccak256(abi.encode(seed, i))), int256(seed % 1e9) - 5e8);
        }
        Merkle m = new Merkle();
        bytes32 root = m.getRoot(leaves);
        _post(1, epoch, root);
        for (uint256 i; i < size; ++i) {
            bytes32[] memory p = m.getProof(leaves, i);
            assertTrue(attestorC.verifyLeaf(1, epoch, leaves[i], p));
        }
    }

    function testFuzz_verify_randomLeafRejected(uint256 seed, bytes32 forged) public {
        bytes32[] memory leaves = new bytes32[](4);
        for (uint256 i; i < 4; ++i) {
            leaves[i] = _leafOf(1, i + 1, uint256(keccak256(abi.encode(seed, i))), 0);
            vm.assume(forged != leaves[i]);
        }
        Merkle m = new Merkle();
        _post(1, 1, m.getRoot(leaves));
        assertFalse(attestorC.verifyLeaf(1, 1, forged, m.getProof(leaves, 0)));
    }

    function testFuzz_verify_tamperedScoreRejected(uint256 score, uint256 delta) public {
        delta = bound(delta, 1, type(uint256).max);
        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = _leafOf(1, 1, score, 0);
        leaves[1] = _leafOf(1, 2, 42, 0);
        Merkle m = new Merkle();
        _post(1, 1, m.getRoot(leaves));
        bytes32[] memory proof = m.getProof(leaves, 0);
        ScoreLeaf memory l = ScoreLeaf({
            season: 1,
            epoch: 1,
            agentId: 1,
            score: score,
            spreadCentiBps: 100,
            depthUsd: 1_000,
            uptimeBps: 9_000,
            pnlUsdCents: 0,
            flags: 0
        });
        assertTrue(_verify(1, 1, l, proof));
        unchecked {
            l.score = score + delta;
        }
        assertFalse(_verify(1, 1, l, proof));
    }
}
