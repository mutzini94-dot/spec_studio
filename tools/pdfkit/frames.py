# 배경에 그려진 패널 · 카드 테두리 후보 (클릭 한 번으로 영역 잡기용)
import pymupdf
# 영역 설정: pdf2json.py 가 페이지 레이아웃마다 바꿔 넣는다 (기본값 = 화면 설계 본문)
AREA = (0, 30, 752, 520)
TITLE_BOX = (18, 33, 200, 52)

def extract(doc, pages):
    out = {}
    for pno, sid in pages:
        rects = []
        for dr in doc[pno].get_drawings():
            r = dr['rect']
            if r.width < 30 or r.height < 18 or r.width > 720 or r.height > 480: continue
            if r.x1 > AREA[2] or r.y0 < AREA[1] or r.y1 > AREA[3]: continue
            c = dr.get('color') or dr.get('fill')
            if c is not None and c[0] > .8 and c[1] < .25 and c[2] < .25: continue   # 빨간 주석 제외
            k = (round(r.x0), round(r.y0), round(r.x1), round(r.y1))
            if any(abs(k[0]-q[0]) < 2 and abs(k[1]-q[1]) < 2 and abs(k[2]-q[2]) < 2 and abs(k[3]-q[3]) < 2 for q in rects): continue
            rects.append(k)
        if rects:
            out[sid] = [[round(r[0], 1), round(r[1], 1), round(r[2]-r[0], 1), round(r[3]-r[1], 1)] for r in rects]
    return out
