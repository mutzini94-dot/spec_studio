// 보기 도구: 눈금자 · 안내선 · 정렬 보기(슬라이드 정렬) · 프레임 메모 막대
import * as Ed from './editor.js';
import { renderFrame, fitText } from './render.js';
import { LAYOUT_INFO } from './templates.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RULER = 18;

export function init(E) {
  // 눈금자에서 끌어내면 안내선 (위쪽 = 가로 안내선, 왼쪽 = 세로 안내선)
  $('#ruler-top').addEventListener('pointerdown', (e) => newGuide(E, e, 'h'));
  $('#ruler-left').addEventListener('pointerdown', (e) => newGuide(E, e, 'v'));
  const nb = $('#notes-bar');
  nb.querySelector('.nb-head').addEventListener('click', () => {
    nb.classList.toggle('open');
    try { localStorage.setItem('tnspec:notes', nb.classList.contains('open') ? '1' : '0'); } catch (err) { /* 무시 */ }
    renderNotes(E);
  });
  try { if (localStorage.getItem('tnspec:notes') === '1') nb.classList.add('open'); } catch (err) { /* 무시 */ }
  const ta = nb.querySelector('textarea');
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  ta.addEventListener('change', () => {
    const f = E.idx && E.idx.get(ta.dataset.fid);
    if (f && (f.notes || '') !== ta.value) Ed.commit([{ op: 'set', id: f.id, key: 'notes', value: ta.value || undefined }], '프레임 메모');
  });
}

// ---------- 프레임 메모 ----------
export function renderNotes(E) {
  const nb = $('#notes-bar');
  if (!nb || !E.doc) return;
  const f = E.activeFrame && E.idx.get(E.activeFrame);
  const ok = f && f.kind === 'frame' && !E.compId;
  nb.classList.toggle('hidden', !ok);
  if (!ok) return;
  nb.querySelector('.nb-title').textContent = `📝 프레임 메모 · ${f.name}${f.notes ? '' : ' (비어 있음)'}`;
  const ta = nb.querySelector('textarea');
  if (document.activeElement !== ta || ta.dataset.fid !== f.id) { ta.value = f.notes || ''; ta.dataset.fid = f.id; }
}

// ---------- 눈금자 ----------
export function drawRulers(E) {
  const center = $('#center');
  if (!center || !E.doc) return;
  const on = !!E.doc.settings.rulers && E.view === 'canvas';
  center.classList.toggle('with-rulers', on);
  if (!on) return;
  const fid = E.compId || E.activeFrame;
  const fr = fid && document.querySelector(`#world .fwrap[data-fw="${fid}"] .frame`);
  const cr = center.getBoundingClientRect();
  const z = E.zoom;
  const ox = fr ? fr.getBoundingClientRect().left - cr.left - RULER : 0;
  const oy = fr ? fr.getBoundingClientRect().top - cr.top - RULER : 0;
  const fw = fr ? fr.offsetWidth : 960, fh = fr ? fr.offsetHeight : 540;
  const step = [2, 5, 10, 20, 50, 100, 200, 500].find((s) => s * z >= 46) || 500;
  const draw = (cv, horiz) => {
    const dpr = window.devicePixelRatio || 1;
    const W = horiz ? cr.width - RULER : RULER, H = horiz ? RULER : cr.height - RULER;
    cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = '#2b2d31'; g.fillRect(0, 0, W, H);
    const o = horiz ? ox : oy, len = horiz ? fw : fh;
    // 프레임 범위는 밝게
    g.fillStyle = '#3a3d44';
    if (horiz) g.fillRect(o, 0, len * z, H); else g.fillRect(0, o, W, len * z);
    g.strokeStyle = '#7d828c'; g.fillStyle = '#a5aab3'; g.font = '9px sans-serif'; g.lineWidth = 1;
    const from = Math.floor(-o / z / step) * step, to = Math.ceil(((horiz ? W : H) - o) / z / step) * step;
    for (let v = from; v <= to; v += step / 5) {
      const p = Math.round(o + v * z) + .5;
      const major = Math.abs(v % step) < 1e-6;
      const L = major ? 8 : 4;
      g.beginPath();
      if (horiz) { g.moveTo(p, H); g.lineTo(p, H - L); } else { g.moveTo(W, p); g.lineTo(W - L, p); }
      g.stroke();
      if (major) {
        if (horiz) g.fillText(String(Math.round(v)), p + 2, 9);
        else { g.save(); g.translate(9, p + 2); g.rotate(-Math.PI / 2); g.textAlign = 'right'; g.fillText(String(Math.round(v)), 0, 0); g.restore(); }
      }
    }
    // 선택 범위 표시
    if (E.sel.length && fr) {
      const b = Ed.nodeBox ? (() => { try { return E.sel.map(Ed.nodeBox).reduce((a, c) => ({ x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), x2: Math.max(a.x2, c.x + c.w), y2: Math.max(a.y2, c.y + c.h) }), { x: 1e9, y: 1e9, x2: -1e9, y2: -1e9 }); } catch (err) { return null; } })() : null;
      if (b && b.x < 1e9) {
        g.fillStyle = 'rgba(76,141,255,.35)';
        if (horiz) g.fillRect(o + b.x * z, 0, (b.x2 - b.x) * z, H); else g.fillRect(0, o + b.y * z, W, (b.y2 - b.y) * z);
      }
    }
  };
  draw($('#ruler-top'), true);
  draw($('#ruler-left'), false);
}

// ---------- 안내선 ----------
export function drawGuides(E, overlayOf) {
  if (E.compId) return;
  const page = Ed.currentPage();
  if (!page) return;
  for (const f of page.frames) {
    const g = f.guides;
    if (!g || (!(g.v || []).length && !(g.h || []).length)) continue;
    const ov = overlayOf(f.id);
    if (!ov) continue;
    (g.v || []).forEach((x, i) => {
      const d = document.createElement('div');
      d.className = 'uguide v';
      d.style.left = x + 'px';
      d.dataset.axis = 'v'; d.dataset.i = i; d.title = `세로 안내선 x=${x} (끌어서 이동 · 프레임 밖으로 끌면 삭제)`;
      ov.appendChild(d);
    });
    (g.h || []).forEach((y, i) => {
      const d = document.createElement('div');
      d.className = 'uguide h';
      d.style.top = y + 'px';
      d.dataset.axis = 'h'; d.dataset.i = i; d.title = `가로 안내선 y=${y} (끌어서 이동 · 프레임 밖으로 끌면 삭제)`;
      ov.appendChild(d);
    });
  }
}

let seq = 0;
function newGuide(E, e, axis) {
  if (!E.doc || E.compId) return;
  const fid = E.activeFrame;
  const f = fid && E.idx.get(fid);
  if (!f || f.kind !== 'frame') { Ed.toast('안내선을 만들 프레임을 먼저 고르세요.'); return; }
  e.preventDefault();
  const g = { v: ((f.guides || {}).v || []).slice(), h: ((f.guides || {}).h || []).slice() };
  const p = Ed.toFrame(e, fid);
  g[axis].push(Math.round(axis === 'v' ? p.x : p.y));
  const key = 'guide' + (++seq);
  Ed.commit([{ op: 'set', id: fid, key: 'guides', value: g }], '안내선 추가', key);
  startGuideDrag(E, e, fid, axis, g[axis].length - 1, key);
}

export function startGuideDrag(E, e, fid, axis, i, key) {
  e.stopPropagation();
  key = key || 'guide' + (++seq);
  const size = axis === 'v' ? E.doc.size.w : E.doc.size.h;
  let last = null;
  Ed.track(e, (ev) => {
    const f = E.idx.get(fid);
    const g = { v: ((f.guides || {}).v || []).slice(), h: ((f.guides || {}).h || []).slice() };
    const p = Ed.toFrame(ev, fid);
    let v = axis === 'v' ? p.x : p.y;
    if (E.doc.settings.gridSnap) { const s = E.doc.settings.grid || 10; v = Math.round(v / s) * s; }
    v = Math.round(v);
    g[axis][i] = v;
    last = v;
    Ed.commit([{ op: 'set', id: fid, key: 'guides', value: g }], '안내선 이동', key);
  }, () => {
    if (last != null && (last < -4 || last > size + 4)) {
      const f = E.idx.get(fid);
      const g = { v: ((f.guides || {}).v || []).slice(), h: ((f.guides || {}).h || []).slice() };
      g[axis].splice(i, 1);
      Ed.commit([{ op: 'set', id: fid, key: 'guides', value: g.v.length || g.h.length ? g : undefined }], '안내선 삭제', key);
    }
    Ed.drawOverlay();
  });
}

export function clearGuides(E, fid) {
  const f = E.idx.get(fid);
  if (f && f.guides) Ed.commit([{ op: 'set', id: fid, key: 'guides' }], '안내선 모두 지우기');
}

// ---------- 정렬 보기 (슬라이드 정렬) ----------
const TW = 192;   // 썸네일 너비
export function renderSorter(E, w) {
  w.classList.remove('edit-mode');
  const nums = Ed.pageNumbers();
  const sc = TW / E.doc.size.w, TH = E.doc.size.h * sc;
  const root = document.createElement('div');
  root.className = 'sorter-root';
  root.innerHTML = '<div class="sorter-hint">끌어서 순서를 바꾸거나 다른 페이지로 옮기세요 · 더블클릭하면 편집 화면으로 · Esc로 돌아가기</div>';
  for (const page of E.doc.pages) {
    const sec = document.createElement('section');
    sec.className = 'sort-page';
    sec.dataset.page = page.id;
    sec.innerHTML = `<header><b>${esc(page.name)}</b><span>${page.frames.length}장</span><button data-add="${page.id}" title="이 페이지에 화면 설계 프레임 추가">＋ 프레임</button></header><div class="sort-grid"></div>`;
    const grid = sec.querySelector('.sort-grid');
    for (const f of page.frames) {
      const it = document.createElement('div');
      it.className = 'sort-item' + (f.id === E.frameSel ? ' on' : '') + (f.hidden ? ' off' : '');
      it.dataset.fid = f.id;
      it.draggable = true;
      it.innerHTML = `<div class="sort-thumb" style="width:${TW}px;height:${TH}px"></div>
        <div class="sort-cap"><em>${nums.get(f.id)}</em><span title="${esc(f.name)}">${esc(f.name)}</span>${f.hidden ? '<i title="숨긴 프레임">🙈</i>' : ''}${f.notes ? '<i title="메모 있음">📝</i>' : ''}</div>
        <div class="sort-acts"><button data-act="hide" title="${f.hidden ? '보이기' : '숨기기 (미리보기 · 인쇄에서 빠짐)'}">${f.hidden ? '👁' : '🙈'}</button><button data-act="dup" title="복제">⧉</button><button data-act="del" title="삭제">🗑</button></div>`;
      const fr = renderFrame(f, { doc: E.doc, idx: E.idx, mode: 'present', pageNo: nums.get(f.id), noEmbed: true });
      fr.style.transform = `scale(${sc})`;
      fr.style.transformOrigin = '0 0';
      it.querySelector('.sort-thumb').appendChild(fr);
      grid.appendChild(it);
    }
    root.appendChild(sec);
  }
  w.appendChild(root);
  fitText(root);
  bindSorter(E, root);
}

function bindSorter(E, root) {
  let dragId = null;
  root.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { const pg = E.idx.get(add.dataset.add); Ed.addFrame('screen', { page: pg.id, after: pg.frames.length ? pg.frames[pg.frames.length - 1].id : null }); return; }
    const it = e.target.closest('.sort-item');
    if (!it) { Ed.select([]); return; }
    const fid = it.dataset.fid;
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'hide') Ed.toggleFrameHidden(fid);
      if (act.dataset.act === 'del') Ed.deleteFrame(fid);
      if (act.dataset.act === 'dup') {
        const f = E.idx.get(fid), pg = E.idx.parentOf(fid);
        import('./model.js').then((M) => Ed.commit([{ op: 'insert', parent: pg.id, index: pg.frames.indexOf(f) + 1, item: M.cloneWithNewIds(f) }], '프레임 복제'));
      }
      return;
    }
    E.frameSel = fid;
    Ed.setActiveFrame(fid);
    root.querySelectorAll('.sort-item').forEach((x) => x.classList.toggle('on', x.dataset.fid === fid));
    Ed.ui();
  });
  root.addEventListener('dblclick', (e) => {
    const it = e.target.closest('.sort-item');
    if (!it) return;
    const fid = it.dataset.fid;
    E.activeFrame = fid;
    E.pageId = E.idx.pageOf(fid).id;
    Ed.setView('canvas');
    E.frameSel = fid;
    Ed.ui();
  });
  root.addEventListener('dragstart', (e) => { const it = e.target.closest('.sort-item'); if (!it) return; dragId = it.dataset.fid; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); it.classList.add('dragging'); });
  root.addEventListener('dragend', () => { dragId = null; root.querySelectorAll('.dragging, .drop-l, .drop-r, .drop-page').forEach((x) => x.classList.remove('dragging', 'drop-l', 'drop-r', 'drop-page')); });
  root.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    root.querySelectorAll('.drop-l, .drop-r, .drop-page').forEach((x) => x.classList.remove('drop-l', 'drop-r', 'drop-page'));
    const it = e.target.closest('.sort-item');
    if (it && it.dataset.fid !== dragId) { const r = it.getBoundingClientRect(); it.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-l' : 'drop-r'); return; }
    const sec = e.target.closest('.sort-page');
    if (sec && !it) sec.classList.add('drop-page');
  });
  root.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const src = dragId;
    const it = e.target.closest('.sort-item');
    const sec = e.target.closest('.sort-page');
    let pageId, index;
    if (it && it.dataset.fid !== src) {
      const tgt = E.idx.get(it.dataset.fid), pg = E.idx.parentOf(tgt.id);
      const r = it.getBoundingClientRect();
      index = pg.frames.indexOf(tgt) + (e.clientX < r.left + r.width / 2 ? 0 : 1);
      if (E.idx.parentOf(src) === pg && pg.frames.indexOf(E.idx.get(src)) < index) index--;
      pageId = pg.id;
    } else if (sec) { pageId = sec.dataset.page; index = null; }
    if (pageId) Ed.commit([{ op: 'move', id: src, parent: pageId, index }], '프레임 순서');
  });
}

export function layoutName(f) { return (LAYOUT_INFO[f.layout] || {}).name || f.layout; }
