// 全站统一的细滚动条：手机上系统滚动条改不了样子、有的还不显示，凡是能横滑 / 竖滑的区域都用这一个。
// 放在滚动区域的「兄弟」位置（同一个定位父元素里），按滚动区域的位置、大小、滚到哪画一条 3px 的轨道和滑块；
// 内容放得下时不出现。样式在 styles.css 的 .sbar。
import { useCallback, useEffect, useState, type RefObject } from 'react';

type Bar = { left: number; top: number; w: number; h: number; len: number; thumb: number; pos: number; padA: number; padB: number };

/** inside：横条画在滚动区域里面的底边（图纸放大后）；默认画在区域下方。竖条总在里面的右边 */
export function ScrollBar({ target, axis, inside = false, deps = [] }: { target: RefObject<HTMLElement | null>; axis: 'x' | 'y'; inside?: boolean; deps?: unknown[] }) {
  const [bar, setBar] = useState<Bar | null>(null);
  const measure = useCallback(() => {
    const el = target.current;
    if (!el) return setBar(null);
    const size = axis === 'x' ? el.clientWidth : el.clientHeight;
    const full = axis === 'x' ? el.scrollWidth : el.scrollHeight;
    if (full <= size + 1) return setBar(null);
    const at = axis === 'x' ? el.scrollLeft : el.scrollTop;
    // 滚动区域自己有内边距（标签栏两边贴屏幕、靠内边距对齐内容）：轨道跟内容对齐，不伸到边上
    const cs = getComputedStyle(el);
    const padA = parseFloat(axis === 'x' ? cs.paddingLeft : cs.paddingTop) || 0;
    const padB = parseFloat(axis === 'x' ? cs.paddingRight : cs.paddingBottom) || 0;
    setBar({ left: el.offsetLeft, top: el.offsetTop, w: el.clientWidth, h: el.clientHeight, len: size, thumb: size / full, pos: Math.min(1, Math.max(0, at / (full - size))), padA, padB });
  }, [target, axis]);

  // 用 useEffect 不用 useLayoutEffect：滚动条写在滚动区域前面时，layout 阶段后面那个区域的 ref 还没挂上
  useEffect(() => {
    const el = target.current;
    measure();
    const raf = requestAnimationFrame(measure); // 字体、图片撑开之后再量一次
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    // 内容变多变少（换图、筛选、放大缩小）也要重新算
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      ro?.disconnect();
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  if (!bar) return null;
  // 轨道两头至少让 6px，不贴着圆角
  const a = Math.max(6, bar.padA), b = Math.max(6, bar.padB);
  const style = axis === 'x'
    ? { left: bar.left + a, top: bar.top + bar.h + (inside ? -7 : 2), width: bar.len - a - b }
    : { left: bar.left + bar.w - 6, top: bar.top + a, height: bar.len - a - b };
  const thumb = axis === 'x'
    ? { width: `${bar.thumb * 100}%`, left: `${bar.pos * (1 - bar.thumb) * 100}%` }
    : { height: `${bar.thumb * 100}%`, top: `${bar.pos * (1 - bar.thumb) * 100}%` };
  return <div className={`sbar sbar-${axis}`} style={style} aria-hidden><i style={thumb} /></div>;
}
