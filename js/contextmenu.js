// 오른쪽 클릭 메뉴: 누른 대상(노드 종류 · 표 칸 · 빈 곳 · 프레임)에 맞는 속성과 명령
import * as M from './model.js';
import * as O from './ops.js';
import * as Ed from './editor.js';
import * as P from './panels.js';
import * as V from './viewtools.js';
import { SHAPES, CAPS } from './render.js';
import { LAYOUT_INFO } from './templates.js';
import * as store from './store.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// editor.js 와 서로 불러오므로, 편집기 상태는 실제로 쓸 때 읽는다
const E = new Proxy({}, { get: (_, k) => Ed.E[k], set: (_, k, v) => { Ed.E[k] = v; return true; } });
const SEP = { sep: true };
const QUICK = ['#ffffff', '#f2f2f2', '#d9d9d9', '#595959', '#000000', '#e53935', '#ff8a00', '#ffc107', '#22c55e', 'theme:primary', '#7b4dff', 'none'];

// ---------- 공용 명령 ----------
const ids = () => O.topLevel(E.idx, E.sel);
const nodes = () => ids().map((id) => E.idx.get(id));
const setAll = (key, value, label) => Ed.commit(ids().map((id) => ({ op: 'set', id, key, value })), label);
const toggleAll = (key, label) => { const on = nodes().every((n) => n[key]); setAll(key, on ? undefined : true, label); };
const focusInspector = (sel) => setTimeout(() => { const el = document.querySelector('#right ' + sel); if (el) { el.focus(); if (el.select) el.select(); el.scrollIntoView({ block: 'center' }); } }, 40);

async function copySel(cut) {
  if (E.cell && E.sel[0] === E.cell.id) {
    const n = E.idx.get(E.cell.id), rg = Ed.cellRange(), lines = [];
    for (let y = rg.r0; y <= rg.r1; y++) { const l = []; for (let x = rg.c0; x <= rg.c1; x++) { const k = n.rows[y].cells[x]; l.push(k ? M.plainText(k.runs) : ''); } lines.push(l.join('\t')); }
    try { await navigator.clipboard.writeText(lines.join('\n')); } catch (e) { /* 권한 없음 */ }
    if (cut) Ed.commit(O.opsCells(n, rg, 'runs', [{ t: '' }]), '칸 잘라내기');
    return;
  }
  E.clip = O.copyPayload(E.idx, E.sel);
  try { await navigator.clipboard.writeText('TNSPEC:' + JSON.stringify(E.clip)); } catch (e) { /* 내부 클립보드만 */ }
  if (cut) Ed.deleteSelection();
}
async function paste(at) {
  let text = null;
  try { text = await navigator.clipboard.readText(); } catch (e) { /* 권한 없음 → 내부 클립보드 */ }
  if (text && text.startsWith('TNSPEC:')) { try { Ed.pastePayload(JSON.parse(text.slice(7)), at); return; } catch (e) { /* 아래로 */ } }
  if (text && E.cell && E.sel[0] === E.cell.id) {
    const rg = Ed.cellRange();
    Ed.commit(O.opsTableFill(E.idx.get(E.cell.id), rg.r0, rg.c0, O.looksTabular(text) ? O.parseTSV(text) : [[text.replace(/\r?\n$/, '')]]), '표에 붙여넣기');
    return;
  }
  if (E.clip) { Ed.pastePayload(E.clip, at); return; }
  if (text) {
    const fid = E.compId || E.activeFrame;
    if (!fid) return;
    if (O.looksTabular(text) && text.trim().includes('\n')) {
      const t = O.tableFromGrid(O.parseTSV(text));
      Ed.addNode(fid, M.createNode('table', Object.assign({ x: at ? at.x : 40, y: at ? at.y : 70 }, t)), { label: '표 붙여넣기' });
      return;
    }
    const n = M.createNode('text', { x: at ? at.x : 40, y: at ? at.y : 70, w: 260, h: 20, runs: [{ t: text.replace(/\r/g, '') }] });
    n.style.fit = 'grow';
    Ed.addNode(fid, n, { label: '글 붙여넣기' });
    return;
  }
  Ed.toast('붙여 넣을 내용이 없어요.');
}
function replaceImage(n) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
  i.onchange = async () => {
    const im = await store.readImageFile(i.files[0]); const aid = M.uid('img');
    Ed.commit([{ op: 'set', id: 'doc', key: 'assets.' + aid, value: { mime: im.mime, data: im.data, w: im.w, h: im.h, name: im.name } }, { op: 'set', id: n.id, key: 'asset', value: aid }], '이미지 교체');
  };
  i.click();
}
const rotateBy = (d) => Ed.commit(nodes().filter((n) => n.type !== 'group' && n.type !== 'connector' && n.type !== 'table').map((n) => { const r = (((n.rotation || 0) + d) % 360 + 360) % 360; return { op: 'set', id: n.id, key: 'rotation', value: r || undefined }; }), '회전');

// ---------- 메뉴 내용 ----------
function common(ctx) {
  const many = ids().length > 1;
  const any = ids().length > 0;
  const hasGroup = nodes().some((n) => n.type === 'group');
  const locked = nodes().every((n) => n.locked), hidden = nodes().every((n) => n.hidden);
  return [
    SEP,
    { label: '잘라내기', kbd: 'Ctrl+X', act: () => copySel(true), disabled: !any },
    { label: '복사', kbd: 'Ctrl+C', act: () => copySel(false), disabled: !any },
    { label: '붙여넣기', kbd: 'Ctrl+V', act: () => paste(null) },
    { label: '복제', kbd: 'Ctrl+D', act: () => Ed.duplicate(), disabled: !any },
    { label: '삭제', kbd: 'Delete', act: () => Ed.deleteSelection(), disabled: !any, danger: true },
    SEP,
    { label: '서식', sub: [
      { label: '서식 복사', kbd: 'Ctrl+Shift+C', act: () => Ed.copyFormat() },
      { label: '서식 붙여넣기', kbd: 'Ctrl+Shift+V', act: () => Ed.pasteFormat(), disabled: !E.fmt },
      { label: '🖌 서식 붓', act: () => Ed.startPainter() },
    ] },
    { label: '순서', sub: [
      { label: '맨 앞으로', kbd: 'Ctrl+Shift+]', act: () => Ed.zorder('front') },
      { label: '앞으로', kbd: 'Ctrl+]', act: () => Ed.zorder('forward') },
      { label: '뒤로', kbd: 'Ctrl+[', act: () => Ed.zorder('backward') },
      { label: '맨 뒤로', kbd: 'Ctrl+Shift+[', act: () => Ed.zorder('back') },
    ] },
    { label: '정렬', sub: [
      { label: '왼쪽', kbd: 'Alt+A', act: () => Ed.align('left') }, { label: '가로 가운데', kbd: 'Alt+H', act: () => Ed.align('hcenter') }, { label: '오른쪽', kbd: 'Alt+D', act: () => Ed.align('right') },
      SEP,
      { label: '위', kbd: 'Alt+W', act: () => Ed.align('top') }, { label: '세로 가운데', kbd: 'Alt+V', act: () => Ed.align('vcenter') }, { label: '아래', kbd: 'Alt+S', act: () => Ed.align('bottom') },
      SEP,
      { label: '가로 간격 같게', act: () => Ed.distribute('h'), disabled: ids().length < 3 },
      { label: '세로 간격 같게', act: () => Ed.distribute('v'), disabled: ids().length < 3 },
      SEP,
      { label: '같은 너비', act: () => Ed.sameSize('w'), disabled: !many },
      { label: '같은 높이', act: () => Ed.sameSize('h'), disabled: !many },
      { label: '같은 크기', act: () => Ed.sameSize('both'), disabled: !many },
    ] },
    SEP,
    { label: '그룹', kbd: 'Ctrl+G', act: () => Ed.groupSelection(), disabled: !any },
    { label: '그룹 해제', kbd: 'Ctrl+Shift+G', act: () => Ed.ungroupSelection(), disabled: !hasGroup },
    { label: '컴포넌트로 만들기', kbd: 'Ctrl+Alt+K', act: () => Ed.makeComponent(), disabled: !any },
    SEP,
    { label: locked ? '잠금 해제' : '잠그기', act: () => toggleAll('locked', locked ? '잠금 해제' : '잠금'), disabled: !any },
    { label: hidden ? '보이기' : '숨기기', act: () => toggleAll('hidden', hidden ? '보이기' : '숨기기'), disabled: !any },
    { label: '이름 바꾸기…', act: () => focusInspector('[data-k$="|name"]'), disabled: many || !any },
  ];
}

function colorRow(label, key, opts = {}) {
  return { label, swatches: opts.colors || QUICK, pick: (c) => (opts.pick ? opts.pick(c) : setAll(key, c === 'none' && opts.noneAs !== undefined ? opts.noneAs : c, label)) };
}

function forText(n) {
  const s = n.style || {};
  return [
    { label: '글 편집', kbd: 'Enter', act: () => Ed.editText(n.id, { selectAll: true }), bold: true },
    SEP,
    { label: '• 글머리 기호', kbd: 'Ctrl+Shift+8', act: () => Ed.commit(nodes().flatMap((k) => O.opsListAll(k, 'bullet')), '글머리 기호') },
    { label: '1. 번호 매기기', kbd: 'Ctrl+Shift+7', act: () => Ed.commit(nodes().flatMap((k) => O.opsListAll(k, 'number')), '번호 매기기') },
    { label: '글자', sub: [
      { label: '굵게', check: !!s.bold, act: () => setAll('style.bold', s.bold ? undefined : true, '굵게') },
      { label: '기울임', check: !!s.italic, act: () => setAll('style.italic', s.italic ? undefined : true, '기울임') },
      { label: '밑줄', check: !!s.underline, act: () => setAll('style.underline', s.underline ? undefined : true, '밑줄') },
      SEP,
      { label: '크게', kbd: 'Ctrl+Shift+>', act: () => Ed.bumpFontSize(1) },
      { label: '작게', kbd: 'Ctrl+Shift+<', act: () => Ed.bumpFontSize(-1) },
      SEP,
      colorRow('글자 색', 'style.color', { colors: QUICK.filter((c) => c !== 'none') }),
      colorRow('배경', 'style.bg', { noneAs: undefined, pick: (c) => setAll('style.bg', c === 'none' ? undefined : c, '글 배경') }),
    ] },
    { label: '맞춤', sub: [
      { label: '왼쪽', check: (s.align || 'left') === 'left', act: () => setAll('style.align', 'left', '글 정렬') },
      { label: '가운데', check: s.align === 'center', act: () => setAll('style.align', 'center', '글 정렬') },
      { label: '오른쪽', check: s.align === 'right', act: () => setAll('style.align', 'right', '글 정렬') },
      SEP,
      { label: '위', check: (s.valign || 'top') === 'top', act: () => setAll('style.valign', 'top', '세로 정렬') },
      { label: '세로 가운데', check: s.valign === 'middle', act: () => setAll('style.valign', 'middle', '세로 정렬') },
      { label: '아래', check: s.valign === 'bottom', act: () => setAll('style.valign', 'bottom', '세로 정렬') },
    ] },
    { label: '자동 맞춤', sub: [
      { label: '안 함 (상자 크기 고정)', check: !s.fit, act: () => setAll('style.fit', undefined, '자동 맞춤') },
      { label: '글에 맞춰 상자 크기 조정', check: s.fit === 'grow', act: () => setAll('style.fit', 'grow', '자동 맞춤') },
      { label: '넘치면 글자 줄이기', check: s.fit === 'shrink', act: () => setAll('style.fit', 'shrink', '자동 맞춤') },
      SEP,
      { label: '줄바꿈 안 함', check: !!s.nowrap, act: () => setAll('style.nowrap', s.nowrap ? undefined : true, '줄바꿈') },
    ] },
    rotateMenu(),
  ];
}

function rotateMenu() {
  return { label: '회전', sub: [
    { label: '오른쪽으로 90°', act: () => rotateBy(90) },
    { label: '왼쪽으로 90°', act: () => rotateBy(-90) },
    { label: '180°', act: () => rotateBy(180) },
    { label: '회전 초기화', act: () => setAll('rotation', undefined, '회전 초기화') },
  ] };
}

function forShape(n) {
  const groups = {};
  SHAPES.forEach(([k, name, g]) => { (groups[g] = groups[g] || []).push({ label: name, check: n.shape === k, act: () => Ed.commit(ids().flatMap((id) => { const ops = [{ op: 'set', id, key: 'shape', value: k }]; if (/^callout/.test(k) && !E.idx.get(id).tail) ops.push({ op: 'set', id, key: 'tail', value: [.22, 1.35] }); return ops; }), '모양 바꾸기') }); });
  return [
    { label: n.runs && M.plainText(n.runs) ? '라벨 편집' : '라벨(글) 넣기', kbd: 'Enter', act: () => Ed.editText(n.id, { selectAll: true }), bold: true },
    SEP,
    { label: '모양 바꾸기', sub: Object.entries(groups).map(([g, list]) => ({ label: g, sub: list })) },
    colorRow('채우기', 'fill'),
    colorRow('선 색', 'stroke', { pick: (c) => Ed.commit(ids().flatMap((id) => [{ op: 'set', id, key: 'stroke', value: c }, ...(c !== 'none' && !E.idx.get(id).strokeWidth ? [{ op: 'set', id, key: 'strokeWidth', value: 1 }] : [])]), '선 색') }),
    { label: '선', sub: [
      ...[0.5, 1, 2, 3, 4].map((w) => ({ label: w + 'px', check: n.strokeWidth === w, act: () => setAll('strokeWidth', w, '선 두께') })),
      SEP,
      ...[['solid', '실선'], ['dash', '점선'], ['dot', '점'], ['long', '긴 점선']].map(([k, l]) => ({ label: l, check: (n.dash || 'solid') === k, act: () => setAll('dash', k, '선 종류') })),
    ] },
    { label: '효과', sub: [
      { label: '그림자', check: !!n.shadow, act: () => toggleAll('shadow', '그림자') },
      { label: '좌우 뒤집기', check: !!n.flipH, act: () => toggleAll('flipH', '좌우 뒤집기') },
      { label: '상하 뒤집기', check: !!n.flipV, act: () => toggleAll('flipV', '상하 뒤집기') },
    ] },
    rotateMenu(),
  ];
}

function forImage(n) {
  const a = E.doc.assets[n.asset];
  return [
    { label: E.crop === n.id ? '자르기 끝내기' : '✂ 자르기', kbd: '더블클릭', act: () => (E.crop === n.id ? Ed.exitCrop() : Ed.enterCrop(n.id)), bold: true },
    { label: '자르기 취소', disabled: !n.crop, act: () => {
      const c = n.crop, fw = n.w / (1 - (c.l || 0) - (c.r || 0)), fh = n.h / (1 - (c.t || 0) - (c.b || 0));
      Ed.commit([{ op: 'set', id: n.id, key: 'crop' }, { op: 'set', id: n.id, key: 'x', value: O.R(n.x - (c.l || 0) * fw) }, { op: 'set', id: n.id, key: 'y', value: O.R(n.y - (c.t || 0) * fh) }, { op: 'set', id: n.id, key: 'w', value: O.R(fw) }, { op: 'set', id: n.id, key: 'h', value: O.R(fh) }], '자르기 취소');
    } },
    { label: '원본 비율로', disabled: !(a && a.w) || !!n.crop, act: () => Ed.commit([{ op: 'set', id: n.id, key: 'h', value: O.R(n.w * a.h / a.w) }], '원본 비율') },
    { label: '이미지 교체…', act: () => replaceImage(n) },
    SEP,
    { label: '모양', sub: [
      { label: '사각형', check: !n.mask && !n.radius, act: () => Ed.commit([{ op: 'set', id: n.id, key: 'mask' }, { op: 'set', id: n.id, key: 'radius' }], '이미지 모양') },
      { label: '둥근 모서리', check: !n.mask && !!n.radius, act: () => Ed.commit([{ op: 'set', id: n.id, key: 'mask' }, { op: 'set', id: n.id, key: 'radius', value: 10 }], '이미지 모양') },
      { label: '원', check: n.mask === 'ellipse', act: () => setAll('mask', 'ellipse', '이미지 모양') },
    ] },
    colorRow('테두리', 'stroke', { pick: (c) => Ed.commit(c === 'none' ? [{ op: 'set', id: n.id, key: 'stroke' }, { op: 'set', id: n.id, key: 'strokeWidth' }] : [{ op: 'set', id: n.id, key: 'stroke', value: c }, { op: 'set', id: n.id, key: 'strokeWidth', value: n.strokeWidth || 1 }], '이미지 테두리') }),
    { label: '효과', sub: [
      { label: '그림자', check: !!n.shadow, act: () => toggleAll('shadow', '그림자') },
      { label: '좌우 뒤집기', check: !!n.flipH, act: () => toggleAll('flipH', '좌우 뒤집기') },
      { label: '상하 뒤집기', check: !!n.flipV, act: () => toggleAll('flipV', '상하 뒤집기') },
      { label: '곱하기 혼합 (흰색 투명)', check: n.blend === 'multiply', act: () => setAll('blend', n.blend ? undefined : 'multiply', '혼합 모드') },
    ] },
    rotateMenu(),
  ];
}

function forTable(n) {
  const rg = E.cell && E.cell.id === n.id ? Ed.cellRange() : null;
  if (!rg) return [{ label: '칸 편집', kbd: '칸 누르기', act: () => Ed.editText(n.id, { r: 0, c: 0 }), bold: true }];
  const many = rg.r1 > rg.r0 || rg.c1 > rg.c0;
  const k = n.rows[rg.r0].cells[rg.c0] || {};
  const tb = (a, r, c) => () => Ed.commit(O.opsTable(E.idx.get(n.id), a, r, c), '표 편집');
  const cells = (key, value, label) => Ed.commit(O.opsCells(E.idx.get(n.id), rg, key, value), label);
  return [
    { label: '칸 편집', kbd: 'Enter', act: () => Ed.editText(n.id, { r: rg.r0, c: rg.c0 }), bold: true },
    { label: '⊞ 셀 병합', disabled: !many, act: () => { if (Ed.commit(O.opsTableMerge(E.idx.get(n.id), rg), '셀 병합')) E.cell = { id: n.id, r: rg.r0, c: rg.c0, r2: rg.r0, c2: rg.c0 }; } },
    { label: '⊟ 셀 분할', disabled: !k.span, act: () => Ed.commit(O.opsTableSplit(E.idx.get(n.id), rg.r0, rg.c0), '셀 분할') },
    { label: '칸 비우기', kbd: 'Delete', act: () => cells('runs', [{ t: '' }], '칸 비우기') },
    SEP,
    { label: '삽입', sub: [
      { label: '위에 행', act: tb('rowAbove', rg.r0, rg.c0) }, { label: '아래에 행', act: tb('rowBelow', rg.r1, rg.c0) },
      { label: '왼쪽에 열', act: tb('colLeft', rg.r0, rg.c0) }, { label: '오른쪽에 열', act: tb('colRight', rg.r0, rg.c1) },
    ] },
    { label: '행 · 열 삭제', sub: [
      { label: '행 삭제', danger: true, act: tb('rowDelete', rg.r0, rg.c0) },
      { label: '열 삭제', danger: true, act: tb('colDelete', rg.r0, rg.c0) },
      { label: '표 전체 삭제', danger: true, act: () => { E.cell = null; Ed.deleteSelection(); } },
    ] },
    { label: '크기', sub: [
      { label: rg.c1 > rg.c0 ? '고른 열 너비 같게' : '모든 열 너비 같게', act: () => Ed.commit(O.opsTableEqualize(E.idx.get(n.id), 'cols', rg.c1 > rg.c0 ? rg : null), '열 너비 같게') },
      { label: rg.r1 > rg.r0 ? '고른 행 높이 같게' : '모든 행 높이 같게', act: () => Ed.commit(O.opsTableEqualize(E.idx.get(n.id), 'rows', rg.r1 > rg.r0 ? rg : null), '행 높이 같게') },
    ] },
    SEP,
    colorRow('칸 배경', 'bg', { pick: (c) => cells('bg', c === 'none' ? undefined : c, '칸 배경') }),
    colorRow('칸 글자 색', 'color', { colors: QUICK.filter((c) => c !== 'none'), pick: (c) => cells('color', c, '칸 글자 색') }),
    { label: '칸 맞춤', sub: [
      { label: '왼쪽', check: (k.align || 'left') === 'left', act: () => cells('align', 'left', '칸 정렬') },
      { label: '가운데', check: k.align === 'center', act: () => cells('align', 'center', '칸 정렬') },
      { label: '오른쪽', check: k.align === 'right', act: () => cells('align', 'right', '칸 정렬') },
      SEP,
      { label: '위', check: k.valign === 'top', act: () => cells('valign', 'top', '칸 세로 정렬') },
      { label: '세로 가운데', check: !k.valign, act: () => cells('valign', undefined, '칸 세로 정렬') },
      { label: '아래', check: k.valign === 'bottom', act: () => cells('valign', 'bottom', '칸 세로 정렬') },
      SEP,
      { label: '굵게', check: !!k.bold, act: () => cells('bold', k.bold ? undefined : true, '칸 굵게') },
    ] },
    { label: '칸 선택 끝내기', kbd: 'Esc', act: () => { E.cell = null; Ed.select(E.sel); } },
  ];
}

function forConnector(n) {
  const caps = (end) => CAPS.map(([k, l]) => ({ label: l, check: (n[end] || 'none') === k, act: () => setAll(end, k, '화살표 모양') }));
  return [
    { label: '경로', sub: [
      { label: '직선', check: n.route !== 'elbow', act: () => setAll('route', 'straight', '경로') },
      { label: '꺾은선', check: n.route === 'elbow', act: () => setAll('route', 'elbow', '경로') },
    ] },
    { label: '시작 모양', sub: caps('startCap') },
    { label: '끝 모양', sub: caps('endCap') },
    { label: '방향 바꾸기 (시작 ↔ 끝)', act: () => Ed.commit(nodes().filter((k) => k.type === 'connector').flatMap((k) => [
      { op: 'set', id: k.id, key: 'pts', value: k.pts.slice().reverse() }, { op: 'set', id: k.id, key: 'from', value: k.to }, { op: 'set', id: k.id, key: 'to', value: k.from },
      { op: 'set', id: k.id, key: 'startCap', value: k.endCap }, { op: 'set', id: k.id, key: 'endCap', value: k.startCap }]), '방향 바꾸기') },
    { label: '연결 끊기 (제자리 고정)', disabled: !n.from && !n.to, act: () => Ed.commit(nodes().flatMap((k) => [{ op: 'set', id: k.id, key: 'from' }, { op: 'set', id: k.id, key: 'to' }]), '연결 끊기') },
    SEP,
    colorRow('선 색', 'stroke', { colors: QUICK.filter((c) => c !== 'none') }),
    { label: '선', sub: [
      ...[0.5, 1, 2, 3].map((w) => ({ label: w + 'px', check: n.width === w, act: () => setAll('width', w, '선 두께') })),
      SEP,
      ...[['solid', '실선'], ['dash', '점선'], ['dot', '점'], ['long', '긴 점선']].map(([k, l]) => ({ label: l, check: (n.dash || 'solid') === k, act: () => setAll('dash', k, '선 종류') })),
    ] },
  ];
}

function forDescription(n) {
  return [
    { label: '제목 · 설명 편집', act: () => focusInspector('#insp-desc-title'), bold: true },
    { label: n.marker === false ? '화면에 번호 표시' : '화면에서 번호 숨기기 (패널에만)', act: () => Ed.commit([{ op: 'set', id: n.id, key: 'marker', value: n.marker === false ? undefined : false }], '번호 표시') },
    colorRow('번호 색', 'color', { colors: ['#e53935', '#ff8a00', '#22c55e', 'theme:primary', '#7b4dff', '#000000'] }),
  ];
}

function forHotspot(n) {
  const frames = E.idx.frames();
  const a = n.action || {};
  return [
    { label: '동작 설정', act: () => focusInspector('#insp-hot-type'), bold: true },
    { label: '이동할 프레임', sub: frames.slice(0, 40).map((f, i) => ({ label: (i + 1) + 'P · ' + f.name, check: a.type === 'goto' && a.target === f.id, act: () => Ed.commit([{ op: 'set', id: n.id, key: 'action', value: { type: 'goto', target: f.id } }], '인터랙션 동작') })) },
    { label: '미리보기에서 확인', kbd: 'Shift+F5', act: () => P.present(E.activeFrame) },
  ];
}

function forInstance(n, ctx) {
  const comp = E.doc.components.find((c) => c.id === n.component);
  return [
    ...(ctx.mid ? [{ label: '이 글자만 바꾸기 (오버라이드)', act: () => Ed.editText(n.id, { mid: ctx.mid, selectAll: true }), bold: true }] : []),
    { label: '◇ 원본 편집', act: () => comp && Ed.editComponent(comp.id), disabled: !comp, bold: !ctx.mid },
    { label: '오버라이드 초기화', disabled: !Object.keys(n.overrides || {}).length, act: () => Ed.commit([{ op: 'set', id: n.id, key: 'overrides', value: {} }], '오버라이드 초기화') },
    { label: '원본 크기로', disabled: !comp, act: () => Ed.commit([{ op: 'set', id: n.id, key: 'w', value: comp.w }, { op: 'set', id: n.id, key: 'h', value: comp.h }], '원본 크기') },
    { label: '다른 컴포넌트로 바꾸기', disabled: E.doc.components.length < 2, sub: E.doc.components.map((c) => ({ label: c.name, check: c.id === n.component, act: () => Ed.commit([{ op: 'set', id: n.id, key: 'component', value: c.id }, { op: 'set', id: n.id, key: 'overrides', value: {} }], '컴포넌트 바꾸기') })) },
    { label: '분리 (일반 그룹으로)', act: () => Ed.detachInstance(n.id) },
  ];
}

function forGroup(n) {
  return [
    { label: '그룹 안으로 들어가기', kbd: 'Enter', act: () => { if (n.children.length) { E.scope = n.id; Ed.select([n.children[n.children.length - 1].id]); } }, bold: true },
  ];
}

function forFrame(fid) {
  const f = E.idx.get(fid);
  if (!f) return [];
  const page = E.idx.parentOf(fid), i = page.frames.indexOf(f);
  return [
    { label: '프레임 속성', act: () => Ed.select([], { frame: fid }), bold: true },
    { label: '이름 바꾸기…', act: () => { Ed.select([], { frame: fid }); focusInspector('[data-k$="|name"]'); } },
    { label: '레이아웃', sub: Object.entries(LAYOUT_INFO).map(([k, v]) => ({ label: v.name, check: f.layout === k, act: () => Ed.commit([{ op: 'set', id: fid, key: 'layout', value: k }], '레이아웃 변경') })) },
    SEP,
    { label: '뒤에 새 프레임', kbd: 'Ctrl+M', sub: Object.entries(LAYOUT_INFO).map(([k, v]) => ({ label: v.name, act: () => Ed.addFrame(k, { page: page.id, after: fid }) })) },
    { label: '프레임 복제', act: () => { const c = M.cloneWithNewIds(f); Ed.commit([{ op: 'insert', parent: page.id, index: i + 1, item: c }], '프레임 복제'); } },
    { label: '위로', disabled: i === 0, act: () => Ed.commit([{ op: 'move', id: fid, parent: page.id, index: i - 1 }], '프레임 순서') },
    { label: '아래로', disabled: i === page.frames.length - 1, act: () => Ed.commit([{ op: 'move', id: fid, parent: page.id, index: i + 1 }], '프레임 순서') },
    { label: '다른 페이지로', disabled: E.doc.pages.length < 2, sub: E.doc.pages.filter((p) => p.id !== page.id).map((p) => ({ label: p.name, act: () => Ed.commit([{ op: 'move', id: fid, parent: p.id, index: null }], '프레임을 다른 페이지로') })) },
    SEP,
    { label: f.hidden ? '프레임 보이기' : '프레임 숨기기 (미리보기 · 인쇄 제외)', act: () => Ed.toggleFrameHidden(fid) },
    { label: '📝 프레임 메모', act: () => { Ed.select([], { frame: fid }); focusInspector('#insp-frame-notes'); } },
    { label: '이 프레임부터 미리보기', kbd: 'Shift+F5', act: () => P.present(fid) },
    { label: '안내선 모두 지우기', disabled: !f.guides, act: () => V.clearGuides(E, fid) },
    SEP,
    { label: '프레임 삭제', danger: true, act: () => Ed.deleteFrame(fid) },
  ];
}

function forEmpty(ctx) {
  const s = E.doc.settings;
  const fid = ctx.fid;
  const comp = E.compId;
  const items = [
    { label: '붙여넣기', kbd: 'Ctrl+V', act: () => paste(ctx.point), bold: true },
    { label: '모두 선택', kbd: 'Ctrl+A', act: () => { const c = Ed.containerFor(fid); Ed.select(c.nodes.filter((n) => !n.locked && !n.hidden).map((n) => n.id)); } },
    SEP,
    { label: '여기에 넣기', sub: [
      { label: '글', act: () => { const n = M.createNode('text', { x: ctx.point.x, y: ctx.point.y, w: 160, h: 18, runs: [{ t: '' }], name: '텍스트' }); n.style.fit = 'grow'; const id = Ed.addNode(fid, n); if (id) setTimeout(() => Ed.editText(id, { selectAll: true, isNew: true }), 0); } },
      { label: '사각형', act: () => Ed.addNode(fid, M.createNode('shape', { x: ctx.point.x, y: ctx.point.y, w: 100, h: 60 })) },
      { label: 'Description 번호', act: () => Ed.addNode(fid, M.createNode('description', { x: ctx.point.x - 8, y: ctx.point.y - 8, num: O.nextDescriptionNumber(Ed.containerFor(fid)) })) },
      { label: '표 (3×4)', act: () => Ed.addNode(fid, M.createNode('table', Object.assign({ x: ctx.point.x, y: ctx.point.y, w: 400, h: 96 }, M.makeTable([90, 130, 180], [24, 24, 24, 24], { header: ['항목', '정책', '상세'], headerBg: '#d9d9d9' })))) },
      { label: '인터랙션 영역', act: () => Ed.addNode(fid, M.createNode('hotspot', { x: ctx.point.x, y: ctx.point.y })) },
      { label: '이미지…', act: () => Ed.pickImage() },
      ...(E.doc.components.length ? [SEP, ...E.doc.components.filter((c) => c.id !== comp).map((c) => ({ label: '◇ ' + c.name, act: () => Ed.insertInstance(c.id, fid, ctx.point) }))] : []),
    ] },
    SEP,
    { label: '보기', sub: [
      { label: '눈금자', kbd: 'Shift+R', check: !!s.rulers, act: () => Ed.setSetting('rulers', !s.rulers) },
      { label: '격자 표시', kbd: "Shift+'", check: !!s.gridShow, act: () => Ed.setSetting('gridShow', !s.gridShow) },
      { label: '격자에 맞추기', check: !!s.gridSnap, act: () => Ed.setSetting('gridSnap', !s.gridSnap) },
      SEP,
      { label: '정렬 보기 (썸네일)', act: () => Ed.setView('sorter') },
      { label: '너비 맞춤', kbd: 'Shift+1', act: () => Ed.fitWidth() },
    ] },
  ];
  if (!comp) items.push(SEP, ...forFrame(fid).slice(0, 1), { label: '프레임', sub: forFrame(fid).slice(1) });
  return items;
}

function itemsFor(ctx) {
  if (ctx.kind === 'frame') return forFrame(ctx.fid);
  if (ctx.kind === 'empty') return forEmpty(ctx);
  const sel = nodes();
  const n = E.idx.get(ctx.id);
  const type = sel.every((k) => k.type === n.type) ? n.type : null;
  const head = sel.length > 1 ? [{ title: `${sel.length}개 선택` }] : [{ title: typeTitle(n) }];
  let own = [];
  if (type === 'text') own = forText(n);
  else if (type === 'shape') own = forShape(n);
  else if (type === 'image' && sel.length === 1) own = forImage(n);
  else if (type === 'table' && sel.length === 1) own = forTable(n);
  else if (type === 'connector') own = forConnector(n);
  else if (type === 'description' && sel.length === 1) own = forDescription(n);
  else if (type === 'hotspot' && sel.length === 1) own = forHotspot(n);
  else if (type === 'instance' && sel.length === 1) own = forInstance(n, ctx);
  else if (type === 'group' && sel.length === 1) own = forGroup(n);
  return head.concat(own, common(ctx));
}
function typeTitle(n) {
  const T = { text: '글', image: '이미지', table: '표', shape: '도형', connector: '선', description: 'Description', hotspot: '인터랙션 영역', group: '그룹', instance: '인스턴스' };
  return (T[n.type] || n.type) + (n.name ? ' · ' + n.name : '');
}

// ---------- 그리기 ----------
let root = null;
export function close() {
  if (root) { root.remove(); root = null; }
  document.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', close);
}
function outside(e) { if (root && !root.contains(e.target)) close(); }
function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
}

function build(items, level) {
  const m = document.createElement('div');
  m.className = 'cm-menu';
  m.dataset.level = level;
  // 앞뒤 · 연속 구분선 정리
  const list = items.filter((it, i) => !(it.sep && (i === 0 || items[i - 1].sep || i === items.length - 1)));
  for (const it of list) {
    if (it.sep) { m.appendChild(Object.assign(document.createElement('hr'), {})); continue; }
    if (it.title) { const t = document.createElement('div'); t.className = 'cm-title'; t.textContent = it.title; m.appendChild(t); continue; }
    if (it.swatches) {
      const row = document.createElement('div');
      row.className = 'cm-sw';
      row.innerHTML = `<span>${esc(it.label)}</span><div>${it.swatches.map((c) => `<button data-c="${esc(c)}" title="${esc(c === 'none' ? '없음' : c.startsWith('theme:') ? '테마 · ' + c.slice(6) : c)}" class="${c === 'none' ? 'none' : ''}" style="background:${c.startsWith('theme:') ? `var(--tc-${c.slice(6)}, #399eff)` : c === 'none' ? 'transparent' : c}"></button>`).join('')}</div>`;
      row.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; close(); it.pick(b.dataset.c); });
      m.appendChild(row);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'cm-it' + (it.disabled ? ' off' : '') + (it.danger ? ' danger' : '') + (it.bold ? ' strong' : '');
    b.innerHTML = `<i>${it.check ? '✓' : ''}</i><span>${esc(it.label)}</span><em>${it.sub ? '▸' : esc(it.kbd || '')}</em>`;
    if (it.disabled) b.disabled = true;
    if (it.sub) {
      b.classList.add('has-sub');
      b.addEventListener('pointerenter', () => openSub(b, it.sub, level + 1));
      b.addEventListener('click', () => openSub(b, it.sub, level + 1));
    } else {
      b.addEventListener('pointerenter', () => closeFrom(level + 1));
      b.addEventListener('click', () => { close(); try { it.act(); } catch (err) { console.error(err); Ed.toast('실행하지 못했어요: ' + err.message, true); } });
    }
    m.appendChild(b);
  }
  return m;
}
function closeFrom(level) { root.querySelectorAll('.cm-menu').forEach((m) => { if (+m.dataset.level >= level) m.remove(); }); root.querySelectorAll(`.cm-menu[data-level="${level - 1}"] .cm-it.open`).forEach((b) => b.classList.remove('open')); }
function openSub(btn, items, level) {
  if (btn.classList.contains('open') && root.querySelector(`.cm-menu[data-level="${level}"]`)) return;
  closeFrom(level);
  btn.classList.add('open');
  const m = build(items, level);
  root.appendChild(m);
  const r = btn.getBoundingClientRect();
  place(m, r.right - 2, r.top - 5, r.left + 2);
}
function place(m, x, y, flipX) {
  const w = m.offsetWidth, h = m.offsetHeight;
  let left = x, top = y;
  if (left + w > innerWidth - 6) left = flipX != null ? flipX - w : innerWidth - w - 6;
  if (top + h > innerHeight - 6) top = Math.max(6, innerHeight - h - 6);
  m.style.left = Math.max(6, left) + 'px';
  m.style.top = top + 'px';
}

export function open(e, ctx) {
  close();
  const items = itemsFor(ctx);
  root = document.createElement('div');
  root.className = 'cm-root';
  root.addEventListener('contextmenu', (ev) => ev.preventDefault());
  document.body.appendChild(root);
  const m = build(items, 0);
  root.appendChild(m);
  place(m, e.clientX, e.clientY);
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
  }, 0);
}
