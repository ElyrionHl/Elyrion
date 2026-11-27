/** Human-readable messages for wallet / transaction errors (viem + wagmi). Pure. */

export const MSG_NO_WALLET =
  "No browser wallet found. Install a wallet such as MetaMask or Rabby, then reload this page.";
export const MSG_WRONG_CHAIN = "Your wallet is on another network. Switch to Elysium (chain 99901) and try again.";
export const MSG_REJECTED = "You rejected the request in your wallet. Nothing was sent.";
export const MSG_NOT_CONFIGURED = "Contracts not deployed yet.";

/** Contract custom errors (ElyrionIdentity / ElyrionPool / USDC) mapped to sentences. */
const BASE_REVERTS: Record<string, string> = {
  NotAgentOwner: "Only the agent's owner can do this. Connect the wallet that owns the agent.",
  AgentDefaulted: "This agent has defaulted. Its line cannot be requested again.",
  LineActive: "This agent already has an open line.",
  BadAmount: "That line amount is not allowed.",
  Paused: "The pool is paused right now. Try again later.",
  ERC721NonexistentToken: "That agent does not exist.",
  CapExceeded: "That deposit would pass the pool's caps ($1,000 per wallet, $10,000 total).",
  InsufficientLiquidity: "Not enough idle USDC in the pool right now; some is lent out. Try a smaller amount or wait for repayments.",
  NoPendingRequest: "This agent has no pending line request any more.",
  NotBacker: "Only this line's backer or the agent's owner can close it.",
  NoLine: "This agent has no open line.",
  OpenLoan: "This agent has an open loan. The line can be closed after it is repaid.",
  ERC20InsufficientBalance: "Not enough USDC in this wallet.",
  ERC20InsufficientAllowance: "The USDC approval is too low for this amount. Approve again and retry.",
};

interface ErrLike {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  errorName?: unknown;
  data?: unknown;
  cause?: unknown;
}

/** The error and its `cause` chain (bounded). */
function chain(err: unknown): ErrLike[] {
  const out: ErrLike[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 8 && cur && typeof cur === "object"; i++) {
    out.push(cur as ErrLike);
    cur = (cur as ErrLike).cause;
  }
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Maps an error thrown by connect / switchChain / writeContract / waitForTransactionReceipt to a sentence.
 * `overrides` replaces the sentence for specific contract errors (e.g. BadAmount on the lend page).
 */
export function humanizeError(err: unknown, overrides: Record<string, string> = {}): string {
  const REVERTS = { ...BASE_REVERTS, ...overrides };
  const links = chain(err);
  for (const e of links) {
    const name = str(e.name);
    const text = `${str(e.shortMessage)} ${str(e.message)} ${str(e.details)}`;
    if (e.code === 4001 || name === "UserRejectedRequestError" || /user (rejected|denied)|rejected the request/i.test(text))
      return MSG_REJECTED;
    if (name === "ProviderNotFoundError" || name === "ConnectorNotFoundError" || /provider not found/i.test(text))
      return MSG_NO_WALLET;
    if (name === "ChainMismatchError" || name === "ConnectorChainMismatchError" || /does not match the target chain/i.test(text))
      return MSG_WRONG_CHAIN;
    const data = e.data as { errorName?: unknown } | undefined;
    const revert = str(e.errorName) || str(data?.errorName);
    if (revert && REVERTS[revert]) return REVERTS[revert];
  }
  for (const e of links) {
    const text = `${str(e.shortMessage)} ${str(e.message)}`;
    const m = Object.keys(REVERTS).find((k) => text.includes(k));
    if (m) return REVERTS[m];
    if (/insufficient funds/i.test(text)) return "Not enough HYPE in this wallet to pay for gas on Elysium.";
  }
  const first = links[0];
  const short = first ? str(first.shortMessage) || str(first.message).split("\n")[0] : "";
  return short ? `Transaction failed: ${short}` : "Something went wrong. Please try again.";
}
