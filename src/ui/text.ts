// 文字 → 格子位图：字体都是开源的（SIL OFL），随网站一起发，不靠手机里装了什么字体。
// 像素字体一个像素就是一颗豆；普通字体按 14～16 像素起画，再小汉字笔画就断了。
// 小像素、圆体、黄油体只带常用字（GB2312 一级字 + 英文标点），没带的字用默认像素字补上；
// 得意黑的许可不许改过的版本再叫这个名字，所以用原版文件、不裁字。
export type TextFont = 'pixel' | 'mini' | 'round' | 'butter' | 'smiley';
// 下拉里的名字都在四个字以内（全名太长，放在小窗里怪）：缝合像素字体 12 / 8 像素、资源圆体、站酷庆科黄油体、得意黑
export const TEXT_FONTS: { id: TextFont; label: string }[] = [
  { id: 'pixel', label: '像素字体' },
  { id: 'mini', label: '小像素体' },
  { id: 'round', label: '圆体' },
  { id: 'butter', label: '黄油体' },
  { id: 'smiley', label: '得意黑体' },
];
const FONTS: Record<TextFont, { family: string; file: string; px: number }> = {
  pixel: { family: 'FusionPixel12', file: 'fusion-pixel-12px-proportional-zh_hans.otf.woff2', px: 12 },
  mini: { family: 'FusionPixel8', file: 'fusion-pixel-8px-proportional-zh_hans-common.woff2', px: 8 },
  round: { family: 'ResourceHanRounded', file: 'resource-han-rounded-cn-bold-common.woff2', px: 14 }, // 圆体字面宽，14 像素起，四个字能放进 52 板
  butter: { family: 'ZcoolQingKeHuangYou', file: 'zcool-qingke-huangyou-common.woff2', px: 16 },
  smiley: { family: 'SmileySans', file: 'SmileySans-Oblique.ttf.woff2', px: 16 },
};
const loading: Partial<Record<TextFont, Promise<void>>> = {};
const loaded = new Set<TextFont>();

/** 用到哪个字体才下载哪个；默认像素字总会一起加载，给别的字体补字 */
function loadFont(id: TextFont): Promise<void> {
  const one = (f: TextFont) =>
    (loading[f] ??= (async () => {
      const face = new FontFace(FONTS[f].family, `url(${import.meta.env.BASE_URL}fonts/${FONTS[f].file})`);
      await face.load();
      document.fonts.add(face);
      loaded.add(f);
    })().catch(e => {
      delete loading[f]; // 没下载成功：下次再选这个字体时重新下载
      throw e;
    }));
  return Promise.all([one('pixel'), one(id)]).then(() => undefined);
}

/** 字体已经下载好了（没好时 rasterText 会用错字体画） */
export const fontLoaded = (id: TextFont) => loaded.has(id) && loaded.has('pixel');

const cssFont = (id: TextFont, size: number) => `${size}px "${FONTS[id].family}", "${FONTS.pixel.family}"`;

/** 一个字真正有笔画的范围：left = 笔画起点在落笔点左边多远，w = 笔画宽；没有笔画（空格）返回 null */
function inkOf(ctx: CanvasRenderingContext2D, ch: string, size: number): { left: number; w: number } | null {
  const m = ctx.measureText(ch);
  if (typeof m.actualBoundingBoxLeft === 'number') {
    const ink = Math.round(m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
    return ink > 0 ? { left: Math.round(m.actualBoundingBoxLeft), w: ink } : null;
  }
  // 老安卓（Chrome 61）量不出笔画范围：画出来数一数哪几列有笔画
  const pad = size, w = Math.ceil(m.width) + pad * 2, h = size * 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.font = ctx.font;
  g.textBaseline = 'top';
  g.fillText(ch, pad, size / 2);
  const { data } = g.getImageData(0, 0, w, h);
  let x0 = w, x1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] < 128) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
  }
  return x1 < 0 ? null : { left: pad - x0, w: x1 - x0 + 1 };
}

/** 把一行文字画成位图（原始大小、不转），返回 bitmap[y][x]，true = 放豆；顺便把字体加载好 */
export async function textToBitmap(text: string, font: TextFont): Promise<boolean[][]> {
  await loadFont(font);
  return rasterText(text, { font, scale: 1, angle: 0, bold: false, flip: false });
}

/**
 * 按大小和角度重新画一遍文字（字体要先用 textToBitmap 加载过）：
 * scale 是相对字体起画大小（像素字体的原始像素、普通字体 14～16 像素）的倍数，最小 1（再小汉字笔画就糊了）；angle 是弧度，顺时针；
 * bold 每一笔往右加厚，厚度跟着放大；flip 左右翻转（镜像版图纸）。返回 bitmap[y][x]，已去掉四周空白
 */
export function rasterText(text: string, opts: { font: TextFont; scale: number; angle: number; bold: boolean; flip: boolean }): boolean[][] {
  const scale = Math.max(1, opts.scale);
  const size = FONTS[opts.font].px * scale;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = cssFont(opts.font, size);
  const extra = opts.bold ? Math.max(1, Math.round(scale)) : 0;
  // 一个字一个字排：每个字只算它真正有笔画的宽度，字和字之间空出 1 颗豆（跟着放大），加粗多出的那笔不占这个空
  const gap = Math.max(1, Math.round(scale)) + extra;
  const chars = [...text].map(ch => {
    const ink = inkOf(probe, ch, size);
    return ink ? { ch, ...ink } : { ch, left: 0, w: Math.round(probe.measureText(ch).width), blank: true };
  });
  const tw = Math.max(1, chars.reduce((sum, c) => sum + c.w, 0) + gap * Math.max(0, chars.length - 1) + extra);
  const side = Math.ceil(Math.hypot(tw, size * 1.5)) + 4; // 普通字体的 g、y 会掉到字号下面，多留点
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.translate(Math.floor(side / 2), Math.floor(side / 2)); // 整数位置：不转的时候像素字体正好落在格子上，不发虚
  ctx.rotate(opts.angle);
  ctx.font = cssFont(opts.font, size);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000';
  let cursor = Math.round(-tw / 2);
  const top = Math.round(-size / 2);
  for (const c of chars) {
    if (!('blank' in c)) for (let i = 0; i <= extra; i++) ctx.fillText(c.ch, cursor + c.left + i, top);
    cursor += c.w + gap;
  }
  const { data } = ctx.getImageData(0, 0, side, side);
  let x0 = side, y0 = side, x1 = -1, y1 = -1;
  const on = (x: number, y: number) => data[(y * side + x) * 4 + 3] >= 128;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    if (!on(x, y)) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return [];
  const rows: boolean[][] = [];
  for (let y = y0; y <= y1; y++) {
    const row: boolean[] = [];
    for (let x = x0; x <= x1; x++) row.push(on(x, y));
    rows.push(opts.flip ? row.reverse() : row);
  }
  return rows;
}
