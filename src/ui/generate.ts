// 出图入口：交给后台线程算，页面不卡；后台线程起不来时退回在页面里算
import type { Grid } from '../core/grid';
import { generatePattern, type PatternInput, type PatternOptions } from '../core/pipeline';

let worker: Worker | null = null;
let broken = false;
let nextId = 0;

/** 先把后台线程起好（做豆图页一打开就调），用户传第一张图时不用再等它加载 */
export function warmUp(): void {
  if (broken) return;
  try {
    worker ??= new Worker(new URL('../workers/generate.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    broken = true;
  }
}

export function generateInBackground(input: PatternInput, options: PatternOptions): Promise<Grid> {
  warmUp();
  if (broken || !worker) return Promise.resolve().then(() => generatePattern(input, options));
  const w = worker;
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const done = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data.id !== id) return;
      done();
      if (event.data.grid) resolve(event.data.grid);
      else reject(new Error(event.data.message));
    };
    const onError = () => {
      done();
      broken = true;
      resolve(generatePattern(input, options));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ id, input, options });
  });
}
