#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== GAUSSIAN ROOM RECONSTRUCTION - BUILD & PUSH ===${NC}"
echo ""

# Configuration
DOCKER_USERNAME="interactdevops"
IMAGE_NAME="gaussian-room-reconstruction"
TAG="latest"
FULL_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}:${TAG}"
LOG_FILE="/tmp/docker-build-$(date +%Y%m%d-%H%M%S).log"

# Check Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker is running${NC}"

# ============================================
# STEP 1: PRUNE LOCAL DOCKER (ALWAYS!)
# ============================================
echo ""
echo -e "${YELLOW}=== STEP 1: PRUNING LOCAL DOCKER ===${NC}"
echo -e "Removing old images, build cache, and unused containers..."

# Remove specific old images if they exist
docker images | grep "${IMAGE_NAME}" && docker rmi -f $(docker images | grep "${IMAGE_NAME}" | awk '{print $3}') 2>/dev/null || echo "No old ${IMAGE_NAME} images to remove"

# Prune build cache
echo -e "${BLUE}Pruning build cache...${NC}"
docker builder prune -af 2>/dev/null || true

# Prune unused images
echo -e "${BLUE}Pruning unused images...${NC}"
docker image prune -f 2>/dev/null || true

# Prune dangling images
echo -e "${BLUE}Pruning dangling images...${NC}"
docker images -f "dangling=true" -q | xargs -r docker rmi -f 2>/dev/null || true

echo -e "${GREEN}✓ Docker pruned successfully${NC}"

# ============================================
# STEP 2: SETUP BUILDX
# ============================================
echo ""
echo -e "${YELLOW}=== STEP 2: SETTING UP BUILDX ===${NC}"

# Clean up any previous builder
docker buildx ls | grep gsbuilder > /dev/null 2>&1 && docker buildx rm gsbuilder 2>/dev/null || true

# Create new builder
echo -e "${BLUE}Creating fresh buildx builder...${NC}"
docker buildx create --name gsbuilder --driver docker-container --use

echo -e "${GREEN}✓ Buildx ready${NC}"

# ============================================
# STEP 3: CHECK DOCKER HUB LOGIN
# ============================================
echo ""
echo -e "${YELLOW}=== STEP 3: DOCKER HUB LOGIN ===${NC}"

if ! docker info 2>/dev/null | grep -q "Username"; then
    echo -e "${BLUE}Not logged in to Docker Hub. Please login:${NC}"
    docker login
fi

echo -e "${GREEN}✓ Docker Hub authenticated${NC}"

# ============================================
# STEP 4: BUILD AND PUSH DIRECTLY
# ============================================
echo ""
echo -e "${YELLOW}=== STEP 4: BUILD AND PUSH ===${NC}"
echo -e "Image: ${FULL_IMAGE}"
echo -e "Platform: linux/amd64 (RunPod RTX 4090)"
echo -e "Log file: ${LOG_FILE}"
echo ""
echo -e "${BLUE}This will build and push directly to Docker Hub (bypasses local storage issues)${NC}"
echo ""

# Build for linux/amd64 and push directly to Docker Hub
# Using --push avoids the "sending tarball" timeout issues
docker buildx build \
    --platform linux/amd64 \
    -t ${FULL_IMAGE} \
    --push \
    . 2>&1 | tee ${LOG_FILE}

if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ BUILD AND PUSH SUCCESSFUL${NC}"
    echo ""
    echo -e "${GREEN}=== DEPLOYMENT READY ===${NC}"
    echo ""
    echo -e "Docker Image: ${FULL_IMAGE}"
    echo -e "Build Log: ${LOG_FILE}"
    echo ""
    echo -e "${BLUE}RunPod Pod Settings:${NC}"
    echo -e "  ┌────────────────────┬──────────────────────────────────────────────┐"
    echo -e "  │ Container Image    │ ${FULL_IMAGE}              │"
    echo -e "  │ GPU Type           │ RTX 4090 (24GB VRAM)                         │"
    echo -e "  │ Container Disk     │ 20 GB                                        │"
    echo -e "  │ Volume Disk        │ 150 GB (frames + 3D models)                  │"
    echo -e "  │ Volume Mount Path  │ /app/storage                                 │"
    echo -e "  │ Expose HTTP Ports  │ 8000                                         │"
    echo -e "  │ Expose TCP Ports   │ 22                                           │"
    echo -e "  └────────────────────┴──────────────────────────────────────────────┘"
    echo ""
    echo -e "${GREEN}Next Steps:${NC}"
    echo -e "1. Go to RunPod.io → Pods → Deploy"
    echo -e "2. Use settings above"
    echo -e "3. Wait 2-3 min for pod startup"
    echo -e "4. Test: curl https://your-pod-8000.proxy.runpod.net/health"
    echo ""
else
    echo ""
    echo -e "${RED}❌ BUILD FAILED${NC}"
    echo ""
    echo -e "${RED}Last 50 lines of build log:${NC}"
    tail -50 ${LOG_FILE}
    echo ""
    echo -e "Full log: ${LOG_FILE}"
    exit 1
fi

echo -e "${GREEN}=== DONE ===${NC}"
