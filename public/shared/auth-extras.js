/* ═══════════════════════════════════════════════════════════════
   跨站共用「登录态呈现」能力（P1, 2026-09-20）
   ────────────────────────────────────────────────────────────────
   背景：头像 emoji 字典、段位徽章 CSS、以及"把登录按钮渲染成
        `[段位] 头像 昵称`"这三块，此前**只存在于 mathduel 的 auth-modal.js**，
   boardduel / memoryduel 的登录按钮只有「👤 昵称」⇒ 典型的"改一漏二"漂移。
   现在抽成单一来源：三站页面引用本文件，auth-modal 通过 window.MDAuthExtras 使用；
   未加载时各站 auth-modal 仍有自己的降级路径（不会白屏）。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* 与各站 shared/avatars.js 的 id 保持一致（不依赖加载顺序） */
  var AVATAR_EMOJI = {
    'a-cat': '🐱', 'a-dog': '🐶', 'a-frog': '🐸', 'a-owl': '🦉', 'a-tiger': '🐯', 'a-bear': '🐻',
    'a-penguin': '🐧', 'a-unicorn': '🦄', 'a-robot': '🤖', 'a-ghost': '👻', 'a-turtle': '🐢', 'a-rabbit': '🐰',
    'a-fox': '🦊', 'a-panda': '🐼', 'a-lion': '🦁', 'a-octo': '🐙'
  };

  function avaIcon(id) {
    return (id && AVATAR_EMOJI[id]) || '👤';
  }

  /* 段位徽章样式（注入一次；避免与各站主题冲突） */
  function ensureTierChipCss() {
    try {
      if (typeof document === 'undefined' || document.getElementById('md-tier-chip-style')) return;
      var s = document.createElement('style');
      s.id = 'md-tier-chip-style';
      s.textContent = '.tier-chip{display:inline-flex;align-items:center;gap:.2rem;padding:.12rem .45rem;border-radius:6px;font-size:.72rem;font-weight:600;margin-right:.25rem;white-space:nowrap}';
      document.head.appendChild(s);
    } catch (e) { /* 注入失败不影响功能 */ }
  }

  function tierChipHtml(tier) {
    if (!tier || !tier.name) return '';
    ensureTierChipCss();
    var color = tier.color || '#4F46E5';
    return '<span class="tier-chip" style="background:' + color + '22;color:' + color + '">' +
      (tier.emoji || '🎖') + ' ' + tier.name + '</span> ';
  }

  /* 把任意元素的文案渲染成「[段位] 头像 昵称」；返回是否成功接管 */
  function decorateUserButton(btn, user) {
    if (!btn || !user) return false;
    try {
      var label = user.nickname || user.email || '用户';
      btn.innerHTML = tierChipHtml(user.tier) + avaIcon(user.avatar) + ' ' + label;
      return true;
    } catch (e) { return false; }
  }

  if (typeof window !== 'undefined') {
    window.MDAuthExtras = {
      avaIcon: avaIcon,
      tierChipHtml: tierChipHtml,
      decorateUserButton: decorateUserButton,
      ensureTierChipCss: ensureTierChipCss,
      AVATAR_EMOJI: AVATAR_EMOJI
    };
    ensureTierChipCss();
  }
})();
