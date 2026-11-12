// 像素画网格识别：外部行为测试。构造一张 16×16 的小图按 7 倍放大、带 3 像素偏移，应该识别出 7 的格距并还原成 16×16。
import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../src/core/image';
import { detectPixelGrid, resampleOnGrid } from '../src/core/pixelgrid';

function sprite(): number[][] {
  // 0 白底，1 橙，2 深橙描边，3 黑眼睛
  const rows = [
    '0000000000000000',
    '0002200000022000',
    '0021120000211200',
    '0211112222111120',
    '0211111111111120',
    '2111111111111112',
    '2111311111131112',
    '2111311111131112',
    '2111111111111112',
    '2111111111111112',
    '0211111111111120',
    '0211111111111120',
    '0021111111111200',
    '0002222222222000',
    '0000000000000000',
    '0000000000000000',
  ];
  return rows.map(r => [...r].map(Number));
}

const COLORS: Record<number, [number, number, number]> = { 0: [255, 255, 255], 1: [232, 140, 60], 2: [160, 80, 30], 3: [20, 20, 20] };

function upscale(cells: number[][], pitch: number, offset: number): RgbaImage {
  const rows = cells.length, cols = cells[0].length;
  const width = cols * pitch + offset * 2, height = rows * pitch + offset * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cy = Math.floor((y - offset) / pitch), cx = Math.floor((x - offset) / pitch);
      const v = cy >= 0 && cx >= 0 && cy < rows && cx < cols ? cells[cy][cx] : 0;
      const [r, g, b] = COLORS[v];
      const i = (y * width + x) * 4;
      // 加一点噪声模拟 JPEG
      data[i] = Math.min(255, Math.max(0, r + ((x * 7 + y * 3) % 5) - 2));
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** AI 画的像素场景：每格宽窄不一（10–17 像素），横竖两个方向的浮动还不一样 */
function irregularScene(cols: number, rows: number, seed: number): { img: RgbaImage; cols: number; rows: number } {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const sizes = (n: number, lo: number, hi: number) => Array.from({ length: n }, () => lo + Math.floor(rnd() * (hi - lo + 1)));
  const ws = sizes(cols, 10, 17), hs = sizes(rows, 12, 16);
  const xs = [0], ys = [0];
  for (const w of ws) xs.push(xs[xs.length - 1] + w);
  for (const h of hs) ys.push(ys[ys.length - 1] + h);
  const palette = [[60, 50, 70], [91, 71, 77], [66, 77, 98], [254, 210, 91], [175, 212, 235], [242, 240, 243], [53, 38, 39], [121, 83, 82]];
  // 相邻的格子常常同色（大色块），不然处处是边、和真实的图不像
  const cell: number[][] = [];
  for (let r = 0; r < rows; r++) {
    cell.push([]);
    for (let c = 0; c < cols; c++) {
      const t = rnd();
      cell[r].push(t < 0.45 && c > 0 ? cell[r][c - 1] : t < 0.8 && r > 0 ? cell[r - 1][c] : Math.floor(rnd() * palette.length));
    }
  }
  const width = xs[cols], height = ys[rows];
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const [R, G, B] = palette[cell[r][c]];
    for (let y = ys[r]; y < ys[r + 1]; y++) for (let x = xs[c]; x < xs[c + 1]; x++) {
      const i = (y * width + x) * 4;
      data[i] = R; data[i + 1] = G; data[i + 2] = B;
    }
  }
  return { img: { width, height, data }, cols, rows };
}

describe('像素画网格识别', () => {
  it('格子宽窄不一的像素场景也能认出来，格数差不到一成', () => {
    for (const seed of [7, 21, 99, 1234]) {
      const { img, cols, rows } = irregularScene(60, 56, seed);
      const grid = detectPixelGrid(img);
      expect(grid, `seed ${seed}`).not.toBeNull();
      expect(Math.abs(grid!.cols - cols) / cols).toBeLessThan(0.1);
      expect(Math.abs(grid!.rows - rows) / rows).toBeLessThan(0.1);
    }
  });

  it('识别放大 7 倍、偏移 3 像素的精灵图，并还原成 16×16', () => {
    const img = upscale(sprite(), 7, 3);
    const grid = detectPixelGrid(img);
    expect(grid).not.toBeNull();
    expect(Math.abs(grid!.pitch - 7)).toBeLessThan(0.3);
    const small = resampleOnGrid(img, grid!);
    expect(small.width).toBeGreaterThanOrEqual(16);
    // 眼睛位置（第 6 行第 4 列，偏移后可能多出 1 列）应是近黑
    const findDark = () => {
      let n = 0;
      for (let i = 0; i < small.width * small.height; i++) if (small.data[i * 4] < 60) n++;
      return n;
    };
    expect(findDark()).toBe(4);
  });

  it('照片（随机渐变）不会被当成像素画', () => {
    const width = 200, height = 200;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = (x * 255) / width;
        data[i + 1] = (y * 255) / height;
        data[i + 2] = ((x + y) * 127) / (width + height) + ((x * 13 + y * 7) % 11);
        data[i + 3] = 255;
      }
    }
    expect(detectPixelGrid({ width, height, data })).toBeNull();
  });

  it('比一格细、不在格子正中的深色线不会读断；旁边色块蹭进来的不算线', () => {
    const pitch = 12, cols = 20, rows = 20;
    const width = cols * pitch, height = rows * pitch;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const row = Math.floor(y / pitch);
        // 第 7 列左边 4 像素宽的竖线（第 2 到 17 行）；第 12、13 列是深色块，往第 14 列多蹭进 4 像素
        const line = x >= 7 * pitch && x < 7 * pitch + 4 && row >= 2 && row <= 17;
        const block = x >= 12 * pitch && x < 14 * pitch + 4 && row >= 5 && row <= 10;
        data.set(line || block ? [53, 38, 39, 255] : [253, 220, 198, 255], (y * width + x) * 4);
      }
    }
    const small = resampleOnGrid({ width, height, data }, { pitch, offsetX: 0, offsetY: 0, cols, rows, method: 'lattice' });
    const dark = (c: number, r: number) => small.data[(r * cols + c) * 4] < 100;
    for (let r = 2; r <= 17; r++) expect(dark(7, r), `第 ${r} 行的线`).toBe(true);
    expect(dark(6, 8)).toBe(false);
    for (let r = 5; r <= 10; r++) expect(dark(14, r), `第 ${r} 行色块右边`).toBe(false);
  });
});
