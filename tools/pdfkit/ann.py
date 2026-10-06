# PDF의 빨간 주석(점선 박스 · 연결선 · 시작 점 · 화살표)을 편집 가능한 벡터 모델로 추출하고 배경에서 제거
import re, math

def is_red(c):
    return c is not None and c[0] > 0.8 and c[1] < 0.25 and c[2] < 0.25

def _subpaths(items):
    """연속된 선분을 하나의 도형으로 묶는다 → [(kind, [points])]"""
    out, cur, last = [], None, None
    for it in items:
        k = it[0]
        if k == 're':
            r = it[1]; out.append(('re', [(r.x0, r.y0), (r.x1, r.y1)])); cur = None; last = None; continue
        if k == 'c':
            out.append(('c', [(p.x, p.y) for p in it[1:5]])); cur = None; last = None; continue
        if k == 'l':
            a, b = it[1], it[2]
            if cur is not None and last is not None and abs(a.x - last[0]) < .05 and abs(a.y - last[1]) < .05:
                cur[1].append((b.x, b.y))
            else:
                cur = ['l', [(a.x, a.y), (b.x, b.y)]]; out.append(cur)
            last = (b.x, b.y)
    return out

def _bbox(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)

def _rdp(pts, eps):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy) or 1e-9
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L
        if d > dmax: dmax, idx = d, i
    if dmax > eps:
        return _rdp(pts[:idx + 1], eps)[:-1] + _rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]

def _tidy(pts):
    out = [list(pts[0])]
    for p in pts[1:-1]:
        if math.hypot(p[0]-out[-1][0], p[1]-out[-1][1]) > 2.4: out.append(list(p))
    out.append(list(pts[-1]))
    for i in range(1, len(out)):
        if abs(out[i][0]-out[i-1][0]) < 1.8: out[i][0] = out[i-1][0] if i < len(out)-1 else out[i][0]
        if abs(out[i][1]-out[i-1][1]) < 1.8: out[i][1] = out[i-1][1] if i < len(out)-1 else out[i][1]
    return [tuple(p) for p in out]

def _link(dr):
    subs = _subpaths(dr['items'])
    curves = [p for k, ps in subs if k == 'c' for p in ps]
    dot = None
    if curves:
        x0, y0, x1, y1 = _bbox(curves); dot = ((x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) / 2)
    dashes, heads = [], []
    for k, ps in subs:
        if k == 'c': continue
        x0, y0, x1, y1 = _bbox(ps)
        (heads if max(x1 - x0, y1 - y0) > 2.2 else dashes).append(ps)
    route = [((_bbox(ps)[0] + _bbox(ps)[2]) / 2, (_bbox(ps)[1] + _bbox(ps)[3]) / 2) for ps in dashes]
    if dot:
        # 시작 점에서 먼 쪽이 끝이 되도록 정렬
        if route and math.hypot(route[0][0] - dot[0], route[0][1] - dot[1]) > math.hypot(route[-1][0] - dot[0], route[-1][1] - dot[1]):
            route.reverse()
        route = [(dot[0], dot[1])] + route
    tip = None
    if heads:
        hp = [p for ps in heads for p in ps]
        ref = route[-1] if route else (0, 0)
        tip = max(hp, key=lambda p: math.hypot(p[0] - ref[0], p[1] - ref[1]))
        route = route + [tip]
    pts = _tidy(_rdp(route, 0.9))
    return {'t': 'link', 'pts': [[round(x, 1), round(y, 1)] for x, y in pts], 'dot': bool(dot), 'arrow': bool(tip)}

def extract(doc, pages):
    """{pno: [elements]}"""
    res = {}
    for pno in pages:
        els = []
        for dr in doc[pno].get_drawings():
            if dr['type'] == 's' and is_red(dr.get('color')) and len(dr['items']) == 1 and dr['items'][0][0] == 're':
                r = dr['items'][0][1]
                els.append({'t': 'box', 'x': round(r.x0, 1), 'y': round(r.y0, 1), 'w': round(r.width, 1), 'h': round(r.height, 1)})
            elif dr['type'] == 'f' and is_red(dr.get('fill')) and len(dr['items']) > 12:
                l = _link(dr)
                if len(l['pts']) >= 2: els.append(l)
        if els: res[pno] = els
    return res

RED = re.compile(rb'(^|\s)(1 0 0|0\.9\d* 0 0|1 0\.0\d* 0\.0\d*) (RG|rg)(\s|$)')
PAINT = re.compile(rb'(^|\s)(S|s|f|F|f\*|B|B\*|b|b\*)(\s|$)')

def _blocks(lines):
    out, depth, st = [], 0, None
    for i, l in enumerate(lines):
        for tok in l.strip().split():
            if tok == b'q':
                if depth == 0: st = i
                depth += 1
            elif tok == b'Q':
                depth -= 1
                if depth == 0 and st is not None: out.append((st, i)); st = None
    return out

def strip(doc, pno):
    """빨간 선만 그린 최상위 q…Q 블록(글자 · 이미지 없음)을 제거"""
    n = 0
    for xref in doc[pno].get_contents():
        s = doc.xref_stream(xref); lines = s.split(b'\n'); kill = set()
        for a, b in _blocks(lines):
            body = b'\n'.join(lines[a:b + 1])
            if b'BT' in body or b' Do' in body: continue
            if RED.search(body) and PAINT.search(body):
                kill.update(range(a, b + 1)); n += 1
        if kill: doc.update_stream(xref, b'\n'.join(l for i, l in enumerate(lines) if i not in kill))
    return n
