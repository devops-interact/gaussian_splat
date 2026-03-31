#!/bin/bash
set -e

# Ensure we run from project root (where Dockerfile lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Colors for output
PURPLE='\033[0;35m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m' 
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${PURPLE}=== GAUSSIAN ROOM RECONSTRUCTION - BUILD & PUSH ===${NC}"
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
# STEP 0: PRE-BUILD VALIDATION
# ============================================
echo ""
echo -e "${YELLOW}=== STEP 0: PRE-BUILD VALIDATION ===${NC}"

# Ensure frontend deps are installed (same toolchain as Dockerfile stage frontend-build)
echo -e "${BLUE}Installing frontend dependencies...${NC}"
cd frontend && npm install
echo -e "${BLUE}Running frontend production build (tsc + vite) — fails fast before Docker...${NC}"
npm run build
cd ..
echo -e "${GREEN}✓ Frontend deps + build OK (matches Docker stage 1)${NC}"

# Viewer / splat picking stack (GaussianSplats3D, not THREE.Raycaster)
echo -e "${BLUE}Verifying viewer & picking sources...${NC}"
for f in \
    "frontend/src/components/Viewer3D.tsx" \
    "frontend/src/types/gaussian-splats-3d.d.ts" \
    "frontend/package.json"
do
    if [ ! -f "$f" ]; then
        echo -e "${RED}❌ Missing required file: $f${NC}"
        exit 1
    fi
done
grep -q "@mkkellogg/gaussian-splats-3d" frontend/package.json || {
    echo -e "${RED}❌ @mkkellogg/gaussian-splats-3d missing from frontend/package.json${NC}"
    exit 1
}
echo -e "${GREEN}✓ Viewer / GS3D splat picking sources OK${NC}"

# Verify key backend files exist (new optimized pipeline)
echo -e "${BLUE}Verifying backend structure...${NC}"
REQUIRED_FILES=(
    "backend/database.py" 
    "backend/api/auth.py" 
    "backend/services/longsplat/postprocess.py"
    "backend/services/longsplat/longsplat_to_3dgs_converter.py"
    "backend/services/longsplat/train.py"
)

for f in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$f" ]; then
        echo -e "${RED}❌ Missing required file: $f${NC}"
        exit 1
    fi
done
echo -e "${GREEN}✓ Backend structure OK${NC}"

# Verify requirements.txt
grep -q "passlib" backend/requirements.txt || { echo -e "${RED}❌ passlib missing from requirements.txt${NC}"; exit 1; }
grep -q "plyfile" backend/requirements.txt || { echo -e "${RED}❌ plyfile missing from requirements.txt${NC}"; exit 1; }
echo -e "${GREEN}✓ Backend requirements OK${NC}"

# ============================================
# STEP 1: DOCKER LOGIN
# ============================================
echo ""
echo -e "${YELLOW}=== STEP 1: DOCKER HUB LOGIN ===${NC}"

if ! docker info 2>/dev/null | grep -q "Username"; then
    echo -e "${BLUE}Not logged in to Docker Hub. Please login:${NC}"
    docker login
fi

echo -e "${GREEN}✓ Docker Hub authenticated${NC}"

# ============================================
# STEP 2: BUILD AND PUSH
# ============================================
echo ""
echo -e "${YELLOW}=== STEP 2: BUILD AND PUSH ===${NC}"
echo -e "Image: ${FULL_IMAGE}"
echo -e "Platform: linux/amd64"
echo -e "Target GPU: A40 (sm_86, 48GB VRAM)"
echo -e "Theme: Deep Purple / Dark"
echo -e "Log file: ${LOG_FILE}"
echo ""

# Create buildx builder if it doesn't exist; always select it for this build
if ! docker buildx inspect gsbuilder > /dev/null 2>&1; then
    docker buildx create --name gsbuilder --use
else
    docker buildx use gsbuilder
fi

# Build and push (frontend dist is built again inside Dockerfile stage frontend-build)
# Optional: export BUILD_NO_CACHE=1 to force clean CUDA/submodule layers on the server
BUILDX_ARGS=(--platform linux/amd64 -t "${FULL_IMAGE}" --push .)
if [ "${BUILD_NO_CACHE:-0}" = "1" ]; then
    echo -e "${YELLOW}BUILD_NO_CACHE=1 → full rebuild (slower, fresh CUDA kernels)${NC}"
    BUILDX_ARGS=(--no-cache "${BUILDX_ARGS[@]}")
fi

docker buildx build "${BUILDX_ARGS[@]}" 2>&1 | tee ${LOG_FILE}

if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ BUILD AND PUSH SUCCESSFUL${NC}"
    echo ""
    echo -e "${PURPLE}=== DEPLOYMENT READY (PURPLE EDITION) ===${NC}"
    echo ""
    echo -e "Docker Image: ${FULL_IMAGE}"
    echo ""
    echo -e "${BLUE}RunPod Pod Settings:${NC}"
    echo -e "  ┌────────────────────┬──────────────────────────────────────────────┐"
    echo -e "  │ Container Image    │ ${FULL_IMAGE}              │"
    echo -e "  │ GPU Type           │ A40 (48GB VRAM) ⭐ REQUIRED                  │"
    echo -e "  │ Container Disk     │ 20 GB                                        │"
    echo -e "  │ Volume Disk        │ 150 GB (frames + 3D models)                  │"
    echo -e "  │ Volume Mount Path  │ /app/storage                                 │"
    echo -e "  │ Expose HTTP Ports  │ 8000                                         │"
    echo -e "  └────────────────────┴──────────────────────────────────────────────┘"
    echo ""
    echo -e "${PURPLE}Viewer: GaussianSplats3D picking (viewport-aligned + ellipsoid), measure calibration, purple UI${NC}"
    echo -e "${BLUE}Tip: BUILD_NO_CACHE=1 ./build-and-push.sh for a full CUDA layer rebuild${NC}"
    echo ""
else
    echo ""
    echo -e "${RED}❌ BUILD FAILED${NC}"
    tail -20 ${LOG_FILE}
    exit 1
fi
