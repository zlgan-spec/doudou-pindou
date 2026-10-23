// 图纸库的系列：读取时的检查和分组
import { describe, expect, it } from 'vitest';
import { groupSeries, parseLibrary } from '../src/ui/library';

const pattern = (id: string, series?: string) => ({ id, name: id, tags: [], colors: ['A1'], rows: ['00', '00'], ...(series ? { series } : {}) });
const cats = { id: 'golden-cat', name: '金渐层', note: '同一只猫的一组动作', cover: 'cat-2' };

describe('系列', () => {
  it('图纸带上系列 id，清单里没有的系列当没写', () => {
    const lib = parseLibrary({ series: [cats], patterns: [pattern('cat-1', 'golden-cat'), pattern('x', 'no-such')] });
    expect(lib.patterns.map(p => p.series)).toEqual(['golden-cat', null]);
    expect(lib.series).toEqual([cats]);
  });

  it('系列 id 格式不对、没有名字、重复的都跳过', () => {
    const lib = parseLibrary({ series: [{ id: 'Bad Id', name: '坏' }, { id: 'noname' }, cats, { ...cats, name: '重复' }] });
    expect(lib.series.map(s => s.name)).toEqual(['金渐层']);
  });

  it('够 3 张按系列分组，按清单顺序排，系列里按文件里的先后；不够的当单张', () => {
    const lib = parseLibrary({
      series: [{ id: 'drinks', name: '饮品' }, cats],
      patterns: [pattern('solo'), pattern('cat-1', 'golden-cat'), pattern('cat-2', 'golden-cat'), pattern('latte', 'drinks'), pattern('cat-3', 'golden-cat'), pattern('mocha', 'drinks')],
    });
    const { groups, singles } = groupSeries(lib);
    expect(groups.map(g => [g.series.id, g.patterns.map(p => p.id)])).toEqual([['golden-cat', ['cat-1', 'cat-2', 'cat-3']]]);
    expect(singles.map(p => p.id)).toEqual(['solo', 'latte', 'mocha']);
  });

  it('没有系列清单的旧文件照样能读', () => {
    const lib = parseLibrary({ v: 1, patterns: [pattern('a')] });
    expect(lib.series).toEqual([]);
    expect(groupSeries(lib).singles.map(p => p.id)).toEqual(['a']);
  });
});
