// 出图测试台：给自动化脚本调用，用真实浏览器跑和网页完全相同的流程（读图 → 抠图 → 出图 → 检查 → 渲染）。
import type { SizeId, StyleId } from './core/config';
import { legendOf, type Grid } from './core/grid';
import { colorOf } from './core/palette';
import { generatePattern, resolveKind } from './core/pipeline';
import { recommendSize } from './core/recommend';
import { validateGrid } from './core/validate';
import { renderSheet } from './render/sheet';
import { cutout } from './ui/cutout';
import { loadImage } from './ui/loadImage';
import { analyzeIrregularGrid, analyzePixelGrid, detectPixelGrid } from './core/pixelgrid';
import { clusterSizes, flatness, gradientShare } from './core/classify';
import { rgbToLab, type Lab } from './core/color';

interface CaseInput {
  url: string;
  size: SizeId;
  style: StyleId;
  removeBackground: boolean;
}

const maskCache = new Map<string, Awaited<ReturnType<typeof cutout>>>();

async function runCase(input: CaseInput) {
  const blob = await (await fetch(input.url)).blob();
  const file = new File([blob], input.url.split('/').pop() ?? 'image.png', { type: blob.type });
  const { image, pixelArt } = await loadImage(file);
  const t0 = performance.now();
  let cut: Awaited<ReturnType<typeof cutout>> = { mask: null, method: 'failed' };
  if (input.removeBackground) {
    cut = maskCache.get(input.url) ?? (await cutout(image, () => {}, { allowModel: !pixelArt }));
    maskCache.set(input.url, cut);
  }
  const t1 = performance.now();
  const patternInput = { image, mask: cut.mask, pixelArt: !!pixelArt };
  const kind = resolveKind(patternInput);
  const grid = generatePattern({ ...patternInput, kind }, { size: input.size, style: input.style });
  const t2 = performance.now();
  const checks = validateGrid(grid, { size: input.size, style: input.style, fullBoard: kind === 'photo' && !cut.mask });
  const sheet = renderSheet(grid);
  return {
    sheet: sheet.toDataURL('image/png'),
    checks,
    cutoutMethod: input.removeBackground ? cut.method : 'off',
    cutoutMs: Math.round(t1 - t0),
    generateMs: Math.round(t2 - t1),
    colors: legendOf(grid).length,
    beads: grid.cells.filter(Boolean).length,
    pixelArt: pixelArt ? `${pixelArt.cols}x${pixelArt.rows}` : null,
    kind,
    recommended: recommendSize(image, cut.mask, kind, pixelArt),
    // 格子矩阵：评测脚本存成 json，用来和理想豆纸做结构对比
    cells: { width: grid.width, height: grid.height, codes: grid.cells },
  };
}

/** 成品预览：每格画成一颗圆豆，接近真实拼完的样子 */
function drawBeads(ctx: CanvasRenderingContext2D, grid: Grid, x0: number, y0: number, cell: number) {
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(x0, y0, grid.width * cell, grid.height * cell);
  grid.cells.forEach((code, i) => {
    if (!code) return;
    const x = i % grid.width, y = (i - x) / grid.width;
    ctx.fillStyle = colorOf(code).hex;
    ctx.beginPath();
    ctx.arc(x0 + x * cell + cell / 2, y0 + y * cell + cell / 2, cell * 0.47, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** 对比图：原图 + 每种风格的成品预览，一行一张测试图 */
async function contactSheet(urls: string[], size: SizeId, styles: StyleId[], removeBackground = true) {
  const cell = 8, tile = 52 * cell, gap = 16, label = 22;
  const canvas = document.createElement('canvas');
  canvas.width = (styles.length + 1) * (tile + gap) + gap;
  canvas.height = urls.length * (tile + gap + label) + gap;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '16px sans-serif';
  for (const [row, url] of urls.entries()) {
    const y = gap + row * (tile + gap + label);
    const blob = await (await fetch(url)).blob();
    const { image, previewUrl, pixelArt } = await loadImage(new File([blob], 'x.png', { type: blob.type }));
    const img = new Image();
    img.src = previewUrl;
    await img.decode();
    const s = Math.min(tile / image.width, tile / image.height);
    ctx.drawImage(img, gap, y + label, image.width * s, image.height * s);
    ctx.fillStyle = '#333';
    ctx.fillText(url.split('/').pop()!, gap, y + 16);
    const cut = removeBackground
      ? maskCache.get(url) ?? (await cutout(image, () => {}, { allowModel: !pixelArt }))
      : { mask: null, method: 'failed' as const };
    if (removeBackground) maskCache.set(url, cut);
    const kind = resolveKind({ image, mask: cut.mask, pixelArt: !!pixelArt });
    for (const [col, style] of styles.entries()) {
      const grid = generatePattern({ image, mask: cut.mask, pixelArt: !!pixelArt, kind }, { size, style });
      const x = gap + (col + 1) * (tile + gap);
      const c = Math.floor(tile / grid.width);
      drawBeads(ctx, grid, x, y + label, c);
      ctx.fillStyle = '#333';
      ctx.fillText(`${style} · ${legendOf(grid).length} 色 · ${kind}`, x, y + 16);
    }
  }
  return canvas.toDataURL('image/png');
}

/** 调试：看每张图的网格识别数据（格距、两个方向的得分） */
async function gridInfo(urls: string[]) {
  const out: Record<string, unknown> = {};
  for (const url of urls) {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const img = { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
    const a = analyzePixelGrid(img);
    const d = detectPixelGrid(img);
    const ir = analyzeIrregularGrid(img);
    out[url.split('/').pop()!] = {
      size: `${w}x${h}`,
      lattice: { pitch: +a.pitch.toFixed(2), scoreX: +a.scoreX.toFixed(2), scoreY: +a.scoreY.toFixed(2) },
      irregular: ir
        ? {
            pitch: ir.pitch,
            lag: `${ir.lagX}/${ir.lagY}`,
            periodicity: `${ir.periodicityX.toFixed(2)}/${ir.periodicityY.toFixed(2)}`,
            concentration: `${ir.concentrationX.toFixed(2)}/${ir.concentrationY.toFixed(2)}`,
            flatShare: +ir.flatShare.toFixed(2),
            cells: `${ir.cols}x${ir.rows}`,
          }
        : null,
      detected: d ? { method: d.method, pitch: +d.pitch.toFixed(1), cols: d.cols, rows: d.rows } : null,
    };
  }
  return out;
}

/** 调试：输入分类用到的各项指标，用来定阈值 */
async function classifyInfo(urls: string[]) {
  const out: Record<string, unknown> = {};
  for (const url of urls) {
    const blob = await (await fetch(url)).blob();
    const { image, pixelArt } = await loadImage(new File([blob], 'x.png', { type: blob.type }));
    const cut = maskCache.get(url) ?? (await cutout(image, () => {}, { allowModel: !pixelArt }));
    maskCache.set(url, cut);
    const mask = cut.mask;
    const labs: Lab[] = [];
    const total = image.width * image.height;
    const step = Math.max(1, Math.floor(total / 20000));
    for (let i = 0; i < total; i += step) {
      if ((mask ? mask.data[i] : image.data[i * 4 + 3] / 255) < 0.5) continue;
      labs.push(rgbToLab(image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2]));
    }
    const cover = (radius: number) => {
      const sizes = clusterSizes(labs, radius);
      const sum = sizes.reduce((a, b) => a + b, 0);
      let acc = 0;
      for (let i = 0; i < sizes.length; i++) {
        acc += sizes[i];
        if (acc >= sum * 0.95) return i + 1;
      }
      return sizes.length;
    };
    out[url.split('/').pop()!] = {
      size: `${image.width}x${image.height}`,
      clusters95_r04: cover(0.04),
      clusters95_r07: cover(0.07),
      flat02: +flatness(image, mask).toFixed(2),
      gradient: +gradientShare(image, mask).toFixed(2),
    };
  }
  return out;
}

Object.assign(window, { runCase, contactSheet, gridInfo, classifyInfo });
