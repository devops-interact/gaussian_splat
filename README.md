# Gaussian Splatting Room Reconstruction MVP

A browser-based web application that reconstructs 3D models of indoor rooms from single video captures using Gaussian Splatting.

## Overview

This MVP validates the hypothesis that a usable 3D reconstruction of an indoor room can be generated from a single video using Gaussian Splatting techniques. The application runs entirely locally with no authentication requirements.

## Features

- Upload `.mp4` video files of rooms
- Asynchronous processing pipeline:
  - Frame extraction (FFmpeg)
  - Camera pose estimation (COLMAP)
  - Gaussian Splatting training
  - 3D model export (.ply, optional .obj)
- Interactive 3D preview in browser (orbit, zoom, pan)
- Download reconstructed models

## Prerequisites

### System Requirements
- Python 3.9+
- Node.js 18+
- FFmpeg (for video processing)
- COLMAP (for Structure-from-Motion)
- CUDA-capable GPU (optional but recommended for training)

### Installing System Dependencies

#### macOS
```bash
# Install FFmpeg
brew install ffmpeg

# Install COLMAP
brew install colmap
```

#### Linux (Ubuntu/Debian)
```bash
# Install FFmpeg
sudo apt-get update
sudo apt-get install ffmpeg

# Install COLMAP
sudo apt-get install colmap
```

#### Windows
- Download FFmpeg from https://ffmpeg.org/download.html
- Download COLMAP from https://colmap.github.io/download.html
- Add both to your system PATH

## Setup

### 1. Clone and Navigate
```bash
cd gaussian-room-reconstruction
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm install
```

### 4. Create Storage Directories

The backend will create these automatically, but you can create them manually:

```bash
mkdir -p backend/storage/{uploads,frames,models,logs}
touch backend/storage/{uploads,frames,models,logs}/.gitkeep
```

## Running the Application

### 1. Start Backend

```bash
cd backend
source venv/bin/activate  # On Windows: venv\Scripts\activate
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`

### 2. Start Frontend

In a new terminal:

```bash
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:5173`

### 3. Use the Application

1. Open `http://localhost:5173` in your browser
2. Upload a `.mp4` video file of a room
3. Wait for processing to complete
4. Interact with the 3D preview
5. Download the reconstructed model

## Project Structure

```
gaussian-room-reconstruction/
├── frontend/          # React + Vite frontend
├── backend/           # Python + FastAPI backend
├── scripts/           # Setup and utility scripts
└── README.md
```

## Processing Pipeline

1. **Video Upload**: User uploads `.mp4` file
2. **Frame Extraction**: FFmpeg extracts frames at regular intervals
3. **Pose Estimation**: COLMAP estimates camera poses from frames
4. **Gaussian Splatting Training**: Trains 3D Gaussian Splatting model
5. **Export**: Generates `.ply` file (and optionally `.obj`)
6. **Preview**: Frontend loads and displays the 3D model

## API Endpoints

- `POST /api/jobs/upload` - Upload video file
- `GET /api/jobs/{job_id}/status` - Get job status
- `GET /api/jobs/{job_id}/model` - Download model file
- `GET /api/jobs/{job_id}/preview` - Get preview URL

## Notes

- Processing can take 10-60+ minutes depending on video length and hardware
- GPU acceleration significantly speeds up training
- The first run may take longer as dependencies are initialized
- Ensure sufficient disk space for video files and generated models

### Gaussian Splatting Integration

**Using Official Library**: The application now uses the official [3D Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting) implementation from INRIA.

**Setup Instructions**:

1. Clone the Gaussian Splatting repository:
```bash
cd ..  # Go to parent directory of this project
git clone https://github.com/graphdeco-inria/gaussian-splatting.git
cd gaussian-splatting
git submodule update --init --recursive
```

2. Install the submodules (requires CUDA):
```bash
pip install submodules/diff-gaussian-rasterization
pip install submodules/simple-knn
```

3. Install additional dependencies (if needed):
```bash
pip install torch torchvision
```

The application will automatically detect and use the Gaussian Splatting repository if it's located:
- As a sibling directory: `../gaussian-splatting/`
- Or in the project root: `./gaussian-splatting/`

If the repository is not found, the application will fall back to a placeholder implementation for testing purposes.

## Docker Deployment for Runpod.io

### Building the Docker Image

The Docker image is configured for **linux/amd64** to run on Runpod's RTX 4090 GPUs:

```bash
# Build the image
./build-docker.sh

# Or manually:
docker buildx build --platform linux/amd64 -t gaussian-room-reconstruction:latest --load .
```

The Dockerfile includes:
- NVIDIA CUDA 12.1 base image
- PyTorch with CUDA 12.1 support
- Official Gaussian Splatting repository with CUDA extensions compiled
- COLMAP and FFmpeg
- All Python dependencies

### Pushing to Registry

Before deploying to Runpod, push the image to a container registry:

```bash
# Set your registry credentials
export DOCKER_REGISTRY=docker.io  # or ghcr.io, registry.runpod.io
export DOCKER_USERNAME=your-username
export IMAGE_TAG=latest

# Push to registry
./push-to-runpod.sh

# Or manually:
docker tag gaussian-room-reconstruction:latest YOUR_REGISTRY/YOUR_USERNAME/gaussian-room-reconstruction:latest
docker push YOUR_REGISTRY/YOUR_USERNAME/gaussian-room-reconstruction:latest
```

### Deploying to Runpod.io

1. **Create a Runpod Pod**:
   - Go to [Runpod.io](https://www.runpod.io/)
   - Create a new Pod
   - Select GPU Type: **RTX_4090**
   - Container Image: `YOUR_REGISTRY/YOUR_USERNAME/gaussian-room-reconstruction:latest`
   - Container Disk: **50GB** (minimum, recommend 100GB for multiple jobs)
   - Port: **8000** (Public)

2. **Environment Variables**:
   - `CUDA_VISIBLE_DEVICES=0`
   - `PYTHONUNBUFFERED=1`
   - `GAUSSIAN_SPLATTING_REPO=/opt/gaussian-splatting` (already set in image)

3. **Access the API**:
   - Once deployed, access at: `https://your-pod-id-8000.proxy.runpod.net`
   - Health check: `https://your-pod-id-8000.proxy.runpod.net/health`

### Local Testing with Docker

```bash
# Build and run locally (requires NVIDIA Docker runtime)
docker-compose up --build

# Or manually:
docker run --gpus all -p 8000:8000 \
  -v $(pwd)/backend/storage:/app/storage \
  gaussian-room-reconstruction:latest
```

## Troubleshooting

### FFmpeg not found
- Ensure FFmpeg is installed and in your PATH
- Verify with: `ffmpeg -version`

### COLMAP not found
- Ensure COLMAP is installed and in your PATH
- Verify with: `colmap -h`

### GPU/CUDA issues
- The app will fall back to CPU if GPU is unavailable
- Processing will be slower but still functional

### Port conflicts
- Backend default: `8000`
- Frontend default: `5173`
- Modify ports in `main.py` and `vite.config.ts` if needed

## License

MIT
