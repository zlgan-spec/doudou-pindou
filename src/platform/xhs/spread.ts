// 帮账号拉人的两个平台接口（小工具版）：发笔记 postNote（§3.3）、关注作者 followAuthor / getFollowStatus（§3.15，客户端 9.51+）。
// 分享不做：容器右上角自带分享按钮（getWindowInfo.menuButtons.share），2026-11-09 Ruby 真机确认后删掉。
// 两个都先探测方法存在、版本够不够，不够就当没有：入口不出现、不报错。启动时 initSpread() 查一次（在 initStorage 之后，要读 kv）。
import { buildVersion, kv } from './kv';
import type { NoteAction } from '../types';

interface MiniTool {
  writeTempFile?: (o: { data: string }) => Promise<{ filePath: string }>;
  postNote?: (o: { title?: string; content?: string; pageType?: string; mediaInfo: { image_resources: Array<{ url: string }> } }) => Promise<unknown>;
  getFollowStatus?: () => Promise<{ follow_status: number }>;
  followAuthor?: () => Promise<{ follow_status: number }>;
}

/** 预填的笔记标题（平台上限 20 字）和正文（上限 1000 字）。不写「原创」（用户的原图可能是别人的）、不放网址 */
export const NOTE_TITLE = '我用 DouDou 做的拼豆图纸';
export const NOTE_CONTENT = '图片一键转图纸，色号都标好了，照着拼就行。\n#拼豆图纸 #小红书小工具';
const FOLLOW_ASKED_KEY = 'doudou-follow-asked-v1'; // 这台设备提过「关注作者」就记下来，只提一次
const MIN_FOLLOW = 9510;
const MAX_IMAGES = 18;

let noteOn = false;
let followOffer = false; // 还没提过、查到是「未关注」：下次存图成功时提一句

function miniTool(): MiniTool | null {
  const xhs = (window as unknown as { xhs?: { miniTool?: MiniTool } }).xhs;
  return (xhs && xhs.miniTool) || null;
}

function reason(e: unknown): string {
  const m = e && typeof e === 'object' && 'errMsg' in e ? String((e as { errMsg: unknown }).errMsg) : e instanceof Error ? e.message : String(e);
  return m.replace(/^\w+:fail\s*/, '').slice(0, 60) || '未知原因';
}

/** 启动时调一次（initStorage 之后）：按方法和客户端版本定三个入口开不开；关注状态在后台查，不耽误页面出来 */
export async function initSpread(): Promise<void> {
  noteOn = followOffer = false;
  const mt = miniTool();
  if (!mt) return;
  const client = Math.floor((await buildVersion()) / 1000);
  noteOn = typeof mt.postNote === 'function' && typeof mt.writeTempFile === 'function';
  const status = client >= MIN_FOLLOW && typeof mt.followAuthor === 'function' && typeof mt.getFollowStatus === 'function' ? mt.getFollowStatus.bind(mt) : null;
  if (!status || kv.getItem(FOLLOW_ASKED_KEY)) return;
  try {
    const r = await status();
    followOffer = !!r && r.follow_status === 0; // 已关注（1）、作者本人（2）、查不到（-1）都不提
  } catch { /* 当查不到 */ }
}

/** 存相册成功后提示条里的按钮：发笔记、（这台设备第一次）关注作者。say 是提示条 */
export function afterSaveActions(urls: string[], say: (text: string) => void): NoteAction[] {
  const out: NoteAction[] = [];
  if (noteOn) out.push({ label: '发笔记', run: () => postNote(urls, say) });
  if (followOffer) {
    followOffer = false;
    kv.setItem(FOLLOW_ASKED_KEY, '1');
    out.push({ label: '关注作者', run: follow });
  }
  return out;
}

// 和存相册一样：点击里就开始写临时文件，写完立刻拉发布页，中间不等别的
function postNote(urls: string[], say: (text: string) => void): void {
  const mt = miniTool();
  if (!mt || typeof mt.postNote !== 'function' || typeof mt.writeTempFile !== 'function') return;
  const write = mt.writeTempFile.bind(mt);
  const post = mt.postNote.bind(mt);
  Promise.all(urls.slice(0, MAX_IMAGES).map(data => write({ data })))
    .then(files => post({ title: NOTE_TITLE, content: NOTE_CONTENT, pageType: 'photo_publish', mediaInfo: { image_resources: files.map(f => ({ url: f.filePath })) } }))
    .then(() => { /* 成功只代表发布页被拉起、用户点了发布，审核结果这里不知道：不说「已发布」 */ })
    .catch(e => { if (!/cancel|取消/i.test(reason(e))) say(`没能打开发布页（${reason(e)}）`); });
}

function follow(): void {
  const mt = miniTool();
  if (!mt || typeof mt.followAuthor !== 'function') return;
  // 平台自己的确认流程就是反馈：成功、用户关掉确认框、今天已弹满 10 次，这边都不再多说一句
  mt.followAuthor().catch(() => {});
}
