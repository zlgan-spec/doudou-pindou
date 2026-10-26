// 照片路径（保留背景或抠图后的主体）。2026-10-26 按对比实验改成「细腻」做法：
//   1. 每格取原图这一块的平均色（面积平均，不先滤波），逐格找最接近的色号 → 光影渐变都在
//   2. 收敛色数：用量最少的颜色并进最接近的、还留着的颜色，直到不超过上限（默认按豆板 20 / 30 / 40）
//   3. 清孤豆：上下左右都没有同色的单颗，周围 8 格里最多的颜色和它够接近就换成那个（两遍）
//   4. 零碎色并入最接近的；放板：保留背景时占满整块板，空出来的格子用图案边上最多的颜色补
// 8 张测试照片上，和原图的平均色差比原来的做法小一半左右，孤豆是「不限色、不清理」的三分之一到四分之一
import { rgbToLab, type Lab } from './color';
import { MIN_BEADS_PER_COLOR, SIZES, boardArea, fitSide, type SizeId, type StyleId } from './config';
import { mergeRareColors } from './cleanup';
import { createGrid, type Grid } from './grid';
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

/** 每格的平均色；格子里大半是透明或抠图外就是 null */
function cellMeans(input: PhotoInput, cols: number, rows: number, box: { x0: number; y0: number; x1: number; y1: number }): (Lab | null)[] {
  const { image, mask } = input;
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const out: (Lab | null)[] = new Array(cols * rows).fill(null);
  for (let gy = 0; gy < rows; gy++) {
    const ya = box.y0 + Math.floor((gy * bh) / rows), yb = Math.max(ya + 1, box.y0 + Math.floor(((gy + 1) * bh) / rows));
    for (let gx = 0; gx < cols; gx++) {
      const xa = box.x0 + Math.floor((gx * bw) / cols), xb = Math.max(xa + 1, box.x0 + Math.floor(((gx + 1) * bw) / cols));
      let r = 0, g = 0, b = 0, n = 0, all = 0;
      for (let y = ya; y < yb && y < image.height; y++) {
        for (let x = xa; x < xb && x < image.width; x++) {
          all++;
          const i = y * image.width + x;
          if ((mask ? mask.data[i] : image.data[i * 4 + 3] / 255) < 0.5) continue;
          r += image.data[i * 4];
          g += image.data[i * 4 + 1];
          b += image.data[i * 4 + 2];
          n++;
        }
      }
      if (n * 2 < all || n === 0) continue;
      out[gy * cols + gx] = rgbToLab(Math.round(r / n), Math.round(g / n), Math.round(b / n));
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

/** 用量最少的颜色并进最接近的、还留着的颜色，直到不超过 max 种 */
function capColors(codes: (string | null)[], max: number): void {
  const counts = new Map<string, number>();
  for (const c of codes) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  const remap = new Map<string, string>();
  while (counts.size > max) {
    let rare = '', rn = Infinity;
    for (const [c, n] of counts) if (n < rn) [rare, rn] = [c, n];
    counts.delete(rare);
    const lab = colorOf(rare).lab;
    let to = '', td = Infinity;
    for (const c of counts.keys()) {
      const d = matchDistance(lab, colorOf(c).lab);
      if (d < td) [to, td] = [c, d];
    }
    counts.set(to, counts.get(to)! + rn);
    remap.set(rare, to);
    for (const [from, target] of remap) if (target === rare) remap.set(from, to); // 之前并进它的，也跟着并过去
  }
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c && remap.has(c)) codes[i] = remap.get(c)!;
  }
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
  capColors(codes, options.maxColors ?? size.autoMaxColors);
  if (!options.keepShades) {
    codes = mergeIsolated(codes, cols, rows);
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
