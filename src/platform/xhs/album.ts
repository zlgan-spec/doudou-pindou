// 保存图纸到相册（小工具版）：小红书小工具不能下载文件，用平台的 writeTempFile + saveImageToPhotosAlbum（客户端 9.42+）。
// 平台要求「由用户主动操作（点击等）触发」：所以图在打开「存到相册」预览时就画好，
// 用户点按钮时 saveDataUrls 第一件事就是调平台接口，中间不等任何异步。
// 结果用底部提示条说一句；失败时带上平台返回的原因，方便真机排查。
// 全部存成功时提示条里带「发笔记」「关注作者」（能不能用由 spread.ts 判断）。
import type { Note, NoteAction } from '../types';
import { afterSaveActions } from './spread';

interface MiniTool {
  writeTempFile?: (o: { data: string }) => Promise<{ filePath: string }>;
  saveImageToPhotosAlbum?: (o: { filePath: string }) => Promise<unknown>;
}

export type AlbumNote = Note;
const listeners = new Set<(note: AlbumNote) => void>();
/** App 订阅提示条 */
export function onAlbumNote(fn: (note: AlbumNote) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function note(text: string, actions?: NoteAction[]): void {
  listeners.forEach(fn => fn({ text, actions }));
}

function miniTool(): MiniTool | null {
  const xhs = (window as unknown as { xhs?: { miniTool?: MiniTool } }).xhs;
  return (xhs && xhs.miniTool) || null;
}

function reason(e: unknown): string {
  const m = e && typeof e === 'object' && 'errMsg' in e ? String((e as { errMsg: unknown }).errMsg) : e instanceof Error ? e.message : String(e);
  return m.replace(/^\w+:fail\s*/, '').slice(0, 60) || '未知原因';
}

/** 能不能存相册（不在小红书 App 里就不能） */
export function albumAvailable(): boolean {
  const mt = miniTool();
  return !!mt && typeof mt.writeTempFile === 'function' && typeof mt.saveImageToPhotosAlbum === 'function';
}

/** 存一张或几张（大图分板时一块板一张）。必须在点击事件里同步调用；返回存成功的张数 */
export function saveDataUrls(urls: string[]): Promise<number> {
  const mt = miniTool();
  if (!mt || typeof mt.writeTempFile !== 'function' || typeof mt.saveImageToPhotosAlbum !== 'function') {
    note('请在小红书 App 里打开，才能保存到相册');
    return Promise.resolve(0);
  }
  const write = mt.writeTempFile.bind(mt);
  const save = mt.saveImageToPhotosAlbum.bind(mt);
  // 先把所有临时文件都开始写（第一张在点击里立刻发出），再按顺序存进相册
  const files = urls.map(data => write({ data }));
  let saved = 0;
  let failure = '';
  const run = files.reduce<Promise<void>>((prev, file) => prev.then(async () => {
    if (failure) return;
    try {
      const { filePath } = await file;
      await save({ filePath });
      saved++;
    } catch (e) {
      failure = reason(e);
    }
  }), Promise.resolve());
  return run.then(() => {
    if (saved === urls.length) note(urls.length > 1 ? `已保存 ${saved} 张到相册` : '已保存到相册', afterSaveActions(urls, note));
    else if (/auth|权限|deny|denied/i.test(failure)) note('没有相册权限：请在手机设置里允许小红书访问相册后再试');
    else if (saved) note(`保存了 ${saved} 张，还有 ${urls.length - saved} 张没存进相册（${failure}）`);
    else note(`没能保存到相册（${failure}）`);
    return saved;
  });
}
