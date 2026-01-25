#!/bin/bash
# Check Docker build status and push when ready

set -e

DOCKER_USERNAME="${1:-}"
if [ -z "$DOCKER_USERNAME" ]; then
    echo "Usage: ./check-and-push.sh YOUR_DOCKER_USERNAME"
    echo "Example: ./check-and-push.sh myusername"
    exit 1
fi

IMAGE_NAME="gaussian-room-reconstruction"
TAG="latest"
LOCAL_IMAGE="${IMAGE_NAME}:${TAG}"
REMOTE_IMAGE="docker.io/${DOCKER_USERNAME}/${IMAGE_NAME}:${TAG}"

echo "Checking if image is built..."
if docker images | grep -q "${IMAGE_NAME}"; then
    echo "✓ Image found locally!"
    
    echo ""
    echo "Tagging image for Docker Hub..."
    docker tag "${LOCAL_IMAGE}" "${REMOTE_IMAGE}"
    
    echo "Logging into Docker Hub..."
    docker login
    
    echo "Pushing to Docker Hub..."
    docker push "${REMOTE_IMAGE}"
    
    echo ""
    echo "=========================================="
    echo "✓ Image pushed successfully!"
    echo "=========================================="
    echo ""
    echo "Your Runpod Image URL:"
    echo "  ${REMOTE_IMAGE}"
    echo ""
    echo "Use this in Runpod:"
    echo "  - Container Image: ${REMOTE_IMAGE}"
    echo "  - GPU Type: RTX_4090"
    echo "  - Container Disk: 50GB+"
    echo "  - Port: 8000 (Public)"
    echo ""
else
    echo "Image not found. Build is still in progress or failed."
    echo "Check build status with: docker buildx ls"
    exit 1
fi
