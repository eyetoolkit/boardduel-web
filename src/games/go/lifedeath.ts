/**
 * 围棋 · 死活判定（Benson Pass-Alive + 真·眼位空间）
 *
 * ═══ W7 方案 A 的设计依据（2026-10-03）═══
 * W6 的 evaluate 只数「气 / 真眼个数 / 块数」。基线实测 4/5 项失败：
 *   ① 白两目活 vs 一目：黑视角差仅 +1.39 → 看不出活棋与濒死的区别
 *   ② 征子有援子 vs 无援子：差 **-10.12**（方向反了）
 *   ③ 搜索 3000ms 仍不提被打吃的孤子
 *   ④ 大块无眼被包（死）得分 **+7.30** > 小块有气（活）**+2.66** → 死棋优于活棋
 *
 * 根因：这些都是「整块棋生死」层面的判断，线性加权表达不了。
 *
 * ═══ 关键设计教训（第一版踩的坑，务必保留）═══
 * 🔴 **眼位空间不能用「从块的空邻点做 flood-fill」**。
 * 第一版这样实现，结果死块（5 子被白包住、气=3）算出的眼位空间 = **16**（最大值），
 * 于是死棋反而成了最优 —— 与基线 ④ 的症状完全一致。
 *
 * 原因：从空邻点 flood 时，**那些「被对方棋子围住、自己围不到」的空点也被算进来了**。
 * 围棋里「眼位」的定义是**这块棋自己能够围成眼的空区**，所以 flood 必须
 * **只走与本块有通路、且沿途不经过对方强占的区域**。
 *
 * 正确判据（三条同时满足才算这块棋有眼位）：
 *   a) 该空点在本块势力范围内（不会被对方先占）
 *   b) 从该空点出发能连到足够多的空点（成片的空区才可能做第二眼）
 *   c) 该空区不能全部是「单点小空」（那只是气，不是眼位）
 */

const NB4: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NB8: ReadonlyArray<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

type BoardLike = ArrayLike<number>;

interface Group {
  stones: number[];
  liberties: number;
  libSet: Set<number>;
}

/** flood-fill 收集同色连通块（含气点集合）。
 *  不能用 engine.collectGroup —— 它签名固定 3 参且要求 number[]，
 *  而搜索热路径传的是 Int8Array（ArrayLike）。 */
function groupOf(b: BoardLike, size: number, start: number, color: number): Group {
  const stones: number[] = [];
  const seen = new Uint8Array(size * size);
  const libSet = new Set<number>();
  const stack: number[] = [start];
  seen[start] = 1;
  while (stack.length) {
    const cur = stack.pop() as number;
    stones.push(cur);
    const x = cur % size;
    const y = (cur / size) | 0;
    for (const [dx, dy] of NB4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      const v = b[ni];
      if (v === 0) libSet.add(ni);
      else if (v === color && seen[ni] !== 1) { seen[ni] = 1; stack.push(ni); }
    }
  }
  return { stones, liberties: libSet.size, libSet };
}

/** 复用缓冲，避免热路径反复分配 */
let _bufA = new Uint8Array(0);
let _bufB = new Uint8Array(0);
function ensureBuf(n: number): void {
  if (_bufA.length < n) { _bufA = new Uint8Array(n); _bufB = new Uint8Array(n); }
}

// ───────────────────────── Benson Pass-Alive ─────────────────────────

/**
 * Benson 算法识别「绝对活棋」（两眼及以上，永不被强提）。
 * 迭代到不动点：空点 p 的所有界内正交邻点都所属 pass-alive 块 → p 是绝对眼；
 * 某块拥有 ≥2 个绝对眼 → 该块 pass-alive。
 *
 * @param aliveOut 长度 size²；块内任意子下标处为 1 表示该块 pass-alive
 * @returns pass-alive 块数
 */
export function bensonPassAlive(
  b: BoardLike, size: number, color: number, aliveOut: Uint8Array,
): number {
  const n = size * size;
  ensureBuf(n);
  aliveOut.fill(0, 0, n);

  const kind = new Int8Array(n);       // 0=空 1=本色 -1=异色
  for (let i = 0; i < n; i++) {
    const c = b[i];
    kind[i] = c === 0 ? 0 : c === color ? 1 : -1;
  }

  // 收集块首
  const seen = new Uint8Array(n);
  const starts: number[] = [];
  for (let i = 0; i < n; i++) {
    if (kind[i] !== 1 || seen[i]) continue;
    for (const s of groupOf(b, size, i, color).stones) seen[s] = 1;
    starts.push(i);
  }

  const groupOk = new Uint8Array(n);
  const isPoint = _bufA;                // pass-alive point 标记
  const counts = _bufB;

  for (let iter = 0; iter < 8; iter++) {
    isPoint.fill(0, 0, n);
    let pointCount = 0;
    for (let i = 0; i < n; i++) {
      if (kind[i] !== 0) continue;
      const x = i % size;
      const y = (i / size) | 0;
      let ok = true;
      let nbCount = 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;  // 界外视为墙
        const ni = ny * size + nx;
        nbCount++;
        if (kind[ni] !== 1 || !groupOk[ni]) { ok = false; break; }
      }
      if (ok && nbCount > 0) { isPoint[i] = 1; pointCount++; }
    }
    if (pointCount === 0) break;

    counts.fill(0, 0, n);
    for (let i = 0; i < n; i++) {
      if (isPoint[i] !== 1) continue;
      const x = i % size;
      const y = (i / size) | 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        if (kind[ni] !== 1) continue;
        counts[ni]++;
        break;
      }
    }
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (counts[i] >= 2 && !groupOk[i]) { groupOk[i] = 1; changed = true; }
    }
    if (!changed) break;
  }

  let aliveCount = 0;
  for (const gs of starts) {
    if (!groupOk[gs]) continue;
    aliveCount++;
    for (const s of groupOf(b, size, gs, color).stones) aliveOut[s] = 1;
  }
  return aliveCount;
}

// ───────────────────────── 眼位空间（修正版） ─────────────────────────

/**
 * 该块**真正能围成眼**的空区大小。
 *
 * 🔴 修正第一版的错误：不能从「块的空邻点」直接 flood —— 那样会把
 * 「被对方棋子围住、自己根本围不到」的空点全算进来（实测死块算出 16）。
 *
 * 正确做法：只统计「本块在 2 格内直接相邻的空点」及其**只经过本块势力范围**的连通空区；
 * 一旦某空点在 3 格内被对方棋子密集包围（对方能先手抢占），就不再往外扩。
 *
 * @param upTo 计数上限（早停）
 */
export function eyeSpaceOf(
  b: BoardLike, size: number, groupStartIdx: number, color: number, upTo = 12,
): number {
  const opp = 3 - color;
  const g = groupOf(b, size, groupStartIdx, color);
  ensureBuf(size * size);
  const vis = _bufA;

  // 只从「本块 2 格内的空点」出发，且要求该空点周围 8 邻不被对方显著占据
  const seeds: number[] = [];
  for (const s of g.stones) {
    const sx = s % size;
    const sy = (s / size) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d === 0 || d > 2) continue;
        const nx = sx + dx;
        const ny = sy + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        if (b[ni] !== 0) continue;
        // 该空点的 8 邻里，对方棋子 ≤1 个才算「本块能围住」
        let oppCnt = 0;
        for (const [ex, ey] of NB8) {
          const ax = nx + ex;
          const ay = ny + ey;
          if (ax < 0 || ay < 0 || ax >= size || ay >= size) continue;
          if (b[ay * size + ax] === opp) oppCnt++;
        }
        if (oppCnt <= 1) seeds.push(ni);
      }
    }
  }
  if (seeds.length === 0) return 0;

  // 只统计 seeds 本身的连通片（不跨过「对方占 ≥2 邻」的空点继续扩）
  vis.fill(0, 0, size * size);
  const queue: number[] = [];
  for (const sd of seeds) {
    if (vis[sd]) continue;
    vis[sd] = 1;
    queue.push(sd);
  }
  let count = queue.length;
  let head = 0;
  while (head < queue.length && count < upTo) {
    const cur = queue[head++];
    const x = cur % size;
    const y = (cur / size) | 0;
    for (const [dx, dy] of NB4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      if (b[ni] !== 0 || vis[ni]) continue;
      let oppCnt = 0;
      for (const [ex, ey] of NB8) {
        const ax = nx + ex;
        const ay = ny + ey;
        if (ax < 0 || ay < 0 || ax >= size || ay >= size) continue;
        if (b[ay * size + ax] === opp) oppCnt++;
      }
      if (oppCnt >= 2) continue;              // 对方占 ≥2 邻 → 这里围不成眼
      vis[ni] = 1;
      queue.push(ni);
      count++;
    }
  }
  return count;
}

// ───────────────────────── 征子逃气 ─────────────────────────

/**
 * 被打吃（气=1）时能否逃出。
 *
 * 规则：
 * - 气 >1 → 不需要逃，直接返回当前气数
 * - 落子后该块气必须 ≥2（否则只是多填一格 = 白送）
 * - 逃到一线（边线）判定为逃不出 —— 征子通常在边角终止
 * - 若能通过提子（长气时提掉敌子）获得 ≥2 气，也算逃出
 *
 * @returns ≥2 可止损；0 逃不出
 */
export function ladderEscape(
  b: BoardLike, size: number, groupStartIdx: number, color: number,
): number {
  const opp = 3 - color;
  const g0 = groupOf(b, size, groupStartIdx, color);
  if (g0.liberties > 1) return g0.liberties;

  const sim = new Int8Array(size * size);
  for (let i = 0; i < sim.length; i++) sim[i] = b[i];

  let best = 0;
  for (const lib of g0.libSet) {
    const nx = lib % size;
    const ny = (lib / size) | 0;
    // 排除靠边的一线逃法
    if (Math.min(nx, ny, size - 1 - nx, size - 1 - ny) === 0) continue;

    sim[lib] = color;
    // 长气时可能提掉邻旁气=0 的敌子
    for (const [ex, ey] of NB4) {
      const ax = nx + ex;
      const ay = ny + ey;
      if (ax < 0 || ay < 0 || ax >= size || ay >= size) continue;
      const ai = ay * size + ax;
      if (sim[ai] !== opp) continue;
      const eg = groupOf(sim, size, ai, opp);
      if (eg.liberties === 0) for (const s2 of eg.stones) sim[s2] = 0;
    }
    const after = groupOf(sim, size, lib, color);
    sim[lib] = 0;                                   // 撤销
    if (after.liberties >= 2 && best < 2) best = 2;   // 能逃一步即止损
  }
  return best;
}
