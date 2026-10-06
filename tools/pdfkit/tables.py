# PDF 표 → 표 노드(JSON). legacy_build_chat_html.py 의 build_table 을 HTML 대신 문서 모델로 내보내도록 옮긴 것
import pymupdf

def _font(f):
    if 'Nanum' in f: return 'n'
    if 'Cambria' in f or 'Times' in f or 'Georgia' in f: return 's'
    if 'Arial' in f or 'Helvetica' in f: return 'a'
    if 'Montserrat' in f: return 'mo'
    return 'm'

def spans_of(page):
    out = []
    for b in page.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            for s in l['spans']:
                if s['text'] == '': continue
                out.append(dict(kind='t', bbox=pymupdf.Rect(s['bbox']), text=s['text'], font=s['font'],
                                bold=('Bold' in s['font']) or bool(s['flags'] & 16), color=s['color'], size=s['size']))
    for info in page.get_image_info(xrefs=True):
        out.append(dict(kind='i', bbox=pymupdf.Rect(info['bbox']), xref=info.get('xref', 0)))
    return out

def fills_of(page):
    return [(d['rect'], d['fill']) for d in page.get_drawings() if d.get('fill') is not None]

def bg_for(cell, fills):
    c = pymupdf.Point((cell.x0 + cell.x1) / 2, (cell.y0 + cell.y1) / 2)
    area = cell.width * cell.height
    best = None
    for r, f in fills:
        a = r.width * r.height
        if r.contains(c) and area * .5 <= a <= area * 4 and (best is None or a < best[0].width * best[0].height):
            best = (r, f)
    if not best: return None
    return '#%02x%02x%02x' % tuple(int(round(v * 255)) for v in best[1][:3])

def _bounds(vals):
    vals = sorted(vals)
    out = []
    for v in vals:
        if not out or v - out[-1] > 2: out.append(v)
    return out

def convert(page, t, spans, fills, icon, R, scale=1.0, style=None):
    """t: pymupdf Table → dict(x, y, w, h, cols, rows, style). icon(span) → asset id"""
    rows = t.rows
    cells_all = [pymupdf.Rect(c) for r in rows for c in r.cells if c]
    xs = _bounds([c.x0 for c in cells_all] + [c.x1 for c in cells_all])
    ys = _bounds([r.bbox[1] for r in rows] + [r.bbox[3] for r in rows] + [c.y0 for c in cells_all] + [c.y1 for c in cells_all])
    nx, ny = len(xs) - 1, len(ys) - 1
    near = lambda arr, v: min(range(len(arr)), key=lambda k: abs(arr[k] - v))
    grid = [[None] * nx for _ in range(ny)]
    owned = [[False] * nx for _ in range(ny)]
    # 표 전체의 대표 글자 크기 · 색
    sizes, colors = {}, {}
    T0 = pymupdf.Rect(t.bbox)
    for s in spans:
        if s['kind'] == 't' and T0.contains(pymupdf.Point((s['bbox'].x0 + s['bbox'].x1) / 2, (s['bbox'].y0 + s['bbox'].y1) / 2)):
            n = len(s['text'].strip())
            sizes[round(s['size'] * 2) / 2] = sizes.get(round(s['size'] * 2) / 2, 0) + n
            colors[s['color']] = colors.get(s['color'], 0) + n
    base_size = max(sizes, key=sizes.get) if sizes else 8
    base_color = max(colors, key=colors.get) if colors else 0
    for cell in cells_all:
        c0, c1 = near(xs, cell.x0), near(xs, cell.x1)
        r0, r1 = near(ys, cell.y0), near(ys, cell.y1)
        if c1 <= c0 or r1 <= r0 or owned[r0][c0]: continue
        mine = [s for s in spans if cell.contains(pymupdf.Point((s['bbox'].x0 + s['bbox'].x1) / 2, (s['bbox'].y0 + s['bbox'].y1) / 2))]
        texts = [s for s in mine if s['kind'] == 't' and s['text'].strip()]
        dom = dict(bold=False, color=base_color, size=base_size, font='MalgunGothic')
        for key in ('bold', 'color', 'size', 'font'):
            cnt = {}
            for s in texts:
                v = round(s[key] * 2) / 2 if key == 'size' else s[key]
                cnt[v] = cnt.get(v, 0) + len(s['text'].strip())
            if cnt: dom[key] = max(cnt, key=cnt.get)
        # 같은 높이의 조각끼리 한 줄로
        items = sorted(mine, key=lambda s: (s['bbox'].y0 + s['bbox'].y1) / 2)
        vrows = []
        for s in items:
            cy = (s['bbox'].y0 + s['bbox'].y1) / 2
            if vrows and abs(vrows[-1]['cy'] - cy) < 3.2: vrows[-1]['s'].append(s)
            else: vrows.append(dict(cy=cy, s=[s]))
        runs = []
        def add(text, s=None):
            r = {'t': text}
            if s is not None:
                if s['bold'] != dom['bold']: r['b'] = s['bold']
                if s['color'] != dom['color']: r['color'] = '#%06x' % s['color']
                if abs(s['size'] - dom['size']) > .6: r['size'] = round(s['size'], 1)
            if runs and 'img' not in runs[-1] and {k: v for k, v in runs[-1].items() if k != 't'} == {k: v for k, v in r.items() if k != 't'}: runs[-1]['t'] += text
            else: runs.append(r)
        prev_row = None
        for vr in vrows:
            vr['s'].sort(key=lambda s: s['bbox'].x0)
            x0 = vr['s'][0]['bbox'].x0; x1 = max(s['bbox'].x1 for s in vr['s'])
            bullet = vr['s'][0]['kind'] == 't' and vr['s'][0]['text'].strip() == '•'
            if prev_row is not None:
                # 앞줄이 칸을 거의 다 채웠으면 자동 줄바꿈(공백), 아니면 실제 줄바꿈
                full = (prev_row[1] - prev_row[0]) > (cell.x1 - prev_row[0] - 6) * .86
                add(' ' if full and not bullet else '\n')
            prev = None
            for s in vr['s']:
                if prev is not None and s['bbox'].x0 - prev['bbox'].x1 > 1.5 and not prev.get('text', 'x').endswith(' ') and not s.get('text', 'x').startswith(' '): add(' ')
                if s['kind'] == 'i':
                    aid = icon(s)
                    if aid: runs.append({'img': aid, 'h': R(s['bbox'].height * scale)})
                else:
                    add(s['text'].replace('•', '•') if not bullet or s is not vr['s'][0] else '• ', s)
                prev = s
            prev_row = (x0, x1)
        runs = [r for r in runs if 'img' in r or r['t'] != '']
        if runs and 't' in runs[-1]: runs[-1]['t'] = runs[-1]['t'].rstrip()
        if runs and 't' in runs[0]: runs[0]['t'] = runs[0]['t'].lstrip()
        k = {'runs': runs or [{'t': ''}]}
        # 정렬: 모든 줄이 칸 가운데 근처면 가운데
        if vrows:
            cx = (cell.x0 + cell.x1) / 2
            spans_x = [(min(s['bbox'].x0 for s in v['s']), max(s['bbox'].x1 for s in v['s'])) for v in vrows]
            if all(abs((a + b) / 2 - cx) < max(4, cell.width * .06) for a, b in spans_x) and all(a - cell.x0 > 8 for a, b in spans_x): k['align'] = 'center'
            else:
                pad = min(a for a, b in spans_x) - cell.x0
                if pad > 6.5: k['pad'] = R(min(pad, 20) * scale)
        bg = bg_for(cell, fills)
        if bg and bg != '#ffffff': k['bg'] = bg
        if dom['bold']: k['bold'] = True
        if dom['color'] != base_color: k['color'] = '#%06x' % dom['color']
        if abs(dom['size'] - base_size) > .4: k['size'] = R(dom['size'] * scale)
        if c1 - c0 > 1 or r1 - r0 > 1: k['span'] = [c1 - c0, r1 - r0]
        grid[r0][c0] = k
        for yy in range(r0, r1):
            for xx in range(c0, c1): owned[yy][xx] = True
    for yy in range(ny):
        for xx in range(nx):
            if not owned[yy][xx]: grid[yy][xx] = {'runs': [{'t': ''}]}
    st = {'border': 'grid', 'borderColor': '#a6a6a6', 'size': R(base_size * scale), 'color': '#%06x' % base_color, 'pad': 4}
    if style: st.update(style)
    cols = [R((xs[i + 1] - xs[i]) * scale) for i in range(nx)]
    return dict(x=R(xs[0] * scale), y=R(ys[0] * scale), w=R((xs[-1] - xs[0]) * scale), h=R((ys[-1] - ys[0]) * scale),
                cols=cols, rows=[{'h': R((ys[i + 1] - ys[i]) * scale), 'cells': grid[i]} for i in range(ny)], style=st)
