# 🚀 RunPod Deployment Settings

## ✅ GitHub Push: COMPLETE
Repository: `https://github.com/devops-interact/gaussian_splat.git`  
Commit: `e6547e0` - Production-ready with LongSplat integration

---

## 🐳 Docker Build: IN PROGRESS
Image: `interactdevops/gaussian-room-reconstruction:latest`  
Platform: `linux/amd64` (RunPod RTX 4090)  
Status: Building... (Est. 30-60 minutes)

**Monitor build:**
```bash
tail -f /tmp/docker-build-*.log
```

---

## 📋 RUNPOD POD SETTINGS

### Container Configuration

```yaml
Container Image: interactdevops/gaussian-room-reconstruction:latest
```

### GPU & Compute

```yaml
GPU Type: RTX 4090
GPU Count: 1
VRAM: 24GB
```

### Storage

```yaml
Container Disk (Temporary): 20 GB
Volume Disk (Persistent): 50 GB
Volume Mount Path: /app/storage
```

### Network Ports

```yaml
Expose HTTP Ports: 8000
Expose TCP Ports: 22
```

### Environment Variables

**None required** - All configuration is built into the image.

*(Optional overrides available:)*
- `LONGSPLAT_ITERATIONS=30000` - Training iterations (default: 30000)
- `FRAME_EXTRACTION_FPS=2.0` - Frames per second (default: 2.0)

---

## 🎯 EXACT RUNPOD CONFIGURATION

### Step-by-Step Pod Creation

1. **Go to RunPod Console**
   - URL: https://www.runpod.io/console/pods

2. **Click "Deploy" or "+" to create new pod**

3. **Select GPU**
   - Choose: **RTX 4090** (24GB VRAM)
   - Region: Any available

4. **Template: Custom**
   - Click "Edit Template" or "Custom"

5. **Container Settings:**

   | Field | Value |
   |-------|-------|
   | Container Image | `interactdevops/gaussian-room-reconstruction:latest` |
   | Docker Command | *(leave empty - uses default CMD)* |
   | Container Disk | `20` GB |
   | Volume Disk | `50` GB |
   | Volume Mount Path | `/app/storage` |

6. **Expose Ports:**

   | Type | Port | Description |
   |------|------|-------------|
   | HTTP | `8000` | API endpoint |
   | TCP | `22` | SSH (optional) |

7. **Environment Variables:**
   - Click "+ Environment Variable"
   - Leave empty (defaults are configured)
   - OR add optional overrides:
     - Key: `LONGSPLAT_ITERATIONS` Value: `30000`
     - Key: `FRAME_EXTRACTION_FPS` Value: `2.0`

8. **Click "Deploy"**

---

## ✅ Post-Deployment Verification

### 1. Wait for Pod Startup (2-3 minutes)

The pod will:
- Pull the Docker image (~12-15 GB)
- Start the container
- Initialize the FastAPI server

### 2. Get Your Pod URL

RunPod will provide:
- **API URL:** `https://your-pod-id-8000.proxy.runpod.net`
- **SSH URL:** `ssh://your-pod-id@ssh.runpod.io:12345` (if TCP port exposed)

### 3. Health Check

```bash
curl https://your-pod-id-8000.proxy.runpod.net/health
```

**Expected Response:**
```json
{"status":"healthy"}
```

### 4. Test GPU Access (SSH)

```bash
# SSH into pod (if TCP port 22 exposed)
ssh root@your-pod-id-ssh.runpod.io -p PORT

# Check GPU
nvidia-smi

# Expected: RTX 4090 with 24GB VRAM
```

### 5. Test Video Upload

```bash
# Upload a test video
curl -X POST https://your-pod-id-8000.proxy.runpod.net/api/jobs/upload \
  -F "file=@/path/to/your/video.mp4"
```

**Expected Response:**
```json
{
  "job_id": "uuid-here",
  "status": "pending",
  "video_filename": "uuid-here.mp4",
  "created_at": "2026-01-26T...",
  "progress": 0.0
}
```

### 6. Monitor Job Status

```bash
# Check job status
curl https://your-pod-id-8000.proxy.runpod.net/api/jobs/{job_id}/status
```

### 7. View Logs (SSH)

```bash
# SSH into pod
ssh root@your-pod-id-ssh.runpod.io -p PORT

# View logs
tail -f /app/storage/logs/app.log

# Or check job history
cat /app/storage/logs/jobs.json | jq
```

---

## 📊 Expected Processing Times

| Video Length | Frames | Extraction | Training | Total |
|--------------|--------|------------|----------|-------|
| 30 seconds | ~60 | 15s | 12m | ~13m |
| 60 seconds | ~120 | 25s | 25m | ~26m |
| 120 seconds | ~240 | 45s | 50m | ~52m |

---

## 🔧 Troubleshooting

### Pod Won't Start

**Check:**
- Image name is correct: `interactdevops/gaussian-room-reconstruction:latest`
- Volume mount path is exactly: `/app/storage`
- HTTP port is: `8000`

### Health Check Fails

**Wait 2-3 minutes** for full startup, then check:
```bash
# Check if container is running
# (in RunPod terminal or SSH)
ps aux | grep uvicorn

# Expected: python3.10 -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### Training Fails

**Check logs:**
```bash
tail -200 /app/storage/logs/app.log
```

**Common issues:**
- GPU not available: Check `nvidia-smi`
- Out of memory: Use shorter video
- Bad video quality: Use 1080p+ resolution

---

## 💰 Cost Estimate

**RTX 4090 Pod on RunPod:**
- **Hourly Rate:** ~$0.40-0.60/hour (varies by region)
- **Per Job:** ~$0.10-0.30 (10-30 minutes training)
- **Daily (24/7):** ~$10-15/day

**Recommendations:**
- Use **Spot Instances** for lower cost (~50% cheaper)
- **Auto-stop** when idle to save costs
- Consider **Reserved Instances** for high volume

---

## 🎓 API Usage Examples

### Upload Video
```bash
curl -X POST https://YOUR-POD-8000.proxy.runpod.net/api/jobs/upload \
  -F "file=@video.mp4"
```

### Check Status
```bash
curl https://YOUR-POD-8000.proxy.runpod.net/api/jobs/{JOB_ID}/status
```

### List All Jobs
```bash
curl https://YOUR-POD-8000.proxy.runpod.net/api/jobs
```

### Download Model
```bash
curl -O https://YOUR-POD-8000.proxy.runpod.net/static/models/{JOB_ID}.ply
```

---

## 📱 Frontend Integration

Update your frontend API URL:

```typescript
// frontend/src/api/jobs.ts
const API_BASE_URL = 'https://your-pod-id-8000.proxy.runpod.net';
```

Then deploy frontend to Vercel:
```bash
cd frontend
npm run build
vercel --prod
```

---

## 🔐 Security Notes

1. **No Authentication** - Add auth middleware if public
2. **Rate Limiting** - Consider adding rate limits
3. **File Validation** - Validates video format/size
4. **CORS** - Configured for all origins (adjust for production)

---

## ✅ CHECKLIST

- [ ] Docker build completes successfully
- [ ] Image pushed to Docker Hub
- [ ] Pod created with settings above
- [ ] Pod starts successfully (2-3 minutes)
- [ ] Health check returns `{"status":"healthy"}`
- [ ] Test video upload succeeds
- [ ] Training completes and generates PLY file
- [ ] Model downloadable
- [ ] Frontend updated with pod URL
- [ ] Frontend deployed to Vercel

---

## 📞 Support Resources

- **LongSplat Issues:** https://github.com/NVlabs/LongSplat/issues
- **RunPod Support:** https://discord.gg/runpod
- **Project Repository:** https://github.com/devops-interact/gaussian_splat

---

**Ready to deploy!** 🚀

*Settings prepared on January 26, 2026*
