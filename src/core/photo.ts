// 照片 / 绘画路径（保留背景或抠图后的主体）。按 2026-10-04 根因分析重写：
//   1. 预滤波：在"子像素"网格上做保边中值，抹掉小于一格的纹理
//   2. 背景分层：从贴边区域生长出背景层，背景单独平涂、不占主体颜色名额
//   3. 主体色调映射：只按主体统计，提亮中间调、修正黄褐偏色、提升色度
//   4. 色族划分：按色相把主体分成几族（暖棕 / 蓝 / 中性…）
//   5. 选色：每族沿亮度一维分级，每级从 MARD 同系列的"梯子"里取色号 → 颜色天然成梯度
//   6. 映射：每格只在本族梯子里找最近色；写实风在相邻色阶间做有序抖动
//   7. 清理：只清"外来色"小块，同梯子相邻色阶的交织单颗保留；点缀色（嘴唇、高光）豁免
//   8. 放板：保留背景时占满整块板，空出来的格子用背景色补
import { chroma, labDistance, rgbToLab, type Lab } from './color';
import { SIZES, STYLES, boardArea, fitSide, type SizeId, type StyleId } from './config';
import { mergeRareColors, protectDetails } from './cleanup';
import { regularizeEdges, tidyEdges } from './contour';
import { MIN_BEADS_PER_COLOR } from './config';
import { connectedRegions, createGrid, type Grid } from './grid';
import type { Mask, RgbaImage } from './image';
import { PALETTE, colorOf, type BeadColor } from './palette';

export interface PhotoInput {
  image: RgbaImage;
  mask: Mask | null;
}

export interface PhotoOptions {
  size: SizeId;
  style: StyleId;
  /** 颜色上限；不给就按豆板和风格的默认值 */
  maxColors?: number;
  /** 自定义尺寸：图案按比例放进 w×h 颗以内，放到能装下它的豆板上（不铺满背景） */
  fit?: { w: number; h: number };
}

const SUB_MAX = 3; // 每格最多 3×3 子像素：够做保边滤波和边界判断，又不至于太慢

// ---------- 工具 ----------

const hueOf = (l: Lab) => ((Math.atan2(l[2], l[1]) * 180) / Math.PI + 360) % 360;
const hueDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

// ---------- 1. 子像素网格 + 保边中值 ----------

interface SubGrid {
  s: number;        // 每格 s×s 个子像素
  w: number;        // 子像素列数 = 格数 × s
  h: number;
  lab: Lab[];
  inside: Uint8Array; // 1 = 主体（有 mask 时）/ 全部为 1（保留背景时）
}

function buildSubGrid(input: PhotoInput, cols: number, rows: number, box: { x0: number; y0: number; x1: number; y1: number }, s: number): SubGrid {
  const { image, mask } = input;
  const w = cols * s, h = rows * s;
  const lab: Lab[] = new Array(w * h);
  const inside = new Uint8Array(w * h);
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  for (let sy = 0; sy < h; sy++) {
    const y0 = Math.floor(box.y0 + (sy * bh) / h), y1 = Math.max(y0 + 1, Math.floor(box.y0 + ((sy + 1) * bh) / h));
    for (let sx = 0; sx < w; sx++) {
      const x0 = Math.floor(box.x0 + (sx * bw) / w), x1 = Math.max(x0 + 1, Math.floor(box.x0 + ((sx + 1) * bw) / w));
      let r = 0, g = 0, b = 0, n = 0, total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * image.width + x;
          total++;
          if (mask && mask.data[i] < 0.5) continue;
          if (image.data[i * 4 + 3] < 128) continue;
          r += image.data[i * 4];
          g += image.data[i * 4 + 1];
          b += image.data[i * 4 + 2];
          n++;
        }
      }
      const k = sy * w + sx;
      inside[k] = n > 0 && n * 2 >= total ? 1 : 0;
      lab[k] = n ? rgbToLab(Math.round(r / n), Math.round(g / n), Math.round(b / n)) : [0.5, 0, 0];
    }
  }
  return { s, w, h, lab, inside };
}

/** 保边中值：3×3 窗口内只对和中心颜色差在 sigma 内的像素取中位数，纹理被抹平、真实边界不动 */
function edgePreservingMedian(grid: SubGrid, sigma: number, passes: number): Lab[] {
  let cur = grid.lab;
  for (let p = 0; p < passes; p++) {
    const out = cur.slice();
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const i = y * grid.w + x;
        if (!grid.inside[i]) continue;
        const c = cur[i];
        const ls: number[] = [], as: number[] = [], bs: number[] = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
            const j = ny * grid.w + nx;
            if (!grid.inside[j]) continue;
            if (labDistance(cur[j], c) > sigma) continue;
            ls.push(cur[j][0]);
            as.push(cur[j][1]);
            bs.push(cur[j][2]);
          }
        }
        out[i] = [median(ls), median(as), median(bs)];
      }
    }
    cur = out;
  }
  return cur;
}

// ---------- 2. 背景分层 ----------

interface Layers {
  bg: Uint8Array;        // 子像素级：1 = 背景
  bgBand: Int8Array;     // 背景子像素属于第几条明暗带（背景有渐变 / 暗角时分 2 到 3 带）
  bgColors: Lab[];       // 每条带的中位色；空 = 没有可分离的背景
}

const BG_MIN_BORDER_SHARE = 0.25;
const BG_MIN_AREA_SHARE = 0.12;
const BG_ONE_BAND_SPREAD = 0.12;  // 背景亮度 10%~90% 分位差小于这个值：一种颜色平涂
const BG_MAX_SPREAD = 0.3;        // 超过这个值说明不是"背景"而是另一块主体
const BG_MIN_BAND_SHARE = 0.1;
const BG_HUE_GATE_CHROMA = 0.05;  // 种子色度到这个值才算"有色相"的背景（草地、彩色墙），灰白背景不卡色相
const BG_MAX_HUE_DIFF = 35;       // 生长时和种子色相最多差这么多度
const BG_NEUTRAL_AB_MIN = 0.009;  // 灰白种子：生长时 a/b 平面上离种子最多差这么多（下限 / 上限）
const BG_NEUTRAL_AB_MAX = 0.02;
const BG_NEUTRAL_MIN_L = 0.3;     // 种子比这暗就不卡 a/b

function splitBackground(grid: SubGrid, lab: Lab[]): Layers {
  const { w, h, inside } = grid;
  const none: Layers = { bg: new Uint8Array(w * h), bgBand: new Int8Array(w * h).fill(-1), bgColors: [] };
  // 边缘像素聚类，取最大的一簇当种子色
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const borderIn = border.filter(i => inside[i]);
  if (borderIn.length < 8) return none;
  const clusters: { lab: Lab; n: number }[] = [];
  for (const i of borderIn) {
    const hit = clusters.find(c => labDistance(c.lab, lab[i]) < 0.06);
    if (hit) hit.n++;
    else clusters.push({ lab: lab[i], n: 1 });
  }
  const seed = clusters.sort((a, b) => b.n - a.n)[0];
  if (seed.n < borderIn.length * BG_MIN_BORDER_SHARE) return none;

  // 种子内部的离散度决定容差：背景越平，容差越紧
  const seedLs = borderIn.filter(i => labDistance(lab[i], seed.lab) < 0.06).map(i => lab[i][0]);
  const mean = seedLs.reduce((a, b) => a + b, 0) / seedLs.length;
  const sd = Math.sqrt(seedLs.reduce((a, b) => a + (b - mean) ** 2, 0) / seedLs.length);
  const tol = Math.max(0.035, Math.min(0.09, sd * 2.5 + 0.02));

  // 从边缘生长：每一步和来源像素差 < tol，和种子色差 < 3·tol（允许暗角渐变）。
  // 3·tol 是给明暗留的余量，不该拿来跨色相：草地这种纹理重的背景 tol 到顶 0.09，
  // 低色度的米色狗毛离绿草种子才 ~0.17，会顺着毛边的过渡像素一路长进去，整只狗被当成背景平涂。
  // 所以种子有明确色相时，再要求色相相近；只有比种子暗、色度又掉得很低的（暗角）才放过
  const seedC = chroma(seed.lab), seedH = hueOf(seed.lab);
  // 灰白背景没有色相可卡，但同样会被吞：浅灰墙前抱着的米色猫，亮度几乎一样、只是略暖（色度 0.01~0.06），
  // 毛边过渡又平缓，3·tol 的余量足够从耳朵、贴底边的白胸口一路长进整只猫。
  // 背景的明暗可以大幅变化（暗角、打光），色彩偏移却很小，所以对灰白种子单独卡 a/b 平面上离种子的距离：
  // 容差按真实种子像素的 a/b 中位离散度定，下限 0.009（灰墙自身的色偏一般在这以内），上限 0.02
  const seedPix = borderIn.filter(i => labDistance(lab[i], seed.lab) < tol);
  const seedA = median(seedPix.map(i => lab[i][1])), seedB = median(seedPix.map(i => lab[i][2]));
  const abSpread = median(seedPix.map(i => Math.hypot(lab[i][1] - seedA, lab[i][2] - seedB)));
  const abTol = Math.max(BG_NEUTRAL_AB_MIN, Math.min(BG_NEUTRAL_AB_MAX, abSpread * 3 + 0.004));
  // 很暗的背景（黑底油画、夜景）不卡：暗处的 a/b 又小又噪，卡了反而把衣服暗部、阴影从黑底里拆出来变成一片深灰
  const sameHue = (l: Lab) =>
    seedC < BG_HUE_GATE_CHROMA
      ? seed.lab[0] < BG_NEUTRAL_MIN_L || Math.hypot(l[1] - seedA, l[2] - seedB) < abTol
      : hueDiff(hueOf(l), seedH) < BG_MAX_HUE_DIFF || (l[0] < seed.lab[0] && chroma(l) < seedC * 0.4);
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const i of borderIn) {
    if (labDistance(lab[i], seed.lab) < tol && sameHue(lab[i])) {
      bg[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i - x) / w;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (bg[j] || !inside[j]) continue;
      if (labDistance(lab[j], lab[i]) < tol && labDistance(lab[j], seed.lab) < tol * 3 && sameHue(lab[j])) {
        bg[j] = 1;
        stack.push(j);
      }
    }
  }
  let area = 0;
  const bgLs: number[] = [];
  for (let i = 0; i < bg.length; i++) if (bg[i]) {
    area++;
    bgLs.push(lab[i][0]);
  }
  let insideCount = 0;
  for (const v of inside) insideCount += v;
  if (area < insideCount * BG_MIN_AREA_SHARE) return none;
  bgLs.sort((a, b) => a - b);
  const spread = quantile(bgLs, 0.9) - quantile(bgLs, 0.1);
  if (spread > BG_MAX_SPREAD) return none; // 亮度跨度太大，不是背景
  const bgIdx: number[] = [];
  for (let i = 0; i < bg.length; i++) if (bg[i]) bgIdx.push(i);
  // 分带：平的背景一带；有暗角 / 渐变的按亮度分 2 到 3 带，每带至少占 10%
  let bands = 1;
  if (spread > BG_ONE_BAND_SPREAD) bands = spread > BG_ONE_BAND_SPREAD * 2 ? 3 : 2;
  const bgBand = new Int8Array(w * h).fill(-1);
  let centers = bands === 1 ? [median(bgIdx.map(i => lab[i][0]))] : jenks1D(bgIdx.map(i => lab[i][0]), bgIdx.map(() => 1), bands);
  for (;;) {
    const counts = new Array(centers.length).fill(0);
    for (const i of bgIdx) {
      let k = 0;
      centers.forEach((c, j) => { if (Math.abs(lab[i][0] - c) < Math.abs(lab[i][0] - centers[k])) k = j; });
      bgBand[i] = k;
      counts[k]++;
    }
    const small = counts.findIndex(n => n < bgIdx.length * BG_MIN_BAND_SHARE);
    if (small < 0 || centers.length === 1) break;
    centers = centers.filter((_, j) => j !== small); // 太小的带并掉，重新分配
  }
  const bgColors: Lab[] = centers.map((_, k) => {
    const members = bgIdx.filter(i => bgBand[i] === k);
    return [median(members.map(i => lab[i][0])), median(members.map(i => lab[i][1])), median(members.map(i => lab[i][2]))];
  });
  return { bg, bgBand, bgColors };
}

// ---------- 3. 主体色调映射 ----------

interface ToneMap {
  apply: (l: Lab) => Lab;
}

const TARGET_MEDIAN_L = 0.66; // 主体中位亮度至少抬到这里（只抬不压：暗画面的脸要亮起来，亮画面保持原样）
const L_MIN = 0.18;  // 对照理想豆纸：最深色阶接近纯黑（p2≈0.19），轮廓和眼睛靠它立起来
const L_MAX = 0.97;
const CHROMA_GAIN = 1.25;
const WARM_FROM = 20, WARM_TO = 110, WARM_TARGET = 52, WARM_MAX_SHIFT = 15;

function buildToneMap(labs: Lab[], style: StyleId): ToneMap {
  const Ls = labs.map(l => l[0]).sort((a, b) => a - b);
  if (Ls.length < 20) return { apply: l => l };
  const p2 = quantile(Ls, 0.02), p98 = quantile(Ls, 0.98), med = quantile(Ls, 0.5);
  const span = Math.max(0.05, p98 - p2);
  // 理想豆纸作者的做法：把 2%~98% 分位拉满到近黑~近白（对比度拉开，轮廓和高光立起来），
  // 中间调只抬不压——原图偏暗（油画、逆光）时用 γ 把中位数抬到目标亮度，本来就亮的图保持原样
  const lo = L_MIN, hi = L_MAX;
  const t = Math.min(0.98, Math.max(0.02, (med - p2) / span));
  const want = Math.min(0.98, Math.max(0.02, (TARGET_MEDIAN_L - lo) / (hi - lo)));
  const gamma = t < want ? Math.max(0.45, Math.log(want) / Math.log(t)) : 1;
  // 暖色偏黄时往橙棕回正（清漆、室内光）
  const warm = labs.filter(l => chroma(l) > 0.035 && hueOf(l) > WARM_FROM && hueOf(l) < WARM_TO);
  const warmMeanHue = warm.length ? warm.reduce((a, l) => a + hueOf(l), 0) / warm.length : WARM_TARGET;
  const shift = warm.length > labs.length * 0.1 && warmMeanHue > WARM_TARGET + 5 ? Math.min(WARM_MAX_SHIFT, warmMeanHue - WARM_TARGET) : 0;
  const gain = style === 'realistic' ? CHROMA_GAIN * 0.9 : CHROMA_GAIN;
  return {
    apply: l => {
      const n = Math.min(1, Math.max(0, (l[0] - p2) / span));
      const L = lo + (hi - lo) * Math.pow(n, gamma);
      let a = l[1] * gain, b = l[2] * gain;
      const c = Math.hypot(a, b);
      if (shift && c > 0.03) {
        const hh = hueOf([L, a, b]);
        if (hh > WARM_FROM && hh < WARM_TO) {
          const rad = ((hh - shift) * Math.PI) / 180;
          a = Math.cos(rad) * c;
          b = Math.sin(rad) * c;
        }
      }
      return [L, a, b];
    },
  };
}

// ---------- 4. 色族 ----------

interface Family {
  hue: number | null; // null = 中性族
  members: number[];  // 子像素下标
  colors: BeadColor[]; // 选出的梯子
}

const NEUTRAL_CHROMA = 0.03;
const FAMILY_MIN_SEP = 35;   // 两个色相峰至少隔这么多度
const FAMILY_MIN_SHARE = 0.03;
const FAMILY_MAX_HUE_DIFF = 60; // 像素和所属族色相差超过这个角度，配出来就是另一种颜色了

/** 色度加权的环形直方图，12° 一箱，平滑后找峰；和 existing 里已有的峰至少隔 FAMILY_MIN_SEP */
function huePeaks(labs: Lab[], members: number[], existing: number[]): number[] {
  const bins = new Float64Array(30);
  for (const i of members) bins[Math.floor(hueOf(labs[i]) / 12) % 30] += chroma(labs[i]);
  const sm = bins.map((_, k) => bins[(k + 29) % 30] * 0.5 + bins[k] + bins[(k + 1) % 30] * 0.5);
  const total = sm.reduce((a, b) => a + b, 0);
  const peaks: number[] = [];
  for (let k = 0; k < 30; k++) {
    if (sm[k] >= sm[(k + 29) % 30] && sm[k] > sm[(k + 1) % 30] && sm[k] > total * FAMILY_MIN_SHARE) peaks.push(k * 12 + 6);
  }
  const kept: number[] = [];
  for (const p of peaks.sort((a, b) => sm[Math.floor(a / 12)] - sm[Math.floor(b / 12)]).reverse()) {
    if ([...existing, ...kept].every(q => hueDiff(p, q) >= FAMILY_MIN_SEP)) kept.push(p);
  }
  return kept;
}

function splitFamilies(labs: Lab[], idx: number[]): Family[] {
  const neutral: number[] = [];
  const colored: number[] = [];
  for (const i of idx) (chroma(labs[i]) < NEUTRAL_CHROMA ? neutral : colored).push(i);
  const fams: Family[] = [];
  if (colored.length) {
    const kept = huePeaks(labs, colored, []);
    if (!kept.length) kept.push(hueOf(labs[colored[0]]));
    const nearestPeak = (i: number) => {
      let best = 0, bd = Infinity;
      kept.forEach((hue, k) => {
        const d = hueDiff(hue, hueOf(labs[i]));
        if (d < bd) [best, bd] = [k, d];
      });
      return { k: best, d: bd };
    };
    // 离所有峰都很远的像素（暖色人像里的青绿沙发、冷色阴影）：峰被大面积暖色压住没冒头，
    // 硬塞进最近的暖族就会按亮度配成锈棕。先在这些"离群"像素里单独再找一轮峰
    const far = colored.filter(i => nearestPeak(i).d > FAMILY_MAX_HUE_DIFF);
    if (far.length >= idx.length * FAMILY_MIN_SHARE) kept.push(...huePeaks(labs, far, kept));
    const groups = kept.map(hue => ({ hue, members: [] as number[], colors: [] as BeadColor[] }));
    for (const i of colored) {
      const { k, d } = nearestPeak(i);
      // 还是离得远：色度低的归中性族（配灰，不配错色相的彩色豆）；鲜艳的少数像素仍跟最近的族
      if (d > FAMILY_MAX_HUE_DIFF && chroma(labs[i]) < LOW_CHROMA_FAMILY) neutral.push(i);
      else groups[k].members.push(i);
    }
    for (const g of groups) if (g.members.length) fams.push(g);
  }
  if (neutral.length) fams.push({ hue: null, members: neutral, colors: [] });
  return fams;
}

// ---------- 5. 色阶梯子 + 选色 ----------

const PALETTE_NEUTRAL = PALETTE.filter(c => chroma(c.lab) < 0.03);
const PALETTE_COLORED = PALETTE.filter(c => chroma(c.lab) >= 0.03);

/**
 * 本族可用的色号：色相在 ±hueWindow 内；中性族用中性色。
 * 色度很低的彩色族（灰猫的毛、带一点蓝的灰墙）同时允许中性灰，否则会被配成蓝灰、紫灰的彩色豆。
 */
const LOW_CHROMA_FAMILY = 0.06;

function ladderFor(fam: Family, meanChroma: number, hueWindow = 28): BeadColor[] {
  if (fam.hue === null) return PALETTE_NEUTRAL;
  let near = PALETTE_COLORED.filter(c => hueDiff(hueOf(c.lab), fam.hue!) <= hueWindow);
  if (near.length < 4) near = PALETTE_COLORED.filter(c => hueDiff(hueOf(c.lab), fam.hue!) <= hueWindow * 2);
  return meanChroma < LOW_CHROMA_FAMILY ? [...near, ...PALETTE_NEUTRAL] : near;
}

/** 一维 Jenks（亮度）：返回 k 个级别的中心 */
function jenks1D(values: number[], weights: number[], k: number): number[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const v = order.map(i => values[i]), w = order.map(i => weights[i]);
  const n = v.length;
  if (k >= n) return [...new Set(v)];
  // 初始化：按加权分位数切
  const totalW = w.reduce((a, b) => a + b, 0);
  const cuts: number[] = [];
  let acc = 0, next = 1;
  for (let i = 0; i < n && next < k; i++) {
    acc += w[i];
    if (acc >= (totalW * next) / k) {
      cuts.push(i + 1);
      next++;
    }
  }
  // 迭代：每段取加权均值为中心，再按最近中心重分段（一维 k-means）
  let centers = segmentsMeans(v, w, cuts);
  for (let it = 0; it < 20; it++) {
    const newCuts: number[] = [];
    let c = 0;
    for (let i = 0; i < n; i++) {
      while (c + 1 < centers.length && Math.abs(v[i] - centers[c + 1]) < Math.abs(v[i] - centers[c])) {
        c++;
        newCuts.push(i);
      }
    }
    const nc = segmentsMeans(v, w, newCuts);
    if (nc.length === centers.length && nc.every((x, i) => Math.abs(x - centers[i]) < 1e-4)) break;
    centers = nc;
  }
  return centers;
}

function segmentsMeans(v: number[], w: number[], cuts: number[]): number[] {
  const bounds = [0, ...cuts, v.length];
  const out: number[] = [];
  for (let s = 0; s + 1 < bounds.length; s++) {
    let sw = 0, sv = 0;
    for (let i = bounds[s]; i < bounds[s + 1]; i++) {
      sw += w[i];
      sv += v[i] * w[i];
    }
    if (sw > 0) out.push(sv / sw);
  }
  return out;
}

// 明暗分级只要有代表性的样本：成员太多（超过 104 的大图）时等间隔取 10 万个；104 以内本来就不到这个数，结果不变
const STAT_SAMPLE = 100_000;
const sampled = (idx: number[]) => (idx.length <= STAT_SAMPLE ? idx : idx.filter((_, i) => i % Math.ceil(idx.length / STAT_SAMPLE) === 0));

/** 给每族分名额：∝ √面积 × 亮度跨度，每族至少 minLevels，总数不超过 budget */
function allocateLevels(fams: Family[], labs: Lab[], budget: number, minLevels: number): number[] {
  const scores = fams.map(f => {
    const Ls = sampled(f.members).map(i => labs[i][0]).sort((a, b) => a - b);
    const spread = Ls.length ? quantile(Ls, 0.95) - quantile(Ls, 0.05) : 0;
    return Math.sqrt(f.members.length) * (0.15 + spread);
  });
  const total = scores.reduce((a, b) => a + b, 0) || 1;
  let levels = scores.map(s => Math.max(minLevels, Math.round((budget * s) / total)));
  // 小族（像素很少）只给 1 到 2 级
  const totalMembers = fams.reduce((a, f) => a + f.members.length, 0);
  levels = levels.map((n, k) => (fams[k].members.length < totalMembers * 0.02 ? Math.min(n, 2) : n));
  // 超预算时从最大的族开始减
  let sum = levels.reduce((a, b) => a + b, 0);
  while (sum > budget) {
    let k = 0;
    levels.forEach((n, i) => {
      if (n - minLevels > levels[k] - minLevels) k = i;
    });
    if (levels[k] <= minLevels) break;
    levels[k]--;
    sum--;
  }
  return levels;
}

/**
 * 这一族需要几级明暗：从 1 级往上加，平均亮度误差小于约 0.012（比肉眼刚能分辨的差还小一点，宁可多一级），
 * 或者再加一级误差几乎不再变小（< 0.0025）时就停，最多 maxK 级
 */
const LEVEL_JND = 0.012;
const LEVEL_GAIN = 0.0025;
const LEVEL_MIN_STEP = 0.06;
function neededLevels(fam: Family, labs: Lab[], maxK: number): number {
  const Ls = sampled(fam.members).map(i => labs[i][0]);
  if (!Ls.length || maxK <= 1) return Math.max(1, maxK);
  const weights = Ls.map(() => 1);
  let prev = Infinity;
  for (let k = 1; k <= maxK; k++) {
    const centers = jenks1D(Ls, weights, k).slice().sort((a, b) => a - b);
    // 新加的一级和相邻一级太近（亮度差 < 0.06），拼出来是交错的碎点而不是一级色阶，不加
    if (k > 1 && centers.some((c, i) => i > 0 && c - centers[i - 1] < LEVEL_MIN_STEP)) return k - 1;
    let err = 0;
    for (const L of Ls) {
      let d = Infinity;
      for (const c of centers) d = Math.min(d, Math.abs(L - c));
      err += d;
    }
    err /= Ls.length;
    if (err < LEVEL_JND) return k;
    if (prev - err < LEVEL_GAIN) return k - 1;
    prev = err;
  }
  return maxK;
}

function chooseLadder(fam: Family, labs: Lab[], levels: number): BeadColor[] {
  // 族的平均色度，用来在同亮度的候选里挑色度相近的
  const meanC = fam.members.reduce((a, i) => a + chroma(labs[i]), 0) / fam.members.length;
  const pool = ladderFor(fam, meanC);
  const Ls = sampled(fam.members).map(i => labs[i][0]);
  const weights = Ls.map(() => 1);
  const centers = jenks1D(Ls, weights, Math.min(levels, Math.max(1, Math.round(fam.members.length / 4))));
  const chosen: BeadColor[] = [];
  for (const L of centers) {
    let best: BeadColor | null = null, bd = Infinity;
    for (const c of pool) {
      if (chosen.includes(c)) continue;
      // 色度差权重放大：低色度族不要选鲜艳豆，高色度族不要选灰豆
      const hueTerm = fam.hue !== null && chroma(c.lab) >= 0.03 ? hueDiff(hueOf(c.lab), fam.hue) / 400 : 0;
      const d = Math.abs(c.lab[0] - L) * 2 + Math.abs(chroma(c.lab) - meanC) * 1.6 + hueTerm;
      if (d < bd) [best, bd] = [c, d];
    }
    if (best) chosen.push(best);
  }
  return chosen.sort((a, b) => a.lab[0] - b.lab[0]);
}

// ---------- 6. 格级映射 ----------

const matchDist = (p: Lab, q: Lab) => Math.hypot((p[0] - q[0]) * 1.5, p[1] - q[1], p[2] - q[2]);

function nearestIn(lab: Lab, colors: BeadColor[]): BeadColor {
  let best = colors[0], bd = Infinity;
  for (const c of colors) {
    const d = matchDist(lab, c.lab);
    if (d < bd) [best, bd] = [c, d];
  }
  return best;
}

/** 2×2 Bayer：格子亮度落在两个相邻色阶中间 40% 时，按位置交替取上下两级 */
const BAYER = [[0, 2], [3, 1]];
function dithered(lab: Lab, ladder: BeadColor[], x: number, y: number, strength: number): BeadColor {
  if (ladder.length < 2) return ladder[0];
  const sorted = ladder; // 已按亮度排序
  let lo = sorted[0], hi = sorted[sorted.length - 1];
  for (let i = 0; i + 1 < sorted.length; i++) {
    if (lab[0] >= sorted[i].lab[0] && lab[0] <= sorted[i + 1].lab[0]) {
      lo = sorted[i];
      hi = sorted[i + 1];
      break;
    }
  }
  if (lo === hi) return nearestIn(lab, ladder);
  const t = (lab[0] - lo.lab[0]) / Math.max(1e-6, hi.lab[0] - lo.lab[0]);
  if (t < 0.5 - strength / 2 || t > 0.5 + strength / 2) return t < 0.5 ? lo : hi;
  const th = (BAYER[y & 1][x & 1] + 0.5) / 4;
  return t > th ? hi : lo;
}

/**
 * 灰豆在梯子里只按亮度和色度挑、不看色相，同亮度的灰往往带着和格子相反的色调：金毛浅色胸毛（略偏黄）
 * 落在 L≈0.77，那一档最近的是紫灰 H3（MARD 在这个亮度没有浅暖灰），拼出来胸口一片发紫。
 * 格子本身有色调、选中的豆色调又反过来（色相差 > 90°）时，换一颗色调同向（±60°）或几乎纯灰的豆：
 * - 只在主体已经用到的色号里换（allColors），不新增颜色
 * - 不换成比格子更鲜艳的豆、也只在差不多一样近时才换——虎斑猫的灰毛不会因此变橙棕
 *   （之前直接给灰豆加色相惩罚、改梯子，就是把灰毛挤成了橙棕、色数也涨了）
 */
const TINT_MIN_CHROMA = 0.015;  // 格子色度到这个值才算有色调
const TINT_BEAD_CHROMA = 0.008; // 豆子色度到这个值才算"带色"（H9、H10 这种几乎纯灰的不算反色）
const TINT_MARGIN = 0.03;       // 换豆最多多付的距离（约亮度差 0.02）
function avoidOppositeTint(lab: Lab, pick: BeadColor, allColors: BeadColor[]): BeadColor {
  const c = chroma(lab);
  if (c < TINT_MIN_CHROMA) return pick;
  const h = hueOf(lab);
  const tinted = (b: BeadColor) => chroma(b.lab) >= TINT_BEAD_CHROMA;
  if (!tinted(pick) || hueDiff(hueOf(pick.lab), h) <= 90) return pick;
  const ok = allColors.filter(b => (!tinted(b) || hueDiff(hueOf(b.lab), h) <= 60) && chroma(b.lab) <= Math.max(0.03, c * 1.2));
  if (!ok.length) return pick;
  const alt = nearestIn(lab, ok);
  return matchDist(lab, alt.lab) - matchDist(lab, pick.lab) < TINT_MARGIN ? alt : pick;
}

// ---------- 总流程 ----------

const DARK_DETAIL_STEP = 0.15; // 清理时，小块比要并入的颜色暗这么多（亮度）就当五官留着

export function generateFromPhoto(input: PhotoInput, options: PhotoOptions): Grid {
  const size = SIZES[options.size];
  const style = STYLES[options.style];
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

  // 1. 子像素 + 保边中值（小图格子大、纹理多，多滤一遍）
  // 超过 104 的大图：原图一颗豆只分到几个像素，子像素再多也是插出来的，按原图能给的来，省时间
  const s = longSide > SIZES.large.board ? Math.max(1, Math.min(2, Math.floor(Math.max(bw, bh) / longSide))) : SUB_MAX;
  const sub = buildSubGrid(input, cols, rows, box, s);
  const SUB = s;
  const sigma = 0.05;
  const filtered = edgePreservingMedian(sub, sigma, options.size === 'small' ? 2 : 1);

  // 2. 背景分层（抠图时 mask 外就是背景，这里不再找）
  const layers = keepBackground ? splitBackground(sub, filtered) : { bg: new Uint8Array(sub.w * sub.h), bgBand: new Int8Array(sub.w * sub.h).fill(-1), bgColors: [] as Lab[] };
  const subjectIdx: number[] = [];
  for (let i = 0; i < filtered.length; i++) if (sub.inside[i] && !layers.bg[i]) subjectIdx.push(i);
  if (subjectIdx.length === 0) return createGrid(size.board, size.board);

  // 3. 色调映射（只看主体）
  const tone = buildToneMap(subjectIdx.map(i => filtered[i]), options.style);
  const toned = filtered.slice();
  for (const i of subjectIdx) toned[i] = tone.apply(filtered[i]);

  // 4. 色族
  const fams = splitFamilies(toned, subjectIdx);

  // 5. 选色：背景色不占主体名额
  const budget = (options.maxColors ?? (style.id === 'realistic' ? size.realisticMaxColors : size.autoMaxColors)) - layers.bgColors.length;
  const minLevels = options.size === 'small' ? 2 : 3;
  let levels = allocateLevels(fams, toned, budget, minLevels);
  // 贴纸风没指定色数时：先按原来的建议色数分好（保底），图里明暗层次多的族再往上加，最多到自动上限；
  // 写实风本来就要层次，照旧用满上限
  if (options.maxColors === undefined && style.id !== 'realistic') {
    const base = allocateLevels(fams, toned, size.maxColors - layers.bgColors.length, minLevels);
    levels = levels.map((n, k) => Math.max(base[k], neededLevels(fams[k], toned, n)));
  }
  fams.forEach((f, k) => (f.colors = chooseLadder(f, toned, levels[k])));
  // 背景每条带一个色号：很暗的直接用纯黑 H7；其余在全色板里找最近，并保证各带不重色。
  // 有色相的背景先在色相 ±15° 内找：背景是大片平涂，草地配成色相偏 20° 的 B11 整片就成了橄榄绿
  const bgBeads: BeadColor[] = [];
  for (const c of layers.bgColors) {
    const free = PALETTE.filter(p => !bgBeads.includes(p));
    const sameHue = chroma(c) >= BG_HUE_GATE_CHROMA ? free.filter(p => chroma(p.lab) >= 0.03 && hueDiff(hueOf(p.lab), hueOf(c)) <= 15) : [];
    const pick = c[0] < 0.15 ? PALETTE.find(p => p.code === 'H7')! : nearestIn(c, sameHue.length ? sameHue : free);
    bgBeads.push(pick);
  }
  const mainBgBead = bgBeads.length ? bgBeads[layers.bgColors.map((_, k) => layers.bgBand.filter(b => b === k).length).reduce((best, n, k, arr) => (n > arr[best] ? k : best), 0)] : null;

  // 6. 格级映射：每格取子像素均值 → 所属族（按多数子像素）→ 本族梯子
  const famOf = new Int16Array(sub.w * sub.h).fill(-1);
  fams.forEach((f, k) => f.members.forEach(i => (famOf[i] = k)));
  const codes: (string | null)[] = new Array(cols * rows).fill(null);
  const cellFam = new Int16Array(cols * rows).fill(-1);
  const dither = style.id === 'realistic' ? (options.size === 'large' ? 0.2 : 0.4) : 0;
  const neutralFam = fams.findIndex(f => f.hue === null && f.colors.length > 0);
  const allLadder = [...new Set(fams.flatMap(f => f.colors))]; // 主体已用到的全部色号：换豆只在这里面换，不新增颜色
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const tally = new Map<number, number>();
      let bgN = 0, inN = 0;
      const acc: Lab = [0, 0, 0];
      let accN = 0;
      for (let dy = 0; dy < SUB; dy++) for (let dx = 0; dx < SUB; dx++) {
        const i = (gy * SUB + dy) * sub.w + gx * SUB + dx;
        if (!sub.inside[i]) continue;
        inN++;
        if (layers.bg[i]) {
          bgN++;
          continue;
        }
        tally.set(famOf[i], (tally.get(famOf[i]) ?? 0) + 1);
      }
      const g = gy * cols + gx;
      if (inN === 0) continue;                       // 抠图外
      if (bgN * 2 >= inN && bgBeads.length) {         // 背景格：取格内最多的那条带
        const bandTally = new Array(bgBeads.length).fill(0);
        for (let dy = 0; dy < SUB; dy++) for (let dx = 0; dx < SUB; dx++) {
          const i = (gy * SUB + dy) * sub.w + gx * SUB + dx;
          if (layers.bg[i] && layers.bgBand[i] >= 0) bandTally[layers.bgBand[i]]++;
        }
        codes[g] = bgBeads[bandTally.indexOf(Math.max(...bandTally))].code;
        continue;
      }
      let fk = -1, fn = 0;
      for (const [k, n] of tally) if (n > fn) [fk, fn] = [k, n];
      if (fk < 0 || !fams[fk].colors.length) continue;
      for (let dy = 0; dy < SUB; dy++) for (let dx = 0; dx < SUB; dx++) {
        const i = (gy * SUB + dy) * sub.w + gx * SUB + dx;
        if (!sub.inside[i] || layers.bg[i] || famOf[i] !== fk) continue;
        acc[0] += toned[i][0];
        acc[1] += toned[i][1];
        acc[2] += toned[i][2];
        accN++;
      }
      const mean: Lab = [acc[0] / accN, acc[1] / accN, acc[2] / accN];
      // 彩色族的梯子按整族的平均色度选：暖色人像里低色度的深色阴影（毛衣暗部、发根）
      // 在暖梯子里最近的往往是艳得多的锈棕 F10。格子色度不到那颗豆一半、中性梯子又更近时改用中性色；
      // 本身就有色度的暗部（背光的脸）不受影响
      if (fams[fk].hue !== null && neutralFam >= 0) {
        const own = nearestIn(mean, fams[fk].colors);
        if (chroma(mean) < chroma(own.lab) * 0.5 && matchDist(mean, nearestIn(mean, fams[neutralFam].colors).lab) < matchDist(mean, own.lab)) fk = neutralFam;
      }
      cellFam[g] = fk;
      const pick = dither ? dithered(mean, fams[fk].colors, gx, gy, dither) : nearestIn(mean, fams[fk].colors);
      codes[g] = avoidOppositeTint(mean, pick, allLadder).code;
    }
  }

  // 7. 清理：只清"外来色"小块。同族相邻色阶的小块、单颗都留着（那是渐变的交织）
  const ladderIndex = new Map<string, { fam: number; level: number }>();
  fams.forEach((f, k) => f.colors.forEach((c, l) => ladderIndex.set(c.code, { fam: k, level: l })));
  const minForeign = options.size === 'small' ? 2 : options.size === 'medium' ? 3 : 4;
  const grid0: Grid = { width: cols, height: rows, cells: codes };
  const details = protectDetails(codes, cols, rows); // 眼睛、高光这类小而对比强的格子所在的小块不并
  for (const region of connectedRegions(grid0, (a, b) => a === b)) {
    if (region.length >= minForeign || region.some(i => details[i])) continue;
    const own = codes[region[0]]!;
    const ownL = ladderIndex.get(own);
    const neigh = new Map<string, number>();
    for (const i of region) {
      const x = i % cols, y = (i - x) / cols;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const c = codes[ny * cols + nx];
        if (c && c !== own) neigh.set(c, (neigh.get(c) ?? 0) + 1);
      }
    }
    if (!neigh.size) continue;
    const [top] = [...neigh].sort((a, b) => b[1] - a[1])[0];
    const topL = ladderIndex.get(top);
    // 同族且只差一级：写实风里是渐变的交织，保留；贴纸风要成片的色带，并掉
    if (style.id === 'realistic' && ownL && topL && ownL.fam === topL.fam && Math.abs(ownL.level - topL.level) <= 1) continue;
    // 明显比周围暗、又和周围不同族的小块（暖色皮肤里的青灰虹膜）：对比没到 protectDetails 的门槛，
    // 并掉眼睛就没了。单颗多半是噪点，照常并
    if (region.length >= 2 && ownL && topL && ownL.fam !== topL.fam && colorOf(top).lab[0] - colorOf(own).lab[0] >= DARK_DETAIL_STEP) continue;
    for (const i of region) codes[i] = top;
  }

  // 背景分带后相邻两带会在边界上交错成噪点：对背景格做一次 3×3 多数滤波，只在背景格之间换
  if (bgBeads.length > 1) {
    const bgSet = new Set(bgBeads.map(b => b.code));
    const snap = codes.slice();
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      const g = gy * cols + gx;
      if (!snap[g] || !bgSet.has(snap[g]!)) continue;
      const tally = new Map<string, number>();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const c = snap[ny * cols + nx];
        if (c && bgSet.has(c)) tally.set(c, (tally.get(c) ?? 0) + 1);
      }
      let best = snap[g]!, bn = 0;
      for (const [c, n] of tally) if (n > bn) [best, bn] = [c, n];
      codes[g] = best;
    }
  }

  // 零碎色：抖动边缘会留下 1 到 2 颗的颜色，并入最接近的
  // 贴纸风先修一遍边缘（尖刺、细线拐角多的那颗、孤豆），再把大色块边上乱跳的台阶理顺；写实风的交织和抖动是故意的，不动。
  // 修完再并零碎色：修边可能把某种颜色修到只剩一两颗
  let cleaned = codes;
  if (style.id !== 'realistic') {
    const keep = protectDetails(cleaned, cols, rows);
    cleaned = tidyEdges(cleaned, cols, rows, keep);
    cleaned = regularizeEdges(cleaned, cols, rows, keep);
  }
  cleaned = mergeRareColors(cleaned, MIN_BEADS_PER_COLOR);
  for (let i = 0; i < codes.length; i++) codes[i] = cleaned[i];

  // 8. 放板：保留背景时占满，空格用背景色补；抠图时居中留边。自定义尺寸放到能装下它的豆板上，不铺满
  const area = options.fit ? boardArea(cols, rows) : { width: size.board, height: size.board };
  const grid = createGrid(area.width, area.height);
  const ox = Math.floor((area.width - cols) / 2), oy = Math.floor((area.height - rows) / 2);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const gx = ox + x, gy = oy + y;
    if (gx < 0 || gy < 0 || gx >= area.width || gy >= area.height) continue;
    grid.cells[gy * area.width + gx] = codes[y * cols + x];
  }
  if (keepBackground && mainBgBead && !options.fit) {
    for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === null) grid.cells[i] = mainBgBead.code;
  }
  return grid;
}
