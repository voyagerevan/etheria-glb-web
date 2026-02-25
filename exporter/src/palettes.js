import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// New-build palette from Etheria-3D-Voxelizer (index 1..63). 0 = empty.
const VOXELIZER_COLOR_MAP = {
  1:"#A43618",2:"#BF4916",3:"#CF7C14",4:"#FF6000",5:"#E2A74A",6:"#18A889",7:"#FFFF97",
  8:"#AADC73",9:"#82A858",10:"#3E8A3C",11:"#512800",12:"#265525",13:"#C69AC3",14:"#168700",
  15:"#6DB717",16:"#CBD400",17:"#FEEF00",18:"#FE9000",19:"#A60F91",20:"#FF0100",21:"#A61D15",
  22:"#8F0303",23:"#C8FBFA",24:"#30234A",25:"#EA01EA",26:"#00226F",27:"#162BB5",28:"#EAD9D8",
  29:"#6BE2BD",30:"#36ABD6",31:"#5DECF5",32:"#471B6D",33:"#FFFFFF",34:"#A1A6B6",35:"#8F8F8F",
  36:"#686868",37:"#4B4B4B",38:"#2F2F2F",39:"#212121",40:"#101010",41:"#E5CA30",42:"#245CFF",
  43:"#F66942",44:"#B9FC02",45:"#B4905A",46:"#A68A49",47:"#846F56",48:"#9F5A0C",49:"#69431F",
  50:"#352410",51:"#CCCCCC",52:"#8A8A5B",53:"#DBB17F",54:"#CAC48B",55:"#69997E",56:"#4A8193",
  57:"#2E5662",58:"#19353F",59:"#ABD0FE",60:"#EE7070",61:"#FCCCE9",62:"#C254CD",63:"#6D2AA7",
};

const LEVELS = [0, 85, 170, 255];

function hexToRgba01(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b, 1];
}

// Lazy-load classic map for old builds (int8 keys -128..86)
let CLASSIC_MAP = null;
function getClassicMap() {
  if (CLASSIC_MAP) return CLASSIC_MAP;
  const p = path.join(__dirname, "classic-color-map.json");
  CLASSIC_MAP = JSON.parse(fs.readFileSync(p, "utf8"));
  return CLASSIC_MAP;
}

export function rgbaForColorIndex(colorIndex, paletteName = "voxelizer") {
  const i = Number(colorIndex);

  if (paletteName === "voxelizer") {
    if (!i) return [0, 0, 0, 0];
    const hex = VOXELIZER_COLOR_MAP[i] ?? VOXELIZER_COLOR_MAP[((i - 1) % 63 + 63) % 63 + 1];
    return hexToRgba01(hex);
  }

  if (paletteName === "classic") {
    const m = getClassicMap();
    const hex = m[String(i)];
    if (hex) return hexToRgba01(hex);

    // fallback: visible gray if unmapped
    const v = Math.max(0, Math.min(255, i + 128)) / 255;
    return [v, v, v, 1];
  }

  if (paletteName === "6bit") {
    const idx = ((i % 64) + 64) % 64;
    const r2 = (idx >> 4) & 3;
    const g2 = (idx >> 2) & 3;
    const b2 = idx & 3;
    return [LEVELS[r2] / 255, LEVELS[g2] / 255, LEVELS[b2] / 255, 1];
  }

  const v = Math.max(0, Math.min(255, i)) / 255;
  return [v, v, v, 1];
}
