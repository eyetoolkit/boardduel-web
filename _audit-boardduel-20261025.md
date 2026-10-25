# 棋盘对决（boardduel.com）深度审核报告

- **审核日期**：2026-10-25
- **审核对象**：boardduel.com（CF Pages 项目 boardduel-web，部署 commit `8ac563e14`）
- **审核范围**：8 款棋单机模式 + **对决模式（联机对战）双端闭环** + 服务端 API + UI 入口流
- **审核方式**：playwright-core + 系统 Edge 真实浏览器双 Tab 实测；服务端 API 直连；静态代码审计；220+ 项单元测试

---

## 一、审核结论总表

| 维度 | 结果 | 证据 |
|---|---|---|
| 单机模式（8 款棋） | ✅ 8/8 正常 | smoke-batch4 复跑（部署后），0 console 错误 |
| **对决模式（联机双端闭环）** | ✅ **8/8 ALL GREEN** | duel-closed-loop v6：99 项断言全过，1 次传播滞后正确甄别 |
| 好友房 UI 入口流 | ✅ ALL GREEN | lobby 按钮 → 邀请卡 → 短链 302 → 深链入房，8 项断言全过 |
| 服务端 API | ✅ 全通 | health / 建房 / 房码查询 / 邀请短链 / 8 游戏页 |
| 单元测试 | ✅ 224 项 223 过 0 败 1 跳过 | 含 P0/P1 契约回归 |
| 部署新鲜度 | ✅ 线上 = 本地 HEAD | CF Pages 最新部署 tree 与本地逐字节一致 |

**发现并修复 2 个缺陷**（均已部署上线并复验）：

| 级别 | 缺陷 | 状态 |
|---|---|---|
| **P0** | chess 落子动画 transform 覆盖 → 棋子钉在 SVG 原点，联机对手每手肉眼可见 | ✅ 已修复部署（`2797d1e`），线上复测未复现 |
| **P1** | reversi/connect4 重连首帧权威盘被丢 → 重连后棋盘 stale 到下一手 | ✅ 已修复部署（`6a281a5`），线上重连探针验证通过 |

---

## 二、对决模式（联机对战）验证详表

> 用户重点关注的维度。单机冒烟证明不了联机——历史上 4 个 P0 全在联机同步管线。

### 2.1 协议闭环（每款棋都走完整链路）

```
POST /api/gp/room?name=&game=<g>   → 6 位房码
        ↓
wss://host/ws?code=&name=          → 双 Tab 入房（DO 服务端）
        ↓
/games/<g>/?c=CODE                 → 深链开局
```

两种房间模式均覆盖：

| 模式 | 棋种 | 服务端角色 |
|---|---|---|
| 判棋模式 | reversi / connect4 | 服务端持权威盘，每步广播 state 帧 |
| 中继模式 | gomoku / go / chess / xiangqi / tictactoe / checkers | 服务端转发 + 着法历史，客户端重放重建 |

### 2.2 双端闭环断言（每棋 10-13 项）

建房 API → 双端入房 → 房码双端可见 → 起始盘一致 → 轮流走子（**每手双端盘面指纹逐子比对**：位置 getCTM + 计算色）→ 双方至少各走一手 → 零分歧 → 认输双端达终局 → 双端零 console 错误。

**部署后全量结果：99 项断言全过（8/8 ALL GREEN）**，其中：

| 棋种 | 走子 | 同步 | 终局 |
|---|---|---|---|
| gomoku | A=1 B=2 | 4 手零分歧 | 双端 ✓ |
| tictactoe | A=1 B=2 | 4 手零分歧 | 双端 ✓ |
| connect4 | A=1 B=2 | 4 手零分歧 | 双端 ✓ |
| reversi | A=1 B=2 | 4 手零分歧 | 双端 ✓ |
| go | A=1 B=2 | 4 手零分歧 | 双端 ✓ |
| chess | A=1 B=2 | 4 手零分歧 | 双端 ✓ |
| xiangqi | A=1 B=2 | 4 手零分歧 | 双端 ✓ |
| checkers | A=1 B=1 | 7 手零分歧 | 双端 ✓ |

另记录 1 次传播滞后（lag）：某手后 900ms 内对手端未及应用，延长 2.5s 后收敛——按环境时序方差计，不计失败（判别方法见 §五）。

### 2.3 好友房 UI 入口流（页面内真实路径）

lobby「Create a room」按钮 → `?mode=friend` → 全屏邀请卡 → 短链入房：

| 断言 | 结果 |
|---|---|
| lobby 按钮导航 | ✅ 点击 #createRoom |
| 邀请卡出现 + 6 位房码 | ✅ code=QUCR2R |
| 邀请链接 = origin + /b/<game>/<CODE> | ✅ |
| QR 图加载（服务端 SVG） | ✅ naturalWidth>0 |
| 短链 /b/<game>/<CODE> 302 → 深链 | ✅ |
| B 端经短链入房、房码可见 | ✅ |
| A 端存活、B 端零 pageerror | ✅ |

---

## 三、单机模式与服务端 API

| 项 | 结果 |
|---|---|
| 8 款棋单机冒烟（AI/ pass-through 起局、走子、终局） | ✅ 8/8，0 console 错误 |
| 单元测试 | ✅ 224 项 223 过 0 败 1 跳过（go 引擎/象棋引擎/四子连线/动画 diff/终局口径/导出记谱等） |
| API：health | ✅ 200 |
| API：建房 | ✅ `{"ok":true,"code":...}`，码形 `^[A-Z2-9]{6}$` |
| API：房码查询 | ✅ 200 |
| API：邀请短链 | ✅ 302 → `/games/<g>/?c=CODE` |
| 8 个游戏页 | ✅ 全 200 |

---

## 四、发现的缺陷与修复

### 4.1 P0：chess 落子动画 transform 覆盖（`2797d1e`）

**现象**：联机对战中每落一子，被走棋子渲染到 SVG 原点（棋盘左上角），直到下次重渲染才复位。对手屏幕每手都肉眼可见；本家屏幕因随后的本地重渲染多半自愈，故单机与短暂测试难以暴露。

**根因**：棋子外层 `<g>` 同时承担定位 `transform` 属性与落子动画类。CSS `transform`（keyframes + `animation-fill-mode: both` 的终态 `scale(1)`）会**整体覆盖** SVG transform 呈现属性（presentation 属性优先级最低）→ 棋子定位被抹成原点。chess 是唯一把位置编码在 `<g transform>` 上的游戏（其余棋种位置在 cx/cy 或 CSS left/top，不受影响）。

**证据**：
- 修复前探针：`attr=[151.255,151.255] ctm=[0,0]`，24/32 子判 BROKEN
- 双 Tab 联机截图：对手端棋子堆叠在棋盘左上角（`_audit-chess-bug.png`）

**修法**：动画类从外层定位 g 移到内层动画包裹 g（外层专职定位），未改 CSS。

**验证**：修复后探针 0/32；线上部署后复测「未复现覆盖」；duel 全量 chess 绿。

### 4.2 P1：reversi/connect4 重连首帧权威盘被丢（`6a281a5`）

**现象**：对局中途断线重连后，棋盘停在断线前的旧局，直到任意一方下一手广播才自愈；若刚好错过对手在断线窗口内的一手，则**持续分叉到对局结束**（实测 A 端 6 子、B 端 7 子，同格颜色互异，A 端 stale 到认输）。刷新重进更严重：onConnect 的 newGame() 已把盘重置成初始 4 子，首帧又被丢，玩家对着空盘看对手落子。

**根因**：服务端（games-room.js）下发 state 帧有**两种形状**：
- `broadcastState()`：`{type:'state', state:{board,turn,...}}`（嵌套，每步广播）
- joinState（**每次 WS 连接首帧，含 rejoin 重连**）：`{type:'state', you, code, ...snapshot()}`（board/turn 在**顶层**）

客户端 reversi/connect4 的 `applyServerBoard` 手写形状判断只认嵌套 → 重连首帧的权威盘被静默丢弃。共享模块 online-core 里本就有处理双形状的 `stateBody()`（`inner ?? msg`），roomLiveFromState / opponentNameFromState 都用它，唯独这两个判棋游戏各写了一份只认嵌套的。中继六棋读取 `m.moves` 时顶层优先，不受影响。

**证据**：
- v6 全量实测：reversi ply4 持续分歧（+2.5s 复检仍不一致），A=6 B=7
- 源码对照：worker `games-room.js:432`（joinState 顶层）vs `:1165`（broadcastState 嵌套）；客户端 `reversi/index.ts:996` / `connect4/index.ts:958` 只读 `m.state`
- 线上 bundle 抓取确认新旧码差异点

**修法**：两个 `applyServerBoard` 改用共享 `stateBody(m)`；新增回归测试 `tests/online-state-shape.test.ts`（4 项，锁「顶层 joinState 必须被采纳」）。

**验证**：
- 重连探针（断网漏广播 → 自动重连 → joinState 采纳）：线上 ALL GREEN，双端 7 子一致
- duel 全量 reversi/connect4 绿；npm test 224 项 0 败

---

## 五、测试方法论（本次核心资产）

联机闭环测试工具 `duel-closed-loop.mjs` 六代演进，每一代都踩掉了上一层的方法论缺陷：

| 版本 | 修正的方法论缺陷 |
|---|---|
| v1 | 占用格选择器靠猜（透明命中区当棋子）→ 落子计数恒 0 |
| v2 | 指纹用视口坐标（getBoundingClientRect）→ 滚动/布局微差即假阳性 |
| v3 | 指纹改棋盘固有坐标 getCTM（含自身 transform + viewBox 映射，免疫滚动/布局/CSS 动画）→ **暴露 chess P0**；房码轮询门提前兼作入房门 |
| v4 | 房码轮询门 20s + 回合弹性（覆盖慢连接端） |
| v5 | 轮询门放宽 45s（连跑 8 房浏览器资源衰减，慢端随机） |
| v6 | ① 房码 toast 2.2s 淡出 vs 轮询竞态 → MutationObserver 事前捕获；② 单 ply 分歧缺滞后甄别 → 分歧后延长 2.5s 复检，收敛记 lag 不计失败；③ console 错误补 URL（资源超时需 URL 才能定位） |

**两条关键判别纪律**（环境方差 ≠ 产品 bug）：

1. **滞后甄别**：单次指纹不一致先等 2.5s 复检——收敛 = 传播滞后（环境时序），持续不一致 = 真分歧。chess P0 会持续分歧照杀；reversi P1 的漏帧场景同样持续分歧（修复后收敛）。
2. **隔离复跑对照**：整跑负载下出现的失败（checkers/c4 偶发 0 手、资源 ERR_TIMED_OUT），隔离单跑全绿 → 判定为沙箱网络/资源方差，不计产品缺陷；同时用 3 连跑确认「哪端慢随机、入房后功能全正常」。

已知环境特征（记录备查）：联机握手 2.4-8.5s；vite dev/build 在沙箱内被静默杀（esbuild service 子进程）；git 端点间歇不通（推送走 GitHub Git Data API + tree 等价校验）。

---

## 六、部署记录

| commit | 内容 | 部署 |
|---|---|---|
| `2797d1e` | chess P0 修复 | ✅ CF Pages |
| `1d7ccb9` | 测试工具 v5 | ✅ |
| `6a281a5` | reversi/connect4 P1 修复 + 回归测试 + 工具 v6 | ✅ |
| `4528ab8` | 重连恢复探针 | ✅ |

推送方式：本地 git 端点不通 → GitHub Git Data API 重建 commit 链 → PATCH refs → **tree 等价校验通过**（远端 tree 与本地 HEAD 逐字节一致）→ build-gate（tsc + vite）success → CF Pages 自动部署。线上部署 commit `8ac563e14`。

---

## 七、遗留事项与建议

| 优先级 | 事项 | 说明 |
|---|---|---|
| P2（建议） | 判棋模式重连后 `maybeAutoPass` 的窗口 | 修复后 joinState 即被采纳，stale 盘面上的误判 pass 风险已消除；可保持观察 |
| P2（建议） | 房码一次性消费后刷新丢失 | `clearInviteParam()` 摘掉 `?c=`，用户刷新即回单机局（产品设计如此，重进靠邀请链接）；如嫌突兀可在刷新前 replaceState 保留码 |
| P3（观察） | 联机握手在弱网下 5-9s | 连接 toast 2.2s 即淡出，慢网络用户可能看不到房码反馈；可延长 toast 或加「连接中」持续指示 |
| — | 其余 6 款棋联机管线 | 本次全量绿，无需动作 |

**工具资产**（`_tools/`，均已入库）：duel-closed-loop.mjs（v6 联机闭环）、chess-anim-probe.mjs（动画覆盖探针）、reversi-desync-diag.mjs（分歧定位）、reversi-reconnect-probe.mjs（重连恢复验证）、friend-room-flow.mjs（UI 入口流）、smoke-batch4.mjs（单机冒烟）、checkers-connect-diag.mjs（连接时间线诊断）。

---

*报告生成：2026-10-25 · 全部结论均有可复跑工具与日志支撑（`_audit-*.log`）*
