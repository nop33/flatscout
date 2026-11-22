// Flat tracker: read-only viewer for the Flats and Interest lists sheet tabs.
// No build step. All sheet values are treated as untrusted text and escaped.

const TZ = 'Europe/Zurich';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const FLAT_STATUS = {
  'inquired': 'Inquired',
  'viewing booked': 'Viewing booked',
  'applied': 'Applied',
  'waiting': 'Waiting',
  'interest list': 'Interest list',
  'closed': 'Closed',
};
const LIST_STATUS = {
  'registered': 'Registered',
  'waiting': 'Waiting',
  'renewal due': 'Renewal due',
  'closed': 'Closed',
};

// Fixture mode: add ?fixtures to the URL to use the fake example rows
// shipped in /fixtures instead of the live sheet.
const FIXTURES = new URLSearchParams(location.search).has('fixtures');
const SOURCES = FIXTURES
  ? { flats: 'fixtures/flats.csv', lists: 'fixtures/interest-lists.csv' }
  : { flats: 'api/flats', lists: 'api/interest-lists' };

const state = { flats: [], lists: [], loaded: false, error: null, tab: 'active' };
const app = document.getElementById('app');
const lightbox = document.getElementById('lightbox');

/* ---------- CSV ---------- */

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  text = text.replace(/^﻿/, '');
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvToObjects(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1)
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, idx) => [h, (r[idx] ?? '').trim()])));
}

/* ---------- Values ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function safeUrl(s) {
  try {
    const u = new URL(String(s).trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

function splitLinks(s) {
  return String(s ?? '').split(/[\n|]/).map((x) => x.trim()).map(safeUrl).filter(Boolean);
}

function hostLabel(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

function num(s) {
  if (s == null || String(s).trim() === '') return null;
  const n = Number(String(s).replace(/[’'\s,]/g, '').replace(/^CHF/i, ''));
  return Number.isFinite(n) ? n : null;
}

function chf(n) {
  const whole = Number.isInteger(n);
  return 'CHF ' + n.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

// Sheet dates are Europe/Zurich wall-clock strings: YYYY-MM-DD[ HH:MM[:SS]].
// They are normalised to sortable "YYYY-MM-DD HH:MM" strings and never converted to UTC.
function parseDT(s) {
  const m = String(s ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return { date: `${y}-${mo}-${d}`, time: h ? `${h.padStart(2, '0')}:${mi}` : null, y: +y, mo: +mo, d: +d };
}

const sortKey = (s) => { const p = parseDT(s); return p ? `${p.date} ${p.time ?? '00:00'}` : ''; };

function fmtDate(p) {
  const wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${p.d} ${MONTHS[p.mo - 1]} ${p.y}`;
}

function fmtDT(s) {
  const p = parseDT(s);
  if (!p) return String(s ?? '');
  return p.time ? `${fmtDate(p)}, ${p.time}` : fmtDate(p);
}

function zurichNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const isClosed = (f) => f.status.toLowerCase() === 'closed';
const statusLabel = (map, s) => map[s.toLowerCase()] ?? (s ? s[0].toUpperCase() + s.slice(1) : '');
const statusClass = (s) => 'badge s-' + s.toLowerCase().replace(/[^a-z]+/g, '-');

function badge(map, s) {
  return s ? `<span class="${statusClass(s)}">${esc(statusLabel(map, s))}</span>` : '';
}

function rentLines(f) {
  const gross = num(f.gross_rent), net = num(f.net_rent), nk = num(f.nebenkosten);
  return {
    gross: gross != null ? chf(gross) : null,
    split: net != null && nk != null ? `${chf(net)} + ${chf(nk)} NK` : null,
  };
}

/* ---------- Photos ---------- */

function driveId(url) {
  const u = new URL(url);
  if (!/(^|\.)(drive|docs)\.google\.com$|^lh3\.googleusercontent\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/\/file\/d\/([\w-]+)/) || u.pathname.match(/^\/d\/([\w-]+)/);
  if (m) return m[1].split('=')[0];
  return u.searchParams.get('id');
}

// Candidate image URLs for one photo link, tried in order on <img> error.
function photoCandidates(url) {
  const id = driveId(url);
  if (!id) return [url];
  const list = [
    `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w2000`,
    `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w2000`,
    `https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`,
  ];
  // Respect the stored URL if it is a direct image URL (not a /view page).
  if (!/\/file\/d\//.test(url) && !list.includes(url)) list.unshift(url);
  return [...new Set(list)];
}

function photoImg(url, cls = '') {
  const c = photoCandidates(url);
  return `<img class="${cls}" src="${esc(c[0])}" data-candidates="${esc(JSON.stringify(c))}" data-try="0" alt="" loading="lazy" decoding="async">`;
}

// Global error handler for photo fallbacks (error events do not bubble, so capture).
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.candidates) return;
  const c = JSON.parse(img.dataset.candidates);
  const next = +img.dataset.try + 1;
  if (next < c.length) {
    img.dataset.try = String(next);
    img.src = c[next];
    return;
  }
  // Every URL failed: treat as no photo.
  const holder = img.closest('[data-photo]');
  img.remove();
  if (holder) photoFailed(holder);
}, true);

function photoFailed(holder) {
  if (holder.matches('.card-photo')) { holder.classList.add('empty'); return; }
  if (holder.matches('.slide')) {
    const gallery = holder.closest('.gallery');
    holder.remove();
    if (gallery) updateGallery(gallery);
  }
}

/* ---------- Data ---------- */

async function fetchCSV(url) {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch {}
    throw new Error(`${url} returned ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return csvToObjects(await res.text());
}

async function load() {
  const btn = document.getElementById('refresh');
  btn.classList.add('spinning');
  btn.disabled = true;
  try {
    const [flats, lists] = await Promise.all([fetchCSV(SOURCES.flats), fetchCSV(SOURCES.lists)]);
    state.flats = flats.filter((f) => f.id);
    state.lists = lists.filter((l) => l.id);
    state.error = null;
  } catch (err) {
    state.error = err.message;
  }
  state.loaded = true;
  btn.classList.remove('spinning');
  btn.disabled = false;
  render();
}

/* ---------- Sorting ---------- */

function sortActive(flats) {
  const today = zurichNow().date;
  const group = (f) => {
    const v = parseDT(f.viewing_datetime);
    if (v && v.date >= today) return 0; // upcoming (or today's) viewing
    if (!v) return 1;                   // no viewing
    return 2;                           // past viewing, no new date
  };
  const desc = (a, b) => (a < b ? 1 : a > b ? -1 : 0);
  return [...flats].sort((a, b) => {
    const ga = group(a), gb = group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) return sortKey(a.viewing_datetime).localeCompare(sortKey(b.viewing_datetime));
    return desc(sortKey(a.date_contacted), sortKey(b.date_contacted))
      || desc(sortKey(a.last_updated), sortKey(b.last_updated));
  });
}

function sortClosed(flats) {
  return [...flats].sort((a, b) => sortKey(b.last_updated).localeCompare(sortKey(a.last_updated)));
}

function sortLists(lists) {
  return [...lists].sort((a, b) => {
    const da = a.status.toLowerCase() === 'renewal due' ? 0 : 1;
    const db = b.status.toLowerCase() === 'renewal due' ? 0 : 1;
    if (da !== db) return da - db;
    const ra = sortKey(a.renewal_date), rb = sortKey(b.renewal_date);
    if (ra !== rb) {
      if (!ra) return 1;
      if (!rb) return -1;
      return ra.localeCompare(rb);
    }
    return a.name.localeCompare(b.name);
  });
}

/* ---------- Next up ---------- */

function nextUp() {
  const today = zurichNow().date;
  const viewing = state.flats
    .filter((f) => !isClosed(f))
    .map((f) => ({ f, p: parseDT(f.viewing_datetime) }))
    .filter((x) => x.p && x.p.date >= today)
    .sort((a, b) => sortKey(a.f.viewing_datetime).localeCompare(sortKey(b.f.viewing_datetime)))[0];
  if (viewing) return { kind: 'flat', item: viewing.f };

  // Soonest renewal date: upcoming or overdue (overdue ones come first).
  const renewal = state.lists
    .filter((l) => l.status.toLowerCase() !== 'closed' && parseDT(l.renewal_date))
    .sort((a, b) => sortKey(a.renewal_date).localeCompare(sortKey(b.renewal_date)))[0];
  if (renewal) return { kind: 'list', item: renewal };
  return null;
}

function renderNextUp() {
  const n = nextUp();
  if (!n) return '';
  if (n.kind === 'flat') {
    const f = n.item;
    const map = safeUrl(f.map_link);
    return `
      <section class="nextup" aria-label="Next up">
        <a class="nextup-main" href="#/flat/${encodeURIComponent(f.id)}">
          <span class="nextup-label">Next up · Viewing</span>
          <span class="nextup-when">${esc(fmtDT(f.viewing_datetime))}</span>
          ${f.address ? `<span class="nextup-what">${esc(f.address)}</span>` : ''}
          ${f.doorbell ? `<span class="nextup-extra">Doorbell / meeting point: ${esc(f.doorbell)}</span>` : ''}
        </a>
        ${map ? `<a class="nextup-map" href="${esc(map)}" target="_blank" rel="noopener noreferrer">Map</a>` : ''}
      </section>`;
  }
  const l = n.item;
  const overdue = parseDT(l.renewal_date).date < zurichNow().date;
  const link = safeUrl(l.link);
  return `
    <section class="nextup" aria-label="Next up">
      <a class="nextup-main" href="#/list/${encodeURIComponent(l.id)}">
        <span class="nextup-label">Next up · Renewal${overdue ? ' (overdue)' : ''}</span>
        <span class="nextup-when">${esc(fmtDT(l.renewal_date))}</span>
        <span class="nextup-what">${esc(l.name || l.id)}</span>
      </a>
      ${link ? `<a class="nextup-map" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Link</a>` : ''}
    </section>`;
}

/* ---------- Home ---------- */

function flatCard(f) {
  const photo = splitLinks(f.photo_links)[0];
  const rent = rentLines(f);
  const start = parseDT(f.start_date);
  const facts = [
    f.rooms && `${esc(f.rooms)} rooms`,
    f.m2 && `${esc(f.m2)} m²`,
    rent.gross && esc(rent.gross),
  ].filter(Boolean);
  return `
    <a class="card" href="#/flat/${encodeURIComponent(f.id)}">
      <div class="card-photo${photo ? '' : ' empty'}" data-photo>${photo ? photoImg(photo) : ''}</div>
      <div class="card-body">
        <div class="card-top">${badge(FLAT_STATUS, f.status)}${f.area ? `<span class="area">${esc(f.area)}</span>` : ''}</div>
        <h3 class="card-title">${esc(f.address || f.id)}</h3>
        ${facts.length ? `<p class="card-facts">${facts.join('<span class="dot">·</span>')}</p>` : ''}
        ${start ? `<p class="card-meta">From ${esc(fmtDate(start))}</p>` : ''}
        ${isClosed(f) && f.closed_reason ? `<p class="card-meta reason">${esc(f.closed_reason)}</p>` : ''}
      </div>
    </a>`;
}

function listCard(l) {
  const renewal = parseDT(l.renewal_date);
  return `
    <a class="card card-list" href="#/list/${encodeURIComponent(l.id)}">
      <div class="card-body">
        <div class="card-top">${badge(LIST_STATUS, l.status)}${l.area ? `<span class="area">${esc(l.area)}</span>` : ''}</div>
        <h3 class="card-title">${esc(l.name || l.id)}</h3>
        ${renewal ? `<p class="card-meta">Renewal ${esc(fmtDate(renewal))}</p>` : ''}
        ${l.notes ? `<p class="card-notes">${esc(l.notes)}</p>` : ''}
      </div>
    </a>`;
}

function renderHome() {
  const active = sortActive(state.flats.filter((f) => !isClosed(f)));
  const closed = sortClosed(state.flats.filter(isClosed));
  const lists = sortLists(state.lists);
  const tabs = [
    ['active', 'Active', active.length],
    ['lists', 'Interest lists', lists.length],
    ['closed', 'Closed', closed.length],
  ];
  let body;
  if (state.tab === 'lists') body = lists.map(listCard).join('');
  else if (state.tab === 'closed') body = closed.map(flatCard).join('');
  else body = active.map(flatCard).join('');
  const empty = { active: 'No active flats.', lists: 'No interest lists.', closed: 'No closed flats.' }[state.tab];

  app.innerHTML = `
    ${renderNextUp()}
    <nav class="tabs" role="tablist">
      ${tabs.map(([key, label, n]) => `
        <a role="tab" href="#/${key}" class="tab${state.tab === key ? ' on' : ''}" aria-selected="${state.tab === key}">
          ${label} <span class="count">${n}</span>
        </a>`).join('')}
    </nav>
    <div class="cards">${body || `<p class="message">${empty}</p>`}</div>`;
}

/* ---------- Detail ---------- */

function factRows(rows) {
  const html = rows.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
  return html ? `<dl class="facts">${html}</dl>` : '';
}

function linkOrText(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  // Linkify emails and URLs inside contact text, escape everything else.
  return t.split(/(\s+|,|;)/).map((part) => {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) return `<a href="mailto:${esc(part)}">${esc(part)}</a>`;
    const u = /^https?:\/\//i.test(part) && safeUrl(part);
    if (u) return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(hostLabel(u))}</a>`;
    return esc(part);
  }).join('');
}

function section(title, inner) {
  return inner ? `<section class="block"><h2>${esc(title)}</h2>${inner}</section>` : '';
}

function textBlock(s) {
  return s ? `<p class="text">${esc(s)}</p>` : '';
}

function timeline(f) {
  const items = [];
  const add = (dt, label, text) => {
    const p = parseDT(dt);
    items.push({ key: p ? `${p.date} ${p.time ?? '00:00'}` : null, when: p ? fmtDT(dt) : '', label, text });
  };
  if (parseDT(f.date_contacted)) add(f.date_contacted, 'Contacted', '');
  if (f.last_reply) {
    const m = f.last_reply.match(/^(\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?)\s*[:\-–]?\s*(.*)$/s);
    if (m) add(m[1], 'Last reply', m[2]);
    else add('', 'Last reply', f.last_reply);
  }
  if (parseDT(f.viewing_datetime)) add(f.viewing_datetime, 'Viewing', f.doorbell ? `Doorbell / meeting point: ${f.doorbell}` : '');
  // Dated lines inside notes, e.g. "2026-11-18: inquiry sent. 2026-11-20: viewing confirmed."
  const re = /(\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?)\s*[:\-–]\s*([\s\S]*?)(?=\s*\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?\s*[:\-–]|$)/g;
  for (const m of (f.notes || '').matchAll(re)) add(m[1], 'Note', m[2].trim().replace(/[.;]\s*$/, ''));

  const dated = items.filter((i) => i.key).sort((a, b) => a.key.localeCompare(b.key));
  const undated = items.filter((i) => !i.key);
  if (f.next_step) undated.push({ when: '', label: 'Next step', text: f.next_step });
  const all = [...dated, ...undated];
  if (!all.length) return '';
  return `<ol class="timeline">${all.map((i) => `
    <li>
      <div class="tl-head">${i.when ? `<span class="tl-when">${esc(i.when)}</span>` : ''}<span class="tl-label">${esc(i.label)}</span></div>
      ${i.text ? `<div class="tl-text">${esc(i.text)}</div>` : ''}
    </li>`).join('')}</ol>`;
}

function gallery(photos) {
  if (!photos.length) return '';
  return `
    <div class="gallery" data-index="0">
      <div class="slides">
        ${photos.map((p, i) => `<button type="button" class="slide" data-photo data-src="${esc(p)}" aria-label="Enlarge photo ${i + 1}">${photoImg(p)}</button>`).join('')}
      </div>
      <button type="button" class="gnav prev" aria-label="Previous photo">‹</button>
      <button type="button" class="gnav next" aria-label="Next photo">›</button>
      <span class="gcount"></span>
    </div>`;
}

function updateGallery(g) {
  const slides = g.querySelectorAll('.slide');
  if (!slides.length) { g.remove(); return; }
  const track = g.querySelector('.slides');
  const idx = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  g.querySelector('.gcount').textContent = slides.length > 1 ? `${Math.min(idx + 1, slides.length)} / ${slides.length}` : '';
  g.querySelectorAll('.gnav').forEach((b) => { b.hidden = slides.length < 2; });
}

function wireGallery() {
  const g = app.querySelector('.gallery');
  if (!g) return;
  const track = g.querySelector('.slides');
  const step = (d) => track.scrollBy({ left: d * track.clientWidth, behavior: 'smooth' });
  g.querySelector('.prev').addEventListener('click', () => step(-1));
  g.querySelector('.next').addEventListener('click', () => step(1));
  track.addEventListener('scroll', () => updateGallery(g), { passive: true });
  track.addEventListener('click', (e) => {
    const slide = e.target.closest('.slide');
    if (!slide) return;
    const all = [...g.querySelectorAll('.slide')];
    openLightbox(all.map((s) => s.querySelector('img')?.currentSrc || s.querySelector('img')?.src).filter(Boolean), all.indexOf(slide));
  });
  updateGallery(g);
}

function openLightbox(srcs, index) {
  if (!srcs.length) return;
  let i = Math.max(0, index);
  const show = () => {
    lightbox.innerHTML = `
      <img src="${esc(srcs[i])}" alt="">
      <button type="button" class="lb-close" aria-label="Close">×</button>
      ${srcs.length > 1 ? `<button type="button" class="lb-prev" aria-label="Previous photo">‹</button>
      <button type="button" class="lb-next" aria-label="Next photo">›</button>
      <span class="lb-count">${i + 1} / ${srcs.length}</span>` : ''}`;
  };
  lightbox.onclick = (e) => {
    if (e.target.closest('.lb-prev')) { i = (i - 1 + srcs.length) % srcs.length; show(); }
    else if (e.target.closest('.lb-next')) { i = (i + 1) % srcs.length; show(); }
    else closeLightbox();
  };
  show();
  lightbox.hidden = false;
  document.body.classList.add('noscroll');
}

function closeLightbox() {
  lightbox.hidden = true;
  lightbox.innerHTML = '';
  document.body.classList.remove('noscroll');
}

document.addEventListener('keydown', (e) => {
  if (lightbox.hidden) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lightbox.querySelector('.lb-prev')?.click();
  if (e.key === 'ArrowRight') lightbox.querySelector('.lb-next')?.click();
});

function backLink(tab) {
  return `<a class="back" href="#/${tab}" data-back>‹ Back</a>`;
}

function renderFlat(f) {
  const rent = rentLines(f);
  const map = safeUrl(f.map_link);
  const start = parseDT(f.start_date);
  const links = splitLinks(f.listing_links);
  const tab = isClosed(f) ? 'closed' : 'active';

  const facts = factRows([
    ['Status', badge(FLAT_STATUS, f.status)],
    ['Closed reason', isClosed(f) ? esc(f.closed_reason) : ''],
    ['Area', esc(f.area)],
    ['Rooms', esc(f.rooms)],
    ['Size', f.m2 ? `${esc(f.m2)} m²` : ''],
    ['Rent', rent.gross ? `${esc(rent.gross)}${rent.split ? `<div class="sub">${esc(rent.split)}</div>` : ''}` : (rent.split ? esc(rent.split) : '')],
    ['Floor', esc(f.floor)],
    ['Available from', start ? esc(fmtDate(start)) : esc(f.start_date)],
    ['Source', esc(f.source)],
    ['Doorbell', esc(f.doorbell)],
    ['Last updated', f.last_updated ? esc(fmtDT(f.last_updated)) : ''],
  ]);

  const agent = factRows([
    ['Name', esc(f.agent_name)],
    ['Contact', linkOrText(f.agent_contact)],
  ]);

  const linkList = links.length
    ? `<ul class="links">${links.map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(hostLabel(u))}</a></li>`).join('')}</ul>`
    : '';

  app.innerHTML = `
    <article class="detail">
      ${backLink(tab)}
      ${gallery(splitLinks(f.photo_links))}
      <header class="detail-head">
        <h1>${esc(f.address || f.id)}</h1>
        ${map ? `<a class="maplink" href="${esc(map)}" target="_blank" rel="noopener noreferrer">Open in Maps</a>` : ''}
      </header>
      ${facts}
      ${section('Agent', agent)}
      ${section('Timeline', timeline(f))}
      ${section('Pros', textBlock(f.pros))}
      ${section('Cons', textBlock(f.cons))}
      ${section('Notes', textBlock(f.notes))}
      ${section('Listings', linkList)}
    </article>`;
  wireGallery();
}

function renderList(l) {
  const link = safeUrl(l.link);
  const reg = parseDT(l.date_registered);
  const ren = parseDT(l.renewal_date);
  const facts = factRows([
    ['Status', badge(LIST_STATUS, l.status)],
    ['Area', esc(l.area)],
    ['Registered', reg ? esc(fmtDate(reg)) : esc(l.date_registered)],
    ['Renewal', ren ? esc(fmtDate(ren)) : esc(l.renewal_date)],
    ['Link', link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(hostLabel(link))}</a>` : ''],
    ['Last updated', l.last_updated ? esc(fmtDT(l.last_updated)) : ''],
  ]);
  app.innerHTML = `
    <article class="detail">
      ${backLink('lists')}
      <header class="detail-head"><h1>${esc(l.name || l.id)}</h1></header>
      ${facts}
      ${section('Notes', textBlock(l.notes))}
    </article>`;
}

/* ---------- Routing ---------- */

let cameFromHome = false;

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { view: parts[0] || 'active', id: parts[1] };
}

function render() {
  closeLightbox();
  if (!state.loaded) return;
  if (state.error) {
    app.innerHTML = `<div class="message error"><p>Could not load the sheet.</p><p class="small">${esc(state.error)}</p><button type="button" class="retry">Try again</button></div>`;
    app.querySelector('.retry').addEventListener('click', load);
    return;
  }
  const { view, id } = route();
  if (view === 'flat' || view === 'list') {
    const item = (view === 'flat' ? state.flats : state.lists).find((x) => x.id === id);
    if (!item) {
      app.innerHTML = `<div class="message">${backLink('active')}<p>Not found.</p></div>`;
      return;
    }
    view === 'flat' ? renderFlat(item) : renderList(item);
    window.scrollTo(0, 0);
    return;
  }
  state.tab = ['active', 'lists', 'closed'].includes(view) ? view : 'active';
  renderHome();
}

window.addEventListener('hashchange', () => {
  const { view } = route();
  render();
  cameFromHome = view !== 'flat' && view !== 'list' ? true : cameFromHome;
});

// "Back" returns to the previous list position when we navigated from it.
app.addEventListener('click', (e) => {
  const back = e.target.closest('[data-back]');
  if (back && cameFromHome && history.length > 1) {
    e.preventDefault();
    history.back();
  }
});

document.getElementById('refresh').addEventListener('click', load);

cameFromHome = !['flat', 'list'].includes(route().view);
load();
