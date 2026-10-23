/**
 * 西洋跳棋引擎规则单测 — engine.ts（2026-10-23 第三批补）
 *
 * selfTest 已覆盖：开局 7 步、强制吃子、双连跳、升变、王后退、AI 合法。
 * 本文件补 selfTest 没盖的规则面（都是规则正确性的关键边角）：
 *   1. 不能落在已有子的格（无论敌我）
 *   2. applyMove 后吃掉的子确实离盘
 *   3. 兵不能后退（王可以——selfTest 已测）
 *   4. 跳吃落点必须是"被吃子正后方一格"（距离恰为 2 格）
 *   5. 越界：边缘棋子不会生成界外着法
 *   6. hasMoves：无子/无合法步判定（联机判负依赖它）
 *   7. 王多方向连跳（斜四向）
 *   8. 深色格才可落子（跳棋只在黑格上走）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialBoard, moves, applyMove, hasMoves, countPieces, isDark, colorOf, isKing,
  RED_MAN, RED_KING, BLACK_MAN, BLACK_KING, EMPTY,
  type Board, type Cell, SIZE2,
} from '../src/games/checkers/engine.ts';

const idx = (r: number, c: number) => r * 8 + c;
const blank = (): Board => new Array<Cell>(SIZE2).fill(0 as Cell);

test('开局：12+12 子、红兵在下方深色格、黑兵在上方深色格', () => {
  const b = initialBoard();
  assert.equal(countPieces(b, 1), 12);
  assert.equal(countPieces(b, 2), 12);
  // 红在 row 5-7，黑在 row 0-2
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) {
    if (isDark(r, c)) assert.equal(b[idx(r, c)], BLACK_MAN, `(${r},${c}) 应为黑兵`);
  }
  for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (isDark(r, c)) assert.equal(b[idx(r, c)], RED_MAN, `(${r},${c}) 应为红兵`);
  }
  // 所有棋子都在深色格上
  b.forEach((v, i) => {
    if (v !== EMPTY) assert.ok(isDark((i / 8) | 0, i % 8), `棋子 ${i} 不在深色格`);
  });
});

test('着法不落在已有子的格（无论敌我）', () => {
  const b = blank();
  b[idx(5, 2)] = RED_MAN;
  b[idx(4, 3)] = RED_MAN;   // 己方子占据目标格
  b[idx(4, 1)] = BLACK_MAN;  // 敌方子占据目标格
  const ms = moves(b, 1);
  for (const m of ms) {
    assert.equal(b[m.to], EMPTY, `着法落点 ${m.to} 已被占据`);
  }
});

test('普通着法是单格斜走；跳吃是两格且落点为空', () => {
  const b = blank();
  b[idx(5, 2)] = RED_MAN;
  const ms = moves(b, 1);
  assert.equal(ms.length, 2, '红兵在盘中腹应有两个斜向选择');
  for (const m of ms) {
    assert.equal(m.captures.length, 0, '无子可吃时不应生成跳吃');
    const dist = Math.max(Math.abs(((m.from / 8) | 0) - ((m.to / 8) | 0)), Math.abs((m.from % 8) - (m.to % 8)));
    assert.equal(dist, 1, '普通着法必须是斜走一格');
  }

  // 有子可吃时：强制吃，且只有跳吃
  const b2 = blank();
  b2[idx(5, 2)] = RED_MAN;
  b2[idx(4, 3)] = BLACK_MAN; // 左上角有敌子 → 跳过它落到 (3,4)
  const cm = moves(b2, 1);
  assert.equal(cm.length, 1, '强制吃子：只能走吃子着法');
  assert.equal(cm[0].captures.length, 1);
  assert.equal(cm[0].to, idx(3, 4), '落点必须是被吃子正后方的空格');
});

test('applyMove：吃掉的子离盘、落子方占位、棋盘尺寸不变', () => {
  const b = blank();
  b[idx(5, 2)] = RED_MAN;
  b[idx(4, 3)] = BLACK_MAN;
  b[idx(4, 5)] = BLACK_MAN;
  const m = moves(b, 1)[0];
  const after = applyMove(b, m);
  assert.equal(after.length, SIZE2, 'applyMove 不得改变棋盘尺寸');
  assert.equal(after[m.to], RED_MAN, '落点应是红兵');
  assert.equal(after[m.from], EMPTY, '原位置应清空');
  assert.equal(after[idx(4, 3)], EMPTY, '被吃的黑子必须离盘');
});

test('兵不能后退（王可以）', () => {
  // 红兵只能向 row 递减方向走
  const b = blank();
  b[idx(3, 4)] = RED_MAN;
  for (const m of moves(b, 1)) {
    assert.ok(((m.to / 8) | 0) < 3, '红兵不得后退（row 不得增大）');
  }
  // 黑兵只能向 row 递增方向走
  const b2 = blank();
  b2[idx(4, 4)] = BLACK_MAN;
  for (const m of moves(b2, 2)) {
    assert.ok(((m.to / 8) | 0) > 4, '黑兵不得后退（row 不得减小）');
  }
});

test('越界：贴边棋子不生成界外着法', () => {
  const b = blank();
  b[idx(5, 0)] = RED_MAN; // 左边缘：只有右上可走
  b[idx(5, 7)] = RED_MAN; // 右边缘：只有左上可走
  b[idx(0, 2)] = RED_MAN; // 顶行：无路可走（再走就出界）
  for (const m of moves(b, 1)) {
    assert.ok(m.to >= 0 && m.to < SIZE2, `落点 ${m.to} 越界`);
  }
  // 顶行红兵单独无合法着法（前进一步即出界；同盘还有别的子，只断言它自己）
  const solo = blank();
  solo[idx(0, 2)] = RED_MAN;
  assert.equal(moves(solo, 1).length, 0, '顶行红兵应无合法着法');
});

test('hasMoves：无子/全被堵时判无步（联机判负依赖）', () => {
  const empty = blank();
  assert.equal(hasMoves(empty, 1), false, '空盘无步');
  // 前向邻格全被己方占据：红兵 (1,1) 的 (0,0)(0,2) 都是红子 → 无处可去
  const b2 = blank();
  b2[idx(1, 1)] = RED_MAN;
  b2[idx(0, 0)] = RED_MAN;
  b2[idx(0, 2)] = RED_MAN;
  assert.equal(hasMoves(b2, 1), false, '前向邻格全被己方占据 → 无步');
  assert.equal(hasMoves(b2, 2), false, '黑方无子 → 无步');
});

test('王斜四向：盘中王有 4 个单步方向（无子阻挡时）', () => {
  const b = blank();
  b[idx(3, 3)] = RED_KING;
  const ms = moves(b, 1);
  assert.equal(ms.length, 4, '王在盘中应有 4 个斜向单步');
  const dests = new Set(ms.map((m) => ((m.to / 8) | 0) + ',' + (m.to % 8)));
  for (const [r, c] of [[2, 2], [2, 4], [4, 2], [4, 4]] as [number, number][]) {
    assert.ok(dests.has(`${r},${c}`), `王应能走到 (${r},${c})`);
  }
});

test('王多方向吃子：左上/右上各有敌子时两个方向都生成吃子着法', () => {
  const b = blank();
  b[idx(4, 4)] = RED_KING;
  b[idx(3, 3)] = BLACK_MAN; // 左上敌子
  b[idx(3, 5)] = BLACK_MAN; // 右上敌子
  const caps = moves(b, 1).filter((m) => m.captures.length >= 1);
  assert.ok(caps.length >= 2, '王应能从至少两个方向吃子');
});

test('深色格约束：所有合法着法的起落点都在深色格', () => {
  const b = initialBoard();
  for (const m of moves(b, 1)) {
    assert.ok(isDark((m.from / 8) | 0, m.from % 8), `起点 ${m.from} 非深色格`);
    assert.ok(isDark((m.to / 8) | 0, m.to % 8), `落点 ${m.to} 非深色格`);
  }
});

test('colorOf/isKing 常量映射自洽', () => {
  assert.equal(colorOf(RED_MAN), 1);
  assert.equal(colorOf(RED_KING), 1);
  assert.equal(colorOf(BLACK_MAN), 2);
  assert.equal(colorOf(BLACK_KING), 2);
  assert.equal(colorOf(EMPTY), 0);
  assert.equal(isKing(RED_KING), true);
  assert.equal(isKing(RED_MAN), false);
  assert.equal(isKing(BLACK_KING), true);
});
