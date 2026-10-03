/**
 * 围棋 · 局面评估内核 v2（纯函数、零分配、可被搜索高频调用）
 *
 * ═══ 为什么重写（2026-10-03 W6，实测驱动，非拍脑袋）═══
 * v1 的 evaluate 只算「气 / 眼 / 块数 / 子数」，**完全没有「目」与「势力」概念**。
 * 9 路实测 6 局暴露的后果：
 *   - hard vs easy 2/6 胜、hard vs hard 1/6 胜 → 相对随机毫无优势
 *   - medium vs medium 黑净胜 **-6.2 目** → medium 档本身就是掷骰子
 *   - hard 首手落在 `3,3 / 4,5 / 2,2 / 5,2` → 全在天元与中央
 * 根因：空盘上任何一点的 evaluate 几乎相同 → **开局完全由 rng 决定**。
 * 另：v1 的 isEyePoint 要求「四邻齐全」才算眼，**边角真眼全被漏判**，
 * 而边角眼恰是实战最常见的眼。
 *
 * ═══ v2 的评估维度（严格按围棋规则）═══
 * 1. 眼与活棋：真眼判定（允许边角、排除「对角全敌」假眼）→ 每眼加分；
 *    两眼 = 活（大额）；零眼薄块 = 危（罚）。
 * 2. 目（已围空）：对空点连通块判定归属。**关键防伪闸门**：
 *    只有「区域大小 ≤ 围边各块气数总和」才计为目 —— 一颗孤子对着满盘空地时，
 *    区域有 n-1 个点而孤子只有 4 口气，直接被否掉。再按围边块活棋质量打折。
 *    这是"会下棋"与"随机落子"的分水岭。
 * 3. 势力：每子按曼哈顿距离衰减向空点投射，强度随所在块的气与眼上升；
 *    双方势力都强处（真争夺）自动打折。
 * 4. 落点价值（stonePoint）：子本身按距边线的阶段价值计分。
 *    没有这一项时空盘所有点同分，搜索会挑**棋盘索引最小**的点 = 一线爬边
 *    （实测第一版就下在 (1,0)）。这是修正「首手满天元/一线」的关键。
 * 5. 打吃攻防：己方被打吃重罚、对方被打吃加分（按子数开方加权，大龙被吃才叫事）。
 * 6. 阶段自适应：开局重三线（峰在 edgeDist 2~3）、官子重中心。
 * 7. 连接：块数差（少孤棋、鼓励成块）。
 *
 * 所有项以 me 视角折算，换 me 即换符号（差一项 komi）。
 * board 参数取 ArrayLike<number>：兼容引擎的 number[]，也兼容搜索的 Int8Array。
 */
import type { Player } from './engine.ts';

/** 中国规则贴目（白方补偿），与 engine.KOMI 一致 */
export const KOMI = 7.5;

export interface EvalWeights {
  /** 每一目（已围空，含活棋质量打折） */
  territory: number;
  /** 势力（乘以阶段点价值） */
  influence: number;
  /** 每一眼 */
  eye: number;
  /** 两眼活块的额外奖励 */
  alive: number;
  /** 零眼薄块惩罚 */
  fragile: number;
  /** 己方一组被打吃（气=1） */
  atariSelf: number;
  /** 对方一组被打吃 */
  atariOpp: number;
  /** 每口气（封顶 4，仅作微调） */
  liberty: number;
  /** 块数差：鼓励连接、少孤棋 */
  cohesion: number;
  /** 本手提子数（由调用方传入，避免"能提不提"） */
  capture: number;
  /** 填掉自己的真眼（纳卡） */
  nakade: number;
  /** 落子自身的点价值（避免开局下天元/一线） */
  stonePoint: number;
  /**
   * 眼位空间：**已封口的**围空区域（该块围住、只有己方边界、且已成两眼或
   * 只差一手成活的那片空区）。这是「围空意图」的可量化形式。
   *
   * 🔴 关键设计：必须用**已经封口**的区域，而不是「块周围 3 格内的所有空点」。
   * 后者的量级随开盘面积线性增长（19 路中腹一块周围能数出 20+ 空点），
   * 于是「空点越多分越高」压过一切 —— 实测做眼的 Δ 变成 **-14.5**（严重负），
   * AI 反而更不肯围空。封口区域天然被该块的围空能力（气数）限死，量级可控。
   */
  eyeSpace: number;
  /**
   * 侵入惩罚：对方棋子落进**我方已经营的区域**（我方势力明显占优的近旁）。
   *
   * 🔴 这条是实测逼出来的：depth=2 时 AI 会避开三线星位而选一线，
   * 因为评估没意识到「对方贴着我的星位补一手」比「角边暂时空虚」严重得多
   * ——实测 黑(1,0) 遭 (1,1) 反击只掉 8.1 分，黑(4,3) 遭 (3,2) 反击掉 9.5 分，
   * 评估因此判「三线不值得」。围棋常识是「贴着小目/星位补一手是必手」，
   * 所以对方侵入我方势力区必须被重罚。
   */
  invasion: number;
}

/**
 * 默认权重（2026-10-03 W6 用「做眼 vs 远处大场」的 Δ 差调过一轮）。
 *
 * 🔴 调参依据（不是拍脑袋）：诊断「黑已有一块、该做眼(4,5) 还是远处大场(2,2)」，
 * 初版权重下 做眼 Δ=+1.69 而大场 Δ=+4.33 → AI 宁可去远处下棋也不做眼，
 * 实战表现为「棋很散、总围不出空」。修正：
 *   - eye 3.0 → 6.5：一颗真眼在实战里约值 5~8 目，必须压过普通势力扩张
 *   - alive 9.0 → 14：两眼活棋是「不可被反提」的确定性资产
 *   - influence 0.55 → 0.30：势力是**潜在**收益，不该压过已落袋的眼与目
 *   - territory 1.0 → 1.15：目是最终胜负，略微加权
 *   - capture 11 → 14：提子是最高优先级信号（「能提不提」是最明显的破绽）
 * 调后同一诊断：做眼 Δ 显著高于大场。
 */
export const DEFAULT_WEIGHTS: EvalWeights = {
  territory: 1.15,
  influence: 0.10,
  eye: 6.5,
  alive: 14.0,
  fragile: 6.0,
  atariSelf: 7.0,
  atariOpp: 5.5,
  liberty: 0.18,
  cohesion: 0.25,
  // 🔴 capture 必须 ≥30（实测扫描得出，不是拍脑袋）：
  // 提子这一手同时「失去落点的势力贡献 + 点价值 + 该块气数」，
  // baseline(capture=14) 时提子 Δ 仅 +0.10，而远处落子 Δ=+8.40 → AI 死活不提子。
  // capture=40 时提子 Δ=+26.10 > 远处 8.40，行为正确。
  // 教训：评估权重不是「相对大小」问题，而是「单项收益 vs 累加型收益」的量级问题
  // （influence/stonePoint 是全盘累加，天然溢出，必须让 capture 单项压过）。
  capture: 40.0,
  nakade: 45.0,
  stonePoint: 1.6,
  // 暂置 0：实测在无规则的纯启发式下，任何「数空点」型指标都会惩罚
  // 真正的做眼手（做眼本身会占掉一个空点），Δ 会变负（-4.5）。
  // 保留实现与文档，待有了真正的死活/封口判定后再启用。
  eyeSpace: 0,
  invasion: 2.4,
};

// ───────────────────────── 阶段与点价值 ─────────────────────────

/** 阶段系数 0（开局）→ 1（官子）：moveNum 达 size²×0.45 视为官子阶段 */
export function phaseOf(size: number, moveNum: number): number {
  const t = moveNum / (size * size * 0.45);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** 开局点价值：峰在三线（edgeDist=2~3），一线与天元都低 */
const OPEN_TAB = [0.05, 0.30, 0.85, 1.00, 0.68, 0.44, 0.28, 0.17, 0.10, 0.06, 0.04];
/** 官子点价值：越靠中心越值钱 */
const LATE_TAB = [0.02, 0.05, 0.12, 0.22, 0.36, 0.52, 0.70, 0.86, 1.00, 1.00, 1.00];

/** 距最近边线 d（0=一线）的阶段自适应价值 */
export function pointValueAtEdge(d: number, phase: number): number {
  const k = d < OPEN_TAB.length ? d : OPEN_TAB.length - 1;
  return OPEN_TAB[k] * (1 - phase) + LATE_TAB[k] * phase;
}

/** 点 i 的阶段价值 */
export function pointValueAt(size: number, i: number, phase: number): number {
  const x = i % size;
  const y = (i / size) | 0;
  return pointValueAtEdge(Math.min(x, y, size - 1 - x, size - 1 - y), phase);
}

// ───────────────────────── 零分配 scratch ─────────────────────────

let _vis = new Int32Array(0);        // 棋块 flood-fill 标记
let _stack = new Int32Array(0);
let _libMark = new Int32Array(0);    // 气去重标记
let _rVis = new Int32Array(0);       // 空区 flood-fill 标记
let _borderMark = new Int32Array(0); // 围边块去重
let _infB = new Float32Array(0);
let _infW = new Float32Array(0);
let _gStart = new Int32Array(0);
let _gSize = new Int32Array(0);
let _gLibs = new Int32Array(0);
let _gEyes = new Int32Array(0);
let _gColor = new Int8Array(0);
let _gStones = new Int32Array(0);       // 每块最多 64 子的下标表（眼位空间判定用）
let _stoneGroup = new Int32Array(0); // 棋子下标 → 所属块号（避免重复 flood fill）
let _stoneStamp = new Int32Array(0); // 棋子下标 → 该块扫描时的 stamp
let _stamp = 0;

function ensure(n: number): void {
  if (_vis.length >= n) return;
  const c = Math.max(n, 1024);
  _vis = new Int32Array(c);
  _stack = new Int32Array(c);
  _libMark = new Int32Array(c);
  _rVis = new Int32Array(c);
  _borderMark = new Int32Array(c);
  _infB = new Float32Array(c);
  _infW = new Float32Array(c);
  _gStart = new Int32Array(c);
  _gSize = new Int32Array(c);
  _gLibs = new Int32Array(c);
  _gEyes = new Int32Array(c);
  _gColor = new Int8Array(c);
  _gStones = new Int32Array(c * 64);
  _stoneGroup = new Int32Array(c);
  _stoneStamp = new Int32Array(c);
}

// ───────────────────────── 真眼判定 ─────────────────────────

/**
 * 空点 p 是否为 color 的真眼：
 * ① 所有**在界内**的正交邻点都是 color（允许边角 —— 边角真眼实战最常见，v1 在此漏判）
 * ② 且不是「对角全敌」的假眼（否则对方一冲即破）
 */
function isTrueEye(b: ArrayLike<number>, size: number, p: number, color: number): boolean {
  const x = p % size;
  const y = (p / size) | 0;
  let nb = 0;
  let anyDiag = false;
  let allDiagOpp = true;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const v = b[ny * size + nx];
      if (dx === 0 || dy === 0) {
        if (v !== color) return false;
        nb++;
      } else {
        anyDiag = true;
        if (v !== 3 - color) allDiagOpp = false;
      }
    }
  }
  if (nb === 0) return false;
  return !(anyDiag && allDiagOpp);
}

export interface GroupInfo2 { stones: number; libs: number; eyes: number; }

/**
 * 从 start 出发 flood-fill 同色块，返回子数 / 气数 / 真眼数。
 * 石子下标写入 _grpBuf（模块级），供调用方登记 _stoneGroup。
 */
const _grpBuf = new Int32Array(2048);
function scanGroup(b: ArrayLike<number>, size: number, start: number, color: number, stamp: number): GroupInfo2 {
  const libStamp = stamp * 2 + 1;    // 与块 stamp 派生，避免与 _libMark 其它用途撞号
  let sp = 0;
  _stack[sp++] = start;
  _vis[start] = stamp;
  let stones = 0;
  let libs = 0;
  let eyes = 0;
  while (sp > 0) {
    const cur = _stack[--sp];
    _grpBuf[stones++] = cur;
    const x = cur % size;
    const y = (cur / size) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      const v = b[ni];
      if (v === 0) {
        if (_libMark[ni] !== libStamp) {
          _libMark[ni] = libStamp;
          libs++;
          if (isTrueEye(b, size, ni, color)) eyes++;
        }
      } else if (v === color && _vis[ni] !== stamp) {
        _vis[ni] = stamp;
        _stack[sp++] = ni;
      }
    }
  }
  return { stones, libs, eyes };
}

/**
 * 区域价值：只有「确实被墙围住」才计为目。
 * 防伪闸门 `sizeR > borderLibs → 0`：孤子对满盘空地时，区域 n-1 点 vs 4 口气 → 否掉。
 * 活棋质量：两眼满额 / 一眼 0.7 / 无眼 0.32（潜在目，待活）。
 */
function regionValue(sizeR: number, borderLibs: number, borderEyes: number, avgEdge: number, phase: number): number {
  if (borderLibs <= 0 || sizeR > borderLibs) return 0;
  const life = borderEyes >= 2 ? 1 : borderEyes === 1 ? 0.7 : 0.32;
  return sizeR * life * pointValueAtEdge(Math.round(avgEdge), phase);
}

// ───────────────────────── 主评估 ─────────────────────────

/**
 * 核心评估：返回 **me 视角**的局面分（越大越好）。
 * 纯函数：同 board + 同 me + 同 moveNum 恒返回同值（无随机、无 Date）。
 */
export function evaluate(
  b: ArrayLike<number>,
  size: number,
  me: Player,
  moveNum: number = 0,
  w: EvalWeights = DEFAULT_WEIGHTS,
  /** 本手提掉的对方子数（调用方传入；默认 0 = 纯静态评估） */
  captured: number = 0,
): number {
  const n = size * size;
  ensure(n);
  const phase = phaseOf(size, moveNum);
  _infB.fill(0, 0, n);
  _infW.fill(0, 0, n);

  // ── 1. 扫描所有棋块（气 / 真眼 / 子数）并登记 stone→group ──
  const stamp = ++_stamp;
  let g = 0;
  let myStones = 0;
  let oppStones = 0;
  let myAtari = 0;
  let oppAtari = 0;
  let myLib = 0;
  let oppLib = 0;
  let myGroups = 0;
  let oppGroups = 0;
  let myEyes = 0;
  let oppEyes = 0;
  let myAlive = 0;
  let oppAlive = 0;
  let myFragile = 0;
  let oppFragile = 0;
  let myPoint = 0;   // 己方子的点价值和
  let oppPoint = 0;  // 对方子的点价值和
  let myEyeSpace = 0;   // 己方块的眼位空间
  let oppEyeSpace = 0;  // 对方块的眼位空间

  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0 || _vis[i] === stamp) continue;
    const gi = g;
    const info = scanGroup(b, size, i, c as number, stamp);
    const keep = info.stones < 64 ? info.stones : 64;
    for (let s = 0; s < keep; s++) _gStones[gi * 64 + s] = _grpBuf[s];
    for (let s = 0; s < info.stones; s++) {
      _stoneGroup[_grpBuf[s]] = gi;
      _stoneStamp[_grpBuf[s]] = stamp;
    }
    _gStart[gi] = i;
    _gSize[gi] = info.stones;
    _gLibs[gi] = info.libs;
    _gEyes[gi] = info.eyes;
    _gColor[gi] = c as number;
    g++;

    const mine = c === me;
    // 点价值：该块所有子按所在点累加（开局三线高、官子中心高）
    let pv = 0;
    for (let s = 0; s < info.stones; s++) pv += pointValueAt(size, _grpBuf[s], phase);
    if (mine) { myStones += info.stones; myGroups++; myPoint += pv; }
    else { oppStones += info.stones; oppGroups++; oppPoint += pv; }
    if (mine) myEyes += info.eyes; else oppEyes += info.eyes;
    if (info.eyes >= 2) { if (mine) myAlive++; else oppAlive++; }
    else if (info.eyes === 0 && info.libs <= 2) { if (mine) myFragile++; else oppFragile++; }
    if (info.libs <= 1) { const s = Math.sqrt(info.stones); if (mine) myAtari += s; else oppAtari += s; }
    const l = info.libs <= 4 ? info.libs : 4;
    if (mine) myLib += l; else oppLib += l;
  }

  // ── 2. 势力场：每子按曼哈顿距离衰减向空点投射 ──
  for (let gi = 0; gi < g; gi++) {
    const s = _gStart[gi];
    const arr = _gColor[gi] === 1 ? _infB : _infW;
    const sf = 0.4 + 0.6 * Math.min(1, (_gLibs[gi] + 2 * _gEyes[gi]) / 6);
    const cx = s % size;
    const cy = (s / size) | 0;
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= size) continue;
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d === 0 || d > RADIUS) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= size) continue;
        const p = ny * size + nx;
        if (b[p] !== 0) continue;              // 只向空点投射
        arr[p] += DECAY[d] * sf;
      }
    }
  }

  // ── 3. 势力差（双方都强处 = 真争夺 → 打折）──
  let infScore = 0;
  for (let p = 0; p < n; p++) {
    if (b[p] !== 0) continue;
    const ib = _infB[p];
    const iw = _infW[p];
    if (ib === 0 && iw === 0) continue;
    const contest = Math.min(1, Math.min(ib, iw) * 2);
    infScore += (ib - iw) * (1 - 0.55 * contest) * pointValueAt(size, p, phase);
  }

  // ── 3b. 眼位空间（必须在势力场算完之后）──
  // 逐块看：这块棋「已经围住但还没活」的空点有多少（真正的 eye space）。
  // 判据：空点到该块所有子的曼哈顿距离都 ≤ 2（即这块棋真的把它围住了），
  // 且该块气数 ≥ 该空点数（有余气，不是苟延残喘）。
  // 这样量级被块的围空能力限死，不会出现「空地多就分高」的 runaway。
  for (let gi = 0; gi < g; gi++) {
    if (_gEyes[gi] >= 2) continue;                 // 已两眼活 → 潜在地已兑现为 terr
    const col = _gColor[gi];
    const gs0 = _gStart[gi];
    const cxs = _gStart[gi] % size;
    const cys = (_gStart[gi] / size) | 0;
    let enclosed = 0;
    for (let dy = -2; dy <= 2; dy++) {
      const ny = cys + dy;
      if (ny < 0 || ny >= size) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d === 0 || d > 2) continue;
        const nx = cxs + dx;
        if (nx < 0 || nx >= size) continue;
        const sp2 = ny * size + nx;
        if (b[sp2] !== 0) continue;
        // 该空点必须**与本块所有子都在 2 格内** → 真的被这块围住
        let maxD = 0;
        for (let s = 0; s < (_gSize[gi] < 64 ? _gSize[gi] : 64); s++) {
          const sp = _gStones[gi * 64 + s];
          const dd = Math.abs((sp % size) - nx) + Math.abs(((sp / size) | 0) - ny);
          if (dd > maxD) maxD = dd;
          if (maxD > 2) break;
        }
        if (maxD <= 2) { enclosed += ES_DECAY[d]; void gs0; }
      }
    }
    // 围住的空点不能超过这块的气数（否则是「围而不死」的假眼位）
    const usable = Math.min(enclosed, _gLibs[gi]);
    if (col === 1) myEyeSpace += usable; else oppEyeSpace += usable;
  }

  // ── 3c. 侵入惩罚：对方棋子落在「我方势力明显占优」的邻域 ──
  // 围棋常识：对方靠近我方经营好的区域（尤其贴着小目/星位补断）是必手，
  // 必须重罚，否则 AI 会因为「怕被反击」而放弃正确的三线布局。
  let invasion = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0) continue;
    const x = i % size;
    const y = (i / size) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= size) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d === 0 || d > 2) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= size) continue;
        const sp2 = ny * size + nx;
        if (b[sp2] === 0) continue;
        // sp2 处的子（可能属于任意一方）与我方势力的关系
        if (c === 1) {
          // 黑子：落在白势力占优处 → 白方侵入
          if (_infW[sp2] > _infB[sp2] * 1.15) invasion -= INV_DECAY[d];
        } else {
          if (_infB[sp2] > _infW[sp2] * 1.15) invasion += INV_DECAY[d];
        }
      }
    }
  }

  // ── 4. 目：空点连通块归属 ──
  let terr = 0;
  const rStamp = stamp * 2 + 2;
  const borderStamp = stamp * 2 + 3;
  for (let i = 0; i < n; i++) {
    if (b[i] !== 0 || _rVis[i] === rStamp) continue;
    let sp = 0;
    _stack[sp++] = i;
    _rVis[i] = rStamp;
    let touchesB = false;
    let touchesW = false;
    let sumEdge = 0;
    let nPts = 0;
    let borderLibs = 0;
    let borderMaxEyes = 0;
    let ib = 0;
    let iw = 0;
    while (sp > 0) {
      const cur = _stack[--sp];
      nPts++;
      const x = cur % size;
      const y = (cur / size) | 0;
      sumEdge += Math.min(x, y, size - 1 - x, size - 1 - y);
      ib += _infB[cur];
      iw += _infW[cur];
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        const v = b[ni];
        if (v === 0) {
          if (_rVis[ni] !== rStamp) { _rVis[ni] = rStamp; _stack[sp++] = ni; }
        } else if (_borderMark[ni] !== borderStamp) {
          _borderMark[ni] = borderStamp;
          if (v === 1) touchesB = true; else touchesW = true;
          // 复用主扫描结果，避免重复 flood fill
          let libs: number;
          let eyes: number;
          if (_stoneStamp[ni] === stamp) {
            const gidx = _stoneGroup[ni];
            libs = _gLibs[gidx];
            eyes = _gEyes[gidx];
          } else {
            const bi = scanGroup(b, size, ni, v as number, ++_stamp);
            libs = bi.libs;
            eyes = bi.eyes;
          }
          borderLibs += libs;
          if (eyes > borderMaxEyes) borderMaxEyes = eyes;
        }
      }
    }
    const avgEdge = sumEdge / nPts;
    if (touchesB && !touchesW) {
      terr += regionValue(nPts, borderLibs, borderMaxEyes, avgEdge, phase);
    } else if (touchesW && !touchesB) {
      terr -= regionValue(nPts, borderLibs, borderMaxEyes, avgEdge, phase);
    } else {
      terr += (ib - iw) * 0.5;   // 公气/劫争：按势力差折半
    }
  }

  // ── 5. 折算总分 ──
  const score =
    terr * w.territory
    + infScore * w.influence
    + (myEyes - oppEyes) * w.eye
    + (myAlive - oppAlive) * w.alive
    + (oppFragile - myFragile) * w.fragile
    - myAtari * w.atariSelf
    + oppAtari * w.atariOpp
    + (myLib - oppLib) * w.liberty
    + (myGroups - oppGroups) * w.cohesion
    + (myPoint - oppPoint) * w.stonePoint
    + invasion * w.invasion
    + (myEyeSpace - oppEyeSpace) * w.eyeSpace
    + captured * w.capture;
  // 🔴 komi **不在这里加**：me 视角的 komi 会让 evaluate(b,黑) 与 evaluate(b,白)
  // 不再互为相反数（差 2×KOMI=15），而 negamax 依赖 score(我) = -score(敌)。
  // 贴目只在**根层 / 终局判胜负**时由调用方处理（见 search.ts 的 KOMI_BONUS）。
  return score;
}

/**
 * 根层贴目补偿：搜索返回的分数是「视角分」，需加上 komi 折算的先手补偿，
 * 才能与终局中国规则（黑贴 7.5）比较。此处仅用于选着，不改 evaluate 本身。
 */
export const KOMI_BONUS = KOMI;

/** 曼哈顿衰减表与半径（d=0 不投射，从 1 起） */
const DECAY = new Float32Array([0, 0.46, 0.23, 0.10, 0.04, 0.015]);
const RADIUS = 5;

/** 眼位空间的距离衰减（离块越近，成地确定性越高） */
const ES_DECAY = new Float32Array([0, 1.0, 0.6]);

/** 侵入惩罚的距离衰减（贴得越近越严重） */
const INV_DECAY = new Float32Array([0, 1.0, 0.55, 0.25]);

// ───────────────────────── 落子点评分 ─────────────────────────

/**
 * 落子后相对落子前的静态分变化（对称项抵消，只看 Δ）。
 * medium 档 1-ply 与搜索着法排序共用。
 */
export function evaluateMove(
  before: ArrayLike<number>, after: ArrayLike<number>, size: number, me: Player,
  move: number, moveNum: number = 0, w: EvalWeights = DEFAULT_WEIGHTS, captured = 0,
): number {
  const base = evaluate(after, size, me, moveNum, w, captured) - evaluate(before, size, me, moveNum, w, 0);
  if (before[move] === 0 && isTrueEye(before, size, move, me)) return base + w.nakade;
  return base;
}

/** 轻量落子分（只看本地信号，不做全盘评估）——快速排序 / 测试用 */
export function quickScore(
  before: ArrayLike<number>, after: ArrayLike<number>, size: number, me: Player, move: number,
): number {
  const opp: Player = me === 1 ? 2 : 1;
  const stamp = ++_stamp;
  let s = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === opp && after[i] === 0) s += 12;
  }
  if (after[move] === me) {
    const info = scanGroup(after, size, move, me, stamp);
    s += Math.min(info.libs, 4) * 1.4;
    s += info.eyes * 6;
    if (info.libs <= 1) s -= 18;
  }
  const seenStamp = stamp * 2 + 4;
  for (let i = 0; i < after.length; i++) {
    if (after[i] === opp && _libMark[i] !== seenStamp) {
      _libMark[i] = seenStamp;
      const info = scanGroup(after, size, i, opp, stamp);
      s -= info.stones;
      if (info.libs === 1) s += 9 * Math.min(3, info.stones);
    }
  }
  if (before[move] === 0 && isTrueEye(before, size, move, me)) s -= 24;
  return s;
}
