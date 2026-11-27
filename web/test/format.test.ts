import { describe, expect, it } from "vitest";
import { formatUsdc, shortAddr } from "../lib/format";

describe("format", () => {
  it("formats USDC with 6 decimals", () => {
    expect(formatUsdc(1667n)).toBe("$0.00");
    expect(formatUsdc(1_000_000_000n)).toBe("$1,000.00");
    expect(formatUsdc(1_234_560_000n)).toBe("$1,234.56");
  });
  it("shortens addresses", () => {
    expect(shortAddr("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});
