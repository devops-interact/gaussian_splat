# Viewer 3D canvas — performance audit (SuperSplat-inspired)

This document implements the **learn, don’t merge** audit: we compare our **Three.js + `@mkkellogg/gaussian-splats-3d`** viewer to patterns in **[playcanvas/supersplat](https://github.com/playcanvas/supersplat)** (PlayCanvas + custom splat stack). SuperSplat is **not** integrated or vendored; paths below refer to a **read-only clone** for research (e.g. `/tmp/supersplat-audit-readonly` or your own shallow clone).

**Primary code in this repo:** [`frontend/src/components/Viewer3D.tsx`](../frontend/src/components/Viewer3D.tsx), [`frontend/src/lib/splatPick.ts`](../frontend/src/lib/splatPick.ts), [`frontend/src/types/gaussian-splats-3d.d.ts`](../frontend/src/types/gaussian-splats-3d.d.ts).

---

## 1. Internal inventory (knobs and black boxes)

### 1.1 `Viewer` constructor options ([`Viewer3D.tsx`](../frontend/src/components/Viewer3D.tsx) ~L912–927)

| Option | Value / rule | Notes |
|--------|----------------|-------|
| `cameraUp` | From initial camera API or bbox fallback | Y-up vs OpenCV-style |
| `initialCameraPosition` / `initialCameraLookAt` | From API or bbox | Scaled by `VITE_VIEWER_SCENE_SCALE` |
| `rootElement` | Container ref | Library creates its own canvas |
| `selfDrivenMode` | `true` | Library owns RAF/render loop |
| `useBuiltInControls` | `true` | OrbitControls inside GS3D |
| `integerBasedSort` | `false` | Candidate to benchmark vs `true` on large scenes |
| `sceneRevealMode` | `Default` if progressive, else `Instant` | Tied to vertex threshold |
| `antialiased` | `true` | **Contrast:** SuperSplat uses `antialias: false` on WebGL2 ([`main.ts`](https://github.com/playcanvas/supersplat/blob/main/src/main.ts)) |
| `freeIntermediateSplatData` | `false` | Likely higher memory, possibly faster path — **black box** inside library |
| `logLevel` | `LogLevel.Info` | |
| `sphericalHarmonicsDegree` | `2` at ctor; live SH 0–2 via `setActiveSphericalHarmonicsDegrees` | UI Display panel |
| `gpuAcceleratedSort` | `true` only if `crossOriginIsolated && !VITE_GS3D_FORCE_LEGACY_WORKERS` | **Largest perf lever** when COEP works |
| `sharedMemoryForWorkers` | Same gate as GPU sort | `SharedArrayBuffer` path |

**Library black box:** splat sort, rasterization, internal buffer layout, and exact worker behavior live inside `@mkkellogg/gaussian-splats-3d` (see package README / source on npm).

### 1.2 `addSplatScene` options (same file ~L949–954)

| Option | Value | Notes |
|--------|--------|-------|
| `splatAlphaRemovalThreshold` | `loadMinAlpha` (Display panel, debounced reload) | |
| `showLoadingUI` | `false` | |
| `progressiveLoad` | `vertexCount >= 50_000` (`PROGRESSIVE_VERTEX_THRESHOLD`) | Time-to-first-frame vs peak work |
| `format` | `2` | PLY |
| `orientation` | From metadata / heuristic | Passed as `Record<string, unknown>` |
| **Not passed from our code** | `streamView`, `position`, `rotation`, `scale` per typings | Experiment only with QA |

### 1.3 `PlyLoader.loadFromURL` (`.ksplat` download path only, ~L1874–1882)

Used for **client-side ksplat export**, not the main viewer load (viewer uses `addSplatScene` on a blob URL).

| Param | Our value | Notes |
|-------|-----------|-------|
| `progressiveLoadToSplatBuffer` | `false` | Could try `true` for huge PLY if memory allows |
| `compressionLevel` | `1` | Room to tune vs file size |
| `optimizeSplatData` | `true` | |
| `outSphericalHarmonicsDegree` | From `shDisplayDegree` | 0–2 |
| `sectionSize`, `blockSize`, `bucketSize`, `headers` | Not passed | **Undersused API surface** for experiments |

### 1.4 Picking and measure ([`splatPick.ts`](../frontend/src/lib/splatPick.ts), `Viewer3D`)

| Constant / behavior | Value | Notes |
|----------------------|-------|-------|
| `PICK_RADIUS_PX` | `28` | Physical pixels on shorter render axis |
| `CENTER_GRID_MIN_SPLATS` | `50_000` | Spatial grid for center-cache picking |
| `maxSplatPickDistance` | `bbox diagonal × 4` (min 3) | Scaled by scene scale in viewer |
| GS3D raycast | `intersectSplatMesh`; optional `raycastAgainstTrueSplatEllipsoid` | Set after `viewer.start()` when supported (not used for measure placement when `splatCentersOnly`) |
| `getRenderDimensions` | Used when non-zero vs canvas backing store | Pick alignment |
| Measure hover | `MEASURE_HOVER_MIN_MS = 100`, `MEASURE_PREVIEW_MOVE_EPS = 0.03` | Reduces pick churn |
| Measure snap | `pickSplatMeasure` + `splatCentersOnly`: cone over **world center cache** only | No proxy mesh; cost is center-cache traversal / grid buckets vs splat count |

### 1.5 Deployment levers ([`ARCHITECTURE.md`](../ARCHITECTURE.md), [`frontend/vercel.json`](../frontend/vercel.json))

- **COOP + COEP** enable GPU sort + shared workers when `crossOriginIsolated === true`.
- **`VITE_GS3D_FORCE_LEGACY_WORKERS`** forces CPU sort path — smoother on broken isolation, heavier main thread.

---

## 2. SuperSplat pattern list (read-only research)

Observations from **shallow clone** of `playcanvas/supersplat` (`src/`). Engine: **PlayCanvas** (`PCApp` extends `AppBase`), not Three.js — patterns are **conceptual** transfer, not copy-paste.

| Theme | SuperSplat location | Pattern |
|-------|---------------------|---------|
| Graphics device | [`src/main.ts`](https://github.com/playcanvas/supersplat/blob/main/src/main.ts) `createGraphicsDevice` | `deviceTypes: ['webgl2']`, **`antialias: false`**, **`depth: false`**, `stencil: false`, **`powerPreference: 'high-performance'`** — aggressive minimization of default framebuffer cost |
| Frame / render | [`src/render.ts`](https://github.com/playcanvas/supersplat/blob/main/src/render.ts) | Offscreen capture, `postrender` waits, optional overlay/gizmo toggles during export — **separates one-shot heavy work from interactive loop** |
| Scene / sort | [`src/scene.ts`](https://github.com/playcanvas/supersplat/blob/main/src/scene.ts) | **`SORTMODE_CUSTOM`** + `specialSort` using AABB corners vs camera — explicit **per-frame sort policy** under app control |
| Picking | [`src/picker.ts`](https://github.com/playcanvas/supersplat/blob/main/src/picker.ts) | **`RenderPassPicker`**, dedicated RTs for ID/depth — GPU picking path, not ray-march vs splats only |
| Load pipeline | [`src/asset-loader.ts`](https://github.com/playcanvas/supersplat/blob/main/src/asset-loader.ts) | **`@playcanvas/splat-transform`**, `loadGSplatData`, **`skipReorder`** for animation frames (speed) — **async load + spinner events**, explicit validation |
| WebGPU | [`src/splat-serialize.ts`](https://github.com/playcanvas/supersplat/blob/main/src/splat-serialize.ts) (grep) | WebGPU used for **SOG compression** paths when available — optional accelerator for **offline-style** work, not primary WebGL2 path in `main.ts` |
| Editor surface | [`src/ui/editor.ts`](https://github.com/playcanvas/supersplat/blob/main/src/ui/editor.ts), tools under `src/tools/` | Rich selection/measure; **debouncing** and tool manager — compare to our single measure mode + throttles |

**Attribution:** SuperSplat is MIT licensed; this audit cites architecture only.

---

## 3. Gap matrix

| Theme | SuperSplat (conceptual) | Ours (GS3D + Three) | Gap | Risk if we change |
|-------|-------------------------|---------------------|-----|---------------------|
| GPU device setup | Explicit WebGL2, AA off, depth off where possible | Three renderer inside GS3D; **`antialiased: true`** | We may pay MSAA / compositor cost we never A/B tested | Low: try `antialiased: false` behind env |
| Sort | Custom sort mode, splat layer control | Library internal GPU/CPU sort + workers | No fine-grained sort policy in app code | High if we fork library |
| Picking | GPU picker RT pass | GS3D raycast + ellipsoid option + center grid fallback | Different accuracy/perf tradeoff | Medium: ellipsoid already toggled |
| Load / reorder | `skipReorder` for sequences; splat-transform | PLY blob → `addSplatScene`; progressive at 50k | No `streamView`; ksplat path uses different PlyLoader args | Medium: experiment `streamView` / section sizes with QA |
| Memory vs speed | GSplat resource lifecycle in PlayCanvas | `freeIntermediateSplatData: false` | Unknown peak memory on 1M+ splats | Medium: only change with profiling |
| COEP / workers | N/A (different stack) | **Critical** for GS3D GPU sort | Ops must keep COEP + CORP story correct | Low for docs; high if misconfigured |
| Measure overlay | N/A (editor selects splats) | Mid-poly mesh + Raycaster | Extra geometry + picks | Low–medium: throttle / LOD overlay |

---

## 4. Measurement protocol (before code changes)

1. **Browser:** Chrome (or target browser), DevTools **Performance** — record 10–20 s while **orbiting**, then while **measure hover**.
2. **Tiers:** Same PLY bucketed by splat count: **&lt;50k**, **50k–200k**, **&gt;200k** (50k aligns with `PROGRESSIVE_VERTEX_THRESHOLD`).
3. **A/B flags:** Document for each run: `crossOriginIsolated` (Application → Frames), **`VITE_GS3D_FORCE_LEGACY_WORKERS`** build flag, **`VITE_VIEWER_SCENE_SCALE`**.
4. **Metrics to note:** Long tasks (&gt;50 ms), **GPU** row, frame duration, JS heap (Memory tab) after load settles.
5. **Regression:** After any viewer flag change, verify **pick alignment** (console `[Pick:dims]` per README) and **measure** two-point calibration + distance on splat-center snaps.

---

## 5. Prioritized optimization backlog

| ID | Priority | Hypothesis | Probe | Acceptance (example) |
|----|----------|------------|-------|-------------------------|
| H0 | P0 | GPU sort + shared workers dominate interactive perf when COEP on | Compare same scene with legacy workers on/off | Document FPS / long-task delta; no pick regression |
| H1 | P1 | `antialiased: false` improves FPS on Retina | One env-gated build | Visual quality acceptable; picks unchanged |
| H2 | P1 | `freeIntermediateSplatData: true` lowers memory with acceptable cost | Large PLY only, memory timeline | No OOM; load still completes |
| H3 | P1 | `PROGRESSIVE_VERTEX_THRESHOLD` wrong for product mix | A/B 35k / 50k / 75k | TTF vs jank tradeoff documented |
| H4 | P2 | PlyLoader `sectionSize` / `blockSize` / `bucketSize` help ksplat export or memory | Read GS3D README + small experiment | Export still valid; tests pass |
| H5 | P2 | `integerBasedSort: true` helps on huge scenes | Benchmark | Sort stability + visual check |
| H6 | P2 | Stronger measure hover throttle reduces main-thread spikes | Tune `MEASURE_HOVER_MIN_MS` | Measure UX still responsive |
| H7 | P3 | Default SH degree / splat scale presets per tier | UX + FPS | Document presets only |

---

## 6. Wave 1 (bounded implementation after sign-off)

**Scope:** At most **1–2** low-risk changes, preferably behind **`import.meta.env.VITE_*`** or existing env patterns.

**Recommended first candidates:**

1. **`VITE_VIEWER_ANTIALIAS=false`** (or similar) → maps to `antialiased: false` in `Viewer` ctor when set — aligns with SuperSplat’s default graphics minimalism; easy A/B.
2. **Document-only / threshold:** Add dev-only log of `vertexCount` vs progressive decision (already partially logged) and capture in QA checklist — no behavior change.

**Out of scope for Wave 1:** Replacing GS3D, adding PlayCanvas, embedding SuperSplat iframe (separate product decision).

---

## 7. Optional product follow-up

- **“Edit in SuperSplat”** link opening [superspl.at/editor](https://superspl.at/editor) with user-exported PLY — no engine merge, clear UX boundary.

---

## 8. Revision log

| Date | Action |
|------|--------|
| 2026-04-14 | Initial audit: internal inventory, SuperSplat shallow-clone patterns, gap matrix, metrics, backlog, Wave 1 |
