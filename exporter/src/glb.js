import { Document } from "@gltf-transform/core";
import { rgbaForColorIndex } from "./palettes.js";

export function colorFor(colorIndex, paletteName = "6bit") {
  return rgbaForColorIndex(colorIndex, paletteName);
}

export function addVoxelMesh(doc, scene, mat, voxels, centerOffset = 0.0) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const cubeCount = voxels.length;
  if (!cubeCount) return;

  const positions = new Float32Array(cubeCount * 8 * 3);
  const indices = new Uint32Array(cubeCount * 36);

  const half = 0.5;
  const faceIndices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 5, 1, 0, 4, 5,
    3, 2, 6, 3, 6, 7,
    0, 3, 7, 0, 7, 4,
    1, 5, 6, 1, 6, 2,
  ];

  for (let i = 0; i < cubeCount; i++) {
    const { x, y, z } = voxels[i];
    const cx = x + centerOffset;
    const cy = y + centerOffset;
    const cz = z + centerOffset;

    const vBase = i * 8;
    const pBase = i * 8 * 3;
    const iBase = i * 36;

    positions.set(
      [
        cx - half, cy - half, cz - half,
        cx + half, cy - half, cz - half,
        cx + half, cy + half, cz - half,
        cx - half, cy + half, cz - half,
        cx - half, cy - half, cz + half,
        cx + half, cy - half, cz + half,
        cx + half, cy + half, cz + half,
        cx - half, cy + half, cz + half,
      ],
      pBase
    );

    for (let j = 0; j < 36; j++) indices[iBase + j] = vBase + faceIndices[j];
  }

  const positionAcc = doc.createAccessor().setArray(positions).setType("VEC3").setBuffer(buffer);
  const indexAcc = doc.createAccessor().setArray(indices).setType("SCALAR").setBuffer(buffer);

  const prim = doc.createPrimitive()
    .setAttribute("POSITION", positionAcc)
    .setIndices(indexAcc)
    .setMaterial(mat);

  const mesh = doc.createMesh().addPrimitive(prim);
  const node = doc.createNode().setMesh(mesh);
  scene.addChild(node);
}

export function makeDocAndScene() {
  const doc = new Document();
  const scene = doc.createScene("Scene");
  doc.createBuffer();
  return { doc, scene };
}
