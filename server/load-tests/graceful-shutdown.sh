#!/bin/bash
# Start server, hammer it with requests, send SIGTERM, verify clean shutdown
set -e

echo "=== Graceful Shutdown Verification ==="
echo "1. Starting server..."
npm run start &
SERVER_PID=$!

echo "2. Waiting for server to be ready..."
for i in {1..30}; do
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    echo "   Server ready"
    break
  fi
  sleep 1
done

echo "3. Starting load (background)..."
artillery quick --count 100 --num 10 http://localhost:3000/health &
ARTILLERY_PID=$!

echo "4. Sending SIGTERM after 5s..."
sleep 5
kill -TERM $SERVER_PID

echo "5. Waiting for server to exit..."
wait $SERVER_PID
EXIT_CODE=$?

kill $ARTILLERY_PID 2>/dev/null || true

if [ $EXIT_CODE -eq 0 ]; then
  echo "✓ Graceful shutdown succeeded (exit 0)"
else
  echo "✗ Shutdown failed (exit $EXIT_CODE)"
  exit 1
fi
