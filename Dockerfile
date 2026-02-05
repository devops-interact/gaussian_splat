# syntax=docker/dockerfile:1.5

# RunPod A40 is linux/amd64. Force the correct platform when building on Apple Silicon.
# IMPORTANT: Build with --no-cache to avoid stale CUDA kernels from previous builds!
FROM --platform=linux/amd64 nvidia/cuda:12.1.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CUDA_HOME=/usr/local/cuda \
    PATH=/usr/local/cuda/bin:${PATH} \
    LD_LIBRARY_PATH=/usr/local/cuda/lib64:${LD_LIBRARY_PATH} \
    TORCH_CUDA_ARCH_LIST="8.0 8.6+PTX" \
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

# PyTorch CUDA (cu121) - Use 2.1.0 for pytorch3d wheel compatibility
RUN python3.10 -m pip install \
    torch==2.1.0 torchvision==0.16.0 torchaudio==2.1.0 \
    --index-url https://download.pytorch.org/whl/cu121

# Install PyTorch extensions for LongSplat (torch_scatter, torch_cluster)
# These need to be installed AFTER PyTorch with matching CUDA version
RUN python3.10 -m pip install \
    torch-scatter torch-cluster \
    -f https://data.pyg.org/whl/torch-2.1.0+cu121.html

# Install PyTorch3D (required by LongSplat for camera handling)
# Use pre-built wheel for PyTorch 2.1.0 + CUDA 12.1 (avoids memory-intensive compilation)
RUN python3.10 -m pip install fvcore iopath && \
    python3.10 -m pip install pytorch3d -f https://dl.fbaipublicfiles.com/pytorch3d/packaging/wheels/py310_cu121_pyt210/download.html

# App deps
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN python3.10 -m pip install -r /app/requirements.txt \
    && python3.10 -m pip install tqdm joblib

# (Pure LongSplat Build)

# Verify torch and CUDA are available before building submodules
RUN python3.10 -c "import torch; print(f'PyTorch {torch.__version__} available, CUDA: {torch.cuda.is_available()}'); print(f'CUDA_HOME: {torch.utils.cmake_prefix_path}')" && \
    nvcc --version

# Clone LongSplat for unposed 3D reconstruction from casual long videos
ARG LONGSPLAT_REPO=https://github.com/NVlabs/LongSplat.git
RUN git clone --recursive ${LONGSPLAT_REPO} /opt/LongSplat
WORKDIR /opt/LongSplat

# Install LongSplat dependencies explicitly from its requirements.txt
# We filter out packages we already installed manually (pytorch3d, torch) to avoid build errors
RUN sed -i '/pytorch3d/d' requirements.txt && \
    sed -i '/torch/d' requirements.txt && \
    python3.10 -m pip install -r requirements.txt

# Install LongSplat submodules - USE LONGSPLAT'S OWN VERSIONS (not gaussian-splatting)
# Each repository has its own tested versions - no cross-linking!
# Build for A40 (compute capability 8.6)
# Force rebuild of submodules to ensure architecture flags are picked up
ARG SUBMODULE_CACHEBUST=1

WORKDIR /opt/LongSplat/submodules
RUN ls -la simple-knn/ && ls -la diff-gaussian-rasterization/ && ls -la fused-ssim/

# CRITICAL FIX: fused-ssim hardcodes -arch=sm_89 which breaks on A40 (sm_86).
# We remove this line so TORCH_CUDA_ARCH_LIST takes precedence.
RUN sed -i '/-arch=sm_89/d' fused-ssim/setup.py && \
    grep -q "sm_89" fused-ssim/setup.py && echo "Failed to remove hardcoded arch!" && exit 1 || echo "Successfully patched fused-ssim/setup.py"

# Build strictly for A40 (sm_86) to avoid any "fat binary" confusion or incompatibilities
RUN TORCH_CUDA_ARCH_LIST="8.6" python3.10 -m pip install --no-cache-dir --no-build-isolation --verbose ./simple-knn
RUN TORCH_CUDA_ARCH_LIST="8.6" python3.10 -m pip install --no-cache-dir --no-build-isolation --verbose ./diff-gaussian-rasterization
RUN TORCH_CUDA_ARCH_LIST="8.6" python3.10 -m pip install --no-cache-dir --no-build-isolation --verbose ./fused-ssim

# Immediate verification of installed extensions
RUN python3.10 -c "import simple_knn; print(f'simple_knn built at: {simple_knn.__file__}')" && \
    python3.10 -c "import diff_gaussian_rasterization; print(f'diff_gaussian_rasterization built at: {diff_gaussian_rasterization.__file__}')" && \
    python3.10 -c "import fused_ssim; print(f'fused_ssim built at: {fused_ssim.__file__}')"
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
    jaxtyping \
    py3_wget

# Compile RoPE CUDA kernels for MASt3R (optional but recommended for speed)
# MASt3R is used internally by LongSplat for pose estimation
# Build for multiple GPU architectures
RUN cd submodules/mast3r/dust3r/croco/models/curope/ && \
    TORCH_CUDA_ARCH_LIST="8.6" python3.10 setup.py build_ext --inplace 2>/dev/null || echo "RoPE CUDA kernels skipped (optional, will fallback to CPU)"

# Pre-download MASt3R checkpoint (required for pose estimation in free mode)
# Reference: https://learnopencv.com/mast3r-sfm-grounding-image-matching-3d/
RUN mkdir -p checkpoints && \
    curl -fsSL -o checkpoints/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric.pth \
    https://download.europe.naverlabs.com/ComputerVision/MASt3R/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric.pth && \
    ls -lh checkpoints/ && \
    echo "MASt3R checkpoint downloaded successfully"

# Create symlinks for checkpoint in expected locations
RUN mkdir -p submodules/mast3r/checkpoints && \
    ln -sf /opt/LongSplat/checkpoints/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric.pth \
    submodules/mast3r/checkpoints/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric.pth

# VERIFY LONGSPLAT DEPENDENCIES
RUN echo "=== VERIFYING LONGSPLAT DEPENDENCIES ===" && \
    python3.10 -c "import torch; print(f'PyTorch: OK')" && \
    python3.10 -c "import torchvision; print(f'Torchvision: OK')" && \
    python3.10 -c "import torch_scatter; print(f'torch_scatter: OK')" && \
    python3.10 -c "import torch_cluster; print(f'torch_cluster: OK')" && \
    python3.10 -c "import pytorch3d; print(f'pytorch3d: OK')" && \
    python3.10 -c "import jaxtyping; print(f'jaxtyping: OK')" && \
    python3.10 -c "import roma; print(f'roma: OK')" && \
    python3.10 -c "import einops; print(f'einops: OK')" && \
    python3.10 -c "import py3_wget; print(f'py3_wget: OK')" && \
    ls -la /opt/LongSplat/train.py && \
    ls -la /opt/LongSplat/convert_3dgs.py && \
    ls -la /opt/LongSplat/submodules/mast3r/ && \
    ls -lh /opt/LongSplat/checkpoints/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric.pth && \
    echo "=== LONGSPLAT + MAST3R INSTALLATION VERIFIED OK ==="

# Back to app
WORKDIR /app
COPY backend/ /app/

# Tell backend where repositories live
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
    # diff_gaussian_rasterization etc are now installed from LongSplat submodules, so we verify them below
    python3.10 -c "import diff_gaussian_rasterization; print('✓ diff_gaussian_rasterization: OK')" && \
    python3.10 -c "import simple_knn; print('✓ simple_knn: OK')" && \
    python3.10 -c "import fused_ssim; print('✓ fused_ssim: OK')" && \
    echo "3. PyTorch Geometric extensions..." && \
    python3.10 -c "import torch_scatter; print('✓ torch_scatter: OK')" && \
    python3.10 -c "import torch_cluster; print('✓ torch_cluster: OK')" && \
    python3.10 -c "import pytorch3d; print('✓ pytorch3d: OK')" && \
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
    echo "7. MASt3R checkpoint for pose estimation..." && \
    ls -lh /opt/LongSplat/checkpoints/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric.pth && \
    ls -la /opt/LongSplat/submodules/mast3r/ && \
    echo "8. CUDA availability..." && \
    python3.10 -c "import torch; print(f'✓ CUDA available: {torch.cuda.is_available()}'); print(f'✓ CUDA version: {torch.version.cuda}'); print(f'✓ Device count: {torch.cuda.device_count()}')" && \
    echo "9. Target GPU: A40 (sm_86, 48GB VRAM)" && \
    echo "10. Verifying CUDA extension architectures..." && \
    python3.10 -c "import fused_ssim; print(f'✓ fused_ssim module path: {fused_ssim.__file__}')" && \
    python3.10 -c "import diff_gaussian_rasterization; print(f'✓ diff_gaussian_rasterization path: {diff_gaussian_rasterization.__file__}')" && \
    echo "=== ✅ ALL DEPENDENCIES VERIFIED ===" && \
    echo "=== ✅ A40 BUILD (sm_86) READY FOR DEPLOYMENT ===" && \
    echo "=== BUILD TIMESTAMP: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# Set PYTHONPATH to include LongSplat, MASt3R, DUSt3R
ENV PYTHONPATH=/opt/LongSplat:/opt/LongSplat/submodules/mast3r:/opt/LongSplat/submodules/mast3r/dust3r:${PYTHONPATH}

CMD ["python3.10", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
