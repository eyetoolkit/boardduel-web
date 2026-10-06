/**
 * BoardDuel · 分享卡片（2026-10-06）
 * ─────────────────────────────────────────────────────────────
 * 范式抄 MathDuel 24-game 的 .share-overlay / .share-card：
 *   弹窗里放一张 **Canvas 绘制的大图**（600×760），可下载成 PNG、
 *   可调系统分享。跟之前做的 .go-invite 邀请弹窗是两层：
 *     · go-invite  = 建房时的邀请信息（房码 + 扫码进房）
 *     · share-card = 可保存分享的图片（成绩 / 邀请 / 终局）
 *
 * Canvas 绘制要点（踩过的坑）：
 *   · 渐变/描边必须等字体就绪后再画，否则 measureText 拿到 fallback 宽度
 *   · 圆角矩形用 arcTo 手写（roundRect 在老 Safari 缺失）
 *   · 二维码直接 fetch 成 Image 再 drawImage，不能污染页面
 *
 * 数据来源全部是调用方传入的 ShareData —— 本模块不碰游戏状态。
 */
import { showBoardDuelToast as toast } from './shared';

export interface ShareData {
  /** 主标题，如「邀请对战」「对局结束」 */
  title: string;
  /** 副标题（游戏名 / 结果说明） */
  subtitle: string;
  /** 大字数据，如房码、比分、排名；为空则画装饰 */
  big?: string;
  /** 大字下的小标签 */
  bigLabel?: string;
  /** 三格数据 [标签, 值] */
  stats?: [string, string][];
  /** 卡片内二维码指向的链接 */
  url: string;
  /** worker /api/qr 用的 game id；缺省从 url 末段取房码 */
  qrGame?: string;
  /** 主题配色，默认棋盘木纹琥珀 */
  tone?: 'wood' | 'indigo' | 'forest';
}

type Tone = 'wood' | 'indigo' | 'forest';

const THEME: Record<Tone, { bg1: string; bg2: string; glow: string; ring: string; accent: string; label: string; sub: string }> = {
  wood:    { bg1: '#3B2A16', bg2: '#1A1008', glow: 'rgba(245,158,11,.42)', ring: 'rgba(245,180,90,.45)', accent: '#F2B441', label: '#FDE8C8', sub: 'rgba(253,232,200,.66)' },
  indigo:  { bg1: '#1E1B4B', bg2: '#0B0A24', glow: 'rgba(99,102,241,.45)', ring: 'rgba(150,150,255,.40)', accent: '#A5B4FC', label: '#E0E7FF', sub: 'rgba(224,231,255,.66)' },
  forest:  { bg1: '#12301F', bg2: '#07160E', glow: 'rgba(16,185,129,.40)', ring: 'rgba(110,231,183,.42)', accent: '#6EE7B7', label: '#D1FAE5', sub: 'rgba(209,250,229,.66)' },
};

let current: ShareData | null = null;
let root: HTMLDivElement | null = null;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;

/* ───────────────────────── Canvas 绘制 ───────────────────────── */

function roundRect(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number): void {
  x.beginPath();
  x.moveTo(X + R, Y);
  x.arcTo(X + W, Y, X + W, Y + H, R);
  x.arcTo(X + W, Y + H, X, Y + H, R);
  x.arcTo(X, Y + H, X, Y, R);
  x.arcTo(X, Y, X + W, Y, R);
  x.closePath();
}

/** 载入图片为 HTMLImageElement（失败返回 null，不阻塞整卡渲染） */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function renderShareCard(canvas: HTMLCanvasElement, d: ShareData): Promise<void> {
  const T = THEME[d.tone || 'wood'];
  const W = canvas.width;   // 600
  const H = canvas.height;  // 760
  const x = canvas.getContext('2d');
  if (!x) return;

  // 等字体，避免 measureText 拿到 fallback
  try { await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready; } catch { /* noop */ }

  // 背景：深色渐变 + 径向光晕
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, T.bg1);
  g.addColorStop(1, T.bg2);
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  const rg = x.createRadialGradient(W / 2, -40, 40, W / 2, 170, 560);
  rg.addColorStop(0, T.glow);
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = rg;
  x.fillRect(0, 0, W, H);

  // 外框
  x.strokeStyle = T.ring;
  x.lineWidth = 3;
  x.strokeRect(18, 18, W - 36, H - 36);

  x.textAlign = 'center';
  const DISP = '"Space Grotesk", "Sora", system-ui, sans-serif';
  const BODY = '"Sora", system-ui, sans-serif';

  // 顶部 emoji + 标题
  x.fillStyle = T.label;
  x.font = `700 34px ${DISP}`;
  x.fillText(d.title, W / 2, 104);

  // 副标题
  x.fillStyle = T.sub;
  x.font = `500 20px ${BODY}`;
  x.fillText(d.subtitle, W / 2, 140);

  // 大字数据
  if (d.big) {
    x.fillStyle = T.accent;
    x.font = `800 ${String(d.big).length > 8 ? 64 : 92}px ${DISP}`;
    x.fillText(d.big, W / 2, 288);
  }
  if (d.bigLabel) {
    x.fillStyle = T.label;
    x.font = `600 21px ${BODY}`;
    x.fillText(d.bigLabel, W / 2, 322);
  }

  // 三格数据
  const stats = (d.stats || []).slice(0, 3);
  if (stats.length) {
    const bw = (W - 80) / 3;
    stats.forEach((s, i) => {
      const bx = 40 + i * bw;
      x.fillStyle = 'rgba(255,255,255,.07)';
      roundRect(x, bx, 380, bw - 16, 88, 16);
      x.fill();
      x.fillStyle = T.sub;
      x.font = `600 15px ${BODY}`;
      x.fillText(String(s[0]).slice(0, 14), bx + (bw - 16) / 2, 412);
      x.fillStyle = T.label;
      x.font = `700 ${String(s[1]).length > 9 ? 20 : 28}px ${DISP}`;
      x.fillText(String(s[1]).slice(0, 14), bx + (bw - 16) / 2, 450);
    });
  }

  // 二维码（右下角白底）—— 只有真正带着房号时才画。
  // 结果卡若没有房码，url 末段是游戏名而非房码，编出来是废码，不如不画。
  const qrCode = d.url.split('/').pop() || '';
  const hasRoom = !!d.qrGame && /^[A-Z2-9]{6}$/.test(qrCode);

  // 品牌行（没房号时别喊「扫码」，卡上并没有码）
  x.fillStyle = T.accent;
  x.font = `700 19px ${DISP}`;
  x.fillText('BoardDuel · Free to Play', W / 2, 545);
  x.fillStyle = T.sub;
  x.font = `500 15px ${BODY}`;
  x.fillText(hasRoom ? 'Scan to play the same board' : 'Play free on BoardDuel', W / 2, 572);

  if (hasRoom) {
    const qrSrc = '/api/qr?game=' + encodeURIComponent(d.qrGame as string) +
      '&code=' + encodeURIComponent(qrCode) + '&size=220';
    const img = await loadImage(qrSrc);
    if (img) {
      const size = 116;
      const offX = W - 44 - size;
      const offY = H - 44 - size;
      x.fillStyle = '#fff';
      roundRect(x, offX - 7, offY - 7, size + 14, size + 14, 10);
      x.fill();
      x.drawImage(img, offX, offY, size, size);
    }
  }
}

/* ───────────────────────── 弹窗 ───────────────────────── */

export function openShareCard(d: ShareData): void {
  current = d;
  if (!root) root = mount();

  const canvas = $<HTMLCanvasElement>('.bd-share-canvas');
  const urlInput = $<HTMLInputElement>('.bd-share-url');
  const titleEl = $('.bd-share-title');
  const qrImg = $<HTMLImageElement>('.bd-share-qr');

  if (titleEl) titleEl.textContent = d.title;
  if (urlInput) urlInput.value = d.url;
  root.hidden = false;
  root.classList.add('show');
  document.body.classList.add('bd-invite-open');

  if (canvas) void renderShareCard(canvas, d);
  if (qrImg) {
    const code = d.url.split('/').pop() || '';
    const g = d.qrGame || 'gomoku';
    // 复用 worker 的 /api/qr（服务端 SVG，免前端 6KB 库）；非房间链接则退回原图
    qrImg.src = code && /^[A-Z2-9]{4,8}$/i.test(code)
      ? '/api/qr?game=' + encodeURIComponent(g) + '&code=' + encodeURIComponent(code) + '&size=160&cb=' + Date.now()
      : d.url;
  }
  root.querySelector<HTMLButtonElement>('.bd-share-x')?.focus();
}

export function closeShareCard(): void {
  if (!root) return;
  root.classList.remove('show');
  root.hidden = true;
  document.body.classList.remove('bd-invite-open');
}

function mount(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'bd-share-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.hidden = true;
  el.innerHTML = `
    <div class="bd-share-card">
      <div class="bd-share-head">
        <h3 class="bd-share-title" data-i18n="bg.bg_share_title">Share</h3>
        <button type="button" class="bd-share-x" data-role="x" aria-label="Close" data-i18n-aria-label="bg.bg_share_close">✕</button>
      </div>

      <div class="bd-share-canvas-wrap"><canvas class="bd-share-canvas" width="600" height="760"></canvas></div>

      <div class="bd-share-qr-row">
        <img class="bd-share-qr" width="76" height="76" alt="Share QR code" decoding="async">
        <div class="bd-share-qr-txt" data-i18n-html="bg.bg_share_qr_hint">📱 <b>Scan or tap the link</b><br>Invite a friend to your board</div>
      </div>

      <div class="bd-share-url-row">
        <input class="bd-share-url" readonly aria-label="Share link" data-i18n-aria-label="bg.bg_share_link">
        <button type="button" class="go-btn bd-share-sm" data-role="copy" data-i18n="bg.bg_share_copy">📋 Copy</button>
      </div>

      <div class="bd-share-actions">
        <button type="button" class="go-btn bd-share-sm" data-role="download" data-i18n="bg.bg_share_save">⬇ Save Image</button>
        <button type="button" class="go-btn bd-share-sm" data-role="system" data-i18n="bg.bg_share_system">💬 Share</button>
      </div>
    </div>`;

  document.body.appendChild(el);

  // 这个弹窗是首次 openShareCard() 时才挂上的，页面启动那遍 applyToDOM 扫不到它。
  // i18n.js 的 MutationObserver 有 60ms 防抖兜底，但这里主动补一次，避免读到未翻译文案。
  try { window.i18n?.applyToDOM(el); } catch { /* i18n 未就绪时交给 observer */ }

  const q = <T extends Element>(role: string) => el.querySelector(`.bd-share-card [data-role="${role}"]`) as T;

  el.addEventListener('click', (e) => { if (e.target === el) closeShareCard(); });
  q<HTMLButtonElement>('x').addEventListener('click', closeShareCard);

  q<HTMLButtonElement>('copy').addEventListener('click', async () => {
    const v = $<HTMLInputElement>('.bd-share-url')?.value || '';
    if (!v) return;
    try { await navigator.clipboard.writeText(v); toast('Link copied'); }
    catch { toast('Copy failed'); }
  });

  q<HTMLButtonElement>('download').addEventListener('click', () => {
    const c = $<HTMLCanvasElement>('.bd-share-canvas');
    if (!c) return;
    const a = document.createElement('a');
    a.download = `boardduel-${(current?.big || 'share').replace(/[^\w-]/g, '')}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
    toast('Image saved');
  });

  q<HTMLButtonElement>('system').addEventListener('click', () => {
    const v = $<HTMLInputElement>('.bd-share-url')?.value || '';
    const d = current;
    if (navigator.share) {
      void navigator.share({ title: d?.title || 'BoardDuel', text: d?.subtitle || '', url: v }).catch(() => {});
    } else {
      void navigator.clipboard?.writeText(v).then(() => toast('Link copied'), () => toast('Copy failed'));
    }
  });

  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeShareCard(); });
  return el;
}

/* ───────────────────────── 便捷封装 ───────────────────────── */

/**
 * 建房场景：把邀请信息渲染成可下载的卡片
 * @param gameId  worker 用的 game id（决定 /b/<gameId>/<CODE> 短链与二维码），如 'gomoku'
 * @param gameName 卡片上显示的名字，如 'Gomoku · 15×15'（只用于文案，别拿来拼链接）
 */
export function shareInvite(gameId: string, gameName: string, code: string, tone: Tone = 'wood'): void {
  openShareCard({
    tone,
    title: 'Invite a friend',
    subtitle: `${gameName} · room ${code}`,
    big: code,
    bigLabel: 'Room code',
    stats: [['Board', gameName], ['Status', 'Waiting'], ['Price', 'Free']],
    url: location.origin + '/b/' + gameId + '/' + code,
    // Canvas 里也要用 gameId 取二维码，别再用展示名
    qrGame: gameId,
  });
}

/** 终局场景：比分 / 结果卡 */
export function shareResult(game: string, opts: {
  youWin: boolean; moves: number; durationSec: number; link: string; tone?: Tone; qrGame?: string;
}): void {
  const m = Math.floor(opts.durationSec / 60);
  const s = Math.round(opts.durationSec % 60);
  openShareCard({
    tone: opts.tone || (opts.youWin ? 'wood' : 'indigo'),
    title: opts.youWin ? 'Victory' : 'Good game',
    subtitle: game,
    big: opts.youWin ? 'WIN' : 'LOSS',
    bigLabel: opts.youWin ? 'You took the board' : 'Better luck next time',
    stats: [
      ['Moves', String(opts.moves)],
      ['Time', `${m}:${String(s).padStart(2, '0')}`],
      ['Site', 'BoardDuel'],
    ],
    url: opts.link,
    // 只有联机房局才有房码可编；单机 AI 对局没有码，卡片就不画二维码
    qrGame: opts.qrGame,
  });
}
