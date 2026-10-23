// 手绘毛笔箭头：沿一条弧形中心线，按「起笔细、中间粗、收笔尖」的粗细算出两侧轮廓，填成一整块；
// 再用噪点位移让边缘毛糙，像干笔刷出来的。坐标单位是 CSS 像素，原点在「选择图片」按钮右边缘、按钮中线上方 56px。

type P = [number, number];

// 中心线经过的点：从「点击」右边出发，顺势往下、往左扫过去，指向按钮（不绕圈）
const CENTER: P[] = [[62, 10], [66, 19], [64, 30], [56, 40], [45, 47], [33, 52], [22, 54]];

/** Catmull-Rom 样条：把几个点连成顺滑的曲线 */
function spline(pts: P[], perSeg = 10): P[] {
  const out: P[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(d => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)) as P);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** 按粗细把中心线变成一块填充形状 */
function ribbon(line: P[], width: (t: number) => number): string {
  const left: P[] = [], right: P[] = [];
  line.forEach((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, w = width(i / (line.length - 1)) / 2;
    left.push([p[0] + nx * w, p[1] + ny * w]);
    right.push([p[0] - nx * w, p[1] - ny * w]);
  });
  const pts = [...left, ...right.reverse()];
  return `M${pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')} Z`;
}

const line = spline(CENTER);
/** 主笔画：起笔细（0.6），压到最粗（约 2.6），快到箭头时略收（1.8），不收成一根线 */
export const ARROW_BODY = ribbon(line, t => (t < 0.25 ? 0.6 + 2 * (t / 0.25) : t < 0.8 ? 2.6 - 0.25 * Math.sin((t - 0.25) * 9) : 2.6 - 0.8 * (t - 0.8) / 0.2));
/** 箭头两笔：从尖往右上、右下各一笔，根部粗、尾部尖 */
const tip = CENTER[CENTER.length - 1];
export const ARROW_HEAD = [
  ribbon(spline([tip, [28, 49], [33, 46]], 8), t => 2.4 * (1 - t) + 0.5),
  ribbon(spline([tip, [28, 59], [32, 62]], 8), t => 2.4 * (1 - t) + 0.5),
];
/** 画出来的动画用：中心线 */
export const ARROW_LINE = `M${line.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')}`;
