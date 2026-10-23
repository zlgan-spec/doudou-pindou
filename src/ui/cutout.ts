// 抠图入口：图片自带透明背景 → 直接用；纯色背景 → 算法去除；其他 → 抠图模型。失败时退回不抠图。
import { alphaMask, cleanMask, dominantBorderMask, plainBackgroundMask, type Mask, type RgbaImage } from '../core/image';

export type CutoutMethod = 'alpha' | 'plain' | 'model' | 'failed';

export interface CutoutResult {
  mask: Mask | null;
  method: CutoutMethod;
}

let worker: Worker | null = null;
let nextId = 0;

function runModel(image: RgbaImage, onLoading: () => void): Promise<Float32Array> {
  worker ??= new Worker(new URL('../workers/cutout.worker.ts', import.meta.url), { type: 'module' });
  const id = ++nextId;
  const w = worker;
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

/** 抠出来几乎为空或几乎全满，说明没认出主体（比如整张纯色图），退回不抠图 */
function usable(mask: Mask): boolean {
  const covered = mask.data.reduce((n, v) => n + v, 0) / mask.data.length;
  return covered >= 0.02 && covered <= 0.98;
}

export interface CutoutOptions {
  /** 像素画只用透明 / 纯色背景两种办法；几十像素的小图跑模型没有意义 */
  allowModel?: boolean;
}

export async function cutout(image: RgbaImage, onLoading: () => void = () => {}, options: CutoutOptions = {}): Promise<CutoutResult> {
  const alpha = alphaMask(image);
  if (alpha) {
    const mask = cleanMask(alpha);
    return usable(mask) ? { mask, method: 'alpha' } : { mask: null, method: 'failed' };
  }
  const plain = plainBackgroundMask(image) ?? dominantBorderMask(image);
  if (plain) {
    const mask = cleanMask(plain);
    if (usable(mask)) return { mask, method: 'plain' };
  }
  if (options.allowModel === false) return { mask: null, method: 'failed' };
  try {
    const mask = cleanMask({ width: image.width, height: image.height, data: await runModel(image, onLoading) });
    return usable(mask) ? { mask, method: 'model' } : { mask: null, method: 'failed' };
  } catch {
    return { mask: null, method: 'failed' };
  }
}
