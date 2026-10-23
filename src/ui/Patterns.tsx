// 图纸库（整理好的现成图纸，public/patterns/index.json）和我的收藏（收藏过的图纸）：顶部导航里各占一个按钮，页面没有页头，打开就是搜索和图纸。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { contentBounds, type Grid } from '../core/grid';
import { categoryRank, groupSeries, loadLibrary, sizeOf, type Library as LibraryData, type LibraryPattern } from './library';
import { Mine } from './Mine';
import { NoteToast } from './NoteToast';
import { downloadSheet, PatternBrowser, type BrowserItem, type SeriesGroup } from './PatternBrowser';
import { createPattern, deletePattern, listPatterns, makeThumb, subscribe, type PatternEntry } from './store';

export type LibraryTab = 'library' | 'mine';

interface Props {
  tab: LibraryTab;
  onOpen: (entry: PatternEntry, from: 'store' | 'library') => void;
}

/** 图纸库的一张，转成编辑器和收藏夹认的格式（id 留空 = 还没收藏） */
function toEntry(p: LibraryPattern): PatternEntry {
  const size = sizeOf(p.grid);
  return {
    id: '', name: p.name, size: size ?? 'small', style: 'sticker', fullBoard: !size, mirrored: p.mirrored, grid: p.grid,
    thumb: '', tags: p.tags, libId: p.id, createdAt: 0, updatedAt: 0,
  };
}

function Library({ onOpen }: { onOpen: Props['onOpen'] }) {
  const [lib, setLib] = useState<LibraryData | null>(null);
  const patterns = lib?.patterns ?? null;
  const [starred, setStarred] = useState(() => listPatterns());
  const [note, setNote] = useState('');
  const clearNote = useCallback(() => setNote(''), []);

  useEffect(() => {
    void loadLibrary().then(setLib);
    return subscribe(() => setStarred(listPatterns()));
  }, []);

  const items = useMemo((): BrowserItem[] => (patterns ?? []).map(p => ({
    id: p.id, name: p.name, tags: p.tags, grid: p.grid, mirrored: p.mirrored, thumb: libraryThumb(p.id, p.grid), // 卡片只画有豆子的部分，图更大、细节看得清
    credit: p.author || p.source ? (
      <>
        {[p.author, p.source].filter(Boolean).join(' · ')}
        {p.link && <> · <a href={p.link} target="_blank" rel="noreferrer noopener">原图</a></>}
      </>
    ) : undefined,
  })), [patterns]);

  // 「全部」的摆法（用户先按喜好找大类，再看一套套的系列）：
  // 0. 置顶的系列（featured）排在最前面，不管大类
  // 1. 按大类分段，顺序照 tags.json「大类」；系列的大类看它第一张的第一个大类标签
  // 2. 同一大类里，系列在前：最近加入的系列在前，同一天的按 index.json 系列清单的先后
  // 3. 不成系列的单张放这一类最后，新的在前；系列里面照系列自己的顺序
  const { series, blocks } = useMemo((): { series: SeriesGroup[]; blocks: BrowserItem[][] } => {
    if (!lib) return { series: [], blocks: [] };
    const byId = new Map(items.map(i => [i.id, i]));
    const latest = (ps: LibraryPattern[]) => ps.reduce((m, p) => (p.addedAt > m ? p.addedAt : m), '');
    const { groups, singles } = groupSeries(lib);
    const ordered = groups
      .map((g, order) => ({ ...g, rank: g.series.featured ? -1 : categoryRank(g.patterns[0].tags), date: latest(g.patterns), order }))
      .sort((a, b) => a.rank - b.rank || b.date.localeCompare(a.date) || a.order - b.order);
    const seriesGroups = ordered.map(({ series: s, patterns: ps, rank }) => ({ id: s.id, name: s.name, items: ps.map(p => byId.get(p.id)!), rank }));
    const singleBlocks = new Map<number, LibraryPattern[]>();
    for (const p of singles) {
      const r = categoryRank(p.tags);
      singleBlocks.set(r, [...(singleBlocks.get(r) ?? []), p]);
    }
    const ranks = [...new Set([...seriesGroups.map(g => g.rank), ...singleBlocks.keys()])].sort((a, b) => a - b);
    const all = ranks.flatMap(r => [
      ...seriesGroups.filter(g => g.rank === r).map(g => g.items),
      ...(singleBlocks.has(r) ? [[...singleBlocks.get(r)!].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).map(p => byId.get(p.id)!)] : []),
    ]);
    return { series: seriesGroups, blocks: all };
  }, [lib, items]);

  if (!patterns) return <p className="status busy">正在读取图纸库…</p>;
  if (!patterns.length) {
    return (
      <div className="empty tall">
        <p>图纸正在整理中</p>
      </div>
    );
  }

  const toggleStar = (p: LibraryPattern) => {
    const mine = starred.find(e => e.libId === p.id);
    if (mine) return deletePattern(mine.id);
    const e = toEntry(p);
    setNote(createPattern({ name: e.name, size: e.size, style: e.style, fullBoard: e.fullBoard, mirrored: e.mirrored, grid: e.grid, tags: e.tags, libId: e.libId }) ? '' : '浏览器空间满了，收藏不进去。到「我的收藏」删掉几张，或先导出备份。');
  };

  return (
    <>
      <NoteToast note={note} onDone={clearNote} />
      <PatternBrowser
        items={items}
        series={series}
        blocks={blocks}
        actions={(item, close) => {
          const p = patterns.find(x => x.id === item.id);
          if (!p) return null;
          const isStarred = starred.some(e => e.libId === p.id);
          return (
            <>
              <button className="btn primary pill" onClick={() => downloadSheet({ ...p, size: sizeOf(p.grid) ?? undefined })}>下载图纸</button>
              <button className="btn pill" aria-pressed={isStarred} onClick={() => toggleStar(p)}>{isStarred ? '已收藏' : '收藏'}</button>
              <button className="btn link" onClick={() => { close(); onOpen(toEntry(p), 'library'); }}>拿去改</button>
            </>
          );
        }}
      />
    </>
  );
}

/** 裁掉四周的空格，只留有豆子的那块（卡片缩略图用；豆板大小在大图里看） */
// 图纸库的缩略图画一次就记住，再进图纸库不用重画
const thumbs = new Map<string, string>();
function libraryThumb(id: string, grid: Grid): string {
  let t = thumbs.get(id);
  if (!t) thumbs.set(id, (t = makeThumb(cropToContent(grid))));
  return t;
}

function cropToContent(grid: Grid): Grid {
  const b = contentBounds(grid);
  if (!b) return grid;
  const w = b.right - b.left + 1, h = b.bottom - b.top + 1;
  const cells: (string | null)[] = [];
  for (let y = b.top; y <= b.bottom; y++) cells.push(...grid.cells.slice(y * grid.width + b.left, y * grid.width + b.right + 1));
  return { width: w, height: h, cells };
}

export function Patterns({ tab, onOpen }: Props) {
  return (
    <section className="frame-row">
      <div className="cell tool-body" key={tab}>
        {/* 没有页头：标题只给读屏用，看得见的位置由顶部导航高亮说明 */}
        <h1 className="sr-only">{tab === 'mine' ? '我的收藏' : '图纸库'}</h1>
        {tab === 'mine' ? <Mine onOpen={e => onOpen(e, 'store')} /> : <Library onOpen={onOpen} />}
      </div>
    </section>
  );
}
