"""Spec Studio 로컬 서버: 정적 파일 + PPTX/PDF → JSON 변환 API

  python spec-studio/tools/serve.py            # http://localhost:5180/spec-studio/

python -m http.server 와 같은 방식으로 저장소 루트를 서비스하고, 여기에 변환 API를 더한다.
  POST /api/import   본문 = 파일 바이트, X-Filename = 원래 파일 이름(URL 인코딩)
                     → { doc, report }   (.pptx: pptx2json, .pdf: pdf2json — PyMuPDF 필요)
  POST /api/screen2html  본문 = { image(dataURL), w, h, frame, descriptions[], request }
                     → { html, model }   화면 스크린샷 → 동작하는 HTML 프로토타입 (Claude API)
  GET  /api/ping     → { ok, pptx, pdf, ai }
보안상 127.0.0.1 에만 열린다.

자동 구현(/api/screen2html)은 Anthropic API 키가 있어야 한다:
  환경 변수 ANTHROPIC_API_KEY  또는  tools/ai.key 파일(한 줄, 저장소에 올라가지 않음)
  모델은 SPEC_STUDIO_MODEL 로 바꿀 수 있다 (기본 claude-opus-5-5).
"""
import argparse, http.server, json, os, re, sys, tempfile, threading, traceback
import urllib.error, urllib.request
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
MAX_BYTES = 200 * 1024 * 1024
LOCK = threading.Lock()   # 변환기는 모듈 전역 상태를 써서 한 번에 하나씩


def pdf_available():
    try:
        import pymupdf  # noqa: F401
        return True
    except Exception:
        return False


def api_key():
    k = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if k:
        return k
    p = os.path.join(HERE, 'ai.key')
    if os.path.isfile(p):
        with open(p, encoding='utf-8') as f:
            return f.read().strip()
    return ''


MODEL = os.environ.get('SPEC_STUDIO_MODEL', 'claude-opus-5-5')

SYSTEM_PROMPT = """너는 투네이션 상세기획서용 프론트엔드 프로토타이퍼다.
화면 스크린샷 한 장과 그 화면의 기획 Description을 받아, 그 화면을 그대로 재현하고 실제로 눌러 볼 수 있게 동작하는 HTML 문서 하나를 만든다.

규칙
- 뷰포트는 정확히 {W}×{H} CSS px. html, body 는 margin 0, 크기 {W}×{H}, overflow hidden. 스크린샷의 위치 · 크기 · 색 · 여백 · 글자를 최대한 똑같이 맞춘다. 글자는 스크린샷 그대로(한국어) 옮긴다.
- 글꼴: 'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif.
- 외부 자원 금지(CDN, 웹 글꼴, 외부 이미지 주소 금지). 아이콘은 인라인 SVG · 이모지 · CSS로, 사진 · 프로필 이미지는 CSS 그라데이션이나 단색 자리로 대신한다.
- 순수 HTML/CSS/JS만. 스크립트는 문서 끝 <script> 하나에. 이 문서는 sandbox iframe(불투명 출처)에서 돌아가므로 localStorage · sessionStorage · cookie · alert · confirm 을 쓰지 않는다(알림은 화면 안 토스트로).
- 실제 서비스처럼 동작하게 만든다: 버튼 눌림 반응, 탭 전환, 토글, 입력창 타이핑과 Enter 전송(예: 채팅이면 메시지가 목록에 추가되고 스크롤), 드롭다운 · 메뉴 · 모달 열고 닫기, 목록 스크롤, hover 상태 등. 화면에 보이는 요소는 가능한 한 모두 반응하게 한다.
- Description은 동작 명세다. 번호 N의 Description이 설명하는 요소에 그 동작을 구현하고, 그 요소의 바깥 요소에 data-spec="N" 속성을 단다(Description과 연결하는 데 쓴다). 위치가 주어진 Description은 그 좌표 근처 요소다.
- 출력은 ```html 코드 블록 하나만. 설명 문장은 쓰지 않는다."""


def extract_html(text):
    m = re.search(r'```(?:html)?\s*\n(.*?)```', text, re.S | re.I)
    if m:
        return m.group(1).strip()
    i = text.lower().find('<!doctype')
    if i < 0:
        i = text.lower().find('<html')
    return text[i:].strip() if i >= 0 else ''


def screen2html(req):
    key = api_key()
    if not key:
        raise PermissionError('no-key')
    m = re.match(r'data:(image/(?:png|jpeg|webp|gif));base64,(.+)$', req.get('image') or '', re.S)
    if not m:
        raise ValueError('스크린샷 이미지가 없습니다 (PNG · JPG · WEBP · GIF)')
    media, data = m.group(1), re.sub(r'\s+', '', m.group(2))
    if len(data) * 3 // 4 > 5 * 1024 * 1024:
        raise ValueError('스크린샷이 너무 큽니다 (최대 5MB)')
    w, h = int(req.get('w') or 1080), int(req.get('h') or 720)
    lines = ['화면 이름: %s' % (req.get('frame') or '(이름 없음)'), '뷰포트: %d×%d px (스크린샷과 같은 크기)' % (w, h), '', 'Description:']
    descs = req.get('descriptions') or []
    for d in descs:
        pos = ' (위치: x=%d, y=%d)' % (d['x'], d['y']) if d.get('x') is not None else ''
        lines.append('%s. %s%s' % (d.get('num', ''), (d.get('title') or '').strip(), pos))
        if (d.get('body') or '').strip():
            lines.append('   ' + d['body'].strip().replace('\n', '\n   '))
    if not descs:
        lines.append('(없음 — 스크린샷만 보고 자연스러운 동작을 구현)')
    if (req.get('request') or '').strip():
        lines += ['', '추가 요청: ' + req['request'].strip()]
    body = {
        'model': MODEL,
        'max_tokens': 32000,
        'system': SYSTEM_PROMPT.replace('{W}', str(w)).replace('{H}', str(h)),
        'messages': [{'role': 'user', 'content': [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': media, 'data': data}},
            {'type': 'text', 'text': '\n'.join(lines)},
        ]}],
    }
    r = urllib.request.Request('https://api.anthropic.com/v1/messages', data=json.dumps(body).encode('utf-8'), method='POST', headers={
        'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=600) as resp:
            out = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')
        try:
            detail = json.loads(detail)['error']['message']
        except Exception:
            pass
        raise RuntimeError('Claude API 오류 %d: %s' % (e.code, detail))
    text = ''.join(b.get('text', '') for b in out.get('content', []) if b.get('type') == 'text')
    html = extract_html(text)
    if not html:
        raise RuntimeError('응답에서 HTML을 찾지 못했습니다' + (' (출력이 잘림)' if out.get('stop_reason') == 'max_tokens' else ''))
    return {'html': html, 'model': out.get('model', MODEL), 'truncated': out.get('stop_reason') == 'max_tokens'}


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 편집기 코드를 고친 뒤 새로고침하면 바로 반영되게
        if self.path.split('?')[0].endswith(('.js', '.css', '.html', '/')):
            self.send_header('Cache-Control', 'no-store')
        # 다른 주소로 연 편집기(파일로 열기 · 다른 포트의 정적 서버)도 이 서버의 변환 API를 쓸 수 있게
        origin = self.headers.get('Origin')
        if origin and self.path.startswith('/api/') and self.cors_ok(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Filename')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Vary', 'Origin')
        super().end_headers()

    def cors_ok(self, origin):
        local = re.fullmatch(r'https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?', origin) is not None
        if self.path.split('?')[0] == '/api/screen2html':
            return local            # API 키를 쓰는 곳은 이 PC의 페이지만
        return local or origin == 'null'   # file:// 로 연 편집기

    def do_OPTIONS(self):
        self.send_response(204 if self.path.startswith('/api/') else 405)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split('?')[0] == '/api/ping':
            self.send_json(200, {'ok': True, 'pptx': True, 'pdf': pdf_available(), 'ai': bool(api_key()), 'model': MODEL})
            return
        super().do_GET()

    def do_screen2html(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > 12 * 1024 * 1024:
            self.send_json(400, {'error': '요청이 비었거나 너무 큽니다'})
            return
        try:
            req = json.loads(self.rfile.read(length).decode('utf-8'))
            print('[screen2html] %s … (%s)' % (req.get('frame') or '', MODEL), flush=True)
            res = screen2html(req)
            print('[screen2html] 완료 %dKB' % (len(res['html']) // 1024), flush=True)
            self.send_json(200, res)
        except PermissionError:
            self.send_json(501, {'error': 'no-key', 'message': 'Anthropic API 키가 없습니다. ANTHROPIC_API_KEY 환경 변수나 spec-studio/tools/ai.key 파일에 키를 넣고 서버를 다시 켜세요.'})
        except ValueError as e:
            self.send_json(400, {'error': str(e)})
        except Exception as e:
            traceback.print_exc()
            self.send_json(502, {'error': str(e)})

    def do_POST(self):
        if self.path.split('?')[0] == '/api/screen2html':
            self.do_screen2html()
            return
        if self.path.split('?')[0] != '/api/import':
            self.send_json(404, {'error': '없는 주소입니다'})
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self.send_json(400, {'error': '파일이 비어 있습니다'})
            return
        if length > MAX_BYTES:
            self.send_json(413, {'error': '파일이 너무 큽니다 (최대 200MB)'})
            return
        name = os.path.basename(unquote(self.headers.get('X-Filename') or 'upload.pptx'))
        name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', name) or 'upload.pptx'
        ext = os.path.splitext(name)[1].lower()
        if ext not in ('.pptx', '.pdf'):
            self.send_json(415, {'error': 'PPTX 또는 PDF 파일만 가져올 수 있습니다 (.ppt 는 PowerPoint에서 .pptx로 저장해 주세요)'})
            return
        data = self.rfile.read(length)
        try:
            with LOCK, tempfile.TemporaryDirectory() as d:
                src = os.path.join(d, name)
                out = os.path.join(d, 'out.tnspec.json')
                with open(src, 'wb') as f:
                    f.write(data)
                if ext == '.pptx':
                    import pptx2json
                    doc, report = pptx2json.convert(src, out)
                else:
                    if not pdf_available():
                        self.send_json(501, {'error': 'PDF 가져오기에는 PyMuPDF가 필요합니다 (pip install pymupdf pillow). PPTX는 바로 됩니다.'})
                        return
                    import pdf2json
                    doc, report = pdf2json.convert(src, out)
            self.send_json(200, {'doc': doc, 'report': report})
            print('[import] %s → 프레임 %d' % (name, sum(len(p['frames']) for p in doc['pages'])), flush=True)
        except Exception as e:
            traceback.print_exc()
            msg = str(e)
            if isinstance(e, __import__('zipfile').BadZipFile):
                msg = 'PPTX 파일을 열 수 없습니다 (손상되었거나 암호가 걸린 파일일 수 있어요)'
            self.send_json(500, {'error': '변환 실패: ' + msg})


def main():
    ap = argparse.ArgumentParser(description='Spec Studio 로컬 서버')
    ap.add_argument('--port', type=int, default=5180)
    ap.add_argument('--root', default=os.path.dirname(os.path.dirname(HERE)), help='서비스할 폴더 (기본: 저장소 루트)')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    os.chdir(a.root)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    print('Spec Studio: http://localhost:%d/spec-studio/  (변환 API: /api/import, PDF %s)' % (a.port, '사용 가능' if pdf_available() else '사용 불가 — PyMuPDF 없음'), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
