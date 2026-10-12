"""Vercel 함수: POST /api/import — PPTX · PDF → Spec Studio 문서 (tools/importapi.py 와 같은 변환기)

배포된 사이트(정적 파일)에서도 올리는 즉시 변환되게 한다. Vercel은 요청 본문을 4.5MB로 제한하므로
큰 PDF는 브라우저가 쪽 묶음으로 나눠 X-Part 헤더와 함께 보낸다 (js/panels.js importFile).
"""
import json, os, sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
import importapi  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = 0
        data = self.rfile.read(length) if length > 0 else b''
        code, obj = importapi.run(self.headers.get('X-Filename'), data, {'X-Part': self.headers.get('X-Part')})
        self.send_json(code, obj)

    def do_GET(self):
        self.send_json(405, {'error': 'POST 로 파일을 보내세요'})
