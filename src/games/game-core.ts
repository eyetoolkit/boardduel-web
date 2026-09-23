/**
 * BoardDuel 通用游戏核心
 * - 计时器（每局独立 elapsed 计时）
 * - 模式状态机（vs AI / Pass & Play / vs Human 占位）
 * - AI 难度档位
 * - 公共 toast
 */

export type Mode = 'ai' | 'pass' | 'human';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface GameMeta {
  slug: string;          // 'tictactoe'
  title: string;         // 'Tic-Tac-Toe'
  boardSize: number;     // 棋盘格子数 (9 / 225)
  rows?: number; cols?: number; // 物理尺寸
  difficultyLabel: Record<Difficulty, string>; // AI 档位说明
  how: string;           // 玩法一句话
}

export interface RuntimeState {
  startedAt: number;
  elapsedMs: number;
  intervalId: number | null;
}

export function createTimer(): RuntimeState {
  return { startedAt: 0, elapsedMs: 0, intervalId: null };
}

export function startTimer(state: RuntimeState, onTick: (ms: number) => void): void {
  if (state.intervalId !== null) return;
  state.startedAt = Date.now();
  state.elapsedMs = 0;
  state.intervalId = window.setInterval(() => {
    state.elapsedMs = Date.now() - state.startedAt;
    onTick(state.elapsedMs);
  }, 250);
}

export function stopTimer(state: RuntimeState): void {
  if (state.intervalId !== null) {
    window.clearInterval(state.intervalId);
    state.intervalId = null;
  }
}

export function fmtClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

/** 顶部 nav 高亮当前页 */
export function setupNav(_slug: string): void {
  const here = (location.pathname || '/').replace(/\/+$/, '') || '/';
  const gameSlug = here.split('/').filter(Boolean).pop() || '';
  document.querySelectorAll<HTMLAnchorElement>('.bd-link').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const isHome = href === '/' || href === '/home';
    const active = isHome && (gameSlug === '' || gameSlug === 'home')
      || href === '/games/' + gameSlug + '/';
    a.classList.toggle('bd-link-cur', active);
  });
}

/** 模式选择器：3 张按钮（AI / Pass / 占位 Human） */
export interface ModeCard {
  mode: Mode;
  label: string;
  badge?: string;
}

export function buildModeCards(_slug: string, defaultMode: Mode): string {
  const cards: ModeCard[] = [
    { mode: 'ai',    label: 'Play the engine', badge: '3 levels' },
    { mode: 'pass',  label: 'Pass & play', badge: 'two players, one screen' },
    { mode: 'human', label: 'Online match', badge: 'coming soon' },
  ];
  return cards.map((c) => {
    const sel = c.mode === defaultMode;
    const dis = c.mode === 'human';
    return `<button type="button" class="bd-mode-card${sel ? ' is-cur' : ''}${dis ? ' is-disabled' : ''}" data-mode="${c.mode}"${dis ? ' disabled' : ''}>
      <span class="bd-mode-label">${c.label}</span>
      <span class="bd-mode-badge">${c.badge ?? ''}</span>
    </button>`;
  }).join('');
}

/** 难度档位（与 engine.ts 档位一致） */
export function buildDifficultyButtons(defaultLevel: Difficulty = 'medium'): string {
  const levels: Difficulty[] = ['easy', 'medium', 'hard'];
  return levels.map((lv) => {
    const sel = lv === defaultLevel;
    return `<button type="button" class="bd-diff-btn${sel ? ' is-cur' : ''}" data-level="${lv}">${lv.toUpperCase()}</button>`;
  }).join('');
}

/** 简易 toast（页面右下角） */
let toastEl: HTMLElement | null = null;
export function toast(msg: string, dur = 2200): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'bd-toast';
    document.body.appendChild(toastEl);
  }
  const item = document.createElement('div');
  item.className = 'bd-toast-item';
  item.textContent = msg;
  toastEl.appendChild(item);
  requestAnimationFrame(() => item.classList.add('is-in'));
  setTimeout(() => {
    item.classList.remove('is-in');
    setTimeout(() => item.remove(), 250);
  }, dur);
}

/** 通用 localStorage bestScore 记录 */
export function readBest(slug: string, mode: Mode, level: Difficulty): number {
  try { return parseInt(localStorage.getItem(`bd_best_${slug}_${mode}_${level}`) || '0', 10) || 0; }
  catch { return 0; }
}
export function writeBest(slug: string, mode: Mode, level: Difficulty, value: number): void {
  try { localStorage.setItem(`bd_best_${slug}_${mode}_${level}`, String(value)); } catch {}
}