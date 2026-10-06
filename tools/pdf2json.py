"""PDF 기획서 → Spec Studio 문서(JSON) 가져오기

  python spec-studio/tools/pdf2json.py 기획서.pdf -o spec-studio/samples/기획서.tnspec.json

기존 채팅 상세기획서 HTML 파이프라인(tools/pdfkit)을 그대로 재활용한다.
  · 페이지 종류 자동 판별 → 템플릿 레이아웃 (표지 · 개정 이력 · 기본 정책 · 간지 · 화면 설계 · THANK YOU · 빈 페이지)
  · 표 → 표 노드, 삽입 이미지 → 이미지 노드, 목업 글자 → 글 노드, 굵은 소제목 → 글 노드
  · 빨간 점선 박스 → 도형, 빨간 주석선(시작 점 · 화살표) → 연결선
  · 머리말 · Description 패널 · 꼬리말은 레이아웃이 다시 그리므로 배경에서 지움
  · 나머지 벡터 그림은 잠긴 "배경(PDF)" 이미지 노드
"""
import argparse, base64, datetime, hashlib, io, json, os, re, sys

import pymupdf
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pdfkit'))
import ann, frames, heads, imgx, mtext, tables  # noqa: E402

W, H = 960, 540
BG_SCALE = 2.0
SCHEMA, VERSION = 'toonation.spec', 1


def R(v):
    return round(v * 10) / 10


class Ids:
    def __init__(self, seed):
        self.n = 0
        self.seed = seed
    def __call__(self, prefix):
        self.n += 1
        return '%s_%s%04d' % (prefix, self.seed, self.n)


# ---------- 자원 ----------
class Assets:
    def __init__(self, ids):
        self.map, self.by_hash, self.ids = {}, {}, ids
    def add(self, im, fmt='WEBP', q=88, name=''):
        if im.mode == 'RGBA' and im.getextrema()[3][0] == 255: im = im.convert('RGB')
        if im.mode not in ('RGB', 'RGBA'): im = im.convert('RGBA' if 'A' in im.mode else 'RGB')
        buf = io.BytesIO()
        if fmt == 'WEBP': im.save(buf, 'WEBP', quality=q, method=6)
        else: im.save(buf, fmt)
        data = buf.getvalue()
        h = hashlib.sha1(data).hexdigest()
        if h in self.by_hash: return self.by_hash[h]
        aid = self.ids('img')
        mime = 'image/' + fmt.lower()
        self.map[aid] = {'mime': mime, 'data': 'data:%s;base64,%s' % (mime, base64.b64encode(data).decode()), 'w': im.width, 'h': im.height, 'name': name}
        self.by_hash[h] = aid
        return aid


def pil_xref(doc, xref):
    pix = pymupdf.Pixmap(doc, xref)
    sm = doc.xref_get_key(xref, 'SMask')
    try:
        if sm[0] == 'xref':
            if pix.alpha: pix = pymupdf.Pixmap(pix, 0)
            if pix.n > 3: pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
            pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, int(sm[1].split()[0])))
        elif pix.n - pix.alpha > 3:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    except Exception:
        info = doc.extract_image(xref)
        return Image.open(io.BytesIO(info['image'])).convert('RGBA')
    return Image.frombytes('RGBA' if pix.alpha else 'RGB', (pix.width, pix.height), pix.samples)


def render(page, scale, clip=None):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False, clip=clip)
    return Image.frombytes('RGB', (pix.width, pix.height), pix.samples)


# ---------- 페이지 종류 판별 ----------
def lines_of(page):
    out = []
    for b in page.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            sp = [s for s in l['spans'] if s['text'].strip()]
            if not sp: continue
            out.append({'bbox': pymupdf.Rect(l['bbox']), 'text': ''.join(s['text'] for s in l['spans']).strip(),
                        'size': max(s['size'] for s in sp), 'bold': all('Bold' in s['font'] or s['flags'] & 16 for s in sp), 'color': sp[0]['color']})
    return out


def luminance(page):
    hist = render(page, .1).convert('L').histogram()
    return sum(i * c for i, c in enumerate(hist)) / max(1, sum(hist))


def detect(page, pno, total, lines):
    text = ' '.join(l['text'] for l in lines)
    up = text.upper()
    if 'PAGE NAME' in up and 'DESCRIPTION' in up: return 'screen'
    if 'REVISION HISTORY' in up or ('VERSION' in up and '변경' in text and ('승인' in text or '작성' in text)): return 'history'
    if 'THANK YOU' in up: return 'end'
    dark = luminance(page) < 90
    if dark:
        if pno == 0: return 'cover'
        if any(re.fullmatch(r'\d{1,2}', l['text']) and l['size'] >= 30 for l in lines): return 'divider'
        return 'end' if pno == total - 1 else 'divider'
    if pno == 0: return 'cover'
    if '정책' in text and page.find_tables().tables: return 'policy'
    return 'blank'


# 레이아웃별 노드 영역 (이 밖은 레이아웃이 그린다)
AREAS = {
    'screen': ((0, 28, 752, 521), (18, 33, 300, 52)),
    'policy': ((0, 80, 960, 521), None),
    'history': ((0, 66, 960, 521), None),
    'blank': ((0, 0, 960, 521), None),
}


def chrome_boxes(layout):
    """배경 이미지에서 지울 레이아웃 부분 (PDF 좌표)"""
    foot = (0, 521, 960, 540)
    if layout == 'screen': return [(0, 0, 960, 52.5), (752, 0, 960, 540), foot]
    if layout in ('policy', 'history'): return [(0, 0, 960, 80 if layout == 'policy' else 66), foot]
    return [foot]


# ---------- 개정 이력: 줄 단위로 읽어 템플릿의 표준 개정 이력 표로 ----------
REV_COLS = [68, 68, 68, 480, 80, 80]                 # js/templates.js revisionTable() 과 같은 값
REV_HEIGHTS = [32, 19, 69, 79, 114, 22, 22, 23, 24, 23]
REV_HEAD = ['No.', 'Version', '변경일', '변경내용', '작성자', '승인자']


def history_rows(page, s):
    edges = [66]
    for w in REV_COLS: edges.append(edges[-1] + w)
    spans = []
    for b in page.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            for sp in l['spans']:
                t = sp['text'].strip()
                r = pymupdf.Rect(sp['bbox'])
                if t and r.y0 * s > 70 and r.y1 * s < 515 and sp['size'] < 20: spans.append((r, t))
    rows = []
    for r, t in sorted(spans, key=lambda x: ((x[0].y0 + x[0].y1) / 2, x[0].x0)):
        cy = (r.y0 + r.y1) / 2
        if rows and abs(rows[-1]['cy'] - cy) < 4: rows[-1]['s'].append((r, t))
        else: rows.append({'cy': cy, 's': [(r, t)]})
    out = []
    for row in rows:
        cells = [''] * 6
        for r, t in sorted(row['s'], key=lambda x: x[0].x0):
            cx = (r.x0 + r.x1) / 2 * s
            k = max(0, min(5, next((i for i in range(6) if edges[i] <= cx < edges[i + 1]), 5 if cx >= edges[6] else 0)))
            cells[k] = (cells[k] + ' ' + t).strip()
        if cells == REV_HEAD or sum(1 for c in cells if c in REV_HEAD) >= 3: continue   # 머리글 줄
        if not any(cells): continue
        out.append(cells)
    # 같은 번호 · 버전이 겹쳐 그려진 줄은 더 많이 채워진 쪽만
    best = {}
    for c in out:
        k = (c[0], c[1])
        if k not in best or sum(1 for x in c if x) > sum(1 for x in best[k] if x): best[k] = c
    seen, uniq = set(), []
    for c in out:
        k = (c[0], c[1])
        if k in seen: continue
        seen.add(k)
        uniq.append(best[k])
    return uniq


def revision_table(ids, rows):
    heights = REV_HEIGHTS[:]
    while len(heights) - 1 < len(rows): heights.append(23)
    head = [{'runs': [{'t': h}], 'bold': True, 'align': 'center', 'bg': '#a6a6a6', 'color': '#333333', 'size': 10} for h in REV_HEAD]
    body = []
    for i in range(len(heights) - 1):
        vals = rows[i] if i < len(rows) else [''] * 6
        body.append({'h': heights[i + 1], 'cells': [dict({'runs': [{'t': v}]}, **({} if ci == 3 else {'align': 'center'})) for ci, v in enumerate(vals)]})
    return {'id': ids('tab'), 'type': 'table', 'name': '개정 이력 표', 'x': 66, 'y': 71, 'w': sum(REV_COLS), 'h': sum(heights), 'cols': REV_COLS[:],
            'rows': [{'h': heights[0], 'cells': head}] + body,
            'style': {'border': 'dotted', 'borderColor': '#b3b3b3', 'topRule': 2, 'size': 8, 'color': '#333333', 'pad': 5}}


# ---------- 메인 ----------
def title_from_name(src):
    base = os.path.splitext(os.path.basename(src))[0]
    m = re.search(r'[_\s-]v(?:er)?\.?(\d+(?:\.\d+)*)$', base, re.I)
    ver = m.group(1) if m else None
    if m: base = base[:m.start()]
    return base.replace('_', ' ').strip(), ver


def convert(src, out_path, title=None, dividers=None):
    doc = pymupdf.open(src)          # 배경용 (글자 · 주석 · 이미지를 단계적으로 지움)
    pristine = pymupdf.open(src)     # 표 · 메타 추출용 (원본 그대로)
    seed = hashlib.sha1(os.path.basename(src).encode('utf-8')).hexdigest()[:4]
    ids = Ids(seed)
    assets = Assets(ids)
    total = len(doc)
    fname_title, fname_ver = title_from_name(src)
    dividers = list(dividers or [])
    warnings = []
    meta = {'title': title or fname_title, 'project': '', 'team': '', 'version': fname_ver or '0.1',
            'date': datetime.date.today().isoformat(), 'author': '', 'copyright': 'Toonation', 'source': os.path.basename(src)}
    pages, cur = [], None
    report = []

    def new_page(name):
        p = {'kind': 'page', 'id': ids('pg'), 'name': name, 'frames': []}
        pages.append(p)
        return p

    for pno in range(total):
        page, orig = doc[pno], pristine[pno]
        s = W / orig.rect.width
        lines = lines_of(orig)
        layout = detect(orig, pno, total, lines)
        frame = {'kind': 'frame', 'id': ids('fr'), 'name': '', 'layout': layout, 'props': {}, 'nodes': []}
        big = sorted(lines, key=lambda l: -l['size'])

        if layout == 'cover':
            if big: meta['title'] = title or big[0]['text']
            elif not title: warnings.append('표지 글자를 읽을 수 없어(이미지) 파일 이름을 제목으로 씀: ' + meta['title'])
            for l in lines:
                m = re.search(r'[Vv]er\.?\s*([\d.]+)\s*(\d{4}[-.]\d{2}[-.]\d{2})?', l['text'])
                if m:
                    meta['version'] = m.group(1)
                    if m.group(2): meta['date'] = m.group(2).replace('.', '-')
                elif l['bbox'].y0 * s > 400 and l['bbox'].y0 * s < 470 and not meta['team']:
                    meta['team'] = l['text']
            frame['name'] = '표지'
        elif layout == 'divider':
            nth = sum(1 for p in pages for f in p['frames'] if f['layout'] == 'divider')
            num = next((l['text'] for l in big if re.fullmatch(r'\d{1,2}', l['text'])), '%02d' % (nth + 1))
            ttl = next((l['text'] for l in big if l['text'] != num and len(l['text']) < 40 and 'CREATIVE' not in l['text'].upper()), None)
            if nth < len(dividers): ttl = dividers[nth]
            if not ttl:
                ttl = '장 제목'
                warnings.append('%d쪽 간지 제목을 읽을 수 없음(이미지) — --dividers 로 지정하거나 편집기에서 더블클릭해 입력' % (pno + 1))
            frame['props'] = {'number': num, 'title': ttl}
            frame['name'] = ttl
        elif layout == 'end':
            frame['name'] = 'THANK YOU'

        if layout == 'divider' or cur is None:
            cur = new_page(('%s %s' % (frame['props']['number'], frame['props']['title'])) if layout == 'divider' else '개요')

        if layout in AREAS:
            area, tbox = AREAS[layout]
            area_pdf = tuple(v / s for v in area)
            for mod in (frames, heads, imgx, mtext): mod.AREA = area_pdf
            for mod in (heads, mtext): mod.TITLE_BOX = tuple(v / s for v in tbox) if tbox else None
            nodes = []
            # 레이아웃 칸 읽기
            if layout == 'screen':
                hdr = [l for l in lines if l['bbox'].y1 * s < 29]
                pn = [l['text'] for l in hdr if 120 < l['bbox'].x0 * s < 678]
                pj = [l['text'] for l in hdr if l['bbox'].x0 * s > 758]
                st = [l['text'] for l in lines if tbox[0] <= l['bbox'].x0 * s <= tbox[2] and tbox[1] <= l['bbox'].y0 * s <= tbox[3] and l['bbox'].height * s > 10]
                if pn: frame['props']['pageName'] = pn[0]
                if pj and not meta['project']: meta['project'] = pj[0]
                if st: frame['props']['screenTitle'] = st[0]
                frame['name'] = frame['props'].get('pageName') or (st[0] if st else '화면 %d' % (pno + 1))
                # Description 패널에 적힌 글 → Description 노드 (번호 위치는 사용자가 옮겨 붙임)
                desc = [l for l in lines if l['bbox'].x0 * s > 757 and l['bbox'].y0 * s > 46 and l['bbox'].y1 * s < 521]
                rows = []
                for l in sorted(desc, key=lambda l: (l['bbox'].y0, l['bbox'].x0)):
                    if l['bbox'].x0 * s < 779 and re.fullmatch(r'\d{1,2}', l['text']): rows.append({'num': int(l['text']), 'lines': []})
                    elif rows: rows[-1]['lines'].append(l['text'])
                for i, r in enumerate(rows):
                    body = r['lines'][1:] if len(r['lines']) > 1 else []
                    nodes.append(('z9', {'id': ids('des'), 'type': 'description', 'name': 'Description %d' % r['num'], 'x': 732, 'y': R(58 + i * 22), 'w': 16, 'h': 16,
                                         'num': r['num'], 'title': r['lines'][0] if r['lines'] else '', 'body': '\n'.join(body), 'color': '#e53935', 'marker': False}))
            elif layout == 'policy':
                t = [l for l in big if l['bbox'].y0 * s < 80 and l['size'] * s >= 13]
                frame['props']['title'] = t[0]['text'] if t else '기본 정책'
                frame['name'] = frame['props']['title']
            elif layout == 'history':
                frame['name'] = 'Revision History'
            else:
                frame['name'] = (big[0]['text'][:30] if big else '페이지 %d' % (pno + 1))

            # 표 (원본에서)
            spans = tables.spans_of(orig)
            fills = tables.fills_of(orig)
            tlist = []
            if layout == 'history':
                rows = history_rows(orig, s)
                nodes.append(('z5', revision_table(ids, rows)))
                if rows and rows[-1][1]: meta['version'] = rows[-1][1]
                if rows and re.fullmatch(r'\d{4}-\d{2}-\d{2}', rows[-1][2]): meta['date'] = rows[-1][2]
            for t in ([] if layout == 'history' else orig.find_tables().tables):
                b = pymupdf.Rect(t.bbox)
                if b.width * s > 900 and b.height * s > 450: continue                     # 머리말+Description 격자 전체
                if layout == 'screen' and (b.y0 * s < 29 or b.x0 * s > 750): continue      # 머리말 · Description 칸
                if b.y1 * s < area[1] or b.y0 * s > area[3]: continue
                if len(t.rows) < 1 or b.width * s < 20: continue
                tlist.append(t)
            icon_cache = {}
            def icon(sp):
                x = sp.get('xref') or 0
                if not x: return None
                if x not in icon_cache:
                    try: icon_cache[x] = assets.add(pil_xref(pristine, x), 'PNG', name='icon')
                    except Exception: icon_cache[x] = None
                return icon_cache[x]
            style = {'border': 'dotted', 'borderColor': '#b3b3b3', 'topRule': 2} if layout == 'history' else ({'border': 'hlines', 'borderColor': '#e6ebf1'} if layout == 'policy' else None)
            avoid = [(60 / s, 66 / s, 915 / s, 512 / s)] if layout == 'history' else []
            for t in tlist:
                tb = tables.convert(orig, t, spans, fills, icon, R, s, style)
                nodes.append(('z5', dict({'id': ids('tab'), 'type': 'table', 'name': '표'}, **tb)))
                b = t.bbox
                avoid.append((b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2))
            # 빨간 주석 (원본에서 벡터로)
            for el in ann.extract(doc, [pno]).get(pno, []):
                if el['t'] == 'box':
                    nodes.append(('z7', {'id': ids('sha'), 'type': 'shape', 'name': '주석 박스', 'x': R(el['x'] * s), 'y': R(el['y'] * s), 'w': R(el['w'] * s), 'h': R(el['h'] * s),
                                         'shape': 'rect', 'fill': 'none', 'stroke': '#ff0000', 'strokeWidth': 1, 'dash': 'dash', 'radius': 0}))
                else:
                    nodes.append(('z8', {'id': ids('con'), 'type': 'connector', 'name': '주석선', 'x': 0, 'y': 0, 'pts': [[R(x * s), R(y * s)] for x, y in el['pts']],
                                         'stroke': '#ff0000', 'width': 1, 'dash': 'dash', 'route': 'straight', 'startCap': 'dot' if el['dot'] else 'none', 'endCap': 'arrow' if el['arrow'] else 'none'}))
            ann.strip(doc, pno)
            sid = frame['id']
            fr = frames.extract(doc, [(pno, sid)])
            ims, srcs, deletable = imgx.extract(doc, [(pno, sid, avoid)])
            keymap = {}
            for k, data in srcs.items():
                raw = base64.b64decode(data.split(',', 1)[1])
                keymap[k] = assets.add(Image.open(io.BytesIO(raw)), 'WEBP', 90, 'image')
            for o in ims.get(sid, []):
                nodes.append(('z3', {'id': ids('ima'), 'type': 'image', 'name': '이미지', 'x': R(o['x'] * s), 'y': R(o['y'] * s), 'w': R(o['w'] * s), 'h': R(o['h'] * s), 'asset': keymap[o['src']], 'fit': 'fill'}))
            imgx.strip(doc, deletable)
            hd = heads.extract(doc, [(pno, sid, avoid)], fr, ims)
            for h in hd.get(sid, []):
                nodes.append(('z6', {'id': ids('tex'), 'type': 'text', 'name': h['text'][:24], 'x': R(h['x'] * s - 1), 'y': R(h['y'] * s), 'w': R(h['w'] * s + 6), 'h': R(h['h'] * s),
                                     'runs': [{'t': h['text']}], 'style': {'size': R(h['size'] * s), 'color': h['color'], 'bold': True, 'nowrap': True, 'lineHeight': 1.15}}))
            mt = mtext.extract(doc, [(pno, sid, avoid)], ims, hd)
            for m in mt.get(sid, []):
                sp = m['spans']
                base = max(set((x['size'], x['color'], x['font'], x['b']) for x in sp), key=lambda k: sum(len(x['t']) for x in sp if (x['size'], x['color'], x['font'], x['b']) == k))
                runs = []
                for x in sp:
                    r = {'t': x['t']}
                    if x['b'] != base[3]: r['b'] = bool(x['b'])
                    if x['color'] != base[1]: r['color'] = x['color']
                    if abs(x['size'] - base[0]) > .3: r['size'] = R(x['size'] * s)
                    if x['font'] != base[2]: r['font'] = x['font']
                    if x['i']: r['i'] = True
                    if runs and {k: v for k, v in runs[-1].items() if k != 't'} == {k: v for k, v in r.items() if k != 't'}: runs[-1]['t'] += x['t']
                    else: runs.append(r)
                text = ''.join(x['t'] for x in sp).strip()
                node = {'id': ids('tex'), 'type': 'text', 'name': text[:24] or '텍스트', 'x': R(m['x'] * s - .5), 'y': R(m['y'] * s), 'w': R(m['w'] * s + 4), 'h': R(m['h'] * s),
                        'runs': runs, 'style': {'size': R(base[0] * s), 'color': base[1], 'font': base[2], 'nowrap': True, 'lineHeight': 1.15}}
                if base[3]: node['style']['bold'] = True
                if m.get('ct') or m.get('cb'): node['clip'] = [R(m['ct'] * s), R(m['cb'] * s)]
                nodes.append(('z6', node))
            mtext.strip(doc, pno)
            # 남은 벡터 그림 → 배경 이미지
            bg = render(page, BG_SCALE)
            dr = ImageDraw.Draw(bg)
            for x0, y0, x1, y1 in chrome_boxes(layout) + [tuple(a) for a in avoid]:
                dr.rectangle([x0 / s * BG_SCALE, y0 / s * BG_SCALE, x1 / s * BG_SCALE, y1 / s * BG_SCALE], fill=(255, 255, 255))
            g = bg.convert('L')
            ink = sum(g.histogram()[:245]) / (g.width * g.height)
            if ink > .0008:
                aid = assets.add(bg, 'WEBP', 84, 'PDF %d쪽 배경' % (pno + 1))
                nodes.insert(0, ('z0', {'id': ids('ima'), 'type': 'image', 'name': '배경(PDF %d쪽)' % (pno + 1), 'x': 0, 'y': 0, 'w': W, 'h': H, 'asset': aid, 'fit': 'fill', 'locked': True, 'blend': 'multiply'}))
            nodes.sort(key=lambda t: t[0])   # 겹침 순서: 배경 → 이미지 → 표 → 글 → 주석
            frame['nodes'] = [n for _, n in nodes]
        cur['frames'].append(frame)
        report.append('%2d쪽 %-8s %-24s 노드 %d' % (pno + 1, layout, frame['name'][:24], len(frame['nodes'])))

    out = {'schema': SCHEMA, 'version': VERSION, 'id': 'doc_' + seed + hashlib.sha1(src.encode('utf-8')).hexdigest()[4:12], 'meta': meta,
           'size': {'w': W, 'h': H}, 'pages': pages, 'components': [], 'assets': assets.map, 'rev': 0}
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    return out, report + ['※ ' + w for w in warnings]


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='PDF 기획서 → Spec Studio JSON')
    ap.add_argument('pdf')
    ap.add_argument('-o', '--out', help='출력 경로 (.tnspec.json)')
    ap.add_argument('--title', help='문서 제목 (기본: 표지에서 읽음)')
    ap.add_argument('--dividers', help='간지 제목을 순서대로, 쉼표로 구분 (글자가 이미지인 PDF용) 예: "프론트,관리자"')
    a = ap.parse_args()
    out_path = a.out or os.path.splitext(a.pdf)[0] + '.tnspec.json'
    doc, rep = convert(a.pdf, out_path, a.title, [x.strip() for x in a.dividers.split(',')] if a.dividers else None)
    sys.stdout.reconfigure(encoding='utf-8')
    print('\n'.join(rep))
    n = sum(len(f['nodes']) for p in doc['pages'] for f in p['frames'])
    print('→ %s  (페이지 %d · 프레임 %d · 노드 %d · 이미지 %d · %dKB)' % (out_path, len(doc['pages']), sum(len(p['frames']) for p in doc['pages']), n, len(doc['assets']), os.path.getsize(out_path) // 1024))
