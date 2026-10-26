// 新手引导：第一次进编辑器时，别处变暗、只亮一块，一个分区一句话：右上角文件操作 → 色号清单 → 工具栏 → 右下角看图。看过（或跳过）一次就不再自动出现，点顶栏的「?」重看
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const KEY = 'doudou-guide-v1';
const PAD = 6; // 亮出来的框比目标大一圈
const GAP = 12; // 说明卡离亮框的距离
const CARD_H = 172; // 说明卡大概多高（两行字），放上下时按它留位置

// 目标用 data-guide 标在元素上（Editor 里），改布局不用改这里；同名的几个元素合成一块亮
const STEPS: Array<{ target: string; text: string }> = [
  { target: 'file', text: '为图纸命名、收藏 / 导入 / 下载图纸' },
  { target: 'beads', text: '颜色功能区，点击颜色右侧 ⋯ 可替换或删除颜色' },
  { target: 'tools', text: '图纸具体的修改功能，可进行 DIY 绘制' },
  { target: 'view', text: '切换不同视图，包括网格、放大缩小、全屏等' },
];

/** 同一步的几个元素合成一个框；不在同一行的（手机上名字在图纸上方、按钮在底部）只取和最后一个同一行的 */
function targetRect(els: HTMLElement[]): DOMRect | null {
  const rects = els.map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
  if (!rects.length) return null;
  const anchor = rects[rects.length - 1], mid = anchor.top + anchor.height / 2;
  const row = rects.filter(r => Math.abs(r.top + r.height / 2 - mid) < anchor.height);
  const left = Math.min(...row.map(r => r.left)), top = Math.min(...row.map(r => r.top));
  return new DOMRect(left, top, Math.max(...row.map(r => r.right)) - left, Math.max(...row.map(r => r.bottom)) - top);
}

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
  const next = useCallback(() => setStep(s => {
    if (s === null) return s;
    if (s < STEPS.length - 1) return s + 1;
    markSeen();
    return null;
  }), []);

  const els = step === null ? [] : [...document.querySelectorAll<HTMLElement>(`[data-guide="${STEPS[step].target}"]`)];
  const el = els.length ? els[els.length - 1] : null;

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
    const sticky = el.closest('.topbar, .page-actions'); // 顶栏、手机底部按钮条本来就固定在屏幕上，不用滚
    if (!sticky && (r0.top < 80 || r0.bottom > window.innerHeight - 16)) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const measure = () => setRect(targetRect(els));
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
    // els 每次渲染都是新数组，跟着 el（最后一个）变就够了
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, el, finish]);

  // 当前亮的是哪块，挂在根元素上：样式里按它临时露出平时悬停才出现的东西（色号清单的「⋯」）
  useEffect(() => {
    if (step === null) return;
    document.documentElement.dataset.guideStep = STEPS[step].target;
    return () => { delete document.documentElement.dataset.guideStep; };
  }, [step]);

  useEffect(() => {
    if (step === null) return;
    // 和常见的引导一样：→ ↓ 回车 空格 下一步，← ↑ 上一步，Esc 关掉（不用滚轮翻，触控板一碰就翻页）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return finish();
      const onButton = e.target instanceof HTMLButtonElement; // 按钮上的回车、空格浏览器会自己点一下，这里再翻就翻两页
      if (['ArrowRight', 'ArrowDown'].includes(e.key) || (!onButton && ['Enter', ' '].includes(e.key))) {
        e.preventDefault();
        next();
      } else if (['ArrowLeft', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        setStep(s => (s ? s - 1 : s));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, finish, next]);

  if (step === null || !rect) return null;
  const last = step === STEPS.length - 1;
  const hole = { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };

  // 说明卡放在亮框旁边：右边放得下放右边，否则左边，再不行放上下（手机）；都夹在屏幕里
  const CARD_W = Math.min(280, window.innerWidth - 32);
  const vw = window.innerWidth, vh = window.innerHeight;
  let left: number, top: number;
  const wide = hole.width > hole.height * 2; // 横条（顶栏按钮、右下角）：说明卡放上下，放左右会挡住别的按钮
  if (!wide && hole.left + hole.width + GAP + CARD_W <= vw - 16) {
    left = hole.left + hole.width + GAP;
    top = hole.top;
  } else if (!wide && hole.left - GAP - CARD_W >= 16) {
    left = hole.left - GAP - CARD_W;
    top = hole.top;
  } else {
    left = hole.left + hole.width - CARD_W; // 右对齐：这几块都靠右
    top = hole.top + hole.height + GAP + CARD_H <= vh - 16 ? hole.top + hole.height + GAP : hole.top - GAP - CARD_H;
  }
  left = Math.max(16, Math.min(left, vw - CARD_W - 16));
  top = Math.max(16, Math.min(top, vh - CARD_H - 16));

  // 点哪里都是下一步（像常见的引导那样），只有「跳过」例外
  return createPortal(
    <div className="guide" role="dialog" aria-modal="true" aria-label="新手引导" onClick={next}>
      <div className="guide-hole" style={hole} />
      <div className="guide-card" style={{ left, top, width: CARD_W }} key={step}>
        <span className="guide-count">{step + 1} / {STEPS.length}</span>
        <p>{STEPS[step].text}</p>
        <div className="guide-actions">
          {!last && <button className="btn link small" onClick={e => { e.stopPropagation(); finish(); }}>跳过</button>}
          <button className="btn primary pill small">{last ? '知道了' : '下一步'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
