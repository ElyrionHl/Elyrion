import { describe, expect, it } from "vitest";
import { decideHouseAction, DUE_MARGIN_SEC, HOLD_SEC, loanStatus, type HouseLoan } from "./house-logic.js";

const DAY = 86_400;
const T0 = 1_800_000_000;
const open = (start = T0, term = 4 * DAY): HouseLoan => ({ status: "open", start, dueAt: start + term });

describe("decideHouseAction", () => {
  it("hold is exactly 3 days + 10 minutes", () => {
    expect(HOLD_SEC).toBe(3 * DAY + 600);
  });

  it("no loan → borrow", () => {
    expect(decideHouseAction(null, T0)).toBe("borrow");
  });

  it("repaid or defaulted latest loan → borrow", () => {
    expect(decideHouseAction({ ...open(), status: "repaid" }, T0 + DAY)).toBe("borrow");
    expect(decideHouseAction({ ...open(), status: "defaulted" }, T0 + 10 * DAY)).toBe("borrow");
  });

  it("open and just borrowed → wait", () => {
    expect(decideHouseAction(open(), T0)).toBe("wait");
    expect(decideHouseAction(open(), T0 + 3 * DAY)).toBe("wait");
  });

  it("boundary: 1 second short of 3d+10m waits, exactly 3d+10m repays", () => {
    expect(decideHouseAction(open(), T0 + HOLD_SEC - 1)).toBe("wait");
    expect(decideHouseAction(open(), T0 + HOLD_SEC)).toBe("repay");
    expect(decideHouseAction(open(), T0 + HOLD_SEC + 1)).toBe("repay");
  });

  it("the 3d+10m repay of a 4-day loan lands before it is due", () => {
    const l = open();
    expect(l.start + HOLD_SEC).toBeLessThan(l.dueAt - DUE_MARGIN_SEC);
  });

  it("overdue open loan → repay", () => {
    expect(decideHouseAction(open(), T0 + 5 * DAY)).toBe("repay");
  });

  it("short loan near its due date → repay before it can default", () => {
    const l = open(T0, 1 * DAY);
    expect(decideHouseAction(l, l.dueAt - DUE_MARGIN_SEC - 1)).toBe("wait");
    expect(decideHouseAction(l, l.dueAt - DUE_MARGIN_SEC)).toBe("repay");
  });
});

describe("loanStatus", () => {
  it("maps the contract enum", () => {
    expect([0, 1, 2].map(loanStatus)).toEqual(["open", "repaid", "defaulted"]);
  });
});
