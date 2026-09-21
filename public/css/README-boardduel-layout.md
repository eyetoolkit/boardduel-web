# boardduel-layout.css · 棋盘游戏页布局骨架层

> 2026-09-14 从 mathduel「6x6 Sudoku」页实测提取的排版规格（用户认可），
> 改写为 BoardDuel 兼容版。**全站棋盘游戏页共用一套布局**。

---

## 一句话

引入一行 `<link>`，删掉页面私有布局样式，**DOM 与 JS 零改动**，
11 个棋类游戏页立刻统一成 6x6 数独页那套排版。

```html
<link rel="stylesheet" href="/css/boardduel-layout.css?v=bd2">
```

放在共享层样式表**之前**（骨架先定形，增强层后覆盖）：

```html
<link rel="stylesheet" href="/assets/css/puzzle-nav.css?v=...">
<link rel="stylesheet" href="/css/boardduel-layout.css?v=bd2">   <!-- ← 放这里 -->
<link rel="stylesheet" href="/css/shared/tokens.css?v=...">
<link rel="stylesheet" href="/css/shared/components.css?v=...">
<link rel="stylesheet" href="/css/boardduel-game.css?v=...">
<link rel="stylesheet" href="/css/shared/brand-ds2.css?v=...">
```

---

## 为什么需要这一层

实测 11 个棋盘游戏页，**每页各自内联 41~273 行私有样式**，
各自定义 `.game-shell` / `.toolbar` / `.board` / `.cell` / `.t-btn` / `.btn-primary`
一整套布局 —— 结果「容器宽度 / 棋盘尺寸 / 按钮栅格」**11 页 11 个样**。

| 页面 | 总行数 | 私有样式行数 | 控制区类名 |
|---|---|---|---|
| bulls | 441 | 41 | （无） |
| checkers | 761 | 76 | `.actions` `.toolbar` |
| chess | 1484 | 160 | `.actions` `.toolbar` |
| connect4 | 594 | 114 | `.actions` `.toolbar` |
| gomoku | 586 | 113 | `.actions` `.toolbar` |
| mathlink15 | 501 | 44 | （无） |
| othello | 603 | 114 | `.actions` `.toolbar` |
| reversi | 433 | 85 | `.actions` `.toolbar` |
| sudoku | 2826 | 273 | `.controls` |
| tictactoe | 623 | 112 | `.actions` `.toolbar` |
| two048 | 397 | 52 | （无） |

### 迁移进度

| 页面 | 家族 | 状态 | 验证 |
|---|---|---|---|
| tictactoe | A (`.game-shell`) | ✅ 已迁移 | 几何 40/40 + 交互 8/8 + 线上 28/28 |
| bulls | B (`.wrap`) | ✅ 已迁移 | 208 项回归全通过 |
| mathlink15 | B (`.wrap`) | ✅ 已迁移 | 208 项回归全通过 |
| two048 | B (`.wrap`) | ✅ 已迁移 | 208 项回归全通过 |
| checkers | A | ✅ 已迁移 | 静态校验：link=1·棋盘 8×8 保留·CSS sanity 通过 |
| connect4 | A | ✅ 已迁移 | 静态校验：link=1·棋盘 7×6 保留·CSS sanity 通过 |
| gomoku | A | ✅ 已迁移 | 静态校验：link=1·棋盘 15×15 保留·CSS sanity 通过 |
| othello | A | ✅ 已迁移 | 静态校验：link=1·棋盘 8×8 保留·CSS sanity 通过 |
| reversi | A | ✅ 已迁移 | 静态校验：link=1·棋盘 8×8 保留·CSS sanity 通过 |
| chess | （独立） | ⏳ 待评估 | 内容/棋盘复杂 |
| sudoku | （独立） | ⏳ 待评估 | 273 行私有样式 |

本层把这些统一为一套规格。**兼容而非替换** —— 选择器双名并存，
适配各页既有类名，所以迁移不需要改 HTML 结构。

---

## 类名映射表

| 语义 | 本层类名 | BoardDuel 现有类名（同样生效） |
|---|---|---|
| 容器 | `.bd-shell` | `.game-shell` |
| 游戏主区 | `.bd-game` | `.game-main` |
| 页头 | `.bd-head` | `.game-header` |
| 统计/状态栏 | — | `.status-bar` + `.sb-item` / `.sb-ico` / `.sb-val` |
| 工具栏（混排） | — | `.toolbar` + `.t-btn` / `.t-divider` / `.t-spacer` / `.toggle` |
| 控制区（按钮栅格） | `.bd-controls` | `.actions` |
| 棋盘卡 | `.bd-boardcard` | `.board-wrap` |
| 棋盘 | `.bd-board` | `.board` |
| 格子 | `.bd-cell` | `.cell` |
| 玩家卡 | `.bd-players` / `.bd-player` | `.players-bar` / `.p-card` |
| 按钮 | `.bd-btn` | `.t-btn` / `.btn` / `.btn-primary` / `.btn-ghost` / `.btn-big` / `.btn-copy` |
| B 家族容器 | — | `.wrap` |
| B 家族内容卡 | — | `.card` |
| B 家族控制行 | — | `.row` |
| 结果浮层 | — | `.result-overlay` + `.result-text` |
| 对战状态栏 | `.bd-battle-bar` | — |
| 弹层 | `.bd-overlay` / `.bd-modal` | — |
| 战绩卡 | `.bd-statgrid` | — |
| 页脚玩法 | `.bd-footer` | — |

---

## 设计规格（实测值，勿随手改）

| 项 | 值 | 备注 |
|---|---|---|
| 容器 | 移动端**全宽**／桌面 `max-width: 1200px` | 见下方硬规则 1 |
| 内容中轴 | `--bd-content-max: 720px` | 状态栏/工具栏/玩家卡居中约束 |
| 游戏页 padding | 移动 `16px 8px`／桌面 `24px` | |
| 棋盘卡 | 白底 · `radius 18px` · `padding 16px` · 双层柔和阴影 · `max-width 388px` | |
| 棋盘 | 等比正方形 · `max-width 360px` · 居中 | `aspect-ratio` 驱动 |
| 状态栏 | grid 4 列（≤560px 降 2 列） | |
| 控制区 | grid 3 列 · `gap .3rem`（4.8px）· ≤340px 降 2 列 | |
| 按钮 | `min-height/width 44px`（触摸目标）· `font .72rem` · `radius 8px` · `2px solid` 边框 | |
| 网格线 | `.is-lined` gap 透底方案 · `gap: 1px` | 见下方硬规则 3 |

---

## 三条硬规则（踩过坑，别改）

### 1. 移动端容器必须**全宽**

```css
/* ✅ 正确 */
.bd-shell { width: 100%; max-width: 1200px; margin-inline: auto; padding: 12px 8px; }

/* ❌ 错误 —— 为「内容型页面」设计的写法 */
.bd-shell { width: min(100% - 40px, 1200px); }
```

后者会让 360px 视口被 container + 多层 padding 逐层啃到 **264px**，
棋盘显示不全、看起来「整体偏右」（2026-09-14 mathduel 实修）。
游戏页要的是**边缘到边缘**的可用面积。

### 2. 控制区必须用 **grid**，不用 flex+wrap

```css
/* ✅ */
.bd-controls { display: grid; grid-template-columns: repeat(3, 1fr); gap: .3rem; }

/* ❌ flex+wrap 换行后不保证等宽，末行留空洞（历史实拍「按钮网格有空洞」）*/
```

且**不要** `white-space: nowrap` + `overflow: hidden`：
360px 下 3 列每列仅 ~84px，而 `"🔄 New Game"` 需 90px → 硬裁 6px；
**含 emoji/CJK 时 `text-overflow: ellipsis` 根本不生效**，浏览器直接切字。
要允许换行：`white-space: normal` + `word-break: keep-all`。

### 3. 网格线颜色必须走变量

`.is-lined` 原理是**容器填深色 + 格子填白 + `gap:1px` 透出细线**，
线由布局缝隙生成，不存在「各自 border 取整导致错开」的问题。

```css
.bd-board.is-lined { --bd-grid-line: #333; background: var(--bd-grid-line); gap: 1px; }
[data-theme="dark"] .bd-board.is-lined { --bd-grid-line: #475569; }   /* ← 暗色必须换色 */
```

写死深色的话，暗色主题下格子背景也变深 → 两者亮度接近 → **1px 缝完全看不见**。

---

## 内置细节（不必重复实现）

- **暗色主题**：`[data-theme="dark"]` 全量变量覆盖，含浮层/玩家卡/hover
- **减少动效**：`prefers-reduced-motion: reduce` 关闭全部 transition/transform
- **触摸目标**：`.bd-btn` / `.bd-cell` 的 `min-height/min-width: 44px`
- **窄屏状态栏**：`≤380px` 隐藏纯文字标签（Mode/Difficulty/Turn/Status），
  保留图标 + 值 —— 实测 320px 下每格仅 ~139px，
  「🏳️ Status Playing」需 ~150px，会导致 `.sb-val` 被压到 43px 而 `"Medium"`(52px) 硬裁
- **焦点可见**：`:focus-visible` 2px 主色描边
- **格子居中**：`line-height: 1` 避免行框把字形挤偏（实测 dy 可差 0.7px）

---

## 迁移清单（每页 7 步）

1. `<head>` 里加 `<link rel="stylesheet" href="/css/boardduel-layout.css?v=bd2">`，**放在共享层之前**
2. 打开页面 `<style>`，逐条判断：**布局骨架**（删）vs **游戏专属**（留）
3. 删除本层已覆盖的规则：`:root` 变量 / `body` / `.game-shell` / `.game-header` / `.status-bar` / `.sb-*` / `.toolbar` / `.t-*` / `.toggle` / `.board-wrap` / `.players-bar` / `.p-card` / `.board` / `.cell` / `.actions` / `.btn-primary` / `.btn-ghost` / `.result-overlay` / `.result-text`
4. 删除**死样式**：顶部导航 `.g-nav*` / `.g-brand` / `.g-links` / `.g-hamburger`
   （这些页面实际用的是 `#site-header` 共享组件，`.g-*` 已无引用）
5. **保留**游戏专属：棋子配色（`.cell.p0/.p1`）、在线面板（`.op-*`）、聊天（`.chat-*`）、教练条（`.coach-*`）、页脚（`.game-footer`）、语言下拉（`.lang-*`）
6. 清理 `<style>` 尾部残留的孤立 `<!--`（历史遗留，CSS 里会被忽略但会干扰注释配对）
7. 三视口复验（见下）

### tictactoe 试点结果（参照）

| 指标 | 迁移前 | 迁移后 |
|---|---|---|
| HTML 行数 | 624 | 571 |
| 私有样式行数 | 112 | 49 |
| 棋盘（390px） | 320×320 | **342×342** |
| 棋盘（桌面） | 320×320 | **356×356** |
| 容器（桌面） | 560px | **1200px** |
| 状态栏「Mode」 | **被拆成「Mo de」两行** | 单行完整 |

---

## 验证方法

### 本地

```bash
# 起静态服务（参数：ROOT 目录 + 端口）
node static_srv.js "E:/TRAE/Game/_tmp_bd_pilot/public" 8911   # 改造版
node static_srv.js "E:/TRAE/Game/sites/boardduel/public" 8912 # 原版对照

# 三视口几何对比（40 项断言）
node verify_bd_pilot.js
# 交互冒烟（8 项断言）
node smoke_bd_pilot.js
# 中轴 / 居中验证（390/768/1280/1920）
node verify_bd_axis.js
# 线上复测（28 项断言）
node verify_bd_live.js
```

脚本位于 `C:\Users\刘先生\.workbuddy\binaries\node\workspace\`。

### 必查项

- [ ] `boardduel-layout.css` 规则数 **> 80**（确认真的生效，不是被语法错误吞掉）
- [ ] 棋盘 `w === h`（正方形）
- [ ] 棋盘 ≤ 棋盘卡 ≤ 容器
- [ ] `documentElement.scrollWidth - clientWidth <= 1`（无横向滚动）
- [ ] 按钮 `lines === 1`（用 `Range.getClientRects()` 按 top 去重，**别用 `height / lineHeight`**，`lineHeight` 为 `normal` 时会算错）
- [ ] 隐藏元素要排除（`getBoundingClientRect()` 全 0 的是 `display:none` 浮层内的，不算缺陷）

---

## ⚠️ CSS 注释陷阱（本项目已踩两次）

**注释文本里出现 `*/` 会提前闭合注释块**，导致后续内容被当 CSS 解析、**整段规则失效**。

```css
/* ❌ 元凶：注释里的 */ 提前闭合了注释 */
/* 示例见 games/*\/index.html 中的用法。 */

/* ✅ 改写 */
/* 参考各游戏页 index.html 里的实例。 */
```

危险写法：`*.css` / `*.js` / `*.html` / `games/*/index.html`
—— 全部含 `*/` 序列。

**每次改完 CSS 必跑这段自检**：

```python
import io, re
s = io.open(CSS_PATH, encoding='utf-8').read()
st = re.sub(r'/\*[\s\S]*?\*/', '', s)
assert st.count('/*') == 0 and st.count('*/') == 0, "剥离注释后有残留 —— 注释提前闭合"
assert st.count('{') == st.count('}'), "花括号不平衡"
assert s.count('/*') == s.count('*/'), "注释开闭不配对"
# 状态机逐行校验 depth 必须归零
```

---

## 相关文件

- **本层**：`public/css/boardduel-layout.css`
- 增强层：`public/css/boardduel-game.css`（`.bd-player-card` 计时器 + `.bd-mode-bar`，
  注意：其 `.bd-*` 类名目前**零引用**，属待接入的孤儿样式表）
- 共享层：`public/css/shared/{tokens,components,sidebar,toast,brand-ds2}.css`
- 试点页：`public/games/tictactoe/index.html`
- 来源参照：`sites/mathduel/public/games/sudoku-6x6/index.html`

## 待办

- [x] 迁移棋盘游戏页（11 个中已完成 9 个：tictactoe / bulls / mathlink15 / two048 / checkers / connect4 / gomoku / othello / reversi）
- [ ] 迁移剩余 2 个巨型页：chess（160 行私有）/ sudoku（273 行私有），需单独评估
- [ ] `.bd-*` 孤儿样式表：决定接入还是删除
- [ ] 棋盘格子改 `<button>`（当前 `<div>` 不可 Tab 聚焦，既有 a11y 缺口）
- [ ] 共享 sidebar 组件在 **768~948px 区间**有既有 bug：
      `.sb-main` 保留 180px 侧栏偏移但侧栏已 fixed 隐藏 → `body.scrollWidth = 948`
      （`html.scrollWidth` 正常 = 768，故不产生可见滚动条，但布局偏右）
