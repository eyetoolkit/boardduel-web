# BoardDuel 分支与发布规范

与 MathDuel 采用同一套架构：**主干开发 + 发布阶段开关（feature flag）+ 环境分层**。
核心原则：**代码同构，配置分环境** —— 上线新游戏只改一个 `data-stage` 标记，
不需要迁移文件、不需要改构建配置。

---

## 一、分支模型

```
main                     生产环境    boardduel.com
  ▲ 合并（游戏打磨完成）
  │
beta                     测试环境    beta.boardduel.com
  ▲ 合并（自测通过）
  │
game/<slug>              功能分支    <branch>.boardduel-web.pages.dev
```

| 分支 | 用途 | 生命周期 |
|---|---|---|
| `main` | 生产。只接受来自 `beta` 的合并 | 长期 |
| `beta` | 公开测试。接受来自 `game/*` 的合并 | 长期 |
| `game/gomoku` 等 | 单游戏开发 | 合并后删除 |

---

## 二、环境与域名

| 环境 | 分支 | 访问地址 | `VITE_SHOW_BETA` |
|---|---|---|---|
| 生产 | `main` | https://boardduel.com | 空（剔除 beta 游戏） |
| 测试 | `beta` | https://beta.boardduel.com | `1` |
| 预览 | `game/*` | https://<branch>.boardduel-web.pages.dev | `1` |

> Cloudflare Pages 不支持把自定义域名绑定到非生产分支，
> 因此 `beta` 环境由独立项目 `boardduel-beta` 承载（其生产分支设为 `beta`）。

---

## 三、游戏发布阶段（feature flag）

首页 `index.html` 里每个游戏入口（卡片 + 侧边栏）都带 `data-stage`：

| stage | 含义 | 生产可见 | beta 可见 |
|---|---|---|---|
| `live` | 已正式上线 | ✅ | ✅ |
| `beta` | 代码就绪，仍在打磨 | ❌ | ✅ |
| `coming` | 尚未开发 | ❌ | ❌ |

```html
<a href="/games/gomoku/" data-stage="beta" class="game-card-cover">…</a>
```

**构建时过滤，不是运行时隐藏** —— `vite.config.ts` 的 `filter-stage` 插件
在生产构建直接把 `data-stage="beta"` 的元素从 HTML 中删除。好处：

- 线上源码里不残留未上线游戏的链接，SEO 准确
- 不依赖 JS，爬虫和禁用 JS 的浏览器看到的都是正确版本
- `src/pages/home.ts` 只做兜底（防御 CDN 缓存的旧 HTML）

**上线一款游戏 = 把它的 `data-stage` 改成 `live`，推 `main`。**

---

## 四、标准流程（以 Gomoku 为例）

```bash
# 1. 开发
git checkout beta
git checkout -b game/gomoku
# ... 写代码 ...
git push -u origin game/gomoku
# → 自动预览 https://game-gomoku.boardduel-web.pages.dev

# 2. 进入公开测试
git checkout beta && git merge game/gomoku && git push
# → https://beta.boardduel.com 上可玩

# 3. 正式上线
# 编辑 index.html：该游戏的 data-stage 改为 live
git checkout main && git merge beta && git push
# → https://boardduel.com 自动出现该游戏
```

**顺序不能反**：先 `main` 合并 `beta`（拿到代码），再改 `data-stage` 提交。
反过来主站就只有开关没有代码。

---

## 五、目录结构

```
index.html               首页（Vite 入口，SEO meta 全部保留）
src/pages/home.ts        发布阶段兜底逻辑
public/                  原样拷贝：SEO 页面、7 语种目录、SW、manifest、共享运行时
public/games/tictactoe/  井字棋（当前唯一上线游戏）
legacy/games/            未上线的 4 款旧游戏，仅测试环境发布
scripts/copy-legacy.mjs  按 VITE_SHOW_BETA 决定是否复制 legacy
```

`public/` 里的文件 Vite 不做任何处理，直接进 `dist`，
所以原有的 SEO 页面、多语言目录、service-worker 全部零改动保留。

---

## 六、为什么井字棋保留旧实现

井字棋页面（571 行）带**联机对战**能力：房间码、大厅、随机匹配、聊天，
依赖 `/assets/js/match-mode.js` + WebSocket（`ws.boardduel.com`）以及 40 多个固定 DOM id。

把它重写进新架构会丢掉联机功能 —— 主站唯一上线的游戏反而变弱，
所以当前**原样保留**，只补了一个小改进：支持 `?ai=easy|normal|hard` 难度直链。

后续若要重写，正确顺序是先把 `match-mode.js` 模块化，再重写页面，
而不是反过来。其余 4 款（gomoku / chess / connect4 / reversi）同理。

---

## 七、注意事项

1. **改环境变量后必须重新部署才生效** —— 已有部署不会回溯应用新变量。
2. **`pnpm build` / `pnpm build:beta`**：后者强制注入 `VITE_SHOW_BETA=1` 用于本地验证。
3. **不要在 `beta` 上单独改 `data-stage`** —— 两分支代码应保持一致，差异只由环境变量决定。
4. **新建 Pages 项目必须先带 `source` 创建**。用最小参数创建会变成 Direct Upload 类型，
   之后无法改成 Git 连接（报错 `You cannot update the source object`），只能删掉重建。
5. **自定义域名的 DNS 记录不会自动创建**。Pages API Token 没有 DNS 权限，
   绑定域名后要用 `X-Auth-Email` + `X-Auth-Key`（Global API Key）手动建 CNAME。
6. **`sitemap.xml` 目前仍列着 4 款未上线游戏**，后续应清理或改为按环境生成。
