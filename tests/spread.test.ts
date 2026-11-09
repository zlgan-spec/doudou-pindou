// 拉人的三个平台接口（发笔记 / 关注作者 / 分享）：预填文案守平台限制；接口不存在或版本不够就不出入口；关注只提一次
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '../src/platform/xhs/kv';

type Fake = Record<string, unknown>;
function install(miniTool: Fake, buildVersion = 9530001) {
  (globalThis as unknown as { window: unknown }).window = { xhs: { launchOptions: { miniToolEnv: { buildVersion } }, miniTool } };
}
const follow = {
  getFollowStatus: vi.fn(() => Promise.resolve({ follow_status: 0 })),
  followAuthor: vi.fn(() => Promise.resolve({ follow_status: 1 })),
};
const full = {
  writeTempFile: vi.fn((o: { data: string }) => Promise.resolve({ filePath: `/tmp/${o.data.length}.png` })),
  postNote: vi.fn((_o: unknown) => Promise.resolve({})),
  ...follow,
};

// initSpread 每次都从头判断，不用重置模块（重置了 kv 也会变成另一份）
const load = () => import('../src/platform/xhs/spread');

beforeEach(() => {
  kv.removeItem('doudou-follow-asked-v1');
  vi.clearAllMocks();
});

describe('预填的笔记文案', () => {
  it('标题不超过 20 字、正文不超过 1000 字，带两个话题，不写原创、不放网址', async () => {
    const { NOTE_TITLE, NOTE_CONTENT } = await load();
    expect(NOTE_TITLE.length).toBeLessThanOrEqual(20);
    expect(NOTE_CONTENT.length).toBeLessThanOrEqual(1000);
    expect(NOTE_CONTENT).toContain('#拼豆图纸');
    expect(NOTE_CONTENT).toContain('#小红书小工具');
    expect(`${NOTE_TITLE}${NOTE_CONTENT}`).not.toMatch(/原创|https?:|www\.|\.com|\.cn/i);
  });
});

describe('入口开不开', () => {
  it('不在小红书里：都没有', async () => {
    (globalThis as unknown as { window: unknown }).window = {};
    const m = await load();
    await m.initSpread();
    expect(m.afterSaveActions(['data:x'], () => {})).toEqual([]);
  });
  it('接口齐、版本够：发笔记 + 关注作者', async () => {
    install(full);
    const m = await load();
    await m.initSpread();
    expect(m.afterSaveActions(['data:x'], () => {}).map(a => a.label)).toEqual(['发笔记', '关注作者']);
  });
  it('9.52：关注照常；9.50：关注不出现', async () => {
    install(full, 9520003);
    let m = await load();
    await m.initSpread();
    expect(m.afterSaveActions(['data:x'], () => {}).map(a => a.label)).toEqual(['发笔记', '关注作者']);
    kv.removeItem('doudou-follow-asked-v1');
    install(full, 9500001);
    m = await load();
    await m.initSpread();
    expect(m.afterSaveActions(['data:x'], () => {}).map(a => a.label)).toEqual(['发笔记']);
    expect(follow.getFollowStatus).toHaveBeenCalledTimes(1);
  });
  it('没有 postNote 就没有「发笔记」', async () => {
    const { postNote: _p, ...rest } = full;
    void _p;
    install(rest);
    const m = await load();
    await m.initSpread();
    expect(m.afterSaveActions(['data:x'], () => {}).map(a => a.label)).toEqual(['关注作者']);
  });
});

describe('关注作者', () => {
  it('已关注或作者本人不提', async () => {
    for (const follow_status of [1, 2, -1]) {
      install({ ...full, getFollowStatus: () => Promise.resolve({ follow_status }) });
      const m = await load();
      await m.initSpread();
      expect(m.afterSaveActions(['data:x'], () => {}).map(a => a.label)).toEqual(['发笔记']);
    }
  });
  it('提过一次就记下，下次启动不再查、不再提', async () => {
    install(full);
    let m = await load();
    await m.initSpread();
    m.afterSaveActions(['data:x'], () => {});
    expect(kv.getItem('doudou-follow-asked-v1')).toBe('1');
    expect(m.afterSaveActions(['data:x'], () => {}).map(a => a.label)).toEqual(['发笔记']);
    m = await load();
    await m.initSpread();
    expect(m.afterSaveActions(['data:x'], () => {}).map(a => a.label)).toEqual(['发笔记']);
    expect(follow.getFollowStatus).toHaveBeenCalledTimes(1);
  });
  it('点了关注只调平台接口，成功、取消都不再多说一句', async () => {
    install(full);
    const m = await load();
    await m.initSpread();
    const said: string[] = [];
    const [, followAct] = m.afterSaveActions(['data:x'], t => said.push(t));
    followAct.run();
    await new Promise(r => setTimeout(r, 0));
    expect(follow.followAuthor).toHaveBeenCalledTimes(1);
    expect(said).toEqual([]);
    install({ ...full, followAuthor: () => Promise.reject({ errCode: 20002, errMsg: 'followAuthor:fail cancel' }) });
    kv.removeItem('doudou-follow-asked-v1');
    const m2 = await load();
    await m2.initSpread();
    const said2: string[] = [];
    m2.afterSaveActions(['data:x'], t => said2.push(t))[1].run();
    await new Promise(r => setTimeout(r, 0));
    expect(said2).toEqual([]);
  });
});

describe('发笔记', () => {
  it('每张图先 writeTempFile 换成路径再传给 postNote，最多 18 张；成功不说「已发布」', async () => {
    install(full);
    const m = await load();
    await m.initSpread();
    const said: string[] = [];
    const urls = Array.from({ length: 20 }, (_, i) => `data:image/png;base64,${'a'.repeat(i + 1)}`);
    m.afterSaveActions(urls, t => said.push(t))[0].run();
    await new Promise(r => setTimeout(r, 0));
    expect(full.writeTempFile).toHaveBeenCalledTimes(18);
    expect(full.postNote).toHaveBeenCalledTimes(1);
    const arg = full.postNote.mock.calls[0][0] as { title: string; content: string; pageType: string; mediaInfo: { image_resources: Array<{ url: string }> } };
    expect(arg.title).toBe(m.NOTE_TITLE);
    expect(arg.content).toBe(m.NOTE_CONTENT);
    expect(arg.pageType).toBe('photo_publish');
    expect(arg.mediaInfo.image_resources).toHaveLength(18);
    expect(arg.mediaInfo.image_resources[0].url).toMatch(/^\/tmp\//);
    expect(said).toEqual([]);
  });
  it('拉不起发布页时说原因；用户取消不说', async () => {
    install({ ...full, postNote: () => Promise.reject({ errMsg: 'postNote:fail no permission' }) });
    const m = await load();
    await m.initSpread();
    const said: string[] = [];
    m.afterSaveActions(['data:x'], t => said.push(t))[0].run();
    await new Promise(r => setTimeout(r, 0));
    expect(said).toEqual(['没能打开发布页（no permission）']);
    install({ ...full, postNote: () => Promise.reject({ errMsg: 'postNote:fail user cancel' }) });
    const m2 = await load();
    await m2.initSpread();
    const said2: string[] = [];
    m2.afterSaveActions(['data:x'], t => said2.push(t))[0].run();
    await new Promise(r => setTimeout(r, 0));
    expect(said2).toEqual([]);
  });
});
