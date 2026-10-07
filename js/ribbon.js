// 홈 리본 (PowerPoint 홈 탭): 클립보드 · 슬라이드 · 글꼴 · 단락 · 그리기 · 편집
// 적용 대상: 글 편집 중 → 고른 글자 / 표 칸을 고른 상태 → 그 칸들 / 그 밖 → 선택한 객체 전체
import * as M from './model.js';
import * as O from './ops.js';
import * as Ed from './editor.js';
import * as P from './panels.js';
import * as CM from './contextmenu.js';
import { FONT_NAMES, SHAPES, resolveColor } from './render.js';
import { LAYOUT_INFO, makeFrame } from './templates.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const E = new Proxy({}, { get: (_, k) => Ed.E[k], set: (_, k, v) => { Ed.E[k] = v; return true; } });
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];

// ---------- 아이콘 (단색 SVG) ----------
const sv = (d, w = 16) => `<svg width="${w}" height="${w}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  paste: sv('<rect x="3" y="3" width="10" height="12" rx="1"/><path d="M6 3V2h4v1"/><path d="M6 8h4M6 11h3"/>', 30),
  cut: sv('<circle cx="4.5" cy="12" r="2"/><circle cx="11.5" cy="12" r="2"/><path d="M5.8 10.5 12 2M10.2 10.5 4 2"/>'),
  copy: sv('<rect x="5" y="5" width="9" height="9" rx="1"/><path d="M3 11V3a1 1 0 0 1 1-1h7"/>'),
  brush: sv('<path d="M10 2l4 4-6 6-4-4z"/><path d="M4 8l-2 6 6-2"/>'),
  slide: sv('<rect x="2" y="3" width="12" height="9" rx="1"/><path d="M5 6h6M5 9h4"/><path d="M13 12v3M11.5 13.5h3"/>', 30),
  layout: sv('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6h12M7 6v7"/>'),
  reset: sv('<path d="M3 8a5 5 0 1 0 1.5-3.5"/><path d="M3 2v3h3"/>'),
  section: sv('<path d="M2 4h12M2 8h12M2 12h7"/><circle cx="12.5" cy="12" r="1.5"/>'),
  grow: '<b style="font-size:13px">가</b><sup style="font-size:8px">▲</sup>', shrink: '<b style="font-size:11px">가</b><sup style="font-size:8px">▼</sup>',
  clear: sv('<path d="M4 3h8M8 3v7"/><path d="M10 11l4 4M14 11l-4 4"/>'),
  bul: sv('<circle cx="3" cy="4" r="1"/><circle cx="3" cy="8" r="1"/><circle cx="3" cy="12" r="1"/><path d="M6 4h8M6 8h8M6 12h8"/>'),
  num: sv('<path d="M2 3h1v3M2 6h2M2 9h2l-2 3h2"/><path d="M6 4h8M6 8h8M6 12h8"/>'),
  out: sv('<path d="M6 3h8M6 8h8M6 13h8"/><path d="M4 6 2 8l2 2"/>'), ind: sv('<path d="M6 3h8M6 8h8M6 13h8"/><path d="M2 6l2 2-2 2"/>'),
  lsp: sv('<path d="M7 3h7M7 8h7M7 13h7"/><path d="M3 2v12M1.5 4 3 2l1.5 2M1.5 12 3 14l1.5-2"/>'),
  aL: sv('<path d="M2 3h12M2 6.3h8M2 9.6h12M2 13h8"/>'), aC: sv('<path d="M2 3h12M4 6.3h8M2 9.6h12M4 13h8"/>'),
  aR: sv('<path d="M2 3h12M6 6.3h8M2 9.6h12M6 13h8"/>'), aJ: sv('<path d="M2 3h12M2 6.3h12M2 9.6h12M2 13h12"/>'),
  cols: sv('<path d="M2 3h5M2 6h5M2 9h5M2 12h5M9 3h5M9 6h5M9 9h5M9 12h5"/>'),
  tdir: sv('<path d="M4 2v9M2 9l2 2 2-2"/><path d="M8 3h6M11 3v10"/>'), talign: sv('<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M5 7h6M5 9.5h6"/>'),
  smart: sv('<rect x="2" y="2" width="5" height="4" rx="1"/><rect x="9" y="10" width="5" height="4" rx="1"/><rect x="2" y="10" width="5" height="4" rx="1"/><path d="M4.5 6v4M7 12h2"/>'),
  arrange: sv('<rect x="2" y="2" width="8" height="8" rx="1"/><rect x="6" y="6" width="8" height="8" rx="1" fill="currentColor" fill-opacity=".25"/>', 30),
  quick: sv('<rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".2"/><path d="M5 11l6-6"/>', 30),
  fill: sv('<path d="M3 9l5-6 5 6-5 5z"/><path d="M13 10s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z" fill="currentColor"/>'),
  line: sv('<path d="M3 13 12 4l1 1-9 9H3z"/>'), effect: sv('<rect x="2" y="2" width="9" height="9" rx="1"/><path d="M12 5v8H5" stroke-width="2.2" stroke-opacity=".5"/>'),
  find: sv('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>'), replace: sv('<path d="M3 5h8l-2-2M13 11H5l2 2"/>'),
  select: sv('<path d="M3 2l9 6-4 1-2 4z"/>'),
};

// ---------- 대상 · 적용 ----------
const topNodes = () => O.topLevel(E.idx, E.sel).map((id) => E.idx.get(id)).filter(Boolean);
function target() {
  if (E.editing) return { mode: 'edit', ed: E.editing, n: E.idx.get(E.editing.id) };
  const ns = topNodes();
  if (ns.length === 1 && ns[0].type === 'table' && E.cell && E.cell.id === ns[0].id) return { mode: 'cells', n: ns[0], rg: Ed.cellRange() };
  return { mode: 'nodes', ns: ns.filter((n) => n.type === 'text' || n.type === 'shape' || n.type === 'table') };
}
const fullRange = (t) => ({ r0: 0, c0: 0, r1: t.rows.length - 1, c1: t.cols.length - 1 });
// 표 칸의 글 조각에 서식 (기울임 · 밑줄 · 취소선은 칸 속성이 없어 조각에 적용)
function cellRunOps(n, rg, fn) {
  const ops = [];
  for (let y = rg.r0; y <= rg.r1; y++) for (let x = rg.c0; x <= rg.c1; x++) {
    const k = n.rows[y].cells[x];
    if (k) ops.push({ op: 'set', id: n.id, key: `rows.${y}.cells.${x}.runs`, value: (k.runs || []).map((r) => (r.img ? r : fn(Object.assign({}, r)))) });
  }
  return ops;
}
function exec(cmd, val) {
  document.execCommand('styleWithCSS', false, true);
  document.execCommand(cmd, false, val);
}
// 편집 중 고른 글자 크기: fontSize 7 로 표시한 뒤 px 로 바꿔 끼운다
function execSize(px) {
  exec('fontSize', '7');
  const el = E.editing && E.editing.el;
  if (!el) return;
  el.querySelectorAll('font[size="7"]').forEach((f) => { const s = document.createElement('span'); s.style.fontSize = px + 'px'; s.innerHTML = f.innerHTML; f.replaceWith(s); });
  el.querySelectorAll('span').forEach((s) => { if (s.style.fontSize === 'xxx-large' || s.style.fontSize === '-webkit-xxx-large') s.style.fontSize = px + 'px'; });
}

const CHAR = {
  b: { cmd: 'bold', style: 'bold', cell: 'bold', run: 'b' },
  i: { cmd: 'italic', style: 'italic', run: 'i' },
  u: { cmd: 'underline', style: 'underline', run: 'u' },
  s: { cmd: 'strikeThrough', style: 'strike', run: 's' },
};
function charOn(t, k) {
  if (t.mode === 'edit') { try { return document.queryCommandState(CHAR[k].cmd); } catch (e) { return false; } }
  if (t.mode === 'cells') { const c = t.n.rows[t.rg.r0].cells[t.rg.c0] || {}; return CHAR[k].cell ? !!c[CHAR[k].cell] : (c.runs || []).some((r) => r[CHAR[k].run]); }
  const n = t.ns[0];
  return !!(n && n.style && n.style[CHAR[k].style]);
}
function toggleChar(k) {
  const t = target();
  if (t.mode === 'edit') { exec(CHAR[k].cmd); return update(); }
  const on = charOn(t, k);
  if (t.mode === 'cells') {
    Ed.commit(CHAR[k].cell ? O.opsCells(t.n, t.rg, CHAR[k].cell, on ? undefined : true) : cellRunOps(t.n, t.rg, (r) => { if (on) delete r[CHAR[k].run]; else r[CHAR[k].run] = true; return r; }), '글자 서식');
    return;
  }
  const ops = [];
  for (const n of t.ns) {
    if (n.type === 'table') ops.push(...(CHAR[k].cell ? O.opsCells(n, fullRange(n), CHAR[k].cell, on ? undefined : true) : cellRunOps(n, fullRange(n), (r) => { if (on) delete r[CHAR[k].run]; else r[CHAR[k].run] = true; return r; })));
    else ops.push({ op: 'set', id: n.id, key: 'style.' + CHAR[k].style, value: on ? undefined : true });
  }
  Ed.commit(ops, '글자 서식');
}
function setColor(kind, c) {   // kind: 'color' | 'bg'
  const t = target();
  if (t.mode === 'edit') {
    const real = c === 'none' ? (kind === 'bg' ? 'transparent' : '#000000') : resolveColor(E.doc, c);
    exec(kind === 'color' ? 'foreColor' : 'hiliteColor', real);
    return;
  }
  const v = c === 'none' ? undefined : c;
  if (t.mode === 'cells') { Ed.commit(kind === 'color' ? O.opsCells(t.n, t.rg, 'color', v) : cellRunOps(t.n, t.rg, (r) => { if (v) r.bg = v; else delete r.bg; return r; }), kind === 'color' ? '글자 색' : '형광펜'); return; }
  const ops = [];
  for (const n of t.ns) {
    if (n.type === 'table') ops.push(...(kind === 'color' ? O.opsCells(n, fullRange(n), 'color', v) : []));
    else if (kind === 'color') ops.push({ op: 'set', id: n.id, key: 'style.color', value: v });
    else ops.push({ op: 'set', id: n.id, key: 'runs', value: (n.runs || []).map((r) => (r.img ? r : Object.assign({}, r, v ? { bg: v } : { bg: undefined }))) });
  }
  Ed.commit(ops, kind === 'color' ? '글자 색' : '형광펜');
}
function setSize(px) {
  px = Math.max(4, Math.min(400, +px));
  if (!isFinite(px)) return;
  const t = target();
  if (t.mode === 'edit') { execSize(px); return; }
  if (t.mode === 'cells') { Ed.commit(O.opsCells(t.n, t.rg, 'size', px), '글자 크기'); return; }
  Ed.commit(t.ns.map((n) => ({ op: 'set', id: n.id, key: 'style.size', value: px })), '글자 크기');
}
function curSize(t) {
  if (t.mode === 'edit') { const s = getSelection(); const node = s.rangeCount ? s.getRangeAt(0).startContainer : null; const el = node && (node.nodeType === 1 ? node : node.parentElement); return el ? Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10 : ''; }
  if (t.mode === 'cells') { const c = t.n.rows[t.rg.r0].cells[t.rg.c0] || {}; return c.size || (t.n.style || {}).size || 9; }
  const n = t.ns[0];
  return n ? ((n.style || {}).size || (n.type === 'table' ? 9 : 12)) : '';
}
// 편집 중이 아닐 때 객체 단위 스타일 (편집 중이면 먼저 끝내고 적용)
function nodeStyle(key, value, label) {
  if (E.editing) Ed.finishEdit();
  const t = target();
  if (t.mode === 'cells') return;
  Ed.commit(t.ns.filter((n) => n.type !== 'table').map((n) => ({ op: 'set', id: n.id, key: 'style.' + key, value })), label);
}
function setFont(k) {
  if (E.editing) Ed.finishEdit();
  const t = target();
  if (t.mode === 'cells') return;
  Ed.commit(t.ns.map((n) => ({ op: 'set', id: n.id, key: 'style.font', value: k === 'm' ? undefined : k })), '글꼴');
}
function clearFormat() {
  const t = target();
  if (t.mode === 'edit') { exec('removeFormat'); return; }
  const plain = (runs) => (runs || []).map((r) => (r.img ? r : { t: r.t }));
  if (t.mode === 'cells') { Ed.commit(cellRunOps(t.n, t.rg, (r) => ({ t: r.t })).concat(O.opsCells(t.n, t.rg, 'bold', undefined), O.opsCells(t.n, t.rg, 'color', undefined), O.opsCells(t.n, t.rg, 'size', undefined)), '서식 지우기'); return; }
  const ops = [];
  for (const n of t.ns) {
    if (n.type === 'table') continue;
    ops.push({ op: 'set', id: n.id, key: 'runs', value: plain(n.runs) });
    for (const k of ['bold', 'italic', 'underline', 'strike', 'color', 'bg', 'letter', 'shadow', 'font']) ops.push({ op: 'set', id: n.id, key: 'style.' + k });
  }
  Ed.commit(ops, '서식 지우기');
}
function changeCase(mode) {
  const f = (s) => (mode === 'upper' ? s.toUpperCase() : mode === 'lower' ? s.toLowerCase() : s.replace(/(^|[.!?]\s+|\n)([a-z])/g, (m, a, b) => a + b.toUpperCase()));
  const t = target();
  if (t.mode === 'edit') { const s = getSelection().toString(); if (s) document.execCommand('insertText', false, f(s)); return; }
  if (t.mode === 'cells') { Ed.commit(cellRunOps(t.n, t.rg, (r) => Object.assign(r, { t: f(r.t || '') })), '대소문자'); return; }
  Ed.commit(t.ns.filter((n) => n.runs).map((n) => ({ op: 'set', id: n.id, key: 'runs', value: n.runs.map((r) => (r.img ? r : Object.assign({}, r, { t: f(r.t || '') }))) })), '대소문자');
}

// ---------- 단락 ----------
function para(kind, value) {
  const t = target();
  if (t.mode === 'edit' && ['align', 'list', 'indent'].includes(kind) && Ed.editingParaCommand(kind, value)) return;
  if (t.mode === 'cells') {
    if (kind === 'align') Ed.commit(O.opsCells(t.n, t.rg, 'align', value === 'justify' ? 'left' : value), '칸 정렬');
    if (kind === 'valign') Ed.commit(O.opsCells(t.n, t.rg, 'valign', value === 'middle' ? undefined : value), '칸 세로 정렬');
    return;
  }
  if (E.editing) Ed.finishEdit();
  const ns = target().ns;
  if (kind === 'list') return Ed.commit(ns.filter((n) => n.runs).flatMap((n) => O.opsListAll(n, value)), value === 'bullet' ? '글머리 기호' : '번호 매기기');
  if (kind === 'indent') return Ed.commit(ns.filter((n) => n.runs).flatMap((n) => O.opsIndentAll(n, value)), '들여쓰기');
  if (kind === 'align' || kind === 'valign') {
    const ops = [];
    for (const n of ns) {
      if (n.type === 'table') ops.push(...O.opsCells(n, fullRange(n), kind, kind === 'valign' && value === 'middle' ? undefined : value));
      else ops.push({ op: 'set', id: n.id, key: 'style.' + kind, value });
    }
    return Ed.commit(ops, '맞춤');
  }
  nodeStyle(kind, value, { lineHeight: '줄 간격', vertical: '텍스트 방향', columns: '단' }[kind] || '단락');
}
function curStyle(key, dflt) {
  const t = target();
  const n = t.mode === 'edit' ? t.n : t.mode === 'cells' ? null : t.ns[0];
  if (t.mode === 'cells') { const c = t.n.rows[t.rg.r0].cells[t.rg.c0] || {}; return key === 'align' ? (c.align || 'left') : key === 'valign' ? (c.valign || 'middle') : dflt; }
  return n && n.style && n.style[key] != null ? n.style[key] : dflt;
}

// ---------- 그리기 ----------
const shapes = () => topNodes().filter((n) => n.type === 'shape');
const fillables = () => topNodes();
function applyFill(c) {
  const t = target();
  if (t.mode === 'cells') { Ed.commit(O.opsCells(t.n, t.rg, 'bg', c === 'none' ? undefined : c), '칸 배경'); return; }
  if (E.editing) Ed.finishEdit();
  const ops = [];
  for (const n of fillables()) {
    if (n.type === 'shape') ops.push({ op: 'set', id: n.id, key: 'fill', value: c });
    else if (n.type === 'text') ops.push({ op: 'set', id: n.id, key: 'style.bg', value: c === 'none' ? undefined : c });
    else if (n.type === 'table') ops.push(...O.opsCells(n, fullRange(n), 'bg', c === 'none' ? undefined : c));
  }
  Ed.commit(ops, '도형 채우기');
}
function applyOutline(prop, v) {
  if (E.editing) Ed.finishEdit();
  const ops = [];
  for (const n of topNodes()) {
    if (n.type === 'shape') {
      if (prop === 'color') { ops.push({ op: 'set', id: n.id, key: 'stroke', value: v }); if (v !== 'none' && !n.strokeWidth) ops.push({ op: 'set', id: n.id, key: 'strokeWidth', value: 1 }); }
      if (prop === 'width') { ops.push({ op: 'set', id: n.id, key: 'strokeWidth', value: v }); if (!n.stroke || n.stroke === 'none') ops.push({ op: 'set', id: n.id, key: 'stroke', value: '#595959' }); }
      if (prop === 'dash') ops.push({ op: 'set', id: n.id, key: 'dash', value: v });
    } else if (n.type === 'connector') {
      if (prop === 'color' && v !== 'none') ops.push({ op: 'set', id: n.id, key: 'stroke', value: v });
      if (prop === 'width') ops.push({ op: 'set', id: n.id, key: 'width', value: v });
      if (prop === 'dash') ops.push({ op: 'set', id: n.id, key: 'dash', value: v });
    } else if (n.type === 'image') {
      if (prop === 'color') ops.push({ op: 'set', id: n.id, key: 'stroke', value: v === 'none' ? undefined : v }, { op: 'set', id: n.id, key: 'strokeWidth', value: v === 'none' ? undefined : (n.strokeWidth || 1) });
      if (prop === 'width') ops.push({ op: 'set', id: n.id, key: 'strokeWidth', value: v }, ...(n.stroke ? [] : [{ op: 'set', id: n.id, key: 'stroke', value: '#595959' }]));
    } else if (n.type === 'text') {
      if (prop === 'color') ops.push({ op: 'set', id: n.id, key: 'style.border', value: v === 'none' ? undefined : v });
      if (prop === 'width') ops.push({ op: 'set', id: n.id, key: 'style.borderWidth', value: v }, ...((n.style || {}).border ? [] : [{ op: 'set', id: n.id, key: 'style.border', value: '#595959' }]));
    }
  }
  Ed.commit(ops, '도형 윤곽선');
}
const QUICK_STYLES = [
  ['강조 · 파랑', { fill: 'theme:primary', stroke: 'none', strokeWidth: 0 }, '#ffffff'],
  ['강조 · 진한 파랑', { fill: 'theme:primaryDark', stroke: 'none', strokeWidth: 0 }, '#ffffff'],
  ['윤곽 · 파랑', { fill: '#ffffff', stroke: 'theme:primary', strokeWidth: 1.5 }, 'theme:primary'],
  ['연한 바탕', { fill: 'theme:bg', stroke: 'theme:line', strokeWidth: 1 }, 'theme:text'],
  ['카드 (흰 바탕 · 그림자)', { fill: '#ffffff', stroke: 'theme:line', strokeWidth: 1, shadow: true }, 'theme:text'],
  ['어두운 바탕', { fill: 'theme:dark', stroke: 'none', strokeWidth: 0 }, '#ffffff'],
  ['주석 박스 (빨간 점선)', { fill: 'none', stroke: 'theme:annot', strokeWidth: 1, dash: 'dash' }, 'theme:annot'],
  ['경고 · 주황', { fill: '#fff4e5', stroke: 'theme:orange', strokeWidth: 1 }, '#8a4b00'],
  ['성공 · 초록', { fill: '#eafaf0', stroke: 'theme:green', strokeWidth: 1 }, '#11633a'],
  ['비활성 (회색)', { fill: '#eeeeee', stroke: '#cccccc', strokeWidth: 1 }, '#9a9a9a'],
];
function applyQuick(st, textColor) {
  if (E.editing) Ed.finishEdit();
  const ops = [];
  for (const n of shapes()) {
    for (const k of ['fill', 'stroke', 'strokeWidth', 'dash', 'shadow', 'gradient', 'fillOpacity']) ops.push({ op: 'set', id: n.id, key: k, value: st[k] });
    if (n.runs) ops.push({ op: 'set', id: n.id, key: 'style.color', value: textColor });
  }
  if (!ops.length) { Ed.toast('도형을 먼저 고르세요.'); return; }
  Ed.commit(ops, '빠른 스타일');
}

// ---------- 슬라이드 ----------
const activeFrame = () => { const f = E.activeFrame && E.idx.get(E.activeFrame); return f && f.kind === 'frame' ? f : null; };
function newSlide(layout) {
  const f = activeFrame();
  Ed.addFrame(layout || (f && !['cover', 'end'].includes(f.layout) ? f.layout : 'screen'));
}
function resetFrame() {
  const f = activeFrame();
  if (!f) return;
  const t = makeFrame(f.layout);
  const props = Object.assign({}, t.props);
  if (f.layout === 'screen') { props.pageName = f.name; props.screenTitle = f.name; }
  if (f.layout === 'policy' || f.layout === 'divider') props.title = f.props.title || t.props.title;
  if (f.layout === 'divider') props.number = f.props.number || t.props.number;
  Ed.commit([{ op: 'set', id: f.id, key: 'props', value: props }, { op: 'set', id: f.id, key: 'guides' }], '다시 설정');
  Ed.toast('양식 칸을 기본값으로 되돌렸어요 (본문은 그대로).');
}
function sectionItems() {
  const page = Ed.currentPage();
  const pi = E.doc.pages.indexOf(page);
  return [
    { label: '구역 추가', act: () => Ed.addPage() },
    { label: '구역 이름 바꾸기…', disabled: !page, act: () => { const v = prompt('구역(페이지) 이름', page.name); if (v) Ed.commit([{ op: 'set', id: page.id, key: 'name', value: v }], '구역 이름'); } },
    { label: '구역 제거 (화면은 앞 구역으로)', disabled: !page || E.doc.pages.length < 2, act: () => {
      const into = E.doc.pages[pi > 0 ? pi - 1 : 1];
      const ops = page.frames.map((f, k) => ({ op: 'move', id: f.id, parent: into.id, index: pi > 0 ? into.frames.length + k : k }));
      ops.push({ op: 'remove', id: page.id });
      if (Ed.commit(ops, '구역 제거')) Ed.gotoPage(into.id);
    } },
    { sep: true },
    { label: '구역 위로', disabled: pi <= 0, act: () => Ed.commit([{ op: 'move', id: page.id, parent: 'doc', index: pi - 1 }], '구역 순서') },
    { label: '구역 아래로', disabled: pi < 0 || pi >= E.doc.pages.length - 1, act: () => Ed.commit([{ op: 'move', id: page.id, parent: 'doc', index: pi + 1 }], '구역 순서') },
  ];
}

// ---------- 메뉴 띄우기 ----------
function menuAt(btn, items) { const r = btn.getBoundingClientRect(); CM.openItems(r.left, r.bottom + 2, items); }
function colorAt(btn, title, current, apply, noNone) { P.openColorPopover(btn, current, (v) => apply(v), { title, noNone }); }

const ACT = {
  paste: () => CM.paste(null), cut: () => CM.copySel(true), copy: () => CM.copySel(false), painter: () => Ed.startPainter(),
  newslide: () => newSlide(), newslideMenu: (b) => menuAt(b, Object.entries(LAYOUT_INFO).map(([k, v]) => ({ label: v.name, act: () => newSlide(k) }))),
  layout: (b) => { const f = activeFrame(); menuAt(b, Object.entries(LAYOUT_INFO).map(([k, v]) => ({ label: v.name, check: f && f.layout === k, disabled: !f, act: () => Ed.commit([{ op: 'set', id: f.id, key: 'layout', value: k }], '레이아웃 변경') }))); },
  reset: () => resetFrame(), section: (b) => menuAt(b, sectionItems()),
  grow: () => { const t = target(); t.mode === 'edit' ? setSize((+curSize(t) || 12) + 2) : Ed.bumpFontSize(1); },
  shrink: () => { const t = target(); t.mode === 'edit' ? setSize(Math.max(4, (+curSize(t) || 12) - 2)) : Ed.bumpFontSize(-1); },
  clear: () => clearFormat(),
  b: () => toggleChar('b'), i: () => toggleChar('i'), u: () => toggleChar('u'), s: () => toggleChar('s'),
  shadow: () => nodeStyle('shadow', curStyle('shadow', false) ? undefined : true, '글자 그림자'),
  spacing: (b) => menuAt(b, [['매우 좁게', -1.5], ['좁게', -.75], ['표준', 0], ['넓게', 1.5], ['매우 넓게', 3]].map(([l, v]) => ({ label: l, check: (curStyle('letter', 0) || 0) === v, act: () => nodeStyle('letter', v || undefined, '자간') }))),
  case: (b) => menuAt(b, [{ label: '문장의 첫 글자를 대문자로', act: () => changeCase('sentence') }, { label: '모두 소문자로', act: () => changeCase('lower') }, { label: '모두 대문자로', act: () => changeCase('upper') }]),
  hl: () => setColor('bg', lastHl), hlMenu: (b) => colorAt(b, '형광펜 색', lastHl, (v) => { lastHl = v === 'none' ? lastHl : v; setColor('bg', v); }),
  fc: () => setColor('color', lastFc), fcMenu: (b) => colorAt(b, '글꼴 색', lastFc, (v) => { lastFc = v; setColor('color', v); }, true),
  bul: () => para('list', 'bullet'), num: () => para('list', 'number'), out: () => para('indent', -1), ind: () => para('indent', 1),
  lsp: (b) => menuAt(b, [1, 1.15, 1.35, 1.5, 2, 2.5, 3].map((v) => ({ label: v.toFixed(v % 1 ? 2 : 1).replace(/0$/, ''), check: Math.abs((curStyle('lineHeight', 1.35)) - v) < .01, act: () => para('lineHeight', v) }))),
  aL: () => para('align', 'left'), aC: () => para('align', 'center'), aR: () => para('align', 'right'), aJ: () => para('align', 'justify'),
  cols: (b) => menuAt(b, [1, 2, 3].map((v) => ({ label: v + '단', check: (curStyle('columns', 1) || 1) === v, act: () => para('columns', v > 1 ? v : undefined) }))),
  tdir: (b) => menuAt(b, [{ label: '가로', check: !curStyle('vertical', false), act: () => para('vertical', undefined) }, { label: '세로 (위→아래)', check: !!curStyle('vertical', false), act: () => para('vertical', true) }]),
  talign: (b) => menuAt(b, [['top', '위쪽'], ['middle', '가운데'], ['bottom', '아래쪽']].map(([k, l]) => ({ label: l, check: curStyle('valign', 'top') === k, act: () => para('valign', k) }))),
  smart: () => Ed.toast('SmartArt는 아직 없어요. 대신 그리기의 순서도 도형과 연결선(C)을 쓰세요.'),
  shapesMore: (b) => { const groups = {}; SHAPES.forEach(([k, name, g]) => { (groups[g] = groups[g] || []).push({ label: name, act: () => Ed.setTool(k === 'rect' ? 'rect' : k === 'ellipse' ? 'ellipse' : 'shape', k) }); }); menuAt(b, [{ label: '선 (L)', act: () => Ed.setTool('line') }, { label: '화살표 (A)', act: () => Ed.setTool('arrow') }, { label: '연결선 (C)', act: () => Ed.setTool('connector') }, { sep: true }, ...Object.entries(groups).map(([g, list]) => ({ label: g, sub: list }))]); },
  arrange: (b) => {
    const n = topNodes().length;
    menuAt(b, [
      { title: '개체 순서' },
      { label: '맨 앞으로 가져오기', kbd: 'Ctrl+Shift+]', disabled: !n, act: () => Ed.zorder('front') }, { label: '맨 뒤로 보내기', kbd: 'Ctrl+Shift+[', disabled: !n, act: () => Ed.zorder('back') },
      { label: '앞으로 가져오기', kbd: 'Ctrl+]', disabled: !n, act: () => Ed.zorder('forward') }, { label: '뒤로 보내기', kbd: 'Ctrl+[', disabled: !n, act: () => Ed.zorder('backward') },
      { title: '개체 그룹화' },
      { label: '그룹', kbd: 'Ctrl+G', disabled: !n, act: () => Ed.groupSelection() }, { label: '그룹 해제', kbd: 'Ctrl+Shift+G', disabled: !topNodes().some((k) => k.type === 'group'), act: () => Ed.ungroupSelection() },
      { title: '개체 위치' },
      { label: '맞춤', disabled: !n, sub: [
        { label: '왼쪽 맞춤', act: () => Ed.align('left') }, { label: '가운데 맞춤', act: () => Ed.align('hcenter') }, { label: '오른쪽 맞춤', act: () => Ed.align('right') }, { sep: true },
        { label: '위쪽 맞춤', act: () => Ed.align('top') }, { label: '중간 맞춤', act: () => Ed.align('vcenter') }, { label: '아래쪽 맞춤', act: () => Ed.align('bottom') }, { sep: true },
        { label: '가로 간격을 동일하게', disabled: n < 3, act: () => Ed.distribute('h') }, { label: '세로 간격을 동일하게', disabled: n < 3, act: () => Ed.distribute('v') },
        { sep: true }, { label: '같은 크기로', disabled: n < 2, act: () => Ed.sameSize('both') },
      ] },
      CM.rotateMenu(),
      { label: '선택 창', act: () => { try { localStorage.setItem('tnspec:leftView', 'layers'); } catch (e) { /* 무시 */ } Ed.ui(); } },
    ]);
  },
  quick: (b) => menuAt(b, [{ title: '빠른 스타일 (도형)' }, ...QUICK_STYLES.map(([l, st, tc]) => ({ label: l, act: () => applyQuick(st, tc) }))]),
  fill: (b) => { const n = topNodes()[0]; colorAt(b, '도형 채우기', n ? (n.fill || (n.style || {}).bg || 'none') : 'none', (v) => applyFill(v)); },
  outline: (b) => menuAt(b, [
    { label: '윤곽선 색', swatches: ['#000000', '#595959', '#a6a6a6', '#d9d9d9', '#ffffff', '#e53935', '#ff8a00', '#ffc107', '#22c55e', 'theme:primary', '#7b4dff', 'none'], pick: (c) => applyOutline('color', c) },
    { label: '다른 색…', act: () => colorAt(b, '윤곽선 색', (topNodes()[0] || {}).stroke || 'none', (v) => applyOutline('color', v)) },
    { label: '윤곽선 없음', act: () => applyOutline('color', 'none') },
    { sep: true },
    { label: '두께', sub: [0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6].map((w) => ({ label: w + 'pt', act: () => applyOutline('width', w) })) },
    { label: '대시', sub: [['solid', '실선'], ['dot', '둥근 점선'], ['dash', '파선'], ['long', '긴 파선'], ['dashdot', '1점 쇄선']].map(([k, l]) => ({ label: l, act: () => applyOutline('dash', k) })) },
  ]),
  effect: (b) => {
    const n = shapes()[0] || topNodes()[0] || {};
    const tog = (key, label) => ({ label, check: !!n[key], act: () => { if (E.editing) Ed.finishEdit(); Ed.commit(topNodes().map((k) => ({ op: 'set', id: k.id, key, value: n[key] ? undefined : true })), label); } });
    menuAt(b, [
      tog('shadow', '그림자'),
      { label: '그라데이션 (흰색으로)', check: !!n.gradient, act: () => Ed.commit(shapes().map((k) => ({ op: 'set', id: k.id, key: 'gradient', value: k.gradient ? undefined : { to: '#ffffff', angle: 90 } })), '그라데이션') },
      { label: '반투명 (채우기 50%)', check: n.fillOpacity === .5, act: () => Ed.commit(shapes().map((k) => ({ op: 'set', id: k.id, key: 'fillOpacity', value: k.fillOpacity === .5 ? undefined : .5 })), '투명도') },
      { sep: true },
      tog('flipH', '좌우 대칭'), tog('flipV', '상하 대칭'),
      { sep: true },
      { label: '효과 없음', act: () => Ed.commit(topNodes().flatMap((k) => ['shadow', 'gradient', 'fillOpacity'].map((key) => ({ op: 'set', id: k.id, key }))), '효과 없음') },
    ]);
  },
  find: () => P.findDialog(false), replace: () => P.findDialog(true),
  select: (b) => menuAt(b, [
    { label: '모두 선택', kbd: 'Ctrl+A', act: () => { const fid = E.compId || E.activeFrame; const c = fid && Ed.containerFor(fid); if (c) Ed.select(c.nodes.filter((n) => !n.locked && !n.hidden).map((n) => n.id)); } },
    { label: '같은 종류 모두 선택', disabled: !topNodes().length, act: () => { const type = topNodes()[0].type; const c = Ed.containerFor(Ed.frameOfNode(topNodes()[0].id)); Ed.select(c.nodes.filter((n) => n.type === type && !n.locked && !n.hidden).map((n) => n.id)); } },
    { label: '선택 창 (레이어)', act: () => { try { localStorage.setItem('tnspec:leftView', 'layers'); } catch (e) { /* 무시 */ } Ed.ui(); } },
  ]),
  collapse: () => { const on = !document.getElementById('app').classList.contains('rb-collapsed'); document.getElementById('app').classList.toggle('rb-collapsed', on); try { localStorage.setItem('tnspec:ribbon', on ? '0' : '1'); } catch (e) { /* 무시 */ } Ed.applyZoom(); },
};
let lastHl = '#ffeb3b', lastFc = '#e53935';

// ---------- 그리기 (DOM) ----------
const btn = (act, inner, title, cls = '') => `<button class="rb-b ${cls}" data-rb="${act}" title="${esc(title)}">${inner}</button>`;
const big = (act, icon, label, title, arrowAct) => arrowAct
  ? `<div class="rb-big split"><button class="rb-b" data-rb="${act}" title="${esc(title)}">${icon}</button><button class="rb-b rb-blab" data-rb="${arrowAct}" title="${esc(title)}">${label} ▾</button></div>`
  : `<button class="rb-b rb-big" data-rb="${act}" title="${esc(title)}">${icon}<span>${label}</span></button>`;
const group = (label, body, cls = '') => `<div class="rb-g ${cls}"><div class="rb-body">${body}</div><div class="rb-lab">${label}</div></div>`;
const GALLERY = ['text', 'rect', 'ellipse', 'line', 'arrow', 'connector', 'roundRect', 'triangle', 'rtTriangle', 'arrowR', 'arrowD', 'callout', 'diamond', 'star5', 'chevron', 'process', 'decision', 'cylinder'];
const GALLERY_ICON = {
  text: sv('<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M5 5h6M8 5v7"/>'), line: sv('<path d="M3 13 13 3"/>'), arrow: sv('<path d="M3 13 13 3M8 3h5v5"/>'),
  connector: sv('<path d="M3 13h5V3h5"/><circle cx="3" cy="13" r="1.3" fill="currentColor"/>'),
};

function shapeIcon(k) {
  if (GALLERY_ICON[k]) return GALLERY_ICON[k];
  const n = { tail: [.25, 1.3] };
  const w = 15, h = /^callout/.test(k) ? 9 : (['ellipse', 'star5', 'diamond', 'decision'].includes(k) ? 14 : 11);
  return `<svg width="16" height="16" viewBox="-0.5 -0.5 16 16"><path d="${P_shapePath(k, w, h, n)}" transform="translate(0 ${(15 - h) / 2 - (/^callout/.test(k) ? 2 : 0)})" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>`;
}
let P_shapePath = null;

export async function init() {
  const R = await import('./render.js');
  P_shapePath = R.shapePath;
  const host = $('#ribbon');
  const fonts = Object.entries(FONT_NAMES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  host.innerHTML = `<div class="rb-row">
    ${group('클립보드', `${big('paste', I.paste, '붙여넣기', '붙여넣기 (Ctrl+V)')}
      <div class="rb-col">${btn('cut', I.cut + '<span>잘라내기</span>', '잘라내기 (Ctrl+X)', 'wide')}${btn('copy', I.copy + '<span>복사</span>', '복사 (Ctrl+C)', 'wide')}${btn('painter', I.brush + '<span>서식 복사</span>', '서식 복사: 누르고 서식을 입힐 요소를 누르세요 (Ctrl+Shift+C / V)', 'wide')}</div>`)}
    ${group('슬라이드', `${big('newslide', I.slide, '새 슬라이드', '새 슬라이드 (Ctrl+M) — 지금 프레임과 같은 레이아웃', 'newslideMenu')}
      <div class="rb-col">${btn('layout', I.layout + '<span>레이아웃 ▾</span>', '지금 프레임의 레이아웃 바꾸기', 'wide')}${btn('reset', I.reset + '<span>다시 설정</span>', '양식 칸(Page Name · 화면 제목 등)을 기본값으로', 'wide')}${btn('section', I.section + '<span>구역 ▾</span>', '구역(페이지) 추가 · 이름 · 제거', 'wide')}</div>`)}
    ${group('글꼴', `<div class="rb-col">
        <div class="rb-line"><select id="rb-font" title="글꼴">${fonts}</select><input id="rb-size" list="rb-sizes" title="글꼴 크기" autocomplete="off"><datalist id="rb-sizes">${SIZES.map((s) => `<option value="${s}">`).join('')}</datalist>${btn('grow', I.grow, '글꼴 크기 크게 (Ctrl+Shift+>)')}${btn('shrink', I.shrink, '글꼴 크기 작게 (Ctrl+Shift+<)')}${btn('clear', I.clear, '모든 서식 지우기')}</div>
        <div class="rb-line">${btn('b', '<b>가</b>', '굵게 (Ctrl+B)')}${btn('i', '<i style="font-family:serif">가</i>', '기울임꼴 (Ctrl+I)')}${btn('u', '<u>가</u>', '밑줄 (Ctrl+U)')}${btn('s', '<s>abc</s>', '취소선')}${btn('shadow', '<span style="text-shadow:1px 1px 0 #888">S</span>', '텍스트 그림자')}${btn('spacing', '<span>가↔</span>', '문자 간격')}${btn('case', '<span>Aa▾</span>', '대/소문자 바꾸기')}
          <span class="rb-split">${btn('hl', '<span class="rb-hl">가</span><i id="rb-hl-bar"></i>', '텍스트 강조 색 (형광펜)')}${btn('hlMenu', '▾', '형광펜 색 고르기', 'arr')}</span>
          <span class="rb-split">${btn('fc', '<span class="rb-fc">가</span><i id="rb-fc-bar"></i>', '글꼴 색')}${btn('fcMenu', '▾', '글꼴 색 고르기', 'arr')}</span></div></div>`, 'rb-font')}
    ${group('단락', `<div class="rb-col">
        <div class="rb-line">${btn('bul', I.bul, '글머리 기호 (Ctrl+Shift+8)')}${btn('num', I.num, '번호 매기기 (Ctrl+Shift+7)')}<span class="rb-sp"></span>${btn('out', I.out, '목록 수준 줄임 (Shift+Tab)')}${btn('ind', I.ind, '목록 수준 늘림 (Tab)')}<span class="rb-sp"></span>${btn('lsp', I.lsp + '▾', '줄 간격')}</div>
        <div class="rb-line">${btn('aL', I.aL, '왼쪽 맞춤')}${btn('aC', I.aC, '가운데 맞춤')}${btn('aR', I.aR, '오른쪽 맞춤')}${btn('aJ', I.aJ, '양쪽 맞춤')}<span class="rb-sp"></span>${btn('cols', I.cols + '▾', '단 나누기')}</div></div>
      <div class="rb-col">${btn('tdir', I.tdir + '<span>텍스트 방향 ▾</span>', '텍스트 방향', 'wide')}${btn('talign', I.talign + '<span>텍스트 맞춤 ▾</span>', '상자 안 세로 맞춤', 'wide')}${btn('smart', I.smart + '<span>SmartArt로 변환</span>', 'SmartArt로 변환 (준비 중)', 'wide off')}</div>`)}
    ${group('그리기', `<div class="rb-gal"><div class="rb-gal-grid">${GALLERY.map((k) => btn('g:' + k, '', k)).join('')}</div>${btn('shapesMore', '▾', '도형 전체 보기', 'rb-gal-more')}</div>
      ${big('arrange', I.arrange, '정렬', '순서 · 그룹 · 맞춤 · 회전')}${big('quick', I.quick, '빠른<br>스타일', '빠른 스타일 (도형)')}
      <div class="rb-col">${btn('fill', I.fill + '<span>도형 채우기 ▾</span>', '도형 채우기', 'wide')}${btn('outline', I.line + '<span>도형 윤곽선 ▾</span>', '도형 윤곽선', 'wide')}${btn('effect', I.effect + '<span>도형 효과 ▾</span>', '도형 효과', 'wide')}</div>`)}
    ${group('편집', `<div class="rb-col">${btn('find', I.find + '<span>찾기</span>', '찾기 (Ctrl+F)', 'wide')}${btn('replace', I.replace + '<span>바꾸기 ▾</span>', '바꾸기 (Ctrl+H)', 'wide')}${btn('select', I.select + '<span>선택 ▾</span>', '선택', 'wide')}</div>`)}
    <div class="rb-grow"></div>${btn('collapse', '⌃', '리본 접기 / 펴기', 'rb-collapse')}
  </div>`;
  // 도형 갤러리 아이콘 · 이름
  const NAME = Object.fromEntries(SHAPES.map((s) => [s[0], s[1]]));
  host.querySelectorAll('[data-rb^="g:"]').forEach((b) => {
    const k = b.dataset.rb.slice(2);
    b.innerHTML = shapeIcon(k);
    b.title = { text: '텍스트 상자 (T)', line: '선 (L)', arrow: '화살표 (A)', connector: '연결선 (C)' }[k] || NAME[k] || k;
  });
  // 글 편집 중에도 고른 글자가 풀리지 않게: 단추를 눌러도 초점을 뺏지 않음
  host.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rb]');
    if (!b || b.classList.contains('off') && b.dataset.rb !== 'smart') return;
    const a = b.dataset.rb;
    if (a.startsWith('g:')) {
      const k = a.slice(2);
      if (k === 'text') Ed.setTool('text');
      else if (['line', 'arrow', 'connector'].includes(k)) Ed.setTool(k);
      else if (k === 'rect' || k === 'ellipse') Ed.setTool(k);
      else Ed.setTool('shape', k);
      return;
    }
    if (ACT[a]) { try { ACT[a](b); } catch (err) { console.error(err); Ed.toast('실행하지 못했어요: ' + err.message, true); } }
    setTimeout(update, 30);
  });
  const font = $('#rb-font'), size = $('#rb-size');
  font.addEventListener('change', () => { setFont(font.value); });
  const applySize = () => { if (size.value !== '') setSize(parseFloat(size.value)); };
  size.addEventListener('change', applySize);
  size.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { applySize(); size.blur(); } if (e.key === 'Escape') size.blur(); });
  document.addEventListener('selectionchange', () => { if (E.editing) update(); });
  try { if (localStorage.getItem('tnspec:ribbon') === '0') document.getElementById('app').classList.add('rb-collapsed'); } catch (e) { /* 무시 */ }
  // 상단 막대의 리본 접기/펴기 단추 (접은 뒤에도 다시 펼 수 있게)
  const tg = document.createElement('button');
  tg.className = 'tb-btn'; tg.id = 'rb-toggle'; tg.title = '리본 접기 / 펴기 (Ctrl+F1)'; tg.textContent = '리본';
  tg.onclick = () => ACT.collapse();
  const grow = document.querySelector('#top .tb-grow');
  if (grow) grow.before(tg);
  window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'F1') { e.preventDefault(); ACT.collapse(); } });
}

// ---------- 상태 반영 ----------
export function update() {
  const host = $('#ribbon');
  if (!host || !E.doc || !host.firstChild) return;
  const t = target();
  const hasText = t.mode === 'edit' || t.mode === 'cells' || t.ns.length > 0;
  const ns = topNodes();
  const on = (a, v) => { const b = host.querySelector(`[data-rb="${a}"]`); if (b) b.classList.toggle('on', !!v); };
  const dis = (acts, v) => acts.forEach((a) => host.querySelectorAll(`[data-rb="${a}"]`).forEach((b) => { b.disabled = !!v; }));
  dis(['b', 'i', 'u', 's', 'grow', 'shrink', 'clear', 'hl', 'hlMenu', 'fc', 'fcMenu', 'case'], !hasText);
  dis(['shadow', 'spacing', 'lsp', 'cols', 'tdir'], !(t.mode === 'edit' || (t.mode === 'nodes' && t.ns.some((n) => n.type !== 'table'))));
  dis(['bul', 'num', 'out', 'ind'], !(t.mode === 'edit' || (t.mode === 'nodes' && t.ns.some((n) => n.runs))));
  dis(['aL', 'aC', 'aR', 'aJ', 'talign'], !hasText);
  dis(['cut', 'copy', 'painter'], !ns.length);
  dis(['arrange', 'fill', 'outline', 'effect'], !ns.length && t.mode !== 'cells');
  dis(['quick'], !shapes().length);
  dis(['layout', 'reset'], !activeFrame());
  for (const k of ['b', 'i', 'u', 's']) on(k, hasText && charOn(t, k));
  on('shadow', !!curStyle('shadow', false));
  const al = curStyle('align', 'left');
  on('aL', hasText && al === 'left'); on('aC', hasText && al === 'center'); on('aR', hasText && al === 'right'); on('aJ', hasText && al === 'justify');
  const font = $('#rb-font'), size = $('#rb-size');
  if (document.activeElement !== font) { font.value = (t.mode === 'nodes' && t.ns[0] && (t.ns[0].style || {}).font) || (t.mode === 'edit' && t.n && (t.n.style || {}).font) || 'm'; font.disabled = !hasText || t.mode === 'cells'; }
  if (document.activeElement !== size) { size.value = hasText ? curSize(t) : ''; size.disabled = !hasText; }
  $('#rb-hl-bar').style.background = resolveColor(E.doc, lastHl);
  $('#rb-fc-bar').style.background = resolveColor(E.doc, lastFc);
  host.querySelectorAll('[data-rb^="g:"]').forEach((b) => {
    const k = b.dataset.rb.slice(2);
    b.classList.toggle('on', (E.tool === 'shape' && E.shapeKind === k) || (E.tool === k));
  });
}
