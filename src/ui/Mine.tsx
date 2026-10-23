// 我的收藏（顶部导航里单独一个按钮）：用户点了「收藏」的图纸。和图纸库一样搜索、按标签筛、点图放大；大图旁边下载、接着改、取消收藏。
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { NoteToast } from './NoteToast';
import { downloadSheet, PatternBrowser, type BrowserItem } from './PatternBrowser';
import { dateStamp } from './pngData';
import { deletePattern, exportPatterns, importPatterns, listPatterns, subscribe, type PatternEntry } from './store';

interface Props {
  onOpen: (entry: PatternEntry) => void;
}

export function Mine({ onOpen }: Props) {
  const [entries, setEntries] = useState<PatternEntry[]>(() => listPatterns());
  const [note, setNote] = useState('');
  const clearNote = useCallback(() => setNote(''), []);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => subscribe(() => setEntries(listPatterns())), []);

  const exportAll = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(exportPatterns());
    a.download = `DouDou_收藏备份_${dateStamp()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { added, updated } = await importPatterns(file);
      setNote(added || updated ? `已导入：新加 ${added} 张${updated ? `，更新 ${updated} 张` : ''}` : '备份里的图纸都已经在收藏里了，没有新加');
    } catch (err) {
      setNote(err instanceof Error && err.message === '浏览器空间不够' ? '浏览器空间不够，导入不进去' : err instanceof Error && err.message === '文件太大' ? '备份文件超过 10MB，导入不了' : '这个文件不是拼豆收藏的备份');
    }
  };

  const items = useMemo((): BrowserItem[] => entries.map(e => ({ id: e.id, name: e.name, tags: e.tags ?? [], grid: e.grid, mirrored: e.mirrored, thumb: e.thumb })), [entries]);
  const byId = (id: string) => entries.find(e => e.id === id);

  const unstar = (entry: PatternEntry, close: () => void) => {
    if (!window.confirm(`取消收藏「${entry.name}」？取消后找不回来。`)) return;
    close();
    deletePattern(entry.id);
  };

  // 导出 / 导入备份放进顶栏右侧（和做豆图页放收藏 / 导入 / 下载同一个位置）
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById('page-actions')), []);

  return (
    <>
      {slot && createPortal(
        <>
          {entries.length > 0 && <button className="btn soft pill" onClick={exportAll}>导出备份</button>}
          <button className="btn soft pill" onClick={() => fileInput.current?.click()}>导入备份</button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={e => void onImport(e)} />
        </>,
        slot,
      )}
      <NoteToast note={note} onDone={clearNote} />

      {!entries.length ? (
        <div className="empty tall">
          <p>还没有收藏。在 <a href="#/make">做豆图</a> 里点「收藏」，图纸会出现在这里。</p>
        </div>
      ) : (
        <PatternBrowser
          items={items}
          actions={(item, close) => {
            const e = byId(item.id);
            if (!e) return null;
            return (
              <>
                <button className="btn primary pill" onClick={() => downloadSheet(e)}>下载图纸</button>
                <button className="btn pill" onClick={() => { close(); onOpen(e); }}>接着改</button>
                <button className="btn link" onClick={() => unstar(e, close)}>取消收藏</button>
              </>
            );
          }}
        />
      )}
      <p className="fine mine-note">收藏只保存在当前浏览器，换设备前先导出备份</p>
    </>
  );
}
