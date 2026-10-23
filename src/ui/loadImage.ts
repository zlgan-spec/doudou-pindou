// 读取用户选的图片：HEIC 先转成 PNG，再缩到最长边 1024 像素以内（更大没有意义，只会更慢、更占内存）。
import type { RgbaImage } from '../core/image';
import { stripChecker } from '../core/checker';
import { detectPixelGrid, resampleOnGrid } from '../core/pixelgrid';

const MAX_SIDE = 1024;

export function isHeic(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
}

async function toDecodableBlob(file: File): Promise<Blob> {
  if (!isHeic(file)) return file;
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/png' });
  return Array.isArray(out) ? out[0] : out;
}

export interface LoadedImage {
  image: RgbaImage;
  previewUrl: string;
  /** 识别为像素画时，image 已重采样为 1 像素 = 1 格；这里记录原始格数 */
  pixelArt: { cols: number; rows: number } | null;
  /** 原图（像素画重采样前的）：像素画格数比豆板还大时，改用它按普通图缩小 */
  original: RgbaImage;
}

/** 超过 30MB 的图片不读：浏览器会先完整解码再缩小，特别大的图会把页面卡死 */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export class FileTooLargeError extends Error {}

/** 解码前先看文件头里的宽高（PNG 的 IHDR、JPEG 的 SOF）：文件不大但像素极多的图，解码会占好几 GB 内存 */
const MAX_PIXELS = 40e6;
async function headerSize(file: File): Promise<[number, number] | null> {
  const b = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b.length >= 24) return [u32(16), u32(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [u16(i + 7), u16(i + 5)];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

export async function loadImage(file: File): Promise<LoadedImage> {
  if (file.size > MAX_FILE_BYTES) throw new FileTooLargeError('图片太大');
  const dims = await headerSize(file);
  if (dims && dims[0] * dims[1] > MAX_PIXELS) throw new FileTooLargeError('图片像素太多');
  const blob = await toDecodableBlob(file);
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, width, height);
  const full: RgbaImage = { width, height, data };
  // 「假透明」棋盘格背景改成真透明，预览也跟着显示透明
  if (stripChecker(full)) ctx.putImageData(new ImageData(data, width, height), 0, 0);
  const previewUrl = canvas.toDataURL('image/png');
  const grid = detectPixelGrid(full);
  if (grid && grid.cols >= 8 && grid.rows >= 8) {
    return { image: resampleOnGrid(full, grid), previewUrl, pixelArt: { cols: grid.cols, rows: grid.rows }, original: full };
  }
  return { image: full, previewUrl, pixelArt: null, original: full };
}
