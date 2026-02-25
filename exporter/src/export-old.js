import { Command } from "commander";
import { ethers } from "ethers";
import { NodeIO } from "@gltf-transform/core";
import { addVoxelMesh, makeDocAndScene, colorFor } from "./glb.js";

const ETHERIA_V12 = "0xB21f8684f23Dbb1008508B4DE91a0aaEDEbdB7E4";
const BDS_V12 = "0xd4e686a1fbf1bfe058510f07cd3936d3d5a70589";
const MAPSIZE = 33;

const etheriaAbi = [
  "function getBlocks(uint8 col, uint8 row) view returns (int8[5][])",
];
const bdsAbi = [
  "function getOccupies(uint8 which) view returns (int8[24])",
];

function tileToColRow(tile) {
  const col = Math.floor(tile / MAPSIZE);
  const row = tile % MAPSIZE;
  return { col, row };
}

function occupiesToTriplets(int8_24) {
  const triplets = [];
  for (let i = 0; i < 24; i += 3) {
    triplets.push([
      Number(int8_24[i]),
      Number(int8_24[i + 1]),
      Number(int8_24[i + 2]),
    ]);
  }
  return triplets;
}

async function main() {
  const program = new Command();

  program
    .requiredOption("--rpc <url>", "Ethereum RPC URL")
    .option("--tile <n>", "Tile index", (v) => parseInt(v, 10))
    .option("--col <n>", "Column", (v) => parseInt(v, 10))
    .option("--row <n>", "Row", (v) => parseInt(v, 10))
    .option("--out <path>", "Output .glb", "etheria_tile_old.glb")
    .option("--center-offset", "Shift by 0.5", false)
    .option("--palette <name>", "Palette name (default: 6bit)", "6bit")
    .parse(process.argv);

  const opts = program.opts();

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
  const etheria = new ethers.Contract(ETHERIA_V12, etheriaAbi, provider);
  const bds = new ethers.Contract(BDS_V12, bdsAbi, provider);

  const blocks = await etheria.getBlocks(col, row);
  const normalized = blocks.map((b) => ({
    blocktype: Number(b[0]),
    x: Number(b[1]),
    y: Number(b[2]),
    z: Number(b[3]),
    color: Number(b[4]),
  }));

  const types = [...new Set(normalized.map((b) => b.blocktype))].sort(
    (a, b) => a - b
  );

  const occupiesMap = new Map();
  for (const t of types) {
    occupiesMap.set(t, occupiesToTriplets(await bds.getOccupies(t)));
  }

  // Group final voxels by color
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
  const centerOffset = opts.centerOffset ? 0.5 : 0.0;

  for (const [color, voxels] of voxelsByColor.entries()) {
    const mat = doc
      .createMaterial(`old_c${color}`)
      .setBaseColorFactor(colorFor(color, opts.palette));
    addVoxelMesh(doc, scene, mat, voxels, centerOffset);
  }

  const io = new NodeIO();
  await io.write(opts.out, doc);

  const totalVoxels = [...voxelsByColor.values()].reduce(
    (sum, a) => sum + a.length,
    0
  );

  console.log(`✅ Exported: ${opts.out}`);
  console.log(`Mode = old`);
  console.log(`Tile col,row = ${col},${row}`);
  console.log(`Palette = ${opts.palette}`);
  console.log(`Placed blocks = ${normalized.length}`);
  console.log(`Occupied voxels = ${totalVoxels}`);
}

main().catch((err) => {
  console.error("❌ Error:", err?.stack || err);
  process.exit(1);
});