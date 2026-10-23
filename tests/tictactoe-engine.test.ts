/**
 * 井字棋引擎单元测试 — engine.ts + index.ts 终局分流契约
 *
 * 覆盖：三连判定（横/竖/斜）、和棋（winner===3）、未分胜负（winner===0）、
 * minimax 必挡/必胜，以及 2026-10-23 P0（和棋被渲染成一方获胜）的分流契约复刻。
 *
 * 运行：node --experimental-strip-types --test tests/tictactoe-engine.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Board, type Player,
  emptyBoard, checkWinner, bestMove,
} from '../src/games/tictactoe/engine.ts';

/** 按字符串构造棋盘：'.' 空 / 'X' / 'O' */
function board(rows: string[]): Board {
  const b = emptyBoard();
  rows.join('').split('').forEach((ch, i) => { b[i] = ch === 'X' ? 1 : ch === 'O' ? 2 : 0; });
  return b;
}

test('checkWinner: three in a row on every line type', () => {
  const cases: Array<[string[], Player]> = [
    [['XXX', 'OO.', '...'], 1],                                  // 横
    [['X.O', 'X.O', 'X..'], 1],                                  // 竖
    [['XO.', 'OX.', '..X'], 1],                                  // 斜
    [['XXO', 'XOX', 'O.X'], 2],                                  // 斜（O：2,4,6）
  ];
  for (const [rows, w] of cases) {
    const r = checkWinner(board(rows));
    assert.equal(r.winner, w);
    assert.ok(r.line && r.line.length === 3);
  }
});

test('checkWinner: full board without a line is a draw (winner===3)', () => {
  // 经典和棋棋盘：无任何三连且已满
  const r = checkWinner(board(['XOX', 'XXO', 'OXO']));
  assert.equal(r.winner, 3);
  assert.equal(r.line, null);
});

test('checkWinner: ongoing game returns 0', () => {
  assert.equal(checkWinner(board(['X..', '.O.', '...'])).winner, 0);
  assert.equal(checkWinner(emptyBoard()).winner, 0);
});

test('P0 contract: full-board draw must route to the draw branch, not finish(winner)', () => {
  // 复刻 index.ts afterMove 修复后的终局分流（2026-10-23）：
  //   修复前 `if (winner !== 0) finish(winner)` 把 winner===3 当胜者 → 渲染成一方获胜。
  //   修复后 winner===3 必须先于 winner!==0 被分流到 finishDraw()。
  const b = board(['XOX', 'XXO', 'OXO']);
  const { winner } = checkWinner(b);
  const route = winner === 3 ? 'draw' : winner !== 0 ? 'finish' : 'continue';
  assert.equal(route, 'draw');
});

test('bestMove takes an immediate win and blocks an immediate loss', () => {
  // X 一手成三：第 3 列
  const winBoard = board(['XX.', 'OO.', '...']);
  assert.equal(bestMove(winBoard, 1 as Player, 'hard'), 2);
  // O 一手成三（第 0 行），X 必须挡
  const blockBoard = board(['OO.', 'XX.', '...']);
  assert.equal(bestMove(blockBoard, 1 as Player, 'hard'), 2);
});

test('perfect play from empty board is a draw (minimax sanity)', () => {
  // X 先走任意角/中心，双方完美应对必和；验证引擎不误判必胜
  let b = emptyBoard();
  let turn: Player = 1;
  for (let ply = 0; ply < 9; ply++) {
    const { winner } = checkWinner(b);
    if (winner !== 0) break;
    const m = bestMove(b, turn, 'hard');
    assert.ok(m >= 0, 'engine must return a move while the game is ongoing');
    b[m] = turn;
    turn = turn === 1 ? 2 : 1;
  }
  assert.equal(checkWinner(b).winner, 3, 'perfect play must end in a draw');
});
