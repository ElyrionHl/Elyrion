# Elyrion

Elyrion is an on-chain credit record for AI agents on the Elysium network (chain 99901). Agents register an
identity, borrow small lines of USDC from a capped pool, repay them, and build a public credit report. The
contracts are experimental and unaudited, and the pool is kept small with hard caps. No yield is promised.

## Repository layout

| Folder | What it is |
| --- | --- |
| `contracts/` | Foundry project: the identity registry and the credit pool. Deploy steps are in [contracts/README.md](contracts/README.md). |
| `web/` | The Next.js website (register, board, lend, admin, docs). Env vars are listed in `web/.env.example`. |
| `mcp/` | `@elyrion/mcp`, an MCP server so agents can use Elyrion. See [mcp/README.md](mcp/README.md). |
| `scripts/` | `house-agent.ts`, the script that runs the house agent. |

## Before you start (Windows)

Install these first:

- Git
- Node.js 22
- pnpm 10: `npm i -g pnpm@10`
- Foundry (`forge`): install it with `foundryup`

Then clone the repo, open a PowerShell window in its folder and run `pnpm install` at the repo root.

Windows long-path problems can break installs and builds. Either keep the repo in a short path such as
`C:\elyrion`, or enable long paths: `git config --system core.longpaths true` (run as administrator) and turn on the
Windows `LongPathsEnabled` setting.

## Launch checklist (for the owner, on Windows)

Use PowerShell. Set environment variables like this, for the current window only:

```powershell
$env:USDC = "0x..."
$env:TREASURY = "0x..."
$env:GUARDIAN = "0x..."
```

### Genesis (today)

1. **Verify the USDC address.** Check it against the contract-addresses page linked from Kinetiq's official Elysium
   docs (https://elysium.kinetiq.xyz/docs/connecting-to-elysium), not from a chat or a message. Stop if it differs
   from `0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65`.
2. **Create three wallets.**
   - Deployer/Owner: deploys the contracts and becomes the pool owner.
   - Treasury: will hold the $1,000 pledge deposit later.
   - Guardian: a separate hot wallet that can only pause the pool.
3. **Fund the Deployer** with a little HYPE for gas.
4. **Deploy the contracts.** Follow [contracts/README.md](contracts/README.md). Set `$env:USDC`, `$env:TREASURY`
   and `$env:GUARDIAN` to addresses only, then run `forge script ... --broadcast --interactive`. Forge asks for the
   Deployer key in the terminal. Never put a private key in a file.
5. **Record the results.** Note `IDENTITY` and `POOL` from the output, and the real deploy block from
   `contracts/broadcast/Deploy.s.sol/99901/run-latest.json` (the logged `DEPLOY_BLOCK` can be slightly early).
6. **Deploy the site on Vercel** (project root: `web`) with these environment variables:
   - `NEXT_PUBLIC_IDENTITY`
   - `NEXT_PUBLIC_POOL`
   - `NEXT_PUBLIC_TREASURY`
   - `NEXT_PUBLIC_DEPLOY_BLOCK`
   - `NEXT_PUBLIC_RPC_URL` (optional)
   - `HOUSE_AGENT_OWNER`
7. **Check the site.** Open it and confirm it shows "Deposited on-chain: $0.00 / $1,000", and that registering an
   agent works.
8. **Launch $ELYR on Montra** yourself.
9. **Post the contract addresses** publicly (identity, pool, USDC, treasury).

### Phase 1 (when creator fees arrive)

1. Swap the creator fees to USDC.
2. As the Treasury wallet, deposit on `/lend` (maximum $1,000 per wallet).
3. Open credit lines on `/admin`.
4. **Run the house agent.**
   - Register the house agent on `/register`. The `agentId` shown afterwards (also visible on `/board`) is your
     `HOUSE_AGENT_ID`.
   - Use a dedicated house-agent wallet holding only a little HYPE for gas and a few USDC for fees. In Vercel, set
     `HOUSE_AGENT_OWNER` to that wallet's address.
   - In the PowerShell window that runs the script, set the variables below. Type the key at run time. Never save it
     to a file, `.env`, script, chat or website, and close the window when you are done.

   ```powershell
   $env:ELYRION_AGENT_KEY = "..."   # typed here only, never saved anywhere
   $env:ELYRION_IDENTITY = "0x..."
   $env:ELYRION_POOL = "0x..."
   $env:HOUSE_AGENT_ID = "..."
   # optional: $env:HOUSE_AGENT_INTERVAL_SEC = "..."
   pnpm tsx scripts/house-agent.ts
   ```

### Safety notes

- The contracts are unaudited. Keep the caps in place.
- Never paste private keys into files, chats or websites.
- The $1,000 is a pledge until it is deposited. The site shows the on-chain figure, so trust that number.
