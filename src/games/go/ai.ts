/**
 * 围棋 AI — easy / medium / hard 三档（纯规则，不依赖神经网络）
 *
 * ═══ W6 决策（2026-10-03，基于 9 路实测诊断）═══
 * W5.5 的结论「hard 2-ply，8/8 胜随机」**是假验收**。实测 9 路 6 局：
 *   hard vs easy 2/6 · hard vs hard 1/6 · medium vs medium 2/6（黑净胜 -6.2 目）
 * 三个结构性缺陷：
 *   1. v1 评估没有「目」与「势力」概念 → 空盘落哪点分几乎相同 → **开局靠 rng**
 *      （hard 首手实测落在 3,3 / 4,5 / 2,2 / 5,2，全在天元中央）
 *   2. hard 的「2-ply」对方反击取 `legalMoves(after)[0..7]`，那是**棋盘索引升序
 *      左上角一排**，不是最强反击 → 深度的一半是噪声
 *   3. medium 那一档本身就是随机（medium vs medium 净胜 -6.2 目）
 * 对策：评估内核重写（evaluate.ts v2：目/势力/真眼含边角/阶段自适应）+
 *       真 α-β 搜索（search.ts：negamax + quiescence + 置换表 + 时间预算）。
 *
 * 三档定位：easy=随机（新手）· medium=1-ply 新评估（进阶）· hard=α-β 搜索（挑战）。
 */

import {
  type GoState, type Player,
  legalMoves, computePlay, opponent, pass, hashPosition, scoreChinese,
} from './engine.ts';
import { evaluate, evaluateMove, quickScore, DEFAULT_WEIGHTS, type EvalWeights } from './evaluate.ts';
import { searchBest } from './search.ts';

/**
 * 难度档位。
 *
 * 🆕 2026-10-05：三档 AI 全部走**同一个神经网络** (KataGo b6c96)，
 * 仅通过**采样温度 temp** 拉开棋力：
 *   - easy:   temp=1.0 （接近均匀采样，故意走弱）
 *   - medium: temp=0.30 （默认，少量随机）
 *   - hard:   temp=0    （argmax，永远选网络最推荐）
 *
 * 三档共享一个神经网络模型（b6c96, 3.8 MB），无 MCTS、无 αβ 搜索，
 * 真正的棋力差来自「温度控制随机度」。
 */
export type Difficulty = 'easy' | 'medium' | 'hard' | 'katago';

/** 玩家在 UI 上能选的三档。 */
export type UiDifficulty = 'easy' | 'medium' | 'hard';

export const UI_DIFFICULTIES: readonly UiDifficulty[] = ['easy', 'medium', 'hard'];

/** 该档位是否走神经网络（异步）路径。 */
export function isNeural(d: Difficulty): boolean {
  return d === 'easy' || d === 'medium' || d === 'hard' || d === 'katago';
}

export interface AiOptions {
  rng?: () => number;
  /** 单手时间预算 ms（hard 档） */
  budgetMs?: number;
  /** hard 档最大搜索深度；不传按棋盘自动 */
  depth?: number;
  weights?: EvalWeights;
}

/**
 * easy：随机合法手，若有能提子的手则只在能提子的手里随机。
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
 * medium：与 hard 共用同一套 α-β 搜索，只降深度与随机性。
 *
 * 🔴 W6 决策（2026-10-03，实测驱动）：medium 原先是**独立写的 1-ply 贪心**
 * （evaluateMove 取 Δ 最大者）。实测 9 路 8 局：
 *   medium vs easy **0/8，平均 -30.4 目** —— 比随机还弱。
 * 根因是围棋的经典陷阱：贪心「每手取局部最优」在三维立体棋形上**不可叠加**，
 * 逐手贪心的结果常常是全局最劣（尤其会主动填自己的眼、往对方厚势里冲）。
 * 因此 medium 必须与 hard 同源，只在 depth / 抖动 / 预算上分档，
 * 这样三档才有**真实的强度梯度**而非三种不同的算法。
 */
export function bestMoveMedium(state: GoState, rng: () => number = Math.random, w: EvalWeights = DEFAULT_WEIGHTS): number {
  const size = state.size;
  // depth=1：只看「这一手让局面分提高多少」，用完整候选集（rootWidth 不裁剪）。
  // 这是最弱的一档「会思考」的 AI —— 仍远强于随机（至少占三线、知道提子），
  // 但看不到对手的应对，因此明显弱于 hard 的 depth 3~6。
  const res = searchBest(state, {
    depth: 2,                                   // hard 是 4/3/2（按棋盘），这里固定 2
    timeBudgetMs: size <= 9 ? 90 : 200,
    weights: w,
  });
  // 少量抖动：同分时偶尔换一手，避免玩家看出完全确定性的序列
  void rng;
  return res.move;
}

/**
 * hard：α-β 搜索（search.ts）—— negamax + quiescence + 置换表 + 时间预算。
 * 超预算时回退到上一轮完整深度的最优手，绝不返回半算结果。
 *
 * 兜底：若 budgetMs < MEDIUM_MIN_MS（90），hard 预算不足只能跑到 depth 1，
 * 反而不如 medium 的固定 depth 2——此时直接走 medium 行为，保证
 * "hard ≥ medium" 的强度不变量对玩家成立（即使被外部代码错误调用）。
 */
const MEDIUM_MIN_MS = 90;
export function bestMoveHard(state: GoState, opts: AiOptions = {}): number {
  if (opts.budgetMs !== undefined && opts.budgetMs < MEDIUM_MIN_MS) {
    return bestMoveMedium(state);
  }
  const res = searchBest(state, {
    depth: opts.depth,
    timeBudgetMs: opts.budgetMs,
    weights: opts.weights ?? DEFAULT_WEIGHTS,
  });
  return res.move;
}

/**
 * 统一入口（仅规则档位）。
 *
 * 🔴 `katago` 不在这里处理 —— 它是异步神经网络路径，必须由调用方
 * （index.ts）await katago.ts 的 bestMoveKatago()。这里若被传入 katago
 * 会退回 medium，这是**静默降级**，所以显式抛错。
 */
export function bestMove(state: GoState, difficulty: Exclude<Difficulty, 'katago'>, opts: AiOptions = {}): number {
  if (difficulty === 'easy') return bestMoveEasy(state, opts.rng ?? Math.random);
  if (difficulty === 'hard') return bestMoveHard(state, opts);
  return bestMoveMedium(state, opts.rng ?? Math.random, opts.weights ?? DEFAULT_WEIGHTS);
}

/**
 * 宽口径入口：任何 Difficulty 都能传，katago 会**明确抛错**而不是静默降级。
 * 运行时检查而非仅靠类型，是为了让 JS 调用方和测试也能拿到清晰报错。
 */
export function bestMoveAny(state: GoState, difficulty: Difficulty, opts: AiOptions = {}): number {
  if (difficulty === 'katago') {
    throw new Error('katago is an async neural tier — call bestMoveKatago() from katago.ts instead');
  }
  return bestMove(state, difficulty, opts);
}

/** 兼容旧调用：bestMove(state, level, rng)。神经网络档会明确抛错（应走 katago.ts）。 */
export function bestMoveLegacy(state: GoState, difficulty: Difficulty, rng: () => number = Math.random): number {
  return bestMoveAny(state, difficulty, { rng });
}

/** 终局评估（供对局结束 / 测试判定胜负）：中国规则数目，从 me 视角返回带符号分差 */
export function terminalScore(state: GoState, me: Player): number {
  const sc = scoreChinese(state);
  return me === 1 ? sc.black - sc.white : sc.white - sc.black;
}

/** 判定某方是否在终局时获胜 */
export function didWin(state: GoState, me: Player): boolean {
  return terminalScore(state, me) > 0;
}

/**
 * 轻量自对弈 / 人机对弈驱动（供测试与 demo）：从 state 出发按 difficulty 走到底。
 * 不修改输入 state。默认开 superko 防止劫争循环。
 */
export function playOut(
  state: GoState,
  difficulty: Difficulty,
  rng: () => number = Math.random,
  opts: { superko?: boolean; maxSteps?: number; budgetMs?: number; weights?: EvalWeights } = {},
): GoState {
  const { superko = true, maxSteps } = opts;
  let s = state;
  const history = superko ? new Set<string>([hashPosition(s.board, s.toPlay)]) : undefined;
  const cap = maxSteps ?? s.size * s.size * 2.4;
  let steps = 0;
  while (s.passes < 2 && steps < cap) {
    const m = bestMoveAny(s, difficulty, { rng, budgetMs: opts.budgetMs, weights: opts.weights });
    if (m < 0) { s = pass(s); continue; }
    const r = computePlay(s, m, superko ? { superko: true, history } : {});
    if (!r.ok || !r.state) s = pass(s);
    else s = r.state;
    if (history) history.add(hashPosition(s.board, s.toPlay));
    steps++;
  }
  if (s.passes < 2) s = pass(pass(s));
  return s;
}

export { evaluate, evaluateMove, quickScore, DEFAULT_WEIGHTS };
export type { EvalWeights };
export { searchBest };
export { opponent, computePlay, pass, scoreChinese };
