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

export const MCP_ENV = ["ELYRION_AGENT_KEY", "ELYRION_IDENTITY", "ELYRION_POOL"] as const;

export const MCP_TOOLS = [
  "register_agent",
  "request_line",
  "check_score",
  "get_line",
  "get_loans",
  "borrow",
  "repay",
] as const;
