// MARD 色板选择器：按系列分组列出全部色号。用于"加颜色"和"替换为…"。
// 标题旁边可以直接输色号：边输边筛，回车选中；替换时最上面一行是「相近」的 4 个色
import { useMemo, useState, type KeyboardEvent } from 'react';
import { textColorOn } from '../core/color';
import { PALETTE, similarColors } from '../core/palette';

interface Props {
  title: string;
  highlight?: string[]; // 图里已在用的色号，排在最前
  /** 当前选着的颜色：在「图里已在用」和它所在的系列里都圈出来，往下翻找相邻色时不会忘了自己在哪个颜色 */
  current?: string;
  /** 给了就在最上面列出和它相近的色（替换时用） */
  similarTo?: string;
  onPick: (code: string) => void;
  onClose: () => void;
}

export function PalettePicker({ title, highlight = [], current, similarTo, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const map = new Map<string, typeof PALETTE[number][]>();
    for (const c of PALETTE) {
      const series = c.code.replace(/\d+$/, '');
      map.set(series, [...(map.get(series) ?? []), c]);
    }
    return [...map];
  }, []);
  const used = PALETTE.filter(c => highlight.includes(c.code));
  const similar = useMemo(() => (similarTo ? similarColors(similarTo, highlight) : []), [similarTo, highlight]);
  const q = query.trim().toUpperCase();
  const matches = q ? PALETTE.filter(c => c.code.startsWith(q)) : [];
  // 回车：输完整的色号就选它；只剩一个结果也选它
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const hit = matches.find(c => c.code === q) ?? (matches.length === 1 ? matches[0] : undefined);
    if (hit) onPick(hit.code);
  };

  const swatch = (c: typeof PALETTE[number], inUse = false) => (
    <button
      key={c.code}
      className={`swatch ${c.code === current ? 'current' : ''} ${inUse ? 'in-use' : ''}`}
      style={{ background: c.hex, color: textColorOn(c.hex) }}
      onClick={() => onPick(c.code)}
      title={`${c.code} ${c.hex}${c.code === current ? '（当前）' : inUse ? ' · 图里已有' : ''}`}
      aria-current={c.code === current ? 'true' : undefined}
    >
      {c.code}
    </button>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal palette-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <strong>{title}</strong>
          <input
            className="text-input palette-search"
            value={query}
            onChange={e => setQuery(e.target.value.replace(/\s/g, '').toUpperCase().slice(0, 4))}
            onKeyDown={onKey}
            placeholder="色号"
            aria-label="输入色号"
            autoFocus={window.matchMedia('(pointer: fine)').matches}
          />
          <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="palette-scroll">
          {q ? (
            matches.length ? <div className="swatches">{matches.map(c => swatch(c))}</div> : <p className="palette-empty">没有 {q} 这个色号</p>
          ) : (
          <>
          {similar.length > 0 && (
            <section>
              <h4>相近</h4>
              <div className="swatches">{similar.map(s => swatch(s.color, s.inUse))}</div>
            </section>
          )}
          {used.length > 0 && (
            <section>
              <h4>图里已在用</h4>
              <div className="swatches">{used.map(c => swatch(c))}</div>
            </section>
          )}
          {groups.map(([series, colors]) => (
            <section key={series}>
              <h4>{series} 系列</h4>
              <div className="swatches">{colors.map(c => swatch(c))}</div>
            </section>
          ))}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
