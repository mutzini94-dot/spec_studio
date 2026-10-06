// PPT 기능 이식 테스트: node --test spec-studio/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../js/model.js';
import * as O from '../js/ops.js';
import { DOC_TEMPLATES } from '../js/templates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const snap = (doc) => { const d = M.clone(doc); delete d.rev; return d; };
function setup(tpl = 'policy') {
  const doc = DOC_TEMPLATES.find((t) => t.id === tpl).build();
  const idx = new M.DocIndex(doc);
  return { doc, idx, hist: new M.History(idx) };
}
const policyTable = (idx) => idx.frames().find((f) => f.layout === 'policy').nodes[0];

test('표: 병합 → 분할, 걸친 병합 칸까지 범위 넓히기', () => {
  const { doc, idx, hist } = setup();
  let t = policyTable(idx);
  hist.commit(O.opsTableMerge(t, { r0: 1, c0: 0, r1: 2, c1: 1 }));
  t = idx.get(t.id);
  assert.deepEqual(t.rows[1].cells[0].span, [2, 2]);
  assert.equal(t.rows[2].cells[1], null);
  assert.deepEqual(M.validate(doc), []);
  // 병합 칸 일부만 걸친 범위 → 병합 칸 전체로 넓어짐
  assert.deepEqual(O.normalizeRange(t, { r0: 2, c0: 1, r1: 3, c1: 2 }), { r0: 1, c0: 0, r1: 3, c1: 2 });
  assert.deepEqual(O.cellOwner(t, 2, 1), { r: 1, c: 0 });
  hist.commit(O.opsTableSplit(t, 2, 1));
  t = idx.get(t.id);
  assert.equal(t.rows[1].cells[0].span, undefined);
  assert.ok(t.rows[2].cells[1]);
  hist.undo(); hist.undo();
  assert.deepEqual(M.validate(doc), []);
});

test('엑셀 붙여넣기: 따옴표 · 줄바꿈 해석, 모자란 행 · 열은 늘린다', () => {
  assert.deepEqual(O.parseTSV('a\tb\n"c\nd"\t"e ""q"""\n'), [['a', 'b'], ['c\nd', 'e "q"']]);
  const { doc, idx, hist } = setup();
  const t = policyTable(idx);
  const rows0 = t.rows.length;
  hist.commit(O.opsTableFill(t, rows0 - 1, 2, [['x', 'y'], ['z', 'w']]));
  const t2 = idx.get(t.id);
  assert.equal(t2.cols.length, 4);
  assert.equal(t2.rows.length, rows0 + 1);
  assert.equal(M.plainText(t2.rows[rows0].cells[3].runs), 'w');
  assert.equal(t2.w, t2.cols.reduce((a, b) => a + b, 0));
  assert.deepEqual(M.validate(doc), []);
  const g = O.tableFromGrid([['이름', '값'], ['A', '1']]);
  assert.equal(g.rows[0].cells[0].bold, true);
  assert.equal(g.cols.length, 2);
});

test('표: 열 너비 · 행 높이 같게, 범위 칸 서식', () => {
  const { idx, hist } = setup();
  const t = policyTable(idx);
  const sum = t.cols.reduce((a, b) => a + b, 0);
  hist.commit(O.opsTableEqualize(t, 'cols'));
  const t2 = idx.get(t.id);
  assert.ok(t2.cols.every((c) => Math.abs(c - sum / 3) < .2));
  hist.commit(O.opsCells(t2, { r0: 1, c0: 0, r1: 2, c1: 2 }, 'bg', '#ff0000'));
  assert.equal(idx.get(t.id).rows[2].cells[2].bg, '#ff0000');
});

test('찾기 · 바꾸기: 글 · 표 · Description · 오버라이드, 한 번에 되돌리기', () => {
  const { doc, idx, hist } = setup('screen');
  const before = snap(doc);
  const ms = O.findMatches(doc, '버튼');
  assert.ok(ms.length >= 2);
  assert.ok(ms.some((m) => m.path === 'title'));                     // Description 제목
  hist.commit(O.opsReplace(idx, ms, '버튼', '단추'));
  assert.equal(O.findMatches(doc, '버튼').length, 0);
  assert.ok(O.findMatches(doc, '단추').length >= 2);
  hist.undo();
  assert.deepEqual(snap(doc), before);
  assert.equal(O.findMatches(doc, 'MESSAGE', { caseSensitive: false }).length, 0);
});

test('목록 · 들여쓰기: 모든 단락에 적용하고 다시 누르면 해제', () => {
  const { idx, hist } = setup('blank');
  const f = idx.frames()[0];
  const t = M.createNode('text', { runs: [{ t: '하나\n둘\n셋' }] });
  hist.commit([{ op: 'insert', parent: f.id, index: null, item: t }]);
  assert.equal(O.paragraphCount(idx.get(t.id).runs), 3);
  hist.commit(O.opsListAll(idx.get(t.id), 'bullet'));
  assert.ok(idx.get(t.id).paras.every((p) => p.list === 'bullet'));
  hist.commit(O.opsIndentAll(idx.get(t.id), 1));
  assert.ok(idx.get(t.id).paras.every((p) => p.lv === 1));
  hist.commit(O.opsListAll(idx.get(t.id), 'bullet'));
  assert.ok(idx.get(t.id).paras.every((p) => !p.list));
});

test('크기 같게 · 서식 복사 · 회전 경계 상자', () => {
  const { idx, hist } = setup('blank');
  const f = idx.frames()[0];
  const a = M.createNode('shape', { x: 0, y: 0, w: 50, h: 20, fill: '#ff0000', stroke: '#000000', strokeWidth: 3, shadow: true });
  const b = M.createNode('shape', { x: 100, y: 0, w: 80, h: 10 });
  hist.commit([a, b].map((n) => ({ op: 'insert', parent: f.id, index: null, item: n })));
  hist.commit(O.opsSameSize(idx, [a.id, b.id], 'both'));
  assert.deepEqual([idx.get(a.id).w, idx.get(a.id).h, idx.get(b.id).w, idx.get(b.id).h], [80, 20, 80, 20]);
  hist.commit(O.opsApplyFormat(idx, [b.id], O.extractFormat(idx.get(a.id))));
  assert.equal(idx.get(b.id).fill, '#ff0000');
  assert.equal(idx.get(b.id).strokeWidth, 3);
  assert.equal(idx.get(b.id).shadow, true);
  // 90° 돌리면 경계 상자는 가로세로가 바뀐다
  hist.commit([{ op: 'set', id: a.id, key: 'rotation', value: 90 }]);
  const bb = M.bounds(idx.get(a.id));
  assert.ok(Math.abs(bb.w - 20) < .01 && Math.abs(bb.h - 80) < .01);
});

test('테마 색 · 설정 · 프레임 메모/숨김/안내선이 저장 → 다시 열기에서 유지', () => {
  const { doc, idx, hist } = setup('screen');
  const f = idx.frames().find((x) => x.layout === 'screen');
  hist.commit([
    { op: 'set', id: 'doc', key: 'theme.colors.0.value', value: '#123456' },
    { op: 'set', id: 'doc', key: 'settings.gridSnap', value: true },
    { op: 'set', id: f.id, key: 'notes', value: '메모' },
    { op: 'set', id: f.id, key: 'hidden', value: true },
    { op: 'set', id: f.id, key: 'guides', value: { v: [100], h: [] } },
    { op: 'set', id: f.nodes[0].id, key: 'fill', value: 'theme:primary' },
  ]);
  const re = M.load(M.serialize(doc));
  assert.deepEqual(re, doc);
  const f2 = re.pages.flatMap((p) => p.frames).find((x) => x.id === f.id);
  assert.equal(f2.notes, '메모');
  assert.equal(f2.hidden, true);
  assert.equal(re.theme.colors[0].value, '#123456');
  // 예전 문서(테마 · 설정 없음)도 열린다
  const old = M.clone(doc); delete old.theme; delete old.settings;
  const up = M.load(JSON.stringify(old));
  assert.ok(up.theme.colors.length > 0 && up.settings.grid === 10);
});

const PPTX_SAMPLE = path.join(here, '../samples/chat-spec-v0.1.pptx.tnspec.json');
test('PPTX에서 가져온 샘플: 검증 · 왕복 · 페이지 종류 · 숨김 · 연결선', { skip: !fs.existsSync(PPTX_SAMPLE) }, () => {
  const doc = M.load(fs.readFileSync(PPTX_SAMPLE, 'utf8'));
  assert.deepEqual(M.load(M.serialize(doc)), doc);
  const frames = doc.pages.flatMap((p) => p.frames);
  const layouts = frames.map((f) => f.layout);
  assert.equal(layouts[0], 'cover');
  assert.ok(layouts.includes('history') && layouts.includes('policy') && layouts.includes('divider') && layouts.includes('end'));
  assert.ok(layouts.filter((l) => l === 'screen').length >= 8);
  assert.ok(frames.some((f) => f.hidden));
  assert.equal(doc.meta.title, '투네이션 채팅 상세기획서');
  const idx = new M.DocIndex(doc);
  let attached = 0;
  for (const f of frames) O.walk(f.nodes, (n) => { if (n.type === 'connector' && n.from && idx.get(n.from.node)) attached++; });
  assert.ok(attached > 5);
  // 편집 → 되돌리기
  const hist = new M.History(idx);
  const before = snap(doc);
  const sf = frames.find((f) => f.layout === 'screen');
  hist.commit(O.opsMove(idx, sf.nodes.slice(0, 10).map((n) => n.id), 5, 5));
  hist.commit(O.opsGroup(idx, sf.nodes.slice(0, 3).map((n) => n.id)).ops);
  while (hist.undo());
  assert.deepEqual(snap(doc), before);
});
