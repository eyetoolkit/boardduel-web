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
