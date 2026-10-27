// 豆图等比放大缩小（选区缩放用）。按像素画的规矩来：
// - 整数倍放大：一颗豆正好变成 k×k 颗，最整齐，直接复制
// - 缩小：每颗新豆看它盖住的那一整块，按面积投票；深色细线、眼睛高光这类细节多一点票，面积打平时它赢，不会被隔颗取样跳掉；
//   眼睛、按钮这类小而实的形状按比例重画（同样大的两只眼睛缩完也一样大）；缩完整块不见了的细节，在它中心补回一颗
// - 非整数倍放大（1.5 倍）：先整数倍放大，再按上面的办法缩回去，同一条线粗细一致
import { colorOf } from './palette';

type Cells = (string | null)[];
export interface Scaled { cells: Cells; w: number; h: number }

const DETAIL_DARK = 0.12;  // 比周围平均暗这么多：轮廓、眼睛
const DETAIL_LIGHT = 0.15; // 比周围平均亮这么多：高光
const COMPACT_MAX_AREA = 25, COMPACT_FILL = 0.75; // 外框不超过 5×5、填满七成半以上：眼睛、圆点这类小而实的形状（十字、星星这种空心的不算，重画会走样）
const EPS = 1e-6; // 面积是小数相加，正好打平时别被误差带偏
const ORPHAN_KEEP_CONTRAST = 0.25; // 孤豆和周围明暗差这么多就当细节留着
const WEIGHT_DETAIL = 1.35; // 只多一点票：面积打平时细节赢（一颗宽的轮廓不断），但不会把眼睛撑成一条

const lightness = (c: string) => colorOf(c).lab[0];

/** 同色 4 邻接连通块：每格属于第几块、每块多大 */
function regions(cells: Cells, w: number, h: number): { id: Int32Array; size: number[]; first: number[]; box: Array<{ x0: number; y0: number; x1: number; y1: number }> } {
  const id = new Int32Array(cells.length).fill(-1);
  const size: number[] = [], first: number[] = [], box: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i] || id[i] >= 0) continue;
    const r = size.length, stack = [i];
    id[i] = r;
    let n = 0;
    const b = { x0: w, y0: h, x1: 0, y1: 0 };
    while (stack.length) {
      const j = stack.pop()!;
      n++;
      const x = j % w, y = (j - x) / w;
      b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x + 1); b.y1 = Math.max(b.y1, y + 1);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (id[k] < 0 && cells[k] === cells[i]) { id[k] = r; stack.push(k); }
      }
    }
    size.push(n);
    first.push(i);
    box.push(b);
  }
  return { id, size, first, box };
}

/** 每颗豆的票数权重：细节（比周围明显深或亮）多一点 */
function weights(cells: Cells, w: number, h: number): Float32Array {
  const wt = new Float32Array(cells.length).fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, c = cells[i];
    if (!c) continue;
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const o = cells[ny * w + nx];
      if (o) { sum += lightness(o); n++; }
    }
    const l = lightness(c), avg = n ? sum / n : l;
    if (avg - l > DETAIL_DARK || l - avg > DETAIL_LIGHT) wt[i] = WEIGHT_DETAIL;
  }
  return wt;
}

/** 缩到 tw×th（ratio = tw / w ≤ 1） */
function shrink(cells: Cells, w: number, h: number, tw: number, th: number): Cells {
  const rx = tw / w, ry = th / h;
  const reg = regions(cells, w, h);
  const wt = weights(cells, w, h);
  const out: Cells = new Array(tw * th).fill(null);
  const placed = new Uint8Array(tw * th);
  const second: Cells = new Array(tw * th).fill(null); // 票数第二的颜色：形状被收窄时退回它
  const owner = new Int32Array(tw * th).fill(-1);       // 赢的颜色里贡献最多的那一块（原图的连通块）
  for (let ty = 0; ty < th; ty++) {
    const y0 = ty / ry, y1 = (ty + 1) / ry;
    for (let tx = 0; tx < tw; tx++) {
      const x0 = tx / rx, x1 = (tx + 1) / rx;
      const votes = new Map<string, number>();
      const byRegion = new Map<number, number>();
      let filled = 0, area = 0;
      for (let y = Math.floor(y0); y < Math.min(h, Math.ceil(y1)); y++) {
        const fy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.min(w, Math.ceil(x1)); x++) {
          const f = (Math.min(x + 1, x1) - Math.max(x, x0)) * fy;
          if (f <= 0) continue;
          area += f;
          const c = cells[y * w + x];
          if (!c) continue;
          filled += f;
          votes.set(c, (votes.get(c) ?? 0) + f * wt[y * w + x]);
          const r = reg.id[y * w + x];
          byRegion.set(r, (byRegion.get(r) ?? 0) + f);
        }
      }
      if (filled * 2 < area - EPS) continue; // 大半是空格：留空，轮廓外不长出豆子（正好一半算有豆，免得同一条边一行有一行没有）
      let best: string | null = null, bv = -1, next: string | null = null, nv = -1;
      for (const [c, v] of votes) {
        if (v > bv + EPS || (Math.abs(v - bv) <= EPS && best && lightness(c) < lightness(best))) { [next, nv] = [best, bv]; [best, bv] = [c, v]; }
        else if (v > nv) [next, nv] = [c, v];
      }
      const i = ty * tw + tx;
      out[i] = best;
      second[i] = next;
      let or = -1, ov = -1;
      for (const [r, v] of byRegion) if (cells[reg.first[r]] === best && v > ov) [or, ov] = [r, v];
      owner[i] = or;
    }
  }
  // 小而实的形状（眼睛、按钮、星星中心）：不靠投票，按比例重新画一块。原图一样大的两只眼睛缩完也一样大、一样方，
  // 不会一只 2×1 一只 1×1（2×2 的眼睛正好压在两颗新豆中间时，投票两边打平就会撑成一条）
  const compact: number[] = [];
  for (let r = 0; r < reg.size.length; r++) {
    const b = reg.box[r], bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    if (bw * bh > COMPACT_MAX_AREA || reg.size[r] < COMPACT_FILL * bw * bh || wt[reg.first[r]] < WEIGHT_DETAIL) continue;
    compact.push(r);
  }
  for (const r of compact) for (let i = 0; i < out.length; i++) if (owner[i] === r) out[i] = second[i];
  for (const r of compact) {
    const b = reg.box[r], code = cells[reg.first[r]];
    // 四舍五入（3×3 的眼睛缩一半画成 2×2，比 1 颗醒目）；只有实心小形状才重画，按钮、轮廓碎块不会因此变胖
    const ew = Math.max(1, Math.round((b.x1 - b.x0) * rx)), eh = Math.max(1, Math.round((b.y1 - b.y0) * ry));
    const cx = ((b.x0 + b.x1) / 2) * rx, cy = ((b.y0 + b.y1) / 2) * ry;
    const x0 = Math.max(0, Math.min(tw - ew, Math.round(cx - ew / 2))), y0 = Math.max(0, Math.min(th - eh, Math.round(cy - eh / 2)));
    // 按形状本身画（十字还是十字），不是整框涂满；太小画不出形状时至少中心一颗
    const sw = b.x1 - b.x0, sh = b.y1 - b.y0;
    let painted = 0;
    for (let y = y0; y < y0 + eh; y++) for (let x = x0; x < x0 + ew; x++) {
      const sx = b.x0 + Math.min(sw - 1, Math.floor(((x - x0 + 0.5) / ew) * sw));
      const sy = b.y0 + Math.min(sh - 1, Math.floor(((y - y0 + 0.5) / eh) * sh));
      if (reg.id[sy * w + sx] !== r) continue;
      out[y * tw + x] = code;
      placed[y * tw + x] = 1;
      painted++;
    }
    if (!painted) {
      const i = Math.min(th - 1, y0 + (eh >> 1)) * tw + Math.min(tw - 1, x0 + (ew >> 1));
      out[i] = code;
      placed[i] = 1;
    }
  }
  // 原来有、缩完整块不见了的形状（眼睛、星星的一角）：在它中心那格补回来，别的补回来的不覆盖
  const seen = new Map<number, { sx: number; sy: number; n: number }>();
  for (let i = 0; i < cells.length; i++) {
    const r = reg.id[i];
    if (r < 0) continue;
    const x = i % w, y = (i - x) / w;
    const s = seen.get(r) ?? { sx: 0, sy: 0, n: 0 };
    s.sx += x + 0.5; s.sy += y + 0.5; s.n++;
    seen.set(r, s);
  }
  const lost: Array<{ code: string; tx: number; ty: number; n: number; weight: number }> = [];
  for (const [r, s] of seen) {
    const first = reg.first[r];
    const code = cells[first]!;
    const cx = s.sx / s.n, cy = s.sy / s.n;
    const tx = Math.min(tw - 1, Math.floor(cx * rx)), ty = Math.min(th - 1, Math.floor(cy * ry));
    // 只补细节（比周围明显深或亮的：眼睛、高光、星星），缩完至少占四分之一颗；普通的明暗小块不补，补多了就是一脸杂点
    if (wt[first] < WEIGHT_DETAIL || s.n * rx * ry < 0.25) continue;
    let found = false;
    const rad = Math.max(1, Math.ceil(Math.sqrt(s.n) * rx));
    for (let dy = -rad; dy <= rad && !found; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (nx >= 0 && ny >= 0 && nx < tw && ny < th && out[ny * tw + nx] === code) { found = true; break; }
    }
    if (!found) lost.push({ code, tx, ty, n: s.n, weight: wt[first] });
  }
  lost.sort((a, b) => b.weight - a.weight || b.n - a.n);
  for (const l of lost) {
    const i = l.ty * tw + l.tx;
    if (placed[i]) continue;
    out[i] = l.code;
    placed[i] = 1;
  }
  // 缩出来的孤豆（上下左右都不同色）：并进周围 8 格里最多的颜色。留着的：特意重画、补回的形状，
  // 以及和周围明暗差得很多的单颗（眼睛、高光）
  const final = out.slice();
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x, c = out[i];
    if (!c || placed[i]) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => out[(y + dy) * tw + x + dx] === c && x + dx >= 0 && y + dy >= 0 && x + dx < tw && y + dy < th)) continue;
    const tally = new Map<string, number>();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= tw || ny >= th) continue;
      const n = out[ny * tw + nx];
      if (n) tally.set(n, (tally.get(n) ?? 0) + 1);
    }
    let top: string | null = null, tn = 0;
    for (const [n, k] of tally) if (k > tn) [top, tn] = [n, k];
    if (top && tn >= 4 && Math.abs(lightness(c) - lightness(top)) < ORPHAN_KEEP_CONTRAST) final[i] = top;
  }
  return final;
}

/** 按倍数等比放大缩小，返回新的格子和宽高 */
export function scaleCells(cells: Cells, w: number, h: number, scale: number): Scaled {
  const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
  if (tw === w && th === h) return { cells: cells.slice(), w, h };
  const k = Math.round(scale);
  if (scale >= 1 && Math.abs(scale - k) < 1e-6) {
    const up: Cells = new Array(tw * th);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) up[y * tw + x] = cells[Math.floor(y / k) * w + Math.floor(x / k)];
    return { cells: up, w: tw, h: th };
  }
  if (scale > 1) {
    const big = scaleCells(cells, w, h, Math.ceil(scale));
    return { cells: shrink(big.cells, big.w, big.h, tw, th), w: tw, h: th };
  }
  return { cells: shrink(cells, w, h, tw, th), w: tw, h: th };
}
