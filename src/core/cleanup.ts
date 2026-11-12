// 清理：让色块连成片、颜色更少，但保住眼睛这类关键小细节。
// 操作对象是一块主体区域的色号数组（w × h，null = 空格）。
import { MAX_ISLAND } from './config';
import { connectedRegions, type Grid } from './grid';
import { colorOf, matchDistance, type BeadColor } from './palette';

type Codes = (string | null)[];

const lightness = (code: string) => colorOf(code).lab[0];

/**
 * 关键细节保护：和周围 8 格平均亮度差 0.22 以上的格子。
 * 比周围暗的是眼睛、鼻孔、嘴角，比周围亮的是高光、眼白、牙齿。两类各自最多保护主体的 1.5%（取差别最大的），
 * 避免把毛发阴影也当成细节。
 */
const PROTECT_SHARE = 0.015;
const PROTECT_CONTRAST = 0.22;

export function protectDetails(codes: Codes, w: number, h: number): Uint8Array {
  const keep = new Uint8Array(codes.length);
  const dark: Array<[number, number]> = [];
  const light: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const code = codes[y * w + x];
      if (!code) continue;
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          const c = nx >= 0 && ny >= 0 && nx < w && ny < h ? codes[ny * w + nx] : null;
          if (!c) continue;
          sum += lightness(c);
          n++;
        }
      }
      if (n < 5) continue;
      const diff = sum / n - lightness(code);
      if (diff >= PROTECT_CONTRAST) dark.push([y * w + x, diff]);
      else if (-diff >= PROTECT_CONTRAST) light.push([y * w + x, -diff]);
    }
  }
  const filled = codes.filter(Boolean).length;
  const limit = Math.max(4, Math.round(filled * PROTECT_SHARE));
  for (const list of [dark, light]) for (const [i] of list.sort((a, b) => b[1] - a[1]).slice(0, limit)) keep[i] = 1;
  return keep;
}

/**
 * 按色块合并：同色相连的一块如果太小（< minArea 颗），整块并入和它接壤最多的相邻色块；
 * 接壤一样多时选亮度最接近的。受保护的格子所在的色块不合并。
 */
export function mergeSmallRegions(codes: Codes, w: number, h: number, minArea: number, keep: Uint8Array): Codes {
  let out = codes.slice();
  for (let round = 0; round < 6; round++) {
    const grid: Grid = { width: w, height: h, cells: out };
    const regions = connectedRegions(grid, (a, b) => a === b).sort((a, b) => a.length - b.length);
    let changed = false;
    const next = out.slice();
    for (const region of regions) {
      if (region.length >= minArea) break;
      if (region.some(i => keep[i])) continue;
      const own = out[region[0]]!;
      const border = new Map<string, number>();
      for (const i of region) {
        const x = i % w, y = (i - x) / w;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const c = out[ny * w + nx];
          if (c && c !== own) border.set(c, (border.get(c) ?? 0) + 1);
        }
      }
      if (border.size === 0) continue;
      let best = '', bestScore = -Infinity;
      for (const [c, n] of border) {
        const score = n - Math.abs(lightness(c) - lightness(own)) * 2;
        if (score > bestScore) [best, bestScore] = [c, score];
      }
      for (const i of region) next[i] = best;
      changed = true;
    }
    out = next;
    if (!changed) break;
  }
  return out;
}

/** 合并几乎一样的颜色：同色族里差别很小的两个色号，用量少的并进用量多的 */
export function mergeNearDuplicates(codes: Codes, threshold: number): Codes {
  const counts = new Map<string, number>();
  for (const c of codes) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  const ordered = [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const remap = new Map<string, string>();
  for (let i = 0; i < ordered.length; i++) {
    if (remap.has(ordered[i])) continue;
    for (let j = i + 1; j < ordered.length; j++) {
      if (remap.has(ordered[j])) continue;
      if (matchDistance(colorOf(ordered[i]).lab, colorOf(ordered[j]).lab) < threshold) remap.set(ordered[j], ordered[i]);
    }
  }
  return remap.size ? codes.map(c => (c && remap.get(c)) || c) : codes;
}

/**
 * 面里的碎点：1–2 颗的小块，四周大半是同一种颜色，和它只是深浅差一点（色相、鲜艳程度几乎一样）就并回去。
 * AI 画的像素图一块面里常有这种深浅不匀的碎点，拼出来很花。腮红、眼睛、高光这类有意的细节
 * 颜色（色相 / 鲜艳程度）或明暗差得多，不会被并。
 * 两颗都是深色时放宽：深色豆之间本来就难分（深灰裤子里的一颗深蓝、描边里的一颗深棕），差得不多就并。
 */
const SPECK_MAX = 2;
const SPECK_HOST_SHARE = 0.6;  // 四周（4 邻）至少这么多是同一种颜色
const SPECK_MAX_DL = 0.12;     // 明暗差不超过这么多
const SPECK_MAX_DAB = 0.02;    // 色相 / 鲜艳程度的差不超过这么多
const SPECK_DARK_L = 0.5;      // 两颗都比这暗算「都是深色」
const SPECK_DARK_NEAR = 0.12;  // 都是深色时：找色号用的距离不超过这么多就并
export function mergeFaintSpecks(codes: Codes, w: number, h: number): Codes {
  let out = codes;
  for (let round = 0; round < 3; round++) {
    const next = out.slice();
    let changed = false;
    for (const region of connectedRegions({ width: w, height: h, cells: out }, (a, b) => a === b)) {
      if (region.length > SPECK_MAX) continue;
      const own = out[region[0]]!;
      const around = new Map<string, number>();
      let sides = 0;
      for (const i of region) {
        const x = i % w, y = (i - x) / w;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const c = out[ny * w + nx];
          if (c === own) continue;
          sides++;
          if (c) around.set(c, (around.get(c) ?? 0) + 1);
        }
      }
      let host = '', hostN = 0;
      for (const [c, n] of around) if (n > hostN) [host, hostN] = [c, n];
      if (!host || hostN < sides * SPECK_HOST_SHARE) continue;
      const a = colorOf(own).lab, b = colorOf(host).lab;
      const faint = Math.abs(a[0] - b[0]) <= SPECK_MAX_DL && Math.hypot(a[1] - b[1], a[2] - b[2]) <= SPECK_MAX_DAB;
      const bothDark = a[0] <= SPECK_DARK_L && b[0] <= SPECK_DARK_L && matchDistance(a, b) <= SPECK_DARK_NEAR;
      if (!faint && !bothDark) continue;
      for (const i of region) next[i] = host;
      changed = true;
    }
    if (!changed) break;
    out = next;
  }
  return out;
}

/** 亮度权重更高的找色：深色小细节会并到深色，不会并到同色相的浅色 */
function nearestByLightness(code: string, candidates: BeadColor[]): BeadColor {
  const lab = colorOf(code).lab;
  let best = candidates[0], bestD = Infinity;
  for (const c of candidates) {
    const d = Math.hypot((lab[0] - c.lab[0]) * 2, lab[1] - c.lab[1], lab[2] - c.lab[2]);
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}

/** 零碎色：用量少于 minCount 颗的颜色并入最接近的常用色 */
/** 受保护细节（眼睛、高光）用到的颜色：合并零碎色、砍色数时不动它们 */
export function detailColors(codes: Codes, keep: Uint8Array): Set<string> {
  const out = new Set<string>();
  codes.forEach((c, i) => { if (c && keep[i]) out.add(c); });
  return out;
}

export function mergeRareColors(codes: Codes, minCount: number, protect: Set<string> = new Set()): Codes {
  for (let round = 0; round < 10; round++) {
    const counts = new Map<string, number>();
    for (const c of codes) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    const rare = [...counts].filter(([c, n]) => n < minCount && !protect.has(c)).map(([c]) => c);
    const kept = [...counts].filter(([, n]) => n >= minCount).map(([c]) => colorOf(c));
    if (rare.length === 0 || kept.length === 0) return codes;
    const remap = new Map(rare.map(c => [c, nearestByLightness(c, kept).code]));
    codes = codes.map(c => (c && remap.get(c)) || c);
  }
  return codes;
}

/**
 * 颜色数超过上限时逐个并掉一种颜色。先并「用量少、又和别的颜色很像」的：按 用量 × 和最近颜色的差距 排，
 * 这样用量小但很显眼的颜色（眼睛、高光、点缀）不会因为少就先被并掉；受保护细节的颜色不并
 */
export function capColors(codes: Codes, maxColors: number, protect: Set<string> = new Set()): Codes {
  for (;;) {
    const counts = new Map<string, number>();
    for (const c of codes) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    if (counts.size <= maxColors) return codes;
    const all = [...counts.keys()];
    let victim = '', worst = Infinity;
    for (const [c, n] of counts) {
      if (protect.has(c)) continue;
      const lab = colorOf(c).lab;
      let near = Infinity;
      for (const o of all) if (o !== c) near = Math.min(near, matchDistance(lab, colorOf(o).lab));
      const score = n * (near + 0.02);
      if (score < worst) [victim, worst] = [c, score];
    }
    if (!victim) return codes;
    const target = nearestByLightness(victim, all.filter(c => c !== victim).map(c => colorOf(c))).code;
    codes = codes.map(c => (c === victim ? target : c));
  }
}

/** 和主体分离的零星小块（≤ MAX_ISLAND 颗），熨烫后会掉，直接去掉 */
export function removeIslands(codes: Codes, w: number, h: number): Codes {
  const grid: Grid = { width: w, height: h, cells: codes.slice() };
  for (const region of connectedRegions(grid)) {
    if (region.length <= MAX_ISLAND) for (const i of region) grid.cells[i] = null;
  }
  return grid.cells;
}
