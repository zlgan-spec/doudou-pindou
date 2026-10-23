// 图纸自动检查：图纸交付标准里能用程序判断的条目（A1、B1… 是条目编号）。
// 版式类（C2、C3、C7、C8）由渲染器按固定规则画出，在渲染测试里检查。
import { MAX_COLORS, MAX_ISLAND, MIN_BEADS_PER_COLOR, SAFE_MARGIN, SIZES, type SizeId, type StyleId } from './config';
import { connectedRegions, contentBounds, getCell, legendOf, type Grid } from './grid';
import { colorOf, isValidCode } from './palette';
import { labDistance } from './color';

export interface CheckResult {
  id: string;
  ok: boolean;
  detail: string;
}

export interface ValidateOptions {
  size: SizeId;
  /** 写实风颜色上限更高 */
  style?: StyleId;
  /** 用户编辑过：允许少量颜色和小块（B5、D7 只约束自动生成的结果） */
  edited?: boolean;
  /** 保留背景、占满整块板：不检查安全边距 */
  fullBoard?: boolean;
}

export function validateGrid(grid: Grid, options: ValidateOptions): CheckResult[] {
  const size = SIZES[options.size];
  const results: CheckResult[] = [];
  const check = (id: string, ok: boolean, detail: string) => results.push({ id, ok, detail });

  check('A1', grid.width === size.board && grid.height === size.board, `豆板 ${grid.width}×${grid.height}，应为 ${size.board}×${size.board}`);

  const b = contentBounds(grid);
  if (b) {
    const margin = Math.min(b.left, b.top, grid.width - 1 - b.right, grid.height - 1 - b.bottom);
    const longSide = Math.max(b.right - b.left + 1, b.bottom - b.top + 1);
    check('A2', options.edited || options.fullBoard || (margin >= SAFE_MARGIN && longSide <= size.maxSubject), options.fullBoard ? '保留背景，占满整块板' : `安全边距 ${margin} 颗，主体最长边 ${longSide} 颗`);
  } else {
    check('A2', false, '图纸是空的');
  }

  const invalid = grid.cells.filter(c => c !== null && !isValidCode(c));
  check('B1/B2', invalid.length === 0, invalid.length ? `非法色号：${[...new Set(invalid)].join('、')}` : '全部是合法 MARD 色号或空格');

  const legend = legendOf(grid);
  check('B4', legend.length <= MAX_COLORS, `${legend.length} 色，上限 ${MAX_COLORS}`);

  if (!options.edited) {
    const rare = legend.filter(l => l.count < MIN_BEADS_PER_COLOR);
    check('B5', rare.length === 0, rare.length ? `零碎色：${rare.map(r => `${r.code}×${r.count}`).join('、')}` : `每色 ≥ ${MIN_BEADS_PER_COLOR} 颗`);
  }

  const total = legend.reduce((n, l) => n + l.count, 0);
  const cellsTotal = grid.cells.filter(Boolean).length;
  const sorted = legend.every((l, i) => i === 0 || legend[i - 1].count >= l.count);
  check('C5/C6', total === cellsTotal && sorted, `色卡合计 ${total} 颗，格子 ${cellsTotal} 颗，${sorted ? '已' : '未'}按用量排序`);

  // 孤立杂点：周围 8 格都不同色的单颗。斜线靠对角相连不算；相邻色阶的交织（颜色差很小）也不算，那是渐变的画法
  const SHADE_STEP = 0.12;
  const similar = (a: string, b: string) => a === b || labDistance(colorOf(a).lab, colorOf(b).lab) < SHADE_STEP;
  let isolated = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const code = getCell(grid, x, y);
      if (!code) continue;
      const around: (string | null)[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) around.push(getCell(grid, x + dx, y + dy));
      const filled = around.filter((c): c is string => !!c);
      if (filled.length > 0 && filled.every(c => !similar(c, code))) isolated++;
    }
  }
  const ratio = cellsTotal ? isolated / cellsTotal : 0;
  check('D5', ratio < 0.05, `孤立杂点 ${(ratio * 100).toFixed(1)}%`);

  if (!options.edited) {
    const small = connectedRegions(grid).filter(r => r.length <= MAX_ISLAND);
    check('D7', small.length === 0, small.length ? `${small.length} 个分离小块` : '没有分离小块');
  }
  return results;
}

export function allPassed(results: CheckResult[]): boolean {
  return results.every(r => r.ok);
}
