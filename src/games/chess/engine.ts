/**
 * Chess（国际象棋）engine — 8×8 完整子集
 * 规则覆盖：王 K/后 Q/车 R/象 B/马 N/兵 P 标准走子、王车易位、兵升变、王被将/将杀/逼和
 * AI 档位（设计稿）：
 *   easy   — material-only + depth=2（基本贪心 + 浅搜索）
 *   medium — αβ depth=4 + material + 机动性
 *   hard   — αβ depth=6 + material + 位置表 + 机动性 + MVV-LVA 排序
 *
 * 数据结构：
 *   8×8 = 64 格；正向 0x88 board（[0..63]）
 *   Piece = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k' | '.'
 *   大写 = 白，小写 = 黑
 *   board = string[64]，board[0] = a1（白左下角）
 */

export type Side = 'w' | 'b';
export type Piece = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k' | '.';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Move {
  from: number; // 0-63
  to: number;   // 0-63
  piece: Piece;
  capture?: Piece | '.';
  promo?: Piece;  // 兵升变目标（仅升变时）
  castle?: 'K' | 'Q'; // 王车易位（白/黑、王翼/后翼）
  enpassant?: boolean;
}

export interface GameState {
  board: Piece[]; // [64]
  turn: Side;
  castling: { K: boolean; Q: boolean; k: boolean; q: boolean }; // 王车易位许可
  enpassant: number | null; // 上一步吃过路兵目标格
  halfmove: number; // 50 步无进展判和
  fullmove: number;
  history: Move[];
}

// 子力估值
const PIECE_VAL: Record<Piece, number> = {
  P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000,
  p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000,
  '.': 0,
};

// Piece-Square Tables（PST）— 简化版，从白方视角；黑方镜像翻转
// 行索引 = rank 0..7（黑→白），列 = file 0..7
// 值单位：cp = 百分之一子力分
const PST_PAWN: number[] = [
  0,  0,  0,  0,  0,  0,  0,  0,
 50, 50, 50, 50, 50, 50, 50, 50,
 10, 10, 20, 30, 30, 20, 10, 10,
  5,  5, 10, 25, 25, 10,  5,  5,
  0,  0,  0, 20, 20,  0,  0,  0,
  5, -5,-10,  0,  0,-10, -5,  5,
  5, 10, 10,-20,-20, 10, 10,  5,
  0,  0,  0,  0,  0,  0,  0,  0,
];
const PST_KNIGHT: number[] = [
-50,-40,-30,-30,-30,-30,-40,-50,
-40,-20,  0,  0,  0,  0,-20,-40,
-30,  0, 10, 15, 15, 10,  0,-30,
-30,  5, 15, 20, 20, 15,  5,-30,
-30,  0, 15, 20, 20, 15,  0,-30,
-30,  5, 10, 15, 15, 10,  5,-30,
-40,-20,  0,  5,  5,  0,-20,-40,
-50,-40,-30,-30,-30,-30,-40,-50,
];
const PST_BISHOP: number[] = [
-20,-10,-10,-10,-10,-10,-10,-20,
-10,  0,  0,  0,  0,  0,  0,-10,
-10,  0, 10, 10, 10, 10,  0,-10,
-10,  5,  5, 10, 10,  5,  5,-10,
-10,  0, 10, 10, 10, 10,  0,-10,
-10, 10, 10, 10, 10, 10, 10,-10,
-10,  5,  0,  0,  0,  0,  5,-10,
-20,-10,-10,-10,-10,-10,-10,-20,
];
const PST_ROOK: number[] = [
  0,  0,  0,  0,  0,  0,  0,  0,
  5, 10, 10, 10, 10, 10, 10,  5,
 -5,  0,  0,  0,  0,  0,  0, -5,
 -5,  0,  0,  0,  0,  0,  0, -5,
 -5,  0,  0,  0,  0,  0,  0, -5,
 -5,  0,  0,  0,  0,  0,  0, -5,
 -5,  0,  0,  0,  0,  0,  0, -5,
  0,  0,  0,  5,  5,  0,  0,  0,
];
const PST_QUEEN: number[] = [
-20,-10,-10, -5, -5,-10,-10,-20,
-10,  0,  0,  0,  0,  0,  0,-10,
-10,  0,  5,  5,  5,  5,  0,-10,
 -5,  0,  5,  5,  5,  5,  0, -5,
  0,  0,  5,  5,  5,  5,  0, -5,
-10,  5,  5,  5,  5,  5,  0,-10,
-10,  0,  5,  0,  0,  0,  0,-10,
-20,-10,-10, -5, -5,-10,-10,-20,
];
// 简化王 PST：终局王活跃度 > 安全
const PST_KING_MID: number[] = [
-30,-40,-40,-50,-50,-40,-40,-30,
-30,-40,-40,-50,-50,-40,-40,-30,
-30,-40,-40,-50,-50,-40,-40,-30,
-30,-40,-40,-50,-50,-40,-40,-30,
-20,-30,-30,-40,-40,-30,-30,-20,
-10,-20,-20,-20,-20,-20,-20,-10,
 20, 20,  0,  0,  0,  0, 20, 20,
 20, 30, 10,  0,  0, 10, 30, 20,
];
// 黑方 PST = 翻转
function flip(pst: number[]): number[] {
  const out = new Array(64);
  for (let sq = 0; sq < 64; sq++) {
    const r = Math.floor(sq / 8), f = sq % 8;
    out[sq] = pst[(7 - r) * 8 + f];
  }
  return out;
}
const PST = {
  P: { w: PST_PAWN, b: flip(PST_PAWN) },
  N: { w: PST_KNIGHT, b: flip(PST_KNIGHT) },
  B: { w: PST_BISHOP, b: flip(PST_BISHOP) },
  R: { w: PST_ROOK, b: flip(PST_ROOK) },
  Q: { w: PST_QUEEN, b: flip(PST_QUEEN) },
  K: { w: PST_KING_MID, b: flip(PST_KING_MID) },
  p: { w: flip(PST_PAWN), b: PST_PAWN },
  n: { w: flip(PST_KNIGHT), b: PST_KNIGHT },
  b: { w: flip(PST_BISHOP), b: PST_BISHOP },
  r: { w: flip(PST_ROOK), b: PST_ROOK },
  q: { w: flip(PST_QUEEN), b: PST_QUEEN },
  k: { w: flip(PST_KING_MID), b: PST_KING_MID },
  '.': { w: new Array(64).fill(0), b: new Array(64).fill(0) },
};

export function initialState(): GameState {
  const board: Piece[] = new Array(64).fill('.');
  const setup = (rank: number, pieces: Piece[]) => {
    for (let f = 0; f < 8; f++) board[rank * 8 + f] = pieces[f];
  };
  // 标准布局：白在底 (rank 0-1)，黑在顶 (rank 6-7)
  // 白兵方向 dir=+1（rank 递增，向顶推进），起点 rank=1；黑兵反之（dir=-1，起点 rank=6）
  // ⚠️ 曾把这里写成「白兵 dir=-1 / 起点 rank=6」——与 legalMoves 的实际口径相反，
  //   正是 2026-10-23 兵攻击方向 P0 的认知源头。改兵相关逻辑前先读 legalMoves:266-272。
  setup(0, ['R','N','B','Q','K','B','N','R']);
  setup(1, ['P','P','P','P','P','P','P','P']);
  setup(6, ['p','p','p','p','p','p','p','p']);
  setup(7, ['r','n','b','q','k','b','n','r']);
  return {
    board,
    turn: 'w',
    castling: { K: true, Q: true, k: true, q: true },
    enpassant: null,
    halfmove: 0,
    fullmove: 1,
    history: [],
  };
}

export function cloneState(s: GameState): GameState {
  return {
    board: s.board.slice(),
    turn: s.turn,
    castling: { ...s.castling },
    enpassant: s.enpassant,
    halfmove: s.halfmove,
    fullmove: s.fullmove,
    history: s.history.slice(),
  };
}

function pieceColor(p: Piece): Side | null {
  if (p === '.') return null;
  return (p === p.toUpperCase()) ? 'w' : 'b';
}

/**
 * 升变目标集合。Piece 约定「大写=白，小写=黑」，所以升变必须按走子方取对应大小写，
 * 否则黑方升变会在盘上留下白后（2026-10-15 修复前 `['Q','R','B','N']` 写死导致）。
 */
const PROMO_PIECES: Record<Side, Piece[]> = {
  w: ['Q', 'R', 'B', 'N'],
  b: ['q', 'r', 'b', 'n'],
};

function fileOf(sq: number) { return sq % 8; }
function rankOf(sq: number) { return Math.floor(sq / 8); }

/** 给定一方的攻击格集合（用于"将军/被将"检测） */
function attackedSquares(board: Piece[], bySide: Side): boolean[] {
  const att = new Array(64).fill(false);
  const addRay = (fromSq: number, dirs: ReadonlyArray<[number, number]>, _stopPiece: Piece[]) => {
    for (const [df, dr] of dirs) {
      let f = fileOf(fromSq) + df, r = rankOf(fromSq) + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const sq = r * 8 + f;
        att[sq] = true;
        const p = board[sq];
        if (p !== '.') {
          if (pieceColor(p) !== bySide) return; // 第一个异己方子挡住
          return; // 同色 = 自己的子也停
        }
        f += df; r += dr;
      }
    }
  };
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p === '.' || pieceColor(p) !== bySide) continue;
    const f = fileOf(sq), r = rankOf(sq);
    const lower = (p === p.toLowerCase());
    switch (p.toLowerCase()) {
      case 'p': {
        // 🔴 2026-10-23 P0 修复：方向曾写成 lower ? 1 : -1，与 legalMoves 的兵行进
        //   方向（:270 lower ? -1 : 1）相反 —— 白兵被标记为攻击"身后一格"。
        //   后果双向：黑王可走入真实规则里被兵攻的格（如 g7→f6 躲 e5 兵），
        //   随后白兵 exf6 直接吃掉黑王、棋盘无王、将杀/逼和检测全部失效；
        //   同时合法着法被幻影攻击拦截（如黑王 g4→f3 被不存在的 e4 兵攻拦掉）。
        //   这里必须与 legalMoves 同源，两侧都要改时一起改。
        const dir = lower ? -1 : 1;
        for (const df of [-1, 1]) {
          const ff = f + df, rr = r + dir;
          if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) att[rr * 8 + ff] = true;
        }
        break;
      }
      case 'n': {
        for (const [df, dr] of [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]] as Array<[number, number]>) {
          const ff = f + df, rr = r + dr;
          if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) att[rr * 8 + ff] = true;
        }
        break;
      }
      case 'b': addRay(sq, [[1,1],[1,-1],[-1,1],[-1,-1]], []); break;
      case 'r': addRay(sq, [[1,0],[-1,0],[0,1],[0,-1]], []); break;
      case 'q': addRay(sq, [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]], []); break;
      case 'k': {
        for (const [df, dr] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as Array<[number, number]>) {
          const ff = f + df, rr = r + dr;
          if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) att[rr * 8 + ff] = true;
        }
        break;
      }
    }
  }
  return att;
}

function findKing(board: Piece[], side: Side): number {
  const k = side === 'w' ? 'K' : 'k';
  for (let sq = 0; sq < 64; sq++) if (board[sq] === k) return sq;
  return -1;
}

export function inCheck(s: GameState, side: Side = s.turn): boolean {
  const att = attackedSquares(s.board, side === 'w' ? 'b' : 'w');
  const kSq = findKing(s.board, side);
  return kSq >= 0 && att[kSq];
}

/** 生成所有合法走子（含王车易位与升变，过滤掉让己方王被将军的走子） */
export function legalMoves(s: GameState): Move[] {
  const out: Move[] = [];
  const board = s.board;
  const turn = s.turn;
  const opp = turn === 'w' ? 'b' : 'w';
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p === '.' || pieceColor(p) !== turn) continue;
    const f = fileOf(sq), r = rankOf(sq);
    const lower = p === p.toLowerCase();
    switch (p.toLowerCase()) {
      case 'p': {
        // 布局：白在底（rank 0-1），黑在顶（rank 6-7）
        // 白兵从 rank 1 向 rank 7 推进 → dir=+1，升变 rank=7
        // 黑兵从 rank 6 向 rank 0 推进 → dir=-1，升变 rank=0
        const dir = lower ? -1 : 1;
        const startRank = lower ? 6 : 1;
        const promoRank = lower ? 0 : 7;
        // 单步前进
        const r1 = r + dir;
        if (r1 >= 0 && r1 < 8 && board[r1 * 8 + f] === '.') {
          if (r1 === promoRank) {
            // 升变 — 生成 4 种。升变目标的大小写必须跟随走子方颜色，
            // 否则黑方升变后盘上会出现白后（Piece 约定：大写=白，小写=黑）。
            for (const promo of PROMO_PIECES[lower ? 'b' : 'w']) {
              const mv: Move = { from: sq, to: r1 * 8 + f, piece: p, promo };
              if (tryApply(s, mv)) out.push(mv);
            }
          } else {
            const mv: Move = { from: sq, to: r1 * 8 + f, piece: p };
            if (tryApply(s, mv)) out.push(mv);
          }
          // 双步前进（仅起始 rank）
          if (r === startRank) {
            const r2 = r + 2 * dir;
            if (board[r2 * 8 + f] === '.' && board[r1 * 8 + f] === '.') {
              const mv: Move = { from: sq, to: r2 * 8 + f, piece: p };
              if (tryApply(s, mv)) out.push(mv);
            }
          }
        }
        // 斜吃
        for (const df of [-1, 1]) {
          const ff = f + df, rr = r + dir;
          if (ff < 0 || ff >= 8 || rr < 0 || rr >= 8) continue;
          const t = board[rr * 8 + ff];
          if (t !== '.' && pieceColor(t) === opp) {
            if (rr === promoRank) {
              for (const promo of PROMO_PIECES[lower ? 'b' : 'w']) {
                const mv: Move = { from: sq, to: rr * 8 + ff, piece: p, capture: t, promo };
                if (tryApply(s, mv)) out.push(mv);
              }
            } else {
              const mv: Move = { from: sq, to: rr * 8 + ff, piece: p, capture: t };
              if (tryApply(s, mv)) out.push(mv);
            }
          }
          // 🔴 吃过路兵（en passant）：目标格为空，但旁边那枚敌兵刚走完双步。
          // s.enpassant 记录的是「下一手可以落子的目标格」（FEN 标准语义）。
          // （2026-10-15 修复：此处曾误加 `rr === promoRank - dir` 条件——promoRank 是升变行，
          //  与吃过路兵无关，该条件恒不成立，导致分支永不可达。另 s.enpassant 原先恒置 null，
          //  分支即使条件正确也永远不触发。）
          else if (t === '.' && s.enpassant === rr * 8 + ff) {
            // 被跳过的敌兵在本兵「起点所在行」的 ff 列
            const victim = board[r * 8 + ff];
            if (victim !== '.' && pieceColor(victim) === opp && victim.toLowerCase() === 'p') {
              const mv: Move = { from: sq, to: rr * 8 + ff, piece: p, capture: victim, enpassant: true };
              if (tryApply(s, mv)) out.push(mv);
            }
          }
        }
        break;
      }
      case 'n': {
        for (const [df, dr] of [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]] as Array<[number, number]>) {
          const ff = f + df, rr = r + dr;
          if (ff < 0 || ff >= 8 || rr < 0 || rr >= 8) continue;
          const t = board[rr * 8 + ff];
          if (t === '.' || pieceColor(t) === opp) {
            const mv: Move = { from: sq, to: rr * 8 + ff, piece: p, capture: t !== '.' ? t : undefined };
            if (tryApply(s, mv)) out.push(mv);
          }
        }
        break;
      }
      case 'b':
      case 'r':
      case 'q': {
        const dirs = p.toLowerCase() === 'b' ? [[1,1],[1,-1],[-1,1],[-1,-1]]
                   : p.toLowerCase() === 'r' ? [[1,0],[-1,0],[0,1],[0,-1]]
                   : [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
        for (const [df, dr] of dirs as Array<[number, number]>) {
          let ff = f + df, rr = r + dr;
          while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
            const t = board[rr * 8 + ff];
            if (t === '.') {
              const mv: Move = { from: sq, to: rr * 8 + ff, piece: p };
              if (tryApply(s, mv)) out.push(mv);
            } else {
              if (pieceColor(t) === opp) {
                const mv: Move = { from: sq, to: rr * 8 + ff, piece: p, capture: t };
                if (tryApply(s, mv)) out.push(mv);
              }
              break;
            }
            ff += df; rr += dr;
          }
        }
        break;
      }
      case 'k': {
        for (const [df, dr] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as Array<[number, number]>) {
          const ff = f + df, rr = r + dr;
          if (ff < 0 || ff >= 8 || rr < 0 || rr >= 8) continue;
          const t = board[rr * 8 + ff];
          if (t === '.' || pieceColor(t) === opp) {
            const mv: Move = { from: sq, to: rr * 8 + ff, piece: p, capture: t !== '.' ? t : undefined };
            if (tryApply(s, mv)) out.push(mv);
          }
        }
        // 王车易位
        const kSq = sq;
        const inCheckNow = inCheck(s, turn);
        if (!inCheckNow) {
          const sideKey = turn === 'w' ? 'K' : 'k';
          // 王翼
          if (s.castling[sideKey as 'K']) {
            if (board[kSq + 1] === '.' && board[kSq + 2] === '.' &&
                !attackedSquares(board, opp)[kSq + 1] && !attackedSquares(board, opp)[kSq + 2]) {
              const rookSq = kSq + 3;
              if (board[rookSq].toLowerCase() === 'r') {
                const mv: Move = { from: kSq, to: kSq + 2, piece: p, castle: 'K' };
                if (tryApply(s, mv)) out.push(mv);
              }
            }
          }
          const qKey = turn === 'w' ? 'Q' : 'q';
          if (s.castling[qKey as 'Q']) {
            if (board[kSq - 1] === '.' && board[kSq - 2] === '.' && board[kSq - 3] === '.' &&
                !attackedSquares(board, opp)[kSq - 1] && !attackedSquares(board, opp)[kSq - 2]) {
              const rookSq = kSq - 4;
              if (board[rookSq].toLowerCase() === 'r') {
                const mv: Move = { from: kSq, to: kSq - 2, piece: p, castle: 'Q' };
                if (tryApply(s, mv)) out.push(mv);
              }
            }
          }
        }
        break;
      }
    }
  }
  return out;
}

/** 测试：模拟 m 走子后**走子方**的王不被将军 → 合法
 *  ⚠️ 必须**原地**还原（不能替换 s.board 引用），否则 legalMoves 循环里缓存的
 *  board 引用会变成"野数组"，读到已被 applyMove 改过、却不再属于 s 的幽灵棋子。 */
function tryApply(s: GameState, m: Move): boolean {
  const mover = s.turn;          // applyMove 会翻转 turn，必须先捕获
  const saveBoard = s.board.slice();
  const saveTurn = s.turn;
  const saveCastling = { ...s.castling };
  const saveEnpassant = s.enpassant;
  const saveHalf = s.halfmove;
  const saveFull = s.fullmove;
  const saveHistLen = s.history.length;

  applyMove(s, m);
  // 🔴 2026-10-23 P0 护栏：任何着法都不得以对方王为捕获目标。
  //   正常对局不可达（双方着法都被 self-check 过滤，对方王不可能留着被吃），
  //   但一旦有别的问题漏出非法局面（如修复前的兵攻方向 bug：黑王走入被攻格），
  //   旧逻辑只会检查"自己王是否安全"，于是白兵 exf6 真的把黑王吃掉、
  //   棋盘从此无王、将杀/逼和检测全部失效。这里把"吃王"结构性堵死。
  const noKingCapture = m.capture !== 'k' && m.capture !== 'K';
  const ok = noKingCapture && !inCheck(s, mover);

  // 原地还原
  for (let i = 0; i < 64; i++) s.board[i] = saveBoard[i];
  s.turn = saveTurn;
  s.castling = saveCastling;
  s.enpassant = saveEnpassant;
  s.halfmove = saveHalf;
  s.fullmove = saveFull;
  s.history.length = saveHistLen;
  return ok;
}

/** 直接走子（不做合法性校验） */
export function applyMove(s: GameState, m: Move): void {
  const turn = s.turn;
  const piece = s.board[m.from];
  const fromRank = Math.floor(m.from / 8);
  const toFile = m.to % 8;
  const toRank = Math.floor(m.to / 8);
  s.board[m.from] = '.';
  s.board[m.to] = m.promo ? m.promo : piece;

  // 🔴 吃过路兵：被吃的敌兵不在 m.to 那一格，而在「与 m.from 同行、m.to 所在列」的被跳过格
  if (m.enpassant) {
    s.board[toFile + fromRank * 8] = '.';
  }

  // 王车易位：搬车
  if (m.castle) {
    const kSq = m.from;
    if (m.castle === 'K') {
      s.board[kSq + 3] = '.';
      s.board[kSq + 1] = turn === 'w' ? 'R' : 'r';
    } else {
      s.board[kSq - 4] = '.';
      s.board[kSq - 1] = turn === 'w' ? 'R' : 'r';
    }
  }

  // 王/车移动 → 清王车易位许可
  if (piece.toLowerCase() === 'k') {
    if (turn === 'w') { s.castling.K = false; s.castling.Q = false; }
    else { s.castling.k = false; s.castling.q = false; }
  } else if (piece.toLowerCase() === 'r') {
    if (turn === 'w') {
      if (m.from === 0) s.castling.Q = false;
      if (m.from === 7) s.castling.K = false;
    } else {
      if (m.from === 56) s.castling.q = false;
      if (m.from === 63) s.castling.k = false;
    }
  }
  // 对面车也可能被吃
  if (m.to === 0) s.castling.Q = false;
  if (m.to === 7) s.castling.K = false;
  if (m.to === 56) s.castling.q = false;
  if (m.to === 63) s.castling.k = false;

  // 半步数（吃子或兵走 = 重置，否则 +1）
  const isCapture = m.capture !== undefined && m.capture !== '.';
  const isPawn = piece.toLowerCase() === 'p';
  s.halfmove = (isCapture || isPawn) ? 0 : s.halfmove + 1;
  if (turn === 'b') s.fullmove++;

  // 切换走子方
  s.turn = turn === 'w' ? 'b' : 'w';
  // 🔴 双步推进 → 记录「下一手可落子的目标格」（FEN 标准语义）：
  //    兵从 fromRank 跳到 toRank，被跳过格是中间格，也是对方吃过路兵时的落点。
  //    修复前此处无条件置 null，en passant 分支因此永远不触发。
  const isDoublePawn = isPawn && Math.abs(toRank - fromRank) === 2;
  s.enpassant = isDoublePawn ? (toFile + Math.floor((fromRank + toRank) / 2) * 8) : null;
  s.history.push(m);
}

/**
 * 全局评估：从 'w' 视角的子力和，正 = 白好
 *
 * 🔴 机动性项会调用 legalMoves 两次（当前方 + 翻转 turn 后的对方），
 *    而 alphabeta 的叶子节点在调用本函数之前**已经算过一次 legalMoves**
 *    （见 alphabeta 里的 `moves` 变量）。三份走法里有一份是纯浪费，
 *    而 depth=6 时叶子节点数量最大 —— 这正是最该省的地方。
 *
 * `myMovesCount` 由调用方传入已算好的走法数；不传则自行生成
 * （保留给 evaluate() 的独立调用方，如 selfTest / 调试）。
 */
export function evaluate(s: GameState, myMovesCount?: number): number {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = s.board[sq];
    if (p === '.') continue;
    const v = PIECE_VAL[p];
    const col = pieceColor(p);
    const pst = col ? (PST as any)[p][col]?.[sq] || 0 : 0;
    if (col === 'w') score += v + pst;
    else if (col === 'b') score -= v + pst;
  }
  // 机动性
  if (!s.turn) return score;
  const myM = myMovesCount ?? legalMoves(s).length;
  s.turn = s.turn === 'w' ? 'b' : 'w';
  const opM = legalMoves(s).length;
  s.turn = s.turn === 'b' ? 'w' : 'b';
  score += (myM - opM) * 5;
  return score;
}

/** αβ 搜索 */
function alphabeta(s: GameState, depth: number, alpha: number, beta: number, maximizing: boolean, deadline: number): number {
  if (Date.now() > deadline) return evaluate(s);
  const moves = legalMoves(s);
  if (depth === 0 || moves.length === 0) {
    if (moves.length === 0) {
      // 无子可走 = 将杀/逼和
      if (inCheck(s, s.turn)) {
        return maximizing ? -99999_999 : 99999_999; // 我方被将杀
      }
      return 0; // 逼和
    }
    // 复用已算好的 moves 长度，省掉 evaluate 内部第三次生成
    return evaluate(s, moves.length);
  }

  // move ordering：吃子先按 MVV-LVA（最大被吃 - 最小攻击者）
  moves.sort((a, b) => {
    const av = a.capture ? PIECE_VAL[a.capture] - PIECE_VAL[a.piece] / 10 : 0;
    const bv = b.capture ? PIECE_VAL[b.capture] - PIECE_VAL[b.piece] / 10 : 0;
    return bv - av;
  });

  let best = maximizing ? -Infinity : Infinity;
  for (const m of moves) {
    const save = cloneState(s);
    applyMove(s, m);
    const v = alphabeta(s, depth - 1, alpha, beta, !maximizing, deadline);
    Object.assign(s, save);
    if (maximizing) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (beta <= alpha) break;
  }
  return best;
}

export function bestMove(s: GameState, difficulty: Difficulty, timeBudget = 1500): Move | null {
  const moves = legalMoves(s);
  if (moves.length === 0) return null;

  let depth = 2;
  if (difficulty === 'medium') depth = 4;
  if (difficulty === 'hard') depth = 6;

  const deadline = Date.now() + timeBudget;
  const maximizing = s.turn === 'w';

  // iterative deepening
  let bestM = moves[0];
  for (let d = 1; d <= depth; d++) {
    let curBest = moves[0];
    let curS = maximizing ? -Infinity : Infinity;
    for (const m of moves) {
      const save = cloneState(s);
      applyMove(s, m);
      const v = alphabeta(s, d - 1, -Infinity, Infinity, !maximizing, deadline);
      Object.assign(s, save);
      if (Date.now() > deadline) break;
      if (maximizing ? v > curS : v < curS) {
        curS = v;
        curBest = m;
      }
    }
    if (Date.now() > deadline) break;
    bestM = curBest;
  }
  return bestM;
}

export function selfTest(): { ok: boolean; details: string[] } {
  const details: string[] = [];
  let ok = true;
  const s = initialState();
  const moves = legalMoves(s);
  if (moves.length !== 20) {
    ok = false;
    details.push('initial legal moves should be 20, got ' + moves.length);
  }
  if (inCheck(s)) {
    ok = false;
    details.push('initial position should not be in check');
  }
  // 白王必须在底排 (rank 0)，即 e1 = sq 4 — 防止布局上下颠倒
  if (s.board[4] !== 'K') {
    ok = false;
    details.push('white king should be on e1 (sq 4), got ' + s.board[4]);
  }
  if (s.board[60] !== 'k') {
    ok = false;
    details.push('black king should be on e8 (sq 60), got ' + s.board[60]);
  }
  // 白兵在 rank 1（sq 8..15），黑兵在 rank 6（sq 48..55）
  if (s.board[12] !== 'P' || s.board[52] !== 'p') {
    ok = false;
    details.push('pawns misplaced: sq12=' + s.board[12] + ' sq52=' + s.board[52]);
  }
  // 白方应有 16 个合法起点走法 = 16 (兵) + 4 (马) = 20
  const pawnMoves = moves.filter((m) => m.piece === 'P').length;
  const knightMoves = moves.filter((m) => m.piece === 'N').length;
  if (pawnMoves !== 16 || knightMoves !== 4) {
    ok = false;
    details.push('expected 16 pawn + 4 knight moves, got ' + pawnMoves + ' + ' + knightMoves);
  }
  // 走 1.e4 后局面应当合法（不在将）且轮到黑
  const e4 = moves.find((m) => m.from === 12 && m.to === 28);
  if (!e4) {
    ok = false;
    details.push('1.e4 (sq12->sq28) should be legal');
  } else {
    applyMove(s, e4);
    if (inCheck(s, 'w')) {
      ok = false;
      details.push('after 1.e4 white should not be in check');
    }
    if (s.turn !== 'b') {
      ok = false;
      details.push('after white move turn should be black, got ' + s.turn);
    }
    // 黑方同位置也应有 20 步
    const bm = legalMoves(s);
    if (bm.length !== 20) {
      ok = false;
      details.push('black reply count should be 20, got ' + bm.length);
    }
  }
  // 王车易位：清空 f1/g1 后白方应能 O-O
  const c = initialState();
  c.board[5] = '.'; c.board[6] = '.';
  const canCastleK = legalMoves(c).some((m) => m.castle === 'K');
  if (!canCastleK) {
    ok = false;
    details.push('white should be able to castle kingside after clearing f1/g1');
  }
  // ── 兵攻击方向回归（2026-10-23 P0 修复的护栏）──
  //   修复前 attackedSquares 的兵方向与 legalMoves 写反，而本 selfTest 对此路径
  //   零覆盖，所以缺陷带着"自检全绿"上线。以下三个局面把两个失败方向都钉死：
  //   ① 漏标（该攻没攻）：黑王走进被兵攻的格 → 之后兵能直接吃王
  //   ② 幻影（不该攻标了攻）：合法着法被不存在的兵攻拦掉
  const noCastle = { K: false, Q: false, k: false, q: false };
  const mini = (pieces: Array<[number, Piece]>, turn: Side): GameState => {
    const b: Piece[] = new Array(64).fill('.');
    for (const [sq, p] of pieces) b[sq] = p;
    return { board: b, turn, castling: { ...noCastle }, enpassant: null, halfmove: 0, fullmove: 1, history: [] };
  };
  // ① 白兵 e5(sq36) 攻 d6(sq43)/f6(sq45)：黑王落 d6 必须处于被将状态
  const pa = mini([[0, 'K'], [36, 'P'], [43, 'k']], 'b');
  if (!inCheck(pa, 'b')) {
    ok = false;
    details.push('pawn attack: black king on d6 must be in check from white pawn e5');
  }
  // ② 同盘黑王在 g7(sq54)：f6(sq45) 被 e5 兵攻 → 不合法；f7(sq53) 合法
  const pb = mini([[0, 'K'], [36, 'P'], [54, 'k']], 'b');
  const kMoves = legalMoves(pb).filter((m) => m.from === 54);
  if (kMoves.some((m) => m.to === 45)) {
    ok = false;
    details.push('pawn attack: black king g7->f6 must be illegal (attacked by pawn e5)');
  }
  if (!kMoves.some((m) => m.to === 53)) {
    ok = false;
    details.push('pawn attack: black king g7->f7 should be legal');
  }
  // ③ 反向幻影：白兵 e4(sq28) 只攻 d5(sq35)/f5(sq37)，不碰 f3(sq21)。
  //    黑王 g4(sq30)→f3 必须合法；→f5 必须不合法（两端同时防住）
  const pc = mini([[0, 'K'], [28, 'P'], [30, 'k']], 'b');
  const cMoves = legalMoves(pc);
  if (!cMoves.some((m) => m.from === 30 && m.to === 21)) {
    ok = false;
    details.push('pawn attack: black king g4->f3 should be legal (pawn e4 does not attack f3)');
  }
  if (cMoves.some((m) => m.from === 30 && m.to === 37)) {
    ok = false;
    details.push('pawn attack: black king g4->f5 must be illegal (attacked by pawn e4)');
  }
  return { ok, details };
}