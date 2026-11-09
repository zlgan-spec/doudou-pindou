// 网站版（默认构建，GitHub Pages）：浏览器什么都有。
// 存储 localStorage；保存图纸直接下载（分板打 zip）；抠图模型和出图都在 Worker 里跑；图纸库从 public/patterns/ 读；HEIC 用 heic2any 转。
import type { Grid } from '../../core/grid';
import type { RgbaImage } from '../../core/image';
import { generatePattern, generateRich, type PatternInput, type PatternOptions } from '../../core/pipeline';
import type { ExportImage, Platform } from '../types';
import { copy } from './copy';
import { makeZip } from './zip';

// 出图线程：起不来就退回在页面里算
let genWorker: Worker | null = null;
let genBroken = false;
let genId = 0;
function warmUp(): void {
  if (genBroken) return;
  try {
    genWorker ??= new Worker(new URL('../../workers/generate.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    genBroken = true;
  }
}
function generate(input: PatternInput, options: PatternOptions, rich: boolean): Promise<Grid> {
  warmUp();
  const run = () => (rich ? generateRich : generatePattern)(input, options);
  if (genBroken || !genWorker) return Promise.resolve().then(run);
  const w = genWorker;
  const id = ++genId;
  return new Promise((resolve, reject) => {
    const done = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data.id !== id) return;
      done();
      if (event.data.grid) resolve(event.data.grid);
      else reject(new Error(event.data.message));
    };
    const onError = () => {
      done();
      genBroken = true;
      resolve(run());
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ id, input, options, rich });
  });
}

// 抠图模型（U²-Netp，onnxruntime-web）在另一个 Worker 里跑
let cutWorker: Worker | null = null;
let cutId = 0;
function cutoutModel(image: RgbaImage, onLoading: () => void): Promise<Float32Array> {
  cutWorker ??= new Worker(new URL('../../workers/cutout.worker.ts', import.meta.url), { type: 'module' });
  const id = ++cutId;
  const w = cutWorker;
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') {
        if (msg.phase === 'loading') onLoading();
        return;
      }
      w.removeEventListener('message', onMessage);
      if (msg.type === 'result') resolve(new Float32Array(msg.mask));
      else reject(new Error(msg.message));
    };
    w.addEventListener('message', onMessage);
    const pixels = image.data.slice().buffer;
    w.postMessage({ id, width: image.width, height: image.height, pixels, base: import.meta.env.BASE_URL }, [pixels]);
  });
}

function isHeic(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
}

function dataUrlBytes(url: string): Uint8Array<ArrayBuffer> {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function download(blob: Blob, fileName: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const storage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
  removeItem: (key: string) => localStorage.removeItem(key),
};

export const platform: Platform = {
  id: 'web',
  caps: {
    themeToggle: true,
    externalLinks: true,
    backup: true,
  },
  fullscreen: {
    enter: () => document.documentElement.requestFullscreen?.().catch(() => { /* 不支持就只铺满窗口 */ }),
    exit: () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); },
  },
  copyText: text => navigator.clipboard.writeText(text),
  copy,
  boot: () => Promise.resolve(), // 主题防闪烁由 vite.config.ts 注入的内联脚本在渲染前做
  storage,
  async decodeImage(file) {
    if (!isHeic(file)) return file;
    const { default: heic2any } = await import('heic2any');
    const out = await heic2any({ blob: file, toType: 'image/png' });
    return Array.isArray(out) ? out[0] : out;
  },
  cutoutModel,
  warmUp,
  generate,
  loadLibraryData: () => fetch(`${import.meta.env.BASE_URL}patterns/index.json`).then(r => (r.ok ? r.json() : null)),
  /** 下载的清晰度：小图放大画，大图按 1 倍，色号都看得清 */
  exportScale: grid => (grid.width > 104 ? 1 : grid.width > 80 ? 1.5 : 2),
  exportSheet(req) {
    // 让「正在下载」先显示出来再开始画（大图要一两秒）
    return new Promise<void>(resolve => {
      window.setTimeout(() => {
        try {
          const images: ExportImage[] = req.build(true);
          if (images.length === 1) download(new Blob([dataUrlBytes(images[0].url)], { type: 'image/png' }), req.fileName);
          else download(makeZip(images.map(i => ({ name: i.name, data: dataUrlBytes(i.url) }))), req.fileName.replace(/\.png$/, '.zip'));
        } finally {
          resolve();
        }
      }, 30);
    });
  },
  onNote: () => () => {},
  Host: null,
};
