// 小红书小工具是沉浸式全屏：手机状态栏和小红书的返回 / 我的 / 分享按钮浮在页面最上面。
// 启动时读平台的窗口信息（getWindowInfo，客户端 9.49+），把页面内容整体往下推到这排按钮下面；
// 读不到时在小红书里按「系统安全区 + 一排按钮」估一个，普通浏览器里不推。
interface Rect { bottom: number }
interface WindowInfo { statusBarHeight?: number; menuButtons?: Record<string, Rect | null> }
interface MiniTool { getWindowInfo?: () => Promise<WindowInfo> }

function miniTool(): MiniTool | null {
  const xhs = (window as unknown as { xhs?: { miniTool?: MiniTool } }).xhs;
  return (xhs && xhs.miniTool) || null;
}

function set(top: string): void {
  document.documentElement.style.setProperty('--top-inset', top);
}

// 手机 WebView 里 100vh 常比真正看得见的高度大（算进了工具栏、键盘收起前的高度）：用 innerHeight 量真的，变了就重算
function setAppHeight(): void {
  document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
}

export async function initSafeArea(): Promise<void> {
  setAppHeight();
  window.addEventListener('resize', setAppHeight);
  window.addEventListener('orientationchange', () => window.setTimeout(setAppHeight, 300));
  const mt = miniTool();
  if (!mt) return; // 普通浏览器：不留位置
  set('calc(env(safe-area-inset-top, 20px) + 56px)'); // 先按估计值留出位置，避免一打开就被挡
  if (typeof mt.getWindowInfo !== 'function') return;
  try {
    const info = await mt.getWindowInfo();
    const bottoms = Object.values(info.menuButtons || {}).filter((r): r is Rect => !!r).map(r => r.bottom);
    const top = Math.max(info.statusBarHeight || 0, ...bottoms);
    if (top > 0) set(`${Math.ceil(top + 8)}px`);
  } catch { /* 用估计值 */ }
}
