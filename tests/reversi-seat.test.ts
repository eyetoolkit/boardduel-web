/**
 * Reversi 座位↔颜色映射回归（2026-10-23 第二批修复）
 *
 * 背景（P1）：服务端 reversi-core seat0=黑(0)且先手（reversi-core.js:17-18），
 * 客户端 1=白/2=黑。原联机实现把 `seat+1` 当颜色用（seat0→1=白），
 * 整局座位-颜色反转：每步权威快照到达棋子 visibly 变色、合法点按错的颜色
 * 计算、HUD "You · White" 是假标签、终局样式/音效按白黑判。
 *
 * 这些断言钉住 engine.seatColor / turnToPlayer / lastPlacedCell 三个真相源。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seatColor, turnToPlayer, lastPlacedCell, emptyBoard, place,
  SIZE2,
  type Board,
} from '../src/games/reversi/engine.ts';

test('seatColor: seat0=黑(2)、seat1=白(1)（服务端 reversi-core 口径）', () => {
  assert.equal(seatColor(0), 2, 'seat0 必须是黑(2)');
  assert.equal(seatColor(1), 1, 'seat1 必须是白(1)');
  // null（未拿到座位）不能默认成 seat0 —— 但 onlineMyTurn 另有 roomLive 闸门拦 null
  assert.equal(seatColor(null), 1);
});

test('turnToPlayer: 服务端 turn=0 是黑先行 → 客户端 2', () => {
  assert.equal(turnToPlayer(0), 2, 'turn=0 应映射为黑(2)');
  assert.equal(turnToPlayer(1), 1, 'turn=1 应映射为白(1)');
  // 曾经的正确性反证：旧实现 turn+1 会把 turn=0 映射成 1(白) → seat0 全程变色
  assert.notEqual(turnToPlayer(0), 0 + 1, 'turn+1 旧口径必须被废弃');
});

test('lastPlacedCell: 只把新落的空→非空格当落点，翻子格不误判', () => {
  const a = emptyBoard();
  const b = emptyBoard();
  // 引擎初始盘：(3,3)=白 (3,4)=黑 (4,3)=黑 (4,4)=白。
  // 白(1)落 (2,4)：向下 (3,4)=黑 → (4,4)=白，应翻 (3,4)
  const r = place(b, 2 * 8 + 4, 1);
  assert.ok(r.flipped.length > 0, '该着法应翻掉至少一子');
  assert.equal(lastPlacedCell(a, b), 2 * 8 + 4, '落点必须是新放的那一格，不是被翻的格');
  // 无变化
  assert.equal(lastPlacedCell(b, b), -1);
  // 多格 diff（重连全量恢复）取最大坐标
  const c = b.slice();
  place(c, 5 * 8 + 2, 2);
  const last = lastPlacedCell(b, c);
  assert.equal(last, 5 * 8 + 2);
});

test('映射闭环：seat0 落黑子 → 服务端 turn 切到 1 → 两端都知该白(seat1)走', () => {
  // 模拟一局：seat0(黑) 先走。服务端 turn 序列 0 → 1 → 0 …
  let serverTurn = 0;
  const board: Board = emptyBoard();
  // seat0 在黑(2)的回合落一子（模拟 doMove 后 turn 切换）
  const moves = [2 * 8 + 3, 5 * 8 + 2, 2 * 8 + 4];
  for (let step = 0; step < moves.length; step++) {
    const seat = serverTurn;
    const color = seatColor(seat);
    place(board, moves[step], color);
    serverTurn = 1 - serverTurn;
    // 客户端视角：权威盘 + turn 到达后的行棋方颜色
    const turnPlayer = turnToPlayer(serverTurn);
    // 行棋方必须正好是对方座位（轮换）
    assert.equal(turnPlayer, seatColor(1 - seat),
      `step ${step}: turn=${serverTurn} 的行棋方应是对方座位颜色`);
    // 且刚落的那子在盘上是落子者座位色
    assert.equal(board[moves[step]], color, `step ${step}: 刚落子必须是落子者颜色`);
  }
  // 三手后盘上 3 + 初始 4 子
  const nonEmpty = board.filter((v) => v !== 0).length;
  assert.equal(nonEmpty, 4 + moves.length);
});

test('初始盘：引擎口径白(1)在 (3,3)(4,4)、黑(2)在 (3,4)(4,3)（与单机/联机同一开局）', () => {
  const b = emptyBoard();
  // 注意：引擎初始盘与常见示意图行号方向相反，(3,3) 是白 —— 以引擎为准
  assert.equal(b[3 * 8 + 3], 1);
  assert.equal(b[3 * 8 + 4], 2);
  assert.equal(b[4 * 8 + 3], 2);
  assert.equal(b[4 * 8 + 4], 1);
  assert.equal(b.filter((v) => v !== 0).length, 4);
  assert.equal(SIZE2, 64);
});
