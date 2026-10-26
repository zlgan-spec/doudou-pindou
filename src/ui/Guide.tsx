// 新手引导：第一次进编辑器时，别处变暗、只亮一块，一步一句话讲清楚在哪改图、看用量、下载。看过（或跳过）一次就不再自动出现，点顶栏的「?」重看
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const KEY = 'doudou-guide-v1';
const PAD = 6; // 亮出来的框比目标大一圈
const GAP = 12; // 说明卡离亮框的距离
const CARD_H = 172; // 说明卡大概多高（两行字），放上下时按它留位置

// 目标用 data-guide 标在元素上（Editor 里），改布局不用改这里
const STEPS: Array<{ target: string; text: string }> = [
  { target: 'tools', text: '在这里改图：画笔、填充、橡皮，改错了能撤销' },
  { target: 'beads', text: '要用哪些色号、各多少颗都在这里，下面能调颜色数量和豆板尺寸' },
  { target: 'download', text: '做好了点这里下载图纸，拖回网站还能接着改' },
];

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // 存储用不了（无痕模式等）：不打扰
  }
}

function markSeen() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* 存不了就只在这次不再出现 */
  }
}

/** replay：每加 1 就从头再放一遍（顶栏「?」） */
export function Guide({ replay = 0 }: { replay?: number }) {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (replay) setStep(0);
  }, [replay]);

  // 编辑器刚出来时布局还在动（图纸渲染、侧栏展开），等一下再开始
  useEffect(() => {
    if (seen()) return;
    const t = window.setTimeout(() => setStep(0), 600);
    return () => window.clearTimeout(t);
  }, []);

  const finish = useCallback(() => {
    markSeen();
    setStep(null);
  }, []);

  const el = step === null ? null : document.querySelector<HTMLElement>(`[data-guide="${STEPS[step].target}"]`);

  // 跟着目标走：滚到能看见，窗口变化、滚动时重新量
  useLayoutEffect(() => {
    if (step === null) return;
    if (!el) {
      // 这一步的目标不在页面上（比如还没加载出来）：跳到下一步，没有了就结束
      if (step < STEPS.length - 1) setStep(step + 1);
      else finish();
      return;
    }
    // 滚到屏幕中间：贴着顶部会被吸顶的导航栏挡住（手机上工具栏就在图纸上方）
    const r0 = el.getBoundingClientRect();
    if (r0.top < 80 || r0.bottom > window.innerHeight - 16) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const measure = () => setRect(el.getBoundingClientRect());
    // 目标刚出现时还在播入场动画、滚动也要一会儿：头一秒每帧都量，跟上它停下来的位置
    const until = performance.now() + 1000;
    let raf = 0;
    const follow = () => {
      measure();
      if (performance.now() < until) raf = requestAnimationFrame(follow);
    };
    follow();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step, el, finish]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, finish]);

  if (step === null || !rect) return null;
  const last = step === STEPS.length - 1;
  const hole = { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };

  // 说明卡放在亮框旁边：右边放得下放右边，否则左边，再不行放上下（手机）；都夹在屏幕里
  const CARD_W = Math.min(280, window.innerWidth - 32);
  const vw = window.innerWidth, vh = window.innerHeight;
  let left: number, top: number;
  if (hole.left + hole.width + GAP + CARD_W <= vw - 16) {
    left = hole.left + hole.width + GAP;
    top = hole.top;
  } else if (hole.left - GAP - CARD_W >= 16) {
    left = hole.left - GAP - CARD_W;
    top = hole.top;
  } else {
    left = hole.left + hole.width / 2 - CARD_W / 2;
    top = hole.top + hole.height + GAP + CARD_H <= vh - 16 ? hole.top + hole.height + GAP : hole.top - GAP - CARD_H;
  }
  left = Math.max(16, Math.min(left, vw - CARD_W - 16));
  top = Math.max(16, Math.min(top, vh - CARD_H - 16));

  return createPortal(
    <div className="guide" role="dialog" aria-modal="true" aria-label="新手引导">
      <div className="guide-hole" style={hole} />
      <div className="guide-card" style={{ left, top, width: CARD_W }} key={step}>
        <span className="guide-count">{step + 1} / {STEPS.length}</span>
        <p>{STEPS[step].text}</p>
        <div className="guide-actions">
          {!last && <button className="btn link small" onClick={finish}>跳过</button>}
          <button className="btn primary pill small" autoFocus onClick={() => (last ? finish() : setStep(step + 1))}>{last ? '知道了' : '下一步'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
