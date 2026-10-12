"""Vercel 함수: GET /api/ping — 변환 API가 있는지 (배포된 사이트용, 자동 구현 AI는 로컬 서버에서만)"""
import json, os, sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
import importapi  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({'ok': True, 'local': False, 'pptx': True, 'pdf': importapi.pdf_available(), 'ai': False, 'maxBody': 4 * 1024 * 1024}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)
