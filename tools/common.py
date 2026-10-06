"""가져오기 공용 도구 (표준 라이브러리만): id · 이미지 자원 · 개정 이력 표 · 문서 틀"""
import base64, hashlib, re, struct

W, H = 960, 540
SCHEMA, VERSION = 'toonation.spec', 1

# js/model.js DEFAULT_THEME 과 같은 값
DEFAULT_THEME = {'colors': [
    {'key': 'primary', 'name': '투네이션 블루', 'value': '#399eff'}, {'key': 'primaryDark', 'name': '진한 블루', 'value': '#2f6fe0'},
    {'key': 'text', 'name': '본문', 'value': '#111111'}, {'key': 'sub', 'name': '보조 글자', 'value': '#5d6470'},
    {'key': 'line', 'name': '선 · 테두리', 'value': '#c7ccd3'}, {'key': 'bg', 'name': '바탕 회색', 'value': '#f2f2f2'},
    {'key': 'dark', 'name': '표지 회색', 'value': '#393939'}, {'key': 'annot', 'name': '주석 빨강', 'value': '#e53935'},
    {'key': 'orange', 'name': '주황', 'value': '#ff8a00'}, {'key': 'green', 'name': '초록', 'value': '#22c55e'},
    {'key': 'purple', 'name': '보라', 'value': '#7b4dff'}, {'key': 'yellow', 'name': '노랑', 'value': '#ffc107'},
]}
DEFAULT_SETTINGS = {'grid': 10, 'gridShow': False, 'gridSnap': False, 'rulers': False}


def R(v):
    return round(v * 10) / 10


class Ids:
    def __init__(self, seed):
        self.n = 0
        self.seed = seed

    def __call__(self, prefix):
        self.n += 1
        return '%s_%s%04d' % (prefix, self.seed, self.n)


def image_size(data):
    """PNG · JPEG · GIF · WEBP 크기 (Pillow 없이)"""
    try:
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            return struct.unpack('>II', data[16:24])
        if data[:6] in (b'GIF87a', b'GIF89a'):
            return struct.unpack('<HH', data[6:10])
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            if data[12:16] == b'VP8X':
                return 1 + int.from_bytes(data[24:27], 'little'), 1 + int.from_bytes(data[27:30], 'little')
            if data[12:16] == b'VP8 ':
                w, h = struct.unpack('<HH', data[26:30])
                return w & 0x3fff, h & 0x3fff
        if data[:2] == b'\xff\xd8':
            i = 2
            while i < len(data):
                if data[i] != 0xFF:
                    i += 1
                    continue
                m = data[i + 1]
                if m in (0xC0, 0xC1, 0xC2):
                    h, w = struct.unpack('>HH', data[i + 5:i + 9])
                    return w, h
                i += 2 + struct.unpack('>H', data[i + 2:i + 4])[0]
    except Exception:
        pass
    return None, None


MIME = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml', 'bmp': 'image/bmp'}


class RawAssets:
    """원본 바이트를 그대로 dataURL 로 (같은 그림은 한 번만)"""
    def __init__(self, ids):
        self.map, self.by_hash, self.ids = {}, {}, ids

    def add(self, data, ext, name=''):
        mime = MIME.get(ext.lower())
        if not mime:
            return None
        h = hashlib.sha1(data).hexdigest()
        if h in self.by_hash:
            return self.by_hash[h]
        aid = self.ids('img')
        w, hh = image_size(data)
        self.map[aid] = {'mime': mime, 'data': 'data:%s;base64,%s' % (mime, base64.b64encode(data).decode()), 'w': w, 'h': hh, 'name': name}
        self.by_hash[h] = aid
        return aid


# ---------- 개정 이력 표 (js/templates.js revisionTable() 과 같은 모양) ----------
REV_COLS = [68, 68, 68, 480, 80, 80]
REV_HEIGHTS = [32, 19, 69, 79, 114, 22, 22, 23, 24, 23]
REV_HEAD = ['No.', 'Version', '변경일', '변경내용', '작성자', '승인자']


def is_rev_header(cells):
    return sum(1 for c in cells if c.strip() in REV_HEAD) >= 3


def revision_table(ids, rows):
    heights = REV_HEIGHTS[:]
    while len(heights) - 1 < len(rows):
        heights.append(23)
    head = [{'runs': [{'t': h}], 'bold': True, 'align': 'center', 'bg': '#a6a6a6', 'color': '#333333', 'size': 10} for h in REV_HEAD]
    body = []
    for i in range(len(heights) - 1):
        vals = (rows[i] + [''] * 6)[:6] if i < len(rows) else [''] * 6
        body.append({'h': heights[i + 1], 'cells': [dict({'runs': [{'t': v}]}, **({} if ci == 3 else {'align': 'center'})) for ci, v in enumerate(vals)]})
    return {'id': ids('tab'), 'type': 'table', 'name': '개정 이력 표', 'x': 66, 'y': 71, 'w': sum(REV_COLS), 'h': sum(heights), 'cols': REV_COLS[:],
            'rows': [{'h': heights[0], 'cells': head}] + body,
            'style': {'border': 'dotted', 'borderColor': '#b3b3b3', 'topRule': 2, 'size': 8, 'color': '#333333', 'pad': 5}}


def title_from_name(path):
    import os
    base = os.path.splitext(os.path.basename(path))[0]
    m = re.search(r'[_\s-]v(?:er)?\.?(\d+(?:\.\d+)*)$', base, re.I)
    ver = m.group(1) if m else None
    if m:
        base = base[:m.start()]
    return base.replace('_', ' ').strip(), ver


def new_doc(doc_id, meta, pages, assets):
    return {'schema': SCHEMA, 'version': VERSION, 'id': doc_id, 'meta': meta, 'size': {'w': W, 'h': H}, 'pages': pages,
            'components': [], 'assets': assets, 'theme': DEFAULT_THEME, 'settings': DEFAULT_SETTINGS, 'rev': 0}
