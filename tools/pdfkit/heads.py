# 표 · 화면 목업 밖의 굵은 소제목 글자를 찾는다 (배경에서 지우고 HTML 글자로 다시 올림)
import pymupdf
# 영역 설정: pdf2json.py 가 페이지 레이아웃마다 바꿔 넣는다 (기본값 = 화면 설계 본문)
AREA = (0, 30, 752, 520)
TITLE_BOX = (18, 33, 200, 52)

def extract(doc, pages, frames, imgs):
    """pages: [(pno, sid, [avoid rects])] → {sid: [{x,y,w,h,size,color,text}]}"""
    out = {}
    for pno, sid, avoid in pages:
        fr = [pymupdf.Rect(f[0], f[1], f[0]+f[2], f[1]+f[3]) for f in frames.get(sid, [])]
        im = [pymupdf.Rect(o['x'], o['y'], o['x']+o['w'], o['y']+o['h']) for o in imgs.get(sid, [])]
        av = [pymupdf.Rect(r) for r in avoid]
        lst = []
        for b in doc[pno].get_text('dict')['blocks']:
            if b['type'] != 0: continue
            for l in b['lines']:
                sp = [s for s in l['spans'] if s['text'].strip()]
                if not sp: continue
                bold = all('Bold' in s['font'] for s in sp)
                size = max(s['size'] for s in sp)
                r = pymupdf.Rect(l['bbox'])
                if not bold or size < 8.9: continue
                if r.y0 < AREA[1] + 3 or r.y1 > AREA[3] or r.x1 > AREA[2]: continue
                c = pymupdf.Point((r.x0+r.x1)/2, (r.y0+r.y1)/2)
                if any(a.contains(c) for a in av + im): continue
                if any(f.contains(c) for f in fr): continue       # 패널 · 목업 안의 글자는 화면 그림의 일부
                if TITLE_BOX and TITLE_BOX[0] <= r.x0 <= TITLE_BOX[2] and TITLE_BOX[1] <= r.y0 <= TITLE_BOX[3]: continue  # 페이지 제목은 이미 따로 처리
                text = ''.join(s['text'] for s in l['spans']).strip()
                lst.append({'x': round(r.x0, 1), 'y': round(r.y0, 1), 'w': round(r.width, 1), 'h': round(r.height, 1), 'size': round(size, 1),
                            'color': '#%06x' % sp[0]['color'], 'text': text})
        if lst: out[sid] = lst
    return out
