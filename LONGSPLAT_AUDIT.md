# LongSplat Installation Audit

**Date:** January 26, 2026  
**Repository:** https://github.com/NVlabs/LongSplat.git  
**Status:** ⚠️ **ISSUES FOUND - REQUIRES FIX**

---

## 📋 Official Requirements (from GitHub)

According to the [official LongSplat repository](https://github.com/NVlabs/LongSplat), the installation requires:

### 1. Clone with Submodules
```bash
git clone --recursive https://github.com/NVlabs/LongSplat.git
```
**✅ OUR STATUS:** Correct (Dockerfile line 75)

### 2. Python Environment
```bash
conda create -n longsplat python=3.10.13 cmake=3.14.0 -y
conda install pytorch torchvision pytorch-cuda=12.1 -c pytorch -c nvidia
```
**✅ OUR STATUS:** Using Python 3.10 + PyTorch 2.2.0 with CUDA 12.1 (compatible)

### 3. Install Requirements
```bash
pip install -r requirements.txt
```
**⚠️ OUR STATUS:** Partial - We install individual packages, not from LongSplat's requirements.txt

### 4. Install Submodules
```bash
pip install submodules/simple-knn
pip install submodules/diff-gaussian-rasterization  
pip install submodules/fused-ssim
```
**❌ CRITICAL ISSUE:** We're symlinking from gaussian-splatting instead of using LongSplat's submodules!

### 5. Optional: RoPE CUDA Kernels
```bash
cd submodules/mast3r/dust3r/croco/models/curope/
python setup.py build_ext --inplace
```
**✅ OUR STATUS:** Implemented with fallback (Dockerfile lines 100-103)

---

## 🚨 **CRITICAL ISSUE IDENTIFIED**

### Problem: Submodule Version Mismatch

**Current Implementation (Dockerfile lines 78-84):**
```dockerfile
RUN cd submodules && \
    rm -rf simple-knn diff-gaussian-rasterization && \
    ln -s /opt/gaussian-splatting/submodules/simple-knn simple-knn && \
    ln -s /opt/gaussian-splatting/submodules/diff-gaussian-rasterization diff-gaussian-rasterization && \
    TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation fused-ssim
```

**Issue:** 
- LongSplat's submodules may have different versions/patches than gaussian-splatting
- Symlinking can cause import path issues
- LongSplat expects its own submodule structure

**Official Approach:**
- Use LongSplat's own submodules (cloned with `--recursive`)
- Build each submodule independently
- No cross-linking between repositories

---

## 📊 Dependency Comparison

| Dependency | Official LongSplat | Our Docker | Status |
|------------|-------------------|------------|---------|
| Python | 3.10.13 | 3.10.x | ✅ Compatible |
| PyTorch | Latest with CUDA 12.1 | 2.2.0+cu121 | ✅ Good |
| torchvision | Latest | 0.17.0 | ✅ Good |
| simple-knn | **From LongSplat submodule** | ❌ Symlink from gaussian-splatting | ❌ Wrong |
| diff-gaussian-rasterization | **From LongSplat submodule** | ❌ Symlink from gaussian-splatting | ❌ Wrong |
| fused-ssim | **From LongSplat submodule** | ✅ Built from LongSplat | ✅ Correct |
| roma | Latest | Installed | ✅ Good |
| einops | Latest | Installed | ✅ Good |
| trimesh | Latest | Installed | ✅ Good |
| opencv-python | Latest | Installed | ✅ Good |
| h5py | Latest | Installed | ✅ Good |
| croco | Latest | Installed | ✅ Good |
| matplotlib | Latest | Installed | ✅ Good |
| scipy | Latest | 1.10.1 | ✅ Good |
| plyfile | Latest | Installed | ✅ Good |
| huggingface_hub | Latest | Installed | ✅ Good |
| jaxtyping | Latest | Installed | ✅ Good |
| torch_scatter | Latest (PyG) | Installed | ✅ Good |
| torch_cluster | Latest (PyG) | Installed | ✅ Good |

---

## ✅ **RECOMMENDED FIX**

### Option 1: Use LongSplat's Own Submodules (RECOMMENDED)

Replace Dockerfile lines 78-84 with:

```dockerfile
# Install LongSplat submodules from its own repository
WORKDIR /opt/LongSplat/submodules
RUN TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation ./simple-knn
RUN TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation ./diff-gaussian-rasterization
RUN TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation ./fused-ssim
WORKDIR /opt/LongSplat
```

**Why:** 
- Uses LongSplat's own versions (tested and verified)
- No cross-repository dependencies
- Follows official installation guide
- Eliminates potential version conflicts

### Option 2: Keep gaussian-splatting for Backward Compatibility

If you need gaussian-splatting for other purposes:

```dockerfile
# Install gaussian-splatting extensions (for reference/comparison)
RUN cd /opt/gaussian-splatting && \
    TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation submodules/diff-gaussian-rasterization && \
    TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation submodules/simple-knn && \
    TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation submodules/fused-ssim

# Install LongSplat extensions (these are the ones actually used)
RUN cd /opt/LongSplat/submodules && \
    TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation ./simple-knn && \
    TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation ./diff-gaussian-rasterization && \
    TORCH_CUDA_ARCH_LIST="8.9" python3.10 -m pip install --no-build-isolation ./fused-ssim
```

---

## 🔍 Additional Verification Needed

### 1. MASt3R Submodule

**Check:** Is `submodules/mast3r` properly initialized?

```bash
ls -la /opt/LongSplat/submodules/mast3r/
```

**Expected:** Full MASt3R repository structure (not empty)

### 2. DUST3R Dependency

**Check:** Is DUST3R (used by MASt3R) properly available?

```bash
python3.10 -c "import dust3r; print('DUST3R OK')"
```

### 3. LongSplat Imports

**Check:** Can we import LongSplat modules?

```bash
cd /opt/LongSplat
python3.10 -c "from scene import Scene; print('Scene OK')"
python3.10 -c "from gaussian_renderer import render; print('Renderer OK')"
python3.10 -c "from arguments import ModelParams; print('Args OK')"
```

---

## 📝 Testing Checklist

After applying fixes, verify:

- [ ] `git clone --recursive` successful
- [ ] All submodules present: `git submodule status`
- [ ] LongSplat's simple-knn installed (not symlinked)
- [ ] LongSplat's diff-gaussian-rasterization installed (not symlinked)
- [ ] LongSplat's fused-ssim installed
- [ ] MASt3R submodule fully initialized
- [ ] DUST3R available
- [ ] RoPE kernels compiled (or fallback working)
- [ ] All Python imports work
- [ ] `train.py` can be executed
- [ ] `convert_3dgs.py` available

---

## 🎯 Impact Analysis

### Current Impact of Symlink Issue

**Potential Problems:**
1. **Import Errors:** Python may not find modules due to path issues
2. **Version Conflicts:** gaussian-splatting submodules may be incompatible with LongSplat
3. **Runtime Failures:** Training may fail due to API mismatches
4. **Subtle Bugs:** Different behavior than official LongSplat

**Why This Matters:**
- LongSplat is research code with specific dependency versions
- The repository was tested with its own submodules
- Cross-linking can introduce unpredictable behavior

### Expected After Fix

- ✅ Matches official LongSplat installation
- ✅ No version conflicts
- ✅ Predictable behavior
- ✅ Easier debugging (matches upstream)
- ✅ Better community support (follows standard setup)

---

## 🚀 Recommended Action Plan

### Immediate (High Priority)

1. **Update Dockerfile** - Use LongSplat's own submodules
2. **Rebuild Image** - Fresh build with correct submodules
3. **Test Imports** - Verify all modules load correctly
4. **Test Training** - Run with sample video

### Short-term (Medium Priority)

1. **Remove gaussian-splatting Dependency** - If not needed elsewhere
2. **Streamline Build** - Reduce build time by removing redundant steps
3. **Document Versions** - Pin exact versions for reproducibility

### Long-term (Low Priority)

1. **CI/CD Testing** - Automated tests for submodule integrity
2. **Version Pinning** - Lock LongSplat to specific commit
3. **Update Strategy** - Plan for tracking LongSplat updates

---

## 📚 References

- **LongSplat Repository:** https://github.com/NVlabs/LongSplat
- **LongSplat Paper:** https://linjohnss.github.io/longsplat/
- **Installation Guide:** See README.md in repository
- **ICCV 2025 Paper:** [LongSplat: Robust Unposed 3D Gaussian Splatting](https://linjohnss.github.io/longsplat/)

---

## ✅ Summary

**Current Status:** ⚠️ **PARTIALLY CORRECT**

**Critical Issues:**
1. ❌ Using gaussian-splatting submodules instead of LongSplat's own
2. ❌ Potential version/API mismatches

**Recommended Fix:**
- Use LongSplat's own submodules (simple-knn, diff-gaussian-rasterization)
- Build them independently
- Remove symlinks

**Priority:** 🔴 **HIGH** - Should be fixed before production deployment

**Estimated Impact:** May cause training failures or unexpected results

---

*Audit completed on January 26, 2026 by comparing against official [LongSplat repository](https://github.com/NVlabs/LongSplat)*
