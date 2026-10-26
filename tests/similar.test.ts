import { describe, expect, it } from 'vitest';
import { similarColors } from '../src/core/palette';

describe('替换颜色的「相近」', () => {
  it('图里没有相近的颜色：给 4 个最接近的新色', () => {
    expect(similarColors('H22', []).map(x => x.color.code)).toEqual(['H11', 'E20', 'D19', 'H14']);
  });

  it('图里已有、又还算像的排前面，最多 2 个；离得远的不推荐', () => {
    const got = similarColors('H22', ['H8', 'H3', 'G3', 'H22']);
    expect(got.map(x => [x.color.code, x.inUse])).toEqual([['H8', true], ['H3', true], ['H11', false], ['E20', false]]);
  });
});
