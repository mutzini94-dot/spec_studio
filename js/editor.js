// Spec Studio 편집기 — 캔버스 · 선택 · 도구 · 단축키 · 저장
import * as M from './model.js';
import * as O from './ops.js';
import { renderFrame, renderComponentStage, resolvePoints, sidePoint, fitText, themeVars } from './render.js';
import { LAYOUT_INFO, makeFrame } from './templates.js';
import * as store from './store.js';
import * as P from './panels.js';
import * as V from './viewtools.js';

const $ = (s, r = document) => r.querySelector(s);
const SNAP = 5;

export const E = {
  doc: null, idx: null, hist: null,
  pageId: null,        // 지금 보고 있는 페이지
  compId: null,        // 컴포넌트 원본 편집 중이면 그 id
  sel: [],             // 선택된 노드 id
  frameSel: null,      // 선택된 프레임 id (프레임 이름을 눌렀을 때)
  activeFrame: null,   // 마지막으로 작업한 프레임
  scope: null,         // 더블클릭으로 들어간 그룹
  cell: null,          // 표에서 고른 칸 범위 { id, r, c, r2, c2 }
  crop: null,          // 자르기 중인 이미지 id
  tool: 'select',
  shapeKind: 'rect',   // 도형 도구로 그릴 모양
  zoom: 1,
  view: 'canvas',      // 'canvas' | 'sorter' (정렬 보기)
  clip: null,
  fmt: null,           // 서식 복사한 것
  painter: false,      // 서식 붓: 다음에 누르는 요소에 서식 적용
  handle: null,        // 파일 저장 위치
  editing: null,       // 글 편집 중 { el, kind, id, ... }
  drag: null,          // 진행 중인 드래그
  hoverId: null,
  altDown: false,
  collapsed: new Set(),
  leftTab: 'layers',
};
window.__E = E;   // 디버깅용

// ---------- 문서 열기 ----------
export function openDoc(doc, handle = null) {
  E.doc = doc;
  E.idx = new M.DocIndex(doc);
  E.hist = new M.History(E.idx, onChange);
  E.handle = handle;
  E.pageId = doc.pages[0] ? doc.pages[0].id : null;
  E.compId = null; E.sel = []; E.frameSel = null; E.scope = null; E.cell = null; E.crop = null; E.view = 'canvas';
  E.activeFrame = doc.pages[0] && doc.pages[0].frames[0] ? doc.pages[0].frames[0].id : null;
  E.collapsed = new Set(E.idx.frames().map((f) => f.id));
  if (E.activeFrame) E.collapsed.delete(E.activeFrame);
  document.title = doc.meta.title + ' — Spec Studio';
  try { localStorage.setItem('tnspec:last', doc.id); } catch (e) { /* 사생활 보호 모드 */ }
  renderCanvas();
  fitWidth();
  ui();
  setSaveState('', '');
  autosave();
}

export function currentPage() { return E.doc.pages.find((p) => p.id === E.pageId) || E.doc.pages[0]; }
export function currentComponent() { return E.compId ? E.doc.components.find((c) => c.id === E.compId) : null; }

// ---------- 편집 = 연산 기록 ----------
export function commit(ops, label, merge) {
  if (!ops || !ops.length) return false;
  try { return E.hist.commit(ops, label, merge); }
  catch (err) { console.error(err, ops); toast('편집을 적용하지 못했습니다: ' + err.message, true); return false; }
}
export function undo() { finishEdit(); if (E.hist.undo()) pruneSelection(); }
export function redo() { finishEdit(); if (E.hist.redo()) pruneSelection(); }

function pruneSelection() {
  E.sel = E.sel.filter((id) => E.idx.get(id));
  if (E.scope && !E.idx.get(E.scope)) E.scope = null;
  if (E.frameSel && !E.idx.get(E.frameSel)) E.frameSel = null;
  if (E.compId && !currentComponent()) E.compId = null;
  if (E.crop && !E.idx.get(E.crop)) E.crop = null;
  if (E.cell) { const t = E.idx.get(E.cell.id); if (!t || t.type !== 'table' || E.cell.r >= t.rows.length || E.cell.c >= t.cols.length) E.cell = null; }
  if (!currentPage() && E.doc.pages[0]) E.pageId = E.doc.pages[0].id;
  if (E.activeFrame && !E.idx.get(E.activeFrame)) E.activeFrame = currentPage() && currentPage().frames[0] ? currentPage().frames[0].id : null;
}

let dirtyFrames = null;   // null = 없음, 'all' = 전체
function onChange(e) {
  const touched = new Set();
  let all = false;
  const see = (id) => {
    if (!id || id === 'doc') { all = true; return; }
    const o = E.idx.get(id);
    if (!o) return;
    if (o.kind === 'page') { all = true; return; }
    if (o.kind === 'frame') { touched.add(o.id); return; }
    if (o.kind === 'component') { all = true; return; }
    const c = E.idx.containerOf(id);
    if (!c || c.kind === 'component') all = true; else touched.add(c.id);
  };
  for (const o of [].concat(e.ops || [], e.inv || [])) {
    if (o.op === 'insert') { see(o.parent); if (o.item && (o.item.kind === 'page' || o.item.kind === 'component')) all = true; }
    else if (o.op === 'move') { see(o.parent); see(o.id); if (E.idx.get(o.id) && E.idx.get(o.id).kind === 'frame') all = true; }
    else see(o.id);
  }
  if (all || E.view === 'sorter') dirtyFrames = 'all';
  else if (dirtyFrames !== 'all') { dirtyFrames = dirtyFrames || new Set(); touched.forEach((t) => dirtyFrames.add(t)); }
  pruneSelection();
  scheduleRender();
  autosave();
}

let rafId = 0;
function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(flush);
}
// 미뤄 둔 다시 그리기를 지금 바로 (DOM이 필요한 작업 직전에)
export function flush() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  const d = dirtyFrames; dirtyFrames = null;
  if (!d) return;
  if (d === 'all') renderCanvas();
  else for (const id of d) renderFrameWrap(id);
  drawOverlay();
  ui();
}

let uiT = 0;
export function ui() {
  clearTimeout(uiT);
  uiT = setTimeout(() => { P.renderTop(E); P.renderLeft(E); P.renderRight(E); V.renderNotes(E); V.drawRulers(E); }, E.drag ? 120 : 0);
}

// ---------- 캔버스 ----------
const canvas = () => $('#canvas');
export const world = () => $('#world');

export function pageNumbers() {
  const m = new Map();
  E.idx.frames().forEach((f, i) => m.set(f.id, i + 1));
  return m;
}

export function renderCanvas() {
  const w = world();
  w.innerHTML = '';
  w.classList.add('edit-mode');
  w.classList.toggle('show-grid', !!E.doc.settings.gridShow);
  w.style.setProperty('--grid', (E.doc.settings.grid || 10) + 'px');
  // 테마 색을 문서 전체(패널 미리보기 포함)에서 쓸 수 있게
  for (const kv of themeVars(E.doc).split(';')) { const [k, v] = kv.split(':'); document.documentElement.style.setProperty(k, v); }
  const banner = $('#comp-banner');
  const comp = currentComponent();
  canvas().classList.toggle('sorter', E.view === 'sorter');
  if (E.view === 'sorter' && !comp) {
    banner.classList.add('hidden');
    V.renderSorter(E, w);
    applyZoom();
    return;
  }
  if (comp) {
    banner.classList.remove('hidden');
    banner.innerHTML = `컴포넌트 편집 중 · ${esc(comp.name)} <span>— 여기서 고친 내용이 모든 인스턴스에 바로 반영됩니다</span><span style="flex:1"></span><button id="comp-done">편집 완료</button>`;
    $('#comp-done').onclick = () => exitComponent();
    const wrap = document.createElement('div');
    wrap.className = 'fwrap';
    wrap.dataset.fw = comp.id;
    wrap.innerHTML = `<div class="flabel"><b>◆ ${esc(comp.name)}</b><span>${comp.w} × ${comp.h}</span></div>`;
    wrap.appendChild(renderComponentStage(comp, { doc: E.doc, idx: E.idx, mode: 'edit' }));
    wrap.appendChild(Object.assign(document.createElement('div'), { className: 'overlay' }));
    w.appendChild(wrap);
  } else {
    banner.classList.add('hidden');
    const page = currentPage();
    const nums = pageNumbers();
    if (page) for (const f of page.frames) {
      const wrap = document.createElement('div');
      wrap.className = 'fwrap';
      wrap.dataset.fw = f.id;
      w.appendChild(wrap);
      fillWrap(wrap, f, nums.get(f.id));
    }
    if (!page || !page.frames.length) w.insertAdjacentHTML('beforeend', '<div class="hint" style="color:#555;font-size:13px">이 페이지에는 프레임이 없습니다. 위쪽 <b>＋ 프레임</b>으로 기획서 양식을 추가하세요.</div>');
  }
  fitText(w);
  applyZoom();
  drawOverlay();
}

function fillWrap(wrap, f, pno) {
  const notes = f.notes && f.notes.trim() ? '<span title="프레임 메모 있음">📝</span>' : '';
  wrap.innerHTML = `<div class="flabel" data-flabel="${f.id}"><b>${esc(f.name)}</b><span>${esc(LAYOUT_INFO[f.layout] ? LAYOUT_INFO[f.layout].name : f.layout)} · ${pno} P</span>${f.hidden ? '<span class="tag-hidden">숨김</span>' : ''}${notes}</div>`;
  wrap.appendChild(renderFrame(f, { doc: E.doc, idx: E.idx, mode: 'edit', pageNo: pno }));
  wrap.appendChild(Object.assign(document.createElement('div'), { className: 'overlay' }));
  wrap.classList.toggle('active', f.id === E.activeFrame);
  wrap.classList.toggle('fsel', f.id === E.frameSel);
  wrap.classList.toggle('frame-off', !!f.hidden);
  fitText(wrap);
}

function renderFrameWrap(fid) {
  if (E.view === 'sorter') { renderCanvas(); return; }
  const wrap = world().querySelector(`.fwrap[data-fw="${fid}"]`);
  const f = E.idx.get(fid);
  if (!wrap || !f || f.kind !== 'frame') { if (f && f.kind === 'frame' && E.idx.pageOf(fid) === currentPage()) renderCanvas(); return; }
  fillWrap(wrap, f, pageNumbers().get(fid));
  if (E.editing && E.editing.frame === fid) E.editing = null;
}

// 화면 확대/축소
export function applyZoom() {
  const w = world();
  const z = E.view === 'sorter' && !E.compId ? 1 : E.zoom;
  w.style.transform = `scale(${z})`;
  w.style.setProperty('--iz', 1 / z);
  const s = $('#sizer');
  s.style.width = w.offsetWidth * z + 'px';
  s.style.height = w.offsetHeight * z + 'px';
  const zv = $('#zv');
  if (zv) zv.textContent = Math.round(z * 100) + '%';
  V.drawRulers(E);
}
export function setZoom(z, cx, cy) {
  if (E.view === 'sorter') return;
  const c = canvas();
  const r = c.getBoundingClientRect();
  cx = cx == null ? r.width / 2 : cx - r.left;
  cy = cy == null ? r.height / 2 : cy - r.top;
  const wx = (c.scrollLeft + cx) / E.zoom, wy = (c.scrollTop + cy) / E.zoom;
  E.zoom = Math.max(.1, Math.min(4, z));
  applyZoom();
  c.scrollLeft = wx * E.zoom - cx;
  c.scrollTop = wy * E.zoom - cy;
  drawOverlay();
}
export function fitWidth() {
  const c = canvas();
  const comp = currentComponent();
  const w = comp ? comp.w : E.doc.size.w;
  E.zoom = Math.max(.1, Math.min(comp ? 3 : 1.6, (c.clientWidth - 60) / (w + 160)));
  applyZoom();
  c.scrollLeft = 0;
}
export function scrollToFrame(fid) {
  const wrap = world().querySelector(`.fwrap[data-fw="${fid}"]`);
  if (!wrap) return;
  canvas().scrollTop = wrap.offsetTop * E.zoom - 30;
}
export function setView(v) {
  finishEdit();
  E.view = v;
  E.sel = []; E.scope = null; E.cell = null; E.crop = null;
  if (v === 'sorter' && E.compId) E.compId = null;
  renderCanvas();
  if (v === 'canvas' && E.activeFrame) {
    const pg = E.idx.pageOf(E.activeFrame);
    if (pg && pg.id !== E.pageId) { E.pageId = pg.id; renderCanvas(); }
    setTimeout(() => scrollToFrame(E.activeFrame), 0);
  }
  ui();
}

// ---------- 좌표 ----------
function frameEl(fid) { return world().querySelector(`.fwrap[data-fw="${fid}"] .frame`); }
export function toFrame(e, fid) {
  const r = frameEl(fid).getBoundingClientRect();
  return { x: (e.clientX - r.left) / E.zoom, y: (e.clientY - r.top) / E.zoom };
}
export function containerFor(fid) { return E.compId ? currentComponent() : E.idx.get(fid); }
function nodeEl(id) { return world().querySelector(`[data-id="${id}"]`); }

// 화면에 실제로 그려진 크기까지 반영한 상자 (표 · 자동 맞춤 글은 내용에 따라 늘어남)
export function nodeBox(id) {
  const n = E.idx.get(id);
  const b = M.frameBounds(n, E.idx);
  const grows = n.type === 'table' || (n.type === 'text' && n.style && n.style.fit === 'grow');
  if (grows && !n.rotation) { const el = nodeEl(id); if (el) b.h = n.type === 'table' ? Math.max(b.h, el.offsetHeight) : el.offsetHeight; }
  return b;
}
function selBox(ids = E.sel) { return O.unionBox(O.topLevel(E.idx, ids).map(nodeBox)); }

export function contentBox(fid) {
  const f = E.idx.get(fid);
  if (!f || f.kind !== 'frame') { const c = currentComponent(); return c ? { x: 0, y: 0, w: c.w, h: c.h } : null; }
  return (LAYOUT_INFO[f.layout] || LAYOUT_INFO.blank).content;
}
function frameBoxOf(fid) {
  const c = containerFor(fid);
  return c.kind === 'component' ? { x: 0, y: 0, w: c.w, h: c.h } : { x: 0, y: 0, w: E.doc.size.w, h: E.doc.size.h };
}

// 눌린 노드에서 지금 범위(그룹 진입 상태)에 맞는 선택 대상을 고른다
function selectable(id, deep) {
  if (deep) return id;
  const anc = E.idx.ancestors(id);   // 가까운 것부터
  if (E.scope) {
    const path = [id].concat(anc.map((g) => g.id));
    const k = path.indexOf(E.scope);
    if (k > 0) return path[k - 1];
    E.scope = null;
  }
  return anc.length ? anc[anc.length - 1].id : id;
}

export function frameOfNode(id) { const c = E.idx.containerOf(id); return c ? c.id : null; }

export function select(ids, opts = {}) {
  finishEdit();
  E.sel = ids.filter((id) => E.idx.get(id));
  E.frameSel = opts.frame || null;
  if (E.crop && !E.sel.includes(E.crop)) E.crop = null;
  if (E.sel.length) {
    const f = frameOfNode(E.sel[0]);
    if (f && f !== E.activeFrame) setActiveFrame(f);
    const pg = E.idx.pageOf(E.sel[0]);
    if (pg && pg.id !== E.pageId && !E.compId) { E.pageId = pg.id; if (E.view === 'sorter') E.view = 'canvas'; renderCanvas(); }
    for (const id of E.sel) for (const g of E.idx.ancestors(id)) E.collapsed.delete(g.id);
    if (f) E.collapsed.delete(f);
  } else if (opts.frame) setActiveFrame(opts.frame);
  if (!E.sel.some((id) => E.cell && E.cell.id === id)) E.cell = null;
  world().querySelectorAll('.fwrap').forEach((w) => w.classList.toggle('fsel', w.dataset.fw === E.frameSel));
  markCell();
  drawOverlay();
  ui();
}
export function setActiveFrame(fid) {
  if (E.activeFrame === fid) return;
  E.activeFrame = fid;
  world().querySelectorAll('.fwrap').forEach((w) => w.classList.toggle('active', w.dataset.fw === fid));
  V.renderNotes(E);
  V.drawRulers(E);
}

// ---------- 오버레이 (선택 상자 · 손잡이 · 가이드) ----------
function overlayOf(fid) { return world().querySelector(`.fwrap[data-fw="${fid}"] .overlay`); }
const px = (v) => v + 'px';
function box(cls, b, parent) {
  const d = document.createElement('div');
  d.className = cls;
  d.style.left = px(b.x); d.style.top = px(b.y); d.style.width = px(b.w); d.style.height = px(b.h);
  parent.appendChild(d);
  return d;
}
function dot(cls, x, y, parent, data = {}) {
  const d = document.createElement('div');
  d.className = cls;
  d.style.left = px(x); d.style.top = px(y);
  Object.assign(d.dataset, data);
  parent.appendChild(d);
  return d;
}
const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const HANDLES = [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]];

export function drawOverlay() {
  world().querySelectorAll('.overlay').forEach((o) => { o.innerHTML = ''; });
  if (!E.doc || E.view === 'sorter') return;
  markSelected();
  V.drawGuides(E, overlayOf);
  const dg = E.drag;
  // 드래그 중에 그리는 것들
  if (dg && dg.fid) {
    const ov = overlayOf(dg.fid);
    if (ov) {
      if (dg.marquee) box('marquee', dg.marquee, ov);
      if (dg.draw) box('draw-box', dg.draw, ov);
      if (dg.showContent) { const cb = contentBox(dg.fid); if (cb) box('content-guide', cb, ov); }
      for (const g of dg.guides || []) {
        const d = document.createElement('div');
        d.className = 'guide ' + g.dir;
        if (g.dir === 'v') { d.style.left = px(g.x); d.style.top = px(g.y0); d.style.height = px(g.y1 - g.y0); }
        else { d.style.top = px(g.y); d.style.left = px(g.x0); d.style.width = px(g.x1 - g.x0); }
        ov.appendChild(d);
      }
      drawDistances(ov, dg.dists || []);
      if (dg.attach) {
        box('attach-box', dg.attach.box, ov);
        for (const s of ['n', 'e', 's', 'w']) { const p = sidePoint(dg.attach.box, s); dot('cpt' + (dg.attach.side === s ? ' on' : ''), p[0], p[1], ov); }
      }
      if (dg.preview) drawPreviewLine(ov, dg.preview);
      if (dg.angle != null) { const t = dot('size-tag', dg.tagAt[0], dg.tagAt[1], ov); t.textContent = Math.round(dg.angle) + '°'; }
    }
  }
  // 마우스를 올린 노드
  if (!dg && E.hoverId && !E.sel.includes(E.hoverId) && E.idx.get(E.hoverId)) {
    const f = frameOfNode(E.hoverId);
    const ov = f && overlayOf(f);
    if (ov) box('hover-box', nodeBox(E.hoverId), ov);
    // Alt: 선택한 것과 올린 것 사이 거리
    if (ov && E.altDown && E.sel.length && frameOfNode(E.sel[0]) === f) drawDistances(ov, measureBetween(selBox(), nodeBox(E.hoverId)));
  }
  if (!E.sel.length) return;
  const fid = frameOfNode(E.sel[0]);
  const ov = fid && overlayOf(fid);
  if (!ov) return;
  if (E.scope && E.idx.get(E.scope)) box('sel-box group-box', nodeBox(E.scope), ov).style.opacity = .5;
  const top = O.topLevel(E.idx, E.sel);
  const single = top.length === 1 ? E.idx.get(top[0]) : null;
  if (single && E.crop === single.id) { drawCrop(ov, single); return; }
  if (single && single.rotation && single.type !== 'group') { drawRotated(ov, single); return; }
  for (const id of top) {
    const n = E.idx.get(id);
    if (n.type === 'description' && n.marker === false) continue;   // 화면에 없는 번호
    box('sel-box' + (n.type === 'group' ? ' group-box' : '') + (n.type === 'instance' ? ' inst-box' : ''), nodeBox(id), ov);
  }
  if (E.editing) return;
  if (single && single.type === 'connector') {
    const pts = resolvePoints(single, { idx: E.idx });
    const o = E.idx.offsetOf(single.id);
    [0, pts.length - 1].forEach((i) => dot('handle pt', pts[i][0] + (single.x || 0) + o.x, pts[i][1] + (single.y || 0) + o.y, ov, { pt: i === 0 ? 'from' : 'to' }));
    return;
  }
  if (single && single.type === 'description') return;
  const b = selBox();
  for (const [dir, hx, hy] of HANDLES) dot('handle h-' + dir, b.x + b.w * hx, b.y + b.h * hy, ov, { h: dir });
  if (single && single.type !== 'group' && single.type !== 'table') {
    dot('handle rot', b.x + b.w / 2, b.y - 20 / E.zoom, ov, { rot: '1' }).title = '돌리기 (Shift: 15° 단위)';
  }
  if (single && single.type === 'shape' && /^callout/.test(single.shape)) {
    const o = E.idx.offsetOf(single.id), t = single.tail || [.22, 1.35];
    dot('handle adj', o.x + single.x + t[0] * single.w, o.y + single.y + t[1] * single.h, ov, { adj: 'tail' }).title = '말풍선 꼬리';
  }
  if (single && single.type === 'table' && !E.cell) drawTableHandles(ov, single, b);
  if (single && single.type === 'table' && E.cell) drawTableHandles(ov, single, b);
  if (dg && (dg.kind === 'move' || dg.kind === 'resize')) {
    const t = document.createElement('div');
    t.className = 'size-tag';
    t.textContent = dg.kind === 'move' ? `${Math.round(b.x)}, ${Math.round(b.y)}` : `${Math.round(b.w)} × ${Math.round(b.h)}`;
    t.style.left = px(b.x + b.w / 2); t.style.top = px(b.y + b.h + 6 / E.zoom);
    ov.appendChild(t);
  }
}

// 선택한 노드(+ 자식)는 이동 커서 · 테두리만 있는 도형도 안쪽을 잡을 수 있게
function markSelected() {
  world().querySelectorAll('.sel-on, .sel-cell').forEach((el) => el.classList.remove('sel-on', 'sel-cell'));
  if (E.editing) return;
  for (const id of O.topLevel(E.idx, E.sel)) {
    const n = E.idx.get(id);
    const el = n && !n.locked && nodeEl(id);
    if (!el) continue;
    el.classList.add('sel-on');
    if (n.type === 'table' && E.cell && E.cell.id === id) el.classList.add('sel-cell');   // 칸 선택 중에는 칸 커서
  }
}

// 회전한 노드: 돌아간 테두리와 손잡이
function drawRotated(ov, n) {
  const o = E.idx.offsetOf(n.id);
  const cx = o.x + n.x + n.w / 2, cy = o.y + n.y + n.h / 2, a = n.rotation * Math.PI / 180;
  const sb = box('sel-box', { x: o.x + n.x, y: o.y + n.y, w: n.w, h: n.h }, ov);
  sb.style.transform = `rotate(${n.rotation}deg)`;
  if (E.editing) return;
  for (const [dir, hx, hy] of HANDLES) { const [x, y] = rot((hx - .5) * n.w, (hy - .5) * n.h, a); dot('handle h-any', cx + x, cy + y, ov, { h: dir }); }
  const [rx, ry] = rot(0, -n.h / 2 - 20 / E.zoom, a);
  dot('handle rot', cx + rx, cy + ry, ov, { rot: '1' });
}

// 이미지 자르기: 원본 전체를 흐리게 보여 주고, 손잡이로 남길 부분을 정한다
function drawCrop(ov, n) {
  const a = E.doc.assets[n.asset];
  const o = E.idx.offsetOf(n.id);
  const c = n.crop || {};
  const fw = n.w / Math.max(.01, 1 - (c.l || 0) - (c.r || 0)), fh = n.h / Math.max(.01, 1 - (c.t || 0) - (c.b || 0));
  const fx = o.x + n.x - (c.l || 0) * fw, fy = o.y + n.y - (c.t || 0) * fh;
  if (a) {
    const g = document.createElement('img');
    g.className = 'crop-ghost';
    g.src = a.data;
    Object.assign(g.style, { left: px(fx), top: px(fy), width: px(fw), height: px(fh) });
    ov.appendChild(g);
  }
  box('crop-full', { x: fx, y: fy, w: fw, h: fh }, ov);
  const b = { x: o.x + n.x, y: o.y + n.y, w: n.w, h: n.h };
  box('sel-box crop-box', b, ov);
  for (const [dir, hx, hy] of HANDLES) dot('handle crop-h h-' + dir, b.x + b.w * hx, b.y + b.h * hy, ov, { crop: dir });
}

// 표: 열 경계 · 행 경계를 끌어 너비 · 높이 조절
function drawTableHandles(ov, n, b) {
  const el = nodeEl(n.id);
  const tb = el && el.querySelector('table');
  let x = b.x;
  n.cols.forEach((w, i) => { x += w; const d = box('tb-col-h', { x: x - 3 / E.zoom, y: b.y, w: 6 / E.zoom, h: b.h }, ov); d.dataset.col = i; d.title = '끌어서 열 너비 (Shift: 표 너비도 바뀜)'; });
  if (!tb) return;
  [...tb.rows].forEach((tr, i) => { const y = b.y + tr.offsetTop + tr.offsetHeight; const d = box('tb-row-h', { x: b.x, y: y - 3 / E.zoom, w: b.w, h: 6 / E.zoom }, ov); d.dataset.row = i; });
}

function drawDistances(ov, list) {
  for (const d of list) {
    const l = document.createElement('div');
    l.className = 'dist ' + (d.dir === 'h' ? 'h' : 'v');
    if (d.dir === 'h') { l.style.left = px(Math.min(d.a, d.b)); l.style.top = px(d.at); l.style.width = px(Math.abs(d.b - d.a)); }
    else { l.style.top = px(Math.min(d.a, d.b)); l.style.left = px(d.at); l.style.height = px(Math.abs(d.b - d.a)); }
    ov.appendChild(l);
    const t = document.createElement('div');
    t.className = 'dist-tag';
    t.textContent = Math.round(Math.abs(d.b - d.a));
    if (d.dir === 'h') { t.style.left = px((d.a + d.b) / 2); t.style.top = px(d.at); }
    else { t.style.top = px((d.a + d.b) / 2); t.style.left = px(d.at); }
    ov.appendChild(t);
  }
}

function drawPreviewLine(ov, p) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('style', 'position:absolute;left:0;top:0;overflow:visible');
  s.setAttribute('width', 1); s.setAttribute('height', 1);
  const l = document.createElementNS(ns, 'line');
  l.setAttribute('x1', p[0][0]); l.setAttribute('y1', p[0][1]); l.setAttribute('x2', p[1][0]); l.setAttribute('y2', p[1][1]);
  l.setAttribute('stroke', '#2f80ff'); l.setAttribute('stroke-width', 1.5 / E.zoom); l.setAttribute('stroke-dasharray', 4 / E.zoom);
  s.appendChild(l);
  ov.appendChild(s);
}

// 거리 가이드: 움직이는 상자와 가장 가까운 이웃(상하좌우) 사이 간격
function neighborDistances(b, others) {
  const best = {};
  for (const o of others) {
    const vOverlap = Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y);
    const hOverlap = Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x);
    if (vOverlap > 0) {
      const at = (Math.max(b.y, o.y) + Math.min(b.y + b.h, o.y + o.h)) / 2;
      if (o.x >= b.x + b.w) { const g = o.x - (b.x + b.w); if (!best.r || g < best.r.g) best.r = { g, d: { dir: 'h', a: b.x + b.w, b: o.x, at } }; }
      if (o.x + o.w <= b.x) { const g = b.x - (o.x + o.w); if (!best.l || g < best.l.g) best.l = { g, d: { dir: 'h', a: o.x + o.w, b: b.x, at } }; }
    }
    if (hOverlap > 0) {
      const at = (Math.max(b.x, o.x) + Math.min(b.x + b.w, o.x + o.w)) / 2;
      if (o.y >= b.y + b.h) { const g = o.y - (b.y + b.h); if (!best.b || g < best.b.g) best.b = { g, d: { dir: 'v', a: b.y + b.h, b: o.y, at } }; }
      if (o.y + o.h <= b.y) { const g = b.y - (o.y + o.h); if (!best.t || g < best.t.g) best.t = { g, d: { dir: 'v', a: o.y + o.h, b: b.y, at } }; }
    }
  }
  return Object.values(best).filter((x) => x.g > .5 && x.g < 400).map((x) => x.d);
}

// Alt 측정: A와 B 사이 (B가 A를 감싸면 안쪽 여백 4방향)
function measureBetween(a, b) {
  const out = [];
  const inside = b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h;
  const cy = a.y + a.h / 2, cx = a.x + a.w / 2;
  if (inside) {
    out.push({ dir: 'h', a: b.x, b: a.x, at: cy }, { dir: 'h', a: a.x + a.w, b: b.x + b.w, at: cy });
    out.push({ dir: 'v', a: b.y, b: a.y, at: cx }, { dir: 'v', a: a.y + a.h, b: b.y + b.h, at: cx });
  } else {
    if (b.x >= a.x + a.w) out.push({ dir: 'h', a: a.x + a.w, b: b.x, at: cy });
    else if (b.x + b.w <= a.x) out.push({ dir: 'h', a: b.x + b.w, b: a.x, at: cy });
    if (b.y >= a.y + a.h) out.push({ dir: 'v', a: a.y + a.h, b: b.y, at: cx });
    else if (b.y + b.h <= a.y) out.push({ dir: 'v', a: b.y + b.h, b: a.y, at: cx });
  }
  return out.filter((d) => Math.abs(d.b - d.a) > .5);
}

// ---------- 스냅 ----------
function snapTargets(fid, exclude) {
  const ex = new Set(exclude);
  const c = containerFor(fid);
  const boxes = [];
  const scopeParent = E.scope ? E.idx.get(E.scope) : null;
  const list = scopeParent ? scopeParent.children : c.nodes;
  for (const n of list) if (!ex.has(n.id) && !n.hidden) boxes.push(nodeBox(n.id));
  // 프레임 밖 형제(그룹 안에서 작업할 때)도 기준으로
  if (scopeParent) for (const n of c.nodes) if (!ex.has(n.id) && n.id !== E.scope && !n.hidden) boxes.push(nodeBox(n.id));
  const fb = frameBoxOf(fid), cb = contentBox(fid);
  const xs = [fb.x, fb.w / 2, fb.w], ys = [fb.y, fb.h / 2, fb.h];
  if (cb) { xs.push(cb.x, cb.x + cb.w); ys.push(cb.y, cb.y + cb.h); }
  for (const b of boxes) { xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); }
  const g = c.guides || {};
  (g.v || []).forEach((x) => xs.push(x));
  (g.h || []).forEach((y) => ys.push(y));
  return { xs, ys, boxes };
}

// 움직이는 기준선(lines)을 가장 가까운 목표선에 맞춘다 → 보정값과 가이드
function snapAxis(lines, targets, th) {
  let best = null;
  for (const l of lines) for (const t of targets) {
    const d = t - l;
    if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
  }
  return best;
}
const gridOn = () => E.doc.settings.gridSnap;
const gridV = (v) => { const g = E.doc.settings.grid || 10; return Math.round(v / g) * g; };
function guidesFor(b, snapX, snapY, boxes) {
  const g = [];
  if (snapX) {
    const rel = boxes.filter((o) => [o.x, o.x + o.w / 2, o.x + o.w].some((v) => Math.abs(v - snapX.t) < .6));
    const ys = [b.y, b.y + b.h].concat(...rel.map((o) => [o.y, o.y + o.h]));
    g.push({ dir: 'v', x: snapX.t, y0: Math.min(...ys) - 4, y1: Math.max(...ys) + 4 });
  }
  if (snapY) {
    const rel = boxes.filter((o) => [o.y, o.y + o.h / 2, o.y + o.h].some((v) => Math.abs(v - snapY.t) < .6));
    const xs = [b.x, b.x + b.w].concat(...rel.map((o) => [o.x, o.x + o.w]));
    g.push({ dir: 'h', y: snapY.t, x0: Math.min(...xs) - 4, x1: Math.max(...xs) + 4 });
  }
  return g;
}

// ---------- 마우스 ----------
let spaceDown = false;
let dragSeq = 0;
function onDown(e) {
  if (E.view === 'sorter') return;
  if (E.editing && E.editing.el.contains(e.target)) return;
  if (e.button === 1 || (e.button === 0 && spaceDown)) { startPan(e); return; }
  if (e.button !== 0) return;
  const label = e.target.closest('[data-flabel]');
  if (label) { finishEdit(); E.scope = null; E.crop = null; setActiveFrame(label.dataset.flabel); select([], { frame: label.dataset.flabel }); return; }
  const wrap = e.target.closest('.fwrap');
  if (!wrap) { finishEdit(); E.scope = null; E.crop = null; select([]); return; }
  const fid = wrap.dataset.fw;
  if (!E.compId) setActiveFrame(fid);
  const p = toFrame(e, fid);
  const gd = e.target.closest('.uguide');
  if (gd) { V.startGuideDrag(E, e, fid, gd.dataset.axis, +gd.dataset.i); return; }
  const hd = e.target.closest('.handle');
  if (hd && hd.dataset.crop) { startCropResize(e, fid, hd.dataset.crop); return; }
  if (hd && hd.dataset.rot) { startRotate(e, fid); return; }
  if (hd && hd.dataset.adj) { startTail(e, fid); return; }
  if (hd && hd.dataset.h) { startResize(e, fid, hd.dataset.h); return; }
  if (hd && hd.dataset.pt) { startEndpoint(e, fid, hd.dataset.pt); return; }
  const th = e.target.closest('.tb-col-h, .tb-row-h');
  if (th) { startTableResize(e, th.dataset.col != null ? 'col' : 'row', +(th.dataset.col != null ? th.dataset.col : th.dataset.row)); return; }
  if (E.crop) {
    const hitc = e.target.closest('[data-id]');
    if (hitc && hitc.dataset.id === E.crop) { startCropPan(e, fid); return; }
    E.crop = null;
  }
  if (E.tool !== 'select') { finishEdit(); startCreate(e, fid, p); return; }
  const descRow = e.target.closest('[data-desc]');
  if (descRow && E.idx.get(descRow.dataset.desc)) { select([descRow.dataset.desc]); return; }
  if (e.target.closest('.ch-field')) { if (E.sel.length) select([]); return; }
  const hit = e.target.closest('[data-id]');
  if (hit && E.idx.get(hit.dataset.id)) {
    finishEdit();
    const id = selectable(hit.dataset.id, e.ctrlKey || e.metaKey);
    const n = E.idx.get(id);
    // 서식 붓: 누른 요소에 복사한 서식 적용
    if (E.painter && E.fmt) {
      commit(O.opsApplyFormat(E.idx, [id], E.fmt), '서식 붙여넣기');
      E.painter = false; canvas().classList.remove('painting');
      select([id]);
      return;
    }
    if (e.shiftKey && !(n.type === 'table' && E.cell && E.cell.id === id)) {
      const s = E.sel.includes(id) ? E.sel.filter((k) => k !== id) : E.sel.concat(id);
      select(s.filter((k) => frameOfNode(k) === frameOfNode(id)));
      return;
    }
    const was = E.sel.length === 1 && E.sel[0] === id;
    // 이미 고른 표 안을 누르면 칸 선택 (테두리 근처는 표 이동)
    const td = e.target.closest('td');
    if (n.type === 'table' && td && was) {
      if (E.cell && E.cell.id === id) { startCellSelect(e, id, td); return; }   // 칸 선택 중: 끌어서 범위
      if (!n.locked) startMove(e, fid, () => { E.cell = { id, r: +td.dataset.r, c: +td.dataset.c, r2: +td.dataset.r, c2: +td.dataset.c }; markCell(); drawOverlay(); ui(); });
      return;
    }
    if (!E.sel.includes(id)) select([id]);
    if (!n.locked) startMove(e, fid);
    return;
  }
  // 선택 상자 안의 빈 곳을 끌면 선택한 것을 옮긴다 (테두리만 있는 주석 박스 등)
  if (E.sel.length && !e.shiftKey && frameOfNode(E.sel[0]) === fid) {
    const b = selBox();
    if (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h && !E.sel.some((id) => E.idx.get(id).locked)) { startMove(e, fid); return; }
  }
  // 빈 곳: 드래그 선택
  finishEdit();
  if (E.painter) { E.painter = false; canvas().classList.remove('painting'); }
  if (!e.shiftKey) { E.scope = null; select([]); }
  startMarquee(e, fid, p);
}

export function track(e, onMove, onUp) {
  const mv = (ev) => onMove(ev);
  const up = (ev) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); onUp(ev); };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}

function startPan(e) {
  e.preventDefault();
  const c = canvas();
  const sx = e.clientX, sy = e.clientY, sl = c.scrollLeft, st = c.scrollTop;
  c.classList.add('panning');
  track(e, (ev) => { c.scrollLeft = sl - (ev.clientX - sx); c.scrollTop = st - (ev.clientY - sy); }, () => c.classList.remove('panning'));
}

function startMarquee(e, fid, p0) {
  const base = E.sel.slice();
  E.drag = { kind: 'marquee', fid, marquee: { x: p0.x, y: p0.y, w: 0, h: 0 } };
  track(e, (ev) => {
    const p = toFrame(ev, fid);
    const m = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
    E.drag.marquee = m;
    const c = containerFor(fid);
    const list = E.scope ? E.idx.get(E.scope).children : c.nodes;
    const hits = list.filter((n) => !n.hidden && !n.locked && n.marker !== false).map((n) => n.id).filter((id) => {
      const b = nodeBox(id);
      return b.x < m.x + m.w && b.x + b.w > m.x && b.y < m.y + m.h && b.y + b.h > m.y;
    });
    E.sel = Array.from(new Set(base.concat(hits)));
    drawOverlay();
  }, () => { E.drag = null; select(E.sel); });
}

function startMove(e, fid, onTap) {
  const sx = e.clientX, sy = e.clientY;
  let started = false;
  const key = 'move' + (++dragSeq);
  let starts = null, base = null, targets = null;
  track(e, (ev) => {
    if (!started) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      started = true;
      // Alt + 드래그 = 복제해서 옮기기
      if (ev.altKey) {
        const pl = O.copyPayload(E.idx, E.sel);
        const parent = O.parentId(E.idx, O.topLevel(E.idx, E.sel)[0]);
        const r = O.opsPaste(E.idx, pl, parent);
        commit(r.ops, '복제', key);
        E.sel = r.ids;
      }
      starts = {};
      for (const id of O.topLevel(E.idx, E.sel)) { const n = E.idx.get(id); starts[id] = { x: n.x || 0, y: n.y || 0 }; }
      base = selBox();
      targets = snapTargets(fid, E.sel.concat(E.idx.ancestors(E.sel[0]).map((g) => g.id)));
      E.drag = { kind: 'move', fid, showContent: true };
    }
    let dx = (ev.clientX - sx) / E.zoom, dy = (ev.clientY - sy) / E.zoom;
    if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    let b = { x: base.x + dx, y: base.y + dy, w: base.w, h: base.h };
    let sxr = null, syr = null;
    if (!ev.ctrlKey && !ev.metaKey) {
      const th = SNAP / E.zoom;
      sxr = snapAxis([b.x, b.x + b.w / 2, b.x + b.w], targets.xs, th);
      syr = snapAxis([b.y, b.y + b.h / 2, b.y + b.h], targets.ys, th);
      if (sxr) dx += sxr.d; else if (gridOn()) dx += gridV(b.x) - b.x;
      if (syr) dy += syr.d; else if (gridOn()) dy += gridV(b.y) - b.y;
      b = { x: base.x + dx, y: base.y + dy, w: base.w, h: base.h };
    }
    E.drag.guides = guidesFor(b, sxr, syr, targets.boxes);
    E.drag.dists = neighborDistances(b, targets.boxes);
    commit(O.opsMove(E.idx, Object.keys(starts), dx, dy, starts), '이동', key);
    commit(O.opsSyncConnectors(E.idx, containerFor(fid)), '이동', key);
  }, () => { E.drag = null; if (!started && onTap) { onTap(); return; } drawOverlay(); ui(); });
}

function resizeBox(base, dir, dx, dy, keep, fromCenter) {
  let { x, y, w, h } = base;
  if (dir.includes('e')) w = base.w + dx;
  if (dir.includes('s')) h = base.h + dy;
  if (dir.includes('w')) { w = base.w - dx; x = base.x + dx; }
  if (dir.includes('n')) { h = base.h - dy; y = base.y + dy; }
  if (keep && base.w && base.h) {
    const r = base.w / base.h;
    if (dir === 'n' || dir === 's') { w = h * r; x = base.x + (base.w - w) / 2; }
    else if (dir === 'e' || dir === 'w') { h = w / r; y = base.y + (base.h - h) / 2; }
    else { if (Math.abs(w / base.w) > Math.abs(h / base.h)) h = w / r; else w = h * r; if (dir.includes('w')) x = base.x + base.w - w; if (dir.includes('n')) y = base.y + base.h - h; }
  }
  if (fromCenter) { x = base.x + base.w / 2 - w / 2; y = base.y + base.h / 2 - h / 2; }
  if (w < 2) { if (dir.includes('w')) x -= 2 - w; w = 2; }
  if (h < 2) { if (dir.includes('n')) y -= 2 - h; h = 2; }
  return { x, y, w, h };
}

function startResize(e, fid, dir) {
  e.stopPropagation();
  const top = O.topLevel(E.idx, E.sel);
  const single = top.length === 1 ? E.idx.get(top[0]) : null;
  if (single && single.rotation && single.type !== 'group') { startRotatedResize(e, single, dir); return; }
  const sx = e.clientX, sy = e.clientY;
  const base = selBox();
  const key = 'resize' + (++dragSeq);
  const targets = snapTargets(fid, E.sel.concat(E.idx.ancestors(E.sel[0]).map((g) => g.id)));
  E.drag = { kind: 'resize', fid, showContent: true };
  track(e, (ev) => {
    let dx = (ev.clientX - sx) / E.zoom, dy = (ev.clientY - sy) / E.zoom;
    let nb = resizeBox(base, dir, dx, dy, ev.shiftKey, ev.altKey);
    let gx = null, gy = null;
    if (!ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      const th = SNAP / E.zoom;
      const ex = dir.includes('e') ? nb.x + nb.w : dir.includes('w') ? nb.x : null;
      const ey = dir.includes('s') ? nb.y + nb.h : dir.includes('n') ? nb.y : null;
      if (ex != null) { gx = snapAxis([ex], targets.xs, th); if (gx) dx += gx.d; else if (gridOn()) dx += gridV(ex) - ex; }
      if (ey != null) { gy = snapAxis([ey], targets.ys, th); if (gy) dy += gy.d; else if (gridOn()) dy += gridV(ey) - ey; }
      nb = resizeBox(base, dir, dx, dy, false, ev.altKey);
    }
    E.drag.guides = guidesFor(nb, gx, gy, targets.boxes);
    const cur = selBox();
    commit(O.opsResize(E.idx, E.sel, cur, nb), '크기 조절', key);
    commit(O.opsSyncConnectors(E.idx, containerFor(fid)), '크기 조절', key);
  }, () => { E.drag = null; drawOverlay(); ui(); });
}

// 회전한 노드의 크기 조절: 마우스 이동을 노드 자신의 축으로 바꿔서 계산하고, 반대쪽 모서리는 제자리에
function startRotatedResize(e, n, dir) {
  const sx = e.clientX, sy = e.clientY, id = n.id;
  const a = n.rotation * Math.PI / 180;
  const base = { x: n.x, y: n.y, w: n.w, h: n.h };
  const c0 = [base.x + base.w / 2, base.y + base.h / 2];
  const key = 'rresize' + (++dragSeq);
  E.drag = { kind: 'resize', fid: frameOfNode(id) };
  track(e, (ev) => {
    const [lx, ly] = rot((ev.clientX - sx) / E.zoom, (ev.clientY - sy) / E.zoom, -a);
    const nb = resizeBox(base, dir, lx, ly, ev.shiftKey, ev.altKey);
    const [wx, wy] = rot(nb.x + nb.w / 2 - c0[0], nb.y + nb.h / 2 - c0[1], a);
    const cx = c0[0] + wx, cy = c0[1] + wy;
    commit([{ op: 'set', id, key: 'x', value: O.R(cx - nb.w / 2) }, { op: 'set', id, key: 'y', value: O.R(cy - nb.h / 2) },
      { op: 'set', id, key: 'w', value: O.R(nb.w) }, { op: 'set', id, key: 'h', value: O.R(nb.h) }], '크기 조절', key);
  }, () => { E.drag = null; drawOverlay(); ui(); });
}

function startRotate(e, fid) {
  e.stopPropagation();
  const n = E.idx.get(O.topLevel(E.idx, E.sel)[0]);
  const o = E.idx.offsetOf(n.id);
  const b = M.frameBounds(n, E.idx);
  const c = [b.x + b.w / 2, b.y + b.h / 2];
  const p0 = toFrame(e, fid);
  const a0 = Math.atan2(p0.y - c[1], p0.x - c[0]), r0 = n.rotation || 0;
  const key = 'rot' + (++dragSeq);
  E.drag = { kind: 'rotate', fid };
  track(e, (ev) => {
    const p = toFrame(ev, fid);
    let deg = r0 + (Math.atan2(p.y - c[1], p.x - c[0]) - a0) * 180 / Math.PI;
    if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
    deg = ((Math.round(deg * 10) / 10) % 360 + 360) % 360;
    E.drag.angle = deg; E.drag.tagAt = [c[0], c[1]];
    commit([{ op: 'set', id: n.id, key: 'rotation', value: deg ? deg : undefined }], '회전', key);
  }, () => { E.drag = null; drawOverlay(); ui(); });
  void o;
}

function startTail(e, fid) {
  e.stopPropagation();
  const n = E.idx.get(E.sel[0]);
  const o = E.idx.offsetOf(n.id);
  const key = 'tail' + (++dragSeq);
  E.drag = { kind: 'adj', fid };
  track(e, (ev) => {
    const p = toFrame(ev, fid);
    const t = [Math.round((p.x - o.x - n.x) / n.w * 100) / 100, Math.round((p.y - o.y - n.y) / n.h * 100) / 100];
    commit([{ op: 'set', id: n.id, key: 'tail', value: t }], '말풍선 꼬리', key);
  }, () => { E.drag = null; drawOverlay(); });
}

// 표 열 경계 · 행 경계 끌기
function startTableResize(e, kind, i) {
  e.stopPropagation();
  const n = E.idx.get(E.sel[0]);
  const id = n.id;
  const sx = e.clientX, sy = e.clientY;
  const cols = n.cols.slice();
  const tb = nodeEl(id) && nodeEl(id).querySelector('table');
  const rendered = tb ? [...tb.rows].map((tr) => tr.offsetHeight) : n.rows.map((r) => r.h);
  const key = 'tbr' + (++dragSeq);
  E.drag = { kind: 'table', fid: frameOfNode(id) };
  track(e, (ev) => {
    const ops = [];
    if (kind === 'col') {
      let d = (ev.clientX - sx) / E.zoom;
      const nc = cols.slice();
      if (i < cols.length - 1 && !ev.shiftKey) {
        d = Math.max(12 - cols[i], Math.min(cols[i + 1] - 12, d));
        nc[i] = O.R(cols[i] + d); nc[i + 1] = O.R(cols[i + 1] - d);
      } else nc[i] = O.R(Math.max(12, cols[i] + d));
      ops.push({ op: 'set', id, key: 'cols', value: nc }, { op: 'set', id, key: 'w', value: O.R(nc.reduce((a, b) => a + b, 0)) });
    } else {
      const d = (ev.clientY - sy) / E.zoom;
      const h = O.R(Math.max(8, rendered[i] + d));
      ops.push({ op: 'set', id, key: `rows.${i}.h`, value: h });
      ops.push({ op: 'set', id, key: 'h', value: O.R(n.rows.reduce((a, r, k) => a + (k === i ? h : r.h), 0)) });
    }
    commit(ops, kind === 'col' ? '열 너비' : '행 높이', key);
  }, () => { E.drag = null; drawOverlay(); ui(); });
}

// 표 칸 선택: 끌어서 범위, Shift+클릭으로 넓히기
function startCellSelect(e, id, td) {
  const r = +td.dataset.r, c = +td.dataset.c;
  if (e.shiftKey && E.cell && E.cell.id === id) E.cell = Object.assign({}, E.cell, { r2: r, c2: c });
  else E.cell = { id, r, c, r2: r, c2: c };
  markCell(); ui();
  track(e, (ev) => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const t2 = el && el.closest('td');
    if (!t2 || !nodeEl(id) || !nodeEl(id).contains(t2)) return;
    const r2 = +t2.dataset.r, c2 = +t2.dataset.c;
    if (r2 !== E.cell.r2 || c2 !== E.cell.c2) { E.cell = Object.assign({}, E.cell, { r2, c2 }); markCell(); }
  }, () => { ui(); drawOverlay(); });
}
export function cellRange() {
  if (!E.cell) return null;
  const n = E.idx.get(E.cell.id);
  if (!n) return null;
  return O.normalizeRange(n, { r0: E.cell.r, c0: E.cell.c, r1: E.cell.r2 != null ? E.cell.r2 : E.cell.r, c1: E.cell.c2 != null ? E.cell.c2 : E.cell.c });
}
function markCell() {
  world().querySelectorAll('td.cell-on').forEach((t) => t.classList.remove('cell-on'));
  const rg = cellRange();
  if (!rg) return;
  const host = nodeEl(E.cell.id);
  if (!host) return;
  host.querySelectorAll('td').forEach((td) => {
    const r = +td.dataset.r, c = +td.dataset.c, rs = td.rowSpan || 1, cs = td.colSpan || 1;
    if (r <= rg.r1 && r + rs - 1 >= rg.r0 && c <= rg.c1 && c + cs - 1 >= rg.c0) td.classList.add('cell-on');
  });
}
function rangeTSV() {
  const n = E.idx.get(E.cell.id), rg = cellRange();
  const out = [];
  for (let y = rg.r0; y <= rg.r1; y++) {
    const line = [];
    for (let x = rg.c0; x <= rg.c1; x++) { const k = n.rows[y].cells[x]; line.push(k ? M.plainText(k.runs).replace(/\t/g, ' ') : ''); }
    out.push(line.map((v) => (/[\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join('\t'));
  }
  return out.join('\n');
}

// ---------- 이미지 자르기 ----------
export function enterCrop(id) {
  const n = E.idx.get(id);
  if (!n || n.type !== 'image') return;
  if (n.rotation) { toast('돌린 이미지는 회전을 0°로 되돌린 뒤 자를 수 있어요.'); return; }
  E.crop = id; E.sel = [id];
  drawOverlay(); ui();
  toast('자르기: 손잡이로 남길 부분을 정하고, 이미지를 끌어 위치를 맞추세요. Enter · Esc로 끝내기');
}
export function exitCrop() { E.crop = null; drawOverlay(); ui(); }
function cropFrame(n) {
  const c = n.crop || {};
  const fw = n.w / Math.max(.01, 1 - (c.l || 0) - (c.r || 0)), fh = n.h / Math.max(.01, 1 - (c.t || 0) - (c.b || 0));
  return { x: n.x - (c.l || 0) * fw, y: n.y - (c.t || 0) * fh, w: fw, h: fh };
}
const r3 = (v) => Math.max(0, Math.round(v * 1000) / 1000);
function startCropResize(e, fid, dir) {
  e.stopPropagation();
  const n = E.idx.get(E.crop), id = n.id;
  const F = cropFrame(n), base = { x: n.x, y: n.y, w: n.w, h: n.h };
  const sx = e.clientX, sy = e.clientY, key = 'crop' + (++dragSeq);
  E.drag = { kind: 'crop', fid };
  track(e, (ev) => {
    const nb = resizeBox(base, dir, (ev.clientX - sx) / E.zoom, (ev.clientY - sy) / E.zoom, false, false);
    const x0 = Math.max(nb.x, F.x), y0 = Math.max(nb.y, F.y), x1 = Math.min(nb.x + nb.w, F.x + F.w), y1 = Math.min(nb.y + nb.h, F.y + F.h);
    if (x1 - x0 < 4 || y1 - y0 < 4) return;
    const crop = { l: r3((x0 - F.x) / F.w), t: r3((y0 - F.y) / F.h), r: r3((F.x + F.w - x1) / F.w), b: r3((F.y + F.h - y1) / F.h) };
    commit([{ op: 'set', id, key: 'x', value: O.R(x0) }, { op: 'set', id, key: 'y', value: O.R(y0) }, { op: 'set', id, key: 'w', value: O.R(x1 - x0) },
      { op: 'set', id, key: 'h', value: O.R(y1 - y0) }, { op: 'set', id, key: 'crop', value: crop }], '이미지 자르기', key);
  }, () => { E.drag = null; drawOverlay(); ui(); });
}
function startCropPan(e, fid) {
  const n = E.idx.get(E.crop), id = n.id;
  const F = cropFrame(n);
  const sx = e.clientX, sy = e.clientY, key = 'cpan' + (++dragSeq);
  E.drag = { kind: 'crop', fid };
  track(e, (ev) => {
    const fx = Math.min(n.x, Math.max(n.x + n.w - F.w, F.x + (ev.clientX - sx) / E.zoom));
    const fy = Math.min(n.y, Math.max(n.y + n.h - F.h, F.y + (ev.clientY - sy) / E.zoom));
    const l = r3((n.x - fx) / F.w), t = r3((n.y - fy) / F.h);
    commit([{ op: 'set', id, key: 'crop', value: { l, t, r: r3(1 - l - n.w / F.w), b: r3(1 - t - n.h / F.h) } }], '이미지 위치', key);
  }, () => { E.drag = null; drawOverlay(); });
}

// ---------- 연결선 · 연결점 ----------
// 노드 위에 있으면 연결선을 붙일 대상 (+ 가까운 연결점: 상하좌우 가운데)
function attachTarget(ev, excludeId, fid) {
  const els = document.elementsFromPoint(ev.clientX, ev.clientY);
  for (const el of els) {
    const h = el.closest && el.closest('[data-id]');
    if (!h) continue;
    const id = h.dataset.id;
    const n = E.idx.get(id);
    if (!n || id === excludeId || n.type === 'connector') continue;
    const tid = selectable(id, ev.ctrlKey || ev.metaKey);
    const b = nodeBox(tid);
    let side = null;
    if (fid) {
      const p = toFrame(ev, fid);
      let best = 12 / E.zoom;
      for (const s of ['n', 'e', 's', 'w']) { const q = sidePoint(b, s); const d = Math.hypot(q[0] - p.x, q[1] - p.y); if (d < best) { best = d; side = s; } }
    }
    return { id: tid, side, box: b };
  }
  return null;
}
const refOf = (t) => (t ? (t.side ? { node: t.id, side: t.side } : { node: t.id }) : null);

function startEndpoint(e, fid, end) {
  e.stopPropagation();
  const id = E.sel[0];
  const key = 'pt' + (++dragSeq);
  E.drag = { kind: 'endpoint', fid };
  track(e, (ev) => {
    const n = E.idx.get(id);
    const p = toFrame(ev, fid);
    const o = E.idx.offsetOf(id);
    const lp = [O.R(p.x - o.x - (n.x || 0)), O.R(p.y - o.y - (n.y || 0))];
    const pts = n.pts.map((q) => q.slice());
    pts[end === 'from' ? 0 : pts.length - 1] = lp;
    const tgt = attachTarget(ev, id, fid);
    E.drag.attach = tgt;
    const ops = [{ op: 'set', id, key: 'pts', value: pts }];
    ops.push(tgt ? { op: 'set', id, key: end, value: refOf(tgt) } : { op: 'set', id, key: end });
    commit(ops, '연결선 끝 이동', key);
  }, () => { E.drag = null; commit(O.opsSyncConnectors(E.idx, containerFor(fid)), '연결선 끝 이동', key); drawOverlay(); });
}

// ---------- 만들기 도구 ----------
function insertTarget(fid) {
  if (E.scope && frameOfNode(E.scope) === fid) return E.scope;
  return containerFor(fid).id;
}
function originFor(parentId) { return O.originOf(E.idx, E.idx.get(parentId)); }

export function addNode(fid, node, opts = {}) {
  const parent = opts.parent || insertTarget(fid);
  const org = originFor(parent);
  node.x = O.R(node.x - org.x); node.y = O.R(node.y - org.y);
  if (commit([{ op: 'insert', parent, index: null, item: node }], opts.label || '추가')) {
    if (opts.select !== false) select([node.id]);
    return node.id;
  }
  return null;
}

const snapAngle = (p0, p) => {
  const dx = p.x - p0.x, dy = p.y - p0.y, L = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: p0.x + Math.cos(a) * L, y: p0.y + Math.sin(a) * L };
};

function startCreate(e, fid, p0) {
  const tool = E.tool;
  const c = containerFor(fid);
  if (gridOn() && !['description'].includes(tool)) p0 = { x: gridV(p0.x), y: gridV(p0.y) };
  if (tool === 'description') {
    const n = M.createNode('description', { x: O.R(p0.x - 8), y: O.R(p0.y - 8), num: O.nextDescriptionNumber(c) });
    addNode(fid, n, { label: 'Description 추가' });
    setTool('select');
    setTimeout(() => { const t = $('#insp-desc-title'); if (t) t.focus(); }, 30);
    return;
  }
  if (tool === 'table') {
    const t = M.makeTable([90, 130, 180], [24, 24, 24, 24], { header: ['항목', '정책', '상세'], headerBg: '#d9d9d9' });
    const n = M.createNode('table', Object.assign({ x: O.R(p0.x), y: O.R(p0.y), w: 400, h: 96 }, t));
    addNode(fid, n, { label: '표 추가' });
    setTool('select');
    return;
  }
  if (tool === 'connector' || tool === 'line' || tool === 'arrow') {
    const isConn = tool === 'connector';
    const from = isConn ? attachTarget(e, null, fid) : null;
    E.drag = { kind: 'create', fid, preview: [[p0.x, p0.y], [p0.x, p0.y]], attach: from };
    const endPt = (ev) => {
      let p = toFrame(ev, fid);
      if (ev.shiftKey) p = snapAngle(p0, p);
      else if (gridOn()) p = { x: gridV(p.x), y: gridV(p.y) };
      return p;
    };
    track(e, (ev) => {
      const p = endPt(ev);
      E.drag.preview[1] = [p.x, p.y];
      E.drag.attach = isConn ? attachTarget(ev, null, fid) : null;
      drawOverlay();
    }, (ev) => {
      const p = endPt(ev);
      const to = isConn ? attachTarget(ev, null, fid) : null;
      E.drag = null;
      if (Math.hypot(p.x - p0.x, p.y - p0.y) < 4) { drawOverlay(); return; }
      const style = isConn ? {} : { stroke: '#333333', dash: 'solid', startCap: 'none', endCap: tool === 'arrow' ? 'arrow' : 'none', name: tool === 'arrow' ? '화살표' : '선' };
      const n = M.createNode('connector', Object.assign({ x: 0, y: 0, pts: [[O.R(p0.x), O.R(p0.y)], [O.R(p.x), O.R(p.y)]] }, style));
      if (from) n.from = refOf(from);
      if (to && (!from || to.id !== from.id)) n.to = refOf(to);
      const id = addNode(fid, n, { label: isConn ? '연결선 추가' : '선 추가' });
      if (id && isConn) commit(O.opsSyncConnectors(E.idx, containerFor(fid)), '연결선 추가');
      setTool('select');
    });
    return;
  }
  // 상자로 그리는 도구: 글 · 도형 · 인터랙션 영역
  E.drag = { kind: 'create', fid, draw: { x: p0.x, y: p0.y, w: 0, h: 0 } };
  track(e, (ev) => {
    let p = toFrame(ev, fid);
    if (gridOn()) p = { x: gridV(p.x), y: gridV(p.y) };
    let w = p.x - p0.x, h = p.y - p0.y;
    if (ev.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
    E.drag.draw = { x: Math.min(p0.x, p0.x + w), y: Math.min(p0.y, p0.y + h), w: Math.abs(w), h: Math.abs(h) };
    drawOverlay();
  }, () => {
    const b = E.drag.draw;
    E.drag = null;
    const tiny = b.w < 4 && b.h < 4;
    let n;
    if (tool === 'text') {
      n = M.createNode('text', { x: O.R(b.x), y: O.R(b.y), w: tiny ? 160 : O.R(b.w), h: tiny ? 18 : O.R(Math.max(16, b.h)), runs: [{ t: '' }], name: '텍스트' });
      if (tiny) n.style.fit = 'grow';
    } else if (tool === 'hotspot') {
      n = M.createNode('hotspot', { x: O.R(b.x), y: O.R(b.y), w: tiny ? 120 : O.R(b.w), h: tiny ? 40 : O.R(b.h) });
    } else {
      const kind = tool === 'ellipse' ? 'ellipse' : tool === 'shape' ? E.shapeKind : 'rect';
      const sq = ['ellipse', 'star5', 'octagon', 'hexagon', 'plus', 'decision', 'diamond'].includes(kind);
      const props = { shape: kind, x: O.R(b.x), y: O.R(b.y), w: tiny ? 100 : O.R(b.w), h: tiny ? (sq ? 100 : 60) : O.R(b.h) };
      if (/^callout/.test(kind)) { props.tail = [.22, 1.35]; props.fill = '#ffffff'; }
      n = M.createNode('shape', props);
      n.name = (P.shapeName(kind) || '도형');
    }
    const id = addNode(fid, n, { label: '추가' });
    setTool('select');
    if (id && tool === 'text') setTimeout(() => editText(id, { selectAll: true, isNew: true }), 0);
  });
}

export function setTool(t, shapeKind) {
  finishEdit();
  E.tool = t;
  if (shapeKind) E.shapeKind = shapeKind;
  const c = canvas();
  c.className = 'tool-' + (t === 'shape' || t === 'line' || t === 'arrow' ? 'rect' : t) + (c.classList.contains('sorter') ? ' sorter' : '');
  ui();
}

// ---------- 글 편집 (노드 · 표 칸 · 도형 라벨 · 인스턴스 오버라이드) ----------
function rgbHex(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('') : c;
}
// 편집한 DOM → { runs, paras }  (단락 = .p 블록, 목록 · 수준 · 정렬은 data-* 속성)
export function domToText(root, withParas) {
  const base = getComputedStyle(root);
  const bw = +base.fontWeight >= 600, bc = rgbHex(base.color), bs = parseFloat(base.fontSize), bi = base.fontStyle === 'italic';
  const runs = [], paras = [];
  const push = (t, el) => {
    if (!t) return;
    const r = { t };
    if (t !== '\n' && el && el !== root && !el.classList.contains('p')) {
      const cs = getComputedStyle(el);
      const w = +cs.fontWeight >= 600;
      if (w !== bw) r.b = w;
      if ((cs.fontStyle === 'italic') !== bi) r.i = cs.fontStyle === 'italic';
      let dec = '';
      for (let p = el; p && p !== root; p = p.parentElement) dec += ' ' + getComputedStyle(p).textDecorationLine;
      const link = el.closest('a[data-link]');
      if (dec.includes('underline') && !link) r.u = true;
      if (dec.includes('line-through')) r.s = true;
      const col = rgbHex(cs.color);
      if (col !== bc && !link) r.color = col;
      const fs = parseFloat(cs.fontSize);
      if (el.closest('sup')) r.sup = true;
      else if (el.closest('sub')) r.sub = true;
      else if (Math.abs(fs - bs) > .2) r.size = Math.round(fs * 10) / 10;
      if (link && root.contains(link)) r.link = link.dataset.link;
      const bgc = cs.backgroundColor;
      if (bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent' && el.tagName !== 'DIV') r.bg = rgbHex(bgc);
    }
    const last = runs[runs.length - 1];
    if (last && !last.img && ['b', 'i', 'u', 's', 'color', 'size', 'sup', 'sub', 'link', 'bg'].every((k) => last[k] === r[k]) && t !== '\n' && last.t !== '\n') last.t += t;
    else runs.push(r);
  };
  const attrsOf = (el) => {
    const p = {};
    if (!el || !el.dataset) return p;
    if (el.dataset.list) p.list = el.dataset.list;
    if (el.dataset.lv) p.lv = +el.dataset.lv;
    if (el.dataset.cont) p.cont = true;
    if (el.dataset.align) p.align = el.dataset.align;
    return p;
  };
  const inline = (node, para) => {
    const kids = [...node.childNodes];
    kids.forEach((ch, i) => {
      if (ch.nodeType === 3) push(ch.nodeValue.replace(/ /g, ' '), node);
      else if (ch.nodeName === 'BR') {
        const lastInBlock = i === kids.length - 1 && /^(DIV|P)$/.test(node.nodeName);
        if (lastInBlock) return;   // 빈 단락 자리표시
        push('\n', node);
        // 단락 안 줄바꿈(Shift+Enter): 같은 수준으로 이어쓰기
        paras.push(Object.assign({}, para.lv ? { lv: para.lv } : {}, (para.list || para.cont) ? { cont: true } : {}, para.align ? { align: para.align } : {}));
      } else if (ch.nodeName === 'IMG' && ch.dataset.img) runs.push({ img: ch.dataset.img, h: parseFloat(ch.style.height) || 10 });
      else if (ch.nodeType === 1 && /^(DIV|P)$/.test(ch.nodeName)) block(ch);
      else if (ch.nodeType === 1) inline(ch, para);
    });
  };
  let first = true;
  const block = (el) => {
    if (!first) push('\n', null);
    first = false;
    const p = attrsOf(el);
    paras.push(p);
    inline(el, p);
  };
  // 최상위: .p 블록들 (블록 밖에 떨어진 글은 한 단락으로)
  let loose = null;
  for (const ch of [...root.childNodes]) {
    if (ch.nodeType === 1 && /^(DIV|P)$/.test(ch.nodeName)) { loose = null; block(ch); continue; }
    if (!loose) { if (!first) push('\n', null); first = false; loose = {}; paras.push(loose); }
    if (ch.nodeType === 3) push(ch.nodeValue.replace(/ /g, ' '), root);
    else if (ch.nodeName === 'BR') { if (ch !== root.lastChild) { push('\n', root); paras.push({}); } }
    else if (ch.nodeName === 'IMG' && ch.dataset.img) runs.push({ img: ch.dataset.img, h: parseFloat(ch.style.height) || 10 });
    else inline(ch, loose);
  }
  const clean = runs.filter((r) => r.img || r.t !== '');
  // 이웃한 같은 서식 조각 합치기 (줄바꿈 포함)
  const merged = [];
  for (const r of clean) {
    const l = merged[merged.length - 1];
    if (l && !l.img && !r.img && ['b', 'i', 'u', 's', 'color', 'size', 'sup', 'sub', 'link', 'bg'].every((k) => l[k] === r[k])) l.t += r.t;
    else merged.push(Object.assign({}, r));
  }
  const out = { runs: merged.length ? merged : [{ t: '' }] };
  if (withParas) out.paras = paras.some((p) => Object.keys(p).length) ? paras : undefined;
  return out;
}

// 편집 중 단락 표시(글머리 · 번호) 다시 계산
const BUL = ['•', '–', '▪', '•', '–'];
function refreshMarkers(el) {
  const counters = [];
  el.querySelectorAll(':scope > .p, :scope > div').forEach((p) => {
    const lv = +(p.dataset.lv || 0), list = p.dataset.list, cont = !!p.dataset.cont;
    p.classList.add('p');
    let m = '';
    if (list === 'number') {
      counters.length = lv + 1; counters[lv] = (counters[lv] || 0) + 1;
      const n = counters[lv];
      m = lv % 3 === 1 ? String.fromCharCode(96 + ((n - 1) % 26) + 1) + ')' : lv % 3 === 2 ? ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][(n - 1) % 10] + '.' : n + '.';
    } else { if (!cont) counters.length = list ? lv : 0; if (list === 'bullet') m = BUL[lv]; }
    if (m) p.dataset.m = m; else delete p.dataset.m;
    p.classList.toggle('li', !!(list || cont));
    const indent = lv * 18 + (list || cont ? 14 : 0);
    p.style.paddingLeft = indent ? indent + 'px' : '';
    p.style.textAlign = p.dataset.align || '';
  });
}
// 선택이 걸친 단락들
function selectedParas(el) {
  const s = getSelection();
  if (!s.rangeCount) return [];
  const rg = s.getRangeAt(0);
  const ps = [...el.querySelectorAll(':scope > div')];
  const hit = ps.filter((p) => rg.intersectsNode(p));
  if (hit.length) return hit;
  let n = rg.startContainer;
  while (n && n.parentNode !== el) n = n.parentNode;
  return n && n.nodeType === 1 ? [n] : [];
}
export function editingParaCommand(cmd, arg) {
  const ed = E.editing;
  if (!ed || (ed.kind !== 'text' && ed.kind !== 'shape')) return false;
  const ps = selectedParas(ed.el);
  if (!ps.length) return true;
  if (cmd === 'list') {
    const allOn = ps.every((p) => p.dataset.list === arg);
    ps.forEach((p) => { if (allOn) delete p.dataset.list; else { p.dataset.list = arg; delete p.dataset.cont; } });
  } else if (cmd === 'indent') {
    ps.forEach((p) => { const lv = Math.max(0, Math.min(4, +(p.dataset.lv || 0) + arg)); if (lv) p.dataset.lv = lv; else delete p.dataset.lv; });
  } else if (cmd === 'align') {
    ps.forEach((p) => { p.dataset.align = arg; });
  }
  refreshMarkers(ed.el);
  return true;
}

export function editText(id, opts = {}) {
  flush();
  const n = E.idx.get(id);
  if (!n) return;
  let el = null, kind = n.type;
  const host = nodeEl(id);
  if (!host) return;
  if (n.type === 'text') el = host.querySelector('.tx');
  else if (n.type === 'shape') {
    if (!n.runs) { commit([{ op: 'set', id, key: 'runs', value: [{ t: '' }] }, { op: 'set', id, key: 'style', value: Object.assign({ size: 12, color: '#111111', align: 'center', valign: 'middle' }, n.style || {}) }], '라벨 추가'); renderFrameWrap(frameOfNode(id)); return editText(id, opts); }
    el = host.querySelector('.tx');
    if (!el) { renderFrameWrap(frameOfNode(id)); const h2 = nodeEl(id); el = h2 && h2.querySelector('.tx'); if (!el) { const lab = document.createElement('div'); lab.className = 'shp-label'; lab.innerHTML = '<div class="tx" style="text-align:center"><div class="p"><br></div></div>'; nodeEl(id).appendChild(lab); el = lab.firstChild; } }
  } else if (n.type === 'table') {
    const r = opts.r != null ? opts.r : (E.cell && E.cell.id === id ? E.cell.r : 0);
    const c = opts.c != null ? opts.c : (E.cell && E.cell.id === id ? E.cell.c : 0);
    el = host.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
    E.cell = { id, r, c, r2: r, c2: c };
    kind = 'cell';
  } else if (n.type === 'instance' && opts.mid) {
    el = host.querySelector(`[data-mid="${opts.mid}"] .tx`);
    kind = 'override';
  }
  if (!el) return;
  finishEdit();
  E.sel = [id];
  if (!el.firstChild && kind !== 'cell') el.innerHTML = '<div class="p"><br></div>';
  el.contentEditable = 'true';
  el.spellcheck = false;
  (el.closest('.node') || el).classList.add('editing-node');
  E.editing = { el, kind, id, r: E.cell && E.cell.r, c: E.cell && E.cell.c, mid: opts.mid, before: el.innerHTML, frame: frameOfNode(id), isNew: opts.isNew };
  el.focus();
  let rg = null;
  if (opts.point && !opts.selectAll && document.caretRangeFromPoint) {
    const c = document.caretRangeFromPoint(opts.point.x, opts.point.y);
    if (c && el.contains(c.startContainer)) rg = c;
  }
  if (!rg) { rg = document.createRange(); rg.selectNodeContents(el); if (!opts.selectAll) rg.collapse(false); }
  const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
  if (opts.insert) document.execCommand('insertText', false, opts.insert);
  el.addEventListener('blur', onEditBlur);
  el.addEventListener('keydown', onEditKey);
  el.addEventListener('input', onEditInput);
  drawOverlay();
  ui();
}
function onEditBlur() { setTimeout(() => { if (E.editing && document.activeElement !== E.editing.el && !document.activeElement.closest('.keep-edit')) finishEdit(); }, 0); }
function onEditInput() { const ed = E.editing; if (ed && (ed.kind === 'text' || ed.kind === 'shape')) refreshMarkers(ed.el); }
function onEditKey(e) {
  const ed = E.editing;
  if (!ed) return;
  e.stopPropagation();
  const mod = e.ctrlKey || e.metaKey;
  const paraKind = ed.kind === 'text' || ed.kind === 'shape';
  if (e.key === 'Escape') { e.preventDefault(); finishEdit(); return; }
  if (e.key === 'Enter' && mod) { e.preventDefault(); finishEdit(); return; }
  if (e.key === 'Enter') {
    if (paraKind) { if (e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); } return; }   // Enter = 새 단락 (브라우저 기본)
    e.preventDefault(); document.execCommand('insertLineBreak'); return;
  }
  if (e.key === 'Tab' && paraKind) { e.preventDefault(); editingParaCommand('indent', e.shiftKey ? -1 : 1); return; }
  if (e.key === 'Tab' && ed.kind === 'cell') {
    e.preventDefault();
    const n = E.idx.get(ed.id);
    let r = ed.r, c = ed.c;
    const step = e.shiftKey ? -1 : 1;
    do { c += step; if (c >= n.cols.length) { c = 0; r++; } if (c < 0) { c = n.cols.length - 1; r--; } } while (r >= 0 && r < n.rows.length && !n.rows[r].cells[c]);
    finishEdit();
    if (r >= 0 && r < n.rows.length) setTimeout(() => editText(ed.id, { r, c, selectAll: true }), 0);
    return;
  }
  if (mod && e.shiftKey && (e.code === 'Digit8' || e.code === 'Digit7') && paraKind) { e.preventDefault(); editingParaCommand('list', e.code === 'Digit8' ? 'bullet' : 'number'); return; }
  if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()]); return; }
  if (mod && (e.key === '=' || e.key === '+') && !e.shiftKey) { e.preventDefault(); document.execCommand(document.queryCommandState('subscript') ? 'subscript' : 'superscript'); return; }
  if (mod && e.key === 'k') { e.preventDefault(); insertLinkWhileEditing(); }
}
function insertLinkWhileEditing() {
  const url = prompt('링크 주소 (https://…) 또는 프레임 이름', 'https://');
  if (!url) return;
  const f = E.idx.frames().find((x) => x.name === url);
  const href = f ? 'frame:' + f.id : url;
  document.execCommand('createLink', false, href);
  E.editing.el.querySelectorAll('a[href]').forEach((a) => { if (!a.dataset.link) { a.dataset.link = a.getAttribute('href'); a.className = 'run-link'; } });
}

export function finishEdit() {
  const ed = E.editing;
  if (!ed) return;
  E.editing = null;
  ed.el.removeEventListener('blur', onEditBlur);
  ed.el.removeEventListener('keydown', onEditKey);
  ed.el.removeEventListener('input', onEditInput);
  const paraKind = ed.kind === 'text' || ed.kind === 'shape';
  const changed = ed.el.innerHTML !== ed.before;
  const out = changed ? domToText(ed.el, paraKind) : null;
  const host = ed.el.closest('.node');
  const h = ed.kind === 'text' ? Math.max(ed.el.scrollHeight, host ? host.scrollHeight : 0) : 0;
  ed.el.contentEditable = 'false';
  if (host) host.classList.remove('editing-node');
  const n = E.idx.get(ed.id);
  if (!n) return;
  const ops = [];
  if (out) {
    if (paraKind) {
      ops.push({ op: 'set', id: ed.id, key: 'runs', value: out.runs });
      if (JSON.stringify(out.paras) !== JSON.stringify(n.paras)) ops.push({ op: 'set', id: ed.id, key: 'paras', value: out.paras });
      if (ed.kind === 'text') {
        const first = M.plainText(out.runs).split('\n')[0].slice(0, 24);
        if (n.name === M.defaultName(n) || n.name === '텍스트') ops.push({ op: 'set', id: ed.id, key: 'name', value: first || '텍스트' });
      }
    } else if (ed.kind === 'cell') ops.push({ op: 'set', id: ed.id, key: `rows.${ed.r}.cells.${ed.c}.runs`, value: out.runs });
    else if (ed.kind === 'override') ops.push({ op: 'set', id: ed.id, key: `overrides.${ed.mid}.runs`, value: out.runs });
  }
  if (ed.kind === 'text') {
    const empty = !M.plainText(out ? out.runs : n.runs).trim();
    if (empty && ed.isNew) { commit([{ op: 'remove', id: ed.id }], '빈 글 삭제'); E.sel = []; scheduleRenderAll(ed.frame); return; }
    const s = n.style || {};
    if (s.fit === 'grow' && host) { const hh = Math.ceil(host.offsetHeight); if (Math.abs(hh - n.h) > 1) ops.push({ op: 'set', id: ed.id, key: 'h', value: hh }); }
    else if (h > n.h + 1 && !s.nowrap && s.fit !== 'shrink' && !n.rotation) ops.push({ op: 'set', id: ed.id, key: 'h', value: Math.ceil(h) });
  }
  if (ops.length) commit(ops, '글 편집');
  else { scheduleRenderAll(ed.frame); ui(); }
}
function scheduleRenderAll(fid) { dirtyFrames = dirtyFrames === 'all' ? 'all' : new Set([...(dirtyFrames || []), fid]); scheduleRender(); }

// 바탕(레이아웃) 칸 바로 고치기: 문서 정보 · 프레임 속성
function editField(el, fid) {
  finishEdit();
  const path = el.dataset.bind;
  const before = el.classList.contains('ch-empty') ? '' : el.textContent;
  el.classList.remove('ch-empty');
  if (!before) el.textContent = '';
  try { el.contentEditable = 'plaintext-only'; } catch (e) { el.contentEditable = 'true'; }
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.focus();
  const rg = document.createRange(); rg.selectNodeContents(el);
  const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
  const done = (save) => {
    el.removeEventListener('blur', blur); el.removeEventListener('keydown', key);
    el.contentEditable = 'false';
    const v = el.innerText.replace(/\n+$/, '');
    if (!save || v === before) { scheduleRenderAll(fid); return; }
    const ops = [];
    if (path.startsWith('meta.')) ops.push({ op: 'set', id: 'doc', key: path, value: v });
    else {
      const f = E.idx.get(fid);
      ops.push({ op: 'set', id: fid, key: path, value: v });
      if (path === 'props.pageName' && f && (f.name === before || !f.name)) ops.push({ op: 'set', id: fid, key: 'name', value: v });
      if (path === 'props.title' && f && (f.name === before || !f.name)) ops.push({ op: 'set', id: fid, key: 'name', value: v });
    }
    commit(ops, '양식 칸 편집');
  };
  const blur = () => done(true);
  const key = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); done(false); }
    else if (e.key === 'Enter' && !(path === 'meta.title' && e.shiftKey)) { e.preventDefault(); el.blur(); }
  };
  el.addEventListener('blur', blur);
  el.addEventListener('keydown', key);
}

function onDbl(e) {
  if (E.view === 'sorter') return;
  const wrap = e.target.closest('.fwrap');
  if (!wrap) return;
  const fid = wrap.dataset.fw;
  const field = e.target.closest('.ch-field');
  if (field && !e.target.closest('[data-id]')) { editField(field, fid); return; }
  const hit = e.target.closest('[data-id]');
  if (!hit) return;
  const id = selectable(hit.dataset.id, false);
  const n = E.idx.get(id);
  if (!n) return;
  if (n.type === 'group') {
    // 그룹 안으로 들어가 눌린 자식을 고른다
    E.scope = id;
    const inner = selectable(hit.dataset.id, false);
    select([inner]);
    const k = E.idx.get(inner);
    if (k && (k.type === 'text')) editText(inner, { point: { x: e.clientX, y: e.clientY } });
    return;
  }
  const pt = { x: e.clientX, y: e.clientY };
  if (n.type === 'text' || n.type === 'shape') { editText(id, { point: pt }); return; }
  if (n.type === 'image') { enterCrop(id); return; }
  if (n.type === 'table') { const td = e.target.closest('td'); if (td) editText(id, { r: +td.dataset.r, c: +td.dataset.c, point: pt }); return; }
  if (n.type === 'instance') {
    const m = e.target.closest('[data-mid]');
    let mid = null;
    for (let el = e.target.closest('[data-mid]'); el; el = el.parentElement && el.parentElement.closest('[data-mid]')) {
      if (el.classList.contains('n-text') || (el.classList.contains('n-shape') && el.querySelector('.tx'))) { mid = el.dataset.mid; break; }
    }
    if (mid) editText(id, { mid, point: pt });
    else if (m) toast('인스턴스의 글자만 바로 고칠 수 있어요. 모양을 바꾸려면 오른쪽 패널에서 "원본 편집"을 누르세요.');
    return;
  }
  if (n.type === 'description') { const t = $('#insp-desc-title'); if (t) t.focus(); }
  if (n.type === 'hotspot') { const t = $('#insp-hot-type'); if (t) t.focus(); }
}

function onHover(e) {
  if (E.drag || E.view === 'sorter') return;
  const hit = e.target.closest && e.target.closest('[data-id]');
  const id = hit && E.idx.get(hit.dataset.id) ? selectable(hit.dataset.id, e.ctrlKey || e.metaKey) : null;
  if (id !== E.hoverId) { E.hoverId = id; drawOverlay(); }
}

// ---------- 명령 ----------
export function deleteSelection() {
  if (E.cell && E.sel.length === 1 && E.sel[0] === E.cell.id) {
    commit(O.opsCells(E.idx.get(E.cell.id), cellRange(), 'runs', [{ t: '' }]), '칸 비우기');
    return;
  }
  if (!E.sel.length) {
    if (E.frameSel) deleteFrame(E.frameSel);
    return;
  }
  commit(O.opsDelete(E.idx, E.sel), '삭제');
  E.sel = [];
  select([]);
}
export function deleteFrame(fid) {
  const f = E.idx.get(fid);
  if (!f || !confirm(`"${f.name}" 프레임을 삭제할까요? (되돌리기로 복구할 수 있어요)`)) return;
  commit([{ op: 'remove', id: fid }], '프레임 삭제');
  E.frameSel = null;
}
export function groupSelection() {
  const r = O.opsGroup(E.idx, E.sel);
  if (!r) { toast('같은 위치(같은 그룹 · 같은 프레임)에 있는 것끼리만 묶을 수 있어요.'); return; }
  if (commit(r.ops, '그룹')) select([r.id]);
}
export function ungroupSelection() {
  const ids = [];
  for (const id of O.topLevel(E.idx, E.sel)) {
    const n = E.idx.get(id);
    if (n.type !== 'group') { ids.push(id); continue; }
    const r = O.opsUngroup(E.idx, id);
    if (r) { commit(r.ops, '그룹 해제', 'ungroup' + dragSeq); ids.push(...r.ids); }
  }
  dragSeq++;
  if (E.scope && !E.idx.get(E.scope)) E.scope = null;
  select(ids);
}
export function zorder(dir) { commit(O.opsZ(E.idx, E.sel, dir), '순서 변경'); drawOverlay(); }
export function align(mode) {
  if (!E.sel.length) return;
  const fid = frameOfNode(E.sel[0]);
  let ref = null;
  if (O.topLevel(E.idx, E.sel).length === 1) {
    const anc = E.idx.ancestors(E.sel[0]);
    ref = anc.length ? nodeBox(anc[0].id) : (contentBox(fid) || frameBoxOf(fid));
  }
  commit(O.opsAlign(E.idx, E.sel, mode, ref), '정렬');
  commit(O.opsSyncConnectors(E.idx, containerFor(fid)), '정렬');
}
export function distribute(axis) { commit(O.opsDistribute(E.idx, E.sel, axis), '간격 맞추기'); }
export function sameSize(mode) { commit(O.opsSameSize(E.idx, E.sel, mode), '크기 같게'); }

export function duplicate() {
  if (!E.sel.length) return;
  const pl = O.copyPayload(E.idx, E.sel);
  const parent = O.parentId(E.idx, O.topLevel(E.idx, E.sel)[0]);
  const r = O.opsPaste(E.idx, pl, parent, 12, 12);
  if (commit(r.ops, '복제')) select(r.ids);
}
export function pastePayload(pl) {
  const fid = E.compId || E.activeFrame;
  if (!fid) { toast('붙여 넣을 프레임을 먼저 고르세요.'); return; }
  let parent = containerFor(fid).id;
  if (E.scope && frameOfNode(E.scope) === fid) parent = E.scope;
  // 같은 자리에 원본이 그대로 있으면 살짝 비켜서 붙인다
  const same = pl.doc === E.doc.id && pl.nodes.every((n) => { const o = E.idx.get(n.id); return o && frameOfNode(n.id) === fid && Math.abs(nodeBox(n.id).x - n.x) < 1; });
  const r = O.opsPaste(E.idx, pl, parent, same ? 12 : 0, same ? 12 : 0);
  if (commit(r.ops, '붙여넣기')) select(r.ids);
}

// 서식 복사 · 붙여넣기 · 서식 붓
export function copyFormat() {
  const n = E.sel.length && E.idx.get(O.topLevel(E.idx, E.sel)[0]);
  if (!n) return;
  E.fmt = O.extractFormat(n);
  toast('서식을 복사했어요. 다른 요소를 고르고 Ctrl+Shift+V');
  ui();
}
export function pasteFormat() {
  if (!E.fmt) { toast('먼저 Ctrl+Shift+C로 서식을 복사하세요.'); return; }
  commit(O.opsApplyFormat(E.idx, E.sel, E.fmt), '서식 붙여넣기');
}
export function startPainter() {
  copyFormat();
  if (!E.fmt) return;
  E.painter = true;
  canvas().classList.add('painting');
  toast('서식 붓: 서식을 입힐 요소를 누르세요 (Esc 취소)');
}
export function bumpFontSize(d) {
  const ops = [];
  for (const id of O.topLevel(E.idx, E.sel)) {
    const n = E.idx.get(id);
    if (n.type === 'text' || n.type === 'shape') ops.push({ op: 'set', id, key: 'style.size', value: Math.max(4, ((n.style && n.style.size) || 12) + d) });
    if (n.type === 'table') ops.push({ op: 'set', id, key: 'style.size', value: Math.max(4, ((n.style && n.style.size) || 9) + d) });
  }
  commit(ops, '글자 크기', 'fontsize');
}

export function makeComponent() {
  if (!E.sel.length) return;
  const name = prompt('컴포넌트 이름', E.sel.length === 1 ? E.idx.get(E.sel[0]).name : '컴포넌트');
  if (name == null) return;
  const r = O.opsCreateComponent(E.idx, E.sel, name);
  if (!r) { toast('같은 위치에 있는 것끼리만 컴포넌트로 만들 수 있어요.'); return; }
  if (commit(r.ops, '컴포넌트 만들기')) { select([r.instanceId]); E.leftTab = 'components'; ui(); toast('컴포넌트를 만들었어요. 원본을 고치면 모든 인스턴스가 함께 바뀝니다.'); }
}
export function detachInstance(id) {
  const r = O.opsDetach(E.idx, id);
  if (r && commit(r.ops, '인스턴스 분리')) select([r.id]);
}
export function editComponent(cid) {
  finishEdit();
  E.compId = cid; E.sel = []; E.scope = null; E.frameSel = null; E.view = 'canvas';
  renderCanvas(); fitWidth(); ui();
}
export function exitComponent() {
  const cid = E.compId;
  E.compId = null; E.sel = []; E.scope = null;
  renderCanvas(); fitWidth(); ui();
  if (cid) { const inst = O.instancesOf(E.doc, cid)[0]; if (inst && E.idx.containerOf(inst.id) && E.idx.pageOf(inst.id)) { E.pageId = E.idx.pageOf(inst.id).id; renderCanvas(); select([inst.id]); scrollToFrame(frameOfNode(inst.id)); } }
}
export function insertInstance(cid, fid, at) {
  const comp = E.doc.components.find((c) => c.id === cid);
  fid = fid || E.compId || E.activeFrame;
  if (!comp || !fid) return;
  if (E.compId === cid) { toast('컴포넌트 안에 자기 자신을 넣을 수는 없어요.'); return; }
  if (E.compId) {
    // 컴포넌트 안에 다른 컴포넌트를 넣을 때 순환 금지
    const test = M.clone(E.doc); const host = test.components.find((c) => c.id === E.compId);
    host.nodes.push(M.createNode('instance', { component: cid, w: 1, h: 1 }));
    if (M.validate(test).some((x) => x.includes('자기 자신'))) { toast('서로를 품는 컴포넌트는 만들 수 없어요.'); return; }
  }
  const cb = contentBox(fid) || { x: 0, y: 0, w: 300, h: 200 };
  const p = at || { x: cb.x + cb.w / 2 - comp.w / 2, y: cb.y + cb.h / 2 - comp.h / 2 };
  addNode(fid, M.createNode('instance', { name: comp.name, x: O.R(p.x), y: O.R(p.y), w: comp.w, h: comp.h, component: cid, overrides: {} }), { label: '인스턴스 넣기' });
}

export function addFrame(layout, opts = {}) {
  const page = opts.page ? E.idx.get(opts.page) : currentPage();
  if (!page) return;
  const f = makeFrame(layout);
  if (layout === 'divider') {
    const n = E.idx.frames().filter((x) => x.layout === 'divider').length + 1;
    f.props.number = String(n).padStart(2, '0'); f.props.title = '장 제목'; f.name = f.props.number + ' 장 제목';
  }
  let at = page.frames.length;
  const after = opts.after || E.activeFrame;
  if (after) { const i = page.frames.findIndex((x) => x.id === after); if (i >= 0) at = i + 1; }
  if (commit([{ op: 'insert', parent: page.id, index: at, item: f }], '프레임 추가')) {
    E.collapsed.delete(f.id);
    if (page.id !== E.pageId && E.view === 'canvas') { E.pageId = page.id; renderCanvas(); }
    setActiveFrame(f.id);
    select([], { frame: f.id });
    if (E.view === 'canvas') setTimeout(() => scrollToFrame(f.id), 30);
  }
}
export function addPage() {
  const name = prompt('페이지(장) 이름', '페이지 ' + (E.doc.pages.length + 1));
  if (name == null) return;
  const p = M.createPage(name, [makeFrame('blank')]);
  if (commit([{ op: 'insert', parent: 'doc', index: null, item: p }], '페이지 추가')) { E.pageId = p.id; E.activeFrame = p.frames[0].id; renderCanvas(); }
}
export function gotoPage(pid) {
  finishEdit();
  if (E.compId) E.compId = null;
  E.pageId = pid; E.sel = []; E.scope = null; E.frameSel = null; E.crop = null;
  const p = currentPage();
  E.activeFrame = p && p.frames[0] ? p.frames[0].id : null;
  if (E.view === 'sorter') E.view = 'canvas';
  renderCanvas();
  canvas().scrollTop = 0;
  ui();
}
export function toggleFrameHidden(fid) {
  const f = E.idx.get(fid);
  if (f) commit([{ op: 'set', id: fid, key: 'hidden', value: f.hidden ? undefined : true }], f.hidden ? '프레임 보이기' : '프레임 숨기기');
}
export function setSetting(key, value) {
  commit([{ op: 'set', id: 'doc', key: 'settings.' + key, value }], '보기 설정');
}

export async function addImageFiles(files, fid, at) {
  fid = fid || E.compId || E.activeFrame;
  if (!fid) return;
  let k = 0;
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const a = await store.readImageFile(f);
      const aid = M.uid('img');
      const sc = Math.min(1, 420 / a.w, 380 / a.h);
      const w = O.R(a.w * sc), h = O.R(a.h * sc);
      const cb = contentBox(fid) || { x: 0, y: 0, w: 400, h: 300 };
      const p = at ? { x: at.x + k * 16, y: at.y + k * 16 } : { x: cb.x + cb.w / 2 - w / 2 + k * 16, y: cb.y + cb.h / 2 - h / 2 + k * 16 };
      const parent = insertTarget(fid);
      const org = originFor(parent);
      const n = M.createNode('image', { name: (a.name || '이미지').replace(/\.[^.]+$/, ''), x: O.R(p.x - org.x), y: O.R(p.y - org.y), w, h, asset: aid });
      if (commit([{ op: 'set', id: 'doc', key: 'assets.' + aid, value: { mime: a.mime, data: a.data, w: a.w, h: a.h, name: a.name } }, { op: 'insert', parent, index: null, item: n }], '이미지 추가')) select([n.id]);
      k++;
    } catch (err) { toast(err.message, true); }
  }
}
export function pickImage() {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = 'image/*'; i.multiple = true;
  i.onchange = () => addImageFiles([...i.files]);
  i.click();
  setTool('select');
}

// ---------- 저장 ----------
let saveT = 0;
export function setSaveState(text, cls) { const s = $('#save-state'); if (s) { s.textContent = text; s.className = 'save-state ' + (cls || ''); } }
function autosave() {
  clearTimeout(saveT);
  setSaveState('저장 대기…', '');
  saveT = setTimeout(async () => {
    try {
      const size = await store.saveLocal(E.doc);
      const t = new Date();
      setSaveState(`자동 저장 · 검증 통과 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} (${(size / 1024).toFixed(0)}KB)`, 'ok');
    } catch (err) { console.error(err); setSaveState('자동 저장 실패: ' + err.message.split('\n')[0], 'err'); }
  }, 700);
}
export async function saveToFile(saveAs) {
  finishEdit();
  try {
    E.handle = await store.saveFile(E.doc, E.handle, saveAs);
    toast(E.handle ? `"${E.handle.name}"에 저장했어요.` : '파일로 내려받았어요.');
  } catch (err) { if (err.name !== 'AbortError') toast('저장 실패: ' + err.message, true); }
}
export async function openFromFile() {
  try { const r = await store.openFile(); P.closeModal(); openDoc(r.doc, r.handle); toast('문서를 열었어요 — 검증 통과'); }
  catch (err) { if (err.name !== 'AbortError' && err.message !== '취소됨') toast('열 수 없는 문서입니다:\n' + err.message, true); }
}

// ---------- 키보드 · 클립보드 ----------
const isField = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
function cycleSelection(back) {
  const fid = E.compId || E.activeFrame;
  if (!fid) return;
  const list = (E.scope ? E.idx.get(E.scope).children : containerFor(fid).nodes).filter((n) => !n.hidden && !n.locked);
  if (!list.length) return;
  const cur = E.sel.length ? list.findIndex((n) => n.id === E.sel[0]) : -1;
  const next = cur < 0 ? (back ? list.length - 1 : 0) : (cur + (back ? -1 : 1) + list.length) % list.length;
  select([list[next].id]);
}
function moveCell(dr, dc, extend) {
  const n = E.idx.get(E.cell.id);
  const base = extend ? { r: E.cell.r2, c: E.cell.c2 } : { r: E.cell.r, c: E.cell.c };
  let r = Math.max(0, Math.min(n.rows.length - 1, base.r + dr)), c = Math.max(0, Math.min(n.cols.length - 1, base.c + dc));
  const o = O.cellOwner(n, r, c); r = o.r; c = o.c;
  E.cell = extend ? Object.assign({}, E.cell, { r2: r, c2: c }) : { id: n.id, r, c, r2: r, c2: c };
  markCell(); ui();
}
function onKey(e) {
  if (e.key === 'Alt') { E.altDown = true; drawOverlay(); }
  if (isField(e.target)) return;
  if (document.querySelector('.modal-bg') || document.getElementById('present') || document.querySelector('.find-panel input:focus')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === 'F5') { e.preventDefault(); P.present(e.shiftKey ? E.activeFrame : 'first'); return; }
  if (e.code === 'Space') { spaceDown = true; e.preventDefault(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 's') { e.preventDefault(); saveToFile(e.shiftKey); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
  if (mod && k === 'f') { e.preventDefault(); P.findDialog(false); return; }
  if (mod && k === 'h') { e.preventDefault(); P.findDialog(true); return; }
  if (mod && k === 'm') { e.preventDefault(); const f = E.activeFrame && E.idx.get(E.activeFrame); addFrame(f && f.kind === 'frame' && !['cover', 'end'].includes(f.layout) ? f.layout : 'screen'); return; }
  if (mod && e.shiftKey && k === 'c') { e.preventDefault(); copyFormat(); return; }
  if (mod && e.shiftKey && k === 'v') { e.preventDefault(); pasteFormat(); return; }
  if (mod && e.shiftKey && (e.key === '>' || e.code === 'Period')) { e.preventDefault(); bumpFontSize(1); return; }
  if (mod && e.shiftKey && (e.key === '<' || e.code === 'Comma')) { e.preventDefault(); bumpFontSize(-1); return; }
  if (mod && e.shiftKey && (e.code === 'Digit8' || e.code === 'Digit7')) {
    e.preventDefault();
    const list = e.code === 'Digit8' ? 'bullet' : 'number';
    const ops = O.topLevel(E.idx, E.sel).map((id) => E.idx.get(id)).filter((n) => n.type === 'text' || (n.type === 'shape' && n.runs)).flatMap((n) => O.opsListAll(n, list));
    commit(ops, '목록');
    return;
  }
  // 표 칸 범위를 고른 상태
  if (E.cell && E.sel.length === 1 && E.sel[0] === E.cell.id && !mod) {
    if (e.key.startsWith('Arrow')) { e.preventDefault(); moveCell(e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0, e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, e.shiftKey); return; }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); editText(E.cell.id, { r: E.cell.r, c: E.cell.c }); return; }
    if (e.key === 'Escape') { E.cell = null; markCell(); ui(); drawOverlay(); return; }
    if (e.key.length === 1 && !e.altKey) { e.preventDefault(); editText(E.cell.id, { r: E.cell.r, c: E.cell.c, selectAll: true, insert: e.key }); return; }
  }
  // 클립보드 이벤트가 막힌 환경을 위한 예비 경로 (정상 환경에서는 copy · paste 이벤트가 먼저 처리)
  if (mod && (k === 'c' || k === 'x') && E.sel.length && !e.shiftKey) {
    if (!E.cell) E.clip = O.copyPayload(E.idx, E.sel);
    if (k === 'x') { cutHandled = false; const ids = E.sel.slice(); setTimeout(() => { if (!cutHandled && ids.every((id) => E.idx.get(id))) deleteSelection(); }, 80); }
    return;
  }
  if (mod && k === 'v' && !e.shiftKey) { pasteHandled = false; setTimeout(() => { if (!pasteHandled && E.clip) pastePayload(E.clip); }, 80); return; }
  if (mod && e.altKey && k === 'k') { e.preventDefault(); makeComponent(); return; }
  if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSelection() : groupSelection(); return; }
  if (mod && (e.key === ']' || e.code === 'BracketRight')) { e.preventDefault(); zorder(e.shiftKey ? 'front' : 'forward'); return; }
  if (mod && (e.key === '[' || e.code === 'BracketLeft')) { e.preventDefault(); zorder(e.shiftKey ? 'back' : 'backward'); return; }
  if (mod && k === 'a') {
    e.preventDefault();
    const fid = E.compId || E.activeFrame;
    if (!fid) return;
    const list = E.scope ? E.idx.get(E.scope).children : containerFor(fid).nodes;
    select(list.filter((n) => !n.locked && !n.hidden).map((n) => n.id));
    return;
  }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); setZoom(E.zoom * 1.2); return; }
  if (mod && k === '-') { e.preventDefault(); setZoom(E.zoom / 1.2); return; }
  if (mod && k === '0') { e.preventDefault(); setZoom(1); return; }
  if (e.shiftKey && e.code === 'Digit1') { fitWidth(); return; }
  if (e.shiftKey && !mod && e.code === 'KeyR') { setSetting('rulers', !E.doc.settings.rulers); return; }
  if (e.shiftKey && !mod && e.code === 'Quote') { setSetting('gridShow', !E.doc.settings.gridShow); return; }
  if (e.altKey && !mod) {
    const m = { KeyA: 'left', KeyD: 'right', KeyH: 'hcenter', KeyW: 'top', KeyS: 'bottom', KeyV: 'vcenter' }[e.code];
    if (m) { e.preventDefault(); align(m); return; }
  }
  if (e.key === 'Tab') { e.preventDefault(); cycleSelection(e.shiftKey); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (e.key === 'Escape') {
    if (E.crop) exitCrop();
    else if (E.painter) { E.painter = false; canvas().classList.remove('painting'); }
    else if (E.tool !== 'select') setTool('select');
    else if (E.scope) { const g = E.scope; E.scope = null; select([g]); }
    else if (E.sel.length) select([]);
    else if (E.compId) exitComponent();
    else if (E.view === 'sorter') setView('canvas');
    return;
  }
  if ((e.key === 'Enter' || e.key === 'F2') && E.crop) { exitCrop(); return; }
  if ((e.key === 'Enter' || e.key === 'F2') && E.sel.length === 1) {
    e.preventDefault();
    const n = E.idx.get(E.sel[0]);
    if (n.type === 'group' && n.children.length && e.key === 'Enter') { E.scope = n.id; select([n.children[n.children.length - 1].id]); }
    else if (n.type === 'text' || n.type === 'shape' || n.type === 'table') editText(n.id, { selectAll: n.type !== 'table' && e.key === 'Enter' });
    return;
  }
  if (e.key.startsWith('Arrow') && E.sel.length) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
    const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
    commit(O.opsMove(E.idx, E.sel, dx, dy), '이동', 'nudge');
    commit(O.opsSyncConnectors(E.idx, containerFor(frameOfNode(E.sel[0]))), '이동', 'nudge');
    return;
  }
  if (!mod && !e.altKey && !e.shiftKey) {
    const t = { v: 'select', t: 'text', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', c: 'connector', d: 'description', h: 'hotspot', b: 'table' }[k];
    if (t) { setTool(t); return; }
    if (k === 'i') { pickImage(); return; }
  }
}
function onKeyUp(e) {
  if (e.key === 'Alt') { E.altDown = false; drawOverlay(); }
  if (e.code === 'Space') spaceDown = false;
}

let pasteHandled = true, cutHandled = true;
function onCopy(e, cut) {
  if (cut) cutHandled = true;
  if (isField(e.target) || E.editing || !E.sel.length) return;
  // 표 칸 범위 → 엑셀에 붙일 수 있는 탭 구분 글
  if (E.cell && E.sel[0] === E.cell.id) {
    e.clipboardData.setData('text/plain', rangeTSV());
    e.preventDefault();
    if (cut) commit(O.opsCells(E.idx.get(E.cell.id), cellRange(), 'runs', [{ t: '' }]), '칸 잘라내기');
    return;
  }
  const pl = O.copyPayload(E.idx, E.sel);
  E.clip = pl;
  e.clipboardData.setData('text/plain', 'TNSPEC:' + JSON.stringify(pl));
  e.preventDefault();
  if (cut) deleteSelection();
}
// HTML 표(엑셀 · 구글 시트 · 웹)를 칸 배열로
function htmlTableGrid(html) {
  if (!/<table/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const t = doc.querySelector('table');
  if (!t) return null;
  const grid = [...t.rows].map((tr) => [...tr.cells].map((td) => td.innerText != null ? td.textContent.replace(/\s+\n/g, '\n').trim() : ''));
  const w = Math.max(...grid.map((r) => r.length));
  return grid.length ? grid.map((r) => r.concat(Array(w - r.length).fill(''))) : null;
}
function onPaste(e) {
  pasteHandled = true;
  if (isField(e.target) || E.editing || document.querySelector('.modal-bg')) return;
  const dt = e.clipboardData;
  const files = [...(dt.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); addImageFiles(files); return; }
  const text = dt.getData('text/plain');
  if (text && text.startsWith('TNSPEC:')) {
    e.preventDefault();
    try { pastePayload(JSON.parse(text.slice(7))); } catch (err) { toast('붙여 넣을 수 없는 데이터입니다', true); }
    return;
  }
  const grid = htmlTableGrid(dt.getData('text/html') || '') || (text && O.looksTabular(text) ? O.parseTSV(text) : null);
  // 표 칸을 고른 상태: 그 칸부터 채우기
  if (E.cell && E.sel[0] === E.cell.id && (grid || text)) {
    e.preventDefault();
    const rg = cellRange();
    commit(O.opsTableFill(E.idx.get(E.cell.id), rg.r0, rg.c0, grid || [[text.replace(/\r?\n$/, '')]]), '표에 붙여넣기');
    return;
  }
  const fid = E.compId || E.activeFrame;
  if (grid && grid.length && (grid.length > 1 || grid[0].length > 1) && fid) {
    e.preventDefault();
    const cb = contentBox(fid) || { x: 20, y: 20, w: 600 };
    const t = O.tableFromGrid(grid, { maxW: Math.min(700, cb.w - 40) });
    addNode(fid, M.createNode('table', Object.assign({ x: cb.x + 20, y: cb.y + 20 }, t)), { label: '표 붙여넣기' });
    toast(`${grid.length}행 × ${grid[0].length}열 표를 만들었어요.`);
    return;
  }
  if (text) {
    e.preventDefault();
    if (!fid) return;
    const cb = contentBox(fid) || { x: 20, y: 20, w: 300 };
    const lines = text.replace(/\r/g, '').split('\n');
    const n = M.createNode('text', { x: cb.x + 20, y: cb.y + 20, w: Math.min(cb.w - 40, Math.max(120, Math.max(...lines.map((l) => l.length)) * 7)), h: Math.max(18, lines.length * 16), runs: [{ t: text.replace(/\r/g, '') }] });
    n.style.fit = 'grow';
    addNode(fid, n, { label: '글 붙여넣기' });
    return;
  }
  if (E.clip) { e.preventDefault(); pastePayload(E.clip); }
}

// ---------- 알림 ----------
let toastT = 0;
export function toast(msg, err) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); document.body.appendChild(t); }
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  clearTimeout(toastT);
  toastT = setTimeout(() => t.remove(), err ? 6000 : 2600);
}
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- 시작 ----------
export function boot() {
  const c = canvas();
  c.addEventListener('pointerdown', onDown);
  c.addEventListener('dblclick', onDbl);
  c.addEventListener('pointermove', onHover);
  c.addEventListener('pointerleave', () => { E.hoverId = null; drawOverlay(); });
  c.addEventListener('scroll', () => V.drawRulers(E));
  c.addEventListener('click', (e) => { const a = e.target.closest('a.run-link'); if (a && !E.editing) e.preventDefault(); });
  c.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(E.zoom * Math.pow(1.0015, -e.deltaY), e.clientX, e.clientY); }
  }, { passive: false });
  c.addEventListener('dragover', (e) => { if (E.view === 'canvas' && [...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/x-tn-comp')) e.preventDefault(); });
  // PPTX · PDF 는 어디에 놓아도 가져오기 (이미지는 캔버스에 놓은 자리로)
  window.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    const f = [...(e.dataTransfer.files || [])].find(P.isImportable);
    if (f) { e.preventDefault(); P.importFile(f); return; }
    if (!e.target.closest('#canvas')) e.preventDefault();   // 다른 파일을 놓아도 브라우저가 페이지를 떠나지 않게
  });
  c.addEventListener('drop', (e) => {
    if ([...(e.dataTransfer.files || [])].some(P.isImportable)) return;
    if (E.view !== 'canvas') return;
    const wrap = e.target.closest('.fwrap');
    if (!wrap) return;
    e.preventDefault();
    const fid = wrap.dataset.fw;
    const p = toFrame(e, fid);
    const cid = e.dataTransfer.getData('text/x-tn-comp');
    if (cid) { const comp = E.doc.components.find((k) => k.id === cid); if (comp) insertInstance(cid, fid, { x: p.x - comp.w / 2, y: p.y - comp.h / 2 }); return; }
    addImageFiles([...e.dataTransfer.files], fid, p);
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { E.altDown = false; spaceDown = false; });
  document.addEventListener('copy', (e) => onCopy(e, false));
  document.addEventListener('cut', (e) => onCopy(e, true));
  document.addEventListener('paste', onPaste);
  window.addEventListener('resize', () => applyZoom());
  window.addEventListener('beforeunload', () => { finishEdit(); });
  P.init(E);
  V.init(E);
  // 마지막으로 작업한 문서를 바로 연다 (없으면 시작 화면)
  let last = null;
  try { last = localStorage.getItem('tnspec:last'); } catch (e) { /* 저장소 차단 */ }
  const fromUrl = new URLSearchParams(location.search).get('new');
  if (last && !fromUrl) store.openLocal(last).then((doc) => openDoc(doc)).catch(() => P.home(E, true));
  else P.home(E, true);
}
