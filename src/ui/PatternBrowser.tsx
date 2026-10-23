// 图纸库和我的收藏共用的浏览方式（照着色卡库）：搜索框 + 一排标签 + 缩略图网格，点图放大看整张图纸，旁边一键下载。
// 图纸库：顶上一排按系列筛；「全部」里同一个系列的图纸放在一起、每个系列另起一行，卡片只放图。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { SIZES, boardLabel, type SizeId, type StyleId } from '../core/config';
import { beadCount, legendOf, type Grid } from '../core/grid';
import { renderSheet, sheetLayout } from '../render/sheet';
import { CATEGORY_TAGS, DETAIL_TAGS, sizeOf, USE_TAGS } from './library';
import { embedPattern, sheetFileName } from './pngData';

export interface BrowserItem {
  id: string;
  name: string;
  tags: string[];
  grid: Grid;
  mirrored: boolean;
  thumb: string;
  /** 作者 · 出处，图纸库才有 */
  credit?: ReactNode;
}

interface Props {
  items: BrowserItem[];
  /** 大图旁边的按钮；close 用于点了「拿去改」之类要离开的操作 */
  actions: (item: BrowserItem, close: () => void) => ReactNode;
  /** 图纸库才有：「全部」里按系列摆，点进去看整套（我的收藏不分组） */
  series?: SeriesGroup[];
  /** 图纸库「全部」的摆法：按大类分段，每段系列在前、单张在后，一块一行（排好的顺序，见 Patterns.tsx） */
  blocks?: BrowserItem[][];
}

const ALL = '全部';

function sizeLabel(grid: Grid): string | null {
  const s = sizeOf(grid);
  return s ? SIZES[s].label : null;
}

/** 下载整张图纸，PNG 里带着格子表格，拖回做拼豆页能接着改 */
export function downloadSheet(p: { name: string; grid: Grid; mirrored: boolean; size?: SizeId; style?: StyleId; fullBoard?: boolean }) {
  renderSheet(p.grid, { mirrored: p.mirrored, scale: p.grid.width > 80 ? 1.5 : 2, title: p.name }).toBlob(async raw => {
    if (!raw) return;
    const blob = await embedPattern(raw, { name: p.name, size: p.size ?? sizeOf(p.grid) ?? 'small', style: p.style ?? 'sticker', fullBoard: p.fullBoard ?? false, mirrored: p.mirrored, grid: p.grid });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = sheetFileName(p.name, p.mirrored);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

/** 图纸库的一个系列，我的收藏没有 */
export interface SeriesGroup {
  id: string;
  name: string;
  items: BrowserItem[];
}

/** 旧的系列页网址 #/patterns/s/<系列 id> 还能用：打开就是选中这个系列 */
const seriesOfHash = () => /^#\/patterns\/s\/([a-z0-9-]+)/.exec(window.location.hash)?.[1] ?? null;

/** 卡片：图纸库只放一张图（名字在悬停提示和大图里）；我的收藏下面写名字 + 豆板 */
function Card({ item, i, bare, onOpen }: { item: BrowserItem; i: number; bare: boolean; onOpen: (id: string) => void }) {
  return (
    <li style={{ '--i': Math.min(i, 40) } as CSSProperties}>
      <button onClick={() => onOpen(item.id)} aria-label={`查看 ${item.name}`} title={item.name}>
        <span className="color-chip pattern-thumb"><img src={item.thumb} alt="" /></span>
        {!bare && (
          <span className="color-meta">
            <b>{item.name}</b>
            <small className="pattern-size">{sizeLabel(item.grid) ?? `${item.grid.width}×${item.grid.height}`}</small>
          </span>
        )}
      </button>
    </li>
  );
}

export function PatternBrowser({ items, actions, series = [], blocks: allBlocks }: Props) {
  const library = series.length > 0;
  const [query, setQuery] = useState('');
  // 图纸库：选系列或豆板；我的收藏：选标签。旧的系列网址打开时直接选中那个系列
  const [tag, setTag] = useState(() => series.find(s => s.id === seriesOfHash())?.name ?? ALL);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = items.find(i => i.id === activeId) ?? null;
  const seriesOf = useMemo(() => new Map(series.flatMap(s => s.items.map(i => [i.id, s.name] as const))), [series]);

  // 一排按钮：全部 → 尺寸 → 大类 → 细分 → 用途，图纸库最后再接各系列（和「全部」里的先后一样）。只列有图纸的
  const chips = useMemo(() => {
    const sizes = Object.values(SIZES).map(s => s.label);
    const count = (t: string) => items.filter(i => seriesOf.get(i.id) === t || i.tags.includes(t) || sizeLabel(i.grid) === t).length;
    // 系列名和标签同名（如「风景」「货币」）只留一个按钮：选它时标签和系列里的图纸都会列出来
    const names = [...new Set([...sizes, ...CATEGORY_TAGS, ...DETAIL_TAGS, ...USE_TAGS, ...(library ? series.map(s => s.name) : [])])];
    return [{ name: ALL, n: items.length }, ...names.map(name => ({ name, n: count(name) })).filter(c => c.n > 0)];
  }, [items, series, seriesOf, library]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(i => {
      const labels = [...i.tags, sizeLabel(i.grid) ?? '', seriesOf.get(i.id) ?? ''];
      if (tag !== ALL && !labels.includes(tag)) return false;
      return !q || i.name.toLowerCase().includes(q) || labels.some(t => t && t.includes(q));
    });
  }, [items, query, tag, seriesOf]);

  // 图纸库「全部」：照排好的分段摆，一块一行；选了标签或搜索时就是一个平铺的结果
  const blocks = useMemo(() => {
    if (!library || tag !== ALL || query.trim() || !allBlocks) return [list];
    return allBlocks.filter(b => b.length);
  }, [library, tag, query, list, allBlocks]);

  // 大图里翻页的顺序 = 页面上从左到右、从上到下的顺序；首尾相接
  const order = useMemo(() => blocks.flat(), [blocks]);
  const step = (d: 1 | -1) => {
    const at = order.findIndex(i => i.id === activeId);
    if (at >= 0) setActiveId(order[(at + d + order.length) % order.length].id);
  };

  let n = 0;
  return (
    <>
      <div className="color-tools">
        <label className="search">
          <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={library ? '搜名字或系列，如 猫咪、货币' : '搜名字或标签，如 猫咪、杯垫'} maxLength={20} aria-label="搜索图纸" />
        </label>
        {chips.length > 2 && (
          <div className="chips" role="tablist" aria-label={library ? '系列' : '标签'}>
            {chips.map(c => (
              <button key={c.name} role="tab" aria-selected={tag === c.name} className={tag === c.name ? 'on' : ''} onClick={() => setTag(c.name)}>
                {c.name}<small>{c.n}</small>
              </button>
            ))}
          </div>
        )}
      </div>

      {!list.length ? (
        <p className="color-hint">没有找到{query.trim() ? `「${query.trim()}」` : '这一类的图纸'}，换个名字试试</p>
      ) : (
        // 图纸库的卡片比色卡大一些、只放图（用户主要看图）；我的收藏和色卡库同一套卡片
        <div className="pattern-blocks">
          {blocks.map((b, bi) => (
            <ul key={bi} className={`color-grid ${library ? 'pattern-grid' : ''}`}>
              {b.map(item => <Card key={item.id} item={item} i={n++} bare={library} onOpen={setActiveId} />)}
            </ul>
          ))}
        </div>
      )}

      {active && <Viewer item={active} actions={actions} onClose={() => setActiveId(null)} onStep={order.length > 1 ? step : undefined} />}
    </>
  );
}

/**
 * 看图区：弹窗大小固定，图纸默认整张放进左边；按钮、双指、Ctrl+滚轮、双击都能缩放，放大后拖动看。
 * 缩放时以手指 / 鼠标所在位置为中心，连续缩放按最新值接着算（同做豆图）
 */
function SheetStage({ item }: { item: BrowserItem }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const L = useMemo(() => sheetLayout(item.grid), [item.grid]);
  const [room, setRoom] = useState<[number, number] | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const PAD = 20;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setRoom([el.clientWidth, el.clientHeight]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = room ? Math.max(0.05, Math.min((room[0] - PAD * 2) / L.width, (room[1] - PAD * 2) / L.height)) : 0;
  const maxZoom = fit ? Math.max(2, 64 / (L.cell * fit)) : 1; // 放大到一格约 64 像素为止
  const cw = L.width * fit * zoom, ch = L.height * fit * zoom;

  // 清晰度：缩放停下来再按屏幕上的大小重画
  const [renderScale, setRenderScale] = useState(1);
  useEffect(() => {
    if (!fit) return;
    const want = Math.min(2.5, Math.max(0.5, fit * zoom * (window.devicePixelRatio || 1)));
    const t = window.setTimeout(() => setRenderScale(want), 120);
    return () => window.clearTimeout(t);
  }, [fit, zoom]);
  useEffect(() => {
    if (canvas.current) renderSheet(item.grid, { mirrored: item.mirrored, title: item.name, scale: renderScale }, canvas.current);
  }, [item, renderScale]);

  const pending = useRef<[number, number] | null>(null);
  const zoomTo = useCallback((next: number, anchor?: [number, number]) => {
    const el = box.current;
    const cur = zoomRef.current;
    const z = Math.min(maxZoom, Math.max(1, next));
    if (!el || !fit || z === cur) return;
    zoomRef.current = z;
    const ax = anchor ? anchor[0] : el.clientWidth / 2, ay = anchor ? anchor[1] : el.clientHeight / 2;
    // 图纸左上角在内容里的位置：比看图区小时居中，大了就从内边距开始
    const at = (z0: number, w: number, h: number): [number, number] => [Math.max(PAD, (w - L.width * fit * z0) / 2), Math.max(PAD, (h - L.height * fit * z0) / 2)];
    const [l0, t0] = at(cur, el.clientWidth, el.clientHeight), [l1, t1] = at(z, el.clientWidth, el.clientHeight);
    const [sl, st] = pending.current ?? [el.scrollLeft, el.scrollTop];
    const u = (sl + ax - l0) / (L.width * fit * cur), v = (st + ay - t0) / (L.height * fit * cur);
    pending.current = [l1 + u * L.width * fit * z - ax, t1 + v * L.height * fit * z - ay];
    setZoom(z);
  }, [fit, maxZoom, L.width, L.height]);
  useLayoutEffect(() => {
    const p = pending.current, el = box.current;
    pending.current = null;
    if (p && el) el.scrollTo(p[0], p[1]);
  }, [zoom]);
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;

  useEffect(() => {
    const el = box.current;
    const dialog = el?.closest('dialog');
    if (!el || !dialog) return;
    const local = (x: number, y: number): [number, number] | undefined => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? [x - r.left, y - r.top] : undefined;
    };
    // 弹窗里任何地方捏合都只缩放图纸，不让浏览器放大整页
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomToRef.current(zoomRef.current * Math.exp(-e.deltaY * 0.01), local(e.clientX, e.clientY));
    };
    let gestureStart = 1;
    const onGestureStart = (e: Event) => { e.preventDefault(); gestureStart = zoomRef.current; };
    const onGestureChange = (e: Event) => { e.preventDefault(); zoomToRef.current(gestureStart * (e as unknown as { scale: number }).scale); };
    // 手机双指：看图区设了 touch-action，浏览器不缩放，这里按两指距离自己算
    const touches = new Map<number, [number, number]>();
    let pinch: { dist: number; zoom: number } | null = null;
    let drag: { x: number; y: number; left: number; top: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: zoomRef.current };
        }
      } else if (e.button === 0 && zoomRef.current > 1) {
        drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
        el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
      }
    };
    const onMove = (e: PointerEvent) => {
      if (touches.has(e.pointerId)) {
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (touches.size === 2 && pinch) {
          const [a, b] = [...touches.values()];
          zoomToRef.current(pinch.zoom * (Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.dist), local((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
        }
      } else if (drag) {
        el.scrollTo(drag.left - (e.clientX - drag.x), drag.top - (e.clientY - drag.y));
      }
    };
    const onUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      if (drag) { drag = null; el.classList.remove('dragging'); }
    };
    dialog.addEventListener('wheel', onWheel, { passive: false });
    dialog.addEventListener('gesturestart', onGestureStart);
    dialog.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      dialog.removeEventListener('wheel', onWheel);
      dialog.removeEventListener('gesturestart', onGestureStart);
      dialog.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return (
    <div className="viewer-stage">
      <div
        ref={box}
        className={`viewer-sheet ${zoom > 1 ? 'zoomed' : ''}`}
        onDoubleClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          zoomTo(zoom > 1 ? 1 : 3, [e.clientX - r.left, e.clientY - r.top]);
        }}
      >
        <div className="viewer-pad" style={{ width: Math.max(cw + PAD * 2, room?.[0] ?? 0), height: Math.max(ch + PAD * 2, room?.[1] ?? 0) }}>
          <canvas ref={canvas} style={{ width: cw, height: ch }} />
        </div>
      </div>
      {fit > 0 && (
        <div className="float-zoom viewer-zoom">
          <button onClick={() => zoomTo(zoom / 1.5)} disabled={zoom <= 1} aria-label="缩小">−</button>
          <span>{Math.round(fit * zoom * 100)}%</span>
          <button onClick={() => zoomTo(zoom * 1.5)} disabled={zoom >= maxZoom} aria-label="放大">＋</button>
        </div>
      )}
    </div>
  );
}

/**
 * 大图弹窗。左右两边的箭头、键盘 ← ↑ / → ↓ 翻到上一张 / 下一张，顺序和页面上排的一样，首尾相接一直能翻。
 * 不用滚轮和滑动翻页：触控板缩放、拖动看图时容易误翻
 */
function Viewer({ item, actions, onClose, onStep }: { item: BrowserItem; actions: Props['actions']; onClose: () => void; onStep?: (d: 1 | -1) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  // 隐藏功能：按 F 图纸全屏（信息栏收起），Esc 先退出全屏、再按才关大图。界面上不加按钮
  const [full, setFull] = useState(false);
  const fullRef = useRef(full);
  fullRef.current = full;
  const setFullScreen = useCallback((on: boolean) => {
    setFull(on);
    if (on) document.documentElement.requestFullscreen?.().catch(() => { /* 不支持就只铺满窗口 */ });
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFull(false); }; // 浏览器自己按 Esc 退出的
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key.toLowerCase() === 'f') { e.preventDefault(); setFullScreen(!fullRef.current); return; }
      if (!stepRef.current) return;
      const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
      if (!d) return;
      e.preventDefault();
      stepRef.current(d);
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);

  const size = sizeLabel(item.grid);
  return (
    <dialog
      ref={dialog}
      className={`viewer ${full ? 'full' : ''}`}
      onCancel={e => { if (fullRef.current) { e.preventDefault(); setFullScreen(false); } }}
      onClose={onClose}
      onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}
      aria-label={item.name}
    >
      <div className="viewer-left">
        {/* 换图时看图区整个重来：缩放回到整张 */}
        <SheetStage key={item.id} item={item} />
        {onStep && (
          <>
            <button className="viewer-step prev" onClick={() => onStep(-1)} aria-label="上一张" title="上一张（← / ↑）">
              <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <button className="viewer-step next" onClick={() => onStep(1)} aria-label="下一张" title="下一张（→ / ↓）">
              <svg viewBox="0 0 24 24" aria-hidden><path d="M9 5l7 7-7 7" /></svg>
            </button>
          </>
        )}
      </div>
      <aside className="viewer-info">
        <div className="viewer-head">
          <h2 className="title">{item.name}</h2>
          <button className="viewer-close" onClick={() => dialog.current?.close()} aria-label="关闭">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {(item.tags.length > 0 || size) && (
          <p className="viewer-tags">{[...(size ? [size] : []), ...item.tags].map(t => <span key={t}>{t}</span>)}</p>
        )}
        <dl className="viewer-facts">
          <div><dt>豆板</dt><dd>{boardLabel(item.grid.width, item.grid.height)}</dd></div>
          <div><dt>颜色</dt><dd>{legendOf(item.grid).length} 色</dd></div>
          <div><dt>豆子</dt><dd>{beadCount(item.grid).toLocaleString()} 颗</dd></div>
          {item.credit && <div><dt>出处</dt><dd>{item.credit}</dd></div>}
        </dl>
        <div className="viewer-actions">{actions(item, () => dialog.current?.close())}</div>
        <p className="fine">下载的 PNG 拖回「做豆图」就能接着改</p>
      </aside>
    </dialog>
  );
}
