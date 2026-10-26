/* 每日工作清单 — 前端逻辑 */
'use strict';
const API = '/api';
const $ = (s) => document.querySelector(s);
const store = {
  get(k, d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch{ return d; } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
};
const pad = (n) => String(n).padStart(2,'0');
const ymd = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const todayYmd = () => ymd(Date.now());
const WEEK = ['周日','周一','周二','周三','周四','周五','周六'];

let state = {
  tasks: [],
  history: {},           // {date:{due,done}}
  settings: { remind:'none', snooze:true, dndStart:'22:00', dndEnd:'08:00', theme:'light', hideDone:true },
  auth: null,            // {token, account}
  pushEnabled: false,
};

/* ---------- 时间 / 循环 ---------- */
function timeToTs(time, base = new Date()){
  const [h, m] = time.split(':').map(Number);
  const d = new Date(base); d.setHours(h, m, 0, 0); return d.getTime();
}
function hhmm(ts){ const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function lastDayOfMonth(y, m){ return new Date(y, m+1, 0).getDate(); }

function nextOccurrence(dueTs, t){
  let d = new Date(dueTs);
  if(t.repeat === 'day'){
    d = new Date(d.getTime() + 86400000);
    while(d.getTime() <= Date.now()) d = new Date(d.getTime() + 86400000);
    return d.getTime();
  }
  if(t.repeat === 'week'){
    let cur = new Date(d); cur.setDate(cur.getDate() + 1);
    while(cur.getDay() !== Number(t.weekday)) cur.setDate(cur.getDate() + 1);
    return cur.getTime();
  }
  if(t.repeat === 'month'){
    let cur = new Date(d); cur.setMonth(cur.getMonth() + 1);
    const day = Math.min(Number(t.monthday), lastDayOfMonth(cur.getFullYear(), cur.getMonth()));
    cur.setDate(day);
    return cur.getTime();
  }
  return d.getTime();
}

/* ---------- 任务判定 ---------- */
function isDoneToday(t){ return t.doneDate === todayYmd(); }
function isOverdue(t){ return !isDoneToday(t) && t.dueTs <= Date.now(); }
function repeatLabel(t){ return {day:'日', week:'周', month:'月'}[t.repeat] || ''; }

/* ---------- 渲染 ---------- */
function render(){
  const active = [], done = [];
  for(const t of state.tasks){
    if(isDoneToday(t)) done.push(t); else active.push(t);
  }
  active.sort((a,b)=> a.dueTs - b.dueTs);

  const list = $('#task-list'); list.innerHTML = '';
  for(const t of active) list.appendChild(taskEl(t, false));
  const dlist = $('#done-list'); dlist.innerHTML = '';
  for(const t of done) dlist.appendChild(taskEl(t, true));

  // 已完成默认隐藏：hideDone 为 true 且未手动展开时隐藏
  const showDone = !state.settings.hideDone || state._showDone;
  dlist.classList.toggle('hidden', !showDone);
  const sd = $('#show-done');
  sd.classList.toggle('hidden', done.length === 0);
  sd.textContent = (showDone ? '收起已完成 ▾ ' : '显示已完成 ') + done.length + ' 项' + (showDone ? '' : ' ▴');

  // 统计行
  const total = state.tasks.length;
  const doneToday = done.length;
  const streak = calcStreak();
  $('#date-label').textContent = `${new Date().getMonth()+1}月${new Date().getDate()}日 ${WEEK[new Date().getDay()]}`;
  const hiddenMark = (state.settings.hideDone && !state._showDone) ? '　·　已隐藏 ✓' : '';
  $('#stats-line').innerHTML = `今日 <b>${doneToday}/${total}</b> 已完成　<span style="color:#ff9f0a">🔥 连续 ${streak} 天</span>${hiddenMark}`;
}

function taskEl(t, isDone){
  const li = document.createElement('li');
  li.className = 'item' + (isOverdue(t) ? ' over' : '') + (isDone ? ' done' : '');
  const over = isOverdue(t);
  const check = document.createElement('button');
  check.className = 'check' + (isDone ? ' done' : (over ? ' over' : ''));
  check.textContent = isDone ? '✓' : (over ? '✗' : '');
  check.onclick = (e)=>{ e.stopPropagation(); toggleDone(t); };
  const body = document.createElement('div'); body.className = 'body';
  const title = document.createElement('div'); title.className = 'title' + (isDone ? ' done' : '');
  title.textContent = t.title;
  body.appendChild(title);
  if(t.note){ const m = document.createElement('div'); m.className='meta'; m.textContent = t.note; body.appendChild(m); }
  const right = document.createElement('div'); right.className = 'right';
  if(t.priority && t.priority !== 'none'){ const p = document.createElement('span'); p.className = 'pri ' + t.priority; right.appendChild(p); }
  const time = document.createElement('span');
  time.className = 'time' + (over ? ' over' : '');
  time.textContent = isDone ? '已完成' : (over ? '逾期 ' + hhmm(t.dueTs) : hhmm(t.dueTs));
  right.appendChild(time);
  if(t.repeat !== 'none'){ const tag = document.createElement('span'); tag.className = 'tag ' + t.repeat; tag.textContent = repeatLabel(t); right.appendChild(tag); }
  li.appendChild(check); li.appendChild(body); li.appendChild(right);
  li.onclick = ()=> openEditor(t);
  return li;
}

/* ---------- 完成 / 循环 ---------- */
function toggleDone(t){
  const now = Date.now();
  if(isDoneToday(t)){
    t.doneDate = null;                 // 取消完成
  } else {
    t.doneDate = todayYmd();
    t.lastDoneTs = now;
    if(t.repeat !== 'none'){ t.dueTs = nextOccurrence(t.dueTs, t); }
  }
  recordHistory();
  save(); render(); pushSync();
}

/* ---------- 历史 / 统计 ---------- */
function recordHistory(){
  const d = todayYmd();
  const due = state.tasks.filter(t => t.repeat !== 'none' || ymd(t.dueTs) === d).length;
  const done = state.tasks.filter(isDoneToday).length;
  state.history[d] = { due, done };
}
function calcStreak(){
  let s = 0; const cur = new Date();
  for(;;){
    const k = ymd(cur.getTime());
    const h = state.history[k];
    if(h && h.done > 0){ s++; cur.setDate(cur.getDate()-1); }
    else break;
  }
  return s;
}

/* ---------- 编辑器 ---------- */
let editing = null;
function openEditor(t){
  editing = t || null;
  $('#editor-title').textContent = t ? '编辑任务' : '添加任务';
  $('#f-title').value = t ? t.title : '';
  $('#f-time').value = t ? hhmm(t.dueTs) : '09:00';
  $('#f-priority').value = t ? (t.priority||'none') : 'none';
  $('#f-repeat').value = t ? (t.repeat||'none') : 'none';
  $('#f-weekday').value = t ? (t.weekday||'1') : '1';
  $('#f-monthday').value = t ? (t.monthday||'1') : '1';
  $('#f-note').value = t ? (t.note||'') : '';
  $('#f-delete').classList.toggle('hidden', !t);
  syncRepeatUI();
  $('#editor').classList.remove('hidden');
}
function syncRepeatUI(){
  const r = $('#f-repeat').value;
  $('#f-week-wrap').classList.toggle('hidden', r !== 'week');
  $('#f-month-wrap').classList.toggle('hidden', r !== 'month');
}
function saveEditor(){
  const title = $('#f-title').value.trim();
  if(!title){ toast('请输入任务名称'); return; }
  const time = $('#f-time').value || '09:00';
  const repeat = $('#f-repeat').value;
  const data = {
    title, time, repeat,
    priority: $('#f-priority').value,
    weekday: $('#f-weekday').value,
    monthday: $('#f-monthday').value,
    note: $('#f-note').value.trim(),
  };
  if(editing){
    Object.assign(editing, data);
    editing.dueTs = timeToTs(time, new Date(editing.dueTs || Date.now()));
  } else {
    state.tasks.push({
      id: 't' + Date.now() + Math.random().toString(36).slice(2,6),
      ...data, dueTs: firstDue(time, data), doneDate: null, lastDoneTs: null, createdAt: Date.now(),
    });
  }
  recordHistory(); save(); render(); pushSync();
  $('#editor').classList.add('hidden');
}
function deleteEditing(){
  if(editing){ state.tasks = state.tasks.filter(t => t !== editing); recordHistory(); save(); render(); pushSync(); }
  $('#editor').classList.add('hidden');
}

function firstDue(time, data){
  if(data.repeat === 'week'){
    const wd = Number(data.weekday);
    let cur = new Date(timeToTs(time));
    while(cur.getDay() !== wd) cur.setDate(cur.getDate() + 1);
    if(cur.getTime() <= Date.now()) cur.setDate(cur.getDate() + 7);
    return cur.getTime();
  }
  if(data.repeat === 'month'){
    const md = Number(data.monthday);
    let cur = new Date(timeToTs(time));
    cur.setDate(Math.min(md, lastDayOfMonth(cur.getFullYear(), cur.getMonth())));
    if(cur.getTime() <= Date.now()){
      cur.setMonth(cur.getMonth() + 1);
      cur.setDate(Math.min(md, lastDayOfMonth(cur.getFullYear(), cur.getMonth())));
    }
    return cur.getTime();
  }
  return timeToTs(time);
}

/* ---------- 自然语言解析 ---------- */
function parseNatural(text){
  // 返回 {title, time, repeat, weekday, monthday} 或 null（部分）
  let title = text, time = '09:00', repeat = 'none', weekday = '1', monthday = '1';
  const wmap = {'日':0,'天':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6};
  if(/每天|每日/.test(text)) repeat = 'day';
  const wm = text.match(/周([日天一二三四五六])/);
  if(wm){ repeat = 'week'; weekday = String(wmap[wm[1]]); }
  const mm = text.match(/每月(\d{1,2})[号日]/);
  if(mm){ repeat = 'month'; monthday = mm[1]; }
  const hm = text.match(/(\d{1,2})[:：](\d{2})/);
  if(hm){ time = pad(+hm[1]) + ':' + hm[2]; }
  else {
    const cn = text.match(/(早上|早晨|上午|中午|下午|晚上|早|晚)(\d{1,2})/);
    if(cn){ let h = +cn[2]; if(/下午|晚上|晚/.test(cn[1]) && h < 12) h += 12; if(/早上|早晨|早/.test(cn[1])) h = Math.min(h,12); time = pad(h) + ':00'; }
  }
  if(/明天/.test(text)){ const d = new Date(); d.setDate(d.getDate()+1); time = hhmm(timeToTs(time, d)); }
  else if(/后天/.test(text)){ const d = new Date(); d.setDate(d.getDate()+2); time = hhmm(timeToTs(time, d)); }
  title = text.replace(/(每天|每日|每周[日天一二三四五六]|每月\d{1,2}[号日]|明天|后天|\d{1,2}[:：]\d{2}|(早上|早晨|上午|中午|下午|晚上|早|晚)\d{1,2})/g, '').replace(/\s+/g,' ').trim();
  return { title: title || text, time, repeat, weekday, monthday };
}

/* ---------- 同步（后端） ---------- */
async function pushSync(){
  if(!state.auth) return;
  try{
    await fetch(API + '/tasks', { method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: state.auth.token, tasks: state.tasks, history: state.history }) });
  }catch(e){ /* 离线，下次同步 */ }
}
async function pullSync(){
  if(!state.auth) return;
  try{
    const r = await fetch(API + '/tasks?token=' + encodeURIComponent(state.auth.token));
    const j = await r.json();
    if(j.tasks){ state.tasks = j.tasks; state.history = j.history || {}; save(); render(); }
  }catch(e){}
}

/* ---------- 设置 / 账号 / 推送 ---------- */
function openSettings(){
  const p = $('#settings-panel'); p.innerHTML = '';
  const acc = state.auth ? state.auth.account : '未登录';
  const row = (label, val, fn) => { const d=document.createElement('div'); d.className='row-item'; d.innerHTML=`<span class="label">${label}</span>`; const b=document.createElement('button'); b.className='btn-link'; b.textContent=val; b.onclick=fn; d.appendChild(b); return d; };
  const card = document.createElement('div'); card.className='card';
  card.appendChild(row('账号', acc, ()=> state.auth ? logout() : openAuth()));
  if(state.auth) card.appendChild(row('退出登录', '退出', logout));
  p.appendChild(card);

  const c2 = document.createElement('div'); c2.className='card';
  const remindSel = mkSelect(['none|仅到点到','5|提前5分钟','15|提前15分钟','30|提前30分钟'], state.settings.remind);
  c2.appendChild(labeled('提醒方式', remindSel, v=>{ state.settings.remind=v; save(); }));
  const dndS = mkTime(state.settings.dndStart), dndE = mkTime(state.settings.dndEnd);
  const dnd = document.createElement('div'); dnd.className='row-item'; dnd.innerHTML='<span class="label">勿扰时段</span>';
  const wr = document.createElement('div'); wr.style.display='flex'; wr.style.gap='6px'; wr.appendChild(dndS); wr.appendChild(dndE); dnd.appendChild(wr);
  dndS.onchange = ()=>{ state.settings.dndStart=dndS.value; save(); }; dndE.onchange=()=>{ state.settings.dndEnd=dndE.value; save(); };
  c2.appendChild(dnd);
  const themeSel = mkSelect(['light|浅色','dark|深色'], state.settings.theme);
  c2.appendChild(labeled('主题', themeSel, v=>{ state.settings.theme=v; applyTheme(); save(); }));
  p.appendChild(c2);

  const c3 = document.createElement('div'); c3.className='card';
  c3.appendChild(row('开启闹钟提醒', state.pushEnabled?'已开启':'去开启', enablePush));
  c3.appendChild(row('日历订阅(.ics)', '复制链接', copyCalendarLink));
  c3.appendChild(row('数据备份', '导出JSON', exportBackup));
  p.appendChild(c3);

  const c4 = document.createElement('div'); c4.className='card';
  c4.appendChild(row('完成统计', '查看', ()=>{ showView('stats-view'); renderStats(); }));
  p.appendChild(c4);

  showView('settings-view');
}
function mkSelect(opts, val){
  const s = document.createElement('select'); s.style.cssText='background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:6px 10px;font-size:14px;';
  for(const o of opts){ const [v,t]=o.split('|'); const op=document.createElement('option'); op.value=v; op.textContent=t; if(v===val)op.selected=true; s.appendChild(op); }
  return s;
}
function mkTime(v){ const i=document.createElement('input'); i.type='time'; i.value=v; i.style.cssText='background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:6px 8px;font-size:14px;'; return i; }
function labeled(label, el, fn){ const d=document.createElement('div'); d.className='row-item'; const l=document.createElement('span'); l.className='label'; l.textContent=label; d.appendChild(l); el.onchange=()=>fn(el.value); d.appendChild(el); return d; }

function openAuth(){
  $('#a-msg').textContent=''; $('#a-account').value=''; $('#a-pass').value='';
  $('#auth').classList.remove('hidden');
}
async function doAuth(){
  const account = $('#a-account').value.trim(), pass = $('#a-pass').value;
  if(!account || !pass){ $('#a-msg').textContent='请填写账号和密码'; return; }
  try{
    const r = await fetch(API + '/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({account, pass}) });
    const j = await r.json();
    if(j.token){ state.auth = { token:j.token, account }; save(); $('#auth').classList.add('hidden'); toast('已登录'); await pullSync(); openSettings(); }
    else $('#a-msg').textContent = j.error || '登录失败';
  }catch(e){ $('#a-msg').textContent='网络错误'; }
}
function logout(){ state.auth=null; save(); toast('已退出'); openSettings(); }

async function enablePush(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)){ toast('当前浏览器不支持推送'); return; }
  const perm = await Notification.requestPermission();
  if(perm !== 'granted'){ toast('需允许通知权限'); return; }
  try{
    const reg = await navigator.serviceWorker.ready;
    const vapid = await (await fetch(API + '/vapid')).text();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: urlBase64ToUint8(vapid) });
    if(state.auth) await fetch(API + '/sub', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token: state.auth.token, sub }) });
    state.pushEnabled = true; save(); toast('闹钟提醒已开启'); openSettings();
  }catch(e){ toast('推送订阅失败'); }
}
function urlBase64ToUint8(b){ const p='='.repeat((4-b.length%4)%4); const s=atob((b+p).replace(/-/g,'+').replace(/_/g,'/')); const u=new Uint8Array(s.length); for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i); return u; }

function copyCalendarLink(){
  if(!state.auth){ toast('请先登录账号'); return; }
  const url = location.origin + API + '/calendar?token=' + encodeURIComponent(state.auth.token);
  navigator.clipboard.writeText(url).then(()=> toast('日历订阅链接已复制，粘到手机日历的“添加订阅”即可'), ()=> prompt('复制此链接：', url));
}
function exportBackup(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '清单备份.json'; a.click();
}

function renderStats(){
  const p = $('#stats-panel'); p.innerHTML='';
  const today = state.history[todayYmd()] || {due:state.tasks.length, done:0};
  const big = document.createElement('div'); big.className='stat-big';
  big.innerHTML = `<div class="num">${today.done}/${today.due}</div><div class="cap">今日完成　🔥 连续 ${calcStreak()} 天</div>`;
  p.appendChild(big);
  const card = document.createElement('div'); card.className='card';
  card.innerHTML = '<div class="section-title">最近 7 天</div>';
  const wk = document.createElement('div'); wk.className='week';
  const now = new Date();
  for(let i=6;i>=0;i--){ const d=new Date(now); d.setDate(d.getDate()-i); const k=ymd(d.getTime()); const h=state.history[k]; const on = h && h.done>0;
    wk.innerHTML += `<div class="d${on?' on':''}">${d.getMonth()+1}/${d.getDate()}<b>${h?h.done:'·'}</b></div>`; }
  card.appendChild(wk); p.appendChild(card);
}

/* ---------- 视图切换 ---------- */
function showView(id){
  for(const v of document.querySelectorAll('.view')) v.classList.add('hidden');
  $('#'+id).classList.remove('hidden');
}

/* ---------- 杂项 ---------- */
function applyTheme(){ document.body.classList.toggle('dark', state.settings.theme==='dark'); $('#theme-color').setAttribute('content', state.settings.theme==='dark' ? '#000000' : '#f5f5f7'); }
let toastTimer;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.add('hidden'), 1800); }
function save(){ store.set('tasks', state.tasks); store.set('history', state.history); store.set('settings', state.settings); store.set('auth', state.auth); store.set('pushEnabled', state.pushEnabled); }
function load(){ state.tasks = store.get('tasks', []); state.history = store.get('history', {}); state.settings = Object.assign(state.settings, store.get('settings', {})); state.auth = store.get('auth', null); state.pushEnabled = store.get('pushEnabled', false); }

/* ---------- 本地到点提醒（页面打开时的兜底） ---------- */
function localReminderCheck(){
  for(const t of state.tasks){
    if(isDoneToday(t) || !inRemindWindow(t)) continue;
    if(!t._reminded || t._reminded !== ymd(t.dueTs)){
      if(Notification.permission === 'granted'){ new Notification('⏰ ' + t.title, { body: '该完成了：' + hhmm(t.dueTs) }); t._reminded = ymd(t.dueTs); }
    }
  }
}
function inRemindWindow(t){
  const now = Date.now();
  if(now < t.dueTs) return false;
  const s = state.settings.dndStart.split(':').map(Number), e = state.settings.dndEnd.split(':').map(Number);
  const cur = new Date().getHours()*60 + new Date().getMinutes();
  const ss = s[0]*60+s[1], ee = e[0]*60+e[1];
  const inDnd = ss>ee ? (cur>=ss||cur<ee) : (cur>=ss&&cur<ee);
  return !inDnd;
}

/* ---------- 初始化 ---------- */
function init(){
  load(); applyTheme(); render();
  // 事件
  $('#btn-menu').onclick = openSettings;
  $('#show-done').onclick = ()=>{ state._showDone = !state._showDone; render(); };
  $('#btn-back').onclick = ()=> showView('list-view');
  $('#btn-back2').onclick = ()=> showView('list-view');
  $('#btn-add').onclick = ()=>{ // 默认自然语言模式：直接弹出，标题框支持自然语言
    openEditor(null);
  };
  $('#editor-mask').onclick = ()=> $('#editor').classList.add('hidden');
  $('#f-cancel').onclick = ()=> $('#editor').classList.add('hidden');
  $('#f-save').onclick = ()=>{
    // 自然语言：若标题含时间/重复关键词，解析填充
    const raw = $('#f-title').value;
    if(!editing && /(明天|后天|每天|每日|每周|每月|\d{1,2}[:：]|早上|上午|中午|下午|晚上|早|晚)/.test(raw)){
      const p = parseNatural(raw);
      $('#f-title').value = p.title; $('#f-time').value = p.time; $('#f-repeat').value = p.repeat;
      $('#f-weekday').value = p.weekday; $('#f-monthday').value = p.monthday; syncRepeatUI();
    }
    saveEditor();
  };
  $('#f-delete').onclick = deleteEditing;
  $('#f-repeat').onchange = syncRepeatUI;
  $('#auth-mask').onclick = ()=> $('#auth').classList.add('hidden');
  $('#a-cancel').onclick = ()=> $('#auth').classList.add('hidden');
  $('#a-login').onclick = doAuth;

  // 服务 worker
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});

  // 同步 & 定时
  if(state.auth) pullSync();
  setInterval(()=>{ const before = todayYmd(); render(); if(before !== todayYmd()) recordHistory(); localReminderCheck(); }, 30000);
  // 跨日检查
  setInterval(()=>{ if(new Date().getHours()===0 && new Date().getMinutes()===0) recordHistory(); }, 60000);
}
document.addEventListener('DOMContentLoaded', init);
