// 豆图生成：先选豆板尺寸 → 传图自动生成 → 调背景 → 编辑 → 导出。
// 第一次打开是尺寸 + 上传区；传图后是图纸和色号清单，移除背景在工具栏的开关里。换图用「导入」。
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { MAX_CUSTOM_SIDE, SIZES, boardFor, tierFor, type SizeId, type StyleId } from '../core/config';
import { startHistory, type History } from '../core/edit';
import { beadCount, contentBounds, legendOf, type Grid } from '../core/grid';
import type { Mask } from '../core/image';
import type { Reference } from './Editor';
import type { RgbaImage } from '../core/image';
import { resolveKind, type PatternInput, type PatternOptions } from '../core/pipeline';
import { recommendSize } from '../core/recommend';
import { cutout, type CutoutResult } from './cutout';
import { generateInBackground, warmUp } from './generate';
import { Editor, type Doc } from './Editor';
import { UploadCard } from './Upload';
import { DEFAULT_SIZING, SizePicker, modeLabel, type Sizing } from './SizePicker';
import { readPattern } from './pngData';
import { clearDraft, loadDraft, saveDraft, type Draft } from './draft';
import { FileTooLargeError, isHeic, loadImage, MAX_FILE_BYTES } from './loadImage';
import { imageFromPaste } from './paste';
import { createPattern, deletePattern, getPattern, subscribe, updatePattern, type PatternEntry } from './store';

interface Source {
  image: RgbaImage;
  previewUrl: string;
  name: string;
  pixelArt: { cols: number; rows: number } | null;
  original: RgbaImage;
}

interface Props {
  /** 从"我的收藏"或图纸库打开的那一份；换一份就换 key 重新挂载 */
  opened: PatternEntry | null;
  /** 首页上传的图片：带编号，同一张图传两次也会重新处理 */
  incoming?: { file: File; n: number } | null;
  /** 当前是不是在做豆图页（页面一直挂着，切走时顶栏不显示这页的按钮） */
  active?: boolean;
}

/** 原图里拿去出图的那块（主体蒙版或不透明区域的外框），按比例记，方便叠到任意尺寸的预览图上 */
function subjectCrop(image: RgbaImage, mask: Mask | null): Reference['crop'] {
  const { width: w, height: h } = image;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((mask ? mask.data[i] : image.data[i * 4 + 3] / 255) < 0.5) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
    }
  }
  if (x1 <= x0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h };
}

export function Generator({ opened, incoming = null, active = true }: Props) {
  const [source, setSource] = useState<Source | null>(null);
  const [sizing, setSizing] = useState<Sizing>(opened ? { ...DEFAULT_SIZING, mode: opened.size } : DEFAULT_SIZING);
  const [style, setStyle] = useState<StyleId>(opened?.style ?? 'sticker'); // 界面上不再让用户选，默认贴纸风；拖回的 PNG 沿用它存的风格
  const [removeBg, setRemoveBg] = useState(false); // 默认保留背景，用户勾选才抠图
  const [history, setHistory] = useState<History<Doc> | null>(() => (opened ? startHistory({ grid: opened.grid, mirrored: opened.mirrored }) : null));
  // 像素画比所选豆板大、已缩小转换时：告诉用户原样 1:1 要多大的豆板，一点就换
  const [fitHint, setFitHint] = useState<{ cols: number; rows: number; need: SizeId | null } | null>(null);
  const [status, setStatus] = useState<string>(''); // 只放需要用户知道的一句话，生成成功本身不用说
  const [progress, setProgress] = useState<string>(''); // 生成中的进度，结束即清空
  const [error, setError] = useState<string>('');
  // 建议类提示（抠图没找到主体、图太扁、像素画太大）在底部提示条里停 8 秒就收起；出错和进度不自动收
  useEffect(() => {
    if (!status && !fitHint) return;
    const t = window.setTimeout(() => { setStatus(''); setFitHint(null); }, 8000);
    return () => window.clearTimeout(t);
  }, [status, fitHint]);
  const [busy, setBusy] = useState(false);
  const cut = useRef<{ for: RgbaImage; result: CutoutResult } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [genId, setGenId] = useState(0); // 每次重新生成，编辑器的工具状态重置
  const [fullBoard, setFullBoard] = useState(opened?.fullBoard ?? false); // 保留背景的照片占满整块板，检查时不看安全边距
  // 原图对照：生成时记下原图的哪一块对应图纸的哪一块
  const [reference, setReference] = useState<Reference | null>(null);
  // 首页传来的图：先停在选尺寸这一步，选好再生成
  const [pending, setPending] = useState<File | null>(null);
  // 当前图纸在"我的收藏"里的 id：只有用户点了收藏才有；收藏后的编辑自动跟着存
  const [patternId, setPatternId] = useState<string | null>(opened?.id || null); // 图纸库打开的 id 为空：还没收藏
  const [docName, setDocName] = useState(opened?.name && opened.name !== '未命名' ? opened.name : ''); // 空 = 还没起名，不用文件名
  const stage = useRef<HTMLElement>(null);
  useEffect(warmUp, []);

  const edited = !!history && history.past.length > 0;
  // 从"我的收藏"打开的没有原图：只能编辑，不能改尺寸 / 风格重新生成
  // 没有原图、只有图纸：从「我的收藏」打开的，或拖回来的本站图纸 PNG。只能编辑，不能改尺寸风格重新生成
  const fromStore = !source && !!history;

  // 手机上图纸在下方：每次生成完、图纸渲染出来之后再滚过去（渲染前页面不够高，滚不到位）
  useEffect(() => {
    if (genId === 0 || !window.matchMedia('(max-width: 860px)').matches) return;
    const timer = window.setTimeout(() => stage.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    return () => window.clearTimeout(timer);
  }, [genId]);

  // 没收藏的图纸自动存成草稿（只存一张），刷新、关页面再回来能接着改；收藏后改动跟着收藏存，草稿就不要了
  // 等着存的草稿 / 收藏（防抖中），关页面时马上存
  const pendingDraft = useRef<(() => void) | null>(null);
  const pendingStore = useRef<(() => void) | null>(null);
  const [draftOffer, setDraftOffer] = useState<Draft | null>(() => (opened || incoming ? null : loadDraft()));
  useEffect(() => {
    if (!history) return;
    if (patternId) return clearDraft();
    const doc = history.present;
    const save = () => {
      pendingDraft.current = null;
      saveDraft({ name: docName.trim() || '未命名', size: boardFor(doc.grid.width, doc.grid.height) ?? 'large', style, fullBoard, mirrored: doc.mirrored, grid: doc.grid });
    };
    pendingDraft.current = save;
    const timer = window.setTimeout(save, 800);
    return () => {
      window.clearTimeout(timer);
      pendingDraft.current = null;
    };
  }, [history, patternId, docName, style, fullBoard]);
  // 刷新、关页面、切到后台时，还没到点的那次保存马上存，刚改的一笔不丢
  useEffect(() => {
    const flush = () => {
      pendingDraft.current?.();
      pendingStore.current?.();
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  const resumeDraft = (d: Draft) => {
    requestId.current++;
    lastOptions.current = { sizing: { ...sizing, mode: d.size }, style: d.style, removeBg };
    setSource(null);
    setSizing(v => ({ ...v, mode: d.size }));
    setStyle(d.style);
    setFullBoard(d.fullBoard);
    setDocName(d.name === '未命名' ? '' : d.name);
    setPatternId(null);
    setHistory(startHistory({ grid: d.grid, mirrored: d.mirrored }));
    setGenId(n => n + 1);
    setDraftOffer(null);
  };

  // 编辑后自动存回"我的收藏"（稍等半秒合并连续的笔画）
  useEffect(() => {
    if (!history || !patternId) return;
    const doc = history.present;
    const save = () => {
      pendingStore.current = null;
      const ok = updatePattern(patternId, { grid: doc.grid, mirrored: doc.mirrored, name: docName.trim() || '未命名' });
      setError(ok ? '' : '浏览器空间满了，刚才的修改没存进收藏。到「我的收藏」删掉几张，或先导出备份。');
    };
    pendingStore.current = save;
    const timer = window.setTimeout(save, 500);
    return () => {
      window.clearTimeout(timer);
      pendingStore.current = null;
    };
  }, [history, patternId, docName]);

  // 在"我的收藏"页改了收藏 / 删除，这边同步
  useEffect(() => subscribe(() => {
    if (!patternId) return;
    if (!getPattern(patternId)) setPatternId(null); // 在收藏页取消了收藏
  }), [patternId]);

  // 每次生成有一个编号：生成中换了图或改了选项，旧结果回来时直接丢掉
  const requestId = useRef(0);

  // 最近一次生成用的输入：「颜色数量」往右拉时拿它按更高的上限重新生成，并先算出原图最多能出几色
  const lastInput = useRef<{ input: PatternInput; options: PatternOptions } | null>(null);
  // 「颜色数量」往右加色用的多色版：第一次点开时在后台用原图按尽量多的颜色生成一份，之后往右拖就从它合并到想要的色数，不用每次重新生成
  const [rich, setRich] = useState<{ genId: number; grid: Grid } | null>(null);
  const [baseColors, setBaseColors] = useState(0); // 刚生成时的色数：滑块以它为中心
  const richFor = useRef(-1);
  const requestRich = () => {
    const last = lastInput.current;
    if (!last || richFor.current === genId) return;
    richFor.current = genId;
    const at = genId;
    void generateInBackground(last.input, last.options, true).then(grid => setRich({ genId: at, grid }));
  };

  const generate = useCallback(async (src: Source, sz: Sizing, styleId: StyleId, bg: boolean): Promise<void> => {
    const id = ++requestId.current;
    setBusy(true);
    setError('');
    try {
      // 自定义：图案放进宽 × 高；自适应的像素画按 1:1（最大到自定义上限）；其余按选的豆板
      const pa = src.pixelArt;
      const fit = sz.mode === 'custom' ? { w: sz.w, h: sz.h }
        : sz.mode === 'auto' && pa ? { w: Math.min(pa.cols, MAX_CUSTOM_SIDE), h: Math.min(pa.rows, MAX_CUSTOM_SIDE) }
        : undefined;
      // 像素画的格数比豆板能放的还多：不再对半缩（细节会丢一半），改用原图按普通图缩到豆板放得下，并提示换大一号能 1:1
      const limit = fit ?? (sz.mode !== 'auto' && sz.mode !== 'custom' ? { w: SIZES[sz.mode].maxSubject, h: SIZES[sz.mode].maxSubject } : null);
      const tooBig = !!pa && !!limit && (pa.cols > limit.w || pa.rows > limit.h);
      const image = tooBig ? src.original : src.image;
      const pixelArt = !!src.pixelArt && !tooBig;
      if (tooBig && pa) {
        const longSide = Math.max(pa.cols, pa.rows);
        const need = (Object.keys(SIZES) as SizeId[]).find(s => SIZES[s].maxSubject >= longSide) ?? null;
        setFitHint({ cols: pa.cols, rows: pa.rows, need });
      } else {
        setFitHint(null);
      }
      let mask = null;
      let note = '';
      if (bg) {
        if (cut.current?.for !== image) {
          setProgress('正在识别主体…');
          const result = await cutout(image, () => setProgress('首次使用，正在加载抠图模型（约 10MB，只需一次）…'), { allowModel: !pixelArt });
          if (id !== requestId.current) return;
          cut.current = { for: image, result };
        }
        mask = cut.current.result.mask;
        if (cut.current.result.method === 'failed') note = '没找到明显的主体，已保留背景。';
      }
      setProgress('正在生成图纸…');
      await new Promise(r => setTimeout(r, 0));
      const kind = resolveKind({ image, mask, pixelArt });
      // 自适应（非像素画）：按图里细节能保住多少，挑能保住细节的最小一块板
      const sizeId: SizeId = fit ? tierFor(fit.w, fit.h) : sz.mode === 'auto' || sz.mode === 'custom' ? recommendSize(image, mask, kind, null).size : sz.mode;
      const options: PatternOptions = { size: sizeId, style: styleId, fit };
      let input: PatternInput = { image, mask, pixelArt, kind };
      let grid = await generateInBackground(input, options);
      if (id !== requestId.current) return;
      if (mask && beadCount(grid) === 0) {
        // 抠完什么都不剩（主体太小或太碎），退回保留背景
        input = { image, mask: null, pixelArt };
        grid = await generateInBackground(input, options);
        note = '没找到明显的主体，已保留背景。';
      }
      lastInput.current = { input, options };
      if (id !== requestId.current) return;
      if (beadCount(grid) === 0) {
        setHistory(null);
        setError('这张图里没有可以拼的内容，换一张试试');
        return;
      }
      const full = kind === 'photo' && !mask;
      setHistory(startHistory({ grid, mirrored: false }));
      const box = contentBounds(grid);
      setReference(box ? { url: src.previewUrl, crop: subjectCrop(image, mask), box } : null);
      setFullBoard(full);
      setGenId(n => n + 1);
      setBaseColors(legendOf(grid).length);
      setDocName(''); // 文件名常常是一串乱码，不拿来当名字；用户在顶栏或收藏时再起
      setPatternId(null); // 新生成的图纸还没收藏
      const b = contentBounds(grid);
      const longSide = b ? Math.max(b.right - b.left, b.bottom - b.top) + 1 : 0;
      const shortSide = b ? Math.min(b.right - b.left, b.bottom - b.top) + 1 : 0;
      if (shortSide && longSide / shortSide > 2 && !fit && sizeId !== 'large') {
        const tall = b!.bottom - b!.top > b!.right - b!.left;
        note += `图比较${tall ? '瘦长' : '扁'}（最窄处只有 ${shortSide} 颗），可以重新选更大的豆板，或先把图裁到主体。`;
      }
      // 自定义的宽高默认从这次的图案大小开始改
      if (b && sz.mode !== 'custom') setSizing(v => (v.mode === sz.mode ? { ...v, w: b.right - b.left + 1, h: b.bottom - b.top + 1 } : v));
      setStatus(note);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(`生成失败：${e instanceof Error ? e.message : String(e)}。换一张图试试。`);
    } finally {
      if (id === requestId.current) {
        setBusy(false);
        setProgress('');
      }
    }
  }, []);

  // 改了尺寸、风格或背景开关，自动重新生成；如果已经手动改过图，先确认。
  // 自定义的宽高只有在选着「自定义」时才算改了尺寸（其他模式下宽高跟着图案大小更新，不触发重新生成）
  const lastOptions = useRef({ sizing, style, removeBg });
  useEffect(() => {
    const prev = lastOptions.current;
    const sameSize = prev.sizing.mode === sizing.mode && (sizing.mode !== 'custom' || (prev.sizing.w === sizing.w && prev.sizing.h === sizing.h));
    if (sameSize && prev.style === style && prev.removeBg === removeBg) return;
    if (!source || !history) {
      lastOptions.current = { sizing, style, removeBg };
      return;
    }
    if (edited && !window.confirm('重新生成会丢掉你改过的内容，继续吗？')) {
      setSizing(prev.sizing);
      setStyle(prev.style);
      setRemoveBg(prev.removeBg);
      return;
    }
    lastOptions.current = { sizing, style, removeBg };
    void generate(source, sizing, style, removeBg);
  }, [sizing, style, removeBg, source, history, edited, generate]);

  const openFile = async (file: File | undefined, asked = false) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && !isHeic(file)) {
      setError('请选择图片文件（JPG、PNG、HEIC）');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('图片超过 30MB，先压缩一下或截个图再传');
      return;
    }
    // 改过但没收藏的图纸，换图前问一句（收藏过的改动已经自动存了）
    if (!asked && edited && !patternId && !window.confirm('换图会丢掉当前图纸的修改，继续吗？')) return;
    // 开始页上还存着上次没收藏的草稿：新图纸生成后会顶掉它，先问一句，可以顺手收藏
    if (!asked && !history) {
      const draft = loadDraft();
      if (draft) return void setDraftAsk({ file, draft });
    }
    setError('');
    setStatus('');
    // 本站导出的图纸 PNG：直接还原成可编辑的图纸，不重新生成
    const saved = await readPattern(file);
    if (saved) {
      requestId.current++; // 丢掉还在跑的生成
      lastOptions.current = { sizing: { ...sizing, mode: saved.size }, style: saved.style, removeBg };
      setSource(null);
      setSizing(v => ({ ...v, mode: saved.size }));
      setStyle(saved.style);
      setFullBoard(saved.fullBoard);
      setDocName(saved.name);
      setPatternId(null);
      setHistory(startHistory({ grid: saved.grid, mirrored: saved.mirrored }));
      setGenId(n => n + 1);
      setBusy(false);
      setProgress('');
      return;
    }
    setBusy(true);
    setProgress('正在读取图片…');
    try {
      const { image, previewUrl, pixelArt, original } = await loadImage(file);
      const src = { image, previewUrl, name: file.name, pixelArt, original };
      setSource(src);
      setHistory(null);
      await generate(src, sizing, style, removeBg);
    } catch (err) {
      setError(err instanceof FileTooLargeError ? '图片太大（超过 30MB 或像素太多），先压缩一下或截个图再传' : '这张图读不出来，换一张试试。iPhone 照片读不了的话，可以先截图再上传。');
      setProgress('');
      setBusy(false);
    }
  };

  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;

  // ⌘V / Ctrl+V 粘贴图片：没传图时按选好的豆板直接生成；已有图纸时用新图重新生成——
  // 收藏过的直接换（原来的还在收藏里），没收藏的先弹窗问一句，可以顺手收藏
  const [pasteAsk, setPasteAsk] = useState<File | null>(null);
  const [draftAsk, setDraftAsk] = useState<{ file: File; draft: Draft } | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(''), 3000);
    return () => window.clearTimeout(timer);
  }, [note]);
  const onPasteImage = (file: File) => {
    setPending(null);
    if (!history) return void openFile(file);
    if (patternId) {
      void openFile(file, true);
      setNote('已换成新图片，原来的图纸在「我的收藏」里');
      return;
    }
    setPasteAsk(file);
  };
  const onPasteRef = useRef(onPasteImage);
  onPasteRef.current = onPasteImage;
  useEffect(() => {
    if (!active) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromPaste(e);
      if (!file) return;
      e.preventDefault();
      onPasteRef.current(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [active]);

  // 本站导出的图纸 PNG 直接还原；普通图片先回到第一步让用户选尺寸
  const receive = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) return openFile(file); // 交给 openFile 报「图片太大」，不先整份读进内存
    if (await readPattern(file)) return openFile(file);
    if (edited && !patternId && !window.confirm('换图会丢掉当前图纸的修改，继续吗？')) return;
    requestId.current++;
    setSource(null);
    setHistory(null);
    setStatus('');
    setError('');
    setPending(file);
  };
  const receiveRef = useRef(receive);
  receiveRef.current = receive;
  useEffect(() => {
    if (incoming) void receiveRef.current(incoming.file);
  }, [incoming]);

  const pick = () => !busy && fileInput.current?.click();
  // 收藏时可以顺便把名字传进来（编辑器里弹出的起名小框）
  const toggleStar = (newName?: string) => {
    if (!history) return;
    const nameNow = (newName ?? docName).trim();
    if (newName !== undefined) setDocName(newName);
    if (patternId) {
      deletePattern(patternId);
      setPatternId(null);
      return;
    }
    const doc = history.present;
    const id = createPattern({ name: nameNow || '未命名', size: boardFor(doc.grid.width, doc.grid.height) ?? 'large', style, fullBoard, mirrored: doc.mirrored, grid: doc.grid, tags: opened?.tags, libId: opened?.libId });
    if (!id) setError('浏览器空间满了，收藏不进去。到「我的收藏」删掉几张，或先导出备份。');
    setPatternId(id);
  };

  const fileInputEl = (
    <input
      ref={fileInput}
      type="file"
      accept="image/*,.heic,.heif"
      hidden
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        void openFile(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  // 豆板尺寸：放在上传卡片顶部，先选再传图
  const sizeSeg = <SizePicker value={sizing} onChange={setSizing} disabled={busy} />;
  // 编辑器侧栏里的尺寸：有原图才能按新尺寸重新生成
  const aspect = source ? (source.pixelArt ? source.pixelArt.cols / source.pixelArt.rows : source.image.width / source.image.height) : undefined;

  if (!source && !fromStore) {
    return (
      <div className="start-screen">
        <header className="page-head start-head">
          <h1 className="title">将图片转为拼豆图</h1>
          {draftOffer && !busy && !pending && (
            <div className="draft-offer" role="status">
              <span>上次还有一张没收藏的图纸{draftOffer.name !== '未命名' ? `「${draftOffer.name}」` : ''}，要接着改吗？</span>
              <button className="btn primary pill small" onClick={() => resumeDraft(draftOffer)}>接着改</button>
              <button className="btn link small" onClick={() => { clearDraft(); setDraftOffer(null); }}>不用</button>
            </div>
          )}
        </header>
        {pending && !busy ? (
          <div className="pending">
            {sizeSeg}
            <p>已选好图片：<b>{pending.name}</b></p>
            <div className="pending-actions">
              <button className="btn primary pill" onClick={() => { const f = pending; setPending(null); void openFile(f); }}>生成图纸</button>
              <button className="btn link" onClick={() => { setPending(null); pick(); }}>换一张</button>
            </div>
          </div>
        ) : (
          <UploadCard header={sizeSeg} onFile={f => { setPending(null); void openFile(f); }} busy={busy} progress={progress} />
        )}
        {fileInputEl}
        {error && <p className="error center">{error}</p>}
        {draftAsk && (
          <ReplaceAsk
            title="用这张新图片生成？"
            body={`上次没收藏的图纸${draftAsk.draft.name !== '未命名' ? `「${draftAsk.draft.name}」` : ''}会被替换，找不回来了`}
            onSave={() => {
              const { file, draft: d } = draftAsk;
              setDraftAsk(null);
              if (!createPattern({ name: d.name, size: d.size, style: d.style, fullBoard: d.fullBoard, mirrored: d.mirrored, grid: d.grid })) {
                setError('浏览器空间满了，草稿没收藏进去。到「我的收藏」删掉几张，或先导出备份。');
                return;
              }
              setDraftOffer(null);
              void openFile(file, true);
            }}
            onReplace={() => { const f = draftAsk.file; setDraftAsk(null); setDraftOffer(null); void openFile(f, true); }}
            onCancel={() => setDraftAsk(null)}
          />
        )}
      </div>
    );
  }

  return (
    <>
      {fileInputEl}
      <div className="layout">
        {/* 还在上传页（没有图纸）时，出错写在这里；有图纸以后所有提示都放在底部浮出的提示条里，不占图纸上方的位置 */}
        {!history && error && (
          <div className="gen-notes">
            <p className="error">{error}</p>
          </div>
        )}
        <main className="stage" ref={stage}>
          {history ? (
            <Editor
              key={genId}
              history={history}
              onHistory={setHistory}
              style={style}
              fullBoard={fullBoard}
              starred={!!patternId}
              onImport={pick}
              reference={source ? reference : null}
              active={active}
              removeBg={source ? removeBg : undefined}
              onToggleRemoveBg={() => setRemoveBg(v => !v)}
              busy={busy}
              notice={busy ? progress : error ? error : fitHint && source ? (
                <>
                  这张像素画是 {fitHint.cols}×{fitHint.rows}，比{sizing.mode === 'custom' ? `自定义的 ${sizing.w}×${sizing.h}` : ` ${modeLabel(sizing.mode)} `}大，已缩小转换
                  {fitHint.need && <button onClick={() => setSizing(v => ({ ...v, mode: fitHint.need! }))}>换成 {SIZES[fitHint.need].label}</button>}
                </>
              ) : status || null}
              onToggleStar={toggleStar}
              colorRange={source && lastInput.current ? { base: baseColors, rich: rich?.genId === genId ? rich.grid : null, onOpen: requestRich } : undefined}
              sizing={source ? { value: sizing, onChange: setSizing, aspect } : undefined}
              name={docName}
              onRename={setDocName}
            />
          ) : (
            <div className="empty"><p>{busy ? progress : ' '}</p></div>
          )}
        </main>
      </div>
      {pasteAsk && (
        <ReplaceAsk
          title="用这张新图片重新生成？"
          body="当前图纸还没收藏，换图后就找不回来了"
          onSave={() => { const f = pasteAsk; setPasteAsk(null); toggleStar(); void openFile(f, true); }}
          onReplace={() => { const f = pasteAsk; setPasteAsk(null); void openFile(f, true); }}
          onCancel={() => setPasteAsk(null)}
        />
      )}
      <div className={`toast ${note ? 'show' : ''}`} role="status" aria-live="polite">{note}</div>
    </>
  );
}

/** 换新图会顶掉没收藏的图纸（编辑中粘贴新图、开始页上还有草稿）：先问一句 */
function ReplaceAsk({ title, body, onSave, onReplace, onCancel }: { title: string; body: string; onSave: () => void; onReplace: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    primary.current?.focus(); // showModal 会把焦点给第一个按钮（取消），改成给主按钮
  }, []);
  return (
    <dialog ref={dialog} className="ask" onClose={onCancel} onClick={e => { if (e.target === dialog.current) dialog.current.close(); }} aria-labelledby="paste-ask-title">
      <h2 id="paste-ask-title">{title}</h2>
      <p>{body}</p>
      <div className="ask-actions">
        <button className="btn link" onClick={() => dialog.current?.close()}>取消</button>
        <button className="btn pill" onClick={onReplace}>直接换</button>
        <button ref={primary} className="btn primary pill" onClick={onSave}>收藏后再换</button>
      </div>
    </dialog>
  );
}
