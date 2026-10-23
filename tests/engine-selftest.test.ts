/**
 * 引擎 selfTest 全量接线 —— 2026-10-23 第三批。
 *
 * 背景：审计发现 8 个引擎都导出 selfTest 但没有任何调用方，
 * 多个 P0 规则 bug（国象兵方向、井字和棋）因此逃过所有检查。
 * 本文件把全部 selfTest 接进 npm test，之后任何引擎回退都会红灯。
 *
 * 两种返回签名在此归一化：
 *   { ok: boolean; details: string[] }        （7 个引擎）
 *   { pass: boolean; msg: string }[]          （xiangqi，数组式）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { selfTest as chessSelfTest } from '../src/games/chess/engine.ts';
import { selfTest as checkersSelfTest } from '../src/games/checkers/engine.ts';
import { selfTest as connect4SelfTest } from '../src/games/connect4/engine.ts';
import { selfTest as gomokuSelfTest } from '../src/games/gomoku/engine.ts';
import { selfTest as reversiSelfTest } from '../src/games/reversi/engine.ts';
import { selfTest as tictactoeSelfTest } from '../src/games/tictactoe/engine.ts';
import { selfTest as goSelfTest } from '../src/games/go/engine.ts';
import { selfTest as xiangqiSelfTest } from '../src/games/xiangqi/engine.ts';

/** 归一化：把两种签名统一成 (ok, failures[]) */
function normalize(
  result: { ok: boolean; details: string[] } | { pass: boolean; msg: string }[],
): { ok: boolean; failures: string[] } {
  if (Array.isArray(result)) {
    return {
      ok: result.every((r) => r.pass),
      failures: result.filter((r) => !r.pass).map((r) => r.msg),
    };
  }
  return { ok: result.ok, failures: result.details };
}

const cases: [string, () => { ok: boolean; details: string[] } | { pass: boolean; msg: string }[]][] = [
  ['chess', chessSelfTest],
  ['checkers', checkersSelfTest],
  ['connect4', connect4SelfTest],
  ['gomoku', gomokuSelfTest],
  ['reversi', reversiSelfTest],
  ['tictactoe', tictactoeSelfTest],
  ['go', goSelfTest],
  ['xiangqi', xiangqiSelfTest],
];

for (const [name, fn] of cases) {
  test(`selfTest: ${name}`, () => {
    const { ok, failures } = normalize(fn());
    assert.ok(ok, `${name} selfTest failed:\n${failures.map((f) => '  - ' + f).join('\n')}`);
  });
}
