# LongSplat 3D Reconstruction - Dependency Manifest

## System Dependencies (apt)
- **python3.10**, python3.10-dev, python3.10-venv, python3-pip
- **git**, ca-certificates, curl
- **build-essential**, cmake, ninja-build, pkg-config
- **ffmpeg** (video processing)
- **libgl1**, libglib2.0-0 (OpenGL/GUI libraries for headless mode)

## Core Python Framework
- **torch==2.2.0** (PyTorch with CUDA 12.1 support)
- **torchvision==0.17.0**
- **torchaudio==2.2.0**

## PyTorch Geometric Extensions (from PyG wheels)
- **torch-scatter** (scatter/gather operations for sparse tensors)
- **torch-cluster** (clustering algorithms on point clouds)

## Gaussian Splatting CUDA Extensions (from source)
- **diff-gaussian-rasterization** (differentiable Gaussian rasterization)
- **simple-knn** (fast K-nearest neighbors)
- **fused-ssim** (structural similarity index for loss)

## LongSplat Core Dependencies
- **roma** (rotation representations and operations)
- **einops** (tensor operations with named dimensions)
- **trimesh==3.23.5** (3D mesh processing)
- **opencv-python==4.8.1.78** (computer vision)
- **h5py** (HDF5 file format)
- **croco** (correspondence and rotation)
- **matplotlib** (visualization)
- **scipy** (scientific computing)
- **plyfile==0.7.4** (PLY file format)
- **huggingface_hub** (model hub integration)
- **jaxtyping** (type annotations for arrays)

## Backend API Dependencies
- **fastapi==0.104.1** (web framework)
- **uvicorn[standard]==0.24.0** (ASGI server)
- **python-multipart==0.0.6** (form data parsing)
- **pydantic==2.5.0** (data validation)
- **pydantic-settings==2.1.0** (settings management)
- **aiofiles==23.2.1** (async file operations)
- **python-dotenv==1.0.0** (environment variables)
- **tqdm** (progress bars)
- **joblib** (parallel processing)

## Supporting Libraries
- **numpy==1.24.3** (numerical computing)
- **pillow==10.1.0** (image processing)

## Optional CUDA Kernels
- **RoPE kernels** for MASt3R (compiled at build time, fallback to CPU if fails)

## Git Repositories
- **Gaussian Splatting**: https://github.com/graphdeco-inria/gaussian-splatting.git
- **LongSplat**: https://github.com/NVlabs/LongSplat.git (with submodules)

## Environment Variables
- `CUDA_HOME=/usr/local/cuda`
- `TORCH_CUDA_ARCH_LIST=8.9` (RTX 4090 compute capability)
- `FORCE_CUDA=1`
- `QT_QPA_PLATFORM=offscreen` (headless rendering)
- `PYTHONPATH=/opt/LongSplat` (for submodule imports)
- `LONGSPLAT_REPO=/opt/LongSplat`
- `GAUSSIAN_SPLATTING_REPO=/opt/gaussian-splatting`

## Verification Steps
All dependencies are verified during Docker build with import tests:
1. Core Python packages (torch, opencv, numpy, fastapi)
2. Gaussian Splatting CUDA extensions
3. PyTorch Geometric extensions
4. LongSplat Python dependencies
5. Backend API dependencies
6. LongSplat scripts and structure
7. CUDA availability

## Architecture
```
Ubuntu 22.04 + CUDA 12.1.1
  ├── Python 3.10
  ├── PyTorch 2.2.0 (CUDA 12.1)
  ├── Gaussian Splatting (CUDA extensions)
  ├── LongSplat (unposed 3D reconstruction)
  │   ├── MASt3R (pose estimation)
  │   └── 3DGS (Gaussian Splatting)
  └── FastAPI Backend (video → frames → training → PLY)
```

## Platform
- **Target**: linux/amd64 (RunPod RTX 4090)
- **CUDA**: 12.1.1
- **GPU**: RTX 4090 (Compute Capability 8.9)

---
**Last Updated**: 2026-01-26
**Verified**: All dependencies tested during Docker build
