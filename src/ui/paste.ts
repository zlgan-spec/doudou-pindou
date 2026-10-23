// 粘贴图片：从剪贴板里取第一张图片（网页上「复制图片」、截图、从访达复制的图片文件都行）。
// 光标在输入框里时只在剪贴板确实是图片的情况下才接管，粘贴文字照常。
import { isHeic } from './loadImage';

export function imageFromPaste(e: ClipboardEvent): File | null {
  const files = [...(e.clipboardData?.files ?? [])];
  const file = files.find(f => f.type.startsWith('image/') || isHeic(f));
  if (!file) return null;
  // 截图粘贴进来的文件名通常是 image.png，给它一个看得懂的名字
  return file.name && file.name !== 'image.png' ? file : new File([file], '粘贴的图片.png', { type: file.type || 'image/png' });
}
