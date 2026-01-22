# Deployment Guide

## Architecture Overview

- **Backend**: Docker image on GPU (RTX 4090 on Runpod.io) - `linux/amd64`
- **Frontend**: Vercel deployment (Vite + React framework)
- **Repository**: https://github.com/devops-interact/gaussian_splat.git

## Backend Deployment (Runpod.io)

### Architecture Confirmation
✅ **Correct**: The Dockerfile uses `--platform=linux/amd64` which is correct for RTX 4090 on Runpod.

### Steps

1. **Build Docker Image**:
   ```bash
   ./build-docker.sh
   ```

2. **Push to Container Registry**:
   ```bash
   export DOCKER_REGISTRY=docker.io  # or ghcr.io
   export DOCKER_USERNAME=your-username
   ./push-to-runpod.sh
   ```

3. **Deploy on Runpod**:
   - GPU Type: **RTX_4090**
   - Container Image: `YOUR_REGISTRY/YOUR_USERNAME/gaussian-room-reconstruction:latest`
   - Container Disk: **50GB+** (recommend 100GB)
   - Port: **8000** (Public)
   - Environment Variables:
     - `CUDA_VISIBLE_DEVICES=0`
     - `PYTHONUNBUFFERED=1`

4. **Get Backend URL**:
   - After deployment: `https://your-pod-id-8000.proxy.runpod.net`

## Frontend Deployment (Vercel)

### Framework Preset
**Use: "Vite"** framework preset on Vercel

### Steps

1. **Import Project on Vercel**:
   - Go to [Vercel Dashboard](https://vercel.com)
   - Click "Add New Project"
   - Import from GitHub: `devops-interact/gaussian_splat`
   - **Framework Preset**: Select **"Vite"**
   - **Root Directory**: Set to `frontend`

2. **Environment Variables**:
   - Add environment variable:
     - **Name**: `VITE_API_BASE_URL`
     - **Value**: Your Runpod backend URL (e.g., `https://your-pod-id-8000.proxy.runpod.net`)

3. **Build Settings** (should auto-detect):
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`

4. **Deploy**:
   - Click "Deploy"
   - Vercel will automatically build and deploy

### Vercel Configuration

The project includes `frontend/vercel.json` with:
- Framework: Vite
- Build command and output directory
- CORS headers for API access

## Environment Variables Summary

### Backend (Runpod)
- `CUDA_VISIBLE_DEVICES=0`
- `PYTHONUNBUFFERED=1`
- `GAUSSIAN_SPLATTING_REPO=/opt/gaussian-splatting` (already set in image)

### Frontend (Vercel)
- `VITE_API_BASE_URL=https://your-pod-id-8000.proxy.runpod.net`

## Testing the Deployment

1. **Backend Health Check**:
   ```bash
   curl https://your-pod-id-8000.proxy.runpod.net/health
   ```

2. **Frontend**:
   - Visit your Vercel deployment URL
   - Upload a video and verify it connects to the backend

## Troubleshooting

### CORS Issues
- Backend already has CORS middleware configured
- Vercel config includes CORS headers

### API Connection
- Verify `VITE_API_BASE_URL` is set correctly in Vercel
- Check that Runpod port 8000 is set to "Public"
- Test backend URL directly in browser

### Build Issues
- Ensure Vercel framework preset is set to "Vite"
- Root directory should be `frontend`
- Check build logs in Vercel dashboard
