// JSON → 화면 (HTML/SVG). 화면은 언제나 문서 모델을 읽어서 그린다 — 화면에만 있는 상태는 없다.
import { renderChrome } from './templates.js';
import { frameBounds, bounds, DEFAULT_THEME, SHAPES } from './model.js';
export { SHAPES };

export const FONTS = {
  m: "var(--f-malgun)", n: "var(--f-nanum)", s: "var(--f-serif)", a: "Arial,Helvetica,sans-serif",
  mo: "'Montserrat',Arial,sans-serif", noto: "var(--f-noto)",
};
export const FONT_NAMES = { m: '맑은 고딕', noto: 'Noto Sans KR', n: '나눔고딕', s: 'Cambria (영문 세리프)', a: 'Arial', mo: 'Montserrat' };
const DASH = { solid: '', dash: '4 3', dot: '1 2.4', long: '8 4', dashdot: '6 3 1 3' };
const hasText = (runs) => (runs || []).some((r) => r.img || (r.t && r.t.length));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function h(tag, cls, style) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (style) el.style.cssText = style;
  return el;
}

// ---------- 테마 색: 'theme:primary' → CSS 변수 (테마를 바꾸면 문서 전체가 함께 바뀜) ----------
const DEF = {};
DEFAULT_THEME.colors.forEach((c) => { DEF[c.key] = c.value; });
export function C(v) {
  if (!v || typeof v !== 'string') return v;
  if (v.startsWith('theme:')) { const k = v.slice(6); return `var(--tc-${k}, ${DEF[k] || '#888'})`; }
  return v;
}
// 화면에 보이는 실제 색 (속성 패널 견본용)
export function resolveColor(doc, v) {
  if (!v || typeof v !== 'string' || !v.startsWith('theme:')) return v;
  const k = v.slice(6);
  const t = (doc.theme && doc.theme.colors || []).find((c) => c.key === k);
  return t ? t.value : DEF[k] || '#888888';
}
export function themeVars(doc) {
  return ((doc.theme && doc.theme.colors) || DEFAULT_THEME.colors).map((c) => `--tc-${c.key}:${c.value}`).join(';');
}

// ---------- 글 ----------
function runHTML(r, assets, mode) {
  if (r.img) {
    const a = assets && assets[r.img];
    return a ? `<img class="run-img" data-img="${esc(r.img)}" src="${a.data}" style="height:${r.h || 10}px" alt="">` : '';
  }
  const st = [];
  if (r.b === true) st.push('font-weight:700'); else if (r.b === false) st.push('font-weight:400');
  if (r.i) st.push('font-style:italic');
  const dec = [r.u && 'underline', r.s && 'line-through'].filter(Boolean);
  if (dec.length) st.push('text-decoration:' + dec.join(' '));
  if (r.color) st.push('color:' + C(r.color));
  if (r.size) st.push('font-size:' + r.size + 'px');
  if (r.font && FONTS[r.font]) st.push('font-family:' + FONTS[r.font]);
  if (r.bg) st.push('background:' + C(r.bg));
  let t = esc(r.t || '');
  if (r.sup) t = `<sup>${t}</sup>`;
  else if (r.sub) t = `<sub>${t}</sub>`;
  if (r.link) {
    const href = r.link.startsWith('frame:') ? '#' : esc(r.link);
    return `<a class="run-link" data-link="${esc(r.link)}" href="${href}" ${mode === 'present' && !r.link.startsWith('frame:') ? 'target="_blank" rel="noopener"' : ''} style="${st.join(';')}">${t}</a>`;
  }
  return st.length ? `<span style="${st.join(';')}">${t}</span>` : t;
}
export function runsHTML(runs, assets, mode) {
  return (runs || []).map((r) => runHTML(r, assets, mode)).join('');
}

// 글 조각을 단락('\n' 기준)으로 나눈다
export function splitParagraphs(runs) {
  const paras = [[]];
  for (const r of runs || []) {
    if (r.img || !r.t || !r.t.includes('\n')) { paras[paras.length - 1].push(r); continue; }
    const parts = r.t.split('\n');
    parts.forEach((p, i) => {
      if (i) paras.push([]);
      if (p) paras[paras.length - 1].push(Object.assign({}, r, { t: p }));
    });
  }
  return paras;
}

const BULLETS = ['•', '–', '▪', '•', '–'];
function numberLabel(n, lv) {
  if (lv % 3 === 1) return String.fromCharCode(96 + ((n - 1) % 26) + 1) + ')';   // a) b)
  if (lv % 3 === 2) return ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][(n - 1) % 10] + '.';
  return n + '.';
}

// 단락 속성: { list:'bullet'|'number', lv:0~4, cont:true(목록 줄 이어쓰기), align, sb, sa }
export function paragraphsHTML(n, assets, mode) {
  const paras = splitParagraphs(n.runs);
  const meta = n.paras || [];
  const counters = [];
  const s = n.style || {};
  return paras.map((runs, i) => {
    const p = meta[i] || {};
    const lv = Math.max(0, Math.min(4, p.lv || 0));
    let marker = '';
    if (p.list === 'number') {
      counters.length = lv + 1;
      counters[lv] = (counters[lv] || 0) + 1;
      marker = numberLabel(counters[lv], lv);
    } else {
      if (!p.cont) counters.length = p.list ? lv : 0;
      if (p.list === 'bullet') marker = BULLETS[lv];
    }
    const listy = p.list || p.cont;
    const st = [];
    const indent = lv * 18 + (listy ? 14 : 0);
    if (indent) st.push('padding-left:' + indent + 'px');
    if (p.align) st.push('text-align:' + p.align);
    const sb = p.sb != null ? p.sb : (i ? s.paraSpace || 0 : 0);
    if (sb) st.push('margin-top:' + sb + 'px');
    if (p.sa) st.push('margin-bottom:' + p.sa + 'px');
    const attrs = [`class="p${listy ? ' li' : ''}"`];
    if (p.list) attrs.push(`data-list="${p.list}"`);
    if (lv) attrs.push(`data-lv="${lv}"`);
    if (p.cont) attrs.push('data-cont="1"');
    if (p.align) attrs.push(`data-align="${p.align}"`);
    if (marker) attrs.push(`data-m="${esc(marker)}"`);
    if (st.length) attrs.push(`style="${st.join(';')}"`);
    const body = runsHTML(runs, assets, mode);
    return `<div ${attrs.join(' ')}>${body || '<br>'}</div>`;
  }).join('');
}

export function textStyle(s = {}) {
  const st = [];
  if (s.size) st.push('font-size:' + s.size + 'px');
  if (s.color) st.push('color:' + C(s.color));
  if (s.bold) st.push('font-weight:700');
  if (s.italic) st.push('font-style:italic');
  if (s.underline) st.push('text-decoration:underline');
  if (s.align) st.push('text-align:' + s.align);
  if (s.lineHeight) st.push('line-height:' + s.lineHeight);
  st.push('font-family:' + (FONTS[s.font] || FONTS.m));
  if (s.nowrap) st.push('white-space:pre');
  if (s.letter) st.push('letter-spacing:' + s.letter + 'px');
  if (s.shadow) st.push('text-shadow:0 1px 2px rgba(0,0,0,.35)');
  if (s.vertical) st.push('writing-mode:vertical-rl');
  const pad = s.pad;
  if (pad != null && pad !== 0) st.push('padding:' + (Array.isArray(pad) ? pad.map((v) => v + 'px').join(' ') : pad + 'px'));
  return st.join(';');
}

const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

function transformOf(n) {
  const t = [];
  if (n.rotation) t.push(`rotate(${n.rotation}deg)`);
  return t.join(' ');
}

// ctx: { doc, idx, mode:'edit'|'present', instanceDepth, overrides, frameId }
export function renderNode(n, ctx) {
  const o = (ctx.overrides && ctx.overrides[n.id]) || null;
  if (o) n = Object.assign({}, n, o);
  const el = h('div', 'node n-' + n.type);
  if (ctx.instRoot) { el.dataset.mid = n.id; el.dataset.inst = ctx.instRoot; }
  else el.dataset.id = n.id;
  if (n.hidden) el.classList.add('is-hidden');
  if (n.locked) el.classList.add('is-locked');
  const st = el.style;
  st.left = (n.x || 0) + 'px';
  st.top = (n.y || 0) + 'px';
  if (n.type !== 'group' && n.type !== 'connector') { st.width = n.w + 'px'; st.height = n.h + 'px'; }
  if (n.opacity != null && n.opacity !== 1) st.opacity = n.opacity;
  if (n.blend) st.mixBlendMode = n.blend;   // 'multiply': 흰 바탕이 투명하게 (PDF 배경 이미지)
  if (n.clip) st.clipPath = `inset(${n.clip[0] || 0}px 0 ${n.clip[1] || 0}px 0)`;
  if (n.type !== 'group' && n.type !== 'connector') { const tf = transformOf(n); if (tf) st.transform = tf; }
  if (n.shadow && n.type !== 'shape') st.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,.28))';

  switch (n.type) {
    case 'text': {
      const s = n.style || {};
      if (s.bg) st.background = C(s.bg);
      if (s.border) st.boxShadow = `inset 0 0 0 ${s.borderWidth || 1}px ${C(s.border)}`;
      el.style.justifyContent = VALIGN[s.valign] || 'flex-start';
      if (s.fit === 'grow') { st.height = 'auto'; el.classList.add('fit-grow'); }
      if (s.fit === 'shrink') el.classList.add('fit-shrink');
      const tx = h('div', 'tx', textStyle(s));
      tx.innerHTML = paragraphsHTML(n, ctx.doc.assets, ctx.mode);
      el.appendChild(tx);
      break;
    }
    case 'image': renderImage(el, n, ctx); break;
    case 'shape':
      el.appendChild(shapeSVG(n));
      if (n.shadow) st.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,.28))';
      if (hasText(n.runs)) el.appendChild(shapeLabel(n, ctx));
      else if (!n.fill || n.fill === 'none') el.classList.add('nofill');
      break;
    case 'table': el.appendChild(tableEl(n, ctx)); st.height = 'auto'; st.minHeight = n.h + 'px'; break;
    case 'connector': el.appendChild(connectorSVG(n, ctx)); break;
    case 'description': {
      if (n.marker === false) el.classList.add('no-marker');   // 패널에만 보이는 Description
      el.style.setProperty('--dc', C(n.color || '#e53935'));
      el.innerHTML = `<span>${esc(n.num)}</span>`;
      el.title = (n.title || '') + (n.body ? '\n' + n.body : '');
      break;
    }
    case 'hotspot': {
      const a = n.action || {};
      let label = '인터랙션';
      if (a.type === 'goto') { const f = ctx.idx && ctx.idx.get(a.target); label = '→ ' + (f ? f.name : '프레임 선택 필요'); }
      else if (a.type === 'url') label = '↗ ' + (a.url || '링크');
      else if (a.type === 'note') label = '💬 ' + (a.note || '메모').slice(0, 20);
      el.innerHTML = `<em>${esc(label)}</em>`;
      break;
    }
    case 'group':
      for (const c of n.children || []) el.appendChild(renderNode(c, ctx));
      break;
    case 'instance': {
      const comp = ctx.doc.components.find((c) => c.id === n.component);
      if (!comp || (ctx.instanceDepth || 0) > 6) { el.classList.add('inst-missing'); el.textContent = comp ? '중첩이 너무 깊음' : '컴포넌트 없음'; break; }
      const inner = h('div', 'inst-inner', `width:${comp.w}px;height:${comp.h}px;transform:scale(${n.w / comp.w},${n.h / comp.h})`);
      // 바깥 인스턴스의 오버라이드가 우선 → 안쪽 인스턴스 오버라이드 순서로 합친다
      const ov = Object.assign({}, n.overrides || {}, ctx.instRoot ? (ctx.overrides || {}) : {});
      const sub = Object.assign({}, ctx, { instanceDepth: (ctx.instanceDepth || 0) + 1, overrides: ov, instRoot: ctx.instRoot || n.id });
      for (const c of comp.nodes) inner.appendChild(renderNode(c, sub));
      el.appendChild(inner);
      break;
    }
  }
  return el;
}

// ---------- 이미지: 자르기 · 모양 · 테두리 ----------
function renderImage(el, n, ctx) {
  const a = ctx.doc.assets[n.asset];
  if (!a) { el.classList.add('img-missing'); return; }
  const box = h('div', 'img-box');
  if (n.mask === 'ellipse') box.style.borderRadius = '50%';
  else if (n.radius) box.style.borderRadius = n.radius + 'px';
  const img = h('img');
  img.src = a.data; img.alt = n.name || ''; img.draggable = false;
  const c = n.crop;
  if (c && (c.l || c.t || c.r || c.b)) {
    const fw = n.w / Math.max(.01, 1 - (c.l || 0) - (c.r || 0)), fh = n.h / Math.max(.01, 1 - (c.t || 0) - (c.b || 0));
    img.style.cssText = `position:absolute;left:${-(c.l || 0) * fw}px;top:${-(c.t || 0) * fh}px;width:${fw}px;height:${fh}px;max-width:none;object-fit:fill`;
  } else img.style.objectFit = n.fit || 'contain';
  const flip = [n.flipH ? 'scaleX(-1)' : '', n.flipV ? 'scaleY(-1)' : ''].join(' ').trim();
  if (flip) box.style.transform = flip;
  box.appendChild(img);
  el.appendChild(box);
  if (n.stroke && n.stroke !== 'none' && n.strokeWidth !== 0) {
    const b = h('div', 'img-border', `border:${n.strokeWidth || 1}px solid ${C(n.stroke)};border-radius:${n.mask === 'ellipse' ? '50%' : (n.radius || 0) + 'px'}`);
    el.appendChild(b);
  }
}

// ---------- 도형 라이브러리 ----------
export const SHAPE_NAME = Object.fromEntries(SHAPES.map((s) => [s[0], s[1]]));

const P = (pts) => 'M' + pts.map((p) => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L') + ' Z';
function star(w, h, n, inner) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? inner : 1, a = -Math.PI / 2 + i * Math.PI / n;
    pts.push([w / 2 + Math.cos(a) * w / 2 * r, h / 2 + Math.sin(a) * h / 2 * r]);
  }
  return P(pts);
}
function roundRectPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}

// 도형 외곽선 (SVG path). tail: 말풍선 꼬리 끝 [x비율, y비율]
export function shapePath(shape, w, h, n = {}) {
  const m = Math.min(w, h);
  switch (shape) {
    case 'ellipse': return `M${w / 2} 0 A${w / 2} ${h / 2} 0 1 1 ${w / 2 - .01} 0 Z`;
    case 'roundRect': return roundRectPath(0, 0, w, h, n.radius != null && n.radius > 0 ? n.radius : m * .18);
    case 'triangle': return P([[w / 2, 0], [w, h], [0, h]]);
    case 'rtTriangle': return P([[0, 0], [w, h], [0, h]]);
    case 'diamond': case 'decision': return P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case 'parallelogram': case 'data': { const k = Math.min(w * .25, h * .6); return P([[k, 0], [w, 0], [w - k, h], [0, h]]); }
    case 'trapezoid': { const k = Math.min(w * .22, h); return P([[k, 0], [w - k, 0], [w, h], [0, h]]); }
    case 'hexagon': { const k = Math.min(w * .25, h * .5); return P([[k, 0], [w - k, 0], [w, h / 2], [w - k, h], [k, h], [0, h / 2]]); }
    case 'octagon': { const k = m * .29; return P([[k, 0], [w - k, 0], [w, k], [w, h - k], [w - k, h], [k, h], [0, h - k], [0, k]]); }
    case 'star5': return star(w, h, 5, .42);
    case 'plus': { const a = w * .32, b = h * .32; return P([[a, 0], [w - a, 0], [w - a, b], [w, b], [w, h - b], [w - a, h - b], [w - a, h], [a, h], [a, h - b], [0, h - b], [0, b], [a, b]]); }
    case 'callout': case 'calloutRound': case 'calloutOval': {
      const t = n.tail || [.22, 1.35];
      const tx = t[0] * w, ty = t[1] * h;
      const bh = h;
      if (shape === 'calloutOval') {
        // 원 + 꼬리
        const cx = w / 2, cy = bh / 2, ang = Math.atan2(ty - cy, tx - cx), sp = .22;
        const p1 = [cx + Math.cos(ang - sp) * w / 2, cy + Math.sin(ang - sp) * bh / 2], p2 = [cx + Math.cos(ang + sp) * w / 2, cy + Math.sin(ang + sp) * bh / 2];
        return `M${p2[0]} ${p2[1]} A${w / 2} ${bh / 2} 0 1 1 ${p1[0]} ${p1[1]} L${tx} ${ty} Z`;
      }
      const r = shape === 'calloutRound' ? Math.min(m * .2, 12) : 0;
      // 꼬리가 나가는 변: 아래(기본) · 위 · 왼쪽 · 오른쪽
      const side = ty > bh ? 's' : ty < 0 ? 'n' : tx < 0 ? 'w' : 'e';
      const bw = Math.max(8, Math.min(w, h) * .18);
      const along = side === 's' || side === 'n' ? Math.max(r + 2, Math.min(w - r - bw - 2, tx - bw / 2)) : Math.max(r + 2, Math.min(bh - r - bw - 2, ty - bw / 2));
      const seg = [];
      seg.push(`M${r} 0`);
      if (side === 'n') seg.push(`H${along} L${tx} ${ty} L${along + bw} 0`);
      seg.push(`H${w - r}`); if (r) seg.push(`A${r} ${r} 0 0 1 ${w} ${r}`);
      if (side === 'e') seg.push(`V${along} L${tx} ${ty} L${w} ${along + bw}`);
      seg.push(`V${bh - r}`); if (r) seg.push(`A${r} ${r} 0 0 1 ${w - r} ${bh}`);
      if (side === 's') seg.push(`H${along + bw} L${tx} ${ty} L${along} ${bh}`);
      seg.push(`H${r}`); if (r) seg.push(`A${r} ${r} 0 0 1 0 ${bh - r}`);
      if (side === 'w') seg.push(`V${along + bw} L${tx} ${ty} L0 ${along}`);
      seg.push(`V${r}`); if (r) seg.push(`A${r} ${r} 0 0 1 ${r} 0`);
      return seg.join(' ') + ' Z';
    }
    case 'arrowR': { const hw = Math.min(w * .45, h), s = h * .25; return P([[0, s], [w - hw, s], [w - hw, 0], [w, h / 2], [w - hw, h], [w - hw, h - s], [0, h - s]]); }
    case 'arrowL': { const hw = Math.min(w * .45, h), s = h * .25; return P([[w, s], [hw, s], [hw, 0], [0, h / 2], [hw, h], [hw, h - s], [w, h - s]]); }
    case 'arrowU': { const hh = Math.min(h * .45, w), s = w * .25; return P([[s, h], [s, hh], [0, hh], [w / 2, 0], [w, hh], [w - s, hh], [w - s, h]]); }
    case 'arrowD': { const hh = Math.min(h * .45, w), s = w * .25; return P([[s, 0], [w - s, 0], [w - s, h - hh], [w, h - hh], [w / 2, h], [0, h - hh], [s, h - hh]]); }
    case 'chevron': { const k = Math.min(w * .4, h * .5); return P([[0, 0], [w - k, 0], [w, h / 2], [w - k, h], [0, h], [k, h / 2]]); }
    case 'pentagon': { const k = Math.min(w * .4, h * .5); return P([[0, 0], [w - k, 0], [w, h / 2], [w - k, h], [0, h]]); }
    case 'terminator': return roundRectPath(0, 0, w, h, h / 2);
    case 'document': { const a = h * .12; return `M0 0 H${w} V${h - a} C${w * .75} ${h - 3 * a} ${w * .5} ${h + a} ${w * .25} ${h} S0 ${h - a} 0 ${h - a} Z`; }
    case 'predefined': case 'process': case 'rect': default: return `M0 0 H${w} V${h} H0 Z`;
    case 'cylinder': { const e = Math.min(h * .14, w * .25); return `M0 ${e} A${w / 2} ${e} 0 0 1 ${w} ${e} V${h - e} A${w / 2} ${e} 0 0 1 0 ${h - e} Z`; }
    case 'manualInput': return P([[0, h * .25], [w, 0], [w, h], [0, h]]);
  }
}
// 외곽선 위에 덧그리는 선 (원통 윗면 · 정의된 처리의 세로줄)
function shapeExtra(shape, w, h) {
  if (shape === 'cylinder') { const e = Math.min(h * .14, w * .25); return `M0 ${e} A${w / 2} ${e} 0 0 0 ${w} ${e}`; }
  if (shape === 'predefined') { const k = Math.min(w * .1, 14); return `M${k} 0 V${h} M${w - k} 0 V${h}`; }
  return '';
}

function shapeSVG(n) {
  const sw = n.stroke && n.stroke !== 'none' ? (n.strokeWidth == null ? 1 : n.strokeWidth) : 0;
  const w = Math.max(.1, n.w), hh = Math.max(.1, n.h);
  const shape = n.shape === 'rect' && n.radius ? 'roundRect' : (n.shape || 'rect');
  const d = shapePath(shape, w, hh, n);
  const extra = shapeExtra(shape, w, hh);
  let fill = !n.fill || n.fill === 'none' ? 'none' : C(n.fill);
  let defs = '';
  if (n.gradient && fill !== 'none') {
    const gid = 'g' + String(n.id).replace(/[^\w-]/g, '');
    const ang = ((n.gradient.angle == null ? 90 : n.gradient.angle) - 90) * Math.PI / 180;
    const x2 = .5 + Math.cos(ang) * .5, y2 = .5 + Math.sin(ang) * .5;
    defs = `<defs><linearGradient id="${gid}" x1="${1 - x2}" y1="${1 - y2}" x2="${x2}" y2="${y2}"><stop offset="0" style="stop-color:${fill}"/><stop offset="1" style="stop-color:${C(n.gradient.to || '#ffffff')}"/></linearGradient></defs>`;
    fill = `url(#${gid})`;
  }
  const stroke = sw ? C(n.stroke) : 'none';
  const dash = DASH[n.dash] ? `stroke-dasharray:${DASH[n.dash]};` : '';
  const fo = n.fillOpacity != null && n.fillOpacity !== 1 ? `fill-opacity:${n.fillOpacity};` : '';
  const flip = (n.flipH || n.flipV) ? ` transform="translate(${n.flipH ? w : 0} ${n.flipV ? hh : 0}) scale(${n.flipH ? -1 : 1} ${n.flipV ? -1 : 1})"` : '';
  const base = `style="fill:${fill};${fo}stroke:${stroke};stroke-width:${sw}px;${dash}" vector-effect="non-scaling-stroke" stroke-linejoin="round"`;
  // 채우기가 없는 도형(주석 박스 등)은 테두리만 눌리게: 안쪽을 누르면 아래 요소가 선택된다
  const hit = fill === 'none' ? `<path class="shp-hit" d="${d}" style="fill:none;stroke:transparent;stroke-width:8px"/>` : '';
  const ex = extra ? `<path d="${extra}" style="fill:none;stroke:${stroke};stroke-width:${sw}px" vector-effect="non-scaling-stroke"/>` : '';
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}" overflow="visible">${defs}<g${flip}><path d="${d}" ${base}/>${ex}${hit}</g></svg>`;
  return wrap.firstChild;
}

function shapeLabel(n, ctx) {
  const s = n.style || {};
  const box = h('div', 'shp-label', 'justify-content:' + (VALIGN[s.valign || 'middle']));
  const tx = h('div', 'tx', textStyle(Object.assign({ align: 'center', pad: [0, 6] }, s)));
  tx.innerHTML = paragraphsHTML(n, ctx.doc.assets, ctx.mode);
  box.appendChild(tx);
  return box;
}

// ---------- 표 ----------
function tableEl(n, ctx) {
  const s = n.style || {};
  const t = h('table', 'tb tb-' + (s.border || 'grid'), `width:${n.cols.reduce((a, b) => a + b, 0)}px;font-size:${s.size || 9}px;color:${C(s.color || '#222')};font-family:${FONTS[s.font] || FONTS.m};--bc:${C(s.borderColor || '#bfbfbf')}`);
  if (s.topRule) t.style.borderTop = s.topRule + 'px solid #000';
  const cg = h('colgroup');
  for (const w of n.cols) cg.appendChild(h('col', '', 'width:' + w + 'px'));
  t.appendChild(cg);
  n.rows.forEach((r, ri) => {
    const tr = h('tr', '', 'height:' + r.h + 'px');
    r.cells.forEach((c, ci) => {
      if (!c) return;   // 병합으로 가려진 칸
      const td = h('td');
      td.dataset.r = ri; td.dataset.c = ci;
      if (c.span) { if (c.span[0] > 1) td.colSpan = c.span[0]; if (c.span[1] > 1) td.rowSpan = c.span[1]; }
      const cs = [];
      if (c.bg) cs.push('background:' + C(c.bg));
      cs.push('text-align:' + (c.align || 'left'));
      if (c.valign) cs.push('vertical-align:' + c.valign);
      if (c.bold) cs.push('font-weight:700');
      if (c.color) cs.push('color:' + C(c.color));
      if (c.size) cs.push('font-size:' + c.size + 'px');
      const pad = c.pad != null ? c.pad : (s.pad != null ? s.pad : 5);
      cs.push('padding:1px ' + Math.min(pad, 5) + 'px 1px ' + pad + 'px');
      if (c.borders) for (const side of ['top', 'right', 'bottom', 'left']) { const b = c.borders[side[0]]; if (b != null) cs.push(`border-${side}:${b ? (b.w || 1) + 'px solid ' + C(b.c || '#999') : '0'}`); }
      td.style.cssText = cs.join(';');
      td.innerHTML = runsHTML(c.runs, ctx.doc.assets, ctx.mode);
      tr.appendChild(td);
    });
    t.appendChild(tr);
  });
  return t;
}

// ---------- 연결선 ----------
const SIDE_DIR = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
export function sidePoint(b, side) {
  if (side === 'n') return [b.x + b.w / 2, b.y];
  if (side === 's') return [b.x + b.w / 2, b.y + b.h];
  if (side === 'e') return [b.x + b.w, b.y + b.h / 2];
  return [b.x, b.y + b.h / 2];
}
// 연결선: 끝점이 노드에 붙어 있으면 그 노드의 연결점(상하좌우) 또는 테두리까지 이어서 그린다
export function resolvePoints(n, ctx) {
  const pts = (n.pts || []).map((p) => p.slice());
  if (pts.length < 2 || !ctx.idx) return pts;
  const off = ctx.instRoot ? { x: 0, y: 0 } : ctx.idx.offsetOf(n.id);
  const ox = off.x + (n.x || 0), oy = off.y + (n.y || 0);
  const attach = (end, i, j) => {
    const ref = n[end];
    if (!ref || !ref.node) return;
    const t = ctx.idx.get(ref.node);
    if (!t || ctx.instRoot) return;
    const b = frameBounds(t, ctx.idx);
    const p = ref.side ? sidePoint(b, ref.side) : edgePoint(b, [pts[j][0] + ox, pts[j][1] + oy]);
    pts[i] = [p[0] - ox, p[1] - oy];
  };
  attach('from', 0, 1);
  attach('to', pts.length - 1, pts.length - 2);
  return pts;
}

// 상자 중심에서 목표점 방향으로 나가는 선이 테두리와 만나는 점
export function edgePoint(b, p) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = p[0] - cx, dy = p[1] - cy;
  if (!dx && !dy) return [cx, cy];
  const sx = dx ? (b.w / 2) / Math.abs(dx) : Infinity, sy = dy ? (b.h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy, 1);
  return [cx + dx * s, cy + dy * s];
}

// 꺾은선: 연결점 방향을 알면 그 방향으로 빠져나갔다가 들어온다
export function routePoints(n, pts) {
  if (n.route !== 'elbow' || pts.length < 2) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const sa = n.from && n.from.side, sb = n.to && n.to.side;
  const G = 14;
  if (sa || sb) {
    const da = SIDE_DIR[sa] || (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? [Math.sign(b[0] - a[0]) || 1, 0] : [0, Math.sign(b[1] - a[1]) || 1]);
    const db = SIDE_DIR[sb] || [-da[0], -da[1]];
    const a2 = [a[0] + da[0] * G, a[1] + da[1] * G], b2 = [b[0] + db[0] * G, b[1] + db[1] * G];
    const out = [a, a2];
    const horizA = da[0] !== 0, horizB = db[0] !== 0;
    if (horizA && horizB) { const mx = (a2[0] + b2[0]) / 2; out.push([mx, a2[1]], [mx, b2[1]]); }
    else if (!horizA && !horizB) { const my = (a2[1] + b2[1]) / 2; out.push([a2[0], my], [b2[0], my]); }
    else if (horizA) out.push([b2[0], a2[1]]);
    else out.push([a2[0], b2[1]]);
    out.push(b2, b);
    return out.filter((p, i) => !i || Math.abs(p[0] - out[i - 1][0]) > .01 || Math.abs(p[1] - out[i - 1][1]) > .01);
  }
  if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) {
    const mx = (a[0] + b[0]) / 2;
    return [a, [mx, a[1]], [mx, b[1]], b];
  }
  const my = (a[1] + b[1]) / 2;
  return [a, [a[0], my], [b[0], my], b];
}

export const CAPS = [['none', '없음'], ['arrow', '화살표'], ['open', '열린 화살표'], ['diamond', '마름모'], ['dot', '점'], ['circle', '빈 원']];

function connectorSVG(n, ctx) {
  const pts = routePoints(n, resolvePoints(n, ctx));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = 10;
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - x0 + pad, hh = Math.max(...ys) - y0 + pad;
  const color = C(n.stroke || '#e53935'), sw = n.width || 1, k = n.capSize || 1;
  const X = (p) => (p[0] - x0).toFixed(1), Y = (p) => (p[1] - y0).toFixed(1);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p) + ' ' + Y(p)).join(' ');
  const cap = (type, tip, from) => {
    if (!type || type === 'none') return '';
    const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
    const L = (4 + sw * 2) * k, W = (2.6 + sw) * k;
    const pt = (dl, dw) => [tip[0] - Math.cos(ang) * dl - Math.sin(ang) * dw, tip[1] - Math.sin(ang) * dl + Math.cos(ang) * dw];
    const S = (q) => (q[0] - x0).toFixed(1) + ',' + (q[1] - y0).toFixed(1);
    if (type === 'arrow') return `<polygon points="${S(tip)} ${S(pt(L, W))} ${S(pt(L, -W))}" style="fill:${color}"/>`;
    if (type === 'open') return `<polyline points="${S(pt(L, W))} ${S(tip)} ${S(pt(L, -W))}" style="fill:none;stroke:${color};stroke-width:${sw}px" stroke-linejoin="round"/>`;
    if (type === 'diamond') return `<polygon points="${S(tip)} ${S(pt(L * .8, W * .8))} ${S(pt(L * 1.6, 0))} ${S(pt(L * .8, -W * .8))}" style="fill:${color}"/>`;
    if (type === 'dot') return `<circle cx="${X(tip)}" cy="${Y(tip)}" r="${(1.6 + sw) * k}" style="fill:${color}"/>`;
    if (type === 'circle') return `<circle cx="${X(tip)}" cy="${Y(tip)}" r="${(1.8 + sw) * k}" style="fill:#fff;stroke:${color};stroke-width:${sw}px"/>`;
    return '';
  };
  const caps = cap(n.startCap, pts[0], pts[1]) + cap(n.endCap, pts[pts.length - 1], pts[pts.length - 2]);
  const dash = DASH[n.dash] ? `stroke-dasharray:${DASH[n.dash]};` : '';
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg class="conn" style="left:${x0}px;top:${y0}px" width="${w}" height="${hh}"><path class="hit" d="${d}"/><path d="${d}" style="fill:none;stroke:${color};stroke-width:${sw}px;${dash}" stroke-linejoin="round"/>${caps}</svg>`;
  return wrap.firstChild;
}

// 프레임 안 Description 노드 (그룹 안까지)
export function collectDescriptions(nodes, out = []) {
  for (const n of nodes) {
    if (n.hidden) continue;
    if (n.type === 'description') out.push(n);
    else if (n.type === 'group') collectDescriptions(n.children || [], out);
  }
  return out.sort((a, b) => (+a.num || 0) - (+b.num || 0));
}

// 프레임 한 장
export function renderFrame(frame, ctx) {
  const el = h('div', 'frame layout-' + frame.layout, `width:${ctx.doc.size.w}px;height:${ctx.doc.size.h}px;${themeVars(ctx.doc)}`);
  el.dataset.frame = frame.id;
  if (frame.hidden) el.classList.add('frame-hidden');
  const chrome = h('div', 'chrome');
  chrome.innerHTML = renderChrome(ctx.doc, frame, { pageNo: ctx.pageNo, descriptions: collectDescriptions(frame.nodes) });
  el.appendChild(chrome);
  const layer = h('div', 'nodes');
  for (const n of frame.nodes) layer.appendChild(renderNode(n, Object.assign({}, ctx, { frameId: frame.id })));
  el.appendChild(layer);
  return el;
}

// 컴포넌트 원본 편집용 바탕
export function renderComponentStage(comp, ctx) {
  const el = h('div', 'frame frame-component', `width:${comp.w}px;height:${comp.h}px;${themeVars(ctx.doc)}`);
  el.dataset.frame = comp.id;
  const layer = h('div', 'nodes');
  for (const n of comp.nodes) layer.appendChild(renderNode(n, ctx));
  el.appendChild(layer);
  return el;
}

// 화면에 붙인 뒤 실행: "넘치면 글자 줄이기" 상자를 맞춘다
export function fitText(root) {
  root.querySelectorAll('.fit-shrink > .tx').forEach((tx) => {
    tx.style.zoom = '';
    tx.style.width = '';
    const box = tx.parentElement;
    const H = box.clientHeight, W = box.clientWidth;
    if (!H || tx.scrollHeight <= H + 1) return;
    let lo = .3, hi = 1;
    for (let i = 0; i < 8; i++) {
      const z = (lo + hi) / 2;
      tx.style.zoom = z; tx.style.width = (W / z) + 'px';
      if (tx.scrollHeight * z <= H + .5) lo = z; else hi = z;
    }
    tx.style.zoom = lo; tx.style.width = (W / lo) + 'px';
  });
}

export { bounds };
