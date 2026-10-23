// 站点标记：一颗拼豆。俯视是一个圆 + C，镜头压到平视是一截矮圆柱。
// 平时静止在"最佳截面"（56°：C 完整可读，侧面也露出来）。手绘感一直保留：线条粗细不一、侧面浅暖灰、轻微不规则。
// 动效是额外的：鼠标移到图标上时才动一次——转到俯视 → 压到平视 → 回到最佳截面，动的几秒里线条逐帧轻轻抖。
// 为了省资源：不循环、不常驻抖动；系统开了"减少动态效果"时不动。
import { useEffect, useId, useRef } from 'react';

const R = 40;
const H = 34;
const deg = (d: number) => (d * Math.PI) / 180;
export const BEST = deg(56);
const UP = deg(90);
const DOWN = deg(6);
// 动一次的关键帧：[角度, 毫秒]
const KEYS: Array<[number, number]> = [[BEST, 0], [UP, 450], [UP, 800], [DOWN, 1900], [DOWN, 2400], [BEST, 3100]];
const TOTAL = KEYS[KEYS.length - 1][1];
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function phiAt(ms: number): number {
  for (let i = 1; i < KEYS.length; i++) {
    const [a0, t0] = KEYS[i - 1], [a1, t1] = KEYS[i];
    if (ms <= t1) return t1 === t0 ? a1 : a0 + (a1 - a0) * ease((ms - t0) / (t1 - t0));
  }
  return BEST;
}

/** 笔触：同一笔再描一道细的、错开一点点，两笔叠起来就是"一边粗一边细"的手绘线 */
export const brush = (shape: string, w: number, extra = '') =>
  `${shape.replace('/>', ` stroke-width="${w.toFixed(2)}" ${extra}/>`)}${shape
    .replace(/fill="[^"]*"/, 'fill="none"')
    .replace('/>', ` stroke-width="${(w * 0.5).toFixed(2)}" transform="translate(0.9 0.8)" ${extra}/>`)}`;

/** 画一帧：phi 是视线和桌面的夹角，90° 俯视，接近 0° 平视。内容只由数字和固定字符串拼成，没有外部输入 */
export function frame(phi: number, filterId: string, seed: number, wobble: number): string {
  const s = Math.sin(phi), c = Math.cos(phi);
  const ry = Math.max(R * s, 0.4), bh = H * c;
  const top = 50 - bh / 2 - ry * 0.15 * c, bot = top + bh;
  const ink = 'var(--ink, #0a0a0a)';
  // 侧面：一层浅暖灰
  const body = bh > 0.5
    ? brush(`<path d="M${50 - R} ${top} V${bot} A${R} ${ry} 0 0 0 ${50 + R} ${bot} V${top}" fill="var(--bead-side, #dedbd3)" stroke="${ink}" stroke-linejoin="round" stroke-linecap="round"/>`, 4.4)
    : '';
  // 顶面轮廓：俯视时最粗，越平越细，平视时只是柱子顶上一道细边
  const face = brush(`<ellipse cx="50" cy="${top}" rx="${R}" ry="${ry}" fill="var(--bead-face, #ffffff)" stroke="${ink}"/>`, 3.6 + 1.8 * s);
  // C 是俯视才有的元素：跟顶面一起压扁、线宽同步变细，压到一半就淡出，平视时整颗豆只剩圆柱的轮廓
  const r = R * 0.5, cy = r * s;
  const cAlpha = Math.min(1, Math.max(0, (s - 0.3) / 0.4));
  const cMark = cAlpha > 0
    ? brush(`<path d="M${50 + r * 0.72} ${top - cy * 0.7} A${r} ${cy} 0 1 0 ${50 + r * 0.72} ${top + cy * 0.7}" fill="none" stroke="${ink}" stroke-linecap="round"/>`, 7.6 * (0.45 + 0.55 * s), `stroke-opacity="${cAlpha.toFixed(2)}"`)
    : '';
  const filter = wobble
    ? `<defs><filter id="${filterId}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="${wobble}"/></filter></defs>`
    : '';
  return `${filter}<g${wobble ? ` filter="url(#${filterId})"` : ''}>${body}${face}${cMark}</g>`;
}

/** phi：静止时的角度，默认最佳截面；传 Math.PI / 2 就是正的俯视图（一个圆 + C） */
export function Logo({ size = 20, animated = false, phi = BEST }: { size?: number; animated?: boolean; phi?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const filterId = `bead-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const wobble = size >= 48 ? 2 : 1.1;
    const still = () => { svg.innerHTML = frame(phi, filterId, 3, wobble); };
    still();
    if (!animated || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0, running = false;
    const play = () => {
      if (running) return;
      running = true;
      const start = performance.now();
      let seed = 1, lastSeed = start;
      const tick = (now: number) => {
        const t = now - start;
        if (t >= TOTAL) {
          still();
          running = false;
          return;
        }
        if (now - lastSeed > 110) { seed = (seed % 7) + 1; lastSeed = now; } // 动的时候线条每 0.1 秒抖一下
        svg.innerHTML = frame(phiAt(t), filterId, seed, wobble);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    svg.addEventListener('mouseenter', play);
    return () => {
      svg.removeEventListener('mouseenter', play);
      cancelAnimationFrame(raf);
    };
  }, [animated, size, filterId, phi]);

  return <svg ref={ref} className="logo" width={size} height={size} viewBox="0 0 100 100" aria-hidden />;
}
