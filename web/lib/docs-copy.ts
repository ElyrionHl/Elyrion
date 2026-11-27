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
