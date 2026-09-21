(function(){
  /* ============================================================
     邀请好友卡片组件
     Usage:
       InviteCard.open()    // 打开邀请弹窗
       InviteCard.close()
     Trigger: <button data-open-invite> / 任何带 [data-invite-trigger] 的元素
  ============================================================ */
  'use strict';

  function qs(s){return document.querySelector(s);}
  function qsa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}

  var state = { stats: null, code: null, loading: false };
  var TIERS = [
    { count: 3, days: 90, label: '3\u4eba', desc: '3\u4e2a\u6708\u514d\u5e7f\u544a' },
    { count: 5, days: 180, label: '5\u4eba', desc: '\u534a\u5e74\u514d\u5e7f\u544a' },
    { count: 10, days: 365, label: '10\u4eba', desc: '1\u5e74\u514d\u5e7f\u544a' }
  ];

  function load(cb){
    if (state.loading) return;
    state.loading = true;
    Promise.all([
      fetch('/api/invite/my-code', {credentials:'same'}).then(function(r){return r.json();}),
      fetch('/api/invite/my-stats', {credentials:'same'}).then(function(r){return r.json();})
    ]).then(function(rs){
      state.code = rs[0];
      state.stats = rs[1];
      state.loading = false;
      if (cb) cb();
    }).catch(function(){
      state.loading = false;
      if (cb) cb();
    });
  }

  function renderContent(){
    var stats = state.stats || {};
    var code = state.code || {};
    var validCount = stats.valid_invites || 0;

    var tierHtml = TIERS.map(function(t){
      var achieved = validCount >= t.count;
      var inProgress = validCount < t.count;
      var pct = Math.min(100, Math.round((validCount / t.count) * 100));
      var cls = achieved ? 'ach' : (inProgress ? 'prog' : '');
      var bar = achieved ? '<div class="bar-fill" style="width:100%"></div>'
        : '<div class="bar-fill" style="width:' + pct + '%"></div>';
      var status = achieved
        ? '<span class="achieved">\u2713 \u5df2\u8fbe\u6210</span>'
        : '<span class="progress">' + validCount + ' / ' + t.count + '</span>';
      return '<div class="tier ' + cls + '">'
        + '<div class="tier-head"><span class="tier-label">\u62db\u8058 ' + t.label + '</span>'
        + '<span class="tier-desc">' + t.desc + '</span>'
        + status
        + '</div>'
        + '<div class="bar"><div class="bar-track">' + bar + '</div></div>'
        + '</div>';
    }).join('');

    var urls = code.urls || [];
    var invUrl = urls[0] || (code.code ? 'https://mathduel.games/?ref=' + code.code : '');

    var recHtml = '';
    var records = (stats.invitee_records || []).slice(0, 5);
    if (records.length) {
      recHtml = '<div class="recs"><h4>\u6700\u8fd1\u9080\u8bf7</h4><ul>'
        + records.map(function(r){
          var u = r.uuid.slice(0,8);
          var d = new Date(r.joined_at).toLocaleDateString();
          return '<li><code>' + u + '</code> \u00b7 ' + d + '</li>';
        }).join('')
        + '</ul></div>';
    }

    var codeStr = code.code || '\u52a0\u8f7d\u4e2d...';

    return '<div class="inv-card">'
      + '<div class="inv-hero">'
      + '<div class="inv-title">\uD83C\uDF81 \u9080\u8bf7\u597d\u53cb \u00b7 \u73b0\u91d1\u8fd4\u5229</div>'
      + '<div class="inv-sub">\u6bcf\u9080\u8bf7 1 \u4f4d\u6709\u6548\u65b0\u4eba\uff0c\u83b7\u5f97 <b>500 \u79ef\u5206</b></div>'
      + '</div>'

      + '<div class="tiers">' + tierHtml + '</div>'

      + '<div class="link-box">'
      + '<div class="link-label">\u4f60\u7684\u9080\u8bf7\u94fe\u63a5</div>'
      + '<div class="link-row">'
      + '<input id="invite-link-input" type="text" value="' + invUrl + '" readonly />'
      + '<button id="copy-invite-link" class="copy-btn">\uD83D\uDCCB \u590d\u5236</button>'
      + '</div>'
      + '<div class="link-meta">\u4ee3\u7801\uff1a<code>' + codeStr + '</code> \u00b7 \u4e09\u7ad9\u901a\u7528</div>'
      + '</div>'

      + recHtml

      + '<div class="qr-section">'
      + '<button id="toggle-qr" class="link-btn">\uD83D\uDCF1 \u663e\u793a/\u9690\u85cf\u4e8c\u7ef4\u7801</button>'
      + '<div id="qr-container" style="display:none;text-align:center;padding:14px 0"></div>'
      + '</div>'

      + '<div class="inv-footer">\u9080\u8bf7\u8005\u4ee5\u9080\u8bf7\u94fe\u63a5\u6ce8\u518C\u4e14\u5728 7 \u5929\u5185\u5b8c\u6210 5 \u5c40\u6e38\u620f\u540e\u751f\u6548</div>'
      + '</div>';
  }

  function renderQR(text, el){
    if (typeof QRCode === 'undefined') {
      // 动态加载 qrcode.js
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
      s.onload = function(){ doQR(text, el); };
      document.head.appendChild(s);
    } else {
      doQR(text, el);
    }
  }

  function doQR(text, el){
    el.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(el, { text: text, width: 180, height: 180, colorDark: '#1f2937', colorLight: '#fff' });
    } else {
      el.innerHTML = '<p style="color:#9ca3af">QR \u5e93\u52a0\u8f7d\u5931\u8d25</p>';
    }
  }

  function open(){
    injectStyles();
    var ov = qs('#invite-overlay');
    if (!ov) createOverlay();
    ov = qs('#invite-overlay');
    ov.style.display = 'flex';

    var panel = qs('#invite-panel');
    if (panel) panel.innerHTML = '<div style="text-align:center;padding:60px 0;color:#9ca3af">\u52a0\u8f7d\u4e2d...</div>';

    load(function(){
      if (panel) panel.innerHTML = renderContent();
      bindEvents();
    });
  }

  function close(){
    var ov = qs('#invite-overlay');
    if (ov) ov.style.display = 'none';
  }

  function bindEvents(){
    var copyBtn = qs('#copy-invite-link');
    if (copyBtn) {
      copyBtn.addEventListener('click', function(){
        var input = qs('#invite-link-input');
        if (input) {
          input.select();
          try {
            navigator.clipboard.writeText(input.value);
            copyBtn.textContent = '\u2713 \u5df2\u590d\u5236';
            setTimeout(function(){ copyBtn.textContent = '\uD83D\uDCCB \u590d\u5236'; }, 1500);
          } catch(e) {
            document.execCommand('copy');
            copyBtn.textContent = '\u2713 \u5df2\u590d\u5236';
          }
        }
      });
    }
    var qrBtn = qs('#toggle-qr');
    if (qrBtn) {
      qrBtn.addEventListener('click', function(){
        var qc = qs('#qr-container');
        if (!qc) return;
        var input = qs('#invite-link-input');
        if (qc.style.display === 'none') {
          qc.style.display = '';
          renderQR(input ? input.value : '', qc);
        } else {
          qc.style.display = 'none';
        }
      });
    }
  }

  function createOverlay(){
    var ov = document.createElement('div');
    ov.id = 'invite-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:none;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = '<div id="invite-panel" style="background:#fff;border-radius:18px;width:min(500px,96vw);max-height:90vh;overflow-y:auto;padding:28px 24px 22px;position:relative;box-shadow:0 24px 80px rgba(0,0,0,.25)"></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){
      if (e.target === ov) close();
    });

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.setAttribute('aria-label', '\u5173\u95ed');
    closeBtn.style.cssText = 'position:absolute;top:14px;right:18px;background:none;border:none;font-size:22px;cursor:pointer;color:#9ca3af;padding:4px 10px;border-radius:6px;transition:.15s;';
    closeBtn.onmouseover = function(){ this.style.background='#f3f4f6'; this.style.color='#374151'; };
    closeBtn.onclick = close;
    var panel = ov.querySelector('#invite-panel');
    if (panel) panel.appendChild(closeBtn);
  }

  function injectStyles(){
    if (qs('#invite-styles')) return;
    var css = document.createElement('style');
    css.id = 'invite-styles';
    css.textContent = [
      '.inv-card{font-family:inherit;color:#1f2937}',
      '.inv-hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border-radius:14px;padding:20px 22px;margin-bottom:18px;text-align:center}',
      '.inv-title{font-size:18px;font-weight:700;margin-bottom:4px}',
      '.inv-sub{font-size:13px;opacity:.9}',
      '.inv-sub b{color:#fde047;font-weight:700}',
      '.tiers{display:grid;gap:10px;margin-bottom:18px}',
      '.tier{border:1.5px solid #e5e7eb;border-radius:12px;padding:14px;background:#f9fafb}',
      '.tier.ach{border-color:#10b981;background:#f0fdf4}',
      '.tier.prog{border-color:#c7d2fe;background:#fff}',
      '.tier-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:8px}',
      '.tier-label{font-weight:700;font-size:15px;color:#1f2937}',
      '.tier-desc{font-size:12px;color:#6b7280}',
      '.achieved{color:#059669;font-size:12px;font-weight:700}',
      '.progress{color:#4f46e5;font-size:12px;font-weight:600}',
      '.bar-track{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}',
      '.bar-fill{height:100%;background:linear-gradient(90deg,#4f46e5,#7c3aed);border-radius:4px;transition:width .3s}',
      '.tier.ach .bar-fill{background:linear-gradient(90deg,#10b981,#059669)}',
      '.link-box{background:#f3f4f6;border-radius:12px;padding:14px;margin-bottom:14px}',
      '.link-label{font-size:12px;color:#6b7280;margin-bottom:8px;font-weight:600}',
      '.link-row{display:flex;gap:8px}',
      '.link-row input{flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;font-family:monospace;background:#fff;color:#1f2937}',
      '.copy-btn{background:#4f46e5;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;transition:.15s;white-space:nowrap}',
      '.copy-btn:hover{background:#4338ca}',
      '.link-meta{font-size:11px;color:#6b7280;margin-top:8px;text-align:center}',
      '.link-meta code{font-family:monospace;color:#4f46e5;font-weight:600}',
      '.recs{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:14px;max-height:120px;overflow-y:auto}',
      '.recs h4{margin:0 0 8px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px}',
      '.recs ul{list-style:none;padding:0;margin:0}',
      '.recs li{padding:6px 0;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6}',
      '.recs li:last-child{border:none}',
      '.recs code{font-family:monospace;color:#7c3aed;background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:11px}',
      '.qr-section{text-align:center;margin-bottom:14px}',
      '.link-btn{background:transparent;border:1px solid #d1d5db;color:#4b5563;padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;transition:.15s}',
      '.link-btn:hover{border-color:#4f46e5;color:#4f46e5}',
      '.inv-footer{font-size:11px;color:#9ca3af;text-align:center;padding-top:8px;border-top:1px solid #f3f4f6}'
    ].join('\n');
    document.head.appendChild(css);
  }

  // 全局事件监听
  document.addEventListener('click', function(e){
    var t = e.target;
    if (!t) return;
    if (t.closest('[data-open-invite]') || t.closest('[data-invite-trigger]')) {
      e.preventDefault();
      open();
    }
  });

  if (typeof window !== 'undefined') {
    window.InviteCard = { open: open, close: close, refresh: function(){ state.stats=null; state.code=null; load(function(){}); } };
  }
})();