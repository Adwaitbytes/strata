// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Test double for the ERC-8004 identity registry. Only the ERC-721 surface is used by the arena.
contract MockIdentityRegistry is ERC721 {
    constructor() ERC721("Mock Agent Identity", "MAID") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function transferOut(address from, address to, uint256 id) external {
        _transfer(from, to, id);
    }
}

/// @notice Registry whose ownerOf always reverts with empty data, to exercise the arena's catch path.
contract RevertingRegistry {
    function ownerOf(uint256) external pure returns (address) {
        revert();
    }
}
