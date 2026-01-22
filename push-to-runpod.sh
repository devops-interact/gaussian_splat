#!/bin/bash
# Push Docker image to registry for Runpod deployment

set -e

# Configuration - UPDATE THESE VALUES
REGISTRY="${DOCKER_REGISTRY:-docker.io}"  # or ghcr.io, registry.runpod.io, etc.
USERNAME="${DOCKER_USERNAME:-your-username}"
IMAGE_NAME="gaussian-room-reconstruction"
TAG="${IMAGE_TAG:-latest}"

FULL_IMAGE="${REGISTRY}/${USERNAME}/${IMAGE_NAME}:${TAG}"

echo "Tagging image for registry..."
docker tag gaussian-room-reconstruction:latest "${FULL_IMAGE}"

echo "Pushing to registry..."
docker push "${FULL_IMAGE}"

echo ""
echo "✓ Image pushed successfully!"
echo ""
echo "Image URL: ${FULL_IMAGE}"
echo ""
echo "Use this image URL when creating your Runpod pod:"
echo "  ${FULL_IMAGE}"
echo ""
echo "Runpod Configuration:"
echo "  - GPU Type: RTX_4090"
echo "  - Container Image: ${FULL_IMAGE}"
echo "  - Container Disk: 50GB (minimum)"
echo "  - Port: 8000 (Public)"
echo "  - Environment Variables:"
echo "    - CUDA_VISIBLE_DEVICES=0"
echo "    - PYTHONUNBUFFERED=1"
