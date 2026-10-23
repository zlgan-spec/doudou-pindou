// 首页大标题里的「DOU」：和站点 logo 同一套手绘画法——粗细不匀的墨线、白色字面、底下一层浅暖灰侧面（像豆子的侧面），
// 线条带一点手抖。O 就是俯视的一颗豆子。鼠标移上去时线条抖一下，同时让旁边的豆子 logo 转一圈。
// 内容只由下面固定的路径拼成，没有外部输入。
import { useEffect, useId, useRef } from 'react';
import { brush } from './Logo';

// 字母的中心线（字高 100），用粗线描出来就是圆润的手绘字
const LETTERS: Array<{ d: string; tilt: number; cx: number }> = [
  { d: 'M0 0 V100 H18 C82 100 82 0 18 0 Z', tilt: -4, cx: 32 }, // D
  { d: 'M140 0 C106 0 106 100 140 100 C174 100 174 0 140 0 Z', tilt: 3, cx: 140 }, // O
  { d: 'M212 0 V58 C212 114 276 114 276 58 V0', tilt: -2, cx: 244 }, // U
];
const TUBE = 38; // 墨线外沿
const FACE = 25; // 白色字面
const DEPTH = 15; // 侧面露出的厚度

function frame(filterId: string, seed: number): string {
  const ink = 'var(--ink, #0a0a0a)';
  // 每个字母各自歪一点，像手写；先画整排的侧面，再盖上字面
  const tube = (l: (typeof LETTERS)[number], dy: number, fill: string) =>
    `<g transform="translate(0 ${dy}) rotate(${l.tilt} ${l.cx} 50)">`
    + brush(`<path d="${l.d}" fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round"/>`, TUBE)
    + `<path d="${l.d}" fill="none" stroke="${fill}" stroke-width="${FACE}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  const side = LETTERS.map(l => tube(l, DEPTH, 'var(--bead-side, #dedbd3)')).join('');
  const face = LETTERS.map(l => tube(l, 0, 'var(--bead-face, #ffffff)')).join('');
  return `<defs><filter id="${filterId}" x="-5%" y="-10%" width="110%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter></defs>`
    + `<g filter="url(#${filterId})">${side}${face}</g>`;
}

export function DouWord() {
  const ref = useRef<SVGSVGElement>(null);
  const filterId = `dou-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    svg.innerHTML = frame(filterId, 3);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer = 0, running = false;
    const play = () => {
      // 让旁边的豆子 logo 一起动（它自己听 mouseenter）
      svg.parentElement?.querySelector('.title-bead svg')?.dispatchEvent(new MouseEvent('mouseenter'));
      if (running) return;
      running = true;
      let n = 0;
      const tick = () => {
        n++;
        svg.innerHTML = frame(filterId, (n % 7) + 1);
        if (n < 12) timer = window.setTimeout(tick, 110);
        else {
          svg.innerHTML = frame(filterId, 3);
          running = false;
        }
      };
      tick();
    };
    svg.addEventListener('mouseenter', play);
    return () => {
      svg.removeEventListener('mouseenter', play);
      window.clearTimeout(timer);
    };
  }, [filterId]);

  return <svg ref={ref} className="dou-word" viewBox="-26 -26 328 170" aria-hidden />;
}
