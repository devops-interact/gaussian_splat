#!/bin/bash
# Build Docker image for Runpod RTX 4090 deployment

set -e

echo "Building Docker image for linux/amd64 (Runpod RTX 4090)..."

# Build for linux/amd64 platform
docker buildx build \
  --platform linux/amd64 \
  -t gaussian-room-reconstruction:latest \
  --load \
  .

echo ""
echo "✓ Docker image built successfully!"
echo ""
echo "Image: gaussian-room-reconstruction:latest"
echo ""
echo "To tag and push to a registry:"
echo "  docker tag gaussian-room-reconstruction:latest YOUR_REGISTRY/gaussian-room-reconstruction:latest"
echo "  docker push YOUR_REGISTRY/gaussian-room-reconstruction:latest"
