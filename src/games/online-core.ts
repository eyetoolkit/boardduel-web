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
  onConnect?: (myIdx: number, code: string) => void;
  onStart?: () => void;
  onOpponentMove?: (msg: OnlineMsg) => void;
  onOpponentPlace?: (msg: OnlineMsg) => void;
  onState?: (msg: OnlineMsg) => void;
  onGameOver?: (msg: OnlineMsg) => void;
  onOpponentLeave?: () => void;
  onRestart?: () => void;
  onPassNotify?: (msg: OnlineMsg) => void;
}

/** 读取 ?c= 房间码（worker /b/<game>/<CODE> 会 302 到 ?c=<CODE>） */
export function inviteCode(): string {
  try {
    const c = new URLSearchParams(location.search).get('c');
    if (!c) return '';
    return /^[A-Za-z0-9]{5,8}$/.test(c) ? c.toUpperCase() : '';
  } catch {
    return '';
  }
}

/** 清掉 ?c= / ?vs=，保留其它查询参数（如语言） */
export function clearInviteParam(): void {
  try {
    const u = new URL(location.href);
    u.searchParams.delete('c');
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

export function sendWs(state: OnlineState, obj: OnlineMsg): void {
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
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
      handlers.onConnect?.(state.myIdx as number, state.roomCode || code);
      handlers.onState?.(msg);
      return;
    }
    if (t === 'start') {
      handlers.onStart?.();
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
      handlers.onRestart?.();
      return;
    }
    if (t === 'pass_notify') {
      handlers.onPassNotify?.(msg);
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
