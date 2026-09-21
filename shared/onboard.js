(function(){
var h=location.hostname||"";
var site=h.indexOf("memoryduel")>-1?"memory":h.indexOf("mathduel")>-1?"math":"board";
var k="ob_done_"+site;
if(localStorage.getItem(k))return;
var d=JSON.parse('{"board":{"title":"Welcome to Board Duel!","sub":"How would you like to start?","options":[{"icon":"🌲","label":"Learn Rules","desc":"Understand the game first","href":"/how-to-play/gomoku/"},{"icon":"⚡","label":"Quick Match","desc":"Jump right in","href":"/games/gomoku/"},{"icon":"🏆","label":"Leaderboard","desc":"See top players","href":"/rank/"}]},"math":{"title":"Welcome to Math Duel!","sub":"How would you like to start?","options":[{"icon":"📚","label":"Learn Rules","desc":"Understand the game first","href":"/how-to-play/sudoku/"},{"icon":"📅","label":"Daily Challenge","desc":"Same puzzle as everyone worldwide","href":"/games/sudoku/"},{"icon":"⚡","label":"Quick Play","desc":"Jump right in","href":"/games/sudoku/"}]},"memory":{"title":"Welcome to Memory Duel!","sub":"How would you like to start?","options":[{"icon":"📚","label":"Learn Rules","desc":"Understand the game first","href":"/how-to-play/memory-match/"},{"icon":"⚡","label":"Quick Duel","desc":"Jump right in","href":"#lobby"},{"icon":"🏆","label":"Top Players","desc":"See global rankings","href":"#globalTop"}]}}');
var sd=d[site]||d.board;
var cards="";
for(var i=0;i<sd.options.length;i++){
  var o=sd.options[i];
  cards+='<a href="'+o.href+'" class="ob-card" onclick="ObDismiss()"><span class="ob-icon">'+o.icon+'</span><div class="ob-text"><strong>'+o.label+'</strong><small>'+o.desc+'</small></div><span class="ob-arrow">&#x2192;</span></a>';
}
var html='<style>.ob-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,sans-serif;opacity:0;transition:opacity 0.25s}.ob-box{background:var(--surface,#fff);border-radius:20px;max-width:460px;width:100%;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,0.3);position:relative}.ob-close{position:absolute;top:16px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;opacity:0.4;padding:4px;color:var(--text,#333);line-height:1}.ob-head{font-size:22px;font-weight:800;margin:0 0 4px;color:var(--text,#1a1a2e);text-align:center}.ob-sub{font-size:14px;color:var(--text-muted,#666);text-align:center;margin:0 0 24px}.ob-cards{display:flex;flex-direction:column;gap:10px}.ob-card{display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:12px;border:1.5px solid var(--border,#e5e7eb);text-decoration:none;color:inherit;background:var(--bg,#f9fafb);transition:border-color 0.15s,box-shadow 0.15s,transform 0.15s}.ob-card:hover{border-color:var(--brand,#6366f1);box-shadow:0 4px 16px rgba(99,102,241,0.15);transform:translateY(-1px)}.ob-icon{flex-shrink:0;font-size:28px}.ob-text{flex:1;text-align:left}.ob-text strong{display:block;font-size:15px;font-weight:700;color:var(--text,#1a1a2e)}.ob-text small{display:block;font-size:12px;color:var(--text-muted,#6b7280);margin-top:2px}.ob-arrow{font-size:18px;opacity:0.4;margin-left:auto;flex-shrink:0}</style><button class="ob-close" onclick="ObDismiss()" aria-label="Close">&#x2715;</button><div class="ob-head" translate="no">'+sd.title+'</div><p class="ob-sub" translate="no">'+sd.sub+'</p><div class="ob-cards">'+cards+'</div>';
document.body.insertAdjacentHTML('beforeend','<div class="ob-overlay" id="ob-overlay" onclick="ObOverlayClick(event)"><div class="ob-box">'+html+'</div></div>');
var ov=document.getElementById('ob-overlay');
requestAnimationFrame(function(){ov.style.opacity='1'});
window.ObDismiss=function(){
  localStorage.setItem(k,'1');
  ov.style.opacity='0';
  setTimeout(function(){ov.remove()},250);
};
window.ObOverlayClick=function(e){if(e.target===ov)ObDismiss()};
document.addEventListener('keydown',function(e){if(e.key==='Escape')ObDismiss()});
})()