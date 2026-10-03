/**
 * 围棋 AI — easy / medium / hard 三档，纯规则，不依赖神经网络
 *
 * W5.5 决策（2026-10-03）：原计划用 KataGo b6c96 ONNX，实测 HF 仓库无该模型
 * （只有 b28c512，uint8 71.7MB / fp32 279.5MB），且站点 CSP `script-src` 无
 * 'wasm-unsafe-eval' 会拦 ONNX WASM → 改走纯规则强化：新增 evaluate.ts 完整启发式
 * （双向 atari / 做眼 / 纳卡 / 连接）+ hard 档 2-ply 搜索。
 *
 * 三档定位：easy=随机（新手）· medium=1-ply 启发式（进阶）· hard=2-ply + 完整评估（挑战）。
 * 均为纯函数式、19×19 单手 <100ms，不卡 UI、无需 Worker。
 */

import {
  type GoState, type Player,
  legalMoves, computePlay, opponent, countLiberties, collectGroup, scoreChinese,
  pass, hashPosition,
} from './engine.ts';
import { evaluate, quickScore } from './evaluate.ts';

export type Difficulty = 'easy' | 'medium' | 'hard';

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

/**
 * hard：2-ply 搜索 + 完整启发式评估（evaluate.ts）
 *
 * 流程：对每个候选手 m，先算 evaluate(我方视角) 的即时收益；再让对方在 m 之后走
 * 「对我最不利」的一手（取对方 evaluate 最小的着法），用「我走 m 且对方最优应对后」
 * 的分作为该 m 的最终分数。取最高分者。
 *
 * 这比 medium 的 1-ply 强在两点：① 用了双向 atari / 做眼 / 纳卡等完整评估；
 * ② 能看到对方的直接反击（不会盲目自填眼、不会送吃）。
 * 纯静态、确定性（除注入的轻微抖动），19×19 单手 <100ms，无需 Worker 也够快。
 */
export function bestMoveHard(state: GoState, rng: () => number = Math.random): number {
  const moves = legalMoves(state);
  if (moves.length === 0) return -1;
  const me = state.toPlay;
  const size = state.size;

  // ── 剪枝：先按「我走这一手的即时分」粗排，只对前 K 个做 2-ply 深搜 ──
  // 全量 2-ply 在 19×19 是 O(候选²)，单手 11s 不可用；围棋好手高度集中，
  // 只对最值得深搜的一批看反击即可，强度损失极小、速度提升数十倍。
  const K = size >= 19 ? 12 : size >= 13 ? 20 : 32;
  const rough: Array<[number, number]> = [];
  for (const m of moves) {
    const r = computePlay(state, m);
    if (!r.ok || !r.state) continue;
    // 粗排用 quickScore：它对「本手提子 / 制造打吃 / 填眼」极其敏感，
    // 保证任何能提子或值得反击的棋都进 shortlist（纯 evaluate 会漏掉「提子」信号）。
    rough.push([m, quickScore(state.board, r.state.board, size, me, m)]);
  }
  rough.sort((a, b) => b[1] - a[1]);
  const shortlist = rough.slice(0, K).map(([m]) => m);

  let best = -1;
  let bestScore = -Infinity;
  for (const m of shortlist) {
    const r = computePlay(state, m);
    if (!r.ok || !r.state) continue;
    const afterMine = r.state;
    // 传入本手提子数 → evaluate 会把 capture 权重直接计入（保证「能提必提」）
    const immediate = evaluate(afterMine.board, size, me, undefined, r.captured ?? 0);

    // 对方最强应对：在 afterMine 里找使「我方 evaluate 最小」的一手
    // （只扫前几个候选反击，够用即可）
    let worst = immediate;
    const oppReplies = legalMoves(afterMine);
    const replyCap = Math.min(oppReplies.length, 8);
    for (let ri = 0; ri < replyCap; ri++) {
      const o = oppReplies[ri];
      const or = computePlay(afterMine, o);
      if (!or.ok || !or.state) continue;
      const v = evaluate(or.state.board, size, me);
      if (v < worst) worst = v;
    }
    // 关键：以「即时收益」为主，2-ply 只做小幅折扣修正。
    // 否则「提子 + 对方随便走一步」会被误判成不如「安静扩展」，导致该提不提。
    const s = immediate * 0.75 + worst * 0.25 + rng() * 0.4;
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

/** 统一入口 */
export function bestMove(state: GoState, difficulty: Difficulty, rng: () => number = Math.random): number {
  if (difficulty === 'easy') return bestMoveEasy(state, rng);
  if (difficulty === 'hard') return bestMoveHard(state, rng);
  return bestMoveMedium(state, rng);
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
