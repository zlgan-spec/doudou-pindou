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

describe('像素画网格识别', () => {
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
});
