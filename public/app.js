/* CPSK Job Fair 2569 – interactive booth map
   Reads data.csv (same folder) and draws the floor plan as SVG. No dependencies. */
(() => {
  'use strict';

  const DATA_URL = 'data.csv';
  const BOOTH_W = 90, BOOTH_H = 42;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* Booth centres on the plan (same coordinates as the official floor plan image) */
  const LAYOUT = (() => {
    const pos = {};
    const xL = [456, 558, 660, 762];
    [28, 27, 26, 25].forEach((b, i) => { pos[b] = [xL[i], 92]; });
    [32, 31, 30, 29].forEach((b, i) => { pos[b] = [xL[i], 258]; });
    [35, 34, 33].forEach((b, i) => { pos[b] = [[528, 630, 732][i], 433]; });
    const xR = [1001, 1103, 1205, 1307, 1410, 1512];
    [[92, [6, 5, 4, 3, 2, 1]], [236, [12, 11, 10, 9, 8, 7]],
     [296, [18, 17, 16, 15, 14, 13]], [450, [24, 23, 22, 21, 20, 19]]]
      .forEach(([y, row]) => row.forEach((b, i) => { pos[b] = [xR[i], y]; }));
    return pos;
  })();
  const BOOTH_NUMBERS = Object.keys(LAYOUT).map(Number).sort((a, b) => a - b);

  const TYPE_DEFS = [
    { key: 'intern', th: 'ฝึกงาน', en: 'Internship', re: /internship|ฝึกงาน/i },
    { key: 'coop', th: 'สหกิจศึกษา', en: 'Co-op', re: /co-?op|สหกิจ/i },
    { key: 'full', th: 'งานประจำ', en: 'Full-time', re: /full-?time|งานประจำ/i },
  ];
  const YEAR_DEFS = [
    { key: 'y1', label: 'ปี 1', re: /ชั้นปีที่\s*1|1st/i },
    { key: 'y2', label: 'ปี 2', re: /ชั้นปีที่\s*2|2nd/i },
    { key: 'y3', label: 'ปี 3', re: /ชั้นปีที่\s*3|3rd/i },
    { key: 'y4', label: 'ปี 4', re: /ชั้นปีที่\s*4|4th/i },
    { key: 'grad', label: 'จบใหม่', re: /จบใหม่|new grad/i },
  ];
  const ANY_YEAR = /ไม่จำกัด|any year/i;

  const $ = (sel, root = document) => root.querySelector(sel);
  const els = {
    map: $('#map'), frame: $('#map-frame'), panel: $('#panel'), panelEmpty: $('#panel-empty'),
    panelBody: $('#panel-body'), scrim: $('#scrim'), tip: $('#tip'),
    dirList: $('#dir-list'), dirCount: $('#dir-count'),
    filterCount: $('#filter-count'), filterReset: $('#filter-reset'),
    search: $('#search'), input: $('#search-input'), list: $('#search-list'), clear: $('.search__clear'),
  };
  const mobileQuery = window.matchMedia('(max-width: 1080px)');

  const state = { booths: new Map(), selected: null, filters: { type: new Set(), year: new Set() } };

  /* ---------- helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim() !== ''));
  }

  /* split on commas / new lines, but not inside brackets: "Dev (Intern, Full-time), QA" */
  function splitTop(s) {
    const out = []; let cur = '', depth = 0;
    for (const ch of s) {
      if (ch === '(' || ch === '[') depth++;
      if ((ch === ')' || ch === ']') && depth) depth--;
      if ((ch === ',' || ch === '\n') && depth === 0) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim()).filter((x) => x && x !== '-');
  }

  function findColumns(header) {
    const want = {
      booth: /booth|บูธ/i, en: /\(english\)|\(อังกฤษ\)/i, th: /\(thai\)|\(ไทย\)/i,
      link: /link|ลิงก์/i,
      types: /employment|ประเภทการจ้างงาน/i, years: /year of study|ชั้นปี/i,
      positions: /positions|ตำแหน่ง/i, req: /requirements|คุณสมบัติ/i,
    };
    const cols = {}; const used = new Set();
    for (const [k, re] of Object.entries(want)) {
      const i = header.findIndex((h, idx) => !used.has(idx) && re.test(h));
      if (i >= 0) { cols[k] = i; used.add(i); }
    }
    return cols;
  }

  function buildBooth(r, c) {
    const get = (k) => (c[k] === undefined ? '' : (r[c[k]] || '').trim());
    const typesRaw = get('types'), yearsRaw = get('years'), posRaw = get('positions'), req = get('req');
    const linkRaw = get('link');
    let link = '';
    try { const u = new URL(linkRaw); if (u.protocol === 'https:' || u.protocol === 'http:') link = u.href; } catch (_) { /* not a URL */ }
    const typeKeys = new Set(); const otherTypes = [];
    splitTop(typesRaw).forEach((p) => {
      const d = TYPE_DEFS.find((t) => t.re.test(p));
      if (d) typeKeys.add(d.key); else otherTypes.push(p);
    });
    const any = ANY_YEAR.test(yearsRaw);
    const years = new Set(YEAR_DEFS.filter((y) => any || y.re.test(yearsRaw)).map((y) => y.key));
    return {
      n: parseInt(get('booth'), 10), th: get('th'), en: get('en') || get('th'),
      typeKeys, otherTypes, years, anyYear: any, positions: splitTop(posRaw), req, link,
      hasData: Boolean(typesRaw || yearsRaw || posRaw || req || link),
    };
  }

  /* ---------- plan (SVG) ---------- */
  function drawPlan() {
    const arrow = (x, y, dir) => {          // block arrow, tip at (x, y)
      const shapes = {
        right: `M${x} ${y} l-46 -36 v22 h-58 v28 h58 v22 z`,
        left: `M${x} ${y} l46 -36 v22 h58 v28 h-58 v22 z`,
        up: `M${x} ${y} l-30 38 h17 v44 h26 v-44 h17 z`,
      };
      return `<path class="plan-arrow" d="${shapes[dir]}"/>`;
    };
    const booths = BOOTH_NUMBERS.map((n, i) => {
      const [cx, cy] = LAYOUT[n]; const x = cx - BOOTH_W / 2, y = cy - BOOTH_H / 2;
      const rx = 66, ry = 37;
      return `<g class="booth" data-booth="${n}" style="--i:${i}" tabindex="0" role="button">
        <rect class="booth-hl" x="${x - 16}" y="${y - 12}" width="${BOOTH_W + 32}" height="${BOOTH_H + 24}" rx="4"/>
        <path class="booth-ring" pathLength="1" transform="rotate(-4 ${cx} ${cy})"
              d="M${cx - rx} ${cy + 2} a${rx} ${ry} 0 1 0 ${rx * 2} 0 a${rx} ${ry} 0 1 0 ${-rx * 2} 0 l6 -8"/>
        <g class="booth-lift">
          <rect class="booth-hit" x="${x - 6}" y="${y - 8}" width="${BOOTH_W + 12}" height="${BOOTH_H + 16}"/>
          <rect class="booth-body" x="${x}" y="${y}" width="${BOOTH_W}" height="${BOOTH_H}" rx="5"/>
          <text class="booth-num" x="${cx}" y="${cy + 9}" text-anchor="middle">${n}</text>
        </g>
      </g>`;
    }).join('');

    els.map.innerHTML = `
    <svg viewBox="20 24 1800 776" xmlns="${SVG_NS}" aria-hidden="false">
      <defs>
        <pattern id="hatch" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="18" stroke="#C9D2CF" stroke-width="3"/>
        </pattern>
      </defs>
      <g aria-hidden="true">
        <path class="plan-wall" pathLength="1" d="M140 172 V42 H835 V462"/>
        <path class="plan-wall" pathLength="1" d="M140 268 V800"/>
        <g class="plan-fade">
          <rect class="plan-bldg" x="412" y="462" width="423" height="238"/>
          <text class="plan-bldg-label" x="623" y="598" text-anchor="middle">อาคาร 15</text>
          <rect class="plan-bldg" x="412" y="744" width="423" height="70"/>
          <g class="plan-icon" transform="translate(770 704)">
            <circle cx="10" cy="5" r="4"/><path d="M4 32 V16 h12 v16 M10 16 v16"/>
            <circle cx="34" cy="5" r="4"/><path d="M27 26 l4 -10 h6 l4 10 M31 26 v6 M37 26 v6"/>
          </g>
          <rect class="plan-desk" x="362" y="462" width="30" height="86" rx="3"/>
          <text class="plan-label" x="350" y="512" text-anchor="end">Reception</text>
          <circle class="plan-table" cx="513" cy="318" r="27"/>
          <circle class="plan-table" cx="706" cy="318" r="27"/>
          ${arrow(134, 220, 'right')}
          <g class="plan-icon" transform="translate(52 120)">
            <rect x="8" y="12" width="40" height="30" rx="3"/><path d="M8 22 h40 M28 12 v10"/>
          </g>
          <text class="plan-label plan-label--strong" x="78" y="292" text-anchor="middle">Drop Off</text>
          ${arrow(278, 708, 'up')}
          <text class="plan-label plan-label--strong" x="320" y="770">ทางเข้า</text>
          ${arrow(1680, 255, 'left')}
          <text class="plan-label plan-label--strong" x="1740" y="322" text-anchor="middle">ทางเข้าจาก</text>
          <text class="plan-label plan-label--strong" x="1740" y="354" text-anchor="middle">โรงอาหาร</text>
          <rect class="plan-hatch-box" x="850" y="530" width="922" height="56"/>
        </g>
      </g>
      ${booths}
    </svg>`;

    els.map.querySelectorAll('.booth').forEach((g) => {
      const n = Number(g.dataset.booth);
      g.addEventListener('click', () => select(n, { from: 'map' }));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(n, { from: 'map' }); }
      });
      g.addEventListener('pointerenter', () => showTip(g, n));
      g.addEventListener('pointerleave', hideTip);
      g.addEventListener('focus', () => showTip(g, n));
      g.addEventListener('blur', hideTip);
    });
  }

  function labelBooths() {
    els.map.querySelectorAll('.booth').forEach((g) => {
      const b = state.booths.get(Number(g.dataset.booth));
      g.setAttribute('aria-label', b ? `บูธ ${b.n} ${b.en}` : `บูธ ${g.dataset.booth} ยังไม่มีบริษัท`);
    });
  }

  function playEntrance() {
    els.map.classList.add('is-drawing');
    const last = els.map.querySelector(`.booth[data-booth="${BOOTH_NUMBERS[BOOTH_NUMBERS.length - 1]}"]`);
    last && last.addEventListener('animationend', () => els.map.classList.remove('is-drawing'), { once: true });
    setTimeout(() => els.map.classList.remove('is-drawing'), 3000);
  }

  /* ---------- zone switcher for narrow screens ---------- */
  const VB_X = 20, VB_W = 1800;
  const ZONES = { indoor: 432, outdoor: 1345 };   // centre of each side, in plan units
  const zonesEl = $('#zones');
  function planToPx(x) { const svg = els.map.querySelector('svg'); return svg ? (x - VB_X) / VB_W * svg.getBoundingClientRect().width + els.map.offsetLeft : 0; }
  function syncZones() {
    const overflow = els.frame.scrollWidth > els.frame.clientWidth + 4;
    zonesEl.hidden = !overflow;
    if (!overflow) return;
    const centre = els.frame.scrollLeft + els.frame.clientWidth / 2;
    const mid = (planToPx(ZONES.indoor) + planToPx(ZONES.outdoor)) / 2;
    zonesEl.querySelectorAll('.zone').forEach((z) =>
      z.setAttribute('aria-pressed', String((centre < mid) === (z.dataset.zone === 'indoor'))));
  }
  zonesEl.addEventListener('click', (e) => {
    const z = e.target.closest('.zone'); if (!z) return;
    els.frame.scrollTo({ left: planToPx(ZONES[z.dataset.zone]) - els.frame.clientWidth / 2, behavior: 'smooth' });
  });
  els.frame.addEventListener('scroll', () => requestAnimationFrame(syncZones), { passive: true });
  window.addEventListener('resize', syncZones);

  /* ---------- tooltip ---------- */
  function showTip(g, n) {
    if (n === state.selected) return;   // keep the highlighter mark clear
    if (window.matchMedia('(hover: none)').matches && document.activeElement !== g) return;
    const b = state.booths.get(n);
    const r = g.querySelector('.booth-body').getBoundingClientRect();
    els.tip.innerHTML = b ? `<strong>บูธ ${n} ${esc(b.en)}</strong><span>${esc(b.th)}</span>` : `<strong>บูธ ${n}</strong>`;
    els.tip.style.left = `${r.left + r.width / 2}px`;
    els.tip.style.top = `${r.top}px`;
    els.tip.hidden = false;
  }
  function hideTip() { els.tip.hidden = true; }
  window.addEventListener('scroll', hideTip, { passive: true });
  els.frame.addEventListener('scroll', hideTip, { passive: true });

  /* ---------- filters ---------- */
  function matches(b) {
    const { type, year } = state.filters;
    if (type.size && ![...type].some((k) => b.typeKeys.has(k))) return false;
    if (year.size && ![...year].some((k) => b.years.has(k))) return false;
    return true;
  }
  function applyFilters() {
    const active = state.filters.type.size + state.filters.year.size > 0;
    let count = 0;
    BOOTH_NUMBERS.forEach((n) => {
      const b = state.booths.get(n);
      const ok = !active || (b && matches(b));
      if (ok && b) count++;
      els.map.querySelector(`.booth[data-booth="${n}"]`)?.classList.toggle('is-dim', !ok);
      els.dirList.querySelector(`[data-booth="${n}"]`)?.classList.toggle('is-dim', !ok);
    });
    els.filterCount.textContent = active
      ? `ตรงเงื่อนไข ${count} จาก ${state.booths.size} บูธ`
      : `ทั้งหมด ${state.booths.size} บูธ`;
    els.filterReset.hidden = !active;
  }
  document.querySelectorAll('.chip[data-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const set = state.filters[chip.dataset.filter];
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(on));
      on ? set.add(chip.dataset.value) : set.delete(chip.dataset.value);
      applyFilters();
    });
  });
  els.filterReset.addEventListener('click', () => {
    state.filters.type.clear(); state.filters.year.clear();
    document.querySelectorAll('.chip[data-filter]').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    applyFilters();
  });

  /* ---------- directory ---------- */
  function typeSummary(b) {
    const t = TYPE_DEFS.filter((d) => b.typeKeys.has(d.key)).map((d) => d.th).concat(b.otherTypes);
    return t.length ? t.join(', ') : 'ยังไม่มีรายละเอียด';
  }
  function renderDirectory() {
    els.dirList.innerHTML = BOOTH_NUMBERS.filter((n) => state.booths.has(n)).map((n) => {
      const b = state.booths.get(n);
      return `<li><button class="dir-item" type="button" data-booth="${n}">
        <span class="tile" aria-hidden="true">${n}</span>
        <span><span class="dir-item__en">${esc(b.en)}</span>
        <span class="dir-item__th">${esc(b.th)}</span>
        <span class="dir-item__types">${esc(typeSummary(b))}</span></span>
        <span class="visually-hidden">บูธ ${n}</span>
      </button></li>`;
    }).join('');
    els.dirCount.textContent = `${state.booths.size} บูธ`;
    els.dirList.addEventListener('click', (e) => {
      const btn = e.target.closest('.dir-item');
      if (btn) select(Number(btn.dataset.booth), { from: 'list' });
    });
  }

  /* ---------- detail panel ---------- */
  function formatPosition(p) {
    return esc(p).replace(/\(([^)]*)\)/g, '<span class="pos-note">($1)</span>');
  }
  function formatRequirements(text) {
    const lines = text.split('\n'); let html = ''; let gap = false;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { if (!gap && html) html += '<div class="req-gap"></div>'; gap = true; continue; }
      gap = false;
      const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (/^\s*[-–—_=]{6,}\s*$/.test(line)) { html += '<hr>'; continue; }
      if (/^\s*\d+(\.\d+)+\s+\S/.test(line)) { html += `<p class="req-head">${inline(line.trim())}</p>`; continue; }
      const m = line.match(/^(\s*)([-•*]|\d+[.)])\s+(.*)$/);
      if (m) {
        const lvl = Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
        const marker = /\d/.test(m[2]) ? m[2] : '•';
        html += `<p class="req-li" style="--lvl:${lvl}" data-marker="${esc(marker)}">${inline(m[3])}</p>`;
        continue;
      }
      html += `<p>${inline(line.trim())}</p>`;
    }
    return html;
  }

  function renderPanel(b) {
    const types = TYPE_DEFS.filter((d) => b.typeKeys.has(d.key))
      .map((d) => `<li class="type">${d.th}<small>${d.en}</small></li>`)
      .concat(b.otherTypes.map((t) => `<li class="type type--other">${esc(t)}</li>`)).join('');
    const years = YEAR_DEFS.map((y) => `<li class="year${b.years.has(y.key) ? ' is-on' : ''}">${y.label}</li>`).join('');
    const yearsLabel = YEAR_DEFS.filter((y) => b.years.has(y.key)).map((y) => y.label).join(', ');

    const blocks = b.hasData ? `
      ${types ? `<section class="block"><h3 class="block__title">${icon('i-briefcase')}รูปแบบงาน</h3><ul class="types">${types}</ul></section>` : ''}
      ${b.years.size ? `<section class="block"><h3 class="block__title">${icon('i-cap')}ชั้นปีที่รับ</h3>
        <ul class="years" aria-label="เปิดรับ ${esc(b.anyYear ? 'ไม่จำกัดชั้นปี' : yearsLabel)}">${years}</ul>
        ${b.anyYear ? '<p class="years__note">ไม่จำกัดชั้นปี</p>' : ''}</section>` : ''}
      ${b.positions.length ? `<section class="block"><h3 class="block__title">${icon('i-list')}ตำแหน่งที่เปิดรับ</h3>
        <ul class="positions">${b.positions.map((p) => `<li>${formatPosition(p)}</li>`).join('')}</ul></section>` : ''}
      ${b.req ? `<section class="block"><h3 class="block__title">${icon('i-check')}คุณสมบัติที่ต้องการ</h3>
        <div class="req">${formatRequirements(b.req)}</div></section>` : ''}`
      : `<div class="nodata">${icon('i-chat')}<div><p>บริษัทนี้ยังไม่ได้ส่งรายละเอียดตำแหน่งงาน</p><p>แวะไปคุยกับทีมงานที่บูธได้เลย</p></div></div>`;

    els.panelBody.innerHTML = `
      <article class="sign is-entering">
        <div class="sign__bar">
          <p class="sign__booth">บูธ ${b.n}</p>
          <button class="sign__btn" type="button" data-step="-1" aria-label="บูธก่อนหน้า">${icon('i-left')}</button>
          <button class="sign__btn" type="button" data-step="1" aria-label="บูธถัดไป">${icon('i-right')}</button>
          <button class="sign__btn sign__close" type="button" aria-label="ปิดรายละเอียด">${icon('i-x')}</button>
        </div>
        <div class="sign__content">
          <h2 class="sign__en">${esc(b.en)}</h2>
          <p class="sign__th">${esc(b.th)}</p>
          ${b.link ? `<a class="joblink" href="${esc(b.link)}" target="_blank" rel="noopener noreferrer">
            <span class="joblink__text">ดูรายละเอียดตำแหน่งงาน<small>${esc(new URL(b.link).hostname.replace(/^www\./, ''))}</small></span>
            ${icon('i-external')}<span class="visually-hidden">(เปิดในแท็บใหม่)</span></a>` : ''}
          ${blocks}
        </div>
      </article>`;
    els.panelEmpty.hidden = true;
    els.panelBody.hidden = false;
    els.panel.scrollTop = 0;
    const sign = els.panelBody.querySelector('.sign');
    setTimeout(() => sign && sign.classList.remove('is-entering'), 700);
  }

  els.panelBody.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      const list = BOOTH_NUMBERS.filter((n) => state.booths.has(n));
      const i = list.indexOf(state.selected);
      const next = list[(i + Number(step.dataset.step) + list.length) % list.length];
      select(next, { from: 'step' });
      return;
    }
    if (e.target.closest('.sign__close')) closeSheet();
  });

  /* ---------- selection ---------- */
  function select(n, { from = '', updateHash = true } = {}) {
    const b = state.booths.get(n);
    if (!b) return;
    state.selected = n;
    els.map.querySelectorAll('.booth.is-selected').forEach((g) => g.classList.remove('is-selected'));
    const g = els.map.querySelector(`.booth[data-booth="${n}"]`);
    if (g) {
      g.classList.remove('is-selected'); void g.getBoundingClientRect(); g.classList.add('is-selected');
      g.parentNode.appendChild(g);     // draw on top of neighbours
    }
    els.dirList.querySelectorAll('.dir-item.is-selected').forEach((x) => x.classList.remove('is-selected'));
    els.dirList.querySelector(`.dir-item[data-booth="${n}"]`)?.classList.add('is-selected');
    renderPanel(b);
    hideTip();
    if (updateHash) history.replaceState(null, '', `#booth-${n}`);

    if (from !== 'map') scrollBoothIntoView(g);
    if (mobileQuery.matches) openSheet();
  }

  function scrollBoothIntoView(g) {
    if (!g) return;
    const fr = els.frame.getBoundingClientRect(), r = g.getBoundingClientRect();
    if (els.frame.scrollWidth > els.frame.clientWidth) {
      els.frame.scrollTo({ left: els.frame.scrollLeft + (r.left + r.width / 2) - (fr.left + fr.width / 2), behavior: 'smooth' });
    }
    if (!mobileQuery.matches && (fr.top < 0 || fr.bottom > window.innerHeight)) {
      els.frame.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /* mobile bottom sheet */
  let lastFocus = null;
  function openSheet() {
    if (els.panel.classList.contains('is-open')) return;
    lastFocus = document.activeElement;
    els.scrim.hidden = false;
    requestAnimationFrame(() => { els.scrim.classList.add('is-open'); els.panel.classList.add('is-open'); });
    document.body.style.overflow = 'hidden';
    setTimeout(() => els.panelBody.querySelector('.sign__close')?.focus({ preventScroll: true }), 320);
  }
  function closeSheet() {
    if (!els.panel.classList.contains('is-open')) return;
    els.panel.classList.remove('is-open'); els.scrim.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => { els.scrim.hidden = true; }, 300);
    lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true });
  }
  els.scrim.addEventListener('click', closeSheet);
  mobileQuery.addEventListener('change', () => { if (!mobileQuery.matches) closeSheet(); });

  /* ---------- search ---------- */
  let results = [], active = -1;
  function search(qRaw) {
    const q = qRaw.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    const isNum = /^\d+$/.test(q);
    state.booths.forEach((b) => {
      let score = 0, why = '';
      if (isNum && String(b.n) === q) score = 100;
      else if (isNum && String(b.n).startsWith(q)) score = 80;
      const en = b.en.toLowerCase(), th = b.th.toLowerCase();
      if (!score && (en.startsWith(q) || th.startsWith(q))) score = 70;
      if (!score && (en.includes(q) || th.includes(q) || th.replace(/^บริษัท\s*/, '').startsWith(q))) score = 60;
      if (!score && q.length >= 2) {
        const hit = b.positions.find((p) => p.toLowerCase().includes(q));
        if (hit) { score = 40; why = hit; }
      }
      if (score) out.push({ b, score, why });
    });
    return out.sort((a, z) => z.score - a.score || a.b.n - z.b.n).slice(0, 8);
  }
  function highlightText(text, q) {
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0 || !q) return esc(text);
    return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
  }
  function renderResults() {
    const q = els.input.value.trim();
    els.clear.hidden = !els.input.value;
    if (!q) { closeList(); return; }
    results = search(q); active = results.length ? 0 : -1;
    els.list.innerHTML = results.length
      ? results.map(({ b, why }, i) => `
        <li class="search__opt" role="option" id="opt-${b.n}" data-booth="${b.n}" aria-selected="${i === active}">
          <span class="tile" aria-hidden="true">${b.n}</span>
          <span><span class="search__opt-name">${highlightText(b.en, q)}</span>
          <span class="search__opt-sub" style="display:block">${why ? `ตำแหน่ง ${highlightText(why, q)}` : highlightText(b.th, q)}</span></span>
        </li>`).join('')
      : `<li class="search__empty" role="presentation">ไม่พบบูธที่ตรงกับ “${esc(q)}” ลองค้นด้วยเลขบูธ ชื่อภาษาอังกฤษ หรือชื่อตำแหน่ง</li>`;
    els.list.hidden = false;
    els.input.setAttribute('aria-expanded', 'true');
    els.input.setAttribute('aria-activedescendant', active >= 0 ? `opt-${results[active].b.n}` : '');
  }
  function setActive(i) {
    if (!results.length) return;
    active = (i + results.length) % results.length;
    els.list.querySelectorAll('.search__opt').forEach((o, idx) => o.setAttribute('aria-selected', String(idx === active)));
    const opt = els.list.querySelector(`#opt-${results[active].b.n}`);
    opt && opt.scrollIntoView({ block: 'nearest' });
    els.input.setAttribute('aria-activedescendant', opt ? opt.id : '');
  }
  function closeList() {
    els.list.hidden = true; els.input.setAttribute('aria-expanded', 'false'); els.input.removeAttribute('aria-activedescendant');
  }
  function choose(n) {
    closeList(); els.input.value = ''; els.clear.hidden = true; els.input.blur();
    select(n, { from: 'search' });
  }
  els.input.addEventListener('input', renderResults);
  els.input.addEventListener('focus', () => { if (els.input.value.trim()) renderResults(); });
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (els.list.hidden) renderResults(); else setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { if (active >= 0 && results[active]) { e.preventDefault(); choose(results[active].b.n); } }
    else if (e.key === 'Escape') { if (!els.list.hidden) { e.stopPropagation(); closeList(); } }
  });
  els.list.addEventListener('mousedown', (e) => e.preventDefault());
  els.list.addEventListener('click', (e) => {
    const opt = e.target.closest('.search__opt');
    if (opt) choose(Number(opt.dataset.booth));
  });
  els.clear.addEventListener('click', () => { els.input.value = ''; renderResults(); els.input.focus(); });
  document.addEventListener('click', (e) => { if (!els.search.contains(e.target)) closeList(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
    if (e.key === '/' && document.activeElement !== els.input && !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault(); els.input.focus();
    }
  });

  /* ---------- deep links: #booth-22 or #22 ---------- */
  function boothFromHash() {
    const m = location.hash.match(/^#(?:booth-)?(\d+)$/);
    return m ? Number(m[1]) : null;
  }
  window.addEventListener('hashchange', () => { const n = boothFromHash(); if (n) select(n, { from: 'hash', updateHash: false }); });

  /* ---------- boot ---------- */
  async function init() {
    drawPlan();
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = parseCSV(await res.text());
      const cols = findColumns(rows[0] || []);
      if (cols.booth === undefined) throw new Error('ไม่พบคอลัมน์หมายเลขบูธ');
      rows.slice(1).map((r) => buildBooth(r, cols))
        .filter((b) => Number.isInteger(b.n) && LAYOUT[b.n])
        .forEach((b) => state.booths.set(b.n, b));
    } catch (err) {
      console.error(err);
      els.map.insertAdjacentHTML('afterend',
        `<div class="load-error">${icon('i-alert')}<p>โหลดข้อมูลบูธไม่สำเร็จ ตรวจสอบว่ามีไฟล์ data.csv อยู่ในโฟลเดอร์ public แล้วรีเฟรชหน้านี้อีกครั้ง</p></div>`);
    }
    labelBooths();
    syncZones();
    renderDirectory();
    applyFilters();
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (_) { /* ignore */ } }
    playEntrance();
    const n = boothFromHash();
    if (n && state.booths.has(n)) setTimeout(() => select(n, { from: 'hash', updateHash: false }), 900);
  }
  init();
})();
