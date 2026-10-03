/**
 * 围棋 AI（W2.1）— easy / medium 两档，纯 JS，不依赖神经网络
 *
 * 说明：hard 档（KataGo b6c96 浏览器端 ONNX）留 W5.5 做。本文件的 medium
 * 是 b6c96 到位前的**过渡中等 AI**（1-ply 启发式 + 全局子数 + 打吃威胁），
 * 棋力介于「easy 随机」与「hard b6c96」之间，足以让玩家在 MVP 阶段有可玩的对手。
 *
 * 性能：纯 1-ply，每手 O(合法手数 × 棋盘规模)，19×19 下每手 < 5ms，不卡 UI。
 */

import {
  type GoState, type Player,
  legalMoves, computePlay, opponent, countLiberties, collectGroup, scoreChinese,
  pass, hashPosition,
} from './engine.ts';

export type Difficulty = 'easy' | 'medium';

/**
 * easy：随机合法手，优先吃子（若有能提子的手则随机选其一）。
 * rng 可注入（测试用确定性伪随机）。
 */
export function bestMoveEasy(state: GoState, rng: () => number = Math.random): number {
  const moves = legalMoves(state);
  if (moves.length === 0) return -1;
  const capturing: number[] = [];
  for (const m of moves) {
    const r = computePlay(state, m);
    if (r.ok && (r.captured ?? 0) > 0) capturing.push(m);
  }
  const pool = capturing.length > 0 ? capturing : moves;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * medium：1-ply 启发式评估（纯 JS，无 rollout）。
 * 分数 = 提子×15 + 己方落子组气×0.4 + 打吃对方威胁 + 全局子数差×0.02 + 轻微随机。
 * 选分数最高者；轻微随机避免陷入重复。
 */
export function bestMoveMedium(state: GoState, rng: () => number = Math.random): number {
  const moves = legalMoves(state);
  if (moves.length === 0) return -1;
  const me = state.toPlay;
  const opp = opponent(me);
  const size = state.size;

  let best = -1;
  let bestScore = -Infinity;
  for (const m of moves) {
    const r = computePlay(state, m);
    if (!r.ok || !r.state) continue;
    const nb = r.state.board;
    let s = (r.captured ?? 0) * 15;
    s += countLiberties(nb, size, m) * 0.4;

    // 对方打吃威胁：任意对方组气 ≤ 1 则视为受威胁（下一步可被提）
    const seen = new Set<number>();
    let threat = 0;
    for (let i = 0; i < nb.length; i++) {
      if (nb[i] === opp && !seen.has(i)) {
        const g = collectGroup(nb, size, i);
        for (const x of g.stones) seen.add(x);
        if (g.liberties <= 1) threat += 8;
      }
    }
    s += threat;

    // 全局子数差（鼓励吃子后保持优势）
    let myS = 0;
    let oppS = 0;
    for (const c of nb) {
      if (c === me) myS++;
      else if (c === opp) oppS++;
    }
    s += (myS - oppS) * 0.02;

    // 轻微随机扰动，避免完全确定的重复序列
    s += rng() * 0.5;

    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

/** 统一入口 */
export function bestMove(state: GoState, difficulty: Difficulty, rng: () => number = Math.random): number {
  return difficulty === 'easy' ? bestMoveEasy(state, rng) : bestMoveMedium(state, rng);
}

/**
 * 终局评估（供对局结束 / 测试判定胜负）：中国规则数目，从 me 视角返回带符号分差。
 */
export function terminalScore(state: GoState, me: Player): number {
  const sc = scoreChinese(state);
  const raw = me === 1 ? sc.black - sc.white : sc.white - sc.black;
  return raw; // >0 我方胜
}

/** 判定某方是否在终局时获胜 */
export function didWin(state: GoState, me: Player): boolean {
  return terminalScore(state, me) > 0;
}

/**
 * 轻量自对弈 / 人机对弈驱动（供测试与 demo）：从 state 出发，按 difficulty
 * 让 AI(=toPlay) 落子直到终局，返回终局 state。不修改输入 state。
 * 可选 superko 防止 AI 陷入劫争循环。
 */
export function playOut(
  state: GoState,
  difficulty: Difficulty,
  rng: () => number = Math.random,
  opts: { superko?: boolean; maxSteps?: number } = {},
): GoState {
  const { superko = true, maxSteps } = opts;
  let s = state;
  const history = superko ? new Set<string>([hashPosition(s.board, s.toPlay)]) : undefined;
  const cap = maxSteps ?? s.size * s.size * 3;
  let steps = 0;
  while (s.passes < 2 && steps < cap) {
    const m = bestMove(s, difficulty, rng);
    if (m < 0) { s = pass(s); }
    else {
      const r = computePlay(s, m, superko ? { superko: true, history } : {});
      if (!r.ok || !r.state) { s = pass(s); }
      else s = r.state;
    }
    if (history) history.add(hashPosition(s.board, s.toPlay));
    steps++;
  }
  if (s.passes < 2) {
    // 兜底强制双 pass 终局（防止极端不收敛）
    s = pass(pass(s));
  }
  return s;
}
