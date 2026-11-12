// 样式档位检查：字号、圆角、阴影只用 styles.css 开头定的档位变量，间距用 2 / 4 的倍数。
// 确实要用档位外的值，在同一行写注释「特例：原因」。新组件照这个来，整站才是一套东西。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
const lines = css.split('\n').map((text, i) => ({ n: i + 1, text, code: text.replace(/\/\*.*?\*\//g, '') }))
  .filter(l => !l.text.includes('特例') && !/^\s*--[\w-]+:/.test(l.code)); // 变量定义本身不查

/** 找出某个属性所有不合规的写法，返回「行号: 值」 */
function offenders(prop: RegExp, ok: (value: string) => boolean): string[] {
  const out: string[] = [];
  for (const l of lines) {
    for (const m of l.code.matchAll(prop)) {
      const value = m[1].trim();
      if (!ok(value)) out.push(`${l.n}: ${m[0].trim()}`);
    }
  }
  return out;
}

describe('样式档位', () => {
  it('字号只用 --text-* / --title-*', () => {
    expect(offenders(/(?<![-\w])font-size:\s*([^;}]+)/g, v => /^var\(--(text|title)-[a-z0-9]+\)$/.test(v) || v === '0' || v === 'inherit')).toEqual([]);
  });

  it('圆角只用 --radius-*、50%、0', () => {
    expect(offenders(/(?<![-\w])border-radius:\s*([^;}]+)/g, v => v.split(/\s+/).every(part => /^var\(--radius(-[a-z0-9]+)?\)$/.test(part) || part === '50%' || part === '0'))).toEqual([]);
  });

  it('阴影只用 --shadow-* / --ring-* / --edge-*', () => {
    expect(offenders(/(?<![-\w])box-shadow:\s*([^;}]+)/g, v => v === 'none' || v.split(',').every(part => /^(inset )?var\(--(shadow|ring|edge)-[a-z0-9]+\)$/.test(part.trim())))).toEqual([]);
  });

  it('间距：24px 以内是 2 的倍数，24–64px 是 4 的倍数', () => {
    const onScale = (px: number) => px > 64 || (px <= 24 ? px % 2 === 0 : px % 4 === 0);
    expect(offenders(/(?<![-\w])(?:gap|padding|margin)(?:-[a-z]+)?:\s*([^;}]+)/g, v => [...v.matchAll(/(?<![\w.#-])-?(\d*\.?\d+)px/g)].every(m => onScale(Number(m[1]))))).toEqual([]);
  });
});
