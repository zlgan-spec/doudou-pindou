// 原图对照小窗：浮在图纸区上，可拖动、拖右下角缩放、「—」收起成小标签、「×」关闭；位置大小记在浏览器里。
// 和图纸联动：鼠标在哪一格，原图上就用一颗豆大小的黑框标出那一格（主角，精确到格）；
// 图纸放大后，再用细淡的框标出屏幕上看到的整块范围（像 Photoshop 导航器的视野框，屏幕大框就大，只作辅助）。
// 只显示原图里出图的那部分（和图纸一一对应），镜像版跟着左右翻。
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Reference } from './Editor';

/** 图纸上的格子坐标（可以是小数），没有就是 null */
export type CellPoint = [number, number] | null;
export interface CellRect { x0: number; y0: number; x1: number; y1: number }

interface Props {
  reference: Reference;
  mirrored: boolean;
  gridWidth: number;
  /** 当前看得到的图纸范围（格子坐标）；整张都看得到时返回 null */
  visibleCells: () => CellRect | null;
  /** 图纸滚动、缩放时通知重算框的位置 */
  viewEl: HTMLElement | null;
  /** 编辑器把「鼠标所在格」推给小窗：注册一个回调 */
  onCursor: (fn: ((p: CellPoint) => void) | null) => void;
  onClose: () => void;
}

const KEY = 'bead-ref-window';
const MIN_W = 140;
interface Saved { x: number; y: number; w: number; min: boolean }

function load(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (!v || ![v.x, v.y, v.w].every(n => typeof n === 'number' && Number.isFinite(n))) return null;
    return { x: v.x!, y: v.y!, w: Math.max(MIN_W, v.w!), min: v.min === true };
  } catch {
    return null;
  }
}

export function RefWindow({ reference, mirrored, gridWidth, visibleCells, viewEl, onCursor, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<Saved>(() => load() ?? { x: -1, y: 14, w: 220, min: false });
  const [ratio, setRatio] = useState(1); // 原图出图那块的 高 / 宽
  const [cursor, setCursor] = useState<CellPoint>(null);
  const [view, setView] = useState<CellRect | null>(null);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 存不下就算了 */ }
  }, [state]);

  // 第一次打开：放到图纸区右上角
  useEffect(() => {
    if (state.x >= 0) return;
    const parent = root.current?.parentElement;
    if (parent) setState(s => ({ ...s, x: Math.max(14, parent.clientWidth - s.w - 14) }));
  }, [state.x]);

  // 记下的位置可能是在更宽的屏幕上拖的（电脑上拖到右边，换手机就跑出屏幕了）：打开时、窗口变化时拉回图纸区里
  useEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;
    const fit = () => {
      const el = root.current;
      if (!el) return;
      setState(s => {
        if (s.x < 0) return s;
        const pw = parent.clientWidth, ph = parent.clientHeight;
        const w = Math.max(MIN_W, Math.min(s.w, pw));
        const x = Math.max(0, Math.min(s.x, pw - (s.min ? el.offsetWidth : w)));
        const y = ph > el.offsetHeight ? Math.max(0, Math.min(s.y, ph - el.offsetHeight)) : s.y;
        return x === s.x && y === s.y && w === s.w ? s : { ...s, x, y, w };
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    onCursor(setCursor);
    return () => onCursor(null);
  }, [onCursor]);

  // 看得到的范围：滚动、缩放、窗口大小变化时重算
  useEffect(() => {
    const update = () => setView(visibleCells());
    update();
    viewEl?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('scroll', update, { passive: true }); // 整页滚动时看到的范围也会变
    window.addEventListener('resize', update);
    const ro = viewEl ? new ResizeObserver(update) : null; // 看图区自己变大变小（全屏、面板展开）时窗口不一定 resize
    if (viewEl) ro!.observe(viewEl);
    return () => {
      ro?.disconnect();
      viewEl?.removeEventListener('scroll', update);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [visibleCells, viewEl]);

  const { crop, box, url } = reference;
  const w = state.w, h = Math.round(w * ratio);
  // 格子坐标 → 小窗里的位置（0~1）；镜像版图纸的格子是左右翻过的
  const bw = box.right - box.left + 1, bh = box.bottom - box.top + 1;
  const left = mirrored ? gridWidth - 1 - box.right : box.left;
  const fx = (x: number) => (x - left) / bw;
  const fy = (y: number) => (y - box.top) / bh;

  // 拖动标题栏移动 / 拖右下角缩放（限制在图纸区里）
  const drag = useRef<null | { mode: 'move' | 'size'; sx: number; sy: number; x: number; y: number; w: number }>(null);
  const down = (mode: 'move' | 'size') => (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button') && mode === 'move') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, x: state.x, y: state.y, w: state.w };
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current, parent = root.current?.parentElement;
    if (!d || !parent) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.mode === 'move') {
      const box = root.current!.getBoundingClientRect();
      setState(s => ({ ...s, x: Math.min(Math.max(0, d.x + dx), parent.clientWidth - box.width), y: Math.min(Math.max(0, d.y + dy), parent.clientHeight - box.height) }));
    } else {
      setState(s => ({ ...s, w: Math.min(Math.max(MIN_W, d.w + dx), parent.clientWidth - s.x) }));
    }
  };
  const up = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  if (state.min) {
    return (
      <div ref={root} className="ref-win min" style={{ left: Math.max(0, state.x), top: state.y }}>
        <button onClick={() => setState(s => ({ ...s, min: false }))} title="展开原图">原图</button>
        <button onClick={onClose} aria-label="关闭原图对照" title="关闭">×</button>
      </div>
    );
  }

  const vx0 = view ? Math.max(0, fx(view.x0)) : 0, vy0 = view ? Math.max(0, fy(view.y0)) : 0;
  const vx1 = view ? Math.min(1, fx(view.x1)) : 1, vy1 = view ? Math.min(1, fy(view.y1)) : 1;
  const showView = !!view && (vx1 - vx0 < 0.98 || vy1 - vy0 < 0.98) && vx1 > vx0 && vy1 > vy0;
  // 鼠标所在的那一格：格子坐标取整，框的大小就是原图上一颗豆的大小（太小时至少 6 像素，还是以那一格为中心）
  const cellW = w / bw, cellH = h / bh;
  const gx = cursor ? Math.floor(cursor[0]) : -1, gy = cursor ? Math.floor(cursor[1]) : -1;
  const cx = fx(gx), cy = fy(gy);
  const showCursor = !!cursor && cx >= 0 && cx < 1 && cy >= 0 && cy < 1;
  const mw = Math.max(6, cellW), mh = Math.max(6, cellH);

  return (
    <div ref={root} className="ref-win" style={{ left: Math.max(0, state.x), top: state.y, width: w }} role="dialog" aria-label="原图对照">
      <div className="ref-head" onPointerDown={down('move')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <span>原图</span>
        <button onClick={() => setState(s => ({ ...s, min: true }))} aria-label="收起原图" title="收起">—</button>
        <button onClick={onClose} aria-label="关闭原图对照" title="关闭">×</button>
      </div>
      <div className="ref-body" style={{ height: h }}>
        {/* 镜像版整块左右翻，十字和框画在翻转层外面，坐标已经是图纸方向 */}
        <div className={`ref-img ${mirrored ? 'flip' : ''}`}>
          <img
            src={url}
            alt="原图"
            draggable={false}
            onLoad={e => {
              const img = e.currentTarget;
              setRatio((crop.h * img.naturalHeight) / Math.max(1, crop.w * img.naturalWidth));
            }}
            style={{ width: w / crop.w, height: h / crop.h, left: (-crop.x * w) / crop.w, top: (-crop.y * h) / crop.h }}
          />
        </div>
        {showView && <i className="ref-view" style={{ left: vx0 * w, top: vy0 * h, width: (vx1 - vx0) * w, height: (vy1 - vy0) * h }} aria-hidden />}
        {showCursor && <i className="ref-cell" style={{ left: cx * w + cellW / 2 - mw / 2, top: cy * h + cellH / 2 - mh / 2, width: mw, height: mh }} aria-hidden />}
        <span className="ref-size" onPointerDown={down('size')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="拖动缩放" aria-hidden />
      </div>
    </div>
  );
}
