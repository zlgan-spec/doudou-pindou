// 图纸库：整理好的现成图纸，源文件是 public/patterns/index.json（网站版打开页面时读一次；小工具版打包时筛一份带进包里）。
// 每张图纸直接存格子（一行一个字符串，像字符画），缩略图和大图都在浏览器里现画，不用另存图片。
// 标签只能从 tags.json 的固定词表里选，避免「猫」「猫咪」「小猫」各一个；尺寸标签按豆板自动给。
// 尺寸规则：读进来时把图案居中放到能装下它的最小豆板（52 / 78 / 104）上，超过 104×104 的不收。
// 系列：文件顶部的 series 清单写系列名、说明、封面，清单顺序就是显示顺序；每张图纸用 series 字段写它属于哪个系列。
import { SIZES, boardFor, type SizeId } from '../core/config';
import { contentBounds, placeOnBoard, type Grid } from '../core/grid';
import { isValidCode } from '../core/palette';
import TAG_GROUPS from './tags.json';
import { platform } from '@platform';

// 标签分三层：大类（每张有且只有一个，写在第一个，决定它在「全部」里排在哪一段，词表顺序就是显示顺序）、细分、用途
export const CATEGORY_TAGS: readonly string[] = TAG_GROUPS['大类'];
export const DETAIL_TAGS: readonly string[] = TAG_GROUPS['细分'];
export const USE_TAGS: readonly string[] = TAG_GROUPS['用途'];
const KNOWN_TAGS = new Set([...CATEGORY_TAGS, ...DETAIL_TAGS, ...USE_TAGS]);

/** 图纸的大类在词表里排第几（没有大类的排最后） */
export function categoryRank(tags: readonly string[]): number {
  const c = tags.find(t => CATEGORY_TAGS.includes(t));
  return c ? CATEGORY_TAGS.indexOf(c) : CATEGORY_TAGS.length;
}

/** 图纸的大类：标签里第一个大类词（每张只有一个，见 scripts/normalize-tags.mjs），没有就是 null */
export function primaryCategory(tags: readonly string[]): string | null {
  return tags.find(t => CATEGORY_TAGS.includes(t)) ?? null;
}

export interface FilterChip { name: string; n: number }
export interface FilterItem { id: string; tags: readonly string[]; size: string | null }

/**
 * 筛选按钮：cats 是大类（单选，按每张图纸的大类数）；subs 是选中大类下的细分 / 用途标签（我的收藏用，图纸库看文件夹不用这排）；
 * sizes 是有图纸的豆板尺寸。整个范围都有的标签不出（点了等于没筛）
 */
export function buildFilters(items: readonly FilterItem[], cat: string | null): { cats: FilterChip[]; subs: FilterChip[]; sizes: FilterChip[] } {
  const count = (list: readonly FilterItem[], f: (i: FilterItem) => boolean) => list.filter(f).length;
  const cats = [...CATEGORY_TAGS].map(name => ({ name, n: count(items, i => primaryCategory(i.tags) === name) })).filter(c => c.n > 0);
  const scope = cat ? items.filter(i => primaryCategory(i.tags) === cat) : items;
  const subs = [...DETAIL_TAGS, ...USE_TAGS].filter(t => !CATEGORY_TAGS.includes(t)).map(name => ({ name, n: count(scope, i => i.tags.includes(name)) })).filter(c => c.n > 0 && c.n < scope.length);
  const sizes = Object.values(SIZES).map(s => ({ name: s.label, n: count(items, i => i.size === s.label) })).filter(c => c.n > 0);
  return { cats, subs, sizes };
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
  /** 这是哪一张图纸的另一个尺寸（那张的 id）。图纸库里不单独出卡片，在那张的大图里切换；不是就写 null */
  variantOf: string | null;
}

export interface LibrarySeries {
  id: string;
  name: string;
  /** 一句话说明，如「同一只猫的一组动作」 */
  note: string;
  /** 封面用哪张图纸（图纸 id），不写或找不到就用系列里第一张 */
  cover: string | null;
  /** 置顶：热门的系列排在图纸库最前面（几个都置顶时按清单先后） */
  pinned?: boolean;
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
    variantOf: ID.test(text(o.variantOf, 40)) ? text(o.variantOf, 40) : null,
  };
}

function decodeSeries(o: Record<string, unknown>): LibrarySeries | null {
  const id = text(o.id, 40), name = text(o.name, 20);
  if (!ID.test(id) || !name) return null;
  const cover = text(o.cover, 40);
  return { id, name, note: text(o.note, 60), cover: ID.test(cover) ? cover : null, ...(o.pinned === true ? { pinned: true } : {}) };
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
  // 另一个尺寸必须指向一张真的在库里、自己不是「另一个尺寸」的图纸，否则当成普通的一张
  const mains = new Set(patterns.filter(p => !p.variantOf).map(p => p.id));
  return { patterns: patterns.map(p => (p.variantOf && !mains.has(p.variantOf) ? { ...p, variantOf: null } : p)), series };
}

/** 同一张图的各个尺寸：主图加上指向它的那些，从小到大排。只有一个尺寸的不在返回里 */
export function sizeVariants(patterns: readonly LibraryPattern[]): Map<string, LibraryPattern[]> {
  const out = new Map<string, LibraryPattern[]>();
  for (const p of patterns) {
    if (!p.variantOf) continue;
    const main = patterns.find(m => m.id === p.variantOf);
    if (main) out.set(main.id, [...(out.get(main.id) ?? [main]), p]);
  }
  for (const list of out.values()) list.sort((a, b) => a.grid.width * a.grid.height - b.grid.width * b.grid.height);
  return out;
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
  cache ??= platform.loadLibraryData()
    .then(parseLibrary)
    .catch(() => ({ patterns: [], series: [] }));
  return cache;
}
