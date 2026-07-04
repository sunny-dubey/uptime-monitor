#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

docker compose up --build -d

echo ""
echo "Waiting for backend to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo ""
echo "Uptime Monitor is running:"
echo "  Frontend:    http://localhost:5173"
echo "  Backend API: http://localhost:8000  (docs at http://localhost:8000/docs)"
echo ""
echo "Logs:  docker compose logs -f"
echo "Stop:  docker compose down"
