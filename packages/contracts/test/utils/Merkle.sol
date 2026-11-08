// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

/// @notice Test-only tree builder mirroring packages/sdk/src/merkle.ts: sorted-pair internal nodes,
///         odd node promoted unchanged to the next level.
contract Merkle {
    function getRoot(bytes32[] memory leaves) external pure returns (bytes32) {
        bytes32[] memory level = leaves;
        while (level.length > 1) level = _next(level);
        return level[0];
    }

    function getProof(bytes32[] memory leaves, uint256 index) external pure returns (bytes32[] memory proof) {
        bytes32[] memory buf = new bytes32[](64);
        uint256 n;
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            uint256 sibling = index ^ 1;
            if (sibling < level.length) buf[n++] = level[sibling];
            level = _next(level);
            index /= 2;
        }
        proof = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            proof[i] = buf[i];
        }
    }

    function _next(bytes32[] memory level) private pure returns (bytes32[] memory out) {
        out = new bytes32[]((level.length + 1) / 2);
        for (uint256 i; i < level.length; i += 2) {
            out[i / 2] = i + 1 < level.length ? Hashes.commutativeKeccak256(level[i], level[i + 1]) : level[i];
        }
    }
}
