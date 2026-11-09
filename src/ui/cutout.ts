// 抠图入口：图片自带透明背景 → 直接用；纯色背景 → 算法去除；其他 → 抠图模型（有模型的渠道）。失败时退回不抠图。
import { platform } from '@platform';
import { alphaMask, cleanMask, dominantBorderMask, plainBackgroundMask, type Mask, type RgbaImage } from '../core/image';

export type CutoutMethod = 'alpha' | 'plain' | 'model' | 'failed';

export interface CutoutResult {
  mask: Mask | null;
  method: CutoutMethod;
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
  const model = platform.cutoutModel;
  if (options.allowModel === false || !model) return { mask: null, method: 'failed' };
  try {
    const mask = cleanMask({ width: image.width, height: image.height, data: await model(image, onLoading) });
    return usable(mask) ? { mask, method: 'model' } : { mask: null, method: 'failed' };
  } catch {
    return { mask: null, method: 'failed' };
  }
}
