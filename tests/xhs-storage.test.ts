import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

test('小红书收藏写入失败时通知页面，本次仍能读取图纸', async () => {
  const committed = new Map<string, string>();
  const setStorage = vi.fn(async () => { throw new Error('quota exceeded'); });
  vi.stubGlobal('window', { xhs: { launchOptions: { miniToolEnv: { buildVersion: 9510000 } }, miniTool: {
    setStorage, getStorage: async ({ key }: { key: string }) => ({ data: committed.get(key) ?? null }),
    removeStorage: async ({ key }: { key: string }) => committed.delete(key),
  } } });
  const first = await import('../src/platform/xhs/kv');
  const failed = vi.fn();
  await first.initStorage(failed);
  expect(() => first.kv.setItem('bead-patterns-v1', 'test-collection')).not.toThrow();
  expect(first.kv.getItem('bead-patterns-v1')).toBe('test-collection');
  await vi.waitFor(() => expect(setStorage).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(failed).toHaveBeenCalledWith('bead-patterns-v1'));
  vi.resetModules();
  const reopened = await import('../src/platform/xhs/kv');
  await reopened.initStorage();
  expect(reopened.kv.getItem('bead-patterns-v1')).toBeNull();
});
