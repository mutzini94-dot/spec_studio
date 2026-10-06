// node --test spec-studio/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../js/model.js';
import * as O from '../js/ops.js';
import { DOC_TEMPLATES, makeFrame } from '../js/templates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const roundtrip = (doc) => M.load(M.serialize(doc));
const snap = (doc) => { const d = M.clone(doc); delete d.rev; return d; };

function setup(tpl = 'screen') {
  const doc = DOC_TEMPLATES.find((t) => t.id === tpl).build();
  const idx = new M.DocIndex(doc);
  const hist = new M.History(idx);
  return { doc, idx, hist };
}
const screenFrame = (doc) => doc.pages.flatMap((p) => p.frames).find((f) => f.layout === 'screen' && f.nodes.length);

test('모든 템플릿: 검증 통과 + 저장 → 다시 열기 동일', () => {
  for (const t of DOC_TEMPLATES) {
    const doc = t.build();
    assert.deepEqual(M.validate(doc), [], t.name);
    assert.deepEqual(roundtrip(doc), doc, t.name);
  }
});

test('연산 → 되돌리기 전부 → 원래 문서, 다시 실행 → 최종 문서', () => {
  const { doc, idx, hist } = setup();
  const before = snap(doc);
  const f = screenFrame(doc);
  const t = M.createNode('text', { x: 10, y: 10, runs: [{ t: '안녕' }] });
  hist.commit([{ op: 'insert', parent: f.id, index: null, item: t }], '추가');
  hist.commit([{ op: 'set', id: t.id, key: 'style.size', value: 20 }, { op: 'set', id: t.id, key: 'runs', value: [{ t: '바뀜', b: true }] }], '편집');
  hist.commit([{ op: 'set', id: 'doc', key: 'meta.title', value: '새 제목' }], '제목');
  const g = O.opsGroup(idx, [t.id, f.nodes[0].id]);
  hist.commit(g.ops, '그룹');
  hist.commit(O.opsZ(idx, [g.id], 'back'), '맨 뒤');
  hist.commit(O.opsUngroup(idx, g.id).ops, '해제');
  hist.commit(O.opsDelete(idx, [t.id]), '삭제');
  const p2 = M.createPage('새 장', [makeFrame('screen', 'X')]);
  hist.commit([{ op: 'insert', parent: 'doc', index: 1, item: p2 }], '페이지');
  hist.commit([{ op: 'move', id: f.id, parent: p2.id, index: 0 }], '프레임 이동');
  const after = snap(doc);
  assert.deepEqual(M.validate(doc), []);
  while (hist.undo());
  assert.deepEqual(snap(doc), before);
  assert.deepEqual(M.validate(doc), []);
  while (hist.redo());
  assert.deepEqual(snap(doc), after);
  // 되돌리기 후 인덱스도 문서와 일치해야 한다
  const fresh = new M.DocIndex(doc);
  assert.deepEqual([...idx.map.keys()].sort(), [...fresh.map.keys()].sort());
});

test('드래그처럼 합쳐진 편집은 한 번에 되돌아간다', () => {
  const { doc, idx, hist } = setup();
  const n = screenFrame(doc).nodes[0];
  const x0 = n.x, y0 = n.y;
  for (let i = 1; i <= 50; i++) hist.commit(O.opsMove(idx, [n.id], i, i * 2, { [n.id]: { x: x0, y: y0 } }), '이동', 'drag1');
  assert.equal(hist.undoStack.length, 1);
  assert.equal(hist.undoStack[0].ops.length, 2);   // set x, set y 두 개로 압축
  assert.equal(n.x, x0 + 50);
  hist.undo();
  assert.equal(n.x, x0);
  assert.equal(n.y, y0);
  hist.redo();
  assert.equal(n.x, x0 + 50);
});

test('실패한 작업은 통째로 취소된다', () => {
  const { doc, hist } = setup();
  const before = snap(doc);
  assert.throws(() => hist.commit([{ op: 'set', id: 'doc', key: 'meta.title', value: 'x' }, { op: 'remove', id: 'nope' }]));
  assert.deepEqual(snap(doc), before);
  assert.equal(hist.undoStack.length, 0);
});

test('무작위 연산 300개 → 되돌리기 → 원래대로', () => {
  const { doc, idx, hist } = setup('standard');
  const before = snap(doc);
  let seed = 7;
  const rnd = (n) => { seed = (seed * 16807) % 2147483647; return seed % n; };
  const frames = () => idx.frames();
  for (let i = 0; i < 300; i++) {
    const f = frames()[rnd(frames().length)];
    const k = rnd(6);
    try {
      if (k === 0 || !f.nodes.length) hist.commit([{ op: 'insert', parent: f.id, index: rnd(f.nodes.length + 1), item: M.createNode(['text', 'shape', 'hotspot', 'description'][rnd(4)], { x: rnd(900), y: rnd(500) }) }]);
      else if (k === 1) hist.commit(O.opsDelete(idx, [f.nodes[rnd(f.nodes.length)].id]));
      else if (k === 2) hist.commit(O.opsMove(idx, [f.nodes[rnd(f.nodes.length)].id], rnd(40) - 20, rnd(40) - 20), 'm', rnd(2) ? 'merge' : null);
      else if (k === 3 && f.nodes.length >= 2) { const r = O.opsGroup(idx, [f.nodes[0].id, f.nodes[f.nodes.length - 1].id]); if (r) hist.commit(r.ops); }
      else if (k === 4) { const g = f.nodes.find((n) => n.type === 'group'); if (g) hist.commit(O.opsUngroup(idx, g.id).ops); }
      else hist.commit(O.opsZ(idx, [f.nodes[rnd(f.nodes.length)].id], ['front', 'back', 'forward', 'backward'][rnd(4)]));
    } catch (e) { assert.fail('연산 실패: ' + e.message); }
    if (i % 50 === 0) assert.deepEqual(M.validate(doc), []);
  }
  assert.deepEqual(roundtrip(doc), doc);
  while (hist.undo());
  assert.deepEqual(snap(doc), before);
});

test('그룹: 화면 위치 유지, 해제하면 원래 좌표', () => {
  const { doc, idx, hist } = setup();
  const f = screenFrame(doc);
  const a = f.nodes[0], b = f.nodes[1];
  const ba = M.frameBounds(a, idx), bb = M.frameBounds(b, idx);
  const g = O.opsGroup(idx, [a.id, b.id]);
  hist.commit(g.ops);
  assert.deepEqual(M.frameBounds(idx.get(a.id), idx), ba);
  assert.deepEqual(M.frameBounds(idx.get(b.id), idx), bb);
  hist.commit(O.opsMove(idx, [g.id], 10, 5));
  hist.commit(O.opsUngroup(idx, g.id).ops);
  assert.equal(idx.get(a.id).x, ba.x + 10);
  assert.equal(idx.get(a.id).y, ba.y + 5);
});

test('복사 → 붙여넣기: 새 id, 다른 문서로 컴포넌트 · 이미지 함께', () => {
  const A = setup();
  const f = screenFrame(A.doc);
  const inst = f.nodes.find((n) => n.type === 'instance');
  A.hist.commit([{ op: 'set', id: 'doc', key: 'assets.img1', value: { mime: 'image/png', data: 'data:image/png;base64,AA==', w: 1, h: 1 } }]);
  const img = M.createNode('image', { x: 5, y: 5, w: 10, h: 10, asset: 'img1' });
  A.hist.commit([{ op: 'insert', parent: f.id, index: null, item: img }]);
  const pl = JSON.parse(JSON.stringify(O.copyPayload(A.idx, [inst.id, img.id])));
  const B = setup('blank');
  B.doc.components = [];
  B.idx = new M.DocIndex(B.doc); B.hist = new M.History(B.idx);
  const target = B.idx.frames()[0];
  const r = O.opsPaste(B.idx, pl, target.id);
  B.hist.commit(r.ops);
  assert.equal(r.ids.length, 2);
  assert.ok(!r.ids.includes(inst.id));
  assert.ok(B.doc.assets.img1);
  assert.ok(B.doc.components.length >= 1);
  assert.deepEqual(M.validate(B.doc), []);
});

test('컴포넌트: 원본을 고치면 인스턴스가 같은 원본을 본다 · 분리하면 독립', () => {
  const { doc, idx, hist } = setup();
  const f = screenFrame(doc);
  const shp = M.createNode('shape', { x: 100, y: 100, w: 80, h: 30, runs: [{ t: '확인' }] });
  hist.commit([{ op: 'insert', parent: f.id, index: null, item: shp }]);
  const r = O.opsCreateComponent(idx, [shp.id], '테스트 버튼');
  hist.commit(r.ops);
  const comp = doc.components.find((c) => c.id === r.componentId);
  assert.equal(comp.w, 80);
  const inst = idx.get(r.instanceId);
  assert.equal(inst.x, 100);
  // 두 번째 인스턴스
  const r2 = O.opsPaste(idx, O.copyPayload(idx, [inst.id]), f.id, 0, 50);
  hist.commit(r2.ops);
  assert.equal(O.instancesOf(doc, comp.id).length, 2);
  // 원본 수정
  hist.commit([{ op: 'set', id: comp.nodes[0].id, key: 'fill', value: '#ff0000' }]);
  for (const i of O.instancesOf(doc, comp.id)) assert.equal(doc.components.find((c) => c.id === i.component).nodes[0].fill, '#ff0000');
  // 오버라이드 + 분리
  hist.commit([{ op: 'set', id: inst.id, key: `overrides.${comp.nodes[0].id}.runs`, value: [{ t: '취소' }] }, { op: 'set', id: inst.id, key: 'w', value: 160 }]);
  const d = O.opsDetach(idx, inst.id);
  hist.commit(d.ops);
  const g = idx.get(d.id);
  assert.equal(g.type, 'group');
  assert.equal(M.plainText(g.children[0].runs), '취소');
  assert.equal(g.children[0].w, 160);
  assert.equal(g.children[0].fill, '#ff0000');
  assert.deepEqual(M.validate(doc), []);
});

test('검증: 깨진 문서를 찾아낸다', () => {
  const { doc } = setup();
  const bad = M.clone(doc);
  const f = screenFrame(bad);
  f.nodes.push(M.clone(f.nodes[0]));                                // id 중복
  f.nodes.push(M.createNode('image', { asset: 'missing' }));         // 없는 이미지
  f.nodes.push({ id: 'x1', type: 'text', x: 'a', y: 0, w: 1, h: 1 }); // 숫자 아님
  const t = M.createNode('table', M.makeTable([10, 10], [10]));
  t.rows[0].cells.pop();                                            // 칸 수 불일치
  f.nodes.push(t);
  bad.components[0].nodes.push(M.createNode('instance', { component: bad.components[0].id })); // 자기 포함
  const errs = M.validate(bad);
  for (const word of ['id 중복', '이미지 자원 없음', '좌표가 숫자가 아님', '칸 수가', '자기 자신']) assert.ok(errs.some((e) => e.includes(word)), word + ' 를 못 찾음: ' + errs.join(' / '));
  assert.throws(() => M.load(JSON.stringify(bad)));
  assert.throws(() => M.load('{"schema":"other"}'));
});

test('표 구조 편집 · 크기 조절 · 정렬 · 간격', () => {
  const { doc, idx, hist } = setup('policy');
  const f = idx.frames().find((x) => x.layout === 'policy');
  const t = f.nodes[0];
  hist.commit(O.opsTable(t, 'colRight', 0, 1));
  assert.equal(t.cols.length, 4);
  assert.ok(t.rows.every((r) => r.cells.length === 4));
  hist.commit(O.opsTable(t, 'rowDelete', 3, 0));
  assert.deepEqual(M.validate(doc), []);
  let a = M.createNode('shape', { x: 0, y: 0, w: 10, h: 10 }), b = M.createNode('shape', { x: 50, y: 20, w: 10, h: 10 }), c = M.createNode('shape', { x: 70, y: 40, w: 10, h: 10 });
  hist.commit([a, b, c].map((n) => ({ op: 'insert', parent: f.id, index: null, item: n })));
  [a, b, c] = [a, b, c].map((n) => idx.get(n.id));   // insert는 복사본을 넣는다
  hist.commit(O.opsDistribute(idx, [a.id, b.id, c.id], 'h'));
  assert.equal(b.x, 35);
  hist.commit(O.opsAlign(idx, [a.id, b.id, c.id], 'bottom'));
  assert.ok([a, b, c].every((n) => n.y === 40));
  hist.commit(O.opsResize(idx, [a.id], { x: 0, y: 40, w: 10, h: 10 }, { x: 0, y: 40, w: 30, h: 20 }));
  assert.equal(a.w, 30); assert.equal(a.h, 20);
});

test('PDF에서 가져온 샘플 문서도 검증 통과 + 왕복 동일', { skip: !fs.existsSync(path.join(here, '../samples/chat-spec-v0.1.tnspec.json')) }, () => {
  const raw = fs.readFileSync(path.join(here, '../samples/chat-spec-v0.1.tnspec.json'), 'utf8');
  const doc = M.load(raw);
  assert.ok(doc.pages.length >= 2);
  assert.deepEqual(roundtrip(doc), doc);
  const idx = new M.DocIndex(doc);
  const hist = new M.History(idx);
  const before = snap(doc);
  const f = idx.frames().find((x) => x.layout === 'screen');
  hist.commit(O.opsMove(idx, f.nodes.slice(0, 5).map((n) => n.id), 3, 3));
  hist.commit(O.opsDelete(idx, [f.nodes[f.nodes.length - 1].id]));
  while (hist.undo());
  assert.deepEqual(snap(doc), before);
});
