// 「假透明」棋盘格背景：很多网上下载的、AI 生成的"透明 PNG"其实把灰白方格直接画进了图里。
// 认出来以后把和边缘连着的方格变成真透明，后面就和用户传一张透明 PNG 一样处理。
// 做法：边缘一圈几乎全是两种浅灰/白，且沿边缘按固定长度交替 → 算出方格大小和起点；
// 按方格判断：整格都是该位置应有的那种颜色才算背景，从边缘的格子往里连；
// 挨着背景、被主体压了一部分的格子，只去掉颜色对得上、又和背景连着的像素。
import type { RgbaImage } from './image';

const NEUTRAL = 18;        // RGB 最大差 ≤ 这个值算无彩色
const LIGHT = 140;         // 亮度 ≥ 这个值算浅色（棋盘格一般是白 + 浅灰）
const MIN_GAP = 12;        // 两种颜色至少差这么多
const MIN_SQUARE = 4;      // 方格边长至少几像素
const BORDER_SHARE = 0.7;  // 边缘至少 7 成像素是这两种颜色
const REGULAR_SHARE = 0.7; // 边缘上的色段至少 7 成长度和方格边长一致

function tone(d: Uint8ClampedArray, i: number): number {
  const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
  if (d[i * 4 + 3] < 128 || Math.max(r, g, b) - Math.min(r, g, b) > NEUTRAL) return -1;
  const v = (r + g + b) / 3;
  return v >= LIGHT ? v : -1;
}

/** 一条边上的色段：返回每次颜色在 亮/暗 之间切换的位置 */
function transitions(tones: number[], mid: number): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let k = 0; k < tones.length; k++) {
    const c = tones[k] < 0 ? 0 : tones[k] >= mid ? 1 : 2;
    if (c && prev && c !== prev) out.push(k);
    if (c) prev = c; else prev = 0;
  }
  return out;
}

/**
 * 从一条边的切换位置估方格边长和起点。缩放过的图边长是小数（如 13.65），
 * 所以从相邻间距的中位数起步，按顺序逐个切换点拟合：每个点先按当前边长算出是第几格，再更新边长，误差不会越积越大。
 */
function fitLine(ts: number[]): { size: number; offset: number; regular: number } | null {
  if (ts.length < 4) return null;
  const gaps = ts.slice(1).map((t, k) => t - ts[k]).sort((a, b) => a - b);
  let size = gaps[gaps.length >> 1];
  if (size < MIN_SQUARE) return null;
  let sxk = 0, skk = 0;
  const ks = [0];
  for (let i = 1; i < ts.length; i++) {
    const k = Math.round((ts[i] - ts[0]) / size);
    ks.push(k);
    if (k < 1) continue;
    sxk += (ts[i] - ts[0]) * k;
    skk += k * k;
    size = sxk / skk;
  }
  let ok = 0, off = 0;
  for (let i = 0; i < ts.length; i++) {
    const err = ts[i] - ts[0] - ks[i] * size;
    if (i > 0 && Math.abs(err) <= 1.5 && ks[i] > ks[i - 1]) ok++;
    off += err;
  }
  const offset = ts[0] + off / ts.length;
  return { size, offset: ((offset % size) + size) % size, regular: ok / (ts.length - 1) };
}

/** 认出假棋盘格就把背景改成透明（直接改 img.data），返回是否改了 */
export function stripChecker(img: RgbaImage): boolean {
  const { width: w, height: h, data: d } = img;
  if (w < 32 || h < 32) return false;
  // 1. 边缘一圈（往里一像素，避开压缩边框）的颜色：两种浅色占绝大多数
  const row = (y: number) => Array.from({ length: w }, (_, x) => tone(d, y * w + x));
  const col = (x: number) => Array.from({ length: h }, (_, y) => tone(d, y * w + x));
  const lines = { top: row(1), bottom: row(h - 2), left: col(1), right: col(w - 2) };
  const all = [...lines.top, ...lines.bottom, ...lines.left, ...lines.right];
  const light = all.filter(v => v >= 0);
  if (light.length < all.length * BORDER_SHARE) return false;
  const sorted = [...light].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.2)], hi = sorted[Math.floor(sorted.length * 0.8)];
  if (hi - lo < MIN_GAP) return false; // 只有一种颜色：普通白底，交给原来的纯色背景处理
  const mid = (lo + hi) / 2;

  // 2. 方格边长和起点：横向用上下边，纵向用左右边，取更规整的那条
  const best = (a: number[], b: number[]) => {
    const fa = fitLine(transitions(a, mid)), fb = fitLine(transitions(b, mid));
    return !fa ? fb : !fb ? fa : fa.regular >= fb.regular ? fa : fb;
  };
  const fx = best(lines.top, lines.bottom), fy = best(lines.left, lines.right);
  if (!fx || !fy || fx.regular < REGULAR_SHARE || fy.regular < REGULAR_SHARE) return false;
  if (Math.abs(fx.size - fy.size) > Math.max(1.5, fx.size * 0.1)) return false;
  const size = (fx.size + fy.size) / 2;
  const cols = Math.ceil((w - fx.offset) / size) + 1, rows = Math.ceil((h - fy.offset) / size) + 1;
  const cellOf = (x: number, y: number) => {
    const cx = Math.floor((x - fx.offset) / size) + 1, cy = Math.floor((y - fy.offset) / size) + 1;
    return cy * cols + cx;
  };
  // 哪种奇偶的格子是亮色：用边缘像素投票
  let vote = 0;
  for (let x = 0; x < w; x++) for (const y of [1, h - 2]) {
    const t = tone(d, y * w + x);
    if (t < 0) continue;
    const c = cellOf(x, y), par = ((c % cols) + Math.floor(c / cols)) & 1;
    vote += (t >= mid) === (par === 0) ? 1 : -1;
  }
  const expect = (c: number) => ((((c % cols) + Math.floor(c / cols)) & 1) === 0) === vote >= 0 ? hi : lo;
  const tol = Math.max(8, (hi - lo) / 3);
  const matches = (i: number, c: number) => {
    const t = tone(d, i);
    return t >= 0 && Math.abs(t - expect(c)) <= tol;
  };

  // 3. 每格统计：去掉格子边上一像素（缩放时两色混出来的过渡）后，几乎全对得上才算背景格
  const total = new Uint32Array(cols * rows), good = new Uint32Array(cols * rows);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ux = (x - fx.offset) / size, uy = (y - fy.offset) / size;
    const ex = (ux - Math.floor(ux)) * size, ey = (uy - Math.floor(uy)) * size;
    if (ex < 1 || ex > size - 1 || ey < 1 || ey > size - 1) continue;
    const c = cellOf(x, y), i = y * w + x;
    total[c]++;
    if (matches(i, c)) good[c]++;
  }
  const bgCell = new Uint8Array(cols * rows);
  const isFull = (c: number) => total[c] > 0 && good[c] >= total[c] * 0.95;
  const stack: number[] = [];
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const edge = cx <= 1 || cy <= 1 || cx >= cols - 2 || cy >= rows - 2;
    const c = cy * cols + cx;
    if (edge && isFull(c)) { bgCell[c] = 1; stack.push(c); }
  }
  while (stack.length) {
    const c = stack.pop()!, cx = c % cols, cy = (c - cx) / cols;
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const n = ny * cols + nx;
      if (!bgCell[n] && isFull(n)) { bgCell[n] = 1; stack.push(n); }
    }
  }

  // 4. 背景格整格透明；挨着背景格的其他格子，颜色对得上且和透明区连着的像素也透明
  const clear = new Uint8Array(w * h);
  const px: number[] = [];
  let cleared = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (bgCell[cellOf(x, y)]) { clear[i] = 1; px.push(i); cleared++; }
  }
  if (cleared < w * h * 0.05) return false;
  while (px.length) {
    const i = px.pop()!, x = i % w, y = (i - x) / w;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (clear[j]) continue;
      // 格子交界处的过渡色：在两种颜色之间也算
      const t = tone(d, j);
      if (matches(j, cellOf(nx, ny)) || (t >= lo - tol && t <= hi + tol && nearSeam(nx, ny))) {
        clear[j] = 1;
        px.push(j);
      }
    }
  }
  function nearSeam(x: number, y: number) {
    const ex = (((x - fx!.offset) / size) % 1 + 1) % 1 * size, ey = (((y - fy!.offset) / size) % 1 + 1) % 1 * size;
    return ex < 1.5 || ex > size - 1.5 || ey < 1.5 || ey > size - 1.5;
  }
  for (let i = 0; i < w * h; i++) if (clear[i]) d[i * 4 + 3] = 0;
  return true;
}
