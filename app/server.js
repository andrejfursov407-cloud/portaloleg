'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const ROOT = __dirname;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data'), MEDIA = process.env.MEDIA_DIR || path.join(ROOT, 'media');
for (const d of [DATA].concat(['video', 'photo', 'music', 'site'].map(t => path.join(MEDIA, t)))) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) { console.error('Не удалось создать каталог', d, e.message); } }
const PORT = +process.env.PORT || 3000;
const SECURE = process.env.COOKIE_SECURE === '1';
const OPEN_REG = process.env.ALLOW_REGISTRATION !== '0';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const MAX_UPLOAD = (+process.env.MAX_UPLOAD_MB || 2048) * 1048576;
const TTL = 7 * 24 * 3600 * 1000;

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJson = (f, o, mode = 0o640) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1), { mode }); fs.renameSync(t, f); };
const USERS_FILE = path.join(DATA, 'users.json'), NEWS_FILE = path.join(DATA, 'news.json'), SITE_FILE = path.join(DATA, 'site.json');
const users = readJson(USERS_FILE, {});
const saveUsers = () => writeJson(USERS_FILE, users, 0o600);
function getNews() {
  const n = readJson(NEWS_FILE, []); let ch = false;
  n.forEach(x => { if (!x.id) { x.id = crypto.randomBytes(5).toString('hex'); ch = true; } });
  if (ch) writeJson(NEWS_FILE, n);
  return n;
}

const SESS_FILE = path.join(DATA, 'sessions.json');
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const sessions = new Map(Object.entries(readJson(SESS_FILE, {})));
let sTimer = null;
function saveSessions() {
  if (sTimer) return;
  sTimer = setTimeout(() => { sTimer = null; try { writeJson(SESS_FILE, Object.fromEntries(sessions), 0o600); } catch (e) {} }, 1500);
}
const attempts = new Map();
setInterval(() => {
  const now = Date.now(); let ch = false;
  for (const [k, v] of sessions) if (v.exp < now) { sessions.delete(k); ch = true; }
  for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
  if (ch) saveSessions();
}, 600000).unref();
function limited(ip) {
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || a.reset < now) a = { n: 0, reset: now + 600000 };
  a.n++; attempts.set(ip, a);
  return a.n > 30;
}
const scrypt = (pw, salt) => new Promise((ok, no) =>
  crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => e ? no(e) : ok(k)));
const DUMMY_SALT = crypto.randomBytes(16);

const TYPES = {
  video: { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4' },
  photo: { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' },
  music: { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.aac': 'audio/aac' },
  site: { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
};
const STATIC = {
  '/static/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/static/login.js': ['public/login.js', 'text/javascript; charset=utf-8'],
  '/static/portal.js': ['public/portal.js', 'text/javascript; charset=utf-8']
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, Object.assign({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  }, SECURE ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}, headers));
  res.end(body);
}
const json = (res, code, obj, h = {}) => send(res, code, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, h));
const redirect = (res, to) => send(res, 302, '', { Location: to, 'Cache-Control': 'no-store' });
const page = (res, file) => fs.readFile(path.join(ROOT, file), (e, b) =>
  e ? json(res, 500, { error: 'Ошибка сервера' }) : send(res, 200, b, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }));

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return out;
}
function auth(req) {
  const s = sessions.get(sha(cookies(req).sid || ''));
  if (!s || s.exp < Date.now() || !users[s.email]) return null;
  const u = users[s.email];
  return { email: s.email, name: u.name, admin: u.role === 'admin' || (!!ADMIN_EMAIL && s.email === ADMIN_EMAIL) };
}
const ip = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
function body(req, limit = 10000) {
  return new Promise((ok, no) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > limit) { no(new Error('big')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch (e) { no(e); } });
  });
}
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}
function startSession(email) {
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sha(sid), { email, exp: Date.now() + TTL });
  saveSessions();
  return `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL / 1000}${SECURE ? '; Secure' : ''}`;
}
const okName = (t, n) => TYPES[t] && n && !n.startsWith('.') && TYPES[t][path.extname(n).toLowerCase()];
const cleanName = s => path.basename(String(s)).normalize('NFC').replace(/[^\p{L}\p{N}._ ()-]/gu, '_').replace(/^\.+/, '').slice(0, 120) || 'file';

function list(type) {
  const dir = path.join(MEDIA, type);
  try {
    return fs.readdirSync(dir).filter(f => okName(type, f)).map(f => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, title: path.basename(f, path.extname(f)), size: st.size, time: st.mtimeMs, url: `/media/${type}/${encodeURIComponent(f)}` };
    }).sort((a, b) => b.time - a.time);
  } catch (e) { return []; }
}

function serveMedia(req, res, type, name) {
  const mime = okName(type, name);
  if (!mime) return json(res, 404, { error: 'Не найдено' });
  const file = path.join(MEDIA, type, path.basename(name));
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) return json(res, 404, { error: 'Не найдено' });
    let start = 0, end = st.size - 1, code = 200;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      if (m[1] === '') start = Math.max(0, st.size - +m[2]);
      else { start = +m[1]; if (m[2]) end = Math.min(+m[2], end); }
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      code = 206;
    }
    const h = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
    if (code === 206) h['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    res.writeHead(code, h);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  });
}

function upload(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const type = q.get('type');
  const name = cleanName(q.get('name') || '');
  const ext = path.extname(name).toLowerCase();
  if (!TYPES[type] || !TYPES[type][ext]) return json(res, 400, { error: 'Этот формат файла не поддерживается в разделе' });
  const len = +req.headers['content-length'] || 0;
  if (!len || len > MAX_UPLOAD) return json(res, 413, { error: 'Файл пустой или больше допустимого размера' });
  const dir = path.join(MEDIA, type);
  let final = path.join(dir, name);
  for (let i = 1; fs.existsSync(final); i++) final = path.join(dir, path.basename(name, ext) + '-' + i + ext);
  const tmp = path.join(dir, '.up-' + crypto.randomBytes(6).toString('hex'));
  const out = fs.createWriteStream(tmp, { mode: 0o640 });
  let got = 0, failed = false;
  const fail = (code, msg) => { if (failed) return; failed = true; out.destroy(); fs.unlink(tmp, () => {}); if (!res.headersSent) json(res, code, { error: msg }); };
  req.on('data', c => { got += c.length; if (got > MAX_UPLOAD) { fail(413, 'Файл слишком большой'); req.destroy(); } });
  req.on('close', () => { if (!req.complete) fail(400, 'Загрузка прервана'); });
  req.on('error', () => fail(400, 'Загрузка прервана'));
  out.on('error', () => fail(500, 'Ошибка записи на диск'));
  out.on('finish', () => {
    if (failed) return;
    fs.rename(tmp, final, e => e ? fail(500, 'Ошибка сохранения') : json(res, 200, { ok: true, name: path.basename(final) }));
  });
  req.pipe(out);
}

async function admin(req, res, p) {
  const b = await body(req, 200000);
  if (p === '/api/admin/delete') {
    const t = b.type, n = path.basename(String(b.name || ''));
    if (!okName(t, n)) return json(res, 400, { error: 'Неверное имя файла' });
    return fs.unlink(path.join(MEDIA, t, n), e => {
      if (t === 'site') { const s = readJson(SITE_FILE, {}); if (s.hero === n) { s.hero = ''; writeJson(SITE_FILE, s); } }
      json(res, e ? 404 : 200, e ? { error: 'Файл не найден' } : { ok: true });
    });
  }
  if (p === '/api/admin/news') {
    const title = String(b.title || '').trim().slice(0, 150), text = String(b.text || '').trim().slice(0, 5000);
    if (!title || !text) return json(res, 400, { error: 'Заполните заголовок и текст' });
    const photo = path.basename(String(b.photo || ''));
    const n = getNews();
    n.unshift({ id: crypto.randomBytes(5).toString('hex'), title, text, date: new Date().toISOString().slice(0, 10), photo: photo && okName('photo', photo) && fs.existsSync(path.join(MEDIA, 'photo', photo)) ? photo : '' });
    writeJson(NEWS_FILE, n);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/news/delete') {
    writeJson(NEWS_FILE, getNews().filter(x => x.id !== b.id));
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/ai') {
    const model = String(b.model || '').trim();
    if (!MODEL_RE.test(model)) return json(res, 400, { error: 'Неверное название модели' });
    writeJson(AI_FILE, {
      enabled: !!b.enabled, model,
      numPredict: Math.min(2048, Math.max(32, parseInt(b.numPredict, 10) || 512)),
      numCtx: Math.min(16384, Math.max(1024, parseInt(b.numCtx, 10) || 4096)),
      temperature: Math.min(1.5, Math.max(0, isNaN(parseFloat(b.temperature)) ? 0.6 : parseFloat(b.temperature))),
      dailyLimit: Math.min(10000, Math.max(0, parseInt(b.dailyLimit, 10) || 0)),
      systemPrompt: String(b.systemPrompt || '').slice(0, 4000) || AI_DEF.systemPrompt
    }, 0o640);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/ai/pull') {
    const model = String(b.model || '').trim();
    if (!MODEL_RE.test(model)) return json(res, 400, { error: 'Неверное название модели' });
    try { startPull(model); } catch (e) { return json(res, 409, { error: e.message }); }
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/ai/delete') {
    const model = String(b.model || '').trim();
    if (!MODEL_RE.test(model)) return json(res, 400, { error: 'Неверное название модели' });
    try {
      const r = await ollama('/api/delete', { method: 'DELETE', headers: JSONH, body: JSON.stringify({ model }) });
      return r.ok ? json(res, 200, { ok: true }) : json(res, 502, { error: await aiError(r) });
    } catch (e) { return json(res, 502, { error: netErr(e) }); }
  }
  if (p === '/api/admin/ai/test') return json(res, 200, await aiTest(aiCfg()));
  if (p === '/api/admin/site') {
    const s = readJson(SITE_FILE, {});
    for (const k of ['bio', 'projects', 'contacts']) if (typeof b[k] === 'string') s[k] = b[k].slice(0, 20000);
    if (typeof b.hero === 'string') s.hero = b.hero && okName('site', path.basename(b.hero)) && fs.existsSync(path.join(MEDIA, 'site', path.basename(b.hero))) ? path.basename(b.hero) : '';
    for (const k of ['heroX', 'heroY', 'heroXm']) if (b[k] !== undefined) { const v = parseInt(b[k], 10); if (!isNaN(v)) s[k] = Math.min(100, Math.max(0, v)); }
    if (b.theme && typeof b.theme === 'object') { s.theme = {}; for (const k of ['blue', 'navy']) if (/^#[0-9a-fA-F]{6}$/.test(String(b.theme[k] || ''))) s.theme[k] = b.theme[k]; }
    if (b.texts && typeof b.texts === 'object') {
      const t = b.texts, cl = (v, n) => String(v || '').trim().slice(0, n);
      s.texts = { title: cl(t.title, 80), subtitle: cl(t.subtitle, 120), button: cl(t.button, 40), newsTitle: cl(t.newsTitle, 60), cards: (Array.isArray(t.cards) ? t.cards : []).slice(0, 3).map(c => cl(c, 50)) };
    }
    if (b.social && typeof b.social === 'object') {
      s.social = s.social || {};
      for (const k of ['vk', 'tg', 'yt', 'ok']) {
        if (typeof b.social[k] !== 'string') continue;
        const v = b.social[k].trim();
        if (v && !/^https?:\/\/[^\s"'<>]{1,500}$/.test(v)) return json(res, 400, { error: 'Ссылка должна начинаться с http:// или https://' });
        s.social[k] = v;
      }
    }
    writeJson(SITE_FILE, s);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Не найдено' });
}

// ---------- статистика и история посещений ----------
const EV_FILE = path.join(DATA, 'events.jsonl');
try { if (fs.statSync(EV_FILE).size > 30 * 1048576) fs.renameSync(EV_FILE, path.join(DATA, 'events-' + Date.now() + '.jsonl')); } catch (e) {}
let uTimer = null;
const saveUsersSoon = () => { if (uTimer) return; uTimer = setTimeout(() => { uTimer = null; try { saveUsers(); } catch (e) {} }, 5000); };
function logEv(req, email, k, d) {
  const rec = { t: Date.now(), u: email || '', k, d: String(d || '').slice(0, 200), ip: ip(req), m: /Mobile|Android|iPhone|iPad/i.test(req.headers['user-agent'] || '') ? 1 : 0 };
  fs.appendFile(EV_FILE, JSON.stringify(rec) + '\n', { mode: 0o640 }, () => {});
}
function touch(email) {
  const u = users[email]; if (!u) return null;
  const st = u.st || (u.st = { visits: 0, views: 0, plays: 0, photos: 0, ai: 0, seconds: 0, last: 0, lastPing: 0 });
  const now = Date.now();
  if (now - st.last > 30 * 60000) st.visits++;
  st.last = now;
  return st;
}
function readEvents() {
  let txt = ''; try { txt = fs.readFileSync(EV_FILE, 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const line of txt.split('\n')) { if (!line) continue; try { out.push(JSON.parse(line)); } catch (e) {} }
  return out;
}
const pad2 = n => String(n).padStart(2, '0');
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
function report() {
  const ev = readEvents(), now = Date.now(), DAY = 864e5;
  const per = {}, pages = {}, mediaC = {}, daily = {};
  let mobile = 0, desktop = 0;
  for (const e of ev) {
    const u = per[e.u] || (per[e.u] = { routes: {}, m: 0, d: 0 });
    if (e.k === 'view') { u.routes[e.d] = (u.routes[e.d] || 0) + 1; pages[e.d] = (pages[e.d] || 0) + 1; }
    if (e.k === 'play' || e.k === 'photo') mediaC[e.d] = (mediaC[e.d] || 0) + 1;
    if (e.m) { u.m++; mobile++; } else { u.d++; desktop++; }
    const dk = dayKey(e.t), dd = daily[dk] || (daily[dk] = { views: 0, users: new Set() });
    if (e.k === 'view') dd.views++;
    if (e.u) dd.users.add(e.u);
  }
  const days = [];
  for (let i = 29; i >= 0; i--) { const k = dayKey(now - i * DAY), d = daily[k]; days.push({ d: k, views: d ? d.views : 0, users: d ? d.users.size : 0 }); }
  const list = Object.entries(users).map(([email, u]) => {
    const st = u.st || {}, p = per[email] || { routes: {}, m: 0, d: 0 };
    const tr = top(p.routes, 1)[0];
    return { email, name: u.name, role: u.role, created: u.created, last: st.last || 0, visits: st.visits || 0, views: st.views || 0, plays: st.plays || 0, photos: st.photos || 0, ai: st.ai || 0, seconds: st.seconds || 0, top: tr ? tr[0] : null, device: p.m > p.d ? 'Телефон' : (p.m + p.d ? 'Компьютер' : '') };
  }).sort((a, b) => b.last - a.last);
  const sum = k => list.reduce((s, u) => s + u[k], 0);
  return {
    totals: {
      users: list.length, admins: list.filter(u => u.role === 'admin').length,
      new7: list.filter(u => now - Date.parse(u.created || 0) < 7 * DAY).length,
      active7: list.filter(u => now - u.last < 7 * DAY).length, active30: list.filter(u => now - u.last < 30 * DAY).length,
      online: list.filter(u => now - u.last < 5 * 60000).length,
      visits: sum('visits'), views: sum('views'), plays: sum('plays'), photos: sum('photos'), ai: sum('ai'), seconds: sum('seconds'),
      logins: ev.filter(e => e.k === 'login' || e.k === 'register').length, mobile, desktop
    },
    daily: days, pages: top(pages, 10), media: top(mediaC, 10), users: list
  };
}
function history(q) {
  const k = q.get('k') || '', u = (q.get('u') || '').toLowerCase();
  const off = Math.max(0, parseInt(q.get('offset'), 10) || 0), lim = Math.min(500, Math.max(1, parseInt(q.get('limit'), 10) || 100));
  const all = readEvents().filter(e => (!k || e.k === k) && (!u || e.u === u)).reverse();
  return { total: all.length, items: all.slice(off, off + lim).map(e => Object.assign({ name: users[e.u] ? users[e.u].name : '' }, e)) };
}
function csv() {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['Время', 'Почта', 'Имя', 'Событие', 'Подробности', 'IP', 'Устройство'].map(q).join(';')];
  for (const e of readEvents()) rows.push([new Date(e.t).toISOString(), e.u, users[e.u] ? users[e.u].name : '', e.k, e.d, e.ip, e.m ? 'phone' : 'desktop'].map(q).join(';'));
  return '\ufeff' + rows.join('\r\n');
}

// ---------- нейросеть Олег AI (локально, через Ollama) ----------
const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const AI_MAX = Math.max(1, parseInt(process.env.AI_MAX_PARALLEL, 10) || 1);
const AI_FILE = path.join(DATA, 'ai.json');
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/@-]{0,99}$/;
const AI_DEF = {
  enabled: false, model: 'qwen3.5:4b', numPredict: 512, numCtx: 4096, temperature: 0.6, dailyLimit: 20,
  systemPrompt: 'Ты — Олег AI, виртуальный помощник портала Олега Борисовского. Отвечай по-русски, вежливо, понятно и по делу, без лишних вступлений. Ты не настоящий Олег Борисовский и не говоришь от его имени. Ты не врач: по вопросам здоровья давай только общую информацию и советуй обратиться к специалисту. Если не знаешь ответа, честно скажи об этом.'
};
const aiCfg = () => Object.assign({}, AI_DEF, readJson(AI_FILE, {}));
const JSONH = { 'content-type': 'application/json' };
async function ollama(p, opt = {}, ms = 15000) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(OLLAMA + p, Object.assign({ signal: ctl.signal }, opt)); } finally { clearTimeout(to); }
}
function ramAvailable() {
  try { const m = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); if (m) return +m[1] * 1024; } catch (e) {}
  return os.freemem();
}
let pullState = null;
async function aiStatus() {
  const out = { online: false, models: [], pull: pullState, cpus: os.cpus().length, ramTotal: os.totalmem(), ramFree: ramAvailable() };
  try {
    const v = await ollama('/api/version'); if (!v.ok) return out;
    out.online = true; out.version = (await v.json()).version;
    const t = await (await ollama('/api/tags')).json();
    out.models = (t.models || []).map(m => ({ name: m.name, size: m.size })).sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {}
  return out;
}
let onlineAt = 0, onlineVal = false;
async function aiOnline() {
  if (Date.now() - onlineAt < 10000) return onlineVal;
  try { onlineVal = (await ollama('/api/version', {}, 3000)).ok; } catch (e) { onlineVal = false; }
  onlineAt = Date.now(); return onlineVal;
}
function startPull(model) {
  if (pullState && !pullState.done) throw new Error('Другая загрузка ещё идёт');
  const st = pullState = { model, status: 'подключение', completed: 0, total: 0, done: false, error: '' };
  (async () => {
    try {
      const r = await fetch(OLLAMA + '/api/pull', { method: 'POST', headers: JSONH, body: JSON.stringify({ model, stream: true }) });
      if (!r.ok || !r.body) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Ollama ответила кодом ' + r.status); }
      let buf = '';
      for await (const chunk of r.body) {
        buf += Buffer.from(chunk).toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          const m = JSON.parse(line);
          if (m.error) throw new Error(m.error);
          st.status = m.status || st.status;
          if (m.total) { st.total = m.total; st.completed = m.completed || 0; }
        }
      }
      st.status = 'готово';
    } catch (e) { st.error = e.code === 'ECONNREFUSED' || /fetch failed/.test(e.message) ? 'Ollama не запущена' : e.message; }
    st.done = true;
  })();
}
function chatBody(cfg, msgs, stream, think) {
  const b = {
    model: cfg.model, stream, keep_alive: '30m',
    messages: [{ role: 'system', content: cfg.systemPrompt }].concat(msgs),
    options: { num_predict: cfg.numPredict, num_ctx: cfg.numCtx, temperature: cfg.temperature }
  };
  if (think) b.think = false;
  return JSON.stringify(b);
}
async function chatReq(cfg, msgs, stream, signal) {
  let r = await fetch(OLLAMA + '/api/chat', { method: 'POST', headers: JSONH, signal, body: chatBody(cfg, msgs, stream, true) });
  if (r.status === 400) r = await fetch(OLLAMA + '/api/chat', { method: 'POST', headers: JSONH, signal, body: chatBody(cfg, msgs, stream, false) });
  return r;
}
async function aiError(r) {
  const d = await r.json().catch(() => ({})), m = String(d.error || '');
  console.error('Ollama error', r.status, m.slice(0, 300));
  if (r.status === 404 || /not found/i.test(m)) return 'Модель «' + m.replace(/^.*?'([^']+)'.*$/, '$1') + '» не установлена. Скачайте её в админ-панели, вкладка «Нейросеть».';
  if (/memory|alloc/i.test(m)) return 'Не хватает оперативной памяти для этой модели. Выберите модель поменьше.';
  return 'Ошибка Ollama (' + r.status + ')' + (m ? ': ' + m.slice(0, 200) : '');
}
const netErr = e => e.name === 'AbortError' ? 'Превышено время ожидания' : (e.cause && e.cause.code === 'ECONNREFUSED') || /fetch failed/.test(e.message) ? 'Сервис нейросети (Ollama) не запущен. На сервере: systemctl status ollama' : e.message;
const stripThink = s => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
async function aiTest(cfg) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 240000);
  try {
    const c = Object.assign({}, cfg, { numPredict: 40 });
    const r = await chatReq(c, [{ role: 'user', content: 'Ответь одним словом: работает' }], false, ctl.signal);
    if (!r.ok) return { ok: false, error: await aiError(r) };
    const d = await r.json();
    const text = stripThink((d.message && d.message.content) || '');
    return text ? { ok: true, reply: text } : { ok: false, error: 'Модель вернула пустой ответ' };
  } catch (e) { return { ok: false, error: netErr(e) }; } finally { clearTimeout(to); }
}
let aiActive = 0; const aiQueue = [];
function aiAcquire() {
  return new Promise((ok, no) => {
    if (aiActive < AI_MAX) { aiActive++; return ok(); }
    if (aiQueue.length >= 8) return no(new Error('busy'));
    const w = { ok, no, t: setTimeout(() => { const i = aiQueue.indexOf(w); if (i >= 0) aiQueue.splice(i, 1); no(new Error('timeout')); }, 180000) };
    aiQueue.push(w);
  });
}
function aiRelease() { const w = aiQueue.shift(); if (w) { clearTimeout(w.t); w.ok(); } else aiActive--; }
const aiUse = new Map(), aiBusy = new Set();
async function aiChat(req, res, user) {
  const cfg = aiCfg();
  if (!cfg.enabled) return json(res, 503, { error: 'Олег AI пока не включён администратором.' });
  const b = await body(req, 120000);
  const msgs = (Array.isArray(b.messages) ? b.messages : []).slice(-20)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  const merged = [];
  for (const m of msgs) { const l = merged[merged.length - 1]; if (l && l.role === m.role) l.content += '\n' + m.content; else merged.push(m); }
  if (!merged.length || merged[merged.length - 1].role !== 'user') return json(res, 400, { error: 'Пустой вопрос' });
  const day = dayKey(Date.now());
  let u = aiUse.get(user.email); if (!u || u.d !== day) u = { d: day, n: 0 };
  if (cfg.dailyLimit > 0 && u.n >= cfg.dailyLimit && !user.admin) return json(res, 429, { error: 'Дневной лимит вопросов исчерпан. Попробуйте завтра.' });
  if (aiBusy.has(user.email)) return json(res, 429, { error: 'Дождитесь ответа на предыдущий вопрос.' });
  aiBusy.add(user.email);
  let closed = false, got = false, locked = false;
  const ctl = new AbortController();
  res.on('close', () => { closed = true; ctl.abort(); });
  const to = setTimeout(() => ctl.abort(), 300000);
  try {
    try { await aiAcquire(); locked = true; } catch (e) {
      return json(res, 503, { error: e.message === 'busy' ? 'Сейчас много вопросов. Повторите через минуту.' : 'Слишком долгое ожидание очереди. Повторите позже.' });
    }
    if (closed) return;
    let r;
    try { r = await chatReq(cfg, merged, true, ctl.signal); } catch (e) { if (closed) return; return json(res, 502, { error: netErr(e) }); }
    if (!r.ok) return json(res, 502, { error: await aiError(r) });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
    let buf = '', inThink = false;
    const emit = s => {
      let out = '';
      while (s) {
        if (inThink) { const i = s.indexOf('</think>'); if (i < 0) return out; s = s.slice(i + 8); inThink = false; }
        else { const i = s.indexOf('<think>'); if (i < 0) { out += s; break; } out += s.slice(0, i); s = s.slice(i + 7); inThink = true; }
      }
      return out;
    };
    try {
      for await (const chunk of r.body) {
        buf += Buffer.from(chunk).toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          const m = JSON.parse(line);
          if (m.error) throw new Error(m.error);
          const t = emit((m.message && m.message.content) || '');
          if (t) { got = true; res.write(JSON.stringify({ d: t }) + '\n'); }
        }
      }
      if (!got) res.write(JSON.stringify({ error: 'Модель вернула пустой ответ. Попробуйте переформулировать вопрос.' }) + '\n');
      else res.write(JSON.stringify({ end: true }) + '\n');
    } catch (e) { if (!closed) res.write(JSON.stringify({ error: netErr(e) }) + '\n'); }
    res.end();
    if (got) {
      u.n++; aiUse.set(user.email, u);
      const st = touch(user.email); if (st) { st.ai++; saveUsersSoon(); }
      logEv(req, user.email, 'ai', '');
    }
  } finally { clearTimeout(to); aiBusy.delete(user.email); if (locked) aiRelease(); }
}

const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    const user = auth(req);

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (STATIC[p]) {
        return fs.readFile(path.join(ROOT, STATIC[p][0]), (e, b) =>
          e ? json(res, 404, {}) : send(res, 200, b, { 'Content-Type': STATIC[p][1], 'Cache-Control': 'no-cache' }));
      }
      if (p === '/') return user ? page(res, 'private/portal.html') : redirect(res, '/login');
      if (p === '/login') return user ? redirect(res, '/') : page(res, 'public/login.html');
      if (p === '/api/config') return json(res, 200, { registration: OPEN_REG });
      if (p === '/api/me') return user ? json(res, 200, user) : json(res, 401, { error: 'Требуется вход' });
      if (p.startsWith('/api/admin/') || p === '/api/media/site') {
        if (!user || !user.admin) return json(res, 403, { error: 'Нужны права администратора' });
        const q = new URL(req.url, 'http://x').searchParams;
        if (p === '/api/media/site') return json(res, 200, list('site'));
        if (p === '/api/admin/ai') return json(res, 200, { cfg: aiCfg(), st: await aiStatus() });
        if (p === '/api/admin/ai/status') return json(res, 200, await aiStatus());
        if (p === '/api/admin/report') return json(res, 200, report());
        if (p === '/api/admin/history') return json(res, 200, history(q));
        if (p === '/api/admin/export.csv') return send(res, 200, csv(), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="visits.csv"', 'Cache-Control': 'no-store' });
        return json(res, 404, { error: 'Не найдено' });
      }
      if (p === '/api/ai/status') {
        if (!user) return json(res, 401, { error: 'Требуется вход' });
        const c = aiCfg();
        return json(res, 200, { enabled: !!c.enabled, online: c.enabled ? await aiOnline() : false });
      }
      if (['/api/news', '/api/site', '/api/media/video', '/api/media/photo', '/api/media/music'].includes(p)) {
        if (!user) return json(res, 401, { error: 'Требуется вход' });
        if (p === '/api/news') return json(res, 200, getNews());
        if (p === '/api/site') return json(res, 200, readJson(SITE_FILE, {}));
        return json(res, 200, list(p.split('/').pop()));
      }
      const m = /^\/media\/(video|photo|music|site)\/([^/]+)$/.exec(p);
      if (m) {
        if (!user) return json(res, 401, { error: 'Требуется вход' });
        return serveMedia(req, res, m[1], decodeURIComponent(m[2]));
      }
      if (req.method === 'GET' && (req.headers.accept || '').includes('text/html') && !p.startsWith('/api/') && !p.startsWith('/media/')) return redirect(res, '/');
      return json(res, 404, { error: 'Не найдено' });
    }

    if (req.method === 'POST') {
      if (p === '/api/admin/upload') {
        if (!user || !user.admin || !sameOrigin(req) || req.headers['x-requested-with'] !== 'portal')
          return json(res, 403, { error: 'Нужны права администратора' });
        return upload(req, res);
      }
      if (!sameOrigin(req) || !(req.headers['content-type'] || '').startsWith('application/json'))
        return json(res, 403, { error: 'Запрос отклонён' });

      if (p === '/api/logout') {
        sessions.delete(sha(cookies(req).sid || '')); saveSessions(); if (user) logEv(req, user.email, 'logout', '');
        return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      }
      if (p === '/api/track') {
        if (!user) return json(res, 401, { error: 'Требуется вход' });
        const b = await body(req, 2000);
        const k = b.k, d = String(b.d || '').slice(0, 200);
        if (!['view', 'play', 'photo', 'ping'].includes(k)) return json(res, 400, { error: 'Неверное событие' });
        const st = touch(user.email), now = Date.now();
        if (k === 'ping') { const dt = now - (st.lastPing || 0); if (dt >= 15000) { st.seconds += dt <= 90000 ? Math.round(dt / 1000) : 30; st.lastPing = now; } }
        else if (k === 'view') { st.views++; logEv(req, user.email, 'view', /^[a-z]{0,12}$/.test(d) ? d : ''); }
        else if (k === 'play') { st.plays++; logEv(req, user.email, 'play', d); }
        else { st.photos++; logEv(req, user.email, 'photo', d); }
        saveUsersSoon();
        return json(res, 200, { ok: true });
      }
      if (p === '/api/ai/chat') {
        if (!user) return json(res, 401, { error: 'Требуется вход' });
        return aiChat(req, res, user);
      }
      if (p.startsWith('/api/admin/')) {
        if (!user || !user.admin) return json(res, 403, { error: 'Нужны права администратора' });
        return admin(req, res, p);
      }
      if (p === '/api/register' || p === '/api/login') {
        if (limited(ip(req))) return json(res, 429, { error: 'Слишком много попыток. Подождите 10 минут.' });
        const b = await body(req);
        const email = String(b.email || '').trim().toLowerCase();
        const pw = String(b.password || '');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return json(res, 400, { error: 'Введите корректный адрес почты.' });

        if (p === '/api/register') {
          const first = Object.keys(users).length === 0;
          const isAdmin = ADMIN_EMAIL ? email === ADMIN_EMAIL : first;
          if (!OPEN_REG && !isAdmin) return json(res, 403, { error: 'Регистрация закрыта.' });
          const name = String(b.name || '').trim();
          if (!name || name.length > 60) return json(res, 400, { error: 'Введите имя (до 60 символов).' });
          if (pw.length < 8 || pw.length > 200) return json(res, 400, { error: 'Пароль должен быть от 8 до 200 символов.' });
          if (users[email]) return json(res, 409, { error: 'Этот адрес уже зарегистрирован. Войдите.' });
          const salt = crypto.randomBytes(16);
          const hh = (await scrypt(pw, salt)).toString('hex');
          if (users[email]) return json(res, 409, { error: 'Этот адрес уже зарегистрирован. Войдите.' });
          users[email] = { name, role: isAdmin ? 'admin' : 'user', salt: salt.toString('hex'), hash: hh, created: new Date().toISOString() };
          saveUsers(); touch(email); saveUsersSoon(); logEv(req, email, 'register', '');
          return json(res, 200, { ok: true }, { 'Set-Cookie': startSession(email) });
        }
        const u = users[email];
        const h = await scrypt(pw, u ? Buffer.from(u.salt, 'hex') : DUMMY_SALT);
        if (!u || !crypto.timingSafeEqual(h, Buffer.from(u.hash, 'hex'))) { logEv(req, email, 'fail', ''); return json(res, 401, { error: 'Неверная почта или пароль.' }); }
        touch(email); saveUsersSoon(); logEv(req, email, 'login', '');
        return json(res, 200, { ok: true }, { 'Set-Cookie': startSession(email) });
      }
    }
    return json(res, 404, { error: 'Не найдено' });
  } catch (e) {
    if (!res.headersSent) return json(res, 400, { error: 'Некорректный запрос' });
  }
});
server.requestTimeout = 0;
const cmd = process.argv[2];
if (cmd === '--admin' || cmd === '--passwd') {
  (async () => {
    const email = String(process.argv[3] || '').trim().toLowerCase(), u = users[email];
    if (!u) { console.error('Пользователь не найден: ' + email); process.exit(1); }
    if (cmd === '--admin') u.role = 'admin';
    else {
      const pw = String(process.argv[4] || '');
      if (pw.length < 8) { console.error('Пароль должен быть не короче 8 символов'); process.exit(1); }
      const salt = crypto.randomBytes(16);
      u.salt = salt.toString('hex'); u.hash = (await scrypt(pw, salt)).toString('hex');
    }
    saveUsers(); console.log('Готово. Перезапустите сервис: systemctl restart portal'); process.exit(0);
  })();
} else {
  server.listen(PORT, '127.0.0.1', () => console.log('Портал запущен на 127.0.0.1:' + PORT));
  const flush = () => { try { writeJson(SESS_FILE, Object.fromEntries(sessions), 0o600); saveUsers(); } catch (e) {} process.exit(0); };
  process.on('SIGTERM', flush); process.on('SIGINT', flush);
}
