// 豆板尺寸：自适应 / 52 / 78 / 104 / 自定义。开始页和编辑器共用。
// 自定义输入宽 × 高（颗）：有原图时按原图比例联动，改一边另一边跟着算；图案按比例放进这个范围。
import { useEffect, useState } from 'react';
import { MAX_CUSTOM_SIDE, SIZES, boardFor, boardTiles, cmLabel, type SizeId } from '../core/config';

export type SizeMode = 'auto' | SizeId | 'custom';
export interface Sizing { mode: SizeMode; w: number; h: number }

export const DEFAULT_SIZING: Sizing = { mode: 'auto', w: 104, h: 104 };
const MIN_SIDE = 10;
const MODES: SizeMode[] = ['auto', 'small', 'medium', 'large', 'custom'];

export function modeLabel(mode: SizeMode): string {
  return mode === 'auto' ? '自适应' : mode === 'custom' ? '自定义' : SIZES[mode].label;
}

/** 要几块板：一块板时不说，多块写「6 块板」 */
function boardsNote(w: number, h: number): string {
  if (boardFor(w, h)) return '';
  const { cols, rows } = boardTiles(w, h);
  return `${cols * rows} 块板`;
}

const clampSide = (n: number) => Math.min(MAX_CUSTOM_SIDE, Math.max(MIN_SIDE, Math.round(n)));

/** 按比例联动：改了一边算另一边，任何一边超过上限就整体等比缩回来 */
function linked(w: number, h: number, aspect: number | undefined, changed: 'w' | 'h'): [number, number] {
  if (!aspect) return [clampSide(w), clampSide(h)];
  let [nw, nh] = changed === 'w' ? [w, w / aspect] : [h * aspect, h];
  const over = Math.max(nw, nh) / MAX_CUSTOM_SIDE;
  if (over > 1) [nw, nh] = [nw / over, nh / over];
  return [clampSide(nw), clampSide(nh)];
}

interface Props {
  value: Sizing;
  onChange: (v: Sizing) => void;
  /** 原图宽 / 高：给了就让自定义的宽高按比例联动 */
  aspect?: number;
  disabled?: boolean;
  /** 竖排（编辑器侧栏窄） */
  column?: boolean;
  /** 给了就由按钮确认自定义尺寸（编辑器里，确认才重新生成）；不给就输完立刻生效（开始页） */
  applyLabel?: string;
}

export function SizePicker({ value, onChange, aspect, disabled = false, column = false, applyLabel }: Props) {
  // 自定义框里正在输的数字：输入过程中允许空着或超范围，离开输入框 / 回车 / 点按钮时再整理
  const [draft, setDraft] = useState({ w: String(value.w), h: String(value.h) });
  useEffect(() => setDraft({ w: String(value.w), h: String(value.h) }), [value.w, value.h]);

  const settle = (changed: 'w' | 'h', text = draft): [number, number] => {
    const w = Number(text.w) || value.w, h = Number(text.h) || value.h;
    return linked(w, h, aspect, changed);
  };
  const [lastEdited, setLastEdited] = useState<'w' | 'h'>('w');
  const type = (side: 'w' | 'h', text: string) => {
    const t = text.replace(/\D/g, '').slice(0, 3);
    const next = { ...draft, [side]: t };
    // 有比例时边输边算另一边，用户马上看到会是多大
    if (aspect && Number(t) > 0) {
      const [w, h] = linked(side === 'w' ? Number(t) : value.w, side === 'h' ? Number(t) : value.h, aspect, side);
      if (side === 'w') next.h = String(h);
      else next.w = String(w);
    }
    setDraft(next);
    setLastEdited(side);
  };
  const commit = () => {
    const [w, h] = settle(lastEdited);
    setDraft({ w: String(w), h: String(h) });
    if (w !== value.w || h !== value.h || value.mode !== 'custom') onChange({ mode: 'custom', w, h });
  };
  const live = !applyLabel;
  const [pw, ph] = settle(lastEdited);
  // 编辑器里点「自定义」只是展开输入框，点按钮才重新生成
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = value.mode === 'custom' || customOpen;
  const choose = (m: SizeMode) => {
    setCustomOpen(m === 'custom');
    if (m !== 'custom' || live) onChange({ ...value, mode: m });
  };

  return (
    <div className={`size-picker ${column ? 'column' : ''}`}>
      <div className={`seg size-seg ${column ? 'col' : ''}`} role="radiogroup" aria-label="豆板尺寸">
        {MODES.map(m => (
          <button
            key={m}
            role="radio"
            aria-checked={showCustom ? m === 'custom' : value.mode === m}
            className={(showCustom ? m === 'custom' : value.mode === m) ? 'on' : ''}
            disabled={disabled}
            title={m === 'auto' ? '按图片自动选' : m === 'custom' ? `最大 ${MAX_CUSTOM_SIDE}×${MAX_CUSTOM_SIDE} 颗` : SIZES[m].hint}
            onClick={() => choose(m)}
          >
            {modeLabel(m)}
          </button>
        ))}
      </div>
      {showCustom && (
        <div className="size-custom">
          <input className="text-input" inputMode="numeric" value={draft.w} disabled={disabled} aria-label="宽（颗）" onChange={e => type('w', e.target.value)} onBlur={live ? commit : undefined} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
          <span aria-hidden>×</span>
          <input className="text-input" inputMode="numeric" value={draft.h} disabled={disabled} aria-label="高（颗）" onChange={e => type('h', e.target.value)} onBlur={live ? commit : undefined} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
          <span>颗</span>
          <span className="size-note">{[boardsNote(pw, ph), cmLabel(pw, ph)].filter(Boolean).join(' · ')}</span>
          {applyLabel && (
            <button className="btn small primary" disabled={disabled || (value.mode === 'custom' && pw === value.w && ph === value.h)} onClick={commit}>{applyLabel}</button>
          )}
        </div>
      )}
    </div>
  );
}
