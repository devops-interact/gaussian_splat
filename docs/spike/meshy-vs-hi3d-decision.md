# Spike: Meshy vs Hi3D — Decision Gate

**Date:** 2026-08-19  
**Decision:** **Meshy** (primary provider)

## Evaluation criteria

| Criterion | Meshy | Hi3D | Winner |
|---|---|---|---|
| Multi-view from casual video keyframes | 1–4 free-order images | Max 4, fixed front/back/left/right order | Meshy |
| REST integration complexity | Bearer API key, JSON body | Token + multipart form | Meshy |
| Web mesh control | `target_polycount`, `smart-topology` | `face` count 100k–5M | Meshy |
| Output for Babylon viewer | GLB native, PBR optional | GLB/OBJ, PBR optional | Tie |
| Cost (textured job) | ~30 credits (~$0.30–0.60) | v2.1 fast $0.50; v3.0 $2.10+ | Meshy (balanced tier) |
| Documentation / DX | Excellent | Good, less accessible | Meshy |
| Room reconstruction fidelity | Object-centric mesh | Object-centric mesh | Tie (both limited) |

## Conclusion

Both APIs produce **textured meshes from 1–4 views**, not full room Gaussian splats. For our pipeline (video → FFmpeg keyframes → multi-image API), **Meshy Multi-Image-to-3D** is the better fit because:

1. Keyframes from room walkthroughs do not map to Hi3D's canonical front/back/left/right views.
2. Meshy offers finer browser-oriented polycount control.
3. Simpler async job lifecycle (create → poll → download GLB).

Hi3D remains documented as a **fallback** if production quality tests fail on real room videos.

## Recommended Meshy presets (production)

| Preset | ai_model | texture | PBR | resolution | target_polycount | ultra_mode |
|---|---|---|---|---|---|---|
| fast | meshy-6 | yes | no | 2k | 30,000 | false |
| balanced | meshy-7 | yes | yes | 2k | 50,000 | false |
| quality | meshy-7 | yes | yes | 4k | 100,000 | true |

## POC script

Run against a local video (requires `MESHY_API_KEY`):

```bash
cd backend
python scripts/spike/compare_apis.py --video ../samples/room.mp4 --provider meshy
```
