// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";
import {ElyScore} from "./libraries/ElyScore.sol";

/// @title ElyrionPool
/// @notice USDC credit pool for ERC-8004-style AI agents. Lenders deposit USDC for internal (non-ERC-20) shares.
///         Backers lock shares to open credit lines for agents; a default burns the backer's locked shares first.
/// @dev Unaudited. Hard caps are constants; mutable limits start at the caps and can only be tightened.
///      Accounting identity: totalAssets = balance + outstandingPrincipal - reserve - unclaimedSponsorFees.
///      There is no path that moves lender or backer funds to the owner; the owner can only take `reserve`.
contract ElyrionPool is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ hard caps & parameters

    uint256 public constant MAX_LOAN = 50e6;
    uint256 public constant MIN_LOAN = 5e6;
    uint256 public constant MAX_OUTSTANDING = 5_000e6;
    uint256 public constant MAX_TOTAL_DEPOSITS = 10_000e6;
    uint256 public constant MAX_PER_WALLET = 1_000e6;
    uint256 public constant MIN_TERM = 1 days;
    uint256 public constant MAX_TERM = 7 days;
    uint256 public constant GRACE = 1 days;
    uint256 public constant FEE_BPS = 100;
    uint256 public constant BACKER_CUT_BPS = 2500;
    uint256 public constant RESERVE_CUT_BPS = 2500;

    /// @dev Virtual shares/assets (OZ ERC4626 style, decimals offset 6): blunts donation/inflation attacks.
    uint256 internal constant VIRTUAL_SHARES = 1e6;
    uint256 internal constant VIRTUAL_ASSETS = 1;

    // ------------------------------------------------------------------ immutables

    IERC20 public immutable usdc;
    IAgentRegistry public immutable registry;
    address public immutable treasury;

    // ------------------------------------------------------------------ admin state

    address public guardian;
    bool public paused;

    uint256 public maxLoan = MAX_LOAN;
    uint256 public maxOutstanding = MAX_OUTSTANDING;
    uint256 public maxTotalDeposits = MAX_TOTAL_DEPOSITS;
    uint256 public maxPerWallet = MAX_PER_WALLET;

    // ------------------------------------------------------------------ accounting

    /// @notice Principal currently lent out (USDC that is owed back to the pool).
    uint256 public outstandingPrincipal;
    /// @notice Protocol reserve held in the pool's balance but not owned by lenders.
    uint256 public reserve;
    /// @notice Sum of all `sponsorFees` owed to backers, held in the balance but not owned by lenders.
    uint256 public unclaimedSponsorFees;

    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;
    mapping(address => uint256) public lockedSharesOf;
    /// @notice Net principal deposited per wallet (for the per-wallet cap).
    mapping(address => uint256) public depositedOf;

    // ------------------------------------------------------------------ credit lines & loans

    /// @notice One credit line per agent, backed by `lockedShares` of the backer's pool shares.
    struct Line {
        address backer;
        uint256 amount;
        uint256 lockedShares;
    }

    enum LoanStatus {
        Open,
        Repaid,
        Defaulted
    }

    struct Loan {
        uint256 agentId;
        address borrower;
        uint256 principal;
        uint256 fee;
        uint256 start;
        uint256 term;
        uint256 dueAt;
        LoanStatus status;
    }

    /// @notice Per-agent repayment history (feeds `ElyScore`).
    struct Stats {
        uint256 repaidCount;
        uint256 dollarSecondsRepaid;
        uint256 qualifiedRepaid;
        uint256 firstRepaidAt;
        bool defaulted;
    }

    /// @notice Loans held at least this long count as qualified repayments.
    uint256 public constant QUALIFY_HOLD = 3 days;

    mapping(uint256 => uint256) public pendingRequest;
    mapping(uint256 => Line) public lines;
    mapping(uint256 => Stats) public stats;
    /// @notice Open loan id per agent; 0 when none (loan ids start at 1).
    mapping(uint256 => uint256) public openLoanOf;
    /// @notice Claimable backer share of repaid fees.
    mapping(address => uint256) public sponsorFees;
    /// @notice Number of loans ever created; also the id of the latest loan.
    uint256 public loanCount;
    mapping(uint256 => Loan) internal _loans;

    // ------------------------------------------------------------------ errors

    error Paused();
    error CapExceeded();
    error InsufficientLiquidity();
    error OnlyTighten();
    error NotAgentOwner();
    error NotBacker();
    error NoPendingRequest();
    error LineActive();
    error OpenLoan();
    error BadAmount();
    error BadTerm();
    error AgentDefaulted();
    error NotDue();
    error LoanClosed();
    error NotGuardian();
    error ZeroAddress();
    error NoLine();
    error RenounceDisabled();

    // ------------------------------------------------------------------ events

    event Deposited(address indexed lender, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lender, uint256 assets, uint256 shares);
    event PausedSet(bool paused);
    event GuardianSet(address indexed guardian);
    event MaxLoanSet(uint256 value);
    event MaxOutstandingSet(uint256 value);
    event MaxTotalDepositsSet(uint256 value);
    event MaxPerWalletSet(uint256 value);
    event ReserveWithdrawn(address indexed to, uint256 amount);
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

    // ------------------------------------------------------------------ modifiers

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier onlyGuardianOrOwner() {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _;
    }

    constructor(IERC20 usdc_, IAgentRegistry registry_, address treasury_, address guardian_, address owner_)
        Ownable(owner_)
    {
        if (address(usdc_) == address(0) || address(registry_) == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        usdc = usdc_;
        registry = registry_;
        treasury = treasury_;
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    // ------------------------------------------------------------------ lender actions

    /// @notice Deposit USDC for shares. Pausable. Shares round down (favours the pool).
    function deposit(uint256 assets) external nonReentrant whenNotPaused returns (uint256 shares) {
        if (assets == 0) revert BadAmount();
        if (totalAssets() + assets > maxTotalDeposits) revert CapExceeded();
        if (depositedOf[msg.sender] + assets > maxPerWallet) revert CapExceeded();

        shares = convertToShares(assets);
        if (shares == 0) revert BadAmount();

        sharesOf[msg.sender] += shares;
        totalShares += shares;
        depositedOf[msg.sender] += assets;

        usdc.safeTransferFrom(msg.sender, address(this), assets);
        emit Deposited(msg.sender, assets, shares);
    }

    /// @notice Redeem unlocked shares for USDC. Never pausable. Assets round down (favours the pool).
    /// @dev Reverts `InsufficientLiquidity` instead of paying out less when USDC is lent out.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0 || shares > sharesOf[msg.sender] - lockedSharesOf[msg.sender]) revert BadAmount();

        assets = convertToAssets(shares);
        if (assets == 0) revert BadAmount();
        if (idleLiquidity() < assets) revert InsufficientLiquidity();

        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        uint256 deposited = depositedOf[msg.sender];
        depositedOf[msg.sender] = deposited - Math.min(assets, deposited);

        usdc.safeTransfer(msg.sender, assets);
        emit Withdrawn(msg.sender, assets, shares);
    }

    // ------------------------------------------------------------------ credit lines

    /// @notice Agent owner asks for a credit line of `amount`. Re-requesting overwrites a pending request.
    function requestLine(uint256 agentId, uint256 amount) external {
        address agentOwner = registry.ownerOf(agentId);
        if (msg.sender != agentOwner) revert NotAgentOwner();
        if (stats[agentId].defaulted) revert AgentDefaulted();
        if (lines[agentId].backer != address(0)) revert LineActive();
        if (amount == 0 || amount > maxLoan) revert BadAmount();
        pendingRequest[agentId] = amount;
        emit LineRequested(agentId, agentOwner, amount);
    }

    /// @notice Any lender backs an agent's pending request by locking `convertToSharesUp(amount)` of its free shares.
    ///         Locked shares cannot be withdrawn and are burned first if the agent defaults. Pausable.
    function openLine(uint256 agentId, uint256 amount) external nonReentrant whenNotPaused {
        if (stats[agentId].defaulted) revert AgentDefaulted();
        if (lines[agentId].backer != address(0)) revert LineActive();
        uint256 requested = pendingRequest[agentId];
        if (requested == 0) revert NoPendingRequest();
        if (amount == 0 || amount > requested || amount > maxLoan) revert BadAmount();

        uint256 lock = convertToSharesUp(amount);
        if (lock > sharesOf[msg.sender] - lockedSharesOf[msg.sender]) revert BadAmount();

        lockedSharesOf[msg.sender] += lock;
        lines[agentId] = Line({backer: msg.sender, amount: amount, lockedShares: lock});
        delete pendingRequest[agentId];
        emit LineOpened(agentId, msg.sender, amount, lock);
    }

    /// @notice Backer or current agent owner closes a line with no open loan, unlocking the backer's shares.
    function closeLine(uint256 agentId) external nonReentrant {
        Line memory line = lines[agentId];
        if (line.backer == address(0)) revert NoLine();
        if (msg.sender != line.backer && msg.sender != registry.ownerOf(agentId)) revert NotBacker();
        if (openLoanOf[agentId] != 0) revert OpenLoan();
        lockedSharesOf[line.backer] -= line.lockedShares;
        delete lines[agentId];
        emit LineClosed(agentId);
    }

    // ------------------------------------------------------------------ loans

    /// @notice Current agent owner borrows against the agent's line. One open loan per agent. Pausable.
    /// @dev Fee = ceil(amount * FEE_BPS * term / (30 days * 10_000)), fixed at borrow time.
    function borrow(uint256 agentId, uint256 amount, uint256 term)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 loanId)
    {
        if (msg.sender != registry.ownerOf(agentId)) revert NotAgentOwner();
        if (stats[agentId].defaulted) revert AgentDefaulted();
        if (openLoanOf[agentId] != 0) revert OpenLoan();
        uint256 limit = Math.min(maxLoan, lines[agentId].amount);
        if (amount < MIN_LOAN || amount > limit) revert BadAmount();
        if (term < MIN_TERM || term > MAX_TERM) revert BadTerm();
        if (outstandingPrincipal + amount > maxOutstanding) revert CapExceeded();
        if (idleLiquidity() < amount) revert InsufficientLiquidity();

        uint256 fee = Math.mulDiv(amount, FEE_BPS * term, 30 days * 10_000, Math.Rounding.Ceil);
        uint256 dueAt = block.timestamp + term;
        loanId = ++loanCount;
        _loans[loanId] = Loan({
            agentId: agentId,
            borrower: msg.sender,
            principal: amount,
            fee: fee,
            start: block.timestamp,
            term: term,
            dueAt: dueAt,
            status: LoanStatus.Open
        });
        openLoanOf[agentId] = loanId;
        outstandingPrincipal += amount;

        usdc.safeTransfer(msg.sender, amount);
        emit Borrowed(loanId, agentId, msg.sender, amount, fee, dueAt);
    }

    /// @notice Anyone repays principal + fee of an open loan. Never pausable; allowed past due until marked default.
    /// @dev Fee split: backer and reserve get floor(fee * 25%) each, lenders keep the rest (it stays in totalAssets).
    ///      Reserve and sponsor fees are only ever credited here, from USDC this call receives.
    function repay(uint256 loanId) external nonReentrant {
        Loan storage loan = _loans[loanId];
        if (loan.principal == 0 || loan.status != LoanStatus.Open) revert LoanClosed();
        uint256 agentId = loan.agentId;
        uint256 principal = loan.principal;
        uint256 fee = loan.fee;

        loan.status = LoanStatus.Repaid;
        delete openLoanOf[agentId];
        outstandingPrincipal -= principal;

        // A line cannot be closed or replaced while its loan is open, so this is the backer at borrow time.
        address backer = lines[agentId].backer;
        uint256 backerCut = fee * BACKER_CUT_BPS / 10_000;
        uint256 reserveCut = fee * RESERVE_CUT_BPS / 10_000;
        sponsorFees[backer] += backerCut;
        unclaimedSponsorFees += backerCut;
        reserve += reserveCut;

        Stats storage st = stats[agentId];
        uint256 held = block.timestamp - loan.start;
        st.repaidCount++;
        st.dollarSecondsRepaid += principal * Math.min(held, loan.term);
        if (held >= QUALIFY_HOLD) st.qualifiedRepaid++;
        if (st.firstRepaidAt == 0) st.firstRepaidAt = block.timestamp;

        usdc.safeTransferFrom(msg.sender, address(this), principal + fee);
        emit Repaid(loanId, agentId, msg.sender, principal, fee);
    }

    /// @notice Anyone marks an unpaid loan defaulted once `dueAt + GRACE` has passed. Never pausable.
    /// @dev Burns min(locked, convertToSharesUp(principal + fee)) of the backer's locked shares, priced BEFORE the
    ///      principal is written off, so the share price (and every other lender's convertToAssets) cannot fall.
    ///      The line's locked shares were worth >= line.amount >= principal at open and the price never falls,
    ///      so the cap at `locked` still covers the principal.
    function markDefault(uint256 loanId) external nonReentrant {
        Loan storage loan = _loans[loanId];
        if (loan.principal == 0 || loan.status != LoanStatus.Open) revert LoanClosed();
        if (block.timestamp <= loan.dueAt + GRACE) revert NotDue();
        uint256 agentId = loan.agentId;
        uint256 principal = loan.principal;
        Line memory line = lines[agentId];

        uint256 burn = Math.min(line.lockedShares, convertToSharesUp(principal + loan.fee));
        sharesOf[line.backer] -= burn;
        lockedSharesOf[line.backer] -= line.lockedShares; // burned part + unlocked rest
        totalShares -= burn;

        outstandingPrincipal -= principal;
        loan.status = LoanStatus.Defaulted;
        delete openLoanOf[agentId];
        delete lines[agentId];
        stats[agentId].defaulted = true;

        emit LineClosed(agentId);
        emit Defaulted(loanId, agentId, burn);
    }

    /// @notice Backer claims its accrued share of repaid fees. Never pausable.
    function claimSponsorFees() external nonReentrant returns (uint256 amount) {
        amount = sponsorFees[msg.sender];
        if (amount == 0) revert BadAmount();
        sponsorFees[msg.sender] = 0;
        unclaimedSponsorFees -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit FeesClaimed(msg.sender, amount);
    }

    // ------------------------------------------------------------------ credit views

    /// @notice Agent credit report. `dollarDays` is whole USDC-days repaid (uncapped; the score caps it at 400).
    ///         `lineAmount`/`backer` are 0 when there is no active line; `openLoanId` is 0 when there is no open loan.
    function creditReport(uint256 agentId)
        external
        view
        returns (
            uint256 score,
            uint256 repaidCount,
            uint256 qualifiedRepaid,
            uint256 dollarDays,
            uint256 lineAmount,
            address backer,
            uint256 firstRepaidAt,
            bool defaulted,
            uint256 openLoanId
        )
    {
        Stats memory st = stats[agentId];
        Line memory line = lines[agentId];
        score = ElyScore.score(
            ElyScore.Inputs({
                defaulted: st.defaulted,
                dollarSecondsRepaid: st.dollarSecondsRepaid,
                qualifiedRepaid: st.qualifiedRepaid,
                lineAmount: line.amount,
                firstRepaidAt: st.firstRepaidAt,
                nowTs: block.timestamp
            })
        );
        repaidCount = st.repaidCount;
        qualifiedRepaid = st.qualifiedRepaid;
        dollarDays = st.dollarSecondsRepaid / 1 days / 1e6;
        lineAmount = line.amount;
        backer = line.backer;
        firstRepaidAt = st.firstRepaidAt;
        defaulted = st.defaulted;
        openLoanId = openLoanOf[agentId];
    }

    /// @notice Loan by id (ids start at 1; an unknown id returns a zeroed struct).
    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return _loans[loanId];
    }

    /// @notice Treasury's pool position in USDC, including shares locked behind lines.
    function treasuryDeposited() external view returns (uint256) {
        return convertToAssets(sharesOf[treasury]);
    }

    // ------------------------------------------------------------------ views

    /// @notice Lender-owned value: balance + outstandingPrincipal - reserve - unclaimedSponsorFees.
    function totalAssets() public view returns (uint256) {
        return usdc.balanceOf(address(this)) + outstandingPrincipal - reserve - unclaimedSponsorFees;
    }

    /// @notice USDC in the pool that is free to withdraw or lend: balance - reserve - unclaimedSponsorFees.
    function idleLiquidity() public view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(this));
        uint256 committed = reserve + unclaimedSponsorFees;
        return bal > committed ? bal - committed : 0;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return _toShares(assets, Math.Rounding.Floor);
    }

    function convertToSharesUp(uint256 assets) public view returns (uint256) {
        return _toShares(assets, Math.Rounding.Ceil);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return _toAssets(shares, Math.Rounding.Floor);
    }

    function convertToAssetsUp(uint256 shares) public view returns (uint256) {
        return _toAssets(shares, Math.Rounding.Ceil);
    }

    function _toShares(uint256 assets, Math.Rounding rounding) internal view returns (uint256) {
        return Math.mulDiv(assets, totalShares + VIRTUAL_SHARES, totalAssets() + VIRTUAL_ASSETS, rounding);
    }

    function _toAssets(uint256 shares, Math.Rounding rounding) internal view returns (uint256) {
        return Math.mulDiv(shares, totalAssets() + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES, rounding);
    }

    // ------------------------------------------------------------------ guardian / owner

    /// @notice Pauses deposit, openLine and borrow only. repay/withdraw/markDefault/claimSponsorFees stay open.
    function pause() external onlyGuardianOrOwner {
        paused = true;
        emit PausedSet(true);
    }

    function unpause() external onlyGuardianOrOwner {
        paused = false;
        emit PausedSet(false);
    }

    function setGuardian(address newGuardian) external onlyOwner {
        guardian = newGuardian;
        emit GuardianSet(newGuardian);
    }

    function setMaxLoan(uint256 newValue) external onlyOwner {
        if (newValue > maxLoan) revert OnlyTighten();
        maxLoan = newValue;
        emit MaxLoanSet(newValue);
    }

    function setMaxOutstanding(uint256 newValue) external onlyOwner {
        if (newValue > maxOutstanding) revert OnlyTighten();
        maxOutstanding = newValue;
        emit MaxOutstandingSet(newValue);
    }

    function setMaxTotalDeposits(uint256 newValue) external onlyOwner {
        if (newValue > maxTotalDeposits) revert OnlyTighten();
        maxTotalDeposits = newValue;
        emit MaxTotalDepositsSet(newValue);
    }

    function setMaxPerWallet(uint256 newValue) external onlyOwner {
        if (newValue > maxPerWallet) revert OnlyTighten();
        maxPerWallet = newValue;
        emit MaxPerWalletSet(newValue);
    }

    /// @notice Disabled: an ownerless pool would strand `reserve` and freeze the caps forever.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice Owner takes protocol reserve only; can never exceed `reserve`.
    function withdrawReserve(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0 || amount > reserve) revert BadAmount();
        reserve -= amount;
        usdc.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }
}
