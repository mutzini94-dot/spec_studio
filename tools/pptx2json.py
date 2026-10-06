"""PPTX 기획서 → Spec Studio 문서(JSON) 가져오기 — 표준 라이브러리만 사용 (추가 설치 없음)

  python spec-studio/tools/pptx2json.py 기획서.pptx -o spec-studio/samples/기획서.tnspec.json

PPTX(OOXML)를 직접 읽어서 옮긴다:
  · 도형(29종 매핑) · 글(단락 · 목록 · 수준 · 정렬 · 굵기/색/크기 · 위첨자 · 링크) · 자동 맞춤 · 안쪽 여백
  · 표(병합 · 칸 배경 · 세로 정렬) · 그림(자르기 · 원형 마스크 · 테두리) · 연결선(연결점 · 꺾은선 · 화살표 모양)
  · 그룹(좌표 변환) · 회전 · 뒤집기 · 그림자 · 그라데이션 · 투명도 · 테마 색(마스터별) · 자리표시자 위치/서식 상속
  · 슬라이드 노트 → 프레임 메모, 숨긴 슬라이드 → 숨긴 프레임
  · 페이지 종류 자동 판별 → 템플릿 레이아웃 (머리말 · Description 칸 · 꼬리말은 레이아웃이 다시 그림)
"""
import argparse, colorsys, datetime, hashlib, json, os, posixpath, re, sys, zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (W, H, R, Ids, RawAssets, revision_table, is_rev_header, title_from_name, new_doc)  # noqa: E402

NS = {
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}
A = '{%s}' % NS['a']
PNS = '{%s}' % NS['p']
RID = '{%s}id' % NS['r']
REMBED = '{%s}embed' % NS['r']


def q(el, path):
    return el.find(path, NS) if el is not None else None


def qa(el, path):
    return el.findall(path, NS) if el is not None else []


# ---------- 색 ----------
PRESET = {'black': '000000', 'white': 'FFFFFF', 'red': 'FF0000', 'green': '008000', 'blue': '0000FF', 'yellow': 'FFFF00', 'gray': '808080', 'darkGray': 'A9A9A9', 'lightGray': 'D3D3D3', 'orange': 'FFA500'}


def apply_mods(hexv, el):
    r, g, b = (int(hexv[i:i + 2], 16) / 255 for i in (0, 2, 4))
    alpha = 1
    for m in list(el):
        tag = m.tag.replace(A, '')
        v = int(m.get('val', '100000')) / 100000
        if tag in ('lumMod', 'lumOff'):
            h, l, s = colorsys.rgb_to_hls(r, g, b)
            l = l * v if tag == 'lumMod' else min(1, l + v)
            r, g, b = colorsys.hls_to_rgb(h, l, s)
        elif tag == 'shade':
            r, g, b = r * v, g * v, b * v
        elif tag == 'tint':
            r, g, b = r + (1 - r) * (1 - v), g + (1 - g) * (1 - v), b + (1 - b) * (1 - v)
        elif tag == 'alpha':
            alpha = v
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(c * 255))) for c in (r, g, b)), alpha


class Theme:
    def __init__(self, xml, clrmap):
        self.c = {}
        if xml is not None:
            cs = q(xml, './/a:clrScheme')
            for ch in list(cs) if cs is not None else []:
                name = ch.tag.replace(A, '')
                v = q(ch, 'a:srgbClr')
                s = q(ch, 'a:sysClr')
                self.c[name] = (v.get('val') if v is not None else (s.get('lastClr') if s is not None else '000000')).upper()
        self.map = clrmap or {}
        fonts = q(xml, './/a:fontScheme') if xml is not None else None
        self.minor = (q(fonts, 'a:minorFont/a:ea').get('typeface') if fonts is not None and q(fonts, 'a:minorFont/a:ea') is not None else '') or ''

    def color(self, holder, ph=None):
        """holder: solidFill 등 색을 품은 요소 → ('#rrggbb', alpha) 또는 None"""
        if holder is None:
            return None
        for ch in list(holder):
            tag = ch.tag.replace(A, '')
            if tag == 'srgbClr':
                return apply_mods(ch.get('val'), ch)
            if tag == 'schemeClr':
                v = ch.get('val')
                if v == 'phClr' and ph is not None:
                    base = ph
                else:
                    v = {'bg1': 'lt1', 'tx1': 'dk1', 'bg2': 'lt2', 'tx2': 'dk2'}.get(v, v)
                    v = self.map.get(v, v) if v in ('lt1', 'dk1', 'lt2', 'dk2') and v in self.map else v
                    base = self.c.get(v, '000000')
                return apply_mods(base, ch)
            if tag == 'sysClr':
                return apply_mods(ch.get('lastClr', '000000'), ch)
            if tag == 'prstClr':
                return apply_mods(PRESET.get(ch.get('val'), '000000'), ch)
            if tag == 'scrgbClr':
                return apply_mods('%02x%02x%02x' % tuple(round(int(ch.get(k)) / 100000 * 255) for k in 'rgb'), ch)
        return None


# ---------- 패키지 ----------
class Package:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.names = set(self.z.namelist())
        self.cache = {}

    def xml(self, name):
        if name not in self.cache:
            self.cache[name] = ET.fromstring(self.z.read(name)) if name in self.names else None
        return self.cache[name]

    def rels(self, part):
        d, f = posixpath.split(part)
        rp = posixpath.join(d, '_rels', f + '.rels')
        out = {}
        x = self.xml(rp)
        if x is None:
            return out
        for r in x:
            t = r.get('Target')
            out[r.get('Id')] = (r.get('Type').split('/')[-1], t if r.get('TargetMode') == 'External' else posixpath.normpath(posixpath.join(d, t)), r.get('TargetMode') == 'External')
        return out

    def rel_of_type(self, part, typ):
        for _id, (t, target, ext) in self.rels(part).items():
            if t == typ:
                return target
        return None


# ---------- 기하 ----------
EMU = 12700   # 1pt = 12700 EMU, 슬라이드 960pt → 1px = 1pt


class Xf:
    """그룹 좌표 변환 누적"""
    def __init__(self, sx=1, sy=1, ox=0, oy=0):
        self.sx, self.sy, self.ox, self.oy = sx, sy, ox, oy

    def pt(self, x, y):
        return self.ox + x * self.sx, self.oy + y * self.sy

    def child(self, grp_xfrm):
        off, ext = q(grp_xfrm, 'a:off'), q(grp_xfrm, 'a:ext')
        choff, chext = q(grp_xfrm, 'a:chOff'), q(grp_xfrm, 'a:chExt')
        if off is None or ext is None:
            return self
        ox, oy, cx, cy = (int(off.get('x')), int(off.get('y')), int(ext.get('cx')), int(ext.get('cy')))
        chx, chy = (int(choff.get('x')), int(choff.get('y'))) if choff is not None else (ox, oy)
        chcx, chcy = (int(chext.get('cx')), int(chext.get('cy'))) if chext is not None else (cx, cy)
        ksx = cx / chcx if chcx else 1
        ksy = cy / chcy if chcy else 1
        # child(x) = off + (x - chOff) * k  → 부모 변환과 합성
        nsx, nsy = self.sx * ksx, self.sy * ksy
        nox = self.ox + (ox - chx * ksx) * self.sx
        noy = self.oy + (oy - chy * ksy) * self.sy
        return Xf(nsx, nsy, nox, noy)


def box_of(xfrm, xf):
    off, ext = q(xfrm, 'a:off'), q(xfrm, 'a:ext')
    if off is None or ext is None:
        return None
    x0, y0 = xf.pt(int(off.get('x')), int(off.get('y')))
    w, h = int(ext.get('cx')) * xf.sx, int(ext.get('cy')) * xf.sy
    return {'x': x0 / EMU, 'y': y0 / EMU, 'w': w / EMU, 'h': h / EMU, 'rot': int(xfrm.get('rot', '0')) / 60000,
            'flipH': xfrm.get('flipH') == '1', 'flipV': xfrm.get('flipV') == '1'}


GEOM = {
    'rect': 'rect', 'roundRect': 'roundRect', 'ellipse': 'ellipse', 'diamond': 'diamond', 'triangle': 'triangle', 'rtTriangle': 'rtTriangle',
    'parallelogram': 'parallelogram', 'trapezoid': 'trapezoid', 'hexagon': 'hexagon', 'octagon': 'octagon', 'star5': 'star5', 'plus': 'plus',
    'wedgeRectCallout': 'callout', 'wedgeRoundRectCallout': 'calloutRound', 'wedgeEllipseCallout': 'calloutOval', 'cloudCallout': 'calloutOval',
    'rightArrow': 'arrowR', 'leftArrow': 'arrowL', 'upArrow': 'arrowU', 'downArrow': 'arrowD', 'chevron': 'chevron', 'homePlate': 'pentagon',
    'flowChartProcess': 'process', 'flowChartDecision': 'decision', 'flowChartTerminator': 'terminator', 'flowChartInputOutput': 'data',
    'flowChartDocument': 'document', 'flowChartPredefinedProcess': 'predefined', 'can': 'cylinder', 'flowChartMagneticDisk': 'cylinder',
    'flowChartManualInput': 'manualInput', 'flowChartAlternateProcess': 'roundRect', 'snip1Rect': 'rect', 'round1Rect': 'roundRect',
    'round2SameRect': 'roundRect', 'snipRoundRect': 'roundRect', 'frame': 'rect', 'flowChartConnector': 'ellipse', 'donut': 'ellipse',
}
DASH = {'dash': 'dash', 'sysDash': 'dash', 'lgDash': 'long', 'sysDot': 'dot', 'dot': 'dot', 'dashDot': 'dashdot', 'lgDashDot': 'dashdot', 'sysDashDot': 'dashdot'}
CAP = {'triangle': 'arrow', 'stealth': 'arrow', 'arrow': 'open', 'oval': 'dot', 'diamond': 'diamond', 'none': 'none'}
CAP_SIZE = {'sm': .7, 'med': 1, 'lg': 1.4}
SIDE_RECT = {'0': 'n', '1': 'w', '2': 's', '3': 'e'}


def font_key(face):
    f = (face or '').lower()
    if 'nanum' in f or '나눔' in f:
        return 'n'
    if 'noto' in f or '본고딕' in f or 'pretendard' in f:
        return 'noto'
    if 'cambria' in f or 'times' in f or 'georgia' in f:
        return 's'
    if 'arial' in f or 'helvetica' in f:
        return 'a'
    if 'montserrat' in f:
        return 'mo'
    return 'm'


# ---------- 슬라이드 하나 ----------
class SlideReader:
    def __init__(self, pkg, part, ids, assets, warn):
        self.pkg, self.part, self.ids, self.assets, self.warn = pkg, part, ids, assets, warn
        self.x = pkg.xml(part)
        self.layout_part = pkg.rel_of_type(part, 'slideLayout')
        self.layout = pkg.xml(self.layout_part) if self.layout_part else None
        self.master_part = pkg.rel_of_type(self.layout_part, 'slideMaster') if self.layout_part else None
        self.master = pkg.xml(self.master_part) if self.master_part else None
        theme_part = pkg.rel_of_type(self.master_part, 'theme') if self.master_part else None
        cm = q(self.master, 'p:clrMap')
        self.theme = Theme(pkg.xml(theme_part) if theme_part else None, dict(cm.attrib) if cm is not None else {})
        self.rels = pkg.rels(part)
        self.idmap = {}        # PPT 도형 id → 노드 id
        self.geom_of = {}      # PPT 도형 id → 모양 (연결점 방향 판단용)
        self.pending_conn = []
        pres = pkg.xml('ppt/presentation.xml')
        self.default_style = q(pres, 'p:defaultTextStyle')

    # 자리표시자 상속: 레이아웃 → 마스터에서 같은 자리표시자 찾기
    def ph_chain(self, sp):
        ph = q(sp, 'p:nvSpPr/p:nvPr/p:ph')
        if ph is None:
            return []
        typ, idx = ph.get('type', 'body'), ph.get('idx')
        out = []
        for src in (self.layout, self.master):
            if src is None:
                continue
            best = None
            for cand in qa(src, './/p:sp'):
                cph = q(cand, 'p:nvSpPr/p:nvPr/p:ph')
                if cph is None:
                    continue
                ctyp, cidx = cph.get('type', 'body'), cph.get('idx')
                if idx is not None and cidx == idx:
                    best = cand
                    break
                if ctyp == typ or (typ in ('ctrTitle',) and ctyp == 'title') or (typ == 'subTitle' and ctyp == 'body'):
                    best = best if best is not None else cand
            if best is not None:
                out.append(best)
        return out

    def master_style(self, sp):
        ph = q(sp, 'p:nvSpPr/p:nvPr/p:ph')
        tx = q(self.master, 'p:txStyles')
        if ph is None:
            return self.default_style if self.default_style is not None else q(tx, 'p:otherStyle')
        t = ph.get('type', 'body')
        return q(tx, 'p:titleStyle') if t in ('title', 'ctrTitle') else q(tx, 'p:bodyStyle')

    # ---- 채우기 · 선 ----
    def fill_of(self, sppr, style):
        if sppr is None:
            sppr = ET.Element('x')
        if q(sppr, 'a:noFill') is not None:
            return None, None, None
        sf = q(sppr, 'a:solidFill')
        if sf is not None:
            c = self.theme.color(sf)
            return (c[0], None, c[1]) if c else (None, None, None)
        gf = q(sppr, 'a:gradFill')
        if gf is not None:
            stops = qa(gf, 'a:gsLst/a:gs')
            if stops:
                c0 = self.theme.color(stops[0]); c1 = self.theme.color(stops[-1])
                lin = q(gf, 'a:lin')
                ang = int(lin.get('ang', '5400000')) / 60000 if lin is not None else 90
                return (c0[0] if c0 else '#ffffff'), {'to': c1[0] if c1 else '#ffffff', 'angle': round(ang + 90) % 360}, None
        pf = q(sppr, 'a:pattFill')
        if pf is not None:
            c = self.theme.color(q(pf, 'a:fgClr'))
            return (c[0] if c else None), None, None
        if q(sppr, 'a:blipFill') is not None:
            return '#eeeeee', None, None
        ref = q(style, 'a:fillRef')
        if ref is not None and ref.get('idx', '0') != '0':
            c = self.theme.color(ref)
            return (c[0] if c else None), None, None
        return None, None, None

    def line_of(self, sppr, style):
        ln = q(sppr, 'a:ln')
        color, width, dash = None, None, None
        head = tail = None
        if ln is not None:
            if q(ln, 'a:noFill') is not None:
                color = 'none'
            else:
                c = self.theme.color(q(ln, 'a:solidFill'))
                if c:
                    color = c[0]
            if ln.get('w'):
                width = int(ln.get('w')) / EMU
            pd = q(ln, 'a:prstDash')
            if pd is not None:
                dash = DASH.get(pd.get('val'))
            head, tail = q(ln, 'a:headEnd'), q(ln, 'a:tailEnd')
        if color is None:
            ref = q(style, 'a:lnRef')
            if ref is not None and ref.get('idx', '0') != '0':
                c = self.theme.color(ref)
                color = c[0] if c else None
                width = width or .75
        if color is None:
            color = 'none'
        return color, (round(width, 2) if width else (1 if color != 'none' else 0)), dash, head, tail

    # ---- 글 ----
    def run_props(self, rpr, base):
        r = {}
        if rpr is None:
            return r
        if rpr.get('b') is not None:
            r['b'] = rpr.get('b') == '1'
        if rpr.get('i') == '1':
            r['i'] = True
        if rpr.get('u') and rpr.get('u') != 'none':
            r['u'] = True
        if rpr.get('strike') and rpr.get('strike') != 'noStrike':
            r['s'] = True
        if rpr.get('sz'):
            r['size'] = int(rpr.get('sz')) / 100
        bl = int(rpr.get('baseline', '0'))
        if bl > 0:
            r['sup'] = True
        elif bl < 0:
            r['sub'] = True
        c = self.theme.color(q(rpr, 'a:solidFill'))
        if c:
            r['color'] = c[0]
        hl = self.theme.color(q(rpr, 'a:highlight'))
        if hl:
            r['bg'] = hl[0]
        face = None
        for k in ('a:ea', 'a:latin'):
            e = q(rpr, k)
            if e is not None and e.get('typeface') and not e.get('typeface').startswith('+'):
                face = e.get('typeface')
                break
        if face:
            r['font'] = font_key(face)
        link = q(rpr, 'a:hlinkClick')
        if link is not None and link.get(RID) in self.rels:
            t, target, ext = self.rels[link.get(RID)]
            if ext:
                r['link'] = target
        return r

    def level_defaults(self, sp, lvl):
        """단락 수준별 기본값: 도형 lstStyle → 자리표시자(레이아웃 · 마스터) → 마스터 글 스타일"""
        tag = 'a:lvl%dpPr' % (lvl + 1)
        out = {}
        chain = [q(sp, 'p:txBody/a:lstStyle')] + [q(c, 'p:txBody/a:lstStyle') for c in self.ph_chain(sp)] + [self.master_style(sp)]
        for src in reversed([c for c in chain if c is not None]):
            lv = q(src, tag)
            if lv is None:
                continue
            d = q(lv, 'a:defRPr')
            if d is not None:
                out.update(self.run_props(d, {}))
            if lv.get('algn'):
                out['algn'] = lv.get('algn')
            if q(lv, 'a:buChar') is not None:
                out['bu'] = 'bullet'
            if q(lv, 'a:buAutoNum') is not None:
                out['bu'] = 'number'
            if q(lv, 'a:buNone') is not None:
                out['bu'] = None
        return out

    def text_of(self, sp, body):
        """txBody → (runs, paras, style)"""
        runs, paras = [], []
        sizes, colors, bolds, fonts, aligns = {}, {}, {}, {}, {}
        style_ref = q(sp, 'p:style/a:fontRef')
        ref_color = self.theme.color(style_ref) if style_ref is not None else None
        line_h = None
        ps = qa(body, 'a:p')
        for pi, p in enumerate(ps):
            ppr = q(p, 'a:pPr')
            lvl = int(ppr.get('lvl', '0')) if ppr is not None else 0
            dflt = self.level_defaults(sp, lvl)
            para = {}
            bu = dflt.get('bu')
            if ppr is not None:
                if q(ppr, 'a:buChar') is not None:
                    bu = 'bullet'
                if q(ppr, 'a:buAutoNum') is not None:
                    bu = 'number'
                if q(ppr, 'a:buNone') is not None:
                    bu = None
            if bu:
                para['list'] = bu
            if lvl:
                para['lv'] = min(4, lvl)
            algn = (ppr.get('algn') if ppr is not None and ppr.get('algn') else dflt.get('algn')) or 'l'
            aligns[algn] = aligns.get(algn, 0) + 1
            para['_algn'] = algn
            if ppr is not None:
                for k, key in (('a:spcBef', 'sb'), ('a:spcAft', 'sa')):
                    sp_el = q(ppr, k)
                    if sp_el is not None and q(sp_el, 'a:spcPts') is not None:
                        v = int(q(sp_el, 'a:spcPts').get('val')) / 100
                        if v:
                            para[key] = R(v)
                ls = q(ppr, 'a:lnSpc/a:spcPct')
                if ls is not None and line_h is None:
                    line_h = round(int(ls.get('val')) / 100000 * 1.2, 2)
            if pi:
                runs.append({'t': '\n'})
            paras.append(para)
            for ch in list(p):
                tag = ch.tag.replace(A, '')
                if tag in ('r', 'fld'):
                    t = ''.join(x.text or '' for x in ch.iter(A + 't'))
                    if not t:
                        continue
                    props = dict((k, v) for k, v in dflt.items() if k not in ('algn', 'bu'))
                    props.update(self.run_props(q(ch, 'a:rPr'), dflt))
                    if 'color' not in props and ref_color:
                        props['color'] = ref_color[0]
                    run = dict(props, t=t)
                    n = len(t.strip()) or 1
                    sizes[run.get('size', 18)] = sizes.get(run.get('size', 18), 0) + n
                    colors[run.get('color', '#000000')] = colors.get(run.get('color', '#000000'), 0) + n
                    bolds[bool(run.get('b'))] = bolds.get(bool(run.get('b')), 0) + n
                    fonts[run.get('font', 'm')] = fonts.get(run.get('font', 'm'), 0) + n
                    runs.append(run)
                elif tag == 'br':
                    runs.append({'t': '\n'})
                    paras.append({k: v for k, v in (('lv', para.get('lv')), ('cont', True if para.get('list') else None), ('_algn', algn)) if v})
        # 대표 서식은 상자 스타일로, 다른 것만 조각에 남긴다
        size = max(sizes, key=sizes.get) if sizes else 18
        color = max(colors, key=colors.get) if colors else (ref_color[0] if ref_color else '#000000')
        bold = max(bolds, key=bolds.get) if bolds else False
        font = max(fonts, key=fonts.get) if fonts else 'm'
        out = []
        for r in runs:
            r2 = {'t': r['t']}
            if r['t'] != '\n':
                if abs(r.get('size', size) - size) > .05:
                    r2['size'] = r.get('size', size)
                if r.get('color', color) != color:
                    r2['color'] = r.get('color')
                if bool(r.get('b')) != bold:
                    r2['b'] = bool(r.get('b'))
                if r.get('font', font) != font:
                    r2['font'] = r.get('font')
                for k in ('i', 'u', 's', 'sup', 'sub', 'link', 'bg'):
                    if r.get(k):
                        r2[k] = r[k]
            if out and 'img' not in out[-1] and {k: v for k, v in out[-1].items() if k != 't'} == {k: v for k, v in r2.items() if k != 't'}:
                out[-1]['t'] += r2['t']
            else:
                out.append(r2)
        if not out:
            out = [{'t': ''}]
        main_align = max(aligns, key=aligns.get) if aligns else 'l'
        AL = {'l': 'left', 'ctr': 'center', 'r': 'right', 'just': 'justify', 'dist': 'justify'}
        clean = []
        for p in paras:
            a = p.pop('_algn', main_align)
            if a != main_align:
                p['align'] = AL.get(a, 'left')
            clean.append(p)
        style = {'size': R(size), 'color': color, 'font': font, 'align': AL.get(main_align, 'left')}
        if bold:
            style['bold'] = True
        if line_h:
            style['lineHeight'] = line_h
        # bodyPr: 여백 · 세로 정렬 · 줄바꿈 · 자동 맞춤 · 세로쓰기
        bp = q(body, 'a:bodyPr')
        chain_bp = [bp] + [q(c, 'p:txBody/a:bodyPr') for c in self.ph_chain(sp)]
        def bget(attr, default):
            for b in chain_bp:
                if b is not None and b.get(attr) is not None:
                    return b.get(attr)
            return default
        ins = [int(bget(k, d)) / EMU for k, d in (('tIns', '45720'), ('rIns', '91440'), ('bIns', '45720'), ('lIns', '91440'))]
        style['pad'] = [R(v) for v in ins]
        anchor = bget('anchor', 't')
        style['valign'] = {'t': 'top', 'ctr': 'middle', 'b': 'bottom'}.get(anchor, 'top')
        if bget('wrap', 'square') == 'none':
            style['nowrap'] = True
        if bget('vert', 'horz') in ('vert', 'eaVert', 'wordArtVert'):
            style['vertical'] = True
        for b in chain_bp:
            if b is None:
                continue
            if q(b, 'a:spAutoFit') is not None:
                style['fit'] = 'grow'
                break
            if q(b, 'a:normAutofit') is not None:
                style['fit'] = 'shrink'
                break
            if q(b, 'a:noAutofit') is not None:
                break
        return out, (clean if any(clean) else None), style

    # ---- 도형 하나 → 노드 ----
    def node_sp(self, sp, xf):
        sppr = q(sp, 'p:spPr')
        style = q(sp, 'p:style')
        xfrm = q(sppr, 'a:xfrm')
        b = box_of(xfrm, xf) if xfrm is not None else None
        if b is None:
            for c in self.ph_chain(sp):
                cx = q(c, 'p:spPr/a:xfrm')
                if cx is not None:
                    b = box_of(cx, Xf())
                    break
        if b is None:
            return None
        cnv = q(sp, 'p:nvSpPr/p:cNvPr')
        pid = cnv.get('id') if cnv is not None else None
        name = cnv.get('name', '') if cnv is not None else ''
        geom_el = q(sppr, 'a:prstGeom')
        prst = geom_el.get('prst') if geom_el is not None else ('custom' if q(sppr, 'a:custGeom') is not None else 'rect')
        if prst in ('line', 'straightConnector1') or prst.startswith('bentConnector') or prst.startswith('curvedConnector'):
            return self.node_line(sp, sppr, style, b, pid, prst)
        fill, grad, alpha = self.fill_of(sppr, style)
        # 자리표시자는 레이아웃의 채우기 · 선을 이어받는다
        if fill is None and q(sp, 'p:nvSpPr/p:nvPr/p:ph') is not None:
            for c in self.ph_chain(sp):
                f2, g2, a2 = self.fill_of(q(c, 'p:spPr'), q(c, 'p:style'))
                if f2:
                    fill, grad, alpha = f2, g2, a2
                    break
        lc, lw, ldash, _h, _t = self.line_of(sppr, style)
        body = q(sp, 'p:txBody')
        has_text = body is not None and ''.join(t.text or '' for t in body.iter(A + 't')).strip() != ''
        visible = (fill is not None) or lc != 'none'
        if not visible and not has_text:
            return None
        if prst not in GEOM and prst != 'custom':
            self.warn.add('도형 "%s"는 사각형으로 바꿔 넣었어요' % prst)
        shape = GEOM.get(prst, 'rect')
        node = {'id': self.ids('sha' if visible else 'tex'), 'name': name or ('글' if not visible else '도형'), 'x': R(b['x']), 'y': R(b['y']), 'w': R(max(1, b['w'])), 'h': R(max(1, b['h']))}
        if b['rot']:
            node['rotation'] = R(b['rot'] % 360)
        if has_text:
            runs, paras, tstyle = self.text_of(sp, body)
        if visible:
            node.update({'type': 'shape', 'shape': 'rect' if shape == 'roundRect' else shape, 'fill': fill or 'none', 'stroke': lc, 'strokeWidth': lw if lc != 'none' else 0})
            if shape == 'roundRect':
                adj = q(geom_el, 'a:avLst/a:gd') if geom_el is not None else None
                k = int(re.sub(r'\D', '', adj.get('fmla')) or 16667) / 100000 if adj is not None and adj.get('fmla') else .16667
                node['radius'] = R(min(node['w'], node['h']) * k)
            if shape.startswith('callout'):
                gds = {g.get('name'): int(re.sub(r'[^\d-]', '', g.get('fmla', '0')) or 0) for g in qa(geom_el, 'a:avLst/a:gd')} if geom_el is not None else {}
                node['tail'] = [round(.5 + gds.get('adj1', -20833) / 100000, 2), round(.5 + gds.get('adj2', 62500) / 100000, 2)]
            if ldash:
                node['dash'] = ldash
            if grad:
                node['gradient'] = grad
            if alpha is not None and alpha < 1:
                node['fillOpacity'] = round(alpha, 2)
            if b['flipH']:
                node['flipH'] = True
            if b['flipV']:
                node['flipV'] = True
            if q(sppr, 'a:effectLst/a:outerShdw') is not None:
                node['shadow'] = True
            if has_text:
                node['runs'], node['style'] = runs, tstyle
                if paras:
                    node['paras'] = paras
        else:
            node.update({'type': 'text', 'runs': runs, 'style': tstyle})
            if paras:
                node['paras'] = paras
        if pid:
            self.idmap[pid] = node['id']
            self.geom_of[pid] = shape
        return node

    def node_line(self, sp, sppr, style, b, pid, prst):
        lc, lw, ldash, head, tail = self.line_of(sppr, style)
        x0, y0, x1, y1 = b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h']
        if b['flipH']:
            x0, x1 = x1, x0
        if b['flipV']:
            y0, y1 = y1, y0
        cnv = q(sp, 'p:nvCxnSpPr/p:cNvPr')
        if cnv is None:
            cnv = q(sp, 'p:nvSpPr/p:cNvPr')
        node = {'id': self.ids('con'), 'type': 'connector', 'name': (cnv.get('name') if cnv is not None else '') or '연결선', 'x': 0, 'y': 0,
                'pts': [[R(x0), R(y0)], [R(x1), R(y1)]], 'stroke': lc if lc != 'none' else '#333333', 'width': lw or 1,
                'dash': ldash or 'solid', 'route': 'elbow' if prst.startswith('bentConnector') else 'straight',
                'startCap': CAP.get(head.get('type'), 'none') if head is not None else 'none',
                'endCap': CAP.get(tail.get('type'), 'none') if tail is not None else 'none'}
        size = (tail if tail is not None else head)
        if size is not None and size.get('w') in CAP_SIZE and CAP_SIZE[size.get('w')] != 1:
            node['capSize'] = CAP_SIZE[size.get('w')]
        cnvc = q(sp, 'p:nvCxnSpPr/p:cNvCxnSpPr')
        st, en = q(cnvc, 'a:stCxn'), q(cnvc, 'a:endCxn')
        if st is not None or en is not None:
            self.pending_conn.append((node, st, en))
        return node

    def node_pic(self, pic, xf):
        sppr = q(pic, 'p:spPr')
        b = box_of(q(sppr, 'a:xfrm'), xf) if q(sppr, 'a:xfrm') is not None else None
        if b is None:
            return None
        blip = q(pic, 'p:blipFill/a:blip')
        rid = blip.get(REMBED) if blip is not None else None
        if not rid or rid not in self.rels:
            return None
        _t, target, ext = self.rels[rid]
        if ext or target not in self.pkg.names:
            return None
        e = target.rsplit('.', 1)[-1].lower()
        aid = self.assets.add(self.pkg.z.read(target), e, posixpath.basename(target))
        if not aid:
            self.warn.add('%s 형식 그림은 브라우저에서 그릴 수 없어 빠졌어요 (PNG · JPG로 바꿔 다시 넣어 주세요)' % e.upper())
            return None
        cnv = q(pic, 'p:nvPicPr/p:cNvPr')
        node = {'id': self.ids('ima'), 'type': 'image', 'name': (cnv.get('name') if cnv is not None else '') or '이미지', 'x': R(b['x']), 'y': R(b['y']),
                'w': R(max(1, b['w'])), 'h': R(max(1, b['h'])), 'asset': aid, 'fit': 'fill'}
        src = q(pic, 'p:blipFill/a:srcRect')
        if src is not None and any(src.get(k) for k in 'ltrb'):
            node['crop'] = {k: round(max(0, int(src.get(k, '0'))) / 100000, 3) for k in 'ltrb'}
        g = q(sppr, 'a:prstGeom')
        if g is not None and g.get('prst') in ('ellipse', 'flowChartConnector'):
            node['mask'] = 'ellipse'
        if g is not None and g.get('prst') == 'roundRect':
            node['radius'] = R(min(node['w'], node['h']) * .16667)
        lc, lw, _d, _h, _t2 = self.line_of(sppr, None)
        if lc != 'none':
            node['stroke'], node['strokeWidth'] = lc, lw
        if b['rot']:
            node['rotation'] = R(b['rot'] % 360)
        if b['flipH']:
            node['flipH'] = True
        if b['flipV']:
            node['flipV'] = True
        if cnv is not None:
            self.idmap[cnv.get('id')] = node['id']
            self.geom_of[cnv.get('id')] = 'rect'
        return node

    def node_table(self, gf, xf):
        tbl = q(gf, './/a:tbl')
        if tbl is None:
            return None
        xfrm = q(gf, 'p:xfrm')
        b = box_of(xfrm, xf)
        cols = [int(g.get('w')) * xf.sx / EMU for g in qa(tbl, 'a:tblGrid/a:gridCol')]
        rows = []
        sizes, colors, borders = {}, {}, {}
        for tr in qa(tbl, 'a:tr'):
            cells = []
            for tc in qa(tr, 'a:tc'):
                if tc.get('hMerge') == '1' or tc.get('vMerge') == '1':
                    cells.append(None)
                    continue
                body = q(tc, 'a:txBody')
                runs = []
                for pi, p in enumerate(qa(body, 'a:p')):
                    if pi:
                        runs.append({'t': '\n'})
                    for ch in list(p):
                        tag = ch.tag.replace(A, '')
                        if tag in ('r', 'fld'):
                            t = ''.join(x.text or '' for x in ch.iter(A + 't'))
                            if t:
                                runs.append(dict(self.run_props(q(ch, 'a:rPr'), {}), t=t))
                        elif tag == 'br':
                            runs.append({'t': '\n'})
                cell = {'runs': runs}
                tcpr = q(tc, 'a:tcPr')
                bgc = self.theme.color(q(tcpr, 'a:solidFill'))
                if bgc and bgc[0] != '#ffffff':
                    cell['bg'] = bgc[0]
                if tcpr is not None and tcpr.get('anchor') in ('t', 'b'):
                    cell['valign'] = 'top' if tcpr.get('anchor') == 't' else 'bottom'
                lnb = q(tcpr, 'a:lnB/a:solidFill')
                if lnb is not None:
                    bc = self.theme.color(lnb)
                    if bc:
                        borders[bc[0]] = borders.get(bc[0], 0) + 1
                al = [q(p, 'a:pPr') for p in qa(body, 'a:p')]
                al = [a.get('algn') for a in al if a is not None and a.get('algn')]
                if al and al[0] == 'ctr':
                    cell['align'] = 'center'
                elif al and al[0] == 'r':
                    cell['align'] = 'right'
                gs, rs = int(tc.get('gridSpan', '1')), int(tc.get('rowSpan', '1'))
                if gs > 1 or rs > 1:
                    cell['span'] = [gs, rs]
                for r in runs:
                    if r['t'] != '\n':
                        n = len(r['t'].strip()) or 1
                        sizes[r.get('size', 18)] = sizes.get(r.get('size', 18), 0) + n
                        colors[r.get('color', '#000000')] = colors.get(r.get('color', '#000000'), 0) + n
                cells.append(cell)
            while len(cells) < len(cols):
                cells.append({'runs': [{'t': ''}]})
            rows.append({'h': R(max(8, int(tr.get('h', '0')) * xf.sy / EMU)), 'cells': cells[:len(cols)]})
        size = max(sizes, key=sizes.get) if sizes else 10
        color = max(colors, key=colors.get) if colors else '#222222'
        for row in rows:
            for c in row['cells']:
                if not c:
                    continue
                c['runs'] = self.compact_runs(c['runs'], size, color) or [{'t': ''}]
                bolds = [r.get('b') for r in c['runs'] if r.get('t', '').strip()]
                if bolds and all(bolds):
                    c['bold'] = True
                    for r in c['runs']:
                        r.pop('b', None)
        cnv = q(gf, 'p:nvGraphicFramePr/p:cNvPr')
        tid = self.ids('tab')
        if cnv is not None:
            self.idmap[cnv.get('id')] = tid
            self.geom_of[cnv.get('id')] = 'table'
        return {'id': tid, 'type': 'table', 'name': (cnv.get('name') if cnv is not None else '') or '표', 'x': R(b['x']), 'y': R(b['y']),
                'w': R(sum(cols)), 'h': R(sum(r['h'] for r in rows)), 'cols': [R(c) for c in cols], 'rows': rows,
                'style': {'border': 'grid', 'borderColor': max(borders, key=borders.get) if borders else '#bfbfbf', 'size': R(size), 'color': color, 'pad': 5}}

    @staticmethod
    def compact_runs(runs, size, color):
        out = []
        for r in runs:
            r2 = {'t': r['t']}
            if r['t'] != '\n':
                if 'size' in r and abs(r['size'] - size) > .05:
                    r2['size'] = r['size']
                if r.get('color') and r['color'] != color:
                    r2['color'] = r['color']
                for k in ('b', 'i', 'u', 's', 'sup', 'sub', 'link', 'bg', 'font'):
                    if r.get(k) and not (k == 'font' and r[k] == 'm'):
                        r2[k] = r[k]
            if out and {k: v for k, v in out[-1].items() if k != 't'} == {k: v for k, v in r2.items() if k != 't'}:
                out[-1]['t'] += r2['t']
            else:
                out.append(r2)
        return [r for r in out if r['t'] != '']

    # ---- 나무 순회 ----
    def walk(self, tree, xf):
        nodes = []
        for ch in list(tree):
            tag = ch.tag.replace(PNS, '')
            n = None
            if tag == 'sp':
                n = self.node_sp(ch, xf)
            elif tag == 'cxnSp':
                sppr = q(ch, 'p:spPr')
                b = box_of(q(sppr, 'a:xfrm'), xf) if q(sppr, 'a:xfrm') is not None else None
                g = q(sppr, 'a:prstGeom')
                if b:
                    n = self.node_line(ch, sppr, q(ch, 'p:style'), b, None, g.get('prst') if g is not None else 'line')
            elif tag == 'pic':
                n = self.node_pic(ch, xf)
            elif tag == 'graphicFrame':
                n = self.node_table(ch, xf)
                if n is None:
                    self.warn.add('차트 · 스마트아트 같은 개체는 빠졌어요 (그림으로 바꿔 넣으면 옮겨집니다)')
            elif tag == 'grpSp':
                gx = q(ch, 'p:grpSpPr/a:xfrm')
                kids = self.walk(ch, xf.child(gx) if gx is not None else xf)
                kids = [k for k in kids if k]
                if kids:
                    n = self.make_group(ch, kids)
            if n:
                n['_pptx_tag'] = tag
                nodes.append(n)
        return nodes

    def make_group(self, grp, kids):
        def bx(k):
            if k['type'] == 'group':
                return k['_abs']
            if k['type'] == 'connector':
                xs = [p[0] for p in k['pts']]; ys = [p[1] for p in k['pts']]
                return (min(xs), min(ys), max(xs), max(ys))
            return (k['x'], k['y'], k['x'] + k['w'], k['y'] + k['h'])
        bs = [bx(k) for k in kids]
        x0, y0 = min(b[0] for b in bs), min(b[1] for b in bs)
        x1, y1 = max(b[2] for b in bs), max(b[3] for b in bs)
        for k in kids:
            if k['type'] == 'connector':
                k['pts'] = [[R(p[0] - x0), R(p[1] - y0)] for p in k['pts']]
            else:
                k['x'], k['y'] = R(k['x'] - x0), R(k['y'] - y0)
        cnv = q(grp, 'p:nvGrpSpPr/p:cNvPr')
        return {'id': self.ids('gro'), 'type': 'group', 'name': (cnv.get('name') if cnv is not None else '') or '그룹', 'x': R(x0), 'y': R(y0), 'children': kids, '_abs': (x0, y0, x1, y1)}

    def resolve_connectors(self):
        for node, st, en in self.pending_conn:
            for end, ref in (('from', st), ('to', en)):
                if ref is None:
                    continue
                nid = self.idmap.get(ref.get('id'))
                if not nid:
                    continue
                r = {'node': nid}
                g = self.geom_of.get(ref.get('id'), 'rect')
                if g in ('rect', 'roundRect', 'process', 'callout', 'calloutRound') and ref.get('idx') in SIDE_RECT:
                    r['side'] = SIDE_RECT[ref.get('idx')]
                elif g in ('ellipse',) and ref.get('idx') in ('0', '2', '4', '6'):
                    r['side'] = {'0': 'n', '2': 'w', '4': 's', '6': 'e'}[ref.get('idx')]
                node[end] = r

    def all_text(self):
        def t(x):
            return ' '.join(e.text or '' for e in x.iter(A + 't')) if x is not None else ''
        return t(self.x), t(self.layout), t(self.master)

    def background_dark(self):
        for src in (self.x, self.layout, self.master):
            bg = q(src, 'p:cSld/p:bg')
            if bg is None:
                continue
            c = self.theme.color(q(bg, 'p:bgPr/a:solidFill')) or self.theme.color(q(bg, 'p:bgRef'))
            if c:
                h = c[0].lstrip('#')
                r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
                return (r * .299 + g * .587 + b * .114) < 90
            if q(bg, 'p:bgPr/a:blipFill') is not None:
                return None
        return False

    def notes(self):
        np_ = self.pkg.rel_of_type(self.part, 'notesSlide')
        if not np_:
            return ''
        nx = self.pkg.xml(np_)
        out = []
        for sp in qa(nx, './/p:sp'):
            ph = q(sp, 'p:nvSpPr/p:nvPr/p:ph')
            if ph is None or ph.get('type') != 'body':
                continue
            for p in qa(sp, 'p:txBody/a:p'):
                out.append(''.join(e.text or '' for e in p.iter(A + 't')))
        return '\n'.join(out).strip()


def strip_private(nodes):
    for n in nodes:
        n.pop('_pptx_tag', None)
        n.pop('_abs', None)
        if n.get('type') == 'group':
            strip_private(n['children'])


def plain(n):
    return ''.join(r.get('t', '') for r in n.get('runs', []))


def is_marker(n):
    """화면 위 번호 표시: 숫자만 적힌 작은 원 · 둥근 도형"""
    if n.get('type') != 'shape' or n.get('w', 99) > 32 or n.get('h', 99) > 32:
        return False
    if n.get('shape') not in ('ellipse', 'rect', 'roundRect', 'process') or (n.get('shape') == 'rect' and not n.get('radius')):
        return False
    return re.fullmatch(r'\d{1,2}', plain(n).strip()) is not None


def link_descriptions(keep, rows, ids):
    """Description 표의 행을 같은 번호의 번호 원과 짝지어 그 자리에 Description 노드로 바꾼다.
    짝이 없는 행은 화면에 번호를 그리지 않고(marker: False) 패널에만 보인다."""
    used = set()
    for k, (num_txt, text) in enumerate(rows):
        lines = text.split('\n')
        num = int(num_txt) if num_txt.isdigit() else k + 1
        d = {'id': ids('des'), 'type': 'description', 'name': 'Description %d' % num, 'num': num,
             'title': lines[0].strip(), 'body': '\n'.join(l.rstrip() for l in lines[1:]).strip(), 'color': '#e53935'}
        idx = next((i for i, n in enumerate(keep) if i not in used and is_marker(n) and int(plain(n).strip()) == num), None)
        if idx is not None:
            m = keep[idx]
            used.add(idx)
            size = R(max(12, min(m['w'], m['h'])))
            d.update({'x': R(m['x'] + (m['w'] - size) / 2), 'y': R(m['y'] + (m['h'] - size) / 2), 'w': size, 'h': size})
            if m.get('fill') and m['fill'] != 'none':
                d['color'] = m['fill']
            keep[idx] = d
        else:
            d.update({'x': 732, 'y': R(58 + k * 22), 'w': 16, 'h': 16, 'marker': False})
            keep.append(d)


def convert(src, out_path, title=None):
    pkg = Package(src)
    pres = pkg.xml('ppt/presentation.xml')
    sz = q(pres, 'p:sldSz')
    sw, sh = int(sz.get('cx')), int(sz.get('cy'))
    if abs(sw / sh - 16 / 9) > .02:
        print('※ 슬라이드 비율이 16:9가 아니에요 (%.2f). 가로 960에 맞춰 넣습니다.' % (sw / sh), file=sys.stderr)
    global EMU
    EMU = sw / W
    prels = pkg.rels('ppt/presentation.xml')
    order = [prels[s.get(RID)][1] for s in qa(pres, 'p:sldIdLst/p:sldId')]
    seed = hashlib.sha1(os.path.basename(src).encode('utf-8')).hexdigest()[:4]
    ids = Ids(seed)
    assets = RawAssets(ids)
    warn = set()
    fname_title, fname_ver = title_from_name(src)
    meta = {'title': title or fname_title, 'project': '', 'team': '', 'version': fname_ver or '0.1', 'date': datetime.date.today().isoformat(),
            'author': '', 'copyright': 'Toonation', 'source': os.path.basename(src)}
    pages, cur, report = [], None, []
    total = len(order)
    for si, part in enumerate(order):
        rd = SlideReader(pkg, part, ids, assets, warn)
        st, lt, mt = rd.all_text()
        both = (st + ' ' + lt + ' ' + mt).upper()
        tree = q(rd.x, 'p:cSld/p:spTree')
        nodes = rd.walk(tree, Xf())
        rd.resolve_connectors()
        dark = rd.background_dark()
        tables = [n for n in nodes if n['type'] == 'table']
        texts = sorted([n for n in nodes if n['type'] in ('text', 'shape') and plain(n).strip()], key=lambda n: -(n.get('style') or {}).get('size', 0))
        # 페이지 종류
        if 'PAGE NAME' in both and 'DESCRIPTION' in both:
            layout = 'screen'
        elif 'REVISION HISTORY' in both or any(is_rev_header([plain(c) if c else '' for c in t['rows'][0]['cells']]) for t in tables):
            layout = 'history'
        elif 'THANK YOU' in both:
            layout = 'end'
        elif dark and si == 0:
            layout = 'cover'
        elif si > 0 and not tables and len(texts) <= 3 and ('간지' in lt or dark or len(nodes) <= 3) and any(re.fullmatch(r'\d{1,2}', plain(n).strip()) for n in texts):
            layout = 'divider'
        elif si == 0:
            layout = 'cover'
        elif '정책' in st and tables:
            layout = 'policy'
        else:
            layout = 'blank'
        frame = {'kind': 'frame', 'id': ids('fr'), 'name': '', 'layout': layout, 'props': {}, 'nodes': []}
        keep = []
        if layout == 'cover':
            ph_title = [n for n in nodes if n['type'] in ('text', 'shape') and plain(n).strip()]
            ver = [n for n in ph_title if re.search(r'[Vv]er\.?\s*\d', plain(n))]
            for n in ver:
                m = re.search(r'[Vv]er\.?\s*([\d.]+)\s*(\d{4}[-.]\d{2}[-.]\d{2})?', plain(n))
                meta['version'] = m.group(1)
                if m.group(2):
                    meta['date'] = m.group(2).replace('.', '-')
            rest = [n for n in texts if n not in ver]
            if rest and not title:
                meta['title'] = plain(rest[0]).strip()
            if len(rest) > 1:
                meta['team'] = plain(rest[1]).strip()
            frame['name'] = '표지'
        elif layout == 'divider':
            num = next((plain(n).strip() for n in texts if re.fullmatch(r'\d{1,2}', plain(n).strip())), '%02d' % (len(pages) + 1))
            ttl = next((plain(n).strip() for n in texts if plain(n).strip() != num), '장 제목')
            frame['props'] = {'number': num, 'title': ttl}
            frame['name'] = ttl
        elif layout == 'end':
            frame['name'] = 'THANK YOU'
        elif layout == 'history':
            rows = []
            for t in tables:
                for r in t['rows']:
                    cells = [plain(c).strip() if c else '' for c in r['cells']]
                    if is_rev_header(cells) or not any(cells):
                        continue
                    rows.append((cells + [''] * 6)[:6])
            keep.append(revision_table(ids, rows))
            if rows and rows[-1][1]:
                meta['version'] = rows[-1][1]
            if rows and re.fullmatch(r'\d{4}-\d{2}-\d{2}', rows[-1][2]):
                meta['date'] = rows[-1][2]
            frame['name'] = 'Revision History'
        else:
            desc_rows = []
            for n in nodes:
                bx = (n['x'], n['y'], n.get('w', 0), n.get('h', 0)) if n['type'] != 'connector' else (min(p[0] for p in n['pts']), min(p[1] for p in n['pts']), 0, 0)
                txt = plain(n).strip()
                if layout == 'screen':
                    if bx[1] + bx[3] <= 31 and n['type'] in ('text', 'shape') and txt:   # 머리말 Page Name / Project
                        if bx[0] < 690:
                            frame['props']['pageName'] = txt
                        elif not meta['project']:
                            meta['project'] = txt
                        continue
                    if n['type'] == 'table' and bx[0] >= 740:                       # Description 칸 → 아래에서 번호 원과 짝짓기
                        for r in n['rows']:
                            cs = [plain(c).strip() if c else '' for c in r['cells']]
                            if len(cs) >= 2 and cs[1]:                                   # 설명이 빈 행(번호만 있는 행)은 건너뜀
                                desc_rows.append((cs[0], cs[1]))
                        continue
                    if bx[0] >= 752 or bx[1] >= 521:
                        continue
                    # 왼쪽 위 화면 제목 (글자가 큰 제목도 포함 · 여러 줄 설명 글은 제외)
                    if 'screenTitle' not in frame['props'] and n['type'] in ('text', 'shape') and txt and chr(10) not in txt and bx[1] < 60 and bx[0] < 160 and bx[3] < 52 and len(txt) <= 40:
                        frame['props']['screenTitle'] = txt
                        continue
                elif layout == 'policy':
                    if n['type'] in ('text', 'shape') and txt and bx[1] < 80 and 'title' not in frame['props']:
                        frame['props']['title'] = txt
                        continue
                    if n['type'] == 'image' and bx[1] < 40 and bx[0] < 130:              # 로고 (레이아웃이 그림)
                        continue
                    if n['type'] == 'table':
                        n['style'].update({'border': 'hlines', 'borderColor': '#e6ebf1'})
                    if bx[1] >= 521:
                        continue
                elif bx[1] >= 521:
                    continue
                keep.append(n)
            if layout == 'screen':
                link_descriptions(keep, desc_rows, ids)
                frame['name'] = frame['props'].get('pageName') or frame['props'].get('screenTitle') or '화면 %d' % (si + 1)
                if not meta['project']:
                    # 마스터 머리말의 Project 칸 글자
                    for msp in qa(rd.master, './/p:sp'):
                        xb = box_of(q(msp, 'p:spPr/a:xfrm'), Xf()) if q(msp, 'p:spPr/a:xfrm') is not None else None
                        t = ''.join(e.text or '' for e in msp.iter(A + 't')).strip()
                        if xb and t and xb['x'] >= 750 and xb['y'] + xb['h'] <= 32 and q(msp, 'p:nvSpPr/p:nvPr/p:ph') is None:
                            meta['project'] = t
                            break
            elif layout == 'policy':
                frame['name'] = frame['props'].get('title', '기본 정책')
            else:
                frame['name'] = (plain(texts[0]).strip()[:30] if texts else '페이지 %d' % (si + 1))
        strip_private(keep)
        frame['nodes'] = keep
        if rd.x.get('show') == '0':
            frame['hidden'] = True
        notes = rd.notes()
        if notes:
            frame['notes'] = notes
        if layout == 'divider' or cur is None:
            cur = {'kind': 'page', 'id': ids('pg'), 'name': ('%s %s' % (frame['props']['number'], frame['props']['title'])) if layout == 'divider' else '개요', 'frames': []}
            pages.append(cur)
        cur['frames'].append(frame)
        report.append('%2d쪽 %-8s %-24s 노드 %d%s' % (si + 1, layout, frame['name'][:24], len(keep), ' (숨김)' if frame.get('hidden') else ''))
    doc = new_doc('doc_' + seed + hashlib.sha1(src.encode('utf-8')).hexdigest()[4:12] + 'x', meta, pages, assets.map)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    return doc, report + ['※ ' + w for w in sorted(warn)]


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='PPTX 기획서 → Spec Studio JSON')
    ap.add_argument('pptx')
    ap.add_argument('-o', '--out', help='출력 경로 (.tnspec.json)')
    ap.add_argument('--title', help='문서 제목 (기본: 표지에서 읽음)')
    a = ap.parse_args()
    out_path = a.out or os.path.splitext(a.pptx)[0] + '.tnspec.json'
    doc, rep = convert(a.pptx, out_path, a.title)
    sys.stdout.reconfigure(encoding='utf-8')
    print('\n'.join(rep))
    def count(nodes):
        return sum(1 + (count(n['children']) if n.get('type') == 'group' else 0) for n in nodes)
    n = sum(count(f['nodes']) for p in doc['pages'] for f in p['frames'])
    print('→ %s  (페이지 %d · 프레임 %d · 노드 %d · 이미지 %d · %dKB)' % (out_path, len(doc['pages']), sum(len(p['frames']) for p in doc['pages']), n, len(doc['assets']), os.path.getsize(out_path) // 1024))
