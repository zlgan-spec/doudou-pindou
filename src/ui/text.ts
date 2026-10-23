// 文字 → 格子位图：用 12 像素的开源像素字体（Fusion Pixel Font，OFL 协议），一个像素就是一颗豆。
const FONT_FAMILY = 'FusionPixel12';
const FONT_PX = 12;
let fontReady: Promise<void> | null = null;

function loadFont(): Promise<void> {
  fontReady ??= (async () => {
    const face = new FontFace(FONT_FAMILY, `url(${import.meta.env.BASE_URL}fonts/fusion-pixel-12px-proportional-zh_hans.otf.woff2)`);
    await face.load();
    document.fonts.add(face);
  })();
  return fontReady;
}

/** 把一行文字画成位图（原始大小、不转），返回 bitmap[y][x]，true = 放豆；顺便把字体加载好 */
export async function textToBitmap(text: string): Promise<boolean[][]> {
  await loadFont();
  return rasterText(text, { scale: 1, angle: 0, bold: false, flip: false });
}

/**
 * 按大小和角度重新画一遍文字（字体要先用 textToBitmap 加载过）：
 * scale 是相对字体原始 12 像素的倍数，最小 1（再小汉字笔画就糊了）；angle 是弧度，顺时针；
 * bold 每一笔往右加厚，厚度跟着放大；flip 左右翻转（镜像版图纸）。返回 bitmap[y][x]，已去掉四周空白
 */
export function rasterText(text: string, opts: { scale: number; angle: number; bold: boolean; flip: boolean }): boolean[][] {
  const scale = Math.max(1, opts.scale);
  const size = FONT_PX * scale;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `${size}px ${FONT_FAMILY}`;
  const extra = opts.bold ? Math.max(1, Math.round(scale)) : 0;
  // 一个字一个字排：每个字只算它真正有笔画的宽度，字和字之间空出 1 颗豆（跟着放大），加粗多出的那笔不占这个空
  const gap = Math.max(1, Math.round(scale)) + extra;
  const chars = [...text].map(ch => {
    const m = probe.measureText(ch);
    const ink = Math.round(m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
    return ink > 0 ? { ch, left: Math.round(m.actualBoundingBoxLeft), w: ink } : { ch, left: 0, w: Math.round(m.width), blank: true };
  });
  const tw = Math.max(1, chars.reduce((sum, c) => sum + c.w, 0) + gap * Math.max(0, chars.length - 1) + extra);
  const side = Math.ceil(Math.hypot(tw, size)) + 4;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.translate(Math.floor(side / 2), Math.floor(side / 2)); // 整数位置：不转的时候像素字体正好落在格子上，不发虚
  ctx.rotate(opts.angle);
  ctx.font = `${size}px ${FONT_FAMILY}`;
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
