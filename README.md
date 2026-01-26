# 🏠 Gaussian Splatting Room Reconstruction with LongSplat

A production-ready web application that converts casual video footage of rooms into interactive 3D models using **LongSplat** - NVIDIA's state-of-the-art technology for unposed 3D reconstruction from long videos.

[![LongSplat](https://img.shields.io/badge/LongSplat-ICCV%202025-blue)](https://linjohnss.github.io/longsplat/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://hub.docker.com/)
[![CUDA](https://img.shields.io/badge/CUDA-12.1-76B900?logo=nvidia)](https://developer.nvidia.com/cuda-toolkit)

---

## 🌟 Features

- **📹 No Pose Estimation Needed!** - LongSplat uses MASt3R internally (COLMAP-free!)
- **🎥 Casual Video Support** - Just record a video walking around your room
- **🤖 Fully Automated Pipeline** - Upload → Process → View 3D Model
- **📊 Real-time Progress** - Live status updates with detailed logging
- **🎮 Interactive 3D Viewer** - Rotate, zoom, and explore your reconstructed space
- **💾 Multiple Formats** - Export as PLY (primary) and OBJ (optional)
- **🐳 Production Ready** - Full Docker containerization for GPU cloud deployment
- **⚡ GPU Optimized** - Built for NVIDIA RTX 4090 with CUDA 12.1

---

## 🛠️ Tech Stack

### Frontend
- **React 18** + **TypeScript** - Modern UI framework
- **Vite** - Lightning-fast build tool
- **Three.js** - WebGL 3D visualization

### Backend
- **Python 3.10** - Core runtime
- **FastAPI** - High-performance async API
- **PyTorch 2.2.0** - Deep learning (CUDA 12.1)
- **LongSplat** - NVIDIA's unposed 3D reconstruction
  - **MASt3R** - Automatic pose estimation
  - **Gaussian Splatting** - Neural 3D representation
- **FFmpeg** - Video processing

### Infrastructure
- **Docker** - Containerization
- **RunPod** - GPU cloud (RTX 4090)
- **Vercel** - Frontend hosting

---

## 📋 Prerequisites

### For Docker Deployment (Recommended ✅)
- **Docker Desktop** with BuildX
- **RunPod Account** (or similar GPU cloud)
- **NVIDIA RTX 3090/4090** (24GB VRAM recommended)

### For Local Development (Advanced)
- **Python 3.10+**
- **Node.js 18+**
- **FFmpeg**
- **NVIDIA GPU** (24GB+ VRAM)
- **CUDA 12.1** drivers

> ⚠️ **Note:** LongSplat requires significant GPU resources. Cloud deployment recommended.

---

## 🚀 Quick Start

### 1️⃣ Clone Repository

```bash
git clone https://github.com/yourusername/gaussian-room-reconstruction.git
cd gaussian-room-reconstruction
```

### 2️⃣ Build & Push Docker Image

```bash
./build-and-push.sh
```

This automated script will:
- ✅ Build for `linux/amd64` (RunPod platform)
- ✅ Install all dependencies (PyTorch, LongSplat, CUDA extensions)
- ✅ Verify all packages at build time
- ✅ Push to Docker Hub (interactive prompt)
- ✅ Save logs to `/tmp/docker-build.log`

### 3️⃣ Deploy to RunPod

Create a new GPU pod with these exact settings:

| Setting | Value |
|---------|-------|
| **Container Image** | `interactdevops/gaussian-room-reconstruction:latest` |
| **GPU Type** | RTX 4090 (24GB VRAM) |
| **Container Disk** | 20 GB (temporary) |
| **Volume Disk** | 50 GB (persistent) |
| **Volume Mount Path** | `/app/storage` |
| **Expose HTTP Ports** | `8000` |
| **Expose TCP Ports** | `22` (SSH, optional) |
| **Environment Variables** | *(none required - pre-configured)* |

### 4️⃣ Access Your App

Wait 2-3 minutes for pod initialization, then:

```bash
# Health check
curl https://your-pod-id-8000.proxy.runpod.net/health

# Expected response:
{"status": "healthy"}
```

**Your backend is ready!** 🎉

### 5️⃣ Deploy Frontend (Optional)

```bash
cd frontend

# Update API URL in src/api/jobs.ts to your RunPod URL
# Then deploy to Vercel:
npm run build
vercel --prod
```

---

## 📱 How to Use

### Recording Your Video

**Best Practices:**
- 📏 **Duration:** 30-120 seconds
- 📹 **Quality:** 1080p or higher
- 🚶 **Movement:** Slow, steady walk around the room
- 💡 **Lighting:** Well-lit, consistent
- 🎯 **Coverage:** Capture all angles
- ❌ **Avoid:** Fast motion, blur, occlusions

### Processing Pipeline

```
1. Upload Video (MP4, MOV, AVI)
        ↓
2. Frame Extraction (FFmpeg @ 2 FPS)
   ⏱️ 10-30 seconds
        ↓
3. LongSplat Training
   ├─ MASt3R: Auto Pose Estimation
   └─ Gaussian Splatting: 3D Scene
   ⏱️ 10-60 minutes
        ↓
4. Export Models
   ├─ PLY (primary format)
   └─ OBJ (optional)
   ⏱️ 5-10 seconds
        ↓
5. 3D Visualization
   🎮 Interactive viewer
```

---

## ⚡ Performance

### Training Time (RTX 4090)

| Video Length | Training Time | Frame Count |
|--------------|---------------|-------------|
| 30 seconds | ~10-15 min | ~60 frames |
| 60 seconds | ~20-30 min | ~120 frames |
| 120 seconds | ~40-60 min | ~240 frames |

### Resource Usage

- **GPU Memory:** 12-20 GB during training
- **Container RAM:** 2-4 GB
- **Storage:** ~500 MB per job

---

## 🔌 API Reference

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/jobs/upload` | Upload video (multipart/form-data) |
| `GET` | `/api/jobs/{job_id}/status` | Job status & progress |
| `GET` | `/api/jobs` | List all jobs |
| `GET` | `/static/models/{job_id}.ply` | Download PLY model |
| `GET` | `/static/models/{job_id}.obj` | Download OBJ (if available) |

### Job Status Response

```json
{
  "job_id": "uuid-here",
  "status": "training",
  "progress": 0.65,
  "video_filename": "room_video.mp4",
  "model_url": "/static/models/uuid-here.ply",
  "created_at": "2026-01-26T12:00:00Z",
  "updated_at": "2026-01-26T12:15:00Z",
  "error_message": null
}
```

**Status Values:**
- `pending` → `extracting_frames` → `training` → `exporting` → `completed`
- `error` (if failure occurs)

---

## 🔧 Troubleshooting

### Build Issues

**❌ `ModuleNotFoundError: No module named 'scipy'`**  
✅ **Fixed** in latest version - rebuild with `./build-and-push.sh`

**❌ CUDA compilation errors**  
✅ Ensure building for `linux/amd64` platform (automated in script)

**❌ Build timeout**  
🔄 Retry - Docker Hub downloads can be slow

### Runtime Issues

**❌ Training fails immediately**

Check logs:
```bash
# In RunPod terminal
tail -100 /app/storage/logs/app.log
```

Verify:
1. GPU available: `nvidia-smi`
2. CUDA accessible: `python3.10 -c "import torch; print(torch.cuda.is_available())"`
3. Frames extracted: `ls /app/storage/frames/{job_id}/`

**❌ "No PLY file generated"**

1. Check output directory: `/app/storage/models/{job_id}/`
2. Verify video quality (1080p+, 30+ seconds)
3. Review LongSplat logs for MASt3R errors
4. Try shorter video or better lighting

**❌ Out of memory**

- ✅ Use shorter videos (30-60 seconds)
- ✅ Reduce video resolution before upload
- ✅ Ensure RTX 4090 pod (not lower-tier GPU)

---

## 📁 Project Structure

```
gaussian-room-reconstruction/
├── backend/
│   ├── api/              # API endpoints
│   ├── core/             # Config, models, pipeline
│   ├── jobs/             # Job management
│   ├── services/
│   │   ├── longsplat/    # ⭐ LongSplat training
│   │   ├── video/        # FFmpeg frame extraction
│   │   └── export/       # PLY/OBJ export
│   ├── storage/          # Runtime data (gitignored)
│   ├── utils/            # Helpers
│   ├── main.py           # FastAPI app
│   └── requirements.txt  # Python deps
├── frontend/
│   ├── src/
│   │   ├── api/          # Backend API client
│   │   ├── components/   # React UI components
│   │   ├── pages/        # Page layouts
│   │   └── types/        # TypeScript types
│   ├── package.json
│   └── vite.config.ts
├── Dockerfile            # 🐳 Production container
├── build-and-push.sh     # 🚀 Automated build script
├── ARCHITECTURE_AUDIT.md # 📋 System audit docs
└── README.md
```

---

## 💻 Local Development (Advanced)

> ⚠️ **Requires:** NVIDIA GPU with 24GB+ VRAM

### Backend

```bash
cd backend
python3.10 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Clone LongSplat
cd ..
git clone --recursive https://github.com/NVlabs/LongSplat.git
export LONGSPLAT_REPO=$(pwd)/LongSplat

# Start server
cd backend
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173
```

---

## 🔗 Resources

- **LongSplat Paper:** https://linjohnss.github.io/longsplat/
- **LongSplat GitHub:** https://github.com/NVlabs/LongSplat
- **Gaussian Splatting:** https://github.com/graphdeco-inria/gaussian-splatting
- **RunPod Docs:** https://docs.runpod.io/
- **Architecture Audit:** See `ARCHITECTURE_AUDIT.md`

---

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Test with Docker builds
4. Submit a pull request

---

## 📄 License

MIT License - See LICENSE file

---

## 🎯 Quick Reference Card

### Build & Deploy
```bash
./build-and-push.sh
```

### RunPod Settings
```
Image: interactdevops/gaussian-room-reconstruction:latest
GPU: RTX 4090
Container: 20 GB | Volume: 50 GB @ /app/storage
Ports: 8000 (HTTP), 22 (SSH)
```

### Health Check
```bash
curl https://your-pod-8000.proxy.runpod.net/health
```

### Logs
```bash
tail -f /app/storage/logs/app.log
```

---

<div align="center">

**Ready to reconstruct in 3D! 🚀**

[Report Bug](https://github.com/yourusername/gaussian-room-reconstruction/issues) · [Request Feature](https://github.com/yourusername/gaussian-room-reconstruction/issues)

</div>
