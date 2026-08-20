#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

TARGET="${1:-api}"

echo "=== AI Room Reconstruction — Railway build (${TARGET}) ==="

if ! docker info > /dev/null 2>&1; then
  echo "Docker is not running"
  exit 1
fi

echo "Running frontend tests..."
(cd frontend && npm test -- --run)

if [[ "$TARGET" == "frontend" || "$TARGET" == "web" || "$TARGET" == "--frontend" ]]; then
  echo "Building frontend image (nginx + SPA)..."
  docker build -f Dockerfile.frontend.railway -t ai-room-web:latest .
  echo "Done. Deploy web service with BACKEND_URL set to your API URL."
elif [[ "$TARGET" == "api" || "$TARGET" == "--api" || "$TARGET" == "" ]]; then
  echo "Building API image..."
  docker build -f Dockerfile.railway -t ai-room-api:latest .
  echo "Done. Deploy api service with MESHY_API_KEY and volume mounted."
else
  echo "Usage: ./build-and-push.sh [api|frontend]"
  exit 1
fi
