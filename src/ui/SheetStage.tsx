import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Grid } from '../core/grid';
import { renderSheet, sheetLayout } from '../render/sheet';
import { ScrollBar } from './ScrollBar';

/**
 * 看图区：弹窗大小固定，图纸默认整张放进左边；按钮、双指、Ctrl+滚轮、双击都能缩放，放大后拖动看。
 * 缩放时以手指 / 鼠标所在位置为中心，连续缩放按最新值接着算（同做豆图）
 */
export function SheetStage({ item }: { item: { grid: Grid; name: string; mirrored: boolean } }) {
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

  // 清晰度：缩放停下来再按屏幕上的大小重画。
  // 整张画布的像素有上限：手机浏览器（尤其 iOS，约 1677 万像素）超过就整张画不出来、变成空白。
  // 所以整张最多画到 1600 万像素；再放大时另叠一块只画看得见那部分的清晰画布（和编辑器同一个办法）
  const PIXEL_BUDGET = 16e6;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const maxScale = Math.min(2.5, Math.sqrt(PIXEL_BUDGET / (L.width * L.height)));
  const [renderScale, setRenderScale] = useState(() => Math.min(1, maxScale));
  useEffect(() => {
    if (!fit) return;
    const want = Math.min(maxScale, Math.max(0.5, fit * zoom * dpr));
    const t = window.setTimeout(() => setRenderScale(want), 120);
    return () => window.clearTimeout(t);
  }, [fit, zoom, dpr, maxScale]);
  useEffect(() => {
    if (canvas.current) renderSheet(item.grid, { mirrored: item.mirrored, title: item.name, scale: renderScale }, canvas.current);
  }, [item, renderScale]);

  // 清晰画布画的是哪一块（版式坐标）：看得见的范围四周多留 30%，滚动出了这块、或缩放停下来才换一块重画
  const detailCanvas = useRef<HTMLCanvasElement>(null);
  const [detail, setDetail] = useState<{ x: number; y: number; w: number; h: number; zoom: number } | null>(null);
  const updateDetail = useCallback(() => {
    const el = box.current, c = canvas.current, z = zoomRef.current;
    if (!fit || !el || !c || fit * z * dpr <= maxScale * 1.02) return setDetail(null);
    const cr = c.getBoundingClientRect(), vr = el.getBoundingClientRect();
    const k = cr.width / L.width;
    if (!k) return;
    const vx0 = (Math.max(vr.left, cr.left) - cr.left) / k, vx1 = (Math.min(vr.right, cr.right) - cr.left) / k;
    const vy0 = (Math.max(vr.top, cr.top) - cr.top) / k, vy1 = (Math.min(vr.bottom, cr.bottom) - cr.top) / k;
    if (vx1 <= vx0 || vy1 <= vy0) return;
    setDetail(d => {
      if (d && d.zoom === z && d.x <= vx0 && d.y <= vy0 && d.x + d.w >= vx1 && d.y + d.h >= vy1) return d;
      const mx = (vx1 - vx0) * 0.3, my = (vy1 - vy0) * 0.3;
      const x = Math.max(0, vx0 - mx), y = Math.max(0, vy0 - my);
      return { x, y, w: Math.min(L.width, vx1 + mx) - x, h: Math.min(L.height, vy1 + my) - y, zoom: z };
    });
  }, [fit, dpr, maxScale, L.width, L.height]);
  useEffect(() => {
    const t = window.setTimeout(updateDetail, 120);
    return () => window.clearTimeout(t);
  }, [zoom, updateDetail]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(updateDetail); };
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { cancelAnimationFrame(frame); el.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, [updateDetail]);
  useEffect(() => {
    if (detail && detailCanvas.current && fit) {
      renderSheet(item.grid, { mirrored: item.mirrored, title: item.name, scale: fit * detail.zoom * dpr, region: detail }, detailCanvas.current);
    }
  }, [item, detail, fit, dpr]);
  const dk = fit * zoom; // 屏幕上一个版式单位多宽
  const detailStyle = detail && detail.zoom === zoom
    ? { left: detail.x * dk, top: detail.y * dk, width: detail.w * dk, height: detail.h * dk }
    : { display: 'none' };

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
      <ScrollBar target={box} axis="x" inside deps={[zoom]} />
      <ScrollBar target={box} axis="y" deps={[zoom]} />
      <div
        ref={box}
        className={`viewer-sheet ${zoom > 1 ? 'zoomed' : ''}`}
        onDoubleClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          zoomTo(zoom > 1 ? 1 : 3, [e.clientX - r.left, e.clientY - r.top]);
        }}
      >
        <div className="viewer-pad" style={{ width: Math.max(cw + PAD * 2, room?.[0] ?? 0), height: Math.max(ch + PAD * 2, room?.[1] ?? 0) }}>
          <div className="viewer-canvas" style={{ width: cw, height: ch }}>
            <canvas ref={canvas} style={{ width: cw, height: ch }} />
            <canvas ref={detailCanvas} className="sheet-detail" style={detailStyle} aria-hidden />
          </div>
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
