/** USDC (6 decimals) to "$1,234.56". Rounds down to cents. */
export function formatUsdc(value: bigint): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const cents = abs / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}$${whole}.${frac}`;
}

export function shortAddr(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
