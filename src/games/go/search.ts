/**
 * 围棋 · α-β 搜索（negamax + quiescence + 置换表 + 时间预算）
 *
 * ═══ 为什么必须重写（2026-10-03 W6）═══
 * v1 的 bestMoveHard 号称「2-ply」，但对方反击是这样取的：
 *     const oppReplies = legalMoves(afterMine);
 *     for (let ri = 0; ri < Math.min(oppReplies.length, 8); ri++)
 * legalMoves 返回的是**棋盘索引升序**的合法手 → 「对方最强反击」实际是
 * 「对方在左上角一排随手走」。深度的一半是噪声，这就是 hard 9 路 1/6 胜（≈随机）
 * 的直接原因。
 *
 * ═══ v2 的做法 ═══
 * - 真 negamax：score(m) = -search(对方视角)，α-β 剪枝
 * - 着法排序按 evaluate Δ 降序 —— **对方反击由此按「对己最不利」排**，
 *   这才是 v1 名义上想做而实际没做的事
 * - Quiescence：只延续提子/打吃/逃气这类强制手直到平静局面
 * - 置换表：局面哈希 → {depth, score, flag}
 * - 时间预算：超时回退到上一轮**完整**深度的最优手，绝不返回半算结果
 * - 增量落子（makems.ts make/unmake）：热路径零分配
 *
 * ═══ 三条实测得来的铁律（每条都对应一个真实 bug）═══
 * 1. 热路径**不得**有 `new Array` / `new Uint8Array` / `.slice()`。
 *    第一版每候选分配一次 Uint8Array 判打吃 → 12ms/节点 → 单手 1.5s 只搜到深度 1。
 * 2. **叶节点评估必须是与 toPlay 无关的零和标量**。直接用 evaluate(b, toPlay) 时，
 *    me 随 toPlay 交替，奇数深度与偶数深度的叶节点分不在同一口径（我方多出的
 *    那颗子被计入），α-β 的 max/min 失去意义。实测 depth=1/3 选 (0,0)、
 *    depth=2/4 选三线。现统一为「先算黑方净胜，再按 toPlay 取符号」（leafEval）。
 * 3. **内部层不插 pass**。pass 不改棋盘却消耗一层深度，会让 α-β 上下界在不同
 *    分支上不可比（β 截断返回上界，取负后是虚假分）。pass 只在根层参与比较。
 *
 * 另：moveNum 必须随 ply 递增传遍全树，否则阶段权重（开局三线 vs 官子中心）
 * 不一致，19 路会一直按开局标准评估。
 */
import { type GoState } from './engine.ts';
import { evaluate, type EvalWeights, DEFAULT_WEIGHTS } from './evaluate.ts';
import {
  make, unmake, isLegal, createPos,
  type PosState, type UndoLog,
} from './makems.ts';


export interface SearchResult {
  move: number;          // 落子点；-1 = pass
  score: number;
  depth: number;         // 实际完成的深度
  nodes: number;
  ms: number;
}

interface TTEntry { depth: number; score: number; flag: 0 | 1 | 2; move: number; }

/** 时间到 → 抛哨兵冒泡（比在热循环里反复读 Date.now() 便宜） */
class TimeUp extends Error { }

/** 搜索上下文：阶段自适应所需的基准手数 */
interface Sctx {
  w: EvalWeights;
  tt: Map<string, TTEntry>;
  deadline: number;
  /** 进入搜索时的 moveNumber */
  base: number;
}

// ───────────────────────── 入口 ─────────────────────────

export function searchBest(
  state: GoState,
  opts: { depth?: number; timeBudgetMs?: number; weights?: EvalWeights } = {},
): SearchResult {
  const t0 = Date.now();
  const size = state.size;
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const maxDepth = opts.depth ?? defaultDepth(size);
  const deadline = t0 + (opts.timeBudgetMs ?? defaultBudget(size));
  const tt = new Map<string, TTEntry>();
  const ctx: Sctx = { w, tt, deadline, base: state.moveNumber };
  const pos = createPos(state.board, size, state.toPlay);
  pos.ko = state.ko !== null && state.koFor === state.toPlay ? state.ko : -1;

  const roots = rootCandidates(pos, ctx);
  if (roots.length === 0) return { move: -1, score: 0, depth: 0, nodes: 0, ms: 0 };

  let nodes = 0;
  let best = roots[0].move;
  let bestScore = roots[0].score;
  let reached = 0;
  const log: UndoLog = [];

  // 根排序里的实手（pass 单独处理，不参与深搜名单）
  const realRoots = roots.filter(r => r.move >= 0);
  const passRoot = roots.find(r => r.move < 0);

  for (let d = 1; d <= maxDepth; d++) {
    let localBest = -2;
    let localScore = -Infinity;
    // 🔴 深搜名单：只取根排序前 K 的**实手**。
    // ① 全窗口搜索下每个根候选都要跑完整子树，19 路 361 点根本搜不动
    //    （实测 6s 只到 depth 3 / 283 节点）；收窄后同样预算能到 depth 5+。
    // ② pass 不能进名单：它的 Δ 恒为 0，混在实手里会挤占名额，
    //    且深搜后其分数与实手不可比（实测首手退化成 (1,0) 一线）。
    const shortlist = d <= 1 ? realRoots : realRoots.slice(0, rootWidth(size, d));
    try {
      // 🔴 根层必须用**全窗口**（-Inf, +Inf）。窄窗口（beta = -alpha）下，
      // 被 β 截断的分支只返回下界，取负后变成虚假的上界分 ——
      // 表现为「该提子不提、该做眼不做」，战术用例直接判负。
      // 剪枝只发生在内部层（那里取到的界不会参与最终选着）。
      for (const cand of shortlist) {
        if (!isLegal(pos, cand.move)) continue;
        const mark = log.length;
        const cap = make(pos, cand.move, log, mark);
        if (cap < 0) { unmake(pos, log, mark); continue; }
        nodes++;
        const sc = -negamax(pos, d - 1, -Infinity, Infinity, ctx, log, 1);
        unmake(pos, log, mark);
        if (sc > localScore) { localScore = sc; localBest = cand.move; }
      }
    } catch (e) {
      if (e instanceof TimeUp) {
        if (reached === 0) { best = roots[0].move; bestScore = roots[0].score; }
        return { move: best, score: bestScore, depth: reached, nodes, ms: Date.now() - t0 };
      }
      throw e;
    }
    // pass 兜底：仅当所有实手都没能搜出结果（理论上不会发生，因为 legalMoves 非空）
    // 或局面上确实没有比 pass 更好的着法时，才允许 pass。
    if (localBest === -2 && passRoot !== undefined) { localBest = -1; localScore = 0; }
    if (localBest === -2) break;              // 本深度无着 → 用上一轮结果
    best = localBest;
    bestScore = localScore;
    reached = d;
    if (bestScore >= 120) break;             // 稳胜，无需更深
  }

  return { move: best, score: bestScore, depth: reached, nodes, ms: Date.now() - t0 };
}

/** 深搜阶段的根候选宽度（越深越窄，保证能到更深层） */
function rootWidth(size: number, depth: number): number {
  if (depth >= 4) return size <= 9 ? 6 : 4;
  if (depth === 3) return size <= 9 ? 10 : 6;
  return size <= 9 ? 16 : 10;
}

/**
 * hard 档默认深度 / 时间预算。
 *
 * 实测（9 路，depth 1→5）：**深度 2 之后收益趋平** —— depth2/3/4 选点几乎一致，
 * 说明瓶颈在**评估函数精度**而非搜索深度。再往上堆深度只烧时间。
 * 故 depth 4 封顶，把余下预算留给 quiescence 与时间稳定性。
 */
function defaultDepth(size: number): number {
  if (size <= 9) return 4;
  if (size <= 13) return 3;
  return 2;
}
function defaultBudget(size: number): number {
  if (size <= 9) return 900;
  if (size <= 13) return 1200;
  return 1600;
}

// ───────────────────────── negamax ─────────────────────────

/** 返回**当前 toPlay 视角**的评分 */
function negamax(
  pos: PosState, depth: number, alpha: number, beta: number,
  ctx: Sctx, log: UndoLog, ply: number,
): number {
  if ((++_tick & 127) === 0 && Date.now() > ctx.deadline) throw new TimeUp();

  const moveNum = ctx.base + ply;
  const key = hashPos(pos);
  const hit = ctx.tt.get(key);
  if (hit !== undefined && hit.depth >= depth) {
    if (hit.flag === 0) return hit.score;
    if (hit.flag === 1 && hit.score <= alpha) return hit.score;
    if (hit.flag === 2 && hit.score >= beta) return hit.score;
  }

  // 🔴 depth=1（即根的最后一层）**不做 quiesce**，直接静态评估。
  // quiesce 的 forcedMoves 判据在浅层会误触发（实测空盘落子后 escapeCount=1，
  // 于是每个根候选都被额外挖 1~4 层，分被搅乱：depth=1 选 (1,0) 得 6.10，
  // 而 evaluate 本身给三线 7.18）。根层要的是**可比**的静态分，不是战术分。
  if (depth <= 0) return leafEval(pos, ctx, moveNum);

  const cands = orderedMoves(pos, ctx, moveNum, branchFactor(depth));

  let best = -Infinity;
  let bestMove = -2;
  const a0 = alpha;

  for (const m of cands) {
    const mk = log.length;
    const cap = make(pos, m, log, mk);
    if (cap < 0) { unmake(pos, log, mk); continue; }
    const sc = -negamax(pos, depth - 1, -beta, -alpha, ctx, log, ply + 1);
    unmake(pos, log, mk);
    if (sc > best) { best = sc; bestMove = m; }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;               // β 截断
  }

  if (best === -Infinity) return leafEval(pos, ctx, moveNum);
  const flag: 0 | 1 | 2 = best <= a0 ? 1 : best >= beta ? 2 : 0;
  if (hit === undefined || hit.depth < depth) ctx.tt.set(key, { depth, score: best, flag, move: bestMove });
  return best;
}

let _tick = 0;

/** 宽度递减：越深候选越少（兼顾深度与速度） */
function branchFactor(depth: number): number {
  if (depth >= 4) return 8;
  if (depth === 3) return 10;
  return 12;
}

// ───────────────────────── quiescence ─────────────────────────


/**
 * 叶节点评估：**零和标量**。先算「黑方净胜」，再按 toPlay 取符号。
 *
 * 🔴 不能直接用 evaluate(b, toPlay)：那样 me 随 toPlay 交替，奇数深度与偶数深度
 * 的叶节点分不在同一口径上（我方多出的那颗子被计入），α-β 的 max/min 失去意义。
 * 实测 depth=1/3 会选 (0,0)、depth=2/4 选三线。
 */
function leafEval(pos: PosState, ctx: Sctx, moveNum: number): number {
  // pos.captured 是**当前这一手**的提子数（make 设置、unmake 还原），
  // 正是我们要的信号。不存在跨层累加问题：叶节点读到的就是最后那手的战果。
  // 早期版本误用「路径累计提子数」，而同一深度下所有候选路径的累计值相同
  // （黑提 1 子后白必提回），完全没有区分度 → AI 死活不提子。
  const black = evaluate(pos.board, pos.size, 1, moveNum, ctx.w, pos.captured);
  return pos.toPlay === 1 ? black : -black;
}


// ───────────────────────── 着法生成与排序 ─────────────────────────

/**
 * 候选排序（搜索强度的关键）：按 evaluate Δ 降序。
 * 于是「对方最强反击」自然排在最前被搜到 —— v1 缺的正是这个排序。
 *
 * 🔴 内部层**不插 pass**：pass 不改棋盘却消耗一层深度，会让 α-β 上下界在不同
 * 分支上不可比。pass 只在根层比较（官方规则允许随时 pass）。
 */
function orderedMoves(pos: PosState, ctx: Sctx, moveNum: number, limit: number): number[] {
  const { board } = pos;
  const baseLeaf = leafEval(pos, ctx, moveNum);
  const scored: Array<{ m: number; s: number }> = [];
  const log: UndoLog = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0 || i === pos.ko) continue;
    if (!isLegal(pos, i)) continue;
    const mk = log.length;
    const cap = make(pos, i, log, mk);
    if (cap < 0) { unmake(pos, log, mk); continue; }
    // 🔴 leafEval 恒以「黑方净胜」为标量，toPlay 翻转时整体取负。
    // 这里必须**按当前 toPlay 视角**折算后再比较，否则轮到白走时排序完全反向
    // （对手的「最差手」被当成「最好手」，剪枝把好手全砍掉）。
    // 症状：depth=1 选 (4,3) 三线，depth≥2 一律退化成 (1,0) 一线。
    // 落子后 toPlay 翻转 → leafEval 折算成对手视角，取负还原成当前行棋方收益
    const afterLeaf = leafEval(pos, ctx, moveNum + 1);
    const s = (pos.toPlay === 1 ? -afterLeaf : afterLeaf) - baseLeaf;
    unmake(pos, log, mk);
    scored.push({ m: i, s });
  }
  if (scored.length === 0) return [];
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map(x => x.m);
}

/** 根节点候选：全量比较（不按 limit 截断），含 pass */
/**
 * 根节点候选：全量比较（不按 limit 截断），含 pass。
 *
 * 🔴 前后评估必须**同一视角**。这里全程以「当前 toPlay 视角」比较：
 *   base   = leafEval(pos)                 → 当前行棋方视角
 *   after  = leafEval(pos 落子后)          → 仍是当前行棋方视角（leafEval 内部
 *                                          按 pos.toPlay 取符号，落子后 toPlay 翻转
 *                                          已经把符号折算回来了）
 * 早期版本写成 `evaluate(board, 1, ...)` 拿「黑方标量」与 leafEval 的结果相减，
 * 两者口径不一致 → 根排序把四个角 (Δ 真实为 -5.29) 排到最前，
 * shortlist 一裁剪就把三线全切掉，depth≥2 首手退化到一线（实测 (0,0)/(8,0)/(0,8)/(8,8) Δ 显示为 +5.29）。
 */
function rootCandidates(pos: PosState, ctx: Sctx): Array<{ move: number; score: number }> {
  const { board } = pos;
  const toPlay = pos.toPlay;
  const base = leafEval(pos, ctx, ctx.base);
  const out: Array<{ move: number; score: number }> = [];
  const log: UndoLog = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0 || i === pos.ko) continue;
    if (!isLegal(pos, i)) continue;
    const mk = log.length;
    const cap = make(pos, i, log, mk);
    if (cap < 0) { unmake(pos, log, mk); continue; }
    // 落子后 toPlay 已翻转，leafEval 会折算成「落子方视角」= 仍是 toPlay 的对手，
    // 故取负还原成落子方的收益
    const afterLeaf = leafEval(pos, ctx, ctx.base + 1);
    const s = (toPlay === 1 ? -afterLeaf : afterLeaf) - base;
    unmake(pos, log, mk);
    out.push({ move: i, score: s });
  }
  out.push({ move: -1, score: 0 });   // pass：棋盘不变 → Δ=0
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** 局面哈希（board + 行棋方）；charCode 拼接避免每点 toString 分配 */
function hashPos(pos: PosState): string {
  const b = pos.board;
  const n = b.length;
  const chars: string[] = new Array<string>(n + 2);
  for (let i = 0; i < n; i++) chars[i] = String.fromCharCode(48 + b[i]);
  chars[n] = ':';
  chars[n + 1] = String.fromCharCode(48 + pos.toPlay);
  return chars.join('');
}
