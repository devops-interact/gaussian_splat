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

# System deps - COLMAP is installed here via apt
# Qt offscreen dependencies are CRITICAL for headless COLMAP
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-dev python3.10-venv python3-pip \
    git ca-certificates curl \
    build-essential cmake ninja-build pkg-config \
    ffmpeg colmap \
    libgl1 libglib2.0-0 \
    # Qt offscreen platform dependencies
    libxkbcommon0 libxcb-xinerama0 libxcb-cursor0 \
    libqt5gui5 libqt5widgets5 libqt5core5a \
    qt5-qpa-plugins \
    && rm -rf /var/lib/apt/lists/*

# VERIFY COLMAP IS INSTALLED - basic check first
RUN echo "=== VERIFYING COLMAP INSTALLATION ===" && \
    which colmap && \
    colmap help | head -5 && \
    echo "=== COLMAP INSTALLED OK ==="

# Python tooling
RUN python3.10 -m pip install --upgrade pip setuptools wheel

# PyTorch CUDA (cu121)
RUN python3.10 -m pip install \
    torch==2.2.0 torchvision==0.17.0 torchaudio==2.2.0 \
    --index-url https://download.pytorch.org/whl/cu121

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

# Back to app
WORKDIR /app
COPY backend/ /app/

# Tell backend where gaussian-splatting lives
ENV GAUSSIAN_SPLATTING_REPO=/opt/gaussian-splatting

# Storage
RUN mkdir -p /app/storage/{uploads,frames,models,logs}

# FINAL VERIFICATION - All dependencies + COLMAP headless test
# This creates a test image and runs COLMAP feature extraction to verify Qt offscreen works
RUN echo "=== FINAL VERIFICATION ===" && \
    echo "1. Python packages..." && \
    python3.10 -c "import torch; print(f'PyTorch: {torch.__version__}')" && \
    python3.10 -c "import cv2; print(f'OpenCV: {cv2.__version__}')" && \
    python3.10 -c "import numpy; print(f'NumPy: {numpy.__version__}')" && \
    python3.10 -c "import fastapi; print(f'FastAPI: {fastapi.__version__}')" && \
    python3.10 -c "from PIL import Image; print('Pillow: OK')" && \
    echo "2. Gaussian Splatting CUDA extensions..." && \
    python3.10 -c "import diff_gaussian_rasterization; print('diff_gaussian_rasterization: OK')" && \
    python3.10 -c "import simple_knn; print('simple_knn: OK')" && \
    echo "3. Gaussian Splatting scripts..." && \
    ls -la /opt/gaussian-splatting/train.py && \
    ls -la /opt/gaussian-splatting/convert.py && \
    echo "4. COLMAP headless feature extraction test..." && \
    mkdir -p /tmp/colmap_test/images && \
    python3.10 -c "from PIL import Image; img = Image.new('RGB', (640, 480), color='gray'); img.save('/tmp/colmap_test/images/test.jpg')" && \
    QT_QPA_PLATFORM=offscreen colmap feature_extractor \
        --database_path /tmp/colmap_test/db.db \
        --image_path /tmp/colmap_test/images \
        --SiftExtraction.use_gpu 0 && \
    rm -rf /tmp/colmap_test && \
    echo "=== COLMAP HEADLESS MODE: OK ===" && \
    echo "=== ALL VERIFICATIONS PASSED ==="

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["python3.10", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
