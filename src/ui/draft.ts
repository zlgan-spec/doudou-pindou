// 草稿：做豆图里还没收藏的那张图纸，自动存在当前浏览器里（只存一张，新的覆盖旧的）。
// 刷新、关掉页面再回来，开始页上问一句要不要接着改；收藏之后就不再需要草稿。读的时候走和导入 PNG 一样的校验
import { platform } from '@platform';
import { cleanRef } from './library';
import { validatePatternData, type PatternData } from './pngData';

const KEY = 'bead-draft';
const MAX_AGE = 7 * 24 * 3600 * 1000; // 一周前的草稿不再提

/** ref：从图纸库拿去改的原图文件名，接着改时原图小窗还在 */
export interface Draft extends PatternData { savedAt: number; ref?: string }

export function saveDraft(d: PatternData & { ref?: string }) {
  try {
    platform.storage.setItem(KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
  } catch {
    // 存不下就算了：草稿只是兜底
  }
}

export function loadDraft(): Draft | null {
  try {
    const raw = JSON.parse(platform.storage.getItem(KEY) ?? 'null') as { savedAt?: unknown; ref?: unknown } | null;
    if (!raw || typeof raw.savedAt !== 'number' || Date.now() - raw.savedAt > MAX_AGE) return null;
    const data = validatePatternData(raw);
    const ref = cleanRef(raw.ref);
    return data ? { ...data, savedAt: raw.savedAt, ...(ref ? { ref } : {}) } : null;
  } catch {
    return null;
  }
}

export function clearDraft() {
  try {
    platform.storage.removeItem(KEY);
  } catch {
    // 忽略
  }
}
