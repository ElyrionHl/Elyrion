// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ElyrionPool} from "../src/ElyrionPool.sol";
import {ElyrionIdentity} from "../src/ElyrionIdentity.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract PoolLendingTest is Test {
    event Deposited(address indexed lender, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lender, uint256 assets, uint256 shares);
    event PausedSet(bool paused);

    MockUSDC usdc;
    ElyrionIdentity registry;
    ElyrionPool pool;

    address owner = address(0x0123);
    address guardian = address(0x6A2D);
    address treasury = address(0x7EA5);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);

    function setUp() public {
        usdc = new MockUSDC();
        registry = new ElyrionIdentity();
        pool = new ElyrionPool(IERC20(address(usdc)), IAgentRegistry(address(registry)), treasury, guardian, owner);
    }

    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(pool), type(uint256).max);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        _fund(who, amount);
        vm.prank(who);
        shares = pool.deposit(amount);
    }

    // ---------------------------------------------------------------- setup

    function test_constructorWiringAndInitialCaps() public view {
        assertEq(address(pool.usdc()), address(usdc));
        assertEq(address(pool.registry()), address(registry));
        assertEq(pool.treasury(), treasury);
        assertEq(pool.guardian(), guardian);
        assertEq(pool.owner(), owner);
        assertFalse(pool.paused());

        assertEq(pool.MAX_LOAN(), 50e6);
        assertEq(pool.MIN_LOAN(), 5e6);
        assertEq(pool.MAX_OUTSTANDING(), 5_000e6);
        assertEq(pool.MAX_TOTAL_DEPOSITS(), 10_000e6);
        assertEq(pool.MAX_PER_WALLET(), 1_000e6);
        assertEq(pool.MIN_TERM(), 1 days);
        assertEq(pool.MAX_TERM(), 7 days);
        assertEq(pool.GRACE(), 1 days);
        assertEq(pool.FEE_BPS(), 100);
        assertEq(pool.BACKER_CUT_BPS(), 2500);
        assertEq(pool.RESERVE_CUT_BPS(), 2500);

        assertEq(pool.maxLoan(), 50e6);
        assertEq(pool.maxOutstanding(), 5_000e6);
        assertEq(pool.maxTotalDeposits(), 10_000e6);
        assertEq(pool.maxPerWallet(), 1_000e6);

        assertEq(pool.totalShares(), 0);
        assertEq(pool.totalAssets(), 0);
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(pool.reserve(), 0);
        assertEq(pool.unclaimedSponsorFees(), 0);
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.ZeroAddress.selector));
        new ElyrionPool(IERC20(address(0)), IAgentRegistry(address(registry)), treasury, guardian, owner);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.ZeroAddress.selector));
        new ElyrionPool(IERC20(address(usdc)), IAgentRegistry(address(0)), treasury, guardian, owner);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.ZeroAddress.selector));
        new ElyrionPool(IERC20(address(usdc)), IAgentRegistry(address(registry)), address(0), guardian, owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ElyrionPool(IERC20(address(usdc)), IAgentRegistry(address(registry)), treasury, guardian, address(0));
    }

    // ---------------------------------------------------------------- deposit / withdraw

    function test_depositMintsShares() public {
        _fund(alice, 100e6);
        // empty pool: shares = 100e6 * (0 + 1e6) / (0 + 1)
        vm.expectEmit(true, false, false, true);
        emit Deposited(alice, 100e6, 100e6 * 1e6);
        vm.prank(alice);
        uint256 shares = pool.deposit(100e6);

        assertEq(shares, 100e6 * 1e6);
        assertEq(pool.sharesOf(alice), shares);
        assertEq(pool.totalShares(), shares);
        assertEq(pool.lockedSharesOf(alice), 0);
        assertEq(pool.depositedOf(alice), 100e6);
        assertEq(pool.totalAssets(), 100e6);
        assertEq(usdc.balanceOf(address(pool)), 100e6);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(pool.convertToAssets(shares), 100e6);

        // second depositor at the same price gets the same shares per asset
        uint256 bobShares = _deposit(bob, 50e6);
        assertEq(bobShares, 50e6 * 1e6);
        assertEq(pool.totalShares(), 150e6 * 1e6);
    }

    function test_depositZeroReverts() public {
        _fund(alice, 1e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.deposit(0);
    }

    function test_withdrawReturnsAssets() public {
        uint256 shares = _deposit(alice, 100e6);

        vm.expectEmit(true, false, false, true);
        emit Withdrawn(alice, 40e6, 40e6 * 1e6);
        vm.prank(alice);
        uint256 assets = pool.withdraw(40e6 * 1e6);

        assertEq(assets, 40e6);
        assertEq(usdc.balanceOf(alice), 40e6);
        assertEq(pool.sharesOf(alice), shares - 40e6 * 1e6);
        assertEq(pool.totalShares(), shares - 40e6 * 1e6);
        assertEq(pool.depositedOf(alice), 60e6);
        assertEq(pool.totalAssets(), 60e6);

        uint256 rest = pool.sharesOf(alice);
        vm.prank(alice);
        assets = pool.withdraw(rest);
        assertEq(assets, 60e6);
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(pool.sharesOf(alice), 0);
        assertEq(pool.totalShares(), 0);
        assertEq(pool.depositedOf(alice), 0);
        assertEq(usdc.balanceOf(address(pool)), 0);
    }

    function test_withdrawMoreThanSharesReverts() public {
        uint256 shares = _deposit(alice, 10e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.withdraw(shares + 1);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.withdraw(1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.withdraw(0);
    }

    function test_withdrawDustSharesForZeroAssetsReverts() public {
        _deposit(alice, 10e6);
        // 1 share is worth 1e-6 of a unit; rounding down gives 0 assets
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.withdraw(1);
    }

    function test_withdrawProfitClampsDepositedOf() public {
        _deposit(alice, 100e6);
        usdc.mint(address(pool), 10e6); // yield-like donation
        vm.startPrank(alice);
        uint256 assets = pool.withdraw(pool.sharesOf(alice));
        vm.stopPrank();
        assertGt(assets, 100e6);
        assertLe(assets, 110e6);
        assertEq(pool.depositedOf(alice), 0);
    }

    // ---------------------------------------------------------------- caps

    function test_depositCapGlobal() public {
        for (uint160 i = 1; i <= 10; i++) {
            _deposit(address(0x1000 + i), 1_000e6);
        }
        assertEq(pool.totalAssets(), 10_000e6);

        _fund(carol, 1);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.CapExceeded.selector));
        pool.deposit(1);
    }

    function test_depositCapPerWallet() public {
        _deposit(alice, 1_000e6);
        assertEq(pool.depositedOf(alice), 1_000e6);

        _fund(bob, 1_000_000_001);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.CapExceeded.selector));
        pool.deposit(1_000_000_001);

        // the cap is cumulative per wallet
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
        usdc.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.CapExceeded.selector));
        pool.deposit(1);
    }

    function test_settersOnlyTighten() public {
        vm.startPrank(owner);
        pool.setMaxLoan(40e6);
        assertEq(pool.maxLoan(), 40e6);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.OnlyTighten.selector));
        pool.setMaxLoan(45e6);
        pool.setMaxLoan(40e6); // equal is allowed

        pool.setMaxOutstanding(1_000e6);
        assertEq(pool.maxOutstanding(), 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.OnlyTighten.selector));
        pool.setMaxOutstanding(1_000e6 + 1);

        pool.setMaxTotalDeposits(2_000e6);
        assertEq(pool.maxTotalDeposits(), 2_000e6);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.OnlyTighten.selector));
        pool.setMaxTotalDeposits(10_000e6);

        pool.setMaxPerWallet(100e6);
        assertEq(pool.maxPerWallet(), 100e6);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.OnlyTighten.selector));
        pool.setMaxPerWallet(100e6 + 1);
        vm.stopPrank();

        // tightened caps are enforced
        _fund(alice, 100e6 + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.CapExceeded.selector));
        pool.deposit(100e6 + 1);
    }

    function test_settersOwnerOnly() public {
        bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian);
        vm.startPrank(guardian);
        vm.expectRevert(unauthorized);
        pool.setMaxLoan(1);
        vm.expectRevert(unauthorized);
        pool.setMaxOutstanding(1);
        vm.expectRevert(unauthorized);
        pool.setMaxTotalDeposits(1);
        vm.expectRevert(unauthorized);
        pool.setMaxPerWallet(1);
        vm.expectRevert(unauthorized);
        pool.setGuardian(alice);
        vm.expectRevert(unauthorized);
        pool.withdrawReserve(guardian, 0);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- pause / guardian

    function test_pauseBlocksDepositNotWithdraw() public {
        uint256 shares = _deposit(alice, 100e6);
        _fund(bob, 10e6);

        vm.expectEmit(false, false, false, true);
        emit PausedSet(true);
        vm.prank(guardian);
        pool.pause();
        assertTrue(pool.paused());

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.Paused.selector));
        pool.deposit(10e6);

        vm.prank(alice);
        uint256 assets = pool.withdraw(shares);
        assertEq(assets, 100e6);
        assertEq(usdc.balanceOf(alice), 100e6);

        vm.expectEmit(false, false, false, true);
        emit PausedSet(false);
        vm.prank(owner);
        pool.unpause();
        assertFalse(pool.paused());

        vm.prank(bob);
        pool.deposit(10e6);
        assertEq(pool.depositedOf(bob), 10e6);
    }

    function test_pauseGuardianOrOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NotGuardian.selector));
        pool.pause();

        vm.prank(owner);
        pool.pause();
        assertTrue(pool.paused());

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NotGuardian.selector));
        pool.unpause();

        vm.prank(guardian);
        pool.unpause();
        assertFalse(pool.paused());
    }

    function test_setGuardian() public {
        vm.prank(owner);
        pool.setGuardian(carol);
        assertEq(pool.guardian(), carol);

        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NotGuardian.selector));
        pool.pause();

        vm.prank(carol);
        pool.pause();
        assertTrue(pool.paused());
    }

    // ---------------------------------------------------------------- reserve

    function test_withdrawReserveLimitedToReserve() public {
        _deposit(alice, 100e6);
        // reserve is 0 in this task: lender funds can never be pulled by the owner
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.withdrawReserve(owner, 1);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.withdrawReserve(owner, 100e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(pool)), 100e6);
    }

    // ---------------------------------------------------------------- ownership

    function test_ownable2Step() public {
        vm.prank(owner);
        pool.transferOwnership(carol);
        assertEq(pool.owner(), owner);
        assertEq(pool.pendingOwner(), carol);
        vm.prank(carol);
        pool.acceptOwnership();
        assertEq(pool.owner(), carol);
    }

    // ---------------------------------------------------------------- inflation / donation

    function test_donationDoesNotStealDeposit() public {
        uint256 aliceIn = 1 + 1_000e6;
        uint256 aliceShares = _deposit(alice, 1);
        usdc.mint(alice, 1_000e6);
        vm.prank(alice);
        usdc.transfer(address(pool), 1_000e6); // direct donation

        uint256 bobShares = _deposit(bob, 500e6);
        assertGt(bobShares, 0);
        vm.prank(bob);
        uint256 bobOut = pool.withdraw(bobShares);
        assertGe(bobOut, 499.99e6);
        assertLe(bobOut, 500e6); // rounding never favours the depositor

        // the attack is unprofitable for the donor
        vm.prank(alice);
        uint256 aliceOut = pool.withdraw(aliceShares);
        assertLt(aliceOut, aliceIn);
    }

    function test_conversionRounding() public {
        _deposit(alice, 3e6);
        usdc.mint(address(pool), 1e6); // totalAssets = 4e6, totalShares = 3e12
        uint256 assets = 7;
        uint256 down = pool.convertToShares(assets);
        uint256 up = pool.convertToSharesUp(assets);
        assertEq(up, down + 1);
        uint256 sharesIn = 1_234_567;
        assertEq(pool.convertToAssetsUp(sharesIn), pool.convertToAssets(sharesIn) + 1);
        // zero converts to zero either way
        assertEq(pool.convertToShares(0), 0);
        assertEq(pool.convertToSharesUp(0), 0);
    }

    // ---------------------------------------------------------------- lent-out liquidity

    /// Review Focus 4. Every loan is covered by backer shares locked at >= its principal, so the free shares of
    /// all holders are always worth <= idle USDC and an honest lent-out pool can always pay free shares. The
    /// `InsufficientLiquidity` guard therefore only fires after an external USDC shortfall, simulated here with
    /// `deal` (e.g. a token-level freeze). It must revert, never pay out less, and never lock the lender out.
    function test_withdrawRevertsWhenLentOut() public {
        address agentOwner = address(0xDA7E);
        vm.prank(agentOwner);
        uint256 agentId = registry.register("ipfs://agent");

        _deposit(alice, 50e6);
        uint256 bobShares = _deposit(bob, 50e6);
        vm.prank(agentOwner);
        pool.requestLine(agentId, 50e6);
        vm.prank(alice);
        pool.openLine(agentId, 50e6); // all of alice's shares locked
        vm.prank(agentOwner);
        uint256 loanId = pool.borrow(agentId, 50e6, 7 days);
        assertEq(pool.idleLiquidity(), 50e6);
        assertEq(pool.outstandingPrincipal(), 50e6);

        // honest lent-out pool: bob's free shares are fully liquid
        assertEq(pool.convertToAssets(bobShares), 50e6);

        // external shortfall: half of the idle USDC disappears
        deal(address(usdc), address(pool), 25e6);
        assertEq(pool.idleLiquidity(), 25e6);
        uint256 owed = pool.convertToAssets(bobShares);
        assertGt(owed, pool.idleLiquidity());

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.InsufficientLiquidity.selector));
        pool.withdraw(bobShares);
        assertEq(pool.sharesOf(bob), bobShares); // nothing burned
        assertEq(usdc.balanceOf(bob), 0); // nothing partially paid

        // bob can still take what is idle, and the rest once the loan is repaid
        uint256 part = pool.convertToShares(25e6);
        vm.prank(bob);
        uint256 got = pool.withdraw(part);
        assertLe(got, 25e6);
        assertGt(got, 25e6 - 2);

        ElyrionPool.Loan memory l = pool.getLoan(loanId);
        _fund(agentOwner, l.principal + l.fee);
        vm.prank(agentOwner);
        pool.repay(loanId);
        uint256 rest = pool.sharesOf(bob);
        vm.prank(bob);
        pool.withdraw(rest);
        assertEq(pool.sharesOf(bob), 0);
    }
}
