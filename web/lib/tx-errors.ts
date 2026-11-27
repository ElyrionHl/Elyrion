/** Human-readable messages for wallet / transaction errors (viem + wagmi). Pure. */

export const MSG_NO_WALLET =
  "No browser wallet found. Install a wallet such as MetaMask or Rabby, then reload this page.";
export const MSG_WRONG_CHAIN = "Your wallet is on another network. Switch to Elysium (chain 99901) and try again.";
export const MSG_REJECTED = "You rejected the request in your wallet. Nothing was sent.";
export const MSG_NOT_CONFIGURED = "Contracts not deployed yet.";

/** Contract custom errors (ElyrionIdentity / ElyrionPool) a register or line request can hit. */
const REVERTS: Record<string, string> = {
  NotAgentOwner: "Only the agent's owner can do this. Connect the wallet that owns the agent.",
  AgentDefaulted: "This agent has defaulted. Its line cannot be requested again.",
  LineActive: "This agent already has an open line.",
  BadAmount: "That line amount is not allowed.",
  Paused: "The pool is paused right now. Try again later.",
  ERC721NonexistentToken: "That agent does not exist.",
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

/** Maps an error thrown by connect / switchChain / writeContract / waitForTransactionReceipt to a sentence. */
export function humanizeError(err: unknown): string {
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
