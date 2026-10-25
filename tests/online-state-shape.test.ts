/**
 * 联机 state 帧双形状回归（2026-10-25 P1 修复）
 *
 * 背景：worker（games-room.js）下发 state 帧有两种形状——
 *   · broadcastState():        {type:'state', state:{board,turn,...}}   （嵌套，每步广播）
 *   · joinState（每次连接首帧，含重连 rejoin）:
 *                             {type:'state', you, code, ...snapshot()} （board/turn 在顶层）
 *
 * reversi/connect4 的 applyServerBoard 曾手写判断只认嵌套形状，重连首帧的
 * 权威盘被静默丢弃：会话内重连 → 棋盘停在断线前旧局直到任意一方下一手；
 * 刷新重进 → onConnect 的 newGame() 重置成初始盘，首帧又被丢，玩家对着
 * 空盘看对手下棋（v6 全量实测复现：A 端漏一帧广播后 6 子 stale 到认输）。
 *
 * 本测试锁两件事：
 *   ① 真实导出 stateBody（online-core.ts）对两种形状都解出内层——修复依赖它；
 *   ② 「judgment 采纳」守卫建模（board 长度 + turn 数字）对两种形状都放行，
 *      同时仍挡下无 board 的等待帧。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { stateBody } from '../src/games/online-core.ts';

test('stateBody: 解出嵌套 broadcast 帧的内层', () => {
  const inner = { board: [null, 0, 1], turn: 1, status: 'playing' };
  const msg = { type: 'state', state: inner };
  assert.equal(stateBody(msg), inner);
});

test('stateBody: 顶层 joinState 帧（重连首帧）返回 msg 本身，board/turn 不丢', () => {
  const msg = {
    type: 'state', you: 0, code: 'ABC234', game: 'reversi',
    roomStatus: 'playing', board: [null, 0, 1], turn: 0, status: 'playing',
  };
  const body = stateBody(msg);
  assert.equal(body, msg, '顶层帧必须原样返回（inner ?? msg）');
  assert.ok(Array.isArray(body.board) && body.board.length === 3, '顶层 board 必须可读');
  assert.equal(typeof body.turn, 'number', '顶层 turn 必须可读');
});

test('stateBody: 无 board 的等待帧（game 未初始化）也能安全解出', () => {
  const msg = { type: 'state', you: 1, code: 'XYZ999', roomStatus: 'waiting' };
  const body = stateBody(msg);
  assert.equal(body, msg);
  assert.equal(Array.isArray(body.board), false, '无 board 帧由各游戏 applyServerBoard 的长度守卫挡下');
});

test('judgment 采纳守卫建模：两种形状的权威盘都必须被采纳（P1 回归）', () => {
  // 复刻修复后 reversi/connect4 applyServerBoard 的头部守卫：
  //   const inner = stateBody(m);
  //   if (!Array.isArray(inner.board) || inner.board.length !== 64) return;
  //   if (typeof inner.turn !== 'number') return;
  const accept = (m: Record<string, unknown>) => {
    const inner = stateBody(m);
    return Array.isArray(inner.board) && inner.board.length === 64 && typeof inner.turn === 'number';
  };
  const board = new Array(64).fill(null);
  // broadcast 形状（嵌套）
  assert.equal(accept({ type: 'state', state: { board, turn: 1, status: 'playing' } }), true);
  // joinState 形状（顶层，重连首帧）——修复前被静默丢弃的就是这一支
  assert.equal(accept({
    type: 'state', you: 0, code: 'ABC234', game: 'reversi',
    roomStatus: 'playing', board, turn: 0, status: 'playing',
  }), true, '重连首帧（顶层 board）必须被采纳');
  // 等待帧（无 board）仍被挡下
  assert.equal(accept({ type: 'state', you: 0, code: 'ABC234', roomStatus: 'waiting' }), false);
});
