import { Command } from "commander";
import { ethers } from "ethers";
import { NodeIO } from "@gltf-transform/core";
import zlib from "zlib";
import { addVoxelMesh, makeDocAndScene, colorFor } from "./glb.js";

const ETHERIA_V12 = "0xB21f8684f23Dbb1008508B4DE91a0aaEDEbdB7E4";
const MAPSIZE = 33;
const etheriaAbi = ["function getName(uint8 col, uint8 row) view returns (string)"];

// Hex-grid footprint constants
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

// “Full” voxel counts
const GRIDY_128 = 128;
const FULL_VOXEL_COUNT = PILLAR_COUNT * GRIDY_128; // 1,267,328
const HALF_VOXEL_BYTES = FULL_VOXEL_COUNT / 2;     // 633,664 (packed 4-bit)

function tileToColRow(tile) {
  const col = Math.floor(tile / MAPSIZE);
  const row = tile % MAPSIZE;
  return { col, row };
}

function extract0xHexRun(s) {
  const m = s.match(/0x[0-9a-fA-F]+/);
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
    const b0 = blobBytes[i], b1 = blobBytes[i + 1];
    if (b0 === 0x78 && (b1 === 0x01 || b1 === 0x5e || b1 === 0x9c || b1 === 0xda)) return i;
  }
  return -1;
}

// Variable GRID_Y mapping
function discretePosFromGridIndex(gridIndex, GRID_Y) {
  const y = gridIndex % GRID_Y;
  const pillarIndex = (gridIndex - y) / GRID_Y;

  const pillarIndex_center = (PILLAR_COUNT - 1) / 2;
  const pillarIndex_maxInc = 33 + 1 + 3 * ((33 * (33 + 1)) / 2);
  const pillarIndex_minDec = PILLAR_COUNT - pillarIndex_maxInc;

  let x, z;

  if (pillarIndex < pillarIndex_maxInc) {
    const zOffset = Math.ceil((1 / 6) * (Math.sqrt(24 * (pillarIndex + 1) + 1) - 5));
    const sumOfPreviousPillars = getNumberOfPillarsInclusiveNthRow(zOffset);
    x = pillarIndex - sumOfPreviousPillars + Math.ceil(getNumberOfPillarsInNthRow(zOffset) / 2);
    z = zOffset - 66;
  } else if (pillarIndex < pillarIndex_minDec) {
    const indexOffsetToCenter = pillarIndex - pillarIndex_center;
    x = Math.floor(indexOffsetToCenter - Math.round(indexOffsetToCenter / 99.5) * 99.5);
    z = Math.round((indexOffsetToCenter - x) / 99.5);
  } else {
    const zOffset = Math.ceil((1 / 6) * (Math.sqrt(24 * (PILLAR_COUNT - pillarIndex) + 1) - 5));
    const sumOfSubsequentPillars = getNumberOfPillarsInclusiveNthRow(zOffset);
    x = sumOfSubsequentPillars - Math.floor(getNumberOfPillarsInNthRow(zOffset) / 2) - (PILLAR_COUNT - pillarIndex);
    z = 66 - zOffset;
  }

  return { x, y, z };
}

function decodeNewBuild(blobBytes, debug = false) {
  const nameLen = blobBytes[0];
  const title = blobBytes.slice(1, 1 + nameLen).toString("utf8");

  const zlibAt = findZlibStart(blobBytes, nameLen);
  if (zlibAt === -1) throw new Error("Could not find zlib header after title");

  const compressed = blobBytes.slice(zlibAt);
  const inflated = zlib.inflateSync(compressed);

  // Auto-detect encoding
  let encoding = "byte";
  let gridY = null;
  let voxelBytes = null;

  if (inflated.length === FULL_VOXEL_COUNT) {
    encoding = "byte";
    gridY = 128;
    voxelBytes = inflated;
  } else if (inflated.length === HALF_VOXEL_BYTES) {
    // packed16: two 4-bit voxels per byte, still 128-high logically
    encoding = "packed16";
    gridY = 128;

    // Expand nibbles into full voxel array length = FULL_VOXEL_COUNT
    const expanded = Buffer.allocUnsafe(FULL_VOXEL_COUNT);
    let j = 0;
    for (let i = 0; i < inflated.length; i++) {
      const b = inflated[i];
      expanded[j++] = (b >> 4) & 0x0f; // high nibble
      expanded[j++] = b & 0x0f;        // low nibble
    }
    voxelBytes = expanded;
  } else if (inflated.length % PILLAR_COUNT === 0) {
    // fallback: treat as byte encoding with gridY inferred (like 64-high variant)
    encoding = "byte";
    gridY = inflated.length / PILLAR_COUNT;
    voxelBytes = inflated;
  } else {
    throw new Error(
      `Inflated length ${inflated.length} not recognized (expected ${FULL_VOXEL_COUNT} or ${HALF_VOXEL_BYTES} or divisible by ${PILLAR_COUNT})`
    );
  }

  if (debug) {
    console.log(`newbuild: title="${title}" nameLen=${nameLen}`);
    console.log(`newbuild: blobLen=${blobBytes.length} zlibAt=${zlibAt} inflatedLen=${inflated.length}`);
    console.log(`newbuild: encoding=${encoding} gridY=${gridY} voxelLen=${voxelBytes.length}`);
    console.log(`newbuild: zlibHeadHex=${compressed.slice(0, 16).toString("hex")}`);
  }

  return { title, voxelBytes, gridY, encoding };
}

// Color decoding depends on palette choice.
// - voxelizer: indices 1..63
// - classic: signed int8 stored in bytes (b>127 => b-256)
// - packed16 builds: indices 0..15 (you still choose palette mapping)
function voxelsByColorFromVoxelBytes(voxelBytes, gridY, paletteName, debug = false) {
  const voxelsByColor = new Map();

  // debug range
  if (debug) {
    let min = 255, max = 0, nz = 0;
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

    const c = (paletteName === "classic" && b > 127) ? (b - 256) : b;

    const pos = discretePosFromGridIndex(i, gridY);
    if (!voxelsByColor.has(c)) voxelsByColor.set(c, []);
    voxelsByColor.get(c).push(pos);
  }

  return voxelsByColor;
}

async function main() {
  const program = new Command();

  program
    .option("--name-raw <hex>", "Paste nameRAW 0x... (recommended)")
    .option("--rpc <url>", "RPC URL (optional if name-raw provided)")
    .option("--tile <n>", "Tile index", (v) => parseInt(v, 10))
    .option("--col <n>", "Column", (v) => parseInt(v, 10))
    .option("--row <n>", "Row", (v) => parseInt(v, 10))
    .option("--out <path>", "Output .glb", "etheria_tile_new.glb")
    .option("--center-offset", "Shift by 0.5", false)
    .option("--palette <name>", "Palette: voxelizer or classic", "voxelizer")
    .option("--debug-new", "Debug output", false)
    .parse(process.argv);

  const opts = program.opts();
  let nameRawHex = opts.nameRaw ?? null;

  if (!nameRawHex) {
    if (!opts.rpc) throw new Error("Provide --name-raw or (--rpc and --tile/--col+--row)");

    let col, row;
    if (opts.tile !== undefined) ({ col, row } = tileToColRow(opts.tile));
    else if (opts.col !== undefined && opts.row !== undefined) { col = opts.col; row = opts.row; }
    else throw new Error("Provide either --tile or (--col and --row).");

    const provider = new ethers.JsonRpcProvider(opts.rpc, 1);
    const etheria = new ethers.Contract(ETHERIA_V12, etheriaAbi, provider);
    const nameStr = await etheria.getName(col, row);

    const extracted = extract0xHexRun(nameStr);
    if (!extracted) throw new Error("getName() did not contain a 0x... hex run. Paste --name-raw instead.");
    nameRawHex = extracted;
  }

  const blobBytes = decodeNameRawHexToBlobBytes(nameRawHex);

  if (opts.debugNew) {
    console.log("nameBlob: len=", blobBytes.length, "headHex=", blobBytes.slice(0, 64).toString("hex"));
    console.log("nameBlob firstByte =", blobBytes[0]);
  }

  const { title, voxelBytes, gridY, encoding } = decodeNewBuild(blobBytes, opts.debugNew);
  const voxelsByColor = voxelsByColorFromVoxelBytes(voxelBytes, gridY, opts.palette, opts.debugNew);

  const { doc, scene } = makeDocAndScene();
  const centerOffset = opts.centerOffset ? 0.5 : 0.0;

  for (const [color, voxels] of voxelsByColor.entries()) {
    const mat = doc.createMaterial(`new_${encoding}_c${color}`).setBaseColorFactor(colorFor(color, opts.palette));
    addVoxelMesh(doc, scene, mat, voxels, centerOffset);
  }

  const io = new NodeIO();
  await io.write(opts.out, doc);

  const totalVoxels = [...voxelsByColor.values()].reduce((sum, a) => sum + a.length, 0);
  console.log(`✅ Exported: ${opts.out}`);
  console.log(`Mode = new | title="${title}" | encoding=${encoding} | gridY=${gridY}`);
  console.log(`Palette = ${opts.palette}`);
  console.log(`Occupied voxels = ${totalVoxels}`);
}

main().catch((err) => {
  console.error("❌ Error:", err?.stack || err);
  process.exit(1);
});