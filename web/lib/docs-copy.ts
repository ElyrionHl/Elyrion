/** Fixed Docs copy (verbatim from the copy rules; tested). */

export const SCORE_ROWS = [
  "Dollar-days — 1 point per $1-day held, max 400",
  "Qualified loans — 25 points per repaid loan held ≥ 3 days, max 250",
  "Backing — 3 points per $1 of active line, max 150",
  "Age — 5 points per day since first repayment, max 200",
] as const;

export const DEFAULT_RULE = "A default sets the score to 0 permanently.";

export const BACKER_NOTE =
  "A line follows the agent NFT: if the agent is transferred, the new owner can borrow against it until the backer closes the line.";

export const PRIORS_CREDIT = "Score design adapted from Priors (MIT).";

export const MCP_PACKAGE = "@elyrion/mcp";

export const MCP_ENV = ["ELYRION_AGENT_KEY", "ELYRION_IDENTITY", "ELYRION_POOL", "ELYRION_FROM_BLOCK"] as const;

/** The MCP server is installed from the repository (it is not published to npm). */
export const MCP_SERVER_PATH = "<repo>/mcp/dist/server.js";

/** Shell steps to build the MCP server from a clone. */
export function mcpInstallSteps(repoUrl?: string): string {
  return [
    `git clone ${repoUrl || "<Elyrion repository URL>"} elyrion`,
    "cd elyrion",
    "pnpm install",
    "pnpm --filter @elyrion/mcp build",
  ].join("\n");
}

/** MCP client config: node runs the built server from the clone. */
export function mcpConfig(o: { identity?: string; pool?: string; deployBlock?: bigint }) {
  return {
    mcpServers: {
      elyrion: {
        command: "node",
        args: [MCP_SERVER_PATH],
        env: {
          ELYRION_AGENT_KEY: "<agent wallet private key>",
          ELYRION_IDENTITY: o.identity ?? "<identity registry address>",
          ELYRION_POOL: o.pool ?? "<credit pool address>",
          ELYRION_FROM_BLOCK: o.deployBlock && o.deployBlock > 0n ? o.deployBlock.toString() : "<deploy block>",
        },
      },
    },
  };
}

export const SELF_BACKED_NOTE =
  "The score counts repayments on any line, including lines an agent backs itself — check `backer`/`selfBacked`.";

export const MCP_TOOLS = [
  "register_agent",
  "request_line",
  "check_score",
  "get_line",
  "get_loans",
  "borrow",
  "repay",
] as const;

/* ------------------------------------------------------------------
   Pre-Score (activity-based, any Elysium address). Formulas verbatim from the spec.
   ------------------------------------------------------------------ */

export const PRESCORE_PARTS = [
  {
    part: "Longevity",
    max: 300,
    formula: "300 × min(1, ageDays / 30)",
    note: "ageDays = now − first tx (Elysium mainnet launched 2026-11-09, so 30 days is a full score)",
    plain: "How long the address has been on Elysium. Thirty days is a full score.",
  },
  {
    part: "Activity",
    max: 300,
    formula: "300 × min(1, log10(1 + txCount) / log10(1 + 500))",
    note: "",
    plain: "How many successful transactions it has sent, on a log scale that fills at 500.",
  },
  {
    part: "Consistency",
    max: 200,
    formula: "200 × min(1, activeDays / 14)",
    note: "distinct UTC days with ≥1 tx among fetched txs",
    plain: "On how many different days it showed up. Fourteen days is a full score.",
  },
  {
    part: "Breadth",
    max: 200,
    formula: "200 × min(1, (distinctTokens + distinctContracts) / 15)",
    note: "distinctContracts = distinct addresses it has sent transactions to (wallets included)",
    plain: "How widely it reaches: distinct tokens in its transfers plus distinct addresses it has sent transactions to.",
  },
] as const;

export const PRESCORE_COUNTING_RULE = [
  'Only successful transactions (isError = "0") sent by the address (from = address) count, taken from the latest 1,000 fetched.',
  'activeDays and distinctContracts (the distinct addresses those transactions were sent to, wallets included, excluding self-sends) come from the same set.',
  'When the explorer returns a full window of 1,000 transactions, older ones are not read: txCount, activeDays and the destination count are then lower bounds, shown with a "+" (for example "640+", or "1,000+" at the cap), and the Burst, Focused and Quiet traits are not given. The same holds for distinctTokens when 1,000 token transfers are returned.',
  "distinctTokens is the number of distinct token contracts in the latest 1,000 token transfers involving the address.",
  "ageDays counts from the address's first transaction of any kind. Each part is rounded down; the total is their sum. No history scores 0.",
] as const;

export const PRESCORE_TIERS = [
  ["Wanderer", "0–199"],
  ["Initiate", "200–399"],
  ["Worthy", "400–599"],
  ["Hero", "600–799"],
  ["Immortal", "800–1000"],
] as const;

export const PRESCORE_INTRO =
  "Pre-Score reads any Elysium address from its public activity on the Elysium explorer and scores it from 0 to 1000. It is a first impression, not a credit score: the agent credit score above is earned on-chain by borrowing and repaying.";
