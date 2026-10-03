/**
 * Go（围棋）规则引擎 — 中国规则（数目制），支持 9 / 13 / 19 路
 *
 * 数据结构（与 gomoku 风格对齐：纯函数 + 类型，Board = number[]）：
 *   Stone   = 0(空) | 1(黑) | 2(白)
 *   Board   = number[]     长度 SIZE*SIZE，idx = y*SIZE + x，左上角 (0,0)
 *   GoState = 不可变局面快照（play/applyMove 产出新快照）
 *
 * 规则覆盖：
 *   ✅ 落子合法性（占用点 / 打劫禁着 / 自杀手）
 *   ✅ 提子（单子 / 多子 / 连锁提，含打劫后回提）
 *   ✅ 简单劫（ko 字段）+ **可选 positional superko**（禁止全局同形再现，正确处理三劫 / 长生 / 打劫重复）
 *   ✅ pass 与双方连续 pass 终局
 *   ✅ 中国规则数目（区域法：活子 + 围空 - 贴目），假定盘上棋子皆活（死子确认放 W4）
 *   ✅ 数气（供 AI / UI 用）
 *
 * ⚠️ W1 范围：规则正确性优先，AI（MCTS）/ 死子确认 / 让子 放后续周。
 */

export type Stone = 0 | 1 | 2;
export type Player = 1 | 2;
export type Board = number[];

/** 不可变局面快照 */
export interface GoState {
  size: number;
  board: Board;
  toPlay: Player;
  /** 简单劫禁着点；仅对 koFor 一方下一步生效 */
  ko: number | null;
  /** 被禁落子方（设置 ko 时的下一手 toPlay） */
  koFor: Player | null;
  /** 连续 pass 计数（2 = 终局） */
  passes: number;
  /** captures[i] = 玩家(i+1)提掉的对方棋子总数（索引 0=黑 1=白） */
  captures: [number, number];
  /** 上一步落子点；pass 为 -1 */
  lastMove: number;
  moveNumber: number;
}

export interface PlayOptions {
  /** 开启 positional superko：落子若使局面（board+toPlay）重现已出现过的局面则非法 */
  superko?: boolean;
  /** superko 已出现局面哈希集合（由上层对局 / MCTS 持有） */
  history?: Set<string>;
}

export type IllegalReason = 'occupied' | 'ko' | 'suicide' | 'superko' | 'out_of_bounds';
export interface PlayResult {
  ok: boolean;
  state?: GoState;
  reason?: IllegalReason;
  /** 本次落子提掉的敌子数（ok 时有效） */
  captured?: number;
}

const NB: ReadonlyArray<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** 围棋记谱列字母（跳过 I，避免与 J 混淆）：A..H, J..T */
const COLS = 'ABCDEFGHJKLMNOPQRST';
/** 中国规则贴目：黑贴 3 又 3/4 子 = 7.5 目 */
export const KOMI = 7.5;

// ───────────────────────── 基础工具 ─────────────────────────

export function idx(size: number, x: number, y: number): number {
  return y * size + x;
}
export function xy(size: number, i: number): [number, number] {
  return [i % size, Math.floor(i / size)];
}
export function inBounds(size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

export function emptyBoard(size: number): Board {
  return new Array(size * size).fill(0);
}

export function cloneBoard(b: Board): Board {
  return b.slice();
}

/** 行列坐标 → 记谱（列 A–T 跳过 I；行 1–N 自下而上） */
export function notation(size: number, i: number): string {
  const [x, y] = xy(size, i);
  return COLS[x] + (size - y);
}

/** 记谱 → idx（不区分大小写；非法返回 -1） */
export function coordToIdx(size: number, coord: string): number {
  if (coord.length < 2) return -1;
  const up = coord.toUpperCase();
  const cx = COLS.indexOf(up[0]);
  const row = parseInt(up.slice(1), 10);
  if (cx < 0 || Number.isNaN(row)) return -1;
  const y = size - row;
  if (!inBounds(size, cx, y)) return -1;
  return idx(size, cx, y);
}

export function opponent(p: Player): Player {
  return (p === 1 ? 2 : 1) as Player;
}

// ───────────────────────── 组 / 气 ─────────────────────────

export interface GroupInfo {
  stones: number[];
  liberties: number;
  color: Stone;
}

/** 从 start 出发 flood-fill 同色连通块，统计棋子与棋眼（空邻点，去重） */
export function collectGroup(board: Board, size: number, start: number): GroupInfo {
  const color = board[start] as Stone;
  const stones: number[] = [];
  const libSet = new Set<number>();
  const seen = new Set<number>();
  const stack = [start];
  seen.add(start);
  while (stack.length) {
    const cur = stack.pop() as number;
    stones.push(cur);
    const x = cur % size;
    const y = Math.floor(cur / size);
    for (const [dx, dy] of NB) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(size, nx, ny)) continue;
      const ni = ny * size + nx;
      const c = board[ni];
      if (c === 0) {
        libSet.add(ni);
      } else if (c === color) {
        if (!seen.has(ni)) { seen.add(ni); stack.push(ni); }
      }
    }
  }
  return { stones, liberties: libSet.size, color };
}

/** 数某点所在组的气数（点为空或越界返回 0） */
export function countLiberties(board: Board, size: number, i: number): number {
  if (i < 0 || i >= board.length || board[i] === 0) return 0;
  return collectGroup(board, size, i).liberties;
}

// ───────────────────────── 落子核心 ─────────────────────────

export function makeState(
  size: number, board: Board, toPlay: Player, ko: number | null, koFor: Player | null,
  passes: number, captures: [number, number], lastMove: number, moveNumber: number,
): GoState {
  return { size, board, toPlay, ko, koFor, passes, captures, lastMove, moveNumber };
}

export function initialState(size: number): GoState {
  return makeState(size, emptyBoard(size), 1, null, null, 0, [0, 0], -1, 0);
}

/** 局面哈希（board + 轮到方），用于 superko */
export function hashPosition(board: Board, toPlay: Player): string {
  return board.join('') + ':' + toPlay;
}

/**
 * 计算在某点落子的结果（纯函数，不改输入 state）。
 * 返回 { ok, state, captured } 或 { ok:false, reason }。
 */
export function computePlay(state: GoState, i: number, opts: PlayOptions = {}): PlayResult {
  const { size, board, toPlay } = state;
  if (i < 0 || i >= board.length) return { ok: false, reason: 'out_of_bounds' };
  if (board[i] !== 0) return { ok: false, reason: 'occupied' };
  // 简单劫：仅对 koFor 一方生效
  if (state.ko === i && state.koFor === toPlay) return { ok: false, reason: 'ko' };

  const opp = opponent(toPlay);
  const nb = board.slice();
  nb[i] = toPlay;

  // 1. 提走落子点四邻的「气已为 0」的敌子组
  let captured = 0;
  const checked = new Set<number>();
  const x0 = i % size;
  const y0 = Math.floor(i / size);
  for (const [dx, dy] of NB) {
    const nx = x0 + dx;
    const ny = y0 + dy;
    if (!inBounds(size, nx, ny)) continue;
    const ni = ny * size + nx;
    if (nb[ni] === opp && !checked.has(ni)) {
      const g = collectGroup(nb, size, ni);
      for (const s of g.stones) checked.add(s);
      if (g.liberties === 0) {
        for (const s of g.stones) { nb[s] = 0; captured++; }
      }
    }
  }

  // 2. 自杀判定：提敌子后，落子方该组仍无气 → 非法
  const myGroup = collectGroup(nb, size, i);
  if (myGroup.liberties === 0) {
    return { ok: false, reason: 'suicide' };
  }

  // 3. 简单劫：恰好提 1 子 且 落子方单子单气（唯一气即被提点）→ 设 ko 禁对方回提
  let newKo: number | null = null;
  let newKoFor: Player | null = null;
  if (captured === 1 && myGroup.stones.length === 1 && myGroup.liberties === 1) {
    // 取 myGroup 的唯一气点（collectGroup 仅返回气数，这里取具体位置）
    const libSet = new Set<number>();
    const mx = i % size;
    const my = Math.floor(i / size);
    for (const [dx, dy] of NB) {
      const nx = mx + dx;
      const ny = my + dy;
      if (inBounds(size, nx, ny) && nb[ny * size + nx] === 0) libSet.add(ny * size + nx);
    }
    const onlyLib = libSet.size === 1 ? [...libSet][0] : -1;
    if (onlyLib >= 0) {
      newKo = onlyLib;       // 被提点（现为唯一气）
      newKoFor = opp;        // 下一手（对手）被禁回提
    }
  }

  // 4. positional superko：禁止全局同形再现
  if (opts.superko && opts.history) {
    const h = hashPosition(nb, opp);
    if (opts.history.has(h)) return { ok: false, reason: 'superko' };
  }

  const captures2: [number, number] = [state.captures[0], state.captures[1]];
  captures2[toPlay - 1] += captured;

  const newState = makeState(
    size, nb, opp, newKo, newKoFor, 0,
    captures2, i, state.moveNumber + 1,
  );
  return { ok: true, state: newState, captured };
}

/** 不可变落子：返回新 state（非法时 ok:false，原 state 不变） */
export function play(state: GoState, i: number, opts: PlayOptions = {}): PlayResult {
  return computePlay(state, i, opts);
}

/** 原地落子（供 AI / MCTS 高频调用）：成功返回 true 并修改 state 字段；失败返回 false 且不改 */
export function applyMove(state: GoState, i: number, opts: PlayOptions = {}): boolean {
  const r = computePlay(state, i, opts);
  if (!r.ok || !r.state) return false;
  const s = r.state;
  state.board = s.board;
  state.toPlay = s.toPlay;
  state.ko = s.ko;
  state.koFor = s.koFor;
  state.passes = s.passes;
  state.captures = s.captures;
  state.lastMove = s.lastMove;
  state.moveNumber = s.moveNumber;
  return true;
}

/** pass：轮转、passes+1、ko 解除（pass 不参与劫争，ko 在对手落子后由 computePlay 重算） */
export function pass(state: GoState): GoState {
  return makeState(
    state.size, state.board, opponent(state.toPlay), null, null,
    state.passes + 1, state.captures, -1, state.moveNumber + 1,
  );
}

// ───────────────────────── 合法性 / 合法手 ─────────────────────────

/** 预检某点是否可落（不产出新 state） */
export function isLegalMove(state: GoState, i: number, opts: PlayOptions = {}): boolean {
  return computePlay(state, i, opts).ok;
}

/** 全部合法落子点（排除占用 / 劫 / 自杀 / superko 重复） */
export function legalMoves(state: GoState, opts: PlayOptions = {}): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i] !== 0) continue;
    if (computePlay(state, i, opts).ok) out.push(i);
  }
  return out;
}

/** 双方连续两次 pass → 终局 */
export function isGameOver(state: GoState): boolean {
  return state.passes >= 2;
}

// ───────────────────────── 中国规则数目 ─────────────────────────

export interface ScoreResult {
  black: number;      // 黑：活子 + 围空
  white: number;      // 白：活子 + 围空 + 贴目
  blackStones: number;
  whiteStones: number;
  blackTerritory: number;
  whiteTerritory: number;
  winner: Player;     // 1=黑 2=白
  margin: number;     // 胜方净胜（目）
}

/**
 * 中国规则数目（区域法，假定盘上棋子皆活；死子确认 W4 做）。
 * 空区域 flood-fill：只邻接一种颜色 → 归该色；邻接两色 → 中立(dame)不计。
 */
export function scoreChinese(state: GoState): ScoreResult {
  const { board, size } = state;
  let blackStones = 0;
  let whiteStones = 0;
  for (const c of board) {
    if (c === 1) blackStones++;
    else if (c === 2) whiteStones++;
  }

  const visited = new Set<number>();
  let blackTerritory = 0;
  let whiteTerritory = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0 || visited.has(i)) continue;
    const region: number[] = [];
    const stack = [i];
    visited.add(i);
    let touchesBlack = false;
    let touchesWhite = false;
    while (stack.length) {
      const cur = stack.pop() as number;
      region.push(cur);
      const x = cur % size;
      const y = Math.floor(cur / size);
      for (const [dx, dy] of NB) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(size, nx, ny)) continue;
        const ni = ny * size + nx;
        const c = board[ni];
        if (c === 0) {
          if (!visited.has(ni)) { visited.add(ni); stack.push(ni); }
        } else if (c === 1) touchesBlack = true;
        else if (c === 2) touchesWhite = true;
      }
    }
    if (touchesBlack && !touchesWhite) blackTerritory += region.length;
    else if (touchesWhite && !touchesBlack) whiteTerritory += region.length;
    // 否则 dame：中立不计
  }

  const black = blackStones + blackTerritory;
  const white = whiteStones + whiteTerritory + KOMI;
  const diff = black - white;
  return {
    black, white, blackStones, whiteStones, blackTerritory, whiteTerritory,
    winner: diff > 0 ? 1 : 2,
    margin: Math.abs(diff),
  };
}

// ───────────────────────── 批量落子（测试 / 复盘用） ─────────────────────────

/** 用记谱坐标序列落子（如 ['pd','dp',...]），支持 'pass'。非法手抛错（测试用） */
export function playSequence(state: GoState, coords: string[], opts: PlayOptions = {}): GoState {
  let s = state;
  for (const c of coords) {
    if (c === 'pass' || c === 'PASS') {
      s = pass(s);
      continue;
    }
    const i = coordToIdx(s.size, c);
    if (i < 0) throw new Error(`bad coord ${c}`);
    const r = play(s, i, opts);
    if (!r.ok) throw new Error(`illegal move ${c} (${r.reason}) at move ${s.moveNumber}`);
    s = r.state as GoState;
  }
  return s;
}

// ───────────────────────── 自检 ─────────────────────────

export function selfTest(): { ok: boolean; details: string[] } {
  const details: string[] = [];
  let ok = true;
  const chk = (cond: boolean, msg: string) => { if (!cond) { ok = false; details.push(msg); } };

  const N = 9;
  // ① 空盘落子合法
  let s = initialState(N);
  chk(isLegalMove(s, idx(N, 4, 4)), 'empty point should be legal');

  // ② 占用点非法
  s = play(s, idx(N, 4, 4)).state as GoState;
  chk(!isLegalMove(s, idx(N, 4, 4)), 'occupied point must be illegal');

  // ③ 自杀手：空点被白四面包围 → 黑落该点（无气且未提子）非法
  {
    const t = initialState(N);
    const b = t.board.slice();
    b[idx(N, 3, 4)] = 2; b[idx(N, 5, 4)] = 2; b[idx(N, 4, 3)] = 2; b[idx(N, 4, 5)] = 2;
    const t2 = makeState(N, b, 1, null, null, 0, [0, 0], -1, 1);
    chk(!isLegalMove(t2, idx(N, 4, 4)), 'fully-surrounded empty point (suicide) must be illegal');
  }

  // ④ 提子：黑落子使白单子无气 → 提 1 子
  {
    const t = initialState(N);
    const b = t.board.slice();
    b[idx(N, 4, 4)] = 2; b[idx(N, 3, 4)] = 1; b[idx(N, 5, 4)] = 1; b[idx(N, 4, 3)] = 1;
    const t2 = makeState(N, b, 1, null, null, 0, [0, 0], -1, 1);
    const r = play(t2, idx(N, 4, 5));
    chk(r.ok && (r.captured ?? 0) === 1, 'should capture 1 white stone');
    chk(r.ok && r.state!.board[idx(N, 4, 4)] === 0, 'captured stone removed from board');
  }

  // ⑤ 简单劫：白提黑 1 子形成 ko，黑立即回提被禁，黑别处落子后 ko 解除
  {
    const t = initialState(N);
    const b = t.board.slice();
    // 黑：(2,5)(3,6)(3,4)(4,5)  白：(2,6)(1,5)(2,4)  空：(3,5)，轮白
    b[idx(N, 2, 5)] = 1; b[idx(N, 3, 6)] = 1; b[idx(N, 3, 4)] = 1; b[idx(N, 4, 5)] = 1;
    b[idx(N, 2, 6)] = 2; b[idx(N, 1, 5)] = 2; b[idx(N, 2, 4)] = 2;
    const t2 = makeState(N, b, 2, null, null, 0, [0, 0], -1, 1);
    const r = play(t2, idx(N, 3, 5)); // 白落 (3,5) 提黑 (2,5)
    chk(r.ok && (r.captured ?? 0) === 1, 'ko setup: white captures exactly 1 black');
    chk(r.ok && r.state!.ko === idx(N, 2, 5) && r.state!.koFor === 1, 'ko point set, forbidden for black');
    const w = r.state as GoState;
    chk(!isLegalMove(w, idx(N, 2, 5)), 'black immediate recapture must be illegal (ko)');
    const w2 = play(w, idx(N, 0, 0)).state as GoState; // 黑落别处
    chk(w2.ko === null, 'ko cleared after black plays elsewhere');
  }

  // ⑥ 双方连续 pass → 终局
  {
    let s2 = initialState(N);
    s2 = pass(s2);
    s2 = pass(s2);
    chk(isGameOver(s2), 'two consecutive passes → game over');
  }

  return { ok, details };
}
