/// <reference lib="webworker" />
// 出图后台线程：大图要算一两秒，放在这里算，页面照常能点、能滚
import { generatePattern, generateRich, type PatternInput, type PatternOptions } from '../core/pipeline';

self.onmessage = (event: MessageEvent<{ id: number; input: PatternInput; options: PatternOptions; rich?: boolean }>) => {
  const { id, input, options, rich } = event.data;
  try {
    self.postMessage({ id, grid: (rich ? generateRich : generatePattern)(input, options) });
  } catch (e) {
    self.postMessage({ id, message: e instanceof Error ? e.message : String(e) });
  }
};
