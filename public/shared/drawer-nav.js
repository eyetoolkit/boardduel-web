/* 移动端抽屉导航：汉堡按钮 + 侧边滑入 + 遮罩（借鉴 papergames.io）
   用法：页面上存在 #hamburger 按钮与 .drawer-backdrop 遮罩时启用 */
(function () {
  'use strict';

  function init() {
    var btn = document.getElementById('hamburger');
    if (!btn) return;

    var backdrop = document.querySelector('.drawer-backdrop');

    function open() {
      document.body.classList.add('drawer-open');
    }
    function close() {
      document.body.classList.remove('drawer-open');
    }

    btn.addEventListener('click', function () {
      document.body.classList.contains('drawer-open') ? close() : open();
    });

    if (backdrop) backdrop.addEventListener('click', close);

    // 点击导航链接后自动收起
    var closers = document.querySelectorAll('.sidebar-link, .sidebar-brand, .sidebar-footer a');
    for (var i = 0; i < closers.length; i++) {
      closers[i].addEventListener('click', close);
    }

    // ESC 关闭
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    // 放大到桌面断点以上时重置（避免残留遮罩）
    window.addEventListener('resize', function () {
      if (window.innerWidth > 820) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
