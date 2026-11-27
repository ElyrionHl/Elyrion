// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ElyrionPool} from "../src/ElyrionPool.sol";
import {ElyrionIdentity} from "../src/ElyrionIdentity.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Drives the pool through deposit / withdraw / open / close / borrow / repay / warp / default / claim.
///         Inputs are bounded to valid ranges so most calls do real work.
contract PoolHandler is Test {
    ElyrionPool public pool;
    MockUSDC public usdc;
    ElyrionIdentity public registry;
    address public owner;

    address[] public lenders;
    uint256[] public agentIds;
    address public watcher; // passive lender: deposits once in setUp, never acts
    address public payer = address(0xFA7E2);

    // ghosts
    bool public priceFell;
    bool public watcherFell;
    bool public freeSharesIlliquid;
    uint256 public lastWatcherAssets;
    mapping(bytes32 => uint256) public calls;

    constructor(ElyrionPool pool_, MockUSDC usdc_, ElyrionIdentity registry_, address owner_, address watcher_) {
        pool = pool_;
        usdc = usdc_;
        registry = registry_;
        owner = owner_;
        watcher = watcher_;
        lastWatcherAssets = pool.convertToAssets(pool.sharesOf(watcher));
        for (uint160 i = 1; i <= 3; i++) {
            lenders.push(address(0x1000 + i));
        }
        for (uint160 i = 1; i <= 6; i++) {
            address agentOwner = address(0x2000 + i);
            vm.prank(agentOwner);
            agentIds.push(registry.register("ipfs://agent"));
        }
    }

    modifier checkPrice() {
        uint256 a0 = pool.totalAssets() + 1;
        uint256 s0 = pool.totalShares() + 1e6;
        _;
        uint256 a1 = pool.totalAssets() + 1;
        uint256 s1 = pool.totalShares() + 1e6;
        // price = (assets + 1) / (shares + 1e6); cross-multiplied, exact
        if (a1 * s0 < a0 * s1) priceFell = true;
        uint256 w = pool.convertToAssets(pool.sharesOf(watcher));
        if (w < lastWatcherAssets) watcherFell = true;
        lastWatcherAssets = w;
    }

    function lendersLength() external view returns (uint256) {
        return lenders.length;
    }

    function agentsLength() external view returns (uint256) {
        return agentIds.length;
    }

    function _free(address who) internal view returns (uint256) {
        return pool.sharesOf(who) - pool.lockedSharesOf(who);
    }

    function _defaulted(uint256 agentId) internal view returns (bool d) {
        (,,,, d) = pool.stats(agentId);
    }

    // ---------------------------------------------------------------- actions

    function deposit(uint256 who, uint256 amount) external checkPrice {
        address l = lenders[who % lenders.length];
        amount = bound(amount, 1e6, 300e6);
        if (pool.totalAssets() + amount > pool.maxTotalDeposits()) return;
        if (pool.depositedOf(l) + amount > pool.maxPerWallet()) return;
        usdc.mint(l, amount);
        vm.startPrank(l);
        usdc.approve(address(pool), amount);
        pool.deposit(amount);
        vm.stopPrank();
        calls["deposit"]++;
    }

    function withdraw(uint256 who, uint256 shares) external checkPrice {
        address l = lenders[who % lenders.length];
        uint256 free = _free(l);
        if (free == 0) return;
        shares = bound(shares, 1, free);
        uint256 assets = pool.convertToAssets(shares);
        if (assets == 0) return;
        if (assets > pool.idleLiquidity()) {
            freeSharesIlliquid = true; // must never happen: loans are fully covered by locked shares
            return;
        }
        vm.prank(l);
        pool.withdraw(shares);
        calls["withdraw"]++;
    }

    function openLine(uint256 agentSeed, uint256 backerSeed, uint256 amount) external checkPrice {
        uint256 agentId = agentIds[agentSeed % agentIds.length];
        address backer = lenders[backerSeed % lenders.length];
        if (_defaulted(agentId)) return;
        (address existing,,) = pool.lines(agentId);
        if (existing != address(0)) return;
        amount = bound(amount, 1e6, pool.maxLoan());
        if (pool.convertToSharesUp(amount) > _free(backer)) return;
        vm.prank(registry.ownerOf(agentId));
        pool.requestLine(agentId, amount);
        vm.prank(backer);
        pool.openLine(agentId, amount);
        calls["openLine"]++;
    }

    function closeLine(uint256 agentSeed) external checkPrice {
        uint256 agentId = agentIds[agentSeed % agentIds.length];
        (address backer,,) = pool.lines(agentId);
        if (backer == address(0) || pool.openLoanOf(agentId) != 0) return;
        vm.prank(backer);
        pool.closeLine(agentId);
        calls["closeLine"]++;
    }

    function borrow(uint256 agentSeed, uint256 amount, uint256 term) external checkPrice {
        uint256 agentId = agentIds[agentSeed % agentIds.length];
        if (_defaulted(agentId) || pool.openLoanOf(agentId) != 0) return;
        (, uint256 lineAmount,) = pool.lines(agentId);
        uint256 maxAmt = lineAmount < pool.maxLoan() ? lineAmount : pool.maxLoan();
        if (maxAmt < pool.MIN_LOAN()) return;
        amount = bound(amount, pool.MIN_LOAN(), maxAmt);
        term = bound(term, 1 days, 7 days);
        if (pool.outstandingPrincipal() + amount > pool.maxOutstanding()) {
            calls["borrowCapHit"]++;
            return;
        }
        if (pool.idleLiquidity() < amount) {
            calls["borrowIlliquid"]++;
            return;
        }
        vm.prank(registry.ownerOf(agentId));
        pool.borrow(agentId, amount, term);
        calls["borrow"]++;
    }

    function repay(uint256 agentSeed) external checkPrice {
        uint256 agentId = agentIds[agentSeed % agentIds.length];
        uint256 loanId = pool.openLoanOf(agentId);
        if (loanId == 0) return;
        ElyrionPool.Loan memory l = pool.getLoan(loanId);
        usdc.mint(payer, l.principal + l.fee);
        vm.startPrank(payer);
        usdc.approve(address(pool), l.principal + l.fee);
        pool.repay(loanId);
        vm.stopPrank();
        calls["repay"]++;
    }

    function markDefault(uint256 agentSeed) external checkPrice {
        uint256 agentId = agentIds[agentSeed % agentIds.length];
        uint256 loanId = pool.openLoanOf(agentId);
        if (loanId == 0) return;
        if (block.timestamp <= pool.getLoan(loanId).dueAt + pool.GRACE()) return;
        pool.markDefault(loanId);
        calls["markDefault"]++;
    }

    function claim(uint256 who) external checkPrice {
        address l = lenders[who % lenders.length];
        if (pool.sponsorFees(l) == 0) return;
        vm.prank(l);
        pool.claimSponsorFees();
        calls["claim"]++;
    }

    function takeReserve(uint256 amount) external checkPrice {
        uint256 r = pool.reserve();
        if (r == 0) return;
        amount = bound(amount, 1, r);
        vm.prank(owner);
        pool.withdrawReserve(owner, amount);
        calls["takeReserve"]++;
    }

    function warp(uint256 secs) external checkPrice {
        secs = bound(secs, 1 hours, 3 days);
        vm.warp(block.timestamp + secs);
        calls["warp"]++;
    }
}

contract PoolInvariantTest is StdInvariant, Test {
    MockUSDC usdc;
    ElyrionIdentity registry;
    ElyrionPool pool;
    PoolHandler handler;

    address owner = address(0x0123);
    address guardian = address(0x6A2D);
    address treasury = address(0x7EA5);
    address watcher = address(0x3A7C4);

    function setUp() public {
        usdc = new MockUSDC();
        registry = new ElyrionIdentity();
        pool = new ElyrionPool(IERC20(address(usdc)), IAgentRegistry(address(registry)), treasury, guardian, owner);

        // a tight outstanding cap so the fuzzer actually reaches it
        vm.prank(owner);
        pool.setMaxOutstanding(150e6);

        usdc.mint(watcher, 100e6);
        vm.startPrank(watcher);
        usdc.approve(address(pool), 100e6);
        pool.deposit(100e6);
        vm.stopPrank();

        handler = new PoolHandler(pool, usdc, registry, owner, watcher);

        bytes4[] memory selectors = new bytes4[](10);
        selectors[0] = PoolHandler.deposit.selector;
        selectors[1] = PoolHandler.withdraw.selector;
        selectors[2] = PoolHandler.openLine.selector;
        selectors[3] = PoolHandler.closeLine.selector;
        selectors[4] = PoolHandler.borrow.selector;
        selectors[5] = PoolHandler.repay.selector;
        selectors[6] = PoolHandler.markDefault.selector;
        selectors[7] = PoolHandler.claim.selector;
        selectors[8] = PoolHandler.takeReserve.selector;
        selectors[9] = PoolHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_lenderSharePriceNeverFalls() public view {
        assertFalse(handler.priceFell(), "share price fell");
        assertFalse(handler.watcherFell(), "passive lender assets fell");
        assertGe(pool.convertToAssets(pool.sharesOf(watcher)), 100e6 - 1);
    }

    function invariant_outstandingWithinCap() public view {
        assertLe(pool.outstandingPrincipal(), pool.maxOutstanding());
        assertLe(pool.maxOutstanding(), pool.MAX_OUTSTANDING());

        uint256 sum;
        for (uint256 i; i < handler.agentsLength(); i++) {
            uint256 loanId = pool.openLoanOf(handler.agentIds(i));
            if (loanId != 0) sum += pool.getLoan(loanId).principal;
        }
        assertEq(pool.outstandingPrincipal(), sum, "outstanding != sum of open loans");
    }

    function invariant_openLoansFullyCollateralized() public view {
        for (uint256 i; i < handler.agentsLength(); i++) {
            uint256 agentId = handler.agentIds(i);
            uint256 loanId = pool.openLoanOf(agentId);
            if (loanId == 0) continue;
            (address backer,, uint256 locked) = pool.lines(agentId);
            assertTrue(backer != address(0), "open loan without line");
            assertGe(pool.convertToAssets(locked), pool.getLoan(loanId).principal, "loan under-collateralized");
        }
    }

    function invariant_freeSharesAlwaysLiquid() public view {
        assertFalse(handler.freeSharesIlliquid());
        uint256 freeValue = pool.convertToAssets(pool.sharesOf(watcher));
        for (uint256 i; i < handler.lendersLength(); i++) {
            address l = handler.lenders(i);
            freeValue += pool.convertToAssets(pool.sharesOf(l) - pool.lockedSharesOf(l));
        }
        assertLe(freeValue, pool.idleLiquidity());
    }

    function invariant_shareAndFeeAccounting() public view {
        uint256 shares = pool.sharesOf(watcher);
        uint256 fees;
        for (uint256 i; i < handler.lendersLength(); i++) {
            address l = handler.lenders(i);
            shares += pool.sharesOf(l);
            fees += pool.sponsorFees(l);
            assertLe(pool.lockedSharesOf(l), pool.sharesOf(l));

            uint256 lockedByLines;
            for (uint256 j; j < handler.agentsLength(); j++) {
                (address backer,, uint256 locked) = pool.lines(handler.agentIds(j));
                if (backer == l) lockedByLines += locked;
            }
            assertEq(pool.lockedSharesOf(l), lockedByLines, "locked != sum of line locks");
        }
        assertEq(pool.totalShares(), shares);
        assertEq(pool.unclaimedSponsorFees(), fees);
        assertGe(usdc.balanceOf(address(pool)), pool.reserve() + pool.unclaimedSponsorFees());
    }

    function afterInvariant() external view {
        // keep the run honest: the interesting paths must actually be exercised
        assertGt(handler.calls("deposit") + handler.calls("openLine") + handler.calls("borrow"), 0);
    }
}
