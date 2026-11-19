import type { Grid } from './grid';
import { mirrorGrid } from './edit';
import { isValidCode } from './palette';

/** 只有可见的卡片格有色号；角色、装饰以及空格均为 null。 */
export interface CardLayer {
  grid: Grid;
  removed: boolean;
  mirrored: boolean;
}

export function readCardLayer(value: unknown, grid: Grid): CardLayer | undefined {
  if (!value || typeof value !== 'object') return;
  const o = value as Partial<CardLayer>, g = o.grid;
  if (!g || g.width !== grid.width || g.height !== grid.height || !Array.isArray(g.cells) || g.cells.length !== grid.cells.length) return;
  if (!g.cells.every(c => c === null || (typeof c === 'string' && isValidCode(c))) || !g.cells.some(Boolean)) return;
  return { grid: g, removed: o.removed === true, mirrored: o.mirrored === true };
}

export function cardFromMask(mask: unknown, grid: Grid, mirrored = false): CardLayer | undefined {
  if (!Array.isArray(mask) || mask.length !== grid.height || !mask.every(r => typeof r === 'string' && r.length === grid.width && /^[01]+$/.test(r))) return;
  const cells = grid.cells.map((c, i) => mask[Math.floor(i / grid.width)][i % grid.width] === '1' ? c : null);
  if (!cells.some(Boolean) || cells.some((c, i) => mask[Math.floor(i / grid.width)][i % grid.width] === '1' && !c)) return;
  return { grid: { ...grid, cells }, removed: false, mirrored };
}

/** 开启时记住卡片当前的颜色；关闭只补空格，不覆盖去背景后新画的内容。 */
export function toggleCard<T extends { grid: Grid; mirrored: boolean; cardLayer?: CardLayer }>(doc: T): T {
  const card = doc.cardLayer;
  if (!card || card.grid.width !== doc.grid.width || card.grid.height !== doc.grid.height) return doc;
  const layer = card.mirrored === doc.mirrored ? card.grid : mirrorGrid(card.grid);
  const saved = layer.cells.map((c, i) => c ? (card.removed ? c : doc.grid.cells[i]) : null);
  const cells = doc.grid.cells.map((c, i) => !layer.cells[i] ? c : card.removed ? (c ?? saved[i]) : null);
  return { ...doc, grid: { ...doc.grid, cells }, cardLayer: { grid: { ...layer, cells: saved }, removed: !card.removed, mirrored: doc.mirrored } };
}

/** 画笔、填充、选区等写过的格子不再当作原卡片，避免开关擦掉用户的新内容。 */
export function editedCard(card: CardLayer | undefined, before: Grid, after: Grid, mirrored: boolean, wasMirrored: boolean): CardLayer | undefined {
  if (!card || before.width !== after.width || before.height !== after.height) return;
  if (mirrored !== wasMirrored) return card;
  const layer = card.mirrored === mirrored ? card.grid : mirrorGrid(card.grid);
  const cells = layer.cells.map((c, i) => before.cells[i] === after.cells[i] ? c : null);
  return cells.some(Boolean) ? { ...card, grid: { ...layer, cells }, mirrored } : undefined;
}
