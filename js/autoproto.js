// 인터랙션 영역 자동 구현: 화면 스크린샷 → 동작하는 HTML 프로토타입
//  1) 인터랙션 영역을 만든다  2) 스크린샷을 올린다  3) 서버(tools/serve.py /api/screen2html)가 Claude로 HTML을 만든다
//  API 키가 없거나 서버가 없으면, 스크린샷 위에 Description 번호를 눌러 볼 수 있는 기본 프로토타입을 만든다.
import * as M from './model.js';
import * as O from './ops.js';
import * as Ed from './editor.js';
import { collectDescriptions, esc, renderFrame, fitText } from './render.js';
import * as API from './api.js';

const E = new Proxy({}, { get: (_, k) => Ed.E[k], set: (_, k, v) => { Ed.E[k] = v; return true; } });
const MAX_EDGE = 1600;   // Claude 비전 권장 크기 근처로 줄여 보낸다 (문서 크기도 줄어든다)

export function pickScreenshot(id) {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = 'image/png,image/jpeg,image/webp,image/gif';
  i.onchange = () => { if (i.files[0]) implementFromFile(id, i.files[0]); };
  i.click();
}

// 이미지 파일 → 줄인 dataURL + 크기
async function loadShot(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('이미지를 열 수 없어요')); im.src = url; });
    const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    let data = c.toDataURL('image/png');
    if (data.length > 3.5e6) data = c.toDataURL('image/jpeg', 0.9);   // API 한도(5MB) 안으로
    return { data, w, h, mime: data.slice(5, data.indexOf(';')) };
  } finally { URL.revokeObjectURL(url); }
}

// 영역 위에 놓인 Description 번호 → 스크린샷 좌표 (AI에게 "이 번호는 여기" 힌트, 기본 프로토타입의 누름 자리)
function descContext(n, fid) {
  const f = E.idx.get(fid);
  const list = f && f.nodes ? collectDescriptions(f.nodes) : [];
  const a = n.action || {};
  const cw = a.cw || n.w, ch = a.ch || n.h;
  const k = Math.min(n.w / cw, n.h / ch);
  const ox = n.x + (n.w - cw * k) / 2, oy = n.y + (n.h - ch * k) / 2;
  const out = [];
  // 번호는 보통 요소 옆에 붙인다 → 기획서 영역 인터랙션은 가장자리 바깥 24px 안의 번호도 이 영역 것으로 (가장자리에 붙여서)
  const pad = a.source === 'area' ? 24 : 0;
  for (const d of list) {
    let cx = d.x + (d.w || 18) / 2, cy = d.y + (d.h || 18) / 2;
    const inside = d.marker !== false && cx >= n.x - pad && cx <= n.x + n.w + pad && cy >= n.y - pad && cy <= n.y + n.h + pad;
    if (inside) { cx = Math.min(n.x + n.w, Math.max(n.x, cx)); cy = Math.min(n.y + n.h, Math.max(n.y, cy)); }
    // 기획서 영역에서 만든 인터랙션: 다른 영역에 번호가 붙은 Description은 빼고, 이 영역의 번호 + 패널에만 있는 것만
    if (a.source === 'area' && d.marker !== false && !inside) continue;
    const o = { num: String(d.num), title: d.title || '', body: d.body || '', color: d.color };
    if (inside) { o.x = Math.round((cx - ox) / k); o.y = Math.round((cy - oy) / k); }
    out.push(o);
  }
  return out;
}

export async function implementFromFile(id, file) {
  const n0 = E.idx.get(id);
  if (!n0) return;
  let shot;
  try { shot = await loadShot(file); } catch (err) { Ed.toast(err.message, true); return; }
  const aid = M.uid('img');
  const a = Object.assign({}, n0.action || {}, { type: 'html', shot: aid, cw: shot.w, ch: shot.h, fit: 'contain', asset: undefined, src: undefined, html: undefined, gen: undefined });
  Object.keys(a).forEach((k) => a[k] === undefined && delete a[k]);
  const ops = [
    { op: 'set', id: 'doc', key: 'assets.' + aid, value: { mime: shot.mime, data: shot.data, w: shot.w, h: shot.h, name: file.name || 'screenshot.png' } },
    { op: 'set', id, key: 'action', value: a },
    // 영역 너비는 그대로 두고 높이를 스크린샷 비율에 맞춘다
    { op: 'set', id, key: 'h', value: O.R(n0.w * shot.h / shot.w) },
  ];
  if (!n0.name || n0.name === '인터랙션 영역') ops.push({ op: 'set', id, key: 'name', value: '화면 프로토타입' });
  if (!Ed.commit(ops, '화면 스크린샷')) return;
  await generate(id);
}

// 이미 문서에 있는 화면 이미지(예: PDF에서 가져온 화면 캡처) → 같은 자리의 화면 프로토타입으로 바꾸고 자동 구현
export async function fromImage(id) {
  const n = E.idx.get(id);
  const a = n && n.type === 'image' && E.doc.assets[n.asset];
  if (!a) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(a.mime)) { Ed.toast('PNG · JPG · WEBP · GIF 이미지만 화면 프로토타입으로 바꿀 수 있어요.', true); return; }
  const e = E.idx.entry(id);
  const list = e.parent[e.key];
  const hs = M.createNode('hotspot', { name: (n.name || '화면').replace(/^화면 이미지/, '화면 프로토타입'), x: n.x, y: n.y, w: n.w, h: n.h,
    action: { type: 'html', shot: n.asset, cw: a.w || n.w, ch: a.h || n.h, fit: n.crop ? 'contain' : 'stretch' } });
  if (!Ed.commit([{ op: 'insert', parent: e.parent.id, index: list.indexOf(n), item: hs }, { op: 'remove', id }], '이미지 → 화면 프로토타입')) return;
  Ed.select([hs.id]);
  await generate(hs.id);
}

// ---------- 기획서의 영역을 골라 인터랙션 추가 ----------
// 고른 객체들이 차지한 영역을 기획서 그대로 캡처(html2canvas) → 그 위에 인터랙션 영역 → 영역 안 Description · 글자를 근거로 자동 구현.
// 원래 객체는 그대로 두고(지우지 않음), 인터랙션 영역은 고른 객체 바로 위 · Description 번호 아래에 둔다.
const CAPTURE_SCALE = 2;
let h2c = null;
function loadH2C() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return h2c || (h2c = new Promise((ok, no) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    sc.onload = () => ok(window.html2canvas);
    sc.onerror = () => { h2c = null; no(new Error('화면 캡처 도구를 불러오지 못했어요 (인터넷 연결을 확인하세요)')); };
    document.head.appendChild(sc);
  }));
}
// 캡처에서 뺄 것: 기획 주석(Description 번호 · 빨간 점선 박스 · 주석선 · 하위 번호 원) — 화면이 아니라 설명이다
function annotationIds(nodes) {
  const out = new Set();
  O.walk(nodes, (n) => {
    if (n.type === 'connector' || n.type === 'description' || n.type === 'hotspot') out.add(n.id);
    else if (n.type === 'shape' && (((!n.fill || n.fill === 'none') && n.dash) || /^(번호 |주석)/.test(n.name || ''))) out.add(n.id);
  });
  return out;
}
export async function captureRegion(fid, box) {
  const f = E.idx.get(fid);
  const html2canvas = await loadH2C();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none';
  const fr = renderFrame(f, { doc: E.doc, idx: E.idx, mode: 'present', noEmbed: true, pageNo: 1 });
  host.appendChild(fr);
  document.body.appendChild(host);
  try {
    fitText(host);
    await Promise.all([...host.querySelectorAll('img')].map((im) => (im.decode ? im.decode().catch(() => {}) : null)));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const skip = annotationIds(f.nodes);
    const r = fr.getBoundingClientRect();
    const canvas = await html2canvas(fr, {
      x: r.left + box.x, y: r.top + box.y, width: box.w, height: box.h, scale: CAPTURE_SCALE,
      backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0,
      ignoreElements: (el) => !!(el.dataset && el.dataset.id && skip.has(el.dataset.id)),
    });
    let data = canvas.toDataURL('image/png');
    if (data.length > 3.5e6) data = canvas.toDataURL('image/jpeg', 0.9);
    return { data, w: canvas.width, h: canvas.height, mime: data.slice(5, data.indexOf(';')) };
  } finally {
    host.remove();
  }
}
// 영역 안 기획서 글자 (AI가 스크린샷을 읽어 옮기는 대신 정확한 표기를 쓰게) — 스크린샷 좌표로
const plain = (runs) => (runs || []).map((r) => r.t || '').join('').trim();
function regionTexts(n, fid) {
  const f = E.idx.get(fid);
  const k = ((n.action && n.action.cw) || n.w) / n.w;
  const out = [];
  O.walk(f.nodes, (t) => {
    if (t.hidden || !['text', 'shape', 'table'].includes(t.type)) return;
    const b = M.bounds(t, E.idx);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (cx < n.x || cx > n.x + n.w || cy < n.y || cy > n.y + n.h) return;
    const txt = t.type === 'table' ? t.rows.map((r) => r.cells.map((c) => (c ? plain(c.runs) : '')).join(' | ')).join(' / ') : plain(t.runs);
    if (txt) out.push({ t: txt.slice(0, 400), x: Math.round((b.x - n.x) * k), y: Math.round((b.y - n.y) * k) });
  });
  return out.slice(0, 120);
}
// 프레임 맨 위 목록에서의 위치 (그룹 안 객체면 그 그룹의 위치)
function topIndex(f, id) {
  let e = E.idx.entry(id);
  while (e && e.parent && e.parent !== f) e = E.idx.entry(e.parent.id);
  return e ? f.nodes.indexOf(e.obj) : -1;
}
export async function addToSelection(sel) {
  const ids = O.topLevel(E.idx, sel || E.sel).filter((id) => { const t = E.idx.get(id); return t && !['description', 'hotspot', 'connector'].includes(t.type); });
  if (!ids.length) { Ed.toast('인터랙션을 넣을 화면 객체를 먼저 고르세요.'); return; }
  const fid = Ed.frameOfNode(ids[0]);
  const f = E.idx.get(fid);
  if (!f || f.kind !== 'frame') { Ed.toast('프레임 안의 객체에만 인터랙션을 넣을 수 있어요.'); return; }
  const sb = O.selectionBox(E.idx, ids);
  const box = { x: Math.max(0, Math.floor(sb.x)), y: Math.max(0, Math.floor(sb.y)) };
  box.w = Math.min(E.doc.size.w, Math.ceil(sb.x + sb.w)) - box.x;
  box.h = Math.min(E.doc.size.h, Math.ceil(sb.y + sb.h)) - box.y;
  if (box.w < 16 || box.h < 16) { Ed.toast('영역이 너무 작아요.'); return; }
  Ed.toast('고른 영역을 기획서 그대로 캡처하는 중…');
  let shot;
  try { shot = await captureRegion(fid, box); } catch (err) { Ed.toast(err.message, true); return; }
  const aid = M.uid('img');
  const index = Math.max(...ids.map((id) => topIndex(f, id))) + 1;
  const first = E.idx.get(ids[0]);
  const hs = M.createNode('hotspot', { name: '인터랙션 · ' + ((ids.length === 1 && first.name) || '영역'), x: box.x, y: box.y, w: box.w, h: box.h,
    action: { type: 'html', shot: aid, cw: shot.w, ch: shot.h, fit: 'stretch', source: 'area' } });
  const ok = Ed.commit([
    { op: 'set', id: 'doc', key: 'assets.' + aid, value: { mime: shot.mime, data: shot.data, w: shot.w, h: shot.h, name: '기획서 영역 캡처' } },
    { op: 'insert', parent: f.id, index: index > 0 ? index : null, item: hs },
  ], '영역에 인터랙션 추가');
  if (!ok) return;
  Ed.select([hs.id]);
  await generate(hs.id);
}
// 이미 그린 인터랙션 영역: 그 아래 기획서 화면을 캡처해 자동 구현
export async function captureUnder(id) {
  const n = E.idx.get(id);
  if (!n) return;
  const fid = Ed.frameOfNode(id);
  Ed.toast('영역 아래 기획서 화면을 캡처하는 중…');
  let shot;
  try { shot = await captureRegion(fid, { x: n.x, y: n.y, w: n.w, h: n.h }); } catch (err) { Ed.toast(err.message, true); return; }
  const aid = M.uid('img');
  const a = Object.assign({}, n.action || {}, { type: 'html', shot: aid, cw: shot.w, ch: shot.h, fit: 'stretch', source: 'area' });
  for (const k of ['asset', 'src', 'html', 'gen']) delete a[k];
  if (!Ed.commit([
    { op: 'set', id: 'doc', key: 'assets.' + aid, value: { mime: shot.mime, data: shot.data, w: shot.w, h: shot.h, name: '기획서 영역 캡처' } },
    { op: 'set', id, key: 'action', value: a },
  ], '영역 캡처')) return;
  await generate(id);
}

// 같은 스크린샷으로 다시 만들기 (추가 요청 반영)
export async function generate(id, request) {
  const n = E.idx.get(id);
  const a = n && n.action;
  if (!a || !a.shot || !E.doc.assets[a.shot]) { Ed.toast('먼저 화면 스크린샷을 올려 주세요.', true); return; }
  if (E.embBusy.has(id)) return;
  const fid = Ed.frameOfNode(id);
  const f = E.idx.get(fid);
  const shot = E.doc.assets[a.shot];
  const descs = descContext(n, fid);
  E.embBusy.add(id);
  Ed.scheduleRenderAll(fid);
  Ed.ui();
  let html = null, gen = null, why = '';
  const r = await API.call('/api/screen2html', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: shot.data, w: a.cw, h: a.ch, frame: f ? f.name : '', descriptions: descs, texts: a.source === 'area' ? regionTexts(n, fid) : [], request: request || a.request || '' }),
  }, true);   // AI 자동 구현은 이 PC의 Spec Studio 서버(API 키)에서만
  if (r.offline) why = 'Spec Studio 서버(tools/serve.py)에 연결할 수 없어 기본 프로토타입으로 만들었어요.';
  else {
    const res = r.res, j = r.body || {};
    if (res.ok && j.html) { html = j.html; gen = { by: 'ai', model: j.model, at: new Date().toISOString() }; if (j.truncated) why = '응답이 길어 일부가 잘렸을 수 있어요. 다시 만들어 보세요.'; }
    else if (res.status === 501) why = 'AI 키가 없어 기본 프로토타입으로 만들었어요. ' + (j.message || '');
    else if (res.status === 404 || res.status === 405) why = 'AI 자동 구현은 이 PC에서 Spec Studio 서버("Spec Studio 실행.bat")를 켰을 때만 돼요 — 기본 프로토타입으로 만들었어요.';
    else why = (j.error || ('서버 오류 ' + res.status)) + ' — 기본 프로토타입으로 만들었어요.';
  }
  if (!html) { html = basicHTML(shot.data, a.cw, a.ch, descs); gen = { by: 'basic', at: new Date().toISOString() }; }
  E.embBusy.delete(id);
  const cur = E.idx.get(id);
  if (!cur || !cur.action || cur.action.shot !== a.shot) { Ed.scheduleRenderAll(fid); Ed.ui(); return; }   // 그동안 지워졌거나 바뀜
  const ra = Ed.htmlAssetOps(html, (f ? f.name : 'screen') + '.html');
  const next = Object.assign({}, cur.action, { asset: ra.aid, gen });
  if (request !== undefined) { if (request) next.request = request; else delete next.request; }
  ra.ops.push({ op: 'set', id, key: 'action', value: next });
  Ed.commit(ra.ops, '자동 구현');
  Ed.toast(gen.by === 'ai' ? '자동 구현 완료! 더블클릭하면 여기서 바로 눌러 볼 수 있어요.' + (why ? ' ' + why : '') : why, gen.by !== 'ai' && !!why);
}

// AI 없이: 스크린샷 + Description 번호 누름 자리 + 설명 말풍선
export function basicHTML(src, w, h, descs) {
  const spots = descs.filter((d) => d.x != null);
  const rest = descs.filter((d) => d.x == null);
  const card = (d) => `<b>${esc(d.num)}. ${esc(d.title || 'Description')}</b>${d.body ? `<p>${esc(d.body).replace(/\n/g, '<br>')}</p>` : ''}`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>화면 프로토타입</title><style>
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif}
.shot{position:absolute;inset:0;width:${w}px;height:${h}px;display:block;user-select:none}
.spot{position:absolute;z-index:3;width:${Math.max(28, Math.round(w / 40))}px;height:${Math.max(28, Math.round(w / 40))}px;margin:-${Math.max(14, Math.round(w / 80))}px 0 0 -${Math.max(14, Math.round(w / 80))}px;border-radius:50%;border:0;background:var(--c);color:#fff;font:700 ${Math.max(13, Math.round(w / 90))}px/1 sans-serif;cursor:pointer;box-shadow:0 0 0 3px rgba(255,255,255,.85),0 2px 8px rgba(0,0,0,.35);animation:p 2s infinite}
.spot:hover,.spot.on{transform:scale(1.15)}
@keyframes p{0%{box-shadow:0 0 0 3px rgba(255,255,255,.85),0 0 0 3px var(--c)}70%{box-shadow:0 0 0 3px rgba(255,255,255,.85),0 0 0 14px transparent}100%{box-shadow:0 0 0 3px rgba(255,255,255,.85),0 0 0 3px transparent}}
.tip{position:absolute;max-width:${Math.round(Math.min(360, w * .45))}px;background:#1b2130;color:#fff;border-radius:8px;padding:10px 12px;font-size:${Math.max(12, Math.round(w / 100))}px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.35);display:none;z-index:5}
.tip b{display:block;margin-bottom:2px}.tip p{margin:4px 0 0;color:#d6dbe6}
.list{position:absolute;z-index:2;right:8px;top:8px;max-width:45%;background:rgba(27,33,48,.92);color:#fff;border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.5}
.list div{cursor:pointer;padding:2px 0}.list div:hover{color:#9ec2ff}
</style></head><body>
<img class="shot" src="${src}" alt="">
${spots.map((d) => `<button class="spot" data-spec="${esc(d.num)}" style="left:${d.x}px;top:${d.y}px;--c:${esc(d.color && /^#|^rgb/.test(d.color) ? d.color : '#e53935')}" data-card="${esc(card(d))}">${esc(d.num)}</button>`).join('')}
${rest.length ? `<div class="list">${rest.map((d) => `<div data-spec="${esc(d.num)}" data-card="${esc(card(d))}">${esc(d.num)}. ${esc(d.title || 'Description')}</div>`).join('')}</div>` : ''}
<div class="tip" id="tip"></div>
<script>
var tip=document.getElementById('tip'),cur=null;
document.addEventListener('click',function(e){
  var t=e.target.closest('[data-card]');
  if(!t||t===cur){tip.style.display='none';if(cur)cur.classList.remove('on');cur=null;return;}
  if(cur)cur.classList.remove('on');cur=t;t.classList.add('on');
  tip.innerHTML=t.getAttribute('data-card');tip.style.display='block';
  var r=t.getBoundingClientRect(),x=r.right+8,y=r.top;
  if(x+tip.offsetWidth>${w}-6)x=r.left-tip.offsetWidth-8;
  if(y+tip.offsetHeight>${h}-6)y=${h}-tip.offsetHeight-6;
  tip.style.left=Math.max(6,x)+'px';tip.style.top=Math.max(6,y)+'px';
});
</script></body></html>`;
}

// 프로토타입 안에서 data-spec 요소를 누르면 → 기획서의 Description 번호와 패널 행을 반짝
export function initBridge() {
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.tnspec !== 'spec' || d.n == null) return;
    const fr = [...document.querySelectorAll('.n-hotspot.embed iframe')].find((x) => x.contentWindow === e.source);
    if (!fr) return;
    const frameEl = fr.closest('.frame');
    const fid = frameEl && frameEl.dataset.frame;
    const f = fid && E.idx && E.idx.get(fid);
    if (!f) return;
    const hit = collectDescriptions(f.nodes).filter((x) => String(x.num) === String(d.n));
    for (const x of hit) {
      frameEl.querySelectorAll(`[data-id="${x.id}"], .ch-desc-r[data-desc="${x.id}"]`).forEach((el) => {
        el.classList.remove('spec-flash');
        void el.offsetWidth;
        el.classList.add('spec-flash');
        setTimeout(() => el.classList.remove('spec-flash'), 1400);
      });
    }
  });
}
