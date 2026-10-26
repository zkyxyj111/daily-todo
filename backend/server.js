/* 每日工作清单 — 后端（Node 内置模块 + 可选 Supabase 云数据库） */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DBFILE = path.join(DATA_DIR, 'data.json');
const VAPID = path.join(DATA_DIR, 'vapid.json');
const DB_KEY = 'global';

/* ---- Supabase 云数据库（不设环境变量则自动回落到本地文件） ---- */
let sb = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    console.log('已连接 Supabase 云数据库');
  } catch (e) {
    console.log('未加载 Supabase 客户端，回落本地文件:', e.message);
  }
}

/* ---- 持久化（云端优先，本地兜底） ---- */
let DB_ = { users: {} };
async function loadDB() {
  if (sb) {
    const { data } = await sb.from('app_data').select('data').eq('key', DB_KEY).single();
    return (data && data.data) ? data.data : { users: {} };
  }
  try { return JSON.parse(fs.readFileSync(DBFILE, 'utf8')); } catch { return { users: {} }; }
}
async function saveDB() {
  if (sb) { await sb.from('app_data').upsert({ key: DB_KEY, data: DB_ }); return; }
  fs.writeFileSync(DBFILE, JSON.stringify(DB_, null, 2));
}

/* ---- VAPID 密钥（放在持久层，重启不失效） ---- */
function loadVapid() {
  if (fs.existsSync(VAPID)) return JSON.parse(fs.readFileSync(VAPID, 'utf8'));
  const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const v = {
    public: kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    private: kp.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'),
  };
  fs.writeFileSync(VAPID, JSON.stringify(v));
  return v;
}
const VAPID_ = loadVapid();
function signJWT(aud) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:todo@example.com' };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = enc(header) + '.' + enc(payload);
  const sig = crypto.createSign('SHA256').update(input).sign({
    key: crypto.createPrivateKey({ key: Buffer.from(VAPID_.private, 'base64url'), format: 'der', type: 'pkcs8' }),
    dsaEncoding: 'ieee-p1363',
  });
  return input + '.' + sig.toString('base64url');
}
function sendPush(sub) {
  try {
    const u = new URL(sub.endpoint);
    const aud = u.protocol + '//' + u.host;
    const req = https.request(u, { method: 'POST', headers: {
      Authorization: 'WebPush ' + signJWT(aud),
      'Crypto-Key': 'p256ecdsa=' + VAPID_.public,
      TTL: '60', Urgency: 'normal',
    } });
    req.on('error', () => {});
    req.end();
  } catch (e) { console.error('push err', e.message); }
}

/* ---- 账号 ---- */
function tokenFor(account, pass) {
  const hash = crypto.createHash('sha256').update(account + ':' + pass).digest('hex');
  let u = DB_.users[account];
  if (u) { if (u.passHash !== hash) return { error: '密码错误' }; }
  else { u = DB_.users[account] = { passHash: hash, token: crypto.randomBytes(16).toString('hex'), tasks: [], history: {}, subs: [] }; }
  return { token: u.token };
}
function userByToken(token) { return Object.values(DB_.users).find(u => u.token === token); }

/* ---- .ics 日历 ---- */
const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function toICSDate(ts) { const d = new Date(ts); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`; }
function buildICS(user) {
  let out = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//DailyTodo//CN\r\nCALSCALE:GREGORIAN\r\n';
  const trig = { none: 'PT0M', '5': 'PT5M', '15': 'PT15M', '30': 'PT30M' }[user.settings?.remind] || 'PT0M';
  for (const t of user.tasks) {
    if (t.doneDate === new Date().toISOString().slice(0, 10)) continue;
    let rrule = '';
    if (t.repeat === 'day') rrule = 'RRULE:FREQ=DAILY\r\n';
    else if (t.repeat === 'week') rrule = `RRULE:FREQ=WEEKLY;BYDAY=${WD[+t.weekday]}\r\n`;
    else if (t.repeat === 'month') rrule = `RRULE:FREQ=MONTHLY;BYMONTHDAY=${t.monthday}\r\n`;
    out += 'BEGIN:VEVENT\r\n';
    out += `UID:${t.id}@dailytodo\r\n`;
    out += `SUMMARY:${t.title}\r\n`;
    out += `DTSTART:${toICSDate(t.dueTs)}\r\n`;
    out += `DESCRIPTION:${(t.note || '')}\r\n`;
    out += rrule;
    out += 'BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:⏰ ' + t.title + '\r\nTRIGGER:-' + trig + '\r\nEND:VALARM\r\n';
    out += 'END:VEVENT\r\n';
  }
  out += 'END:VCALENDAR\r\n';
  return out;
}

/* ---- 静态文件 ---- */
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
}

/* ---- API ---- */
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b ? JSON.parse(b || '{}') : {})); }); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  try {
    if (p === '/api/vapid') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(VAPID_.public); }
    if (p === '/api/auth' && req.method === 'POST') { const { account, pass } = await readBody(req); const r = tokenFor(account, pass); if (r.error) return json(res, 401, r); await saveDB(); return json(res, 200, r); }
    if (p === '/api/tasks' && req.method === 'GET') { const u2 = userByToken(u.searchParams.get('token')); if (!u2) return json(res, 401, { error: '未登录' }); return json(res, 200, { tasks: u2.tasks, history: u2.history }); }
    if (p === '/api/tasks' && req.method === 'PUT') { const b = await readBody(req); const u2 = userByToken(b.token); if (!u2) return json(res, 401, { error: '未登录' }); u2.tasks = b.tasks || []; u2.history = b.history || {}; await saveDB(); return json(res, 200, { ok: true }); }
    if (p === '/api/sub' && req.method === 'POST') { const b = await readBody(req); const u2 = userByToken(b.token); if (!u2) return json(res, 401, { error: '未登录' }); u2.subs = (u2.subs || []).filter(s => s.endpoint !== b.sub.endpoint); u2.subs.push(b.sub); await saveDB(); return json(res, 200, { ok: true }); }
    if (p === '/api/calendar' && req.method === 'GET') { const u2 = userByToken(u.searchParams.get('token')); if (!u2) return res.writeHead(401), res.end('no'); res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' }); return res.end(buildICS(u2)); }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    return serveStatic(req, res);
  } catch (e) { console.error(e); return json(res, 500, { error: String(e) }); }
});

/* ---- 提醒调度：到点推送（实例存活期间有效；关 App 的可靠提醒由 .ics 系统日历兜底） ---- */
async function scheduler() {
  const now = Date.now();
  let changed = false;
  for (const u of Object.values(DB_.users)) {
    for (const t of u.tasks) {
      if (t.doneDate === new Date().toISOString().slice(0, 10)) continue;
      if (t.dueTs <= now) {
        const key = 'r' + t.id + new Date(t.dueTs).toISOString().slice(0, 10);
        if (!u._sent) u._sent = {};
        if (!u._sent[key]) {
          u._sent[key] = true; changed = true;
          for (const s of (u.subs || [])) sendPush(s);
          console.log('提醒推送:', t.title);
        }
      }
    }
  }
  if (changed) await saveDB();
}

loadDB().then(async (d) => {
  DB_ = d;
  server.listen(PORT, () => console.log(`每日清单后端已启动: http://localhost:${PORT}${sb ? ' (Supabase)' : ' (本地文件)'}`));
  scheduler();
  setInterval(scheduler, 30000);
});
