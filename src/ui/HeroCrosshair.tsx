// 首页的坐标十字线：鼠标在首屏里移动时，一横一竖两条细线跟着走，线碰到边的地方标出第几列、第几行（按豆板的格子数，一格 12 像素）；
// 移到按钮上时，四个角的括号把按钮框住。只画线，不铺图案。
// 为了省资源：鼠标不动、线停稳就不再重画；没有鼠标的设备（手机）不显示；系统开了"减少动态效果"时线不拖尾，直接跟手。
import { useEffect, useRef } from 'react';

const CELL = 12; // 一格豆子按 12 像素算，坐标显示成第几列 / 第几行
const TARGETS = 'a, button';

export function HeroCrosshair() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx || !window.matchMedia('(hover: hover)').matches) return;
    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let w = 0, h = 0, dpr = 1, raf = 0, last = 0;
    let ink = '#0a0a0a', paper = '#ffffff';
    const p = { tx: 0, ty: 0, x: 0, y: 0, inside: false, seen: false, show: 0 };
    let target: Element | null = null;
    const box = { x: 0, y: 0, w: 0, h: 0, a: 0 };

    const readColors = () => {
      const css = getComputedStyle(host);
      ink = css.getPropertyValue('--ink').trim() || ink;
      paper = css.getPropertyValue('--bg').trim() || paper;
    };
    const resize = () => {
      const r = host.getBoundingClientRect();
      w = r.width;
      h = r.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      draw();
    };
    // 1 像素的线落在半像素上才不糊
    const sharp = (v: number) => (Math.round(v * dpr) + 0.5) / dpr;

    const tag = (text: string, x: number, y: number, centerX: boolean) => {
      ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      const tw = ctx.measureText(text).width + 10, th = 16;
      const left = Math.min(Math.max(centerX ? x - tw / 2 : x, 4), w - tw - 4);
      const top = Math.min(Math.max(centerX ? y : y - th / 2, 4), h - th - 4);
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.roundRect(left, top, tw, th, 4);
      ctx.fill();
      ctx.fillStyle = paper;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, left + tw / 2, top + th / 2 + 0.5);
    };

    const corners = (x: number, y: number, bw: number, bh: number) => {
      const arm = Math.min(12, bw / 3, bh / 3);
      ctx.beginPath();
      for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + bw, y, -1, 1], [x, y + bh, 1, -1], [x + bw, y + bh, -1, -1]]) {
        ctx.moveTo(cx, cy + sy * arm);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + sx * arm, cy);
      }
      ctx.stroke();
    };

    function draw() {
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, w, h);
      if (p.show < 0.01 && box.a < 0.01) return;
      const x = sharp(p.x), y = sharp(p.y);
      ctx!.strokeStyle = ink;
      ctx!.lineWidth = 1;
      ctx!.globalAlpha = p.show * 0.32 * (1 - 0.5 * box.a);
      ctx!.beginPath();
      ctx!.moveTo(0, y);
      ctx!.lineTo(w, y);
      ctx!.moveTo(x, 0);
      ctx!.lineTo(x, h);
      ctx!.stroke();
      // 线碰到上边、左边的地方标第几列、第几行；框住按钮时先收起来
      ctx!.globalAlpha = p.show * 0.85 * (1 - box.a);
      tag(`第 ${Math.floor(p.x / CELL) + 1} 列`, p.x, 8, true);
      tag(`第 ${Math.floor(p.y / CELL) + 1} 行`, 8, p.y, false);
      if (box.a > 0.01) {
        ctx!.globalAlpha = box.a * 0.8;
        ctx!.lineWidth = 1.5;
        corners(box.x, box.y, box.w, box.h);
      }
      ctx!.globalAlpha = 1;
    }

    const tick = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const ease = (tau: number) => (instant ? 1 : 1 - Math.exp(-dt / tau));
      p.x += (p.tx - p.x) * ease(0.06);
      p.y += (p.ty - p.y) * ease(0.06);
      const wantShow = p.inside ? 1 : 0;
      p.show += (wantShow - p.show) * ease(wantShow ? 0.1 : 0.2);
      const hostRect = host.getBoundingClientRect();
      let goal = { x: p.x - 8, y: p.y - 8, w: 16, h: 16 };
      if (target && p.inside) {
        const r = target.getBoundingClientRect();
        goal = { x: r.left - hostRect.left - 6, y: r.top - hostRect.top - 6, w: r.width + 12, h: r.height + 12 };
      }
      const k = ease(0.07);
      box.x += (goal.x - box.x) * k;
      box.y += (goal.y - box.y) * k;
      box.w += (goal.w - box.w) * k;
      box.h += (goal.h - box.h) * k;
      const wantBox = target && p.inside ? 1 : 0;
      box.a += (wantBox - box.a) * ease(wantBox ? 0.08 : 0.14);
      draw();
      const settling = Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) > 0.1 || Math.abs(wantShow - p.show) > 0.005
        || Math.abs(wantBox - box.a) > 0.005 || Math.abs(goal.x - box.x) + Math.abs(goal.w - box.w) > 0.2;
      if (settling) raf = requestAnimationFrame(tick);
      else last = 0;
    };
    const wake = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = host.getBoundingClientRect();
      p.tx = e.clientX - r.left;
      p.ty = e.clientY - r.top;
      if (!p.seen) {
        p.seen = true;
        p.x = p.tx;
        p.y = p.ty;
        Object.assign(box, { x: p.x - 8, y: p.y - 8, w: 16, h: 16 });
      }
      p.inside = true;
      const t = e.target instanceof Element ? e.target.closest(TARGETS) : null;
      target = t && host.contains(t) ? t : null;
      wake();
    };
    const onLeave = () => {
      p.inside = false;
      target = null;
      wake();
    };
    const recolor = () => { readColors(); draw(); };

    readColors();
    const sizeWatch = new ResizeObserver(resize);
    sizeWatch.observe(host);
    const themeWatch = new MutationObserver(recolor);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', recolor);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    resize();

    return () => {
      cancelAnimationFrame(raf);
      sizeWatch.disconnect();
      themeWatch.disconnect();
      media.removeEventListener('change', recolor);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-crosshair" aria-hidden />;
}
