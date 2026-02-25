// src/export-tile.js
// One exporter for Etheria v0.9 / v1.0 / v1.1 / v1.2
// Mode=auto tries NEW-build decode from tile name, falls back to OLD blocks.
// IMPORTANT UPDATE: supports --name-raw to force NEW build decode when getName()
// does not include a literal "0x..." blob.
//
// Usage examples:
//   node src/export-tile.js --rpc https://ethereum.publicnode.com --version 1.2 --tile 530 --out tile_530_v12.glb
//   node src/export-tile.js --rpc https://ethereum.publicnode.com --version 0.9 --tile 530 --mode old --out tile_530_v09_old.glb
//   node src/export-tile.js --rpc https://ethereum.publicnode.com --version 1.2 --tile 530 --mode new --name-raw 0x... --out tile_530_v12_new.glb
//
// Requires your existing helpers:
//   - src/glb.js exporting: addVoxelMesh, makeDocAndScene, colorFor
// Palette names depend on your src/palettes.js (e.g. voxelizer, classic, debug16, 6bit).

import { Command } from "commander";
import { ethers } from "ethers";
import { NodeIO } from "@gltf-transform/core";
import zlib from "zlib";
import { addVoxelMesh, makeDocAndScene, colorFor } from "./glb.js";

// ---------- Version config (Etheria map contract + BDS) ----------
const VERSIONS = {
  "0.9": {
    etheria: "0xe468d26721b703d224d05563cb64746a7a40e1f4",
    bds: "0x782bdf7015b71b64f6750796dd087fde32fd6fdc",
  },
  "1.0": {
    etheria: "0xe414716f017b5c1457bf98e985bccb135dff81f2",
    bds: "0x782bdf7015b71b64f6750796dd087fde32fd6fdc",
  },
  "1.1": {
    etheria: "0x169332ae7d143e4b5c6baedb2fef77bfbddb4011",
    bds: "0xd4e686a1fbf1bfe058510f07cd3936d3d5a70589",
  },
  "1.2": {
    etheria: "0xb21f8684f23dbb1008508b4de91a0aaedebdb7e4",
    bds: "0xd4e686a1fbf1bfe058510f07cd3936d3d5a70589",
  },
};

// ---------- ABIs ----------
const etheriaAbi = [
  "function getBlocks(uint8 col, uint8 row) view returns (int8[5][])",
  "function getName(uint8 col, uint8 row) view returns (string)",
];

const bdsAbi = ["function getOccupies(uint8 which) view returns (int8[24])"];

// ---------- Tile mapping ----------
const MAPSIZE = 33;
function tileToColRow(tile) {
  const col = Math.floor(tile / MAPSIZE);
  const row = tile % MAPSIZE;
  return { col, row };
}

// ---------- OLD build helpers ----------
function occupiesToTriplets(int8_24) {
  const triplets = [];
  for (let i = 0; i < 24; i += 3) {
    triplets.push([Number(int8_24[i]), Number(int8_24[i + 1]), Number(int8_24[i + 2])]);
  }
  return triplets;
}

// ---------- NEW build helpers ----------
const GRID_Z = 133;
const GRID_X = 1 + (GRID_Z - 1) * 0.75; // 100

function getNumberOfPillarsInclusiveNthRow(n) {
  return n + 1 + 3 * n * (n + 1) * 0.5;
}
function getNumberOfPillarsInNthRow(n) {
  return 1 + n * 3;
}
function calcPillarCount() {
  const corners = ((GRID_Z - 1) * 0.25 + 1) * (GRID_X + 1);
  const center = ((GRID_Z + 1) * 0.5 - 2 - 1) * (GRID_X - 0.5) + (GRID_X - 1);
  return corners + center;
}
const PILLAR_COUNT = calcPillarCount(); // 9901

const FULL_GRIDY = 128;
const FULL_VOXEL_COUNT = PILLAR_COUNT * FULL_GRIDY; // 1,267,328
const HALF_VOXEL_BYTES = FULL_VOXEL_COUNT / 2; // 633,664 packed16 (two voxels per byte)

// getName() usually returns a string containing an 0x.... run; pull it out.
function extract0xHexRun(s) {
  const m = String(s).match(/0x[0-9a-fA-F]+/);
  return m ? m[0] : null;
}

function decodeNameRawHexToBlobBytes(nameRawHex) {
  let hex = String(nameRawHex).trim();
  if (!hex.startsWith("0x") && !hex.startsWith("0X")) throw new Error("nameRAW must start with 0x");
  hex = hex.slice(2).replace(/[^0-9a-fA-F]/g, "");
  if (hex.length % 2 === 1) hex = "0" + hex;
  return Buffer.from(hex, "hex");
}

function findZlibStart(blobBytes, nameLen) {
  const titleEnd = 1 + nameLen;
  for (let i = titleEnd; i < Math.min(blobBytes.length - 2, titleEnd + 512); i++) {
    const b0 = blobBytes[i],
      b1 = blobBytes[i + 1];
    if (b0 === 0x78 && (b1 === 0x01 || b1 === 0x5e || b1 === 0x9c || b1 === 0xda)) return i;
  }
  return -1;
}

function detectGridY(inflatedLen) {
  if (inflatedLen % PILLAR_COUNT !== 0) return null;
  const gridY = inflatedLen / PILLAR_COUNT;
  if (gridY < 1 || gridY > 512) return null;
  return gridY;
}

// Voxelizer coordinate mapping with variable GRID_Y.
function discretePosFromGridIndex(gridIndex, GRID_Y) {
  const y = gridIndex % GRID_Y;
  const pillarIndex = (gridIndex - y) / GRID_Y;

  const pillarIndex_center = (PILLAR_COUNT - 1) / 2;
  const pillarIndex_maxInc = 33 + 1 + 3 * ((33 * (33 + 1)) / 2);
  const pillarIndex_minDec = PILLAR_COUNT - pillarIndex_maxInc;

  let x, z;

  if (pillarIndex < pillarIndex_maxInc) {
    const zOffset = Math.ceil((1 / 6) * (Math.sqrt(24 * (pillarIndex + 1) + 1) - 5));
    const sumPrev = getNumberOfPillarsInclusiveNthRow(zOffset);
    x = pillarIndex - sumPrev + Math.ceil(getNumberOfPillarsInNthRow(zOffset) / 2);
    z = zOffset - 66;
  } else if (pillarIndex < pillarIndex_minDec) {
    const off = pillarIndex - pillarIndex_center;
    x = Math.floor(off - Math.round(off / 99.5) * 99.5);
    z = Math.round((off - x) / 99.5);
  } else {
    const zOffset = Math.ceil((1 / 6) * (Math.sqrt(24 * (PILLAR_COUNT - pillarIndex) + 1) - 5));
    const sumNext = getNumberOfPillarsInclusiveNthRow(zOffset);
    x = sumNext - Math.floor(getNumberOfPillarsInNthRow(zOffset) / 2) - (PILLAR_COUNT - pillarIndex);
    z = 66 - zOffset;
  }

  return { x, y, z };
}

function decodeNewBuildFromNameHex(nameHex, debug = false) {
  const blobBytes = decodeNameRawHexToBlobBytes(nameHex);

  const nameLen = blobBytes[0];
  const title = blobBytes.slice(1, 1 + nameLen).toString("utf8");
  const zlibAt = findZlibStart(blobBytes, nameLen);
  if (zlibAt === -1) throw new Error("newbuild: no zlib header found after title");

  const compressed = blobBytes.slice(zlibAt);
  const inflated = zlib.inflateSync(compressed);

  // Encoding auto-detect:
  // - FULL_VOXEL_COUNT => byte-per-voxel, gridY=128
  // - HALF_VOXEL_BYTES => packed16 (two 4-bit voxels per byte), expand to FULL_VOXEL_COUNT, gridY=128
  // - else divisible by pillarCount => byte-per-voxel with gridY=len/pillarCount
  let encoding = "byte";
  let gridY = null;
  let voxelBytes = null;

  if (inflated.length === FULL_VOXEL_COUNT) {
    encoding = "byte";
    gridY = 128;
    voxelBytes = inflated;
  } else if (inflated.length === HALF_VOXEL_BYTES) {
    encoding = "packed16";
    gridY = 128;
    const expanded = Buffer.allocUnsafe(FULL_VOXEL_COUNT);
    let j = 0;
    for (let i = 0; i < inflated.length; i++) {
      const b = inflated[i];
      expanded[j++] = (b >> 4) & 0x0f;
      expanded[j++] = b & 0x0f;
    }
    voxelBytes = expanded;
  } else {
    const gy = detectGridY(inflated.length);
    if (!gy) throw new Error(`newbuild: inflatedLen=${inflated.length} not recognized`);
    encoding = "byte";
    gridY = gy;
    voxelBytes = inflated;
  }

  if (debug) {
    console.log(`nameBlob: len=${blobBytes.length} headHex=${blobBytes.slice(0, 64).toString("hex")}`);
    console.log(`nameBlob firstByte=${blobBytes[0]}`);
    console.log(`newbuild: title="${title}" nameLen=${nameLen}`);
    console.log(`newbuild: zlibAt=${zlibAt} inflatedLen=${inflated.length}`);
    console.log(`newbuild: encoding=${encoding} gridY=${gridY} voxelLen=${voxelBytes.length}`);
    console.log(`newbuild: zlibHeadHex=${compressed.slice(0, 16).toString("hex")}`);
  }

  return { title, voxelBytes, gridY, encoding };
}

function voxelsByColorFromNewBuild(voxelBytes, gridY, paletteName, debug = false) {
  // paletteName affects how we interpret color bytes:
  // - voxelizer: indices 1..63 typically (but we don't enforce)
  // - classic: treat as signed int8 when byte-per-voxel data uses packed signed colors (b>127 => b-256)
  //
  // For packed16 expansion, values are 0..15, and signed conversion won't apply.
  const voxelsByColor = new Map();

  if (debug) {
    let min = 255,
      max = 0,
      nz = 0;
    for (const b of voxelBytes) {
      if (b === 0) continue;
      nz++;
      if (b < min) min = b;
      if (b > max) max = b;
    }
    console.log(`newbuild: nonzero=${nz} byteRange=[${min}, ${max}]`);
  }

  for (let i = 0; i < voxelBytes.length; i++) {
    const b = voxelBytes[i];
    if (b === 0) continue;

    const c = paletteName === "classic" && b > 127 ? b - 256 : b;
    const pos = discretePosFromGridIndex(i, gridY);

    if (!voxelsByColor.has(c)) voxelsByColor.set(c, []);
    voxelsByColor.get(c).push(pos);
  }

  return voxelsByColor;
}

// ---------- Exporters ----------
async function exportOld({ etheria, bds, col, row, outPath, centerOffset, paletteName, debug }) {
  const blocks = await etheria.getBlocks(col, row);
  const normalized = blocks.map((b) => ({
    blocktype: Number(b[0]),
    x: Number(b[1]),
    y: Number(b[2]),
    z: Number(b[3]),
    color: Number(b[4]),
  }));

  const types = [...new Set(normalized.map((b) => b.blocktype))].sort((a, b) => a - b);

  const occupiesMap = new Map();
  for (const t of types) {
    const occ = await bds.getOccupies(t);
    occupiesMap.set(t, occupiesToTriplets(occ));
  }

  const voxelsByColorSet = new Map(); // color -> Set("x,y,z")
  for (const b of normalized) {
    const occ = occupiesMap.get(b.blocktype);
    if (!occ) continue;

    if (!voxelsByColorSet.has(b.color)) voxelsByColorSet.set(b.color, new Set());
    const set = voxelsByColorSet.get(b.color);

    for (const [dx, dy, dz] of occ) {
      set.add(`${b.x + dx},${b.y + dy},${b.z + dz}`);
    }
  }

  const voxelsByColor = new Map(); // color -> [{x,y,z}]
  for (const [color, set] of voxelsByColorSet.entries()) {
    voxelsByColor.set(
      color,
      [...set].map((k) => {
        const [x, y, z] = k.split(",").map(Number);
        return { x, y, z };
      })
    );
  }

  const { doc, scene } = makeDocAndScene();
  for (const [color, voxels] of voxelsByColor.entries()) {
    const mat = doc.createMaterial(`old_c${color}`).setBaseColorFactor(colorFor(color, paletteName));
    addVoxelMesh(doc, scene, mat, voxels, centerOffset);
  }

  const io = new NodeIO();
  await io.write(outPath, doc);

  const totalVoxels = [...voxelsByColor.values()].reduce((s, a) => s + a.length, 0);

  console.log(`✅ Exported: ${outPath}`);
  console.log(`Mode = old`);
  console.log(`Tile col,row = ${col},${row}`);
  console.log(`Palette = ${paletteName}`);
  console.log(`Placed blocks = ${normalized.length}`);
  console.log(`Occupied voxels = ${totalVoxels}`);

  if (debug) console.log(`oldbuild: uniqueColors=${voxelsByColor.size}`);
}

async function exportNew({ nameHex, col, row, outPath, centerOffset, paletteName, debug }) {
  const { title, voxelBytes, gridY, encoding } = decodeNewBuildFromNameHex(nameHex, debug);
  const voxelsByColor = voxelsByColorFromNewBuild(voxelBytes, gridY, paletteName, debug);

  const { doc, scene } = makeDocAndScene();
  for (const [color, voxels] of voxelsByColor.entries()) {
    const mat = doc.createMaterial(`new_${encoding}_c${color}`).setBaseColorFactor(colorFor(color, paletteName));
    addVoxelMesh(doc, scene, mat, voxels, centerOffset);
  }

  const io = new NodeIO();
  await io.write(outPath, doc);

  const totalVoxels = [...voxelsByColor.values()].reduce((s, a) => s + a.length, 0);

  console.log(`✅ Exported: ${outPath}`);
  console.log(`Mode = new | title="${title}" | encoding=${encoding} | gridY=${gridY}`);
  console.log(`Tile col,row = ${col},${row}`);
  console.log(`Palette = ${paletteName}`);
  console.log(`Occupied voxels = ${totalVoxels}`);
}

// ---------- Main ----------
async function main() {
  const program = new Command();

  program
    .requiredOption("--rpc <url>", "Ethereum RPC URL")
    .requiredOption("--version <v>", "Etheria version: 0.9 | 1.0 | 1.1 | 1.2")
    .option("--tile <n>", "Tile index 0..1088", (v) => parseInt(v, 10))
    .option("--col <n>", "Column 0..32", (v) => parseInt(v, 10))
    .option("--row <n>", "Row 0..32", (v) => parseInt(v, 10))
    .option("--mode <m>", "auto | old | new", "auto")
    .option("--palette <name>", "Palette name (e.g. voxelizer, classic, debug16)", "voxelizer")
    .option("--name-raw <hex>", "Paste nameRAW 0x... (forces new build input)")
    .option("--out <path>", "Output .glb path", "etheria_tile.glb")
    .option("--center-offset", "Shift cubes by +0.5 to center", false)
    .option("--debug", "Debug logs", false)
    .parse(process.argv);

  const opts = program.opts();

  const cfg = VERSIONS[String(opts.version)];
  if (!cfg) {
    throw new Error(`Unknown version: ${opts.version}. Use one of: ${Object.keys(VERSIONS).join(", ")}`);
  }

  let col, row;
  if (opts.tile !== undefined) {
    ({ col, row } = tileToColRow(opts.tile));
  } else if (opts.col !== undefined && opts.row !== undefined) {
    col = opts.col;
    row = opts.row;
  } else {
    throw new Error("Provide either --tile or (--col and --row).");
  }

  if (col < 0 || col >= MAPSIZE || row < 0 || row >= MAPSIZE) {
    throw new Error(`col,row out of bounds. Expected 0..${MAPSIZE - 1}`);
  }

  const provider = new ethers.JsonRpcProvider(opts.rpc, 1);
  const etheria = new ethers.Contract(cfg.etheria, etheriaAbi, provider);
  const bds = new ethers.Contract(cfg.bds, bdsAbi, provider);

  const centerOffset = opts.centerOffset ? 0.5 : 0.0;
  const outPath = opts.out;
  const mode = String(opts.mode).toLowerCase();
  const paletteName = String(opts.palette);
  const debug = !!opts.debug;

  if (mode === "old") {
    await exportOld({ etheria, bds, col, row, outPath, centerOffset, paletteName, debug });
    return;
  }

  // If user provided nameRAW explicitly, use it.
  // Otherwise try getName + extract 0x... run.
  let nameStr = null;
  try {
    nameStr = await etheria.getName(col, row);
  } catch (e) {
    if (debug) console.log("getName failed:", e?.message || e);
  }

  const nameHex = opts.nameRaw ?? (nameStr ? extract0xHexRun(nameStr) : null);

  if (mode === "new") {
    if (!nameHex) throw new Error("Mode=new but getName() did not contain a 0x... blob and no --name-raw provided.");
    await exportNew({ nameHex, col, row, outPath, centerOffset, paletteName, debug });
    return;
  }

  // mode=auto
  if (nameHex) {
    try {
      await exportNew({ nameHex, col, row, outPath, centerOffset, paletteName, debug });
      return;
    } catch (e) {
      if (debug) console.log("auto: newbuild decode failed, falling back to old:", e?.message || e);
    }
  } else if (debug) {
    console.log("auto: no name blob found (and no --name-raw), falling back to old.");
  }

  await exportOld({ etheria, bds, col, row, outPath, centerOffset, paletteName, debug });
}

main().catch((err) => {
  console.error("❌ Error:", err?.stack || err);
  process.exit(1);
});