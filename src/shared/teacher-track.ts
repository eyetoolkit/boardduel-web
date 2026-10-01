/* ═══════════════════════════════════════════════════════════════
   BoardDuel · 学生端归因（M2 2026-10-01）
   ────────────────────────────────────────────────────────────────
   拷贝自 mathduel-web/src/games/_shared/teacher-track.ts (2026-10-01)。

   关键差异：
   · 房间码在 URL 上是 ?c= （不是 ?room=），邀请链接示例
       https://boardduel.com/games/chess/?c=ABC123&mode=battle&tid=1
     因此 urlRoomCode() 同时接受 ?room= 和 ?c=。
   · Classroom 标记靠 ?tid=1（教师邀请链接特征）—— 普通 ?c= 是 PvP 房码，
     不弹代号框、不上报，避免 classroom 环境污 PvP 数据。
   · boardduel 是策略棋（chess/gomoku/connect4/reversi/tictactoe），
     RoundPayload 不传 24-点专用字段（ops/skills），只报告
     {solved, duration_ms, outcome: 'win'|'loss'|'draw'}。

   合规：只传代号（S01），永不传真实姓名。
   ═══════════════════════════════════════════════════════════════ */

const LS_KEY = 'bd_classroom_codes_v1';

type CodeMap = Record<string, string>;

function readMap(): CodeMap {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw as CodeMap : {};
  } catch {
    return {};
  }
}

function writeMap(m: CodeMap): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(m)); } catch { /* 隐私模式下忽略 */ }
}

/** 是否为老师端课堂邀请链接 */
export function isClassroom(): boolean {
  try {
    return new URLSearchParams(location.search).get('tid') === '1';
  } catch {
    return false;
  }
}

/** 当前页面 URL 上的房间码（boardduel 用 ?c=；mathduel 用 ?room=——两种都兼容） */
export function urlRoomCode(): string | null {
  try {
    const p = new URLSearchParams(location.search);
    const rc = (p.get('c') || p.get('room') || '').trim().toUpperCase();
    return rc || null;
  } catch {
    return null;
  }
}

/** 本机已绑定的代号（换取家庭/同一台机器重复上课不必重输） */
export function studentCodeFor(room: string): string | null {
  if (!room) return null;
  return readMap()[room] || null;
}

function remember(room: string, code: string): void {
  const m = readMap();
  m[room] = code;
  writeMap(m);
}

export interface RoundPayload {
  round?: number;
  solved: boolean;
  duration_ms?: number;
  wrong?: number;
  outcome?: 'win' | 'loss' | 'draw';   // boardduel 棋类结果（M2）
  ops?: string[];
  skills?: string[];   // G2.5-M1：技能标签（服务端白名单过滤）
}

/* ─── 代号输入弹窗 ─── */
let promptEl: HTMLDivElement | null = null;

function ensureStyles(): void {
  if (document.getElementById('mdClassroomCss')) return;
  const st = document.createElement('style');
  st.id = 'mdClassroomCss';
  st.textContent = `
  .mdcls-wrap{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(16,20,42,.55);backdrop-filter:blur(3px);font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
  .mdcls-box{background:#fff;border-radius:18px;padding:24px 22px;width:min(360px,92vw);box-shadow:0 20px 60px rgba(16,20,42,.3)}
  .mdcls-box h3{margin:0 0 6px;font-size:1.1rem;color:#10142A}
  .mdcls-box p{margin:0 0 14px;font-size:.8rem;color:#6B7290;line-height:1.5}
  .mdcls-box input{width:100%;border:1.5px solid #E3E7F0;border-radius:11px;padding:12px 13px;font-size:1.05rem;letter-spacing:.06em;text-transform:uppercase;font-family:system-ui,sans-serif}
  .mdcls-box input:focus{outline:none;border-color:#3730A3}
  .mdcls-box button{margin-top:13px;width:100%;background:#3730A3;color:#fff;border:0;border-radius:11px;font-weight:700;font-size:.92rem;padding:12px}
  .mdcls-box button:disabled{opacity:.5}
  .mdcls-err{color:#DC2626;font-size:.75rem;font-weight:700;margin-top:8px;min-height:1em}
  .mdcls-skip{background:transparent!important;color:#6B7290!important;font-size:.8rem!important;margin-top:6px!important;padding:6px!important}
  `;
  document.head.appendChild(st);
}

/**
 * 确保学生已绑定班级代号：已绑定直接返回；否则弹出一次性输入。
 * 「跳过」或关闭都返回 null —— 不强制归因，玩家仍可正常游戏，只是不计入学情看板。
 */
export function ensureStudentCode(room: string): Promise<string | null> {
  const prev = studentCodeFor(room);
  if (prev) return Promise.resolve(prev);
  ensureStyles();
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'mdcls-wrap';
    wrap.innerHTML = `
      <div class="mdcls-box">
        <h3>Enter your class code</h3>
        <p>Your teacher gave you a code (like <b>S07</b>). It's how your work gets counted — no name needed.</p>
        <input id="mdclsInput" maxlength="12" autocomplete="off" placeholder="S07" />
        <div class="mdcls-err" id="mdclsErr"></div>
        <button id="mdclsOk">Start</button>
        <button class="mdcls-skip" id="mdclsSkip">Skip for now</button>
      </div>`;
    document.body.appendChild(wrap);
    promptEl = wrap as HTMLDivElement;

    const input = wrap.querySelector('#mdclsInput') as HTMLInputElement;
    const errEl = wrap.querySelector('#mdclsErr') as HTMLDivElement;
    const okBtn = wrap.querySelector('#mdclsOk') as HTMLButtonElement;
    const skipBtn = wrap.querySelector('#mdclsSkip') as HTMLButtonElement;

    const close = (code: string | null) => {
      if (promptEl === wrap) promptEl = null;
      wrap.remove();
      if (code) remember(room, code);
      resolve(code);
    };

    const submit = async () => {
      const code = input.value.trim().toUpperCase();
      if (!code) { errEl.textContent = 'Please enter your code.'; return; }
      okBtn.disabled = true;
      okBtn.textContent = 'Checking…';
      try {
        const res = await fetch('/api/teacher/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ roomCode: room, code }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          errEl.textContent = (j && j.error === 'room_not_found')
            ? 'This room has expired — ask your teacher for a new link.'
            : 'Could not join. Please check the code.';
          okBtn.disabled = false;
          okBtn.textContent = 'Start';
          return;
        }
        if (j && j.ok === false) {
          errEl.textContent = j.reason === 'not_on_roster'
            ? 'This code is not on the class list — check with your teacher.'
            : j.reason === 'expired'
              ? 'This assignment has closed — ask your teacher.'
              : 'Not accepted. Check with your teacher.';
          okBtn.disabled = false;
          okBtn.textContent = 'Start';
          return;
        }
        close(code);
      } catch {
        errEl.textContent = 'Network error — try again.';
        okBtn.disabled = false;
        okBtn.textContent = 'Start';
      }
    };

    okBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    skipBtn.addEventListener('click', () => close(null));
    setTimeout(() => { try { input.focus(); } catch { /* ignore */ } }, 60);
  });
}

/** 单轮成绩回写（fire-and-forget：失败不影响游戏） */
export function reportRound(room: string | null, payload: RoundPayload): void {
  if (!room) return;
  const code = studentCodeFor(room);
  if (!code) return;                       // 没绑定 → 不计入看板（仍可正常玩）
  try {
    fetch('/api/teacher/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ roomCode: room, code, ...payload }),
      keepalive: true,
    }).catch(() => { /* 静默：回写失败不打扰玩家 */ });
  } catch { /* ignore */ }
}

/**
 * G2.5-M1：从算式推导技能标签（24 点专用，其余游戏返回空数组）。
 *  div     用到了除法
 *  mul     用到了乘法
 *  mix     乘法与加减混用 —— 求值时乘法先于加减，正是「乘法优先」教学点
 *  bracket 括号嵌套
 * 标签随 track 上报，服务端白名单过滤后进入技能热力图。
 */
export function skillsFromExpression(expr: string): string[] {
  const s = String(expr || '');
  if (!s) return [];
  const out: string[] = [];
  if (/[\u002f\u00f7]/.test(s)) out.push('div');
  if (/[\u00d7*\u00b7]/.test(s)) {
    out.push('mul');
    if (/[+\u2212-]/.test(s)) out.push('mix');
  }
  if (s.includes('(') || s.includes(')')) out.push('bracket');
  return out;
}

/** 从表达式里抽取用到的运算符（24 点专用，其余游戏返回空数组） */
export function opsFromExpression(expr: string): string[] {
  const set = new Set<string>();
  for (const ch of String(expr || '')) {
    if (ch === '+') set.add('+');
    else if (ch === '-' || ch === '−') set.add('−');
    else if (ch === '*' || ch === '×' || ch === '·') set.add('×');
    else if (ch === '/' || ch === '÷') set.add('÷');
  }
  return [...set];
}
