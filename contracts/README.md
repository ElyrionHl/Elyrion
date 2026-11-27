# Elyrion contracts

Run tests with `forge test` (Foundry 1.8.1).

## Known noise on Windows

A fresh `forge test` / `forge build` may print to stderr:

    error: file ../IERC721.sol not found
      --> \?\C:/.../contracts/lib/openzeppelin-contracts/contracts/token/ERC721/extensions/IERC721Metadata.sol

Cause: forge's built-in linter (solar parser) mishandles Windows `\?\` long-path prefixes
in deep checkout paths. `[lint] lint_on_build = false` and `ignore = ["lib/**"]` do not
suppress it. It is harmless: compilation succeeds, all tests run and the exit code is 0.
Cached re-runs are clean; `forge test 2>/dev/null` hides it.

## Deploying to Elysium mainnet (owner only)

Chain 99901, RPC `https://rpc.elysium.kinetiq.xyz`, explorer `https://elysium.kinetiq.xyz`, gas token HYPE.
The deployer wallet becomes the pool `owner`.

Checklist before you broadcast:

- [ ] Verify the USDC token address on Kinetiq's address page (`https://elysium.kinetiq.xyz`), not from a chat or message.
- [ ] Treasury = the wallet that will hold the $1,000 pledge deposit.
- [ ] Guardian = a separate hot wallet allowed only to pause.
- [ ] The deployer wallet holds enough HYPE for gas.
- [ ] Set `USDC`, `TREASURY`, `GUARDIAN` (addresses only) as environment variables in the window you deploy from.
- [ ] Never paste a private key into any file or env var. Sign with `--interactive` (prompts in your terminal) or `--account <keystore>`.

Windows PowerShell, from the repo root (`forge` is installed with `foundryup` from Git Bash, into
`%USERPROFILE%\.foundry\bin`):

```powershell
cd contracts
$env:USDC = "0x..."
$env:TREASURY = "0x..."
$env:GUARDIAN = "0x..."
& "$HOME\.foundry\bin\forge.exe" script script/Deploy.s.sol --rpc-url https://rpc.elysium.kinetiq.xyz --broadcast --interactive
```

(Or `--account <keystore-name>` with a key imported via `cast wallet import`.) The script reverts with a clear
message if `USDC`, `TREASURY` or `GUARDIAN` is missing or zero. `.env.example` lists the same three variables for
reference; the commands above do not read a `.env` file.

Afterwards:

- [ ] Save the logged `IDENTITY=`, `POOL=` and `DEPLOY_BLOCK=` values. `DEPLOY_BLOCK` is the block seen during
  simulation, so it is at or before the real deployment; the exact block is in
  `broadcast/Deploy.s.sol/99901/run-latest.json`. The web indexer needs it.
- [ ] Web reads `NEXT_PUBLIC_IDENTITY` / `NEXT_PUBLIC_POOL` / `NEXT_PUBLIC_DEPLOY_BLOCK`; the MCP server reads
  `ELYRION_IDENTITY` / `ELYRION_POOL` / `ELYRION_FROM_BLOCK`.
- [ ] The treasury wallet approves USDC to the pool and calls `deposit` for the full $1,000 pledge in ONE
  transaction. The site's Gate reads `depositedOf(treasury)` (net USDC principal deposited) and opens at $1,000.

## Local end-to-end smoke test

`bash script/smoke-local.sh` starts anvil, deploys MockUSDC and the contracts with anvil's public dev key #0
(local only), runs register, requestLine, deposit, openLine, borrow, a 2-day warp, repay and `creditReport`,
and exits non-zero unless the score is above 0 and the loan is repaid.
