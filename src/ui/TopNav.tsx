// 顶栏导航：跟在「DouDou /」后面的几个文字链接。只有一个圆角框：平时停在当前页上（顺便说明在哪一页），
// 鼠标移到别的链接时滑过去、宽度跟着变，移开再滑回当前页。不在任何一页（首页、条款）时，框只在悬停时出现。
// 思路参考 React Bits 的顶栏，代码自己写的。
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface NavItem { id: string; hash: string; label: ReactNode }

export function TopNav({ items, current }: { items: NavItem[]; current: string }) {
  const refs = useRef(new Map<string, HTMLAnchorElement>());
  const navRef = useRef<HTMLElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [box, setBox] = useState<{ x: number; w: number; on: boolean } | null>(null);
  const moved = useRef(false); // 第一次出现时直接放好，不从左边滑进来

  const target = hover ?? current;
  useLayoutEffect(() => {
    const place = () => {
      const el = refs.current.get(target);
      setBox(b => (el ? { x: el.offsetLeft, w: el.offsetWidth, on: true } : b && { ...b, on: false }));
    };
    place();
    // 字体加载完、屏幕宽窄切换后链接的位置和宽度会变：盯着导航栏自己的尺寸，变了就重新量
    const ro = navRef.current ? new ResizeObserver(place) : null;
    if (navRef.current) ro!.observe(navRef.current);
    void document.fonts?.ready.then(place);
    return () => ro?.disconnect();
  }, [target]);
  useLayoutEffect(() => {
    if (box?.on) requestAnimationFrame(() => { moved.current = true; });
  }, [box?.on]);

  return (
    <nav ref={navRef} className="nav-links" aria-label="主导航" onMouseLeave={() => setHover(null)}>
      {box && (
        <span
          className={`nav-box ${box.on ? 'on' : ''} ${moved.current ? 'moving' : ''}`}
          style={{ transform: `translateX(${box.x}px)`, width: box.w }}
          aria-hidden
        />
      )}
      {items.map(n => (
        <a
          key={n.id}
          ref={el => { if (el) refs.current.set(n.id, el); else refs.current.delete(n.id); }}
          href={n.hash}
          className={current === n.id ? 'on' : ''}
          aria-current={current === n.id ? 'page' : undefined}
          onMouseEnter={() => setHover(n.id)}
          onFocus={() => setHover(n.id)}
          onBlur={() => setHover(null)}
        >
          {n.label}
        </a>
      ))}
    </nav>
  );
}
