// 编辑操作：每个操作都是"旧格子表格 → 新格子表格"，不修改原表，方便撤销。
import { capColors, mergeSmallRegions, protectDetails, removeIslands } from './cleanup';
import { MAX_CUSTOM_SIDE, SIZES, boardArea } from './config';
import { cloneGrid, contentBounds, legendOf, NEIGHBORS, placeOnBoard, type Grid } from './grid';
import { colorOf, matchDistance } from './palette';

/** 画笔 / 橡皮：code 为 null 时就是橡皮 */
export function paintCells(grid: Grid, points: Array<[number, number]>, code: string | null): Grid {
  const next = cloneGrid(grid);
  let changed = false;
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
    const i = y * grid.width + x;
    if (next.cells[i] === code) continue;
    next.cells[i] = code;
    changed = true;
  }
  return changed ? next : grid; // 没有任何变化时返回原表，不产生撤销记录
}

/** 填充：把与起点相连、颜色相同的一片格子换成新颜色（空格区域也可以填） */
export function fillRegion(grid: Grid, x: number, y: number, code: string | null): Grid {
  const { width, height } = grid;
  if (x < 0 || y < 0 || x >= width || y >= height) return grid;
  const target = grid.cells[y * width + x];
  if (target === code) return grid;
  const next = cloneGrid(grid);
  const stack = [y * width + x];
  next.cells[stack[0]] = code;
  while (stack.length) {
    const i = stack.pop()!;
    const cx = i % width, cy = (i - cx) / width;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (next.cells[j] !== target) continue;
      next.cells[j] = code;
      stack.push(j);
    }
  }
  return next;
}

/** 色卡替换：整张图里 from 全部换成 to；to 已在用时两张色卡自然合并；to 为 null 就是把这个颜色的豆子全部清空 */
export function replaceColor(grid: Grid, from: string, to: string | null): Grid {
  if (from === to || !grid.cells.includes(from)) return grid;
  return { ...grid, cells: grid.cells.map(c => (c === from ? to : c)) };
}

/** 镜像：每一行左右翻转 */
export function mirrorGrid(grid: Grid): Grid {
  const { width, height, cells } = grid;
  const next = cloneGrid(grid);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) next.cells[y * width + x] = cells[y * width + (width - 1 - x)];
  }
  return next;
}

/** 文字：把位图（true = 有笔画）盖到 (left, top) 位置，用 code 着色 */
export function stampBitmap(grid: Grid, bitmap: boolean[][], left: number, top: number, code: string): Grid {
  const points: Array<[number, number]> = [];
  bitmap.forEach((row, dy) => row.forEach((on, dx) => on && points.push([left + dx, top + dy])));
  return paintCells(grid, points, code);
}

/** 选区：格子坐标的矩形，含 x、y，宽 w 高 h */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inRect = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

function mapCells(grid: Grid, fn: (code: string | null, x: number, y: number) => string | null): Grid {
  let changed = false;
  const cells = grid.cells.map((c, i) => {
    const x = i % grid.width;
    const next = fn(c, x, (i - x) / grid.width);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...grid, cells } : grid;
}

/** 选区里填一种颜色；code 为 null 就是清空 */
export function fillRect(grid: Grid, r: Rect, code: string | null): Grid {
  return mapCells(grid, (c, x, y) => (inRect(r, x, y) ? code : c));
}

/** 把选区内容贴到挪 (dx, dy) 的位置，超出豆板的部分丢掉；clearSource 为 true 是移动，false 是复制 */
function shiftRect(grid: Grid, r: Rect, dx: number, dy: number, clearSource: boolean): Grid {
  const next = cloneGrid(clearSource ? fillRect(grid, r, null) : grid);
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const code = grid.cells[y * grid.width + x];
      const nx = x + dx, ny = y + dy;
      if (!code || nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      next.cells[ny * grid.width + nx] = code;
    }
  }
  return next;
}

/** 移动选区：内容挪过去，原位置空出来 */
export function moveRect(grid: Grid, r: Rect, dx: number, dy: number): Grid {
  return dx || dy ? shiftRect(grid, r, dx, dy, true) : grid;
}

/** 复制选区：原位置保留，在挪 (dx, dy) 的位置再贴一份 */
export function copyRect(grid: Grid, r: Rect, dx: number, dy: number): Grid {
  return dx || dy ? shiftRect(grid, r, dx, dy, false) : grid;
}

/** 复制品放哪：右边放得下就放右边，其次左边、下面、上面，都放不下就错开 2 格 */
export function copySpot(grid: Grid, r: Rect): [number, number] {
  const gap = 1;
  if (r.x + r.w * 2 + gap <= grid.width) return [r.w + gap, 0];
  if (r.x - r.w - gap >= 0) return [-(r.w + gap), 0];
  if (r.y + r.h * 2 + gap <= grid.height) return [0, r.h + gap];
  if (r.y - r.h - gap >= 0) return [0, -(r.h + gap)];
  return [2, 2];
}

/** 选区内左右翻转 */
export function mirrorRect(grid: Grid, r: Rect): Grid {
  return mapCells(grid, (c, x, y) => (inRect(r, x, y) ? grid.cells[y * grid.width + (2 * r.x + r.w - 1 - x)] : c));
}

/** 删色：这个颜色的格子全部换成图里剩下的颜色中最接近的一个，少买一种豆子 */
export function removeColor(grid: Grid, code: string): Grid {
  const to = nearestOther(grid, code);
  return to ? replaceColor(grid, code, to) : grid;
}

/** 图里除了 code 以外最接近它的颜色；只剩它一种时返回 null */
export function nearestOther(grid: Grid, code: string): string | null {
  const others = legendOf(grid).map(l => l.code).filter(c => c !== code);
  if (!others.length) return null;
  const lab = colorOf(code).lab;
  return others.reduce((best, c) => (matchDistance(lab, colorOf(c).lab) < matchDistance(lab, colorOf(best).lab) ? c : best));
}

/** 描边：图案外面一圈空格（上下左右和斜角挨着豆子的空格）铺上 code；图案铺满豆板时没有空位，返回原表 */
export function outlineGrid(grid: Grid, code: string): Grid {
  const { width: w, height: h, cells } = grid;
  const next = cells.slice();
  let changed = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x]) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && cells[ny * w + nx]) { touches = true; break; }
        }
      }
      if (touches) { next[y * w + x] = code; changed = true; }
    }
  }
  return changed ? { ...grid, cells: next } : grid;
}

/**
 * 减少颜色：先并「用量少、又和别的颜色很像」的，直到只剩 n 色。
 * 眼睛、鼻子、高光这类关键细节的颜色不并（之前深灰的鼻子会被并进旁边鱼的棕色）；细节色太多时只保最多的几种，保证能减到 n
 */
export function reduceColors(grid: Grid, n: number): Grid {
  const target = Math.max(1, n);
  const keep = protectDetails(grid.cells, grid.width, grid.height);
  const counts = new Map<string, number>();
  keep.forEach((k, i) => { const c = grid.cells[i]; if (k && c) counts.set(c, (counts.get(c) ?? 0) + 1); });
  const protect = new Set([...counts].sort((a, b) => b[1] - a[1]).slice(0, Math.max(0, target - 2)).map(([c]) => c));
  const cells = capColors(grid.cells, target, protect);
  return cells === grid.cells ? grid : { ...grid, cells };
}

/** 降噪：1~2 颗的零碎同色小点并进旁边的色块，再去掉孤立的小豆；眼睛高光这类关键细节保留 */
export function denoise(grid: Grid): Grid {
  const { width: w, height: h } = grid;
  const merged = mergeSmallRegions(grid.cells, w, h, 3, protectDetails(grid.cells, w, h));
  const cells = removeIslands(merged, w, h);
  return cells.every((c, i) => c === grid.cells[i]) ? grid : { ...grid, cells };
}

/** 撤销 / 重做：只存快照，T 一般是 { grid, mirrored } */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const HISTORY_LIMIT = 100;

export function startHistory<T>(state: T): History<T> {
  return { past: [], present: state, future: [] };
}

export function commit<T>(history: History<T>, state: T): History<T> {
  if (state === history.present) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: state, future: [] };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return { past: [...history.past, history.present], present: next, future: rest };
}

/** 编辑时豆板最多扩到多大（和图纸数据校验的上限一致） */
export const MAX_EDIT_SIDE = MAX_CUSTOM_SIDE;

/**
 * 尺寸规则：编辑时画到豆板边外，豆板扩大。
 * 还放得进一块标准板：按 52 → 78 → 104 找能装下的最小一块，四边等量扩、原图案居中；
 * 放不下了：用 104 板拼，画出去的那一边加整块的板（原来的板不动），每边最多 MAX_EDIT_SIDE 颗。
 * x0..x1、y0..y1 是要画的范围（旧坐标，可以是负数）。本来就在板内、或超过上限时返回 null；
 * 否则返回扩大后的表格和旧格子在新表格里的偏移 dx、dy
 */
export function growToFit(grid: Grid, x0: number, y0: number, x1: number, y1: number): { grid: Grid; dx: number; dy: number } | null {
  if (x0 >= 0 && y0 >= 0 && x1 < grid.width && y1 < grid.height) return null;
  const BOARD = SIZES.large.board;
  const from = Math.max(grid.width, grid.height);
  const centered = (side: number): [number, number] => [Math.floor((side - grid.width) / 2), Math.floor((side - grid.height) / 2)];
  const fits = (side: number) => {
    const [ox, oy] = centered(side);
    return x0 + ox >= 0 && y0 + oy >= 0 && x1 + ox < side && y1 + oy < side;
  };
  const side = from <= BOARD ? Object.values(SIZES).map(s => s.board).find(b => b > from && fits(b)) : undefined;
  if (side) return place(grid, side, side, ...centered(side));
  // 每个方向：不是整块 104 的先居中放进一块 104，再往画出去的那边加整块的板
  const axis = (size: number, a0: number, a1: number): [number, number] => {
    const off = size % BOARD ? Math.floor((BOARD - size) / 2) : 0;
    const base = size % BOARD ? BOARD : size;
    const before = a0 + off < 0 ? Math.ceil(-(a0 + off) / BOARD) * BOARD : 0;
    const after = a1 + off >= base ? Math.ceil((a1 + off - base + 1) / BOARD) * BOARD : 0;
    return [before + base + after, off + before];
  };
  const [w, dx] = axis(grid.width, x0, x1);
  const [h, dy] = axis(grid.height, y0, y1);
  return w > MAX_EDIT_SIDE || h > MAX_EDIT_SIDE ? null : place(grid, w, h, dx, dy);
}

function place(grid: Grid, w: number, h: number, dx: number, dy: number): { grid: Grid; dx: number; dy: number } {
  const cells: (string | null)[] = new Array(w * h).fill(null);
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) cells[(y + dy) * w + x + dx] = grid.cells[y * grid.width + x];
  return { grid: { width: w, height: h, cells }, dx, dy };
}

/**
 * 没有原图时换尺寸：图案原样换到 w×h 对应的豆板上（52 / 78 / 104，或几块 104 拼成的范围），居中；
 * w×h 放不下图案时才按比例缩小（每格取对应范围里最多的颜色，空格也算一种）。不给 w×h 就用能装下图案的最小那块
 */
export function fitOnBoard(grid: Grid, w?: number, h?: number): Grid {
  const b = contentBounds(grid);
  if (!b) return grid;
  const cw = b.right - b.left + 1, ch = b.bottom - b.top + 1;
  const [bw, bh] = w && h ? [w, h] : [cw, ch];
  const area = boardArea(bw, bh);
  let src: Grid = { width: cw, height: ch, cells: [] };
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) src.cells.push(grid.cells[(b.top + y) * grid.width + b.left + x]);
  const k = Math.min(1, bw / cw, bh / ch);
  if (k < 1) {
    const nw = Math.max(1, Math.floor(cw * k)), nh = Math.max(1, Math.floor(ch * k));
    const cells: (string | null)[] = [];
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const tally = new Map<string | null, number>();
      for (let sy = Math.floor((y * ch) / nh); sy < Math.max(Math.floor((y * ch) / nh) + 1, Math.floor(((y + 1) * ch) / nh)); sy++) {
        for (let sx = Math.floor((x * cw) / nw); sx < Math.max(Math.floor((x * cw) / nw) + 1, Math.floor(((x + 1) * cw) / nw)); sx++) {
          const c = src.cells[sy * cw + sx];
          tally.set(c, (tally.get(c) ?? 0) + 1);
        }
      }
      let best: string | null = null, n = 0;
      for (const [c, m] of tally) if (m > n) [best, n] = [c, m];
      cells.push(best);
    }
    src = { width: nw, height: nh, cells };
  }
  return placeOnBoard(src, area.width, area.height) ?? grid;
}
