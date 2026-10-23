/// <reference lib="webworker" />
// 抠图后台线程：用 U²-Netp 模型算出主体蒙版。模型和运行库都放在本站，不访问外部网站。
// 运行库（.wasm）由打包工具从 onnxruntime-web 里自动带上，和页面放在一起。
import * as ort from 'onnxruntime-web/wasm';

interface CutoutRequest {
  id: number;
  width: number;
  height: number;
  pixels: ArrayBuffer; // RGBA
  base: string;        // 站点根路径，用来找模型和运行库
}

const INPUT = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
// 模型输出是软边蒙版；低置信度的尾巴常带着背景色，压掉它再交给出图流水线二值化
const LOW = 0.15;
const HIGH = 0.75;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function loadSession(base: string) {
  ort.env.wasm.numThreads = 1;
  return ort.InferenceSession.create(`${base}models/U-2-Netp/onnx/model.onnx`, { executionProviders: ['wasm'] });
}

async function computeMask(req: CutoutRequest): Promise<Float32Array> {
  sessionPromise ??= loadSession(req.base);
  const session = await sessionPromise;
  self.postMessage({ id: req.id, type: 'progress', phase: 'processing' });

  const source = new OffscreenCanvas(req.width, req.height);
  source.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(req.pixels), req.width, req.height), 0, 0);

  const scale = Math.min(INPUT / req.width, INPUT / req.height);
  const w = Math.max(1, Math.round(req.width * scale)), h = Math.max(1, Math.round(req.height * scale));
  const left = Math.floor((INPUT - w) / 2), top = Math.floor((INPUT - h) / 2);
  const input = new OffscreenCanvas(INPUT, INPUT);
  const ictx = input.getContext('2d')!;
  ictx.fillStyle = '#000';
  ictx.fillRect(0, 0, INPUT, INPUT);
  ictx.drawImage(source, left, top, w, h);
  const px = ictx.getImageData(0, 0, INPUT, INPUT).data;

  const plane = INPUT * INPUT;
  const tensor = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) tensor[c * plane + i] = (px[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, INPUT, INPUT]) });
  const raw = output[session.outputNames[0]].data as Float32Array;

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < plane; i++) {
    if (raw[i] < min) min = raw[i];
    if (raw[i] > max) max = raw[i];
  }
  const range = Math.max(max - min, 1e-6);
  const small = new OffscreenCanvas(INPUT, INPUT);
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(INPUT, INPUT);
  for (let i = 0; i < plane; i++) {
    const v = Math.round(((raw[i] - min) / range) * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  const full = new OffscreenCanvas(req.width, req.height);
  const fctx = full.getContext('2d')!;
  fctx.drawImage(small, left, top, w, h, 0, 0, req.width, req.height);
  const scaled = fctx.getImageData(0, 0, req.width, req.height).data;
  const mask = new Float32Array(req.width * req.height);
  for (let i = 0; i < mask.length; i++) {
    const v = scaled[i * 4] / 255;
    mask[i] = Math.min(1, Math.max(0, (v - LOW) / (HIGH - LOW)));
  }
  return mask;
}

self.addEventListener('message', async (event: MessageEvent<CutoutRequest>) => {
  const req = event.data;
  try {
    self.postMessage({ id: req.id, type: 'progress', phase: 'loading' });
    const mask = await computeMask(req);
    self.postMessage({ id: req.id, type: 'result', mask: mask.buffer }, { transfer: [mask.buffer] });
  } catch (error) {
    sessionPromise = null;
    self.postMessage({ id: req.id, type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});
