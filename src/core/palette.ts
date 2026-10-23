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
