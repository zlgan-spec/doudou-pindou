// MARD 色板选择器：按系列分组列出全部色号。用于"加颜色"和"替换为…"。
import { useMemo } from 'react';
import { textColorOn } from '../core/color';
import { PALETTE } from '../core/palette';

interface Props {
  title: string;
  highlight?: string[]; // 图里已在用的色号，排在最前
  /** 当前选着的颜色：在「图里已在用」和它所在的系列里都圈出来，往下翻找相邻色时不会忘了自己在哪个颜色 */
  current?: string;
  onPick: (code: string) => void;
  onClose: () => void;
}

export function PalettePicker({ title, highlight = [], current, onPick, onClose }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof PALETTE[number][]>();
    for (const c of PALETTE) {
      const series = c.code.replace(/\d+$/, '');
      map.set(series, [...(map.get(series) ?? []), c]);
    }
    return [...map];
  }, []);
  const used = PALETTE.filter(c => highlight.includes(c.code));

  const swatch = (c: typeof PALETTE[number]) => (
    <button
      key={c.code}
      className={`swatch ${c.code === current ? 'current' : ''}`}
      style={{ background: c.hex, color: textColorOn(c.hex) }}
      onClick={() => onPick(c.code)}
      title={`${c.code} ${c.hex}${c.code === current ? '（当前）' : ''}`}
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
          <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="palette-scroll">
          {used.length > 0 && (
            <section>
              <h4>图里已在用</h4>
              <div className="swatches">{used.map(swatch)}</div>
            </section>
          )}
          {groups.map(([series, colors]) => (
            <section key={series}>
              <h4>{series} 系列</h4>
              <div className="swatches">{colors.map(swatch)}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
