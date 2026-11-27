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
