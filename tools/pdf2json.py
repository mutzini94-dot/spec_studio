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

# ---------- 띄어쓰기 복원 ----------
# 한글 PDF 중에는 글자를 한 자씩 찍고 공백 문자를 넣지 않은 것이 많다 (예: "다날상품권구매").
# 글자 사이 간격이 글자 크기의 20%를 넘으면 공백으로 보고 되살린다. pdfkit 모듈은 모두 get_text('dict')를
# 쓰므로 여기 한 곳에서 고치면 제목 · 본문 · 표 · Description 모두에 적용된다.
SPACE_GAP = 0.2
SCREEN_TABLES = False   # 화면 설계 페이지의 목업 표도 표 노드로 바꿀지
_get_text = pymupdf.Page.get_text


def _get_text_spaced(self, option='text', *a, **k):
    if option != 'dict':
        return _get_text(self, option, *a, **k)
    d = _get_text(self, 'rawdict', *a, **k)
    for b in d['blocks']:
        if b['type'] != 0:
            continue
        for l in b['lines']:
            for s in l['spans']:
                cs = s.pop('chars', [])
                out = []
                for i, c in enumerate(cs):
                    if i and c['c'] != ' ' and out and out[-1] != ' ':
                        gap = c['bbox'][0] - cs[i - 1]['bbox'][2]
                        if gap > s['size'] * SPACE_GAP:
                            out.append(' ')
                    out.append(c['c'])
                s['text'] = ''.join(out)
    return d


pymupdf.Page.get_text = _get_text_spaced
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


def image_page(page, lines):
    """글자 없이 큰 그림 한 장뿐인 페이지 (화면 캡처를 PDF로 묶은 것)"""
    if lines or luminance(page) < 90:
        return False
    area = page.rect.width * page.rect.height
    return any(pymupdf.Rect(i['bbox']).get_area() > area * .1 for i in page.get_image_info())


def trim_white(im, pad=4):
    """가장자리 흰 여백을 잘라낸 그림과 잘린 상자 (그림 픽셀 좌표)"""
    g = im.convert('L').point(lambda v: 255 if v < 246 else 0)
    box = g.getbbox()
    if not box:
        return im, (0, 0, im.width, im.height)
    x0, y0, x1, y1 = max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad)
    return im.crop((x0, y0, x1, y1)), (x0, y0, x1, y1)


NUM_RE = re.compile(r'\d{1,2}(?:-\d{1,2})?')


def number_circles(page, lines, s, area):
    """화면 영역의 빨간(주황) 번호 원: 채워진 작은 원 + 안에 적힌 번호(1, 2, 1-1 …)"""
    spans = []
    for b in page.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            for sp in l['spans']:
                t = sp['text'].strip()
                if t: spans.append((pymupdf.Rect(sp['bbox']), t))
    out = []
    for dr in page.get_drawings():
        f = dr.get('fill')
        r = dr['rect']
        if not f or len(f) < 3 or not (f[0] > .75 and f[1] < .45 and f[2] < .35): continue
        if abs(r.width - r.height) > 2.5 or not (8 <= r.width * s <= 30): continue
        if r.x1 * s > W or r.y0 * s < area[1] or r.y1 * s > area[3]: continue   # 패널 위 팝업에 붙은 번호도
        if any(abs(o['rect'].x0 - r.x0) < 2 and abs(o['rect'].y0 - r.y0) < 2 for o in out): continue   # 채우기 · 테두리 중복
        inner = [t for rr, t in spans if r.x0 - 1 <= (rr.x0 + rr.x1) / 2 <= r.x1 + 1 and r.y0 - 1 <= (rr.y0 + rr.y1) / 2 <= r.y1 + 1]
        txt = ''.join(inner).replace(' ', '')
        if not NUM_RE.fullmatch(txt): continue
        size = R(r.width * s)
        out.append({'rect': r, 'x': R(r.x0 * s), 'y': R(r.y0 * s), 'size': size, 'text': txt,
                    'color': '#%02x%02x%02x' % tuple(int(round(v * 255)) for v in f[:3])})
    return out


def overlay_rects(page, s):
    """화면 영역에서 Description 패널 쪽으로 걸쳐 그려진 상자(팝업 · 툴팁 등)"""
    out = []
    for dr in page.get_drawings():
        r = dr['rect']
        if r.x0 * s < 745 and r.x1 * s > 760 and 60 < r.y0 * s and r.height * s < 380 and r.width * s < 500 and (dr.get('fill') or dr.get('color')):
            if not any(o.contains(r) for o in out):
                out = [o for o in out if not r.contains(o)] + [pymupdf.Rect(r)]
    return out


def panel_rows(page, desc, s):
    """Description 패널 칸 나누기: 패널의 가로 줄로 행 경계를 잡고, 번호가 든 행마다 줄을 모은다.
    (번호가 칸 위쪽 가운데에 있어 제목 줄이 번호보다 살짝 위에 오는 문서도 제자리에)"""
    ys = []
    for dr in page.get_drawings():
        for it in dr['items']:
            if it[0] == 'l':
                a, b = it[1], it[2]
                if abs(a.y - b.y) < .5 and min(a.x, b.x) * s > 745 and abs(a.x - b.x) * s > 100: ys.append(a.y)
            elif it[0] == 're':
                r = it[1]
                if r.x0 * s > 745 and r.width * s > 100:
                    ys.append(r.y0)
                    if r.height * s > 5: ys.append(r.y1)
    ys = sorted(y for y in ys if 44 / s < y < 526 / s)
    bands = []
    for y in ys:
        if not bands or y - bands[-1] > 1.5: bands.append(y)
    nums = [l for l in desc if l['bbox'].x0 * s < 779 and re.fullmatch(r'\d{1,2}', l['text'])]
    rest = [l for l in desc if l not in nums]
    cy = lambda l: (l['bbox'].y0 + l['bbox'].y1) / 2
    rows = []
    for n in sorted(nums, key=lambda l: l['bbox'].y0):
        top = max([y for y in bands if y <= n['bbox'].y0 + 1.5] or [n['bbox'].y0 - 2])
        bot = min([y for y in bands if y > n['bbox'].y0 + 1.5] or [526 / s])
        rows.append({'num': int(n['text']), 'top': top, 'bot': bot, 'lines': []})
    for i, r in enumerate(rows):   # 경계를 못 찾았으면 다음 번호까지
        if i + 1 < len(rows) and r['bot'] > rows[i + 1]['top']: r['bot'] = rows[i + 1]['top']
    for l in rest:
        r = next((r for r in rows if r['top'] - .5 <= cy(l) < r['bot']), None)
        if r: r['lines'].append(l)
    for r in rows:
        # 같은 높이의 줄(글머리 "•" 와 그 글)을 한 줄로 보고 왼쪽부터
        ls = sorted(r['lines'], key=cy)
        groups = []
        for l in ls:
            if groups and abs(cy(l) - groups[-1][0]) < max(2, l['bbox'].height * .45): groups[-1][1].append(l)
            else: groups.append([cy(l), [l]])
        r['lines'] = [l for _, g in groups for l in sorted(g, key=lambda l: l['bbox'].x0)]
    return rows


BULLETS = ('•', '·', '▪', '◦', '●')
ITEM_START = re.compile(r'^([-※└→*▶►]|\d+[.)]\s|\d+-\d+\s*:)')


def desc_body(lines):
    """Description 패널 본문 줄 → 항목 줄. 글머리("•", "1)")만 있는 줄은 다음 줄과 합치고,
    줄바꿈으로 잘린 줄(항목 글자 시작 위치에 맞춰 들여 쓴 줄)은 앞 항목에 잇는다."""
    right = max((l['bbox'].x1 for l in lines), default=0)
    in_list = lambda it: it.startswith('• ') or bool(ITEM_START.match(it)) or bool(re.match(r'\d{1,2}[.)] ', it))
    items, prefix, cont_x, item_x, prev = [], None, None, None, None
    for l in lines:
        t = l['text'].strip()
        x = l['bbox'].x0
        if t in BULLETS or re.fullmatch(r'\d{1,2}[.)]', t):
            prefix = '• ' if t in BULLETS else t + ' '
            continue
        if t[:1] in BULLETS:
            t, prefix = t[1:].strip(), '• '
        joined = False
        if prefix is None and items and not ITEM_START.match(t) and (
                (cont_x is not None and abs(x - cont_x) < 3) or (item_x is not None and item_x + 2 < x < item_x + 25)
                # 앞 줄이 칸 끝까지 찼으면 들여쓰기 없이 이어진 줄
                or (in_list(items[-1]) and prev is not None and prev['bbox'].x1 > right - prev['size'] * 2)):
            items[-1] += ' ' + t
            joined = True
        if not joined:
            if prefix is not None:
                items.append(prefix + t)
                cont_x, item_x = x, None
            else:
                items.append(t)
                cont_x, item_x = None, (x if ITEM_START.match(t) else None)
            prefix = None
        prev = l
    return '\n'.join(items)


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


def convert(src, out_path, title=None, dividers=None, part=None):
    """part: 큰 PDF를 쪽 묶음으로 나눠 보낼 때 이 묶음의 위치
       {'index': 묶음 번호, 'offset': 앞 묶음까지의 쪽 수, 'total': 전체 쪽 수, 'dividers': 앞까지 나온 간지 수, 'screens': 앞까지 나온 화면 캡처 수}
       (Vercel 함수는 요청 본문이 4.5MB로 제한돼 브라우저가 나눠 보낸다 — js/panels.js importFile)"""
    part = part or {}
    doc = pymupdf.open(src)          # 배경용 (글자 · 주석 · 이미지를 단계적으로 지움)
    pristine = pymupdf.open(src)     # 표 · 메타 추출용 (원본 그대로)
    seed = hashlib.sha1((os.path.basename(src) + ':%d' % part.get('index', 0)).encode('utf-8')).hexdigest()[:4]
    ids = Ids(seed)
    assets = Assets(ids)
    total = len(doc)
    offset, gtotal = part.get('offset', 0), part.get('total') or len(doc)
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
        gp = offset + pno   # 문서 전체에서의 쪽 번호
        s = W / orig.rect.width
        lines = lines_of(orig)
        is_img = image_page(orig, lines)
        layout = 'blank' if is_img else detect(orig, gp, gtotal, lines)
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
            nth = part.get('dividers', 0) + sum(1 for p in pages for f in p['frames'] if f['layout'] == 'divider')
            num = next((l['text'] for l in big if re.fullmatch(r'\d{1,2}', l['text'])), '%02d' % (nth + 1))
            ttl = next((l['text'] for l in big if l['text'] != num and len(l['text']) < 40 and 'CREATIVE' not in l['text'].upper()), None)
            if nth < len(dividers): ttl = dividers[nth]
            if not ttl:
                ttl = '장 제목'
                warnings.append('%d쪽 간지 제목을 읽을 수 없음(이미지) — --dividers 로 지정하거나 편집기에서 더블클릭해 입력' % (gp + 1))
            frame['props'] = {'number': num, 'title': ttl}
            frame['name'] = ttl
        elif layout == 'end':
            frame['name'] = 'THANK YOU'

        if layout == 'divider' or cur is None:
            cur = new_page(('%s %s' % (frame['props']['number'], frame['props']['title'])) if layout == 'divider' else '개요')

        try:
            if is_img:
                # 화면 캡처 페이지: 흰 여백을 잘라낸 화면 이미지 한 장 (잠그지 않음 → 바로 화면 프로토타입으로 바꿀 수 있게)
                crop, (x0, y0, x1, y1) = trim_white(render(orig, BG_SCALE))
                k = s / BG_SCALE
                aid = assets.add(crop, 'WEBP', 90, 'PDF %d쪽 화면' % (gp + 1))
                nth = part.get('screens', 0) + sum(1 for p in pages for f in p['frames'] if f.get('_img')) + 1
                frame['name'] = '화면 %d' % nth
                frame['_img'] = True
                frame['nodes'] = [{'id': ids('ima'), 'type': 'image', 'name': '화면 이미지 (PDF %d쪽)' % (gp + 1), 'x': R(x0 * k), 'y': R(y0 * k),
                                   'w': R((x1 - x0) * k), 'h': R((y1 - y0) * k), 'asset': aid, 'fit': 'fill'}]
            elif layout in AREAS:
                area, tbox = AREAS[layout]
                area_pdf = tuple(v / s for v in area)
                for mod in (frames, heads, imgx, mtext): mod.AREA = area_pdf
                for mod in (heads, mtext): mod.TITLE_BOX = tuple(v / s for v in tbox) if tbox else None
                nodes = []
                overlay_keep = []   # Description 패널 위로 걸친 팝업 등 (배경에서 지우지 않음)
                marker_rects = []   # 번호 원 자리 (PDF 좌표): 글 · 배경에서 빼고 노드로 다시 그린다
                # 레이아웃 칸 읽기
                if layout == 'screen':
                    hdr = [l for l in lines if l['bbox'].y1 * s < 29]
                    pn = [l['text'] for l in hdr if 120 < l['bbox'].x0 * s < 678]
                    pj = [l['text'] for l in hdr if l['bbox'].x0 * s > 758]
                    st = [l['text'] for l in lines if tbox[0] <= l['bbox'].x0 * s <= tbox[2] and tbox[1] <= l['bbox'].y0 * s <= tbox[3] and l['bbox'].height * s > 10]
                    if pn: frame['props']['pageName'] = pn[0]
                    if pj and not meta['project']: meta['project'] = pj[0]
                    if st: frame['props']['screenTitle'] = st[0]
                    frame['name'] = frame['props'].get('pageName') or (st[0] if st else '화면 %d' % (gp + 1))
                    # Description 패널에 적힌 글 → Description 노드 (번호 위치는 사용자가 옮겨 붙임)
                    overlays = overlay_rects(orig, s)
                    overlay_keep += overlays
                    desc = [l for l in lines if l['bbox'].x0 * s > 757 and l['bbox'].y0 * s > 46 and l['bbox'].y1 * s < 521
                            and not any(o.contains(l['bbox'].tl + (l['bbox'].br - l['bbox'].tl) * .5) for o in overlays)]
                    rows = panel_rows(orig, desc, s)
                    # 화면 위 빨간 번호 원 → 같은 번호 행과 짝지은 Description 노드 (pptx2json.link_descriptions 와 같은 규칙)
                    markers = number_circles(orig, lines, s, area)
                    marker_rects += [m['rect'] for m in markers]
                    used = set()
                    for i, r in enumerate(rows):
                        title = r['lines'][0]['text'] if r['lines'] else ''
                        d = {'id': ids('des'), 'type': 'description', 'name': 'Description %d' % r['num'], 'num': r['num'],
                             'title': title, 'body': desc_body(r['lines'][1:]), 'color': '#e53935'}
                        k = next((j for j, m in enumerate(markers) if j not in used and m['text'] == str(r['num'])), None)
                        if k is not None:
                            used.add(k)
                            m = markers[k]
                            d.update({'x': m['x'], 'y': m['y'], 'w': m['size'], 'h': m['size'], 'color': m['color']})
                        else:
                            d.update({'x': 732, 'y': R(58 + i * 22), 'w': 16, 'h': 16, 'marker': False})
                        nodes.append(('z9', d))
                    # 짝이 없는 원(1-1, 2-1 같은 하위 번호 등)은 고칠 수 있는 번호 도형으로
                    for j, m in enumerate(markers):
                        if j in used: continue
                        nodes.append(('z9', {'id': ids('sha'), 'type': 'shape', 'name': '번호 %s' % m['text'], 'shape': 'ellipse', 'x': m['x'], 'y': m['y'], 'w': m['size'], 'h': m['size'],
                                             'fill': m['color'], 'stroke': 'none', 'runs': [{'t': m['text']}],
                                             'style': {'size': R(min(9, m['size'] * (.5 if len(m['text']) <= 2 else .38))), 'color': '#ffffff', 'bold': True, 'align': 'center', 'valign': 'middle', 'pad': 0}}))
                elif layout == 'policy':
                    t = [l for l in big if l['bbox'].y0 * s < 80 and l['size'] * s >= 13]
                    frame['props']['title'] = t[0]['text'] if t else '기본 정책'
                    frame['name'] = frame['props']['title']
                elif layout == 'history':
                    frame['name'] = 'Revision History'
                else:
                    frame['name'] = (big[0]['text'][:30] if big else '페이지 %d' % (gp + 1))

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
                    # 화면 설계의 "표"는 대개 화면 목업(팝업 · 목록이 겹친 그림)이라 표로 바꾸면 칸이 엉킨다.
                    # 글은 글 노드, 선 · 칸 · 버튼은 배경으로 두는 편이 원본과 똑같다 (SCREEN_TABLES=True 면 표로)
                    if layout == 'screen' and not SCREEN_TABLES: continue
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
                n_avoid = len(avoid)   # 이 뒤에 더하는 표 자리와 달리 번호 원은 배경에서 원 모양으로만 지운다
                avoid += [(r.x0 - .5, r.y0 - .5, r.x1 + .5, r.y1 + .5) for r in marker_rects]
                # 표 밑에 깔린 화면 캡처 조각(버튼 등이 그려진 그림): 표 아래 이미지 노드로 그대로 둔다
                under = set()
                for t in tlist:
                    T = pymupdf.Rect(t.bbox)
                    cell = T.get_area() / max(1, sum(len(r.cells) for r in t.rows))
                    for info in orig.get_image_info(xrefs=True):
                        b = pymupdf.Rect(info['bbox'])
                        key = (info.get('xref'), tuple(round(v) for v in b))
                        if not info.get('xref') or key in under or b.get_area() < cell * 4 or (b & T).get_area() < b.get_area() * .25: continue
                        try: aid = assets.add(pil_xref(pristine, info['xref']), 'WEBP', 88, 'image')
                        except Exception: continue
                        under.add(key)
                        nodes.append(('z4', {'id': ids('ima'), 'type': 'image', 'name': '표 밑 그림', 'x': R(b.x0 * s), 'y': R(b.y0 * s), 'w': R(b.width * s), 'h': R(b.height * s), 'asset': aid, 'fit': 'fill'}))
                # 칸 안에 그려진 작은 채운 도형(버튼 · 배지 등): 표는 칸 배경만 알므로 표 바로 아래 도형으로 되살린다
                hexc = lambda c: '#%02x%02x%02x' % tuple(int(round(v * 255)) for v in c[:3])
                for t in tlist:
                    T = pymupdf.Rect(t.bbox)
                    cells = [pymupdf.Rect(c) for r in t.rows for c in r.cells if c]
                    for dr in orig.get_drawings():
                        r, f = dr['rect'], dr.get('fill')
                        if not f or r.width < 4 or r.height < 4 or not T.contains(r): continue
                        home = next((c for c in cells if c.contains(r)), None)
                        if not home or r.get_area() > home.get_area() * .7: continue          # 칸 배경은 표가 그린다
                        if min(r.x0 - home.x0, home.x1 - r.x1, r.y0 - home.y0, home.y1 - r.y1) < 1: continue   # 칸 테두리에 붙은 건 잘게 나뉜 칸 배경
                        if f[0] > .75 and f[1] < .45 and f[2] < .35 and abs(r.width - r.height) < 2.5: continue   # 번호 원
                        sh = {'id': ids('sha'), 'type': 'shape', 'name': '칸 안 도형', 'shape': 'rect', 'x': R(r.x0 * s), 'y': R(r.y0 * s), 'w': R(r.width * s), 'h': R(r.height * s),
                              'fill': hexc(f), 'stroke': hexc(dr['color']) if dr.get('color') else 'none', 'strokeWidth': R(dr.get('width') or 1) if dr.get('color') else 0,
                              'radius': R(min(r.width, r.height) * s * .18)}
                        nodes.append(('z45', sh))
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
                keep = [(bg.crop(box), box) for box in (tuple(int(round(v * BG_SCALE)) for v in (o.x0, o.y0, o.x1, o.y1)) for o in overlay_keep)]
                dr = ImageDraw.Draw(bg)
                circles = set(range(n_avoid, n_avoid + len(marker_rects)))
                for i, (x0, y0, x1, y1) in enumerate([tuple(a) for a in avoid]):
                    box = [x0 / s * BG_SCALE, y0 / s * BG_SCALE, x1 / s * BG_SCALE, y1 / s * BG_SCALE]
                    if i in circles: dr.ellipse(box, fill=(255, 255, 255))
                    else: dr.rectangle(box, fill=(255, 255, 255))
                for x0, y0, x1, y1 in chrome_boxes(layout):
                    dr.rectangle([x0 / s * BG_SCALE, y0 / s * BG_SCALE, x1 / s * BG_SCALE, y1 / s * BG_SCALE], fill=(255, 255, 255))
                for im, box in keep:
                    # 팝업의 패널 쪽 부분만 되살린다 (화면 쪽은 이미 글 · 이미지 노드로 뽑았다)
                    cut = int(round(752 / s * BG_SCALE))
                    if box[2] > cut:
                        bg.paste(im.crop((max(0, cut - box[0]), 0, im.width, im.height)), (max(box[0], cut), box[1]))
                g = bg.convert('L')
                ink = sum(g.histogram()[:245]) / (g.width * g.height)
                if ink > .0008:
                    aid = assets.add(bg, 'WEBP', 84, 'PDF %d쪽 배경' % (gp + 1))
                    nodes.insert(0, ('z0', {'id': ids('ima'), 'type': 'image', 'name': '배경(PDF %d쪽)' % (gp + 1), 'x': 0, 'y': 0, 'w': W, 'h': H, 'asset': aid, 'fit': 'fill', 'locked': True, 'blend': 'multiply'}))
                nodes.sort(key=lambda t: t[0])   # 겹침 순서: 배경 → 이미지 → 표 → 글 → 주석
                frame['nodes'] = [n for _, n in nodes]
        except Exception as e:
            # 한 쪽이 실패해도 문서 전체는 가져온다: 그 쪽은 페이지 그림 한 장으로
            print('[pdf2json] %d쪽 변환 실패 → 페이지 그림으로: %r' % (gp + 1, e), file=sys.stderr)
            frame['layout'], frame['props'] = 'blank', {}
            frame['name'] = frame['name'] or '페이지 %d' % (gp + 1)
            aid = assets.add(render(orig, BG_SCALE), 'WEBP', 86, 'PDF %d쪽' % (gp + 1))
            frame['nodes'] = [{'id': ids('ima'), 'type': 'image', 'name': 'PDF %d쪽 (그림)' % (gp + 1), 'x': 0, 'y': 0, 'w': W, 'h': H, 'asset': aid, 'fit': 'fill'}]
            warnings.append('%d쪽은 자동 변환에 실패해 페이지 그림으로 넣었어요 (%s)' % (gp + 1, type(e).__name__))
        cur['frames'].append(frame)
        report.append('%2d쪽 %-8s %-24s 노드 %d' % (gp + 1, 'image' if is_img else layout, frame['name'][:24], len(frame['nodes'])))
        if is_img and not any('화면 캡처' in w for w in warnings):
            warnings.append('글자 없는 화면 캡처 페이지는 화면 이미지로 가져왔어요 — 이미지를 오른쪽 클릭 → "이 이미지로 화면 프로토타입 만들기"로 바로 자동 구현할 수 있어요')

    for p in pages:
        for f in p['frames']: f.pop('_img', None)
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
