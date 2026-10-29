/**
 * BoardDuel · 分享卡片（2026-10-06 建，2026-10-29 起 = 公共引擎薄封装）
 * ─────────────────────────────────────────────────────────────
 * 🔴 2026-10-29 三站统一：Canvas 绘制 + 弹窗交互全部收敛到
 *    fe-shared/shared/invite-card.mjs（与 memoryduel 同源）。原先
 *    memoryduel 修的芯片截断 bug 不会回流到本站 —— 收敛后一处修、
 *    三站生效。本文件只剩三件事：
 *      1. 拼链接（/b/<gameId>/<CODE> 短链）与二维码端点（/api/qr）
 *      2. 打开那一刻解析全部文案（Canvas 是像素，缺键烧裸 key 永不修复）
 *      3. 把站点原生 toast 传给引擎（保持 BoardDuel 弹报样式）
 *    样式由引擎自注入 —— src/styles/share-card.css 已删除，根治
 *    10-26 那类「样式文件被谁 import 决定弹窗有没有样式」的归属 bug。
 *    导出 API 与旧版完全一致（8 个游戏 + invite-card.ts 消费方零改动）。
 */
import { showBoardDuelToast as toast } from './shared';

/** 引擎模块（public/shared 静态资源，运行时原生 ESM 加载） */
const ENG_URL = '/shared/invite-card.mjs';

interface InviteCardTexts {
  copy: string; copied: string; copyFailed: string;
  save: string; saved: string; share: string;
  close: string; linkAria: string; qrMain: string; qrSub: string;
}
interface InviteCardConfig {
  title: string; subtitle: string; big?: string; bigLabel?: string;
  stats?: [string, string][];
  url: string; qrSrc: string | null;
  tone: string;
  brand: string; domain: string; scanText: string; ctaText: string;
  fileBase: string;
  texts: InviteCardTexts;
  toast?: (msg: string) => void;
}
interface InviteCardModule {
  openInviteCard(cfg: InviteCardConfig): Promise<void>;
  closeInviteCard(): void;
}

let engPromise: Promise<InviteCardModule> | null = null;
function engine(): Promise<InviteCardModule> {
  if (!engPromise) engPromise = import(/* @vite-ignore */ ENG_URL) as Promise<InviteCardModule>;
  return engPromise;
}

/**
 * 取一条本地化文案（2026-10-26 第 2 批，注释见 git 历史）。
 * 返回 === key 就当没查到，退回英文兜底 —— 判降级，Canvas 不烧裸 key。
 */
function i18nText(key: string, fallback: string): string {
  try {
    const w = window as unknown as {
      t?: (k: string) => string;
      i18n?: { t?: (k: string) => string };
    };
    const fn = w.i18n?.t ?? w.t;
    if (typeof fn === 'function') {
      const v = fn(key);
      if (typeof v === 'string' && v && v !== key) return v;
    }
  } catch {
    /* 字典未就绪 → 走英文兜底 */
  }
  return fallback;
}

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

/** 房码形态才画二维码；否则 qrSrc=null → Canvas 画 CTA 胶囊、弹窗隐藏二维码行 */
function qrSrcOf(d: ShareData, size: number): string | null {
  const code = d.url.split('/').pop() || '';
  if (!d.qrGame || !/^[A-Z2-9]{4,8}$/i.test(code)) return null;
  return '/api/qr?game=' + encodeURIComponent(d.qrGame) +
    '&code=' + encodeURIComponent(code) + '&size=' + size + '&cb=' + Date.now();
}

function textsOf(): InviteCardTexts {
  return {
    copy: i18nText('bg.bg_share_copy', '📋 Copy').replace(/^📋 /, ''),
    copied: i18nText('bg.bg_share_copied', 'Link copied'),
    copyFailed: i18nText('bg.bg_share_copy_failed', 'Copy failed'),
    save: i18nText('bg.bg_share_save', '⬇ Save Image').replace(/^⬇ /, ''),
    saved: i18nText('bg.bg_share_saved', 'Image saved'),
    share: i18nText('bg.bg_share_system', '💬 Share').replace(/^💬 /, ''),
    close: i18nText('bg.bg_share_close', 'Close'),
    linkAria: i18nText('bg.bg_share_link', 'Share link'),
    qrMain: i18nText('bg.bg_share_qr_hint', '📱 Scan or tap the link').replace(/^📱 /, ''),
    qrSub: i18nText('bg.bg_share_qr_sub', 'Invite a friend to your board'),
  };
}

/** 打开卡片（弹窗 + Canvas 绘制全部在公共引擎里） */
export async function openShareCard(d: ShareData): Promise<void> {
  await engine().then((m) => m.openInviteCard({
    title: d.title,
    subtitle: d.subtitle,
    big: d.big,
    bigLabel: d.bigLabel,
    stats: d.stats,
    url: d.url,
    qrSrc: qrSrcOf(d, 220),
    tone: d.tone || 'wood',
    brand: 'BoardDuel',
    domain: 'boardduel.com',
    scanText: i18nText('bg.bg_share_scan_board', 'Scan to play the same board'),
    ctaText: i18nText('bg.bg_share_cta_play', 'Play a free game'),
    fileBase: 'boardduel',
    texts: textsOf(),
    toast,
  }));
}

export function closeShareCard(): void {
  void engine().then((m) => m.closeInviteCard()).catch(() => { /* noop */ });
}

/* ───────────────────────── 便捷封装（API 不变） ───────────────────────── */

/**
 * 建房场景：把邀请信息渲染成可下载的卡片
 * @param gameId  worker 用的 game id（决定 /b/<gameId>/<CODE> 短链与二维码），如 'gomoku'
 * @param gameName 卡片上显示的名字，如 'Gomoku · 15×15'（只用于文案，别拿来拼链接）
 */
export function shareInvite(gameId: string, gameName: string, code: string, tone: 'wood' | 'indigo' | 'forest' = 'wood'): void {
  void openShareCard({
    tone,
    title: i18nText('bg.bg_share_invite_title', 'Invite a friend'),
    subtitle: `${gameName} · ${code}`,
    big: code,
    bigLabel: i18nText('bg.bg_share_room_code', 'Room code'),
    stats: [
      [i18nText('bg.bg_share_stat_board', 'Board'), gameName],
      [i18nText('bg.bg_share_stat_status', 'Status'), i18nText('bg.bg_share_stat_waiting', 'Waiting')],
      [i18nText('bg.bg_share_stat_price', 'Price'), i18nText('bg.bg_share_stat_free', 'Free')],
    ],
    url: location.origin + '/b/' + gameId + '/' + code,
    // Canvas 里也要用 gameId 取二维码，别再用展示名
    qrGame: gameId,
  });
}

/** 终局场景：比分 / 结果卡 */
export function shareResult(game: string, opts: {
  youWin: boolean; moves: number; durationSec: number; link: string; tone?: 'wood' | 'indigo' | 'forest'; qrGame?: string;
}): void {
  const m = Math.floor(opts.durationSec / 60);
  const s = Math.round(opts.durationSec % 60);
  void openShareCard({
    tone: opts.tone || (opts.youWin ? 'wood' : 'indigo'),
    title: opts.youWin
      ? i18nText('bg.bg_share_result_win', 'Victory')
      : i18nText('bg.bg_share_result_good', 'Good game'),
    subtitle: game,
    big: opts.youWin
      ? i18nText('bg.bg_share_big_win', 'WIN')
      : i18nText('bg.bg_share_big_loss', 'LOSS'),
    bigLabel: opts.youWin
      ? i18nText('bg.bg_share_win_sub', 'You took the board')
      : i18nText('bg.bg_share_loss_sub', 'Better luck next time'),
    stats: [
      [i18nText('bg.bg_share_stat_moves', 'Moves'), String(opts.moves)],
      [i18nText('bg.bg_share_stat_time', 'Time'), `${m}:${String(s).padStart(2, '0')}`],
      [i18nText('bg.bg_share_stat_site', 'Site'), 'BoardDuel'],
    ],
    url: opts.link,
    // 只有联机房局才有房码可编；单机 AI 对局没有码，卡片就不画二维码
    qrGame: opts.qrGame,
  });
}
