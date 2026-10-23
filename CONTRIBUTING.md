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

- 代码结构：`src/core/` 是出图核心（纯计算，不依赖页面），`src/render/` 画图纸，`src/ui/` 是页面，`src/workers/` 是后台线程
- 提交说明用 `feat:` / `fix:` / `docs:` / `chore:` 加一句话，例如 `fix: 修复缩放卡顿`
- 改了出图逻辑，请确认 52 / 78 / 104 的出图结果没有意外变化，并跑一遍 `npm test`

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
| `--series` | 成套的图纸写系列 id；新系列第一次用时加 `--series-name 系列名`，可选 `--series-note 一句话说明` |

### 标签和排序

标签分四层，网站上按这个顺序显示：

| 层 | 词 | 规则 |
|---|---|---|
| 尺寸 | 52×52、78×78、104×104 | 自动给，显示在最前面 |
| 大类 | 动漫、游戏、动物、人物、风景、食物、货币、节日、文字 | 每张必须有一个，写在第一个 |
| 细分 | 猫咪、植物、表情、字母、数字 | 可选 |
| 用途 | 杯垫、钥匙扣、冰箱贴、挂画、头像 | 可选 |

- 图纸库的筛选按钮：全部 → 尺寸 → 大类 → 细分 → 用途 → 系列；没有图纸的不显示，系列名和标签同名时只留一个
- 「全部」里的顺序：先按大类分段（顺序同上表）；同一大类里系列在前，最近加入的系列在前，同一天加入的按 `series` 清单的先后；不成系列的单张放这一类最后，新的在前；系列里照系列自己的顺序。整页连着铺，不按系列换行，行尾不留空

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
