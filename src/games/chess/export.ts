/**
 * 国际象棋 PGN 导出（2026-10-24 第四批 ⑰）
 * ------------------------------------------------------------
 * SAN 生成需要「同回合合法着法」做同子力消歧（Nbd2 / R1e2 / Qh4e1），
 * 因此必须 import 本游戏引擎，放在 games/chess/ 下而非 shared/。
 *
 * 联机 wire 着法只有 {from,to,promotion}（castle/enpassant 标记丢失，
 * 见审计 P1），这里用 from+to(+promo) 在合法着法里反查匹配，兼容两种来源。
 */
import {
  initialState, legalMoves, applyMove, inCheck,
  type Move, type GameState, type Side, type Piece,
  // 注意：带 .ts 后缀，好让 node --experimental-strip-types 单测也能解析
} from './engine.ts';

const FILES = 'abcdefgh';

/**
 * 0-63 → 'e4'。⚠️ 引擎索引口径：row0 = 白方底线（a1=0, h8=63），
 * 与渲染层的 squareXY（y = 7-row）是同一套 row。别写成 8-row。
 */
export function sqName(sq: number): string {
  return FILES[sq % 8] + String(Math.floor(sq / 8) + 1);
}

const PIECE_LETTER: Record<string, string> = { P: '', N: 'N', B: 'B', R: 'R', Q: 'Q', K: 'K' };

/** 单手 SAN（不含 +/# 终局标记，由调用方补） */
function sanOf(gs: GameState, m: Move): string {
  if (m.castle) return m.castle === 'K' ? 'O-O' : 'O-O-O';
  const p = m.piece;
  const upper = p.toUpperCase() as 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';
  const dest = sqName(m.to);
  if (upper === 'P') {
    let s = m.capture ? `${FILES[m.from % 8]}x${dest}` : dest;
    if (m.promo) s += `=${PIECE_LETTER[m.promo.toUpperCase()]}`;
    return s;
  }
  // 同子力同落点消歧：优先文件，再-row，再 both
  const rivals = legalMoves(gs).filter((x) => x.piece.toUpperCase() === upper && x.to === m.to && x.from !== m.from);
  let disamb = '';
  if (rivals.length) {
    const sameFile = rivals.some((x) => x.from % 8 === m.from % 8);
    const sameRank = rivals.some((x) => Math.floor(x.from / 8) === Math.floor(m.from / 8));
    if (!sameFile) disamb = FILES[m.from % 8];
    else if (!sameRank) disamb = String(Math.floor(m.from / 8) + 1);
    else disamb = sqName(m.from);
  }
  return `${PIECE_LETTER[upper]}${disamb}${m.capture && m.capture !== '.' ? 'x' : ''}${dest}`;
}

export interface PgnMeta {
  blackName?: string;
  whiteName?: string;
  /** '1-0' | '0-1' | '1/2-1/2' | '*' */
  result?: string;
  event?: string;
  date?: string; // YYYY.MM.DD
}

/**
 * 由着法序列生成 PGN。会重放整局判定终局标记（+ / #）。
 * 遇到无法匹配合法着法的着法（异常帧）即截断，保证输出仍是合法 PGN。
 */
export function buildPgn(moves: Move[], meta: PgnMeta = {}): string {
  let gs: GameState = initialState();
  const tokens: string[] = [];
  let ply = 0;
  let truncated = false;
  for (const m of moves) {
    const legal = legalMoves(gs);
    let match: Move | undefined = legal.find((x) => x.from === m.from && x.to === m.to
      && (x.promo ?? undefined) === (m.promo ?? undefined)
      && (x.castle ?? undefined) === (m.castle ?? undefined));
    if (!match) match = legal.find((x) => x.from === m.from && x.to === m.to);
    if (!match) { truncated = true; break; }
    const san = sanOf(gs, match);
    applyMove(gs, match);
    // 终局标记：对手被将且无合法着法 = 将杀(#)，仅被将 = +
    const opp: Side = gs.turn;
    let mark = '';
    if (inCheck(gs, opp)) {
      mark = legalMoves(gs).length === 0 ? '#' : '+';
    }
    if (ply % 2 === 0) tokens.push(`${ply / 2 + 1}.`);
    tokens.push(san + mark);
    ply++;
  }

  // 未显式给结果时由终局局面推导：将杀→走子方负；逼和/无合法着法→和；否则进行中
  let result = meta.result;
  if (!result) {
    const noMove = legalMoves(gs).length === 0;
    result = !noMove ? '*' : inCheck(gs, gs.turn)
      ? (gs.turn === 'w' ? '0-1' : '1-0')
      : '1/2-1/2';
  }
  const tags: string[] = [
    '[Event "' + (meta.event ?? 'BoardDuel game') + '"]',
    '[Site "boardduel.com"]',
    `[Date "${meta.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.')}"]`,
    '[Round "-"]',
    `[White "${meta.whiteName ?? 'White'}"]`,
    `[Black "${meta.blackName ?? 'Black'}"]`,
    `[Result "${result}"]`,
  ];
  let movetext = tokens.join(' ');
  if (truncated) movetext += ' {truncated: unmatched move}';
  movetext += ` ${result}`;
  return tags.join('\n') + '\n\n' + movetext + '\n';
}

/**
 * 终局结果串：由终局局面推导（将杀/逼和/子力不足等）。
 * resign/超时等非棋盘终局由调用方直接给值。
 */
export function chessResultFromState(moves: Move[], fellByResign: Side | null): '1-0' | '0-1' | '1/2-1/2' | '*' {
  if (fellByResign === 'w') return '0-1';
  if (fellByResign === 'b') return '1-0';
  let gs: GameState = initialState();
  for (const m of moves) {
    const legal = legalMoves(gs);
    const match = legal.find((x) => x.from === m.from && x.to === m.to
      && (x.promo ?? undefined) === (m.promo ?? undefined)) ?? legal.find((x) => x.from === m.from && x.to === m.to);
    if (!match) return '*';
    applyMove(gs, match);
  }
  if (legalMoves(gs).length === 0) {
    return inCheck(gs, gs.turn) ? (gs.turn === 'w' ? '0-1' : '1-0') : '1/2-1/2';
  }
  return '*';
}

/** 供测试：判定某着法是否为该局面合法着法 */
export function findLegal(gs: GameState, m: Move): Move | undefined {
  return legalMoves(gs).find((x) => x.from === m.from && x.to === m.to);
}

export type { Move, Piece };
