#!/bin/bash
# Push Docker image to registry and get Runpod URL

set -e

# Configuration
REGISTRY="${DOCKER_REGISTRY:-docker.io}"  # Options: docker.io, ghcr.io, registry.runpod.io
USERNAME="${DOCKER_USERNAME:-}"
IMAGE_NAME="gaussian-room-reconstruction"
TAG="${IMAGE_TAG:-latest}"

if [ -z "$USERNAME" ]; then
    echo "Error: DOCKER_USERNAME not set"
    echo ""
    echo "Usage:"
    echo "  export DOCKER_REGISTRY=docker.io  # or ghcr.io"
    echo "  export DOCKER_USERNAME=your-username"
    echo "  ./push-docker-image.sh"
    echo ""
    exit 1
fi

FULL_IMAGE="${REGISTRY}/${USERNAME}/${IMAGE_NAME}:${TAG}"

echo "Building Docker image for linux/amd64..."
docker buildx build --platform linux/amd64 -t "${FULL_IMAGE}" --push .

echo ""
echo "✓ Image pushed successfully!"
echo ""
echo "=========================================="
echo "Runpod Configuration:"
echo "=========================================="
echo "Container Image: ${FULL_IMAGE}"
echo ""
echo "Runpod Settings:"
echo "  - GPU Type: RTX_4090"
echo "  - Container Image: ${FULL_IMAGE}"
echo "  - Container Disk: 50GB (minimum, recommend 100GB)"
echo "  - Port: 8000 (Public)"
echo "  - Environment Variables:"
echo "    - CUDA_VISIBLE_DEVICES=0"
echo "    - PYTHONUNBUFFERED=1"
echo ""
echo "=========================================="
