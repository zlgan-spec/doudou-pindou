// 小红书小工具版（vite build --mode xhs）。容器的限制见官方能力清单：
// 禁 WebAssembly 和 Worker（没有抠图模型、出图在页面里算）、禁 fetch（图纸库打进包里）、禁文件下载（存相册）、
// localStorage 不保证（用平台存储）、禁剪贴板 / 外链 / 全屏、沉浸式全屏要给状态栏和小红书按钮让位、要兼容 Android 8.1 / Chrome 61。
import './polyfills';
import type { Grid } from '../../core/grid';
import { generatePattern, generateRich, type PatternInput, type PatternOptions } from '../../core/pipeline';
import { sheetLayout } from '../../render/sheet';
import type { Platform } from '../types';
import libraryData from 'virtual:library-data';
import { onAlbumNote } from './album';
import { markFlexGap } from './compat';
import { copy } from './copy';
import { ExportHost, openExport } from './ExportSheet';
import { initStorage, kv } from './kv';
import { initSafeArea } from './safeArea';
import { initSpread } from './spread';

// 小工具不允许内联脚本：主题（深色 / 浅色）在渲染前设好，之后 App 跟着系统变
function applyTheme(): void {
  try {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark');
  } catch { /* 用浅色 */ }
}

export const platform: Platform = {
  id: 'xhs',
  caps: {
    themeToggle: false,
    externalLinks: false,
    backup: false,
  },
  // 全屏由小红书容器管；剪贴板容器不开放
  fullscreen: null,
  copyText: null,
  copy,
  async boot() {
    // initSpread 要在 initStorage 之后（读「提过关注没有」）；它只查版本，不等网络
    await Promise.all([initStorage().then(initSpread), initSafeArea()]);
    markFlexGap();
    applyTheme();
  },
  storage: kv,
  // 不带 HEIC 解码库：小红书的选图器交过来的一般已是 JPG / PNG；万一还是 HEIC，交给系统解码，解不了就报错
  decodeImage: file => Promise.resolve(file),
  cutoutModel: null,
  warmUp() {},
  // 出图在页面里算，先让出一帧，让「生成中」先画出来
  generate(input: PatternInput, options: PatternOptions, rich: boolean): Promise<Grid> {
    return new Promise(resolve => setTimeout(resolve, 16)).then(() => (rich ? generateRich : generatePattern)(input, options));
  },
  loadLibraryData: () => Promise.resolve(libraryData),
  /** 存相册的清晰度：长边约 2400 像素（手机相册放大看色号够清楚；再大手机上编码要好几秒） */
  exportScale(grid: Grid): number {
    const L = sheetLayout(grid);
    return Math.min(2, 2400 / Math.max(L.width, L.height));
  },
  exportSheet(req) {
    openExport(req);
    return Promise.resolve();
  },
  onNote: onAlbumNote,
  Host: ExportHost,
};
