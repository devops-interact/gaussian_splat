# LongSplat Integration

## Overview
LongSplat is a robust unposed 3D Gaussian Splatting framework designed for casually captured long videos. It addresses challenges like irregular camera motion, unknown poses, and expansive scenes where traditional methods fail due to pose drift or memory limitations.

## Key Features

### 1. Incremental Joint Optimization
LongSplat concurrently optimizes camera poses and 3D Gaussians. This joint optimization strategy helps avoid local minima and ensures global consistency across the reconstruction, which is critical for long, drift-prone sequences.

### 2. Pose Estimation with 3D Priors
The framework leverages a Pose Estimation Module that utilizes learned 3D priors to provide robust initialization and correction, superior to standard structure-from-motion techniques in difficult scenarios.

### 3. Adaptive Octree Anchor Formation
To manage memory efficiency in large scenes, LongSplat uses an adaptive Octree mechanism. This dynamically adjusts anchor densities based on scene complexity, significantly reducing memory usage without compromising detail.

## Configuration & Optimization
We have tuned the training parameters for efficiency while maintaining these core benefits:
- **optimized iterations**: Reduced incremental steps to speed up processing time (~20 mins vs 67 mins).
- **Auto-Centering**: Post-processing ensures the final model is centered at (0,0,0) for immediate viewing.
- **Native Color Learning**: We rely on the model's natural convergence for color ("SH DC") rather than random initialization, preserving the fidelity of the input video.

## Usage
Run the training service via Docker. The system will automatically handle:
1. Video preprocessing.
2. LongSplat training (Pose + Gaussian optimization).
3. Conversion to standard 3DGS PLY format (centered).
