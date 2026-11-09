// 构建时由 vite.config.ts 生成：从 public/patterns/index.json 筛出小工具版要带的图纸（见 libraryData 插件）
declare module 'virtual:library-data' {
  const data: unknown;
  export default data;
}
