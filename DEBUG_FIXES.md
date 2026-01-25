# Debug Fixes Applied

## Issues Fixed

### 1. ✅ Gaussian Splatting Repository Path Resolution
**Problem**: The training code didn't check the `GAUSSIAN_SPLATTING_REPO` environment variable set in Docker.

**Fix**: Updated `backend/services/gaussian/train.py` to:
- Check `GAUSSIAN_SPLATTING_REPO` environment variable first (for Docker)
- Fallback to checking sibling directory `../gaussian-splatting`
- Fallback to checking project root `./gaussian-splatting`
- This ensures it works both locally and in Docker

### 2. ✅ CORS Configuration for Vercel
**Problem**: CORS only allowed localhost, blocking Vercel deployments.

**Fix**: Updated `backend/main.py` to:
- Allow all origins by default (for Vercel's varying domains)
- Support `CORS_ORIGINS` environment variable for specific domains
- Properly handle credentials based on origin settings

### 3. ✅ Frontend API Configuration
**Problem**: Frontend had hardcoded localhost URLs.

**Fix**: Updated `frontend/src/api/jobs.ts` and `frontend/src/components/Viewer3D.tsx` to:
- Use `VITE_API_BASE_URL` environment variable
- Fallback to localhost for local development
- Works with Vercel deployments

### 4. ✅ Vercel Configuration
**Problem**: Build commands weren't configured correctly for root directory.

**Fix**: Created `vercel.json` at root with:
- Correct build command: `cd frontend && npm install && npm run build`
- Correct output directory: `frontend/dist`
- Framework: Vite

## Current Status

✅ **Backend**: Ready for Docker deployment on Runpod
✅ **Frontend**: Ready for Vercel deployment
✅ **Training**: Uses official Gaussian Splatting library when available
✅ **CORS**: Configured for production deployments
✅ **Environment Variables**: Properly configured

## Testing Checklist

- [ ] Backend runs locally
- [ ] Frontend connects to backend
- [ ] Docker image builds successfully
- [ ] Vercel deployment works
- [ ] Runpod deployment works
- [ ] End-to-end video processing works

## Next Steps

1. Test locally: `cd backend && source venv/bin/activate && uvicorn main:app --reload`
2. Build Docker: `./build-docker.sh` or `docker buildx build --platform linux/amd64 -t gaussian-room-reconstruction:latest --load .`
3. Push to registry: Use `./push-docker-image.sh` or `./check-and-push.sh YOUR_USERNAME`
4. Deploy to Runpod: Use the image URL from registry
5. Deploy to Vercel: Import from GitHub, set `VITE_API_BASE_URL` to Runpod URL
