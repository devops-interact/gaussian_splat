import type { AbstractMesh } from '@babylonjs/core';
import type { BabylonViewerCtx } from '../types';

/** Collect unique geometry meshes including child submeshes. */
export function collectSceneGeometryMeshes(ctx: BabylonViewerCtx): AbstractMesh[] {
  const seen = new Set<AbstractMesh>();
  const out: AbstractMesh[] = [];

  const add = (mesh: AbstractMesh) => {
    if (seen.has(mesh)) return;
    seen.add(mesh);
    out.push(mesh);
    for (const child of mesh.getChildMeshes(false)) {
      if (child.getTotalVertices() > 0) add(child);
    }
  };

  for (const mesh of ctx.geometryMeshes) add(mesh);
  for (const mesh of ctx.shellMeshes) add(mesh);
  for (const { geometryMeshes } of ctx.zoneMeshes) {
    for (const mesh of geometryMeshes) add(mesh);
  }

  return out;
}
