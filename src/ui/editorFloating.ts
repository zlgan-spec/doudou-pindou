import type { Rect } from '../core/edit';
import { scaleCells } from '../core/scale';
import { rasterText, type TextFont } from './text';

/**
 * 浮起来的一块：复制出来的、或者正在挪的选区内容。浮着的时候可以随便拖、镜像，底下的图案不受影响；
 * 点「放下」或点到外面才真正贴上去。cut = 挪动时原来的位置（放下时清空），复制时为 null
 */
export interface Floating {
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
interface TextSpec { value: string; font: TextFont; color: string; bold: boolean; flip: boolean; angle: number }

/** 文字浮层：按倍数和角度重新画字，中心点不动 */
export function textFloat(t: TextSpec, scale: number, cx: number, cy: number): Floating {
  const rows = rasterText(t.value, { font: t.font, scale, angle: t.angle, bold: t.bold, flip: t.flip });
  const h = Math.max(1, rows.length), w = Math.max(1, rows[0]?.length ?? 1);
  const cells = rows.flat().map(on => (on ? t.color : null));
  return { cells, w, h, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), cut: null, base: cells, bw: w, bh: h, scale, text: t };
}
export const floatCenter = (f: Floating): [number, number] => [f.x + f.w / 2, f.y + f.h / 2];
export const DEG = Math.PI / 180;
/** 旋转角度：靠近 0°/45°/90°… 4° 以内吸过去；按住 Shift 每 15° 一档 */
export function snapAngle(a: number, shift: boolean): number {
  if (shift) return Math.round(a / (15 * DEG)) * 15 * DEG;
  const near = Math.round(a / (45 * DEG)) * 45 * DEG;
  return Math.abs(a - near) < 4 * DEG ? near : a;
}

/** 按倍数等比放大缩小：按像素画的规矩（整数倍直接复制；缩小时细线、眼睛不丢，同样大的眼睛缩完一样大），见 core/scale.ts */
function buildFloat(base: (string | null)[], bw: number, bh: number, scale: number) {
  return scaleCells(base, bw, bh, scale);
}
export function makeFloat(base: (string | null)[], bw: number, bh: number, scale: number, x: number, y: number, cut: Rect | null): Floating {
  return { ...buildFloat(base, bw, bh, scale), base, bw, bh, scale, x, y, cut };
}
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
/** 换倍数时，对角那个角不动 */
export function rescale(f: Floating, scale: number, fixed: Corner): Floating {
  const b = buildFloat(f.base, f.bw, f.bh, scale);
  const x = fixed === 'tl' || fixed === 'bl' ? f.x : f.x + f.w - b.w;
  const y = fixed === 'tl' || fixed === 'tr' ? f.y : f.y + f.h - b.h;
  return { ...f, ...b, scale, x, y };
}
export const floatRect = (f: Floating): Rect => ({ x: f.x, y: f.y, w: f.w, h: f.h });
