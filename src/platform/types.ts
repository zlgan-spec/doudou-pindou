// 渠道适配层的接口：同一份页面代码，网站版和小红书小工具版各实现一份（src/platform/web、src/platform/xhs）。
// 页面里凡是「在这个渠道怎么做」的事都只问 platform，不自己判断环境：
// 存东西、保存图纸、抠图模型、后台线程、图纸库从哪读、图片怎么解码、哪些按钮要不要出现、按渠道写的文案。
// 构建时按 --mode 选实现（vite.config.ts 的 @platform 别名），不会把另一个渠道的代码打进包里。
import type { ComponentType, ReactNode } from 'react';
import type { Grid } from '../core/grid';
import type { RgbaImage } from '../core/image';
import type { PatternInput, PatternOptions } from '../core/pipeline';

/** 和 localStorage 一样的同步用法；小工具版启动时先把平台存储读进内存 */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 这个渠道有没有这项能力：没有的，对应的按钮和文字就不出现 */
export interface Caps {
  /** 顶栏深浅色切换（否则跟随系统） */
  themeToggle: boolean;
  /** 能放外链（GitHub、图纸库原图链接） */
  externalLinks: boolean;
  /** 我的收藏导出 / 导入备份 */
  backup: boolean;
}

export interface ExportImage {
  /** 文件名（网站版多张时打进压缩包用） */
  name: string;
  /** PNG data URL */
  url: string;
}

export interface ExportRequest {
  title: string;
  /** 单张时的文件名 */
  fileName: string;
  /** codes：图上写不写色号。返回要存的每张图，第一张是总览 / 唯一一张 */
  build(codes: boolean): ExportImage[];
}

export interface NoteAction {
  label: string;
  run: () => void;
}

/** 平台操作的结果提示（存相册成功、没权限……），App 用底部提示条显示 */
export interface Note {
  text: string;
  actions?: NoteAction[];
}

/** 按渠道写的文案 */
export interface Copy {
  /** 收藏存不下时的提示；what 是没存进去的那件事（「收藏不进去」「刚才的修改没存进收藏」） */
  storageFull: (what: string) => string;
  /** 页面崩溃时怎么办 */
  crashHint: string;
  /** 上传区的一句提示；没有就只留按钮 */
  uploadHint: string | null;
  /** 编辑器右上角保存按钮：下载 / 存相册 */
  exportLabel: string;
  exportingLabel: string;
  exportTitle: string;
  /** 图纸库、收藏大图旁的保存按钮 */
  sheetExportLabel: string;
  /** 大图旁的一句说明 */
  viewerHint: string;
  /** 我的收藏底部的一句说明 */
  mineNote: string;
  /** 色卡库：点色卡之后的提示和说明 */
  colorPicked: (code: string) => string;
  colorsHint: string;
  colorsFaq: string;
  /** 调整菜单里「移除背景」的小字 */
  removeBgHint: string;
  /** 抠图没认出主体 */
  cutoutFailed: string;
  /** 抠图模型加载中（没有模型的渠道用不到） */
  cutoutLoading: string;
  /** 用户协议：版本、更新日期、开头两段、各节 */
  terms: {
    version: string;
    updated: string;
    intro: ReactNode;
    readFirst: ReactNode;
    sections: Array<{ title: string; body: ReactNode[] }>;
  };
  /** 页脚一行 */
  footer: ReactNode;
  /** 顶栏右侧的仓库链接；没有就不放 */
  repoUrl: string | null;
}

export interface Platform {
  id: 'web' | 'xhs';
  caps: Caps;
  copy: Copy;
  /** 渲染页面前要做完的事（读平台存储、量安全区、补 polyfill……） */
  boot(): Promise<void>;
  storage: KeyValue;
  /** 用户选的图片先转成浏览器能解码的格式（HEIC 等） */
  decodeImage(file: File): Promise<Blob>;
  /** 真全屏（编辑器和大图的全屏按钮）；没有的渠道是 null，按钮不出现 */
  fullscreen: { enter(): void; exit(): void } | null;
  /** 写剪贴板（色卡库点一下复制色号）；没有的渠道是 null，点了只选中 */
  copyText: ((text: string) => Promise<void>) | null;
  /** 抠图模型：返回和图片同尺寸的 0–1 遮罩；没有模型的渠道是 null */
  cutoutModel: ((image: RgbaImage, onLoading: () => void) => Promise<Float32Array>) | null;
  /** 先把出图的后台线程起好（做豆图页一打开就调） */
  warmUp(): void;
  /** 出图；rich 是「颜色数量」往右用的多色版 */
  generate(input: PatternInput, options: PatternOptions, rich: boolean): Promise<Grid>;
  /** 图纸库原始数据（格式见 CONTRIBUTING.md），读不到返回 null */
  loadLibraryData(): Promise<unknown>;
  /** 存出来的图纸画多大（每格多少像素的倍数）：网站版下载给高清，小工具版照顾手机编码速度 */
  exportScale(grid: Grid): number;
  /** 保存图纸：网站版直接下载，小工具版先预览再存相册。返回的 Promise 结束表示这边的事做完了 */
  exportSheet(req: ExportRequest): Promise<void>;
  /** 订阅平台操作的结果提示 */
  onNote(fn: (note: Note) => void): () => void;
  /** 要挂在 App 里的渠道组件（小工具版：存相册预览弹窗）；没有就不挂 */
  Host: ComponentType | null;
  /** 首页「分享」入口：有就出现 */
  share: { available(): boolean; run(): void } | null;
}
