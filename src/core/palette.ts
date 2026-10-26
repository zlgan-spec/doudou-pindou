// MARD 色板：按色号查颜色，按颜色找最接近的色号。
import { hexToLab, type Lab } from './color';
import { MARD_COLORS } from './palette-data';

export interface BeadColor {
  code: string;
  hex: string;
  lab: Lab;
}

export const PALETTE: readonly BeadColor[] = MARD_COLORS.map(([code, hex]) => ({ code, hex, lab: hexToLab(hex) }));

const byCode = new Map(PALETTE.map(c => [c.code, c]));

export function colorOf(code: string): BeadColor {
  const c = byCode.get(code);
  if (!c) throw new Error(`未知色号 ${code}`);
  return c;
}

export function isValidCode(code: string): boolean {
  return byCode.has(code);
}

// 找色号时色相、饱和度的差别比明暗更显眼：把 a、b 两个方向放大，避免橙色被配成卡其、灰色被配成土黄
const HUE_WEIGHT = 1.6;

export function matchDistance(p: Lab, q: Lab): number {
  const dl = p[0] - q[0], da = (p[1] - q[1]) * HUE_WEIGHT, db = (p[2] - q[2]) * HUE_WEIGHT;
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** 在给定色号范围内找最接近的颜色（默认全色板） */
export function nearest(lab: Lab, candidates: readonly BeadColor[] = PALETTE): BeadColor {
  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = matchDistance(lab, c.lab);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

// 替换颜色时的「相近」：图里已有、又还算像的排前面（换过去还能少一种色，手里也多半有这颗豆），最多占 2 个；剩下补最接近的新色
const SIMILAR_COUNT = 4;
const MAX_IN_USE = 2;
const IN_USE_RADIUS = 0.1; // 已有的颜色离得比这近才推荐：灰色 H22 → 灰 H3 约 0.075 算，→ 肤色 G3 约 0.126 不算

export function similarColors(code: string, inUse: readonly string[]): Array<{ color: BeadColor; inUse: boolean }> {
  const from = colorOf(code).lab;
  const used = new Set(inUse);
  const byDistance = PALETTE.filter(c => c.code !== code)
    .map(c => ({ color: c, d: matchDistance(from, c.lab), inUse: used.has(c.code) }))
    .sort((a, b) => a.d - b.d);
  const near = byDistance.filter(x => x.inUse && x.d < IN_USE_RADIUS).slice(0, MAX_IN_USE);
  const fresh = byDistance.filter(x => !x.inUse).slice(0, SIMILAR_COUNT - near.length);
  return [...near, ...fresh].map(({ color, inUse }) => ({ color, inUse }));
}
