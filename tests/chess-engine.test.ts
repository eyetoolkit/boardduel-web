/**
 * 国际象棋引擎单元测试 — engine.ts
 *
 * 覆盖：初始局面合法性、王车易位、以及 2026-10-23 P0（兵攻击方向反转）的回归。
 * P0 症状：attackedSquares 的兵方向与 legalMoves 写反 —— 黑王可走入被兵攻的格、
 * 白兵能直接吃王（将杀检测失效），同时合法着法被幻影兵攻拦截。修复前 selfTest
 * 对此路径零覆盖，所以缺陷带着"自检全绿"上线。
 *
 * 运行：node --experimental-strip-types --test tests/chess-engine.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Side, type Piece, type GameState,
  initialState, legalMoves, inCheck, applyMove, selfTest,
} from '../src/games/chess/engine.ts';

const NO_CASTLE = { K: false, Q: false, k: false, q: false };

/** 由 [sq, piece] 列表构造迷你局面（只放关键子，其余为空） */
function mini(pieces: Array<[number, Piece]>, turn: Side): GameState {
  const b: Piece[] = new Array(64).fill('.');
  for (const [sq, p] of pieces) b[sq] = p;
  return { board: b, turn, castling: { ...NO_CASTLE }, enpassant: null, halfmove: 0, fullmove: 1, history: [] };
}

test('initial position: 20 legal moves, no check, kings on e1/e8', () => {
  const s = initialState();
  assert.equal(legalMoves(s).length, 20);
  assert.equal(inCheck(s), false);
  assert.equal(s.board[4], 'K');
  assert.equal(s.board[60], 'k');
});

test('castling kingside after clearing f1/g1', () => {
  const s = initialState();
  s.board[5] = '.'; s.board[6] = '.';
  assert.ok(legalMoves(s).some((m) => m.castle === 'K'));
});

test('P0 regression: pawn attacks mark the correct squares', () => {
  // 白兵 e5(sq36) 攻 d6(sq43)/f6(sq45) —— 黑王在 d6 必须被将
  const a = mini([[0, 'K'], [36, 'P'], [43, 'k']], 'b');
  assert.equal(inCheck(a, 'b'), true);
});

test('P0 regression: king cannot move into pawn-attacked square', () => {
  // 黑王 g7(sq54)：f6(sq45) 被 e5 兵攻 → 非法；f7(sq53) 合法
  const b = mini([[0, 'K'], [36, 'P'], [54, 'k']], 'b');
  const kingMoves = legalMoves(b).filter((m) => m.from === 54);
  assert.equal(kingMoves.some((m) => m.to === 45), false, 'g7->f6 must be illegal');
  assert.equal(kingMoves.some((m) => m.to === 53), true, 'g7->f7 should be legal');
});

test('P0 regression: no phantom pawn attacks block legal moves', () => {
  // 白兵 e4(sq28) 只攻 d5(sq35)/f5(sq37)：黑王 g4(sq30)→f3(sq21) 合法，→f5 非法
  const c = mini([[0, 'K'], [28, 'P'], [30, 'k']], 'b');
  const moves = legalMoves(c);
  assert.equal(moves.some((m) => m.from === 30 && m.to === 21), true, 'g4->f3 should be legal');
  assert.equal(moves.some((m) => m.from === 30 && m.to === 37), false, 'g4->f5 must be illegal');
});

test('P0 regression: king is never capturable by a pawn', () => {
  // 修复前最重症状：黑王可走入 f6，随后白兵 exf6 吃王。现在 f6 根本不可落入，
  // 且任何着法都不该以对方王为 capture 目标。
  const b = mini([[0, 'K'], [36, 'P'], [54, 'k']], 'b');
  for (const m of legalMoves(b)) {
    assert.notEqual(m.to, 45, 'no black king move into f6');
  }
  const s2 = mini([[0, 'K'], [36, 'P'], [54, 'k']], 'w');
  for (const m of legalMoves(s2)) {
    assert.notEqual(m.capture, 'k', 'white must not be able to capture the black king');
  }
  // 黑王真的走到 f6（构造非法局面）后，白方也不能"吃王"——applyMove 前先确认无此着法
  const bKingOnF6 = mini([[0, 'K'], [36, 'P'], [45, 'k']], 'w');
  const caps = legalMoves(bKingOnF6).filter((m) => m.capture === 'k');
  assert.equal(caps.length, 0, 'no legal move may capture a king');
  void applyMove; // 保持 import 被使用（引擎导出面稳定）
});

test('selfTest passes (includes pawn-attack regression)', () => {
  const r = selfTest();
  assert.equal(r.ok, true, r.details.join('; '));
});

/* ============================================================
 * 2026-10-24 P0 回归：attackedSquares 的 addRay 曾把「撞子」写成 return，
 * 直接退出整个 addRay —— 滑子在一个方向被挡后，剩余方向全部不辐射。
 * 后果①：傻瓜将杀（1.f3 e5 2.g4 Qh4#）后白 g4-g5 被判为解将，将杀永不成立；
 * 后果②：被挡的后/车/象漏标其他方向的攻击格，王可走入真实被攻格。
 * 下面三条分别钉住：将杀成立、滑子多方向辐射、漏攻会导致王走入被攻格。
 * ============================================================ */

test('傻瓜将杀：1.f3 e5 2.g4 Qh4# —— 白方零合法着法', () => {
  const s = initialState();
  const idx = (x: string) => ('abcdefgh'.indexOf(x[0])) + (Number(x[1]) - 1) * 8;
  for (const c of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) {
    const from = idx(c.slice(0, 2)), to = idx(c.slice(2, 4));
    const m = legalMoves(s).find((x) => x.from === from && x.to === to);
    assert.ok(m, `legal: ${c}`);
    applyMove(s, m!);
  }
  assert.equal(inCheck(s, 'w'), true, 'white is in check');
  assert.equal(legalMoves(s).length, 0, 'checkmate: no legal move (notably g4-g5 must not be legal)');
});

test('滑子被挡后其余方向仍要辐射（addRay 多方向）', () => {
  // 黑后 d1(3)：射线顺序 [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]。
  // 白兵 c2(10) 挡住第 3 个方向（左上斜线）——bug 版在此 return 掉整个 addRay，
  // 第 6 个方向（沿 1 rank 向左到 c1/b1/a1）永远跑不到，白王 a1 就被判"没被将"。
  const s = mini([[3, 'q'], [10, 'P'], [0, 'K'], [60, 'k']], 'w');
  assert.equal(inCheck(s, 'w'), true, 'Qd1 still checks Ka1 along rank 1 despite the c2 blocker');
  // 反向钉：拿掉挡子后结论不变（防"改坏了正常路径"）
  const s2 = mini([[3, 'q'], [0, 'K'], [60, 'k']], 'w');
  assert.equal(inCheck(s2, 'w'), true);
});

test('射线止于挡子：d 线被兵堵住后 d8 不再被攻击', () => {
  // 同一修复的另一半——不能"多方向辐射"修过头变成穿透。
  // 黑王放 a8(56) 而非 e8——否则 e8 与 d8 相邻，王的邻接攻击会污染判定
  const s = mini([[3, 'q'], [27, 'P'], [59, 'K'], [56, 'k']], 'w');
  assert.equal(inCheck(s, 'w'), false, 'P@d4 blocks the d-file: d8 is not attacked');
  // 挡子拿掉后 d8 重新被辐射（确认不是"干脆不辐射了"）
  const s2 = mini([[3, 'q'], [59, 'K'], [56, 'k']], 'w');
  assert.equal(inCheck(s2, 'w'), true);
});

test('漏攻回归：被挡滑子仍阻止王走入其真实攻击格', () => {
  // 黑后 h4(31)：向左上（-1,+1）在 e7(52) 撞黑兵挡住；向下左（-1,-1）仍须攻击 e1(4)。
  const s = mini([[31, 'q'], [52, 'p'], [4, 'K'], [60, 'k']], 'w');
  assert.equal(inCheck(s, 'w'), true, 'Qh4 still checks Ke1 even though the up-left ray is blocked');
});
