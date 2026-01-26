# syntax=docker/dockerfile:1.5

# Runpod RTX 4090 is linux/amd64. Force the correct platform when building on Apple Silicon.
FROM --platform=linux/amd64 nvidia/cuda:12.1.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CUDA_HOME=/usr/local/cuda \
    PATH=/usr/local/cuda/bin:${PATH} \
    LD_LIBRARY_PATH=/usr/local/cuda/lib64:${LD_LIBRARY_PATH} \
    TORCH_CUDA_ARCH_LIST="8.9" \
    FORCE_CUDA="1" \
    QT_QPA_PLATFORM=offscreen

# System deps - LongSplat doesn't need COLMAP (uses MASt3R internally)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-dev python3.10-venv python3-pip \
    git ca-certificates curl \
    build-essential cmake ninja-build pkg-config \
    ffmpeg \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Python tooling
RUN python3.10 -m pip install --upgrade pip setuptools wheel

# PyTorch CUDA (cu121)
RUN python3.10 -m pip install \
    torch==2.2.0 torchvision==0.17.0 torchaudio==2.2.0 \
    --index-url https://download.pytorch.org/whl/cu121

# Install PyTorch extensions for LongSplat (torch_scatter, torch_cluster)
# These need to be installed AFTER PyTorch with matching CUDA version
RUN python3.10 -m pip install \
    torch-scatter torch-cluster \
    -f https://data.pyg.org/whl/torch-2.2.0+cu121.html

# App deps
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN python3.10 -m pip install -r /app/requirements.txt \
    && python3.10 -m pip install tqdm joblib

# Clone gaussian-splatting and only init training-related submodules
# (We don't need SIBR_viewers for headless training.)
ARG GS_REPO=https://github.com/graphdeco-inria/gaussian-splatting.git
RUN git clone --depth 1 ${GS_REPO} /opt/gaussian-splatting
WORKDIR /opt/gaussian-splatting
RUN git submodule update --init --recursive \
      submodules/diff-gaussian-rasterization \
      submodules/simple-knn \
      submodules/fused-ssim

# Verify torch and CUDA are available before building submodules
RUN python3.10 -c "import torch; print(f'PyTorch {torch.__version__} available, CUDA: {torch.cuda.is_available()}'); print(f'CUDA_HOME: {torch.utils.cmake_prefix_path}')" && \
    nvcc --version

# Build/Install CUDA extensions
# Use --no-build-isolation to ensure torch is available during build
# Set TORCH_CUDA_ARCH_LIST for RTX 4090 (compute capability 8.9)
RUN TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation submodules/diff-gaussian-rasterization \
    && TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation submodules/simple-knn \
    && TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation submodules/fused-ssim

# VERIFY ALL GAUSSIAN SPLATTING DEPENDENCIES ARE INSTALLED
RUN echo "=== VERIFYING GAUSSIAN SPLATTING DEPENDENCIES ===" && \
    python3.10 -c "import diff_gaussian_rasterization; print('diff_gaussian_rasterization OK')" && \
    python3.10 -c "import simple_knn; print('simple_knn OK')" && \
    python3.10 -c "import fused_ssim; print('fused_ssim OK')" && \
    echo "=== GAUSSIAN SPLATTING DEPENDENCIES VERIFIED OK ==="

# Clone LongSplat for unposed 3D reconstruction from casual long videos
ARG LONGSPLAT_REPO=https://github.com/NVlabs/LongSplat.git
RUN git clone --recursive ${LONGSPLAT_REPO} /opt/LongSplat
WORKDIR /opt/LongSplat

# Install LongSplat submodules - USE LONGSPLAT'S OWN VERSIONS (not gaussian-splatting)
# Each repository has its own tested versions - no cross-linking!
WORKDIR /opt/LongSplat/submodules
RUN TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation ./simple-knn
RUN TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation ./diff-gaussian-rasterization
RUN TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation ./fused-ssim
WORKDIR /opt/LongSplat

# Install only essential LongSplat dependencies (skip CUDA packages that need torch at build time)
RUN python3.10 -m pip install \
    roma \
    einops \
    trimesh \
    opencv-python \
    h5py \
    croco \
    matplotlib \
    scipy \
    plyfile \
    huggingface_hub \
    jaxtyping

# Compile RoPE CUDA kernels for MASt3R (optional but recommended for speed)
# MASt3R is used internally by LongSplat for pose estimation
RUN cd submodules/mast3r/dust3r/croco/models/curope/ && \
    python3.10 setup.py build_ext --inplace 2>/dev/null || echo "RoPE CUDA kernels skipped (optional, will fallback to CPU)"

# VERIFY LONGSPLAT DEPENDENCIES
RUN echo "=== VERIFYING LONGSPLAT DEPENDENCIES ===" && \
    python3.10 -c "import torch; print(f'PyTorch: OK')" && \
    python3.10 -c "import torchvision; print(f'Torchvision: OK')" && \
    python3.10 -c "import torch_scatter; print(f'torch_scatter: OK')" && \
    python3.10 -c "import torch_cluster; print(f'torch_cluster: OK')" && \
    python3.10 -c "import jaxtyping; print(f'jaxtyping: OK')" && \
    python3.10 -c "import roma; print(f'roma: OK')" && \
    python3.10 -c "import einops; print(f'einops: OK')" && \
    ls -la /opt/LongSplat/train.py && \
    ls -la /opt/LongSplat/convert_3dgs.py && \
    echo "=== LONGSPLAT INSTALLATION VERIFIED OK ==="

# Back to app
WORKDIR /app
COPY backend/ /app/

# Tell backend where repositories live
ENV GAUSSIAN_SPLATTING_REPO=/opt/gaussian-splatting
ENV LONGSPLAT_REPO=/opt/LongSplat

# Storage
RUN mkdir -p /app/storage/{uploads,frames,models,logs}

# COMPREHENSIVE FINAL VERIFICATION - All dependencies
RUN echo "=== COMPREHENSIVE DEPENDENCY VERIFICATION ===" && \
    echo "1. Core Python packages..." && \
    python3.10 -c "import torch; print(f'✓ PyTorch: {torch.__version__}')" && \
    python3.10 -c "import torchvision; print(f'✓ Torchvision: {torchvision.__version__}')" && \
    python3.10 -c "import cv2; print(f'✓ OpenCV: {cv2.__version__}')" && \
    python3.10 -c "import numpy; print(f'✓ NumPy: {numpy.__version__}')" && \
    python3.10 -c "import fastapi; print(f'✓ FastAPI: {fastapi.__version__}')" && \
    python3.10 -c "from PIL import Image; print('✓ Pillow: OK')" && \
    echo "2. Gaussian Splatting CUDA extensions..." && \
    python3.10 -c "import diff_gaussian_rasterization; print('✓ diff_gaussian_rasterization: OK')" && \
    python3.10 -c "import simple_knn; print('✓ simple_knn: OK')" && \
    python3.10 -c "import fused_ssim; print('✓ fused_ssim: OK')" && \
    echo "3. PyTorch Geometric extensions..." && \
    python3.10 -c "import torch_scatter; print('✓ torch_scatter: OK')" && \
    python3.10 -c "import torch_cluster; print('✓ torch_cluster: OK')" && \
    echo "4. LongSplat Python dependencies..." && \
    python3.10 -c "import jaxtyping; print('✓ jaxtyping: OK')" && \
    python3.10 -c "import roma; print('✓ roma: OK')" && \
    python3.10 -c "import einops; print('✓ einops: OK')" && \
    python3.10 -c "import trimesh; print('✓ trimesh: OK')" && \
    python3.10 -c "import h5py; print('✓ h5py: OK')" && \
    python3.10 -c "import matplotlib; print('✓ matplotlib: OK')" && \
    python3.10 -c "import scipy; print('✓ scipy: OK')" && \
    python3.10 -c "import plyfile; print('✓ plyfile: OK')" && \
    python3.10 -c "from huggingface_hub import HfApi; print('✓ huggingface_hub: OK')" && \
    echo "5. Backend API dependencies..." && \
    python3.10 -c "import aiofiles; print('✓ aiofiles: OK')" && \
    python3.10 -c "import uvicorn; print('✓ uvicorn: OK')" && \
    echo "6. LongSplat scripts and structure..." && \
    ls -la /opt/LongSplat/train.py && \
    ls -la /opt/LongSplat/convert_3dgs.py && \
    ls -la /opt/LongSplat/submodules/mast3r/ && \
    echo "7. CUDA availability..." && \
    python3.10 -c "import torch; print(f'✓ CUDA available: {torch.cuda.is_available()}'); print(f'✓ CUDA version: {torch.version.cuda}'); print(f'✓ Device count: {torch.cuda.device_count()}')" && \
    echo "=== ✅ ALL DEPENDENCIES VERIFIED ===" && \
    echo "=== ✅ SYSTEM READY FOR DEPLOYMENT ==="

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8000/health || exit 1

# Set PYTHONPATH to include both LongSplat and gaussian-splatting
ENV PYTHONPATH=/opt/LongSplat:/opt/gaussian-splatting:${PYTHONPATH}

CMD ["python3.10", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
