import { describe, expect, it } from 'vitest';
import { cardFromMask, editedCard, readCardLayer, toggleCard } from '../src/core/cardLayer';
import { commit, mirrorGrid, redo, startHistory, undo } from '../src/core/edit';
import { parseLibrary } from '../src/ui/library';
import { embedPatternDataUrl, readPattern } from '../src/ui/pngData';

const grid = { width: 3, height: 2, cells: ['E14', 'E14', 'H7', 'E14', 'H2', 'E14'] };
const doc = () => ({ grid, mirrored: false, cardLayer: cardFromMask(['100', '001'], grid)! });

describe('卡片层', () => {
  it('只清标记格，同色角色、装饰、五官和被包围的保留格不变，关闭逐格恢复', () => {
    const before = doc(), after = toggleCard(before);
    expect(after.grid.cells).toEqual([null, 'E14', 'H7', 'E14', 'H2', null]);
    expect(toggleCard(after).grid).toEqual(grid);
    expect(before.grid).toEqual(grid);
  });
  it('开关和普通编辑共用撤销重做，状态跟随撤销', () => {
    const h = commit(startHistory(doc()), toggleCard(doc()));
    expect(undo(h).present).toEqual(doc());
    expect(redo(undo(h)).present).toEqual(h.present);
  });
  it('镜像后按新位置移除并恢复', () => {
    const d = { ...doc(), grid: mirrorGrid(grid), mirrored: true };
    const off = toggleCard(d);
    expect(off.grid.cells).toEqual(['H7', 'E14', null, null, 'H2', 'E14']);
    expect(toggleCard(off).grid).toEqual(d.grid);
    const flipped = { ...off, grid: mirrorGrid(off.grid), mirrored: false };
    expect(toggleCard(flipped).grid).toEqual(grid);
  });
  it('关闭时不覆盖移除背景后新画的内容', () => {
    const d = toggleCard(doc());
    d.grid = { ...d.grid, cells: ['B9', ...d.grid.cells.slice(1)] };
    expect(toggleCard(d).grid.cells[0]).toBe('B9');
  });
  it('用户改过的卡片格不再参与移除，改变画布尺寸时放弃旧坐标', () => {
    const d = doc(), changed = { ...grid, cells: ['B9', ...grid.cells.slice(1)] };
    const layer = editedCard(d.cardLayer, grid, changed, false, false)!;
    expect(layer.grid.cells[0]).toBeNull();
    expect(toggleCard({ ...d, grid: changed, cardLayer: layer }).grid.cells[0]).toBe('B9');
    expect(editedCard(layer, grid, { width: 2, height: 3, cells: grid.cells }, false, false)).toBeUndefined();
  });
  it('错行、错宽、非法标记、标空格和空掩膜均不启用开关', () => {
    for (const m of [[], ['100'], ['1000', '001'], ['10x', '001'], ['000', '000']]) expect(cardFromMask(m, grid)).toBeUndefined();
    expect(cardFromMask(['100'], { width: 3, height: 1, cells: [null, 'H7', 'H7'] })).toBeUndefined();
    expect(readCardLayer({ ...doc().cardLayer, grid: { ...grid, cells: ['BAD'] } }, grid)).toBeUndefined();
  });
  it('图纸库居中时掩膜与图案一起平移；旧条目不出现开关', () => {
    const p = { id: 'test', colors: ['E14', 'H7', 'H2'], rows: ['001', '020'], cardMask: ['100', '001'] };
    const [a, b] = parseLibrary({ patterns: [p, { ...p, id: 'old', cardMask: undefined }] }).patterns;
    const off = toggleCard({ grid: a.grid, mirrored: false, cardLayer: a.cardLayer });
    expect(a.cardLayer!.grid.cells.filter(Boolean)).toEqual(['E14', 'E14']);
    expect(off.grid.cells.filter(Boolean)).toEqual(['E14', 'H7', 'E14', 'H2']);
    expect(toggleCard(off).grid).toEqual(a.grid);
    expect(b.cardLayer).toBeUndefined();
  });
  it('PNG 往返保留已移除的卡片及恢复颜色', async () => {
    const d = toggleCard(doc());
    const url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX2sAAAAASUVORK5CYII=';
    const asPng = (u: string) => new Blob([Uint8Array.from(atob(u.split(',')[1]), ch => ch.charCodeAt(0))], { type: 'image/png' });
    const back = await readPattern(asPng(embedPatternDataUrl(url, { ...d, name: 'test', size: 'small', style: 'sticker', fullBoard: false })));
    expect(back!.cardLayer!.removed).toBe(true);
    const restored = toggleCard(back!);
    expect(restored.grid.cells.filter(Boolean)).toEqual(grid.cells);
  });
});
