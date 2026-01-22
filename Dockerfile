# syntax=docker/dockerfile:1.5

# Runpod RTX 4090 is linux/amd64. Force the correct platform when building on Apple Silicon.
FROM --platform=linux/amd64 nvidia/cuda:12.1.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-venv python3-pip \
    git ca-certificates curl \
    build-essential cmake ninja-build pkg-config \
    ffmpeg colmap \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

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

# Build/Install CUDA extensions
RUN python3.10 -m pip install submodules/diff-gaussian-rasterization \
    && python3.10 -m pip install submodules/simple-knn \
    && python3.10 -m pip install submodules/fused-ssim

# Back to app
WORKDIR /app
COPY backend/ /app/

# Tell backend where gaussian-splatting lives
ENV GAUSSIAN_SPLATTING_REPO=/opt/gaussian-splatting

# Storage
RUN mkdir -p /app/storage/{uploads,frames,models,logs}

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["python3.10", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
