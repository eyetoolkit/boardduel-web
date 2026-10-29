/**
 * tri-sites · 三站共用邀请卡引擎（2026-10-29）
 * ─────────────────────────────────────────────────────────────
 * BoardDuel / MemoryDuel（/api/md/qr）/ NumeriDuel 三站的邀请卡
 * 曾经是三套独立引擎（identity.js 式「三版修复互不回流」的坑已经
 * 踩过一次：memoryduel 的芯片截断修复不会自动回到 boardduel）。
 * 本模块把「Canvas 600×760 大图 + 弹窗（二维码行/链接行/复制/保存/分享）」
 * 收敛为一份实现，三站各自只剩**薄封装**（拼参数 + 取译文）。
 *
 * 三样东西参数化（这正是各站差异的全部）：
 *   1. tone       —— 品牌配色（wood 棋盘琥珀 / indigo 靛蓝 /
 *                    forest 墨绿 / sky 数点蓝）
 *   2. url+qrSrc  —— 链接构造与二维码端点由调用方拼好传入
 *                    （boardduel /api/qr · memoryduel /api/md/qr）
 *   3. texts      —— 弹窗与 Canvas 的全部文案由调用方在**打开那一刻**
 *                    解析完毕传入。Canvas 是像素，i18n 的 MutationObserver
 *                    管不到；缺键烧裸 key 永不修复（铁律：判降级 + 英文兜底）。
 *
 * 🔴 样式自注入：CSS 由本模块在首次打开时以 <style> 注入，**不存在
 *    独立的 css 文件** —— 根治 boardduel 10-26 那类「样式文件被谁
 *    import 决定弹窗有没有样式」的归属 bug，也免去 css 跨站同步。
 *
 * 消费方式（TS 仓库）：
 *   const m = await import(动态变量);   // 变量传 '/shared/invite-card.mjs'，
 *                                       // vite-ignore 注释让 vite 保留为运行时原生 ESM
 *   public/shared 与 fe-shared/shared 逐字节一致（sync-shared 门禁管）。
 */

/* ───────────────────────── 品牌配色 ─────────────────────────
   与 boardduel-web / memoryduel-web 原引擎的 THEME 逐字节一致；
   sky 为 NumeriDuel 预留（#0f1b2e 深蓝 + #4D97E6 强调）。 */
const THEME = {
  wood:   { bg1: '#3B2A16', bg2: '#1A1008', glow: 'rgba(245,158,11,.42)', ring: 'rgba(245,180,90,.45)', accent: '#F2B441', label: '#FDE8C8', sub: 'rgba(253,232,200,.66)' },
  indigo: { bg1: '#1E1B4B', bg2: '#0B0A24', glow: 'rgba(99,102,241,.45)', ring: 'rgba(150,150,255,.40)', accent: '#A5B4FC', label: '#E0E7FF', sub: 'rgba(224,231,255,.66)' },
  forest: { bg1: '#12301F', bg2: '#07160E', glow: 'rgba(16,185,129,.40)', ring: 'rgba(110,231,183,.42)', accent: '#6EE7B7', label: '#D1FAE5', sub: 'rgba(209,250,229,.66)' },
  sky:    { bg1: '#0F1B2E', bg2: '#08101D', glow: 'rgba(0,102,204,.45)',  ring: 'rgba(120,180,255,.45)', accent: '#4D97E6', label: '#BFDBFE', sub: 'rgba(203,213,225,.72)' },
};

/* ───────────────────────── 样式（自注入） ─────────────────────────
   660px 盒模型倒推：画布 600 + wrap padding 10×2 + 卡片 padding 18×2
   + border 1×2 = 658 ≈ 660（boardduel 线上实测教训）。 */
const CSS = `
.fc-invite-overlay{position:fixed;inset:0;z-index:2147483100;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(30,27,57,.58);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);overflow-y:auto}
.fc-invite-overlay.show{display:flex}
.fc-invite-overlay[hidden]{display:none!important}
body.fc-invite-open{overflow:hidden}
.fc-invite-card{width:100%;max-width:660px;max-height:92vh;overflow-y:auto;background:#fff;border:1px solid #E3E6F0;border-radius:24px;padding:20px 18px 18px;box-shadow:0 2px 4px rgba(30,27,57,.06),0 24px 60px -20px rgba(30,27,57,.40);animation:fc-invite-in .26s cubic-bezier(.34,1.4,.64,1) both;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
@keyframes fc-invite-in{from{opacity:0;transform:translateY(16px) scale(.95)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.fc-invite-card{animation:none}}
.fc-invite-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.fc-invite-title{margin:0;font-weight:700;font-size:1.1rem;color:#1E1B39;letter-spacing:-.01em}
.fc-invite-x{border:0;background:#F1F2F7;color:#5B6079;width:34px;height:34px;border-radius:10px;font-size:1rem;line-height:1;cursor:pointer}
.fc-invite-x:hover{background:#E3E6F0;color:#1E1B39}
.fc-invite-canvas-wrap{display:flex;justify-content:center;margin-bottom:14px;background:#F8F9FC;border-radius:16px;padding:10px}
.fc-invite-canvas{width:100%;max-width:600px;height:auto;border-radius:10px;box-shadow:0 4px 14px rgba(30,27,57,.12)}
.fc-invite-qr-row{display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:12px;background:#F8F9FC;border:1px solid #EEF1F5;border-radius:14px}
.fc-invite-qr{width:76px;height:76px;flex:0 0 auto;border-radius:10px;background:#fff;padding:4px;border:1px solid #E3E6F0;object-fit:contain}
.fc-invite-qr.fc-qr-broken{display:none}
.fc-invite-qr-txt{font-size:.78rem;color:#5B6079;line-height:1.5}
.fc-invite-qr-txt b{color:#1E1B39;font-weight:700}
.fc-invite-url-row{display:flex;gap:8px;margin-bottom:10px}
.fc-invite-url{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.74rem;color:#5B6079;padding:9px 10px;border-radius:10px;border:1px solid #E3E6F0;background:#F8F9FC;text-overflow:ellipsis}
.fc-invite-btn{border:1px solid #E3E6F0;background:#fff;color:#1E1B39;font-size:.82rem;font-weight:600;padding:9px 14px;border-radius:10px;cursor:pointer;white-space:nowrap}
.fc-invite-btn:hover{background:#F1F2F7}
.fc-invite-actions{display:flex;gap:8px}
.fc-invite-actions .fc-invite-btn{flex:1}
.fc-invite-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(8px);background:#1E1B39;color:#F4F5F9;font-size:.82rem;padding:9px 16px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:2147483200}
.fc-invite-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
@media (max-width:380px){.fc-invite-card{max-width:100%;padding:18px 14px 16px;border-radius:20px}.fc-invite-canvas{max-width:100%}.fc-invite-actions{flex-wrap:wrap}}
html[data-theme="dark"] .fc-invite-overlay{background:rgba(6,6,18,.72)}
html[data-theme="dark"] .fc-invite-card{background:#1A1B2E;border-color:#2C2E45;box-shadow:0 2px 4px rgba(0,0,0,.35),0 24px 60px -20px rgba(0,0,0,.7)}
html[data-theme="dark"] .fc-invite-title{color:#F4F5F9}
html[data-theme="dark"] .fc-invite-x{background:#24263C;color:#9AA0BE}
html[data-theme="dark"] .fc-invite-x:hover{background:#2F3150;color:#F4F5F9}
html[data-theme="dark"] .fc-invite-canvas-wrap,html[data-theme="dark"] .fc-invite-qr-row{background:#15162A;border-color:#2C2E45}
html[data-theme="dark"] .fc-invite-qr-txt{color:#9AA0BE}
html[data-theme="dark"] .fc-invite-qr-txt b{color:#F4F5F9}
html[data-theme="dark"] .fc-invite-url{background:#15162A;border-color:#2C2E45;color:#9AA0BE}
html[data-theme="dark"] .fc-invite-btn{background:#24263C;border-color:#2C2E45;color:#E0E7FF}
html[data-theme="dark"] .fc-invite-btn:hover{background:#2F3150}
`;

let styleInjected = false;
function ensureStyle() {
  if (styleInjected) return;
  try {
    const st = document.createElement('style');
    st.id = 'fc-invite-style';
    st.textContent = CSS;
    document.head.appendChild(st);
    styleInjected = true;
  } catch { /* 极老浏览器：卡片仍可用，只是无样式 */ }
}

function roundRect(x, X, Y, W, H, R) {
  x.beginPath();
  x.moveTo(X + R, Y);
  x.arcTo(X + W, Y, X + W, Y + H, R);
  x.arcTo(X + W, Y + H, X, Y + H, R);
  x.arcTo(X, Y + H, X, Y, R);
  x.arcTo(X, Y, X + W, Y, R);
  x.closePath();
}

/** 载入图片为 HTMLImageElement（失败返回 null，不阻塞整卡渲染） */
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* ───────────────────────── Canvas 绘制 ───────────────────────── */

/**
 * 把邀请/成绩卡画到 canvas 上。
 * @param {HTMLCanvasElement} canvas 600×760
 * @param {object} cfg 见文件头。qrSrc 为空或加载失败 → 画行动胶囊，版式不塌。
 */
export async function renderInviteCard(canvas, cfg) {
  const T = THEME[cfg.tone] || THEME.indigo;
  const W = canvas.width;   // 600
  const H = canvas.height;  // 760
  const x = canvas.getContext('2d');
  if (!x) return;

  // 等字体，避免 measureText 拿到 fallback 宽度
  try { await (document).fonts?.ready; } catch { /* noop */ }

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

  // 顶部标题 / 副标题
  x.fillStyle = T.label;
  x.font = `700 34px ${DISP}`;
  x.fillText(String(cfg.title || ''), W / 2, 104);

  x.fillStyle = T.sub;
  x.font = `500 20px ${BODY}`;
  x.fillText(String(cfg.subtitle || ''), W / 2, 140);

  // 大字数据（房码 / WIN / #rank）
  if (cfg.big) {
    x.fillStyle = T.accent;
    x.font = `800 ${String(cfg.big).length > 8 ? 64 : 92}px ${DISP}`;
    x.fillText(String(cfg.big), W / 2, 288);
  }
  if (cfg.bigLabel) {
    x.fillStyle = T.label;
    x.font = `600 21px ${BODY}`;
    x.fillText(String(cfg.bigLabel), W / 2, 322);
  }

  // 三格数据芯片。
  // 🔴 截断修复（memoryduel 10-29）：标签 16 字内、值 12 字内用原字号，
  //    超长先缩字再截断 —— "Sequence Memory Duel" 这种长名不再 "…Memor" 破相。
  const stats = (cfg.stats || []).slice(0, 3);
  if (stats.length) {
    const bw = (W - 80) / 3;
    stats.forEach((s, i) => {
      const bx = 40 + i * bw;
      x.fillStyle = 'rgba(255,255,255,.07)';
      roundRect(x, bx, 380, bw - 16, 88, 16);
      x.fill();
      const lbl = String(s[0] ?? '');
      const val = String(s[1] ?? '');
      x.fillStyle = T.sub;
      x.font = `600 ${lbl.length > 14 ? 13 : 15}px ${BODY}`;
      x.fillText(lbl.slice(0, 18), bx + (bw - 16) / 2, 412);
      x.fillStyle = T.label;
      x.font = `700 ${val.length > 12 ? 17 : 28}px ${DISP}`;
      x.fillText(val.slice(0, 16), bx + (bw - 16) / 2, 450);
    });
  }

  // ─── 底部品牌面板：左 = 品牌 + 标语，右 = 二维码（有码）或行动胶囊 ───
  // 🔴 二维码先加载、再决定面板布局：端点拉不到（离线/worker 抖动）时
  //    右半边画 CTA 胶囊，不留空洞。
  const panelX = 40, panelW = W - 80, panelY = 530, panelH = 140;
  let qrImg = null;
  if (cfg.qrSrc) qrImg = await loadImage(cfg.qrSrc);
  const showQr = !!qrImg;

  x.strokeStyle = 'rgba(255,255,255,.12)';
  x.lineWidth = 1;
  x.beginPath();
  x.moveTo(panelX, panelY - 22);
  x.lineTo(W - panelX, panelY - 22);
  x.stroke();

  x.fillStyle = 'rgba(255,255,255,.055)';
  roundRect(x, panelX, panelY, panelW, panelH, 18);
  x.fill();

  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  x.fillStyle = T.accent;
  x.font = `800 30px ${DISP}`;
  x.fillText(String(cfg.brand || ''), panelX + 28, panelY + 54);
  x.fillStyle = T.sub;
  x.font = `500 17px ${BODY}`;
  // 双态标语：有码 → scanText；无码 → noQrText（缺省回落 ctaText）
  x.fillText(String(showQr ? cfg.scanText : (cfg.noQrText || cfg.ctaText || cfg.scanText)), panelX + 28, panelY + 90);

  if (showQr && qrImg) {
    const size = 116, box = size + 14;
    const offX = panelX + panelW - 28 - box;
    const offY = panelY + (panelH - box) / 2;
    x.fillStyle = '#fff';
    roundRect(x, offX, offY, box, box, 10);
    x.fill();
    x.drawImage(qrImg, offX + 7, offY + 7, size, size);
  } else if (cfg.ctaText) {
    // 没有二维码可扫 —— 行动胶囊把「看卡的人」引到游戏本身
    const cta = String(cfg.ctaText);
    x.font = `700 17px ${DISP}`;
    const bw2 = x.measureText(cta).width + 52, bh = 52;
    const bx = panelX + panelW - 28 - bw2, by = panelY + (panelH - bh) / 2;
    x.fillStyle = T.accent;
    roundRect(x, bx, by, bw2, bh, 26);
    x.fill();
    x.fillStyle = T.bg2;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(cta, bx + bw2 / 2, by + bh / 2 + 1);
    x.textAlign = 'left';
    x.textBaseline = 'alphabetic';
  }

  // 底部域名（卡片自带出处，不依赖弹窗的链接框）
  x.fillStyle = T.sub;
  x.font = `500 15px ${BODY}`;
  x.textAlign = 'center';
  x.fillText(String(cfg.domain || ''), W / 2, panelY + panelH + 42);
  x.textAlign = 'left';
}

/* ───────────────────────── 弹窗 ───────────────────────── */

let root = null;
let current = null;

const $sel = (sel) => document.querySelector(sel);

export function closeInviteCard() {
  if (!root) return;
  root.classList.remove('show');
  root.hidden = true;
  document.body.classList.remove('fc-invite-open');
}

function mount() {
  const el = document.createElement('div');
  el.className = 'fc-invite-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.hidden = true;
  el.innerHTML = `
    <div class="fc-invite-card">
      <div class="fc-invite-head">
        <h3 class="fc-invite-title"></h3>
        <button type="button" class="fc-invite-x" data-role="x">✕</button>
      </div>

      <div class="fc-invite-canvas-wrap"><canvas class="fc-invite-canvas" width="600" height="760"></canvas></div>

      <div class="fc-invite-qr-row">
        <img class="fc-invite-qr" width="76" height="76" decoding="async" alt="">
        <div class="fc-invite-qr-txt"></div>
      </div>

      <div class="fc-invite-url-row">
        <input class="fc-invite-url" readonly>
        <button type="button" class="fc-invite-btn" data-role="copy"></button>
      </div>

      <div class="fc-invite-actions">
        <button type="button" class="fc-invite-btn" data-role="download"></button>
        <button type="button" class="fc-invite-btn" data-role="system"></button>
      </div>
    </div>`;

  document.body.appendChild(el);

  const q = (role) => el.querySelector(`.fc-invite-card [data-role="${role}"]`);

  el.addEventListener('click', (e) => { if (e.target === el) closeInviteCard(); });
  q('x').addEventListener('click', closeInviteCard);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInviteCard(); });

  q('copy').addEventListener('click', async () => {
    const v = $sel('.fc-invite-url')?.value || '';
    if (!v) return;
    try { await navigator.clipboard.writeText(v); toastMsg(current?.texts?.copied || 'Link copied'); }
    catch { toastMsg(current?.texts?.copyFailed || 'Copy failed'); }
  });

  q('download').addEventListener('click', () => {
    const c = $sel('.fc-invite-canvas');
    if (!c) return;
    const a = document.createElement('a');
    const slug = String(current?.big || 'share').replace(/[^\w-]/g, '') || 'share';
    a.download = `${current?.fileBase || 'invite'}-${slug}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
    toastMsg(current?.texts?.saved || 'Image saved');
  });

  q('system').addEventListener('click', () => {
    const v = $sel('.fc-invite-url')?.value || '';
    const d = current;
    if (navigator.share) {
      navigator.share({ title: d?.title || d?.brand || '', text: d?.subtitle || '', url: v }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(v).then(
        () => toastMsg(d?.texts?.copied || 'Link copied'),
        () => toastMsg(d?.texts?.copyFailed || 'Copy failed'));
    }
  });

  return el;
}

/** toast：站点传了 cfg.toast 用站点原生，否则用内置胶囊 */
function toastMsg(msg) {
  if (current?.toast) { try { current.toast(msg); } catch { /* noop */ } return; }
  try {
    let el = document.querySelector('.fc-invite-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'fc-invite-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 1800);
  } catch { /* noop */ }
}

/**
 * 打开邀请卡弹窗。
 * @param {object} cfg
 *   title/subtitle/big/bigLabel  —— Canvas 大图文案（调用方已解析好译文）
 *   stats                        —— [[label, value]] ×3
 *   url                          —— 邀请链接（复制/系统分享用）
 *   qrSrc                        —— 服务端二维码 URL；null → 弹窗隐藏二维码行、
 *                                   Canvas 画 CTA 胶囊（判降级，不烧破图）
 *   tone                         —— 'wood' | 'indigo' | 'forest' | 'sky'
 *   brand / domain               —— 卡片品牌面板 + 底部域名
 *   scanText / ctaText           —— 品牌面板标语（有码/无码两态）
 *   fileBase                     —— 下载文件名前缀
 *   texts                        —— { copy, copied, copyFailed, save, saved,
 *                                   share, close, linkAria, qrMain, qrSub }
 *   toast                        —— 可选，站点原生 toast(msg)；缺省用内置
 */
export async function openInviteCard(cfg) {
  current = cfg;
  ensureStyle();
  if (!root) root = mount();

  const canvas = $sel('.fc-invite-canvas');
  const urlInput = $sel('.fc-invite-url');
  const titleEl = $sel('.fc-invite-title');
  const qrImg = $sel('.fc-invite-qr');
  const qrRow = $sel('.fc-invite-qr-row');
  const T = cfg.texts || {};

  if (titleEl) titleEl.textContent = cfg.title || '';
  if (urlInput) urlInput.value = cfg.url || '';
  if (qrRow) qrRow.style.display = cfg.qrSrc ? '' : 'none';
  if (qrImg) {
    qrImg.alt = cfg.scanText || 'QR code';
    // 🔴 端点失败时隐藏破图（判降级），Canvas 面板同样已走 CTA 兜底
    qrImg.classList.remove('fc-qr-broken');
    qrImg.onerror = () => { qrImg.classList.add('fc-qr-broken'); if (qrRow) qrRow.style.display = 'none'; };
    qrImg.src = cfg.qrSrc || '';
  }
  const qrTxt = $sel('.fc-invite-qr-txt');
  if (qrTxt) qrTxt.innerHTML = `<b></b><br>`;
  if (qrTxt) {
    qrTxt.firstChild.textContent = T.qrMain || '';
    qrTxt.lastChild.textContent = T.qrSub || '';
  }
  const xBtn = root.querySelector('.fc-invite-x');
  if (xBtn) xBtn.setAttribute('aria-label', T.close || 'Close');
  if (urlInput) urlInput.setAttribute('aria-label', T.linkAria || 'Share link');
  const cBtn = root.querySelector('[data-role="copy"]');
  if (cBtn) cBtn.textContent = `📋 ${T.copy || 'Copy'}`;
  const dBtn = root.querySelector('[data-role="download"]');
  if (dBtn) dBtn.textContent = `⬇ ${T.save || 'Save Image'}`;
  const sBtn = root.querySelector('[data-role="system"]');
  if (sBtn) sBtn.textContent = `💬 ${T.share || 'Share'}`;

  root.hidden = false;
  root.classList.add('show');
  document.body.classList.add('fc-invite-open');
  root.querySelector('.fc-invite-x')?.focus();

  if (canvas) await renderInviteCard(canvas, cfg);
}
