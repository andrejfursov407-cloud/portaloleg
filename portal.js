const $ = s => document.querySelector(s);
const el = (t, p = {}, ...k) => {
  const e = document.createElement(t);
  for (const [n, v] of Object.entries(p)) {
    if (n.startsWith('aria-') || n.startsWith('data-') || n === 'role') e.setAttribute(n, v); else e[n] = v;
  }
  k.forEach(x => e.append(x));
  return e;
};
const html = s => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstChild; };
const H = { 'Content-Type': 'application/json' };
let me = {}, site = {}, news = [], media = { video: [], photo: [], music: [], site: [] };

async function api(u, opt) {
  const r = await fetch(u, opt);
  if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Ошибка');
  return d;
}
const post = (u, b) => api(u, { method: 'POST', headers: H, body: JSON.stringify(b) });
function track(k, d) { fetch('/api/track', { method: 'POST', headers: H, body: JSON.stringify({ k, d: d || '' }), keepalive: true }).catch(() => {}); }
const once = label => { let done = false; return () => { if (!done) { done = true; track('play', label); } }; };
function startPing() {
  let act = Date.now();
  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(ev => addEventListener(ev, () => { act = Date.now(); }, { passive: true }));
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - act < 120000) track('ping'); }, 30000);
}
function applyTheme() {
  const t = site.theme || {}, r = document.documentElement.style;
  ['blue', 'navy'].forEach(k => { if (/^#[0-9a-f]{6}$/i.test(t[k])) r.setProperty('--' + k, t[k]); else r.removeProperty('--' + k); });
}
async function loadMedia() { for (const t of ['video', 'photo', 'music'].concat(me.admin ? ['site'] : [])) media[t] = await api('/api/media/' + t); }
async function loadAll() { [site, news] = await Promise.all([api('/api/site'), api('/api/news')]); await loadMedia(); }
const fmtDate = d => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('ru-RU'); };
const mb = n => (n / 1048576).toFixed(1) + ' МБ';
const photoUrl = n => '/media/photo/' + encodeURIComponent(n);
const siteUrl = n => '/media/site/' + encodeURIComponent(n);

const ICONS = {
  research: '<path d="M13 6v13a8 8 0 0 0 16 0V6M10 6h6M26 6h6M21 27v5a8 8 0 0 0 16 0v-7"/><circle cx="37" cy="22" r="3.5"/>',
  social: '<circle cx="24" cy="14" r="5"/><path d="M14 36v-4a10 10 0 0 1 20 0v4z"/><circle cx="9" cy="19" r="4"/><circle cx="39" cy="19" r="4"/><path d="M2 34v-3a6 6 0 0 1 6-6M46 34v-3a6 6 0 0 0-6-6"/>',
  medical: '<path d="M3 20l9-7 9 2 6-3 9 5 9 3M7 31l5 5 5-3 3 3 4-3 6 5 5-4M12 13l-5 6 9 9M36 17l5 6-10 9"/>'
};
const icon = k => html('<svg viewBox="0 0 48 48" aria-hidden="true">' + ICONS[k] + '</svg>');
const SOC = {
  vk: ['ВКонтакте', '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0077ff"/><text x="16" y="21" text-anchor="middle" font-size="12" font-weight="800" fill="#fff" font-family="Arial">VK</text></svg>'],
  tg: ['Telegram', '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#29a9ea"/><path d="M7 15.5l17-6.5-2.8 14-5-3.7-2.6 2.5-.5-4.3 8-7.2-10 6.200z" fill="#fff"/></svg>'],
  yt: ['YouTube', '<svg viewBox="0 0 32 32"><rect x="1" y="6" width="30" height="20" rx="6" fill="#f00"/><path d="M13 11l8 5-8 5z" fill="#fff"/></svg>'],
  ok: ['Одноклассники', '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#ee8208"/><circle cx="16" cy="11" r="3" fill="none" stroke="#fff" stroke-width="2"/><path d="M11 17c3 2 7 2 10 0M16 19.5v4M12.5 27l3.5-3.5 3.5 3.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>']
};
function drawSocials() {
  document.querySelectorAll('.soc').forEach(box => {
    box.replaceChildren(...Object.entries(SOC).map(([k, [t, svg]]) => {
      const u = (site.social || {})[k];
      const n = u ? el('a', { href: u, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t }) : el('span', { 'aria-hidden': 'true' });
      n.append(html(svg)); return n;
    }));
  });
}

function newsCard(n) {
  const pic = n.photo ? el('img', { className: 'pic', src: photoUrl(n.photo), alt: '', loading: 'lazy' }) : el('div', { className: 'pic', textContent: 'Б', 'aria-hidden': 'true' });
  const cal = html('<svg class="ci" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 7h12M5 1.5v3M11 1.5v3"/></svg>');
  return el('article', { className: 'ncard' }, pic,
    el('div', {}, el('time', {}, cal, fmtDate(n.date)), el('h3', { textContent: n.title })),
    el('p', { textContent: n.text }), el('a', { className: 'more', href: '#/post/' + n.id, textContent: 'Читать далее →' }));
}
function home() {
  const T = site.texts || {};
  const h = el('section', { className: 'hero' + (site.hero ? ' has-img' : '') }, el('div', { className: 'wrap hero-in' },
    el('h1', {}, el('span', { textContent: T.title || 'Олег Борисовский:' }), el('span', { className: 'sub', textContent: T.subtitle || 'медицина, наука, благотворительность' })),
    el('a', { className: 'gbtn', href: '#/projects' }, T.button || 'Подробнее о проектах', el('i', { textContent: '›' }))));
  if (site.hero) {
    h.style.backgroundImage = 'url("' + siteUrl(site.hero) + '")';
    h.style.setProperty('--hx', (site.heroX ?? 50) + '%'); h.style.setProperty('--hy', (site.heroY ?? 0) + '%'); h.style.setProperty('--hxm', (site.heroXm ?? 68) + '%');
  }
  const cards = el('div', { className: 'cards' }, ...[['research', 'Научные исследования'], ['social', 'Социальные проекты'], ['medical', 'Медицинская практика']]
    .map(([k, t], i) => [k, (T.cards || [])[i] || t]).map(([k, t]) => el('a', { className: 'fcard', href: '#/projects' }, icon(k), el('span', { textContent: t }))));
  const box = el('div', { className: 'home' }, h, cards, el('h2', { className: 'sec-title', textContent: T.newsTitle || 'Последние новости и блог' }),
    news.length ? el('div', { className: 'news' }, ...news.slice(0, 3).map(newsCard)) : el('p', { className: 'hint', textContent: 'Новостей пока нет.' }),
    el('i', { className: 'rib l' }), el('i', { className: 'rib r' }));
  return box;
}
const textPage = (title, key) => () => el('div', { className: 'wrap page' }, el('h2', { textContent: title }),
  el('p', { className: site[key] ? 'text' : 'hint', textContent: site[key] || 'Раздел пока не заполнен.' }));
const blog = () => el('div', { className: 'wrap page' }, el('h2', { textContent: 'Блог' }),
  el('div', { className: 'list' }, ...(news.length ? news.map(newsCard) : [el('p', { className: 'hint', textContent: 'Записей пока нет.' })])));
function postPage(id) {
  const n = news.find(x => x.id === id);
  if (!n) return el('div', { className: 'wrap page' }, el('h2', { textContent: 'Запись не найдена' }), el('a', { className: 'link', href: '#/blog', textContent: '← В блог' }));
  return el('div', { className: 'wrap page post' }, el('a', { className: 'link', href: '#/blog', textContent: '← В блог' }),
    el('h2', { textContent: n.title }), el('p', { className: 'hint', textContent: fmtDate(n.date) }),
    ...(n.photo ? [el('img', { className: 'big', src: photoUrl(n.photo), alt: '' })] : []), el('p', { className: 'text', textContent: n.text }));
}
function searchPage(q) {
  const s = q.toLowerCase();
  const nn = news.filter(n => (n.title + ' ' + n.text).toLowerCase().includes(s));
  const mm = ['video', 'photo', 'music'].flatMap(t => media[t].filter(f => f.title.toLowerCase().includes(s)).map(f => ({ ...f, t })));
  const kind = { video: 'Видео', photo: 'Фото', music: 'Аудио' };
  return el('div', { className: 'wrap page' }, el('h2', { textContent: 'Поиск: ' + q }),
    nn.length ? el('div', { className: 'list' }, ...nn.map(newsCard)) : '',
    mm.length ? el('div', {}, el('h3', { textContent: 'Файлы' }), ...mm.map(f => el('p', {}, el('a', { className: 'link', href: '#/media', textContent: f.title + ' (' + kind[f.t] + ')' })))) : '',
    !nn.length && !mm.length ? el('p', { className: 'hint', textContent: 'Ничего не найдено.' }) : '');
}

function lightbox(i) {
  const list = media.photo; if (!list.length) return;
  track('photo', list[i].title);
  const img = el('img', { alt: '' });
  const show = () => { img.src = list[i].url; img.alt = list[i].title; };
  const close = () => { lb.remove(); document.body.classList.remove('lock'); document.removeEventListener('keydown', key); };
  const step = d => { i = (i + d + list.length) % list.length; show(); };
  const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); };
  const lb = el('div', { className: 'lb', role: 'dialog', 'aria-label': 'Просмотр фото' }, img,
    el('button', { className: 'x', textContent: '×', 'aria-label': 'Закрыть', onclick: close }),
    el('button', { className: 'pv', textContent: '‹', 'aria-label': 'Назад', onclick: () => step(-1) }),
    el('button', { className: 'nx', textContent: '›', 'aria-label': 'Вперёд', onclick: () => step(1) }));
  lb.onclick = e => { if (e.target === lb) close(); };
  let x0 = null;
  lb.ontouchstart = e => { x0 = e.touches[0].clientX; };
  lb.ontouchend = e => { if (x0 === null) return; const d = e.changedTouches[0].clientX - x0; if (Math.abs(d) > 50) step(d > 0 ? -1 : 1); x0 = null; };
  document.addEventListener('keydown', key); document.body.classList.add('lock'); document.body.append(lb); show();
}
const emptyMsg = () => el('p', { className: 'hint', textContent: 'Здесь пока пусто.' + (me.admin ? ' Добавьте файлы в админ-панели.' : '') });
const players = {
  video: () => media.video.length ? el('div', { className: 'grid' }, ...media.video.map(f =>
    el('div', { className: 'tile' }, el('video', { src: f.url, controls: true, preload: 'metadata', playsInline: true, onplay: once('Видео: ' + f.title) }), el('p', { textContent: f.title })))) : emptyMsg(),
  photo: () => media.photo.length ? el('div', { className: 'grid' }, ...media.photo.map((f, i) =>
    el('div', { className: 'tile' }, el('button', { className: 'ph', 'aria-label': 'Открыть: ' + f.title, onclick: () => lightbox(i) },
      el('img', { src: f.url, alt: f.title, loading: 'lazy' })), el('p', { textContent: f.title })))) : emptyMsg(),
  music: () => {
    if (!media.music.length) return emptyMsg();
    const audios = [];
    return el('div', {}, ...media.music.map(f => {
      const a = el('audio', { src: f.url, controls: true, preload: 'none' }); audios.push(a);
      const tr = once('Аудио: ' + f.title);
      a.onplay = () => { audios.forEach(o => { if (o !== a) o.pause(); }); tr(); };
      a.onended = () => { const n = audios[audios.indexOf(a) + 1]; if (n) n.play().catch(() => {}); };
      return el('div', { className: 'track' }, el('p', { textContent: f.title }), a);
    }));
  }
};
function mediaPage() {
  const kinds = [['video', 'Видео'], ['photo', 'Фото'], ['music', 'Аудио']];
  const body = el('div'), tabs = el('div', { className: 'tabs', role: 'tablist' });
  const show = k => { tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.k === k))); body.replaceChildren(players[k]()); };
  kinds.forEach(([k, t]) => tabs.append(el('button', { role: 'tab', textContent: t, 'data-k': k, onclick: () => show(k) })));
  show('video');
  return el('div', { className: 'wrap page' }, el('h2', { textContent: 'Медиа' }), tabs, body);
}

/* админ-панель */
const ROUTE = { '': 'Главная', bio: 'Биография', projects: 'Проекты', media: 'Медиа', blog: 'Блог', contacts: 'Контакты', admin: 'Админ-панель', post: 'Запись блога', search: 'Поиск', ai: 'Олег AI' };
const KIND = { register: 'Регистрация', login: 'Вход', fail: 'Неудачный вход', logout: 'Выход', view: 'Страница', play: 'Воспроизведение', photo: 'Фото', ai: 'Вопрос Олег AI' };
const fmtDT = t => t ? new Date(t).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const fmtDur = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ' ч ' + m + ' мин' : m ? m + ' мин' : s + ' с'; };
const panel = (title, ...k) => el('section', { className: 'panel' }, el('h3', { textContent: title }), ...k);
const field = (label, input) => el('div', {}, el('label', { textContent: label }), input);
const table = (head, rows) => el('div', { className: 'tbl' }, el('table', {}, el('thead', {}, el('tr', {}, ...head.map(h => el('th', { textContent: h })))),
  el('tbody', {}, ...rows.map(r => el('tr', {}, ...r.map(c => el('td', { textContent: String(c) })))))));

let adminTab = 'design';
function adminPage() {
  const w = el('div', { className: 'wrap page' }, el('h2', { textContent: 'Админ-панель' }));
  const tabs = el('div', { className: 'tabs', role: 'tablist' }), body = el('div');
  const S = { design: ['Дизайн', adminDesign], files: ['Файлы', adminFiles], content: ['Новости и тексты', adminContent], report: ['Отчёт', adminReport], ai: ['Нейросеть', adminAI] };
  const show = k => { adminTab = k; tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.k === k))); body.replaceChildren(S[k][1]()); };
  Object.entries(S).forEach(([k, [t]]) => tabs.append(el('button', { role: 'tab', textContent: t, 'data-k': k, onclick: () => show(k) })));
  w.append(tabs, body); show(adminTab);
  return w;
}

/* --- дизайн --- */
function adminDesign() {
  const box = el('div');
  let hero = site.hero || '', hx = site.heroX ?? 50, hy = site.heroY ?? 0, hxm = site.heroXm ?? 68;
  const pw = el('div', { className: 'hprev w' }), pp = el('div', { className: 'hprev p' });
  const paint = () => [[pw, hx], [pp, hxm]].forEach(([d, x]) => {
    d.style.backgroundImage = hero ? 'url("' + siteUrl(hero) + '")' : '';
    d.style.backgroundPosition = x + '% ' + hy + '%';
  });
  const slider = (label, get, set) => { const i = el('input', { type: 'range', min: 0, max: 100, value: get() }); i.oninput = () => { set(+i.value); paint(); }; return field(label, i); };
  const list = el('div'), pmsg = el('p', { className: 'msg' });
  const drawList = () => list.replaceChildren(...(media.site.length ? media.site.map(f => el('div', { className: 'frow' },
    el('span', { textContent: f.name }), el('small', { textContent: mb(f.size) }),
    el('button', { className: 'mini' + (hero === f.name ? ' on' : ''), type: 'button', textContent: hero === f.name ? 'Выбрано' : 'Выбрать', onclick: () => { hero = f.name; paint(); drawList(); } }),
    el('button', { className: 'mini del', type: 'button', textContent: 'Удалить', onclick: async () => {
      if (!confirm('Удалить файл «' + f.name + '»?')) return;
      await post('/api/admin/delete', { type: 'site', name: f.name }); await loadMedia(); if (hero === f.name) hero = ''; paint(); drawList();
    } }))) : [el('p', { className: 'hint', textContent: 'Фото ещё не загружались.' })]));
  const inp = el('input', { type: 'file', accept: '.jpg,.jpeg,.png,.webp' }), bar = el('progress', { max: 100, value: 0 }), umsg = el('span');
  const up = el('button', { className: 'gbtn', type: 'button', textContent: 'Загрузить фото' });
  up.onclick = async () => {
    if (!inp.files[0]) return;
    up.disabled = true; bar.value = 0;
    const r = await sendFile('site', inp.files[0], bar, umsg);
    up.disabled = false; inp.value = '';
    if (r) { await loadMedia(); if (typeof r === 'string') hero = r; paint(); drawList(); }
  };
  const save = el('button', { className: 'gbtn', type: 'button', textContent: 'Сохранить фото на главной' });
  save.onclick = async () => {
    try { await post('/api/admin/site', { hero, heroX: hx, heroY: hy, heroXm: hxm }); Object.assign(site, { hero, heroX: hx, heroY: hy, heroXm: hxm }); pmsg.textContent = 'Сохранено. Откройте «Главная», чтобы увидеть результат.'; }
    catch (e) { pmsg.textContent = e.message; }
  };
  const none = el('button', { className: 'mini', type: 'button', textContent: 'Убрать фото (небо и луг)', onclick: () => { hero = ''; paint(); drawList(); } });
  box.append(panel('Фото на главной странице',
    el('p', { className: 'hint', textContent: 'Это большое фото в шапке главной (где стоит человек). Лучше всего подходит широкий снимок от 1600 пикселей по ширине, человек справа, слева свободное место под заголовок.' }),
    el('div', { className: 'row' }, field('Новое фото (JPG, PNG, WebP)', inp), up), el('div', { className: 'ups' }, bar, umsg),
    el('h4', { textContent: 'Загруженные фото' }), list, el('p', {}, none),
    el('h4', { textContent: 'Положение на экране' }),
    el('div', { className: 'prevs' }, pw, pp),
    el('div', { className: 'row' }, slider('Компьютер: по горизонтали', () => hx, v => { hx = v; }), slider('Вертикаль', () => hy, v => { hy = v; }), slider('Телефон: по горизонтали', () => hxm, v => { hxm = v; })),
    el('p', {}, save), pmsg));
  paint(); drawList();

  const T0 = site.theme || {};
  const cb = el('input', { type: 'color', value: T0.blue || '#0b3fd6' }), cn = el('input', { type: 'color', value: T0.navy || '#0a1a6b' }), cmsg = el('p', { className: 'msg' });
  const live = () => { document.documentElement.style.setProperty('--blue', cb.value); document.documentElement.style.setProperty('--navy', cn.value); };
  cb.oninput = live; cn.oninput = live;
  const PRE = [['Синяя', '#0b3fd6', '#0a1a6b'], ['Зелёная', '#0f8a4f', '#0b3d2a'], ['Бордовая', '#b3202f', '#4a0f1a'], ['Графит', '#374151', '#111827']];
  const sw = el('div', { className: 'row' }, ...PRE.map(([t, a, b]) => el('button', { className: 'mini', type: 'button', textContent: t, onclick: () => { cb.value = a; cn.value = b; live(); } })));
  box.append(panel('Цвета сайта', el('div', { className: 'row' }, field('Основной цвет (кнопки, акценты)', cb), field('Тёмный цвет (заголовки)', cn)), sw,
    el('p', {}, el('button', { className: 'gbtn', type: 'button', textContent: 'Сохранить цвета', onclick: async () => {
      try { await post('/api/admin/site', { theme: { blue: cb.value, navy: cn.value } }); site.theme = { blue: cb.value, navy: cn.value }; cmsg.textContent = 'Сохранено'; } catch (e) { cmsg.textContent = e.message; }
    } }), ' ', el('button', { className: 'mini', type: 'button', textContent: 'Вернуть стандартные', onclick: async () => {
      await post('/api/admin/site', { theme: {} }); site.theme = {}; applyTheme(); cb.value = '#0b3fd6'; cn.value = '#0a1a6b'; cmsg.textContent = 'Стандартные цвета';
    } })), cmsg));

  const T = site.texts || {}, ti = {};
  const defs = [['title', 'Заголовок', 'Олег Борисовский:'], ['subtitle', 'Подзаголовок', 'медицина, наука, благотворительность'], ['button', 'Текст кнопки', 'Подробнее о проектах'],
    ['c0', 'Карточка 1', 'Научные исследования'], ['c1', 'Карточка 2', 'Социальные проекты'], ['c2', 'Карточка 3', 'Медицинская практика'], ['newsTitle', 'Заголовок блока новостей', 'Последние новости и блог']];
  const val = k => k[0] === 'c' && k.length === 2 ? (T.cards || [])[+k[1]] : T[k];
  defs.forEach(([k, , d]) => { ti[k] = el('input', { value: val(k) || '', placeholder: d, maxLength: 120 }); });
  const tmsg = el('p', { className: 'msg' });
  const saveT = async reset => {
    const texts = reset ? {} : { title: ti.title.value, subtitle: ti.subtitle.value, button: ti.button.value, newsTitle: ti.newsTitle.value, cards: [ti.c0.value, ti.c1.value, ti.c2.value] };
    try { await post('/api/admin/site', { texts }); site.texts = reset ? {} : texts; if (reset) defs.forEach(([k]) => { ti[k].value = ''; }); tmsg.textContent = 'Сохранено'; } catch (e) { tmsg.textContent = e.message; }
  };
  box.append(panel('Тексты на главной', el('p', { className: 'hint', textContent: 'Пустое поле означает стандартный текст.' }), ...defs.map(([k, l]) => field(l, ti[k])),
    el('p', {}, el('button', { className: 'gbtn', type: 'button', textContent: 'Сохранить тексты', onclick: () => saveT(false) }), ' ', el('button', { className: 'mini', type: 'button', textContent: 'Сбросить', onclick: () => saveT(true) })), tmsg));
  return box;
}

/* --- файлы --- */
function adminFiles() {
  const box = el('div');
  const kinds = [['video', 'Видео'], ['photo', 'Фото'], ['music', 'Аудио']];
  const accept = { video: '.mp4,.m4v,.mov,.webm', photo: '.jpg,.jpeg,.png,.webp,.gif', music: '.mp3,.m4a,.aac,.ogg,.wav,.flac' };
  const sel = el('select', {}, ...kinds.map(([v, t]) => el('option', { value: v, textContent: t })));
  const inp = el('input', { type: 'file', multiple: true, accept: accept.video });
  const fmt = el('p', { className: 'hint', textContent: 'Форматы: ' + accept.video.replace(/\./g, '').replace(/,/g, ', ') });
  sel.onchange = () => { inp.accept = accept[sel.value]; fmt.textContent = 'Форматы: ' + accept[sel.value].replace(/\./g, '').replace(/,/g, ', '); };
  const ups = el('div', { className: 'ups' });
  const go = el('button', { className: 'gbtn', type: 'button', textContent: 'Загрузить' });
  go.onclick = async () => {
    const files = [...inp.files]; if (!files.length) return;
    go.disabled = true; ups.replaceChildren();
    for (const f of files) {
      const bar = el('progress', { max: 100, value: 0 }), msg = el('span');
      ups.append(el('div', {}, el('span', { textContent: f.name }), bar, msg));
      await sendFile(sel.value, f, bar, msg);
    }
    inp.value = ''; go.disabled = false;
    await loadMedia(); refresh();
  };
  const files = el('section', { className: 'panel' });
  function refresh() {
    files.replaceChildren(el('h3', { textContent: 'Загруженные файлы' }));
    kinds.forEach(([k, t]) => {
      files.append(el('h4', { textContent: t }));
      if (!media[k].length) files.append(el('p', { className: 'hint', textContent: 'Нет файлов.' }));
      media[k].forEach(f => files.append(el('div', { className: 'frow' }, el('span', { textContent: f.name }), el('small', { textContent: mb(f.size) }),
        el('button', { className: 'mini del', type: 'button', textContent: 'Удалить', onclick: async () => {
          if (!confirm('Удалить файл «' + f.name + '»?')) return;
          await post('/api/admin/delete', { type: k, name: f.name }); await loadMedia(); refresh();
        } }))));
    });
  }
  box.append(panel('Загрузка файлов', el('div', { className: 'row' }, field('Раздел', sel), field('Файлы', inp), go), fmt, ups), files);
  refresh();
  return box;
}

/* --- новости и тексты --- */
function adminContent() {
  const box = el('div');
  const photoSel = el('select', {}, el('option', { value: '', textContent: 'Без фото' }), ...media.photo.map(f => el('option', { value: f.name, textContent: f.name })));
  const nt = el('input', { maxLength: 150 }), nx = el('textarea', { maxLength: 5000 }), nmsg = el('p', { className: 'msg' }), nlist = el('div');
  const drawNews = () => nlist.replaceChildren(...news.map(n => el('div', { className: 'frow' },
    el('span', { textContent: n.title }), el('small', { textContent: fmtDate(n.date) }),
    el('button', { className: 'mini del', type: 'button', textContent: 'Удалить', onclick: async () => {
      if (!confirm('Удалить запись «' + n.title + '»?')) return;
      await post('/api/admin/news/delete', { id: n.id }); news = await api('/api/news'); drawNews();
    } }))));
  const pub = el('button', { className: 'gbtn', type: 'button', textContent: 'Опубликовать' });
  pub.onclick = async () => {
    try { await post('/api/admin/news', { title: nt.value, text: nx.value, photo: photoSel.value }); nt.value = ''; nx.value = ''; nmsg.textContent = 'Опубликовано'; news = await api('/api/news'); drawNews(); }
    catch (e) { nmsg.textContent = e.message; }
  };
  box.append(panel('Новости и блог', field('Заголовок', nt), field('Текст', nx), field('Фото к записи', photoSel), el('p', {}, pub), nmsg, nlist));
  drawNews();

  const ps = el('select', {}, ...[['bio', 'Биография'], ['projects', 'Проекты'], ['contacts', 'Контакты']].map(([v, t]) => el('option', { value: v, textContent: t })));
  const pt = el('textarea', { value: site.bio || '' }), pmsg = el('p', { className: 'msg' });
  ps.onchange = () => { pt.value = site[ps.value] || ''; pmsg.textContent = ''; };
  const sv = el('button', { className: 'gbtn', type: 'button', textContent: 'Сохранить' });
  sv.onclick = async () => { try { await post('/api/admin/site', { [ps.value]: pt.value }); site[ps.value] = pt.value; pmsg.textContent = 'Сохранено'; } catch (e) { pmsg.textContent = e.message; } };
  box.append(panel('Тексты разделов', field('Раздел', ps), field('Текст', pt), el('p', {}, sv), pmsg));

  const soc = {}, smsg = el('p', { className: 'msg' });
  const sbox = Object.entries(SOC).map(([k, [t]]) => { soc[k] = el('input', { type: 'url', placeholder: 'https://', value: (site.social || {})[k] || '' }); return field(t, soc[k]); });
  const ss = el('button', { className: 'gbtn', type: 'button', textContent: 'Сохранить' });
  ss.onclick = async () => {
    const social = Object.fromEntries(Object.entries(soc).map(([k, i]) => [k, i.value.trim()]));
    try { await post('/api/admin/site', { social }); site.social = social; drawSocials(); smsg.textContent = 'Сохранено'; } catch (e) { smsg.textContent = e.message; }
  };
  box.append(panel('Ссылки на соцсети', ...sbox, el('p', {}, ss), smsg));
  return box;
}

/* --- отчёт --- */
function adminReport() {
  const box = el('div', {}, el('p', { className: 'hint', textContent: 'Загрузка отчёта…' }));
  api('/api/admin/report').then(r => {
    const t = r.totals;
    const cards = [['Пользователей', t.users], ['Новых за 7 дней', t.new7], ['Активных за 7 дней', t.active7], ['Активных за 30 дней', t.active30], ['Сейчас на сайте', t.online],
      ['Визитов', t.visits], ['Просмотров страниц', t.views], ['Видео и аудио', t.plays], ['Просмотров фото', t.photos], ['Вопросов Олег AI', t.ai], ['Входов', t.logins], ['Время на сайте', fmtDur(t.seconds)]];
    const mx = Math.max(1, ...r.daily.map(d => d.views));
    const bars = el('div', { className: 'bars' }, ...r.daily.map(d => { const i = el('i', { title: d.d + ': просмотров ' + d.views + ', посетителей ' + d.users }); i.style.height = Math.max(2, d.views / mx * 100) + '%'; return i; }));
    const dev = t.mobile + t.desktop;
    const users = table(['Имя', 'Почта', 'Роль', 'Регистрация', 'Последний визит', 'Визитов', 'Страниц', 'Видео/аудио', 'Фото', 'AI', 'Время', 'Любимый раздел', 'Устройство'],
      r.users.map(u => [u.name, u.email, u.role === 'admin' ? 'админ' : 'пользователь', fmtDT(Date.parse(u.created || 0)), fmtDT(u.last), u.visits, u.views, u.plays, u.photos, u.ai, fmtDur(u.seconds), u.top === null ? '—' : (ROUTE[u.top] ?? u.top), u.device || '—']));
    box.replaceChildren(
      el('div', { className: 'stats' }, ...cards.map(([l, v]) => el('div', { className: 'stat' }, el('b', { textContent: String(v) }), el('span', { textContent: l })))),
      panel('Просмотры страниц за 30 дней', bars, el('p', { className: 'hint', textContent: 'Устройства: телефоны ' + (dev ? Math.round(t.mobile / dev * 100) : 0) + '%, компьютеры ' + (dev ? Math.round(t.desktop / dev * 100) : 0) + '%. Время считается по активности на странице.' })),
      panel('Пользователи', users),
      el('div', { className: 'two' },
        panel('Популярные разделы', table(['Раздел', 'Просмотров'], r.pages.map(([k, n]) => [ROUTE[k] ?? k, n]))),
        panel('Популярные файлы', r.media.length ? table(['Файл', 'Открытий'], r.media) : el('p', { className: 'hint', textContent: 'Пока нет данных.' }))),
      historyPanel(r.users));
  }).catch(e => { box.textContent = e.message; });
  return box;
}
function historyPanel(users) {
  let off = 0;
  const kindSel = el('select', {}, el('option', { value: '', textContent: 'Все события' }), ...Object.entries(KIND).map(([v, t]) => el('option', { value: v, textContent: t })));
  const userSel = el('select', {}, el('option', { value: '', textContent: 'Все пользователи' }), ...users.map(u => el('option', { value: u.email, textContent: u.name + ' (' + u.email + ')' })));
  const tb = el('tbody'), info = el('p', { className: 'hint' });
  const more = el('button', { className: 'mini', type: 'button', textContent: 'Показать ещё' });
  async function load(reset) {
    if (reset) { off = 0; tb.replaceChildren(); }
    const d = await api('/api/admin/history?offset=' + off + '&limit=100&k=' + encodeURIComponent(kindSel.value) + '&u=' + encodeURIComponent(userSel.value));
    d.items.forEach(e => tb.append(el('tr', {}, ...[fmtDT(e.t), e.name || e.u || '—', KIND[e.k] || e.k, e.k === 'view' ? (ROUTE[e.d] ?? e.d) : e.d, e.ip, e.m ? 'Телефон' : 'Компьютер'].map(c => el('td', { textContent: c })))));
    off += d.items.length; more.hidden = off >= d.total; info.textContent = 'Показано ' + off + ' из ' + d.total;
  }
  kindSel.onchange = () => load(true); userSel.onchange = () => load(true); more.onclick = () => load(false);
  load(true);
  return panel('История посещений', el('div', { className: 'row' }, field('Событие', kindSel), field('Пользователь', userSel), el('a', { className: 'mini', href: '/api/admin/export.csv', textContent: 'Скачать всё в CSV (Excel)' })),
    el('div', { className: 'tbl' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Время', 'Пользователь', 'Событие', 'Подробности', 'IP', 'Устройство'].map(h => el('th', { textContent: h })))), tb)), info, more,
    el('p', { className: 'hint', textContent: 'В истории хранятся адреса (IP), время и действия пользователей. Сообщите посетителям об этом в политике конфиденциальности.' }));
}

/* --- нейросеть (локальная, Ollama) --- */
const RECOMMENDED = [
  ['qwen3.5:4b', 'Qwen 3.5, 4B: рекомендуется для 8 ГБ (≈3,4 ГБ)'],
  ['qwen3.5:2b', 'Qwen 3.5, 2B: быстрее, но проще (≈2 ГБ)'],
  ['gemma3:4b', 'Gemma 3, 4B: хорошо пишет по-русски (≈3,3 ГБ)'],
  ['llama3.2:3b', 'Llama 3.2, 3B: лёгкая (≈2 ГБ)'],
  ['qwen3.5:9b', 'Qwen 3.5, 9B: качественнее, но на 8 ГБ тесно и медленно (≈6,6 ГБ)']
];
const gb = n => (n / 1073741824).toFixed(1) + ' ГБ';
function adminAI() {
  const box = el('div', {}, el('p', { className: 'hint', textContent: 'Загрузка…' }));
  api('/api/admin/ai').then(({ cfg, st }) => {
    const stBox = el('div'), mList = el('div'), pBox = el('div');
    const model = el('input', { value: cfg.model }), dl = el('datalist', { id: 'aimodels' });
    model.setAttribute('list', 'aimodels');
    const msg = el('p', { className: 'msg' });
    let timer = null;
    function paint(s) {
      stBox.replaceChildren(el('p', { textContent: s.online ? 'Ollama работает, версия ' + s.version + '.' : 'Ollama не отвечает. На сервере выполните: sudo systemctl status ollama' }),
        el('p', { className: 'hint', textContent: 'Сервер: ' + s.cpus + ' ядер, память: свободно ' + gb(s.ramFree) + ' из ' + gb(s.ramTotal) + '.' }));
      dl.replaceChildren(...s.models.map(m => el('option', { value: m.name })));
      mList.replaceChildren(...(s.models.length ? s.models.map(m => el('div', { className: 'frow' }, el('span', { textContent: m.name }), el('small', { textContent: gb(m.size) }),
        el('button', { className: 'mini' + (model.value === m.name ? ' on' : ''), type: 'button', textContent: model.value === m.name ? 'Выбрана' : 'Выбрать', onclick: () => { model.value = m.name; paint(s); } }),
        el('button', { className: 'mini del', type: 'button', textContent: 'Удалить', onclick: async () => {
          if (!confirm('Удалить модель «' + m.name + '» с сервера?')) return;
          try { await post('/api/admin/ai/delete', { model: m.name }); poll(); } catch (e) { msg.textContent = e.message; }
        } }))) : [el('p', { className: 'hint', textContent: 'Моделей нет. Скачайте модель ниже.' })]));
      const p = s.pull;
      if (p) {
        const pct = p.total ? Math.round(p.completed / p.total * 100) : 0;
        pBox.replaceChildren(el('p', { textContent: p.error ? 'Ошибка загрузки «' + p.model + '»: ' + p.error : p.done ? 'Модель «' + p.model + '» загружена.' : 'Загрузка «' + p.model + '»: ' + p.status + (p.total ? ', ' + pct + '% (' + gb(p.completed) + ' из ' + gb(p.total) + ')' : '') }),
          ...(p.done ? [] : [el('progress', { max: 100, value: pct })]));
      } else pBox.replaceChildren();
      const busy = p && !p.done;
      clearTimeout(timer);
      if (busy) timer = setTimeout(poll, 2000);
      dlBtn.disabled = !!busy;
    }
    async function poll() {
      if (!document.body.contains(box)) return;
      try { paint(await api('/api/admin/ai/status')); } catch (e) { msg.textContent = e.message; }
    }
    const pick = el('select', {}, ...RECOMMENDED.map(([v, t]) => el('option', { value: v, textContent: t })), el('option', { value: '', textContent: 'Другая (ввести название)…' }));
    const custom = el('input', { placeholder: 'например, mistral:7b' }); custom.hidden = true;
    pick.onchange = () => { custom.hidden = !!pick.value; };
    const dlBtn = el('button', { className: 'gbtn', type: 'button', textContent: 'Скачать модель' });
    dlBtn.onclick = async () => {
      const name = (pick.value || custom.value).trim(); if (!name) return;
      try { await post('/api/admin/ai/pull', { model: name }); msg.textContent = ''; poll(); } catch (e) { msg.textContent = e.message; }
    };
    const en = el('input', { type: 'checkbox', checked: !!cfg.enabled, id: 'aien' });
    const sp = el('textarea', { value: cfg.systemPrompt, maxLength: 4000 });
    const np = el('input', { type: 'number', min: 32, max: 2048, value: cfg.numPredict }), nc = el('input', { type: 'number', min: 1024, max: 16384, step: 1024, value: cfg.numCtx });
    const tp = el('input', { type: 'number', min: 0, max: 1.5, step: 0.1, value: cfg.temperature }), lim = el('input', { type: 'number', min: 0, max: 10000, value: cfg.dailyLimit });
    const save = () => post('/api/admin/ai', { enabled: en.checked, model: model.value, numPredict: +np.value, numCtx: +nc.value, temperature: +tp.value, dailyLimit: +lim.value, systemPrompt: sp.value });
    const sv = el('button', { className: 'gbtn', type: 'button', textContent: 'Сохранить' });
    sv.onclick = async () => { try { await save(); msg.textContent = 'Сохранено'; poll(); } catch (e) { msg.textContent = e.message; } };
    const tst = el('button', { className: 'mini', type: 'button', textContent: 'Сохранить и проверить' });
    tst.onclick = async () => {
      msg.textContent = 'Проверяю… первый запуск модели может занять до минуты';
      try { await save(); const d = await post('/api/admin/ai/test', {}); msg.textContent = d.ok ? 'Работает. Ответ модели: ' + d.reply : 'Ошибка: ' + d.error; } catch (e) { msg.textContent = e.message; }
    };
    box.replaceChildren(
      panel('Состояние', stBox),
      panel('Установленные модели', mList),
      panel('Скачать модель', el('p', { className: 'hint', textContent: 'Модель скачивается из интернета и хранится на этом сервере. Для сервера с 8 ГБ памяти без видеокарты подходят модели до 4 млрд параметров. Скорость ответа около 5–10 слов в секунду.' }),
        el('div', { className: 'row' }, field('Модель', pick), dlBtn), custom, pBox),
      panel('Настройки «Олег AI»', el('label', { htmlFor: 'aien' }, en, ' Включить «Олег AI» для посетителей'),
        field('Активная модель', model), dl, field('Инструкция для нейросети (роль и правила)', sp),
        el('div', { className: 'row' }, field('Максимум токенов в ответе', np), field('Память диалога (токенов)', nc), field('Творчество (0–1,5)', tp), field('Вопросов на человека в день (0 — без лимита)', lim)),
        el('p', {}, sv, ' ', tst), msg));
    paint(st);
  }).catch(e => { box.textContent = e.message; });
  return box;
}

function aiPage() {
  const key = 'oai_' + me.email;
  let hist = []; try { hist = JSON.parse(localStorage.getItem(key) || '[]').filter(m => m && typeof m.content === 'string'); } catch (e) {}
  const log = el('div', { className: 'chat-log', role: 'log', 'aria-live': 'polite' });
  const ta = el('textarea', { rows: 2, maxLength: 4000, placeholder: 'Напишите вопрос…' });
  const send = el('button', { className: 'gbtn', type: 'button', textContent: 'Отправить' });
  const err = el('p', { className: 'err', role: 'alert' });
  let busy = false, off = false, offMsg = '';
  const save = () => { try { localStorage.setItem(key, JSON.stringify(hist.slice(-40))); } catch (e) {} };
  const draw = typing => {
    log.replaceChildren(...hist.map(m => el('div', { className: 'bub ' + (m.role === 'user' ? 'u' : 'a'), textContent: m.content })));
    if (!hist.length) log.append(el('p', { className: 'hint', textContent: off ? (offMsg || 'Олег AI пока не включён.') + (me.admin ? ' Настройте его в админ-панели, вкладка «Нейросеть».' : '') : 'Задайте вопрос о проектах, медицине, науке или работе портала.' }));
    if (typing) log.append(el('div', { className: 'bub a', textContent: 'Олег AI печатает…' }));
    log.scrollTop = log.scrollHeight;
  };
  async function askStream(msgs, onChunk) {
    const r = await fetch('/api/ai/chat', { method: 'POST', headers: H, body: JSON.stringify({ messages: msgs }) });
    if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Ошибка'); }
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        if (m.error) throw new Error(m.error);
        if (m.d) onChunk(m.d);
      }
    }
  }
  async function ask(text) {
    text = String(text || ta.value).trim();
    if (!text || busy || off) return;
    busy = true; send.disabled = true; err.textContent = ''; ta.value = '';
    hist.push({ role: 'user', content: text }); draw(true);
    const bot = { role: 'assistant', content: '' };
    try {
      await askStream(hist.slice(-20), t => { if (!bot.content) hist.push(bot); bot.content += t; draw(false); });
      save();
    } catch (e) {
      const k = hist.indexOf(bot); if (k >= 0) hist.splice(k, 1);
      hist.pop(); ta.value = text; err.textContent = e.message;
    }
    busy = false; send.disabled = off; draw(false); ta.focus();
  }
  send.onclick = () => ask();
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); } };
  const chips = el('div', { className: 'chips' }, ...['Расскажи о проектах портала', 'Как вести здоровый образ жизни?', 'Что такое научные исследования в медицине?']
    .map(t => el('button', { className: 'mini', type: 'button', textContent: t, onclick: () => ask(t) })));
  const clear = el('button', { className: 'mini', type: 'button', textContent: 'Очистить чат', onclick: () => { hist = []; save(); err.textContent = ''; draw(false); } });
  api('/api/ai/status').then(s => { if (!s.enabled || !s.online) { off = true; offMsg = s.enabled ? 'Сервис нейросети временно недоступен.' : '';  ta.disabled = true; send.disabled = true; draw(false); } }).catch(() => {});
  draw(false);
  return el('div', { className: 'wrap page' }, el('h2', { textContent: 'Олег AI' }),
    el('p', { className: 'hint', textContent: 'Олег AI — виртуальный помощник портала, а не сам Олег Борисовский. Ответы нейросети могут быть неточными и не заменяют консультацию врача.' }),
    el('div', { className: 'chat' }, log, chips, err, el('div', { className: 'chat-in' }, ta, send), el('div', {}, clear)));
}

function sendFile(type, file, bar, msg) {
  return new Promise(done => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/admin/upload?type=' + type + '&name=' + encodeURIComponent(file.name));
    x.setRequestHeader('X-Requested-With', 'portal');
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.upload.onprogress = e => { if (e.lengthComputable) bar.value = e.loaded / e.total * 100; };
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} const ok = x.status === 200; if (ok) bar.value = 100; msg.textContent = ok ? 'Загружено' : (d.error || 'Ошибка загрузки (' + x.status + ')'); done(ok ? (d.name || true) : false); };
    x.onerror = () => { msg.textContent = 'Нет связи с сервером'; done(false); };
    x.send(file);
  });
}

const routes = { '': home, bio: textPage('Биография', 'bio'), projects: textPage('Проекты', 'projects'), media: mediaPage, blog, contacts: textPage('Контакты', 'contacts'), admin: adminPage, post: postPage, search: searchPage, ai: aiPage };
function render() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  let key = parts[0];
  const arg = decodeURIComponent(parts.slice(1).join('/'));
  if (!routes[key] || (key === 'admin' && !me.admin)) key = '';
  document.querySelectorAll('#nav a[data-r]').forEach(a => { if (a.dataset.r === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  closeMenu();
  track('view', key);
  $('#m').replaceChildren(routes[key](arg));
  window.scrollTo(0, 0);
}
function closeMenu() { $('#nav').classList.remove('open'); $('#burger').setAttribute('aria-expanded', 'false'); $('#sq').hidden = $('#sq').hidden || !$('#sq').value; }
async function logout(e) { if (e) e.preventDefault(); try { await post('/api/logout', {}); } catch (x) {} location.href = '/login'; }
$('#out').onclick = logout; $('#out2').onclick = logout;
$('#burger').onclick = () => { const o = $('#nav').classList.toggle('open'); $('#burger').setAttribute('aria-expanded', String(o)); };
$('#sf').onsubmit = e => {
  e.preventDefault();
  const i = $('#sq');
  if (i.hidden) { i.hidden = false; i.focus(); return; }
  const q = i.value.trim();
  if (q) location.hash = '#/search/' + encodeURIComponent(q); else i.hidden = true;
};
window.addEventListener('hashchange', render);
(async () => {
  me = await api('/api/me');
  $('#adminLink').hidden = !me.admin; $('#adminLink2').hidden = !me.admin;
  await loadAll(); applyTheme(); drawSocials(); render(); startPing();
})().catch(e => { if (e.message !== 'auth') $('#m').replaceChildren(el('p', { className: 'wrap page hint', textContent: 'Не удалось загрузить данные. Обновите страницу.' })); });
