/**
 * 国际象棋 PGN / SAN 导出单测（2026-10-24 第四批 ⑰）
 * SAN 是易错区：消歧、易位、升变、吃过路兵、将杀标记逐一验。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPgn, sqName, chessResultFromState } from '../src/games/chess/export.ts';
import { initialState, legalMoves, applyMove, type Move } from '../src/games/chess/engine.ts';

/** 从初始局面按 SAN-ish 简化指令构造着法（'e2e4' / 'g1f3' / 'e7e8q'） */
function playAll(cmds: string[]): Move[] {
  let gs = initialState();
  const out: Move[] = [];
  for (const c of cmds) {
    const from = sqToIdx(c.slice(0, 2));
    const to = sqToIdx(c.slice(2, 4));
    const promo = c.length > 4 ? (c[4].toUpperCase() as Move['promo']) : undefined;
    const legal = legalMoves(gs);
    const m = legal.find((x) => x.from === from && x.to === to && (x.promo ?? undefined) === promo);
    assert.ok(m, `no legal move for ${c} (from=${sqName(from)} to=${sqName(to)})`);
    out.push(m!);
    applyMove(gs, m!);
  }
  return out;
}

function sqToIdx(s: string): number {
  const f = 'abcdefgh'.indexOf(s[0]);
  const r = Number(s[1]) - 1;
  return r * 8 + f;
}

const movetext = (moves: Move[], meta = {}) => {
  const pgn = buildPgn(moves, meta);
  return pgn.split('\n\n')[1].trim();
};

test('基本着法与编号', () => {
  const t = movetext(playAll(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']));
  assert.equal(t, '1. e4 e5 2. Nf3 Nc6 3. Bb5 *');
});

test('同子力消歧：双马都能去 d2 时记 Nbd2', () => {
  // 1.d4 让开 d2 兵，随后 b1 与 f3 两马都能到 d2 → 按起点文件消歧
  const t = movetext(playAll(['d2d4', 'd7d5', 'g1f3', 'g8f6', 'b1d2']));
  assert.equal(t, '1. d4 d5 2. Nf3 Nf6 3. Nbd2 *');
});

test('王车易位 O-O / O-O-O', () => {
  const t = movetext(playAll(['e2e4', 'e7e5', 'g1f3', 'g8f6', 'f1c4', 'f8c5', 'e1g1', 'e8g8']));
  assert.ok(t.includes('4. O-O O-O'), t);
});

test('吃过路兵 exd6（SAN 与普通吃子同形）', () => {
  const t = movetext(playAll(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']));
  assert.ok(t.includes('3. exd6'), t);
});

test('吃子升变记作 cxd8=Q', () => {
  // 1.e4 d5 2.exd5 c6 3.dxc6 a6 4.c7 a5 5.cxd8=Q（c7 兵斜吃 d8 后并升变）
  const t = movetext(playAll(['e2e4', 'd7d5', 'e4d5', 'c7c6', 'd5c6', 'a7a6', 'c6c7', 'a6a5', 'c7d8q']));
  assert.ok(t.includes('5. cxd8=Q'), t);
});

test('傻瓜将杀：f3 e5 g4 Qh4#', () => {
  const t = movetext(playAll(['f2f3', 'e7e5', 'g2g4', 'd8h4']));
  assert.equal(t, '1. f3 e5 2. g4 Qh4# 0-1');
});

test('将军标记 +（非将杀）', () => {
  const t = movetext(playAll(['e2e4', 'f7f6', 'd1h5']));
  assert.ok(t.includes('2. Qh5+'), t);
});

test('结果串由终局局面推导', () => {
  assert.equal(chessResultFromState(playAll(['f2f3', 'e7e5', 'g2g4', 'd8h4']), null), '0-1');
  assert.equal(chessResultFromState(playAll(['e2e4', 'e7e5']), null), '*');
  assert.equal(chessResultFromState(playAll(['e2e4', 'e7e5']), 'w'), '0-1');
});

test('sqName 映射', () => {
  assert.equal(sqName(0), 'a1');
  assert.equal(sqName(7), 'h1');
  assert.equal(sqName(63), 'h8');
  assert.equal(sqName(sqToIdx('e4')), 'e4');
});

test('PGN 头部标签齐全', () => {
  const pgn = buildPgn(playAll(['e2e4']), { result: '1-0', whiteName: 'Liu', blackName: 'AI' });
  assert.ok(pgn.startsWith('[Event "BoardDuel game"]'));
  assert.ok(pgn.includes('[White "Liu"]'));
  assert.ok(pgn.includes('[Black "AI"]'));
  assert.ok(pgn.includes('[Result "1-0"]'));
  assert.ok(pgn.trimEnd().endsWith('1-0'));
});

test('无法匹配的着法截断而不抛错', () => {
  const moves: Move[] = [{ from: sqToIdx('e2'), to: sqToIdx('e5'), piece: 'P' }]; // 兵不能走三格
  const t = movetext(moves);
  assert.ok(t.includes('{truncated: unmatched move}'), t);
});
