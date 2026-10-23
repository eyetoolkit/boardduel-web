/**
 * Connect4 联机同步回归（2026-10-23 第二批修复）
 *
 * 背景（P0）：服务端 judgment 模式每步先 broadcastState()（权威盘，已含该子）
 * 再广播 opponent_place（games-room.js:881-884），且 broadcast 无差别发给所有人。
 * 原客户端两路都落子：接收方在权威盘上多落一子（幻影盘），moves 被清后
 * 按奇偶重记 → 座位 0 第一回合后回合错位永久锁死。
 *
 * 这里不复刻 DOM/WS，直接对纯函数与「state 帧采纳」状态机建模：
 *   · deriveMovesFromBoard / lastPlacedCell（engine.ts）
 *   · 客户端 applyServerBoard 的核心口径（inSync 检测 + 反推 + player=turn+1）
 *   · onlineMyTurn 的 turn 口径（不依赖 moves 奇偶）
 * 任一环节退回到「opponent_place 补子 / moves 奇偶判回合」，这些断言都会红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyBoard, drop, checkWinner, legalMoves, deriveMovesFromBoard, lastPlacedCell,
  ROWS, COLS, SIZE2,
  type Board, type Player,
} from '../src/games/connect4/engine.ts';

/** 模拟服务端权威局（judgment 模式）：board 值 null|0|1 = 空|座位（对齐 connect4-core.js） */
function serverGame() {
  const board = new Array<number | null>(SIZE2).fill(null);
  let turn = 0;
  const moves: number[] = [];
  return {
    place(seat: number, col: number): boolean {
      if (turn !== seat) return false;               // not_your_turn
      // 找该列最深的空格（服务端 core 同款重力）
      let idx = -1;
      for (let y = ROWS - 1; y >= 0; y--) {
        const kk = y * COLS + col;
        if (board[kk] === null) { idx = kk; break; }
      }
      if (idx < 0) return false;
      board[idx] = seat;
      turn = 1 - seat;
      moves.push(col);
      return true;
    },
    /** snapshot()：扁平盘 null|0|1 + turn 座位号（0=先手） */
    snapshot(): { board: (number | null)[]; turn: number } {
      return { board: board.slice(), turn };
    },
    moves: () => moves.slice(),
  };
}

/** 模拟客户端（connect4/index.ts applyServerBoard 的核心口径，2026-10-23 版） */
function clientGame(myIdx: number) {
  const board: Board = emptyBoard();
  let player: Player = 1;                 // 本地方色 1|2
  const moves: number[] = [];
  let lastMove = -1;
  return {
    get player() { return player; },
    get moves() { return moves.slice(); },
    get board() { return board.slice(); },
    /** 对应 applyServerBoard：采纳权威盘 + turn+1 + diff/反推 */
    applyState(snap: { board: (number | null)[]; turn: number }): void {
      const b: Board = emptyBoard();
      for (let i = 0; i < SIZE2; i++) {
        const v = snap.board[i];
        b[i] = (v === 0 || v === 1) ? ((v + 1) as Player) : 0;
      }
      // inSync 检测：本地按 moves 重放 vs 权威盘
      const replay: Board = emptyBoard();
      moves.forEach((col, k) => { drop(replay, col, (k % 2 === 0 ? 1 : 2) as Player); });
      const inSync = replay.every((v, i) => v === b[i]);
      lastMove = lastPlacedCell(board, b);
      for (let i = 0; i < SIZE2; i++) board[i] = b[i];
      player = (snap.turn + 1) as Player;
      if (!inSync) {
        moves.length = 0;
        for (const c of deriveMovesFromBoard(b)) moves.push(c);
      }
    },
    /** 联机回合判定：turn 口径（onlineMyTurn 2026-10-23 版） */
    myTurn(): boolean { return player === myIdx + 1; },
    /** 联机回合判定：moves 奇偶口径（被废弃的旧版，用于证明它会死锁） */
    myTurnLegacy(): boolean { return moves.length % 2 === myIdx; },
    /** 旧 applyServerBoard 的无条件清空记谱行为（仅用于复现死锁） */
    resetMovesLegacy(): void { moves.length = 0; },
    /** 本地乐观落子（onCell：placeLocal + afterMove 的纯状态部分） */
    localPlace(col: number): void {
      moves.push(col);
      drop(board, col, player);
      lastMove = (ROWS - 1) * COLS + col;
      player = player === 1 ? 2 : 1;
    },
    last: () => lastMove,
  };
}

test('deriveMovesFromBoard: 重放后与服务端权威盘逐格一致', () => {
  for (let g = 0; g < 50; g++) {
    const srv = serverGame();
    const seatOrder = [0, 1];
    let guard = 0;
    while (guard++ < 42) {
      const seat = seatOrder[guard % 2];
      const cols = legalMoves(srv.snapshot().board.map((v) => (v === null ? 0 : (v + 1)) as 0 | 1 | 2));
      if (!cols.length) break;
      if (!srv.place(seat, cols[Math.floor(Math.random() * cols.length)])) break;
      if (checkWinner(srv.snapshot().board.map((v) => (v === null ? 0 : (v + 1)) as 0 | 1 | 2)).winner !== 0) break;
    }
    const snap = srv.snapshot();
    const b: Board = emptyBoard();
    for (let i = 0; i < SIZE2; i++) {
      const v = snap.board[i];
      b[i] = (v === 0 || v === 1) ? ((v + 1) as Player) : 0;
    }
    const replay: Board = emptyBoard();
    deriveMovesFromBoard(b).forEach((col, k) => {
      drop(replay, col, (k % 2 === 0 ? 1 : 2) as Player);
    });
    assert.deepEqual(replay, b, `game ${g}: 反推序列重放后必须与权威盘一致`);
  }
});

test('lastPlacedCell: 找出从空到非空的新落点', () => {
  const a = emptyBoard();
  const b = emptyBoard();
  drop(b, 3, 1);
  assert.equal(lastPlacedCell(a, b), 5 * COLS + 3);
  const c = b.slice();
  drop(c, 0, 2);
  assert.equal(lastPlacedCell(b, c), 5 * COLS + 0);
  assert.equal(lastPlacedCell(b, b), -1);   // 无变化
});

test('联机同步：state 帧采纳模型下双方盘面/回合永不幻影、永不死锁', () => {
  const srv = serverGame();
  const c0 = clientGame(0);
  const c1 = clientGame(1);
  // 首帧 joinState（空盘 turn=0）
  c0.applyState(srv.snapshot());
  c1.applyState(srv.snapshot());

  let seat = 0;
  for (let step = 0; step < 42; step++) {
    const cli = seat === 0 ? c0 : c1;
    // 回合判定必须是「服务端权威方」
    assert.equal(cli.myTurn(), true, `step ${step}: seat${seat} 应轮到他走`);
    // 找一个合法列（服务端口径：该列顶格为空）
    const snap = srv.snapshot();
    const cols: number[] = [];
    for (let c = 0; c < COLS; c++) if (snap.board[c] === null) cols.push(c);
    if (!cols.length) break;
    const col = cols[Math.floor(Math.random() * cols.length)];

    // 客户端乐观落子（onCell）
    cli.localPlace(col);
    // 服务端校验通过（not_your_turn 必不发生）
    assert.equal(srv.place(seat, col), true, `step ${step}: 服务端必须接受 seat${seat} 的合法着法`);
    // 服务端广播顺序恒为 state → opponent_place；两端都只认 state 帧
    c0.applyState(srv.snapshot());
    c1.applyState(srv.snapshot());
    // opponent_place 帧：新模型零动作（不落子不记谱）—— 幻影盘的根因此被拔掉

    // 双端一致性：盘面相同、记谱数与服务端着法数一致、无幻影
    assert.deepEqual(c0.board, c1.board, `step ${step}: 双端盘面必须一致`);
    assert.equal(c0.moves.length, srv.moves().length, `step ${step}: seat0 记谱数与服务端着法数一致`);
    assert.equal(c1.moves.length, srv.moves().length, `step ${step}: seat1 记谱数与服务端着法数一致`);
    assert.equal(c0.player, c1.player, `step ${step}: 双端回合方一致`);
    // 双端「下一手该谁走」必须都跟随服务端 turn（不会双锁死也不会双放行）
    const expectSeat = srv.snapshot().turn;
    assert.equal(c0.myTurn(), expectSeat === 0, `step ${step}: turn=${expectSeat} → seat0 行棋权应${expectSeat === 0}`);
    assert.equal(c1.myTurn(), expectSeat === 1, `step ${step}: turn=${expectSeat} → seat1 行棋权应${expectSeat === 1}`);

    // 终局即停
    const b = c0.board;
    if (checkWinner(b).winner !== 0 || b.every((v) => v !== 0)) break;
    seat = 1 - seat;
  }
});

test('旧口径复现：moves 奇偶 + opponent_place 补子必然死锁（证明本修复必要）', () => {
  const srv = serverGame();
  const c0 = clientGame(0);
  const c1 = clientGame(1);
  // 旧 applyServerBoard：无条件清空 moves + player=turn+1（2026-10-23 之前的实现）
  const legacyApply = (cli: ReturnType<typeof clientGame>): void => {
    cli.applyState(srv.snapshot());   // 先按新模型同步盘面/turn
    cli.resetMovesLegacy();           // 再无条件清空记谱（旧行为）
  };
  legacyApply(c0);
  legacyApply(c1);

  // ── seat0 第一手 ──
  srv.place(0, 3);
  c0.localPlace(3);                  // 落子方乐观落子
  legacyApply(c0);                   // state 帧：清空 c0.moves（=[]）
  legacyApply(c1);                   // state 帧：c1 采纳权威盘（1 子），moves=[]
  c1.localPlace(3);                  // 旧 opponent_place：在权威盘上又补一子 → 幻影 + moves=[3]

  // 服务端 turn=1（seat1 走）：c1 旧口径 3%2===1 恰好还能走（第一回合自愈假象）；
  // 而 c0 旧口径被错乱放行（服务端明确该 seat1 走）—— 它落子只会被服务端拒。
  assert.equal(c1.myTurnLegacy(), true, '第一回合 c1 旧口径侥幸还能走');
  assert.equal(c0.myTurnLegacy(), true, 'c0 旧口径错乱放行：服务端该 seat1 走，旧口径却认为轮到 seat0');

  // ── seat1 第二手 ──
  srv.place(1, 4);
  c1.localPlace(4);                  // c1.moves=[3,4]
  legacyApply(c0);                   // state 帧：清空 c0.moves
  legacyApply(c1);                   // state 帧：清空 c1.moves
  c0.localPlace(4);                  // 旧 opponent_place(by=1)：c0 又补一子 → 幻影 + c0.moves=[4]

  // 服务端 turn=0（seat0 走）：两端旧口径都判「不是我的回合」→ 双锁死，房间假死
  assert.equal(srv.snapshot().turn, 0);
  assert.equal(c0.myTurnLegacy(), false, 'c0 旧口径：轮到他却判不是 → 锁死');
  assert.equal(c1.myTurnLegacy(), false, 'c1 旧口径：没轮到他但也判不是 → 双锁死');
  // 旧口径罪证：c0 盘上多出一枚幻影 disc（服务端才 2 子）
  const srvCount = srv.snapshot().board.filter((v) => v !== null).length;
  const c0Count = c0.board.filter((v) => v !== 0).length;
  assert.equal(c0Count, srvCount + 1, '旧口径 c0 盘面多一枚幻影 disc（本地 3 子 vs 服务端 2 子）');
  // 新口径（turn 口径 + opponent_place 零动作）在同一帧序列下的正确性，
  // 由上一个测试的完整对局建模覆盖，这里不再重复。
});
