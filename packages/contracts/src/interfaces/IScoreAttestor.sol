// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IScoreAttestor
/// @notice Anchors each epoch's score merkle root onchain (PRD 8.2).
/// @dev Leaf = keccak256(abi.encode(uint64 season, uint64 epoch, uint256 agentId, uint256 score,
///      uint256 spreadCentiBps, uint256 depthUsd, uint256 uptimeBps, int256 pnlUsdCents, uint256 flags)).
///      Internal nodes use sorted-pair hashing (OpenZeppelin MerkleProof). See docs/SCORING.md.
interface IScoreAttestor {
    struct EpochRecord {
        bytes32 merkleRoot;
        uint64 postedAt;
        string dataURI;
    }

    event EpochPosted(uint64 indexed season, uint64 indexed epoch, bytes32 root, string uri);

    error NotAttestor();
    error EpochOutOfOrder(uint64 season, uint64 expectedMinEpoch, uint64 got);
    error ZeroRoot();
    error EmptyURI();

    /// @notice Post the merkle root for an epoch. Attestor only. Epochs must strictly increase per season.
    function postEpoch(uint64 season, uint64 epoch, bytes32 merkleRoot, string calldata dataURI) external;

    /// @notice Verify one agent's score fields against a posted epoch root.
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
    ) external view returns (bool);

    /// @notice Verify a precomputed leaf against a posted epoch root.
    function verifyLeaf(uint64 season, uint64 epoch, bytes32 leaf, bytes32[] calldata proof) external view returns (bool);

    function arena() external view returns (address);
    function getEpoch(uint64 season, uint64 epoch) external view returns (EpochRecord memory);
    function lastEpoch(uint64 season) external view returns (uint64 epoch, bool any);
}
