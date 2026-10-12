"""PPTX · PDF → Spec Studio 문서 변환 API (로컬 서버 tools/serve.py 와 Vercel 함수 api/import.py 가 함께 쓴다)

  run(name, data, headers) → (HTTP 상태, 응답 dict)
  헤더:
    X-Filename   원래 파일 이름 (URL 인코딩)
    X-Part       큰 PDF를 쪽 묶음으로 나눠 보낼 때: JSON {"index","offset","total","dividers","screens"}
"""
import json, os, re, sys, tempfile, threading, traceback, zipfile
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
MAX_BYTES = 200 * 1024 * 1024
LOCK = threading.Lock()   # 변환기는 모듈 전역 상태를 써서 한 번에 하나씩


def pdf_available():
    try:
        import pymupdf  # noqa: F401
        return True
    except Exception:
        return False


def run(name, data, headers=None):
    headers = headers or {}
    if not data:
        return 400, {'error': '파일이 비어 있습니다'}
    if len(data) > MAX_BYTES:
        return 413, {'error': '파일이 너무 큽니다 (최대 200MB)'}
    name = os.path.basename(unquote(name or 'upload.pptx'))
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', name) or 'upload.pptx'
    ext = os.path.splitext(name)[1].lower()
    if ext not in ('.pptx', '.pdf'):
        return 415, {'error': 'PPTX 또는 PDF 파일만 가져올 수 있습니다 (.ppt 는 PowerPoint에서 .pptx로 저장해 주세요)'}
    part = None
    if headers.get('X-Part'):
        try:
            part = {k: int(v) for k, v in json.loads(headers['X-Part']).items() if k in ('index', 'offset', 'total', 'dividers', 'screens')}
        except Exception:
            return 400, {'error': 'X-Part 형식이 잘못됐습니다'}
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
                    return 501, {'error': 'PDF 가져오기에는 PyMuPDF가 필요합니다 (pip install pymupdf pillow). PPTX는 바로 됩니다.'}
                import pdf2json
                doc, report = pdf2json.convert(src, out, part=part)
        print('[import] %s%s → 프레임 %d' % (name, ' (%d번째 묶음)' % (part['index'] + 1) if part else '', sum(len(p['frames']) for p in doc['pages'])), flush=True)
        return 200, {'doc': doc, 'report': report}
    except Exception as e:
        traceback.print_exc()
        msg = str(e)
        if isinstance(e, zipfile.BadZipFile):
            msg = 'PPTX 파일을 열 수 없습니다 (손상되었거나 암호가 걸린 파일일 수 있어요)'
        return 500, {'error': '변환 실패: ' + msg}
