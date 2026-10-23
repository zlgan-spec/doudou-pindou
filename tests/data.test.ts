// 外部数据校验：图纸 PNG、收藏、备份文件读进来的数据不合格就整份丢掉，不能让页面崩或卡死
import { describe, expect, it } from 'vitest';
import { sheetFileName, validatePatternData } from '../src/ui/pngData';

const ok = { name: '猫', size: 'small', style: 'sticker', grid: { width: 2, height: 1, cells: ['H7', null] } };

describe('validatePatternData', () => {
  it('合格的图纸通过，补成整块豆板、图案不丢', () => {
    const g = validatePatternData(ok)!.grid;
    expect([g.width, g.height, g.cells.filter(Boolean)]).toEqual([52, 52, ['H7']]);
  });
  it('名字不是字符串时用「未命名」，不会把对象塞进页面', () => {
    expect(validatePatternData({ ...ok, name: { a: 1 } })?.name).toBe('未命名');
  });
  it('名字过长会截断', () => {
    expect(validatePatternData({ ...ok, name: 'x'.repeat(500) })?.name.length).toBe(60);
  });
  it('不认识的尺寸 / 风格回退默认值', () => {
    const d = validatePatternData({ ...ok, size: 'foo', style: 'bar' });
    expect(d?.size).toBe('small');
    expect(d?.style).toBe('sticker');
  });
  it('宽高不是正整数、单边超过 200、长宽乘积刚好凑够格数的都丢掉', () => {
    expect(validatePatternData({ ...ok, grid: { width: 1048576, height: 2 ** -20, cells: [null] } })).toBeNull();
    expect(validatePatternData({ ...ok, grid: { width: 40000, height: 1, cells: new Array(40000).fill(null) } })).toBeNull();
    expect(validatePatternData({ ...ok, grid: { width: 0, height: 0, cells: [] } })).toBeNull();
  });
  it('色号不在色卡里就丢掉', () => {
    expect(validatePatternData({ ...ok, grid: { width: 1, height: 1, cells: ['<img src=x>'] } })).toBeNull();
  });
  it('格数和宽高对不上就丢掉', () => {
    expect(validatePatternData({ ...ok, grid: { width: 2, height: 2, cells: ['H7'] } })).toBeNull();
  });
});

describe('名字清洗', () => {
  it('去掉文字方向控制符和控制字符', async () => {
    const { cleanName } = await import('../src/ui/pngData');
    expect(cleanName('abc‮gnp.exe')).toBe('abcgnp.exe');
    expect(cleanName('  猫\u0000咪  ')).toBe('猫咪');
  });
});

describe('下载文件名', () => {
  const d = new Date(2026, 9, 15, 9, 5);
  it('DouDou_图纸名_日期，镜像版加后缀', () => {
    expect(sheetFileName('猫猫测试', false, d)).toBe('DouDou_猫猫测试_20261015.png');
    expect(sheetFileName('猫猫测试', true, d)).toBe('DouDou_猫猫测试_20261015_镜像版.png');
  });
  it('没起名的带上时分，同一天不重名', () => {
    expect(sheetFileName('', false, d)).toBe('DouDou_20261015_0905.png');
    expect(sheetFileName('未命名', false, d)).toBe('DouDou_20261015_0905.png');
  });
  it('去掉文件名里不能用的字符', () => {
    expect(sheetFileName('a/b:c*?', false, d)).toBe('DouDou_abc_20261015.png');
  });
});
