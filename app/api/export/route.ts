import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

// ✅ Force Vercel/Next to bundle these deps into the server function:
import "commander";
import "ethers";
import "@gltf-transform/core";

export const runtime = "nodejs"; // IMPORTANT: needs Node, not Edge.

type Payload = {
  mode: "old" | "new" | "auto";
  tile: number;
  version?: string;   // e.g. "1.2"
  palette?: string;   // e.g. "classic" | "voxelizer"
  nameRaw?: string;   // e.g. "0x..."
  rpc?: string;       // optional override (we will mostly use env RPC_URL)
};

function run(cmd: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

    let out = "";
    let err = "";

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`Exporter failed (code ${code}).\n\nSTDOUT:\n${out}\n\nSTDERR:\n${err}`));
    });
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Payload;

    const mode = body.mode ?? "old";
    const tile = Number(body.tile);
    if (!Number.isFinite(tile) || tile < 0) {
      return NextResponse.json({ error: "Tile must be a number >= 0" }, { status: 400 });
    }

    // For new builds: fans paste nameRaw
    if (mode === "new") {
      if (!body.nameRaw || typeof body.nameRaw !== "string" || !body.nameRaw.startsWith("0x")) {
        return NextResponse.json({ error: "nameRaw must start with 0x (required for new mode)" }, { status: 400 });
      }
    }

    const rpcUrl = body.rpc || process.env.RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json(
        { error: "Missing RPC_URL (set it in .env.local or Vercel env vars)" },
        { status: 500 }
      );
    }

    const version = body.version || "1.2";
    const palette = body.palette || "classic";

    // Temp output file
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "etheria-"));
    const outPath = path.join(tmpDir, `tile_${tile}.glb`);

    // Run exporter script
    const exporterCwd = path.join(process.cwd(), "exporter");
    const scriptPath = path.join(exporterCwd, "src", "export-tile.js");

    const args: string[] = [
      scriptPath,
      "--mode",
      mode,
      "--rpc",
      rpcUrl,
      "--version",
      version,
      "--tile",
      String(tile),
      "--palette",
      palette,
      "--out",
      outPath,
    ];

    // Only include name-raw for new mode (or if user provided anyway)
    if (body.nameRaw) {
      args.push("--name-raw", body.nameRaw);
    }

    await run("node", args, exporterCwd);

    const file = await fs.readFile(outPath);

    // Send as downloadable file
    return new NextResponse(file, {
      status: 200,
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Disposition": `attachment; filename="tile_${tile}.glb"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}