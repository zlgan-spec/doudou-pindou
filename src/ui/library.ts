// 图纸库：整理好的现成图纸，放在 public/patterns/index.json，打开页面时读一次。
// 每张图纸直接存格子（一行一个字符串，像字符画），缩略图和大图都在浏览器里现画，不用另存图片。
// 标签只能从 tags.json 的固定词表里选，避免「猫」「猫咪」「小猫」各一个；尺寸标签按豆板自动给。
// 尺寸规则：读进来时把图案居中放到能装下它的最小豆板（52 / 78 / 104）上，超过 104×104 的不收。
// 系列：文件顶部的 series 清单写系列名、说明、封面，清单顺序就是显示顺序；每张图纸用 series 字段写它属于哪个系列。
import { SIZES, boardFor, type SizeId } from '../core/config';
import { contentBounds, placeOnBoard, type Grid } from '../core/grid';
import { isValidCode } from '../core/palette';
import TAG_GROUPS from './tags.json';

// 标签分三层：大类（每张必有一个，写在第一个，决定它在「全部」里排在哪一段，词表顺序就是显示顺序）、细分、用途
export const CATEGORY_TAGS: readonly string[] = TAG_GROUPS['大类'];
export const DETAIL_TAGS: readonly string[] = TAG_GROUPS['细分'];
export const USE_TAGS: readonly string[] = TAG_GROUPS['用途'];
const KNOWN_TAGS = new Set([...CATEGORY_TAGS, ...DETAIL_TAGS, ...USE_TAGS]);

/** 图纸的大类在词表里排第几（没有大类的排最后） */
export function categoryRank(tags: readonly string[]): number {
  const c = tags.find(t => CATEGORY_TAGS.includes(t));
  return c ? CATEGORY_TAGS.indexOf(c) : CATEGORY_TAGS.length;
}

export interface LibraryPattern {
  id: string;
  name: string;
  tags: string[];
  author: string;
  source: string;
  link: string | null;
  addedAt: string;
  mirrored: boolean;
  grid: Grid;
  /** 属于哪个系列（系列 id），不属于写 null */
  series: string | null;
}

export interface LibrarySeries {
  id: string;
  name: string;
  /** 一句话说明，如「同一只猫的一组动作」 */
  note: string;
  /** 封面用哪张图纸（图纸 id），不写或找不到就用系列里第一张 */
  cover: string | null;
}

export interface Library {
  patterns: LibraryPattern[];
  series: LibrarySeries[];
}

/** 系列至少几张才按系列显示，不够的当单张 */
export const SERIES_MIN = 3;
const ID = /^[a-z0-9-]{1,40}$/;

/** 格子里用的字符：'.' 是空格，其余按顺序对应 colors 里的色号 */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_SIDE = 200;

/** 只留词表里的标签，去重 */
export function cleanTags(tags: unknown): string[] {
  return Array.isArray(tags) ? [...new Set(tags.filter((t): t is string => typeof t === 'string' && KNOWN_TAGS.has(t)))] : [];
}

/** 图纸放在哪块豆板上：按颗数算（图纸库、收藏的图纸都已经是整块豆板）；超过 104 返回 null */
export function sizeOf(grid: Grid): SizeId | null {
  return boardFor(grid.width, grid.height);
}

/** 按尺寸规则放到能装下图案的最小豆板上；超过 104×104 返回 null */
function toBoard(grid: Grid): Grid | null {
  const b = contentBounds(grid);
  const s = b ? boardFor(b.right - b.left + 1, b.bottom - b.top + 1) : 'small';
  return s ? placeOnBoard(grid, SIZES[s].board) : null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function decode(o: Record<string, unknown>): LibraryPattern | null {
  const id = text(o.id, 40);
  if (!ID.test(id)) return null;
  const colors = o.colors, rows = o.rows;
  if (!Array.isArray(colors) || colors.length > DIGITS.length || !colors.every(c => typeof c === 'string' && isValidCode(c))) return null;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_SIDE || !rows.every(r => typeof r === 'string')) return null;
  const width = (rows[0] as string).length, height = rows.length;
  if (width < 1 || width > MAX_SIDE) return null;
  const cells: (string | null)[] = [];
  for (const row of rows as string[]) {
    if (row.length !== width) return null;
    for (const ch of row) {
      if (ch === '.') { cells.push(null); continue; }
      const i = DIGITS.indexOf(ch);
      if (i < 0 || i >= colors.length) return null;
      cells.push(colors[i] as string);
    }
  }
  const grid = toBoard({ width, height, cells });
  if (!grid) return null;
  const link = text(o.link, 300);
  return {
    id,
    name: text(o.name, 30) || '未命名',
    tags: cleanTags(o.tags),
    author: text(o.author, 40),
    source: text(o.source, 60),
    link: /^https:\/\/[^\s"<>]+$/.test(link) ? link : null, // 只认 https 链接
    addedAt: text(o.addedAt, 10),
    mirrored: o.mirrored === true,
    grid,
    series: ID.test(text(o.series, 40)) ? text(o.series, 40) : null,
  };
}

function decodeSeries(o: Record<string, unknown>): LibrarySeries | null {
  const id = text(o.id, 40), name = text(o.name, 20);
  if (!ID.test(id) || !name) return null;
  const cover = text(o.cover, 40);
  return { id, name, note: text(o.note, 60), cover: ID.test(cover) ? cover : null };
}

const objects = (list: unknown): Record<string, unknown>[] => (Array.isArray(list) ? list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);

/** 检查整份图纸库：格式不对的条目跳过，id 重复的只留第一个，写了清单里没有的系列当没写 */
export function parseLibrary(data: unknown): Library {
  const raw = (data ?? {}) as { patterns?: unknown; series?: unknown };
  const seen = new Set<string>();
  const series = objects(raw.series).flatMap(o => {
    const sr = decodeSeries(o);
    if (!sr || seen.has(sr.id)) return [];
    seen.add(sr.id);
    return [sr];
  });
  seen.clear();
  const patterns = objects(raw.patterns).flatMap(o => {
    const p = decode(o);
    if (!p || seen.has(p.id)) return [];
    seen.add(p.id);
    return [{ ...p, series: series.some(sr => sr.id === p.series) ? p.series : null }];
  });
  return { patterns, series };
}

/** 按系列分组：够张数的系列按清单顺序排，系列里按图纸在文件里的先后；其余都是单张 */
export function groupSeries(lib: Library): { groups: Array<{ series: LibrarySeries; patterns: LibraryPattern[] }>; singles: LibraryPattern[] } {
  const groups = lib.series
    .map(series => ({ series, patterns: lib.patterns.filter(p => p.series === series.id) }))
    .filter(g => g.patterns.length >= SERIES_MIN);
  const grouped = new Set(groups.map(g => g.series.id));
  return { groups, singles: lib.patterns.filter(p => !p.series || !grouped.has(p.series)) };
}

let cache: Promise<Library> | null = null;

/** 读图纸库；读不到返回空的 */
export function loadLibrary(): Promise<Library> {
  cache ??= fetch(`${import.meta.env.BASE_URL}patterns/index.json`)
    .then(r => (r.ok ? r.json() : null))
    .then(parseLibrary)
    .catch(() => ({ patterns: [], series: [] }));
  return cache;
}
