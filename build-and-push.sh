#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== GAUSSIAN ROOM RECONSTRUCTION - BUILD & PUSH ===${NC}"
echo ""

# Configuration
DOCKER_USERNAME="interactdevops"
IMAGE_NAME="gaussian-room-reconstruction"
TAG="latest"
FULL_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}:${TAG}"

# Check Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker is running${NC}"

# Clean up any previous builds
echo -e "${BLUE}Cleaning up previous build artifacts...${NC}"
docker buildx ls | grep gsbuilder > /dev/null 2>&1 && docker buildx rm gsbuilder || true

# Create new builder
echo -e "${BLUE}Creating fresh buildx builder...${NC}"
docker buildx create --name gsbuilder --driver docker-container --use

echo ""
echo -e "${GREEN}=== STARTING DOCKER BUILD ===${NC}"
echo -e "Image: ${FULL_IMAGE}"
echo -e "Platform: linux/amd64 (RunPod RTX 4090)"
echo ""

# Build for linux/amd64 (RunPod platform)
docker buildx build \
    --platform linux/amd64 \
    -t ${FULL_IMAGE} \
    --load \
    . 2>&1 | tee /tmp/docker-build.log

if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ BUILD SUCCESSFUL${NC}"
    echo ""
    
    # Ask for push confirmation
    echo -e "${BLUE}Ready to push to Docker Hub?${NC}"
    echo -e "Image: ${FULL_IMAGE}"
    read -p "Push now? (y/n): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        echo -e "${GREEN}=== PUSHING TO DOCKER HUB ===${NC}"
        
        # Login check
        if ! docker info | grep Username > /dev/null 2>&1; then
            echo -e "${BLUE}Not logged in to Docker Hub. Logging in...${NC}"
            docker login
        fi
        
        # Push
        docker push ${FULL_IMAGE} 2>&1 | tee /tmp/docker-push.log
        
        if [ ${PIPESTATUS[0]} -eq 0 ]; then
            echo ""
            echo -e "${GREEN}✅ PUSH SUCCESSFUL${NC}"
            echo ""
            echo -e "${GREEN}=== DEPLOYMENT READY ===${NC}"
            echo ""
            echo -e "Docker Image: ${FULL_IMAGE}"
            echo ""
            echo -e "${BLUE}RunPod Pod Settings:${NC}"
            echo -e "  Container Image: ${FULL_IMAGE}"
            echo -e "  Container Disk: 20 GB"
            echo -e "  Volume Disk: 50 GB"
            echo -e "  Volume Mount: /app/storage"
            echo -e "  HTTP Port: 8000"
            echo -e "  TCP Port: 22"
            echo ""
        else
            echo -e "${RED}❌ PUSH FAILED - Check /tmp/docker-push.log${NC}"
            exit 1
        fi
    else
        echo ""
        echo -e "${BLUE}Push cancelled. Image built locally: ${FULL_IMAGE}${NC}"
        echo -e "To push later, run: docker push ${FULL_IMAGE}"
    fi
else
    echo ""
    echo -e "${RED}❌ BUILD FAILED - Check /tmp/docker-build.log${NC}"
    echo ""
    echo -e "${RED}Last 50 lines of build log:${NC}"
    tail -50 /tmp/docker-build.log
    exit 1
fi

echo ""
echo -e "${GREEN}=== DONE ===${NC}"
