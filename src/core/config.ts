// 尺寸和风格参数。尺寸规则见 docs/how-it-works.md；风格 = 同一条流水线的一组参数。

export type SizeId = 'small' | 'medium' | 'large';
export type StyleId = 'sticker' | 'realistic';

export interface SizeSpec {
  id: SizeId;
  label: string;
  board: number;       // 豆板每边几颗（52 / 78 / 104，钉子有几排就能放几颗），图纸就画这么大
  maxSubject: number;  // 主体最长边（颗），四周留出安全边距
  maxColors: number;   // 建议色数：好买齐也好拼（界面上提示用）
  autoMaxColors: number; // 贴纸风自动选色的上限：颜色按图来，最多到这里
  realisticMaxColors: number; // 写实风颜色上限：照片马赛克需要更多色阶
  minRegion: number;   // 小于这个颗数的同色小块会并入相邻色块
  hint: string;
}

export const SIZES: Record<SizeId, SizeSpec> = {
  small: { id: 'small', label: '52×52', board: 52, maxSubject: 50, maxColors: 15, autoMaxColors: 20, realisticMaxColors: 30, minRegion: 3, hint: '52×52 豆板 · 约 14 cm · 钥匙扣、杯垫' },
  medium: { id: 'medium', label: '78×78', board: 78, maxSubject: 74, maxColors: 24, autoMaxColors: 30, realisticMaxColors: 40, minRegion: 4, hint: '78×78 豆板 · 约 20 cm · 头像、单个角色' },
  large: { id: 'large', label: '104×104', board: 104, maxSubject: 102, maxColors: 30, autoMaxColors: 40, realisticMaxColors: 50, minRegion: 5, hint: '104×104 豆板 · 约 27 cm · 复杂图案、照片' },
};

export const SAFE_MARGIN = 1;
/** 颜色数量最多到这里：同类工具一般给到 64 色，再多买豆、拼都太麻烦 */
export const MAX_COLORS = 64;
export const BEAD_MM = 2.6;
export const MIN_BEADS_PER_COLOR = 3;
export const MAX_ISLAND = 3;

export interface StyleSpec {
  id: StyleId;
  label: string;
  hint: string;
  chromaScale: number;       // 饱和度倍数（拼豆比照片更鲜明）
  warmth: number;            // 往暖色（橙）偏移的量
  contrast: number;          // 明暗对比
  lightStep: number;         // 亮度分级步长，0 = 不分级；越大色阶越少、色块越整
  coolShadows: boolean;      // 暗部往冷色偏
  colorTolerance: number;    // 减色允许的平均色差，越大颜色越少
  colorRatio: number;        // 实际颜色上限 = 尺寸上限 × 这个比例
  duplicateDistance: number; // 差别小于这个值的两个色号合并
  extraRegion: number;       // 在尺寸的最小色块基础上再加几颗，越大越平整
  smoothing: boolean;        // 减色前做保边平滑（抹掉毛发纹理，明暗成片）
  outline: 'dark' | 'black' | 'none';
}

// 两种风格对应两套豆图语法：
// 贴纸风 = 平涂、少色、同色系深描边、留白（卡通 / 像素画输入的默认）；
// 写实风 = 多色阶、无描边的照片马赛克，只适合中图大图（照片直转时的选项）。
export const STYLES: Record<StyleId, StyleSpec> = {
  sticker: {
    id: 'sticker', label: '贴纸风', hint: '颜色少、有描边，适合卡通和像素图',
    chromaScale: 1.3, warmth: 0.008, contrast: 1.08, lightStep: 0.11, coolShadows: true,
    colorTolerance: 0.045, colorRatio: 1, duplicateDistance: 0.06, extraRegion: 1, smoothing: true, outline: 'dark',
  },
  realistic: {
    id: 'realistic', label: '写实风', hint: '颜色多、不描边，适合照片，建议 78×78 以上',
    chromaScale: 1.1, warmth: 0, contrast: 1.02, lightStep: 0, coolShadows: false,
    colorTolerance: 0.025, colorRatio: 1, duplicateDistance: 0.03, extraRegion: 0, smoothing: false, outline: 'none',
  },
};

/** 尺寸规则：图案放进能装下它的最小那块豆板 52 / 78 / 104；超过 104 的返回 null */
export function boardFor(width: number, height: number): SizeId | null {
  const side = Math.max(width, height);
  return (Object.keys(SIZES) as SizeId[]).find(s => SIZES[s].board >= side) ?? null;
}

/** 自定义尺寸每边最多几颗：5×5 块 104 板 */
export const MAX_CUSTOM_SIDE = 520;

/** 参数档位（色数、清理力度）：放得进哪块标准板就按哪块，更大的按 104 */
export function tierFor(width: number, height: number): SizeId {
  return boardFor(width, height) ?? 'large';
}

/** 图案要放的豆板范围：放得进标准板就用能装下的最小那块；更大的用 104 板拼成的整块范围 */
export function boardArea(width: number, height: number): { width: number; height: number } {
  const s = boardFor(width, height);
  if (s) return { width: SIZES[s].board, height: SIZES[s].board };
  const { cols, rows } = boardTiles(width, height);
  return { width: cols * SIZES.large.board, height: rows * SIZES.large.board };
}

/** 图案（宽 bw、高 bh，任意单位）按比例放进 w×h 颗以内时，长边最多几颗 */
export function fitSide(bw: number, bh: number, w: number, h: number): number {
  const side = bw >= bh ? Math.min(w, Math.floor((h * bw) / bh)) : Math.min(h, Math.floor((w * bh) / bw));
  return Math.max(1, side);
}

/** 实物大约多大：一颗豆 2.6 mm，返回「约 14×14 cm」 */
export function cmLabel(width: number, height: number): string {
  const cm = (n: number) => Math.round((n * BEAD_MM) / 10);
  return `约 ${cm(width)}×${cm(height)} cm`;
}

/** 超过 104 的大图用几块 104×104 豆板拼：横几块、竖几块 */
export function boardTiles(width: number, height: number): { cols: number; rows: number } {
  const side = SIZES.large.board;
  return { cols: Math.ceil(width / side), rows: Math.ceil(height / side) };
}

/** 图纸、图纸库里写的豆板：「52×52 豆板」；超过 104 的写要拼几块 104×104 */
export function boardLabel(width: number, height: number): string {
  const s = boardFor(width, height);
  if (s) return `${SIZES[s].label} 豆板`;
  const { cols, rows } = boardTiles(width, height);
  return `需 ${cols * rows} 块 104×104 豆板拼（横 ${cols} × 竖 ${rows}）`;
}
