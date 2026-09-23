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
  // 白兵方向 dir=-1（rank 递减，向顶推进），起点 rank=6
  // 黑兵方向 dir=+1（rank 递增，向底推进），起点 rank=1
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
        const dir = lower ? 1 : -1;
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
            // 升变 — 生成 4 种
            for (const promo of ['Q','R','B','N'] as Piece[]) {
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
              for (const promo of ['Q','R','B','N'] as Piece[]) {
                const mv: Move = { from: sq, to: rr * 8 + ff, piece: p, capture: t, promo };
                if (tryApply(s, mv)) out.push(mv);
              }
            } else {
              const mv: Move = { from: sq, to: rr * 8 + ff, piece: p, capture: t };
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
  const ok = !inCheck(s, mover);

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
  s.board[m.from] = '.';
  s.board[m.to] = m.promo ? m.promo : piece;

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
  s.enpassant = null;
  s.history.push(m);
}

/** 全局评估：从 'w' 视角的子力和，正 = 白好 */
export function evaluate(s: GameState): number {
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
  const myM = legalMoves(s).length;
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
    return evaluate(s);
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
  return { ok, details };
}