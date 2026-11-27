// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/// @title ElyrionPool
/// @notice USDC credit pool for ERC-8004-style AI agents. Lenders deposit USDC for internal (non-ERC-20) shares.
///         Backers (Task 3) lock shares to open credit lines for agents.
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

    /// @notice Owner takes protocol reserve only; can never exceed `reserve`.
    function withdrawReserve(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0 || amount > reserve) revert BadAmount();
        reserve -= amount;
        usdc.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }
}
