// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ElyrionPool} from "../src/ElyrionPool.sol";
import {ElyrionIdentity} from "../src/ElyrionIdentity.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract PoolLoansTest is Test {
    event LineRequested(uint256 indexed agentId, address indexed owner, uint256 amount);
    event LineOpened(uint256 indexed agentId, address indexed backer, uint256 amount, uint256 lockedShares);
    event LineClosed(uint256 indexed agentId);
    event Borrowed(
        uint256 indexed loanId,
        uint256 indexed agentId,
        address indexed borrower,
        uint256 amount,
        uint256 fee,
        uint256 dueAt
    );
    event Repaid(uint256 indexed loanId, uint256 indexed agentId, address indexed payer, uint256 amount, uint256 fee);
    event Defaulted(uint256 indexed loanId, uint256 indexed agentId, uint256 burnedShares);
    event FeesClaimed(address indexed backer, uint256 amount);

    MockUSDC usdc;
    ElyrionIdentity registry;
    ElyrionPool pool;

    address owner = address(0x0123);
    address guardian = address(0x6A2D);
    address treasury = address(0x7EA5);
    address alice = address(0xA11CE); // backer
    address bob = address(0xB0B); // plain lender
    address carol = address(0xCA201); // third party
    address dave = address(0xDA7E); // agent owner
    address erin = address(0xE217); // second agent owner / NFT recipient

    uint256 agent; // owned by dave
    uint256 agent2; // owned by erin

    uint256 constant FEE_50_7D = 116_667; // ceil(50e6*100*7d / (30d*10_000))

    function setUp() public {
        usdc = new MockUSDC();
        registry = new ElyrionIdentity();
        pool = new ElyrionPool(IERC20(address(usdc)), IAgentRegistry(address(registry)), treasury, guardian, owner);
        vm.prank(dave);
        agent = registry.register("ipfs://agent-1");
        vm.prank(erin);
        agent2 = registry.register("ipfs://agent-2");
    }

    // ---------------------------------------------------------------- helpers

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

    function _openLine(uint256 agentId, address backer, uint256 amount) internal {
        vm.prank(registry.ownerOf(agentId));
        pool.requestLine(agentId, amount);
        vm.prank(backer);
        pool.openLine(agentId, amount);
    }

    function _borrow(uint256 agentId, uint256 amount, uint256 term) internal returns (uint256 loanId) {
        vm.prank(registry.ownerOf(agentId));
        loanId = pool.borrow(agentId, amount, term);
    }

    function _repay(uint256 loanId, address payer) internal {
        ElyrionPool.Loan memory l = pool.getLoan(loanId);
        _fund(payer, l.principal + l.fee);
        vm.prank(payer);
        pool.repay(loanId);
    }

    function _line(uint256 agentId) internal view returns (address backer, uint256 amount, uint256 locked) {
        (backer, amount, locked) = pool.lines(agentId);
    }

    function _score(uint256 agentId) internal view returns (uint256 s) {
        (s,,,,,,,,) = pool.creditReport(agentId);
    }

    /// @dev Standard setup: alice deposits 100 and backs `agent` for 50; bob deposits 100.
    function _standard() internal {
        _deposit(alice, 100e6);
        _deposit(bob, 100e6);
        _openLine(agent, alice, 50e6);
    }

    // ---------------------------------------------------------------- lines

    function test_requestThenOpenLine() public {
        _deposit(alice, 100e6);

        vm.expectEmit(true, true, false, true);
        emit LineRequested(agent, dave, 50e6);
        vm.prank(dave);
        pool.requestLine(agent, 50e6);
        assertEq(pool.pendingRequest(agent), 50e6);

        uint256 lock = pool.convertToSharesUp(50e6);
        assertEq(lock, 50e6 * 1e6);
        vm.expectEmit(true, true, false, true);
        emit LineOpened(agent, alice, 50e6, lock);
        vm.prank(alice);
        pool.openLine(agent, 50e6);

        (address backer, uint256 amount, uint256 locked) = _line(agent);
        assertEq(backer, alice);
        assertEq(amount, 50e6);
        assertEq(locked, lock);
        assertEq(pool.lockedSharesOf(alice), lock);
        assertEq(pool.sharesOf(alice), 100e6 * 1e6);
        assertEq(pool.pendingRequest(agent), 0);
        assertEq(pool.totalAssets(), 100e6); // locking moves no value

        // one line per agent
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.LineActive.selector));
        pool.requestLine(agent, 10e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.LineActive.selector));
        pool.openLine(agent, 10e6);
    }

    function test_requestLineOnlyAgentOwnerAndValidAmount() public {
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NotAgentOwner.selector));
        pool.requestLine(agent, 10e6);

        vm.startPrank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.requestLine(agent, 0);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.requestLine(agent, 50e6 + 1);
        pool.requestLine(agent, 20e6);
        pool.requestLine(agent, 30e6); // re-request overwrites while no line is open
        vm.stopPrank();
        assertEq(pool.pendingRequest(agent), 30e6);
    }

    function test_openLineWithoutRequestReverts() public {
        _deposit(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NoPendingRequest.selector));
        pool.openLine(agent, 10e6);
    }

    function test_openLineValidation() public {
        _deposit(alice, 30e6);
        vm.prank(dave);
        pool.requestLine(agent, 40e6);

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.openLine(agent, 0);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.openLine(agent, 40e6 + 1); // above the request
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.openLine(agent, 40e6); // alice only has 30 of free shares
        vm.stopPrank();

        // a tightened maxLoan below the request is enforced at open time
        vm.prank(owner);
        pool.setMaxLoan(20e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.openLine(agent, 25e6);

        // a partial fill of the request is allowed
        vm.prank(alice);
        pool.openLine(agent, 20e6);
        (, uint256 amount,) = _line(agent);
        assertEq(amount, 20e6);

        // shares already locked cannot back a second line
        vm.prank(erin);
        pool.requestLine(agent2, 15e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.openLine(agent2, 15e6);
        vm.prank(alice);
        pool.openLine(agent2, 10e6);
        assertEq(pool.lockedSharesOf(alice), pool.sharesOf(alice));
    }

    function test_closeLine() public {
        _standard();

        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NotBacker.selector));
        pool.closeLine(agent);

        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NoLine.selector));
        pool.closeLine(agent2);

        uint256 loanId = _borrow(agent, 10e6, 1 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.OpenLoan.selector));
        pool.closeLine(agent);
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.OpenLoan.selector));
        pool.closeLine(agent);

        _repay(loanId, dave);
        vm.expectEmit(true, false, false, true);
        emit LineClosed(agent);
        vm.prank(alice);
        pool.closeLine(agent);
        assertEq(pool.lockedSharesOf(alice), 0);
        (address backer,,) = _line(agent);
        assertEq(backer, address(0));

        // the agent owner may also close, and can then request again
        _openLine(agent, alice, 20e6);
        vm.prank(dave);
        pool.closeLine(agent);
        assertEq(pool.lockedSharesOf(alice), 0);
        vm.prank(dave);
        pool.requestLine(agent, 10e6);
    }

    /// Task 2 review (a): locked shares cannot be withdrawn, exactly the unlocked part can.
    function test_withdrawLockedSharesRevertsUnlockedSucceeds() public {
        _deposit(alice, 100e6);
        _openLine(agent, alice, 40e6);
        uint256 freeShares = pool.sharesOf(alice) - pool.lockedSharesOf(alice);
        assertEq(freeShares, 60e6 * 1e6);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.withdraw(freeShares + 1);

        vm.prank(alice);
        uint256 out = pool.withdraw(freeShares);
        assertEq(out, 60e6);
        assertEq(pool.sharesOf(alice), pool.lockedSharesOf(alice));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.withdraw(1);

        vm.prank(alice);
        pool.closeLine(agent);
        uint256 rest = pool.sharesOf(alice);
        vm.prank(alice);
        assertEq(pool.withdraw(rest), 40e6);
    }

    // ---------------------------------------------------------------- borrow

    function test_borrowWithinLine() public {
        _deposit(alice, 100e6);
        _openLine(agent, alice, 30e6);

        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.borrow(agent, 30e6 + 1, 3 days);

        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NotAgentOwner.selector));
        pool.borrow(agent, 30e6, 3 days);

        // an agent with no line has a zero limit
        vm.prank(erin);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.borrow(agent2, 5e6, 3 days);

        uint256 fee = 30e6 * 100 * 3 days / (30 days * 10_000); // exact: 30_000
        assertEq(fee, 30_000);
        uint256 dueAt = block.timestamp + 3 days;
        vm.expectEmit(true, true, true, true);
        emit Borrowed(1, agent, dave, 30e6, fee, dueAt);
        vm.prank(dave);
        uint256 loanId = pool.borrow(agent, 30e6, 3 days);

        assertEq(loanId, 1);
        assertEq(pool.loanCount(), 1);
        assertEq(usdc.balanceOf(dave), 30e6);
        assertEq(pool.outstandingPrincipal(), 30e6);
        assertEq(pool.idleLiquidity(), 70e6);
        assertEq(pool.totalAssets(), 100e6); // lending moves no value
        assertEq(pool.openLoanOf(agent), 1);

        ElyrionPool.Loan memory l = pool.getLoan(loanId);
        assertEq(l.agentId, agent);
        assertEq(l.borrower, dave);
        assertEq(l.principal, 30e6);
        assertEq(l.fee, fee);
        assertEq(l.start, block.timestamp);
        assertEq(l.term, 3 days);
        assertEq(l.dueAt, dueAt);
        assertEq(uint8(l.status), 0);

        (,,,,,,,, uint256 openLoanId) = pool.creditReport(agent);
        assertEq(openLoanId, 1);

        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.OpenLoan.selector));
        pool.borrow(agent, 5e6, 3 days);
    }

    function test_borrowCapsAndTerms() public {
        _standard();

        vm.startPrank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.borrow(agent, 4.99e6, 1 days);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.borrow(agent, 50e6 + 1, 1 days);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadTerm.selector));
        pool.borrow(agent, 5e6, 1 days - 1);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadTerm.selector));
        pool.borrow(agent, 5e6, 7 days + 1);
        vm.stopPrank();

        // tightened maxLoan caps an existing line
        vm.prank(owner);
        pool.setMaxLoan(20e6);
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.borrow(agent, 20e6 + 1, 1 days);

        // total outstanding cap
        vm.prank(owner);
        pool.setMaxOutstanding(10e6);
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.CapExceeded.selector));
        pool.borrow(agent, 10e6 + 1, 1 days);

        // boundaries succeed
        uint256 id1 = _borrow(agent, 5e6, 1 days);
        _repay(id1, dave);
        uint256 id2 = _borrow(agent, 10e6, 7 days);
        assertEq(pool.getLoan(id2).term, 7 days);
    }

    /// Unreachable in an honest pool (the backer's locked shares always cover the line); exercised with a
    /// simulated external USDC shortfall.
    function test_borrowRevertsOnInsufficientLiquidity() public {
        _deposit(alice, 50e6);
        _openLine(agent, alice, 50e6);
        deal(address(usdc), address(pool), 49e6);
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.InsufficientLiquidity.selector));
        pool.borrow(agent, 50e6, 1 days);
        _borrow(agent, 49e6, 1 days);
        assertEq(pool.idleLiquidity(), 0);
    }

    function test_feeRounding() public {
        _standard();
        uint256 id1 = _borrow(agent, 5e6, 1 days);
        assertEq(pool.getLoan(id1).fee, 1667);
        _repay(id1, dave);
        uint256 id2 = _borrow(agent, 50e6, 7 days);
        assertEq(pool.getLoan(id2).fee, FEE_50_7D);
    }

    // ---------------------------------------------------------------- repay

    function test_repaySplitsFee() public {
        _standard();
        uint256 bobShares = pool.sharesOf(bob);
        uint256 bobBefore = pool.convertToAssets(bobShares);
        uint256 assetsBefore = pool.totalAssets();

        uint256 loanId = _borrow(agent, 50e6, 7 days);
        vm.warp(block.timestamp + 7 days);

        uint256 backerCut = FEE_50_7D * 2500 / 10_000; // 29_166
        uint256 reserveCut = FEE_50_7D * 2500 / 10_000;
        uint256 lenderCut = FEE_50_7D - backerCut - reserveCut; // 58_335
        assertEq(backerCut, 29_166);
        assertEq(lenderCut, 58_335);

        _fund(carol, 50e6 + FEE_50_7D);
        vm.expectEmit(true, true, true, true);
        emit Repaid(loanId, agent, carol, 50e6, FEE_50_7D);
        vm.prank(carol);
        pool.repay(loanId);

        assertEq(usdc.balanceOf(carol), 0);
        assertEq(pool.reserve(), reserveCut);
        assertEq(pool.sponsorFees(alice), backerCut);
        assertEq(pool.unclaimedSponsorFees(), backerCut);
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(pool.openLoanOf(agent), 0);
        assertEq(uint8(pool.getLoan(loanId).status), 1);
        assertEq(pool.totalAssets(), assetsBefore + lenderCut);
        assertGt(pool.convertToAssets(bobShares), bobBefore);

        // the line stays active after a repayment
        (address backer, uint256 amount,) = _line(agent);
        assertEq(backer, alice);
        assertEq(amount, 50e6);

        // repaying twice is impossible
        _fund(carol, 50e6 + FEE_50_7D);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.LoanClosed.selector));
        pool.repay(loanId);

        // backer claims its cut
        uint256 assetsMid = pool.totalAssets();
        vm.expectEmit(true, false, false, true);
        emit FeesClaimed(alice, backerCut);
        vm.prank(alice);
        uint256 claimed = pool.claimSponsorFees();
        assertEq(claimed, backerCut);
        assertEq(usdc.balanceOf(alice), backerCut);
        assertEq(pool.sponsorFees(alice), 0);
        assertEq(pool.unclaimedSponsorFees(), 0);
        assertEq(pool.totalAssets(), assetsMid); // claiming moves no lender value

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.claimSponsorFees();
    }

    /// Task 2 review (b): reserve and sponsor fees are excluded from lender assets and idle liquidity,
    /// and the owner can take at most `reserve`.
    function test_feesExcludedFromAssetsAndIdle() public {
        _standard();
        uint256 loanId = _borrow(agent, 50e6, 7 days);
        vm.warp(block.timestamp + 7 days);
        _repay(loanId, dave);

        uint256 bal = usdc.balanceOf(address(pool));
        uint256 res = pool.reserve();
        uint256 unc = pool.unclaimedSponsorFees();
        assertGt(res, 0);
        assertGt(unc, 0);
        assertEq(bal, 200e6 + FEE_50_7D);
        assertEq(pool.totalAssets(), bal - res - unc);
        assertEq(pool.idleLiquidity(), bal - res - unc);

        uint256 assetsBefore = pool.totalAssets();
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.withdrawReserve(owner, res + 1);
        pool.withdrawReserve(owner, res);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.BadAmount.selector));
        pool.withdrawReserve(owner, 1);
        vm.stopPrank();
        assertEq(usdc.balanceOf(owner), res);
        assertEq(pool.reserve(), 0);
        assertEq(pool.totalAssets(), assetsBefore);

        // everyone can exit in full; the pool keeps only rounding dust
        vm.prank(alice);
        pool.closeLine(agent);
        vm.prank(alice);
        pool.claimSponsorFees();
        uint256 a = pool.sharesOf(alice);
        uint256 b = pool.sharesOf(bob);
        vm.prank(alice);
        pool.withdraw(a);
        vm.prank(bob);
        pool.withdraw(b);
        assertEq(pool.totalShares(), 0);
        assertLt(usdc.balanceOf(address(pool)), 10);
        assertGt(usdc.balanceOf(alice) + usdc.balanceOf(bob), 200e6);
    }

    function test_scoreAfterRepay() public {
        _standard();
        uint256 loanId = _borrow(agent, 50e6, 7 days);
        vm.warp(block.timestamp + 7 days);
        _repay(loanId, dave);

        (
            uint256 score,
            uint256 repaidCount,
            uint256 qualifiedRepaid,
            uint256 dollarDays,
            uint256 lineAmount,
            address backer,
            uint256 firstRepaidAt,
            bool defaulted,
            uint256 openLoanId
        ) = pool.creditReport(agent);
        assertEq(score, 525); // 350 dollar-days + 25 qualified + 150 backing + 0 age
        assertEq(repaidCount, 1);
        assertEq(qualifiedRepaid, 1);
        assertEq(dollarDays, 350);
        assertEq(lineAmount, 50e6);
        assertEq(backer, alice);
        assertEq(firstRepaidAt, block.timestamp);
        assertFalse(defaulted);
        assertEq(openLoanId, 0);

        vm.warp(block.timestamp + 10 days);
        assertEq(_score(agent), 575); // + 10 days * 5 age points
    }

    function test_heldCappedByTermAndShortHoldNotQualified() public {
        _standard();
        uint256 id1 = _borrow(agent, 10e6, 2 days);
        vm.warp(block.timestamp + 2 days);
        _repay(id1, dave);
        (uint256 repaidCount, uint256 dollarSeconds, uint256 qualified, uint256 firstRepaidAt,) = pool.stats(agent);
        assertEq(repaidCount, 1);
        assertEq(dollarSeconds, 10e6 * 2 days);
        assertEq(qualified, 0); // held < 3 days
        uint256 first = firstRepaidAt;

        uint256 id2 = _borrow(agent, 10e6, 3 days);
        vm.warp(block.timestamp + 4 days); // late but before default
        _repay(id2, dave);
        (repaidCount, dollarSeconds, qualified, firstRepaidAt,) = pool.stats(agent);
        assertEq(repaidCount, 2);
        assertEq(dollarSeconds, 10e6 * 2 days + 10e6 * 3 days); // held capped at term
        assertEq(qualified, 1);
        assertEq(firstRepaidAt, first); // set once
    }

    /// Review Focus 2: a late repayment before anyone marks default is a normal repayment, even while paused.
    function test_lateRepayBeforeDefaultIsRepaid() public {
        _standard();
        uint256 loanId = _borrow(agent, 10e6, 2 days);
        ElyrionPool.Loan memory l = pool.getLoan(loanId);

        vm.warp(l.dueAt + 1 days); // last second of grace: default not yet possible
        vm.prank(guardian);
        pool.pause();
        _repay(loanId, carol);

        assertEq(uint8(pool.getLoan(loanId).status), 1);
        assertEq(pool.outstandingPrincipal(), 0);
        (uint256 repaidCount, uint256 dollarSeconds, uint256 qualified,, bool defaulted) = pool.stats(agent);
        assertEq(repaidCount, 1);
        assertEq(dollarSeconds, 10e6 * 2 days);
        assertEq(qualified, 1); // held 3 days
        assertFalse(defaulted);
        assertGt(_score(agent), 0);

        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.LoanClosed.selector));
        pool.markDefault(loanId);
    }

    // ---------------------------------------------------------------- default

    function test_markDefaultTooEarlyReverts() public {
        _standard();
        uint256 loanId = _borrow(agent, 10e6, 1 days);
        uint256 dueAt = pool.getLoan(loanId).dueAt;

        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NotDue.selector));
        pool.markDefault(loanId);
        vm.warp(dueAt);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NotDue.selector));
        pool.markDefault(loanId);
        vm.warp(dueAt + 1 days);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NotDue.selector));
        pool.markDefault(loanId);

        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.LoanClosed.selector));
        pool.markDefault(999); // unknown loan
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.LoanClosed.selector));
        pool.repay(999);

        vm.warp(dueAt + 1 days + 1);
        vm.prank(carol);
        pool.markDefault(loanId);
        assertEq(uint8(pool.getLoan(loanId).status), 2);

        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.LoanClosed.selector));
        pool.markDefault(loanId);
    }

    function test_defaultBurnsBackerLenderWhole() public {
        _standard();
        uint256 bobShares = pool.sharesOf(bob);
        uint256 bobBefore = pool.convertToAssets(bobShares);

        uint256 loanId = _borrow(agent, 50e6, 7 days);
        vm.warp(block.timestamp + 8 days + 1);

        uint256 aliceShares = pool.sharesOf(alice);
        uint256 lock = pool.lockedSharesOf(alice);
        // a full-line loan owes principal + fee > line amount, so the burn is capped at the locked shares,
        // which still cover the principal
        assertGt(pool.convertToSharesUp(50e6 + FEE_50_7D), lock);
        uint256 burn = lock;
        assertGe(pool.convertToAssets(burn), 50e6);
        uint256 totalBefore = pool.totalShares();

        vm.expectEmit(true, true, false, true);
        emit LineClosed(agent);
        vm.expectEmit(true, true, false, true);
        emit Defaulted(loanId, agent, burn);
        vm.prank(carol);
        pool.markDefault(loanId);

        assertEq(pool.sharesOf(alice), aliceShares - burn);
        assertEq(pool.lockedSharesOf(alice), 0);
        assertEq(pool.totalShares(), totalBefore - burn);
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(pool.openLoanOf(agent), 0);
        (address backer, uint256 amount, uint256 locked) = _line(agent);
        assertEq(backer, address(0));
        assertEq(amount, 0);
        assertEq(locked, 0);
        (,,,, bool defaulted) = pool.stats(agent);
        assertTrue(defaulted);

        // the plain lender is made whole (and keeps the unpaid fee as compensation)
        assertGe(pool.convertToAssets(bobShares), bobBefore);

        // both can exit; the pool stays solvent
        vm.prank(bob);
        uint256 bobOut = pool.withdraw(bobShares);
        assertGe(bobOut, 100e6);
        uint256 aliceRest = pool.sharesOf(alice);
        vm.prank(alice);
        uint256 aliceOut = pool.withdraw(aliceRest);
        // the backer bears the whole principal loss
        assertLe(aliceOut, 50e6);
        assertGe(aliceOut, 50e6 - 1);
        assertEq(pool.totalShares(), 0);
        assertEq(bobOut + aliceOut + usdc.balanceOf(address(pool)), 150e6);
    }

    function test_defaultPartialLineBurnsOwedAndUnlocksRest() public {
        _standard(); // line 50, alice 100, bob 100
        uint256 bobShares = pool.sharesOf(bob);
        uint256 bobBefore = pool.convertToAssets(bobShares);
        uint256 loanId = _borrow(agent, 20e6, 3 days);
        uint256 fee = pool.getLoan(loanId).fee;
        assertEq(fee, 20_000);
        vm.warp(block.timestamp + 4 days + 1);

        uint256 aliceShares = pool.sharesOf(alice);
        uint256 lock = pool.lockedSharesOf(alice);
        uint256 burn = pool.convertToSharesUp(20e6 + fee);
        assertLt(burn, lock);

        vm.expectEmit(true, true, false, true);
        emit Defaulted(loanId, agent, burn);
        pool.markDefault(loanId);

        assertEq(pool.sharesOf(alice), aliceShares - burn);
        assertEq(pool.lockedSharesOf(alice), 0); // the rest of the line's lock is released
        // lenders are compensated for principal and the unpaid fee
        assertGt(pool.convertToAssets(bobShares), bobBefore);

        uint256 freeAlice = pool.sharesOf(alice);
        vm.prank(alice);
        uint256 aliceOut = pool.withdraw(freeAlice);
        assertLt(aliceOut, 80e6);
        assertGe(aliceOut, 80e6 - fee);
    }

    function test_defaultedAgentCannotBorrowOrScore() public {
        _standard();
        uint256 id1 = _borrow(agent, 50e6, 7 days);
        vm.warp(block.timestamp + 7 days);
        _repay(id1, dave);
        assertGt(_score(agent), 0);

        uint256 id2 = _borrow(agent, 20e6, 1 days);
        vm.warp(block.timestamp + 2 days + 1);
        pool.markDefault(id2);

        (uint256 score,,,, uint256 lineAmount, address backer,, bool defaulted, uint256 openLoanId) =
            pool.creditReport(agent);
        assertEq(score, 0);
        assertTrue(defaulted);
        assertEq(lineAmount, 0);
        assertEq(backer, address(0));
        assertEq(openLoanId, 0);

        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.AgentDefaulted.selector));
        pool.requestLine(agent, 10e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.AgentDefaulted.selector));
        pool.openLine(agent, 10e6);
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.AgentDefaulted.selector));
        pool.borrow(agent, 5e6, 1 days);

        _fund(dave, 30e6);
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.LoanClosed.selector));
        pool.repay(id2);

        vm.warp(block.timestamp + 365 days);
        assertEq(_score(agent), 0); // forever
    }

    function test_twoDefaultsSameBacker() public {
        _deposit(alice, 200e6);
        _deposit(bob, 300e6);
        _openLine(agent, alice, 50e6);
        _openLine(agent2, alice, 40e6);
        uint256 bobShares = pool.sharesOf(bob);
        uint256 p0 = pool.convertToAssets(bobShares);

        uint256 id1 = _borrow(agent, 50e6, 7 days);
        uint256 id2 = _borrow(agent2, 40e6, 3 days);
        assertGe(pool.convertToAssets(bobShares), p0);

        vm.warp(block.timestamp + 4 days + 1);
        pool.markDefault(id2);
        uint256 p1 = pool.convertToAssets(bobShares);
        assertGe(p1, p0);
        assertEq(pool.lockedSharesOf(alice), _lockedOf(agent)); // agent2's lock fully released

        vm.warp(block.timestamp + 4 days);
        pool.markDefault(id1);
        uint256 p2 = pool.convertToAssets(bobShares);
        assertGe(p2, p1);
        assertEq(pool.lockedSharesOf(alice), 0);
        assertEq(pool.outstandingPrincipal(), 0);
        assertLe(pool.lockedSharesOf(alice), pool.sharesOf(alice));

        vm.prank(bob);
        assertGe(pool.withdraw(bobShares), 300e6);
    }

    function _lockedOf(uint256 agentId) internal view returns (uint256 locked) {
        (,, locked) = pool.lines(agentId);
    }

    // ---------------------------------------------------------------- NFT transfer

    /// Review Focus 3: the loan stays with the agentId; anyone repays; only the new owner borrows next.
    function test_transferMidLoan() public {
        _standard();
        uint256 loanId = _borrow(agent, 20e6, 3 days);

        vm.prank(dave);
        registry.transferFrom(dave, erin, agent);
        assertEq(registry.ownerOf(agent), erin);

        vm.warp(block.timestamp + 3 days);
        _repay(loanId, carol);
        assertEq(pool.getLoan(loanId).borrower, dave);
        (uint256 repaidCount,, uint256 qualified,,) = pool.stats(agent);
        assertEq(repaidCount, 1);
        assertEq(qualified, 1);
        assertGt(_score(agent), 0);

        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NotAgentOwner.selector));
        pool.borrow(agent, 5e6, 1 days);
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.NotBacker.selector));
        pool.closeLine(agent);

        vm.prank(erin);
        uint256 next = pool.borrow(agent, 5e6, 1 days);
        assertEq(pool.getLoan(next).borrower, erin);
        assertEq(usdc.balanceOf(erin), 5e6);
    }

    // ---------------------------------------------------------------- pause

    function test_pauseNeverBlocksRepayWithdrawDefault() public {
        _deposit(alice, 200e6);
        _deposit(bob, 100e6);
        _openLine(agent, alice, 50e6);
        _openLine(agent2, alice, 50e6);
        uint256 id1 = _borrow(agent, 20e6, 3 days);
        uint256 id2 = _borrow(agent2, 20e6, 1 days);
        vm.warp(block.timestamp + 3 days);

        vm.prank(guardian);
        pool.pause();

        // pausable: deposit, openLine, borrow
        _fund(carol, 10e6);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.Paused.selector));
        pool.deposit(10e6);
        vm.prank(erin);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.Paused.selector));
        pool.borrow(agent2, 5e6, 1 days);

        // never pausable: repay, markDefault, claimSponsorFees, withdraw (and closeLine/requestLine)
        _repay(id1, carol);
        assertEq(uint8(pool.getLoan(id1).status), 1);
        pool.markDefault(id2);
        assertEq(uint8(pool.getLoan(id2).status), 2);
        vm.prank(alice);
        assertGt(pool.claimSponsorFees(), 0);
        uint256 bobShares = pool.sharesOf(bob);
        vm.prank(bob);
        assertGe(pool.withdraw(bobShares), 100e6);
        vm.prank(alice);
        pool.closeLine(agent);

        // openLine is pausable
        vm.prank(dave);
        pool.requestLine(agent, 10e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.Paused.selector));
        pool.openLine(agent, 10e6);

        vm.prank(owner);
        pool.unpause();
        vm.prank(alice);
        pool.openLine(agent, 10e6);
    }

    // ---------------------------------------------------------------- misc views / admin

    function test_treasuryDepositedIncludesLockedShares() public {
        assertEq(pool.treasuryDeposited(), 0);
        _deposit(treasury, 1_000e6);
        assertEq(pool.treasuryDeposited(), 1_000e6);
        _openLine(agent, treasury, 50e6);
        assertEq(pool.treasuryDeposited(), 1_000e6);

        uint256 loanId = _borrow(agent, 50e6, 7 days);
        vm.warp(block.timestamp + 7 days);
        _repay(loanId, dave);
        assertEq(pool.treasuryDeposited(), 1_000e6 + 58_335 - 1); // lender cut, floor rounding vs virtual shares
    }

    function test_creditReportEmptyAgent() public view {
        (
            uint256 score,
            uint256 repaidCount,
            uint256 qualifiedRepaid,
            uint256 dollarDays,
            uint256 lineAmount,
            address backer,
            uint256 firstRepaidAt,
            bool defaulted,
            uint256 openLoanId
        ) = pool.creditReport(agent);
        assertEq(score + repaidCount + qualifiedRepaid + dollarDays + lineAmount + firstRepaidAt + openLoanId, 0);
        assertEq(backer, address(0));
        assertFalse(defaulted);
        ElyrionPool.Loan memory l = pool.getLoan(1);
        assertEq(l.principal, 0);
    }

    function test_backingScoreWithoutLoans() public {
        _deposit(alice, 100e6);
        _openLine(agent, alice, 20e6);
        assertEq(_score(agent), 60); // 3 points per $1 of active line
    }

    function test_renounceOwnershipDisabled() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ElyrionPool.RenounceDisabled.selector));
        pool.renounceOwnership();
        assertEq(pool.owner(), owner);
    }
}
