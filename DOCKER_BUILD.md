# Docker Image Build & Push Instructions

## Step 1: Start Docker Desktop

Make sure Docker Desktop is running on your Mac.

## Step 2: Build and Push Docker Image

### Option A: Use the Script (Recommended)

```bash
# Set your registry credentials
export DOCKER_REGISTRY=docker.io  # or ghcr.io for GitHub Container Registry
export DOCKER_USERNAME=your-username
export IMAGE_TAG=latest

# Build and push in one command
./push-docker-image.sh
```

### Option B: Manual Commands

```bash
# 1. Build the image for linux/amd64
docker buildx build --platform linux/amd64 \
  -t your-username/gaussian-room-reconstruction:latest \
  --load .

# 2. Tag for your registry
docker tag gaussian-room-reconstruction:latest \
  docker.io/your-username/gaussian-room-reconstruction:latest

# 3. Login to registry (if needed)
docker login docker.io  # or docker login ghcr.io

# 4. Push to registry
docker push docker.io/your-username/gaussian-room-reconstruction:latest
```

## Step 3: Get Your Image URL

After pushing, your image URL will be:
- **Docker Hub**: `docker.io/YOUR_USERNAME/gaussian-room-reconstruction:latest`
- **GitHub Container Registry**: `ghcr.io/YOUR_USERNAME/gaussian-room-reconstruction:latest`

## Step 4: Use in Runpod

1. Go to [Runpod.io](https://www.runpod.io/)
2. Create a new Pod
3. Configure:
   - **GPU Type**: RTX_4090
   - **Container Image**: `docker.io/YOUR_USERNAME/gaussian-room-reconstruction:latest`
   - **Container Disk**: 50GB (minimum, recommend 100GB)
   - **Port**: 8000 (Public)
   - **Environment Variables**:
     - `CUDA_VISIBLE_DEVICES=0`
     - `PYTHONUNBUFFERED=1`
4. Deploy and get your backend URL: `https://your-pod-id-8000.proxy.runpod.net`

## Registry Options

### Docker Hub (docker.io)
- Free for public images
- URL format: `docker.io/username/image:tag`
- Login: `docker login`

### GitHub Container Registry (ghcr.io)
- Free for public images
- URL format: `ghcr.io/username/image:tag`
- Login: `echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin`

### Runpod Registry
- If you have Runpod registry access
- URL format: `registry.runpod.io/username/image:tag`
