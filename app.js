/* 每日工作清单 — 前端逻辑（无服务器版：直连 Supabase） */
'use strict';

/* ===== Supabase 连接（你的项目，已验证可用） ===== */
const SB_URL  = 'https://sjefpfgprwruiarifdnn.supabase.co';
const SB_ANON = 'sb_publishable_0CSTCrFS9bUP5kTmyTZ4Dw_zsUzG95x';
const AUTH = SB_URL + '/auth/v1';
const REST = SB_URL + '/rest/v1';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
};
const pad = (n) => String(n).padStart(2,'0');
const ymd = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const cnDate = (s) => { const p = String(s).split('-'); return `${p[0]}年${Number(p[1])}月${Number(p[2])}日`; };
const todayYmd = () => ymd(Date.now());
const WEEK = ['周日','周一','周二','周三','周四','周五','周六'];
const BYDAY = ['SU','MO','TU','WE','TH','FR','SA'];

let state = {
  tasks: [],
  history: {},
  settings: { remind:'none', dndStart:'22:00', dndEnd:'08:00', theme:'light', hideDone:true },
  session: null,     // { access_token, refresh_token, user_id, email }
  savedAt: 0,
  _showDone: false,
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
/* 从当前起算的下一个到期时间，用于日历 DTSTART */
function nextDue(t){
  const now = Date.now();
  const h = new Date(t.dueTs).getHours(), m = new Date(t.dueTs).getMinutes();
  if(t.repeat === 'day'){
    let d = new Date(); d.setHours(h, m, 0, 0);
    if(d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if(t.repeat === 'week'){
    let cur = new Date(); cur.setHours(h, m, 0, 0);
    while(cur.getDay() !== Number(t.weekday) || cur.getTime() <= now) cur.setDate(cur.getDate() + 1);
    return cur.getTime();
  }
  if(t.repeat === 'month'){
    let cur = new Date(); cur.setDate(1); cur.setHours(h, m, 0, 0);
    for(let i = 0; i < 60; i++){
      const day = Math.min(Number(t.monthday), lastDayOfMonth(cur.getFullYear(), cur.getMonth()));
      const cand = new Date(cur.getFullYear(), cur.getMonth(), day, h, m, 0, 0);
      if(cand.getTime() > now) return cand.getTime();
      cur.setMonth(cur.getMonth() + 1);
    }
    return null;
  }
  return t.dueTs;
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

  const showDone = !state.settings.hideDone || state._showDone;
  dlist.classList.toggle('hidden', !showDone);
  const sd = $('#show-done');
  sd.classList.toggle('hidden', done.length === 0);
  sd.textContent = (showDone ? '收起已完成 ▾ ' : '显示已完成 ') + done.length + ' 项' + (showDone ? '' : ' ▴');

  const total = state.tasks.length;
  const doneToday = done.length;
  const streak = calcStreak();
  $('#date-label').textContent = `${new Date().getMonth()+1}月${new Date().getDate()}日 ${WEEK[new Date().getDay()]}`;
  const hiddenMark = (state.settings.hideDone && !state._showDone) ? '　·　已隐藏 ✓' : '';
  const syncMark = state.session ? '　·　已同步 ☁' : '';
  $('#stats-line').innerHTML = `今日 <b>${doneToday}/${total}</b> 已完成　<span style="color:#ff9f0a">🔥 连续 ${streak} 天</span>${hiddenMark}${syncMark}`;
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
  time.className = 'time' + (isDone ? ' done-cn' : (over ? ' over' : ''));
  time.textContent = isDone ? ('完成于 ' + cnDate(t.doneDate)) : (over ? '逾期 ' + hhmm(t.dueTs) : hhmm(t.dueTs));
  right.appendChild(time);
  if(t.repeat !== 'none'){ const tag = document.createElement('span'); tag.className = 'tag ' + t.repeat; tag.textContent = repeatLabel(t); right.appendChild(tag); }
  const del = document.createElement('button');
  del.className = 'del'; del.textContent = '✕'; del.title = '删除任务';
  del.onclick = (e)=>{ e.stopPropagation(); deleteTask(t); };
  li.appendChild(check); li.appendChild(body); li.appendChild(right); li.appendChild(del);
  li.onclick = ()=> openEditor(t);
  return li;
}

/* ---------- 完成 / 循环 ---------- */
function toggleDone(t){
  const now = Date.now();
  if(isDoneToday(t)){
    t.doneDate = null;
  } else {
    t.doneDate = todayYmd();
    t.lastDoneTs = now;
    if(t.repeat !== 'none'){ t.dueTs = nextOccurrence(t.dueTs, t); }
  }
  recordHistory(); persist(); render(); scheduleSave();
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
  recordHistory(); persist(); render(); scheduleSave();
  $('#editor').classList.add('hidden');
}
function deleteTask(t){
  if(!confirm('确定删除「' + (t.title || '该任务') + '」？')) return;
  state.tasks = state.tasks.filter(x => x !== t);
  recordHistory(); persist(); render(); scheduleSave();
}
function deleteEditing(){
  if(editing) deleteTask(editing);
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

/* =========================================================
   同步层：直连 Supabase（无后端）
   ========================================================= */
function authHeaders(extra){ return Object.assign({'apikey': SB_ANON, 'Authorization': 'Bearer ' + (state.session ? state.session.access_token : '')}, extra || {}); }

async function tryRefresh(){
  if(!state.session) return;
  try{
    const r = await fetch(AUTH + '/token?grant_type=refresh_token', {
      method:'POST', headers:{'apikey':SB_ANON,'Content-Type':'application/json'},
      body: JSON.stringify({ refresh_token: state.session.refresh_token })
    });
    const j = await r.json();
    if(j.access_token){
      state.session.access_token = j.access_token;
      if(j.refresh_token) state.session.refresh_token = j.refresh_token;
      persist();
    }
  }catch(e){}
}

async function pullData(){
  if(!state.session) return;
  try{
    let r = await fetch(REST + '/user_data?select=*&user_id=eq.' + encodeURIComponent(state.session.user_id), { headers: authHeaders() });
    if(r.status === 401){ await tryRefresh(); r = await fetch(REST + '/user_data?select=*&user_id=eq.' + encodeURIComponent(state.session.user_id), { headers: authHeaders() }); }
    const rows = await r.json();
    if(Array.isArray(rows) && rows[0]){
      const row = rows[0];
      const remoteTs = row.updated_at ? Date.parse(row.updated_at) : 0;
      if(remoteTs > (state.savedAt || 0)){
        state.tasks = row.tasks || [];
        state.history = row.history || {};
        store.set('tasks', state.tasks); store.set('history', state.history);
        render();
      }
    }
  }catch(e){}
}

let saveTimer;
function scheduleSave(){ clearTimeout(saveTimer); saveTimer = setTimeout(saveData, 400); }
async function saveData(){
  store.set('tasks', state.tasks); store.set('history', state.history);
  state.savedAt = Date.now();
  if(!state.session) return;
  const body = JSON.stringify({
    user_id: state.session.user_id,
    tasks: state.tasks,
    history: state.history,
    updated_at: new Date(state.savedAt).toISOString(),
  });
  try{
    let r = await fetch(REST + '/user_data?on_conflict=user_id', {
      method:'POST',
      headers: Object.assign(authHeaders(), {'Content-Type':'application/json', 'Prefer':'resolution=merge-duplicates, return=minimal'}),
      body
    });
    if(r.status === 401){ await tryRefresh(); await fetch(REST + '/user_data?on_conflict=user_id', {
      method:'POST',
      headers: Object.assign(authHeaders(), {'Content-Type':'application/json', 'Prefer':'resolution=merge-duplicates, return=minimal'}),
      body }); }
  }catch(e){}
}

/* ---------- 账号（Supabase Auth） ---------- */
function openAuth(){
  $('#a-msg').textContent=''; $('#a-account').value=''; $('#a-pass').value='';
  $('#auth').classList.remove('hidden');
}
async function doAuth(){
  const email = $('#a-account').value.trim(), password = $('#a-pass').value;
  if(!email || !password){ $('#a-msg').textContent='请填写邮箱和密码'; return; }
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ $('#a-msg').textContent='请输入正确的邮箱格式'; return; }
  $('#a-login').disabled = true;
  try{
    let j = await (await fetch(AUTH + '/token?grant_type=password', {
      method:'POST', headers:{'apikey':SB_ANON,'Content-Type':'application/json'},
      body: JSON.stringify({ email, password })
    })).json();
    if(!j.access_token){
      // 首次：注册
      const sj = await (await fetch(AUTH + '/signup', {
        method:'POST', headers:{'apikey':SB_ANON,'Content-Type':'application/json'},
        body: JSON.stringify({ email, password })
      })).json();
      if(sj.error){ $('#a-msg').textContent = (sj.error.message || '注册失败') + '（若提示需验证邮箱，请在 Supabase 后台关闭“确认邮箱”）'; return; }
      j = await (await fetch(AUTH + '/token?grant_type=password', {
        method:'POST', headers:{'apikey':SB_ANON,'Content-Type':'application/json'},
        body: JSON.stringify({ email, password })
      })).json();
    }
    if(j.access_token){
      state.session = { access_token:j.access_token, refresh_token:j.refresh_token, user_id:(j.user && j.user.id) || j.user_id, email };
      persist();
      $('#auth').classList.add('hidden'); toast('已登录');
      await pullData(); render(); openSettings();
    } else {
      $('#a-msg').textContent = (j.error && j.error.message) || '登录失败';
    }
  }catch(e){ $('#a-msg').textContent = '网络错误：' + (e && (e.message || e.name) ? (e.message || e.name) : e); console.error(e); }
  finally{ $('#a-login').disabled = false; }
}

/* ---------- 连接诊断（排查用） ---------- */
async function diag(){
  const out = $('#a-diag-out');
  const lines = [];
  const stamp = () => new Date().toLocaleTimeString();
  const test = async (name, fn) => {
    const t0 = Date.now();
    try{ const r = await fn(); lines.push(`[${stamp()}] ${name} ✅ ${r}（${Date.now()-t0}ms）`); }
    catch(e){ lines.push(`[${stamp()}] ${name} ❌ ${e && (e.message||e.name) ? (e.message||e.name) : e}（${Date.now()-t0}ms）`); }
    out.textContent = lines.join('\n');
  };
  out.textContent = '诊断中…';
  lines.length = 0;
  lines.push('当前页面来源 Origin: ' + (location.origin || '未知'));
  lines.push('目标后端: ' + SB_URL);
  out.textContent = lines.join('\n');
  await test('REST 读取接口', async () => {
    const r = await fetch(REST + '/user_data?select=*&limit=1', { headers:{'apikey':SB_ANON} });
    return 'HTTP ' + r.status;
  });
  await test('Auth 登录接口(POST)', async () => {
    const r = await fetch(AUTH + '/token?grant_type=password', {
      method:'POST', headers:{'apikey':SB_ANON,'Content-Type':'application/json'},
      body: JSON.stringify({ email:'diag-probe@example.com', password:'DiagTest123!' })
    });
    return 'HTTP ' + r.status;
  });
  await test('Auth 注册接口(POST)', async () => {
    const r = await fetch(AUTH + '/signup', {
      method:'POST', headers:{'apikey':SB_ANON,'Content-Type':'application/json'},
      body: JSON.stringify({ email:'diag-probe2@example.com', password:'DiagTest123!' })
    });
    return 'HTTP ' + r.status;
  });
  lines.push('—— 把上面这段发给我即可定位问题');
  out.textContent = lines.join('\n');
}
function logout(){ state.session = null; persist(); toast('已退出'); openSettings(); }

/* ---------- 设置 / 日历 / 提醒 ---------- */
function openSettings(){
  const p = $('#settings-panel'); p.innerHTML = '';
  const acc = state.session ? state.session.email : '未登录';
  const card = document.createElement('div'); card.className = 'card';
  card.appendChild(row('账号', acc, ()=> state.session ? logout() : openAuth()));
  if(state.session) card.appendChild(row('退出登录', '退出', logout));
  p.appendChild(card);

  const c2 = document.createElement('div'); c2.className = 'card';
  const remindSel = mkSelect(['none|仅到时间','5|提前5分钟','15|提前15分钟','30|提前30分钟'], state.settings.remind);
  c2.appendChild(labeled('日历提前量', remindSel, v=>{ state.settings.remind = v; persist(); }));
  const dndS = mkTime(state.settings.dndStart), dndE = mkTime(state.settings.dndEnd);
  const dnd = document.createElement('div'); dnd.className = 'row-item'; dnd.innerHTML = '<span class="label">勿扰时段</span>';
  const wr = document.createElement('div'); wr.style.display = 'flex'; wr.style.gap = '6px'; wr.appendChild(dndS); wr.appendChild(dndE); dnd.appendChild(wr);
  dndS.onchange = ()=>{ state.settings.dndStart = dndS.value; persist(); };
  dndE.onchange = ()=>{ state.settings.dndEnd = dndE.value; persist(); };
  c2.appendChild(dnd);
  const themeSel = mkSelect(['light|浅色','dark|深色'], state.settings.theme);
  c2.appendChild(labeled('主题', themeSel, v=>{ state.settings.theme = v; applyTheme(); persist(); }));
  p.appendChild(c2);

  const c3 = document.createElement('div'); c3.className = 'card';
  c3.appendChild(row('日历闹钟(.ics)', '下载导入', downloadICS));
  c3.appendChild(row('应用内提醒', (('Notification' in window) && Notification.permission === 'granted') ? '已开启' : '去开启', requestNotify));
  c3.appendChild(row('数据备份', '导出JSON', exportBackup));
  const note = document.createElement('div');
  note.style.cssText = 'font-size:12px;color:var(--sub);padding:10px 2px 4px;line-height:1.5;';
  note.textContent = '日历闹钟导入后，到点手机响 + 手环振动；任务有变动请重新下载导入。';
  c3.appendChild(note);
  p.appendChild(c3);

  const c4 = document.createElement('div'); c4.className = 'card';
  c4.appendChild(row('完成统计', '查看', ()=>{ showView('stats-view'); renderStats(); }));
  p.appendChild(c4);

  showView('settings-view');
}
function row(label, val, fn){
  const d = document.createElement('div'); d.className = 'row-item';
  d.innerHTML = `<span class="label">${label}</span>`;
  const b = document.createElement('button'); b.className = 'btn-link'; b.textContent = val; b.onclick = fn;
  d.appendChild(b); return d;
}
function mkSelect(opts, val){
  const s = document.createElement('select');
  s.style.cssText = 'background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:6px 10px;font-size:14px;';
  for(const o of opts){ const [v,t] = o.split('|'); const op = document.createElement('option'); op.value = v; op.textContent = t; if(v === val) op.selected = true; s.appendChild(op); }
  return s;
}
function mkTime(v){
  const i = document.createElement('input'); i.type = 'time'; i.value = v;
  i.style.cssText = 'background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:6px 8px;font-size:14px;';
  return i;
}
function labeled(label, el, fn){
  const d = document.createElement('div'); d.className = 'row-item';
  const l = document.createElement('span'); l.className = 'label'; l.textContent = label;
  d.appendChild(l); el.onchange = ()=> fn(el.value); d.appendChild(el); return d;
}

async function requestNotify(){
  if(!('Notification' in window)){ toast('当前浏览器不支持通知'); return; }
  const p = await Notification.requestPermission();
  toast(p === 'granted' ? '应用内提醒已开启' : '需允许通知');
  openSettings();
}

/* ---------- .ics 日历生成（闹钟来源） ---------- */
function icsStamp(ts){ const d = new Date(ts); return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`; }
function icsStart(t){
  if(t.repeat === 'none') return t.dueTs > Date.now() ? t.dueTs : null;
  return nextDue(t);
}
function buildICS(){
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//daily-todo//ZH','CALSCALE:GREGORIAN'];
  const offset = state.settings.remind === 'none' ? 0 : Number(state.settings.remind);
  for(const t of state.tasks){
    const start = icsStart(t);
    if(start === null) continue;
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + t.id + '@daily-todo');
    lines.push('DTSTAMP:' + icsStamp(Date.now()));
    lines.push('DTSTART:' + icsStamp(start));
    if(t.repeat === 'day') lines.push('RRULE:FREQ=DAILY');
    else if(t.repeat === 'week') lines.push('RRULE:FREQ=WEEKLY;BYDAY=' + BYDAY[Number(t.weekday)]);
    else if(t.repeat === 'month') lines.push('RRULE:FREQ=MONTHLY;BYMONTHDAY=' + Number(t.monthday));
    lines.push('SUMMARY:' + t.title);
    lines.push('DESCRIPTION:' + (t.note || '每日工作清单'));
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push('DESCRIPTION:' + t.title);
    lines.push('TRIGGER:-PT' + offset + 'M');
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function downloadICS(){
  const ics = buildICS();
  const file = new File([ics], '每日清单.ics', { type: 'text/calendar' });
  // iOS Safari / 现代浏览器：用系统分享直接选「日历」导入（Safari 不支持 a.download 下载）
  if(navigator.canShare && navigator.canShare({ files: [file] })){
    navigator.share({ files: [file], title: '每日清单' })
      .then(()=> toast('在分享面板里选「日历」即可完成导入'))
      .catch(()=> {});
    return;
  }
  // 兜底：安卓 / 桌面走普通下载
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  a.download = '每日清单.ics'; document.body.appendChild(a); a.click(); a.remove();
  toast('日历文件已生成：iOS 用「文件」App 打开并导入日历，安卓用日历导入');
}
function exportBackup(){
  const blob = new Blob([JSON.stringify({ tasks: state.tasks, history: state.history, settings: state.settings }, null, 2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '清单备份.json'; a.click();
}

function renderStats(){
  const p = $('#stats-panel'); p.innerHTML = '';
  const today = state.history[todayYmd()] || { due: state.tasks.length, done: 0 };
  const big = document.createElement('div'); big.className = 'stat-big';
  big.innerHTML = `<div class="num">${today.done}/${today.due}</div><div class="cap">今日完成　🔥 连续 ${calcStreak()} 天</div>`;
  p.appendChild(big);
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML = '<div class="section-title">最近 7 天</div>';
  const wk = document.createElement('div'); wk.className = 'week';
  const now = new Date();
  for(let i = 6; i >= 0; i--){ const d = new Date(now); d.setDate(d.getDate() - i); const k = ymd(d.getTime()); const h = state.history[k]; const on = h && h.done > 0;
    wk.innerHTML += `<div class="d${on ? ' on' : ''}">${d.getMonth()+1}/${d.getDate()}<b>${h ? h.done : '·'}</b></div>`; }
  card.appendChild(wk); p.appendChild(card);
}

/* ---------- 视图切换 ---------- */
function showView(id){
  for(const v of document.querySelectorAll('.view')) v.classList.add('hidden');
  $('#' + id).classList.remove('hidden');
}

/* ---------- 杂项 ---------- */
function applyTheme(){ document.body.classList.toggle('dark', state.settings.theme === 'dark'); $('#theme-color').setAttribute('content', state.settings.theme === 'dark' ? '#000000' : '#f5f5f7'); }
let toastTimer;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(()=> t.classList.add('hidden'), 2200); }
function persist(){ store.set('tasks', state.tasks); store.set('history', state.history); store.set('settings', state.settings); store.set('session', state.session); }

/* ---------- 本地到点提醒（页面打开时的兜底，非系统级） ---------- */
function localReminderCheck(){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  for(const t of state.tasks){
    if(isDoneToday(t) || !inRemindWindow(t)) continue;
    if(t.dueTs <= Date.now() && t._reminded !== ymd(t.dueTs)){
      new Notification('⏰ ' + t.title, { body: '该完成了：' + hhmm(t.dueTs) });
      t._reminded = ymd(t.dueTs);
    }
  }
}
function inRemindWindow(t){
  const now = Date.now();
  if(now < t.dueTs) return false;
  const s = state.settings.dndStart.split(':').map(Number), e = state.settings.dndEnd.split(':').map(Number);
  const cur = new Date().getHours()*60 + new Date().getMinutes();
  const ss = s[0]*60+s[1], ee = e[0]*60+e[1];
  const inDnd = ss > ee ? (cur >= ss || cur < ee) : (cur >= ss && cur < ee);
  return !inDnd;
}

/* ---------- 初始化 ---------- */
function init(){
  state.tasks = store.get('tasks', []);
  state.history = store.get('history', {});
  state.settings = Object.assign(state.settings, store.get('settings', {}));
  state.session = store.get('session', null);

  applyTheme(); render();

  $('#btn-menu').onclick = openSettings;
  $('#show-done').onclick = ()=>{ state._showDone = !state._showDone; render(); };
  $('#btn-back').onclick = ()=> showView('list-view');
  $('#btn-back2').onclick = ()=> showView('list-view');
  $('#btn-add').onclick = ()=> openEditor(null);
  $('#editor-mask').onclick = ()=> $('#editor').classList.add('hidden');
  $('#f-cancel').onclick = ()=> $('#editor').classList.add('hidden');
  $('#f-save').onclick = ()=>{
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
  $('#a-diag').onclick = diag;

  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});

  if(state.session) pullData();
  setInterval(()=>{ const before = todayYmd(); render(); if(before !== todayYmd()) recordHistory(); localReminderCheck(); }, 30000);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) pullData(); });
  setInterval(()=>{ if(state.session) pullData(); }, 20000);
}
document.addEventListener('DOMContentLoaded', init);
