// 패널: 상단 도구 막대 · 왼쪽(페이지 · 레이어 · 컴포넌트) · 오른쪽(속성) · 시작 화면 · 찾기 · 미리보기 · 인쇄
import * as M from './model.js';
import * as O from './ops.js';
import * as Ed from './editor.js';
import * as V from './viewtools.js';
import { renderFrame, renderNode, FONT_NAMES, collectDescriptions, SHAPES, SHAPE_NAME, shapePath, CAPS, resolveColor, fitText } from './render.js';
import { DOC_TEMPLATES, LAYOUT_INFO } from './templates.js';
import * as store from './store.js';
import * as CM from './contextmenu.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let E = null;

const TYPE_ICON = { text: 'T', image: '▣', table: '▦', shape: '□', connector: '↗', description: '①', hotspot: '⚡', group: '▤', instance: '◇', frame: '#' };
export const shapeName = (k) => SHAPE_NAME[k];

function shapeIcon(kind, size = 22) {
  const w = size, h = kind === 'ellipse' || kind === 'star5' || kind === 'octagon' || kind === 'plus' || kind === 'decision' || kind === 'diamond' ? size : size * .72;
  const n = { tail: [.25, 1.3], radius: 0 };
  const hh = /^callout/.test(kind) ? h * .75 : h;
  return `<svg width="${w + 2}" height="${h + 2}" viewBox="-1 -1 ${w + 2} ${h + 2}"><path d="${shapePath(kind, w, hh, n)}" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;
}

export function init(e) {
  E = e;
  // 도형 메뉴 채우기
  const sm = $('#shape-menu');
  if (sm) {
    const groups = {};
    SHAPES.forEach(([k, name, g]) => { (groups[g] = groups[g] || []).push([k, name]); });
    sm.innerHTML = Object.entries(groups).map(([g, list]) => `<div class="sm-g">${esc(g)}</div><div class="sm-grid">${list.map(([k, name]) => `<button data-act="shape:${k}" title="${esc(name)}">${shapeIcon(k)}</button>`).join('')}</div>`).join('');
  }
  $('#top').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    closeMenus(b.closest('.menu'));
    if (a === 'menu') { const pop = b.parentElement.querySelector('.menu-pop'); pop.classList.toggle('hidden'); if (b.dataset.menu === 'view') renderViewMenu(); return; }
    if (a.startsWith('tool:')) { const t = a.slice(5); t === 'image' ? Ed.pickImage() : Ed.setTool(t); return; }
    if (a.startsWith('shape:')) { Ed.setTool('shape', a.slice(6)); closeMenus(); return; }
    if (a.startsWith('frame:')) { Ed.addFrame(a.slice(6)); return; }
    if (a.startsWith('set:')) { const k = a.slice(4); Ed.setSetting(k, !E.doc.settings[k]); closeMenus(); return; }
    ({
      home: () => home(E), open: () => Ed.openFromFile(), save: () => Ed.saveToFile(false), saveas: () => Ed.saveToFile(true),
      json: () => store.download(store.verifiedJSON(E.doc), store.fileName(E.doc)), import: () => importHelp(), importfile: () => pickImport(),
      undo: () => Ed.undo(), redo: () => Ed.redo(), present: () => present('first'), shortcuts: () => shortcuts(),
      check: () => checkDoc(), print: () => printDoc(), find: () => findDialog(false), replace: () => findDialog(true),
      sorter: () => Ed.setView(E.view === 'sorter' ? 'canvas' : 'sorter'),
      gridsize: () => { const v = prompt('격자 간격 (px)', E.doc.settings.grid || 10); if (v && +v > 1) Ed.setSetting('grid', +v); },
      clearguides: () => E.activeFrame && V.clearGuides(E, E.activeFrame),
    }[a] || (() => {}))();
  });
  document.addEventListener('pointerdown', (ev) => { const t = ev.target instanceof Element ? ev.target : null; if (!t || !t.closest('.menu')) closeMenus(); if (!t || !t.closest('.cpop, .cswatch, .rb-b')) closeColorPop(); });
  const title = $('#doc-title');
  title.addEventListener('change', () => { Ed.commit([{ op: 'set', id: 'doc', key: 'meta.title', value: title.value }], '문서 제목'); });
  title.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') title.blur(); });
  $('#zoombar').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.z === 'in') Ed.setZoom(E.zoom * 1.2);
    if (b.dataset.z === 'out') Ed.setZoom(E.zoom / 1.2);
    if (b.dataset.z === 'fit') Ed.fitWidth();
    if (b.dataset.z === '100') Ed.setZoom(1);
  });
}
function closeMenus(except) { document.querySelectorAll('.menu-pop').forEach((m) => { if (!except || !except.contains(m)) m.classList.add('hidden'); }); }

function renderViewMenu() {
  const s = E.doc.settings;
  const ck = (on) => (on ? '✓' : '');
  $('#view-menu').innerHTML = `
    <button data-act="sorter">${E.view === 'sorter' ? '편집 화면으로' : '정렬 보기 (썸네일)'} <span class="kbd"></span></button><hr>
    <button data-act="set:rulers">눈금자 <span class="kbd">${ck(s.rulers)} Shift+R</span></button>
    <button data-act="set:gridShow">격자 표시 <span class="kbd">${ck(s.gridShow)} Shift+'</span></button>
    <button data-act="set:gridSnap">격자에 맞추기 <span class="kbd">${ck(s.gridSnap)}</span></button>
    <button data-act="gridsize">격자 간격… <span class="kbd">${s.grid || 10}px</span></button><hr>
    <button data-act="clearguides">이 프레임 안내선 모두 지우기</button>
    <div class="hint" style="padding:6px 10px">눈금자에서 캔버스로 끌어내면 안내선이 생겨요. 안내선을 프레임 밖으로 끌면 지워져요.</div>`;
}

export function renderTop() {
  if (!E.doc) return;
  const t = $('#doc-title');
  if (document.activeElement !== t) t.value = E.doc.meta.title;
  $('[data-act="undo"]').disabled = !E.hist.undoStack.length;
  $('[data-act="redo"]').disabled = !E.hist.redoStack.length;
  $('[data-act="undo"]').title = E.hist.undoStack.length ? '실행 취소: ' + E.hist.undoStack[E.hist.undoStack.length - 1].label + ' (Ctrl+Z)' : '실행 취소 (Ctrl+Z)';
  document.querySelectorAll('[data-act^="tool:"]').forEach((b) => b.classList.toggle('on', b.dataset.act === 'tool:' + E.tool));
  const sb = $('[data-act="menu"][data-menu="shape"]');
  if (sb) { sb.classList.toggle('on', E.tool === 'shape'); sb.innerHTML = shapeIcon(E.shapeKind || 'roundRect', 16) + ' ▾'; }
  const so = $('[data-act="sorter"].tb-btn');
  if (so) so.classList.toggle('on', E.view === 'sorter');
}

// ---------- 왼쪽 ----------
export function renderLeft() {
  if (!E.doc) return;
  const L = $('#left');
  const st = $('#layers') ? $('#layers').scrollTop : 0;
  L.innerHTML = `<div class="tabs"><button data-tab="layers" class="${E.leftTab === 'layers' ? 'on' : ''}">페이지 · 레이어</button><button data-tab="components" class="${E.leftTab === 'components' ? 'on' : ''}">컴포넌트 <small>${E.doc.components.length}</small></button></div>`;
  L.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { E.leftTab = b.dataset.tab; renderLeft(); }; });
  if (E.leftTab === 'components') { renderComponents(L); return; }
  const pages = document.createElement('div');
  pages.id = 'pages';
  pages.innerHTML = `<div class="sec-h">페이지 <button title="페이지(장) 추가" data-addpage>＋</button></div>` +
    E.doc.pages.map((p) => `<div class="pg ${p.id === E.pageId && !E.compId && E.view === 'canvas' ? 'on' : ''}" data-pg="${p.id}" draggable="true"><span class="nm">${esc(p.name)}</span><span class="cnt">${p.frames.length}</span><button class="x" data-delpg="${p.id}" title="페이지 삭제">×</button></div>`).join('');
  L.appendChild(pages);
  pages.querySelector('[data-addpage]').onclick = () => Ed.addPage();
  pages.querySelectorAll('.pg').forEach((el) => {
    const pid = el.dataset.pg;
    el.onclick = (ev) => { if (!ev.target.closest('.x')) Ed.gotoPage(pid); };
    el.ondblclick = () => renameInline(el.querySelector('.nm'), E.idx.get(pid).name, (v) => Ed.commit([{ op: 'set', id: pid, key: 'name', value: v }], '페이지 이름'));
    el.ondragstart = (ev) => { ev.dataTransfer.setData('text/x-tn-page', pid); };
    el.ondragover = (ev) => { if (dragging.kind === 'frame' || ev.dataTransfer.types.includes('text/x-tn-page')) { ev.preventDefault(); el.classList.add('drop'); } };
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = (ev) => {
      ev.preventDefault(); el.classList.remove('drop');
      const src = ev.dataTransfer.getData('text/x-tn-page');
      if (src && src !== pid) Ed.commit([{ op: 'move', id: src, parent: 'doc', index: E.doc.pages.findIndex((p) => p.id === pid) }], '페이지 순서');
      else if (dragging.kind === 'frame') { Ed.commit([{ op: 'move', id: dragging.id, parent: pid, index: null }], '프레임을 다른 페이지로'); dragging = {}; }
    };
  });
  pages.querySelectorAll('[data-delpg]').forEach((b) => {
    b.onclick = () => {
      const p = E.idx.get(b.dataset.delpg);
      if (E.doc.pages.length <= 1) { Ed.toast('마지막 페이지는 지울 수 없어요.'); return; }
      if (!confirm(`"${p.name}" 페이지와 프레임 ${p.frames.length}개를 삭제할까요? (되돌리기 가능)`)) return;
      Ed.commit([{ op: 'remove', id: p.id }], '페이지 삭제');
    };
  });
  const comp = Ed.currentComponent();
  if (!comp && leftView() === 'slides') { renderSlides(L, st); return; }
  const ly = document.createElement('div');
  ly.id = 'layers';
  const rows = [];
  if (comp) {
    rows.push(`<div class="sec-h">◆ ${esc(comp.name)} 원본</div>`);
    layerRows(comp.nodes, 0, rows);
  } else {
    const page = Ed.currentPage();
    rows.push(`<div class="sec-h">${viewSwitch()}<span class="kbd">${page ? page.frames.length : 0} 프레임</span></div>`);
    if (page) page.frames.forEach((f) => {
      const open = !E.collapsed.has(f.id);
      rows.push(`<div class="ly frame-row ${f.id === E.frameSel ? 'on' : ''} ${f.id === E.activeFrame ? 'active-frame' : ''} ${f.hidden ? 'is-hidden' : ''}" data-ly="${f.id}" data-frame="1" draggable="true" style="padding-left:2px">
        <span class="tw" data-tw="${f.id}">${open ? '▼' : '▶'}</span><span class="ic">#</span><span class="nm">${esc(f.name)}</span><span class="kbd">${esc((LAYOUT_INFO[f.layout] || {}).name || f.layout)}</span>
        <button class="act ${f.hidden ? 'pin' : ''}" data-fhide="${f.id}" title="프레임 숨기기 (미리보기 · 인쇄에서 빠짐)">${f.hidden ? '⊘' : '👁'}</button></div>`);
      if (open) layerRows(f.nodes, 1, rows);
    });
  }
  ly.innerHTML = rows.join('');
  L.appendChild(ly);
  ly.scrollTop = st;
  bindLayerRows(ly);
  bindViewSwitch(ly);
}

// ---------- 슬라이드 보기 (PowerPoint 썸네일 창) ----------
function leftView() { try { return localStorage.getItem('tnspec:leftView') || 'slides'; } catch (e) { return 'slides'; } }
function setLeftView(v) { try { localStorage.setItem('tnspec:leftView', v); } catch (e) { /* 무시 */ } renderLeft(); }
function viewSwitch() {
  const v = leftView();
  return `<span class="vsw"><button data-lv="slides" class="${v === 'slides' ? 'on' : ''}" title="화면 단위 미리보기 (PowerPoint 슬라이드 창)">🖼 슬라이드</button><button data-lv="layers" class="${v === 'layers' ? 'on' : ''}" title="요소 목록 (레이어)">☰ 레이어</button></span>`;
}
function bindViewSwitch(root) { root.querySelectorAll('[data-lv]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); setLeftView(b.dataset.lv); }; }); }

const THUMB_W = 184;
const thumbCache = new Map();   // 프레임 id → { key, el }  (바뀐 프레임만 다시 그린다)
let lastRevealed = null;
function thumbFor(f, pno, fresh) {
  const sc = THUMB_W / E.doc.size.w;
  const c = thumbCache.get(f.id);
  if (c && E.drag) return c.el;   // 드래그 중에는 다시 그리지 않음 (끝나면 반영)
  const key = JSON.stringify(f) + '|' + pno + '|' + JSON.stringify(E.doc.meta) + '|' + JSON.stringify(E.doc.theme);
  if (c && c.key === key) return c.el;
  const holder = document.createElement('div');
  holder.className = 'sl-thumb';
  holder.style.cssText = `width:${THUMB_W}px;height:${Math.round(E.doc.size.h * sc)}px`;
  const fr = renderFrame(f, { doc: E.doc, idx: E.idx, mode: 'present', pageNo: pno });
  fr.style.transform = `scale(${sc})`;
  fr.style.transformOrigin = '0 0';
  holder.appendChild(fr);
  thumbCache.set(f.id, { key, el: holder });
  fresh.push(holder);
  return holder;
}

function renderSlides(L, st) {
  const box = document.createElement('div');
  box.id = 'layers';
  box.className = 'slides';
  box.tabIndex = 0;
  const nums = Ed.pageNumbers();
  const fresh = [];
  const head = document.createElement('div');
  head.className = 'sec-h';
  head.innerHTML = `${viewSwitch()}<span class="kbd">${E.idx.frames().length}장</span>`;
  box.appendChild(head);
  for (const page of E.doc.pages) {
    const ph = document.createElement('div');
    ph.className = 'sl-page' + (page.id === E.pageId ? ' cur' : '');
    ph.dataset.page = page.id;
    ph.innerHTML = `<span>${esc(page.name)}</span><small>${page.frames.length}장</small>`;
    box.appendChild(ph);
    for (const f of page.frames) {
      const it = document.createElement('div');
      it.className = 'sl-item' + (f.id === E.activeFrame && E.view === 'canvas' ? ' on' : '') + (f.id === E.frameSel ? ' fsel' : '') + (f.hidden ? ' off' : '');
      it.dataset.fid = f.id;
      it.draggable = true;
      it.title = `${nums.get(f.id)}. ${f.name} · ${(LAYOUT_INFO[f.layout] || {}).name || f.layout}`;
      it.innerHTML = `<div class="sl-num"><b>${nums.get(f.id)}</b>${f.hidden ? '<i title="숨긴 프레임 (미리보기 · 인쇄 제외)">🙈</i>' : ''}${f.notes ? '<i title="메모 있음">📝</i>' : ''}</div>`;
      const right = document.createElement('div');
      right.className = 'sl-body';
      right.appendChild(thumbFor(f, nums.get(f.id), fresh));
      right.insertAdjacentHTML('beforeend', `<div class="sl-name">${esc(f.name)}</div>`);
      it.appendChild(right);
      box.appendChild(it);
    }
  }
  for (const id of [...thumbCache.keys()]) if (!E.idx.get(id)) thumbCache.delete(id);   // 지워진 프레임
  L.appendChild(box);
  box.scrollTop = st;
  fresh.forEach((h) => fitText(h));
  // 작업 중인 프레임이 바뀌면 목록에서 보이게
  if (E.activeFrame !== lastRevealed) {
    lastRevealed = E.activeFrame;
    const on = box.querySelector('.sl-item.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  bindViewSwitch(box);
  bindSlides(box);
}

function gotoFrame(fid) {
  if (E.compId) Ed.exitComponent();
  const pg = E.idx.pageOf(fid);
  if (!pg) return;
  if (E.view !== 'canvas') Ed.setView('canvas');
  if (pg.id !== E.pageId) Ed.gotoPage(pg.id);
  E.scope = null;
  Ed.select([], { frame: fid });
  Ed.scrollToFrame(fid);
}

function bindSlides(box) {
  let dragId = null;
  box.addEventListener('click', (e) => {
    const ph = e.target.closest('.sl-page');
    if (ph) { Ed.gotoPage(ph.dataset.page); return; }
    const it = e.target.closest('.sl-item');
    if (it) { gotoFrame(it.dataset.fid); const b = $('#layers'); if (b) b.focus({ preventScroll: true }); }
  });
  box.addEventListener('contextmenu', (e) => {
    const it = e.target.closest('.sl-item');
    if (!it) return;
    e.preventDefault();
    gotoFrame(it.dataset.fid);
    CM.open(e, { kind: 'frame', fid: it.dataset.fid });
  });
  // 키보드: ↑↓ 이전 · 다음 화면, Delete 삭제 (PowerPoint와 같게)
  box.addEventListener('keydown', (e) => {
    const frames = E.idx.frames();
    const i = frames.findIndex((f) => f.id === (E.frameSel || E.activeFrame));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      const n = frames[Math.max(0, Math.min(frames.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n) {
        gotoFrame(n.id);
        setTimeout(() => { const el = document.querySelector(`#layers .sl-item[data-fid="${n.id}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); const b = $('#layers'); if (b) b.focus({ preventScroll: true }); }, 0);
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && i >= 0) {
      e.preventDefault(); e.stopPropagation(); Ed.deleteFrame(frames[i].id);
    }
  });
  // 끌어서 순서 바꾸기 · 다른 페이지로
  box.addEventListener('dragstart', (e) => { const it = e.target.closest('.sl-item'); if (!it) return; dragId = it.dataset.fid; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); it.classList.add('dragging'); });
  box.addEventListener('dragend', () => { dragId = null; box.querySelectorAll('.dragging, .drop-t, .drop-b, .drop-page').forEach((x) => x.classList.remove('dragging', 'drop-t', 'drop-b', 'drop-page')); });
  box.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    box.querySelectorAll('.drop-t, .drop-b, .drop-page').forEach((x) => x.classList.remove('drop-t', 'drop-b', 'drop-page'));
    const it = e.target.closest('.sl-item');
    if (it && it.dataset.fid !== dragId) { const r = it.getBoundingClientRect(); it.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-t' : 'drop-b'); return; }
    const ph = e.target.closest('.sl-page');
    if (ph) ph.classList.add('drop-page');
  });
  box.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const src = dragId;
    const it = e.target.closest('.sl-item'), ph = e.target.closest('.sl-page');
    let pageId = null, index = null;
    if (it && it.dataset.fid !== src) {
      const tgt = E.idx.get(it.dataset.fid), pg = E.idx.parentOf(tgt.id);
      const r = it.getBoundingClientRect();
      index = pg.frames.indexOf(tgt) + (e.clientY < r.top + r.height / 2 ? 0 : 1);
      if (E.idx.parentOf(src) === pg && pg.frames.indexOf(E.idx.get(src)) < index) index--;
      pageId = pg.id;
    } else if (ph) { pageId = ph.dataset.page; index = 0; }
    if (pageId) Ed.commit([{ op: 'move', id: src, parent: pageId, index }], '프레임 순서');
  });
}

function layerRows(nodes, depth, out) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const open = n.type === 'group' && !E.collapsed.has(n.id);
    const ic = n.type === 'shape' ? '□' : TYPE_ICON[n.type];
    out.push(`<div class="ly ${E.sel.includes(n.id) ? 'on' : ''} ${n.hidden ? 'is-hidden' : ''} ${n.type}" data-ly="${n.id}" draggable="true" style="padding-left:${depth * 14 + 2}px">
      <span class="tw" ${n.type === 'group' ? `data-tw="${n.id}"` : ''}>${n.type === 'group' ? (open ? '▼' : '▶') : ''}</span>
      <span class="ic">${ic}</span><span class="nm">${esc(n.name || n.type)}</span>
      <button class="act ${n.locked ? 'pin' : ''}" data-lock="${n.id}" title="잠금">${n.locked ? '🔒' : '🔓'}</button>
      <button class="act ${n.hidden ? 'pin' : ''}" data-eye="${n.id}" title="숨기기">${n.hidden ? '⊘' : '👁'}</button></div>`);
    if (open) layerRows(n.children, depth + 1, out);
  }
}

let dragging = {};
function bindLayerRows(root) {
  root.querySelectorAll('[data-tw]').forEach((t) => {
    t.onclick = (ev) => { ev.stopPropagation(); const id = t.dataset.tw; E.collapsed.has(id) ? E.collapsed.delete(id) : E.collapsed.add(id); renderLeft(); };
  });
  root.querySelectorAll('[data-eye]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); const n = E.idx.get(b.dataset.eye); Ed.commit([{ op: 'set', id: n.id, key: 'hidden', value: n.hidden ? undefined : true }], n.hidden ? '보이기' : '숨기기'); }; });
  root.querySelectorAll('[data-lock]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); const n = E.idx.get(b.dataset.lock); Ed.commit([{ op: 'set', id: n.id, key: 'locked', value: n.locked ? undefined : true }], n.locked ? '잠금 해제' : '잠금'); }; });
  root.querySelectorAll('[data-fhide]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); Ed.toggleFrameHidden(b.dataset.fhide); }; });
  root.querySelectorAll('.ly[data-ly]').forEach((row) => {
    const id = row.dataset.ly;
    const isFrame = !!row.dataset.frame;
    row.onclick = (ev) => {
      if (isFrame) { E.scope = null; Ed.select([], { frame: id }); Ed.scrollToFrame(id); return; }
      const anc = E.idx.ancestors(id);
      E.scope = anc.length ? anc[0].id : null;
      if (ev.shiftKey && E.sel.length) Ed.select(E.sel.includes(id) ? E.sel.filter((k) => k !== id) : E.sel.concat(id));
      else Ed.select([id]);
    };
    row.ondblclick = (ev) => {
      if (ev.target.closest('.act, .tw')) return;
      const o = E.idx.get(id);
      renameInline(row.querySelector('.nm'), o.name, (v) => Ed.commit([{ op: 'set', id, key: 'name', value: v }], '이름 바꾸기'));
    };
    row.ondragstart = (ev) => { dragging = { id, kind: isFrame ? 'frame' : 'node' }; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', id); };
    row.ondragend = () => { dragging = {}; };
    row.ondragover = (ev) => {
      if (!dragging.id || dragging.id === id) return;
      const tgt = E.idx.get(id);
      if (dragging.kind === 'frame' && !isFrame) return;
      ev.preventDefault();
      const r = row.getBoundingClientRect();
      const y = (ev.clientY - r.top) / r.height;
      const into = dragging.kind === 'node' && (isFrame || (tgt.type === 'group' && y > .28 && y < .72));
      row.classList.remove('drop-before', 'drop-after', 'drop-into');
      row.classList.add(into ? 'drop-into' : y < .5 ? 'drop-before' : 'drop-after');
    };
    row.ondragleave = () => row.classList.remove('drop-before', 'drop-after', 'drop-into');
    row.ondrop = (ev) => {
      ev.preventDefault();
      const mode = row.classList.contains('drop-into') ? 'into' : row.classList.contains('drop-before') ? 'before' : 'after';
      row.classList.remove('drop-before', 'drop-after', 'drop-into');
      const src = dragging.id;
      dragging = {};
      if (!src || src === id) return;
      dropLayer(src, id, mode);
    };
  });
}

function dropLayer(src, target, mode) {
  const s = E.idx.get(src), t = E.idx.get(target);
  if (!s || !t) return;
  if (s.kind === 'frame') {
    const page = E.idx.parentOf(target);
    let i = page.frames.indexOf(t) + (mode === 'after' ? 1 : 0);
    if (E.idx.parentOf(src) === page && page.frames.indexOf(s) < i) i--;
    Ed.commit([{ op: 'move', id: src, parent: page.id, index: i }], '프레임 순서');
    return;
  }
  for (let p = t; p; p = E.idx.parentOf(p.id)) { if (p === s) return; if (p === E.doc) break; }
  let parent, index;
  if (mode === 'into') { parent = target; index = null; }
  else {
    const par = E.idx.parentOf(target);
    parent = par.id;
    const list = par[E.idx.entry(target).key];
    // 레이어 목록은 위가 앞(배열 끝) → "위에 놓기" = 배열에서 대상 다음
    index = list.indexOf(t) + (mode === 'before' ? 1 : 0);
    if (E.idx.parentOf(src) === par && list.indexOf(s) < index) index--;
  }
  if (Ed.commit(O.opsReparent(E.idx, src, parent, index), '레이어 이동')) Ed.select([src]);
}

function renameInline(span, value, done) {
  const inp = document.createElement('input');
  inp.value = value || '';
  span.replaceWith(inp);
  inp.focus(); inp.select();
  let fin = false;
  const end = (ok) => { if (fin) return; fin = true; if (ok && inp.value.trim() && inp.value !== value) done(inp.value.trim()); else renderLeft(); };
  inp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') end(true); if (ev.key === 'Escape') end(false); };
  inp.onblur = () => end(true);
}

function renderComponents(L) {
  const box = document.createElement('div');
  box.style.cssText = 'overflow:auto;flex:1';
  box.innerHTML = `<div class="hint">반복되는 UI(채팅 메시지 · 버튼 · 팝업)를 한 번 만들고 여러 곳에 넣어 쓰세요. <b>원본을 고치면 모든 인스턴스가 함께 바뀝니다.</b><br>
    · 선택한 것을 컴포넌트로: <b>Ctrl+Alt+K</b><br>· 카드를 캔버스로 끌어다 놓거나 ＋ 를 누르면 인스턴스가 들어갑니다.</div><div class="cmp-list"></div>`;
  const list = box.querySelector('.cmp-list');
  for (const c of E.doc.components) {
    const n = O.instancesOf(E.doc, c.id).length;
    const card = document.createElement('div');
    card.className = 'cmp-card';
    card.innerHTML = `<div class="pv" draggable="true" title="끌어서 캔버스에 놓기"></div><div class="meta"><b title="${esc(c.name)}">${esc(c.name)}</b><small>${n}개 사용</small>
      <button data-a="ins" title="지금 프레임에 넣기">＋</button><button data-a="edit" title="원본 편집">✎</button><button data-a="del" title="삭제">🗑</button></div>`;
    const pv = card.querySelector('.pv');
    const sc = Math.min(1, 200 / c.w, 80 / c.h);
    const holder = document.createElement('div');
    holder.className = 'frame';
    holder.style.cssText = `width:${c.w}px;height:${c.h}px;transform:translate(-50%,-50%) scale(${sc});transform-origin:center;overflow:visible`;
    holder.appendChild(renderNode(M.createNode('instance', { id: 'pv', x: 0, y: 0, w: c.w, h: c.h, component: c.id }), { doc: E.doc, idx: E.idx, mode: 'present' }));
    pv.appendChild(holder);
    pv.ondragstart = (ev) => { ev.dataTransfer.setData('text/x-tn-comp', c.id); ev.dataTransfer.effectAllowed = 'copy'; };
    pv.ondblclick = () => Ed.editComponent(c.id);
    card.querySelector('[data-a="ins"]').onclick = () => Ed.insertInstance(c.id);
    card.querySelector('[data-a="edit"]').onclick = () => Ed.editComponent(c.id);
    card.querySelector('[data-a="del"]').onclick = () => {
      if (n) { Ed.toast(`${n}곳에서 쓰이고 있어요. 인스턴스를 먼저 분리하거나 지운 다음 삭제하세요.`); return; }
      if (confirm(`"${c.name}" 컴포넌트를 삭제할까요?`)) { if (E.compId === c.id) Ed.exitComponent(); Ed.commit([{ op: 'remove', id: c.id }], '컴포넌트 삭제'); }
    };
    card.querySelector('b').ondblclick = (ev) => renameInline(ev.target, c.name, (v) => Ed.commit([{ op: 'set', id: c.id, key: 'name', value: v }], '컴포넌트 이름'));
    list.appendChild(card);
  }
  L.appendChild(box);
}

// ---------- 오른쪽: 속성 ----------
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

// 입력칸 → 연산. key: 노드 경로, 여러 노드면 모두에 적용
function bindInput(input, ids, key, opts = {}) {
  input.dataset.k = ids.join(',') + '|' + key;
  const read = () => {
    let v = input.type === 'checkbox' ? input.checked : input.value;
    if (opts.num) { v = parseFloat(v); if (!isFinite(v)) return undefined; }
    if (opts.map) v = opts.map(v);
    return v;
  };
  const apply = (merge) => {
    const v = read();
    if (v === undefined && !opts.allowEmpty) return;
    const ops = opts.makeOps ? opts.makeOps(v) : ids.map((id) => ({ op: 'set', id, key, value: v === '' && opts.emptyUndefined ? undefined : v }));
    if (opts.extra) ops.push(...opts.extra(v));
    Ed.commit(ops, opts.label || '속성 변경', merge);
  };
  if (opts.live) input.addEventListener('input', () => apply('insp' + key));
  input.addEventListener('change', () => apply(opts.live ? 'insp' + key : null));
  if (input.tagName === 'INPUT' && input.type !== 'checkbox') input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') input.blur();
    if (opts.num && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault();
      input.value = Math.round(((parseFloat(input.value) || 0) + (ev.key === 'ArrowUp' ? 1 : -1) * (ev.shiftKey ? 10 : 1)) * 10) / 10;
      apply('insp-arrow' + key);
    }
  });
}

function numField(label, v, ids, key, opts = {}) {
  const f = el(`<label class="fld"><span>${label}</span><input type="text" inputmode="decimal" value="${v == null || v === '' ? '' : Math.round(v * 100) / 100}"></label>`);
  bindInput(f.querySelector('input'), ids, key, Object.assign({ num: true }, opts));
  return f;
}
function textField(v, ids, key, opts = {}) {
  const f = el(`<label class="fld"><input type="text" value="${esc(v == null ? '' : v)}" placeholder="${esc(opts.ph || '')}"></label>`);
  bindInput(f.querySelector('input'), ids, key, opts);
  return f;
}
function selectField(v, options, ids, key, opts = {}) {
  const f = el(`<label class="fld"><select>${options.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select></label>`);
  bindInput(f.querySelector('select'), ids, key, opts);
  return f;
}

// ---------- 색 고르기: 테마 색 · 최근 색 · 직접 입력 ----------
function recentColors() { try { return JSON.parse(localStorage.getItem('tnspec:colors') || '[]'); } catch (e) { return []; } }
function pushRecent(c) {
  if (!c || c === 'none' || c.startsWith('theme:')) return;
  const r = [c].concat(recentColors().filter((x) => x !== c)).slice(0, 10);
  try { localStorage.setItem('tnspec:colors', JSON.stringify(r)); } catch (e) { /* 무시 */ }
}
function toHex6(v) { if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map((x) => x + x).join(''); return /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'; }
function colorLabel(v) {
  if (!v || v === 'none') return '없음';
  if (v.startsWith('theme:')) { const t = (E.doc.theme.colors || []).find((c) => c.key === v.slice(6)); return '테마 · ' + (t ? t.name : v.slice(6)); }
  return v;
}
function closeColorPop() { const p = $('.cpop'); if (p) p.remove(); }
// apply(value, merge) 로 직접 연산을 만들거나, ids+key 로 set
function colorField(v, ids, key, opts = {}) {
  const shown = resolveColor(E.doc, v);
  const f = el(`<div class="fld cswatch" tabindex="0"><i style="background:${!v || v === 'none' ? 'transparent' : esc(shown)}" class="${!v || v === 'none' ? 'none' : ''}"></i><span class="cl">${esc(colorLabel(v))}</span></div>`);
  f.dataset.k = ids.join(',') + '|' + key;
  const apply = opts.apply || ((val, merge) => {
    const ops = ids.map((id) => ({ op: 'set', id, key, value: val }));
    Ed.commit(ops, opts.label || '색 변경', merge);
  });
  f.onclick = (ev) => { ev.stopPropagation(); openColorPopover(f, v, apply, Object.assign({ key }, opts)); };
  return f;
}

// 색 고르기 팝오버 (속성 패널 · 리본에서 함께 씀). apply(value, mergeKey)
export function openColorPopover(anchor, v, apply, opts = {}) {
  const key = opts.key || 'c';
  const shown = resolveColor(E.doc, v);
  {
    closeColorPop();
    const pop = document.createElement('div');
    pop.className = 'cpop keep-edit';
    const theme = E.doc.theme.colors || [];
    const rec = recentColors();
    pop.innerHTML = `<div class="cp-h">테마 색 <small>테마를 바꾸면 함께 바뀜</small></div><div class="cp-grid">${theme.map((c) => `<button data-v="theme:${esc(c.key)}" title="${esc(c.name)} ${esc(c.value)}" style="background:${esc(c.value)}" class="${v === 'theme:' + c.key ? 'on' : ''}"></button>`).join('')}</div>
      ${rec.length ? `<div class="cp-h">최근 사용</div><div class="cp-grid">${rec.map((c) => `<button data-v="${esc(c)}" title="${esc(c)}" style="background:${esc(c)}"></button>`).join('')}</div>` : ''}
      <div class="cp-h">기본</div><div class="cp-grid">${['#ffffff', '#f2f2f2', '#d9d9d9', '#a6a6a6', '#595959', '#000000', '#e53935', '#ff8a00', '#ffc107', '#22c55e', '#399eff', '#7b4dff'].map((c) => `<button data-v="${c}" title="${c}" style="background:${c}"></button>`).join('')}</div>
      <div class="cp-row"><input type="color" value="${toHex6(shown || '#000000')}"><input type="text" class="cp-hex" value="${esc(v && !v.startsWith('theme:') && v !== 'none' ? v : '')}" placeholder="#rrggbb">${opts.noNone ? '' : '<button data-v="none" class="cp-none">없음</button>'}</div>`;
    if (opts.title) pop.insertAdjacentHTML('afterbegin', `<div class="cp-h" style="color:var(--tx)"><b>${esc(opts.title)}</b></div>`);
    if (opts.extra) pop.appendChild(opts.extra);
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(innerWidth - 236, r.left) + 'px';
    pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 4) + 'px';
    pop.addEventListener('pointerdown', (e2) => { if (e2.target.tagName !== 'INPUT') e2.preventDefault(); });
    pop.addEventListener('click', (e2) => {
      const b = e2.target.closest('[data-v]');
      if (!b) return;
      pushRecent(b.dataset.v);
      apply(b.dataset.v, null);
      closeColorPop();
    });
    const ci = pop.querySelector('input[type=color]'), hx = pop.querySelector('.cp-hex');
    ci.addEventListener('input', () => { hx.value = ci.value; apply(ci.value, 'color' + key); });
    ci.addEventListener('change', () => pushRecent(ci.value));
    hx.addEventListener('keydown', (e2) => { e2.stopPropagation(); if (e2.key === 'Enter' && /^#[0-9a-f]{3,8}$/i.test(hx.value.trim())) { pushRecent(hx.value.trim()); apply(hx.value.trim(), null); closeColorPop(); } });
  }
}

function row(label, ...kids) {
  const r = el(`<div class="row">${label ? `<label>${label}</label>` : ''}</div>`);
  kids.forEach((k) => r.appendChild(k));
  return r;
}
function btn(html, title, fn, cls = '') {
  const b = el(`<button class="ib ${cls}" title="${esc(title)}">${html}</button>`);
  b.onclick = fn;
  return b;
}
// 글 편집 중에도 눌러지는 버튼 (포커스를 뺏지 않음)
function keepBtn(html, title, fn, cls = '') {
  const b = btn(html, title, fn, cls + ' keep-edit');
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  return b;
}
function section(title, sub) {
  const s = document.createElement('section');
  s.innerHTML = `<h4>${title}${sub ? `<small>${sub}</small>` : ''}</h4>`;
  return s;
}
const same = (list, f) => { const v = list.map(f); return v.every((x) => JSON.stringify(x) === JSON.stringify(v[0])) ? v[0] : null; };

export function renderRight() {
  if (!E.doc) return;
  const R = $('#right');
  const a = document.activeElement;
  const keep = a && R.contains(a) && a.dataset.k ? { k: a.dataset.k, s: a.selectionStart, e: a.selectionEnd } : null;
  if (a && R.contains(a) && a.tagName === 'TEXTAREA') return;   // 긴 글 입력 중에는 다시 그리지 않음
  const st = R.scrollTop;
  R.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'insp';
  R.appendChild(box);
  const nodes = E.sel.map((id) => E.idx.get(id)).filter(Boolean);
  if (nodes.length) nodeInspector(box, nodes);
  else if (E.compId) componentInspector(box, Ed.currentComponent());
  else if (E.frameSel && E.idx.get(E.frameSel)) frameInspector(box, E.idx.get(E.frameSel));
  else docInspector(box);
  R.scrollTop = st;
  if (keep) {
    const t = R.querySelector(`[data-k="${CSS.escape(keep.k)}"]`);
    if (t && t.tagName !== 'DIV') { t.focus(); try { t.setSelectionRange(keep.s, keep.e); } catch (e) { /* select */ } }
  }
}

function docInspector(box) {
  const m = E.doc.meta;
  const s = section('문서 정보', '표지 · 머리말에 자동 반영');
  const f = (lab, key, ph) => s.appendChild(row(lab, textField(m[key], ['doc'], 'meta.' + key, { ph, label: '문서 정보' })));
  f('제목', 'title'); f('프로젝트', 'project'); f('팀', 'team'); f('버전', 'version'); f('날짜', 'date', 'YYYY-MM-DD'); f('작성자', 'author'); f('저작권', 'copyright');
  box.appendChild(s);
  // 머리글 · 바닥글
  const ft = Object.assign({ slogan: true, copyright: true, pageNo: true }, m.footer || {});
  const fs = section('바닥글', '모든 프레임');
  const fb = el('<div class="btns"></div>');
  [['slogan', '슬로건'], ['copyright', '저작권'], ['pageNo', '쪽 번호']].forEach(([k, lab]) => {
    fb.appendChild(btn((ft[k] ? '✓ ' : '') + lab, lab + ' 표시', () => Ed.commit([{ op: 'set', id: 'doc', key: 'meta.footer', value: Object.assign({}, ft, { [k]: !ft[k] }) }], '바닥글 설정'), ft[k] ? 'on' : ''));
  });
  fs.appendChild(fb);
  box.appendChild(fs);
  // 테마 색
  const th = section('테마 색', '색 칸에서 고르면 테마와 연결됨');
  const list = el('<div class="theme-list"></div>');
  (E.doc.theme.colors || []).forEach((c, i) => {
    const r = el(`<div class="theme-row"><input type="color" value="${toHex6(c.value)}"><input type="text" class="tn" value="${esc(c.name)}"><code>${esc(c.key)}</code><button class="ib" title="삭제">✕</button></div>`);
    const [ci, ti] = r.querySelectorAll('input');
    ci.oninput = () => Ed.commit([{ op: 'set', id: 'doc', key: `theme.colors.${i}.value`, value: ci.value }], '테마 색', 'theme' + i);
    ti.onchange = () => Ed.commit([{ op: 'set', id: 'doc', key: `theme.colors.${i}.name`, value: ti.value }], '테마 색 이름');
    ti.onkeydown = (ev) => ev.stopPropagation();
    r.querySelector('button').onclick = () => {
      const used = JSON.stringify(E.doc.pages).includes('theme:' + c.key) || JSON.stringify(E.doc.components).includes('theme:' + c.key);
      if (used && !confirm(`"${c.name}"을(를) 쓰는 요소가 있어요. 지우면 기본 색으로 보입니다. 지울까요?`)) return;
      const colors = M.clone(E.doc.theme.colors); colors.splice(i, 1);
      Ed.commit([{ op: 'set', id: 'doc', key: 'theme.colors', value: colors }], '테마 색 삭제');
    };
    list.appendChild(r);
  });
  th.appendChild(list);
  th.appendChild(btn('＋ 테마 색 추가', '테마 색 추가', () => {
    const name = prompt('색 이름', '새 색'); if (!name) return;
    const colors = M.clone(E.doc.theme.colors || []);
    colors.push({ key: 'c' + Date.now().toString(36).slice(-4), name, value: '#399eff' });
    Ed.commit([{ op: 'set', id: 'doc', key: 'theme.colors', value: colors }], '테마 색 추가');
  }, 'wide'));
  box.appendChild(th);
  const page = Ed.currentPage();
  if (page) {
    const p = section('페이지', page.frames.length + '개 프레임');
    p.appendChild(row('이름', textField(page.name, [page.id], 'name', { label: '페이지 이름' })));
    p.appendChild(el('<div class="muted">페이지는 기획서의 장(章)입니다. 프레임 = 기획서 한 장(PDF 한 쪽)이에요.</div>'));
    box.appendChild(p);
  }
  const t = section('도움말');
  t.appendChild(el(`<div class="muted">· 프레임 이름을 누르면 프레임 속성(레이아웃 · 메모 · 숨기기)을 고칠 수 있어요.<br>· 표지 제목, Page Name 같은 양식 칸은 <b>더블클릭</b>해서 바로 고칩니다.<br>· 모든 편집은 연산으로 기록돼 <b>Ctrl+Z</b>로 되돌릴 수 있어요.</div>`));
  t.appendChild(btn('⌨ 단축키 보기', '단축키', () => shortcuts(), 'wide'));
  box.appendChild(t);
}

function frameInspector(box, f) {
  const s = section('프레임', (LAYOUT_INFO[f.layout] || {}).name);
  s.appendChild(row('이름', textField(f.name, [f.id], 'name', { label: '프레임 이름' })));
  s.appendChild(row('레이아웃', selectField(f.layout, Object.entries(LAYOUT_INFO).map(([k, v]) => [k, v.name]), [f.id], 'layout', { label: '레이아웃 변경' })));
  if (f.layout === 'screen') {
    s.appendChild(row('Page Name', textField(f.props.pageName != null ? f.props.pageName : f.name, [f.id], 'props.pageName')));
    s.appendChild(row('화면 제목', textField(f.props.screenTitle != null ? f.props.screenTitle : '', [f.id], 'props.screenTitle', { ph: 'Page Name과 같음', emptyUndefined: true, allowEmpty: true })));
  }
  if (f.layout === 'divider') {
    s.appendChild(row('번호', textField(f.props.number, [f.id], 'props.number')));
    s.appendChild(row('장 제목', textField(f.props.title, [f.id], 'props.title')));
  }
  if (f.layout === 'policy') s.appendChild(row('제목', textField(f.props.title, [f.id], 'props.title')));
  const hb = el('<div class="btns"></div>');
  hb.appendChild(btn(f.hidden ? '🙈 숨김 (미리보기 · 인쇄 제외)' : '👁 보임', '프레임 숨기기', () => Ed.toggleFrameHidden(f.id), f.hidden ? 'on wide' : 'wide'));
  s.appendChild(hb);
  box.appendChild(s);
  const nt = section('프레임 메모', '기획 의도 · 개발 참고 (발표자 노트)');
  const ta = el(`<textarea id="insp-frame-notes" placeholder="이 화면에 대한 메모">${esc(f.notes || '')}</textarea>`);
  ta.addEventListener('change', () => Ed.commit([{ op: 'set', id: f.id, key: 'notes', value: ta.value || undefined }], '프레임 메모'));
  ta.addEventListener('keydown', (ev) => ev.stopPropagation());
  ta.addEventListener('blur', () => setTimeout(renderRight, 0));
  nt.appendChild(ta);
  box.appendChild(nt);
  const a = section('정리');
  const page = E.idx.parentOf(f.id);
  const i = page.frames.indexOf(f);
  const b = el('<div class="btns"></div>');
  b.appendChild(btn('↑ 위로', '앞으로', () => Ed.commit([{ op: 'move', id: f.id, parent: page.id, index: i - 1 }], '프레임 순서')));
  b.appendChild(btn('↓ 아래로', '뒤로', () => Ed.commit([{ op: 'move', id: f.id, parent: page.id, index: i + 1 }], '프레임 순서')));
  b.appendChild(btn('⧉ 복제', '프레임 복제', () => {
    const c = M.cloneWithNewIds(f);
    Ed.commit([{ op: 'insert', parent: page.id, index: i + 1, item: c }], '프레임 복제');
    Ed.select([], { frame: c.id }); Ed.scrollToFrame(c.id);
  }));
  b.appendChild(btn('🗑 삭제', '프레임 삭제', () => Ed.deleteFrame(f.id), 'danger'));
  a.appendChild(b);
  const g = f.guides || {};
  if ((g.v || []).length || (g.h || []).length) a.appendChild(el(`<div class="muted" style="margin-top:8px">안내선 세로 ${(g.v || []).length}개 · 가로 ${(g.h || []).length}개</div>`)), a.appendChild(btn('안내선 모두 지우기', '', () => V.clearGuides(E, f.id), 'wide'));
  if (E.doc.pages.length > 1) {
    const sel = el(`<label class="fld"><select>${E.doc.pages.map((p) => `<option value="${p.id}" ${p.id === page.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`);
    sel.querySelector('select').onchange = (ev) => { Ed.commit([{ op: 'move', id: f.id, parent: ev.target.value, index: null }], '프레임을 다른 페이지로'); Ed.gotoPage(ev.target.value); };
    a.appendChild(el('<div style="height:8px"></div>'));
    a.appendChild(row('페이지', sel));
  }
  box.appendChild(a);
  if (f.layout === 'screen') {
    const d = section('Description 패널', collectDescriptions(f.nodes).length + '개');
    d.appendChild(el('<div class="muted">화면 위에 Description 번호(도구 D)를 놓으면 오른쪽 패널이 번호순으로 자동 정리됩니다.</div>'));
    box.appendChild(d);
  }
}

function componentInspector(box, c) {
  if (!c) return;
  const s = section('컴포넌트 원본', O.instancesOf(E.doc, c.id).length + '개 인스턴스');
  s.appendChild(row('이름', textField(c.name, [c.id], 'name', { label: '컴포넌트 이름' })));
  const g = el('<div class="grid2"></div>');
  g.appendChild(numField('W', c.w, [c.id], 'w', { label: '컴포넌트 크기' }));
  g.appendChild(numField('H', c.h, [c.id], 'h', { label: '컴포넌트 크기' }));
  s.appendChild(g);
  const b = el('<div class="btns"></div>');
  b.appendChild(btn('내용에 맞추기', '원본 크기를 내용 경계로', () => {
    const bb = O.unionBox(c.nodes.map((n) => M.bounds(n, E.idx)));
    if (!bb) return;
    const ops = c.nodes.map((n) => [{ op: 'set', id: n.id, key: 'x', value: O.R((n.x || 0) - bb.x) }, { op: 'set', id: n.id, key: 'y', value: O.R((n.y || 0) - bb.y) }]).flat();
    ops.push({ op: 'set', id: c.id, key: 'w', value: Math.ceil(bb.w) }, { op: 'set', id: c.id, key: 'h', value: Math.ceil(bb.h) });
    Ed.commit(ops, '컴포넌트 크기 맞춤');
  }, 'wide'));
  b.appendChild(btn('편집 완료', '돌아가기', () => Ed.exitComponent(), 'primary wide'));
  s.appendChild(b);
  s.appendChild(el('<div class="muted" style="margin-top:8px">인스턴스는 원본 크기를 기준으로 늘어나거나 줄어듭니다. 인스턴스에서 바꾼 글자(오버라이드)는 원본을 고쳐도 유지돼요.</div>'));
  box.appendChild(s);
}

function typeName(n) {
  if (n.type === 'shape') return SHAPE_NAME[n.shape] || '도형';
  if (n.type === 'connector' && !n.from && !n.to && n.startCap === 'none') return n.endCap === 'arrow' ? '화살표' : '선';
  return { text: '글', image: '이미지', table: '표', shape: '도형', connector: '연결선', description: 'Description', hotspot: '인터랙션 영역', group: '그룹', instance: '인스턴스' }[n.type];
}

function nodeInspector(box, nodes) {
  const ids = nodes.map((n) => n.id);
  const n0 = nodes[0];
  const single = nodes.length === 1 ? n0 : null;
  const type = same(nodes, (n) => n.type);
  const s = section(single ? (TYPE_ICON[n0.type] + ' ' + typeName(n0)) : `${nodes.length}개 선택`, single && n0.type === 'instance' ? '<span class="tag">인스턴스</span>' : '');
  if (single) s.appendChild(row('이름', textField(n0.name, ids, 'name', { label: '이름 바꾸기' })));
  const b = O.selectionBox(E.idx, ids);
  if (single && !['group', 'connector'].includes(n0.type)) {
    const g = el('<div class="grid2"></div>');
    g.appendChild(numField('X', n0.x, ids, 'x', { label: '위치' }));
    g.appendChild(numField('Y', n0.y, ids, 'y', { label: '위치' }));
    if (n0.type !== 'description') {
      g.appendChild(numField('W', n0.w, ids, 'w', { label: '크기', extra: (v) => (n0.type === 'table' ? [{ op: 'set', id: n0.id, key: 'cols', value: n0.cols.map((c) => O.R(c * v / n0.w)) }] : []) }));
      g.appendChild(numField('H', n0.h, ids, 'h', { label: '크기' }));
      if (n0.type !== 'table') g.appendChild(numField('↻', n0.rotation || 0, ids, 'rotation', { label: '회전', map: (v) => { v = ((v % 360) + 360) % 360; return v || undefined; }, allowEmpty: true }));
    }
    s.appendChild(g);
  } else if (b) {
    s.appendChild(el(`<div class="muted" style="margin-bottom:6px">X ${Math.round(b.x)} · Y ${Math.round(b.y)} · ${Math.round(b.w)} × ${Math.round(b.h)}</div>`));
  }
  const vis = el('<div class="btns"></div>');
  vis.appendChild(btn(nodes.every((n) => n.hidden) ? '⊘ 숨김' : '👁 보임', '숨기기/보이기', () => { const h = !nodes.every((n) => n.hidden); Ed.commit(ids.map((id) => ({ op: 'set', id, key: 'hidden', value: h || undefined })), '숨기기'); }));
  vis.appendChild(btn(nodes.every((n) => n.locked) ? '🔒 잠김' : '🔓 잠금', '잠그면 캔버스에서 눌리지 않습니다 (레이어에서 선택)', () => { const l = !nodes.every((n) => n.locked); Ed.commit(ids.map((id) => ({ op: 'set', id, key: 'locked', value: l || undefined })), '잠금'); }));
  const op = same(nodes, (n) => (n.opacity == null ? 1 : n.opacity));
  const of = numField('불투명%', op == null ? '' : Math.round(op * 100), ids, 'opacity', { map: (v) => { v = Math.max(0, Math.min(100, v)) / 100; return v === 1 ? undefined : v; }, allowEmpty: true, label: '불투명도' });
  of.style.maxWidth = '120px';
  vis.appendChild(of);
  s.appendChild(vis);
  // 서식 복사 · 붓
  const fm = el('<div class="btns" style="margin-top:6px"></div>');
  fm.appendChild(btn('🖌 서식 붓', '이 서식을 다음에 누르는 요소에 입히기', () => Ed.startPainter()));
  fm.appendChild(btn('서식 복사', 'Ctrl+Shift+C', () => Ed.copyFormat()));
  if (E.fmt) fm.appendChild(btn('서식 붙여넣기', 'Ctrl+Shift+V', () => Ed.pasteFormat()));
  s.appendChild(fm);
  box.appendChild(s);

  if (type === 'text') textInspector(box, nodes, ids);
  if (type === 'shape') shapeInspector(box, nodes, ids);
  if (single && type === 'image') imageInspector(box, n0);
  if (single && type === 'table') tableInspector(box, n0);
  if (type === 'connector') connectorInspector(box, nodes, ids);
  if (single && type === 'description') descInspector(box, n0);
  if (single && type === 'hotspot') hotspotInspector(box, n0);
  if (single && type === 'instance') instanceInspector(box, n0);

  // 정렬 · 간격 · 크기
  const al = section('정렬 · 간격', nodes.length === 1 ? '본문 영역 기준' : '선택 영역 기준');
  const ab = el('<div class="btns"></div>');
  [['left', '⇤', '왼쪽 (Alt+A)'], ['hcenter', '↔', '가로 가운데 (Alt+H)'], ['right', '⇥', '오른쪽 (Alt+D)'], ['top', '⤒', '위 (Alt+W)'], ['vcenter', '↕', '세로 가운데 (Alt+V)'], ['bottom', '⤓', '아래 (Alt+S)']]
    .forEach(([m, i, t]) => ab.appendChild(btn(i, t, () => Ed.align(m))));
  al.appendChild(ab);
  if (nodes.length >= 2) {
    const sb = el('<div class="btns" style="margin-top:6px"></div>');
    sb.appendChild(btn('같은 너비', '가장 큰 것에 맞춤', () => Ed.sameSize('w')));
    sb.appendChild(btn('같은 높이', '가장 큰 것에 맞춤', () => Ed.sameSize('h')));
    sb.appendChild(btn('같은 크기', '가장 큰 것에 맞춤', () => Ed.sameSize('both')));
    al.appendChild(sb);
  }
  if (nodes.length >= 3) {
    const db = el('<div class="btns" style="margin-top:6px"></div>');
    db.appendChild(btn('⇹ 가로 간격 같게', '가로 간격 같게', () => Ed.distribute('h'), 'wide'));
    db.appendChild(btn('⇳ 세로 간격 같게', '세로 간격 같게', () => Ed.distribute('v'), 'wide'));
    al.appendChild(db);
  }
  box.appendChild(al);

  const ar = section('정리');
  const zb = el('<div class="btns"></div>');
  zb.appendChild(btn('⤒ 맨 앞', '맨 앞으로 (Ctrl+Shift+])', () => Ed.zorder('front')));
  zb.appendChild(btn('↑ 앞', '앞으로 (Ctrl+])', () => Ed.zorder('forward')));
  zb.appendChild(btn('↓ 뒤', '뒤로 (Ctrl+[)', () => Ed.zorder('backward')));
  zb.appendChild(btn('⤓ 맨 뒤', '맨 뒤로 (Ctrl+Shift+[)', () => Ed.zorder('back')));
  ar.appendChild(zb);
  const gb = el('<div class="btns" style="margin-top:6px"></div>');
  gb.appendChild(btn('▤ 그룹', '그룹 (Ctrl+G)', () => Ed.groupSelection()));
  if (nodes.some((n) => n.type === 'group')) gb.appendChild(btn('그룹 해제', '그룹 해제 (Ctrl+Shift+G)', () => Ed.ungroupSelection()));
  gb.appendChild(btn('◇ 컴포넌트로', '컴포넌트 만들기 (Ctrl+Alt+K)', () => Ed.makeComponent()));
  gb.appendChild(btn('⧉ 복제', '복제 (Ctrl+D)', () => Ed.duplicate()));
  gb.appendChild(btn('🗑', '삭제 (Delete)', () => Ed.deleteSelection(), 'danger'));
  ar.appendChild(gb);
  box.appendChild(ar);
}

function textInspector(box, nodes, ids) {
  const s = section('글');
  const v = (k, d) => { const x = same(nodes, (n) => (n.style || {})[k]); return x == null ? d : x; };
  s.appendChild(row('글꼴', selectField(v('font', 'm'), Object.entries(FONT_NAMES), ids, 'style.font', { label: '글꼴' })));
  const g = el('<div class="grid2"></div>');
  g.appendChild(numField('pt', v('size', 12), ids, 'style.size', { label: '글자 크기' }));
  g.appendChild(numField('줄', v('lineHeight', 1.35), ids, 'style.lineHeight', { label: '줄 간격' }));
  g.appendChild(numField('자간', v('letter', 0), ids, 'style.letter', { label: '글자 간격', map: (x) => x || undefined, allowEmpty: true }));
  g.appendChild(numField('단락↕', v('paraSpace', 0), ids, 'style.paraSpace', { label: '단락 간격', map: (x) => x || undefined, allowEmpty: true }));
  s.appendChild(g);
  s.appendChild(row('색', colorField(v('color', '#111111'), ids, 'style.color', { label: '글자 색', noNone: true })));
  s.appendChild(row('배경', colorField(v('bg', 'none'), ids, 'style.bg', { label: '글 배경', apply: (val, merge) => Ed.commit(ids.map((id) => ({ op: 'set', id, key: 'style.bg', value: val === 'none' ? undefined : val })), '글 배경', merge) })));
  s.appendChild(row('테두리', colorField(v('border', 'none'), ids, 'style.border', { label: '글 상자 테두리', apply: (val, merge) => Ed.commit(ids.map((id) => ({ op: 'set', id, key: 'style.border', value: val === 'none' ? undefined : val })), '글 테두리', merge) })));
  const b = el('<div class="btns"></div>');
  const tog = (k, lab, title) => { const on = nodes.every((n) => (n.style || {})[k]); b.appendChild(btn(lab, title, () => Ed.commit(ids.map((id) => ({ op: 'set', id, key: 'style.' + k, value: on ? undefined : true })), title), on ? 'on' : '')); };
  tog('bold', '<b>B</b>', '굵게'); tog('italic', '<i>I</i>', '기울임'); tog('underline', '<u>U</u>', '밑줄');
  ['left', 'center', 'right', 'justify'].forEach((a) => { const on = v('align', 'left') === a; b.appendChild(keepBtn({ left: '⯇', center: '≡', right: '⯈', justify: '☰' }[a], { left: '왼쪽', center: '가운데', right: '오른쪽', justify: '양쪽' }[a] + ' 맞춤', () => { if (!Ed.editingParaCommand('align', a)) Ed.commit(ids.map((id) => ({ op: 'set', id, key: 'style.align', value: a })), '글 정렬'); }, on ? 'on' : '')); });
  ['top', 'middle', 'bottom'].forEach((a) => { const on = v('valign', 'top') === a; b.appendChild(btn({ top: '⊤', middle: '⊝', bottom: '⊥' }[a], { top: '위', middle: '가운데', bottom: '아래' }[a] + ' 세로 맞춤', () => Ed.commit(ids.map((id) => ({ op: 'set', id, key: 'style.valign', value: a })), '세로 정렬'), on ? 'on' : '')); });
  tog('nowrap', '↛', '줄바꿈 안 함'); tog('shadow', 'S', '글자 그림자'); tog('vertical', '⫶', '세로쓰기');
  s.appendChild(b);
  // 목록 · 수준
  const lb = el('<div class="btns" style="margin-top:6px"></div>');
  lb.appendChild(keepBtn('• 글머리', '글머리 기호 (Ctrl+Shift+8)', () => { if (!Ed.editingParaCommand('list', 'bullet')) Ed.commit(nodes.flatMap((n) => O.opsListAll(n, 'bullet')), '글머리 기호'); }));
  lb.appendChild(keepBtn('1. 번호', '번호 매기기 (Ctrl+Shift+7)', () => { if (!Ed.editingParaCommand('list', 'number')) Ed.commit(nodes.flatMap((n) => O.opsListAll(n, 'number')), '번호 매기기'); }));
  lb.appendChild(keepBtn('⇤', '내어쓰기 (Shift+Tab)', () => { if (!Ed.editingParaCommand('indent', -1)) Ed.commit(nodes.flatMap((n) => O.opsIndentAll(n, -1)), '내어쓰기'); }));
  lb.appendChild(keepBtn('⇥', '들여쓰기 (Tab)', () => { if (!Ed.editingParaCommand('indent', 1)) Ed.commit(nodes.flatMap((n) => O.opsIndentAll(n, 1)), '들여쓰기'); }));
  s.appendChild(lb);
  // 자동 맞춤 · 여백
  const fit = v('fit', '');
  s.appendChild(row('자동 맞춤', selectField(fit || '', [['', '안 함 (상자 크기 고정)'], ['grow', '글에 맞춰 상자 크기 조정'], ['shrink', '넘치면 글자 줄이기']], ids, 'style.fit', { label: '자동 맞춤', emptyUndefined: true, allowEmpty: true })));
  const pad = v('pad', 0);
  s.appendChild(row('안쪽 여백', numField('px', Array.isArray(pad) ? pad[0] : pad, ids, 'style.pad', { label: '안쪽 여백', map: (x) => x || undefined, allowEmpty: true })));
  if (nodes.length === 1) s.appendChild(el('<div class="muted" style="margin-top:6px">편집 중: Enter 새 단락 · Shift+Enter 줄바꿈 · Tab 들여쓰기 · Ctrl+B/I/U · Ctrl+= 위첨자 · Ctrl+K 링크</div>'));
  box.appendChild(s);
}

function shapeInspector(box, nodes, ids) {
  const s = section('도형');
  const v = (k, d) => { const x = same(nodes, (n) => n[k]); return x == null ? d : x; };
  s.appendChild(row('모양', selectField(v('shape', 'rect'), SHAPES.map(([k, name, g]) => [k, g + ' · ' + name]), ids, 'shape', { label: '모양 바꾸기', extra: (k) => (/^callout/.test(k) ? nodes.filter((n) => !n.tail).map((n) => ({ op: 'set', id: n.id, key: 'tail', value: [.22, 1.35] })) : []) })));
  s.appendChild(row('채우기', colorField(v('fill', '#ffffff'), ids, 'fill', { label: '채우기' })));
  const gr = same(nodes, (n) => n.gradient || null);
  s.appendChild(row('그라데이션', colorField(gr ? gr.to : 'none', ids, 'gradient', { label: '그라데이션', apply: (val, merge) => Ed.commit(ids.map((id) => ({ op: 'set', id, key: 'gradient', value: val === 'none' ? undefined : { to: val, angle: (gr && gr.angle) || 90 } })), '그라데이션', merge) })));
  if (gr) s.appendChild(row('방향', numField('°', gr.angle == null ? 90 : gr.angle, ids, 'gradient.angle', { label: '그라데이션 방향' })));
  s.appendChild(row('선', colorField(v('stroke', '#9aa3ad'), ids, 'stroke', { label: '선 색' })));
  const g = el('<div class="grid2"></div>');
  g.appendChild(numField('두께', v('strokeWidth', 1), ids, 'strokeWidth', { label: '선 두께' }));
  g.appendChild(numField('모서리', v('radius', 0), ids, 'radius', { label: '모서리' }));
  g.appendChild(numField('채움%', Math.round((v('fillOpacity', 1)) * 100), ids, 'fillOpacity', { label: '채우기 투명도', map: (x) => { x = Math.max(0, Math.min(100, x)) / 100; return x === 1 ? undefined : x; }, allowEmpty: true }));
  g.appendChild(selectField(v('dash', 'solid') || 'solid', [['solid', '실선'], ['dash', '점선'], ['dot', '점'], ['long', '긴 점선'], ['dashdot', '1점 쇄선']], ids, 'dash', { label: '선 종류' }));
  s.appendChild(g);
  const fb = el('<div class="btns"></div>');
  const tog = (k, lab, title) => { const on = nodes.every((n) => n[k]); fb.appendChild(btn(lab, title, () => Ed.commit(ids.map((id) => ({ op: 'set', id, key: k, value: on ? undefined : true })), title), on ? 'on' : '')); };
  tog('shadow', '◪ 그림자', '그림자'); tog('flipH', '⇋ 좌우', '좌우 뒤집기'); tog('flipV', '⇵ 상하', '상하 뒤집기');
  s.appendChild(fb);
  const n0 = nodes[0];
  if (nodes.length === 1 && /^callout/.test(n0.shape)) {
    const t = n0.tail || [.22, 1.35];
    const tg = el('<div class="grid2" style="margin-top:6px"></div>');
    tg.appendChild(numField('꼬리X%', Math.round(t[0] * 100), [n0.id], 'tail.0', { label: '말풍선 꼬리', map: (x) => x / 100 }));
    tg.appendChild(numField('꼬리Y%', Math.round(t[1] * 100), [n0.id], 'tail.1', { label: '말풍선 꼬리', map: (x) => x / 100 }));
    s.appendChild(tg);
    s.appendChild(el('<div class="muted">노란 손잡이를 끌어 꼬리 위치를 바꿀 수 있어요.</div>'));
  }
  if (nodes.some((n) => n.runs && M.plainText(n.runs))) {
    const vs = (k, d) => { const x = same(nodes, (n) => (n.style || {})[k]); return x == null ? d : x; };
    const g2 = el('<div class="grid2" style="margin-top:6px"></div>');
    g2.appendChild(numField('pt', vs('size', 12), ids, 'style.size', { label: '라벨 크기' }));
    g2.appendChild(colorField(vs('color', '#111111'), ids, 'style.color', { label: '라벨 색', noNone: true }));
    s.appendChild(g2);
    const lb = el('<div class="btns" style="margin-top:6px"></div>');
    lb.appendChild(btn('<b>B</b>', '라벨 굵게', () => Ed.commit(ids.map((id) => ({ op: 'set', id, key: 'style.bold', value: nodes.every((n) => (n.style || {}).bold) ? undefined : true })), '라벨 굵게'), nodes.every((n) => (n.style || {}).bold) ? 'on' : ''));
    lb.appendChild(btn('• 목록', '글머리 기호', () => Ed.commit(nodes.flatMap((n) => O.opsListAll(n, 'bullet')), '글머리 기호')));
    ['top', 'middle', 'bottom'].forEach((a) => lb.appendChild(btn({ top: '⊤', middle: '⊝', bottom: '⊥' }[a], '세로 맞춤', () => Ed.commit(ids.map((id) => ({ op: 'set', id, key: 'style.valign', value: a })), '세로 정렬'), (vs('valign', 'middle') === a) ? 'on' : '')));
    s.appendChild(lb);
  }
  s.appendChild(el('<div class="muted" style="margin-top:6px">더블클릭하면 도형 안에 글(라벨)을 쓸 수 있어요. 위쪽 동그란 손잡이로 돌리기 (Shift: 15°).</div>'));
  box.appendChild(s);
}

function imageInspector(box, n) {
  const s = section('이미지');
  const a = E.doc.assets[n.asset];
  if (a) s.appendChild(el(`<div class="muted" style="margin-bottom:6px">${esc(a.name || n.asset)} · 원본 ${a.w || '?'}×${a.h || '?'}</div>`));
  const cb = el('<div class="btns"></div>');
  cb.appendChild(btn(E.crop === n.id ? '✓ 자르기 끝내기' : '✂ 자르기', '더블클릭으로도 시작 · Enter로 끝내기', () => (E.crop === n.id ? Ed.exitCrop() : Ed.enterCrop(n.id)), E.crop === n.id ? 'primary wide' : 'wide'));
  if (n.crop) cb.appendChild(btn('자르기 취소', '원본 전체로', () => {
    const c = n.crop, fw = n.w / (1 - (c.l || 0) - (c.r || 0)), fh = n.h / (1 - (c.t || 0) - (c.b || 0));
    Ed.commit([{ op: 'set', id: n.id, key: 'crop' }, { op: 'set', id: n.id, key: 'x', value: O.R(n.x - (c.l || 0) * fw) }, { op: 'set', id: n.id, key: 'y', value: O.R(n.y - (c.t || 0) * fh) }, { op: 'set', id: n.id, key: 'w', value: O.R(fw) }, { op: 'set', id: n.id, key: 'h', value: O.R(fh) }], '자르기 취소');
  }, 'wide'));
  s.appendChild(cb);
  s.appendChild(row('모양', selectField(n.mask || '', [['', '사각형'], ['ellipse', '원 (타원)']], [n.id], 'mask', { label: '이미지 모양', emptyUndefined: true, allowEmpty: true })));
  const g = el('<div class="grid2"></div>');
  g.appendChild(numField('모서리', n.radius || 0, [n.id], 'radius', { label: '모서리', map: (x) => x || undefined, allowEmpty: true }));
  g.appendChild(numField('테두리', n.strokeWidth || 0, [n.id], 'strokeWidth', { label: '테두리 두께', extra: (x) => (x && !n.stroke ? [{ op: 'set', id: n.id, key: 'stroke', value: '#c7ccd3' }] : []) }));
  s.appendChild(g);
  if (n.strokeWidth) s.appendChild(row('테두리 색', colorField(n.stroke || '#c7ccd3', [n.id], 'stroke', { label: '테두리 색' })));
  s.appendChild(row('맞춤', selectField(n.fit || 'contain', [['contain', '비율 유지 (안에 맞춤)'], ['cover', '비율 유지 (채우기)'], ['fill', '늘이기']], [n.id], 'fit', { label: '이미지 맞춤' })));
  s.appendChild(row('혼합', selectField(n.blend || '', [['', '보통'], ['multiply', '곱하기 (흰색 투명)']], [n.id], 'blend', { label: '혼합 모드', emptyUndefined: true, allowEmpty: true })));
  const fb = el('<div class="btns"></div>');
  const tog = (k, lab, title) => fb.appendChild(btn(lab, title, () => Ed.commit([{ op: 'set', id: n.id, key: k, value: n[k] ? undefined : true }], title), n[k] ? 'on' : ''));
  tog('shadow', '◪ 그림자', '그림자'); tog('flipH', '⇋ 좌우', '좌우 뒤집기'); tog('flipV', '⇵ 상하', '상하 뒤집기');
  s.appendChild(fb);
  const b = el('<div class="btns" style="margin-top:6px"></div>');
  b.appendChild(btn('이미지 교체', '파일에서 교체', () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    i.onchange = async () => { const im = await store.readImageFile(i.files[0]); const aid = M.uid('img'); Ed.commit([{ op: 'set', id: 'doc', key: 'assets.' + aid, value: { mime: im.mime, data: im.data, w: im.w, h: im.h, name: im.name } }, { op: 'set', id: n.id, key: 'asset', value: aid }], '이미지 교체'); };
    i.click();
  }, 'wide'));
  if (a && a.w && !n.crop) b.appendChild(btn('원본 비율', '원본 가로세로 비율로', () => Ed.commit([{ op: 'set', id: n.id, key: 'h', value: O.R(n.w * a.h / a.w) }], '원본 비율'), 'wide'));
  s.appendChild(b);
  box.appendChild(s);
}

function tableInspector(box, n) {
  const s = section('표', `${n.rows.length}행 × ${n.cols.length}열`);
  const st = n.style || {};
  s.appendChild(row('테두리', selectField(st.border || 'grid', [['grid', '격자'], ['hlines', '가로줄만'], ['dotted', '점선 (개정 이력)'], ['none', '없음']], [n.id], 'style.border', { label: '표 테두리' })));
  const g = el('<div class="grid2"></div>');
  g.appendChild(numField('pt', st.size || 9, [n.id], 'style.size', { label: '표 글자 크기' }));
  g.appendChild(colorField(st.borderColor || '#bfbfbf', [n.id], 'style.borderColor', { label: '선 색', noNone: true }));
  s.appendChild(g);
  // 표 스타일 프리셋
  const ps = el('<div class="btns"></div>');
  const preset = (lab, title, fn) => ps.appendChild(btn(lab, title, () => Ed.commit(fn(), '표 스타일')));
  preset('머리글 회색', '첫 행 회색 · 굵게', () => n.rows[0].cells.map((c, i) => c && [{ op: 'set', id: n.id, key: `rows.0.cells.${i}.bg`, value: '#d9d9d9' }, { op: 'set', id: n.id, key: `rows.0.cells.${i}.bold`, value: true }]).filter(Boolean).flat());
  preset('머리글 블루', '첫 행 테마 블루', () => n.rows[0].cells.map((c, i) => c && [{ op: 'set', id: n.id, key: `rows.0.cells.${i}.bg`, value: 'theme:primary' }, { op: 'set', id: n.id, key: `rows.0.cells.${i}.color`, value: '#ffffff' }, { op: 'set', id: n.id, key: `rows.0.cells.${i}.bold`, value: true }]).filter(Boolean).flat());
  preset('줄무늬', '짝수 행 연한 회색', () => n.rows.flatMap((r, y) => (y > 0 ? r.cells.map((c, x) => c && { op: 'set', id: n.id, key: `rows.${y}.cells.${x}.bg`, value: y % 2 === 0 ? '#f5f6f8' : undefined }).filter(Boolean) : [])));
  preset('첫 열 굵게', '첫 열 굵게 · 회색', () => n.rows.flatMap((r, y) => (r.cells[0] && y > 0 ? [{ op: 'set', id: n.id, key: `rows.${y}.cells.0.bold`, value: true }, { op: 'set', id: n.id, key: `rows.${y}.cells.0.bg`, value: '#f2f2f2' }] : [])));
  s.appendChild(ps);
  const rg = Ed.cellRange && E.cell && E.cell.id === n.id ? Ed.cellRange() : null;
  const b = el('<div class="btns" style="margin-top:6px"></div>');
  const at = rg || { r0: n.rows.length - 1, c0: n.cols.length - 1, r1: n.rows.length - 1, c1: n.cols.length - 1 };
  const run = (a) => () => Ed.commit(O.opsTable(n, a, a === 'rowBelow' ? at.r1 : at.r0, a === 'colRight' ? at.c1 : at.c0), '표 편집');
  b.appendChild(btn('행 ↑', '위에 행 추가', run('rowAbove')));
  b.appendChild(btn('행 ↓', '아래에 행 추가', run('rowBelow')));
  b.appendChild(btn('열 ←', '왼쪽에 열 추가', run('colLeft')));
  b.appendChild(btn('열 →', '오른쪽에 열 추가', run('colRight')));
  b.appendChild(btn('행 삭제', '고른 행 삭제', run('rowDelete'), 'danger'));
  b.appendChild(btn('열 삭제', '고른 열 삭제', run('colDelete'), 'danger'));
  s.appendChild(b);
  const eq = el('<div class="btns" style="margin-top:6px"></div>');
  eq.appendChild(btn('열 너비 같게', rg ? '고른 열끼리' : '모든 열', () => Ed.commit(O.opsTableEqualize(n, 'cols', rg && rg.c1 > rg.c0 ? { c0: rg.c0, c1: rg.c1 } : null), '열 너비 같게')));
  eq.appendChild(btn('행 높이 같게', rg ? '고른 행끼리' : '모든 행', () => Ed.commit(O.opsTableEqualize(n, 'rows', rg && rg.r1 > rg.r0 ? { r0: rg.r0, r1: rg.r1 } : null), '행 높이 같게')));
  s.appendChild(eq);
  if (n.cols.length === 6 && n.rows[0].cells[0] && M.plainText(n.rows[0].cells[0].runs) === 'No.') {
    s.appendChild(el('<div style="height:6px"></div>'));
    s.appendChild(btn('📌 리비전 행 추가', '다음 번호 · 버전 · 오늘 날짜로 한 줄 추가', () => addRevisionRow(n), 'primary wide'));
  }
  if (rg) {
    const k = n.rows[rg.r0].cells[rg.c0] || {};
    const many = rg.r1 > rg.r0 || rg.c1 > rg.c0;
    s.appendChild(el(`<div class="muted" style="margin:10px 0 6px">고른 칸: ${rg.r0 + 1}${many ? '~' + (rg.r1 + 1) : ''}행 ${rg.c0 + 1}${many ? '~' + (rg.c1 + 1) : ''}열 — 끌거나 Shift+클릭으로 범위, Enter로 편집, 엑셀 붙여넣기 가능</div>`));
    const mb = el('<div class="btns"></div>');
    if (many) mb.appendChild(btn('⊞ 셀 병합', '고른 칸 합치기', () => { if (Ed.commit(O.opsTableMerge(n, rg), '셀 병합')) { E.cell = { id: n.id, r: rg.r0, c: rg.c0, r2: rg.r0, c2: rg.c0 }; } }, 'primary'));
    if (k.span) mb.appendChild(btn('⊟ 셀 분할', '병합 풀기', () => Ed.commit(O.opsTableSplit(n, rg.r0, rg.c0), '셀 분할')));
    s.appendChild(mb);
    const cellSet = (key, value, label) => Ed.commit(O.opsCells(n, rg, key, value), label);
    s.appendChild(row('칸 배경', colorField(k.bg || 'none', [n.id], 'cells.bg', { label: '칸 배경', apply: (val) => cellSet('bg', val === 'none' ? undefined : val, '칸 배경') })));
    s.appendChild(row('글자 색', colorField(k.color || 'none', [n.id], 'cells.color', { label: '칸 글자 색', apply: (val) => cellSet('color', val === 'none' ? undefined : val, '칸 글자 색') })));
    const cb = el('<div class="btns"></div>');
    ['left', 'center', 'right'].forEach((a) => cb.appendChild(btn({ left: '⯇', center: '≡', right: '⯈' }[a], { left: '왼쪽', center: '가운데', right: '오른쪽' }[a], () => cellSet('align', a, '칸 정렬'), (k.align || 'left') === a ? 'on' : '')));
    ['top', 'middle', 'bottom'].forEach((a) => cb.appendChild(btn({ top: '⊤', middle: '⊝', bottom: '⊥' }[a], { top: '위', middle: '가운데', bottom: '아래' }[a] + ' 세로 맞춤', () => cellSet('valign', a === 'middle' ? undefined : a, '칸 세로 정렬'), (k.valign || 'middle') === a ? 'on' : '')));
    cb.appendChild(btn('<b>B</b>', '굵게', () => cellSet('bold', k.bold ? undefined : true, '칸 굵게'), k.bold ? 'on' : ''));
    s.appendChild(cb);
    const sz = el('<div class="grid2" style="margin-top:6px"></div>');
    sz.appendChild(numField('열너비', n.cols[rg.c0], [n.id], 'cols.' + rg.c0, { label: '열 너비', extra: (v) => [{ op: 'set', id: n.id, key: 'w', value: O.R(n.cols.reduce((a2, w, i) => a2 + (i === rg.c0 ? v : w), 0)) }] }));
    sz.appendChild(numField('행높이', n.rows[rg.r0].h, [n.id], `rows.${rg.r0}.h`, { label: '행 높이' }));
    s.appendChild(sz);
  } else s.appendChild(el('<div class="muted" style="margin-top:8px">표를 고른 상태에서 칸을 누르면 칸 단위로 고칠 수 있어요. 끌면 여러 칸, 경계선을 끌면 너비 · 높이 조절.</div>'));
  box.appendChild(s);
}

function addRevisionRow(n) {
  const filled = n.rows.filter((r, i) => i > 0 && r.cells[0] && M.plainText(r.cells[0].runs).trim());
  const last = filled[filled.length - 1];
  const no = last ? (parseInt(M.plainText(last.cells[0].runs), 10) || filled.length) + 1 : 1;
  const prevVer = last ? parseFloat(M.plainText(last.cells[1].runs)) : 0;
  const ver = last ? (Math.round((prevVer + .1) * 10) / 10).toFixed(1) : (E.doc.meta.version || '0.1');
  const change = prompt('변경 내용', '');
  if (change == null) return;
  const rows = M.clone(n.rows);
  let target = rows.findIndex((r, i) => i > 0 && !r.cells.some((k) => k && M.plainText(k.runs).trim()));
  if (target < 0) { rows.push({ h: 23, cells: rows[1].cells.map((k) => ({ runs: [{ t: '' }], align: k && k.align })) }); target = rows.length - 1; }
  const vals = [String(no), ver, M.today(), change, E.doc.meta.author || '', ''];
  vals.forEach((v, i) => { rows[target].cells[i] = Object.assign({}, rows[target].cells[i], { runs: [{ t: v }] }); });
  Ed.commit([{ op: 'set', id: n.id, key: 'rows', value: rows }, { op: 'set', id: 'doc', key: 'meta.version', value: ver }, { op: 'set', id: 'doc', key: 'meta.date', value: M.today() }], '리비전 행 추가');
}

function connectorInspector(box, nodes, ids) {
  const s = section(nodes.length === 1 ? typeName(nodes[0]) : '선');
  const v = (k, d) => { const x = same(nodes, (n) => n[k]); return x == null ? d : x; };
  s.appendChild(row('색', colorField(v('stroke', '#e53935'), ids, 'stroke', { label: '선 색', noNone: true })));
  const g = el('<div class="grid2"></div>');
  g.appendChild(numField('두께', v('width', 1), ids, 'width', { label: '선 두께' }));
  g.appendChild(selectField(v('dash', 'dash'), [['solid', '실선'], ['dash', '점선'], ['dot', '점'], ['long', '긴 점선'], ['dashdot', '1점 쇄선']], ids, 'dash', { label: '선 종류' }));
  s.appendChild(g);
  s.appendChild(row('경로', selectField(v('route', 'straight'), [['straight', '직선'], ['elbow', '꺾은선']], ids, 'route', { label: '경로' })));
  const g2 = el('<div class="grid2"></div>');
  g2.appendChild(selectField(v('startCap', 'none') || 'none', CAPS.map(([k, l]) => [k, '시작: ' + l]), ids, 'startCap', { label: '시작 모양' }));
  g2.appendChild(selectField(v('endCap', 'none') || 'none', CAPS.map(([k, l]) => [k, '끝: ' + l]), ids, 'endCap', { label: '끝 모양' }));
  s.appendChild(g2);
  s.appendChild(row('머리 크기', numField('×', v('capSize', 1), ids, 'capSize', { label: '화살표 크기', map: (x) => (x === 1 ? undefined : Math.max(.3, x)), allowEmpty: true })));
  if (nodes.length === 1) {
    const n = nodes[0];
    const SIDE = { n: '위', e: '오른쪽', s: '아래', w: '왼쪽' };
    const name = (r) => (r && r.node && E.idx.get(r.node) ? E.idx.get(r.node).name + (r.side ? ` (${SIDE[r.side]})` : '') : '고정점');
    s.appendChild(el(`<div class="muted">시작: <b>${esc(name(n.from))}</b> → 끝: <b>${esc(name(n.to))}</b><br>끝점을 요소 위로 끌면 붙어요. 상하좌우 연결점(초록 점) 가까이 놓으면 그 점에 고정되고, 꺾은선이 그 방향으로 나갑니다.</div>`));
  }
  box.appendChild(s);
}

function descInspector(box, n) {
  const s = section('Description', '화면 설계 오른쪽 패널에 자동 정리');
  const g = el('<div class="grid2"></div>');
  g.appendChild(numField('No', n.num, [n.id], 'num', { label: '번호', extra: (v) => (n.name === 'Description ' + n.num ? [{ op: 'set', id: n.id, key: 'name', value: 'Description ' + v }] : []) }));
  g.appendChild(colorField(n.color || '#e53935', [n.id], 'color', { label: '색', noNone: true }));
  s.appendChild(g);
  if (n.marker === false) {
    s.appendChild(el('<div class="muted" style="margin-bottom:6px">이 번호는 화면에 표시돼 있지 않고 오른쪽 Description 패널에만 보여요.</div>'));
    s.appendChild(btn('① 화면에 번호 표시', '본문 영역 왼쪽 위에 번호를 꺼내 놓아요 · 원하는 자리로 끌어 옮기세요', () => {
      const f = E.idx.containerOf(n.id);
      const cb = (LAYOUT_INFO[f && f.layout] || LAYOUT_INFO.screen).content;
      Ed.commit([{ op: 'set', id: n.id, key: 'marker' }, { op: 'set', id: n.id, key: 'x', value: cb.x + 10 }, { op: 'set', id: n.id, key: 'y', value: cb.y + 10 + ((n.num || 1) - 1) % 10 * 20 }], '번호 표시');
    }, 'primary wide'));
  } else s.appendChild(btn('화면에서 번호 숨기기', '패널에만 남기기', () => Ed.commit([{ op: 'set', id: n.id, key: 'marker', value: false }], '번호 숨기기'), 'wide'));
  s.appendChild(row('제목', textField(n.title, [n.id], 'title', { label: 'Description 제목' })));
  s.querySelector('[data-k$="|title"]').id = 'insp-desc-title';
  const ta = el(`<textarea id="insp-desc-body" placeholder="설명 · 정책 · 예외 사항">${esc(n.body || '')}</textarea>`);
  ta.addEventListener('change', () => Ed.commit([{ op: 'set', id: n.id, key: 'body', value: ta.value }], 'Description 내용'));
  ta.addEventListener('keydown', (ev) => ev.stopPropagation());
  ta.addEventListener('blur', () => setTimeout(renderRight, 0));
  s.appendChild(ta);
  s.appendChild(el('<div class="muted" style="margin-top:6px">4단계에서 Description 단위로 QA 케이스 · Jira 티켓이 만들어질 예정이라, 한 번호에 한 가지 기능을 적는 것을 권장해요.</div>'));
  box.appendChild(s);
}

function hotspotInspector(box, n) {
  const s = section('인터랙션 영역', '미리보기(▶)에서 동작');
  const a = n.action || { type: 'none' };
  const t = selectField(a.type, [['none', '동작 없음'], ['goto', '다른 프레임으로 이동'], ['url', '링크 열기'], ['note', '메모 띄우기']], [n.id], 'action.type', { label: '인터랙션 동작' });
  t.querySelector('select').id = 'insp-hot-type';
  s.appendChild(row('동작', t));
  if (a.type === 'goto') {
    const frames = E.idx.frames();
    s.appendChild(row('대상', selectField(a.target || '', [['', '— 프레임 선택 —']].concat(frames.map((f, i) => [f.id, (i + 1) + 'P · ' + f.name])), [n.id], 'action.target', { label: '이동 대상' })));
  }
  if (a.type === 'url') s.appendChild(row('URL', textField(a.url, [n.id], 'action.url', { ph: 'https://' })));
  if (a.type === 'note') {
    const ta = el(`<textarea id="insp-hot-note" placeholder="눌렀을 때 보여줄 메모">${esc(a.note || '')}</textarea>`);
    ta.addEventListener('change', () => Ed.commit([{ op: 'set', id: n.id, key: 'action.note', value: ta.value }], '메모'));
    ta.addEventListener('keydown', (ev) => ev.stopPropagation());
    ta.addEventListener('blur', () => setTimeout(renderRight, 0));
    s.appendChild(ta);
  }
  box.appendChild(s);
}

function instanceInspector(box, n) {
  const comp = E.doc.components.find((c) => c.id === n.component);
  const s = section('컴포넌트 인스턴스', comp ? esc(comp.name) : '원본 없음');
  const ov = Object.keys(n.overrides || {}).length;
  s.appendChild(el(`<div class="muted" style="margin-bottom:8px">원본을 고치면 이 인스턴스도 함께 바뀝니다. 글자는 인스턴스 안에서 더블클릭해 따로 바꿀 수 있어요 (오버라이드 ${ov}개).</div>`));
  const b = el('<div class="btns"></div>');
  if (comp) b.appendChild(btn('✎ 원본 편집', '컴포넌트 원본 편집', () => Ed.editComponent(comp.id), 'primary wide'));
  if (ov) b.appendChild(btn('오버라이드 초기화', '원본 글자로 되돌리기', () => Ed.commit([{ op: 'set', id: n.id, key: 'overrides', value: {} }], '오버라이드 초기화'), 'wide'));
  if (comp) b.appendChild(btn('원본 크기', '원본 크기로', () => Ed.commit([{ op: 'set', id: n.id, key: 'w', value: comp.w }, { op: 'set', id: n.id, key: 'h', value: comp.h }], '원본 크기'), 'wide'));
  b.appendChild(btn('분리', '일반 그룹으로 바꾸기 (원본과 연결 끊기)', () => Ed.detachInstance(n.id), 'wide'));
  s.appendChild(b);
  if (comp && E.doc.components.length > 1) {
    s.appendChild(el('<div style="height:8px"></div>'));
    s.appendChild(row('바꾸기', selectField(comp.id, E.doc.components.map((c) => [c.id, c.name]), [n.id], 'component', { label: '다른 컴포넌트로', extra: () => [{ op: 'set', id: n.id, key: 'overrides', value: {} }] })));
  }
  box.appendChild(s);
}

// ---------- 찾기 · 바꾸기 ----------
let findState = { q: '', r: '', cs: false, i: 0 };
export function findDialog(replace) {
  Ed.finishEdit();
  let p = $('.find-panel');
  if (!p) {
    p = document.createElement('div');
    p.className = 'find-panel';
    p.innerHTML = `<div class="fp-row"><input class="fp-q" placeholder="찾을 내용"><span class="fp-cnt"></span><button data-f="prev" title="이전 (Shift+Enter)">↑</button><button data-f="next" title="다음 (Enter)">↓</button><button data-f="close" title="닫기 (Esc)">✕</button></div>
      <div class="fp-row fp-rep"><input class="fp-r" placeholder="바꿀 내용"><button data-f="one">바꾸기</button><button data-f="all">모두 바꾸기</button></div>
      <label class="fp-opt"><input type="checkbox" class="fp-cs"> 대소문자 구분</label><div class="fp-list"></div>`;
    $('#center').appendChild(p);
    const q = p.querySelector('.fp-q'), r = p.querySelector('.fp-r'), cs = p.querySelector('.fp-cs');
    q.value = findState.q; r.value = findState.r; cs.checked = findState.cs;
    const refresh = () => { findState.q = q.value; findState.cs = cs.checked; findState.i = 0; listMatches(p); };
    q.addEventListener('input', refresh);
    cs.addEventListener('change', refresh);
    r.addEventListener('input', () => { findState.r = r.value; });
    for (const inp of [q, r]) inp.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') p.remove();
      if (ev.key === 'Enter' && inp === q) step(p, ev.shiftKey ? -1 : 1);
      if (ev.key === 'Enter' && inp === r) replaceOne(p);
    });
    p.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-f]');
      if (b) { ({ prev: () => step(p, -1), next: () => step(p, 1), close: () => p.remove(), one: () => replaceOne(p), all: () => replaceAll(p) })[b.dataset.f](); return; }
      const it = ev.target.closest('[data-mi]');
      if (it) { findState.i = +it.dataset.mi; gotoMatch(p); }
    });
  }
  p.classList.toggle('with-rep', !!replace || p.classList.contains('with-rep'));
  const q = p.querySelector('.fp-q');
  q.focus(); q.select();
  listMatches(p);
}
function currentMatches() { return O.findMatches(E.doc, findState.q, { caseSensitive: findState.cs }); }
function listMatches(p) {
  const ms = currentMatches();
  p.querySelector('.fp-cnt').textContent = findState.q ? (ms.length ? `${Math.min(findState.i + 1, ms.length)}/${ms.length}` : '없음') : '';
  const list = p.querySelector('.fp-list');
  list.innerHTML = ms.slice(0, 80).map((m, i) => {
    const a = Math.max(0, m.index - 14), t = m.text;
    const pre = esc(t.slice(a, m.index)), hit = esc(t.substr(m.index, findState.q.length)), post = esc(t.slice(m.index + findState.q.length, m.index + findState.q.length + 24));
    return `<div class="fp-it ${i === findState.i ? 'on' : ''}" data-mi="${i}"><small>${esc(m.frameName)} · ${esc(m.name || '')}</small><span>${a ? '…' : ''}${pre}<mark>${hit}</mark>${post}</span></div>`;
  }).join('') + (ms.length > 80 ? `<div class="muted" style="padding:6px">… ${ms.length - 80}개 더</div>` : '');
}
function step(p, d) {
  const ms = currentMatches();
  if (!ms.length) return;
  findState.i = (findState.i + d + ms.length) % ms.length;
  gotoMatch(p);
}
function gotoMatch(p) {
  const ms = currentMatches();
  const m = ms[findState.i];
  if (!m) return;
  if (m.component) { if (E.compId !== m.frame) Ed.editComponent(m.frame); Ed.select([m.id]); listMatches(p); return; }
  if (E.compId) Ed.exitComponent();
  const pg = E.idx.pageOf(m.id);
  if (E.view !== 'canvas') Ed.setView('canvas');
  if (pg && pg.id !== E.pageId) Ed.gotoPage(pg.id);
  Ed.select([m.id]);
  if (m.cell) { E.cell = { id: m.id, r: m.cell[0], c: m.cell[1], r2: m.cell[0], c2: m.cell[1] }; Ed.select([m.id]); }
  Ed.scrollToFrame(m.frame);
  listMatches(p);
}
function replaceOne(p) {
  const ms = currentMatches();
  const m = ms[findState.i];
  if (!m) return;
  // 이 글 조각 안에서 지금 위치의 것 하나만
  const n = E.idx.get(m.id);
  let cur = n;
  for (const k of m.path.split('.')) cur = cur[/^\d+$/.test(k) ? +k : k];
  const next = cur.slice(0, m.index) + findState.r + cur.slice(m.index + findState.q.length);
  Ed.commit([{ op: 'set', id: m.id, key: m.path, value: next }], '바꾸기');
  setTimeout(() => listMatches(p), 30);
}
function replaceAll(p) {
  const ms = currentMatches();
  if (!ms.length) return;
  if (Ed.commit(O.opsReplace(E.idx, ms, findState.q, findState.r, { caseSensitive: findState.cs }), `모두 바꾸기 (${ms.length}곳)`)) Ed.toast(`${ms.length}곳을 바꿨어요. Ctrl+Z로 한 번에 되돌릴 수 있어요.`);
  setTimeout(() => listMatches(p), 30);
}

// ---------- 대화상자 ----------
export function closeModal() { const m = $('.modal-bg'); if (m) m.remove(); }
function modal(html, dismiss = true) {
  closeModal();
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  if (dismiss) bg.addEventListener('pointerdown', (ev) => { if (ev.target === bg && E.doc) closeModal(); });
  document.body.appendChild(bg);
  const onEsc = (ev) => { if (ev.key === 'Escape' && E.doc) { closeModal(); window.removeEventListener('keydown', onEsc, true); } };
  window.addEventListener('keydown', onEsc, true);
  return bg;
}

export async function home(e, first) {
  E = e;
  const bg = modal(`<header><h2>투네이션 상세기획서 스튜디오</h2><p>기획서양식.pdf 를 기본 템플릿으로, 문서 → 페이지 → 프레임 → 노드 구조의 JSON 문서를 편집합니다.</p></header>
    <div class="body">
      <h3>새로 만들기</h3><div class="tpl-grid" id="tpls"></div>
      <h3>PPTX · PDF 가져오기</h3>
      <div class="drop-zone" id="h-drop" tabindex="0"><b>⬆ 기획서 PPTX(또는 PDF)를 여기에 끌어다 놓거나 눌러서 고르세요</b><small>올리는 즉시 편집 가능한 문서(JSON)로 바뀌어 열려요 · 표지 · 개정 이력 · 화면 설계 등 페이지 종류는 자동 판별</small></div>
      <h3>열기</h3>
      <div class="actions"><button class="ib primary" id="h-open">📂 파일 열기 (.tnspec.json)</button><button class="ib" id="h-sample-pptx">📄 샘플: 채팅 기획서 (PPTX에서 가져옴)</button><button class="ib" id="h-sample">📄 샘플: 채팅 기획서 (PDF에서 가져옴)</button><button class="ib" id="h-import">PPTX · PDF → JSON 가져오기 방법</button></div>
      <h3>최근 문서 <small style="color:var(--tx3);font-weight:400">— 이 브라우저에 자동 저장된 문서</small></h3><div class="recent" id="recent"><div class="muted">불러오는 중…</div></div>
    </div>`, !first);
  const grid = bg.querySelector('#tpls');
  for (const t of DOC_TEMPLATES) {
    const doc = t.build();
    const idx = new M.DocIndex(doc);
    const f = doc.pages.map((p) => p.frames).flat().find((x) => x.layout === (t.id === 'policy' ? 'policy' : t.id === 'history' ? 'history' : t.id === 'blank' ? 'blank' : t.id === 'screen' ? 'screen' : 'cover'));
    const card = document.createElement('button');
    card.className = 'tpl';
    card.innerHTML = `<div class="th"></div><div class="tt"><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></div>`;
    const fr = renderFrame(f, { doc, idx, mode: 'present', pageNo: 1 });
    fr.style.transform = 'scale(' + (190 / 960) + ')';
    card.querySelector('.th').appendChild(fr);
    card.onclick = () => { closeModal(); Ed.openDoc(t.build()); };
    grid.appendChild(card);
  }
  bg.querySelector('#h-open').onclick = () => Ed.openFromFile();
  const dz = bg.querySelector('#h-drop');
  dz.onclick = () => pickImport();
  dz.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickImport(); } };
  dz.ondragover = (ev) => { ev.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (ev) => { ev.preventDefault(); ev.stopPropagation(); dz.classList.remove('over'); const f = [...ev.dataTransfer.files].find(isImportable); if (f) importFile(f); else Ed.toast('PPTX 또는 PDF 파일을 놓아 주세요.', true); };
  bg.querySelector('#h-import').onclick = () => importHelp();
  const sample = (file, label) => async () => {
    try {
      const r = await fetch('samples/' + file, { cache: 'no-store' });
      if (!r.ok) throw new Error('samples/' + file + ' 이 없습니다. 먼저 tools/ 의 가져오기 스크립트를 실행하세요.');
      const doc = M.load(await r.text());
      closeModal(); Ed.openDoc(doc); Ed.toast(label + '에서 가져온 문서를 열었어요 — 검증 통과');
    } catch (err) { Ed.toast(err.message, true); }
  };
  bg.querySelector('#h-sample').onclick = sample('chat-spec-v0.1.tnspec.json', 'PDF');
  bg.querySelector('#h-sample-pptx').onclick = sample('chat-spec-v0.1.pptx.tnspec.json', 'PPTX');
  const rc = bg.querySelector('#recent');
  try {
    const list = await store.listLocal();
    rc.innerHTML = list.length ? '' : '<div class="muted">아직 없습니다.</div>';
    for (const d of list.slice(0, 12)) {
      const r = document.createElement('div');
      r.className = 'rc';
      r.innerHTML = `<b>${esc(d.title)}</b><small>${new Date(d.updated).toLocaleString('ko-KR')} · ${(d.size / 1024).toFixed(0)}KB</small><button title="목록에서 삭제">✕</button>`;
      r.onclick = async (ev) => {
        if (ev.target.closest('button')) { if (confirm(`"${d.title}"을(를) 이 브라우저 저장소에서 지울까요?`)) { await store.removeLocal(d.id); r.remove(); } return; }
        try { const doc = await store.openLocal(d.id); closeModal(); Ed.openDoc(doc); } catch (err) { Ed.toast(err.message, true); }
      };
      rc.appendChild(r);
    }
  } catch (err) { rc.innerHTML = `<div class="muted">브라우저 저장소를 쓸 수 없습니다: ${esc(err.message)}</div>`; }
}

// ---------- PPTX · PDF 올리기 → JSON 자동 변환 (tools/serve.py 의 /api/import) ----------
export const isImportable = (f) => f && /\.(pptx|pdf)$/i.test(f.name);
export function pickImport() {
  const i = document.createElement('input');
  i.type = 'file';
  i.accept = '.pptx,.pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/pdf';
  i.onchange = () => { if (i.files[0]) importFile(i.files[0]); };
  i.click();
}
function countNodes(doc) {
  let n = 0;
  for (const p of doc.pages) for (const f of p.frames) O.walk(f.nodes, () => n++);
  return n;
}
export async function importFile(file) {
  if (!isImportable(file)) { Ed.toast('PPTX 또는 PDF 파일만 가져올 수 있어요. (.ppt 는 PowerPoint에서 .pptx로 저장해 주세요)', true); return; }
  const mb = (file.size / 1024 / 1024).toFixed(1);
  const bg = modal(`<header><h2>가져오는 중…</h2><p>${esc(file.name)} · ${mb}MB</p></header>
    <div class="body"><div class="imp-progress"><i></i></div><div class="muted" style="margin-top:10px">도형 · 글 · 표 · 그림을 편집 가능한 요소로 바꾸고 있어요. 큰 파일은 몇 초 걸릴 수 있어요.</div></div>`, false);
  let res, body;
  try {
    res = await fetch('/api/import', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, body: file });
    body = await res.json().catch(() => null);
  } catch (err) { res = null; }
  if (!res || res.status === 404 || res.status === 405 || res.status === 501 && !body || (!body && !res.ok)) {
    // 정적 서버(python -m http.server · Vercel)에는 변환 API가 없다
    noServer(bg, file);
    return;
  }
  if (!res.ok) {
    bg.querySelector('.modal').innerHTML = `<header><h2>가져오지 못했어요</h2><p>${esc(file.name)}</p></header><div class="body"><div class="code">${esc((body && body.error) || res.statusText)}</div>
      <div class="actions" style="margin-top:16px"><button class="ib primary" data-x="again">다른 파일 고르기</button><button class="ib" data-x="close">닫기</button></div></div>`;
    bg.querySelector('[data-x="again"]').onclick = () => { closeModal(); pickImport(); };
    bg.querySelector('[data-x="close"]').onclick = () => (E.doc ? closeModal() : home(E, true));
    return;
  }
  let doc;
  try { doc = M.load(JSON.stringify(body.doc)); }
  catch (err) { bg.querySelector('.modal .body').innerHTML = `<div class="code">${esc(err.message)}</div>`; return; }
  doc.id = M.uid('doc');   // 같은 파일을 다시 가져와도 이전 문서를 덮어쓰지 않게
  const frames = doc.pages.reduce((a, p) => a + p.frames.length, 0);
  const layouts = {};
  doc.pages.forEach((p) => p.frames.forEach((f) => { const k = (LAYOUT_INFO[f.layout] || {}).name || f.layout; layouts[k] = (layouts[k] || 0) + 1; }));
  const warns = (body.report || []).filter((l) => l.startsWith('※'));
  const lines = (body.report || []).filter((l) => !l.startsWith('※'));
  bg.querySelector('.modal').innerHTML = `<header><h2>✅ 가져오기 완료</h2><p>${esc(file.name)} → ${esc(doc.meta.title)}</p></header>
    <div class="body">
      <div class="imp-stats"><div><b>${doc.pages.length}</b><small>페이지</small></div><div><b>${frames}</b><small>프레임</small></div><div><b>${countNodes(doc)}</b><small>요소</small></div><div><b>${Object.keys(doc.assets).length}</b><small>그림</small></div></div>
      <div class="muted" style="margin-top:10px">${Object.entries(layouts).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</div>
      ${warns.length ? `<h3>확인할 점</h3><div class="imp-warn">${warns.map((w) => `<div>${esc(w.replace(/^※\s*/, ''))}</div>`).join('')}</div>` : ''}
      <details style="margin-top:12px"><summary class="muted" style="cursor:pointer">쪽별 결과 보기</summary><div class="code" style="margin-top:6px;max-height:220px;overflow:auto">${esc(lines.join('\n'))}</div></details>
      <div class="actions" style="margin-top:18px"><button class="ib primary" data-x="open">편집 시작</button><button class="ib" data-x="json">JSON 내려받기 (.tnspec.json)</button><button class="ib" data-x="more">다른 파일 가져오기</button></div>
    </div>`;
  bg.querySelector('[data-x="open"]').onclick = () => { closeModal(); Ed.openDoc(doc); Ed.toast('가져온 문서를 열었어요 — 검증 통과, 이 브라우저에 자동 저장됩니다'); };
  bg.querySelector('[data-x="json"]').onclick = () => store.download(store.verifiedJSON(doc), file.name.replace(/\.(pptx|pdf)$/i, '') + '.tnspec.json');
  bg.querySelector('[data-x="more"]').onclick = () => pickImport();
}
function noServer(bg, file) {
  bg.querySelector('.modal').innerHTML = `<header><h2>변환 서버가 꺼져 있어요</h2><p>지금 주소는 정적 파일만 내보내는 서버라 ${esc(file.name)}을(를) 바꿀 수 없어요.</p></header>
    <div class="body">
      <h3>1. Spec Studio 서버로 다시 열기 (권장)</h3>
      <div class="code">python spec-studio/tools/serve.py</div>
      <div class="muted" style="margin-top:6px">저장소 루트에서 실행하고 <b>http://localhost:5180/spec-studio/</b> 를 열면 PPTX를 올리는 즉시 변환돼요. (지금 쓰는 <code>python -m http.server</code> 대신 쓰면 됩니다)</div>
      <h3>2. 명령으로 바꾼 뒤 열기</h3>
      <div class="code">python spec-studio/tools/pptx2json.py "${esc(file.name)}" -o 결과.tnspec.json</div>
      <div class="actions" style="margin-top:18px"><button class="ib primary" data-x="open">.tnspec.json 열기</button><button class="ib" data-x="close">닫기</button></div>
    </div>`;
  bg.querySelector('[data-x="open"]').onclick = () => Ed.openFromFile();
  bg.querySelector('[data-x="close"]').onclick = () => (E.doc ? closeModal() : home(E, true));
}

function importHelp() {
  const bg = modal(`<header><h2>PPTX · PDF → JSON 가져오기</h2><p>기존 기획서를 편집 가능한 문서로 옮깁니다. PPTX가 있으면 PPTX를 권장해요 — 표지 · 간지 글자, 도형, 표, 연결선이 원본 그대로 편집 가능하게 들어옵니다.</p></header>
    <div class="body">
      <h3>가장 쉬운 방법: 올리기</h3>
      <div class="muted">파일 메뉴 → <b>PPTX · PDF 가져오기…</b>, 또는 PPTX 파일을 화면에 끌어다 놓으면 바로 변환돼 열려요. (서버를 <code>python spec-studio/tools/serve.py</code> 로 띄웠을 때)</div>
      <h3>명령으로: PPTX (권장 · 추가 설치 없음)</h3>
      <div class="code">python spec-studio/tools/pptx2json.py "기획서.pptx" -o spec-studio/samples/기획서.tnspec.json</div>
      <div class="muted" style="margin-top:6px">도형 · 글(단락 · 목록 · 서식) · 표(병합 · 칸 색) · 그림(자르기) · 연결선(연결점 · 화살표) · 그룹 · 회전 · 테마 색 · 슬라이드 노트(→ 프레임 메모) · 숨긴 슬라이드를 옮겨요.</div>
      <h3>PDF (PyMuPDF, Pillow 필요)</h3>
      <div class="code">python spec-studio/tools/pdf2json.py "기획서.pdf" -o spec-studio/samples/기획서.tnspec.json</div>
      <h3>이 화면에서 열기</h3>
      <div class="muted">위쪽 메뉴 <b>파일 → 열기</b>로 만들어진 .tnspec.json 을 엽니다. 페이지 종류(표지 · 개정 이력 · 기본 정책 · 간지 · 화면 설계 · THANK YOU)는 자동으로 판별해 템플릿 레이아웃에 맞춰 넣습니다.</div>
      <div class="actions" style="margin-top:18px"><button class="ib primary" id="ih-close">확인</button></div>
    </div>`);
  bg.querySelector('#ih-close').onclick = () => (E.doc ? closeModal() : home(E, true));
}

function shortcuts() {
  const k = [['V · T · R · O', '선택 · 글 · 사각형 · 원'], ['L · A · C', '선 · 화살표 · 연결선'], ['D · H · B · I', 'Description · 인터랙션 영역 · 표 · 이미지'],
    ['Ctrl+Z / Ctrl+Shift+Z', '되돌리기 / 다시 실행'], ['Ctrl+C · X · V', '복사 · 잘라내기 · 붙여넣기 (다른 문서로도, 엑셀 표도)'], ['Ctrl+D / Alt+드래그', '복제'],
    ['Ctrl+Shift+C / V', '서식 복사 / 서식 붙여넣기'], ['Ctrl+F / Ctrl+H', '찾기 / 바꾸기'], ['Ctrl+M', '새 프레임'], ['F5 / Shift+F5', '처음부터 / 지금 프레임부터 미리보기'],
    ['Ctrl+G / Ctrl+Shift+G', '그룹 / 해제'], ['더블클릭 · Enter · F2', '그룹 안으로 · 글 편집 · 이미지 자르기'], ['Esc', '그룹 밖으로 · 선택 해제'], ['Ctrl+클릭', '그룹 속 요소 바로 선택'],
    ['Tab / Shift+Tab', '다음 · 이전 요소 선택 (글 편집 중: 들여쓰기)'], ['Ctrl+Shift+8 / 7', '글머리 기호 / 번호'], ['Ctrl+Shift+> / <', '글자 크기 키우기 / 줄이기'],
    ['Ctrl+] / [', '앞으로 / 뒤로'], ['Ctrl+Shift+] / [', '맨 앞 / 맨 뒤'], ['Alt+A·H·D / W·V·S', '정렬 (좌·중·우 / 상·중·하)'], ['Ctrl+Alt+K', '컴포넌트 만들기'],
    ['방향키 (Shift)', '1px (10px) 이동 · 표 칸 이동'], ['Shift+드래그', '수평 · 수직 고정 / 비율 유지 / 15° 회전 / 45° 선'], ['Ctrl+드래그', '자석(스냅) 끄기'], ['Alt (선택 후 올리기)', '간격 재기'],
    ['Shift+R · Shift+\'', '눈금자 · 격자 표시'], ['Space+드래그 · 휠 클릭', '화면 이동'], ['Ctrl+휠 · Ctrl+= / -', '확대 · 축소'], ['Shift+1', '너비 맞춤'], ['Ctrl+S / Ctrl+Shift+S', '파일 저장 / 다른 이름으로']];
  const bg = modal(`<header><h2>단축키</h2></header><div class="body"><div style="display:grid;grid-template-columns:210px 1fr;gap:6px 14px">${k.map(([a, b]) => `<b style="font-family:Consolas,monospace;color:#cfe3ff">${esc(a)}</b><span>${esc(b)}</span>`).join('')}</div>
    <div class="actions" style="margin-top:18px"><button class="ib primary" id="sc-close">닫기</button></div></div>`);
  bg.querySelector('#sc-close').onclick = closeModal;
}

function checkDoc() {
  const json = M.serialize(E.doc);
  let errs = [];
  try { M.load(json); } catch (err) { errs = err.errors || [err.message]; }
  const frames = E.idx.frames().length;
  let nodes = 0; for (const f of E.idx.frames()) O.walk(f.nodes, () => nodes++);
  const bg = modal(`<header><h2>문서 점검</h2><p>저장 → 다시 열기 검증 결과</p></header><div class="body">
    <div class="muted">페이지 ${E.doc.pages.length} · 프레임 ${frames} · 노드 ${nodes} · 컴포넌트 ${E.doc.components.length} · 이미지 자원 ${Object.keys(E.doc.assets).length} · 크기 ${(json.length / 1024).toFixed(0)}KB · 리비전 카운터 ${E.doc.rev}</div>
    <h3>${errs.length ? '문제 ' + errs.length + '개' : '✅ 문제 없음 — 다시 열어도 깨지지 않습니다'}</h3>
    ${errs.length ? `<div class="code">${esc(errs.join('\n'))}</div>` : ''}
    <div class="actions" style="margin-top:18px"><button class="ib primary" id="ck-close">닫기</button></div></div>`);
  bg.querySelector('#ck-close').onclick = closeModal;
}

// ---------- 미리보기 (발표 · 인터랙션 체험) ----------
export function present(start) {
  Ed.finishEdit();
  const all = E.idx.frames();
  const frames = all.filter((f) => !f.hidden);
  if (!frames.length) { Ed.toast('보일 프레임이 없어요 (모두 숨김).'); return; }
  const nums = new Map(all.map((f, i) => [f.id, i + 1]));
  let i = start === 'first' || !start ? 0 : Math.max(0, frames.findIndex((f) => f.id === start));
  let showNotes = false;
  const host = document.createElement('div');
  host.id = 'present';
  host.innerHTML = '<div class="stage"></div><div class="pnotes hidden"></div><div class="pbar"><button data-p="prev">◀</button><span class="pn"></span><button data-p="next">▶</button><button data-p="notes" title="메모 (N)">📝</button><button data-p="exit">닫기 (Esc)</button></div>';
  document.body.appendChild(host);
  const stage = host.querySelector('.stage');
  const show = () => {
    const f = frames[i];
    stage.innerHTML = '';
    const fr = renderFrame(f, { doc: E.doc, idx: E.idx, mode: 'present', pageNo: nums.get(f.id) });
    stage.appendChild(fr);
    fitText(stage);
    const sc = Math.min((innerWidth - 40) / E.doc.size.w, (innerHeight - (showNotes ? 200 : 80)) / E.doc.size.h);
    stage.style.transform = `scale(${sc})`;
    stage.style.width = E.doc.size.w + 'px'; stage.style.height = E.doc.size.h + 'px';
    host.querySelector('.pn').textContent = `${i + 1} / ${frames.length} · ${f.name}`;
    const pn = host.querySelector('.pnotes');
    pn.classList.toggle('hidden', !showNotes);
    pn.textContent = f.notes || '(메모 없음)';
    const note = host.querySelector('.note'); if (note) note.remove();
  };
  const go = (d) => { i = Math.max(0, Math.min(frames.length - 1, i + d)); show(); };
  const exit = () => { window.removeEventListener('keydown', key, true); window.removeEventListener('resize', show); host.remove(); };
  const key = (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') exit();
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(ev.key)) { ev.preventDefault(); go(1); }
    if (['ArrowLeft', 'PageUp', 'Backspace'].includes(ev.key)) { ev.preventDefault(); go(-1); }
    if (ev.key === 'Home') { i = 0; show(); }
    if (ev.key === 'End') { i = frames.length - 1; show(); }
    if (ev.key.toLowerCase() === 'n') { showNotes = !showNotes; show(); }
  };
  host.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-p]');
    if (b) { if (b.dataset.p === 'prev') go(-1); if (b.dataset.p === 'next') go(1); if (b.dataset.p === 'notes') { showNotes = !showNotes; show(); } if (b.dataset.p === 'exit') exit(); return; }
    const link = ev.target.closest('a.run-link');
    if (link && link.dataset.link.startsWith('frame:')) { ev.preventDefault(); const k = frames.findIndex((f) => f.id === link.dataset.link.slice(6)); if (k >= 0) { i = k; show(); } return; }
    const hs = ev.target.closest('.n-hotspot');
    if (!hs) return;
    const n = E.idx.get(hs.dataset.id);
    const a = (n && n.action) || {};
    if (a.type === 'goto' && a.target) { const k = frames.findIndex((f) => f.id === a.target); if (k >= 0) { i = k; show(); } }
    else if (a.type === 'url' && a.url) window.open(a.url, '_blank', 'noopener');
    else if (a.type === 'note') { let nt = host.querySelector('.note'); if (!nt) { nt = document.createElement('div'); nt.className = 'note'; host.appendChild(nt); } nt.textContent = a.note || ''; }
  });
  window.addEventListener('keydown', key, true);
  window.addEventListener('resize', show);
  show();
}

// ---------- 인쇄 · PDF 저장: 프레임 한 장 = 종이 한 쪽 (960×540), 숨긴 프레임 제외 ----------
export function printDoc() {
  Ed.finishEdit();
  let host = document.getElementById('print-root');
  if (host) host.remove();
  host = document.createElement('div');
  host.id = 'print-root';
  E.idx.frames().forEach((f, i) => {
    if (f.hidden) return;
    const pg = document.createElement('div');
    pg.className = 'print-page';
    pg.appendChild(renderFrame(f, { doc: E.doc, idx: E.idx, mode: 'present', pageNo: i + 1 }));
    host.appendChild(pg);
  });
  document.body.appendChild(host);
  fitText(host);
  const done = () => { host.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 150);   // 이미지가 그려질 시간
}
