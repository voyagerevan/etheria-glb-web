# Etheria GLB Exporter

Export Etheria tiles into `.glb` files.

## What this supports

### Old builds (works for all versions)
Old builds are the on-chain block placements (`getBlocks + getOccupies`).

✅ v0.9, v1.0, v1.1, v1.2

### New builds (nameRAW blobs)
New builds are stored in the tile “nameRAW” blob and must be pasted in.

✅ Works when you provide `--name-raw 0x...`

---

## Install (non-technical steps)

### 1) Install Node.js (one-time)
Install Node “LTS” from nodejs.org.

### 2) Download this tool
On GitHub, click:
**Code → Download ZIP**

Unzip it. Open Terminal.

### 3) Install dependencies
In Terminal, `cd` into the folder you unzipped (the one with `package.json`), then run:

```bash
npm install