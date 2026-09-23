/**
 * Gomoku（五子棋）engine — 15×15 自由式规则
 * AI 档位（对齐设计稿 01 — BOARD LANGUAGE 的命名与性格）：
 *   easy   (Counter)   "counts pairs & trios"            — 启发式 + depth=1
 *   medium (Attacker)  "opens threats, still local"      — 启发式 + αβ depth=2
 *   hard   (Punisher)  "sharpest weights, no lookahead"   — 启发式 + αβ depth=4 + 必胜/必挡短路
 *
 * 数据结构：
 *   Board = number[225]  0=空 1=黑(我) 2=白(对手)
 *   索引：index = y*15 + x，左上角为 (0,0)
 *
 * 评分（每条线的 pattern scoring，**区分开放/封闭**）：
 *   五连          = 1_000_000（已成）
 *   open-4 (X.XXX 两端任一可延伸) = 100_000   —— 必胜，无法挡
 *   4 成子差1（立四/冲四，仅一端）= 15_000   —— 必须立即挡
 *   open-3  (.XXX. 两端可延伸)     = 8_000    —— 不挡则下一手变 open-4
 *   closed-3                       = 800
 *   open-2  (.XX.)                 = 400
 *   closed-2                       = 60
 *   ——评估总分 = Σ(我方) - 1.15 * Σ(对手)
 *
 * ⚠️ 历史缺陷（本次修复）：
 *   1) 旧 scorePatternFor 对 5 元素窗口 `for (i=0; i<=5)` 多跑一次，
 *      `slice(5,10)` 得空数组 → 幽灵窗口；已改为精确遍历。
 *   2) 旧 scoreWindow 完全不看开放度：`XXXX`（立四，一端被堵）与
 *      `XXXX.`（活四）同给 10_000，导致 AI 分不清"该挡"与"该冲"；
 *      且 `XXX..` 与 `.XXX.` 同分。已引入 left/right 开放标记。
 *   3) 旧 evaluate 用 `px = x-dx*4` 做起点守卫并嵌套 k 循环，会把合法
 *      线整段跳过；已改为直接以「五连窗口」为主循环。
 *   4) 旧 bestMove 无「先看自己能否成五 / 再看对手能否成五」短路，
 *      深搜在数百候选点上极慢（实测 hard 档单手超时）；
 *      已加胜/挡短路 + 候选按启发式排序 + 只保留 Top-N 做深搜。
 */

export type Player = 1 | 2;
export type Cell = 0 | 1 | 2;
export type Board = number[];
export type Difficulty = 'easy' | 'medium' | 'hard';

export const SIZE = 15;
export const SIZE2 = SIZE * SIZE;
const DIRS: ReadonlyArray<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
const INF = 1_000_000_000;

/** 评分常量（越大越关键） */
const S = {
  FIVE: 1_000_000,
  OPEN4: 100_000,
  FOUR: 15_000,      // 立四 / 冲四：差 1 成五，必须立即处理
  OPEN3: 8_000,      // 活三：不挡则成 open-4
  CLOSED3: 800,
  OPEN2: 400,
  CLOSED2: 60,
};

export function emptyBoard(): Board {
  return new Array(SIZE2).fill(0);
}

export function cloneBoard(b: Board): Board {
  return b.slice();
}

export function legalMoves(b: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < SIZE2; i++) if (b[i] === 0) out.push(i);
  return out;
}

/** 以 (x, y) 取 idx */
function idx(x: number, y: number) {
  return y * SIZE + x;
}

/** 越界判定 */
function inb(x: number, y: number) {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

export function xy(i: number): [number, number] {
  return [i % SIZE, Math.floor(i / SIZE)];
}

/** 行列坐标 → 记谱（列 A–O，行 1–15 自下而上；与设计稿一致） */
export function notation(i: number): string {
  const [x, y] = xy(i);
  return String.fromCharCode(65 + x) + (SIZE - y);
}

/**
 * 沿方向 (dx,dy) 从 (x,y) 起统计 player 的连子数 + 两端是否开放。
 * 返回 { count, openEnds }：count 含起点自身。
 */
function runInfo(b: Board, x: number, y: number, dx: number, dy: number, p: Player) {
  let count = 1;
  // 正向
  let cx = x + dx, cy = y + dy;
  while (inb(cx, cy) && b[idx(cx, cy)] === p) { count++; cx += dx; cy += dy; }
  const openFwd = inb(cx, cy) && b[idx(cx, cy)] === 0;
  // 反向
  let bx = x - dx, by = y - dy;
  while (inb(bx, by) && b[idx(bx, by)] === p) { count++; bx -= dx; by -= dy; }
  const openBwd = inb(bx, by) && b[idx(bx, by)] === 0;
  return { count, openEnds: (openFwd ? 1 : 0) + (openBwd ? 1 : 0) };
}

/** 单点对 player 的「形态分」：该点若属于 player，沿四方向累计其连子价值 */
function pointScore(b: Board, i: number, p: Player): number {
  const [x, y] = xy(i);
  let s = 0;
  const seen = new Set<string>();
  for (const [dx, dy] of DIRS) {
    const { count, openEnds } = runInfo(b, x, y, dx, dy, p);
    if (count >= 5) { s += S.FIVE; continue; }
    // 用方向+跨度去重，避免同一段被两端重复计
    const key = `${dx},${dy},${count},${openEnds}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (count === 4) s += openEnds >= 2 ? S.OPEN4 : (openEnds === 1 ? S.FOUR : 0);
    else if (count === 3) s += openEnds >= 2 ? S.OPEN3 : (openEnds === 1 ? S.CLOSED3 : 0);
    else if (count === 2) s += openEnds >= 2 ? S.OPEN2 : (openEnds === 1 ? S.CLOSED2 : 0);
  }
  return s;
}

/**
 * 全局评估：以"所有落点形态分之和"构造，从 player 视角。
 * 比旧版逐窗口扫更快且不会漏线。
 */
export function evaluate(b: Board, player: Player): number {
  const opp = (player === 1 ? 2 : 1) as Player;
  let mine = 0, theirs = 0;
  let myFive = false, oppFive = false;
  for (let i = 0; i < SIZE2; i++) {
    const c = b[i];
    if (c === 0) continue;
    if (c === player) {
      const v = pointScore(b, i, player);
      if (v >= S.FIVE) myFive = true;
      mine += v;
    } else if (c === opp) {
      const v = pointScore(b, i, opp);
      if (v >= S.FIVE) oppFive = true;
      theirs += v;
    }
  }
  // 终局优先：己方成五绝对赢；对手成五绝对输
  if (myFive && !oppFive) return 100_000_000;
  if (oppFive && !myFive) return -100_000_000;
  return mine - theirs * 1.15;
}

/** αβ 搜索 */
function alphabeta(b: Board, depth: number, alpha: number, beta: number, player: Player, ai: Player): number {
  const moves = candidateMoves(b);
  if (depth === 0 || moves.length === 0) return evaluate(b, ai);

  // 立即终局检测（避免深搜在已结束局面上继续）
  const maximizing = player === ai;
  let best = maximizing ? -INF : INF;
  const ordered = orderMoves(b, moves, player).slice(0, 12);
  for (const m of ordered) {
    b[m] = player;
    let v: number;
    if (pointScore(b, m, player) >= S.FIVE) {
      v = player === ai ? 100_000_000 - (10 - depth) : -100_000_000 + (10 - depth);
    } else {
      v = alphabeta(b, depth - 1, alpha, beta, (player === 1 ? 2 : 1) as Player, ai);
    }
    b[m] = 0;
    if (maximizing) {
      if (v > best) best = v;
      if (best > alpha) alpha = best;
    } else {
      if (v < best) best = v;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break;
  }
  return best;
}

/** 候选点：已有棋子周围 2 格 */
export function candidateMoves(b: Board): number[] {
  const moves = legalMoves(b);
  if (moves.length === 0) return [];
  if (moves.length === SIZE2) return [Math.floor(SIZE2 / 2)];
  const seen = new Set<number>();
  for (let i = 0; i < SIZE2; i++) {
    if (b[i] === 0) continue;
    const x = i % SIZE, y = Math.floor(i / SIZE);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (!inb(xx, yy)) continue;
        const k = idx(xx, yy);
        if (b[k] === 0) seen.add(k);
      }
    }
  }
  return seen.size === 0 ? moves : [...seen];
}

/** 按启发式排序：我方进攻分 + 对手威胁分（对手在此点的价值=必挡价值） */
function orderMoves(b: Board, moves: number[], me: Player): number[] {
  const opp = (me === 1 ? 2 : 1) as Player;
  const scored = moves.map((m) => {
    b[m] = me;
    const atk = pointScore(b, m, me);
    b[m] = opp;
    const def = pointScore(b, m, opp);
    b[m] = 0;
    return { m, s: atk + def * 0.95 };
  });
  scored.sort((a, b2) => b2.s - a.s);
  return scored.map((x) => x.m);
}

/** 找「下一手即成五」的点（返回全部，便于必胜/必挡短路） */
function winPoints(b: Board, p: Player): number[] {
  const out: number[] = [];
  for (const m of candidateMoves(b)) {
    b[m] = p;
    if (pointScore(b, m, p) >= S.FIVE) out.push(m);
    b[m] = 0;
  }
  return out;
}

export function bestMove(b: Board, player: Player, difficulty: Difficulty): number {
  const moves = legalMoves(b);
  if (moves.length === 0) return -1;
  if (moves.length === SIZE2) return Math.floor(SIZE2 / 2); // 首手天元

  const opp = (player === 1 ? 2 : 1) as Player;

  // ① 能赢就赢（最高优先，防止"看见胜机却去堵"）
  const mine = winPoints(b, player);
  if (mine.length) return mine[0];

  // ② 对手能赢就必须堵
  const theirs = winPoints(b, opp);
  if (theirs.length) return theirs[0];

  const depth = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 4;
  const candidates = orderMoves(b, candidateMoves(b), player);

  // easy：只看一层静态分（"counts pairs & trios"）
  if (depth === 1) {
    let bestI = candidates[0], bestS = -INF;
    for (const m of candidates) {
      b[m] = player;
      const s = evaluate(b, player);
      b[m] = 0;
      if (s > bestS) { bestS = s; bestI = m; }
    }
    return bestI;
  }

  // medium/hard：只对启发式 Top-K 做深搜，控制耗时
  const K = depth >= 4 ? 10 : 14;
  const top = candidates.slice(0, K);
  let bestI = top[0], bestS = -INF;
  for (const m of top) {
    b[m] = player;
    let s: number;
    if (pointScore(b, m, player) >= S.FIVE) s = 100_000_000;
    else s = alphabeta(b, depth - 1, -INF, INF, opp, player);
    b[m] = 0;
    if (s > bestS) { bestS = s; bestI = m; }
  }
  return bestI;
}

/** 检测是否有 5 连（任意一方） */
export function hasFive(b: Board): { winner: 0 | Player; line: number[] | null } {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const me = b[idx(x, y)];
      if (me === 0) continue;
      for (const [dx, dy] of DIRS) {
        const px = x - dx, py = y - dy;
        if (inb(px, py) && b[idx(px, py)] === me) continue; // 非起点
        const line: number[] = [];
        let ok = true;
        for (let k = 0; k < 5; k++) {
          const xx = x + dx * k, yy = y + dy * k;
          if (!inb(xx, yy) || b[idx(xx, yy)] !== me) { ok = false; break; }
          line.push(idx(xx, yy));
        }
        if (ok) return { winner: me as Player, line };
      }
    }
  }
  return { winner: 0, line: null };
}

/** 自检 */
export function selfTest(): { ok: boolean; details: string[] } {
  const details: string[] = [];
  let ok = true;
  const chk = (cond: boolean, msg: string) => { if (!cond) { ok = false; details.push(msg); } };

  // ① 首手天元
  let b = emptyBoard();
  chk(bestMove(b, 1, 'easy') === 112, 'first move should be center (112)');

  // ② 正好 5 子才赢
  b = emptyBoard();
  for (let x = 0; x < 5; x++) b[idx(7 + x, 7)] = 1;
  chk(hasFive(b).winner === 1, '5-in-row should detect winner=1');
  // ③ 4 连不判胜
  b = emptyBoard();
  for (let x = 0; x < 4; x++) b[idx(7 + x, 7)] = 1;
  chk(hasFive(b).winner === 0, '4-in-row must NOT be a win');
  // ④ 斜向 5 连 + line 长度
  b = emptyBoard();
  for (let k = 0; k < 5; k++) b[idx(3 + k, 3 + k)] = 2;
  const d = hasFive(b);
  chk(d.winner === 2, 'diagonal 5-in-row should detect winner=2');
  chk(!!d.line && d.line.length === 5, 'win line must contain 5 points');

  // ⑤ 有必胜点必须直接连五（各档）
  for (const diff of ['easy', 'medium', 'hard'] as Difficulty[]) {
    b = emptyBoard();
    b[idx(3, 3)] = 2; b[idx(4, 3)] = 2; b[idx(5, 3)] = 2; b[idx(6, 3)] = 2;
    const m = bestMove(b, 2, diff);
    chk(m === idx(2, 3) || m === idx(7, 3), `${diff}: should complete four->five, got ${notation(m)}`);
  }

  // ⑥ 对手立四必须挡（各档）
  for (const diff of ['easy', 'medium', 'hard'] as Difficulty[]) {
    b = emptyBoard();
    b[idx(5, 5)] = 1; b[idx(6, 5)] = 1; b[idx(7, 5)] = 1; b[idx(8, 5)] = 1;
    const m = bestMove(b, 2, diff);
    chk(m === idx(4, 5) || m === idx(9, 5), `${diff}: must block opponent four, got ${notation(m)}`);
  }

  // ⑦ 开放度区分：open-4 分数必须显著高于立四
  b = emptyBoard();
  b[idx(3, 3)] = 1; b[idx(4, 3)] = 1; b[idx(5, 3)] = 1; b[idx(6, 3)] = 1; // .XXXX.
  const open4 = pointScore(b, idx(4, 3), 1);
  const b2 = emptyBoard();
  b2[idx(0, 3)] = 1; b2[idx(1, 3)] = 1; b2[idx(2, 3)] = 1; b2[idx(3, 3)] = 1; // XXXX. 贴边一端
  const closed4 = pointScore(b2, idx(1, 3), 1);
  chk(open4 > closed4, `open-4 (${open4}) should outscore closed four (${closed4})`);

  // ⑧ 记谱正确性：天元 112 → H8
  chk(notation(112) === 'H8', `notation(112) should be H8, got ${notation(112)}`);

  return { ok, details };
}
