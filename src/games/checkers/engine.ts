/**
 * Checkers（西洋跳棋 / English Draughts，8×8 美式规则）引擎 — MIT 自研，零外部依赖
 * ------------------------------------------------------------------
 * 棋盘：8×8，棋子只落在「深色格」(r + c) % 2 === 1。
 * 阵营：玩家 1 = 红方（向下走，r 增大）；玩家 2 = 黑方（向上走，r 减小）。
 * 棋子：
 *   0         空
 *   1=红兵 2=红王  3=黑兵 4=黑王
 * 规则要点（美式）：
 *   · 兵只能斜向前走一格；王可斜向任意方向走一格
 *   · 跳吃：斜向越过相邻敌方子落到其后的空格；落点必须为空
 *   · 强制吃子：若存在吃子走法，则所有走法都必须是吃子（含连跳）
 *   · 连跳：吃子后若仍能继续吃，必须接着吃（同一条链）
 *   · 升变：兵到达对方底线 → 变王
 *   · 胜负：对方无子 或 对方无合法步
 */

export type Player = 1 | 2;
export const EMPTY = 0;
export const RED_MAN = 1;
export const RED_KING = 2;
export const BLACK_MAN = 3;
export const BLACK_KING = 4;

export const SIZE = 8;
export const SIZE2 = 64;
export type Cell = 0 | 1 | 2 | 3 | 4;
export type Board = Cell[]; // 长度 64，索引 = r * 8 + c
export type Difficulty = 'easy' | 'medium' | 'hard';

/** 一次完整走法（连跳时 to 为最终落点，captures 为被吃子序列，path 含 from 与所有落点） */
export interface Move {
  from: number;
  to: number;
  captures: number[];
  path: number[]; // [from, ...landing]
}

/* ===================== 基础工具 ===================== */
export function isDark(r: number, c: number): boolean {
  return (r + c) % 2 === 1;
}
function inB(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}
export function colorOf(p: Cell): 0 | 1 | 2 {
  if (p === 0) return 0;
  return p <= 2 ? 1 : 2;
}
export function isKing(p: Cell): boolean {
  return p === RED_KING || p === BLACK_KING;
}
export function manOf(pl: Player): Cell {
  return pl === 1 ? RED_MAN : BLACK_MAN;
}
export function kingOf(pl: Player): Cell {
  return pl === 1 ? RED_KING : BLACK_KING;
}
export function opponent(pl: Player): Player {
  return pl === 1 ? 2 : 1;
}

function kingDirs() {
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
}
// 红方（玩家1）在底部 r=5,6,7，前进朝 r 减小（向上）；黑方（玩家2）在顶部，前进朝 r 增大（向下）
function manDirs(pl: Player) {
  return pl === 1 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]] as const;
}

export function initialBoard(): Board {
  const b: Cell[] = new Array(SIZE2).fill(0);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (!isDark(r, c)) continue;
      if (r <= 2) b[r * 8 + c] = BLACK_MAN;
      else if (r >= 5) b[r * 8 + c] = RED_MAN;
    }
  }
  return b;
}

export function cloneBoard(b: Board): Board {
  return b.slice() as Board;
}

export function countPieces(b: Board, pl: Player): number {
  let n = 0;
  for (const v of b) if (colorOf(v) === pl) n++;
  return n;
}

/* ===================== 走法生成 ===================== */

/**
 * 从 from 出发，递归收集所有连跳落点。
 * board 在这里被视为「当前棋子已移到 from 所在位置、被吃子保留待稍后统一移除」的中间态：
 * 为避免重复吃同一子且允许踩在已吃子空格上，每次跳跃都把被吃的 mid 置空，并用
 * capturedSoFar 记录已吃子坐标（双重保险）。
 */
function findJumps(
  board: Board,
  from: number,
  player: Player,
  capturedSoFar: number[],
  pathSoFar: number[],
): { to: number; captures: number[]; path: number[] }[] {
  const results: { to: number; captures: number[]; path: number[] }[] = [];
  const p = board[from];
  const r = Math.floor(from / 8);
  const c = from % 8;
  const dirs = isKing(p) ? kingDirs() : manDirs(player);

  for (const [dr, dc] of dirs) {
    const jr = r + dr;
    const jc = c + dc; // 相邻敌方（被跳过的子）
    const lr = r + 2 * dr;
    const lc = c + 2 * dc; // 落点
    if (!inB(jr, jc) || !inB(lr, lc)) continue;
    const mid = board[jr * 8 + jc];
    if (mid === 0 || colorOf(mid as Cell) === player) continue;
    if (capturedSoFar.includes(jr * 8 + jc)) continue;
    if (board[lr * 8 + lc] !== 0) continue;

    // 临时落子：把 from 的棋子移到落点，并移除被吃子
    const nb = cloneBoard(board);
    nb[from] = 0;
    nb[lr * 8 + lc] = p;
    nb[jr * 8 + jc] = 0;

    const deeper = findJumps(nb, lr * 8 + lc, player, [...capturedSoFar, jr * 8 + jc], [...pathSoFar, lr * 8 + lc]);
    if (deeper.length === 0) {
      results.push({ to: lr * 8 + lc, captures: [...capturedSoFar, jr * 8 + jc], path: [...pathSoFar, lr * 8 + lc] });
    } else {
      for (const d of deeper) results.push(d);
    }
  }
  return results;
}

/** 返回 player 的全部合法走法（已含强制吃子约束） */
export function moves(board: Board, player: Player): Move[] {
  const caps: Move[] = [];
  for (let i = 0; i < SIZE2; i++) {
    if (board[i] === 0 || colorOf(board[i]) !== player) continue;
    const js = findJumps(board, i, player, [], [i]);
    for (const m of js) caps.push({ from: i, to: m.to, captures: m.captures, path: m.path });
  }
  if (caps.length > 0) return caps; // 强制吃子

  const simple: Move[] = [];
  for (let i = 0; i < SIZE2; i++) {
    if (board[i] === 0 || colorOf(board[i]) !== player) continue;
    const p = board[i];
    const r = Math.floor(i / 8);
    const c = i % 8;
    const dirs = isKing(p) ? kingDirs() : manDirs(player);
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (inB(nr, nc) && board[nr * 8 + nc] === 0) {
        simple.push({ from: i, to: nr * 8 + nc, captures: [], path: [i, nr * 8 + nc] });
      }
    }
  }
  return simple;
}

export function hasMoves(board: Board, player: Player): boolean {
  return moves(board, player).length > 0;
}

/** 执行走法，返回新棋盘（不修改原数组）。含升变。 */
export function applyMove(board: Board, m: Move): Board {
  const nb = cloneBoard(board);
  const p = nb[m.from];
  nb[m.from] = 0;
  for (const cap of m.captures) nb[cap] = 0;
  let np = p;
  if (!isKing(p)) {
    const tr = Math.floor(m.to / 8);
    if ((p === RED_MAN && tr === 0) || (p === BLACK_MAN && tr === 7)) np = kingOf(colorOf(p) as Player);
  }
  nb[m.to] = np;
  return nb;
}

/* ===================== 评估与 AI ===================== */

/** 从 ai 视角评估局面（越大越有利于 ai 方） */
function evaluate(board: Board, ai: Player): number {
  let score = 0;
  for (let i = 0; i < SIZE2; i++) {
    const v = board[i];
    if (v === 0) continue;
    const pl = colorOf(v);
    const r = Math.floor(i / 8);
    const c = i % 8;
    let val = v === RED_MAN || v === BLACK_MAN ? 100 : 175; // 王更值钱
    // 推进度：红兵越靠下越好，黑兵越靠上越好
    if (v === RED_MAN) val += r * 6;
    else if (v === BLACK_MAN) val += (7 - r) * 6;
    // 边列兵不易被侧翼吃
    if (c === 0 || c === 7) val += 8;
    score += pl === ai ? val : -val;
  }
  // 机动性（轻量权重，避免爆栈）
  const myMov = moves(board, ai).length;
  const opMov = moves(board, opponent(ai)).length;
  score += (myMov - opMov) * 2;
  return score;
}

function alphabeta(board: Board, depth: number, alpha: number, beta: number, player: Player, ai: Player): number {
  const legal = moves(board, player);
  if (legal.length === 0) {
    // 无步者判负（越早被将死越糟）
    return player === ai ? -100000 - depth : 100000 + depth;
  }
  if (depth === 0) return evaluate(board, ai);

  if (player === ai) {
    let best = -Infinity;
    for (const m of legal) {
      const v = alphabeta(applyMove(board, m), depth - 1, alpha, beta, opponent(player), ai);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of legal) {
      const v = alphabeta(applyMove(board, m), depth - 1, alpha, beta, opponent(player), ai);
      if (v < best) best = v;
      if (best < beta) beta = best;
      if (alpha >= beta) break;
    }
    return best;
  }
}

/**
 * 返回 ai（=player）的最佳走法；无步返回 null。
 * 难度：easy 以随机为主（强制吃子约束仍生效）；medium/hard 用不同深度的 αβ。
 */
export function bestMove(board: Board, player: Player, difficulty: Difficulty, rng: () => number = Math.random): Move | null {
  const legal = moves(board, player);
  if (legal.length === 0) return null;
  if (legal.length === 1) return legal[0];

  const depth = difficulty === 'hard' ? 7 : difficulty === 'medium' ? 5 : 2;

  if (difficulty === 'easy' && rng() < 0.8) {
    return legal[Math.floor(rng() * legal.length)];
  }

  let bestIdx = 0;
  let bestS = -Infinity;
  for (let k = 0; k < legal.length; k++) {
    const v = alphabeta(applyMove(board, legal[k]), depth - 1, -Infinity, Infinity, opponent(player), player);
    if (v > bestS) {
      bestS = v;
      bestIdx = k;
    }
  }
  return legal[bestIdx];
}

/* ===================== 自检 ===================== */
export function selfTest(): { ok: boolean; details: string[] } {
  const details: string[] = [];
  let ok = true;

  // 1) 开局红方合法步应为 7
  const b = initialBoard();
  const rm = moves(b, 1);
  if (rm.length !== 7) {
    ok = false;
    details.push('opening red moves should be 7, got ' + rm.length);
  }

  // 2) 强制吃子：存在吃子时，走法必须全是吃子
  const tb = new Array(SIZE2).fill(0) as Cell[];
  tb[5 * 8 + 2] = RED_MAN;
  tb[4 * 8 + 3] = BLACK_MAN;
  const cm = moves(tb, 1);
  if (cm.length !== 1 || cm[0].captures.length !== 1) {
    ok = false;
    details.push('forced capture failed: ' + JSON.stringify(cm.map((m) => [m.from, m.to, m.captures])));
  }

  // 3) 连跳：一次吃掉两颗
  const jb = new Array(SIZE2).fill(0) as Cell[];
  jb[5 * 8 + 2] = RED_MAN;
  jb[4 * 8 + 3] = BLACK_MAN;
  jb[2 * 8 + 5] = BLACK_MAN;
  // 红 (5,2) 吃 (4,3) 落 (3,4)，再吃 (2,5) 落 (1,6)
  const jm = moves(jb, 1);
  const dbl = jm.find((m) => m.captures.length === 2);
  if (!dbl) {
    ok = false;
    details.push('double jump not found: ' + JSON.stringify(jm.map((m) => m.captures.length)));
  } else if (dbl.to !== 1 * 8 + 6) {
    ok = false;
    details.push('double jump final landing wrong: got ' + dbl.to);
  }

  // 4) 升变：红兵到底线变王
  const pb = new Array(SIZE2).fill(0) as Cell[];
  pb[1 * 8 + 2] = RED_MAN; // 红兵在 row1，向上走一步即抵底线 row0 → 升变
  const pm = moves(pb, 1);
  const prom = pm.find((m) => Math.floor(m.to / 8) === 0);
  if (!prom) {
    ok = false;
    details.push('promotion move not generated');
  } else {
    const after = applyMove(pb, prom);
    if (after[prom.to] !== RED_KING) {
      ok = false;
      details.push('promotion did not produce a king: ' + after[prom.to]);
    }
  }

  // 5) 王可后退：黑王向上后退一步
  const kb = new Array(SIZE2).fill(0) as Cell[];
  kb[4 * 8 + 3] = BLACK_KING;
  const km = moves(kb, 2);
  const back = km.find((m) => Math.floor(m.to / 8) === 5);
  if (!back) {
    ok = false;
    details.push('king could not move backward');
  }

  // 6) AI 必须能走出开局一步（不抛错且合法）
  const aiMove = bestMove(b, 1, 'medium');
  if (!aiMove || moves(b, 1).every((m) => m.from !== aiMove.from || m.to !== aiMove.to)) {
    ok = false;
    details.push('bestMove returned an illegal opening move');
  }

  return { ok, details };
}
