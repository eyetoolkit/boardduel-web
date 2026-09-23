/**
 * BoardDuel · Chess (8×8) · 完整可玩（click-click 操作）
 * 玩家执白，AI 执黑。点击你的棋子 → 再点目的地。
 */
import {
  setupNav,
  startTimer, stopTimer, createTimer, fmtClock,
  toast, type Mode, type Difficulty,
} from '../game-core';
import {
  initialState, cloneState, legalMoves, applyMove, bestMove,
  type GameState as CS, type Side as CSide, type Move as CMove, type Piece as CPiece,
} from './engine';

const SLOT = 540;
const PAD = 16;
const CELL = (SLOT - 2 * PAD) / 8;

const boardEl = document.getElementById('bd-board') as HTMLDivElement;
const turnEl  = document.getElementById('bd-turn-v') as HTMLSpanElement;
const timeEl  = document.getElementById('bd-time-v') as HTMLSpanElement;
const statusEl = document.getElementById('bd-status-v') as HTMLSpanElement;
const modeEl  = document.getElementById('bd-mode-v') as HTMLSpanElement;
const newBtn  = document.getElementById('bd-new') as HTMLButtonElement;
const undoBtn = document.getElementById('bd-undo') as HTMLButtonElement;

setupNav('chess');

// 棋子 SVG（去色版：白=W， 黑=B）
const PIECE_G: Record<string, string> = {
  K: '<path d="M11.5 8.5h4.6v3.6h2.7V8.5h2.4v3.6h2.7V8.5h4.6V17h-17zM14.5 17h11l2 21.5h-15zM10.5 38.5h19v3.5h-19z" stroke="#0A0F14" stroke-width="0.5"/>',
  Q: '<path d="M11.5 17.5 13 8l4.5 6L20 6.5 22.5 14 27 8l1.5 9.5zM13 20.5h14l2.5 18h-19zM10.5 38.5h19v3.5h-19z" stroke="#0A0F14" stroke-width="0.5"/>',
  R: '<path d="M11.5 8.5h4.6v3.6h2.7V8.5h2.4v3.6h2.7V8.5h4.6V17h-17zM14.5 17h11l2 21.5h-15zM10.5 38.5h19v3.5h-19z" stroke="#0A0F14" stroke-width="0.5"/>',
  B: '<path d="M11.5 17.5l3.5-9.5h10l3.5 9.5zM13 20.5h14l2.5 18h-19zM10.5 38.5h19v3.5h-19z" stroke="#0A0F14" stroke-width="0.5"/>',
  N: '<path d="M22 8l-3-3-3 3 3 3v6l-5 5 1 2h17l1-2-5-5V8l3-3-3-3-3 3zM14.5 26h11v12.5h-11zM10.5 38.5h19v3.5h-19z" stroke="#0A0F14" stroke-width="0.5"/>',
  P: '<path d="M19.5 17l-3-3-3 3 3 3v8h-4l-1 8.5h14l-1-8.5h-4v-8zM10.5 38.5h19v3.5h-19z" stroke="#0A0F14" stroke-width="0.5"/>',
};

const state = {
  mode: 'ai' as Mode,
  level: 'medium' as Difficulty,
  gs: initialState() as CS,
  selected: -1,
  lastMove: null as CMove | null,
  over: false,
  history: [] as CS[],
  timer: createTimer(),
};

function squareXY(sq: number): [number, number] {
  // 引擎 rank 0 = 白方底线。渲染时上下翻转，让白（玩家）在屏幕底部。
  return [sq % 8, 7 - Math.floor(sq / 8)];
}

/** 人类当前执哪一方。
 *  vs AI：永远执白；Pass & Play：每步由 gs.turn 决定，双方都能落子。 */
function humanSide(): CSide {
  return state.mode === 'ai' ? 'w' : state.gs.turn;
}

function pieceSvg(p: CPiece, sq: number): string {
  const kind = p.toLowerCase();
  if (kind === '.') return '';
  const [x, y] = squareXY(sq);
  const cx = PAD + x * CELL + CELL / 2;
  const cy = PAD + y * CELL + CELL / 2;
  const isWhite = p === p.toUpperCase();
  // 白子：奶白色实心 + 深色描边；黑子：墨黑实心 + 浅灰描边
  const body = isWhite ? '#F4F6F2' : '#111A21';
  const edge = isWhite ? '#0A0F14' : '#7C8B95';
  const glyph = PIECE_G[kind.toUpperCase()].replace(/stroke="#0A0F14"/g, `stroke="${edge}"`);
  const w = CELL * 0.74;
  const ox = cx - w / 2, oy = cy - w / 2;
  return `<g class="ch-piece" transform="translate(${ox} ${oy}) scale(${w / 40})" fill="${body}" pointer-events="none">`
    + `<g stroke="${edge}" stroke-width="1.1" stroke-linejoin="round" fill="${body}">${glyph}</g>`
    + '</g>';
}

function render(): void {
  let lines = '';
  for (let r = 1; r < 8; r++) {
    const y = PAD + r * CELL;
    lines += `<line x1="${PAD}" y1="${y}" x2="${SLOT - PAD}" y2="${y}" stroke="#2A3741" stroke-width="0.6"/>`;
  }
  for (let c = 1; c < 8; c++) {
    const x = PAD + c * CELL;
    lines += `<line x1="${x}" y1="${PAD}" x2="${x}" y2="${SLOT - PAD}" stroke="#2A3741" stroke-width="0.6"/>`;
  }

  // 浅色格（棋盘格交替）
  let squares = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const fill = (r + c) % 2 === 0 ? '#1C262E' : '#151D24';
      squares += `<rect x="${PAD + c * CELL}" y="${PAD + r * CELL}" width="${CELL}" height="${CELL}" fill="${fill}"/>`;
    }
  }

  // 上一步标记
  let lastMark = '';
  if (state.lastMove) {
    for (const sq of [state.lastMove.from, state.lastMove.to]) {
      const [x, y] = squareXY(sq);
      const cx = PAD + x * CELL + CELL / 2;
      const cy = PAD + y * CELL + CELL / 2;
      lastMark += `<circle cx="${cx}" cy="${cy}" r="5" fill="rgba(242, 193, 78, .55)"/>`;
    }
  }

  // 选中 + 可走目标（只在自己回合显示）
  let selMarks = '';
  let hitAreas = '';
  const human = humanSide();
  if (state.selected >= 0 && human === state.gs.turn && !state.over) {
    const [sx, sy] = squareXY(state.selected);
    const cx = PAD + sx * CELL + CELL / 2;
    const cy = PAD + sy * CELL + CELL / 2;
    selMarks += `<rect x="${PAD + sx * CELL}" y="${PAD + sy * CELL}" width="${CELL}" height="${CELL}" fill="rgba(255, 106, 60, .35)"/>`;
    selMarks += `<circle cx="${cx}" cy="${cy}" r="6" fill="none" stroke="#FF6A3C" stroke-width="2"/>`;
    const moves = legalMoves(state.gs).filter((m) => m.from === state.selected);
    for (const m of moves) {
      const [mx, my] = squareXY(m.to);
      const mcx = PAD + mx * CELL + CELL / 2;
      const mcy = PAD + my * CELL + CELL / 2;
      const cap = state.gs.board[m.to] !== '.';
      selMarks += cap
        ? `<circle cx="${mcx}" cy="${mcy}" r="${CELL / 2 - 2}" fill="none" stroke="#FF6A3C" stroke-width="2"/>`
        : `<circle cx="${mcx}" cy="${mcy}" r="5" fill="#FF6A3C"/>`;
    }
  }

  // 命中区（轮到人类一方时才给点击区）
  if (!state.over && human === state.gs.turn) {
    const moves = legalMoves(state.gs);
    if (state.selected < 0) {
      const fromSqs = new Set(moves.map((m) => m.from));
      for (const sq of fromSqs) {
        const [x, y] = squareXY(sq);
        hitAreas += `<g class="ch-cell" data-sq="${sq}" style="cursor:pointer">
          <rect class="hit" x="${PAD + x * CELL}" y="${PAD + y * CELL}" width="${CELL}" height="${CELL}" fill="transparent"/>
        </g>`;
      }
    } else {
      for (const m of moves.filter((m) => m.from === state.selected)) {
        const [mx, my] = squareXY(m.to);
        hitAreas += `<g class="ch-cell" data-to="${m.to}" style="cursor:pointer">
          <rect class="hit" x="${PAD + mx * CELL}" y="${PAD + my * CELL}" width="${CELL}" height="${CELL}" fill="transparent"/>
        </g>`;
      }
    }
  }

  // 棋子
  let pieces = '';
  for (let i = 0; i < 64; i++) {
    if (state.gs.board[i] !== '.') pieces += pieceSvg(state.gs.board[i], i);
  }

  boardEl.innerHTML = `<svg viewBox="0 0 ${SLOT} ${SLOT}" aria-label="Chess board">
    <rect x="0" y="0" width="${SLOT}" height="${SLOT}" fill="#151D24" rx="6"/>
    ${squares}${lines}${lastMark}${selMarks}${pieces}${hitAreas}
  </svg>`;
  boardEl.querySelectorAll<SVGGElement>('.ch-cell').forEach((g) => {
    g.addEventListener('click', () => {
      const sq = g.dataset.sq;
      const to = g.dataset.to;
      if (sq !== undefined) {
        state.selected = Number(sq);
        render();
      } else if (to !== undefined) {
        const m = legalMoves(state.gs).find((mm) => mm.from === state.selected && mm.to === Number(to));
        if (m) {
          state.history.push(cloneState(state.gs));
          applyMove(state.gs, m);
          state.lastMove = m;
          state.selected = -1;
          afterMove();
        }
      }
    });
  });

  // HUD
  const counts = state.gs.board.reduce((acc, v) => {
    if (v !== '.') acc[v === v.toUpperCase() ? 0 : 1]++;
    return acc;
  }, [0, 0]);
  turnEl.textContent = state.over
    ? '— game over —'
    : state.mode === 'pass'
      ? (state.gs.turn === 'w' ? 'White (P1)' : 'Black (P2)')
      : state.gs.turn === 'w' ? 'You (White)' : 'AI (Black)';
  turnEl.className = 'bd-hud-v ' + (state.over ? '' : state.mode === 'ai' && state.gs.turn === 'b' ? 'bd-turn-ai' : 'bd-turn-you');
  statusEl.textContent = state.over
    ? `W ${counts[0]} · B ${counts[1]}`
    : state.mode === 'pass'
      ? (state.gs.turn === 'w' ? 'white to move' : 'black to move')
      : (state.gs.turn === 'w' ? 'your turn' : 'AI thinking');
  modeEl.textContent = state.mode === 'ai' ? 'vs AI · ' + state.level : 'Pass & Play';
}

function afterMove(): void {
  // 检查对手无子下 → 跳过 / 终局
  const moves = legalMoves(state.gs);
  if (moves.length === 0) {
    state.over = true;
    stopTimer(state.timer);
    render();
    toast('Stalemate or no legal moves');
    return;
  }
  render();
  if (state.mode === 'ai' && state.gs.turn === 'b') {
    setTimeout(() => {
      if (state.over) return;
      const m = bestMove(state.gs, state.level, 1200);
      if (!m) return;
      state.history.push(cloneState(state.gs));
      applyMove(state.gs, m);
      state.lastMove = m;
      afterMove();
    }, 300);
  }
}

function newGame(): void {
  state.gs = initialState();
  state.selected = -1;
  state.lastMove = null;
  state.over = false;
  state.history = [];
  startTimer(state.timer, (ms) => { timeEl.textContent = fmtClock(ms); });
  render();
}

function undo(): void {
  if (state.over || state.history.length === 0) return;
  state.gs = state.history.pop()!;
  state.lastMove = state.gs.history[state.gs.history.length - 1] || null;
  state.selected = -1;
  if (state.mode === 'ai' && state.history.length >= 1) {
    state.gs = state.history.pop()!;
    state.lastMove = state.gs.history[state.gs.history.length - 1] || null;
  }
  render();
}

document.querySelectorAll<HTMLButtonElement>('.bd-mode-card').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.classList.contains('is-disabled')) return;
    document.querySelectorAll('.bd-mode-card').forEach((x) => x.classList.remove('is-cur'));
    b.classList.add('is-cur');
    state.mode = b.dataset.mode as Mode;
    newGame();
  });
});
document.querySelectorAll<HTMLButtonElement>('.bd-diff-btn').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.bd-diff-btn').forEach((x) => x.classList.remove('is-cur'));
    b.classList.add('is-cur');
    state.level = b.dataset.level as Difficulty;
    newGame();
  });
});
newBtn.addEventListener('click', newGame);
undoBtn.addEventListener('click', undo);

newGame();