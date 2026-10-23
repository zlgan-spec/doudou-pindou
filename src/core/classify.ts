// 输入分类：决定走哪条出图路径。
// - pixel：严格在网格上的像素画（由 pixelgrid 识别，这里不重复判断）
// - flat：平涂图。颜色聚类后少数几类就能覆盖绝大部分主体（卡通、贴纸、AI 画的像素风）
// - photo：其他，主要是照片
import { chroma, labDistance, rgbToLab, type Lab } from './color';
import type { Mask, RgbaImage } from './image';

export type InputKind = 'pixel' | 'flat' | 'photo';

const CLUSTER_RADIUS = 0.07;    // 同一块平涂色经压缩后的离散范围
const FLAT_MAX_CLUSTERS = 24;   // 这么多类能覆盖 COVERAGE 的主体像素，就算平涂
const COVERAGE = 0.95;
const SAMPLE_TARGET = 20000;

function subjectLabs(image: RgbaImage, mask: Mask | null): Lab[] {
  const total = image.width * image.height;
  const step = Math.max(1, Math.floor(total / SAMPLE_TARGET));
  const out: Lab[] = [];
  for (let i = 0; i < total; i += step) {
    const m = mask ? mask.data[i] : image.data[i * 4 + 3] / 255;
    if (m < 0.5) continue;
    out.push(rgbToLab(image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2]));
  }
  return out;
}

/** 贪心聚类：按频率从高到低，离已有中心够近就归入，否则新开一类；返回各类的像素数（降序） */
export function clusterSizes(labs: Lab[], radius: number): number[] {
  const q = (l: Lab) => `${Math.round(l[0] * 60)},${Math.round(l[1] * 120)},${Math.round(l[2] * 120)}`;
  const buckets = new Map<string, { lab: Lab; n: number }>();
  for (const lab of labs) {
    const k = q(lab);
    const e = buckets.get(k);
    if (e) e.n++;
    else buckets.set(k, { lab, n: 1 });
  }
  const centers: { lab: Lab; n: number }[] = [];
  for (const b of [...buckets.values()].sort((a, c) => c.n - a.n)) {
    const hit = centers.find(c => labDistance(c.lab, b.lab) < radius);
    if (hit) hit.n += b.n;
    else centers.push({ lab: b.lab, n: b.n });
  }
  return centers.map(c => c.n).sort((a, b) => b - a);
}

const FLAT_NEIGHBOR_DISTANCE = 0.02;

/** 主体像素里，和右边、下边的像素都几乎同色的比例（只作诊断用：手机照片降噪后这个值也很高，分不开） */
export function flatness(image: RgbaImage, mask: Mask | null): number {
  const { width, height } = image;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / SAMPLE_TARGET)));
  const labAt = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return rgbToLab(image.data[i], image.data[i + 1], image.data[i + 2]);
  };
  let total = 0, flat = 0;
  for (let y = 0; y < height - 1; y += step) {
    for (let x = 0; x < width - 1; x += step) {
      const i = y * width + x;
      if ((mask ? mask.data[i] : image.data[i * 4 + 3] / 255) < 0.5) continue;
      total++;
      const here = labAt(x, y);
      if (labDistance(here, labAt(x + 1, y)) < FLAT_NEIGHBOR_DISTANCE && labDistance(here, labAt(x, y + 1)) < FLAT_NEIGHBOR_DISTANCE) flat++;
    }
  }
  return total ? flat / total : 0;
}

/**
 * 渐变占比：隔一个"豆格"远的两个主体像素，颜色差落在"中等"区间的比例。
 * 平涂图里两点要么同色（差 ≈ 0）要么跨过边界（差很大），中等差异很少；照片的光影渐变让中等差异到处都是。
 * 距离按主体尺寸换算成一个小图格子（主体最长边 / 48）。
 */
const GRADIENT_LOW = 0.035;
const GRADIENT_HIGH = 0.16;

export function gradientShare(image: RgbaImage, mask: Mask | null): number {
  const { width, height } = image;
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const i = y * width + x;
      if ((mask ? mask.data[i] : image.data[i * 4 + 3] / 255) < 0.5) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 <= x0 || y1 <= y0) return 1;
  const k = Math.max(2, Math.round(Math.max(x1 - x0, y1 - y0) / 48));
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / SAMPLE_TARGET)));
  const labAt = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return rgbToLab(image.data[i], image.data[i + 1], image.data[i + 2]);
  };
  const inside = (x: number, y: number) => (mask ? mask.data[y * width + x] : image.data[(y * width + x) * 4 + 3] / 255) >= 0.5;
  let pairs = 0, medium = 0;
  for (let y = y0; y + k <= y1; y += step) {
    for (let x = x0; x + k <= x1; x += step) {
      if (!inside(x, y)) continue;
      const here = labAt(x, y);
      for (const [nx, ny] of [[x + k, y], [x, y + k]]) {
        if (!inside(nx, ny)) continue;
        pairs++;
        const d = labDistance(here, labAt(nx, ny));
        if (d > GRADIENT_LOW && d < GRADIENT_HIGH) medium++;
      }
    }
  }
  return pairs ? medium / pairs : 1;
}

// 实测（2026-10-04，11 张图）：照片 0.37~0.50，卡通/贴纸/AI 像素风 0.16~0.27
const FLAT_MAX_GRADIENT = 0.3;

export function classifyInput(image: RgbaImage, mask: Mask | null): InputKind {
  const labs = subjectLabs(image, mask);
  if (labs.length < 50) return 'photo';
  if (gradientShare(image, mask) >= FLAT_MAX_GRADIENT) return 'photo';
  const sizes = clusterSizes(labs, CLUSTER_RADIUS);
  const total = sizes.reduce((a, b) => a + b, 0);
  let covered = 0;
  for (let i = 0; i < sizes.length; i++) {
    covered += sizes[i];
    if (covered >= total * COVERAGE) return i + 1 <= FLAT_MAX_CLUSTERS ? 'flat' : 'photo';
  }
  return 'photo';
}

/**
 * 主体边缘是否已经有深色描边：沿主体边界（紧贴背景的像素）取样，
 * 如果大多数边界像素明显比它内侧的像素暗，说明图里自带轮廓线，我们不用再描一圈。
 */
export function hasOwnOutline(image: RgbaImage, mask: Mask | null): boolean {
  const { width, height } = image;
  const isSubject = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = y * width + x;
    return (mask ? mask.data[i] : image.data[i * 4 + 3] / 255) >= 0.5;
  };
  const labAt = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return rgbToLab(image.data[i], image.data[i + 1], image.data[i + 2]);
  };
  let border = 0, dark = 0;
  const step = Math.max(1, Math.floor(Math.max(width, height) / 256));
  const reach = Math.max(2, Math.round(Math.max(width, height) / 60)); // 往内侧看多远，大约一个"像素画格子"
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (!isSubject(x, y)) continue;
      const outside = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => !isSubject(x + dx, y + dy));
      if (!outside) continue;
      border++;
      const here = labAt(x, y);
      const inner = labAt(
        Math.min(width - 1, Math.max(0, x - outside[0] * reach)),
        Math.min(height - 1, Math.max(0, y - outside[1] * reach)),
      );
      // 边界像素本身很暗，或者比内侧暗一截且不是鲜艳色，都算描边
      if (here[0] < 0.35 || (inner[0] - here[0] > 0.18 && chroma(here) < 0.12)) dark++;
    }
  }
  return border >= 40 && dark / border >= 0.6;
}
