// 出图入口：交给渠道去算（网站版在后台线程，小工具版在页面里）
import { platform } from '@platform';
import type { Grid } from '../core/grid';
import type { PatternInput, PatternOptions } from '../core/pipeline';

/** 先把后台线程起好（做豆图页一打开就调），用户传第一张图时不用再等它加载 */
export function warmUp(): void {
  platform.warmUp();
}

/** rich：算「颜色数量」往右用的多色版（generateRich） */
export function generateInBackground(input: PatternInput, options: PatternOptions, rich = false): Promise<Grid> {
  return platform.generate(input, options, rich);
}
