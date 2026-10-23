// 颜色换算：sRGB ↔ Oklab。Oklab 里的距离接近人眼感受，找最接近的色号、做减色都在这里算。
// 出图要处理几十万个像素，所以用数组和纯函数，不用对象库。

export type Lab = [l: number, a: number, b: number];

const toLinear = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  toLinear[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = toLinear[r], lg = toLinear[g], lb = toLinear[b];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

export function labDistance(p: Lab, q: Lab): number {
  const dl = p[0] - q[0], da = p[1] - q[1], db = p[2] - q[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** 色度（饱和程度） */
export function chroma(p: Lab): number {
  return Math.hypot(p[1], p[2]);
}

/** 深色底上用白字、浅色底上用黑字 */
export function textColorOn(hex: string): string {
  return hexToLab(hex)[0] > 0.68 ? '#1a1a1a' : '#ffffff';
}
