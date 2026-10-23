// 页面之间顺手带过去的一点信息：在色卡库点了哪个色号，回到做豆图时拿来当画笔颜色。
// 不读剪贴板（浏览器会弹窗要权限），只记站内点过的；存在当前浏览器里，用一次就清掉。
import { PALETTE } from '../core/palette';

const KEY = 'bead-copied-color';
const MAX_AGE = 10 * 60 * 1000; // 10 分钟内复制的才算"刚复制"
const CODES = new Set(PALETTE.map(c => c.code));

export function rememberCopiedColor(code: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // 隐私模式等存不了：这个顺手功能就不生效，不影响复制本身
  }
}

/** 取出刚复制的色号并清掉；过期、不在色卡里、读不了都返回 null */
export function takeCopiedColor(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const v = JSON.parse(raw) as { code?: unknown; at?: unknown };
    if (typeof v.code !== 'string' || !CODES.has(v.code) || typeof v.at !== 'number' || Date.now() - v.at > MAX_AGE) return null;
    return v.code;
  } catch {
    return null;
  }
}
