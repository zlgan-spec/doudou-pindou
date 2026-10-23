// 像素画网格识别：AI 画出来或放大过的像素图，一个"像素"其实是一块 N×N 的色块，
// 而且格距不一定是整数、原点也不一定在 0。这里估计出真实格距和相位，让后面的采样严格按格取色。
// 不是像素画（照片、渐变）时返回 null，流水线走普通路径。
import { rgbToLab, labDistance } from './color';
import type { RgbaImage } from './image';

export interface PixelGrid {
  pitch: number;   // 一个像素画格子对应多少图片像素（不规则网格时是自相关估出的平均格距）
  offsetX: number; // 第一条格线的位置（图片像素）
  offsetY: number;
  cols: number;
  rows: number;
  /** 不规则网格：每条格线的实际位置（含首尾）。有它时 pitch/offset 只作参考 */
  xs?: number[];
  ys?: number[];
  method: 'lattice' | 'boundaries';
}

const EDGE_THRESHOLD = 0.12;  // 相邻像素 Oklab 距离超过这个值算一条边
const MIN_PITCH = 4;
const MAX_PITCH = 64;

/** 每一行 / 列上颜色跳变的位置直方图 */
export function edgeProfile(img: RgbaImage, axis: 'x' | 'y'): Float64Array {
  const { width, height, data } = img;
  const len = axis === 'x' ? width : height;
  const other = axis === 'x' ? height : width;
  const hist = new Float64Array(len);
  const step = Math.max(1, Math.floor(other / 64)); // 抽 64 条线就够
  for (let k = 0; k < other; k += step) {
    let prev: [number, number, number] | null = null;
    for (let i = 1; i < len; i++) {
      const [x, y] = axis === 'x' ? [i, k] : [k, i];
      const idx = (y * width + x) * 4;
      if (data[idx + 3] < 128) {
        prev = null;
        continue;
      }
      const cur = rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
      if (prev && labDistance(prev, cur) > EDGE_THRESHOLD) hist[i] += 1;
      prev = cur;
    }
  }
  return hist;
}

/** 给定格距，找让最多边落在格线上的相位，返回 [相位, 命中比例] */
function bestPhase(hist: Float64Array, pitch: number): [number, number] {
  // 每处边的位置按格距取余、排好序再做前缀和：某个相位落在格线 ±TOLERANCE 内的边用二分查出来，
  // 不用每试一个相位就把所有位置扫一遍（照片边多，原来要算几千万次）
  const rs: number[] = [], ws: number[] = [];
  let total = 0;
  for (let i = 0; i < hist.length; i++) {
    if (!hist[i]) continue;
    rs.push(((i % pitch) + pitch) % pitch);
    ws.push(hist[i]);
    total += hist[i];
  }
  if (total === 0) return [0, 0];
  const order = rs.map((_, k) => k).sort((a, b) => rs[a] - rs[b]);
  const r = order.map(k => rs[k]);
  const sum = new Float64Array(r.length + 1);
  order.forEach((k, j) => (sum[j + 1] = sum[j] + ws[k]));
  const below = (v: number, strict: boolean) => { // 余数小于（strict）/ 不大于 v 的有几个
    let lo = 0, hi = r.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (strict ? r[mid] < v : r[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const within = (a: number, b: number) => sum[below(b, false)] - sum[below(a, true)]; // 余数在 [a, b] 里的边
  let bestOff = 0, bestHit = -1;
  const steps = Math.max(1, Math.round(pitch * 4)); // 相位精度 1/4 像素
  for (let s = 0; s < steps; s++) {
    const off = (s / steps) * pitch;
    const a = off - TOLERANCE, b = off + TOLERANCE; // 格线两侧各 TOLERANCE，超出 0 或格距的部分绕到另一头
    let hit = within(Math.max(0, a), Math.min(pitch, b));
    if (a < 0) hit += within(a + pitch, pitch);
    if (b >= pitch) hit += within(0, b - pitch); // 余数 0 就是格距那条线
    if (hit > bestHit) [bestOff, bestHit] = [off, hit];
  }
  return [bestOff, bestHit / total];
}

const TOLERANCE = 0.75;
const MIN_SCORE = 0.45; // 0 = 和随机分布一样，1 = 全部边都在格线上
const SURE_SCORE = 0.55; // 规则格距得分到这里不用再复核

/** 命中比例换算成"比随机好多少"：格距小的时候随机也能命中很多，必须扣掉 */
function scoreOf(ratio: number, pitch: number): number {
  const baseline = Math.min(1, (TOLERANCE * 2) / pitch);
  return (ratio - baseline) / (1 - baseline);
}

export interface GridAnalysis {
  pitch: number;
  scoreX: number;
  scoreY: number;
  offsetX: number;
  offsetY: number;
}

/** 横竖两个方向一起选格距（像素是方的），再各自找相位 */
export function analyzePixelGrid(img: RgbaImage): GridAnalysis {
  const hx = edgeProfile(img, 'x'), hy = edgeProfile(img, 'y');
  let best = { pitch: 0, score: -Infinity };
  for (let p = MIN_PITCH; p <= MAX_PITCH; p++) {
    const score = scoreOf(bestPhase(hx, p)[1], p) + scoreOf(bestPhase(hy, p)[1], p);
    if (score > best.score) best = { pitch: p, score };
  }
  let fine = best;
  for (let p = best.pitch - 1; p <= best.pitch + 1; p += 0.05) {
    if (p < MIN_PITCH) continue;
    const score = scoreOf(bestPhase(hx, p)[1], p) + scoreOf(bestPhase(hy, p)[1], p);
    if (score > fine.score) fine = { pitch: p, score };
  }
  const [offsetX, rx] = bestPhase(hx, fine.pitch);
  const [offsetY, ry] = bestPhase(hy, fine.pitch);
  return { pitch: fine.pitch, scoreX: scoreOf(rx, fine.pitch), scoreY: scoreOf(ry, fine.pitch), offsetX, offsetY };
}

/** 有边的位置占全部位置的比例。像素画的边只在格线附近（约 1~3 格 / 格距），照片几乎处处有边 */
function occupancy(hist: Float64Array): number {
  const max = Math.max(...hist);
  if (!max) return 0;
  let n = 0;
  for (const v of hist) if (v > max * 0.05) n++;
  return n / hist.length;
}

const MAX_OCCUPANCY_PER_PITCH = 3.2; // 允许每条格线两侧各糊 1 像素

// ---------- 不规则网格：AI 画的"像素风" ----------
// AI 画出来的像素图不是真网格：每格宽度在 ±25% 内浮动，同一条格线在图的上下两端还会错开两三个像素，
// 边缘也是软的。固定格距套不上，所以改成三步：
//   1. 用全图的"边能量"剖面（相邻像素 Oklab 距离按行 / 列求和）做自相关估格距 —— 自相关只看间距、不看相位，不怕漂移；
//   2. 动态规划摆格线：在"格线落在边上"和"间距接近格距"之间取最优，大片平涂区按格距补线；
//   3. 用像素画的本质特征做验收 —— 颜色变化几乎都发生在格线上、格子内部是平涂。
// 格子很小（< 8 像素）时内部没法判断平不平，改看周期性：缩小过的真像素图边是严格周期的，照片和卡通不是。

const NOISE_FLOOR = 0.02;        // 相邻像素色差低于这个值当作噪点（JPEG、渐变），不计入边能量
const LARGE_CELL_PITCH = 8;      // 格距 ≥ 8 像素才能看格子内部是否平涂
const MIN_PERIODICITY = 0.5;     // 小格距：自相关峰谷差下限（像素贴纸 ≥ 0.65，照片 / 卡通 ≤ 0.35）
const MIN_CONCENTRATION = 0.3;   // 大格距：边能量集中在格线上的比例，扣掉随机基线（像素画 ≥ 0.45，照片 / 卡通 ≤ 0.1）
const MIN_FLAT_SHARE = 0.85;     // 大格距：内部平涂的格子占比下限
const FLAT_DENSITY = 0.02;       // 格子中心区域每对相邻像素的平均边能量低于这个值算平涂
const BAND_RATIO = 0.12;         // 格线两侧算作"在格线上"的宽度（格距的比例），容纳软边和弯曲
const GAP_MIN = 0.75, GAP_MAX = 1.35; // 相邻格线间距允许的范围（格距的倍数）
const EDGE_GAP_MIN = 0.5;        // 图片边缘的半格允许更窄
const LINE_COST = 0.3;           // 每放一条格线的代价（单位：平均每格的边能量），防止把软边拆成两条线
const DEVIATION_COST = 1.0;      // 间距偏离格距的代价（每 100% 偏差扣一个单位）
const HIGHPASS_HALF = 48;        // 自相关前去掉的慢变化成分的半窗
const MIN_CELLS = 8, MAX_CELLS = 200;

interface Gradients {
  dx: Float32Array; // dx[y*w+x]：像素 (x-1,y) 与 (x,y) 的色差，x=0 或任一方透明时为 0
  dy: Float32Array; // dy[y*w+x]：像素 (x,y-1) 与 (x,y) 的色差
  gx: Float64Array; // 长 w+1：每条竖格线位置 i（像素 i-1 和 i 之间）的边能量
  gy: Float64Array; // 长 h+1
  opaque: Uint8Array;
}

function computeGradients(img: RgbaImage): Gradients {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const lab = new Float32Array(n * 3);
  const opaque = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) continue;
    opaque[i] = 1;
    const [l, a, b] = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    lab[i * 3] = l;
    lab[i * 3 + 1] = a;
    lab[i * 3 + 2] = b;
  }
  const dist = (i: number, j: number) => {
    const dl = lab[i * 3] - lab[j * 3], da = lab[i * 3 + 1] - lab[j * 3 + 1], db = lab[i * 3 + 2] - lab[j * 3 + 2];
    return Math.max(0, Math.sqrt(dl * dl + da * da + db * db) - NOISE_FLOOR);
  };
  const dx = new Float32Array(n), dy = new Float32Array(n);
  const gx = new Float64Array(w + 1), gy = new Float64Array(h + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!opaque[i]) continue;
      if (x > 0 && opaque[i - 1]) gx[x] += dx[i] = dist(i, i - 1);
      if (y > 0 && opaque[i - w]) gy[y] += dy[i] = dist(i, i - w);
    }
  }
  return { dx, dy, gx, gy, opaque };
}

function prefixSums(g: ArrayLike<number>): Float64Array {
  const cs = new Float64Array(g.length + 1);
  for (let i = 0; i < g.length; i++) cs[i + 1] = cs[i] + g[i];
  return cs;
}

/** 边能量剖面的自相关：峰的位置就是格距；峰谷差衡量周期性有多强（严格周期 → 1，平滑 / 随机 → 0） */
function autocorrelation(g: Float64Array): { lag: number; periodicity: number } {
  const n = g.length;
  // 去掉慢变化（照片里"这片区域边多、那片边少"），只留格距尺度的起伏
  const cs = prefixSums(g);
  const hp = new Float64Array(n);
  let den = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - HIGHPASS_HALF), hi = Math.min(n, i + HIGHPASS_HALF + 1);
    hp[i] = g[i] - (cs[hi] - cs[lo]) / (hi - lo);
    den += hp[i] * hp[i];
  }
  const maxLag = Math.min(MAX_PITCH, Math.floor(n / 4));
  if (!den || maxLag < MIN_PITCH) return { lag: 0, periodicity: 0 };
  const ac = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += hp[i] * hp[i - lag];
    ac[lag] = s / den;
  }
  let lag = MIN_PITCH;
  for (let l = MIN_PITCH + 1; l <= maxLag; l++) if (ac[l] > ac[lag]) lag = l;
  const half = Math.ceil(lag / 2);
  let trough = Infinity;
  for (let l = Math.max(1, lag - half); l <= Math.min(maxLag, lag + half); l++) trough = Math.min(trough, ac[l]);
  return { lag, periodicity: ac[lag] - trough };
}

/**
 * 动态规划摆格线：位置 0..n（n = 图片边长），首尾必须是格线。
 * 目标 = Σ 格线带内边能量 − 每条线的固定代价 − 间距偏离格距的代价。
 * 有边的地方线会贴着边走（间距在 [0.75, 1.35] 格距内自由），平涂区没有边可贴，代价项让线按格距均匀排。
 */
function placeLines(g: Float64Array, pitch: number): { lines: number[]; band: number } {
  const n = g.length - 1;
  const band = Math.max(1, Math.round(BAND_RATIO * pitch));
  const cs = prefixSums(g);
  const bandEnergy = (i: number) => cs[Math.min(n + 1, i + band + 1)] - cs[Math.max(0, i - band)];
  const unit = cs[n + 1] / Math.max(1, n / pitch); // 平均每格的边能量
  const gapMin = Math.max(2, Math.round(GAP_MIN * pitch));
  const gapMax = Math.max(gapMin + 1, Math.round(GAP_MAX * pitch));
  const edgeGapMin = Math.max(1, Math.round(EDGE_GAP_MIN * pitch));
  const score = new Float64Array(n + 1).fill(-Infinity);
  const prev = new Int32Array(n + 1).fill(-1);
  score[0] = 0;
  for (let i = 1; i <= n; i++) {
    const energy = bandEnergy(i) - LINE_COST * unit;
    for (let j = Math.max(0, i - gapMax); j < i; j++) {
      if (score[j] === -Infinity) continue;
      const gap = i - j;
      if (gap < (j === 0 || i === n ? edgeGapMin : gapMin)) continue;
      const v = score[j] + energy - DEVIATION_COST * unit * Math.abs(gap - pitch) / pitch;
      if (v > score[i]) {
        score[i] = v;
        prev[i] = j;
      }
    }
  }
  if (score[n] === -Infinity) return { lines: [0, n], band };
  const lines: number[] = [];
  for (let i = n; i >= 0; i = prev[i]) {
    lines.push(i);
    if (i === 0) break;
  }
  return { lines: lines.reverse(), band };
}

/** 边能量落在格线带内的比例，扣掉"带占了多少位置"这个随机基线：像素画 → 接近 1，边到处都有的图 → 接近 0 */
function concentration(g: Float64Array, lines: number[], band: number): number {
  const n = g.length;
  const covered = new Uint8Array(n);
  for (const p of lines) for (let i = Math.max(0, p - band); i <= Math.min(n - 1, p + band); i++) covered[i] = 1;
  let total = 0, onLines = 0, coveredCount = 0;
  for (let i = 0; i < n; i++) {
    total += g[i];
    if (covered[i]) {
      onLines += g[i];
      coveredCount++;
    }
  }
  if (!total || coveredCount >= n) return 0;
  const coverage = coveredCount / n;
  return (onLines / total - coverage) / (1 - coverage);
}

/** 内部平涂的格子占比：每格取中间一半区域，相邻像素平均色差低于 FLAT_DENSITY 算平涂；透明格不算 */
function flatShare(grad: Gradients, width: number, xs: number[], ys: number[]): number {
  let flat = 0, cells = 0;
  for (let r = 0; r + 1 < ys.length; r++) {
    const insetY = Math.max(1, Math.round((ys[r + 1] - ys[r]) * 0.25));
    const y0 = ys[r] + insetY, y1 = ys[r + 1] - insetY;
    if (y1 - y0 < 2) continue;
    for (let c = 0; c + 1 < xs.length; c++) {
      const insetX = Math.max(1, Math.round((xs[c + 1] - xs[c]) * 0.25));
      const x0 = xs[c] + insetX, x1 = xs[c + 1] - insetX;
      if (x1 - x0 < 2) continue;
      let energy = 0, pairs = 0, opaque = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * width + x;
          opaque += grad.opaque[i];
          if (x > x0) {
            energy += grad.dx[i];
            pairs++;
          }
          if (y > y0) {
            energy += grad.dy[i];
            pairs++;
          }
        }
      }
      if (opaque < (y1 - y0) * (x1 - x0) * 0.5) continue;
      cells++;
      if (energy / pairs < FLAT_DENSITY) flat++;
    }
  }
  return cells ? flat / cells : 0;
}

export interface IrregularAnalysis {
  pitch: number;
  lagX: number;
  lagY: number;
  periodicityX: number;
  periodicityY: number;
  concentrationX: number;
  concentrationY: number;
  flatShare: number;
  cols: number;
  rows: number;
  grid: PixelGrid | null; // 通过验收才有
}

/** 不规则网格分析：返回全部指标（给调试台看），grid 非空表示通过验收 */
export function analyzeIrregularGrid(img: RgbaImage): IrregularAnalysis | null {
  const grad = computeGradients(img);
  const ax = autocorrelation(grad.gx), ay = autocorrelation(grad.gy);
  if (!ax.lag || !ay.lag) return null;
  const pitch = (ax.lag + ay.lag) / 2;
  const bx = placeLines(grad.gx, pitch), by = placeLines(grad.gy, pitch);
  const cols = bx.lines.length - 1, rows = by.lines.length - 1;
  const result: IrregularAnalysis = {
    pitch,
    lagX: ax.lag,
    lagY: ay.lag,
    periodicityX: ax.periodicity,
    periodicityY: ay.periodicity,
    concentrationX: concentration(grad.gx, bx.lines, bx.band),
    concentrationY: concentration(grad.gy, by.lines, by.band),
    flatShare: flatShare(grad, img.width, bx.lines, by.lines),
    cols,
    rows,
    grid: null,
  };
  // 像素是方的：两个方向的格距要一致
  if (Math.abs(ax.lag - ay.lag) > Math.max(1, 0.15 * Math.max(ax.lag, ay.lag))) return result;
  if (cols < MIN_CELLS || rows < MIN_CELLS || cols > MAX_CELLS || rows > MAX_CELLS) return result;
  // 小格距只看周期性会把 JPEG 照片当成像素画（8×8 压缩块缩小后也有周期），所以两种格距都要求边集中在格线上
  const concentrated = result.concentrationX >= MIN_CONCENTRATION && result.concentrationY >= MIN_CONCENTRATION;
  const accepted = pitch < LARGE_CELL_PITCH
    ? result.periodicityX >= MIN_PERIODICITY && result.periodicityY >= MIN_PERIODICITY && concentrated
    : concentrated && result.flatShare >= MIN_FLAT_SHARE;
  if (accepted) {
    result.grid = { pitch, offsetX: bx.lines[0], offsetY: by.lines[0], cols, rows, xs: bx.lines, ys: by.lines, method: 'boundaries' };
  }
  return result;
}

export function detectPixelGrid(img: RgbaImage): PixelGrid | null {
  const hx = edgeProfile(img, 'x'), hy = edgeProfile(img, 'y');
  const a = analyzePixelGrid(img);
  const limit = MAX_OCCUPANCY_PER_PITCH / a.pitch;
  const irregular = analyzeIrregularGrid(img);
  // 规则格距刚过线时（低清 JPEG 也能到 0.49），再看边是不是真的集中在格线上
  const sure = (a.scoreX >= SURE_SCORE && a.scoreY >= SURE_SCORE)
    || (!!irregular && irregular.concentrationX >= MIN_CONCENTRATION && irregular.concentrationY >= MIN_CONCENTRATION);
  if (a.scoreX >= MIN_SCORE && a.scoreY >= MIN_SCORE && sure && occupancy(hx) <= limit && occupancy(hy) <= limit) {
    const offsetX = a.offsetX % a.pitch, offsetY = a.offsetY % a.pitch;
    return {
      pitch: a.pitch,
      offsetX,
      offsetY,
      cols: Math.floor((img.width - offsetX) / a.pitch),
      rows: Math.floor((img.height - offsetY) / a.pitch),
      method: 'lattice',
    };
  }
  // 规则格距套不上，试不规则格线
  return irregular?.grid ?? null;
}

/** 按识别出的网格重新采样：每格取中心区域的多数色（避开格子边缘的压缩毛边），输出 1 像素 = 1 格的小图 */
export function resampleOnGrid(img: RgbaImage, grid: PixelGrid): RgbaImage {
  const { pitch, offsetX, offsetY, cols, rows } = grid;
  const out = new Uint8ClampedArray(cols * rows * 4);
  const xs = grid.xs ?? Array.from({ length: cols + 1 }, (_, c) => offsetX + c * pitch);
  const ys = grid.ys ?? Array.from({ length: rows + 1 }, (_, r) => offsetY + r * pitch);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // 每格取中间一半区域，避开格子边缘的软边
      const cw = xs[c + 1] - xs[c], ch = ys[r + 1] - ys[r];
      const x0 = Math.round(xs[c] + cw * 0.25), x1 = Math.max(x0 + 1, Math.round(xs[c + 1] - cw * 0.25));
      const y0 = Math.round(ys[r] + ch * 0.25), y1 = Math.max(y0 + 1, Math.round(ys[r + 1] - ch * 0.25));
      const tally = new Map<number, number>();
      let alphaSum = 0, n = 0;
      for (let y = y0; y < y1 && y < img.height; y++) {
        for (let x = x0; x < x1 && x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          n++;
          alphaSum += img.data[i + 3];
          if (img.data[i + 3] < 128) continue;
          // 量化到 4 级/通道再投票，JPEG 噪点不会把同一块色拆成几十种
          const key = ((img.data[i] >> 4) << 8) | ((img.data[i + 1] >> 4) << 4) | (img.data[i + 2] >> 4);
          tally.set(key, (tally.get(key) ?? 0) + 1);
        }
      }
      const o = (r * cols + c) * 4;
      if (!n || tally.size === 0) {
        out[o + 3] = 0;
        continue;
      }
      let bestKey = 0, bestN = 0;
      for (const [k, v] of tally) if (v > bestN) [bestKey, bestN] = [k, v];
      // 用该主色桶内像素的平均值作为输出色
      let rs = 0, gs = 0, bs = 0, m = 0;
      for (let y = y0; y < y1 && y < img.height; y++) {
        for (let x = x0; x < x1 && x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (img.data[i + 3] < 128) continue;
          const key = ((img.data[i] >> 4) << 8) | ((img.data[i + 1] >> 4) << 4) | (img.data[i + 2] >> 4);
          if (key !== bestKey) continue;
          rs += img.data[i];
          gs += img.data[i + 1];
          bs += img.data[i + 2];
          m++;
        }
      }
      out[o] = Math.round(rs / m);
      out[o + 1] = Math.round(gs / m);
      out[o + 2] = Math.round(bs / m);
      out[o + 3] = alphaSum / n >= 128 ? 255 : 0;
    }
  }
  return { width: cols, height: rows, data: out };
}
