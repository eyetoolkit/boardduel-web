/**
 * 棋谱导出按钮 · 共享 UI 层（2026-10-24 第四批 ⑰）
 * ------------------------------------------------------------
 * 8 款游戏的终局面板都有同一个容器 `.go-end-acts`（再来一局 / 复盘 / 分享…），
 * 这里只做一件事：往容器尾部插一个「导出棋谱」按钮，点击时调用该游戏自己的
 * build 回调拿到文本记录并下载。
 *
 * 终局判词（谁赢/和棋）不进各游戏状态——直接读终局面板上的
 * `[id$="-end-verdict"]` 文本，天然跟随当前语言，无需为导出再维护一份胜负。
 */
import { downloadRecord, recordFilename } from './export-record';
import { toast } from '../games/game-core';

/** build 回调：拿到终局判词，返回记录文本；返回 null 表示没有可导出的着法 */
export type RecordBuilder = (verdict: string) => string | null;

export interface MountExportOpts {
  /** 文件名中的游戏名（boardduel-<game>-时间戳） */
  game: string;
  /** 扩展名：sgf / pgn / txt */
  ext: string;
  build: RecordBuilder;
}

function verdictText(): string {
  const el = document.querySelector<HTMLElement>('[id$="-end-verdict"]');
  return (el?.textContent ?? '').trim();
}

/**
 * 挂载导出按钮。幂等：重复调用不会插第二个按钮。
 * 终局面板在游戏初始化时就存在于 DOM（只是 hidden），因此可在 init 期直接调用。
 */
export function mountExportButton(o: MountExportOpts): void {
  const host = document.querySelector<HTMLElement>('.go-end-acts');
  if (!host) return;
  if (host.querySelector('[data-bd-export]')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'go-btn';
  btn.dataset.bdExport = '1';
  btn.setAttribute('data-i18n', 'bg.bg_export');
  btn.textContent = window.t('bg.bg_export');

  btn.addEventListener('click', () => {
    const text = o.build(verdictText());
    if (!text) { toast(window.t('bg.bg_common_no_moves_yet')); return; }
    downloadRecord(recordFilename(o.game, o.ext), text);
    toast(window.t('bg.bg_export_done'));
  });

  host.appendChild(btn);
  // 动态插入的 data-i18n 节点要立刻翻译，否则要等下一轮 MutationObserver
  window.i18n?.applyToDOM(btn);
}
