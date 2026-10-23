// 导出的图纸 PNG 里顺带存一份格子表格（PNG 的 tEXt 文本块，看图软件会忽略它），
// 以后把这张 PNG 拖回来就能还原成可编辑的图纸，不用另存工程文件。
import type { SizeId, StyleId } from '../core/config';
import type { Grid } from '../core/grid';
import { MAX_CUSTOM_SIDE, SIZES, STYLES, boardArea } from '../core/config';
import { PALETTE } from '../core/palette';

export interface PatternData {
  name: string;
  size: SizeId;
  style: StyleId;
  fullBoard: boolean;
  mirrored: boolean;
  grid: Grid;
}

const KEYWORD = 'bead-pattern';
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_SIDE = MAX_CUSTOM_SIDE; // 每边最多几颗：和自定义尺寸的上限一致（5×5 块 104 板）

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIG.every((b, i) => bytes[i] === b);
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
}

/** 在 IEND 前插入一个 tEXt 块 */
export async function embedPattern(png: Blob, data: PatternData): Promise<Blob> {
  const bytes = new Uint8Array(await png.arrayBuffer());
  if (!isPng(bytes)) return png;
  const payload = new TextEncoder().encode(`${KEYWORD}\0${toBase64(JSON.stringify({ v: 1, ...data }))}`);
  const type = new TextEncoder().encode('tEXt');
  const chunk = new Uint8Array(12 + payload.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set(type, 4);
  chunk.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)));
  const iend = bytes.length - 12; // IEND 块固定 12 字节，在文件末尾
  return new Blob([bytes.subarray(0, iend), chunk, bytes.subarray(iend)], { type: 'image/png' });
}

/** 读出本站导出的图纸数据；不是本站的图、数据不完整或不合法都返回 null */
export async function readPattern(file: Blob): Promise<PatternData | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 20 || !isPng(bytes)) return null;
  const view = new DataView(bytes.buffer);
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (type === 'tEXt' && pos + 8 + len <= bytes.length) {
      const body = bytes.subarray(pos + 8, pos + 8 + len);
      const sep = body.indexOf(0);
      if (sep > 0 && new TextDecoder().decode(body.subarray(0, sep)) === KEYWORD) {
        try {
          return validatePatternData(JSON.parse(fromBase64(new TextDecoder().decode(body.subarray(sep + 1)))));
        } catch {
          return null;
        }
      }
    }
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  return null;
}

const CODES = new Set(PALETTE.map(c => c.code));

/** 名字：去掉看不见的控制字符和文字方向控制符（会让名字和文件名显示得和实际不一样），最多 60 字 */
export function cleanName(name: string): string {
  return name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 60);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 本地日期 YYYYMMDD（UTC 在凌晨会差一天） */
export function dateStamp(d = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** 下载文件名：DouDou_图纸名_日期.png；没起名的带上时分，同一天下载几张不重名；镜像版加 _镜像版 */
export function sheetFileName(name: string, mirrored: boolean, d = new Date()): string {
  const safe = cleanName(name).replace(/[\\/:*?"<>|]/g, '').trim();
  const label = safe && safe !== '未命名' ? `${safe}_${dateStamp(d)}` : `${dateStamp(d)}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `DouDou_${label}${mirrored ? '_镜像版' : ''}.png`;
}

/**
 * 读进来的图纸补成整块的豆板，图案相对位置不变：以前误以为 52 / 104 板最外一圈不能用，画成过 50×50 / 100×100
 * （中间还有一版转换只把 100 补到 102）；超过 104 的以前按 2 颗一档扩。都补成能装下它的板（或几块 104 拼成的范围），居中
 */
function fromOldBoard(grid: Grid): Grid {
  const { width, height } = boardArea(grid.width, grid.height);
  if (width === grid.width && height === grid.height) return grid;
  const ox = Math.floor((width - grid.width) / 2), oy = Math.floor((height - grid.height) / 2);
  const cells: (string | null)[] = new Array(width * height).fill(null);
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) cells[(y + oy) * width + x + ox] = grid.cells[y * grid.width + x];
  return { width, height, cells };
}

/** 图纸数据的统一校验：PNG 里读出来的、收藏里存的、备份文件导入的都走这里，不合格就整份丢掉 */
export function validatePatternData(d: unknown): PatternData | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const g = o.grid as Record<string, unknown> | undefined;
  if (!g || !Number.isInteger(g.width) || !Number.isInteger(g.height) || !Array.isArray(g.cells)) return null;
  const width = g.width as number, height = g.height as number;
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE || g.cells.length !== width * height) return null;
  if (!g.cells.every(c => c === null || (typeof c === 'string' && CODES.has(c)))) return null;
  const size = (Object.keys(SIZES) as SizeId[]).find(s => s === o.size) ?? 'small';
  const style = (Object.keys(STYLES) as StyleId[]).find(s => s === o.style) ?? 'sticker';
  const name = typeof o.name === 'string' ? cleanName(o.name) || '未命名' : '未命名';
  return { name, size, style, fullBoard: o.fullBoard === true, mirrored: o.mirrored === true, grid: fromOldBoard({ width, height, cells: g.cells as (string | null)[] }) };
}
