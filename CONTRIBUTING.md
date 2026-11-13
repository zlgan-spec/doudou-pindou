# 参与贡献

谢谢你愿意参与 DouDou！

## 提问题和建议

在 [Issues](https://github.com/zlgan-spec/doudou-pindou/issues/new/choose) 里选模板：

- **问题反馈**：附上操作步骤、浏览器和截图，有原图更好（只发你有权分享的图）
- **图纸版权申诉**：附上作品链接和权属说明，核实后会尽快移除

## 本地开发

需要 Node.js 20 以上。

```bash
npm install
npm run dev        # http://localhost:5190
npm test           # 单元测试
npm run build      # 类型检查 + 打包
```

- 代码结构：`src/core/` 是出图核心（纯计算，不依赖页面），`src/render/` 画图纸，`src/ui/` 是页面，`src/workers/` 是后台线程，`src/platform/` 是渠道适配层（`web/` 网站、`xhs/` 小红书小工具，同一个接口 `types.ts`）。页面里凡是「这个渠道怎么做」的事（存储、保存图纸、抠图、外链、文案）只问 `platform`，不自己判断环境
- 提交说明用 `feat:` / `fix:` / `docs:` / `chore:` 加一句话，例如 `fix: 修复缩放卡顿`
- 改了出图逻辑，请确认 52 / 78 / 104 的出图结果没有意外变化，并跑一遍 `npm test`

### 改界面：组件和档位

整站是一套组件，数值只从档位里取。档位写在 `src/ui/styles.css` 开头的变量里（那里是唯一的一份，下面只说有哪几类）：

| 类别 | 变量 | 用法 |
|---|---|---|
| 字号 | `--text-xs` 到 `--text-xl`、`--title-s` 到 `--title-l` | 正文五档、标题三档；首页大标题随屏宽变，是特例 |
| 圆角 | `--radius-2xs` / `-xs` / `-s` / `--radius` / `--radius-pill` | 正圆用 `50%` |
| 阴影 | `--shadow-0` 到 `--shadow-3`、`--shadow-up` | 浮起越高档位越大 |
| 描边环 | `--ring-focus` / `--ring-selected` / `--ring-line` / `--edge-inset` | 聚焦、选中、细线框、彩色块内边线 |
| 控件高度 | `--control-s` / `-m` / `-l` | 可点的按钮、输入框 |
| 间距 | 不设变量 | 24px 以内用 2 的倍数，24–64px 用 4 的倍数 |

- `npm test` 里的 `tests/style-scale.test.ts` 会查 `styles.css`：出现档位外的字号、圆角、阴影、间距就不通过。确实需要时，在同一行写注释 `/* 特例：原因 */`
- 本地开发时打开 `http://localhost:5190/#/kit` 是组件页（不进正式版）：档位和现有组件都摆在上面。**新增组件先在 `src/ui/Kit.tsx` 登记一份**，和旁边的组件摆在一起看是不是一套
- 新组件先看能不能用现有的 class 拼出来（按钮 `.btn`、分段 `.seg`、标签 `.chips`、卡片 `.color-grid`、文件夹 `.folder` 等），不够再加
- 小工具要兼容老安卓：`aspect-ratio`、`inset` 简写这类新写法要么不用，要么配 `@supports` 回退

### 小红书小工具版

同一份代码的另一个构建（`vite build --mode xhs`，产物在 `dist-xhs/`）：没有抠图模型和后台线程、图纸库打进包里（只带作者 DouDou、出处 AI 原创的图纸）、保存图纸走平台的存相册接口、兼容 Chrome 61。

```bash
npm run build:xhs   # 类型检查 + 构建
npm run pack:xhs    # 构建 + 文件类型检查 + 不含网站版代码检查 + 安全扫描 + 打成 release/doudou-minitool-<版本>.zip
```

打包脚本自带的扫描规则是通用的（密钥字样、本机路径、邮箱、source map）；维护者可以用 `DOUDOU_SCAN_RULES=/path/to/rules.json` 再加一份放在仓库外的规则（格式见脚本开头）。任何一条命中都不出 zip。

### 本地预览的两个开关（只在开发服务器里生效）

- `DOUDOU_LIBRARY=/path/to/index.json npm run dev`：用这份图纸库文件代替 `public/patterns/index.json`，预览还没上线的图纸
- `DOUDOU_TEST_IMAGES=/path/to/images npm run dev`：出图测试台（`harness.html`）从这个文件夹读测试图，默认是 `test-images/`（不进仓库）

## 给图纸库加图纸

### 收什么

- 只收原创，或原作者明确同意收录的图纸
- 照别人的图纸复刻的，作者写原作者，不写原创
- 图案不超过 104×104（网站会自动放进能装下它的最小豆板）

### 步骤

1. 在网站「做豆图」里做好图纸，点「下载」得到 PNG（PNG 里带着格子数据）
2. 运行导入脚本：

```bash
node scripts/add-pattern.mjs 图纸.png --id cat-cafe-coaster --tags 猫咪,杯垫 --author 作者 --source 原创 --series cat-coaster --series-name 猫咪杯垫
```

3. `npm run dev` 打开「图纸库」检查，再提交

### 参数

| 参数 | 说明 |
|---|---|
| `--id` | 小写英文、数字和短横线。同一个 id 再跑一次就是更新 |
| `--tags` | 只能用 [`src/ui/tags.json`](src/ui/tags.json) 里的词，**第一个写大类**（见下）；尺寸标签自动给，不用写 |
| `--name` | 不写就用 PNG 里存的名字 |
| `--author` / `--source` / `--link` | 作者、出处、原图网址（只认 https） |
| `--variant-of` | 这张是另一张图纸的另一个尺寸时，写那张的 id。图纸库里不单独出卡片，在那张的大图里切换尺寸；名字、标签、出处写成和那张一样 |
| `--series` | 成套的图纸写系列 id；新系列第一次用时加 `--series-name 系列名`，可选 `--series-note 一句话说明` |

### 标签和排序

标签分四层：

| 层 | 词 | 规则 |
|---|---|---|
| 尺寸 | 52×52、78×78、104×104 | 自动给 |
| 大类 | 动漫、游戏、动物、人物、潮玩、风景、食物、货币、节日、文字、其他 | 每张**有且只有一个**，写在第一个。动漫、游戏里的角色写作品那一类，不再另写「人物」「动物」 |
| 细分 | 猫咪、植物、表情、字母、数字 | 可选 |
| 用途 | 杯垫、钥匙扣、冰箱贴、挂画、头像 | 可选 |

- 图纸库首页是文件夹：一个系列一个文件夹（顺序按大类、新的在前），不成系列的图纸收在「散装」里；上面一排大类（单选）只筛文件夹。搜索或选尺寸时不看文件夹，直接列图纸。尺寸是搜索框旁边的下拉
- 细分和用途标签在图纸库里至少 5 张才单独出按钮，不够的搜索照样搜得到；我的收藏里有就出
- 旧数据用 `node scripts/normalize-tags.mjs` 整理（每张只留一个大类，风景补「挂画」）
- 「全部」里的顺序：系列清单里写了 `"pinned": true` 的（热门的）排最前；其余先按大类分段（顺序同上表）；同一大类里系列在前，最近加入的系列在前，同一天加入的按 `series` 清单的先后；不成系列的单张放这一类最后，新的在前；系列里照系列自己的顺序。整页连着铺，不按系列换行，行尾不留空。选了大类、系列或尺寸，结果也保持这个先后

### 文件格式

结果写进 `public/patterns/index.json`：

```json
{
  "v": 1,
  "series": [{ "id": "cat-coaster", "name": "猫咪杯垫", "note": "一句话说明", "cover": "cat-cafe-coaster" }],
  "patterns": [{
    "id": "cat-cafe-coaster", "name": "猫咪杯垫 咖啡", "tags": ["猫咪", "杯垫"],
    "author": "作者", "source": "原创", "addedAt": "2026-10-23", "mirrored": false,
    "series": "cat-coaster",
    "colors": ["H7", "H2", "A4"],
    "rows": ["..00..", ".0110.", "012210"]
  }]
}
```

- 每张图纸只存图案范围，一行一个字符串：`.` 是空格，其他字符按顺序对应 `colors` 里的色号（`0` 是第一个色号）
- 一套至少 3 张才在「全部」里收成一张系列卡；系列清单的先后就是显示的先后；图纸名以系列名加空格或「·」开头的，系列页里只显示后半段
- 网站读这个文件时会逐条检查，色号不在 MARD 221 色里、行长不一致、标签不在词表里的会被跳过或去掉
