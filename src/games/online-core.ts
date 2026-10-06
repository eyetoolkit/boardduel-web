/**
 * BoardDuel · 共享在线双人房（WS）接线
 * 参照 gomoku 的 enterRankedRoom 范式，抽成可复用模块，
 * 供 tictactoe / connect4 / reversi / chess 的 online 模式复用。
 *
 * 后端契约（tri-sites worker · games-room.js）：
 *  - 建房：POST /api/gp/room?game=<id>&name=<n>  → { ok, code }
 *  - 进房：WebSocket /ws?code=<CODE>&name=<n>
 *  - relay 模式(chess/tictactoe)：客户端发 {type:'move',...}，服务器原样转发为 {type:'opponent_move',...,by}
 *  - judgment 模式(connect4/reversi)：客户端发 {type:'place',p,...}，服务器权威校验后广播 {type:'state',...} + {type:'opponent_place',...,by}
 *  - 双向消息：start / game_over / opponent_leave / restart_notify / move_ack / chat / pass_notify
 */
export interface OnlineState {
  ws: WebSocket | null;
  roomCode: string | null;
  myIdx: number | null;
  mode: string;
}

export type OnlineMsg = Record<string, unknown>;

export interface OnlineHandlers {
  /**
   * 本次 WS 连接只触发一次（首帧 state 握手时）。
   * ⚠️ 不要在这里做 newGame() 之类会被反复触发的重置 —— judgment 模式每步都有 state 帧。
   */
  onConnect?: (myIdx: number, code: string) => void;
  /** 第二人进房广播。带 players（对手昵称），见 applyRoomState 那类用法。 */
  onStart?: (msg: OnlineMsg) => void;
  onOpponentMove?: (msg: OnlineMsg) => void;
  onOpponentPlace?: (msg: OnlineMsg) => void;
  onState?: (msg: OnlineMsg) => void;
  onGameOver?: (msg: OnlineMsg) => void;
  onOpponentLeave?: () => void;
  onRestart?: () => void;
  onPassNotify?: (msg: OnlineMsg) => void;
  /** 服务端拒绝（illegal_move / not_your_turn / 对方未连接…）。
   *  可选：未提供时该消息被忽略，行为与此前一致。 */
  onError?: (msg: OnlineMsg) => void;
}

/* ═══════════ 联机再战回声闸（2026-10-06）═══════════
 * 服务端 restart 是无差别广播：发起方自己也会收到 restart_notify
 * （games-room.js:698 中继模式 / :704 判棋模式）。而发起方在发送那一刻
 * 已经自己 newGame() 过一次 —— 若不吞掉回声，回声会在 WS 往返窗口里
 * 把玩家刚落下的一手擦掉（症状：自己的子凭空消失）。
 *
 * 收口在共享模块，棋种零改动：sendWs 见 type==='restart' 自动上闩，
 * restart_notify 分发处自动吞掉自己那一次。各棋种的 newGame()/onRestart 保持原样。
 * ⚠️ 自带 WS 的 gomoku / go 不走 sendWs，需在各自 restart 收发处自行处理。
 * ═══════════════════════════════════════════════════════════════ */

/* ═══════════ 联机等待态（2026-10-06）═══════════
 * 服务端 `state` 消息带 roomStatus（waiting / playing）与 players（含真实昵称），
 * 第二人加入时广播 `start`。此前这些信息被各棋种整体丢弃，导致建房后：
 *   ① 计时器在对手没进来时就开跑
 *   ② 对手侧时钟写着「引擎 · XX」（根本没有引擎）
 *   ③ 没人时也能落子 → 本地走了、服务端拒、start 一来清盘 →「子凭空消失」
 * ③ 早在 10-05 由 go 站用 rankedLive 单独堵过，其余棋种没跟上，这里统一收敛。
 * 行业通行做法（lichess / chess.com / 通用好友房）一致：等对手期间棋盘锁定、时钟不走。
 */

/** state 消息有两种形状：{you,code,game,roomStatus,players} 与 {state:{...}}。
 *  这里统一取出内层对象，避免各棋种各写一遍形状判断。 */
export function stateBody(msg: OnlineMsg): OnlineMsg {
  const inner = (msg.state && typeof msg.state === 'object') ? msg.state as OnlineMsg : null;
  return inner ?? msg;
}

/** 房间是否已有对手（真正开局）。仅靠 roomStatus 判断，不猜座位映射。 */
export function roomLiveFromState(msg: OnlineMsg): boolean {
  return String(stateBody(msg).roomStatus || '') === 'playing';
}

/** 从 state 消息解出对手昵称；人数不足返回 null。 */
export function opponentNameFromState(msg: OnlineMsg, myIdx: number | null): string | null {
  const players = stateBody(msg).players as { idx?: number; name?: string }[] | undefined;
  if (!Array.isArray(players) || players.length < 2) return null;
  const other = players.find((p) => p && p.idx !== myIdx && p.idx !== undefined);
  return other?.name || null;
}

/** 读取 ?c= 房间码（worker /b/<game>/<CODE> 会 302 到 ?c=<CODE>）
 *  2026-10-05 残留1同类修复：兼容 ?room= / ?code=（第三方/手写房间链接此前被丢弃） */
export function inviteCode(): string {
  try {
    const q = new URLSearchParams(location.search);
    const c = q.get('c') || q.get('room') || q.get('code');
    if (!c) return '';
    return /^[A-Za-z0-9]{5,8}$/.test(c) ? c.toUpperCase() : '';
  } catch {
    return '';
  }
}

/** 清掉 ?c= / ?room= / ?code= / ?vs=，保留其它查询参数（如语言） */
export function clearInviteParam(): void {
  try {
    const u = new URL(location.href);
    u.searchParams.delete('c');
    u.searchParams.delete('room');
    u.searchParams.delete('code');
    u.searchParams.delete('vs');
    const q = u.searchParams.toString();
    history.replaceState(null, '', u.pathname + (q ? '?' + q : '') + u.hash);
  } catch {
    /* 无 history 也要能玩 */
  }
}

/** 我的 UUID（沿用站点通用 pid cookie / Account 模块） */
export function myUuid(): string {
  const m = document.cookie.match(/(?:^|;\s*)pid=([^;\s]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
export function myName(): string {
  // 🔴 不能写死 'Player'：服务端 resolveIdx 会按 name 复用座位，
  // 两个匿名玩家同名会被分进同一座位（双方都执黑、互不走子）——2026-10-05 PvP 实测。
  // 生成一次后持久化到 localStorage，保证同一浏览器刷新/重连名字稳定。
  try {
    const KEY = 'bd_nick';
    let n = localStorage.getItem(KEY);
    if (!n) {
      n = 'Player-' + Math.random().toString(36).slice(2, 6);
      localStorage.setItem(KEY, n);
    }
    return n;
  } catch {
    return 'Player-' + Math.random().toString(36).slice(2, 6);
  }
}

export function wsUrl(code: string, name: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`;
}

/** 联机再战回声闸：armed=true 表示「本方刚发过 restart」。
 *  见本文件顶部说明。模块级单例——一个页面只跑一款棋。 */
const restartEcho = { armed: false };

export function sendWs(state: OnlineState, obj: OnlineMsg): void {
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  // 自己发起再战 → 记一笔，稍后吞掉服务端回给自己的 restart_notify
  if (obj.type === 'restart') restartEcho.armed = true;
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    /* ignore */
  }
}

/** 进入房间：建 WS 并挂通用消息分发，按游戏类型回调 handlers */
export function enterRoom(state: OnlineState, code: string, handlers: OnlineHandlers): void {
  state.roomCode = code;
  state.mode = 'online';
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl(code, myName()));
  } catch {
    return;
  }
  state.ws = ws;

  ws.addEventListener('open', () => {
    /* 连接建立 */
  });
  // onConnect 的语义是「这条连接握手完成一次」，不是「收到一帧 state」。
  // judgment 模式(reversi/connect4)每落一子服务端就 broadcastState() 一帧(games-room.js:551)，
  // 帧里没有 you/code，只有首帧有。若跟着每帧都调 onConnect，各游戏 onConnect 里的 newGame()
  // 会把棋盘清空 —— 黑白棋实测：每走一步两端棋盘都被重置，双向永久不同步。
  let connectNotified = false;
  ws.addEventListener('message', (ev) => {
    let msg: OnlineMsg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const t = String(msg.type || '');
    if (t === 'state') {
      if (typeof msg.you === 'number') state.myIdx = msg.you;
      const code2 = typeof msg.code === 'string' ? msg.code : '';
      if (code2) state.roomCode = code2;
      if (!connectNotified) {
        connectNotified = true;
        handlers.onConnect?.(state.myIdx as number, state.roomCode || code);
      }
      handlers.onState?.(msg);
      return;
    }
    if (t === 'start') {
      handlers.onStart?.(msg);
      return;
    }
    if (t === 'opponent_move') {
      handlers.onOpponentMove?.(msg);
      return;
    }
    if (t === 'opponent_place') {
      handlers.onOpponentPlace?.(msg);
      return;
    }
    if (t === 'game_over') {
      handlers.onGameOver?.(msg);
      return;
    }
    if (t === 'opponent_leave') {
      handlers.onOpponentLeave?.();
      return;
    }
    if (t === 'restart_notify') {
      // 服务端无差别广播，发起方也会收到自己那一份。发起方已经自己重置过，
      // 再跑一次 onRestart 会把往返窗口内刚落下的一手擦掉。
      if (restartEcho.armed) {
        restartEcho.armed = false;
        return;
      }
      handlers.onRestart?.();
      return;
    }
    if (t === 'pass_notify') {
      handlers.onPassNotify?.(msg);
      return;
    }
    if (t === 'error') {
      // 服务端拒绝（越界 / not_your_turn / 房间已满…）。
      // 此前没有这个分支，被拒的消息被静默丢弃 —— 用户表现为「点了没反应」。
      handlers.onError?.(msg);
      return;
    }
  });
  ws.addEventListener('close', () => {
    /* 连接断开 */
  });
  ws.addEventListener('error', () => {
    /* 连接错误 */
  });
}
