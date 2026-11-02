#!/usr/bin/env bash
# Full restart of the brain: kills whatever holds ports 3000 (frontend) and
# 3001 (API), then starts both detached so they outlive the terminal.
# Always runs the main checkout, since that's what the ai-brain MCP server uses.
# Usage: npm run restart   (or ./scripts/restart.sh from anywhere in the repo)
set -euo pipefail

MAIN=$(git -C "$(dirname "$0")" worktree list | head -1 | awk '{print $1}')
LOGS=~/Library/Logs
cd "$MAIN"

for port in 3000 3001; do
  for pid in $(lsof -tiTCP:$port -sTCP:LISTEN || true); do
    # The API runs under a `node --watch` parent, which would restart it - stop that too
    parent=$(ps -o ppid= -p "$pid" | tr -d ' ')
    if ps -o command= -p "$parent" | grep -q -- "--watch"; then kill "$parent" 2>/dev/null || true; fi
    kill "$pid" 2>/dev/null || true
  done
done
# Leftover watchers from earlier restarts have no server under them; worktree APIs do, so they're kept
for pid in $(pgrep -f "node --watch server/index.js" || true); do
  if ! pgrep -P "$pid" > /dev/null; then kill "$pid" 2>/dev/null || true; fi
done
sleep 1

nohup npm run dev:server > "$LOGS/neuroverse-server.log" 2>&1 < /dev/null & disown
nohup npm run dev:client > "$LOGS/neuroverse-client.log" 2>&1 < /dev/null & disown

wait_for() {
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null "$2"; then echo "✓ $1 up ($2)"; return; fi
    sleep 0.5
  done
  echo "✗ $1 didn't start - see $3"
  exit 1
}
wait_for "API" http://localhost:3001/api/tabs "$LOGS/neuroverse-server.log"
wait_for "Frontend" http://localhost:3000 "$LOGS/neuroverse-client.log"
