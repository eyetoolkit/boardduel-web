/**
 * 棋谱导出共享层单测（2026-10-24 第四批 ⑰）
 * SGF 的坐标映射与 pass 编码是最易错的地方，逐条钉住。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSgf, buildMoveList, sgfCoord, sgfResult, recordFilename } from '../src/shared/export-record.ts';

test('sgfCoord：aa = 左上，列在前行在后', () => {
  assert.equal(sgfCoord(0, 0), 'aa');
  assert.equal(sgfCoord(14, 14), 'oo');
  assert.equal(sgfCoord(3, 4), 'de');
});

test('SGF 头：GM/FF/SZ/KM/RE/DT 齐全，着法按黑白交替', () => {
  const sgf = buildSgf({ size: 15, moves: [112, 113, 114], komi: 0, gameName: 'Gomoku' });
  assert.ok(sgf.startsWith('(;GM[1]FF[4]CA[UTF-8]'), sgf);
  assert.ok(sgf.includes('SZ[15]'), sgf);
  assert.ok(sgf.includes('KM[0]'), sgf);
  assert.ok(sgf.includes('GN[Gomoku]'), sgf);
  // 112 = (col 7, row 7) → hh；113 → ih；114 → jh
  assert.ok(sgf.includes(';B[hh];W[ih];B[jh]'), sgf);
  assert.ok(sgf.trimEnd().endsWith(')'), sgf);
});

test('19 路 pass 记作 tt；15 路 pass 记作空着法', () => {
  const go = buildSgf({ size: 19, moves: [-1, 360], komi: 7.5 });
  assert.ok(go.includes(';B[tt]'), go);
  const gomoku = buildSgf({ size: 15, moves: [-1] });
  assert.ok(gomoku.includes(';B[]'), gomoku);
});

test('先手为白时着色对调', () => {
  const sgf = buildSgf({ size: 15, moves: [0], firstColor: 2 });
  assert.ok(sgf.includes(';W[aa]'), sgf);
});

test('特殊字符转义：] 与 \\ 不破坏 SGF 结构', () => {
  const sgf = buildSgf({ size: 15, moves: [], comment: 'a]b\\c' });
  assert.ok(sgf.includes('C[a\\]b\\\\c]'), sgf);
});

test('sgfResult', () => {
  assert.equal(sgfResult(1), 'B+R');
  assert.equal(sgfResult(2, '7.5'), 'W+7.5');
  assert.equal(sgfResult(0), 'Draw');
});

test('buildMoveList：编号从 1 起，结果行在末尾', () => {
  const t = buildMoveList({ title: 'T', moves: ['C4', 'C5'], result: 'Black wins', meta: ['m1'] });
  const lines = t.trim().split('\n');
  assert.equal(lines[0], '# T');
  assert.ok(lines.some((l) => l === '# m1'), t);
  assert.ok(t.includes('1. C4'), t);
  assert.ok(t.includes('2. C5'), t);
  assert.ok(t.trimEnd().endsWith('Black wins'), t);
});

test('recordFilename：boardduel-<game>-时间戳.<ext>', () => {
  const f = recordFilename('gomoku', 'sgf');
  assert.match(f, /^boardduel-gomoku-\d{8}-\d{4}\.sgf$/);
});
