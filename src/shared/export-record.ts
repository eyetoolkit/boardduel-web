/**
 * 棋谱导出 · 共享层（2026-10-24 第四批 ⑰）
 * ------------------------------------------------------------
 * 覆盖三种记录格式：
 *   ① SGF（FF[4]）——围棋/五子棋。aa = 左上角，列 = 'a'+col、行 = 'a'+row。
 *      19×19 的 pass 记作 tt（FF[4] 惯例），其余棋盘 pass 记作空着法 B[]。
 *   ② PGN——国际象棋。SAN 生成在 games/chess/export.ts（需要引擎合法着法
 *      做同子力消歧，不能放共享层）。
 *   ③ 通用着法文本——其余棋盘游戏，一行一手，附带结果行。
 *
 * 下载统一走 Blob + a[download]，不依赖任何外部库。
 */

/** 触发浏览器下载文本文件 */
export function downloadRecord(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** SGF 坐标：0 基 (col,row) → 两位小写字母（aa = 左上） */
export function sgfCoord(col: number, row: number): string {
  return String.fromCharCode(97 + col) + String.fromCharCode(97 + row);
}

/** 导出文件名：boardduel-<game>-<yyyymmdd-hhmm>.<ext> */
export function recordFilename(game: string, ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `boardduel-${game}-${stamp}.${ext}`;
}

export type SgfColor = 1 | 2; // 1 = 黑(B)  2 = 白(W)

export interface SgfOpts {
  /** 棋盘边长（15/19） */
  size: number;
  /** 着法序列：点下标（0 基，row*size+col）；-1 = pass */
  moves: number[];
  /** 先手颜色（默认 1=黑） */
  firstColor?: SgfColor;
  /** 贴目（围棋；五子棋省略） */
  komi?: number;
  /** 结果：'B+R' / 'W+7.5' / 'Draw' / ''（未知） */
  result?: string;
  blackName?: string;
  whiteName?: string;
  /** 对局名（GN[]） */
  gameName?: string;
  /** 规则（围棋 RU[]） */
  rules?: string;
  /** 日期 YYYY-MM-DD（默认今天） */
  date?: string;
  /** 备注（C[]）——用来放终局判词等自由文本 */
  comment?: string;
}

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/]/g, '\\]');

/**
 * 生成 SGF（围棋/五子棋通用）。
 * 例：(;GM[1]FF[4]CA[UTF-8]SZ[15]KM[0]GN[Gomoku]RE[];B[hh];W[ij])
 */
export function buildSgf(o: SgfOpts): string {
  const first: SgfColor = o.firstColor ?? 1;
  const size = o.size;
  const passCoord = size === 19 ? 'tt' : '';
  let out = '(;GM[1]FF[4]CA[UTF-8]';
  out += `AP[BoardDuel:1.0]SZ[${size}]`;
  if (o.komi !== undefined) out += `KM[${o.komi}]`;
  if (o.rules) out += `RU[${esc(o.rules)}]`;
  if (o.gameName) out += `GN[${esc(o.gameName)}]`;
  if (o.blackName) out += `PB[${esc(o.blackName)}]`;
  if (o.whiteName) out += `PW[${esc(o.whiteName)}]`;
  out += `RE[${esc(o.result ?? '')}]`;
  if (o.comment) out += `C[${esc(o.comment)}]`;
  out += `DT[${o.date ?? new Date().toISOString().slice(0, 10)}]`;
  for (let k = 0; k < o.moves.length; k++) {
    const color: 'B' | 'W' = (k % 2 === 0 ? first : (first === 1 ? 2 : 1)) === 1 ? 'B' : 'W';
    const i = o.moves[k];
    if (i < 0) {
      out += `;${color}[${passCoord}]`;
    } else {
      out += `;${color}[${sgfCoord(i % size, Math.floor(i / size))}]`;
    }
  }
  return out + ')\n';
}

export interface MoveListOpts {
  /** 每手文本（不含编号），按顺序 */
  moves: string[];
  /** 结果行（如 'Result: black wins' / 'Result: draw'） */
  result?: string;
  /** 文件头标题 */
  title?: string;
  /** 附加元信息行 */
  meta?: string[];
}

/** 通用着法文本：编号 + 每手一行，尾附结果 */
export function buildMoveList(o: MoveListOpts): string {
  const lines: string[] = [];
  lines.push(`# ${o.title ?? 'BoardDuel game record'}`);
  lines.push(`# date: ${new Date().toISOString()}`);
  for (const m of o.meta ?? []) lines.push(`# ${m}`);
  lines.push('');
  for (let k = 0; k < o.moves.length; k++) {
    lines.push(`${k + 1}. ${o.moves[k]}`);
  }
  if (o.result) lines.push('', o.result);
  return lines.join('\n') + '\n';
}

/** SGF 结果串：winner 为 1(黑)/2(白)/0(和) */
export function sgfResult(winner: 0 | 1 | 2, margin?: string): string {
  if (winner === 0) return 'Draw';
  return (winner === 1 ? 'B+' : 'W+') + (margin ?? 'R');
}
