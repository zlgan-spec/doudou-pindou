// 出图核心使用的图片和主体蒙版格式，与浏览器 ImageData 兼容，但不依赖页面。
import { labDistance, rgbToLab, type Lab } from './color';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
}

/** 主体蒙版：每个像素 0~1，1 = 主体 */
export interface Mask {
  width: number;
  height: number;
  data: Float32Array;
}

// --- 纯色背景：边缘颜色足够统一时，从边缘往里去除相近颜色 ---

const PLAIN_EDGE_SHARE = 0.8;    // 边缘至少 8 成像素接近同一颜色，才算纯色背景
const PLAIN_EDGE_TOLERANCE = 0.06;
const PLAIN_FILL_TOLERANCE = 0.07;
const FILL_GLOBAL_TOLERANCE = 0.2;  // 背景整体允许离种子色多远（照顾暗角、渐变）
const FILL_STEP_TOLERANCE = 0.03;   // 相邻两个像素之间最多差多少（主体边界是突变，过不去）

function labAt(img: RgbaImage, i: number): Lab {
  return rgbToLab(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
}

function isTransparent(img: RgbaImage, i: number): boolean {
  return img.data[i * 4 + 3] < 128;
}

function borderIndices(width: number, height: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < width; x++) out.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) out.push(y * width, y * width + width - 1);
  return out;
}

/** 图片本身带透明背景时直接用透明度做蒙版 */
export function alphaMask(img: RgbaImage): Mask | null {
  let transparent = 0;
  const data = new Float32Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) {
    data[i] = img.data[i * 4 + 3] / 255;
    if (data[i] < 0.5) transparent++;
  }
  return transparent > data.length * 0.02 ? { width: img.width, height: img.height, data } : null;
}

/**
 * 从边缘上接近 center 颜色的像素出发向内填充。两个条件同时满足才继续：
 * 和种子色的差在 FILL_GLOBAL_TOLERANCE 内（背景可以有暗角、渐变），
 * 和来源像素的差在 FILL_STEP_TOLERANCE 内（主体边界是颜色突变，过不去）。
 */
function floodBackground(img: RgbaImage, center: Lab, border: number[]): Uint8Array {
  const { width, height } = img;
  const background = new Uint8Array(width * height);
  const labs = new Map<number, Lab>();
  const lab = (i: number) => {
    let l = labs.get(i);
    if (!l) labs.set(i, (l = labAt(img, i)));
    return l;
  };
  const stack: number[] = [];
  for (const i of border) {
    if (labDistance(lab(i), center) < PLAIN_FILL_TOLERANCE) {
      background[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const from = lab(i);
    const x = i % width, y = (i - x) / width;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (background[j]) continue;
      if (isTransparent(img, j)) {
        background[j] = 1;
        stack.push(j);
        continue;
      }
      const here = lab(j);
      if (labDistance(here, center) < FILL_GLOBAL_TOLERANCE && labDistance(here, from) < FILL_STEP_TOLERANCE) {
        background[j] = 1;
        stack.push(j);
      }
    }
  }
  return background;
}

function toMask(background: Uint8Array, width: number, height: number): Mask {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = background[i] ? 0 : 1;
  return { width, height, data };
}

/**
 * 主体贴着画面边缘时，边缘颜色不够统一，但背景仍然是一种平涂色：
 * 取边缘上最多的那种颜色，只要它占边缘三成以上、填充后连成一片且占画面一定面积，就当背景。
 * 填出来的背景得真是平涂色（绝大部分接近那种颜色）：照片里的墙有明暗，填充会顺着渐变
 * 漫进脸、浅色猫毛这些颜色相近的主体，这种交给抠图模型。
 */
const DOMINANT_MIN_BORDER_SHARE = 0.3;
const DOMINANT_MIN_AREA_SHARE = 0.1;
const DOMINANT_MIN_FLAT_SHARE = 0.8;

export function dominantBorderMask(img: RgbaImage): Mask | null {
  const { width, height } = img;
  const border = borderIndices(width, height).filter(i => !isTransparent(img, i));
  if (border.length === 0) return null;
  const labs = border.map(i => labAt(img, i));
  const centers: { lab: Lab; n: number }[] = [];
  for (const lab of labs) {
    const hit = centers.find(c => labDistance(c.lab, lab) < PLAIN_EDGE_TOLERANCE);
    if (hit) hit.n++;
    else centers.push({ lab, n: 1 });
  }
  const top = centers.sort((a, b) => b.n - a.n)[0];
  if (top.n < labs.length * DOMINANT_MIN_BORDER_SHARE) return null;
  const background = floodBackground(img, top.lab, border);
  let area = 0, flat = 0;
  for (let i = 0; i < background.length; i++) {
    if (!background[i]) continue;
    area++;
    if (isTransparent(img, i) || labDistance(labAt(img, i), top.lab) < PLAIN_EDGE_TOLERANCE) flat++;
  }
  if (area < width * height * DOMINANT_MIN_AREA_SHARE) return null;
  if (flat < area * DOMINANT_MIN_FLAT_SHARE) return null;
  return toMask(background, width, height);
}

/** 纯色背景时返回蒙版，否则返回 null（交给抠图模型） */
export function plainBackgroundMask(img: RgbaImage): Mask | null {
  const { width, height } = img;
  const border = borderIndices(width, height).filter(i => !isTransparent(img, i));
  if (border.length === 0) return null;
  const labs = border.map(i => labAt(img, i));
  const median: Lab = [0, 1, 2].map(k => {
    const v = labs.map(l => l[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  }) as Lab;
  const close = labs.filter(l => labDistance(l, median) < PLAIN_EDGE_TOLERANCE).length;
  if (close < labs.length * PLAIN_EDGE_SHARE) return null;
  return toMask(floodBackground(img, median, border), width, height);
}

/** 蒙版整理：二值化，只保留最大的一块主体，填上主体内部的小洞 */
export function cleanMask(mask: Mask): Mask {
  const { width, height } = mask;
  const n = width * height;
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = mask.data[i] >= 0.5 ? 1 : 0;

  const label = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const flood = (start: number, value: number, id: number) => {
    const stack = [start];
    label[start] = id;
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width, y = (i - x) / width;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (label[j] !== -1 || fg[j] !== value) continue;
        label[j] = id;
        stack.push(j);
      }
    }
    return size;
  };

  for (let i = 0; i < n; i++) if (fg[i] && label[i] === -1) sizes.push(flood(i, 1, sizes.length));
  if (sizes.length === 0) return { width, height, data: new Float32Array(n) };
  const main = sizes.indexOf(Math.max(...sizes));

  // 背景里不和边缘相连的小洞（主体内部的空洞）填回主体
  const outside = new Int32Array(n).fill(-1);
  const bgStack: number[] = [];
  for (const i of borderIndices(width, height)) {
    if (label[i] !== main && outside[i] === -1) {
      outside[i] = 1;
      bgStack.push(i);
    }
  }
  while (bgStack.length) {
    const i = bgStack.pop()!;
    const x = i % width, y = (i - x) / width;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (outside[j] !== -1 || label[j] === main) continue;
      outside[j] = 1;
      bgStack.push(j);
    }
  }
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = label[i] === main || outside[i] !== 1 ? 1 : 0;
  return { width, height, data };
}

/** 蒙版缩放到图片尺寸（最近邻） */
export function resizeMask(mask: Mask, width: number, height: number): Mask {
  if (mask.width === width && mask.height === height) return mask;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mask.height - 1, Math.floor((y + 0.5) * mask.height / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mask.width - 1, Math.floor((x + 0.5) * mask.width / width));
      data[y * width + x] = mask.data[sy * mask.width + sx];
    }
  }
  return { width, height, data };
}
