// 壳子：顶部导航（做豆图 / 图纸库 / 我的收藏 / 色卡库 + GitHub），下面是当前页。
// 路由用 hash（#/、#/make、#/patterns、#/mine、#/colors），纯静态托管不用配置。
import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Colors } from './Colors';
import { loadDraft } from './draft';
import { Generator } from './Generator';
import { Home } from './Home';
import { Logo } from './Logo';
import { TopNav } from './TopNav';
import { imageFromPaste } from './paste';
import { Patterns } from './Patterns';
import { Terms } from './Terms';
import type { PatternEntry } from './store';

type Route = 'home' | 'make' | 'patterns' | 'mine' | 'colors' | 'terms';

// 手机上顶栏放不下四个字的「我的收藏」，「我的」在窄屏藏起来只显示「收藏」
const NAV: Array<{ id: Route; hash: string; label: ReactNode }> = [
  { id: 'make', hash: '#/make', label: '做豆图' },
  { id: 'patterns', hash: '#/patterns', label: '图纸库' },
  { id: 'mine', hash: '#/mine', label: <><span className="nav-extra">我的</span>收藏</> },
  { id: 'colors', hash: '#/colors', label: '色卡库' },
];
const REPO = 'https://github.com/zlgan-spec/doudou-pindou';

function parse(hash: string): Route {
  if (hash.startsWith('#/make')) return 'make';
  if (hash.startsWith('#/colors')) return 'colors';
  if (hash.startsWith('#/terms')) return 'terms';
  // 旧地址（#/patterns/mine、#/resources、#/patterns/prompts）也认，收藏过链接的人不会落空
  if (hash.startsWith('#/mine') || hash.startsWith('#/patterns/mine')) return 'mine';
  if (hash.startsWith('#/patterns') || hash.startsWith('#/resources')) return 'patterns';
  return 'home';
}

export function App() {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  // 条款页左上角「← 返回」回到进来之前的那一页；直接打开条款链接时回首页
  const [backHash, setBackHash] = useState('#/');
  // 从图纸库打开的那一份；带一个编号，打开同一份两次也会重新挂载
  const [opened, setOpened] = useState<{ entry: PatternEntry; from: 'store' | 'library'; n: number } | null>(null);
  // 首页上传的图片，交给做拼豆页处理
  const [incoming, setIncoming] = useState<{ file: File; n: number } | null>(null);
  const [scrolled, setScrolled] = useState(false);
  // 深浅色：默认跟系统，手动切过就记住
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem('bead-theme');
      if (saved) return saved === 'dark';
    } catch { /* 读不到就跟系统 */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  // 切换深浅色：新主题以点击位置为圆心、边缘柔和地向外扩散铺满整页（View Transitions + CSS 遮罩，不复制页面、不加覆盖层）。
  // 键盘触发时圆心在按钮中心；浏览器不支持或开了「减少动态效果」就直接切
  const toggleTheme = (ev: ReactMouseEvent<HTMLButtonElement>) => {
    const next = !dark;
    const apply = () => {
      document.documentElement.classList.toggle('dark', next);
      flushSync(() => setDark(next));
    };
    try {
      localStorage.setItem('bead-theme', next ? 'dark' : 'light');
    } catch { /* 存不下就只在本次有效 */ }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof document.startViewTransition !== 'function') return apply();
    let x = ev.clientX, y = ev.clientY;
    if (!x && !y) {
      const r = ev.currentTarget.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    const root = document.documentElement.style;
    root.setProperty('--theme-x', `${x}px`);
    root.setProperty('--theme-y', `${y}px`);
    const t = document.startViewTransition(apply);
    // 标签页在后台时动画会被拒绝，但主题照样切换，报错吞掉
    t.ready.catch(() => {});
    t.updateCallbackDone.catch(() => {});
    t.finished.catch(() => {});
  };

  useEffect(() => {
    const onHash = (e: HashChangeEvent) => {
      const from = new URL(e.oldURL).hash;
      if (parse(window.location.hash) === 'terms' && parse(from) !== 'terms') setBackHash(from || '#/');
      setRoute(parse(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const open = (entry: PatternEntry, from: 'store' | 'library') => {
    // 还存着没收藏的草稿：拿去改的图纸会顶掉它，打开收藏也会清掉它，先问一句
    const draft = loadDraft();
    if (draft && !window.confirm(`上次没收藏的图纸${draft.name !== '未命名' ? `「${draft.name}」` : ''}会被替换，找不回来了。继续吗？`)) return;
    setOpened(o => ({ entry, from, n: (o?.n ?? 0) + 1 }));
    window.location.hash = '#/make';
  };
  // 首页也能粘贴图片，粘贴后去做豆图页（做豆图页自己处理粘贴）
  useEffect(() => {
    if (route !== 'home') return;
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromPaste(e);
      if (!file) return;
      e.preventDefault();
      setIncoming(i => ({ file, n: (i?.n ?? 0) + 1 }));
      window.location.hash = '#/make';
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [route]);

  const startWith = (file: File) => {
    setIncoming(i => ({ file, n: (i?.n ?? 0) + 1 }));
    window.location.hash = '#/make';
  };

  return (
    <div className={`app page-${route}`}>
      <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
        {/* 顶栏底线和左右外框竖线的交点：放在吸顶的顶栏里，滚动时跟着顶栏停在原处 */}
        <span className="rails" aria-hidden />
        <div className="topbar-in">
          <div className="topbar-start">
            <a className="brand" href="#/" aria-label="DouDou 首页">
              <Logo size={24} animated />
              <span>DouDou</span>
            </a>
            <span className="crumb-sep" aria-hidden>/</span>
            <TopNav items={NAV} current={route} />
          </div>
          <div className="topbar-end">
            {/* 做豆图页：图纸名字（点了就能改）和收藏 / 导入 / 下载放在一起（编辑器渲染进来），别的页面是空的 */}
            <div id="page-title" className="page-title" />
            <div id="page-actions" className="page-actions" />
            <button className="theme-toggle" onClick={toggleTheme} aria-label={dark ? '切换到浅色' : '切换到深色'} title={dark ? '浅色' : '深色'}>
              {dark
                ? <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
                : <svg viewBox="0 0 24 24" aria-hidden><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
            </button>
            <a className="btn soft pill github" href={REPO} target="_blank" rel="noreferrer">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>
              GitHub
            </a>
          </div>
        </div>
      </header>

      <main className="frame">
        {route === 'home' && <Home onFile={startWith} />}
        {/* 做拼豆页一直挂着，切到别的页只是藏起来，回来时图纸和选项还在 */}
        <section className="frame-row view" hidden={route !== 'make'}>
          <div className="cell">
            <Generator key={opened?.n ?? 0} opened={opened?.entry ?? null} incoming={incoming} active={route === 'make'} />
          </div>
        </section>
        {(route === 'patterns' || route === 'mine') && <Patterns tab={route === 'mine' ? 'mine' : 'library'} onOpen={open} />}
        {route === 'colors' && <Colors />}
        {route === 'terms' && <Terms backHash={backHash} />}
        <footer className="frame-row foot">
          <div className="cell foot-in">
            <p className="fine">色号整理自公开 MARD 色卡 · 抠图 U²-Netp（Apache-2.0）· 像素字体 Fusion Pixel（OFL）· MIT 开源 · <a href={REPO} target="_blank" rel="noreferrer">GitHub</a> · <a href="#/terms">用户协议</a></p>
          </div>
        </footer>
      </main>

    </div>
  );
}
