// 照片路径（保留背景或抠图后的主体）。2026-10-26 按对比实验改成「细腻」做法：
//   1. 每格取原图这一块的平均色（面积平均，不先滤波），逐格找最接近的色号 → 光影渐变都在
//   2. 收敛色数：用量最少的颜色并进最接近的、还留着的颜色，直到不超过上限（默认按豆板 20 / 30 / 40）
//   3. 清孤豆：上下左右都没有同色的单颗，周围 8 格里最多的颜色和它够接近就换成那个（两遍）
//   4. 零碎色并入最接近的；放板：保留背景时占满整块板，空出来的格子用图案边上最多的颜色补
// 8 张测试照片上，和原图的平均色差比原来的做法小一半左右，孤豆是「不限色、不清理」的三分之一到四分之一
import { rgbToLab, type Lab } from './color';
import { MIN_BEADS_PER_COLOR, SIZES, boardArea, fitSide, type SizeId, type StyleId } from './config';
import { capColors, mergeRareColors } from './cleanup';
import { connectedRegions, createGrid, type Grid } from './grid';
import type { Mask, RgbaImage } from './image';
import { PALETTE, colorOf, matchDistance, type BeadColor } from './palette';

export interface PhotoInput {
  image: RgbaImage;
  mask: Mask | null;
}

export interface PhotoOptions {
  size: SizeId;
  style: StyleId;
  /** 颜色上限；不给就按豆板的默认值 */
  maxColors?: number;
  /** 自定义尺寸：图案按比例放进 w×h 颗以内，放到能装下它的豆板上（不铺满背景） */
  fit?: { w: number; h: number };
  /** 留住细碎的颜色：不清孤豆、不并零碎色（「颜色数量」往右加色用的多色版） */
  keepShades?: boolean;
}

const ISOLATED_MERGE = 0.12; // 孤豆和周围最多的颜色差这么多以内才换（再远就是眼睛、高光这类真细节）
const ISOLATED_PASSES = 2;

const SPLIT_VARIANCE = 0.008; // 格内线性 RGB 方差超过这个：一格里混着两种颜色（轮廓边上黑白各一半），分开取多的那种
const SPLIT_MIN_PIXELS = 4;
const SPLIT_MIN_SHARE = 0.3; // 少的那种也要占到这么多才分开：两块颜色的交界才分；胡须、发丝这类细线只占一小块，照旧平均，留下一道浅色
const toLinear = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => toLinear(i));
const toSrgb = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));

/** 一组线性光像素的平均色 → Lab */
function meanLab(px: Float32Array, idx: number[]): Lab {
  let r = 0, g = 0, b = 0;
  for (const i of idx) { r += px[i * 3]; g += px[i * 3 + 1]; b += px[i * 3 + 2]; }
  const n = idx.length;
  return rgbToLab(toSrgb(r / n), toSrgb(g / n), toSrgb(b / n));
}

/** 格内像素分成两组（2 均值，3 遍），返回人多那组；少的那组占比不够就返回 null（照旧整格平均） */
function majorGroup(px: Float32Array, n: number): number[] | null {
  // 起点取离平均色最远的像素和离它最远的像素
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) { mr += px[i * 3]; mg += px[i * 3 + 1]; mb += px[i * 3 + 2]; }
  mr /= n; mg /= n; mb /= n;
  const d2 = (i: number, c: number[]) => (px[i * 3] - c[0]) ** 2 + (px[i * 3 + 1] - c[1]) ** 2 + (px[i * 3 + 2] - c[2]) ** 2;
  let a = 0, best = -1;
  for (let i = 0; i < n; i++) { const d = d2(i, [mr, mg, mb]); if (d > best) [a, best] = [i, d]; }
  const ca = [px[a * 3], px[a * 3 + 1], px[a * 3 + 2]];
  let bIdx = 0; best = -1;
  for (let i = 0; i < n; i++) { const d = d2(i, ca); if (d > best) [bIdx, best] = [i, d]; }
  let c0 = ca, c1 = [px[bIdx * 3], px[bIdx * 3 + 1], px[bIdx * 3 + 2]];
  let g0: number[] = [], g1: number[] = [];
  for (let it = 0; it < 3; it++) {
    g0 = []; g1 = [];
    for (let i = 0; i < n; i++) (d2(i, c0) <= d2(i, c1) ? g0 : g1).push(i);
    const centre = (g: number[], prev: number[]) => {
      if (!g.length) return prev;
      const c = [0, 0, 0];
      for (const i of g) { c[0] += px[i * 3]; c[1] += px[i * 3 + 1]; c[2] += px[i * 3 + 2]; }
      return c.map(v => v / g.length);
    };
    c0 = centre(g0, c0);
    c1 = centre(g1, c1);
  }
  if (Math.min(g0.length, g1.length) < n * SPLIT_MIN_SHARE) return null;
  return g0.length >= g1.length ? g0 : g1;
}

/**
 * 每格的颜色：在线性光下平均（sRGB 直接平均会偏暗）；格内颜色明显分成两块时（轮廓边上黑白各占一半），
 * 取占多数的那块，不混成一个灰色、发脏的过渡色。格子里大半是透明或抠图外就是 null
 */
function cellMeans(input: PhotoInput, cols: number, rows: number, box: { x0: number; y0: number; x1: number; y1: number }): (Lab | null)[] {
  const { image, mask } = input;
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const out: (Lab | null)[] = new Array(cols * rows).fill(null);
  const maxCell = (Math.ceil(bw / cols) + 1) * (Math.ceil(bh / rows) + 1);
  const px = new Float32Array(maxCell * 3);
  for (let gy = 0; gy < rows; gy++) {
    const ya = box.y0 + Math.floor((gy * bh) / rows), yb = Math.max(ya + 1, box.y0 + Math.floor(((gy + 1) * bh) / rows));
    for (let gx = 0; gx < cols; gx++) {
      const xa = box.x0 + Math.floor((gx * bw) / cols), xb = Math.max(xa + 1, box.x0 + Math.floor(((gx + 1) * bw) / cols));
      let n = 0, all = 0;
      for (let y = ya; y < yb && y < image.height; y++) {
        for (let x = xa; x < xb && x < image.width; x++) {
          all++;
          const i = y * image.width + x;
          if ((mask ? mask.data[i] : image.data[i * 4 + 3] / 255) < 0.5) continue;
          px[n * 3] = LINEAR[image.data[i * 4]];
          px[n * 3 + 1] = LINEAR[image.data[i * 4 + 1]];
          px[n * 3 + 2] = LINEAR[image.data[i * 4 + 2]];
          n++;
        }
      }
      if (n * 2 < all || n === 0) continue;
      const idx = Array.from({ length: n }, (_, i) => i);
      let variance = 0;
      if (n >= SPLIT_MIN_PIXELS) {
        for (let ch = 0; ch < 3; ch++) {
          let m = 0, q = 0;
          for (let i = 0; i < n; i++) { const v = px[i * 3 + ch]; m += v; q += v * v; }
          m /= n;
          variance += q / n - m * m;
        }
        variance /= 3;
      }
      out[gy * cols + gx] = meanLab(px, (variance > SPLIT_VARIANCE && majorGroup(px, n)) || idx);
    }
  }
  return out;
}

function nearestBead(lab: Lab, candidates: readonly BeadColor[]): BeadColor {
  let best = candidates[0], bd = Infinity;
  for (const c of candidates) {
    const d = matchDistance(lab, c.lab);
    if (d < bd) [best, bd] = [c, d];
  }
  return best;
}

// 收色时锁住的显眼色：近黑、近白（眼睛、高光）占到 0.1%，很艳的颜色（嘴唇、红围巾）占到 0.5%，就不并掉；最多锁上限的三分之一
const KEEP_DARK_L = 0.3, KEEP_LIGHT_L = 0.93, KEEP_EXTREME_SHARE = 0.001;
const KEEP_VIVID_CHROMA = 0.12, KEEP_VIVID_SHARE = 0.005;

/**
 * 颜色超过上限时一种种并掉：先并「用量少、又和别的颜色很像」的（用量 × 和最近颜色的差距），
 * 用量小但很显眼的颜色不会因为少就先没；显眼色直接锁住
 */
function capPhotoColors(codes: (string | null)[], max: number): (string | null)[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const c of codes) if (c) { counts.set(c, (counts.get(c) ?? 0) + 1); total++; }
  if (counts.size <= max) return codes;
  const locked = [...counts]
    .filter(([c, n]) => {
      const [l, a, b] = colorOf(c).lab;
      const share = n / total;
      return ((l < KEEP_DARK_L || l > KEEP_LIGHT_L) && share >= KEEP_EXTREME_SHARE) || (Math.hypot(a, b) >= KEEP_VIVID_CHROMA && share >= KEEP_VIVID_SHARE);
    })
    .sort((x, y) => y[1] - x[1])
    .slice(0, Math.floor(max / 3))
    .map(([c]) => c);
  return capColors(codes, max, new Set(locked));
}

/** 孤豆：上下左右都没有同色的单颗，换成周围 8 格里最多、又够接近的颜色 */
function mergeIsolated(codes: (string | null)[], cols: number, rows: number): (string | null)[] {
  let cur = codes;
  for (let pass = 0; pass < ISOLATED_PASSES; pass++) {
    const next = cur.slice();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = cur[y * cols + x];
        if (!c) continue;
        let lonely = true;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && cur[ny * cols + nx] === c) lonely = false;
        }
        if (!lonely) continue;
        const tally = new Map<string, number>();
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = cur[ny * cols + nx];
          if (n) tally.set(n, (tally.get(n) ?? 0) + 1);
        }
        let top = '', tn = 0;
        for (const [n, k] of tally) if (k > tn) [top, tn] = [n, k];
        if (top && matchDistance(colorOf(c).lab, colorOf(top).lab) < ISOLATED_MERGE) next[y * cols + x] = top;
      }
    }
    cur = next;
  }
  return cur;
}

// 保护图：每格和上下左右的原图颜色差得多（轮廓、眼睛、唇线）就保护，0–1
const EDGE_FROM = 0.06, EDGE_SPAN = 0.14;
function protection(means: (Lab | null)[], cols: number, rows: number): Float32Array {
  const p = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const m = means[y * cols + x];
    if (!m) continue;
    let edge = 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const n = nx >= 0 && ny >= 0 && nx < cols && ny < rows ? means[ny * cols + nx] : null;
      if (n) edge = Math.max(edge, matchDistance(m, n));
    }
    p[y * cols + x] = Math.min(1, Math.max(0, (edge - EDGE_FROM) / EDGE_SPAN));
  }
  return p;
}

// 碎块：4 颗以内的同色小块。周围过半是同一种颜色、块里没有受保护的格、每一格的原图色和那种颜色也够接近，才换成它
const FRAGMENT_MAX = 4, FRAGMENT_PROTECT = 0.55, FRAGMENT_FIT = 0.12;
function mergeFragments(codes: (string | null)[], cols: number, rows: number, means: (Lab | null)[], protect: Float32Array): (string | null)[] {
  const out = codes.slice();
  for (const region of connectedRegions({ width: cols, height: rows, cells: codes }, (a, b) => a === b)) {
    if (region.length > FRAGMENT_MAX || region.some(i => protect[i] > FRAGMENT_PROTECT)) continue;
    const own = codes[region[0]];
    const inside = new Set(region);
    const tally = new Map<string, number>();
    let ring = 0;
    for (const i of region) {
      const x = i % cols, y = (i - x) / cols;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (inside.has(j)) continue;
        ring++;
        const c = codes[j];
        if (c && c !== own) tally.set(c, (tally.get(c) ?? 0) + 1);
      }
    }
    let top = '', tn = 0;
    for (const [c, n] of tally) if (n > tn) [top, tn] = [c, n];
    if (!top || tn * 2 <= ring) continue;
    const lab = colorOf(top).lab;
    if (region.some(i => !means[i] || matchDistance(means[i]!, lab) > FRAGMENT_FIT)) continue;
    for (const i of region) out[i] = top;
  }
  return out;
}

// 逐格平滑：每格在「当前色、上下左右的颜色、离原图最近的色」里挑代价最小的。
// 代价 = 离原图多远 ×（1 + 0.4 × 保护值）+ λ × 和邻居平均差多远。λ 按短边：格子越少，一颗噪点越显眼，越要平
// 短边超过 120 不跑（大图噪点不显眼，也省时间）；最多 6 遍，没有格子再变就停
const SMOOTH_PROTECT = 0.4, SMOOTH_MAX_SHORT = 120, SMOOTH_PASSES = 6;
const smoothLambda = (short: number) => (short <= 30 ? 0.25 : short <= 50 ? 0.18 : short <= 80 ? 0.12 : 0.07);
function smoothCells(codes: (string | null)[], cols: number, rows: number, means: (Lab | null)[], protect: Float32Array): (string | null)[] {
  const short = Math.min(cols, rows);
  if (short > SMOOTH_MAX_SHORT) return codes;
  const lambda = smoothLambda(short);
  const allowed = [...new Set(codes.filter((c): c is string => !!c))].map(c => colorOf(c));
  const pair = new Map<string, number>();
  const dist = (a: string, b: string) => {
    if (a === b) return 0;
    const k = a < b ? a + b : b + a;
    let d = pair.get(k);
    if (d === undefined) pair.set(k, (d = matchDistance(colorOf(a).lab, colorOf(b).lab)));
    return d;
  };
  const nearestAllowed = means.map(m => (m ? nearestBead(m, allowed).code : null));
  const cur = codes.slice();
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    let changed = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const m = means[i], c = cur[i];
      if (!m || !c) continue;
      const nb: string[] = [];
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = cur[ny * cols + nx];
        if (n) nb.push(n);
      }
      if (!nb.length) continue;
      const weight = 1 + SMOOTH_PROTECT * protect[i];
      const cost = (k: string) => matchDistance(m, colorOf(k).lab) * weight + (lambda * nb.reduce((sum, n) => sum + dist(k, n), 0)) / nb.length;
      let best = c, bc = cost(c);
      for (const k of new Set([...nb, nearestAllowed[i]!])) {
        const v = cost(k);
        if (v < bc - 1e-9) [best, bc] = [k, v];
      }
      if (best !== c) { cur[i] = best; changed++; }
    }
    if (!changed) break;
  }
  return cur;
}

export function generateFromPhoto(input: PhotoInput, options: PhotoOptions): Grid {
  const size = SIZES[options.size];
  const { image, mask } = input;
  const keepBackground = mask === null;

  // 画幅：保留背景 → 整张图按比例放进整块板（占满长边）；抠图 → 主体最长边 = maxSubject
  let box = { x0: 0, y0: 0, x1: image.width, y1: image.height };
  if (mask) {
    let x0 = image.width, y0 = image.height, x1 = 0, y1 = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (mask.data[y * image.width + x] < 0.5) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
    }
    if (x1 > x0) box = { x0, y0, x1, y1 };
  }
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const longSide = options.fit ? fitSide(bw, bh, options.fit.w, options.fit.h) : keepBackground ? size.board : size.maxSubject;
  const cols = bw >= bh ? longSide : Math.max(1, Math.round((longSide * bw) / bh));
  const rows = bw >= bh ? Math.max(1, Math.round((longSide * bh) / bw)) : longSide;

  // 1. 逐格平均色 → 最近色号（同一个颜色只算一次）
  const means = cellMeans(input, cols, rows, box);
  const memo = new Map<string, string>();
  let codes: (string | null)[] = means.map(lab => {
    if (!lab) return null;
    const key = `${Math.round(lab[0] * 400)},${Math.round(lab[1] * 400)},${Math.round(lab[2] * 400)}`;
    let code = memo.get(key);
    if (!code) memo.set(key, (code = nearestBead(lab, PALETTE).code));
    return code;
  });

  // 2–4. 收敛色数 → 清孤豆 → 零碎色
  codes = capPhotoColors(codes, options.maxColors ?? size.autoMaxColors);
  if (!options.keepShades) {
    const protect = protection(means, cols, rows);
    codes = smoothCells(codes, cols, rows, means, protect);
    codes = mergeIsolated(codes, cols, rows);
    codes = mergeFragments(codes, cols, rows, means, protect);
    codes = mergeRareColors(codes, MIN_BEADS_PER_COLOR);
  }

  // 放板：保留背景时占满，空格用图案边上最多的颜色补；抠图时居中留边。自定义尺寸放到能装下它的豆板上，不铺满
  const area = options.fit ? boardArea(cols, rows) : { width: size.board, height: size.board };
  const grid = createGrid(area.width, area.height);
  const ox = Math.floor((area.width - cols) / 2), oy = Math.floor((area.height - rows) / 2);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const gx = ox + x, gy = oy + y;
    if (gx < 0 || gy < 0 || gx >= area.width || gy >= area.height) continue;
    grid.cells[gy * area.width + gx] = codes[y * cols + x];
  }
  // 照片不是正方形时上下（或左右）空出来：每边用挨着它那条边上最多的颜色补，整条边的颜色接着往外铺，不会冒出一条别处的颜色
  if (keepBackground && !options.fit) {
    const commonest = (idx: number[]) => {
      const tally = new Map<string, number>();
      for (const i of idx) { const c = codes[i]; if (c) tally.set(c, (tally.get(c) ?? 0) + 1); }
      let best: string | null = null, bn = 0;
      for (const [c, n] of tally) if (n > bn) [best, bn] = [c, n];
      return best;
    };
    const range = (n: number) => Array.from({ length: n }, (_, i) => i);
    const sides = rows < area.height
      ? { before: commonest(range(cols)), after: commonest(range(cols).map(x => (rows - 1) * cols + x)), vertical: true }
      : { before: commonest(range(rows).map(y => y * cols)), after: commonest(range(rows).map(y => y * cols + cols - 1)), vertical: false };
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== null) continue;
      const x = i % area.width, y = (i - x) / area.width;
      grid.cells[i] = (sides.vertical ? y < oy : x < ox) ? sides.before : sides.after;
    }
  }
  return grid;
}
