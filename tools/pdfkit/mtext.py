# 목업 · 패널 · 머리글 등 표 밖의 모든 글자를 줄 단위로 추출 (배경에서는 글자를 통째로 빼고 HTML로 다시 올림)
import re
# 영역 설정: pdf2json.py 가 페이지 레이아웃마다 바꿔 넣는다 (기본값 = 화면 설계 본문)
AREA = (0, 30, 752, 520)
TITLE_BOX = (18, 33, 200, 52)

import pymupdf

def _font(f):
    if 'Nanum' in f: return 'n'
    if 'Cambria' in f or 'Times' in f or 'Georgia' in f: return 's'
    if 'Arial' in f or 'Helvetica' in f: return 'a'
    if 'Montserrat' in f: return 'mo'
    return 'm'

def extract(doc, pages, imgs, heads):
    """pages: [(pno, sid, [avoid rects])], imgs: 추출된 이미지 {sid:[{x,y,w,h}]}, heads: 이미 따로 올린 소제목
       → {sid: [{x,y,w,h,spans:[{t,size,color,font,b,i}]}]}"""
    out = {}
    for pno, sid, avoid in pages:
        page = doc[pno]
        av = [pymupdf.Rect(r) for r in avoid]
        hd = [pymupdf.Rect(h['x'], h['y'], h['x']+h['w'], h['y']+h['h']) for h in heads.get(sid, [])]
        ex = [pymupdf.Rect(o['x'], o['y'], o['x']+o['w'], o['y']+o['h']) for o in imgs.get(sid, [])]
        log = page.get_bboxlog()
        kept = []   # 배경에 남은 이미지 (그려진 순서와 함께)
        for i, (t, r) in enumerate(log):
            if t != 'fill-image': continue
            rr = pymupdf.Rect(r)
            if rr.width < 6 or any(abs(rr.x0-e.x0) < 1 and abs(rr.y0-e.y0) < 1 and abs(rr.x1-e.x1) < 1 for e in ex): continue
            kept.append((i, rr))
        texts = [(i, pymupdf.Rect(r)) for i, (t, r) in enumerate(log) if t in ('fill-text', 'stroke-text')]
        lst = []
        for b in page.get_text('dict')['blocks']:
            if b['type'] != 0: continue
            for l in b['lines']:
                sp = [s for s in l['spans'] if s['text'] != '']
                if not ''.join(s['text'] for s in sp).strip(): continue
                r = pymupdf.Rect(l['bbox']); c = pymupdf.Point((r.x0+r.x1)/2, (r.y0+r.y1)/2)
                if any(a.contains(c) for a in av): continue                      # 표는 따로 그림
                if any(h.contains(c) for h in hd): continue                      # 소제목은 따로 올림
                if TITLE_BOX and TITLE_BOX[0] <= r.x0 <= TITLE_BOX[2] and TITLE_BOX[1] <= r.y0 <= TITLE_BOX[3] and r.height > 10: continue   # 페이지 제목
                if r.x0 > AREA[2] or r.y0 < AREA[1] - 2 or r.y1 > AREA[3] + 4: continue                           # Description 칸 (HTML 패널이 덮음)
                # 배경에 남은 이미지 아래에 깔린 글자는 원래도 안 보였으니 올리지 않음
                # 그려진 순서 찾기: 첫 조각과 가장 많이 겹치는 글자 항목 (겹쳐 놓인 다른 줄과 헷갈리지 않도록)
                fr = pymupdf.Rect(sp[0]['bbox']); best, ti = 0, -1
                for i, tr in texts:
                    iou = (tr & fr).get_area() / max((tr | fr).get_area(), .01)
                    if iou > best + 1e-6: best, ti = iou, i
                if best < .3: ti = next((i for i, tr in texts if tr.contains(c) or (tr & r).get_area() > .5 * max(tr.get_area(), .01)), -1)
                if ti >= 0 and any(ii > ti and kr.contains(c) for ii, kr in kept): continue
                # 나중에 그려진 채움 도형이 글자를 덮고 있으면(예: 접힌 투표 바) 원래 안 보이던 글자
                if ti >= 0 and any(t2 == 'fill-path' and pymupdf.Rect(r2).contains(r) and pymupdf.Rect(r2).get_area() < 300000 for t2, r2 in log[ti+1:]): continue
                # 일부만 가려진 줄: 나중에 그려진 도형 · 이미지가 위나 아래를 덮으면 보이는 부분만 남김
                ct = cb = 0.0
                if ti >= 0:
                    covers = [pymupdf.Rect(r2) for t2, r2 in log[ti+1:] if t2 == 'fill-path' and pymupdf.Rect(r2).get_area() < 300000] + [kr for ii, kr in kept if ii > ti]
                    for cr in covers:
                        if cr.x0 > r.x0 + .2*r.width or cr.x1 < r.x1 - .2*r.width: continue   # 가로로 충분히 덮는 것만
                        if cr.y0 <= r.y0 < cr.y1 < r.y1: ct = max(ct, cr.y1 - r.y0)
                        if r.y0 < cr.y0 < r.y1 <= cr.y1: cb = max(cb, r.y1 - cr.y0)
                spans = []
                for s in sp:
                    spans.append({'t': s['text'], 'size': round(s['size'], 2), 'color': '#%06x' % s['color'], 'font': _font(s['font']),
                                  'b': 1 if ('Bold' in s['font'] or s['flags'] & 16) else 0, 'i': 1 if ('Italic' in s['font'] or s['flags'] & 2) else 0,
                                  'x': round(s['bbox'][0], 1)})
                lst.append({'x': round(r.x0, 1), 'y': round(r.y0, 1), 'w': round(r.width, 1), 'h': round(r.height, 1), 'spans': spans, 'ct': round(ct, 1), 'cb': round(cb, 1)})
        if lst: out[sid] = lst
    return out

def strip(doc, pno):
    """페이지의 글자(BT … ET)를 모두 뺀다"""
    for xref in doc[pno].get_contents():
        s = doc.xref_stream(xref); lines = s.split(b'\n'); keep, inside = [], False
        for l in lines:
            t = l.strip()
            if t == b'BT' or t.startswith(b'BT ') : inside = True
            if not inside: keep.append(l)
            if inside and (t == b'ET' or t.endswith(b' ET')): inside = False
        doc.update_stream(xref, b'\n'.join(keep))
