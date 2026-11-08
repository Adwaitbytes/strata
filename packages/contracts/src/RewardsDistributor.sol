// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";

/// @title RewardsDistributor
/// @notice Pull-based merkle claims of season rewards from an owner-funded pool (PRD 8.3). TESTNET ONLY in R0.
/// @dev Leaf = keccak256(bytes.concat(keccak256(abi.encode(uint256 index, address account, uint256 amount)))),
///      the OpenZeppelin StandardMerkleTree format, so the OpenZeppelin merkle-tree JS library can build the tree off chain.
///      The double hash keeps leaves distinct from 64-byte internal nodes. Each season has its own token, root,
///      claim bitmap and accounting, so one season can never pay out of another season's funds.
///      Roots are write-once. Unclaimed funds can be swept only after the 30-day claim window.
contract RewardsDistributor is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BitMaps for BitMaps.BitMap;

    /// @notice Length of the claim window, counted from season configuration.
    uint256 public constant CLAIM_WINDOW = 30 days;

    struct Pool {
        IERC20 token;
        bytes32 root;
        uint64 claimDeadline;
        bool swept;
        uint256 funded;
        uint256 claimed;
    }

    mapping(uint64 season => Pool) private _pools;
    mapping(uint64 season => BitMaps.BitMap) private _claimed;

    event SeasonConfigured(uint64 indexed season, address indexed token, bytes32 root, uint64 claimDeadline);
    event Funded(uint64 indexed season, uint256 amount);
    event Claimed(uint64 indexed season, uint256 indexed index, address indexed account, uint256 amount);
    event Swept(uint64 indexed season, address indexed to, uint256 amount);

    error RenounceDisabled();
    error InvalidSeason();
    error ZeroAddress();
    error ZeroRoot();
    error ZeroAmount();
    error SeasonAlreadyConfigured();
    error SeasonNotConfigured();
    error ClaimWindowClosed();
    error ClaimWindowOpen();
    error AlreadyClaimed();
    error InvalidProof();
    error InsufficientPool();
    error AlreadySwept();
    error UnsupportedToken();

    /// @param owner_ Contract owner (funds pools and sweeps). Hardware wallet or Safe outside testnet.
    constructor(address owner_) Ownable(owner_) {}

    /// @notice Register a season's reward token and merkle root and open its 30-day claim window. Owner only.
    /// @param season Arena season number (non-zero).
    /// @param token ERC-20 paid out for this season.
    /// @param root Merkle root over (index, account, amount) leaves. Cannot be changed later.
    function configureSeason(uint64 season, IERC20 token, bytes32 root) external onlyOwner {
        if (season == 0) revert InvalidSeason();
        if (address(token) == address(0)) revert ZeroAddress();
        if (root == bytes32(0)) revert ZeroRoot();
        Pool storage p = _pools[season];
        if (p.root != bytes32(0)) revert SeasonAlreadyConfigured();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 deadline = uint64(block.timestamp + CLAIM_WINDOW); // uint64 seconds lasts ~5.8e11 years
        p.token = token;
        p.root = root;
        p.claimDeadline = deadline;
        emit SeasonConfigured(season, address(token), root, deadline);
    }

    /// @notice Pull `amount` of the season token from the owner into the season pool. Owner only.
    /// @dev Effects before interactions: the pool is credited first and the whole call reverts unless exactly
    ///      `amount` arrives, so fee-on-transfer or rebasing tokens cannot overstate a pool.
    /// @param season Configured season whose claim window is still open.
    /// @param amount Token amount to transfer in.
    function fund(uint64 season, uint256 amount) external nonReentrant onlyOwner {
        Pool storage p = _openPool(season);
        if (amount == 0) revert ZeroAmount();
        p.funded += amount;
        emit Funded(season, amount);
        IERC20 token = p.token;
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        // Exact match is the point: any shortfall or surplus means a non-standard token.
        // forge-lint: disable-next-line(incorrect-strict-equality)
        if (token.balanceOf(address(this)) - before != amount) revert UnsupportedToken();
    }

    /// @notice Claim a reward. Anyone may submit; tokens always go to `account`.
    /// @param season Season to claim from.
    /// @param index Leaf index (claim bitmap position).
    /// @param account Recipient committed in the leaf.
    /// @param amount Amount committed in the leaf.
    /// @param proof Merkle proof for the leaf.
    function claim(uint64 season, uint256 index, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        Pool storage p = _openPool(season);
        if (account == address(0)) revert ZeroAddress();
        BitMaps.BitMap storage bitmap = _claimed[season];
        if (bitmap.get(index)) revert AlreadyClaimed();
        if (!MerkleProof.verifyCalldata(proof, p.root, computeLeaf(index, account, amount))) revert InvalidProof();
        uint256 claimedAfter = p.claimed + amount;
        if (claimedAfter > p.funded) revert InsufficientPool();
        bitmap.set(index);
        p.claimed = claimedAfter;
        // No external call precedes this emit (MerkleProof is an internal library); the transfer follows it.
        // forge-lint: disable-next-line(reentrancy-events)
        emit Claimed(season, index, account, amount);
        p.token.safeTransfer(account, amount);
    }

    /// @notice Send a season's unclaimed balance to `to` after its claim window closes. Owner only, once.
    /// @param season Season to sweep.
    /// @param to Recipient of the remainder.
    function sweep(uint64 season, address to) external nonReentrant onlyOwner {
        Pool storage p = _pools[season];
        if (p.root == bytes32(0)) revert SeasonNotConfigured();
        if (block.timestamp < p.claimDeadline) revert ClaimWindowOpen();
        if (p.swept) revert AlreadySwept();
        if (to == address(0)) revert ZeroAddress();
        uint256 remainder = p.funded - p.claimed;
        p.swept = true;
        emit Swept(season, to, remainder);
        p.token.safeTransfer(to, remainder);
    }

    /// @notice Disabled: an ownerless distributor would strand unclaimed funds forever.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @notice Whether leaf `index` of `season` has been claimed.
    function isClaimed(uint64 season, uint256 index) external view returns (bool) {
        return _claimed[season].get(index);
    }

    /// @notice Pool configuration and accounting for a season.
    function getPool(uint64 season) external view returns (Pool memory) {
        return _pools[season];
    }

    /// @notice Leaf hash for a claim, matching OpenZeppelin StandardMerkleTree over (uint256, address, uint256).
    function computeLeaf(uint256 index, address account, uint256 amount) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
    }

    function _openPool(uint64 season) private view returns (Pool storage p) {
        p = _pools[season];
        if (p.root == bytes32(0)) revert SeasonNotConfigured();
        if (block.timestamp >= p.claimDeadline) revert ClaimWindowClosed();
    }
}
