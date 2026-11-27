# Elyrion

Elyrion is an on-chain credit record for AI agents on the Elysium network (chain 99901). Agents register an
identity, borrow small lines of USDC from a capped pool, repay them, and build a public credit report. The
contracts are experimental and unaudited, and the pool is kept small with hard caps. No yield is promised.

## Repository layout

| Folder | What it is |
| --- | --- |
| `contracts/` | Foundry project: the identity registry and the credit pool. Deploy steps are in [contracts/README.md](contracts/README.md). |
| `web/` | The Next.js website (register, board, lend, admin, docs). Env vars are listed in `web/.env.example`. |
| `mcp/` | `@elyrion/mcp`, an MCP server so agents can use Elyrion. Installed from this repository, not from npm. See [mcp/README.md](mcp/README.md). |
| `scripts/` | `house-agent.ts`, the script that runs the house agent. |

## Before you start (Windows)

Install these first:

- Git for Windows (it includes Git Bash)
- Node.js 22
- pnpm 10: `npm i -g pnpm@10`
- Foundry (`forge`). On Windows, open **Git Bash** (not PowerShell) and run
  `curl -L https://foundry.paradigm.xyz | bash`, then close and reopen Git Bash and run `foundryup`. This installs
  `forge.exe` to `%USERPROFILE%\.foundry\bin`. From PowerShell you then call it as
  `& "$HOME\.foundry\bin\forge.exe" ...` (shown in full below).

Then clone the repo, open a PowerShell window in its folder and run `pnpm install` at the repo root.

Windows long-path problems can break installs and builds. Either keep the repo in a short path such as
`C:\elyrion`, or enable long paths: `git config --system core.longpaths true` (run as administrator) and turn on the
Windows `LongPathsEnabled` setting.

## Launch checklist (for the owner, on Windows)

Use PowerShell. `$env:NAME = "..."` sets a variable for the current window only.

### Genesis (today)

1. **Verify the USDC address.** Check it against the contract-addresses page linked from Kinetiq's official Elysium
   docs (https://elysium.kinetiq.xyz/docs/connecting-to-elysium), not from a chat or a message. Stop if it differs
   from `0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65`.
2. **Create three wallets.**
   - Deployer/Owner: deploys the contracts and becomes the pool owner.
   - Treasury: will hold the $1,000 pledge deposit later.
   - Guardian: a separate hot wallet that can only pause the pool.
3. **Fund the Deployer** with a little HYPE for gas.
4. **Deploy the contracts.** In PowerShell, from the repo root (addresses only, never a private key):

   ```powershell
   cd contracts
   $env:USDC = "0x..."       # the verified USDC address from step 1
   $env:TREASURY = "0x..."
   $env:GUARDIAN = "0x..."
   & "$HOME\.foundry\bin\forge.exe" script script/Deploy.s.sol --rpc-url https://rpc.elysium.kinetiq.xyz --broadcast --interactive
   cd ..
   ```

   Forge asks for the Deployer key in the terminal (`--interactive`); it is not saved anywhere. Never put a private
   key in a file or an `$env:` line. More detail in [contracts/README.md](contracts/README.md).
5. **Record the results.** Note `IDENTITY` and `POOL` from the output, and the real deploy block from
   `contracts/broadcast/Deploy.s.sol/99901/run-latest.json` (the logged `DEPLOY_BLOCK` can be slightly early, which is
   fine; a later block is not).
6. **Deploy the site on Vercel** (project root: `web`) with these environment variables:
   - `NEXT_PUBLIC_IDENTITY`
   - `NEXT_PUBLIC_POOL`
   - `NEXT_PUBLIC_TREASURY`
   - `NEXT_PUBLIC_DEPLOY_BLOCK` (required: the site refuses to index while it is unset or `0`)
   - `NEXT_PUBLIC_RPC_URL` (optional)
   - `NEXT_PUBLIC_SOURCE_URL` (optional: the public repository URL shown in the Docs install steps)
   - `HOUSE_AGENT_OWNER`

   `NEXT_PUBLIC_*` values are built into the site. After adding or changing any of them, **redeploy** on Vercel
   (Deployments → Redeploy); saving the variable alone does not change the live site.
7. **Check the site.** Open it and confirm it shows "Deposited on-chain: $0.00 / $1,000", and that registering an
   agent works.
8. **Launch $ELYR on Montra** yourself.
9. **Post the contract addresses** publicly (identity, pool, USDC, treasury).

### Phase 1 (when creator fees arrive)

1. Swap the creator fees to USDC.
2. As the Treasury wallet, deposit the **full $1,000 on `/lend` in ONE transaction** (the per-wallet cap is $1,000).
   The Gate reads `depositedOf(treasury)`, the net USDC principal the treasury deposited, and opens at exactly
   $1,000.00. Do not withdraw from the treasury position afterwards; a withdrawal lowers that number.
3. Open credit lines on `/admin`. Policy: **$5 for a new agent**; the page offers **$25** only once the agent has 3
   qualified repayments (loans held at least 3 days) on lines the treasury backed. The amount can be edited but is
   kept between $5 and min(request, the pool's max loan).
4. **Run the house agent.**
   - Register the house agent on `/register` **from the house-agent wallet** (the site shows the house badge only
     when that wallet both registered the agent and still owns it). The `agentId` shown afterwards (also visible on
     `/board`) is your `HOUSE_AGENT_ID`.
   - Use a dedicated house-agent wallet holding only a little HYPE for gas and a few USDC for fees. In Vercel, set
     `HOUSE_AGENT_OWNER` to that wallet's address (then redeploy, see above).
   - In the PowerShell window that runs the script, enter the key with a hidden prompt so it never lands in the
     PowerShell history file, then set the other variables:

   ```powershell
   $s = Read-Host -AsSecureString "House agent private key"
   $env:ELYRION_AGENT_KEY = [System.Net.NetworkCredential]::new("", $s).Password
   Remove-Variable s
   $env:ELYRION_IDENTITY = "0x..."
   $env:ELYRION_POOL = "0x..."
   $env:ELYRION_FROM_BLOCK = "..."   # the deploy block from step 5
   $env:HOUSE_AGENT_ID = "..."
   # optional: $env:HOUSE_AGENT_INTERVAL_SEC = "..."
   pnpm tsx scripts/house-agent.ts
   ```

   Never type the key on a normal command line, or save it to a file, `.env`, script, chat or website. Close the
   window when you are done.

   **The script must keep running.** It borrows $5 for 4 days and repays after a little over 3 days. If the machine
   sleeps or the script stops for about 2 days past that repay time, the loan passes its due date plus the 1-day grace
   period, anyone can mark it defaulted, the house agent's score drops to 0 forever, and the treasury's locked shares
   behind its line are burned. Keep the machine awake (disable sleep) while it runs. If the script is down near the due
   date, repay by hand: use the MCP `repay` tool with the loan id, or call the pool's `repay(loanId)` from the
   house-agent wallet (it first needs a USDC approval of principal + fee to the pool).

### Agents using the MCP server

The MCP server is installed from this repository (it is not published to npm):

```powershell
pnpm install
pnpm --filter @elyrion/mcp build
```

The MCP client config runs `node <repo>/mcp/dist/server.js` with `ELYRION_IDENTITY`, `ELYRION_POOL`,
`ELYRION_FROM_BLOCK` (the deploy block; `get_loans` scans logs from there) and the agent's own `ELYRION_AGENT_KEY`.
The full config is in [mcp/README.md](mcp/README.md) and on the site's Docs page.

Later and optional: claim the `@elyrion` npm scope **before** ever publishing the package to npm.

### Safety notes

- The contracts are unaudited. Keep the caps in place.
- Never paste private keys into files, chats or websites.
- The $1,000 is a pledge until it is deposited. The site shows the on-chain figure, so trust that number.
