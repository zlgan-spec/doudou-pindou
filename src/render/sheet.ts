// 把格子表格画成标准拼豆图纸：
// 顶部规格 → 四边坐标 + 整块豆板网格（每格色号、每 10 格粗线）→ 底部色卡。
import { SIZES, boardLabel } from '../core/config';
import { textColorOn } from '../core/color';
import { legendOf, type Grid } from '../core/grid';
import { colorOf } from '../core/palette';
import { BEST, frame } from '../ui/Logo';

// 表头的标志：和网站左上角同一个静态标志（56° 截面、手绘粗细线）。图纸是白纸，颜色写死成浅色版。
// SVG 转成图片要异步加载一次，加载好之前的图纸先不画标志，好了以后调用方再重画
let logoImg: HTMLImageElement | null = null;
let logoReady: Promise<void> | null = null;
export function sheetLogoReady(): Promise<void> {
  if (logoReady) return logoReady;
  if (typeof Image === 'undefined') return (logoReady = Promise.resolve());
  const inner = frame(BEST, 'sheet-logo', 3, 1.1)
    .replace(/var\(--ink, (#[0-9a-f]+)\)/g, '$1')
    .replace(/var\(--bead-side, (#[0-9a-f]+)\)/g, '$1')
    .replace(/var\(--bead-face, (#[0-9a-f]+)\)/g, '$1');
  const img = new Image();
  logoReady = new Promise(resolve => {
    img.onload = () => { logoImg = img; resolve(); };
    img.onerror = () => resolve();
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">${inner}</svg>`)}`;
  return logoReady;
}
void sheetLogoReady(); // 页面一打开就先加载，第一次出图纸时多半已经好了

export interface SheetOptions {
  mirrored?: boolean;
  /** 拼豆模式：这些色号淡化显示（只在屏幕上用，导出的图纸不传） */
  dim?: ReadonlySet<string>;
  /** 网格线：all = 细线 + 每 10 格粗线（默认、导出用），major = 只留粗线，none = 不画网格（外框保留）。只在屏幕上切换 */
  lines?: 'all' | 'major' | 'none';
  /** false = 格子里不写色号（预览看整体效果用）。只在屏幕上切换 */
  codes?: boolean;
  /** 画布像素是版式尺寸的几倍：屏幕上按放大倍数 × 屏幕清晰度，导出用 2 倍，放大看都清楚。坐标照旧用版式尺寸 */
  scale?: number;
  /** 图纸名字：表头写「DouDou / 名字」，没起名只写「DouDou」（和网站顶栏同一个写法，作者另在图纸库里写） */
  title?: string;
}

export interface SheetLayout {
  cell: number;
  gridX: number;
  gridY: number;
}

const BOARD = SIZES.large.board; // 拼大图用的板
const FONT = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif';
const THIN_LINE = '#d4d4d4';
const THICK_LINE = '#262626';
const AXIS_TEXT = '#6e6e73'; // 坐标条有底色后数字要深一点才看得清
const AXIS_FILL = '#eeede9'; // 浅暖灰：中性色不和豆子颜色抢眼
const AXIS_LINE = '#dcdad4';

/** 每格像素：小图 36，大板 32，保证 ≥ 32（C8） */
export function cellSizeFor(board: number): number {
  return board <= 52 ? 36 : 32;
}

type FullLayout = SheetLayout & { width: number; height: number; legendTop: number; cardW: number; cardH: number; gap: number; perRow: number; pad: number; axis: number; band: number };
// 版式要数一遍全图颜色，画笔每动一格都要用：同一张表格算一次就记住（表格改了就是新对象）
const layouts = new WeakMap<Grid, FullLayout>();

export function sheetLayout(grid: Grid): FullLayout {
  let L = layouts.get(grid);
  if (!L) layouts.set(grid, (L = computeLayout(grid)));
  return L;
}

/** 超过一块 104 板：要用几块板拼 */
const isMulti = (grid: Grid) => grid.width > BOARD || grid.height > BOARD;

/** 第几块板的名字：竖着第 row 排用字母、横着第 col 列用数字，A1、A2、B1… */
export function boardName(row: number, col: number): string {
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

function computeLayout(grid: Grid): FullLayout {
  const cell = cellSizeFor(grid.width);
  const axis = Math.round(cell * 0.95);
  const pad = Math.round(cell * 0.8);
  const header = Math.round(cell * 1.5); // 一行：署名 + 规格
  const band = isMulti(grid) ? Math.round(cell * 1.8) : 0; // 多块板：坐标条外面再加一条写板号（上面 1 2 3，左边 A B C）
  const gridX = pad + band + axis;
  const gridY = pad + header + band + axis;
  const gridW = grid.width * cell;
  const width = gridX + gridW + axis + pad;
  const cardW = Math.round(cell * 2.1), cardH = Math.round(cell * 2.3), gap = Math.round(cell * 0.35);
  const perRow = Math.max(1, Math.floor((width - pad * 2 + gap) / (cardW + gap)));
  const legendCount = legendOf(grid).length;
  const rows = Math.max(1, Math.ceil(legendCount / perRow));
  const legendTop = gridY + grid.height * cell + axis + Math.round(cell * 0.8);
  const height = legendTop + rows * (cardH + gap) - gap + pad;
  return { cell, gridX, gridY, width, height, legendTop, cardW, cardH, gap, perRow, pad, axis, band };
}

/** 第 i 条格线是什么线：外框、板和板的接缝、每块板里每 10 颗的粗线、普通细线 */
function lineKind(i: number, n: number): 'border' | 'seam' | 'major' | 'thin' {
  if (i === 0 || i === n) return 'border';
  if (i % BOARD === 0) return 'seam';
  return (i % BOARD) % 10 === 0 ? 'major' : 'thin';
}

export function renderSheet(grid: Grid, options: SheetOptions = {}, canvas: HTMLCanvasElement = document.createElement('canvas')): HTMLCanvasElement {
  const L = sheetLayout(grid);
  const scale = options.scale ?? 1;
  canvas.width = Math.max(1, Math.round(L.width * scale));
  canvas.height = Math.max(1, Math.round(L.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, L.width, L.height);

  const legend = legendOf(grid);
  drawHeader(ctx, L, grid, legend, options);
  const all: number[] = [];
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i]) all.push(i);
  drawCells(ctx, L, grid, all, options);
  drawAxes(ctx, L, grid);
  drawGridLines(ctx, L, grid, options);
  drawLegend(ctx, L, legend);
  return canvas;
}

/**
 * 只重画改过的格子（编辑时用，大图不用整张重画）：改过的格子连同四周一圈重新上色、写色号、补格线，表头的颗数和底部色卡整块重画。
 * extra：没改颜色但被实时预览涂过、要恢复原样的格子。画不了（尺寸、版式变了，或改动太多）返回 false，调用方整张重画
 */
export function renderSheetDiff(prev: Grid, grid: Grid, options: SheetOptions, canvas: HTMLCanvasElement, extra: Iterable<number> = []): boolean {
  if (prev.width !== grid.width || prev.height !== grid.height) return false;
  const L = sheetLayout(grid), P = sheetLayout(prev);
  const scale = options.scale ?? 1;
  if (L.height !== P.height || canvas.width !== Math.max(1, Math.round(L.width * scale)) || canvas.height !== Math.max(1, Math.round(L.height * scale))) return false;
  const { width: w, height: h } = grid;
  const dirty = new Set<number>(extra);
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] !== prev.cells[i]) dirty.add(i);
  if (dirty.size > grid.cells.length / 4) return false;
  const changedColors = [...dirty].some(i => grid.cells[i] !== prev.cells[i]);
  // 连同四周一圈：缩放后格子边上的像素是两格颜色混出来的，只画自己那格会留下一道白边
  const cells = new Set<number>();
  for (const i of dirty) {
    const x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) cells.add(ny * w + nx);
    }
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const list = [...cells];
  // 只在这些格子里画：格子边上的线有一半在旁边没重画的格子里，画两遍会变深
  ctx.save();
  ctx.beginPath();
  for (const i of list) {
    const x = i % w, y = (i - x) / w;
    ctx.rect(L.gridX + x * L.cell, L.gridY + y * L.cell, L.cell, L.cell);
  }
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  drawCells(ctx, L, grid, list.filter(i => grid.cells[i]), options);
  drawGridLines(ctx, L, grid, options, list);
  ctx.restore();
  if (changedColors) {
    const legend = legendOf(grid);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, L.width, L.gridY - L.axis - L.band);
    drawHeader(ctx, L, grid, legend, options);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, L.legendTop - 2, L.width, L.height - L.legendTop + 2);
    drawLegend(ctx, L, legend);
  }
  return true;
}

// 表头（C7）：标志 + 「DouDou / 名字」，后面跟「共 N 颗 · 52×52 豆板」，镜像版加「镜像版」
function drawHeader(ctx: CanvasRenderingContext2D, L: FullLayout, grid: Grid, legend: ReturnType<typeof legendOf>, options: SheetOptions) {
  const { cell, pad } = L;
  const beads = legend.reduce((n, l) => n + l.count, 0);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const baseline = pad + cell * 0.8;
  void sheetLogoReady();
  const logoSize = Math.round(cell * 0.95);
  let x = logoImg ? pad + logoSize + Math.round(cell * 0.25) : pad;
  if (logoImg) ctx.drawImage(logoImg, pad, Math.round(baseline - cell * 0.21 - logoSize / 2), logoSize, logoSize); // 和文字中线对齐
  const name = options.title?.trim();
  const named = name && name !== '未命名' ? name : '';
  ctx.font = `bold ${Math.round(cell * 0.6)}px ${FONT}`;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText('DouDou', x, baseline);
  x += ctx.measureText('DouDou').width;
  if (named) {
    ctx.font = `${Math.round(cell * 0.6)}px ${FONT}`;
    ctx.fillStyle = '#9a9a9a';
    const slash = ' / ';
    ctx.fillText(slash, x, baseline);
    x += ctx.measureText(slash).width;
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `bold ${Math.round(cell * 0.6)}px ${FONT}`;
    ctx.fillText(named, x, baseline);
    x += ctx.measureText(named).width;
  }
  const specX = x + cell * 0.6;
  const spec = `${options.mirrored ? '镜像版 · ' : ''}共 ${beads} 颗 · ${boardLabel(grid.width, grid.height)}`;
  let specSize = Math.round(cell * 0.42);
  ctx.font = `${specSize}px ${FONT}`;
  const room = L.width - pad - specX;
  const specW = ctx.measureText(spec).width;
  if (specW > room) {
    specSize = Math.max(10, Math.floor((specSize * room) / specW));
    ctx.font = `${specSize}px ${FONT}`;
  }
  ctx.fillStyle = '#555555';
  ctx.fillText(spec, specX, baseline);
}

// 格子颜色 + 色号（C1）
function drawCells(ctx: CanvasRenderingContext2D, L: FullLayout, grid: Grid, indices: number[], options: SheetOptions) {
  const { cell, gridX, gridY } = L;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(cell * 0.34)}px ${FONT}`;
  for (const i of indices) {
    const code = grid.cells[i];
    if (!code) continue;
    const x = i % grid.width, y = (i - x) / grid.width;
    const hex = colorOf(code).hex;
    const px = gridX + x * cell, py = gridY + y * cell;
    ctx.fillStyle = hex;
    ctx.fillRect(px, py, cell, cell);
    if (options.dim?.has(code)) {
      // 淡化：盖一层白，色号不写，正在拼的颜色才跳出来
      ctx.fillStyle = 'rgba(255, 255, 255, 0.84)';
      ctx.fillRect(px, py, cell, cell);
      continue;
    }
    if (options.codes === false) continue;
    ctx.fillStyle = textColorOn(hex);
    ctx.fillText(code, px + cell / 2, py + cell / 2 + 1);
  }
}

// 坐标条（C3）：浅灰底，和图纸区分开，数格子时眼睛不会串行（参考常见拼豆 App 图纸的表头样式）。
// 坐标在每块板里从 1 重新数，拼哪块数哪块；多块板时外面再加一条写板号
function drawAxes(ctx: CanvasRenderingContext2D, L: FullLayout, grid: Grid) {
  const { cell, gridX, gridY, axis } = L;
  const gw = grid.width * cell, gh = grid.height * cell;
  ctx.fillStyle = AXIS_FILL;
  ctx.fillRect(gridX - axis, gridY - axis, gw + axis * 2, axis);
  ctx.fillRect(gridX - axis, gridY + gh, gw + axis * 2, axis);
  ctx.fillRect(gridX - axis, gridY, axis, gh);
  ctx.fillRect(gridX + gw, gridY, axis, gh);
  // 坐标条里也画出每格的分隔，和下面的格子对齐
  ctx.strokeStyle = AXIS_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < grid.width; i++) {
    const x = gridX + i * cell + 0.5;
    ctx.moveTo(x, gridY - axis); ctx.lineTo(x, gridY);
    ctx.moveTo(x, gridY + gh); ctx.lineTo(x, gridY + gh + axis);
  }
  for (let j = 1; j < grid.height; j++) {
    const y = gridY + j * cell + 0.5;
    ctx.moveTo(gridX - axis, y); ctx.lineTo(gridX, y);
    ctx.moveTo(gridX + gw, y); ctx.lineTo(gridX + gw + axis, y);
  }
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = (n: number) => {
    const k = (n % BOARD) + 1;
    const strong = k % 10 === 0;
    ctx.font = `${strong ? 'bold ' : ''}${Math.round(cell * (strong ? 0.36 : 0.3))}px ${FONT}`;
    ctx.fillStyle = strong ? '#1a1a1a' : AXIS_TEXT;
    return String(k);
  };
  for (let i = 0; i < grid.width; i++) {
    const t = label(i), cx = gridX + i * cell + cell / 2;
    ctx.fillText(t, cx, gridY - axis / 2);
    ctx.fillText(t, cx, gridY + gh + axis / 2);
  }
  for (let j = 0; j < grid.height; j++) {
    const t = label(j), cy = gridY + j * cell + cell / 2;
    ctx.fillText(t, gridX - axis / 2, cy);
    ctx.fillText(t, gridX + gw + axis / 2, cy);
  }
  if (!L.band) return;
  ctx.font = `bold ${Math.round(cell * 1.1)}px ${FONT}`;
  ctx.fillStyle = '#1a1a1a';
  for (let c = 0; c * BOARD < grid.width; c++) ctx.fillText(String(c + 1), gridX + (c * BOARD + Math.min(BOARD, grid.width - c * BOARD) / 2) * cell, gridY - axis - L.band / 2);
  for (let r = 0; r * BOARD < grid.height; r++) ctx.fillText(String.fromCharCode(65 + r), gridX - axis - L.band / 2, gridY + (r * BOARD + Math.min(BOARD, grid.height - r * BOARD) / 2) * cell);
}

// 网格线（C2）：细线每格；每块板里每 10 颗一条粗线；板和板之间的接缝更粗；外框。only 给了就只画这些格子四条边上的线
function drawGridLines(ctx: CanvasRenderingContext2D, L: FullLayout, grid: Grid, options: SheetOptions, only?: number[]) {
  const { cell, gridX, gridY } = L;
  const lines = options.lines ?? 'all';
  const thick = Math.max(2, Math.round(cell / 14));
  const style = { thin: [THIN_LINE, 1, 0.5], major: [THICK_LINE, thick, 0], seam: [THICK_LINE, Math.round(cell * 0.3), 0], border: [THICK_LINE, thick, 0] } as const;
  const show = (k: keyof typeof style) => (k === 'thin' ? lines === 'all' : k === 'border' ? true : lines !== 'none');
  // 竖线 i 从第 y0 行画到第 y1 行，横线 j 从第 x0 列画到第 x1 列
  const segs: Record<keyof typeof style, Array<[boolean, number, number, number]>> = { thin: [], major: [], seam: [], border: [] };
  // 细线每条都画（粗线压在上面，边缘和原来一样）。两格共用的边只画一次：缩小时细线不到一个像素，画两遍会变深
  const seen = new Set<number>();
  const add = (vertical: boolean, at: number, n: number, from: number, to: number) => {
    const id = ((vertical ? 1 : 0) * 1024 + at) * 1024 + from;
    if (seen.has(id)) return;
    seen.add(id);
    segs.thin.push([vertical, at, from, to]);
    const k = lineKind(at, n);
    if (k !== 'thin') segs[k].push([vertical, at, from, to]);
  };
  if (!only) {
    for (let i = 0; i <= grid.width; i++) add(true, i, grid.width, 0, grid.height);
    for (let j = 0; j <= grid.height; j++) add(false, j, grid.height, 0, grid.width);
  } else {
    for (const idx of only) {
      const x = idx % grid.width, y = (idx - x) / grid.width;
      for (const i of [x, x + 1]) add(true, i, grid.width, y, y + 1);
      for (const j of [y, y + 1]) add(false, j, grid.height, x, x + 1);
    }
  }
  for (const k of ['thin', 'major', 'seam', 'border'] as const) {
    if (!show(k) || !segs[k].length) continue;
    if (k === 'border' && !only) {
      // 外框整圈画，四个角是满的
      ctx.strokeStyle = THICK_LINE;
      ctx.lineWidth = thick;
      ctx.strokeRect(gridX, gridY, grid.width * cell, grid.height * cell);
      continue;
    }
    const [color, width, off] = style[k];
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const [vertical, at, from, to] of segs[k]) {
      if (vertical) {
        const x = gridX + at * cell + off;
        ctx.moveTo(x, gridY + from * cell); ctx.lineTo(x, gridY + to * cell);
      } else {
        const y = gridY + at * cell + off;
        ctx.moveTo(gridX + from * cell, y); ctx.lineTo(gridX + to * cell, y);
      }
    }
    ctx.stroke();
  }
}

// 色卡（C4、C5）：圆角竖卡片，上半色块 + 色号，下半白底 + 颗数
function drawLegend(ctx: CanvasRenderingContext2D, L: FullLayout, legend: ReturnType<typeof legendOf>) {
  const { cell, pad } = L;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const radius = Math.round(cell * 0.28);
  legend.forEach((item, idx) => {
    const col = idx % L.perRow, row = Math.floor(idx / L.perRow);
    const x = pad + col * (L.cardW + L.gap);
    const y = L.legendTop + row * (L.cardH + L.gap);
    const split = Math.round(L.cardH * 0.55);
    const hex = colorOf(item.code).hex;
    ctx.save();
    roundRect(ctx, x, y, L.cardW, L.cardH, radius);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, L.cardW, L.cardH);
    ctx.fillStyle = hex;
    ctx.fillRect(x, y, L.cardW, split);
    ctx.restore();
    ctx.strokeStyle = '#cfcfcf';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, L.cardW, L.cardH, radius);
    ctx.stroke();
    ctx.fillStyle = textColorOn(hex);
    ctx.font = `bold ${Math.round(cell * 0.56)}px ${FONT}`;
    ctx.fillText(item.code, x + L.cardW / 2, y + split / 2 + 1);
    ctx.fillStyle = '#333333';
    ctx.font = `${Math.round(cell * 0.46)}px ${FONT}`;
    ctx.fillText(String(item.count), x + L.cardW / 2, y + split + (L.cardH - split) / 2 + 1);
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 屏幕坐标 → 格子坐标（编辑器点击用）；不在格子内返回 null */
export function hitCell(grid: Grid, sheetX: number, sheetY: number): [number, number] | null {
  const { cell, gridX, gridY } = sheetLayout(grid);
  const x = Math.floor((sheetX - gridX) / cell), y = Math.floor((sheetY - gridY) / cell);
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height ? [x, y] : null;
}

/** 屏幕坐标 → 第几张色卡；不在色卡上返回 -1 */
export function hitLegend(grid: Grid, sheetX: number, sheetY: number): number {
  const L = sheetLayout(grid);
  const pad = Math.round(L.cell * 0.8);
  const col = Math.floor((sheetX - pad) / (L.cardW + L.gap)), row = Math.floor((sheetY - L.legendTop) / (L.cardH + L.gap));
  if (col < 0 || row < 0 || col >= L.perRow) return -1;
  const inX = (sheetX - pad) % (L.cardW + L.gap) <= L.cardW, inY = (sheetY - L.legendTop) % (L.cardH + L.gap) <= L.cardH;
  const idx = row * L.perRow + col;
  return inX && inY && idx < legendOf(grid).length ? idx : -1;
}
