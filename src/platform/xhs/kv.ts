// 本地存储（小工具版）：小红书小工具不保证 localStorage 可用，推荐用平台的 Storage JS API（客户端 9.46+）。
// 平台接口是异步的，页面里原来的读写都是同步的，所以启动时先把所有 key 读进内存，之后同步读内存、写的时候顺手存到平台。
// 平台单个 key 最大 1 MB：超过的值拆成几段存（key#0、key#1…），另存一个段数。
// 平台接口不可用（低版本客户端、普通浏览器预览）时退回 localStorage，读写失败都当没存过。

const KEYS = ['bead-theme', 'bead-draft', 'bead-copied-color', 'bead-patterns-v1', 'bead-list-collapsed', 'doudou-guide-v1', 'bead-ref-window', 'doudou-follow-asked-v1'];
const CHUNK = 400 * 1024; // 按字符切；中文 UTF-8 最多 3 字节一个，400K 字符不会超过 1 MB 太多，留余量取 400K
const MIN_CLIENT = 9460;

interface MiniTool {
  setStorage?: (o: { key: string; data: string }) => Promise<unknown>;
  getStorage?: (o: { key: string }) => Promise<{ data: string | null }>;
  removeStorage?: (o: { key: string }) => Promise<unknown>;
  getLaunchOptions?: () => Promise<{ miniToolEnv?: { buildVersion?: unknown } }>;
}
interface XhsWindow { xhs?: { miniTool?: MiniTool; launchOptions?: { miniToolEnv?: { buildVersion?: unknown } } } }

const memory = new Map<string, string>();
let platform: MiniTool | null = null;

function miniTool(): MiniTool | null {
  const xhs = (window as unknown as XhsWindow).xhs;
  return (xhs && xhs.miniTool) || null;
}

/** 客户端 buildVersion（如 9462004 = 9.46.2 + 编译号 004），取不到是 0；spread.ts 也用它判版本 */
export async function buildVersion(): Promise<number> {
  const xhs = (window as unknown as XhsWindow).xhs;
  const sync = Number(xhs && xhs.launchOptions && xhs.launchOptions.miniToolEnv && xhs.launchOptions.miniToolEnv.buildVersion) || 0;
  if (sync) return sync;
  const mt = miniTool();
  if (!mt || typeof mt.getLaunchOptions !== 'function') return 0;
  try {
    const o = await mt.getLaunchOptions();
    return Number(o && o.miniToolEnv && o.miniToolEnv.buildVersion) || 0;
  } catch {
    return 0;
  }
}

// 平台存的 data 必须是 JSON 字符串，所以每个值先 JSON.stringify 一次
async function platformGet(mt: MiniTool, key: string): Promise<string | null> {
  try {
    const r = await mt.getStorage!({ key });
    if (!r || r.data == null) return null;
    const v = JSON.parse(r.data) as unknown;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

async function readPlatform(mt: MiniTool, key: string): Promise<string | null> {
  const parts = Number(await platformGet(mt, `${key}#n`)) || 0;
  if (!parts) return platformGet(mt, key);
  let out = '';
  for (let i = 0; i < parts; i++) {
    const part = await platformGet(mt, `${key}#${i}`);
    if (part == null) return null;
    out += part;
  }
  return out;
}

async function writePlatform(mt: MiniTool, key: string, value: string | null): Promise<void> {
  try {
    const old = Number(await platformGet(mt, `${key}#n`)) || 0;
    for (let i = 0; i < old; i++) await mt.removeStorage!({ key: `${key}#${i}` });
    if (old) await mt.removeStorage!({ key: `${key}#n` });
    if (value == null) {
      await mt.removeStorage!({ key });
      return;
    }
    if (value.length <= CHUNK) {
      await mt.setStorage!({ key, data: JSON.stringify(value) });
      return;
    }
    await mt.removeStorage!({ key });
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) await mt.setStorage!({ key: `${key}#${i}`, data: JSON.stringify(value.slice(i * CHUNK, (i + 1) * CHUNK)) });
    await mt.setStorage!({ key: `${key}#n`, data: JSON.stringify(String(n)) });
  } catch {
    /* 存不下就算了：内存里还有，这次打开期间照常用 */
  }
}

// 同一个 key 的写入排队，避免先写的后到
const queues = new Map<string, Promise<void>>();
function persist(key: string, value: string | null): void {
  const mt = platform;
  if (!mt) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* 存不下就算了 */ }
    return;
  }
  const prev = queues.get(key) || Promise.resolve();
  queues.set(key, prev.then(() => writePlatform(mt, key, value)));
}

/** 启动时调一次，读完再渲染页面 */
export async function initStorage(): Promise<void> {
  const mt = miniTool();
  if (mt && typeof mt.setStorage === 'function' && typeof mt.getStorage === 'function' && typeof mt.removeStorage === 'function'
    && Math.floor((await buildVersion()) / 1000) >= MIN_CLIENT) {
    platform = mt;
    for (const key of KEYS) {
      const v = await readPlatform(mt, key);
      if (v != null) memory.set(key, v);
    }
    return;
  }
  for (const key of KEYS) {
    try {
      const v = localStorage.getItem(key);
      if (v != null) memory.set(key, v);
    } catch { /* 读不到就当没有 */ }
  }
}

/** 和 localStorage 一样的用法 */
export const kv = {
  getItem(key: string): string | null {
    return memory.has(key) ? memory.get(key)! : null;
  },
  setItem(key: string, value: string): void {
    memory.set(key, value);
    persist(key, value);
  },
  removeItem(key: string): void {
    memory.delete(key);
    persist(key, null);
  },
};
