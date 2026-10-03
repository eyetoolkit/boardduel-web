/**
 * 围棋 · 增量式落子内核（make / unmake）—— 专供搜索高频调用
 *
 * ═══ 为什么不用 engine.computePlay（2026-10-03 W6 实测）═══
 * computePlay 每次落子都 `board.slice()` + `makeState(...)` 造新对象，
 * 而 legalMoves 要对全盘每点各调一次。实测 9 路：legalMoves 0.085ms、
 * evaluate 0.03ms，但「生成一次候选」= 81×(slice+evaluate) ≈ 9ms，
 * 深度 4 的树有几千节点 → **单手 7s+，UI 直接卡死**。
 *
 * 本模块用可逆操作消除分配：
 *   make(pos, i, log) → 只改受影响的格子，落子与提子都记进 undo 日志
 *   unmake(pos, log)  → 严格逆序回滚
 * 落子规则与 engine.computePlay 一致：提子、自杀非法、简单劫。
 */

/** undo 日志：交替的 [下标, 旧值]；下标为负数时表示保存 PosState 的标量字段 */
export type UndoLog = number[];

/** 日志头部长度：SAVE_KO / SAVE_TOPLAY / SAVE_CAP / SAVE_START 各占 2 项 */
const HEADER = 8;
const SAVE_KO = -1;        // [SAVE_KO, oldKo]
const SAVE_TOPLAY = -2;    // [SAVE_TOPLAY, oldToPlay]
const SAVE_CAP = -3;       // [SAVE_CAP, oldCapturedNet]
const SAVE_LASTCAP = -4;   // [SAVE_LASTCAP, oldCaptured]

/** 搜索内部局面：可原地推进/回滚 */
export interface PosState {
  board: Int8Array;
  size: number;
  toPlay: 1 | 2;
  /** 劫禁点：下一手不可落（等价 GoState.ko 且 koFor===toPlay） */
  ko: number;
  /** 本手提掉的敌子数（评估用；unmake 时还原） */
  captured: number;
  /**
   * 提子累计（黑方视角的净值 = 黑提的子数 - 白提的子数）。
   *
   * 🔴 为什么必须是净值而不是绝对值：evaluate 恒以「黑方净胜」为标量，
   * capture 项是 `captured * w.capture` 的加项。若黑提 1 子记 +1、白提 1 子也记 +1，
   * 绝对值会把**对手的战果**也算成自己的收益，评估彻底反了。
   *
   * 搜索递归时每次 make/unmake 都会覆盖 captured，所以需要这个跨层累加器；
   * 它同样进 undo 日志，回滚时精确还原。
   */
  capturedNet: number;
}

export function createPos(board: ArrayLike<number>, size: number, toPlay: 1 | 2): PosState {
  const b = new Int8Array(size * size);
  for (let i = 0; i < b.length; i++) b[i] = board[i] as number;
  return { board: b, size, toPlay, ko: -1, captured: 0, capturedNet: 0 };
}

export function clonePos(p: PosState): PosState {
  return { board: Int8Array.from(p.board), size: p.size, toPlay: p.toPlay, ko: p.ko, captured: p.captured, capturedNet: p.capturedNet };
}

// ───────────────────────── flood fill（无分配） ─────────────────────────

let _mark = new Int32Array(0);
let _stamp = 0;
let _stack = new Int32Array(0);
function ensure(n: number): void {
  if (_mark.length < n) {
    const c = Math.max(n, 1024);
    _mark = new Int32Array(c);
    _stack = new Int32Array(c);
  }
}

const _buf = new Int32Array(2048);

/**
 * 从 start 收集同色连通块：石子下标写入 out，返回 {stones, libs}。
 * 气的去重用模块级 _mark（每块用独立 stamp，故不会互相污染）。
 */
export function collectInto(board: Int8Array, size: number, start: number, color: number, out: Int32Array): { stones: number; libs: number } {
  ensure(board.length);
  const stamp = ++_stamp;
  let sp = 0;
  _stack[sp++] = start;
  _mark[start] = stamp;
  let n = 0;
  let libs = 0;
  while (sp > 0) {
    const cur = _stack[--sp];
    out[n++] = cur;
    const x = cur % size;
    const y = (cur / size) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      const v = board[ni];
      if (v === 0) {
        if (_mark[ni] !== stamp) { _mark[ni] = stamp; libs++; }
      } else if (v === color && _mark[ni] !== stamp) {
        _mark[ni] = stamp;
        _stack[sp++] = ni;
      }
    }
  }
  return { stones: n, libs };
}

// ───────────────────────── 合法性与落子 ─────────────────────────

/** 该点是否可落（排除占用 / 劫 / 自杀） */
export function isLegal(pos: PosState, i: number): boolean {
  const { board, size, toPlay } = pos;
  if (i < 0 || i >= board.length || board[i] !== 0) return false;
  if (i === pos.ko) return false;
  const opp = (3 - toPlay) as 1 | 2;
  const x = i % size;
  const y = (i / size) | 0;
  for (let k = 0; k < 4; k++) {
    const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
    const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    const ni = ny * size + nx;
    const v = board[ni];
    if (v === 0) return true;                       // 有空邻 → 合法
    if (v === opp && collectInto(board, size, ni, opp, _buf).libs === 1) return true; // 提子
  }
  return false;
}

/**
 * 落子到 i（调用前须 isLegal 为真），结果写入 undo 日志。
 * 返回提子数；返回 -2 表示自杀（已自动回滚，调用方应跳过该手）。
 *
 * 日志布局（本层）：
 *   [mark+0, mark+1] SAVE_KO    旧 ko
 *   [mark+2, mark+3] SAVE_TOPLAY 旧 toPlay
 *   [mark+4, mark+5] SAVE_CAP   旧 captured
 *   [mark+6 ...  ] 棋盘变更 [下标, 旧值] 成对
 * `mark` 必须原样传给配对的 unmake —— 嵌套时日志是共享栈，靠 mark 定位本层区间。
 */
export function make(pos: PosState, i: number, log: UndoLog, mark: number): number {
  const { board, size } = pos;
  const color = pos.toPlay;
  const opp = (3 - color) as 1 | 2;
  log.push(
    SAVE_KO, pos.ko,
    SAVE_TOPLAY, pos.toPlay,
    SAVE_CAP, pos.capturedNet,
    SAVE_LASTCAP, pos.captured,
  );

  let captured = 0;
  const x = i % size;
  const y = (i / size) | 0;
  for (let k = 0; k < 4; k++) {
    const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
    const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    const ni = ny * size + nx;
    if (board[ni] !== opp) continue;
    const g = collectInto(board, size, ni, opp, _buf);
    if (g.libs === 0) {
      for (let s = 0; s < g.stones; s++) {
        const p = _buf[s];
        log.push(p, board[p]);
        board[p] = 0;
        captured++;
      }
    }
  }

  log.push(i, board[i]);
  board[i] = color as number;

  const my = collectInto(board, size, i, color, _buf);
  if (my.libs === 0) {
    unmake(pos, log, mark);
    return -2;                       // 自杀（理论上 isLegal 已排除，做防御）
  }

  // 简单劫：提 1 子 + 我方落子后单子单气 → 劫禁点为被提点
  let newKo = -1;
  if (captured === 1 && my.stones === 1 && my.libs === 1) {
    const s0 = _buf[0];
    const sx = s0 % size;
    const sy = (s0 / size) | 0;
    let only = -1;
    let cnt = 0;
    for (let k = 0; k < 4; k++) {
      const nx = sx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = sy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (board[ny * size + nx] === 0) { only = ny * size + nx; cnt++; }
    }
    if (cnt === 1) newKo = only;
  }

  pos.ko = newKo;
  pos.toPlay = opp;
  pos.captured = captured;
  // 黑提白 → 净值 +captured；白提黑 → 净值 -captured
  pos.capturedNet += color === 1 ? captured : -captured;
  return captured;
}

/**
 * 回滚到 mark（mark = 配对 make 之前传入的 log.length）。
 *
 * 🔴 嵌套调用铁律（本模块最隐蔽的 bug）：日志是**共享栈**。若回滚区间不按
 * mark 定位，内层 unmake 会连带撤销外层尚未回滚的记录。实测症状：
 * 跑完一次候选枚举后「整盘棋子残留、toPlay 未还原」，于是根层每个候选的
 * 评分都基于被污染的棋盘 —— 首手从三线退化到 (0,0)（d=1/3）而偶数深度正常。
 *
 * @param mark 配对 make 的 mark 参数；回滚后日志截断到此
 */
export function unmake(pos: PosState, log: UndoLog, mark: number): void {
  const end = log.length;
  if (end < mark + HEADER) { log.length = mark; return; }
  // 标量：本层头部保存的旧值
  pos.ko = log[mark + 1] as number;
  pos.toPlay = log[mark + 3] as 1 | 2;
  pos.capturedNet = log[mark + 5];
  pos.captured = log[mark + 7] as number;
  // 棋盘：只回滚本层记录 [mark+HEADER, end)
  for (let k = end - 2; k >= mark + HEADER; k -= 2) {
    pos.board[log[k]] = log[k + 1] as number;
  }
  log.length = mark;
}
