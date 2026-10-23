// 图纸查看与编辑：拖动 / 选区 / 画笔 / 取色 / 橡皮 / 填充 / 文字，镜像、降噪，撤销重做，色卡替换和删色，导入导出。
// 所有操作都只改格子表格，图纸每次从表格重新画，色卡和颗数自然同步。
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from 'react';
import { textColorOn } from '../core/color';
import { MAX_COLORS, SIZES, boardFor, boardTiles, type SizeId, type StyleId } from '../core/config';
import { commit, copySpot, denoise, fillRect, fitOnBoard, fillRegion, growToFit, mirrorGrid, mirrorRect, outlineGrid, paintCells, redo, reduceColors, replaceColor, undo, type History, type Rect } from '../core/edit';
import { legendOf, type Grid } from '../core/grid';
import { colorOf } from '../core/palette';
import { boardName, hitCell, hitLegend, renderSheet, renderSheetDiff, sheetLayout, sheetLogoReady } from '../render/sheet';
import { Logo } from './Logo';
import { PalettePicker } from './PalettePicker';
import { embedPattern, sheetFileName } from './pngData';
import { makeZip } from './zip';
import { rasterText, textToBitmap } from './text';
import { RefWindow, type CellPoint, type CellRect } from './RefWindow';
import { takeCopiedColor } from './handoff';
import { SizePicker, type Sizing } from './SizePicker';

/** 两格之间直线经过的格子（不含起点） */
function lineCells([x0, y0]: [number, number], [x1, y1]: [number, number]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 1; i <= steps; i++) out.push([Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps)]);
  return out;
}

/** 原图对照：原图里出图的那块（按比例）对应图纸上的哪些格子 */
export interface Reference {
  url: string;
  crop: { x: number; y: number; w: number; h: number };
  box: { left: number; top: number; right: number; bottom: number };
}

export interface Doc {
  grid: Grid;
  mirrored: boolean;
}

type Tool = 'pan' | 'select' | 'brush' | 'picker' | 'eraser' | 'fill' | 'text';

const TOOL_ICON: Record<Tool, ReactElement> = {
  pan: <svg viewBox="0 0 24 24" aria-hidden><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.6 15.6a1.6 1.6 0 0 1 2.4-2.1L8 14.6" /></svg>,
  select: <svg viewBox="0 0 24 24" aria-hidden><path d="M4 7V5a1 1 0 0 1 1-1h2M11 4h2M17 4h2a1 1 0 0 1 1 1v2M20 11v2M20 17v2a1 1 0 0 1-1 1h-2M13 20h-2M7 20H5a1 1 0 0 1-1-1v-2M4 13v-2" /></svg>,
  brush: <svg viewBox="0 0 24 24" aria-hidden><path d="M15.5 4.5l4 4L9 19l-5 1 1-5z" /><path d="M13 7l4 4" /></svg>,
  picker: <svg viewBox="0 0 24 24" aria-hidden><path d="M14.5 6.5l3 3M19.2 4.8a2.1 2.1 0 0 1 0 3L16 11l-3-3 3.2-3.2a2.1 2.1 0 0 1 3 0z" /><path d="M13 8l-8 8v3h3l8-8" /></svg>,
  eraser: <svg viewBox="0 0 24 24" aria-hidden><path d="M8.5 19.5L3.8 14.8a1.6 1.6 0 0 1 0-2.3l8.7-8.7a1.6 1.6 0 0 1 2.3 0l5.4 5.4a1.6 1.6 0 0 1 0 2.3l-8.3 8.3M8.5 19.5H20M7 11l6 6" /></svg>,
  fill: <svg viewBox="0 0 24 24" aria-hidden><path d="M11 3.5l8 8-7 7a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8z" /><path d="M4.5 12h13M20 15.5s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z" /></svg>,
  text: <svg viewBox="0 0 24 24" aria-hidden><path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" /></svg>,
};

// 快捷键照绘图软件（Photoshop / Aseprite）的习惯：H 抓手、M 选框、B 画笔、I 吸管、E 橡皮、G 油漆桶、T 文字
const TOOLS: Array<{ id: Tool; label: string; key: string }> = [
  { id: 'pan', label: '拖动', key: 'H' },
  { id: 'select', label: '选区', key: 'M' },
  { id: 'brush', label: '画笔', key: 'B' },
  { id: 'picker', label: '取色', key: 'I' },
  { id: 'eraser', label: '橡皮', key: 'E' },
  { id: 'fill', label: '填充', key: 'G' },
  { id: 'text', label: '文字', key: 'T' },
];
const TOOL_BY_KEY = new Map(TOOLS.map(t => [t.key.toLowerCase(), t.id]));

const COLLAPSE = <svg viewBox="0 0 24 24" aria-hidden><path d="M4 6h16M10 12h10M4 18h16M7 9.5L4.5 12 7 14.5" /></svg>;

const ICON = {
  undo: <svg viewBox="0 0 24 24" aria-hidden><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>,
  redo: <svg viewBox="0 0 24 24" aria-hidden><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>,
  gridAll: <svg viewBox="0 0 24 24" aria-hidden><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16" /></svg>,
  gridMajor: <svg viewBox="0 0 24 24" aria-hidden><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M12 4v16M4 12h16" /></svg>,
  gridNone: <svg viewBox="0 0 24 24" aria-hidden><rect x="4" y="4" width="16" height="16" rx="1.5" /></svg>,
  gridPreview: <svg viewBox="0 0 24 24" aria-hidden><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></svg>,
  full: <svg viewBox="0 0 24 24" aria-hidden><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /></svg>,
  exitFull: <svg viewBox="0 0 24 24" aria-hidden><path d="M9 4v4a1 1 0 0 1-1 1H4M20 9h-4a1 1 0 0 1-1-1V4M15 20v-4a1 1 0 0 1 1-1h4M4 15h4a1 1 0 0 1 1 1v4" /></svg>,
  outline: <svg viewBox="0 0 24 24" aria-hidden><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><rect x="8.5" y="8.5" width="7" height="7" rx="1" /></svg>,
  grip: <svg viewBox="0 0 24 24" aria-hidden><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></svg>,
  move: <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" /></svg>,
  adjust: <svg viewBox="0 0 24 24" aria-hidden><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>,
  star: <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" /></svg>,
  import: <svg viewBox="0 0 24 24" aria-hidden><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><circle cx="9" cy="9.5" r="1.6" /><path d="M20.5 16l-5-5-9 9" /></svg>,
  export: <svg viewBox="0 0 24 24" aria-hidden><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>,
};

/** 两个格子围成的矩形 */
const rectOf = ([x0, y0]: [number, number], [x1, y1]: [number, number]): Rect => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 });
const inside = (r: Rect, [x, y]: [number, number]) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/**
 * 浮起来的一块：复制出来的、或者正在挪的选区内容。浮着的时候可以随便拖、镜像，底下的图案不受影响；
 * 点「放下」或点到外面才真正贴上去。cut = 挪动时原来的位置（放下时清空），复制时为 null
 */
interface Floating {
  cells: (string | null)[]; // 按 scale 放大之后真正要贴的格子
  w: number;
  h: number;
  x: number;
  y: number;
  cut: Rect | null;
  base: (string | null)[]; // 原始大小的内容；放大从它重算，不会越放越糊
  bw: number;
  bh: number;
  scale: number; // 等比倍数，可以是小数；整数倍时一颗豆正好变成 scale×scale 颗，笔画最整齐
  text?: TextSpec; // 文字浮层：缩放、旋转都按字体重新画，不拿位图硬拉
}
interface TextSpec { value: string; color: string; bold: boolean; flip: boolean; angle: number }

/** 文字浮层：按倍数和角度重新画字，中心点不动 */
function textFloat(t: TextSpec, scale: number, cx: number, cy: number): Floating {
  const rows = rasterText(t.value, { scale, angle: t.angle, bold: t.bold, flip: t.flip });
  const h = Math.max(1, rows.length), w = Math.max(1, rows[0]?.length ?? 1);
  const cells = rows.flat().map(on => (on ? t.color : null));
  return { cells, w, h, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), cut: null, base: cells, bw: w, bh: h, scale, text: t };
}
const floatCenter = (f: Floating): [number, number] => [f.x + f.w / 2, f.y + f.h / 2];
const DEG = Math.PI / 180;
/** 旋转角度：靠近 0°/45°/90°… 4° 以内吸过去；按住 Shift 每 15° 一档 */
function snapAngle(a: number, shift: boolean): number {
  if (shift) return Math.round(a / (15 * DEG)) * 15 * DEG;
  const near = Math.round(a / (45 * DEG)) * 45 * DEG;
  return Math.abs(a - near) < 4 * DEG ? near : a;
}

/** 按倍数等比放大缩小：每个新格子取原图对应位置的那颗（最近邻），不会糊成杂色 */
function buildFloat(base: (string | null)[], bw: number, bh: number, scale: number) {
  const sw = Math.max(1, Math.round(bw * scale)), sh = Math.max(1, Math.round(bh * scale));
  const up: (string | null)[] = new Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const by = Math.min(bh - 1, Math.floor((y * bh) / sh));
    for (let x = 0; x < sw; x++) up[y * sw + x] = base[by * bw + Math.min(bw - 1, Math.floor((x * bw) / sw))];
  }
  return { cells: up, w: sw, h: sh };
}
function makeFloat(base: (string | null)[], bw: number, bh: number, scale: number, x: number, y: number, cut: Rect | null): Floating {
  return { ...buildFloat(base, bw, bh, scale), base, bw, bh, scale, x, y, cut };
}
type Corner = 'tl' | 'tr' | 'bl' | 'br';
/** 换倍数时，对角那个角不动 */
function rescale(f: Floating, scale: number, fixed: Corner): Floating {
  const b = buildFloat(f.base, f.bw, f.bh, scale);
  const x = fixed === 'tl' || fixed === 'bl' ? f.x : f.x + f.w - b.w;
  const y = fixed === 'tl' || fixed === 'tr' ? f.y : f.y + f.h - b.h;
  return { ...f, ...b, scale, x, y };
}
const floatRect = (f: Floating): Rect => ({ x: f.x, y: f.y, w: f.w, h: f.h });

interface Props {
  history: History<Doc>;
  onHistory: (h: History<Doc>) => void;
  style: StyleId;
  fullBoard: boolean;
  /** 在"我的收藏"里是否已收藏；没有 onToggleStar 时不显示按钮 */
  starred?: boolean;
  onToggleStar?: (name?: string) => void;
  onRename?: (name: string) => void;
  /** 图纸名字，存进导出的 PNG，拖回来时还原 */
  name?: string;
  /** 「导入」：换一张图，或导入存过的图纸 PNG */
  onImport?: () => void;
  /** 移除背景开关：有原图时才有（会重新生成） */
  removeBg?: boolean;
  onToggleRemoveBg?: () => void;
  busy?: boolean;
  /** 做豆图页的提示（生成进度、出错、建议）：放在底部浮出的提示条里，不占图纸上方的位置 */
  notice?: ReactNode;
  /** 在做豆图页时才把收藏 / 导入 / 导出放进顶栏 */
  active?: boolean;
  /** 有原图时才能对照 */
  reference?: Reference | null;
  /** 有原图时「颜色数量」才能往右加：base 是刚生成时的色数（滑块正中），rich 是用原图按尽量多的颜色生成的一份（点开时 onOpen 在后台算，算好前为 null） */
  colorRange?: { base: number; rich: Grid | null; onOpen: () => void };
  /** 有原图时才能换尺寸（用原图重新生成） */
  sizing?: { value: Sizing; onChange: (v: Sizing) => void; aspect?: number };
}

export function Editor({ history, onHistory, style, fullBoard, starred = false, onToggleStar, name = '', onRename, onImport, removeBg, onToggleRemoveBg, busy = false, notice = null, active = true, reference = null, colorRange, sizing }: Props) {
  const doc = history.present;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const detailRef = useRef<HTMLCanvasElement>(null); // 大图放大后叠在上面的清晰画布，只画看得见的那一块
  // 网格视图：全部 → 只留每 10 格粗线 → 不显示 → 全部，只改屏幕上的看法，导出照常带完整网格
  // 第四种「预览」：网格和色号都不显示，看整体效果
  const [gridView, setGridView] = useState<'all' | 'major' | 'none' | 'preview'>('all');
  const GRID_NEXT = { all: 'major', major: 'none', none: 'preview', preview: 'all' } as const;
  const GRID_LABEL = { all: '网格：全部', major: '网格：只留每 10 颗粗线', none: '网格：不显示', preview: '预览：网格和色号都不显示' } as const;
  const gridLines = gridView === 'preview' ? 'none' : gridView;
  const showCodes = gridView !== 'preview';

  // 表头标志加载好后重画一次
  const [logoTick, setLogoTick] = useState(0);
  useEffect(() => { void sheetLogoReady().then(() => setLogoTick(1)); }, []);
  const [tool, setToolRaw] = useState<Tool>('pan');
  const lastPaintTool = useRef<Tool>('brush'); // 取完色回到哪个工具
  // 选区：格子坐标；drag 记录正在拖出新选区还是在挪选区
  const [sel, setSel] = useState<Rect | null>(null);
  const selDrag = useRef<{ mode: 'new' | 'float'; start: [number, number]; at: [number, number] } | null>(null);
  const [float, setFloat] = useState<Floating | null>(null);
  const [selDragging, setSelDragging] = useState(false); // 拖的时候先藏起弹出按钮
  const ants = useRef(0); // 蚂蚁线虚线的偏移，定时往前走一点
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  // 用过手写笔（iPad + Pencil）之后：笔负责画，手指只负责拖动和缩放
  const [penMode, setPenMode] = useState(false);
  const setTool = (t: Tool) => {
    if (t === 'brush' || t === 'fill' || t === 'text') lastPaintTool.current = t;
    if (t !== 'select') {
      if (float) placeFloat(float);
      setSel(null);
    }
    setToolRaw(t);
  };
  const [color, setColor] = useState<string>(() => legendOf(doc.grid)[0]?.code ?? 'H7');
  // 从色卡库复制了色号再回到这里：直接拿起画笔、换成那个颜色，并提示一句，点「不用」换回原来的
  const [handoff, setHandoff] = useState<null | { code: string; tool: Tool; color: string }>(null);
  const wasActive = useRef(active);
  useEffect(() => {
    const back = active && !wasActive.current;
    wasActive.current = active;
    if (!back) return;
    const code = takeCopiedColor();
    if (!code || (code === color && tool === 'brush')) return;
    setHandoff({ code, tool, color });
    setColor(code);
    setTool('brush');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => {
    if (!handoff) return;
    const timer = window.setTimeout(() => setHandoff(null), 5000);
    return () => window.clearTimeout(timer);
  }, [handoff]);
  const undoHandoff = () => {
    if (!handoff) return;
    setColor(handoff.color);
    setTool(handoff.tool);
    setHandoff(null);
  };
  const [picker, setPicker] = useState<null | { mode: 'brush' } | { mode: 'textColor' } | { mode: 'outline'; ring: number } | { mode: 'replace'; from: string }>(null);
  const [card, setCard] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [bitmap, setBitmap] = useState<boolean[][]>([]);
  const stroke = useRef<{ grid: Grid; points: Array<[number, number]> } | null>(null);
  const pinching = useRef(false); // 两根手指在缩放：不画、不选
  const justStroked = useRef(false);

  // 查看区：默认整张图纸刚好放进窗口（zoom = 1），放大后在区域内滚动看细节；图纸本身始终按原分辨率画，格子线不会丢
  const viewRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // padX / padY：放大后图纸四周多出来的灰色空间，边缘也能拖到工具栏外面、拖到视野中间来改
  const [fit, setFit] = useState<{ scale: number; w: number; h: number; padX: number; padY: number } | null>(null);
  const natural = useMemo(() => sheetLayout(doc.grid), [doc.grid]);
  // 现在是几号板：按图纸格数算（画到边外豆板会变大），颜色建议、存进 PNG 的尺寸都跟着它
  const board: SizeId = boardFor(doc.grid.width, doc.grid.height) ?? 'large';

  const measureFit = useCallback(() => {
    const box = viewRef.current;
    if (!box) return;
    // 工具栏浮在左边时，图纸左右各让出工具栏的宽度，整张放进来时不被盖住
    const rail = railRef.current;
    const railRoom = rail && getComputedStyle(rail).position === 'absolute' ? (rail.offsetWidth + 16) * 2 : 0;
    const css = getComputedStyle(box); // 手机上底部留了放悬浮按钮的内边距，整张放进来时不算这块
    const bw = box.clientWidth - 2 - railRoom, bh = box.clientHeight - 2 - parseFloat(css.paddingTop || '0') - parseFloat(css.paddingBottom || '0');
    const scale = Math.min(bw / natural.width, bh / natural.height);
    setFit({ scale, w: natural.width * scale, h: natural.height * scale, padX: Math.round(box.clientWidth * 0.35), padY: Math.round(box.clientHeight * 0.35) });
  }, [natural.width, natural.height]);

  useEffect(() => {
    measureFit();
    const box = viewRef.current;
    if (!box) return;
    const ro = new ResizeObserver(measureFit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [measureFit]);

  // 清晰度：画布按「屏幕上显示的大小 × 屏幕清晰度」画，放大后也是锐利的。
  // 整张画布的像素有上限（太大浏览器会卡或画不出来）：大图放大到整张画不清楚时，另叠一块只画看得见那部分的清晰画布，
  // 所以任何尺寸都能放大到一颗豆 64 像素
  const PIXEL_BUDGET = 40e6;
  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 3);
  const maxScale = Math.sqrt(PIXEL_BUDGET / (natural.width * natural.height));
  const maxZoom = fit ? Math.max(1, 2 / fit.scale) : 1;
  // null = 还没量出窗口大小：先不画，量好后直接按合适的清晰度画一次（不先按原尺寸画一遍大图）
  const [renderScale, setRenderScale] = useState<number | null>(null);
  useEffect(() => {
    if (!fit) return;
    const want = Math.min(maxScale, Math.max(0.5, fit.scale * zoom * dpr));
    // 缩放停下来再重画，缩放过程中先拉伸旧的
    const timer = window.setTimeout(() => setRenderScale(r => (r !== null && Math.abs(r - want) / want < 0.05 ? r : want)), renderScale === null ? 0 : 120);
    return () => window.clearTimeout(timer);
  }, [fit, zoom, dpr, maxScale]);
  // 捏合时一帧里会连来好几个缩放事件，页面还没重画：所以每次都从「最新的缩放值 + 还没生效的滚动位置」接着算，
  // 不能用上一次画面上的旧值，否则视野会来回跳、卡在边上。滚动位置等图纸尺寸更新后、画到屏幕前再一次性设上
  const pendingScroll = useRef<[number, number] | null>(null);
  const zoomTo = (next: number, anchor?: [number, number]) => {
    const box = viewRef.current;
    const cur = zoomRef.current;
    const clamped = Math.min(maxZoom, Math.max(1, next));
    if (clamped === cur) return;
    zoomRef.current = clamped;
    if (!box || !fit) return setZoom(clamped);
    // 以鼠标位置（默认中心）为锚点缩放，视野不乱跳
    const ax = anchor ? anchor[0] : box.clientWidth / 2, ay = anchor ? anchor[1] : box.clientHeight / 2;
    const ratio = clamped / cur;
    // 图纸左上角在查看区里的位置：放大后是四周的灰色空间，没放大时是居中留出的空白
    const off = (z: number): [number, number] => (z > 1 ? [fit.padX, fit.padY] : [Math.max(0, (box.clientWidth - fit.w) / 2), Math.max(0, (box.clientHeight - fit.h) / 2)]);
    const [ox0, oy0] = off(cur), [ox1, oy1] = off(clamped);
    const [left, top] = pendingScroll.current ?? [box.scrollLeft, box.scrollTop];
    pendingScroll.current = [(left + ax - ox0) * ratio + ox1 - ax, (top + ay - oy0) * ratio + oy1 - ay];
    setZoom(clamped);
  };
  useLayoutEffect(() => {
    const p = pendingScroll.current, box = viewRef.current;
    pendingScroll.current = null;
    if (p && box) box.scrollTo(p[0], p[1]);
  }, [zoom]);
  // 缩放只作用在查看区，不能让浏览器把整个页面放大：
  // - 触控板捏合 / Ctrl+滚轮：浏览器发的是带 ctrlKey 的 wheel，必须用非 passive 监听才能 preventDefault（React 的 onWheel 是 passive 的）
  // - Safari 还会发 gesture 事件，也要拦
  // - 手机双指：元素上设 touch-action: pan-x pan-y 禁掉浏览器的捏合，再用两个 pointer 的距离自己算
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;
  useEffect(() => {
    const box = viewRef.current;
    if (!box) return;
    // 捏合手指落在工具栏、弹窗或页面其他地方时，也不能让浏览器放大整页（工具栏会跟着放大、看起来卡住），统一缩放图纸
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = box.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      zoomToRef.current(zoomRef.current * Math.exp(-e.deltaY * 0.01), inside ? [e.clientX - rect.left, e.clientY - rect.top] : undefined);
    };
    let gestureStartZoom = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStartZoom = zoomRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const scale = (e as unknown as { scale: number }).scale;
      zoomToRef.current(gestureStartZoom * scale);
    };
    const pointers = new Map<number, [number, number]>();
    let pinchStart: { dist: number; zoom: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: zoomRef.current };
        // 第二根手指按下：这次整个手势都算缩放，到手指全部抬起前不画；第一根手指已经预览上去的豆子擦掉
        pinching.current = true;
        stroke.current = null;
        redrawRef.current();
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2 && pinchStart) {
        e.preventDefault();
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const rect = box.getBoundingClientRect();
        zoomToRef.current(pinchStart.zoom * (dist / pinchStart.dist), [(a[0] + b[0]) / 2 - rect.left, (a[1] + b[1]) / 2 - rect.top]);
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (!pointers.size) window.setTimeout(() => { pinching.current = false; }, 0); // 等这次抬手的事件都处理完再恢复
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('gesturestart', onGestureStart);
    window.addEventListener('gesturechange', onGestureChange);
    box.addEventListener('pointerdown', onDown, true);
    box.addEventListener('pointermove', onMove, true);
    box.addEventListener('pointerup', onUp, true);
    box.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('gesturestart', onGestureStart);
      window.removeEventListener('gesturechange', onGestureChange);
      box.removeEventListener('pointerdown', onDown, true);
      box.removeEventListener('pointermove', onMove, true);
      box.removeEventListener('pointerup', onUp, true);
      box.removeEventListener('pointercancel', onUp, true);
    };
  }, []);
  const sheetStyle = fit ? { width: fit.w * zoom, height: fit.h * zoom } : undefined;

  // 清晰画布画的是哪一块（版式坐标）：看得见的范围四周多留 30%，滚动、缩放时超出了才换一块重画
  const [detail, setDetail] = useState<{ x: number; y: number; w: number; h: number; zoom: number } | null>(null);
  const updateDetail = useCallback(() => {
    const view = viewRef.current, canvas = canvasRef.current, z = zoomRef.current;
    if (!fit || !view || !canvas || fit.scale * z * dpr <= maxScale * 1.02) return setDetail(null);
    const c = canvas.getBoundingClientRect(), v = view.getBoundingClientRect();
    const k = c.width / natural.width;
    if (!k) return;
    const vx0 = (Math.max(v.left, c.left) - c.left) / k, vx1 = (Math.min(v.right, c.right) - c.left) / k;
    const vy0 = (Math.max(v.top, c.top) - c.top) / k, vy1 = (Math.min(v.bottom, c.bottom) - c.top) / k;
    if (vx1 <= vx0 || vy1 <= vy0) return;
    setDetail(d => {
      if (d && d.zoom === z && d.x <= vx0 && d.y <= vy0 && d.x + d.w >= vx1 && d.y + d.h >= vy1) return d;
      const mx = (vx1 - vx0) * 0.3, my = (vy1 - vy0) * 0.3;
      const x = Math.max(0, vx0 - mx), y = Math.max(0, vy0 - my);
      return { x, y, w: Math.min(natural.width, vx1 + mx) - x, h: Math.min(natural.height, vy1 + my) - y, zoom: z };
    });
  }, [fit, natural, dpr, maxScale]);
  useEffect(() => {
    const id = requestAnimationFrame(updateDetail);
    return () => cancelAnimationFrame(id);
  }, [zoom, updateDetail]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateDetail);
    };
    view.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      view.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [updateDetail]);
  const detailK = fit ? fit.scale * zoom : 0; // 屏幕上一个版式单位多宽
  const detailStyle = detail && detail.zoom === zoom
    ? { left: detail.x * detailK, top: detail.y * detailK, width: detail.w * detailK, height: detail.h * detailK }
    : { display: 'none' };

  // 全屏：图纸区铺满屏幕、整张放进来；再点一次或按 Esc 退出。浏览器不支持真全屏时就铺满窗口
  const [full, setFull] = useState(false);
  const enterFull = () => {
    setFull(true);
    setZoom(1);
    document.documentElement.requestFullscreen?.().catch(() => { /* 不支持就只铺满窗口 */ });
  };
  const exitFull = () => {
    setFull(false);
    setZoom(1);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) { setFull(false); setZoom(1); } }; // 浏览器自己按 Esc 退出的
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => {
    document.body.style.overflow = full ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [full]);
  const fullRef = useRef(full);
  fullRef.current = full;

  // 缩放数字：点一下可以直接输入比例，鼠标停在上面滚动也能缩放
  const [zoomText, setZoomText] = useState<string | null>(null);
  const commitZoomText = () => {
    const n = parseFloat(zoomText ?? '');
    if (fit && Number.isFinite(n) && n > 0) zoomTo(n / 100 / fit.scale);
    setZoomText(null);
  };
  const zoomBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = zoomBoxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return; // 捏合由上面的整页监听处理，这里再缩一次就重复了
      e.preventDefault();
      zoomToRef.current(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const zoomPercent = fit ? Math.round(fit.scale * zoom * 100) : 100;

  const legend = useMemo(() => legendOf(doc.grid), [doc.grid]);

  // 看颜色：点色号清单里的一行，图纸上只亮这个颜色、其他变淡，色块外面加一圈黑边；再点一次恢复
  const [focus, setFocus] = useState<string | null>(null);
  // 色号清单可以收起成一列色块，把位置让给图纸；记在浏览器里
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('bead-list-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed(c => {
      try {
        localStorage.setItem('bead-list-collapsed', c ? '0' : '1');
      } catch { /* 存不下就只在本次有效 */ }
      return !c;
    });
  };
  // 色号被替换掉之后，正在看的颜色可能已经不在图里了
  useEffect(() => {
    if (focus && !legend.some(l => l.code === focus)) setFocus(null);
  }, [legend, focus]);
  // 清单里选中的颜色就是画笔颜色（只有一个「当前颜色」）。变淡只在「看 / 清理」的工具里用：
  // 拖动、选区、取色、橡皮时点颜色 = 只看这一色；画笔、填充时点颜色 = 换画笔颜色，不变淡，看得到整张图才好画
  const painting = tool === 'brush' || tool === 'fill';
  const dim = useMemo(() => (focus && !painting ? new Set(legend.map(l => l.code).filter(c => c !== focus)) : undefined), [focus, legend, painting]);
  const pickFromList = (code: string) => {
    setColor(code);
    if (painting) setFocus(code); // 记住选中的是哪个，切回拖动时接着只看这一色
    else setFocus(f => (f === code ? null : code));
  };
  const listSelected = painting ? color : focus;

  // 表格一变、看法一变、缩放停下来，就按当前需要的清晰度重画图纸。
  // 只是改了几颗豆（看法没变）：只重画改过的格子和实时预览涂过的格子，大图不用整张重画
  const drawn = useRef<{ grid: Grid; key: unknown[] } | null>(null);
  const detailDrawn = useRef<{ grid: Grid; key: unknown[] } | null>(null);
  const liveCells = useRef(new Set<number>());
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || renderScale === null) return;
    const options = { mirrored: doc.mirrored, dim, lines: gridLines, codes: showCodes, scale: renderScale, title: name };
    const key = [doc.mirrored, dim, gridLines, showCodes, renderScale, name, logoTick];
    const draw = (target: HTMLCanvasElement, opts: typeof options & { region?: NonNullable<typeof detail> }, k: unknown[], memo: typeof drawn) => {
      const prev = memo.current;
      const same = prev && prev.key.length === k.length && prev.key.every((v, i) => v === k[i]);
      if (!same || !renderSheetDiff(prev.grid, doc.grid, opts, target, liveCells.current)) renderSheet(doc.grid, opts, target);
      memo.current = { grid: doc.grid, key: k };
    };
    draw(canvas, options, key, drawn);
    // 清晰画布：只画看得见的那一块，按放大后的清晰度
    const dc = detailRef.current;
    if (dc && detail && fit) draw(dc, { ...options, scale: fit.scale * detail.zoom * dpr, region: detail }, [...key, detail], detailDrawn);
    else detailDrawn.current = null;
    liveCells.current.clear();
  }, [doc, dim, gridLines, showCodes, logoTick, renderScale, name, detail, fit, dpr]);
  useEffect(redraw, [redraw]);
  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;

  useEffect(() => {
    let alive = true;
    if (!text.trim()) {
      setBitmap([]);
      return;
    }
    textToBitmap(text.trim()).then(b => alive && setBitmap(b));
    return () => {
      alive = false;
    };
  }, [text]);

  const apply = useCallback((grid: Grid, mirrored = doc.mirrored) => {
    if (grid === doc.grid && mirrored === doc.mirrored) return;
    onHistory(commit(history, { grid, mirrored }));
  }, [doc, history, onHistory]);

  // 屏幕坐标 → 图纸版式坐标（和画布实际像素无关，画布清晰度变了也不影响点哪格）
  // 事件挂在整个看图区上（画笔能画到图纸外的灰色区域），坐标一律按图纸画布的位置换算
  const toSheet = (e: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>): [number, number] => {
    const el = (canvasRef.current ?? e.currentTarget).getBoundingClientRect();
    return [((e.clientX - el.left) * natural.width) / el.width, ((e.clientY - el.top) * natural.height) / el.height];
  };

  const paintLive = (x: number, y: number, code: string | null) => {
    if (x < 0 || y < 0 || x >= doc.grid.width || y >= doc.grid.height) return; // 画到板外的先不预览，松手后豆板扩大再画上
    const L = sheetLayout(doc.grid);
    const px = L.gridX + x * L.cell, py = L.gridY + y * L.cell;
    liveCells.current.add(y * doc.grid.width + x);
    // 两块画布都画（清晰画布开着时盖在上面）；画布上一次画图纸时设好的缩放和位移还在，直接按版式坐标画
    for (const canvas of [canvasRef.current, detail ? detailRef.current : null]) {
      if (!canvas) continue;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = code ? colorOf(code).hex : '#ffffff';
      if (gridLines === 'all') ctx.fillRect(px + 2, py + 2, L.cell - 3, L.cell - 3); // 留出网格线，实时预览不盖住线
      else ctx.fillRect(px, py, L.cell, L.cell);
      if (code && showCodes) {
        ctx.fillStyle = textColorOn(colorOf(code).hex);
        ctx.font = `bold ${Math.round(L.cell * 0.34)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(code, px + L.cell / 2, py + L.cell / 2 + 1);
      }
    }
  };

  // 文字的粗细：只用一种开源像素字体，粗体 = 每一笔往右加厚一颗豆（字和字之间的空隙不会被填上）
  const [textColor, setTextColor] = useState('H7'); // 文字有自己的颜色，默认黑色，不跟着画笔（画笔常是背景色，放上去会看不见）
  const [textBold, setTextBold] = useState(false);
  // 镜像版里加的文字也要镜像，熨烫翻面后文字方向才是对的
  // bitmap 有内容说明字体已加载好，粗细、镜像都按放上去时的样子重画一遍，格数提示才准
  const placedBitmap = useMemo(
    () => (bitmap.length ? rasterText(text.trim(), { scale: 1, angle: 0, bold: textBold, flip: doc.mirrored }) : bitmap),
    [bitmap, text, textBold, doc.mirrored],
  );
  const textSize = placedBitmap.length ? { w: placedBitmap[0].length, h: placedBitmap.length } : null;

  // 文字放上去先浮在图纸中间（和复制出来的一样），拖角放大、拖十字移动，再「放下」
  const placeText = async () => {
    const value = text.trim();
    if (!value) return;
    // 打完字马上回车：字体或位图还没准备好，等它好了再放
    if (!placedBitmap.length && !(await textToBitmap(value)).length) return;
    setTool('select');
    setFloat(textFloat({ value, color: textColor, bold: textBold, flip: doc.mirrored, angle: 0 }, 1, doc.grid.width / 2, doc.grid.height / 2));
  };

  // 不限在板内的格子坐标：画笔画到豆板边外时用（松手后豆板四边等量扩大）
  const rawCell = (sx: number, sy: number): [number, number] => [Math.floor((sx - natural.gridX) / natural.cell), Math.floor((sy - natural.gridY) / natural.cell)];
  // 画到边外、豆板扩大后，提示一下现在是几号板
  const [growNote, setGrowNote] = useState<string | null>(null);
  useEffect(() => {
    if (!growNote) return;
    const t = window.setTimeout(() => setGrowNote(null), 4000);
    return () => window.clearTimeout(t);
  }, [growNote]);
  const noteGrow = (g: Grid) => {
    const s = boardFor(g.width, g.height);
    const t = boardTiles(g.width, g.height);
    setGrowNote(s ? `豆板扩大到 ${SIZES[s].label}` : `需要 ${t.cols * t.rows} 块 104×104 豆板`);
  };

  // 点击（色卡、填充、文字）用 click：手机上 pointerdown 打开弹窗后，紧接着的 click 会落到遮罩上把弹窗关掉
  const onClick = (e: ReactMouseEvent<HTMLElement>) => {
    // 画笔拖完松手时浏览器还会补一个 click，不能当成点了色卡
    if (justStroked.current) {
      justStroked.current = false;
      return;
    }
    const [sx, sy] = toSheet(e);
    const cardIdx = hitLegend(doc.grid, sx, sy);
    if (cardIdx >= 0) {
      setCard(legend[cardIdx].code);
      return;
    }
    const cell = hitCell(doc.grid, sx, sy);
    if (!cell) return;
    const [x, y] = cell;
    if (tool === 'picker') {
      const code = doc.grid.cells[y * doc.grid.width + x];
      if (!code) return; // 空格没有颜色可取
      setColor(code);
      setTool(lastPaintTool.current); // 取完回到原来的工具，工具栏的颜色块已经换了，不用再提示
      return;
    }
    if (tool === 'fill') apply(fillRegion(doc.grid, x, y, color));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (pinching.current) return;
    justStroked.current = false;
    if (e.pointerType === 'pen' && !penMode) setPenMode(true);
    if (tool === 'pan') {
      // 鼠标按住拖动图纸；手指在手机上本来就能滑动，不用管
      const box = viewRef.current;
      if (e.pointerType !== 'mouse' || !box) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      pan.current = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop };
      return;
    }
    if (penMode && e.pointerType === 'touch') return; // 手写笔模式：手指不画
    if (tool === 'select') {
      const cell = hitCell(doc.grid, ...toSheet(e));
      if (!cell) return;
      let mode: 'new' | 'float' = 'new';
      // 浮着的那块（文字、复制出来的）只有点「放下」/ 回车 / 换工具才贴进图纸；点到外面不动它
      if (float && !inside(floatRect(float), cell)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      if (float) mode = 'float';
      else if (sel && inside(sel, cell)) {
        setFloat(lift(sel, sel)); // 按住选区拖：把内容浮起来再挪
        mode = 'float';
      }
      selDrag.current = { mode, start: cell, at: cell };
      setSelDragging(true);
      drawOverlay();
      return;
    }
    if (tool !== 'brush' && tool !== 'eraser') return;
    const [sx, sy] = toSheet(e);
    // 画笔可以从豆板外面落笔（点在色卡上除外）；橡皮只擦板内
    const cell = hitCell(doc.grid, sx, sy) ?? (tool === 'brush' && hitLegend(doc.grid, sx, sy) < 0 ? rawCell(sx, sy) : null);
    if (!cell) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    stroke.current = { grid: doc.grid, points: [cell] };
    paintLive(cell[0], cell[1], tool === 'brush' ? color : null);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (pinching.current) return;
    if (refCursor.current) {
      const [sx, sy] = toSheet(e);
      refCursor.current([(sx - natural.gridX) / natural.cell, (sy - natural.gridY) / natural.cell]);
    }
    if (pan.current && viewRef.current) {
      viewRef.current.scrollTo(pan.current.left - (e.clientX - pan.current.x), pan.current.top - (e.clientY - pan.current.y));
      return;
    }
    const cell = hitCell(doc.grid, ...toSheet(e));
    if (selDrag.current) {
      if (cell) selDrag.current.at = cell;
      drawOverlay();
      return;
    }
    drawOverlay();
    const at = stroke.current && tool === 'brush' ? rawCell(...toSheet(e)) : cell;
    if (!stroke.current || !at) return;
    const last = stroke.current.points[stroke.current.points.length - 1];
    if (last[0] === at[0] && last[1] === at[1]) return;
    // 快速拖动时两次事件之间会跳过好几格，按直线补上中间的格子
    for (const p of lineCells(last, at)) {
      stroke.current.points.push(p);
      paintLive(p[0], p[1], tool === 'brush' ? color : null);
    }
  };

  // 松手、被系统打断（来电、手势切换）都要结束这一笔，不然画布一直抓着指针，后面的点击全落不到按钮上
  const onPointerUp = (e?: ReactPointerEvent<HTMLElement>) => {
    if (pinching.current) return;
    if (e && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (pan.current) {
      // 拖过的话松手不能当成点击（点到色卡会弹窗）
      if (e && Math.hypot(e.clientX - pan.current.x, e.clientY - pan.current.y) > 4) justStroked.current = true;
      pan.current = null;
      return;
    }
    const drag = selDrag.current;
    if (drag) {
      selDrag.current = null;
      setSelDragging(false);
      justStroked.current = true;
      const [dx, dy] = [drag.at[0] - drag.start[0], drag.at[1] - drag.start[1]];
      if (drag.mode === 'float') {
        setFloat(f => (f ? { ...f, x: f.x + dx, y: f.y + dy } : f));
      } else {
        // 只点了一下没拖：取消选区
        setSel(dx || dy ? rectOf(drag.start, drag.at) : null);
      }
      return;
    }
    if (!stroke.current) return;
    const { grid, points } = stroke.current;
    stroke.current = null;
    justStroked.current = true;
    if (tool === 'brush') {
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      const grown = growToFit(grid, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
      if (grown) {
        apply(paintCells(grown.grid, points.map(([x, y]) => [x + grown.dx, y + grown.dy] as [number, number]), color));
        noteGrow(grown.grid);
        return;
      }
    }
    const next = paintCells(grid, points, tool === 'brush' ? color : null);
    // 什么都没改（比如橡皮擦在空格上）时表格不变、不会触发重画，要手动把被实时预览盖住的网格线画回来
    if (next === grid) redraw();
    else apply(next);
  };

  // 把选区里的内容拿起来（不改图纸）
  const lift = (r: Rect, cut: Rect | null): Floating => {
    const cells: (string | null)[] = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.push(doc.grid.cells[y * doc.grid.width + x]);
    return makeFloat(cells, r.w, r.h, 1, r.x, r.y, cut);
  };
  // 放下：挪动的先清空原位置，再把浮着的内容贴上（空格不盖住底下的豆子）
  const placeFloat = (f: Floating) => {
    let base = f.cut ? fillRect(doc.grid, f.cut, null) : doc.grid;
    // 文字、挪动的那块伸出豆板时，豆板四边等量扩大再贴（尺寸规则）
    let ox = 0, oy = 0;
    {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (f.cells[y * f.w + x]) {
        x0 = Math.min(x0, f.x + x); x1 = Math.max(x1, f.x + x); y0 = Math.min(y0, f.y + y); y1 = Math.max(y1, f.y + y);
      }
      const grown = x1 >= x0 ? growToFit(base, x0, y0, x1, y1) : null;
      if (grown) { base = grown.grid; ox = grown.dx; oy = grown.dy; noteGrow(base); }
    }
    const W = base.width, H = base.height;
    const cells = base.cells.slice();
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const code = f.cells[y * f.w + x];
        const nx = f.x + x + ox, ny = f.y + y + oy;
        if (code && nx >= 0 && ny >= 0 && nx < W && ny < H) cells[ny * W + nx] = code;
      }
    }
    // 贴好就不再留蚂蚁线：蚂蚁线表示还浮着、可以挪，贴进图纸后不该再让人以为能单独拖
    setFloat(null);
    setSel(null);
    if (W !== doc.grid.width || cells.some((c, i) => c !== doc.grid.cells[i])) apply({ width: W, height: H, cells });
  };
  const cancelFloat = () => {
    if (float?.cut) setSel(float.cut);
    setFloat(null);
  };
  const mirrorFloat = () => setFloat(f => f && (f.text ? textFloat({ ...f.text, flip: !f.text.flip }, f.scale, ...floatCenter(f)) : makeFloat(f.base.map((_, i) => f.base[Math.floor(i / f.bw) * f.bw + (f.bw - 1 - (i % f.bw))]), f.bw, f.bh, f.scale, f.x, f.y, f.cut)));

  // 四个角拖动 = 按整数倍等比放大缩小（对角不动），中间十字拖动 = 移动
  // 文字浮层：四个角绕中心等比缩放（按字体重画，最小就是原始大小），上面的圆点拖动旋转
  const handleDrag = useRef<null | { mode: 'scale'; fixed: Corner; fx: number; fy: number } | { mode: 'move'; sx: number; sy: number; x0: number; y0: number }
    | { mode: 'textScale'; cx: number; cy: number; s0: number; d0: number } | { mode: 'rotate'; cx: number; cy: number; a0: number; p0: number }>(null);
  const [handleDragging, setHandleDragging] = useState(false);
  const cellAt = (clientX: number, clientY: number): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [((clientX - r.left) * natural.width / r.width - natural.gridX) / natural.cell, ((clientY - r.top) * natural.height / r.height - natural.gridY) / natural.cell];
  };
  const onHandleDown = (e: ReactPointerEvent<HTMLElement>, corner: Corner | 'move' | 'rotate') => {
    if (!float) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setHandleDragging(true);
    const [px, py] = cellAt(e.clientX, e.clientY);
    if (corner === 'move') {
      handleDrag.current = { mode: 'move', sx: px, sy: py, x0: float.x, y0: float.y };
      return;
    }
    if (float.text) {
      const [cx, cy] = floatCenter(float);
      handleDrag.current = corner === 'rotate'
        ? { mode: 'rotate', cx, cy, a0: float.text.angle, p0: Math.atan2(py - cy, px - cx) }
        : { mode: 'textScale', cx, cy, s0: float.scale, d0: Math.max(0.5, Math.hypot(px - cx, py - cy)) };
      return;
    }
    if (corner === 'rotate') return;
    const fixed: Corner = ({ tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' } as const)[corner];
    handleDrag.current = { mode: 'scale', fixed, fx: fixed === 'tl' || fixed === 'bl' ? float.x : float.x + float.w, fy: fixed === 'tl' || fixed === 'tr' ? float.y : float.y + float.h };
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = handleDrag.current;
    if (!d || !float) return;
    const [cx, cy] = cellAt(e.clientX, e.clientY);
    if (d.mode === 'move') {
      const x = d.x0 + Math.round(cx - d.sx), y = d.y0 + Math.round(cy - d.sy);
      if (x !== float.x || y !== float.y) setFloat({ ...float, x, y });
      return;
    }
    if (d.mode === 'rotate' && float.text) {
      const raw = d.a0 + Math.atan2(cy - d.cy, cx - d.cx) - d.p0;
      const angle = snapAngle(Math.atan2(Math.sin(raw), Math.cos(raw)), e.shiftKey);
      if (Math.abs(angle - float.text.angle) > 0.2 * DEG) setFloat(textFloat({ ...float.text, angle }, float.scale, d.cx, d.cy));
      return;
    }
    if (d.mode === 'textScale' && float.text) {
      // 拖离中心越远越大；最小是字体原始大小（汉字 12 格高），再小笔画会糊；最大到豆板的两倍
      const most = Math.max(1, Math.min((doc.grid.width * 2) / (float.w / float.scale), (doc.grid.height * 2) / (float.h / float.scale)));
      const want = (d.s0 * Math.hypot(cx - d.cx, cy - d.cy)) / d.d0;
      const snap = Math.round(want);
      const scale = Math.min(most, Math.max(1, Math.abs(want - snap) < 0.08 ? snap : want));
      if (Math.abs(scale - float.scale) > 0.01) {
        const next = textFloat(float.text, scale, d.cx, d.cy);
        if (next.w !== float.w || next.h !== float.h) setFloat(next);
      }
      return;
    }
    if (d.mode !== 'scale') return;
    // 等比缩放：按拖到的位置算倍数，离整数倍不到 2 格时吸附过去（整数倍笔画最整齐）；最小 1 格，最大到豆板的两倍
    const want = Math.max(Math.abs(cx - d.fx) / float.bw, Math.abs(cy - d.fy) / float.bh);
    const snap = Math.round(want);
    const least = Math.max(1 / float.bw, 1 / float.bh);
    const most = Math.max(1, Math.min((doc.grid.width * 2) / float.bw, (doc.grid.height * 2) / float.bh));
    const scale = Math.min(most, Math.max(least, snap >= 1 && Math.abs(want - snap) * Math.max(float.bw, float.bh) < 2 ? snap : want));
    const next = rescale(float, scale, d.fixed);
    if (next.w !== float.w || next.h !== float.h) setFloat(next);
  };
  const onHandleUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    handleDrag.current = null;
    setHandleDragging(false);
  };

  // 叠在图纸上的一层：文字虚影、选区虚线框（挪动时连内容一起跟着走）
  const drawOverlay = () => {
    const overlay = overlayRef.current, canvas = canvasRef.current;
    if (!overlay || !canvas) return;
    if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
      overlay.width = canvas.width;
      overlay.height = canvas.height;
    }
    const ctx = overlay.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.setTransform(overlay.width / natural.width, 0, 0, overlay.height / natural.height, 0, 0);
    const L = sheetLayout(doc.grid);
    const drag = selDrag.current;
    let box = float ? null : sel;
    if (drag?.mode === 'new') box = rectOf(drag.start, drag.at);
    if (float) {
      const [dx, dy] = drag?.mode === 'float' ? [drag.at[0] - drag.start[0], drag.at[1] - drag.start[1]] : [0, 0];
      const fx = float.x + dx, fy = float.y + dy;
      if (drag?.mode !== 'new') box = { x: fx, y: fy, w: float.w, h: float.h };
      // 挪动时原来的位置先盖白（放下时才真正清空）
      if (float.cut) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(L.gridX + float.cut.x * L.cell, L.gridY + float.cut.y * L.cell, float.cut.w * L.cell, float.cut.h * L.cell);
      }
      // 浮着的内容：带一点阴影，看得出是在图纸上面
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
      ctx.shadowBlur = L.cell * 0.4;
      ctx.font = `bold ${Math.round(L.cell * 0.34)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let y = 0; y < float.h; y++) {
        for (let x = 0; x < float.w; x++) {
          const code = float.cells[y * float.w + x];
          const nx = fx + x, ny = fy + y;
          if (!code || nx < 0 || ny < 0 || nx >= doc.grid.width || ny >= doc.grid.height) continue;
          const px = L.gridX + nx * L.cell, py = L.gridY + ny * L.cell;
          ctx.fillStyle = colorOf(code).hex;
          ctx.fillRect(px, py, L.cell, L.cell);
          ctx.shadowBlur = 0;
          ctx.fillStyle = textColorOn(colorOf(code).hex);
          ctx.fillText(code, px + L.cell / 2, py + L.cell / 2 + 1);
          ctx.shadowBlur = L.cell * 0.4;
        }
      }
      ctx.restore();
    }
    if (box) {
      // 蚂蚁线：白色实线打底，上面黑色虚线，虚线一直往前走
      const [bx, by, bw, bh] = [L.gridX + box.x * L.cell, L.gridY + box.y * L.cell, box.w * L.cell, box.h * L.cell];
      // 线宽、虚线长度按屏幕像素算：图纸缩得再小，蚂蚁线看起来都一样粗
      const px = natural.width / Math.max(1, canvas.getBoundingClientRect().width || overlay.getBoundingClientRect().width);
      ctx.save();
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.lineDashOffset = -ants.current * px * 0.5;
      ctx.strokeStyle = '#0a0a0a';
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();
    }
  };

  useEffect(() => drawOverlay());
  useEffect(() => setFloat(null), [doc.grid.width, doc.grid.height]);
  const drawOverlayRef = useRef(drawOverlay);
  drawOverlayRef.current = drawOverlay;
  useEffect(() => {
    if ((!sel && !float) || tool !== 'select' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      ants.current = (ants.current + 2) % 16;
      if (!selDrag.current) drawOverlayRef.current();
    }, 90);
    return () => window.clearInterval(timer);
  }, [sel, float, tool]);

  // 键盘：⌘Z / Ctrl+Z 撤销，⇧⌘Z / Ctrl+Y 重做，Esc 关闭弹窗；在输入框里时交给输入框自己处理
  const historyRef = useRef(history);
  historyRef.current = history;
  const selRef = useRef(sel);
  selRef.current = sel;
  const exitFullRef = useRef(exitFull);
  exitFullRef.current = exitFull;
  const setToolRef = useRef(setTool);
  setToolRef.current = setTool;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const tempTool = useRef<null | { key: string; back: Tool }>(null); // 按住空格 / Alt 临时换的工具，松开换回
  const toggleFullRef = useRef(() => {});
  toggleFullRef.current = () => (full ? exitFull() : enterFull());
  const activeRef = useRef(active);
  activeRef.current = active;
  const floatRef = useRef(float);
  floatRef.current = float;
  const clearSelRef = useRef(() => {});
  clearSelRef.current = () => {
    if (float) {
      if (float.cut) apply(fillRect(doc.grid, float.cut, null)); // 挪到一半按删除：原来那块删掉
      setFloat(null);
      setSel(null);
      return;
    }
    if (sel) apply(fillRect(doc.grid, sel, null));
  };
  const floatKeyRef = useRef<(key: string) => boolean>(() => false);
  floatKeyRef.current = key => {
    if (!float) return false;
    if (key === 'Escape') cancelFloat();
    else if (key === 'Enter') placeFloat(float);
    else return false;
    return true;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return; // 在别的页面（图纸库、色卡库）按键不动这里的图纸
      if ((e.key === 'Escape' || e.key === 'Enter') && floatKeyRef.current(e.key)) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        setCard(null);
        setPicker(null);
        setSel(null);
        if (fullRef.current && !document.fullscreenElement) exitFullRef.current(); // 只铺满窗口时，Esc 也退出
        return;
      }
      // 只在可输入文字的地方把撤销交给浏览器；单选框、复选框上照常撤销图纸
      const target = e.target as HTMLElement | null;
      const typing = target instanceof HTMLTextAreaElement || target?.isContentEditable
        || (target instanceof HTMLInputElement && !['radio', 'checkbox', 'button', 'file', 'range'].includes(target.type));
      if (typing) return;
      // 工具快捷键（不带 ⌘ / Ctrl / Alt 的单个字母）
      const toolKey = !e.metaKey && !e.ctrlKey && !e.altKey ? TOOL_BY_KEY.get(e.key.toLowerCase()) : undefined;
      if (toolKey) {
        e.preventDefault();
        tempTool.current = null; // 按住空格 / Alt 时又按了别的工具：以新按的为准，松开不再换回
        setToolRef.current(toolKey);
        return;
      }
      // 按住空格：临时拖动；按住 ⌥ / Alt（画笔、填充时）：临时取色。松开回到原来的工具，不放下浮着的内容
      if (e.key === ' ' || e.key === 'Alt') {
        if (e.key === ' ') e.preventDefault();
        if (e.repeat || tempTool.current) return;
        const now = toolRef.current;
        const to: Tool | null = e.key === ' ' ? (now !== 'pan' ? 'pan' : null) : now === 'brush' || now === 'fill' ? 'picker' : null;
        if (!to) return;
        if (e.key === 'Alt') e.preventDefault();
        tempTool.current = { key: e.key, back: now };
        setToolRaw(to);
        return;
      }
      // F：进入 / 退出全屏（和看视频、看图软件的习惯一样）
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleFullRef.current();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selRef.current || floatRef.current)) {
        e.preventDefault();
        clearSelRef.current();
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      e.preventDefault();
      const next = key === 'y' || e.shiftKey ? redo(historyRef.current) : undo(historyRef.current);
      historyRef.current = next;
      onHistory(next);
    };
    const endTemp = (e?: KeyboardEvent) => {
      const t = tempTool.current;
      if (!t || (e && e.key !== t.key)) return;
      tempTool.current = null;
      setToolRaw(t.back);
    };
    const onBlur = () => endTemp();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', endTemp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', endTemp);
      window.removeEventListener('blur', onBlur);
    };
  }, [onHistory]);

  // 保存：另画一张不带拼豆模式淡化的图纸，并把格子表格写进 PNG，以后拖回来能继续编辑
  // 导出：另画一张不带拼豆模式淡化、网格完整的图纸，并把格子表格写进 PNG，以后拖回来能继续编辑
  // 导出清晰度：每格 48～72 像素，看图软件里放大也清楚；104 板用 1.5 倍，更大的用 1 倍（每格 32 像素），免得导出等太久
  const EXPORT_SCALE = (w: number) => (w > 104 ? 1 : w > 80 ? 1.5 : 2);
  const [exporting, setExporting] = useState(false);
  const toBlob = (c: HTMLCanvasElement) => new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/png'));
  const download = (blob: Blob, fileName: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  // 超过一块 104 板：打成一个压缩包，一张总览（能拖回来接着改）+ 每块板一张（只画这块板，色号和颗数也只算这块），拼一块看一张
  const exportBoards = async (data: Parameters<typeof embedPattern>[1]) => {
    const { grid, mirrored } = doc;
    const L = sheetLayout(grid);
    const s = Math.min(1, Math.sqrt(40e6 / (L.width * L.height))); // 总览太大浏览器画不出来，按总像素缩小；缩到色号看不清就不写色号
    const overview = await toBlob(renderSheet(grid, { mirrored, scale: s, codes: s >= 0.75, title: name }));
    if (!overview) return;
    const files = [{ name: '总览.png', data: new Uint8Array(await (await embedPattern(overview, data)).arrayBuffer()) }];
    const B = SIZES.large.board, { cols, rows } = boardTiles(grid.width, grid.height);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const part: Grid = { width: B, height: B, cells: new Array(B * B).fill(null) };
      for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) part.cells[y * B + x] = grid.cells[(r * B + y) * grid.width + c * B + x] ?? null;
      if (!part.cells.some(Boolean)) continue; // 空板不用拼
      const id = boardName(r, c);
      const blob = await toBlob(renderSheet(part, { mirrored, scale: EXPORT_SCALE(B), title: name.trim() ? `${name.trim()} · ${id}` : id }));
      if (blob) files.push({ name: `${id}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    download(makeZip(files), sheetFileName(name, mirrored).replace(/\.png$/, '.zip'));
  };
  const save = () => {
    if (exporting) return;
    setExporting(true);
    const data = { name: name.trim() || '未命名', size: board, style, fullBoard, mirrored: doc.mirrored, grid: doc.grid };
    // 让「正在下载」先显示出来再开始画（大图要一两秒）
    window.setTimeout(async () => {
      try {
        if (!boardFor(doc.grid.width, doc.grid.height)) return await exportBoards(data);
        const blob = await toBlob(renderSheet(doc.grid, { mirrored: doc.mirrored, scale: EXPORT_SCALE(doc.grid.width), title: name }));
        if (blob) download(await embedPattern(blob, data), sheetFileName(name, doc.mirrored));
      } finally {
        setExporting(false);
      }
    }, 30);
  };

  // 原图对照：半透明叠在图纸上，只在屏幕上看，不进导出
  const [showRef, setShowRef] = useState(false);
  // 原图小窗的联动：鼠标所在格推给小窗；当前看得到的图纸范围（格子坐标）
  const refCursor = useRef<((p: CellPoint) => void) | null>(null);
  const onRefCursor = useCallback((fn: ((p: CellPoint) => void) | null) => { refCursor.current = fn; }, []);
  const visibleCells = useCallback((): CellRect | null => {
    const view = viewRef.current, canvas = canvasRef.current;
    if (!view || !canvas) return null;
    const c = canvas.getBoundingClientRect();
    if (!c.width) return null;
    // 真正看得到的范围：看图区里去掉浮在左边的工具栏，再去掉滚出屏幕的部分
    const r = view.getBoundingClientRect(), rail = railRef.current;
    const railRight = rail && getComputedStyle(rail).position === 'absolute' ? rail.getBoundingClientRect().right : r.left;
    const v = { left: Math.max(r.left, railRight, 0), top: Math.max(r.top, 0), right: Math.min(r.right, window.innerWidth), bottom: Math.min(r.bottom, window.innerHeight) };
    const toCell = (px: number, py: number): [number, number] => [
      ((px - c.left) * natural.width / c.width - natural.gridX) / natural.cell,
      ((py - c.top) * natural.height / c.height - natural.gridY) / natural.cell,
    ];
    const [x0, y0] = toCell(Math.max(v.left, c.left), Math.max(v.top, c.top));
    const [x1, y1] = toCell(Math.min(v.right, c.right), Math.min(v.bottom, c.bottom));
    return { x0, y0, x1, y1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural, zoom]);

  // 改了哪些格子：格子下标 → [原来的颜色, 改后的颜色]；撤销时只换回还保持改后颜色的格子，之后自己画的地方不动
  const diffOf = (before: Grid, after: Grid) => {
    const changes = new Map<number, [string | null, string | null]>();
    after.cells.forEach((c, i) => { if (c !== before.cells[i]) changes.set(i, [before.cells[i], c]); });
    return changes;
  };
  const restore = (changes: Map<number, [string | null, string | null]>) => {
    const cells = doc.grid.cells.slice();
    for (const [i, [before, after]] of changes) if (cells[i] === after) cells[i] = before;
    apply({ ...doc.grid, cells });
  };

  // 「颜色数量」默认收起成一行，点开才有滑块
  const [mergeOpen, setMergeOpen] = useState(false);
  // 「豆板尺寸」也是平时一行，点开换
  const [sizeOpen, setSizeOpen] = useState(false);
  const tiles = boardTiles(doc.grid.width, doc.grid.height);
  const boardNow = boardFor(doc.grid.width, doc.grid.height);
  const boardShort = boardNow ? SIZES[boardNow].label : `${tiles.cols}×${tiles.rows} 块`;
  // 没有原图（收藏、草稿、导入的图纸）：换尺寸 = 图案原样换到别的豆板上，四周多出空位画别的；放不下才缩小。可以撤销
  const ownSizing: Sizing = { mode: boardNow ?? 'custom', w: doc.grid.width, h: doc.grid.height }; // 选中的就是现在用的板
  const resizeBoard = (v: Sizing) => {
    const box = v.mode === 'auto' ? [] : v.mode === 'custom' ? [v.w, v.h] : [SIZES[v.mode].board, SIZES[v.mode].board];
    apply(fitOnBoard(doc.grid, box[0], box[1]));
  };
  const sizePicker = sizing ?? { value: ownSizing, onChange: resizeBoard, aspect: undefined };
  // 颜色数量：刚生成时的色数在滑块正中，左半 2…它，右半它…原图最多能出的色数。松手就生效，都能撤销：
  // 往左 = 用量少的颜色并进最接近的颜色（保留手改）；往右 = 从多色版合并到这个色数（多色版第一次点开时在后台算好）
  const [merged, setMerged] = useState<{ changes: Map<number, [string | null, string | null]>; from: number } | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const cur = legend.length;
  useEffect(() => {
    if (mergeOpen) colorRange?.onOpen();
  }, [mergeOpen, colorRange]);
  const richN = useMemo(() => (colorRange?.rich ? legendOf(colorRange.rich).length : 0), [colorRange?.rich]);
  const base = Math.max(2, colorRange?.base ?? cur);
  // 多色版还在后台算（大图要一秒左右）：先按两倍算右半，滑块照样停在正中，算好再换成真的上限
  const top = Math.max(base, cur, colorRange ? (colorRange.rich ? richN : Math.min(MAX_COLORS, base * 2 - 2)) : 0);
  const twoSided = top > base;
  // 滑块位置 0–100 ↔ 色数：两边都能调时左右各占一半，刚生成的色数在 50
  const toN = (p: number) => Math.round(!twoSided ? 2 + ((top - 2) * p) / 100 : p <= 50 ? 2 + ((base - 2) * p) / 50 : base + ((top - base) * (p - 50)) / 50);
  const toP = (n: number) => (!twoSided ? ((n - 2) / Math.max(1, top - 2)) * 100 : n <= base ? ((n - 2) / Math.max(1, base - 2)) * 50 : 50 + ((n - base) / (top - base)) * 50);
  const targetN = Math.min(Math.max(2, target ?? cur), top);
  const doMerge = (n: number) => {
    const next = reduceColors(doc.grid, n);
    const changes = diffOf(doc.grid, next);
    if (!changes.size) return;
    // 连着合并几次：同一格保留最早的原色，撤销一次回到合并前
    const all = new Map(merged?.changes ?? []);
    for (const [i, [before, after]] of changes) all.set(i, [all.get(i)?.[0] ?? before, after]);
    setMerged({ changes: all, from: merged?.from ?? legend.length });
    apply(next);
  };
  const commitColors = () => {
    const n = targetN;
    setTarget(null);
    if (n < cur) return doMerge(n);
    const rich = colorRange?.rich;
    if (n === cur || !rich) return;
    // 往右：整张换成多色版合并到 n 色（镜像过就跟着翻）；之前记下的描边、降噪、合并位置都对不上了，清掉
    const next = reduceColors(doc.mirrored ? mirrorGrid(rich) : rich, n);
    setMerged(null);
    setOutlined(null);
    setDenoised(null);
    apply(next);
  };
  const undoMerge = () => {
    if (!merged) return;
    restore(merged.changes);
    setMerged(null);
    setTarget(null);
  };

  // 「图片调整」浮层：点外面、按 Esc 就关
  const [adjustOpen, setAdjustOpen] = useState(false);
  const adjustRef = useRef<HTMLDivElement>(null);
  const adjustBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!adjustOpen) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!adjustRef.current?.contains(t) && !adjustBtnRef.current?.contains(t)) setAdjustOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setAdjustOpen(false);
      adjustBtnRef.current?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [adjustOpen]);
  // 描边：开关，记下铺了哪些格子；换颜色时直接重铺
  const [outlineOpen, setOutlineOpen] = useState(false);
  const outlineRef = useRef<HTMLDivElement>(null);
  const outlineBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!outlineOpen) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if ((t as Element).closest?.('.modal-backdrop')) return; // 在选色弹窗里点颜色不算点外面
      if (!outlineRef.current?.contains(t) && !outlineBtnRef.current?.contains(t)) setOutlineOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-backdrop')) return; // 开着选色弹窗时 Esc 先关弹窗
      setOutlineOpen(false);
      outlineBtnRef.current?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [outlineOpen]);
  // 可以描好几圈，每圈一个颜色；第 1 圈紧贴图案，往外依次加
  const MAX_RINGS = 5;
  const [rings, setRings] = useState<string[]>(['H7']);
  const [outlineNote, setOutlineNote] = useState('');
  const [outlined, setOutlined] = useState<Map<number, [string | null, string | null]> | null>(null);
  const applyOutline = (base: Grid, colors: string[]) => {
    // 图案四边都碰到豆板边缘（保留了背景、铺满整板）：描边只会在豆板外沿加一圈框，先提示移除背景
    const { width: W, height: H, cells } = base;
    const edgeFilled = (xs: number[]) => xs.some(i => cells[i]);
    const row = (y: number) => Array.from({ length: W }, (_, x) => y * W + x), col = (x: number) => Array.from({ length: H }, (_, y) => y * W + x);
    if (edgeFilled(row(0)) && edgeFilled(row(H - 1)) && edgeFilled(col(0)) && edgeFilled(col(W - 1))) {
      setOutlined(null);
      setOutlineNote('图案铺满了整块豆板，描边只会变成外框；先在「调整」里移除背景再描边');
      if (base !== doc.grid) apply(base);
      return;
    }
    const next = colors.reduce((g, code) => outlineGrid(g, code), base);
    const changes = diffOf(base, next);
    if (!changes.size) {
      setOutlined(null);
      setOutlineNote('图案铺满了豆板，外面没有空位；可以先在「调整」里移除背景');
      if (base !== doc.grid) apply(base);
      return;
    }
    setOutlined(changes);
    setOutlineNote('');
    apply(next);
  };
  // 先把已有描边换回去，得到没描边的样子
  const withoutOutline = () => {
    if (!outlined) return doc.grid;
    const cells = doc.grid.cells.slice();
    for (const [i, [before, after]] of outlined) if (cells[i] === after) cells[i] = before;
    return { ...doc.grid, cells };
  };
  const toggleOutline = () => {
    if (outlined) {
      apply(withoutOutline());
      setOutlined(null);
      return;
    }
    applyOutline(doc.grid, rings);
  };
  // 改颜色、加圈、删圈：描边开着就马上重铺
  const updateRings = (next: string[]) => {
    setRings(next);
    if (outlined) applyOutline(withoutOutline(), next);
  };

  // 按住左边的点点上下拖，调整圈的顺序；拖的时候只换显示顺序，松手才重铺描边
  const ringDrag = useRef<null | { from: number; startY: number; rowH: number }>(null);
  const [ringPreview, setRingPreview] = useState<null | { order: string[]; at: number }>(null);
  const moveRing = (list: string[], from: number, to: number) => {
    const next = list.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  };
  const onRingGripDown = (e: ReactPointerEvent<HTMLElement>, i: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    ringDrag.current = { from: i, startY: e.clientY, rowH: e.currentTarget.closest('li')?.offsetHeight || 38 };
    setRingPreview({ order: rings, at: i });
  };
  const onRingGripMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = ringDrag.current;
    if (!d) return;
    const to = Math.max(0, Math.min(rings.length - 1, d.from + Math.round((e.clientY - d.startY) / d.rowH)));
    if (to !== ringPreview?.at) setRingPreview({ order: moveRing(rings, d.from, to), at: to });
  };
  const onRingGripUp = () => {
    const d = ringDrag.current;
    ringDrag.current = null;
    if (d && ringPreview && ringPreview.at !== d.from) updateRings(ringPreview.order);
    setRingPreview(null);
  };


  // 降噪是开关：打开时记下改了哪些格子，再点一次换回去
  const [denoised, setDenoised] = useState<Map<number, [string | null, string | null]> | null>(null);
  const [denoiseNote, setDenoiseNote] = useState('');
  const toggleDenoise = () => {
    if (denoised) {
      restore(denoised);
      setDenoised(null);
      setDenoiseNote('');
      return;
    }
    const next = denoise(doc.grid);
    const changes = diffOf(doc.grid, next);
    if (!changes.size) return setDenoiseNote('没有零碎的杂点，不用降噪');
    setDenoised(changes);
    setDenoiseNote(`清理了 ${changes.size} 颗零碎的豆子`);
    apply(next);
  };

  // 镜像是整张左右翻：降噪、减少颜色记下的格子位置也要跟着翻，之后撤销才对得上
  const toggleMirror = () => {
    const w = doc.grid.width;
    const flip = (m: Map<number, [string | null, string | null]>) => new Map([...m].map(([i, v]) => [i - (i % w) + (w - 1 - (i % w)), v] as const));
    setDenoised(m => m && flip(m));
    setMerged(m => m && { ...m, changes: flip(m.changes) });
    setOutlined(m => m && flip(m));
    apply(mirrorGrid(doc.grid), !doc.mirrored);
  };
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setActionSlot(document.getElementById('page-actions'));
    setTitleSlot(document.getElementById('page-title'));
  }, []);
  // 收藏时还没起名：星标下面弹个小框起名，也可以跳过
  const [askName, setAskName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const starRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!askName) return;
    const close = (e: PointerEvent) => { if (!starRef.current?.contains(e.target as Node)) setAskName(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [askName]);
  const clickStar = () => {
    if (!onToggleStar) return;
    if (!starred && !name.trim()) {
      setDraftName('');
      setAskName(true);
      return;
    }
    onToggleStar();
  };
  const confirmStar = (n: string) => {
    setAskName(false);
    onToggleStar?.(n.trim());
  };

  const adjustOn = (removeBg ? 1 : 0) + (showRef && reference ? 1 : 0) + (doc.mirrored ? 1 : 0) + (denoised ? 1 : 0);
  // 工具栏提示：鼠标在按钮上停 0.35 秒才出来，划过去不打扰
  // 有选区或浮层时，页面滚动要重新算选区弹条该放上面还是下面（吸顶导航会挡住）
  const [, setScrollTick] = useState(0);
  useEffect(() => {
    if (!sel && !float) return;
    const onScroll = () => setScrollTick(t => t + 1);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [sel, float]);
  const [railTip, setRailTip] = useState<null | { id: Tool; top: number; left: number }>(null);
  const railTipTimer = useRef(0);
  const showRailTip = (id: Tool, el: HTMLElement) => {
    window.clearTimeout(railTipTimer.current);
    const stage = el.closest('.sheet-stage')?.getBoundingClientRect();
    const r = el.getBoundingClientRect(), rail = railRef.current?.getBoundingClientRect();
    if (!stage || !rail) return;
    railTipTimer.current = window.setTimeout(() => setRailTip({ id, top: r.top + r.height / 2 - stage.top, left: rail.right - stage.left + 8 }), 350);
  };
  const hideRailTip = () => {
    window.clearTimeout(railTipTimer.current);
    setRailTip(null);
  };
  const editing = tool !== 'pan';
  // 看图区里浮着的按钮（选区操作条、文字框手柄）自己处理点击，不算点在图纸上
  const onSheet = <E extends ReactMouseEvent<HTMLElement>>(fn: (e: E) => void) => (e: E) => {
    if ((e.target as HTMLElement).closest('button, .sel-pop, .float-box')) return;
    fn(e);
  };
  const handlers = { onClick: onSheet(onClick), onPointerDown: onSheet(onPointerDown), onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onPointerLeave: () => { refCursor.current?.(null); if (!selDrag.current) drawOverlay(); } };

  return (
    <section className={`result ${collapsed ? 'list-collapsed' : ''}`}>
      {active && (
        <div className={`toast has-action ${handoff || growNote || notice ? 'show' : ''} ${!handoff && !growNote && notice ? 'notice' : ''}`} role="status" aria-live="polite">
          {handoff && <><span>画笔已换成刚复制的 <b>{handoff.code}</b>，直接画吧</span><button onClick={undoHandoff}>不用</button></>}
          {!handoff && growNote && <span>{growNote}</span>}
          {!handoff && !growNote && notice}
        </div>
      )}
      <div className="result-main">
      {/* 图纸名字放在顶栏右边，挨着收藏 / 导入 / 下载，点了就能改 */}
      {active && titleSlot && onRename && createPortal(
        <>
          <input
            className="title-input"
            value={name}
            placeholder="未命名豆图"
            maxLength={30}
            aria-label="图纸名字"
            title="点击改名"
            // 宽度跟着字数走（中文一个字约 1em，英文数字约半个），再加上左右内边距
            style={{ width: `calc(${Math.min(16, Math.max(4, [...(name || '未命名豆图')].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 1 : 0.6), 0) + 0.5))}em + 18px)` }}
            onChange={e => onRename(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
          />
        </>,
        titleSlot,
      )}
      {/* 手机上顶栏放不下名字：在图纸上方单独一行，桌面不显示 */}
      {onRename && (
        <input
          className="title-input mobile-title"
          value={name}
          placeholder="未命名豆图（点这里起名）"
          maxLength={30}
          aria-label="图纸名字"
          onChange={e => onRename(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
        />
      )}
      {/* 收藏 / 导入 / 导出放进顶栏右侧，不再单独占一行 */}
      {active && actionSlot && createPortal(
        <>
          {onToggleStar && (
            <div className="star-wrap" ref={starRef}>
              <button className="btn soft pill icon-only" onClick={clickStar} aria-pressed={starred} aria-label={starred ? '已收藏' : '收藏'} title={starred ? '已在「我的收藏」，点击取消收藏' : '收藏到「我的收藏」，之后的修改会自动保存'}>
                {ICON.star}
              </button>
              {askName && (
                <form className="name-pop" onSubmit={e => { e.preventDefault(); confirmStar(draftName); }}>
                  <p>给这张豆图起个名字</p>
                  <input className="text-input" value={draftName} maxLength={30} placeholder="比如：猫咪头像" onChange={e => setDraftName(e.target.value)} autoFocus />
                  <div className="name-pop-actions">
                    <button type="button" className="btn link small" onClick={() => confirmStar('')}>先不起名</button>
                    <button type="submit" className="btn primary pill small">收藏</button>
                  </div>
                </form>
              )}
            </div>
          )}
          {onImport && <button className="btn soft pill btn-icon" onClick={onImport} title="换一张图，或导入存过的图纸 PNG">{ICON.import}导入</button>}
          <button className="btn primary pill btn-icon" onClick={save} disabled={exporting} title="下载高清图纸 PNG，拖回来能接着改">{ICON.export}{exporting ? '正在下载…' : '下载'}</button>
        </>,
        actionSlot,
      )}

      <div className={`sheet-stage ${full ? 'full' : ''}`}>
      <div
        ref={viewRef}
        className={`sheet-view ${zoom > 1 ? 'zoomed' : ''} tool-${tool}`}
        {...handlers}
        onDoubleClick={e => {
          if (editing) return;
          const rect = e.currentTarget.getBoundingClientRect();
          zoomTo(zoom === 1 && fit ? 1 / fit.scale : 1, [e.clientX - rect.left, e.clientY - rect.top]);
        }}
      >
        <div className="sheet-pad" style={zoom > 1 && fit ? { padding: `${fit.padY}px ${fit.padX}px` } : undefined}>
        <div className="sheet-wrap" style={sheetStyle}>
          <canvas ref={canvasRef} className={`sheet ${editing ? 'editing' : ''} ${penMode ? 'pen-mode' : ''}`} style={sheetStyle} aria-label="拼豆图纸" />
          <canvas ref={detailRef} className="sheet-detail" style={detailStyle} aria-hidden />
          <canvas ref={overlayRef} className={`sheet-overlay ${editing ? '' : 'hidden'}`} />
          {tool === 'select' && float && !selDragging && fit && (() => {
            const k = (fit.w * zoom) / natural.width;
            const style = { left: (natural.gridX + float.x * natural.cell) * k, top: (natural.gridY + float.y * natural.cell) * k, width: float.w * natural.cell * k, height: float.h * natural.cell * k };
            const handle = (c: Corner | 'move' | 'rotate') => ({ onPointerDown: (e: ReactPointerEvent<HTMLElement>) => onHandleDown(e, c), onPointerMove: onHandleMove, onPointerUp: onHandleUp, onPointerCancel: onHandleUp });
            return (
              <div className="float-box" style={style}>
                {(['tl', 'tr', 'bl', 'br'] as const).map(c => <span key={c} className={`fh ${c}`} title="拖动等比放大缩小" {...handle(c)} />)}
                <span className="fh-move" title="拖动移动" {...handle('move')}>{ICON.move}</span>
                {float.text && <span className="fh-rot" title="拖动旋转（按住 Shift 每 15° 一档）" {...handle('rotate')} />}
                {(float.scale !== 1 || float.text?.angle) && (
                  <em className="fh-scale">{float.w}×{float.h} 颗{float.text?.angle ? ` · ${Math.round(float.text.angle / DEG)}°` : ''}</em>
                )}
              </div>
            );
          })()}
          {tool === 'select' && (sel || float) && !selDragging && !handleDragging && fit && (() => {
            // 弹出按钮贴在选区（或浮起来的那块）上方正中；太靠上就放到下方
            const r = float ? floatRect(float) : sel!;
            const k = (fit.w * zoom) / natural.width;
            const left = (natural.gridX + (r.x + r.w / 2) * natural.cell) * k;
            const top = (natural.gridY + r.y * natural.cell) * k;
            // 太靠上（图纸顶部，或者页面滚动后会被吸顶导航挡住）就放到下方
            const barBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
            const screenTop = (canvasRef.current?.getBoundingClientRect().top ?? 0) + top;
            const below = top < 56 || screenTop - 56 < barBottom;
            const y = below ? (natural.gridY + (r.y + r.h) * natural.cell) * k + 14 + (float?.text ? 40 : 0) : top - 14; // 文字框下面有旋转手柄，按钮再往下让一点
            return (
              <div className={`sel-pop ${below ? 'below' : ''}`} style={{ left, top: y }} role="toolbar" aria-label="选区操作">
                {float ? (
                  <>
                    <button onClick={() => placeFloat(float)}>放下</button>
                    <button onClick={mirrorFloat}>镜像</button>
                    <button onClick={cancelFloat}>取消</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => {
                      const [dx, dy] = copySpot(doc.grid, sel!);
                      setFloat({ ...lift(sel!, null), x: sel!.x + dx, y: sel!.y + dy });
                      setSel(null);
                    }}>复制</button>
                    <button onClick={() => apply(mirrorRect(doc.grid, sel!))}>镜像</button>
                    <button onClick={() => { apply(fillRect(doc.grid, sel!, null)); setSel(null); }}>删除</button>
                  </>
                )}
              </div>
            );
          })()}
        </div>
        </div>
      </div>
      {showRef && reference && (
        <RefWindow
          reference={reference}
          mirrored={doc.mirrored}
          gridWidth={doc.grid.width}
          visibleCells={visibleCells}
          viewEl={viewRef.current}
          onCursor={onRefCursor}
          onClose={() => setShowRef(false)}
        />
      )}
      {/* 工具栏的提示：「快捷键 I」（工具名按钮上已经有了，不再重复）；放在工具栏外面（工具栏自己会滚动，放里面会被裁掉），鼠标停一下才出来 */}
      {railTip && (() => {
        const t = TOOLS.find(x => x.id === railTip.id)!;
        return (
          <div className="rail-tip" style={{ top: railTip.top, left: railTip.left }} role="tooltip">
            <p>快捷键<kbd>{t.key}</kbd></p>
          </div>
        );
      })()}
      {/* 左边竖排工具栏：图标 + 字；要用颜色的工具下面跟着当前颜色 */}
      <div className="tool-rail" ref={railRef} role="toolbar" aria-label="编辑工具">
        {TOOLS.map(t => (
          <button
            key={t.id}
            className={tool === t.id ? 'on' : ''}
            onClick={() => setTool(t.id)}
            aria-pressed={tool === t.id}
            aria-label={`${t.label}（${t.key}）`}
            aria-keyshortcuts={t.key}
            onMouseEnter={e => showRailTip(t.id, e.currentTarget)}
            onMouseLeave={hideRailTip}
          >
            {TOOL_ICON[t.id]}
            <span>{t.label}</span>
          </button>
        ))}
        <button ref={outlineBtnRef} className={`rail-adjust ${outlined ? 'active' : ''}`} onClick={() => { setOutlineOpen(o => !o); setAdjustOpen(false); }} aria-expanded={outlineOpen} aria-haspopup="true" title={outlined ? `描边 · 已开 ${rings.length} 圈` : '描边：图案外面加几圈豆子'}>
          {ICON.outline}
          <span>描边</span>
        </button>
        <button ref={adjustBtnRef} className={`rail-adjust rail-adjust-2 ${adjustOn ? 'active' : ''}`} onClick={() => { setAdjustOpen(o => !o); setOutlineOpen(false); }} aria-expanded={adjustOpen} aria-haspopup="true" title={adjustOn ? `图片调整 · 已开 ${adjustOn} 项` : '图片调整：移除背景、镜像、降噪'}>
          {ICON.adjust}
          <span>调整</span>
        </button>
        {(tool === 'brush' || tool === 'fill') && (
          <button className="rail-color" onClick={() => setPicker({ mode: 'brush' })} title="换一种颜色">
            <i style={{ background: colorOf(color).hex }} />
            <span>{color}</span>
          </button>
        )}
      </div>
      {outlineOpen && (
        <div className="adjust-pop" ref={outlineRef} role="group" aria-label="描边">
          <button className="switch-row" role="switch" aria-checked={!!outlined} onClick={toggleOutline} title="图案外面的空格铺上描边颜色">
            <span><b>描边</b></span>
            <i aria-hidden />
          </button>
          <ol className="ring-list">
            {(ringPreview?.order ?? rings).map((code, i) => (
              <li key={i} className={ringPreview?.at === i ? 'dragging' : ''}>
                {rings.length > 1 && (
                  <span className="ring-grip" title="按住上下拖，调整顺序" aria-label={`拖动调整第 ${i + 1} 圈的顺序`} onPointerDown={e => onRingGripDown(e, i)} onPointerMove={onRingGripMove} onPointerUp={onRingGripUp} onPointerCancel={onRingGripUp}>{ICON.grip}</span>
                )}
                <span>第 {i + 1} 圈</span>
                <button className="ring-color" onClick={() => setPicker({ mode: 'outline', ring: i })} title="换这一圈的颜色">
                  <i style={{ background: colorOf(code).hex }} /><span>{code}</span>
                </button>
                {rings.length > 1 && (
                  <button className="ring-remove" onClick={() => updateRings(rings.filter((_, j) => j !== i))} aria-label={`删掉第 ${i + 1} 圈`} title="删掉这一圈">×</button>
                )}
              </li>
            ))}
          </ol>
          {outlineNote && <p className="pop-note">{outlineNote}</p>}
          {rings.length < MAX_RINGS && (
            <button className="ring-add" onClick={() => updateRings([...rings, rings[rings.length - 1] === 'H2' ? 'H7' : 'H2'])}>+ 再加一圈</button>
          )}
        </div>
      )}
      {adjustOpen && (
        <div className="adjust-pop" ref={adjustRef} role="group" aria-label="图片调整">
          {onToggleRemoveBg && removeBg !== undefined && (
            <button className="switch-row" role="switch" aria-checked={removeBg} onClick={onToggleRemoveBg} disabled={busy} title="会重新生成图纸">
              <span><b>移除背景</b><small>只拼主体，会重新生成</small></span>
              <i aria-hidden />
            </button>
          )}
          {reference && (
            <button className="switch-row" role="switch" aria-checked={showRef} onClick={() => setShowRef(v => !v)} title="在旁边开一个原图小窗，可拖动缩放；鼠标在图纸上的位置会同步标在原图上">
              <span><b>原图对照</b></span>
              <i aria-hidden />
            </button>
          )}
          <button className="switch-row" role="switch" aria-checked={doc.mirrored} onClick={toggleMirror} title="左右翻转整张图纸：熨烫后翻面看，图案和原图同向">
            <span><b>水平镜像</b></span>
            <i aria-hidden />
          </button>
          <button className="switch-row" role="switch" aria-checked={!!denoised} onClick={toggleDenoise} title="零碎的一两颗杂点并进旁边的色块">
            <span><b>降噪</b>{denoiseNote && <small>{denoiseNote}</small>}</span>
            <i aria-hidden />
          </button>
        </div>
      )}
      {tool === 'text' && (
        <div className="adjust-pop text-pop" role="group" aria-label="文字">
          <p className="pop-title">文字</p>
          <input className="text-input" value={text} maxLength={20} placeholder="输入要放上去的文字" onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void placeText(); }} autoFocus />
          <button className="switch-row" onClick={() => setPicker({ mode: 'textColor' })} title="换文字颜色">
            <span><b>颜色</b></span>
            <em className="ring-color"><i style={{ background: colorOf(textColor).hex }} />{textColor}</em>
          </button>
          <div className="switch-row static">
            <span><b>粗细</b></span>
            <div className="seg mini" role="radiogroup" aria-label="粗细">
              <button role="radio" aria-checked={!textBold} className={!textBold ? 'on' : ''} onClick={() => setTextBold(false)}>常规</button>
              <button role="radio" aria-checked={textBold} className={textBold ? 'on' : ''} onClick={() => setTextBold(true)}>粗</button>
            </div>
          </div>
          {textSize && (
            <p className="pop-note">
              占 {textSize.w}×{textSize.h} 颗{textSize.w > doc.grid.width && '，比豆板宽'}
            </p>
          )}
          <button className="btn primary block" onClick={() => void placeText()} disabled={!bitmap.length}>放到图纸上</button>
        </div>
      )}
      {/* 浮在图纸角上：左下撤销重做，右下缩放 */}
      <div className="float-bar left">
        <button className="float-btn" onClick={() => onHistory(undo(history))} disabled={!history.past.length} title="撤销（⌘Z）" aria-label="撤销">{ICON.undo}</button>
        <button className="float-btn" onClick={() => onHistory(redo(history))} disabled={!history.future.length} title="重做（⇧⌘Z）" aria-label="重做">{ICON.redo}</button>
      </div>
      <div className="float-bar right">
        <button className="float-btn" onClick={() => setGridView(g => GRID_NEXT[g])} title={`${GRID_LABEL[gridView]}（点一下切换）`} aria-label={GRID_LABEL[gridView]}>
          {ICON[({ all: 'gridAll', major: 'gridMajor', none: 'gridNone', preview: 'gridPreview' } as const)[gridView]]}
        </button>
        <div className="float-zoom" ref={zoomBoxRef} title="点数字直接输入比例，或在数字上滚动缩放">
          <button onClick={() => zoomTo(zoom / 1.5)} disabled={zoom <= 1} aria-label="缩小">−</button>
          <input
            className="zoom-input"
            value={zoomText ?? `${zoomPercent}%`}
            inputMode="numeric"
            aria-label="缩放比例"
            onFocus={e => { setZoomText(String(zoomPercent)); requestAnimationFrame(() => e.target.select()); }}
            onChange={e => setZoomText(e.target.value.replace(/[^\d.]/g, '').slice(0, 4))}
            onBlur={commitZoomText}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { setZoomText(null); e.currentTarget.blur(); }
            }}
          />
          <button onClick={() => zoomTo(zoom * 1.5)} disabled={zoom >= maxZoom} aria-label="放大">＋</button>
        </div>
        <button className="float-btn" onClick={full ? exitFull : enterFull} title={full ? '退出全屏（F / Esc）' : '全屏（F）'} aria-label={full ? '退出全屏' : '全屏'} aria-pressed={full}>{full ? ICON.exitFull : ICON.full}</button>
      </div>
      </div>

      </div>

      <aside className="bead-list" aria-label="色号清单">
        <div className="bead-list-head">
          <span className="kicker">色号清单</span>
          <button className="bead-collapse" onClick={toggleCollapsed} aria-expanded={!collapsed} aria-label={collapsed ? '展开色号清单' : '收起色号清单'} title={collapsed ? '展开' : '收起，只看色块'}>
            {COLLAPSE}
          </button>
        </div>
        {/* 表头：最左是俯视的标志（和下面的色块一样是个圆、竖着对齐），「色号」对齐下面的色号文字 */}
        <div className="bead-cols" aria-hidden><Logo size={20} phi={Math.PI / 2} /><span>色号</span><span>用量</span></div>
        <ul>
          {legend.map(l => (
            <li key={l.code} className={listSelected === l.code ? 'on' : ''}>
              <button className="bead-row" onClick={() => pickFromList(l.code)} aria-pressed={listSelected === l.code} title={painting ? `用 ${l.code} 画（${l.count} 颗）` : `只看 ${l.code}（${l.count} 颗）`}>
                <span className="bead-swatch" style={{ background: colorOf(l.code).hex }} />
                <b>{l.code}</b>
                <span className="num">{l.count}</span>
              </button>
              <button className="bead-more" onClick={() => setCard(l.code)} aria-label={`替换或删掉 ${l.code}`} title="替换或删掉这个色号">⋯</button>
            </li>
          ))}
        </ul>
        {/* 颜色数量：平时一行，点开拖滑块；往左减少、往右增加 */}
        {(cur > 2 || colorRange) && (
          <div className={`bead-merge ${mergeOpen ? 'open' : ''}`}>
            <button className="bead-merge-head" onClick={() => { setMergeOpen(o => !o); setTarget(null); }} aria-expanded={mergeOpen}>
              <span>颜色数量</span>
              <b>{mergeOpen ? targetN : cur}<small>色</small></b>
              <i className="caret" aria-hidden />
            </button>
            {merged && !mergeOpen && (
              <p className="bead-merge-note">原来 {merged.from} 色<button className="btn link small" onClick={undoMerge}>撤销</button></p>
            )}
            {mergeOpen && (
              <>
                <div className="bead-range">
                  <input type="range" min={0} max={100} value={toP(targetN)} disabled={busy} aria-label="颜色数量"
                    onChange={e => setTarget(toN(Number(e.target.value)))} onPointerUp={commitColors} onKeyUp={commitColors} />
                </div>
                {merged && <p className="bead-merge-note">原来 {merged.from} 色<button className="btn link small" onClick={undoMerge}>撤销</button></p>}
              </>
            )}
          </div>
        )}
        {/* 豆板尺寸：和颜色数量一样平时一行，点开换。有原图按新尺寸重新生成；没有原图就把图案原样换到别的豆板上 */}
        <div className={`bead-merge ${sizeOpen ? 'open' : ''}`}>
          <button className="bead-merge-head" onClick={() => setSizeOpen(o => !o)} aria-expanded={sizeOpen}>
            <span>豆板尺寸</span>
            <b>{boardShort}</b>
            <i className="caret" aria-hidden />
          </button>
          {sizeOpen && <SizePicker value={sizePicker.value} onChange={sizePicker.onChange} aspect={sizePicker.aspect} disabled={busy} column applyLabel={sizing ? '重新生成' : '应用'} />}
        </div>
      </aside>

      {card && (
        <div className="modal-backdrop" onClick={() => setCard(null)}>
          <div className="modal card-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={`色号 ${card}`}>
            <div className="card-preview" style={{ background: colorOf(card).hex, color: textColorOn(colorOf(card).hex) }}>{card}</div>
            <p>{legend.find(l => l.code === card)?.count ?? 0} 颗</p>
            <button className="btn primary btn-replace" onClick={() => setPicker({ mode: 'replace', from: card })}>
              把<i style={{ background: colorOf(card).hex }} />{card} 替换成<span aria-hidden>→</span>
            </button>
            {/* 删掉：这个颜色的豆子全部清空（比如删掉不要的背景色）。想并进相近颜色用上面的替换或「减少颜色」；点错可以撤销 */}
            <button className="btn" onClick={() => { apply(replaceColor(doc.grid, card, null)); setCard(null); }}>删掉这个颜色</button>
          </div>
        </div>
      )}

      {picker && (
        <PalettePicker
          title={picker.mode === 'replace' ? `把 ${picker.from} 全部替换为` : picker.mode === 'outline' ? '描边颜色' : picker.mode === 'textColor' ? '文字颜色' : '选择颜色'}
          highlight={legend.map(l => l.code)}
          current={picker.mode === 'replace' ? picker.from : picker.mode === 'outline' ? rings[picker.ring] : picker.mode === 'textColor' ? textColor : color}
          onClose={() => setPicker(null)}
          onPick={code => {
            if (picker.mode === 'textColor') setTextColor(code);
            else if (picker.mode === 'outline') updateRings(rings.map((c, i) => (i === picker.ring ? code : c)));
            else if (picker.mode === 'replace') {
              apply(replaceColor(doc.grid, picker.from, code));
              setCard(null);
            } else {
              setColor(code);
            }
            setPicker(null);
          }}
        />
      )}
    </section>
  );
}
