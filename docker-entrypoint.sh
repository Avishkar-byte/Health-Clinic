#!/bin/bash
# Runs both the worker and the API in one container. If either process
# exits for any reason (crash, or a fatal config error — e.g. the worker
# exits(1) on a malformed REDIS_URL), stop the whole container instead of
# silently continuing half-dead, and forward termination signals to both
# children so Render's restarts/redeploys shut down cleanly.
set -u

node apps/worker/dist/main.js &
worker_pid=$!
node apps/api/dist/main.js &
api_pid=$!

trap 'kill -TERM "$worker_pid" "$api_pid" 2>/dev/null' TERM INT

wait -n "$worker_pid" "$api_pid"
exit_code=$?

echo "[entrypoint] a process exited with code $exit_code — stopping container"
kill -TERM "$worker_pid" "$api_pid" 2>/dev/null

exit "$exit_code"
