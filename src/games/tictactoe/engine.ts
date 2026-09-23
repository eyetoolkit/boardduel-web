/**
 * Tic-Tac-Toe engine
 * 规则：3×3 棋盘，先 3 连（横/竖/斜）胜，平局。
 * AI 档位：
 *   easy   — 随机合法落子（带 20% 走最优防御）
 *   medium — 完整 minimax depth≤9 限制搜索
 *   hard   — 完整 minimax 全深度（9 格搜索树 9! = 362880 节点，瞬间出解）
 *
 * 设计稿约束：exact verdicts（棋盘 < 9 格即已能算完）
 *
 * 数据结构：
 *   Board = number[9]，0=空、1=X、2=O；索引 0-8 左上→右下 row-major
 *   Player = 1 (X) 或 2 (O)
 */

export type Player = 1 | 2;
export type Cell = 0 | 1 | 2;
export type Board = [Cell, Cell, Cell, Cell, Cell, Cell, Cell, Cell, Cell];
export type Difficulty = 'easy' | 'medium' | 'hard';

const LINES: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // 横
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // 竖
  [0, 4, 8], [2, 4, 6],            // 斜
];

export function emptyBoard(): Board {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

export function cloneBoard(b: Board): Board {
  return [b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8]];
}

/** 复制一份井字格子为 9 字符串（展示用：'_XO'） */
export function renderBoard(b: Board): string {
  const map = ['_', 'X', 'O'];
  let out = '';
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out += map[b[r * 3 + c]];
    }
    out += '\n';
  }
  return out.trim();
}

/** 返回 [winner, line]。winner: 0=未结束, 1=X, 2=O, 3=平局 */
export function checkWinner(b: Board): { winner: 0 | Player | 3; line: number[] | null } {
  for (const line of LINES) {
    const [a, c, d] = line;
    if (b[a] !== 0 && b[a] === b[c] && b[a] === b[d]) {
      return { winner: b[a] as Player, line: [...line] };
    }
  }
  if (b.every((v) => v !== 0)) return { winner: 3, line: null };
  return { winner: 0, line: null };
}

/** 合法落子列表 */
export function legalMoves(b: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < 9; i++) if (b[i] === 0) out.push(i);
  return out;
}

/** minimax 评分：返回从 `player` 视角的最优分数
 *  - win  = +100（player 赢）
 *  - loss = -100（对手赢）
 *  - draw = 0
 */
function minimax(b: Board, turn: Player, ai: Player): number {
  const { winner } = checkWinner(b);
  if (winner === ai) return 100;
  if (winner === (3 as typeof winner)) return 0;
  if (winner !== 0) return -100;

  const moves = legalMoves(b);
  let best = turn === ai ? -Infinity : Infinity;
  for (const m of moves) {
    b[m] = turn;
    const v = minimax(b, (turn === 1 ? 2 : 1) as Player, ai);
    b[m] = 0;
    best = turn === ai ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

/** 选择最优落子。`player` = 当前轮到谁（X 或 O）。 */
export function bestMove(b: Board, player: Player, difficulty: Difficulty): number {
  const moves = legalMoves(b);
  if (moves.length === 0) return -1;

  // easy：80% 随机 + 20% 走最优
  if (difficulty === 'easy' && Math.random() < 0.8) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // medium/hard 都跑 minimax（9 格穷举不耗资源）
  let bestI = moves[0];
  let bestS = -Infinity;
  for (const m of moves) {
    b[m] = player;
    const s = minimax(b, (player === 1 ? 2 : 1) as Player, player);
    b[m] = 0;
    if (s > bestS) {
      bestS = s;
      bestI = m;
    }
  }
  return bestI;
}

/** 模拟一局：人类(1) vs AI(2)，AI 取 difficulty。返回终局棋盘。 */
export function playGame(b: Board, aiDifficulty: Difficulty): Board {
  const cur = cloneBoard(b);
  let turn: Player = 1;
  while (true) {
    const { winner } = checkWinner(cur);
    if (winner !== 0) break;
    const m = bestMove(cur, turn, aiDifficulty);
    if (m < 0) break;
    cur[m] = turn;
    turn = turn === 1 ? 2 : 1;
  }
  return cur;
}

/** 自检：跑一遍 minimax 全部起始走子验证 — 完美 X 应该拿到最优解（角或中心） */
export function selfTest(): { ok: boolean; details: string[] } {
  const details: string[] = [];
  let ok = true;
  const b = emptyBoard();
  const m = bestMove(b, 1, 'hard');
  if (![0, 2, 4, 6, 8].includes(m)) {
    ok = false;
    details.push('hard first move should be corner/center, got ' + m);
  }
  // 模拟 X=O 完美对抗，应该平局
  const final = playGame(b, 'hard');
  const { winner } = checkWinner(final);
  if (winner !== 3) {
    ok = false;
    details.push('X-vs-O perfect play should be draw, got winner=' + winner);
  }
  return { ok, details };
}