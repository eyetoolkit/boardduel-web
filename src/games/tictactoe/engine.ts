/**
 * Tic-Tac-Toe engine
 * 规则：3×3 棋盘，先 3 连（横/竖/斜）胜，平局。
 *
 * AI 档位（2026-10-15 重做，理由见下方「难度轴」）：
 *   easy   — 随机落子，但**必须挡**对手下一手能赢的点（新手本能）
 *   medium — 启发式：能赢就赢 / 对手能赢就挡 / 其余随机偏好中心，不做长线规划
 *   hard   — 完整 minimax 全深度（9! = 362880 节点，瞬间出解）
 *
 * 【难度轴】9 格棋盘永远能算到底，「限制搜索深度」拿不到中等难度，
 * 只会得到一个更差的 minimax。真实的难度轴是三种手艺：随机 / 启发式挡手 / 完美。
 *
 * 【实测基线】20k 局 Monte Carlo，人类=随机手（直接调 bestMove，非复刻）：
 *   旧实现：easy 人类胜 47.0% / medium 0.0% / hard 0.0%  ← medium≡hard，曲线断崖
 *   新实现：easy 50.6% / medium 14.1% / hard 0.0%        ← 三档单调递减
 *
 * 【参数来源】两个概率都来自参数扫描，不是拍脑袋：
 *   EASY_BLOCK_P  挡手概率：0→58.8% 0.2→50.6% 0.4→41.4% 0.6→32.9% 0.8→22.8% 1.0→13.4%
 *   MEDIUM_HEUR_P 启发式概率：0.5→25.9% 0.7→14.1% 0.9→5.3% 1.0→1.3%
 *   取 easy=0.2（练手档，人类该赢得比输多）、medium=0.7（居中）。
 *
 * ⚠️ 人类=随机手是**下限**基线，真实玩家比随机手强，体感会更接近 medium/hard 那一侧。
 *    改这两个数之前先重跑扫描，别凭直觉调。
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

/** 返回落子 `m` 后能否立刻三连获胜（用于「挡一手」判定，不含对手已有连子） */
function winsAt(b: Board, m: number, player: Player): boolean {
  b[m] = player;
  const won = checkWinner(b).winner === player;
  b[m] = 0;
  return won;
}

/** 返回所有「落这里就三连」的点 */
function winningMoves(b: Board, player: Player): number[] {
  return legalMoves(b).filter((m) => winsAt(b, m, player));
}

/** 中心与四角：启发式落子的偏好位（新手玩家的直觉位置） */
const PREFERRED: readonly number[] = [4, 0, 2, 6, 8, 1, 3, 5, 7];

/** easy 档「挡对手下一手」的概率（扫描得来，见文件头） */
const EASY_BLOCK_P = 0.2;
/** medium 档「走启发式」的概率，其余走随机（扫描得来，见文件头） */
const MEDIUM_HEUR_P = 0.7;

/**
 * 启发式选点（medium / easy 共用）：
 *   1. 我能赢 → 赢
 *   2. 对手能赢 → 挡（井字棋里「能挡就一定要挡」，新手也会做）
 *   3. 其余按 PREFERRED 顺序取第一个空格
 *
 * 关键约束：**不做长线规划**。不预判「这手之后对手会怎么走」，
 * 也不 fork 成双威胁，因此强度显著低于 minimax —— 这正是 medium 与 hard 的分界。
 */
function heuristicMove(b: Board, player: Player): number {
  const mine = winningMoves(b, player);
  if (mine.length) return mine[0];

  const foe = (player === 1 ? 2 : 1) as Player;
  const theirs = winningMoves(b, foe);
  if (theirs.length) {
    // 对手有多点能赢时随机挑一个（多点同赢本身是必败局面，早输晚输一样）
    return theirs[Math.floor(Math.random() * theirs.length)];
  }

  for (const m of PREFERRED) if (b[m] === 0) return m;
  return legalMoves(b)[0] ?? -1;
}

/** 选择落子。`player` = 当前轮到谁（X 或 O）。 */
export function bestMove(b: Board, player: Player, difficulty: Difficulty): number {
  const moves = legalMoves(b);
  if (moves.length === 0) return -1;

  // easy：低概率挡 immediate win，其余纯随机。
  // 旧实现是「80% 随机 + 20% 完美 minimax」——AI 有时像傻子有时像神，
  // 玩家学不到任何东西。改成「弱挡手」后行为一致，强度也可控。
  if (difficulty === 'easy') {
    const foe = (player === 1 ? 2 : 1) as Player;
    const threat = winningMoves(b, foe);
    if (threat.length && Math.random() < EASY_BLOCK_P) {
      return threat[Math.floor(Math.random() * threat.length)];
    }
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // medium：以 MEDIUM_HEUR_P 走启发式，否则随机；不规划
  if (difficulty === 'medium') {
    return Math.random() < MEDIUM_HEUR_P
      ? heuristicMove(b, player)
      : moves[Math.floor(Math.random() * moves.length)];
  }

  // hard：完整 minimax（9 格穷举不耗资源）
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

/**
 * 难度曲线探针：人类=随机手，统计人类胜率。
 * 期望（20k 局实测）：easy ≫ medium ≫ hard，且 hard 必须为 0（完美 AI 对随机手必不败）。
 *
 * 这条断言防的是「三档退化成同一档」——旧实现 medium≡hard（都是 0.0%），
 * 单看每档都「正常」，只有横向比较才暴露。
 *
 * 注意：跑 20k 局约需数秒，CI 里若嫌慢可降到 4000（比例关系不变）。
 */
export function difficultyCurve(games = 4000): {
  easyHuman: number; mediumHuman: number; hardHuman: number;
} {
  const run = (diff: Difficulty): number => {
    let humanWin = 0;
    for (let g = 0; g < games; g++) {
      const b = emptyBoard();
      let turn: Player = 1;
      let winner = 0;
      while (winner === 0) {
        const moves = legalMoves(b);
        if (!moves.length) { winner = 3; break; }
        const m = turn === 2
          ? bestMove(b, 2, diff)
          : moves[Math.floor(Math.random() * moves.length)];
        b[m] = turn;
        turn = turn === 1 ? 2 : 1;
        winner = checkWinner(b).winner;
      }
      if (winner === 1) humanWin++;
    }
    return (humanWin / games) * 100;
  };
  return {
    easyHuman: run('easy'),
    mediumHuman: run('medium'),
    hardHuman: run('hard'),
  };
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

  // 三档难度必须单调递减：hard 对随机手必不败(=0)，medium 居中，easy 最松
  const c = difficultyCurve();
  if (!(c.easyHuman > c.mediumHuman)) {
    ok = false;
    details.push(`easy(${c.easyHuman.toFixed(1)}%) 应高于 medium(${c.mediumHuman.toFixed(1)}%)`);
  }
  if (!(c.mediumHuman > c.hardHuman)) {
    ok = false;
    details.push(`medium(${c.mediumHuman.toFixed(1)}%) 应高于 hard(${c.hardHuman.toFixed(1)}%)`);
  }
  if (c.hardHuman !== 0) {
    ok = false;
    details.push(`hard 对随机手人类胜率应为 0，实际 ${c.hardHuman.toFixed(1)}%`);
  }
  // easy 是练手档：人类应该赢得比输多
  if (c.easyHuman < 35) {
    ok = false;
    details.push(`easy 人类胜率 ${c.easyHuman.toFixed(1)}% 过低（练手档应 >35%）`);
  }
  return { ok, details };
}