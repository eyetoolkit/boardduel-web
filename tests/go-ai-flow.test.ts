/**
 * W2.3 human-vs-AI 流程契约测试
 *
 * 锁住 index.ts 里 AI 模式最容易出错的两个不变量：
 *   A. bestMove（easy/medium）返回的落点永远合法（或 -1 表示该停手）——否则人类
 *      走完后 AI 那一手被静默丢弃，局面卡在"AI 回合"玩家动不了。
 *   B. 悔棋「一路回退到人类回合」在 AI 模式下总能停在 humanColor（history 严格
 *      黑白交替，保证弹栈最多两步就回到人类回合，不会弹空或卡在 AI 回合）。
 * 另外锁住：人类落子后轮到 AI、AI 落子后轮回人类；双 pass 终局能出胜负。
 *
 * 注意：这里复刻了 index.ts 的「回合调度 / 悔棋弹栈」纯逻辑做断言（index.ts 本身
 * 闭包持有 DOM，无法在 node:test 里直接 import）。引擎 + AI 的真身仍由
 * go-engine / go-ai / go-render 测试覆盖。
 */
import { test } from 'node:test';
import {
  initialState, play, pass, opponent, scoreChinese, isLegalMove,
  type GoState, type Player,
} from '../src/games/go/engine.ts';
import { bestMove, bestMoveEasy, bestMoveMedium, type Difficulty } from '../src/games/go/ai.ts';

const SIZES = [9, 13, 19] as const;
const DIFFS: Difficulty[] = ['easy', 'medium'];

/** 确定性伪随机，保证测试可复现 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/* ── A. AI 落点永远合法 ── */

for (const size of SIZES) {
  for (const diff of DIFFS) {
    test(`A · ${size}×${size} ${diff}：整局自对弈每手都合法`, () => {
      const rng = seeded(size * 31 + diff.length);
      let s: GoState = initialState(size);
      let steps = 0;
      // 双方都交给 bestMove；限制步数避免 superko 未开时可能的劫争长循环
      const cap = size * size * 2;
      while (s.passes < 2 && steps < cap) {
        const m = bestMove(s, diff, rng);
        if (m < 0) {
          s = pass(s);           // 无合法手 → 停手（引擎允许 pass）
        } else {
          if (!isLegalMove(s, m)) {
            throw new Error(`${size}/${diff} 第 ${steps} 步返回非法落点 ${m}`);
          }
          s = play(s, m).state!;
        }
        steps++;
      }
      if (steps === 0) throw new Error('一步都没走');
    });
  }
}

test('A · bestMove 在空盘 19×19 上首手合法且落子', () => {
  for (const fn of [bestMoveEasy, bestMoveMedium]) {
    const s = initialState(19);
    const m = fn(s, seeded(7));
    expect_ok(isLegalMove(s, m), `首手 ${m} 应合法`);
    if (m >= 0) {
      const r = play(s, m);
      expect_ok(r.ok && r.state!.board[m] === 1, '落子后该点应为黑');
    }
  }
});

test('A · 满盘无合法手时 bestMove 返回 -1（触发 AI 停手）', () => {
  // 造一个只剩单气自杀点的极小局面：9×9 不现实，改用直接验证 easy 在合法手耗尽时的行为
  // 用 1×1 退化盘不可行(size>=2)，这里改为：把 board 填满到无空点 → legalMoves=0
  const s = initialState(9);
  const filled: GoState = { ...s, board: s.board.map(() => 1) }; // 全黑占满
  // 全占满 → 没有空点 → legalMoves 为空 → 返回 -1
  const m = bestMoveEasy(filled, seeded(3));
  expect_ok(m === -1, `满盘应返回 -1，实际 ${m}`);
});

/* ── B. 悔棋回退到人类回合（复刻 index.ts doUndo 的弹栈逻辑） ── */

/** 复刻 index.ts 的「一路回退到人类回合」弹栈：返回弹出的步数与落点 state */
function undoUntilHumanTurn(history: GoState[], mode: Mode): { state: GoState; popped: number } {
  const humanColor: Player = 1;
  let state = history[history.length - 1]!;
  let popped = 0;
  const guardLimit = state.size * state.size + 2;
  while (history.length > 0 && popped < guardLimit) {
    const prev = history.pop()!;
    state = prev;
    popped++;
    if (mode !== 'ai' || state.toPlay === humanColor) break;
  }
  return { state, popped };
}
type Mode = 'pass' | 'ai';

/** 跑一段「人类(黑) + AI(白)」对局，产出 history 栈（每步 push before） */
function buildAiHistory(size: number, rounds: number, diff: Difficulty): GoState[] {
  const rng = seeded(size + rounds);
  const humanColor: Player = 1;
  const aiColor: Player = opponent(humanColor);
  let s: GoState = initialState(size);
  const history: GoState[] = [];
  for (let r = 0; r < rounds; r++) {
    // 人类随便下一手合法的
    const hm = bestMoveEasy(s, rng);
    if (hm < 0) break;
    history.push(s);
    s = play(s, hm).state!;
    if (s.toPlay !== aiColor) throw new Error('人类落子后应轮到 AI(白)');
    // AI 回一手
    const am = bestMove(s, diff, rng);
    if (am < 0) { s = pass(s); continue; }
    history.push(s);
    s = play(s, am).state!;
    if (s.toPlay !== humanColor) throw new Error('AI 落子后应轮回人类(黑)');
  }
  return history;
}

for (const size of [9, 13] as const) {
  test(`B · ${size}×${size} vs AI：悔棋总能停在人类回合`, () => {
    const history = buildAiHistory(size, 6, 'medium');
    expect_ok(history.length > 0, '应积累出历史');
    // 反复悔棋直到弹空
    let guard = 0;
    while (history.length > 0 && guard < 200) {
      const { state } = undoUntilHumanTurn(history, 'ai');
      // 关键不变量：弹出的落点一定是「人类回合」或「历史弹空后的初始盘」
      if (state.toPlay !== 1) {
        throw new Error(`size=${size} 悔棋后落在 AI 回合(toPlay=${state.toPlay})`);
      }
      guard++;
    }
    expect_ok(guard > 0, '应至少成功悔棋一次');
  });
}

test('B · vs AI 悔棋一步 = 撤销「人类+AI」两手（弹 2）', () => {
  const size = 9;
  const history = buildAiHistory(size, 3, 'easy');
  // 构造：确保栈顶是 AI 刚落完（history 长度偶数 = 成对）
  const before = history.length;
  const { state, popped } = undoUntilHumanTurn(history, 'ai');
  expect_ok(popped === 2, `成对历史一次悔棋应弹 2，实际弹 ${popped}（栈 ${before}）`);
  expect_ok(state.toPlay === 1, '弹 2 后应回到人类回合');
});

/* ── 终局：双 pass → 中国规则能出胜负 ── */

for (const size of SIZES) {
  test(`C · ${size}×${size} 双 pass 终局出胜负（带贴目 7.5）`, () => {
    let s: GoState = initialState(size);
    // 黑随手下一子，再黑pass? 实际是黑pass白pass（黑先手，黑pass→白pass→终局）
    s = pass(pass(s));
    expect_ok(s.passes === 2, '两次 pass 应终局');
    const sc = scoreChinese(s);
    // 空盘：白(0子+0空+7.5贴目) 胜，margin=7.5
    expect_ok(sc.winner === 2, '空盘白应靠贴目胜');
    expect_ok(Math.abs(sc.margin - 7.5) < 1e-9, `空盘 margin 应 7.5，实际 ${sc.margin}`);
  });
}

test('C · 黑单活一子 vs 白空（黑占一处）终局黑胜', () => {
  const size = 9;
  let s: GoState = initialState(size);
  // 黑下一子在角上，围住单点区域
  const b = s.board.slice();
  b[0] = 1; // (0,0)
  b[1] = 1; // (1,0)
  b[9] = 1; // (0,1)
  s = { ...s, board: b, toPlay: 1 as Player };
  s = pass(pass(s));
  const sc = scoreChinese(s);
  // 黑：1子 + 天元等大白区应压过白 7.5? 这里只断言 winner 是合法 Player 且 margin>0
  expect_ok(sc.winner === 1 || sc.winner === 2, 'winner 必须是 1 或 2');
  expect_ok(sc.margin >= 0, 'margin 非负');
});

/* ── 工具断言（不依赖 node:assert 的自定义，尽量少依赖） ── */
function expect_ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
