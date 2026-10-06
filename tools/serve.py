"""Spec Studio 로컬 서버: 정적 파일 + PPTX/PDF → JSON 변환 API

  python spec-studio/tools/serve.py            # http://localhost:5180/spec-studio/

python -m http.server 와 같은 방식으로 저장소 루트를 서비스하고, 여기에 변환 API를 더한다.
  POST /api/import   본문 = 파일 바이트, X-Filename = 원래 파일 이름(URL 인코딩)
                     → { doc, report }   (.pptx: pptx2json, .pdf: pdf2json — PyMuPDF 필요)
  GET  /api/ping     → { ok, pptx, pdf }
보안상 127.0.0.1 에만 열린다.
"""
import argparse, http.server, json, os, re, sys, tempfile, threading, traceback
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


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 편집기 코드를 고친 뒤 새로고침하면 바로 반영되게
        if self.path.split('?')[0].endswith(('.js', '.css', '.html', '/')):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split('?')[0] == '/api/ping':
            self.send_json(200, {'ok': True, 'pptx': True, 'pdf': pdf_available()})
            return
        super().do_GET()

    def do_POST(self):
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
