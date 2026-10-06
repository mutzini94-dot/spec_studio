// 기획서양식.pdf 를 그대로 옮긴 레이아웃(프레임 바탕) + 새 문서 템플릿 + 기본 컴포넌트
// 레이아웃은 "마스터"처럼 동작한다: 머리말 · Description 패널 · 꼬리말 · 쪽 번호는 노드가 아니라
// 문서 정보(meta)와 프레임 속성(props)으로 그려지고, 본문만 노드로 편집한다.
import { createDoc, createPage, createFrame, createNode, createComponent, makeTable, today, uid } from './model.js';

const A = 'assets/';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 레이아웃별 정보 — content: 노드를 놓는 본문 영역 (정렬 · 간격 가이드 기준)
export const LAYOUT_INFO = {
  cover: { name: '표지', dark: true, content: { x: 66, y: 120, w: 828, h: 300 } },
  history: { name: '개정 이력 (Revision History)', content: { x: 66, y: 71, w: 844, h: 440 } },
  policy: { name: '기본 정책', content: { x: 32, y: 86, w: 896, h: 430 } },
  divider: { name: '간지 (장 구분)', dark: true, content: { x: 66, y: 280, w: 780, h: 200 } },
  screen: { name: '화면 설계', content: { x: 11, y: 54, w: 741, h: 466 } },
  end: { name: 'THANK YOU', dark: true, content: { x: 66, y: 60, w: 828, h: 420 } },
  blank: { name: '빈 페이지', content: { x: 20, y: 20, w: 920, h: 500 } },
};

// 꼬리말: 문서 정보의 footer 설정으로 슬로건 · 저작권 · 쪽 번호를 켜고 끈다
function footer(doc, pageNo) {
  const f = Object.assign({ slogan: true, copyright: true, pageNo: true }, doc.meta.footer || {});
  const c = esc(doc.meta.copyright || 'Toonation');
  return (f.slogan ? `<img class="ch-abs" src="${A}slogan.png" alt="" style="left:4.35px;top:527.3px;width:158.9px;height:14.5px">` : '') +
    (f.copyright ? `<div class="ch-abs ch-copy" style="right:${f.pageNo ? 29 : 6}px;top:528.6px">Copyright @<b>${c}.</b> All Rights Reserved</div>` : '') +
    (f.pageNo ? `<div class="ch-abs ch-pno" style="right:2px;top:526.5px">${pageNo} P</div>` : '');
}

// 바뀌는 칸: data-bind="meta.title" (문서 정보) / "props.pageName" (프레임 속성) — 더블클릭으로 바로 고친다
function bind(path, value, placeholder, cls, style) {
  const empty = value == null || value === '';
  return `<div class="ch-abs ch-field ${cls}${empty ? ' ch-empty' : ''}" data-bind="${path}" data-ph="${esc(placeholder)}" style="${style}">${esc(empty ? placeholder : value)}</div>`;
}

export function renderChrome(doc, frame, ctx) {
  const m = doc.meta, p = frame.props || {};
  switch (frame.layout) {
    case 'cover':
      return `<div class="ch-bg" style="background:#393939"></div>
        <img class="ch-abs" src="${A}toothlife.png" alt="TOOTHLIFE" style="left:66px;top:40px;width:65px">
        <img class="ch-abs" src="${A}slogan.png" alt="WE MAKE CREATIVE CULTURE." style="left:652.8px;top:37.4px;width:246.7px;height:22.6px">
        ${bind('meta.title', m.title, '기획서 제목', 'ch-cover-title', 'left:64px;top:131px;width:820px')}
        ${bind('meta.team', m.team, '팀 이름', 'ch-cover-team', 'left:66px;top:432px;width:500px')}
        <div class="ch-abs ch-cover-ver" style="left:66px;top:483px">Ver.${bind('meta.version', m.version, '0.1', 'ch-inline', '')} ${bind('meta.date', m.date, today(), 'ch-inline', '')}</div>`;
    case 'history':
      return `<div class="ch-bg" style="background:#fff"></div>
        <div class="ch-abs ch-rev-title" style="left:66px;top:22px">Revision History</div>${footer(doc, ctx.pageNo)}`;
    case 'policy':
      return `<div class="ch-bg" style="background:#fff"></div>
        <img class="ch-abs" src="${A}toonation-logo.png" alt="Toonation" style="left:14.3px;top:6.4px;width:88.6px;height:28.6px">
        ${bind('props.title', p.title, '기본 정책', 'ch-policy-title', 'left:25px;top:44px;width:600px')}${footer(doc, ctx.pageNo)}`;
    case 'divider':
      return `<div class="ch-bg" style="background:#121212"></div>
        ${bind('props.number', p.number, '01', 'ch-div-num', 'left:58px;top:96px;width:400px')}
        ${bind('props.title', p.title, '장 제목', 'ch-div-title', 'left:64px;top:198px;width:780px')}
        <img class="ch-abs" src="${A}toothlife.png" alt="TOOTHLIFE" style="left:66px;top:489px;width:65px;opacity:.87">
        <img class="ch-abs" src="${A}slogan-vertical.png" alt="" style="left:882px;top:54.5px;width:21.6px;height:456.5px">`;
    case 'screen': {
      const rows = descriptionRows(ctx.descriptions || []);
      return `<div class="ch-bg" style="background:#fff"></div>
        <div class="ch-abs ch-hd" style="left:11px;top:8px;width:945px;height:19px">
          <div class="ch-hd-l" style="width:112px">Page Name</div>
          ${bind('props.pageName', p.pageName != null ? p.pageName : frame.name, '화면 제목', 'ch-hd-v', 'position:relative;width:555px')}
          <div class="ch-hd-l" style="width:80px">Project</div>
          ${bind('meta.project', m.project, '프로젝트 명', 'ch-hd-v', 'position:relative;width:198px')}
        </div>
        ${bind('props.screenTitle', p.screenTitle != null ? p.screenTitle : (p.pageName != null ? p.pageName : frame.name), '화면 제목', 'ch-screen-title', 'left:20px;top:34px;width:700px')}
        <div class="ch-abs ch-desc" style="left:757px;top:28px;width:199px;height:497px">
          <div class="ch-desc-h">Description</div>
          <div class="ch-desc-b">${rows}</div>
        </div>${footer(doc, ctx.pageNo)}`;
    }
    case 'end':
      return `<div class="ch-bg" style="background:#393939"></div>
        <div class="ch-abs ch-thanks" style="left:0;top:196px;width:960px">THANK YOU</div>
        <img class="ch-abs" src="${A}slogan-end.png" alt="WE MAKE CREATIVE CULTURE." style="left:313px;top:258.7px;width:339.9px;height:22.6px">
        <img class="ch-abs" src="${A}toothlife.png" alt="TOOTHLIFE" style="left:447.5px;top:293.5px;width:65px">`;
    default:
      return `<div class="ch-bg" style="background:#fff"></div>${footer(doc, ctx.pageNo)}`;
  }
}

// 화면 설계 프레임의 Description 패널: 프레임 안 Description 노드를 번호순으로 모아 자동으로 채운다
function descriptionRows(list) {
  const out = list.map((d) => `<div class="ch-desc-r" data-desc="${esc(d.id)}"><div class="ch-desc-n" style="color:${esc(d.color || '#e53935')}">${esc(d.num)}</div>
      <div class="ch-desc-t">${d.title ? `<b>${esc(d.title)}</b>` : ''}${d.title && d.body ? '<br>' : ''}${esc(d.body || '')}</div></div>`);
  for (let i = list.length; i < 6; i++) out.push('<div class="ch-desc-r ch-desc-empty"><div class="ch-desc-n"></div><div class="ch-desc-t"></div></div>');
  return out.join('');
}

// ---------- 프레임 템플릿 (+ 프레임 추가) ----------
const T = (t, extra = {}) => Object.assign({ runs: [{ t }] }, extra);

export function revisionTable(rows) {
  const data = rows && rows.length ? rows : [['1', '0.1', today(), '최초 작성', '', '']];
  const cols = [68, 68, 68, 480, 80, 80];
  const heights = [32, 19, 69, 79, 114, 22, 22, 23, 24, 23];
  while (heights.length - 1 < data.length) heights.push(23);
  const t = makeTable(cols, heights, { header: ['No.', 'Version', '변경일', '변경내용', '작성자', '승인자'], headerBg: '#a6a6a6', headerColor: '#333333', style: { border: 'dotted', borderColor: '#b3b3b3', topRule: 2, size: 8, color: '#333333' } });
  data.forEach((r, i) => r.forEach((v, ci) => { const c = t.rows[i + 1].cells[ci]; c.runs = [{ t: v }]; if (ci !== 3) c.align = 'center'; }));
  t.rows[0].cells.forEach((c) => { c.size = 10; });
  return createNode('table', Object.assign({ name: '개정 이력 표', x: 66, y: 71, w: 844, h: heights.reduce((a, b) => a + b, 0) }, t));
}

export function policyTable() {
  const cols = [175, 236, 377];
  const heights = [28, 21, 37, 36, 29, 21, 37, 29, 29, 29, 28, 29, 22];
  const t = makeTable(cols, heights, { header: ['영역(분류)', '정책', '상세'], headerBg: '#d9d9d9', headerColor: '#111111', style: { border: 'hlines', borderColor: '#e6ebf1', size: 8, color: '#222222' } });
  return createNode('table', Object.assign({ name: '정책 표', x: 32, y: 86, w: 788, h: heights.reduce((a, b) => a + b, 0) }, t));
}

export const FRAME_TEMPLATES = [
  { layout: 'cover', make: () => createFrame('cover', '표지') },
  { layout: 'history', make: () => createFrame('history', 'Revision History', {}, [revisionTable()]) },
  { layout: 'policy', make: () => createFrame('policy', '기본 정책', { title: '기본 정책' }, [policyTable()]) },
  { layout: 'divider', make: (n = '01', t = '프론트') => createFrame('divider', t, { number: n, title: t }) },
  { layout: 'screen', make: (name = '화면 제목') => createFrame('screen', name, { pageName: name, screenTitle: name }) },
  { layout: 'end', make: () => createFrame('end', 'THANK YOU') },
  { layout: 'blank', make: () => createFrame('blank', '빈 페이지') },
];
export const makeFrame = (layout, ...a) => FRAME_TEMPLATES.find((f) => f.layout === layout).make(...a);

// ---------- 기본 컴포넌트: 버튼 · 채팅 메시지 · 팝업 ----------
export function starterComponents() {
  const btn = createComponent('버튼 / 기본', 112, 34, [
    createNode('shape', { name: '배경', x: 0, y: 0, w: 112, h: 34, shape: 'rect', radius: 6, fill: '#2b7fff', stroke: 'none', strokeWidth: 0,
      runs: [{ t: '버튼' }], style: { size: 12, color: '#ffffff', bold: true, align: 'center', valign: 'middle' } }),
  ]);
  const btn2 = createComponent('버튼 / 보조', 112, 34, [
    createNode('shape', { name: '배경', x: 0, y: 0, w: 112, h: 34, shape: 'rect', radius: 6, fill: '#ffffff', stroke: '#c7ccd3', strokeWidth: 1,
      runs: [{ t: '취소' }], style: { size: 12, color: '#3b4250', align: 'center', valign: 'middle' } }),
  ]);
  const chat = createComponent('채팅 메시지', 280, 42, [
    createNode('shape', { name: '프로필', x: 0, y: 4, w: 28, h: 28, shape: 'ellipse', fill: '#dfe7f5', stroke: 'none', strokeWidth: 0 }),
    createNode('text', { name: '닉네임', x: 38, y: 2, w: 200, h: 16, runs: [{ t: '도네이터 닉네임' }], style: { size: 11, color: '#4a5568', bold: true } }),
    createNode('text', { name: '메시지', x: 38, y: 20, w: 240, h: 18, runs: [{ t: '채팅 메시지 내용이 여기에 표시됩니다.' }], style: { size: 11, color: '#111111' } }),
  ]);
  const popup = createComponent('팝업', 300, 170, [
    createNode('shape', { name: '배경', x: 0, y: 0, w: 300, h: 170, shape: 'rect', radius: 10, fill: '#ffffff', stroke: '#d0d5dc', strokeWidth: 1 }),
    createNode('text', { name: '제목', x: 20, y: 18, w: 260, h: 20, runs: [{ t: '팝업 제목' }], style: { size: 14, color: '#111111', bold: true } }),
    createNode('text', { name: '본문', x: 20, y: 48, w: 260, h: 60, runs: [{ t: '안내 문구를 입력하세요.\n두 줄까지 권장합니다.' }], style: { size: 11, color: '#4a5568', lineHeight: 1.5 } }),
    createNode('instance', { name: '취소 버튼', x: 36, y: 120, w: 112, h: 34, component: btn2.id, overrides: {} }),
    createNode('instance', { name: '확인 버튼', x: 156, y: 120, w: 112, h: 34, component: btn.id, overrides: {} }),
  ]);
  // 팝업 안 확인 버튼의 글자를 "확인"으로 바꿔 두기 (오버라이드 예시)
  popup.nodes[4].overrides[btn.nodes[0].id] = { runs: [{ t: '확인' }] };
  return [btn, btn2, chat, popup];
}

// ---------- 새 문서 템플릿 ----------
function sampleScreen(doc, name, comps) {
  const f = makeFrame('screen', name);
  const chat = comps.find((c) => c.name === '채팅 메시지');
  const btn = comps.find((c) => c.name === '버튼 / 기본');
  f.nodes.push(
    createNode('shape', { name: '화면 영역', x: 40, y: 70, w: 300, h: 420, fill: '#f7f8fa', stroke: '#c9ced6', strokeWidth: 1, radius: 8 }),
    createNode('text', { name: '영역 제목', x: 56, y: 82, w: 200, h: 18, runs: [{ t: '채팅' }], style: { size: 12, color: '#111111', bold: true } }),
    createNode('instance', { name: '채팅 메시지', x: 52, y: 112, w: 280, h: 42, component: chat.id, overrides: {} }),
    createNode('instance', { name: '채팅 메시지', x: 52, y: 160, w: 280, h: 42, component: chat.id, overrides: {} }),
    createNode('instance', { name: '전송 버튼', x: 212, y: 442, w: 112, h: 34, component: btn.id, overrides: { [btn.nodes[0].id]: { runs: [{ t: '전송' }] } } }),
  );
  const d1 = createNode('description', { x: 24, y: 104, num: 1, title: '채팅 메시지', body: '닉네임 · 메시지 순서로 표시한다.' });
  const d2 = createNode('description', { x: 196, y: 450, num: 2, title: '전송 버튼', body: '입력값이 없으면 비활성.' });
  const box = createNode('shape', { name: '주석 박스', x: 206, y: 437, w: 124, h: 44, fill: 'none', stroke: '#e53935', strokeWidth: 1, dash: 'dash' });
  f.nodes.push(box, d1, d2);
  return f;
}

export const DOC_TEMPLATES = [
  {
    id: 'standard', name: '기본 양식', desc: '기획서양식.pdf 그대로 — 표지 · 개정 이력 · 기본 정책 · 간지 · 화면 설계 · THANK YOU',
    build() {
      const doc = createDoc();
      doc.components = starterComponents();
      doc.pages.push(createPage('개요', [makeFrame('cover'), makeFrame('history'), makeFrame('policy')]));
      doc.pages.push(createPage('01 프론트', [makeFrame('divider', '01', '프론트'), makeFrame('screen', '화면 제목')]));
      doc.pages.push(createPage('마무리', [makeFrame('end')]));
      return doc;
    },
  },
  {
    id: 'screen', name: '화면 설계', desc: '화면 목업 + 번호 주석 + Description 패널. 채팅 메시지 · 버튼 컴포넌트 예시 포함',
    build() {
      const doc = createDoc({ title: '화면 설계서' });
      doc.components = starterComponents();
      doc.pages.push(createPage('개요', [makeFrame('cover'), makeFrame('history')]));
      doc.pages.push(createPage('01 화면', [makeFrame('divider', '01', '화면'), sampleScreen(doc, '메인 화면', doc.components), makeFrame('screen', '상세 화면')]));
      doc.pages.push(createPage('마무리', [makeFrame('end')]));
      return doc;
    },
  },
  {
    id: 'policy', name: '정책서', desc: '영역(분류) · 정책 · 상세 표 중심의 정책 문서',
    build() {
      const doc = createDoc({ title: '정책서' });
      doc.components = starterComponents();
      const p2 = makeFrame('policy'); p2.name = '세부 정책'; p2.props.title = '세부 정책';
      doc.pages.push(createPage('정책', [makeFrame('cover'), makeFrame('history'), makeFrame('policy'), p2, makeFrame('end')]));
      return doc;
    },
  },
  {
    id: 'history', name: '변경 이력', desc: 'Revision History 표만 있는 변경 이력 문서',
    build() {
      const doc = createDoc({ title: '변경 이력' });
      doc.components = starterComponents();
      doc.pages.push(createPage('변경 이력', [makeFrame('cover'), makeFrame('history')]));
      return doc;
    },
  },
  {
    id: 'blank', name: '빈 문서', desc: '빈 페이지 하나에서 새로 작성',
    build() {
      const doc = createDoc({ title: '제목 없는 기획서' });
      doc.components = starterComponents();
      doc.pages.push(createPage('페이지 1', [makeFrame('blank')]));
      return doc;
    },
  },
];

export { T, uid };
