/**
 * BoardDuel · 联机终局帧（game_over）的统一解析
 * ------------------------------------------------------------
 * 🔴 2026-10-15 新建。本文件的存在理由是一次真实的契约事故：
 *
 * 服务端 worker games-room.js 的 relay 模式广播 game_over 时，
 * 认输发的是 `{ kind:'resign', winner:'黑'|'白', by: 座位号 }`，
 * 提和发的是 `{ kind:'draw', reason:'双方同意' }` —— **没有 winner 字段**。
 * 而全部 8 款前端一致地只认 `winner === 'draw'` 才判和：
 *
 *     if (w === 'draw') { 和棋文案 } else { 胜负分支 }
 *
 * 于是 `w = undefined` 直接落进 else，把「双方同意和棋」渲染成一方胜出的
 * 胜负屏，判词写着「对手认输」。根因是 CORES 只含 { reversi, connect4 }，
 * 8 款里 6 款走 relay，这个缺陷 100% 命中，只有那 2 款侥幸躲过。
 *
 * 本模块的职责是**把协议口径钉死在一个地方**，而不是让 8 个文件各写一份
 * 30 行的 if/else。下次改契约只改这里，且改一处就够。
 *
 * 设计上刻意同时容忍两种形状：
 *   · 新形状 `{ winner:'draw' }`      —— 服务端修复后的正确契约
 *   · 旧形状 `{ kind:'draw' }`       —— CDN 边缘缓存的旧 worker（部署窗口内必然存在）
 * 两边都判和棋。这样前端可以先于服务端上线，不会出现「新前端 + 旧 worker」
 * 期间的结算错判。
 *
 * 用法：
 *     import { parseGameOver } from '../../shared/game-over';
 *     const r = parseGameOver(msg);
 *     if (r.draw) { ... } else { ... }
 */

/** 终局原因。与服务端 reason 字段口径对齐（见 normalizeReason）。 */
export type GameOverReason =
  | 'draw'              // 双方同意和棋
  | 'resign'            // 本方或对手认输
  | 'timeout'           // 棋钟超时判负
  | 'opponent_left'     // 对手离开房间
  | 'natural_over'      // 服务端判定的自然终局（五连 / 棋盘满）
  | 'count';            // 围棋终局数目结算（不是认输，文案差别很大）

export interface GameOverResult {
  /** 是否和棋（双方同意 或 服务端直接判和）。和棋没有赢家，胜负字段一律无意义。 */
  draw: boolean;
  /**
   * 服务端声明的赢家。
   *   · 数字（0/1）= 座位号，用于和 myIdx 比对判胜负
   *   · 'draw'       = 和棋（此时应读 draw 字段，不要读这个）
   *   · null         = 服务端没给（断线宽限期判定等），调用方需自行决定兜底口径
   *
   * 🔴 不要用 [winner !== myIdx] 作为「我输了」的判据，除非先确认 winner 非 null。
   * 修复前和棋错判的次生伤害就在这里：null !== 0 会把双方同时显示成失败。
   */
  winner: number | 'draw' | null;
  /**
   * 服务端声明的赢家颜色名（'黑' / '白'）。
   * 🔴 共享层不把颜色翻译成座位 —— 映射因游戏而异，猜错就是判反胜负。
   *   需要按颜色判胜负的调用方读这个字段，自己按本游戏的 seat 约定换算。
   */
  winnerColor: string | null;
  /** 认输方座位号（仅认输场景有值）。 */
  by: number | null;
  reason: GameOverReason;
  /** 原始 reason 字符串，便于排查未知原因。 */
  rawReason: string;
}

/**
 * reason 归一化。服务端历史上放过中文裸值（'双方同意'），
 * 也放过英文 snake_case（'opponent_left' / 'timeout' / 'natural_over' / 'count'）。
 * 两种都要认，否则同一个语义会走到不同分支。
 *
 * 🔴 这里的 case 是「白名单」：不在表里的一律降级为 'resign'。看起来保守，
 *   但方向是安全的 —— 多一个未知 reason 最多让文案不够精准，而漏掉一个已知
 *   reason 会让「终局数目结算」被显示成「对方认输获胜」（go 的 count 就是这种）。
 *   加新 reason 时记得同步补 case，别指望 default 兜住语义。
 *
 * 2026-10-23 补两个服务端实发但此前漏登记的 reason：
 *   · 'double_pass'（reversi 双方连续停招终局，games-room.js:921）→ 自然终局，
 *     此前落进 default 被渲染成「认输」；
 *   · 'draw_agreed'（双方同意和棋，games-room.js:764）→ draw，
 *     此前靠 winner==='draw' 才判和，只修一半的部署窗口会错判。
 */
function normalizeReason(raw: string): GameOverReason {
  switch (raw) {
    case 'opponent_left':
    case 'timeout':
    case 'natural_over':
    case 'count':
      return raw;
    case 'double_pass':
      return 'natural_over';
    // 🔴 服务端 games-room.js:247 长期发的是中文 '双方同意'，
    //   这里显式并入 draw，不能靠前端各处的 [w === 'draw'] 兜。
    case '双方同意':
    case 'draw_agreed':
      return 'draw';
    default:
      return 'resign';
  }
}

/**
 * 解析服务端 game_over 帧。
 *
 * @param msg WebSocket 收到的原始消息对象
 * @returns 归一化后的终局语义。未知形状一律降级为 { draw:false, winner:null, reason:'resign' }，
 *          由调用方按各自 UI 的兜底口径处理 —— 这里不做猜测性判胜。
 */
export function parseGameOver(msg: Record<string, unknown>): GameOverResult {
  const rawReason = typeof msg.reason === 'string' && msg.reason ? msg.reason : '';
  const kind = typeof msg.kind === 'string' ? msg.kind : '';
  const rawWinner = msg.winner;

  // 和棋的两个独立信号：winner === 'draw'（新契约）或 kind === 'draw'（旧契约）。
  // 两者取或 —— 服务端任一字段到位都能正确判和，这也让「只修一半」的中间态也安全。
  const isDraw = rawWinner === 'draw'
    || kind === 'draw'
    || normalizeReason(rawReason) === 'draw';

  const by = typeof msg.by === 'number' ? msg.by : null;

  let winner: number | 'draw' | null = null;
  let winnerColor: string | null = null;
  if (rawWinner === 'draw') {
    winner = 'draw';
  } else if (typeof rawWinner === 'number') {
    winner = rawWinner;
  } else if (typeof rawWinner === 'string' && /^[01]$/.test(rawWinner)) {
    // 服务端在判棋模式（reversi/connect4）走 seats 结算时会发 '0'/'1' 字符串。
    winner = Number(rawWinner);
  } else if (typeof rawWinner === 'string' && rawWinner) {
    // 🔴 relay 模式认输帧发的是**颜色名**（games-room.js:230 winner:'黑'|'白'），
    //   而座位↔颜色的映射因游戏而异（reversi idx0 是谁？chess 座位序是什么？各端不一），
    //   共享层猜错就是判反胜负 —— 比拿不到更糟。
    //   所以这里只**如实转达颜色名**，座位换算交给调用方按自己的 seat 约定做。
    //   （2026-10-15 踩过：checkers 早期实现直接 `winner===null → 判和棋`，
    //     结果认输帧被渲染成「平局」，端到端探针当场抓到。）
    winnerColor = rawWinner;
  }

  // 🔴 认输且 winner 不可直接用时，用「认输方座位号」推出赢家 —— 这是无歧义的信息：
  //   by 是发起 resign 的那一方（服务端 findIndex 得到的座位号），
  //   两人对局下赢家必然是另一方。不需要知道颜色↔座位映射。
  if (!isDraw && winner === null && by !== null) {
    winner = by === 0 ? 1 : 0;
  }

  return {
    draw: isDraw,
    winner: isDraw ? 'draw' : winner,
    winnerColor,
    by,
    reason: normalizeReason(rawReason),
    rawReason,
  };
}
