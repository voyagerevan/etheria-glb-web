"use client";

import { useState } from "react";

export default function Home() {
  const [mode, setMode] = useState<"old" | "new" | "auto">("old");
  const [tile, setTile] = useState("464");
  const [version, setVersion] = useState("1.2");
  const [palette, setPalette] = useState("classic");
  const [nameRaw, setNameRaw] = useState("0x");
  const [status, setStatus] = useState("");

  async function generate() {
    setStatus("Generating… (don’t close this tab)");
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          tile: Number(tile),
          version,
          palette,
          nameRaw: mode === "new" ? nameRaw : undefined,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Request failed: ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `tile_${tile}.glb`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
      setStatus("Done ✅ Download started");
    } catch (err: any) {
      setStatus(`Error ❌ ${err.message}`);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Etheria → GLB Exporter</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Type a tile number, choose settings, click Generate.
      </p>

      <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
        <label>
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as any)} style={{ width: "100%", padding: 8 }}>
            <option value="old">old</option>
            <option value="new">new</option>
            <option value="auto">auto</option>
          </select>
        </label>

        <label>
          Tile #
          <input value={tile} onChange={(e) => setTile(e.target.value)} style={{ width: "100%", padding: 8 }} />
        </label>

        <label>
          Version
          <input value={version} onChange={(e) => setVersion(e.target.value)} style={{ width: "100%", padding: 8 }} />
        </label>

        <label>
          Palette
          <select value={palette} onChange={(e) => setPalette(e.target.value)} style={{ width: "100%", padding: 8 }}>
            <option value="classic">classic</option>
            <option value="voxelizer">voxelizer</option>
          </select>
        </label>

        {mode === "new" && (
          <label>
            nameRAW (starts with 0x…)
            <input value={nameRaw} onChange={(e) => setNameRaw(e.target.value)} style={{ width: "100%", padding: 8 }} />
          </label>
        )}

        <button onClick={generate} style={{ padding: 12, fontSize: 16, cursor: "pointer" }}>
          Generate GLB
        </button>

        <div style={{ whiteSpace: "pre-wrap", opacity: 0.9 }}>{status}</div>
      </div>
    </main>
  );
}
