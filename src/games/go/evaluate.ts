/**
 * 围棋 · 局面评估（纯函数，无 DOM、无随机）—— MCTS 与静态搜索共用
 *
 * 相比 W2.1 那版 1-ply 评估（只看"落子点自身的气 + 提子数"），这里补齐了
 * 围棋真正的胜负手：双向打吃、逃气/长考、连接增值、做眼、纳卡（不填自己单点眼）。
 *
 * 所有量都从 board 纯函数推导，**与 toPlay 无关的部分**先算好，
 * 再以 `me` 视角折算分差，保证 evaluate(board, 黑) 与 evaluate(board, 白) 互为相反数。
 */
import { collectGroup, type Board, type Player } from './engine.ts';

export interface EvalWeights {
  /** 提掉对方一子 */
  capture: number;
  /** 对方一组被打吃（气=1）——威胁收益 */
  atariOpp: number;
  /** 我方一组被打吃（气=1）——危险，必须救 */
  atariSelf: number;
  /** 棋块气数（每口气，封顶递减） */
  liberty: number;
  /** 气为 2 的薄块（容易被吃） */
  fragile: number;
  /** 落子形成"眼"（空点四周皆己方子） */
  eye: number;
  /** 己方成块数（鼓励连接、少孤） */
  cohesion: number;
  /** 盘面领空（简单均势差） */
  influence: number;
  /** 纳卡惩罚（填掉自己单点眼 = 送死） */
  nakade: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  capture: 18,        // 提子是最高优先级：必须压过"安静扩展"的收益
  atariOpp: 12,
  atariSelf: -18,
  liberty: 1.6,
  fragile: -2.2,
  eye: 6,
  cohesion: 1.2,
  influence: 0.18,    // 压低子数权重：子数差本身不等于收益（提子已经计入 capture）
  nakade: -9,
};

const NB: ReadonlyArray<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function nbrs(size: number, i: number, out: number[]): void {
  out.length = 0;
  const x = i % size, y = (i / size) | 0;
  for (const [dx, dy] of NB) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    out.push(ny * size + nx);
  }
}

/** 判断空点 i 是否是 color 的"真眼"候选：四邻皆己方（对角不计，这是简化判定） */
function isEyePoint(board: Board, size: number, i: number, color: Player): boolean {
  if (board[i] !== 0) return false;
  const buf: number[] = [];
  nbrs(size, i, buf);
  if (buf.length < 4) return false;              // 边角不足四邻，不算眼
  for (const n of buf) if (board[n] !== color) return false;
  return true;
}

/**
 * 核心评估：返回 **me 视角** 的局面分（越大越好）。
 * 纯函数：同样 board + 同样 me 恒返回同值。
 */
export function evaluate(
  board: Board, size: number, me: Player, w: EvalWeights = DEFAULT_WEIGHTS,
  /** 本手提掉的对方子数（由调用方从 PlayResult.captured 传入；默认 0 = 纯静态评估） */
  captured: number = 0,
): number {
  const opp: Player = me === 1 ? 2 : 1;
  const seen = new Set<number>();

  // 提子是最高优先级信号：直接计入，不被其他项稀释
  let score = captured * w.capture;
  let myStones = 0, oppStones = 0;
  let myGroups = 0, oppGroups = 0;
  let myEyes = 0, oppEyes = 0;

  for (let i = 0; i < board.length; i++) {
    const c = board[i];

    // ── 空点：做眼 / 纳卡 ──
    if (c === 0) {
      if (isEyePoint(board, size, i, me)) myEyes++;
      else if (isEyePoint(board, size, i, opp)) oppEyes++;
      continue;
    }

    if (c === me) myStones++; else oppStones++;

    if (seen.has(i)) continue;
    const g = collectGroup(board, size, i);
    for (const s of g.stones) seen.add(s);

    const isMine = c === me;
    if (isMine) {
      myGroups++;
      // 气（递减收益：4 气以上不再加分，封顶 3）
      score += Math.min(g.liberties, 3) * w.liberty;
      // 被打吃（气=1）：重罚
      if (g.liberties <= 1) score += w.atariSelf;
      // 薄块（气=2）：轻罚
      else if (g.liberties === 2) score += w.fragile;
    } else {
      oppGroups++;
      // 对方被打吃：威胁收益
      if (g.liberties <= 1) score += w.atariOpp;
    }
  }

  // ── 眼差（做眼是 Go 的核心）──
  score += (myEyes - oppEyes) * w.eye;

  // ── 块数差（鼓励连接、少孤棋）──
  score += (myGroups - oppGroups) * w.cohesion;

  // ── 领空/子数差（均势判断，收尾阶段主导）──
  score += (myStones - oppStones) * w.influence;

  return score;
}

/**
 * 落子后的即时奖励（对 MCTS 的 move prior 与"是否值得下这手"用）。
 * = 该手带来的分差变化（对称抵消静态分，故只看 Δ）。
 */
export function evaluateMove(
  before: Board, after: Board, size: number, me: Player, move: number,
  w: EvalWeights = DEFAULT_WEIGHTS,
): number {
  const base = evaluate(after, size, me, w) - evaluate(before, size, me, w);
  // 纳卡：自己填掉自己的单点眼 = 严重自伤
  let out = base;
  if (before[move] === 0 && isEyePoint(before, size, move, me)) out += w.nakade;
  return out;
}

/** 一手棋的粗排序分（MCTS 收敛前的初始排序 / easy 档用），越大越优先 */
export function quickScore(before: Board, after: Board, size: number, me: Player, move: number): number {
  const opp: Player = me === 1 ? 2 : 1;
  let s = 0;

  // 本手提子数
  for (let i = 0; i < before.length; i++) {
    if (before[i] === opp && after[i] === 0) s += 12;
  }
  // 落子后所在棋块的气（连接后整体气，不是单子）
  if (after[move] === me) {
    const g = collectGroup(after, size, move);
    s += Math.min(g.liberties, 4) * 1.5;
    if (g.liberties <= 1) s -= 14;                 // 把自己送进打吃
  }
  // 制造对敌打吃
  const seen = new Set<number>();
  for (let i = 0; i < after.length; i++) {
    if (after[i] === opp && !seen.has(i)) {
      const g = collectGroup(after, size, i);
      for (const x of g.stones) seen.add(x);
      if (g.liberties === 1) s += 9;
    }
  }
  // 纳卡：填自己的眼重罚
  if (before[move] === 0 && isEyePoint(before, size, move, me)) s -= 10;
  return s;
}
