// 勾轮廓：在主体外围加一圈描边豆。
// 星露谷 / 精致：每段描边用相邻色块的同色系最深一级（橘 → 深橘棕，灰 → 深灰）；动漫：统一黑色。
import { chroma, type Lab } from './color';
import { colorOf, nearest, PALETTE, type BeadColor } from './palette';

type Codes = (string | null)[];

const MAX_OUTLINE_COLORS = 1; // 同一圈描边只用一种颜色（取这圈里最多的那个），像素画的规矩，也不用频繁换豆
const neutralPalette = PALETTE.filter(c => chroma(c.lab) < 0.025);
const chromaticPalette = PALETTE.filter(c => chroma(c.lab) >= 0.025);

/** 同色系、更深的一级 */
export function darkShade(code: string): BeadColor {
  const lab = colorOf(code).lab;
  const target: Lab = [Math.max(0.15, Math.min(lab[0] - 0.3, 0.42)), lab[1] * 0.85, lab[2] * 0.85];
  return nearest(target, chroma(lab) < 0.035 ? neutralPalette : chromaticPalette);
}

export interface OpenSides {
  top: boolean;
  left: boolean;
  right: boolean;
  bottom: boolean;
}

const CLOSED: OpenSides = { top: false, left: false, right: false, bottom: false };

/** open：主体在原图里被画框切掉的那几侧，不在那一侧补描边（否则会沿画框画出一条假轮廓） */
export function addOutline(codes: Codes, w: number, h: number, mode: 'dark' | 'black', open: OpenSides = CLOSED) {
  const W = w + 2, H = h + 2;
  const out: Codes = new Array(W * H).fill(null);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[(y + 1) * W + x + 1] = codes[y * w + x];

  const ring: Array<[number, string]> = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (out[y * W + x]) continue;
      if ((open.top && y === 0) || (open.bottom && y === H - 1) || (open.left && x === 0) || (open.right && x === W - 1)) continue;
      const touching = new Map<string, number>();
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const c = nx >= 0 && ny >= 0 && nx < W && ny < H ? out[ny * W + nx] : null;
        if (c) touching.set(c, (touching.get(c) ?? 0) + 1);
      }
      if (!touching.size) continue;
      if (mode === 'black') {
        ring.push([y * W + x, 'H7']);
        continue;
      }
      // 相邻色里取最深的那个来定描边色系，避免浅色描边
      const base = [...touching.keys()].sort((a, b) => colorOf(a).lab[0] - colorOf(b).lab[0])[0];
      ring.push([y * W + x, darkShade(base).code]);
    }
  }

  // 描边色最多保留几种：少见的描边色并到最接近的常用描边色
  const counts = new Map<string, number>();
  for (const [, c] of ring) counts.set(c, (counts.get(c) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, MAX_OUTLINE_COLORS).map(([c]) => colorOf(c));
  for (const [i, c] of ring) out[i] = top.some(t => t.code === c) ? c : nearest(colorOf(c).lab, top).code;

  // 描边沿着圈平滑：每颗取周围 8 格描边里最多的颜色，让同一段描边是同一种颜色，不会一颗一换
  const onRing = new Set(ring.map(([i]) => i));
  for (let pass = 0; pass < 3; pass++) {
    const snapshot = out.slice();
    for (const i of onRing) {
      const x = i % W, y = (i - x) / W;
      const tally = new Map<string, number>();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = (y + dy) * W + x + dx;
          if (x + dx < 0 || y + dy < 0 || x + dx >= W || y + dy >= H || !onRing.has(j)) continue;
          tally.set(snapshot[j]!, (tally.get(snapshot[j]!) ?? 0) + (dx || dy ? 1 : 1.5));
        }
      }
      let best = snapshot[i]!, bestN = 0;
      for (const [c, n] of tally) if (n > bestN) [best, bestN] = [c, n];
      out[i] = best;
    }
  }
  return { codes: out, w: W, h: H };
}
