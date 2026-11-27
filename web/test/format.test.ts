import { describe, expect, it } from "vitest";
import { formatUsdc, formatUsdcExact, shortAddr } from "../lib/format";

describe("format", () => {
  it("formats USDC with 6 decimals", () => {
    expect(formatUsdc(1667n)).toBe("$0.00");
    expect(formatUsdc(1_000_000_000n)).toBe("$1,000.00");
    expect(formatUsdc(1_234_560_000n)).toBe("$1,234.56");
  });
  it("formats exact USDC for fees (no rounding to $0.00)", () => {
    expect(formatUsdcExact(1667n)).toBe("$0.001667");
    expect(formatUsdcExact(3334n)).toBe("$0.003334");
    expect(formatUsdcExact(5_000_000n)).toBe("$5.00");
    expect(formatUsdcExact(5_100_000n)).toBe("$5.10");
    expect(formatUsdcExact(1_234_567_891n)).toBe("$1,234.567891");
    expect(formatUsdcExact(0n)).toBe("$0.00");
  });
  it("shortens addresses", () => {
    expect(shortAddr("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});
