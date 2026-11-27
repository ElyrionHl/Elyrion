# @elyrion/mcp

MCP server for Elyrion (ERC-8004-compatible agent identity + USDC credit pool on Elysium, chain 99901). It lets an AI agent register itself, request a credit line, check its Ely Score, borrow and repay, over stdio.

> **Use a dedicated, low-balance wallet.** `ELYRION_AGENT_KEY` is the private key of the agent's own wallet and the server signs transactions with it. Never point it at a wallet that holds meaningful funds. The key is read from the environment only, is never logged and is never returned in tool output. The contracts are unaudited.

## Install (from the repository)

The server is **not published to npm**. Build it from a clone of the Elyrion repository (Node.js 20+ and pnpm 10):

```sh
git clone <Elyrion repository URL> elyrion
cd elyrion
pnpm install
pnpm --filter @elyrion/mcp build      # emits mcp/dist/server.js
```

Then add it to your MCP client config (Claude Desktop, Claude Code, Cursor, ...). Replace `<repo>` with the full path of the clone (on Windows use forward slashes, e.g. `C:/elyrion`):

```json
{
  "mcpServers": {
    "elyrion": {
      "command": "node",
      "args": ["<repo>/mcp/dist/server.js"],
      "env": {
        "ELYRION_AGENT_KEY": "<agent wallet private key>",
        "ELYRION_IDENTITY": "<identity registry address>",
        "ELYRION_POOL": "<credit pool address>",
        "ELYRION_FROM_BLOCK": "<deploy block>"
      }
    }
  }
}
```

The contract addresses and the deploy block are listed on the Elyrion website's Docs page.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `ELYRION_IDENTITY` | yes | Identity registry address. |
| `ELYRION_POOL` | yes | Credit pool address. |
| `ELYRION_AGENT_KEY` | write tools only | Private key of the agent's own wallet (`0x` + 64 hex). Read tools work without it. |
| `ELYRION_RPC_URL` | no | RPC endpoint. Default `https://rpc.elysium.kinetiq.xyz`. The server refuses an RPC that is not chain id 99901. |
| `ELYRION_FROM_BLOCK` | recommended | The contracts' deploy block. `get_loans` scans logs from here to the latest block in 10,000-block ranges. Default `0`, which makes the scan slow; a range of more than 2,000 requests is refused with a message asking for this variable. |

## Tools

| Tool | Arguments | Notes |
| --- | --- | --- |
| `register_agent` | `name` (2-64 chars), `description` (<=280), `endpoint` (`https://` or empty) | Same registration file as the website. Returns `agentId`. |
| `request_line` | `agentId`, `amountUsd` ($5-$50) | A lender must still back the request. |
| `check_score` | `agentId` | Ely Score and repayment history. Read-only. |
| `get_line` | `agentId` | Credit line, pending request, open loan. Read-only. |
| `get_loans` | `agentId` | Loans built from `Borrowed` / `Repaid` / `Defaulted` logs, scanned from `ELYRION_FROM_BLOCK` in 10,000-block ranges. Read-only. |
| `borrow` | `agentId`, `amountUsd` ($5-$50), `termDays` (1-7) | Summary shows principal, fee and due date. Fee = ceil(amount x 1% x term / 30 days), e.g. $5 for 1 day = 0.001667 USDC. |
| `repay` | `loanId` | Approves exactly principal + fee to the pool if the allowance is short, then repays. |

Write tools return `{ txHash, explorerUrl, summary }`. Failures are returned as MCP tool errors with a short readable message.

## Development

```sh
pnpm --filter @elyrion/mcp abi        # regenerate src/abi from contracts/out (needs forge build)
pnpm --filter @elyrion/mcp test       # vitest, mocked viem client, no network
pnpm --filter @elyrion/mcp typecheck
pnpm --filter @elyrion/mcp build      # emits dist/server.js (the elyrion-mcp bin)
```

## Publishing (later, optional)

The package is not on npm. Before it is ever published, claim the `@elyrion` npm scope first, so nobody else can
publish a package under that name; until then, install only from the repository as above. `package.json` is
marked `"private": true` so it cannot be published by accident; remove that flag only after the scope is claimed.

