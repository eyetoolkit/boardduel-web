/* ═══════════════════════════════════════════════════════════════
   BoardDuel 头像渲染助手 (boardduel 站内独立副本, 移植自 mathduel)
   用法:
     BDAvatars.chipHtml(id)  -> '<span class="bd-p-avatar">🐱</span>'
     BDAvatars.chip(el, id)  -> 渲染进容器
     BDAvatars.icon(id)      -> emoji 字符
     BDAvatars.pick(seed)    -> 由昵称确定性派生头像 id(无服务端头像时也能稳定显示)
   id 与 mathduel stores/account.js FREE_AVATARS + ep.js CATALOG 对齐;
   未知 id 兜底 🎭, 不抛错。
   ═════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var MAP = {
    /* 免费 12 */
    'a-cat': '🐱', 'a-dog': '🐶', 'a-frog': '🐸', 'a-owl': '🦉',
    'a-tiger': '🐯', 'a-bear': '🐻', 'a-penguin': '🐧', 'a-unicorn': '🦄',
    'a-robot': '🤖', 'a-ghost': '👻', 'a-turtle': '🐢', 'a-rabbit': '🐰',
    /* 商店付费 4 */
    'a-fox': '🦊', 'a-panda': '🐼', 'a-lion': '🦁', 'a-octo': '🐙'
  };
  function icon(id) { return (id && MAP[id]) || '🎭'; }
  function chipHtml(id) {
    if (!id) return '';   // 无头像数据不渲染, 避免满屏兜底脸
    return '<span class="bd-p-avatar">' + icon(id) + '</span>';
  }
  function chip(el, id, label) {
    if (!el) return;
    el.innerHTML = chipHtml(id) + (label ? '<span>' + label + '</span>' : '');
  }
  /* 由任意昵称确定性派生头像 id(FNV-1a 哈希取模), 让无服务端头像的玩家也有稳定头像 */
  function pick(seed) {
    var ids = Object.keys(MAP);
    var h = 2166136261 >>> 0;
    var s = String(seed == null ? '' : seed);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return ids[h % ids.length];
  }
  function ensureStyle() {
    if (document.getElementById('bd-p-avatar-style')) return;
    var st = document.createElement('style');
    st.id = 'bd-p-avatar-style';
    st.textContent =
      '.bd-p-avatar{display:inline-flex;align-items:center;justify-content:center;' +
      'width:1.6em;height:1.6em;font-size:1.05em;background:var(--bd-muted,#f9fafb);' +
      'border-radius:50%;vertical-align:-0.35em;margin-right:.35em;line-height:1;flex:none;' +
      'box-shadow:inset 0 0 0 1px rgba(0,0,0,.06);}';
    document.head.appendChild(st);
  }
  if (document.head) ensureStyle();
  else document.addEventListener('DOMContentLoaded', ensureStyle);
  window.BDAvatars = { icon: icon, chipHtml: chipHtml, chip: chip, pick: pick };
})();
