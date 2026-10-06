// 편집 명령 → 연산 목록. UI와 분리돼 있어서 노드 환경에서도 그대로 테스트할 수 있다.
import { bounds, frameBounds, clone, cloneWithNewIds, createNode, createComponent, childLists, uid } from './model.js';
import { resolvePoints } from './render.js';

const R = (v) => Math.round(v * 10) / 10;

export function parentId(idx, id) {
  const p = idx.parentOf(id);
  return p === idx.doc ? 'doc' : p.id;
}
export function siblings(idx, id) {
  const e = idx.entry(id);
  return e.parent[e.key];
}
export function indexOf(idx, id) {
  return siblings(idx, id).indexOf(idx.get(id));
}

// 선택 안에 조상까지 함께 들어 있으면 조상만 남긴다
export function topLevel(idx, ids) {
  const set = new Set(ids);
  return ids.filter((id) => idx.get(id) && !idx.ancestors(id).some((g) => set.has(g.id)));
}

// 그룹 · 프레임 원점 (프레임 좌표계에서 그 부모의 0,0 위치)
export function originOf(idx, parent) {
  if (!parent || parent.kind || parent === 'doc') return { x: 0, y: 0 };
  const o = idx.offsetOf(parent.id);
  return { x: o.x + (parent.x || 0), y: o.y + (parent.y || 0) };
}

export function unionBox(list) {
  if (!list.length) return null;
  const x0 = Math.min(...list.map((b) => b.x)), y0 = Math.min(...list.map((b) => b.y));
  const x1 = Math.max(...list.map((b) => b.x + b.w)), y1 = Math.max(...list.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function selectionBox(idx, ids) {
  return unionBox(topLevel(idx, ids).map((id) => frameBounds(idx.get(id), idx)));
}

function walk(nodes, fn) {
  for (const n of nodes || []) { fn(n); if (n.type === 'group') walk(n.children, fn); }
}

// ---------- 이동 ----------
export function opsMove(idx, ids, dx, dy, starts) {
  const ops = [];
  for (const id of topLevel(idx, ids)) {
    const n = idx.get(id);
    const s = starts ? starts[id] : { x: n.x || 0, y: n.y || 0 };
    ops.push({ op: 'set', id, key: 'x', value: R(s.x + dx) }, { op: 'set', id, key: 'y', value: R(s.y + dy) });
  }
  return ops;
}

// 연결선 끝이 붙은 노드가 움직였을 때 저장된 점도 실제 위치로 맞춘다
export function opsSyncConnectors(idx, container) {
  const ops = [];
  walk(container.nodes, (n) => {
    if (n.type !== 'connector' || !((n.from && n.from.node) || (n.to && n.to.node))) return;
    const pts = resolvePoints(n, { idx }).map((p) => [R(p[0]), R(p[1])]);
    if (JSON.stringify(pts) !== JSON.stringify(n.pts)) ops.push({ op: 'set', id: n.id, key: 'pts', value: pts });
  });
  return ops;
}

// ---------- 삭제 ----------
export function opsDelete(idx, ids) {
  const top = topLevel(idx, ids);
  const gone = new Set();
  for (const id of top) { gone.add(id); walk([idx.get(id)], (n) => gone.add(n.id)); }
  const ops = [];
  // 지워지는 노드를 가리키던 연결선은 그 자리에 고정
  const containers = new Set(top.map((id) => idx.containerOf(id)).filter(Boolean));
  for (const c of containers) walk(c.nodes, (n) => {
    if (n.type !== 'connector' || gone.has(n.id)) return;
    for (const end of ['from', 'to']) if (n[end] && gone.has(n[end].node)) ops.push({ op: 'set', id: n.id, key: end });
  });
  const sorted = top.map((id) => ({ id, d: idx.ancestors(id).length, i: indexOf(idx, id) })).sort((a, b) => b.d - a.d || b.i - a.i);
  for (const s of sorted) ops.push({ op: 'remove', id: s.id });
  return ops;
}

// ---------- 그룹 ----------
export function opsGroup(idx, ids, name = '그룹') {
  const top = topLevel(idx, ids);
  if (top.length < 1) return null;
  const pid = parentId(idx, top[0]);
  if (top.some((id) => parentId(idx, id) !== pid)) return null;
  const items = top.map((id) => ({ id, i: indexOf(idx, id), n: idx.get(id) })).sort((a, b) => a.i - b.i);
  const b = unionBox(items.map((it) => bounds(it.n, idx)));
  const gx = R(b.x), gy = R(b.y);
  const children = items.map((it) => { const c = clone(it.n); c.x = R((c.x || 0) - gx); c.y = R((c.y || 0) - gy); return c; });
  const g = createNode('group', { name, x: gx, y: gy, children });
  const ops = [];
  for (const it of items.slice().reverse()) ops.push({ op: 'remove', id: it.id });
  ops.push({ op: 'insert', parent: pid, index: items[items.length - 1].i - (items.length - 1), item: g });
  return { ops, id: g.id };
}

export function opsUngroup(idx, gid) {
  const g = idx.get(gid);
  if (!g || g.type !== 'group') return null;
  const pid = parentId(idx, gid), at = indexOf(idx, gid);
  const ops = [{ op: 'remove', id: gid }];
  const ids = [];
  g.children.forEach((c, k) => {
    const n = clone(c); n.x = R((n.x || 0) + (g.x || 0)); n.y = R((n.y || 0) + (g.y || 0));
    ops.push({ op: 'insert', parent: pid, index: at + k, item: n });
    ids.push(n.id);
  });
  return { ops, ids };
}

// ---------- 앞뒤 순서 ----------
export function opsZ(idx, ids, dir) {
  const top = topLevel(idx, ids);
  if (!top.length) return [];
  const pid = parentId(idx, top[0]);
  const ok = top.filter((id) => parentId(idx, id) === pid);
  const arr = siblings(idx, ok[0]).map((n) => n.id);
  const sel = new Set(ok);
  const ops = [];
  const mv = (id, to) => {
    const from = arr.indexOf(id);
    if (from === to) return;
    arr.splice(from, 1); arr.splice(to, 0, id);
    ops.push({ op: 'move', id, parent: pid, index: to });
  };
  const byIdx = ok.slice().sort((a, b) => arr.indexOf(a) - arr.indexOf(b));
  if (dir === 'front') for (const id of byIdx) mv(id, arr.length - 1);
  else if (dir === 'back') for (const id of byIdx.slice().reverse()) mv(id, 0);
  else if (dir === 'forward') {
    for (const id of byIdx.slice().reverse()) { const i = arr.indexOf(id); if (i < arr.length - 1 && !sel.has(arr[i + 1])) mv(id, i + 1); }
  } else if (dir === 'backward') {
    for (const id of byIdx) { const i = arr.indexOf(id); if (i > 0 && !sel.has(arr[i - 1])) mv(id, i - 1); }
  }
  return ops;
}

// ---------- 정렬 · 간격 ----------
// ref: 하나만 골랐을 때 맞출 기준 상자 (프레임 좌표)
export function opsAlign(idx, ids, mode, ref) {
  const top = topLevel(idx, ids);
  const boxes = top.map((id) => ({ id, b: frameBounds(idx.get(id), idx) }));
  const t = top.length > 1 ? unionBox(boxes.map((x) => x.b)) : ref;
  if (!t) return [];
  const ops = [];
  for (const { id, b } of boxes) {
    const n = idx.get(id);
    let dx = 0, dy = 0;
    if (mode === 'left') dx = t.x - b.x;
    if (mode === 'hcenter') dx = t.x + t.w / 2 - (b.x + b.w / 2);
    if (mode === 'right') dx = t.x + t.w - (b.x + b.w);
    if (mode === 'top') dy = t.y - b.y;
    if (mode === 'vcenter') dy = t.y + t.h / 2 - (b.y + b.h / 2);
    if (mode === 'bottom') dy = t.y + t.h - (b.y + b.h);
    if (dx) ops.push({ op: 'set', id, key: 'x', value: R((n.x || 0) + dx) });
    if (dy) ops.push({ op: 'set', id, key: 'y', value: R((n.y || 0) + dy) });
  }
  return ops;
}

export function opsDistribute(idx, ids, axis) {
  const top = topLevel(idx, ids);
  if (top.length < 3) return [];
  const P = axis === 'h' ? 'x' : 'y', S = axis === 'h' ? 'w' : 'h';
  const items = top.map((id) => ({ id, b: frameBounds(idx.get(id), idx) })).sort((a, b) => a.b[P] - b.b[P]);
  const first = items[0].b, last = items[items.length - 1].b;
  const span = last[P] + last[S] - first[P];
  const gap = (span - items.reduce((a, it) => a + it.b[S], 0)) / (items.length - 1);
  const ops = [];
  let cur = first[P];
  for (const it of items) {
    const d = cur - it.b[P];
    if (Math.abs(d) > .05) ops.push({ op: 'set', id: it.id, key: P, value: R((idx.get(it.id)[P] || 0) + d) });
    cur += it.b[S] + gap;
  }
  return ops;
}

// ---------- 크기 조절 (여러 개 · 그룹은 비율대로) ----------
function scaleInto(n, sx, sy, ops, setRoot) {
  // setRoot: 루트 노드의 새 x,y,w,h를 이미 정했을 때
  if (n.type === 'group') {
    for (const c of n.children) {
      ops.push({ op: 'set', id: c.id, key: 'x', value: R((c.x || 0) * sx) }, { op: 'set', id: c.id, key: 'y', value: R((c.y || 0) * sy) });
      scaleInto(c, sx, sy, ops, false);
    }
    return;
  }
  if (n.type === 'connector') {
    ops.push({ op: 'set', id: n.id, key: 'pts', value: n.pts.map((p) => [R(p[0] * sx), R(p[1] * sy)]) });
    return;
  }
  if (n.type === 'description') return;
  if (!setRoot) {
    ops.push({ op: 'set', id: n.id, key: 'w', value: R(n.w * sx) }, { op: 'set', id: n.id, key: 'h', value: R(n.h * sy) });
    if (n.type === 'table') ops.push(...tableScaleOps(n, sx, sy));
  }
}

function tableScaleOps(n, sx, sy) {
  const ops = [];
  if (Math.abs(sx - 1) > 1e-3) ops.push({ op: 'set', id: n.id, key: 'cols', value: n.cols.map((w) => R(w * sx)) });
  if (Math.abs(sy - 1) > 1e-3) n.rows.forEach((r, i) => ops.push({ op: 'set', id: n.id, key: 'rows.' + i + '.h', value: R(Math.max(8, r.h * sy)) }));
  return ops;
}

export function opsResize(idx, ids, from, to) {
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
  const ops = [];
  for (const id of topLevel(idx, ids)) {
    const n = idx.get(id);
    const b = frameBounds(n, idx);
    const o = idx.offsetOf(id);
    const nx = to.x + (b.x - from.x) * sx, ny = to.y + (b.y - from.y) * sy;
    if (n.type === 'group' || n.type === 'connector') {
      // 그룹 · 연결선: 원점을 옮기고 내용을 비율대로
      const lb = bounds(n, idx);
      const relX = lb.x - (n.x || 0), relY = lb.y - (n.y || 0);
      ops.push({ op: 'set', id, key: 'x', value: R(nx - o.x - relX * sx) }, { op: 'set', id, key: 'y', value: R(ny - o.y - relY * sy) });
      scaleInto(n, sx, sy, ops, true);
    } else if (n.rotation) {
      // 회전한 노드: 중심을 옮기고 크기는 축에 맞춰 비율 적용 (90° 가까우면 가로세로를 바꿔서)
      const turned = Math.abs(Math.sin(n.rotation * Math.PI / 180)) > .7;
      const kx = turned ? sy : sx, ky = turned ? sx : sy;
      const cx = to.x + (b.x + b.w / 2 - from.x) * sx, cy = to.y + (b.y + b.h / 2 - from.y) * sy;
      const w = Math.max(2, n.w * kx), h = Math.max(2, n.h * ky);
      ops.push({ op: 'set', id, key: 'x', value: R(cx - w / 2 - o.x) }, { op: 'set', id, key: 'y', value: R(cy - h / 2 - o.y) },
        { op: 'set', id, key: 'w', value: R(w) }, { op: 'set', id, key: 'h', value: R(h) });
    } else if (n.type === 'description') {
      ops.push({ op: 'set', id, key: 'x', value: R(nx + (b.w * sx - b.w) / 2 - o.x) }, { op: 'set', id, key: 'y', value: R(ny + (b.h * sy - b.h) / 2 - o.y) });
    } else {
      const w = Math.max(2, b.w * sx), h = Math.max(2, b.h * sy);
      ops.push({ op: 'set', id, key: 'x', value: R(nx - o.x) }, { op: 'set', id, key: 'y', value: R(ny - o.y) },
        { op: 'set', id, key: 'w', value: R(w) }, { op: 'set', id, key: 'h', value: R(h) });
      if (n.type === 'table') ops.push(...tableScaleOps(n, w / n.w, h / n.h));
    }
  }
  return ops;
}

// ---------- 복사 · 붙여넣기 ----------
export function collectRefs(nodes, doc, assets = {}, comps = new Map()) {
  const runsAssets = (runs) => (runs || []).forEach((r) => { if (r.img && doc.assets[r.img]) assets[r.img] = doc.assets[r.img]; });
  const visit = (n) => {
    if (n.type === 'image' && n.asset && doc.assets[n.asset]) assets[n.asset] = doc.assets[n.asset];
    runsAssets(n.runs);
    if (n.type === 'table') n.rows.forEach((r) => r.cells.forEach((c) => c && runsAssets(c.runs)));
    if (n.overrides) Object.values(n.overrides).forEach((o) => { runsAssets(o.runs); if (o.asset && doc.assets[o.asset]) assets[o.asset] = doc.assets[o.asset]; });
    if (n.type === 'instance' && !comps.has(n.component)) {
      const c = doc.components.find((k) => k.id === n.component);
      if (c) { comps.set(c.id, c); walk(c.nodes, visit); }
    }
  };
  walk(nodes, visit);
  return { assets, components: [...comps.values()] };
}

export function copyPayload(idx, ids) {
  const top = topLevel(idx, ids);
  const nodes = top.map((id) => {
    const n = clone(idx.get(id));
    const o = idx.offsetOf(id);
    n.x = R((n.x || 0) + o.x); n.y = R((n.y || 0) + o.y);
    return n;
  });
  const refs = collectRefs(nodes, idx.doc);
  return { kind: 'tnspec-clip', v: 1, doc: idx.doc.id, nodes, assets: clone(refs.assets), components: clone(refs.components) };
}

// parent: 프레임 · 그룹 · 컴포넌트 id. dx/dy: 붙여넣는 위치 보정
export function opsPaste(idx, payload, parent, dx = 0, dy = 0) {
  const ops = [];
  const p = idx.get(parent);
  const org = originOf(idx, p);
  for (const [aid, a] of Object.entries(payload.assets || {})) if (!idx.doc.assets[aid]) ops.push({ op: 'set', id: 'doc', key: 'assets.' + aid, value: a });
  // 다른 문서에서 온 컴포넌트는 함께 가져온다 (같은 id가 있으면 이 문서의 것을 쓴다)
  for (const c of payload.components || []) if (!idx.get(c.id)) ops.push({ op: 'insert', parent: 'doc', index: null, item: c });
  const ids = [];
  for (const n of payload.nodes) {
    const c = cloneWithNewIds(n);
    c.x = R(c.x + dx - org.x); c.y = R(c.y + dy - org.y);
    if (c.type === 'connector') for (const end of ['from', 'to']) if (c[end] && c[end].node && !idx.get(c[end].node) && !payload.nodes.some((k) => k.id === c[end].node)) delete c[end];
    ops.push({ op: 'insert', parent, index: null, item: c });
    ids.push(c.id);
  }
  return { ops, ids };
}

// ---------- 컴포넌트 ----------
export function opsCreateComponent(idx, ids, name) {
  const top = topLevel(idx, ids);
  if (!top.length) return null;
  const pid = parentId(idx, top[0]);
  if (top.some((id) => parentId(idx, id) !== pid)) return null;
  const items = top.map((id) => ({ id, i: indexOf(idx, id), n: idx.get(id) })).sort((a, b) => a.i - b.i);
  const b = unionBox(items.map((it) => bounds(it.n, idx)));
  const bx = R(b.x), by = R(b.y), w = Math.max(1, Math.round(b.w)), h = Math.max(1, Math.round(b.h));
  const nodes = items.map((it) => { const c = cloneWithNewIds(it.n); c.x = R((c.x || 0) - bx); c.y = R((c.y || 0) - by); return c; });
  const comp = createComponent(name || (items.length === 1 ? items[0].n.name : '컴포넌트'), w, h, nodes);
  const inst = createNode('instance', { name: comp.name, x: bx, y: by, w, h, component: comp.id, overrides: {} });
  const ops = [{ op: 'insert', parent: 'doc', index: null, item: comp }];
  for (const it of items.slice().reverse()) ops.push({ op: 'remove', id: it.id });
  ops.push({ op: 'insert', parent: pid, index: items[items.length - 1].i - (items.length - 1), item: inst });
  return { ops, componentId: comp.id, instanceId: inst.id };
}

function applyOverrides(n, ov) {
  const o = ov[n.id];
  if (o) Object.assign(n, clone(o));
  if (n.type === 'instance') n.overrides = Object.assign({}, n.overrides, clone(ov));
  for (const l of childLists(n)) for (const c of l) applyOverrides(c, ov);
}
function scaleTree(n, sx, sy) {
  n.x = R((n.x || 0) * sx); n.y = R((n.y || 0) * sy);
  if (n.type === 'group') n.children.forEach((c) => scaleTree(c, sx, sy));
  else if (n.type === 'connector') n.pts = n.pts.map((p) => [R(p[0] * sx), R(p[1] * sy)]);
  else if (n.type !== 'description') { n.w = R(n.w * sx); n.h = R(n.h * sy); }
}

export function opsDetach(idx, instId) {
  const inst = idx.get(instId);
  const comp = inst && idx.doc.components.find((c) => c.id === inst.component);
  if (!comp) return null;
  const sx = inst.w / comp.w, sy = inst.h / comp.h;
  const children = comp.nodes.map((n) => {
    const c = clone(n);
    applyOverrides(c, inst.overrides || {});
    const k = cloneWithNewIds(c);
    if (Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3) scaleTree(k, sx, sy);
    return k;
  });
  const g = createNode('group', { name: inst.name || comp.name, x: inst.x, y: inst.y, children });
  return { ops: [{ op: 'remove', id: instId }, { op: 'insert', parent: parentId(idx, instId), index: indexOf(idx, instId), item: g }], id: g.id };
}

export function instancesOf(doc, compId) {
  const out = [];
  const scan = (nodes) => walk(nodes, (n) => { if (n.type === 'instance' && n.component === compId) out.push(n); });
  for (const p of doc.pages) for (const f of p.frames) scan(f.nodes);
  for (const c of doc.components) scan(c.nodes);
  return out;
}

// 레이어 패널에서 다른 그룹 · 프레임으로 옮길 때: 화면 위치가 그대로 유지되도록 좌표를 보정
export function opsReparent(idx, id, newParent, index) {
  const n = idx.get(id);
  const np = newParent === 'doc' ? idx.doc : idx.get(newParent);
  const ops = [{ op: 'move', id, parent: newParent, index }];
  if (n.type && np && (np.type === 'group' || np.kind === 'frame' || np.kind === 'component')) {
    const sameContainer = idx.containerOf(id) === (np.type === 'group' ? idx.containerOf(np.id) : np);
    if (sameContainer) {
      const o = idx.offsetOf(id);
      const fx = (n.x || 0) + o.x, fy = (n.y || 0) + o.y;
      const org = originOf(idx, np);
      if (Math.abs(fx - org.x - (n.x || 0)) > .01) ops.push({ op: 'set', id, key: 'x', value: R(fx - org.x) });
      if (Math.abs(fy - org.y - (n.y || 0)) > .01) ops.push({ op: 'set', id, key: 'y', value: R(fy - org.y) });
    }
  }
  return ops;
}

// ---------- 표 구조 편집 ----------
export function opsTable(n, action, r, c) {
  const cols = n.cols.slice();
  const rows = clone(n.rows);
  const blank = (src) => { const k = { runs: [{ t: '' }] }; if (src) ['bg', 'align', 'bold', 'color', 'size'].forEach((p) => { if (src[p] != null) k[p] = src[p]; }); return k; };
  if (action === 'rowAbove' || action === 'rowBelow') {
    const ref = rows[r] || rows[rows.length - 1];
    const at = action === 'rowAbove' ? r : r + 1;
    rows.splice(at, 0, { h: Math.max(18, Math.min(ref.h, 30)), cells: ref.cells.map((k) => blank(r === 0 && action === 'rowBelow' ? null : k && !k.bold ? k : null)) });
  } else if (action === 'rowDelete') {
    if (rows.length <= 1) return [];
    rows.splice(r, 1);
  } else if (action === 'colLeft' || action === 'colRight') {
    const at = action === 'colLeft' ? c : c + 1;
    const w = Math.max(40, Math.round(cols[c] / 2));
    cols.splice(at, 0, w);
    rows.forEach((row) => row.cells.splice(at, 0, blank(row.cells[c])));
  } else if (action === 'colDelete') {
    if (cols.length <= 1) return [];
    cols.splice(c, 1);
    rows.forEach((row) => row.cells.splice(c, 1));
  }
  // 병합된 칸이 표 밖으로 나가거나 가려진 칸이 주인을 잃지 않게 정리
  rows.forEach((row, ri) => row.cells.forEach((k, ci) => {
    if (k && k.span) k.span = [Math.min(k.span[0] || 1, cols.length - ci), Math.min(k.span[1] || 1, rows.length - ri)];
  }));
  const covered = new Set();
  rows.forEach((row, ri) => row.cells.forEach((k, ci) => {
    if (k && k.span) for (let y = 0; y < k.span[1]; y++) for (let x = 0; x < k.span[0]; x++) if (x || y) covered.add((ri + y) + ':' + (ci + x));
  }));
  rows.forEach((row, ri) => row.cells.forEach((k, ci) => {
    const key = ri + ':' + ci;
    if (!k && !covered.has(key)) row.cells[ci] = { runs: [{ t: '' }] };
    if (k && covered.has(key)) row.cells[ci] = null;
  }));
  return [
    { op: 'set', id: n.id, key: 'cols', value: cols },
    { op: 'set', id: n.id, key: 'rows', value: rows },
    { op: 'set', id: n.id, key: 'w', value: R(cols.reduce((a, b) => a + b, 0)) },
    { op: 'set', id: n.id, key: 'h', value: R(rows.reduce((a, b) => a + b.h, 0)) },
  ];
}

export function nextDescriptionNumber(container) {
  let max = 0;
  walk(container.nodes, (n) => { if (n.type === 'description') max = Math.max(max, +n.num || 0); });
  return max + 1;
}

// ---------- 크기 같게 (가장 큰 것 기준) ----------
export function opsSameSize(idx, ids, mode) {
  const top = topLevel(idx, ids).map((id) => idx.get(id)).filter((n) => n.w != null && n.type !== 'description');
  if (top.length < 2) return [];
  const W = Math.max(...top.map((n) => n.w)), H = Math.max(...top.map((n) => n.h));
  const ops = [];
  for (const n of top) {
    if (mode !== 'h' && n.w !== W) ops.push({ op: 'set', id: n.id, key: 'w', value: W });
    if (mode !== 'w' && n.h !== H) ops.push({ op: 'set', id: n.id, key: 'h', value: H });
    if (n.type === 'table' && mode !== 'h' && n.w !== W) ops.push({ op: 'set', id: n.id, key: 'cols', value: n.cols.map((c) => R(c * W / n.w)) });
  }
  return ops;
}

// ---------- 표: 병합 · 분할 · 채우기 · 균등 ----------
function tableOps(n, cols, rows) {
  return [
    { op: 'set', id: n.id, key: 'cols', value: cols },
    { op: 'set', id: n.id, key: 'rows', value: rows },
    { op: 'set', id: n.id, key: 'w', value: R(cols.reduce((a, b) => a + b, 0)) },
    { op: 'set', id: n.id, key: 'h', value: R(rows.reduce((a, b) => a + b.h, 0)) },
  ];
}
// 병합으로 가려진 칸의 주인 찾기
export function cellOwner(n, r, c) {
  for (let y = r; y >= 0; y--) for (let x = c; x >= 0; x--) {
    const k = n.rows[y] && n.rows[y].cells[x];
    if (!k) continue;
    const sp = k.span || [1, 1];
    if (y + sp[1] > r && x + sp[0] > c) return { r: y, c: x };
  }
  return { r, c };
}
// 고른 범위를 걸쳐 있는 병합 칸까지 넓힌다
export function normalizeRange(n, rg) {
  let r0 = Math.min(rg.r0, rg.r1), c0 = Math.min(rg.c0, rg.c1), r1 = Math.max(rg.r0, rg.r1), c1 = Math.max(rg.c0, rg.c1);
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < n.rows.length; y++) for (let x = 0; x < n.cols.length; x++) {
      const k = n.rows[y].cells[x];
      if (!k) continue;
      const sp = k.span || [1, 1];
      const y2 = y + sp[1] - 1, x2 = x + sp[0] - 1;
      const hit = y <= r1 && y2 >= r0 && x <= c1 && x2 >= c0;
      if (hit && (y < r0 || x < c0 || y2 > r1 || x2 > c1)) { r0 = Math.min(r0, y); c0 = Math.min(c0, x); r1 = Math.max(r1, y2); c1 = Math.max(c1, x2); changed = true; }
    }
  }
  return { r0, c0, r1, c1 };
}
export function opsTableMerge(n, rg) {
  const { r0, c0, r1, c1 } = normalizeRange(n, rg);
  if (r0 === r1 && c0 === c1) return [];
  const rows = clone(n.rows);
  const texts = [];
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) {
    const k = rows[y].cells[x];
    if (k && k.runs && k.runs.some((r) => r.img || (r.t && r.t.trim()))) texts.push(k.runs);
    if (y !== r0 || x !== c0) rows[y].cells[x] = null;
  }
  const head = rows[r0].cells[c0] || { runs: [{ t: '' }] };
  head.runs = texts.length ? texts.reduce((a, b, i) => (i ? a.concat([{ t: '\n' }], b) : b.slice()), []) : [{ t: '' }];
  head.span = [c1 - c0 + 1, r1 - r0 + 1];
  rows[r0].cells[c0] = head;
  return tableOps(n, n.cols.slice(), rows);
}
export function opsTableSplit(n, r, c) {
  const o = cellOwner(n, r, c);
  const k = n.rows[o.r].cells[o.c];
  if (!k || !k.span) return [];
  const rows = clone(n.rows);
  const [sw, sh] = k.span;
  delete rows[o.r].cells[o.c].span;
  for (let y = o.r; y < o.r + sh; y++) for (let x = o.c; x < o.c + sw; x++) if (y !== o.r || x !== o.c) rows[y].cells[x] = k.bg ? { runs: [{ t: '' }], bg: k.bg } : { runs: [{ t: '' }] };
  return tableOps(n, n.cols.slice(), rows);
}
// 엑셀 · 시트에서 복사한 글 (탭 · 줄바꿈, 따옴표 처리)
export function parseTSV(text) {
  const rows = [[]];
  let cur = '', q = false;
  text = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"' && cur === '') { q = true; continue; }
    if (ch === '\t') { rows[rows.length - 1].push(cur); cur = ''; continue; }
    if (ch === '\n') { rows[rows.length - 1].push(cur); rows.push([]); cur = ''; continue; }
    cur += ch;
  }
  rows[rows.length - 1].push(cur);
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.concat(Array(w - r.length).fill('')));
}
export const looksTabular = (text) => /\t/.test(text);
// 범위 왼쪽 위부터 채우기 (모자라면 행 · 열을 늘린다)
export function opsTableFill(n, r0, c0, grid) {
  const cols = n.cols.slice(), rows = clone(n.rows);
  const needC = c0 + grid[0].length, needR = r0 + grid.length;
  while (cols.length < needC) { cols.push(cols[cols.length - 1] || 80); rows.forEach((row) => row.cells.push({ runs: [{ t: '' }] })); }
  while (rows.length < needR) rows.push({ h: Math.min(30, rows[rows.length - 1].h), cells: cols.map(() => ({ runs: [{ t: '' }] })) });
  grid.forEach((line, y) => line.forEach((v, x) => {
    const o = cellOwner({ rows, cols }, r0 + y, c0 + x);
    if (o.r !== r0 + y || o.c !== c0 + x) return;   // 병합으로 가려진 칸은 건너뜀
    rows[r0 + y].cells[c0 + x] = Object.assign({}, rows[r0 + y].cells[c0 + x], { runs: [{ t: v }] });
  }));
  return tableOps(n, cols, rows);
}
export function tableFromGrid(grid, opts = {}) {
  const nc = grid[0].length;
  const total = Math.min(opts.maxW || 700, Math.max(240, nc * 110));
  const cols = Array(nc).fill(R(total / nc));
  const rows = grid.map((line, y) => ({ h: 24, cells: line.map((v) => Object.assign({ runs: [{ t: v }] }, y === 0 && opts.header !== false ? { bold: true, align: 'center', bg: '#d9d9d9' } : {})) }));
  return { cols, rows, style: { border: 'grid', borderColor: '#bfbfbf', size: 9, color: '#222222', pad: 5 }, w: R(total), h: rows.length * 24 };
}
export function opsTableEqualize(n, what, rg) {
  const cols = n.cols.slice(), rows = clone(n.rows);
  if (what === 'cols') {
    const a = rg ? Math.min(rg.c0, rg.c1) : 0, b = rg ? Math.max(rg.c0, rg.c1) : cols.length - 1;
    if (b <= a) return [];
    const avg = R(cols.slice(a, b + 1).reduce((x, y) => x + y, 0) / (b - a + 1));
    for (let i = a; i <= b; i++) cols[i] = avg;
  } else {
    const a = rg ? Math.min(rg.r0, rg.r1) : 0, b = rg ? Math.max(rg.r0, rg.r1) : rows.length - 1;
    if (b <= a) return [];
    const avg = R(rows.slice(a, b + 1).reduce((x, y) => x + y.h, 0) / (b - a + 1));
    for (let i = a; i <= b; i++) rows[i].h = avg;
  }
  return tableOps(n, cols, rows);
}
// 범위 안 모든 칸에 같은 속성
export function opsCells(n, rg, key, value) {
  const { r0, c0, r1, c1 } = normalizeRange(n, rg);
  const ops = [];
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) if (n.rows[y].cells[x]) ops.push({ op: 'set', id: n.id, key: `rows.${y}.cells.${x}.${key}`, value });
  return ops;
}

// ---------- 서식 복사 · 붙여넣기 ----------
const FORMAT_KEYS = {
  text: ['style'], shape: ['fill', 'stroke', 'strokeWidth', 'dash', 'radius', 'gradient', 'fillOpacity', 'shadow', 'style'],
  connector: ['stroke', 'width', 'dash', 'route', 'startCap', 'endCap', 'capSize'], image: ['radius', 'mask', 'stroke', 'strokeWidth', 'shadow', 'fit'],
  table: ['style'], description: ['color'], hotspot: [],
};
export function extractFormat(n) {
  const f = { type: n.type, props: {} };
  for (const k of FORMAT_KEYS[n.type] || []) f.props[k] = clone(n[k]);
  f.props.opacity = n.opacity;
  // 글 상자 ↔ 도형 라벨 사이에서도 글자 서식은 옮길 수 있게
  if (n.style) f.textStyle = clone(n.style);
  return f;
}
export function opsApplyFormat(idx, ids, f) {
  const ops = [];
  for (const id of topLevel(idx, ids)) {
    const n = idx.get(id);
    if (n.type === f.type) {
      for (const [k, v] of Object.entries(f.props)) ops.push({ op: 'set', id, key: k, value: clone(v) });
    } else if (f.textStyle && (n.type === 'text' || n.type === 'shape')) {
      for (const k of ['size', 'color', 'bold', 'italic', 'underline', 'font', 'lineHeight', 'letter', 'align']) ops.push({ op: 'set', id, key: 'style.' + k, value: f.textStyle[k] });
    }
  }
  return ops;
}

// ---------- 찾기 · 바꾸기 ----------
// 찾을 곳: 글 · 도형 라벨 · 표 칸 · Description 제목/내용 · 인스턴스 오버라이드
const reEscape = (q) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function findMatches(doc, query, opts = {}) {
  if (!query) return [];
  const re = new RegExp(reEscape(query), opts.caseSensitive ? 'g' : 'gi');
  const out = [];
  const scanText = (text, where) => {
    if (typeof text !== 'string') return;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) { out.push(Object.assign({ index: m.index, text }, where)); if (!m[0].length) re.lastIndex++; }
  };
  const scanRuns = (runs, base, path) => (runs || []).forEach((r, ri) => scanText(r.t, Object.assign({}, base, { path: path + '.' + ri + '.t' })));
  const scanNode = (n, frame) => {
    const base = { id: n.id, frame: frame.id, frameName: frame.name, name: n.name };
    if (n.runs) scanRuns(n.runs, base, 'runs');
    if (n.type === 'table') n.rows.forEach((row, y) => row.cells.forEach((c, x) => c && scanRuns(c.runs, Object.assign({}, base, { cell: [y, x] }), `rows.${y}.cells.${x}.runs`)));
    if (n.type === 'description') for (const k of ['title', 'body']) scanText(n[k], Object.assign({}, base, { path: k }));
    if (n.type === 'instance') for (const [mid, o] of Object.entries(n.overrides || {})) if (o.runs) scanRuns(o.runs, base, `overrides.${mid}.runs`);
    if (n.type === 'group') n.children.forEach((c) => scanNode(c, frame));
  };
  for (const p of doc.pages) for (const f of p.frames) f.nodes.forEach((n) => scanNode(n, f));
  // 컴포넌트 원본 속 글자도 (고치면 모든 인스턴스에 반영)
  for (const c of doc.components) c.nodes.forEach((n) => scanNode(n, { id: c.id, name: '◆ ' + c.name }));
  for (const m of out) if (doc.components.some((c) => c.id === m.frame)) m.component = true;
  return out;
}
// 찾은 곳들을 한 번에 바꾸는 연산 (같은 글 조각은 한 번만 고친다)
export function opsReplace(idx, matches, query, repl, opts = {}) {
  const re = new RegExp(reEscape(query), opts.caseSensitive ? 'g' : 'gi');
  const done = new Set(), ops = [];
  for (const m of matches) {
    const k = m.id + '|' + m.path;
    if (done.has(k)) continue;
    done.add(k);
    const n = idx.get(m.id);
    if (!n) continue;
    let cur = n;
    for (const p of m.path.split('.')) cur = cur == null ? cur : cur[/^\d+$/.test(p) ? +p : p];
    if (typeof cur !== 'string') continue;
    const next = cur.replace(re, () => repl);
    if (next !== cur) ops.push({ op: 'set', id: m.id, key: m.path, value: next });
  }
  return ops;
}

// ---------- 단락 (목록 · 수준) ----------
export function paragraphCount(runs) {
  return (runs || []).reduce((a, r) => a + (r.t ? (r.t.match(/\n/g) || []).length : 0), 1);
}
const cleanParas = (paras) => (paras.some((p) => Object.keys(p).length) ? paras : undefined);
// 노드 전체 단락에 목록 적용 / 해제 (편집 중이 아닐 때)
export function opsListAll(n, list) {
  const cnt = paragraphCount(n.runs);
  const cur = n.paras || [];
  const allOn = cur.length >= cnt && cur.slice(0, cnt).every((p) => p && p.list === list);
  const paras = [];
  for (let i = 0; i < cnt; i++) {
    const p = Object.assign({}, cur[i] || {});
    if (allOn) delete p.list; else { p.list = list; delete p.cont; }
    paras.push(p);
  }
  return [{ op: 'set', id: n.id, key: 'paras', value: cleanParas(paras) }];
}
export function opsIndentAll(n, d) {
  const cnt = paragraphCount(n.runs);
  const cur = n.paras || [];
  const paras = [];
  for (let i = 0; i < cnt; i++) { const p = Object.assign({}, cur[i] || {}); p.lv = Math.max(0, Math.min(4, (p.lv || 0) + d)); if (!p.lv) delete p.lv; paras.push(p); }
  return [{ op: 'set', id: n.id, key: 'paras', value: cleanParas(paras) }];
}

export { walk, R, uid };
