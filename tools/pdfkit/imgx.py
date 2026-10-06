# PDF에 삽입된 이미지를 개별 객체로 추출하고 배경 렌더링에서 제거
import base64, io
# 영역 설정: pdf2json.py 가 페이지 레이아웃마다 바꿔 넣는다 (기본값 = 화면 설계 본문)
AREA = (0, 30, 752, 520)
TITLE_BOX = (18, 33, 200, 52)

import pymupdf
from PIL import Image

def _pil(doc, xref):
    pix = pymupdf.Pixmap(doc, xref)
    sm = doc.xref_get_key(xref, 'SMask')
    if sm[0] == 'xref':
        if pix.alpha: pix = pymupdf.Pixmap(pix, 0)
        if pix.n > 3: pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, int(sm[1].split()[0])))
    elif pix.n - pix.alpha != 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)   # 회색조 · CMYK → RGB
    if pix.n - pix.alpha != 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    return Image.frombytes('RGBA' if pix.alpha else 'RGB', (pix.width, pix.height), pix.samples)

def _data(im):
    buf = io.BytesIO()
    if im.mode == 'RGBA' and im.getextrema()[3][0] == 255: im = im.convert('RGB')
    im.save(buf, 'WEBP', quality=90, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()

def extract(doc, pages):
    """pages: [(pno, slide_id, [excluded rects])] → (objs {slide:[{id,x,y,w,h,src}]}, srcs {key:dataURL}, deletable xrefs)"""
    objs, srcs, used_in, excluded = {}, {}, {}, set()
    for pno, sid, avoid in pages:
        page, seen, items = doc[pno], set(), []
        log = page.get_bboxlog()
        def order(b):
            for i, (t, r) in enumerate(log):
                if t == 'fill-image' and abs(r[0]-b.x0) < 1 and abs(r[1]-b.y0) < 1 and abs(r[2]-b.x1) < 1 and abs(r[3]-b.y1) < 1: return i
            return -1
        def covered(i, b):
            # 이 이미지보다 나중에 그려져 위를 덮는 글자 · 도형이 있으면 배경에 남김 (겹침 순서 보존)
            if i < 0: return False
            for t, r in log[i+1:]:
                if t not in ('fill-text', 'fill-path', 'stroke-path', 'stroke-text'): continue
                rr = pymupdf.Rect(r)
                if rr.get_area() < .95*b.get_area() and (rr & b).get_area() > .6*max(rr.get_area(), .01): return True
            return False
        for info in page.get_image_info(xrefs=True):
            x = info.get('xref') or 0
            b = pymupdf.Rect(info['bbox'])
            if not x or b.width < 6 or b.height < 6: continue
            if b.y0 > AREA[3] - 5 or b.y1 < AREA[1] or b.x0 > AREA[2] - 4: continue          # 머리 · 꼬리말, Description 칸
            c = pymupdf.Point((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)
            if any(pymupdf.Rect(r).contains(c) for r in avoid):         # 표 안의 아이콘은 표가 그림
                excluded.add(x); continue
            k = (x, round(b.x0), round(b.y0))
            if k in seen: continue
            seen.add(k)
            oi = order(b)
            items.append([x, b, oi, covered(oi, b)])
        # 배경에 남는 이미지가 위에 그려져 있으면, 그 아래 이미지도 배경에 남김 (겹침 순서 보존)
        changed = True
        while changed:
            changed = False
            for it in items:
                if it[3]: continue
                for o in items:
                    if o is it or not o[3] or o[2] <= it[2]: continue
                    if (o[1] & it[1]).get_area() > .3 * it[1].get_area(): it[3] = True; changed = True; break
        for it in items:
            if it[3]: excluded.add(it[0])
        items = [it[:3] for it in items if not it[3]]
        items.sort(key=lambda t: t[2])   # PDF에 그려진 순서대로 쌓기
        lst = []
        for i, (x, b, _o) in enumerate(items):
            key = 'x%d' % x
            if key not in srcs: srcs[key] = _data(_pil(doc, x))
            lst.append({'id': '%s-%d' % (sid, i + 1), 'x': round(b.x0, 1), 'y': round(b.y0, 1), 'w': round(b.width, 1), 'h': round(b.height, 1), 'src': key})
            used_in.setdefault(x, set()).add(pno)
        if lst: objs[sid] = lst
    deletable = {x: p for x, p in used_in.items() if x not in excluded}
    return objs, srcs, deletable

def strip(doc, deletable):
    """배경에서 추출한 이미지를 지운다 (같은 이미지가 표 안에도 쓰이면 남김)"""
    for x, pnos in deletable.items():
        doc[sorted(pnos)[0]].delete_image(x)
