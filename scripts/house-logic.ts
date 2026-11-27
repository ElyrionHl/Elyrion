/** Pure decision logic for the house agent (no I/O). */

export const HOUSE_BORROW_USD = 5;
export const HOUSE_TERM_DAYS = 4;
/** The pool counts a repayment as qualified when held >= 3 days; repay 10 minutes past that. */
export const HOLD_SEC = 3 * 86_400 + 10 * 60;
/** Never let a loan run to its due date: repay at the latest this long before dueAt. */
export const DUE_MARGIN_SEC = 30 * 60;

export type HouseAction = "borrow" | "repay" | "wait";

/** The agent's latest loan as read from the pool, or null when it has none. */
export interface HouseLoan {
  status: "open" | "repaid" | "defaulted";
  /** Unix seconds (Loan.start). */
  start: number;
  /** Unix seconds (Loan.dueAt). */
  dueAt: number;
}

/**
 * No loan, or the latest one is closed (repaid/defaulted) → borrow.
 * Open and held >= 3 days + 10 minutes → repay (a qualified repayment, still before due).
 * Open and within DUE_MARGIN_SEC of dueAt (e.g. a short loan someone else opened) → repay anyway.
 * Otherwise wait.
 */
export function decideHouseAction(loan: HouseLoan | null, nowSec: number): HouseAction {
  if (!loan || loan.status !== "open") return "borrow";
  if (nowSec - loan.start >= HOLD_SEC) return "repay";
  if (nowSec >= loan.dueAt - DUE_MARGIN_SEC) return "repay";
  return "wait";
}

/** Contract LoanStatus enum (0 Open, 1 Repaid, 2 Defaulted) → HouseLoan status. */
export function loanStatus(code: number): HouseLoan["status"] {
  return code === 0 ? "open" : code === 1 ? "repaid" : "defaulted";
}
