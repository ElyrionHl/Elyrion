#!/usr/bin/env bash
# Local end-to-end smoke test on anvil. LOCAL ONLY: uses anvil's public dev key #0.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/.."

PORT=8546
RPC="http://127.0.0.1:$PORT"
# Anvil's well-known dev account #0 (public; never holds real funds).
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ME=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

anvil --port "$PORT" --silent >/dev/null 2>&1 &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do cast block-number --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done

send() { cast send --rpc-url "$RPC" --private-key "$PK" "$@" >/dev/null; }
call() { cast call --rpc-url "$RPC" "$@"; }
num()  { awk '{print $1}'; }

echo "== deploy MockUSDC"
USDC=$(forge create test/mocks/MockUSDC.sol:MockUSDC --rpc-url "$RPC" --private-key "$PK" --broadcast 2>/dev/null \
  | awk '/Deployed to:/ {print $3}')
echo "USDC=$USDC"

echo "== run Deploy.s.sol"
OUT=$(USDC=$USDC TREASURY=$ME GUARDIAN=$ME forge script script/Deploy.s.sol --rpc-url "$RPC" --private-key "$PK" --broadcast 2>/dev/null)
echo "$OUT" | grep -E '^\s*(IDENTITY|POOL|OWNER|DEPLOY_BLOCK)='
IDENTITY=$(echo "$OUT" | sed -n 's/^ *IDENTITY=//p')
POOL=$(echo "$OUT" | sed -n 's/^ *POOL=//p')
[ -n "$IDENTITY" ] && [ -n "$POOL" ] || { echo "FAIL: deploy addresses missing"; exit 1; }

echo "== register / requestLine / deposit / openLine / borrow"
send "$USDC" "mint(address,uint256)" $ME 1000000000
send "$IDENTITY" "register(string)" "https://example.com/agent.json"
AGENT=1
send "$POOL" "requestLine(uint256,uint256)" $AGENT 20000000
send "$USDC" "approve(address,uint256)" "$POOL" 1000000000
send "$POOL" "deposit(uint256)" 100000000            # as treasury (same dev account)
send "$POOL" "openLine(uint256,uint256)" $AGENT 20000000
send "$POOL" "borrow(uint256,uint256,uint256)" $AGENT 10000000 172800

echo "== warp 2 days, repay"
cast rpc --rpc-url "$RPC" evm_increaseTime 172800 >/dev/null
cast rpc --rpc-url "$RPC" evm_mine >/dev/null
send "$POOL" "repay(uint256)" 1

echo "== creditReport($AGENT)"
REPORT=$(call "$POOL" "creditReport(uint256)(uint256,uint256,uint256,uint256,uint256,address,uint256,bool,uint256)" $AGENT)
echo "$REPORT"
SCORE=$(echo "$REPORT" | sed -n 1p | num)
STATUS=$(call "$POOL" "getLoan(uint256)((uint256,address,uint256,uint256,uint256,uint256,uint256,uint8))" 1 | tr -d '()' | awk -F', ' '{print $8}' | num)
echo "score=$SCORE loanStatus=$STATUS (1 = Repaid)"

[ "$SCORE" -gt 0 ] || { echo "FAIL: score not > 0"; exit 1; }
[ "$STATUS" = "1" ] || { echo "FAIL: loan not repaid"; exit 1; }
echo "SMOKE OK"
