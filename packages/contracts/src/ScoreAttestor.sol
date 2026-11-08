// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IScoreAttestor} from "./interfaces/IScoreAttestor.sol";
import {IStrataArena} from "./interfaces/IStrataArena.sol";

/// @title ScoreAttestor
/// @notice Anchors each epoch's score merkle root onchain (PRD 8.2, decisions D18, D20, D21).
/// @dev The authorized poster is read from `StrataArena.attestor()` on every call (D21), so rotating the
///      attestor is a single arena-owner transaction. Leaves are a single keccak over the 288-byte
///      abi.encode preimage; internal nodes are sorted pairs (D20), matching packages/sdk/src/merkle.ts.
///      Immutable and non-custodial: no payable function, no receive or fallback.
contract ScoreAttestor is IScoreAttestor {
    /// @inheritdoc IScoreAttestor
    address public immutable arena;

    mapping(uint64 season => mapping(uint64 epoch => EpochRecord)) private _epochs;
    mapping(uint64 season => uint64 epoch) private _lastEpoch;
    mapping(uint64 season => bool posted) private _anyEpoch;

    error ZeroAddress();
    error UnknownSeason(uint64 season);
    error EpochOutOfWindow(uint64 season, uint64 epoch);

    /// @param arena_ The StrataArena that names the attestor and owns the season registry.
    constructor(address arena_) {
        if (arena_ == address(0)) revert ZeroAddress();
        arena = arena_;
    }

    /// @inheritdoc IScoreAttestor
    /// @dev Season must already exist in the arena (1..currentSeason). Epoch `e` covers
    ///      [startTime + e * epochSeconds, startTime + (e + 1) * epochSeconds), clipped to the season's endTime
    ///      (which StrataArena clamps when a season ends early). An epoch is postable only when it starts before
    ///      endTime and has already ended, so the attestor cannot post future epochs, epochs past the season,
    ///      or `type(uint64).max` to brick the season (W11 M-1). Gaps between epochs are allowed (an epoch with no
    ///      scored agents is not attested); duplicates and regressions are not.
    function postEpoch(uint64 season, uint64 epoch, bytes32 merkleRoot, string calldata dataURI) external {
        IStrataArena a = IStrataArena(arena);
        // All arena reads are `view` calls (STATICCALL) to the immutable arena set at construction: no reentrancy.
        // aderyn-fp-next-line(reentrancy-state-change)
        if (msg.sender != a.attestor()) revert NotAttestor();
        // aderyn-fp-next-line(reentrancy-state-change)
        if (season == 0 || season > a.currentSeason()) revert UnknownSeason(season);
        // `active` is deliberately ignored: the window uses endTime, which the arena clamps when a season ends early.
        // slither-disable-start unused-return
        // aderyn-fp-next-line(reentrancy-state-change)
        (uint64 startTime, uint64 endTime, uint32 epochSeconds,) = a.seasons(season); // forge-lint: disable-line(unused-return)
        // slither-disable-end unused-return
        uint256 epochStart = uint256(startTime) + uint256(epoch) * epochSeconds;
        uint256 epochEnd = epochStart + epochSeconds;
        if (epochEnd > endTime) epochEnd = endTime;
        if (epochStart >= endTime || epochEnd > block.timestamp) revert EpochOutOfWindow(season, epoch);
        if (merkleRoot == bytes32(0)) revert ZeroRoot();
        if (bytes(dataURI).length == 0) revert EmptyURI();
        if (_anyEpoch[season]) {
            uint64 last = _lastEpoch[season];
            // last + 1 cannot overflow: the window check bounds every posted epoch below endTime <= 2^64 - 1.
            if (epoch <= last) revert EpochOutOfOrder(season, last + 1, epoch);
        }
        _anyEpoch[season] = true;
        _lastEpoch[season] = epoch;
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 postedAt = uint64(block.timestamp); // uint64 seconds lasts ~5.8e11 years
        _epochs[season][epoch] = EpochRecord({merkleRoot: merkleRoot, postedAt: postedAt, dataURI: dataURI});
        emit EpochPosted(season, epoch, merkleRoot, dataURI);
    }

    /// @inheritdoc IScoreAttestor
    /// @dev Returns false (never reverts) for an epoch that was not posted.
    function verifyScore(
        uint64 season,
        uint64 epoch,
        uint256 agentId,
        uint256 score,
        uint256 spreadCentiBps,
        uint256 depthUsd,
        uint256 uptimeBps,
        int256 pnlUsdCents,
        uint256 flags,
        bytes32[] calldata proof
    ) external view returns (bool) {
        bytes32 leaf = computeLeaf(
            season, epoch, agentId, score, spreadCentiBps, depthUsd, uptimeBps, pnlUsdCents, flags
        );
        return _verify(season, epoch, leaf, proof);
    }

    /// @notice Build the score leaf exactly as packages/sdk/src/merkle.ts `encodeLeaf` does.
    /// @return The leaf hash keccak256(abi.encode(season, epoch, agentId, score, spreadCentiBps, depthUsd,
    ///         uptimeBps, pnlUsdCents, flags)).
    function computeLeaf(
        uint64 season,
        uint64 epoch,
        uint256 agentId,
        uint256 score,
        uint256 spreadCentiBps,
        uint256 depthUsd,
        uint256 uptimeBps,
        int256 pnlUsdCents,
        uint256 flags
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(season, epoch, agentId, score, spreadCentiBps, depthUsd, uptimeBps, pnlUsdCents, flags)
        );
    }

    /// @inheritdoc IScoreAttestor
    function getEpoch(uint64 season, uint64 epoch) external view returns (EpochRecord memory) {
        return _epochs[season][epoch];
    }

    /// @inheritdoc IScoreAttestor
    function lastEpoch(uint64 season) external view returns (uint64 epoch, bool any) {
        return (_lastEpoch[season], _anyEpoch[season]);
    }

    function _verify(uint64 season, uint64 epoch, bytes32 leaf, bytes32[] calldata proof) private view returns (bool) {
        bytes32 root = _epochs[season][epoch].merkleRoot;
        if (root == bytes32(0)) return false;
        return MerkleProof.verifyCalldata(proof, root, leaf);
    }
}
