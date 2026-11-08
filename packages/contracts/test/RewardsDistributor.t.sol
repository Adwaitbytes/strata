// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RewardsDistributor} from "../src/RewardsDistributor.sol";
import {Merkle} from "./utils/Merkle.sol";
import {MockERC20, FeeOnTransferToken, ReentrantToken} from "./mocks/MockTokens.sol";

contract RewardsDistributorTest is Test {
    RewardsDistributor internal dist;
    MockERC20 internal token;
    Merkle internal merkle;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal treasury = makeAddr("treasury");

    uint64 internal constant SEASON = 1;
    uint64 internal constant T0 = 1_800_000_000;

    bytes32[] internal leaves;
    bytes32 internal root;
    bytes32[][] internal proofs;

    function setUp() public {
        vm.warp(T0);
        dist = new RewardsDistributor(owner);
        token = new MockERC20();
        merkle = new Merkle();
        token.mint(owner, 1_000e18);
        vm.prank(owner);
        token.approve(address(dist), type(uint256).max);

        leaves.push(dist.computeLeaf(0, alice, 100e18));
        leaves.push(dist.computeLeaf(1, bob, 50e18));
        leaves.push(dist.computeLeaf(2, carol, 25e18));
        root = merkle.getRoot(leaves);
        for (uint256 i; i < leaves.length; ++i) {
            proofs.push(merkle.getProof(leaves, i));
        }
    }

    function _configure() internal {
        vm.prank(owner);
        dist.configureSeason(SEASON, IERC20(address(token)), root);
    }

    function _configureAndFund(uint256 amount) internal {
        _configure();
        vm.prank(owner);
        dist.fund(SEASON, amount);
    }

    /// @dev Reads cached proofs so no external call sits between expectRevert and the call under test.
    function _proof(uint256 i) internal view returns (bytes32[] memory) {
        return proofs[i];
    }

    // ---------------------------------------------------------------- constructor / ownership

    function test_constructor_setsOwner() public view {
        assertEq(dist.owner(), owner);
        assertEq(dist.CLAIM_WINDOW(), 30 days);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new RewardsDistributor(address(0));
    }

    function test_renounceOwnership_disabled() public {
        vm.prank(owner);
        vm.expectRevert(RewardsDistributor.RenounceDisabled.selector);
        dist.renounceOwnership();
    }

    function test_rejectsEther() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(dist).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ---------------------------------------------------------------- configureSeason

    function test_configureSeason_storesAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit RewardsDistributor.SeasonConfigured(SEASON, address(token), root, T0 + 30 days);
        _configure();
        RewardsDistributor.Pool memory p = dist.getPool(SEASON);
        assertEq(address(p.token), address(token));
        assertEq(p.root, root);
        assertEq(p.claimDeadline, T0 + 30 days);
        assertEq(p.funded, 0);
        assertEq(p.claimed, 0);
        assertFalse(p.swept);
    }

    function test_configureSeason_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        dist.configureSeason(SEASON, IERC20(address(token)), root);
    }

    function test_configureSeason_revertsOnSeasonZero() public {
        vm.prank(owner);
        vm.expectRevert(RewardsDistributor.InvalidSeason.selector);
        dist.configureSeason(0, IERC20(address(token)), root);
    }

    function test_configureSeason_revertsOnZeroToken() public {
        vm.prank(owner);
        vm.expectRevert(RewardsDistributor.ZeroAddress.selector);
        dist.configureSeason(SEASON, IERC20(address(0)), root);
    }

    function test_configureSeason_revertsOnZeroRoot() public {
        vm.prank(owner);
        vm.expectRevert(RewardsDistributor.ZeroRoot.selector);
        dist.configureSeason(SEASON, IERC20(address(token)), bytes32(0));
    }

    function test_configureSeason_rootIsImmutable() public {
        _configure();
        vm.prank(owner);
        vm.expectRevert(RewardsDistributor.SeasonAlreadyConfigured.selector);
        dist.configureSeason(SEASON, IERC20(address(token)), keccak256("other"));
    }

    // ---------------------------------------------------------------- fund

    function test_fund_pullsTokensAndEmits() public {
        _configure();
        vm.expectEmit(true, false, false, true);
        emit RewardsDistributor.Funded(SEASON, 200e18);
        vm.prank(owner);
        dist.fund(SEASON, 200e18);
        assertEq(token.balanceOf(address(dist)), 200e18);
        assertEq(dist.getPool(SEASON).funded, 200e18);
    }

    function test_fund_rejectsFeeOnTransferToken() public {
        FeeOnTransferToken fee = new FeeOnTransferToken();
        fee.mint(owner, 1_000e18);
        vm.startPrank(owner);
        fee.approve(address(dist), type(uint256).max);
        dist.configureSeason(SEASON, IERC20(address(fee)), root);
        vm.expectRevert(RewardsDistributor.UnsupportedToken.selector);
        dist.fund(SEASON, 100e18);
        vm.stopPrank();
        assertEq(dist.getPool(SEASON).funded, 0);
    }

    function test_fund_onlyOwner() public {
        _configure();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        dist.fund(SEASON, 1);
    }

    function test_fund_revertsWhenNotConfigured() public {
        vm.prank(owner);
        vm.expectRevert(RewardsDistributor.SeasonNotConfigured.selector);
        dist.fund(SEASON, 1);
    }

    function test_fund_revertsOnZeroAmount() public {
        _configure();
        vm.prank(owner);
        vm.expectRevert(RewardsDistributor.ZeroAmount.selector);
        dist.fund(SEASON, 0);
    }

    function test_fund_revertsAfterWindow() public {
        _configure();
        vm.warp(T0 + 30 days);
        vm.prank(owner);
        vm.expectRevert(RewardsDistributor.ClaimWindowClosed.selector);
        dist.fund(SEASON, 1);
    }

    // ---------------------------------------------------------------- claim

    function test_claim_paysAndEmits() public {
        _configureAndFund(175e18);
        vm.expectEmit(true, true, true, true);
        emit RewardsDistributor.Claimed(SEASON, 0, alice, 100e18);
        vm.prank(bob); // anyone may submit; tokens always go to the leaf account
        dist.claim(SEASON, 0, alice, 100e18, _proof(0));
        assertEq(token.balanceOf(alice), 100e18);
        assertTrue(dist.isClaimed(SEASON, 0));
        assertFalse(dist.isClaimed(SEASON, 1));
        assertEq(dist.getPool(SEASON).claimed, 100e18);
    }

    function test_claim_allLeaves() public {
        _configureAndFund(175e18);
        dist.claim(SEASON, 0, alice, 100e18, _proof(0));
        dist.claim(SEASON, 1, bob, 50e18, _proof(1));
        dist.claim(SEASON, 2, carol, 25e18, _proof(2));
        assertEq(token.balanceOf(address(dist)), 0);
    }

    function test_claim_twiceReverts() public {
        _configureAndFund(175e18);
        dist.claim(SEASON, 0, alice, 100e18, _proof(0));
        vm.expectRevert(RewardsDistributor.AlreadyClaimed.selector);
        dist.claim(SEASON, 0, alice, 100e18, _proof(0));
    }

    function test_claim_revertsOnWrongAmount() public {
        _configureAndFund(175e18);
        vm.expectRevert(RewardsDistributor.InvalidProof.selector);
        dist.claim(SEASON, 0, alice, 101e18, _proof(0));
    }

    function test_claim_revertsOnWrongAccount() public {
        _configureAndFund(175e18);
        vm.expectRevert(RewardsDistributor.InvalidProof.selector);
        dist.claim(SEASON, 0, bob, 100e18, _proof(0));
    }

    function test_claim_revertsOnZeroAccount() public {
        _configureAndFund(175e18);
        vm.expectRevert(RewardsDistributor.ZeroAddress.selector);
        dist.claim(SEASON, 0, address(0), 100e18, _proof(0));
    }

    function test_claim_revertsWhenNotConfigured() public {
        vm.expectRevert(RewardsDistributor.SeasonNotConfigured.selector);
        dist.claim(SEASON, 0, alice, 100e18, _proof(0));
    }

    function test_claim_revertsAfterWindow() public {
        _configureAndFund(175e18);
        vm.warp(T0 + 30 days);
        vm.expectRevert(RewardsDistributor.ClaimWindowClosed.selector);
        dist.claim(SEASON, 0, alice, 100e18, _proof(0));
    }

    function test_claim_revertsWhenPoolUnderfunded() public {
        _configureAndFund(99e18);
        vm.expectRevert(RewardsDistributor.InsufficientPool.selector);
        dist.claim(SEASON, 0, alice, 100e18, _proof(0));
    }

    function test_claim_seasonsAreIsolated() public {
        _configureAndFund(175e18);
        bytes32[] memory l2 = new bytes32[](2);
        l2[0] = dist.computeLeaf(0, alice, 500e18);
        l2[1] = dist.computeLeaf(1, bob, 1);
        vm.startPrank(owner);
        dist.configureSeason(2, IERC20(address(token)), merkle.getRoot(l2));
        dist.fund(2, 10e18);
        vm.stopPrank();
        // Season 2 cannot drain season 1's pool even though both share a token balance.
        bytes32[] memory p = merkle.getProof(l2, 0);
        vm.expectRevert(RewardsDistributor.InsufficientPool.selector);
        dist.claim(2, 0, alice, 500e18, p);
    }

    function test_claim_isReentrancyGuarded() public {
        ReentrantToken re = new ReentrantToken();
        re.mint(owner, 1_000e18);
        vm.startPrank(owner);
        re.approve(address(dist), type(uint256).max);
        dist.configureSeason(SEASON, IERC20(address(re)), root);
        dist.fund(SEASON, 175e18);
        vm.stopPrank();
        re.arm(address(dist), abi.encodeCall(RewardsDistributor.claim, (SEASON, 1, bob, 50e18, _proof(1))));
        dist.claim(SEASON, 0, alice, 100e18, _proof(0));
        assertTrue(re.reentered());
        assertEq(re.lastRevert(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertFalse(dist.isClaimed(SEASON, 1));
    }

    function testFuzz_claim_bitmapIndependent(uint256 a, uint256 b) public {
        vm.assume(a != b);
        bytes32[] memory l = new bytes32[](2);
        l[0] = dist.computeLeaf(a, alice, 1e18);
        l[1] = dist.computeLeaf(b, bob, 1e18);
        vm.startPrank(owner);
        dist.configureSeason(SEASON, IERC20(address(token)), merkle.getRoot(l));
        dist.fund(SEASON, 2e18);
        vm.stopPrank();
        dist.claim(SEASON, a, alice, 1e18, merkle.getProof(l, 0));
        assertTrue(dist.isClaimed(SEASON, a));
        assertFalse(dist.isClaimed(SEASON, b));
        dist.claim(SEASON, b, bob, 1e18, merkle.getProof(l, 1));
        assertTrue(dist.isClaimed(SEASON, b));
    }

    function testFuzz_claim_forgedAmountRejected(uint256 amount) public {
        vm.assume(amount != 100e18);
        _configureAndFund(175e18);
        vm.expectRevert(RewardsDistributor.InvalidProof.selector);
        dist.claim(SEASON, 0, alice, amount, _proof(0));
    }

    // ---------------------------------------------------------------- sweep

    function test_sweep_afterWindowSendsRemainder() public {
        _configureAndFund(175e18);
        dist.claim(SEASON, 0, alice, 100e18, _proof(0));
        vm.warp(T0 + 30 days);
        vm.expectEmit(true, true, false, true);
        emit RewardsDistributor.Swept(SEASON, treasury, 75e18);
        vm.prank(owner);
        dist.sweep(SEASON, treasury);
        assertEq(token.balanceOf(treasury), 75e18);
        assertTrue(dist.getPool(SEASON).swept);
    }

    function test_sweep_revertsDuringWindow() public {
        _configureAndFund(175e18);
        vm.warp(T0 + 30 days - 1);
        vm.prank(owner);
        vm.expectRevert(RewardsDistributor.ClaimWindowOpen.selector);
        dist.sweep(SEASON, treasury);
    }

    function test_sweep_twiceReverts() public {
        _configureAndFund(175e18);
        vm.warp(T0 + 30 days);
        vm.startPrank(owner);
        dist.sweep(SEASON, treasury);
        vm.expectRevert(RewardsDistributor.AlreadySwept.selector);
        dist.sweep(SEASON, treasury);
        vm.stopPrank();
    }

    function test_sweep_revertsWhenNotConfigured() public {
        vm.prank(owner);
        vm.expectRevert(RewardsDistributor.SeasonNotConfigured.selector);
        dist.sweep(SEASON, treasury);
    }

    function test_sweep_revertsOnZeroRecipient() public {
        _configureAndFund(175e18);
        vm.warp(T0 + 30 days);
        vm.prank(owner);
        vm.expectRevert(RewardsDistributor.ZeroAddress.selector);
        dist.sweep(SEASON, address(0));
    }

    function test_sweep_onlyOwner() public {
        _configureAndFund(175e18);
        vm.warp(T0 + 30 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        dist.sweep(SEASON, alice);
    }

    function test_sweep_doesNotTouchOtherSeasons() public {
        _configureAndFund(175e18);
        vm.warp(T0 + 10 days);
        vm.startPrank(owner);
        dist.configureSeason(2, IERC20(address(token)), root);
        dist.fund(2, 175e18);
        vm.warp(T0 + 30 days);
        dist.sweep(SEASON, treasury);
        vm.stopPrank();
        assertEq(token.balanceOf(treasury), 175e18);
        assertEq(token.balanceOf(address(dist)), 175e18);
        dist.claim(2, 0, alice, 100e18, _proof(0));
    }
}
