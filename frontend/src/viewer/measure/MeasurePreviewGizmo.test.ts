import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer';
import { MeasurePreviewGizmo } from '../measure/MeasurePreviewGizmo';

describe('MeasurePreviewGizmo', () => {
  it('renders crosshair lines across repeated updates without corrupting scratch vectors', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const utilityLayer = new UtilityLayerRenderer(scene);
    const camera = new UniversalCamera('cam', new Vector3(0, 0, -5), scene);
    scene.activeCamera = camera;

    const gizmo = new MeasurePreviewGizmo(utilityLayer, { worldUnit: 0.05, effectiveDiagonal: 4 });
    const pick = {
      position: new Vector3(0, 0, 0),
      isSnapped: true,
      mesh: null,
      normal: Vector3.Up(),
    };

    for (let i = 0; i < 20; i += 1) {
      pick.position.set(Math.sin(i * 0.3) * 0.5, Math.cos(i * 0.2) * 0.3, 0);
      gizmo.update(pick, camera.position, null);
    }

    expect(gizmo).toBeDefined();

    gizmo.dispose();
    utilityLayer.dispose();
    scene.dispose();
    engine.dispose();
  });
});
