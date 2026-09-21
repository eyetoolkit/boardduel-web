(function(){
var SITE = location.hostname.indexOf('memoryduel')>-1?'memory':location.hostname.indexOf('mathduel')>-1?'math':'board';
var KEY = 'ach_' + SITE;
var DATA = JSON.parse(localStorage.getItem(KEY) || '{"unlocked":[],"streak":0,"streak_date":""}');
var ach = [{"id":"first_win","icon":"🏆","label":"First Victory","desc":"Win your first PvP match","color":"#f59e0b"},{"id":"streak_3","icon":"🔥","label":"On Fire","desc":"Win 3 PvP matches in a row","color":"#ef4444"},{"id":"daily_7","icon":"📅","label":"Daily Dedication","desc":"Complete daily challenge 7 days","color":"#10b981"},{"id":"perfect","icon":"💯","label":"Perfect Score","desc":"Get a perfect score on daily","color":"#6366f1"},{"id":"all_games","icon":"🎮","label":"Explorer","desc":"Play all game types","color":"#8b5cf6"}];
function unlock(id){
  if(DATA.unlocked.indexOf(id)>-1)return;
  DATA.unlocked.push(id);
  localStorage.setItem(KEY,JSON.stringify(DATA));
  var a=ach.find(function(x){return x.id===id});
  if(!a)return;
  var toast=document.createElement('div');
  toast.style='position:fixed;bottom:24px;right:24px;z-index:9998;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:16px 20px;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:system-ui,sans-serif;display:flex;align-items:center;gap:12px;max-width:320px;animation:achSlideIn 0.3s ease';
  toast.innerHTML='<span style="font-size:32px;flex-shrink:0">'+a.icon+'</span><div><div style="font-size:13px;font-weight:700">Achievement Unlocked!</div><div style="font-size:12px;opacity:0.85">'+a.label+'</div></div>';
  document.body.appendChild(toast);
  var st=document.createElement('style');
  st.textContent='@keyframes achSlideIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}';
  document.head.appendChild(st);
  setTimeout(function(){toast.style.opacity='0';toast.style.transition='opacity 0.3s';setTimeout(function(){toast.remove()},300)},4000);
}
function renderBadge(icon,color,label){
  var w=label.split(' ')[0];
  return '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border-radius:10px;background:color-mix(in srgb,'+color+' 10%,transparent);border:1.5px solid color-mix(in srgb,'+color+' 30%,transparent)"><span style="font-size:22px">'+icon+'</span><span style="font-size:10px;color:'+color+';font-weight:700;text-align:center;line-height:1.2">'+w+'</span></div>';
}
function render(container){
  var h='<div style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 0">';
  for(var i=0;i<ach.length;i++){
    var a=ach[i];
    if(DATA.unlocked.indexOf(a.id)>-1){h+=renderBadge(a.icon,a.color,a.label);}
    else{h+='<div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border-radius:10px;opacity:0.25"><span style="font-size:22px">'+a.icon+'</span><span style="font-size:10px;font-weight:700;text-align:center;line-height:1.2;color:var(--text-muted,#999)">???</span></div>';}
  }
  h+='</div>';
  container.insertAdjacentHTML('beforeend',h);
}
function checkStreak(){
  var today=new Date().toISOString().slice(0,10);
  if(DATA.streak_date===today)return;
  if(DATA.streak_date){
    var diff=(new Date(today)-new Date(DATA.streak_date))/86400000;
    if(diff<=1.5){DATA.streak++;if(DATA.streak===7)unlock('daily_7');}else{DATA.streak=1;}
  }else{DATA.streak=1;}
  DATA.streak_date=today;
  localStorage.setItem(KEY,JSON.stringify(DATA));
}
var done=false;
function run(){
  if(done)return;done=true;
  checkStreak();
  var el=document.getElementById('accountCard')||document.getElementById('account-rows')||document.querySelector('.account-card');
  if(!el)return;
  if(el.querySelector('.ach-section'))return;
  var sec=document.createElement('div');
  sec.className='ach-section';
  sec.style.cssText='margin-top:12px;padding-top:12px;border-top:1px solid var(--border,#e5e7eb)';
  var lbl=document.createElement('div');
  lbl.style.cssText='font-size:12px;font-weight:600;color:var(--text-muted,#6b7280);margin-bottom:8px';
  lbl.textContent='Achievements';
  var badges=document.createElement('div');
  sec.appendChild(lbl);sec.appendChild(badges);el.appendChild(sec);
  render(badges);
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',run);}else{run();}
window.AchUnlock=unlock;window.AchStreak=checkStreak;
})()