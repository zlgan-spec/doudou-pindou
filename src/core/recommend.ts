// 尺寸推荐：选能保住图里"有意义的细节"的最小尺寸。
// 做法：把主体缩到固定分辨率，按颜色聚类后找连通色块（花瓣、发丝、眼睛各是一块），
// 然后对小 / 中 / 大三种格数各做一次模拟缩格，看有多少块还能留下来；留下 85% 以上的最小尺寸就是推荐。
import { labDistance, rgbToLab, type Lab } from './color';
import { SIZES, type SizeId } from './config';
import type { Mask, RgbaImage } from './image';
import type { InputKind } from './classify';

const ANALYSIS_SIDE = 160;
const CLUSTER_RADIUS = 0.07;
const MIN_REGION_SHARE = 0.002; // 色块至少占主体这么多面积才算"有意义的细节"
const MIN_SURVIVE_CELLS = 3;    // 缩格后一个细节至少还剩几格才算保住
const MIN_AREA_RETENTION = 0.5; // 并且保留的格数不少于它按面积应占格数的一半（细条会被多数投票吞掉）
const MIN_SURVIVAL = 0.85;      // 至少保住这么大比例的细节，才推荐这个尺寸
const MIN_PHOTO_RECALL = 0.9;   // 照片没有清晰色块，色块存活率总是 1；改看"色彩分界线保留率"，小图通常只有 0.85 左右
const SIZE_ORDER: SizeId[] = ['small', 'medium', 'large'];

export function smallestSizeFor(cells: number): SizeId {
  return SIZE_ORDER.find(id => SIZES[id].maxSubject >= cells) ?? 'large';
}

export interface Recommendation {
  size: SizeId;
  /** 主体最长边需要多少格才能保住细节 */
  neededCells: number;
  /** 各尺寸能保住的细节比例（0~1），界面上可以告诉用户"小图会丢掉 x% 的细节" */
  survival: Partial<Record<SizeId, number>>;
}

export function recommendSize(image: RgbaImage, mask: Mask | null, kind: InputKind, pixelArt: { cols: number; rows: number } | null): Recommendation {
  if (kind === 'pixel' && pixelArt) {
    const cells = Math.max(pixelArt.cols, pixelArt.rows);
    return { size: smallestSizeFor(cells), neededCells: cells, survival: {} };
  }
  // 照片也走同一套细节存活模拟：虎斑纹、胡须这类细节在小图上存不下来，就推荐大一号

  // 主体外接框
  const { width, height } = image;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = y * width + x;
      if ((mask ? mask.data[i] : image.data[i * 4 + 3] / 255) < 0.5) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return { size: 'small', neededCells: 0, survival: {} };
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const scale = ANALYSIS_SIDE / Math.max(bw, bh);
  const aw = Math.max(1, Math.round(bw * scale)), ah = Math.max(1, Math.round(bh * scale));

  // 缩到分析分辨率：每个分析像素取对应区域的主体平均色
  const labs: (Lab | null)[] = new Array(aw * ah).fill(null);
  for (let ay = 0; ay < ah; ay++) {
    for (let ax = 0; ax < aw; ax++) {
      const sx0 = x0 + Math.floor((ax * bw) / aw), sx1 = Math.max(sx0 + 1, x0 + Math.floor(((ax + 1) * bw) / aw));
      const sy0 = y0 + Math.floor((ay * bh) / ah), sy1 = Math.max(sy0 + 1, y0 + Math.floor(((ay + 1) * bh) / ah));
      let r = 0, g = 0, b = 0, n = 0, total = 0;
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const i = y * width + x;
          total++;
          if ((mask ? mask.data[i] : image.data[i * 4 + 3] / 255) < 0.5) continue;
          r += image.data[i * 4];
          g += image.data[i * 4 + 1];
          b += image.data[i * 4 + 2];
          n++;
        }
      }
      if (n * 2 >= total && n) labs[ay * aw + ax] = rgbToLab(Math.round(r / n), Math.round(g / n), Math.round(b / n));
    }
  }

  // 颜色聚类
  const centers: Lab[] = [];
  const label = new Int16Array(aw * ah).fill(-1);
  for (let i = 0; i < labs.length; i++) {
    const lab = labs[i];
    if (!lab) continue;
    let best = -1, bestD = Infinity;
    for (let c = 0; c < centers.length; c++) {
      const d = labDistance(centers[c], lab);
      if (d < bestD) [best, bestD] = [c, d];
    }
    if (best >= 0 && bestD < CLUSTER_RADIUS) label[i] = best;
    else {
      centers.push(lab);
      label[i] = centers.length - 1;
    }
  }

  // 连通色块：记录每块的面积和它的像素
  const seen = new Uint8Array(aw * ah);
  const regions: number[][] = [];
  for (let s0 = 0; s0 < label.length; s0++) {
    if (seen[s0] || label[s0] < 0) continue;
    const stack = [s0];
    seen[s0] = 1;
    const px: number[] = [];
    while (stack.length) {
      const i = stack.pop()!;
      px.push(i);
      const x = i % aw, y = (i - x) / aw;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= aw || ny >= ah) continue;
        const j = ny * aw + nx;
        if (seen[j] || label[j] !== label[s0]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    regions.push(px);
  }
  let subjectArea = 0;
  for (const l of label) if (l >= 0) subjectArea++;
  // 有意义的色块：至少占主体 0.2%（JPEG 碎块、抗锯齿边都比这小）
  const meaningful = regions.filter(r => r.length >= Math.max(4, subjectArea * MIN_REGION_SHARE));
  if (!meaningful.length) return { size: 'small', neededCells: 0, survival: {} };

  // 对每个候选格数做一次"模拟缩格"：每格取多数标签，看多少有意义的色块还能占到 ≥ MIN_SURVIVE_CELLS 格
  const survival = (cells: number) => {
    const cellPx = ANALYSIS_SIDE / cells;
    const cols = Math.ceil(aw / cellPx), rows = Math.ceil(ah / cellPx);
    const tally: Map<number, number>[] = Array.from({ length: cols * rows }, () => new Map());
    for (let i = 0; i < label.length; i++) {
      if (label[i] < 0) continue;
      const x = i % aw, y = (i - x) / aw;
      const c = Math.floor(x / cellPx) + Math.floor(y / cellPx) * cols;
      tally[c].set(label[i], (tally[c].get(label[i]) ?? 0) + 1);
    }
    const majority = tally.map(t => {
      let best = -1, n = 0;
      for (const [l, k] of t) if (k > n) [best, n] = [l, k];
      return best;
    });
    let survived = 0;
    for (const r of meaningful) {
      const cellsOfRegion = new Set<number>();
      const lbl = label[r[0]];
      for (const i of r) {
        const x = i % aw, y = (i - x) / aw;
        const c = Math.floor(x / cellPx) + Math.floor(y / cellPx) * cols;
        if (majority[c] === lbl) cellsOfRegion.add(c);
      }
      const idealCells = r.length / (cellPx * cellPx);
      if (cellsOfRegion.size >= MIN_SURVIVE_CELLS && cellsOfRegion.size >= idealCells * MIN_AREA_RETENTION) survived++;
    }
    return survived / meaningful.length;
  };

  // 边界保留率：原图里相邻两色的分界线，缩格再放回来后还有多少条留着（细发丝、花瓣边缘丢了就体现在这里）
  const isBoundary = (lbl: (i: number) => number, i: number) => {
    const x = i % aw, y = (i - x) / aw;
    const l = lbl(i);
    if (l < 0) return false;
    return (x + 1 < aw && lbl(i + 1) >= 0 && lbl(i + 1) !== l) || (y + 1 < ah && lbl(i + aw) >= 0 && lbl(i + aw) !== l);
  };
  const boundaryRecall = (cells: number) => {
    const cellPx = ANALYSIS_SIDE / cells;
    const cols = Math.ceil(aw / cellPx), rows = Math.ceil(ah / cellPx);
    const tally: Map<number, number>[] = Array.from({ length: cols * rows }, () => new Map());
    for (let i = 0; i < label.length; i++) {
      if (label[i] < 0) continue;
      const x = i % aw, y = (i - x) / aw;
      const c = Math.floor(x / cellPx) + Math.floor(y / cellPx) * cols;
      tally[c].set(label[i], (tally[c].get(label[i]) ?? 0) + 1);
    }
    const majority = tally.map(t => {
      let best = -1, n = 0;
      for (const [l, k] of t) if (k > n) [best, n] = [l, k];
      return best;
    });
    const up = (i: number) => {
      const x = i % aw, y = (i - x) / aw;
      return label[i] < 0 ? -1 : majority[Math.floor(x / cellPx) + Math.floor(y / cellPx) * cols];
    };
    const after = new Uint8Array(aw * ah);
    for (let i = 0; i < label.length; i++) if (isBoundary(up, i)) after[i] = 1;
    let total = 0, kept = 0;
    for (let i = 0; i < label.length; i++) {
      if (!isBoundary(j => label[j], i)) continue;
      total++;
      const x = i % aw, y = (i - x) / aw;
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < aw && ny < ah && after[ny * aw + nx]) hit = true;
      }
      if (hit) kept++;
    }
    return total ? kept / total : 1;
  };

  const rates: Partial<Record<SizeId, number>> = {};
  const recall: Partial<Record<SizeId, number>> = {};
  let pick: SizeId = 'large';
  for (const id of SIZE_ORDER) {
    rates[id] = survival(SIZES[id].maxSubject);
    recall[id] = boundaryRecall(SIZES[id].maxSubject);
  }
  for (const id of SIZE_ORDER) {
    if ((rates[id] ?? 0) >= MIN_SURVIVAL && (kind !== 'photo' || (recall[id] ?? 0) >= MIN_PHOTO_RECALL)) {
      pick = id;
      break;
    }
  }
  return { size: pick, neededCells: SIZES[pick].maxSubject, survival: rates, recall, regions: meaningful.length } as Recommendation & { regions: number; recall: typeof recall };
}
