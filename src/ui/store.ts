// 我的收藏：用户点了「收藏」的图纸，存在当前浏览器的 localStorage 里。
// 存的是格子表格（几十 KB），打开能继续编辑；收藏之后的编辑自动跟着存。可以导出 / 导入 JSON 备份。
import type { SizeId, StyleId } from '../core/config';
import type { Grid } from '../core/grid';
import { colorOf } from '../core/palette';
import { cleanTags } from './library';
import { validatePatternData } from './pngData';

export interface PatternEntry {
  id: string;
  name: string;
  size: SizeId;
  style: StyleId;
  fullBoard: boolean;
  mirrored: boolean;
  grid: Grid;
  thumb: string; // 小缩略图 data URL，列表里用
  tags?: string[]; // 从图纸库收藏的带着图纸库的标签；自己做的没有
  libId?: string; // 从图纸库收藏的：对应图纸库里的 id，用来显示「已收藏」
  createdAt: number;
  updatedAt: number;
}

const KEY = 'bead-patterns-v1';
const listeners = new Set<() => void>();

function read(): PatternEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.map(toEntry).filter(isEntry).map(e => (e.thumb ? e : { ...e, thumb: makeThumb(e.grid) })) : [];
  } catch {
    return [];
  }
}

/** 存不下时返回 false（浏览器空间满了），调用方提示用户 */
function write(entries: PatternEntry[]): boolean {
  let ok = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    ok = false;
  }
  listeners.forEach(fn => fn());
  return ok;
}

/**
 * 收藏条目的校验：本地存储和备份文件都可能被改过，逐项检查类型和范围，不合格的整条丢掉，
 * 免得一条坏数据让「我的收藏」整页打不开。图纸本身走和 PNG 导入同一套校验（尺寸、色号）
 */
function toEntry(e: unknown): PatternEntry | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[\w-]{1,40}$/.test(o.id)) return null;
  if (o.starred === false) return null; // 早期版本会自动存每次生成（starred: false），那些不算收藏
  const data = validatePatternData(o);
  if (!data) return null;
  const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    id: o.id,
    name: data.name,
    size: data.size,
    style: data.style,
    fullBoard: data.fullBoard,
    mirrored: data.mirrored,
    grid: data.grid,
    thumb: typeof o.thumb === 'string' && o.thumb.startsWith('data:image/png;base64,') ? o.thumb : '',
    tags: cleanTags(o.tags),
    libId: typeof o.libId === 'string' && /^[\w-]{1,40}$/.test(o.libId) ? o.libId : undefined,
    createdAt: time(o.createdAt),
    updatedAt: time(o.updatedAt),
  };
}
const isEntry = (e: PatternEntry | null): e is PatternEntry => e !== null;

export function listPatterns(): PatternEntry[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 一颗豆画一个像素，页面上靠 image-rendering: pixelated 放大，图小、画得快
export function makeThumb(grid: Grid): string {
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(grid.width, grid.height);
  grid.cells.forEach((code, i) => {
    if (!code) return;
    const hex = colorOf(code).hex;
    img.data[i * 4] = parseInt(hex.slice(1, 3), 16);
    img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
    img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    img.data[i * 4 + 3] = 255;
  });
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

type Draft = Omit<PatternEntry, 'id' | 'thumb' | 'createdAt' | 'updatedAt'>;

/** 收藏一份，返回 id；浏览器空间满了返回 null */
export function createPattern(draft: Draft): string | null {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  const entries = read();
  entries.push({ ...draft, id, thumb: makeThumb(draft.grid), createdAt: now, updatedAt: now });
  return write(entries) ? id : null;
}

/** 收藏后继续编辑，跟着存 */
/** 存不下时返回 false（浏览器空间满了），调用方提示用户 */
export function updatePattern(id: string, patch: Partial<Draft>): boolean {
  const entries = read();
  const e = entries.find(x => x.id === id);
  if (!e) return true;
  Object.assign(e, patch, { updatedAt: Date.now() });
  if (patch.grid) e.thumb = makeThumb(patch.grid);
  return write(entries);
}

export function deletePattern(id: string): void {
  write(read().filter(e => e.id !== id));
}

export function getPattern(id: string): PatternEntry | undefined {
  return read().find(e => e.id === id);
}

export function exportPatterns(): Blob {
  const data = { app: 'doudou', version: 1, exportedAt: new Date().toISOString(), patterns: read() };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

/** 导入备份：同 id 的以文件里的为准；返回新加了几张、更新了几张（和收藏里一模一样的不算） */
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const MAX_BACKUP_ENTRIES = 500;
export async function importPatterns(file: File): Promise<{ added: number; updated: number }> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('文件太大');
  const text = await file.text();
  const data = JSON.parse(text);
  const incoming: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.patterns) ? data.patterns : [];
  // 同一个文件里重复的 id 只留最后一条；最多 500 条
  const byId = new Map<string, PatternEntry>();
  for (const e of incoming.slice(0, MAX_BACKUP_ENTRIES).map(toEntry).filter(isEntry)) byId.set(e.id, e);
  const valid = [...byId.values()];
  if (!valid.length) throw new Error('文件里没有图纸');
  const before = read();
  const content = (e: PatternEntry) => JSON.stringify([e.name, e.size, e.style, e.fullBoard, e.mirrored, e.grid, e.tags ?? [], e.libId ?? '']);
  let added = 0, updated = 0;
  for (const v of valid) {
    const old = before.find(e => e.id === v.id);
    if (!old) added++;
    else if (content(old) !== content(v)) updated++;
  }
  const entries = before.filter(e => !valid.some(v => v.id === e.id));
  // 缩略图现算，不信任文件里的
  for (const v of valid) entries.push({ ...v, thumb: makeThumb(v.grid) });
  if (!write(entries)) throw new Error('浏览器空间不够');
  return { added, updated };
}
