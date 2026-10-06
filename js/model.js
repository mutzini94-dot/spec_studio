// 투네이션 상세기획서 문서 모델
// 문서 → 페이지(장) → 프레임(한 장의 기획서 슬라이드) → 노드
// 모든 편집은 "연산(op)"으로 기록한다. 연산을 적용하면 되돌리는 연산(inverse)이 함께 나오므로
// 되돌리기 · 다시 실행 · 리비전 · 동시 편집(3단계)이 같은 기록 위에서 동작한다.

export const SCHEMA = 'toonation.spec';
export const SCHEMA_VERSION = 1;
export const PAGE_W = 960;
export const PAGE_H = 540;

// 테마 색: 노드 색에 'theme:primary'처럼 적으면 테마를 바꿀 때 문서 전체가 함께 바뀐다
export const DEFAULT_THEME = {
  colors: [
    { key: 'primary', name: '투네이션 블루', value: '#399eff' },
    { key: 'primaryDark', name: '진한 블루', value: '#2f6fe0' },
    { key: 'text', name: '본문', value: '#111111' },
    { key: 'sub', name: '보조 글자', value: '#5d6470' },
    { key: 'line', name: '선 · 테두리', value: '#c7ccd3' },
    { key: 'bg', name: '바탕 회색', value: '#f2f2f2' },
    { key: 'dark', name: '표지 회색', value: '#393939' },
    { key: 'annot', name: '주석 빨강', value: '#e53935' },
    { key: 'orange', name: '주황', value: '#ff8a00' },
    { key: 'green', name: '초록', value: '#22c55e' },
    { key: 'purple', name: '보라', value: '#7b4dff' },
    { key: 'yellow', name: '노랑', value: '#ffc107' },
  ],
};

// 도형 라이브러리 [키, 이름, 묶음]
export const SHAPES = [
  ['rect', '사각형', '기본'], ['roundRect', '둥근 사각형', '기본'], ['ellipse', '원', '기본'], ['triangle', '삼각형', '기본'],
  ['rtTriangle', '직각 삼각형', '기본'], ['diamond', '마름모', '기본'], ['parallelogram', '평행사변형', '기본'], ['trapezoid', '사다리꼴', '기본'],
  ['hexagon', '육각형', '기본'], ['octagon', '팔각형', '기본'], ['star5', '별', '기본'], ['plus', '더하기', '기본'],
  ['callout', '말풍선', '설명선'], ['calloutRound', '둥근 말풍선', '설명선'], ['calloutOval', '원형 말풍선', '설명선'],
  ['arrowR', '오른쪽 화살표', '블록 화살표'], ['arrowL', '왼쪽 화살표', '블록 화살표'], ['arrowU', '위쪽 화살표', '블록 화살표'], ['arrowD', '아래쪽 화살표', '블록 화살표'],
  ['chevron', '갈매기형', '블록 화살표'], ['pentagon', '오각형 화살표', '블록 화살표'],
  ['process', '처리', '순서도'], ['decision', '판단', '순서도'], ['terminator', '시작/끝', '순서도'], ['data', '데이터(입출력)', '순서도'],
  ['document', '문서', '순서도'], ['predefined', '정의된 처리', '순서도'], ['cylinder', '데이터베이스', '순서도'], ['manualInput', '수동 입력', '순서도'],
];
export const NODE_TYPES = ['text', 'image', 'table', 'shape', 'connector', 'description', 'hotspot', 'group', 'instance'];
export const LAYOUTS = ['cover', 'history', 'policy', 'divider', 'screen', 'end', 'blank'];

// 노드 종류별 기본값 (새로 만들 때만 사용 — 저장된 문서에는 실제 값만 남는다)
export const NODE_DEFAULTS = {
  text: { w: 160, h: 20, runs: [{ t: '텍스트' }], style: { size: 12, color: '#111111', align: 'left', valign: 'top', lineHeight: 1.35 } },
  image: { w: 160, h: 120, asset: null, fit: 'contain' },
  table: { w: 400, h: 72 },
  shape: { w: 120, h: 80, shape: 'rect', fill: '#ffffff', stroke: '#9aa3ad', strokeWidth: 1, radius: 0 },
  connector: { pts: [[0, 0], [100, 0]], stroke: '#e53935', width: 1, dash: 'dash', route: 'straight', startCap: 'dot', endCap: 'arrow' },
  description: { w: 16, h: 16, num: 1, title: '', body: '', color: '#e53935' },
  hotspot: { w: 120, h: 40, action: { type: 'none' } },
  group: { children: [] },
  instance: { w: 100, h: 40, component: null, overrides: {} },
};

let _seq = 0;
export function uid(prefix = 'n') {
  _seq = (_seq + 1) % 1679616;
  return prefix + '_' + Date.now().toString(36).slice(-5) + _seq.toString(36).padStart(4, '0') + Math.random().toString(36).slice(2, 5);
}

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---------- 생성 ----------
export function createDoc(meta = {}) {
  return {
    schema: SCHEMA,
    version: SCHEMA_VERSION,
    id: uid('doc'),
    meta: Object.assign({ title: '기획서 제목', project: '프로젝트 명', team: '팀 이름', version: '0.1', date: today(), author: '', copyright: 'Toonation' }, meta),
    size: { w: PAGE_W, h: PAGE_H },
    pages: [],
    components: [],
    assets: {},
    theme: clone(DEFAULT_THEME),
    settings: { grid: 10, gridShow: false, gridSnap: false, rulers: false },
    rev: 0,
  };
}

export function createPage(name = '페이지', frames = []) {
  return { kind: 'page', id: uid('pg'), name, frames };
}

export function createFrame(layout = 'blank', name = '', props = {}, nodes = []) {
  return { kind: 'frame', id: uid('fr'), name: name || layout, layout, props, nodes };
}

export function createComponent(name, w, h, nodes = []) {
  return { kind: 'component', id: uid('cmp'), name, w, h, nodes };
}

export function createNode(type, props = {}) {
  if (!NODE_TYPES.includes(type)) throw new Error('알 수 없는 노드 종류: ' + type);
  const n = Object.assign({ id: uid(type.slice(0, 3)), type, name: '', x: 0, y: 0 }, clone(NODE_DEFAULTS[type]), clone(props));
  if (type === 'group' || type === 'connector') { delete n.w; delete n.h; }
  if (!n.name) n.name = defaultName(n);
  return n;
}

export function defaultName(n) {
  switch (n.type) {
    case 'text': return (plainText(n.runs).split('\n')[0] || '텍스트').slice(0, 24);
    case 'image': return '이미지';
    case 'table': return '표';
    case 'shape': { const s = SHAPES.find((k) => k[0] === n.shape); return s ? s[1] : '도형'; }
    case 'connector': return '연결선';
    case 'description': return 'Description ' + n.num;
    case 'hotspot': return '인터랙션 영역';
    case 'group': return '그룹';
    case 'instance': return '인스턴스';
  }
  return n.type;
}

// 표: 열 너비 · 행 높이 배열로 빈 표를 만든다
export function makeTable(cols, rowHeights, opts = {}) {
  const rows = rowHeights.map((h, ri) => ({
    h,
    cells: cols.map((_, ci) => {
      const head = opts.header && ri === 0;
      const c = { runs: [{ t: head ? (opts.header[ci] || '') : '' }] };
      if (head) { c.bold = true; c.align = 'center'; if (opts.headerBg) c.bg = opts.headerBg; if (opts.headerColor) c.color = opts.headerColor; }
      return c;
    }),
  }));
  return { cols: cols.slice(), rows, style: Object.assign({ border: 'grid', borderColor: '#bfbfbf', size: 9, color: '#222222', pad: 5 }, opts.style || {}) };
}

export function plainText(runs) {
  return (runs || []).map((r) => (r.t != null ? r.t : '')).join('');
}

// ---------- 인덱스: id → 위치 ----------
// 컨테이너 목록 키: 문서(pages/components), 페이지(frames), 프레임 · 컴포넌트(nodes), 그룹(children)
export function listKeyFor(parent, child) {
  if (parent === 'doc' || parent.schema === SCHEMA) return child.kind === 'component' ? 'components' : 'pages';
  if (parent.kind === 'page') return 'frames';
  if (parent.kind === 'frame' || parent.kind === 'component') return 'nodes';
  if (parent.type === 'group') return 'children';
  throw new Error('컨테이너가 아닌 곳에 넣을 수 없음: ' + (parent.id || parent));
}

export function childLists(obj) {
  if (obj.schema === SCHEMA) return [obj.pages, obj.components];
  if (obj.kind === 'page') return [obj.frames];
  if (obj.kind === 'frame' || obj.kind === 'component') return [obj.nodes];
  if (obj.type === 'group') return [obj.children];
  return [];
}

export class DocIndex {
  constructor(doc) {
    this.doc = doc;
    this.map = new Map();
    this.map.set('doc', { obj: doc, parent: null, key: null });
    for (const l of childLists(doc)) for (const c of l) this.add(c, doc);
  }
  add(obj, parent) {
    if (this.map.has(obj.id)) throw new Error('id 중복: ' + obj.id);
    this.map.set(obj.id, { obj, parent, key: listKeyFor(parent, obj) });
    for (const l of childLists(obj)) for (const c of l) this.add(c, obj);
  }
  remove(obj) {
    this.map.delete(obj.id);
    for (const l of childLists(obj)) for (const c of l) this.remove(c);
  }
  get(id) { const e = this.map.get(id); return e ? e.obj : null; }
  entry(id) { return this.map.get(id) || null; }
  parentOf(id) { const e = this.map.get(id); return e ? e.parent : null; }
  // 노드가 속한 프레임(또는 컴포넌트 원본)
  containerOf(id) {
    let e = this.map.get(id);
    while (e && e.parent) {
      const p = e.parent;
      if (p.kind === 'frame' || p.kind === 'component') return p;
      e = this.map.get(p.id);
    }
    return null;
  }
  pageOf(id) {
    let e = this.map.get(id);
    while (e && e.parent) {
      if (e.parent.kind === 'page') return e.parent;
      e = this.map.get(e.parent.id);
    }
    return null;
  }
  // 조상 그룹들 (가까운 것부터)
  ancestors(id) {
    const out = [];
    let p = this.parentOf(id);
    while (p && p.type === 'group') { out.push(p); p = this.parentOf(p.id); }
    return out;
  }
  // 프레임 좌표계로 바꾸기 위한 누적 오프셋
  offsetOf(id) {
    let x = 0, y = 0;
    for (const g of this.ancestors(id)) { x += g.x || 0; y += g.y || 0; }
    return { x, y };
  }
  frames() {
    const out = [];
    for (const p of this.doc.pages) for (const f of p.frames) out.push(f);
    return out;
  }
}

// ---------- 경로 접근 (점 표기: 'style.size', 'rows.2.cells.0.runs') ----------
function splitPath(path) { return String(path).split('.').map((k) => (/^\d+$/.test(k) ? +k : k)); }

export function getPath(obj, path) {
  let cur = obj;
  for (const k of splitPath(path)) { if (cur == null) return undefined; cur = cur[k]; }
  return cur;
}

function setPath(obj, path, value) {
  const ks = splitPath(path);
  let cur = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (cur[ks[i]] == null || typeof cur[ks[i]] !== 'object') cur[ks[i]] = typeof ks[i + 1] === 'number' ? [] : {};
    cur = cur[ks[i]];
  }
  const last = ks[ks.length - 1];
  if (value === undefined) { if (Array.isArray(cur)) cur.splice(last, 1); else delete cur[last]; }
  else cur[last] = value;
}

// ---------- 연산 ----------
// { op:'insert', parent:id|'doc', index, item }
// { op:'remove', id }
// { op:'move',   id, parent:id|'doc', index }        // 순서 변경 · 그룹 넣고 빼기
// { op:'set',    id:id|'doc', key:'a.b', value }      // value 생략 = 키 삭제
// apply()는 실제로 문서를 바꾸고, 되돌리는 연산을 돌려준다.
export function apply(idx, o) {
  const doc = idx.doc;
  switch (o.op) {
    case 'insert': {
      const parent = o.parent === 'doc' ? doc : idx.get(o.parent);
      if (!parent) throw new Error('insert: 부모 없음 ' + o.parent);
      const item = clone(o.item);
      const key = listKeyFor(parent, item);
      const list = parent[key] || (parent[key] = []);
      const at = o.index == null || o.index > list.length ? list.length : Math.max(0, o.index);
      list.splice(at, 0, item);
      idx.add(item, parent);
      return { op: 'remove', id: item.id };
    }
    case 'remove': {
      const e = idx.entry(o.id);
      if (!e || !e.parent) throw new Error('remove: 없음 ' + o.id);
      const list = e.parent[e.key];
      const at = list.indexOf(e.obj);
      list.splice(at, 1);
      idx.remove(e.obj);
      return { op: 'insert', parent: e.parent === doc ? 'doc' : e.parent.id, index: at, item: clone(e.obj) };
    }
    case 'move': {
      const e = idx.entry(o.id);
      if (!e || !e.parent) throw new Error('move: 없음 ' + o.id);
      const np = o.parent === 'doc' ? doc : idx.get(o.parent);
      if (!np) throw new Error('move: 부모 없음 ' + o.parent);
      for (let p = np; p && p !== doc; p = idx.parentOf(p.id)) if (p === e.obj) throw new Error('move: 자기 안으로 옮길 수 없음');
      const oldList = e.parent[e.key];
      const oldAt = oldList.indexOf(e.obj);
      const inv = { op: 'move', id: o.id, parent: e.parent === doc ? 'doc' : e.parent.id, index: oldAt };
      oldList.splice(oldAt, 1);
      const key = listKeyFor(np, e.obj);
      const list = np[key] || (np[key] = []);
      const at = o.index == null || o.index > list.length ? list.length : Math.max(0, o.index);
      list.splice(at, 0, e.obj);
      e.parent = np; e.key = key;
      return inv;
    }
    case 'set': {
      const obj = o.id === 'doc' ? doc : idx.get(o.id);
      if (!obj) throw new Error('set: 없음 ' + o.id);
      if (o.key === 'id' || o.key === 'type' || o.key === 'kind') throw new Error('set: 바꿀 수 없는 키 ' + o.key);
      const prev = clone(getPath(obj, o.key));
      setPath(obj, o.key, clone(o.value));
      return prev === undefined ? { op: 'set', id: o.id, key: o.key } : { op: 'set', id: o.id, key: o.key, value: prev };
    }
  }
  throw new Error('알 수 없는 연산: ' + o.op);
}

// 여러 연산을 하나의 작업으로 적용 — 실패하면 앞서 적용한 것까지 되돌린다
export function applyAll(idx, ops) {
  const inv = [];
  try {
    for (const o of ops) inv.push(apply(idx, o));
  } catch (err) {
    for (let i = inv.length - 1; i >= 0; i--) apply(idx, inv[i]);
    throw err;
  }
  return inv.reverse();
}

// ---------- 되돌리기 기록 ----------
export class History {
  constructor(idx, onChange) {
    this.idx = idx;
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = onChange || (() => {});
    this.limit = 300;
  }
  // merge: 같은 키로 연달아 들어오는 작업(드래그 · 타이핑)은 한 번의 되돌리기로 합친다
  commit(ops, label = '편집', merge = null) {
    if (!ops || !ops.length) return null;
    const inv = applyAll(this.idx, ops);
    const top = this.undoStack[this.undoStack.length - 1];
    if (merge && top && top.merge === merge && Date.now() - top.time < 1500) {
      top.ops = compact(top.ops.concat(ops));
      top.inv = inv.concat(top.inv);
      top.inv = compactInverse(top.inv);
      top.time = Date.now();
    } else {
      this.undoStack.push({ label, ops: clone(ops), inv, merge, time: Date.now() });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
    this.idx.doc.rev = (this.idx.doc.rev || 0) + 1;
    this.onChange({ kind: 'commit', ops, inv, label });
    return true;
  }
  undo() {
    const t = this.undoStack.pop();
    if (!t) return null;
    const back = applyAll(this.idx, t.inv);
    this.redoStack.push(t);
    this.idx.doc.rev = (this.idx.doc.rev || 0) + 1;
    this.onChange({ kind: 'undo', ops: t.inv, inv: back, label: t.label });
    return t;
  }
  redo() {
    const t = this.redoStack.pop();
    if (!t) return null;
    t.inv = applyAll(this.idx, t.ops);
    t.merge = null;
    this.undoStack.push(t);
    this.idx.doc.rev = (this.idx.doc.rev || 0) + 1;
    this.onChange({ kind: 'redo', ops: t.ops, inv: t.inv, label: t.label });
    return t;
  }
  clear() { this.undoStack = []; this.redoStack = []; }
}

// 같은 대상 · 같은 키의 set은 마지막 값만 남긴다 (드래그 중 수백 개가 쌓이지 않게)
function compact(ops) {
  const out = [];
  const seen = new Map();
  for (const o of ops) {
    if (o.op === 'set') {
      const k = o.id + '\u0000' + o.key;
      if (seen.has(k)) { out[seen.get(k)] = clone(o); continue; }
      seen.set(k, out.length);
    } else seen.clear();
    out.push(clone(o));
  }
  return out;
}
// 되돌리기 쪽은 반대로 "처음 값"이 남아야 한다 (inv 배열은 실행 순서 = 최신 → 과거)
function compactInverse(inv) {
  const out = [];
  const seen = new Map();
  for (const o of inv) {
    if (o.op === 'set') {
      const k = o.id + '\u0000' + o.key;
      if (seen.has(k)) out[seen.get(k)] = null;   // 더 과거의 값(뒤쪽)이 이긴다
      seen.set(k, out.length);
    } else seen.clear();
    out.push(o);
  }
  return out.filter(Boolean);
}

// ---------- 기하 ----------
// 노드의 경계 상자 (부모 좌표계)
export function bounds(n, idx) {
  if (n.type === 'group') {
    const kids = (n.children || []).filter((c) => !c.hidden);
    if (!kids.length) return { x: n.x || 0, y: n.y || 0, w: 0, h: 0 };
    const bs = kids.map((c) => bounds(c, idx));
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
    return { x: (n.x || 0) + x0, y: (n.y || 0) + y0, w: x1 - x0, h: y1 - y0 };
  }
  if (n.type === 'connector') {
    const pts = n.pts || [];
    if (!pts.length) return { x: n.x || 0, y: n.y || 0, w: 0, h: 0 };
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return { x: (n.x || 0) + x0, y: (n.y || 0) + y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
  }
  if (n.rotation) {
    // 회전한 노드는 회전된 네 모서리를 감싸는 상자
    const w = n.w || 0, h = n.h || 0, cx = (n.x || 0) + w / 2, cy = (n.y || 0) + h / 2;
    const a = n.rotation * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const bw = w * c + h * s, bh = w * s + h * c;
    return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
  }
  return { x: n.x || 0, y: n.y || 0, w: n.w || 0, h: n.h || 0 };
}

// 프레임 좌표계 경계 상자
export function frameBounds(n, idx) {
  const b = bounds(n, idx);
  const o = idx.offsetOf(n.id);
  return { x: b.x + o.x, y: b.y + o.y, w: b.w, h: b.h };
}

// ---------- 하위 트리 복제 (복사 · 붙여넣기 · 컴포넌트 분리) ----------
export function cloneWithNewIds(node, idMap = new Map()) {
  const c = clone(node);
  (function walk(n) {
    const nid = uid((n.type || n.kind || 'n').slice(0, 3));
    idMap.set(n.id, nid);
    n.id = nid;
    for (const l of childLists(n)) for (const k of l) walk(k);
  })(c);
  // 연결선이 복사본 안의 노드를 가리키면 새 id로 바꾼다
  (function relink(n) {
    if (n.type === 'connector') for (const end of ['from', 'to']) if (n[end] && n[end].node && idMap.has(n[end].node)) n[end].node = idMap.get(n[end].node);
    if (n.overrides) {
      const o = {};
      for (const k in n.overrides) o[k] = n.overrides[k];
      n.overrides = o;
    }
    for (const l of childLists(n)) for (const k of l) relink(k);
  })(c);
  return c;
}

// ---------- 직렬화 · 검증 ----------
export function serialize(doc) {
  return JSON.stringify(doc);
}

// 예전 버전 문서를 현재 스키마로 끌어올린다 (지금은 v1만 존재)
export function migrate(raw) {
  const doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!doc || doc.schema !== SCHEMA) throw new Error('투네이션 기획서 문서가 아닙니다 (schema 불일치)');
  if (doc.version > SCHEMA_VERSION) throw new Error('더 새로운 버전의 문서입니다 (v' + doc.version + ')');
  doc.meta = doc.meta || {};
  doc.size = doc.size || { w: PAGE_W, h: PAGE_H };
  doc.pages = doc.pages || [];
  doc.components = doc.components || [];
  doc.assets = doc.assets || {};
  doc.theme = doc.theme || clone(DEFAULT_THEME);
  doc.settings = Object.assign({ grid: 10, gridShow: false, gridSnap: false, rulers: false }, doc.settings || {});
  doc.rev = doc.rev || 0;
  return doc;
}

// 깨진 곳을 찾아 목록으로 돌려준다 (빈 배열 = 정상)
export function validate(doc) {
  const errs = [];
  const ids = new Set();
  const compIds = new Set(doc.components.map((c) => c.id));
  const nodeIds = new Set();
  const conns = [];
  const seeId = (o, where) => {
    if (!o || typeof o.id !== 'string' || !o.id) errs.push(where + ': id 없음');
    else if (ids.has(o.id)) errs.push(where + ': id 중복 ' + o.id);
    else ids.add(o.id);
  };
  const num = (v) => typeof v === 'number' && isFinite(v);
  const walkNodes = (list, where, inComponent) => {
    if (!Array.isArray(list)) { errs.push(where + ': 노드 목록이 배열이 아님'); return; }
    for (const n of list) {
      const w = where + ' > ' + (n && (n.name || n.id));
      seeId(n, w);
      nodeIds.add(n.id);
      if (!NODE_TYPES.includes(n.type)) { errs.push(w + ': 알 수 없는 종류 ' + n.type); continue; }
      if (!num(n.x) || !num(n.y)) errs.push(w + ': 좌표가 숫자가 아님');
      if (!['group', 'connector'].includes(n.type) && (!num(n.w) || !num(n.h))) errs.push(w + ': 크기가 숫자가 아님');
      if (n.type === 'group') walkNodes(n.children, w, inComponent);
      if (n.type === 'image' && n.asset && !doc.assets[n.asset]) errs.push(w + ': 이미지 자원 없음 ' + n.asset);
      if (n.type === 'instance') {
        if (!compIds.has(n.component)) errs.push(w + ': 컴포넌트 없음 ' + n.component);
      }
      if (n.type === 'connector') {
        if (!Array.isArray(n.pts) || n.pts.length < 2) errs.push(w + ': 연결선 점이 2개 미만');
        conns.push([n, w]);
      }
      if (n.type === 'table') {
        if (!Array.isArray(n.cols) || !Array.isArray(n.rows)) errs.push(w + ': 표 구조 없음');
        else n.rows.forEach((r, ri) => { if (!Array.isArray(r.cells) || r.cells.length !== n.cols.length) errs.push(w + ': ' + (ri + 1) + '행 칸 수가 열 수와 다름'); });
      }
    }
  };
  if (doc.schema !== SCHEMA) errs.push('schema 불일치');
  for (const p of doc.pages) {
    seeId(p, '페이지 ' + p.name);
    if (p.kind !== 'page') errs.push('페이지 ' + p.name + ': kind≠page');
    for (const f of p.frames || []) {
      seeId(f, '프레임 ' + f.name);
      if (f.kind !== 'frame') errs.push('프레임 ' + f.name + ': kind≠frame');
      if (!LAYOUTS.includes(f.layout)) errs.push('프레임 ' + f.name + ': 알 수 없는 레이아웃 ' + f.layout);
      walkNodes(f.nodes, '프레임 ' + f.name, false);
    }
  }
  for (const c of doc.components) {
    seeId(c, '컴포넌트 ' + c.name);
    walkNodes(c.nodes, '컴포넌트 ' + c.name, true);
    // 컴포넌트가 자기 자신을 (간접적으로) 품으면 무한 반복
    const seen = new Set();
    const visit = (cid) => {
      if (seen.has(cid)) return true;
      seen.add(cid);
      const comp = doc.components.find((k) => k.id === cid);
      let cyc = false;
      const walk = (l) => l.forEach((n) => { if (n.type === 'instance') cyc = cyc || visit(n.component); if (n.type === 'group') walk(n.children); });
      if (comp) walk(comp.nodes);
      seen.delete(cid);
      return cyc;
    };
    if (visit(c.id)) errs.push('컴포넌트 ' + c.name + ': 자기 자신을 포함함');
  }
  for (const [n, w] of conns) for (const end of ['from', 'to']) if (n[end] && n[end].node && !nodeIds.has(n[end].node)) errs.push(w + ': 연결 대상 없음 ' + n[end].node);
  return errs;
}

// 저장 → 다시 열기: 문자열로 만들었다가 되살려 검증까지 통과해야 성공
export function load(raw) {
  const doc = migrate(raw);
  const errs = validate(doc);
  if (errs.length) {
    const e = new Error('문서 검증 실패:\n' + errs.slice(0, 12).join('\n'));
    e.errors = errs;
    throw e;
  }
  return doc;
}
