# Spec Studio — 투네이션 상세기획서 작성 도구

`기획서양식.pdf`를 기본 템플릿으로 쓰는 Figma식 상세기획서 편집기입니다. 지금 들어 있는 범위는 4단계 계획 중 **1단계(문서 모델)와 2단계(편집기 기본기)**이고, 여기에 **PPT 기능 이식 6개 묶음**을 더했습니다.

## 실행

```bash
python spec-studio/tools/serve.py
```
저장소 루트에서 실행한 다음 <http://localhost:5180/spec-studio/>를 엽니다. 이 서버는 `python -m http.server`처럼 저장소 루트를 서비스하고, **PPTX · PDF 변환 API**(`POST /api/import`)를 더한 것입니다. 시작 화면의 올리기 영역, **파일 → PPTX · PDF 가져오기…**, 또는 화면 어디에나 파일을 끌어다 놓으면 바로 JSON으로 바뀌어 열립니다. 결과 창에서 `.tnspec.json`으로 내려받을 수도 있어요. 보안상 127.0.0.1에서만 열립니다.

빌드 과정은 없습니다(순수 ES 모듈). `python -m http.server`나 Vercel 같은 정적 서버에서도 편집기는 동작하지만, 올리기 변환은 안내 창이 뜨고 명령으로 변환해야 합니다.

```bash
node --test spec-studio/tests/model.test.mjs spec-studio/tests/features.test.mjs   # 테스트 19개
python spec-studio/tools/pptx2json.py 기획서.pptx -o out.tnspec.json              # PPTX 가져오기 (권장, 추가 설치 없음)
python spec-studio/tools/pdf2json.py 기획서.pdf -o out.tnspec.json                # PDF 가져오기 (PyMuPDF · Pillow 필요)
```

## 폴더 구조

| 경로 | 역할 |
|---|---|
| `js/model.js` | **문서 모델**: 스키마, 테마 기본값, 도형 목록, id 인덱스, 연산 적용/역연산, 되돌리기 기록, 검증, 직렬화 |
| `js/ops.js` | 편집 명령을 연산 목록으로 변환: 그룹, 순서, 정렬·간격·크기 같게, 크기 조절, 복사·붙여넣기, 컴포넌트, 표(병합·분할·채우기·균등), 서식 복사, 찾기·바꾸기, 목록. UI와 분리돼 있어 Node에서 테스트 가능 |
| `js/templates.js` | 기획서양식.pdf 레이아웃 7종, 문서 템플릿 5종, 기본 컴포넌트 |
| `js/render.js` | JSON을 HTML/SVG로 그림: 단락·목록, 도형 라이브러리 경로, 연결점·꺾은선, 이미지 자르기, 테마 색 |
| `js/editor.js` | 캔버스, 선택, 도구, 스냅·거리 가이드, 회전·자르기·표 칸 선택, 단축키, 클립보드, 자동 저장 |
| `js/viewtools.js` | 눈금자·안내선, 정렬 보기(썸네일), 프레임 메모 막대 |
| `js/panels.js` | 페이지·레이어·컴포넌트 패널, 속성 패널, 색 고르기, 찾기·바꾸기, 시작 화면, 미리보기, 인쇄 |
| `js/store.js` | IndexedDB 자동 저장, 파일 저장·열기 (3단계 백엔드 교체 지점) |
| `css/studio.css`, `css/features.css` | 화면 스타일 (기본 / PPT 기능) |
| `tools/pptx2json.py` | **PPTX를 JSON으로** (OOXML 직접 해석, 표준 라이브러리만 사용) |
| `tools/pdf2json.py` | PDF를 JSON으로 (기존 채팅 기획서 HTML 파이프라인 재활용) |
| `tools/serve.py` | 로컬 서버: 정적 파일 + 올리기 변환 API (`/api/import`, `/api/ping`) |
| `tools/common.py` | 가져오기 공용 (id, 그림 자원, 개정 이력 표, 문서 틀) |
| `tools/pdfkit/` | 기존 파이프라인 모듈. `legacy_build_chat_html.py`는 원본 빌드 스크립트 보관본 |
| `samples/` | 채팅 기획서를 가져온 결과 (`*.pptx.tnspec.json`, `*.tnspec.json`) |

## 1단계 · 문서 모델

```
문서 (schema: "toonation.spec", version: 1)
├─ meta        제목 · 프로젝트 · 팀 · 버전 · 날짜 · 작성자 · 저작권 · footer(슬로건/저작권/쪽 번호)
├─ theme       테마 색 [{key, name, value}] — 노드 색에 'theme:primary'처럼 적으면 테마를 바꿀 때 함께 바뀜
├─ settings    격자 간격 · 격자 표시/맞추기 · 눈금자
├─ pages[]     페이지 = 기획서의 장(章)                    { kind:"page", id, name, frames[] }
│   └─ frames[]  프레임 = 기획서 한 장 (PDF 한 쪽, 960×540)  { kind:"frame", id, name, layout, props, nodes[], notes?, hidden?, guides? }
│       └─ nodes[]  노드
├─ components[]  컴포넌트 원본                              { kind:"component", id, name, w, h, nodes[] }
└─ assets{}      이미지 자원 (dataURL)                       { mime, data, w, h, name }
```

**노드 종류** (모든 노드 공통: `id, type, name, x, y, w, h, rotation?, hidden?, locked?, opacity?, blend?, shadow?`)

| type | 주요 속성 |
|---|---|
| `text` 글 | `runs:[{t, b, i, u, s, color, size, font, sup, sub, link, bg}]`, `paras:[{list: bullet\|number, lv, cont, align, sb, sa}]`, `style:{size, color, bold, align, valign, lineHeight, font, bg, border, pad, letter, paraSpace, nowrap, vertical, fit: grow\|shrink}` |
| `image` 이미지 | `asset`, `fit`, `crop:{l,t,r,b}`(비율), `mask: ellipse`, `radius`, `stroke/strokeWidth`, `flipH/flipV` |
| `table` 표 | `cols`, `rows:[{h, cells:[{runs, bg, color, align, valign, bold, size, span:[가로,세로]} \| null]}]`, `style`. `null` = 병합으로 가려진 칸 |
| `shape` 도형 | `shape`(29종: 기본·설명선·블록 화살표·순서도), `fill, gradient:{to, angle}, fillOpacity, stroke, strokeWidth, dash, radius, tail`(말풍선 꼬리), `flipH/flipV`, 라벨용 `runs/paras/style` |
| `connector` 연결선·선·화살표 | `pts`, `from/to:{node, side: n\|e\|s\|w}`(연결점), `route: straight\|elbow`, `startCap/endCap: arrow\|open\|diamond\|dot\|circle\|none`, `capSize`, `dash` |
| `description` | `num, title, body, color`. 화면 설계 프레임의 Description 패널에 번호순으로 자동 정리 |
| `hotspot` 인터랙션 영역 | `action:{type: goto\|url\|note, …}` |
| `group` · `instance` | 그룹 자식은 그룹 원점 기준 / 인스턴스는 `component` + `overrides` |

### 편집 = 연산

```js
{ op:'insert', parent:'<id>|doc', index, item }
{ op:'remove', id }
{ op:'move',   id, parent, index }
{ op:'set',    id:'<id>|doc', key:'style.size', value }   // value 생략 = 키 삭제
```
- `apply()`는 문서를 바꾸고, 되돌리는 연산을 함께 돌려줍니다.
- 드래그나 타이핑처럼 이어지는 편집은 한 번의 되돌리기로 합쳐집니다.
- 작업 중 연산 하나가 실패하면 작업 전체를 되돌립니다.
- 저장할 때마다 `serialize → load → validate`를 통과해야 저장됩니다.

## 2단계 + PPT 기능 이식

| 묶음 | 기능 |
|---|---|
| 기본 | 템플릿 5종 · 프레임 7종, 레이어 패널, 그룹, 순서, 복사·붙여넣기, 정렬·간격·거리 가이드, 컴포넌트(원본 수정 → 모든 인스턴스 반영), Description 자동 패널, 미리보기, 인쇄·PDF 저장 |
| ① PPTX 가져오기 | 도형, 글(단락·목록·서식), 표(병합·칸 색), 그림(자르기), 연결선(연결점·화살표), 그룹, 회전, 테마 색(마스터별), 자리표시자 상속, 노트(→ 프레임 메모), 숨긴 슬라이드, 페이지 종류 자동 판별 |
| ② 글 | 글머리 기호·번호(Ctrl+Shift+8/7), 들여쓰기(Tab/Shift+Tab, 5단계), 단락별 정렬, 자동 맞춤(글에 맞춰 늘리기 / 넘치면 줄이기), 서식 복사·붙여넣기(Ctrl+Shift+C/V)·서식 붓, 찾기·바꾸기(Ctrl+F/H, 컴포넌트 원본 포함, 한 번에 되돌리기), 위첨자(Ctrl+=), 링크(Ctrl+K), 자간·단락 간격·안쪽 여백·테두리·세로쓰기 |
| ③ 표 | 칸 범위 선택(끌기·Shift+클릭·Shift+방향키), 셀 병합·분할, 엑셀·시트 붙여넣기(칸 채우기, 모자라면 행·열 추가, 칸을 고르지 않았으면 새 표), 칸 범위를 엑셀로 복사, 열·행 경계 드래그, 열 너비·행 높이 같게, 범위 서식(배경·글자색·정렬·세로 정렬·굵게), 표 스타일 프리셋 |
| ④ 도형 | 도형 라이브러리 29종(말풍선·블록 화살표·순서도 포함), 회전 손잡이(Shift 15°), 뒤집기, 그라데이션·그림자·채우기 투명도, 말풍선 꼬리 손잡이, 선·화살표 도구(Shift 45°), 연결점(상하좌우)·꺾은선 자동 경로, 화살표 머리 5종·크기 |
| ⑤ 배치·프레임 | 눈금자(Shift+R)와 끌어 만드는 안내선, 격자 표시·격자에 맞추기, 크기 같게, Tab으로 요소 순환 선택, 정렬 보기(썸네일, 페이지 사이로 끌어 옮기기), 프레임 메모(아래 막대, 미리보기에서 N), 프레임 숨기기(미리보기·인쇄 제외), Ctrl+M · F5 · Shift+F5 · F2 · Ctrl+Shift+>/<, 바닥글 설정 |
| ⑥ 이미지·테마 | 이미지 자르기(더블클릭: 손잡이로 범위, 끌어서 위치), 원형 마스크·둥근 모서리·테두리, 테마 색 팔레트(문서 정보에서 편집 → 쓰인 곳 전부 반영), 최근 사용 색 |
| 홈 리본 · 슬라이드 창 | PowerPoint 홈 탭과 같은 리본(클립보드 · 슬라이드 · 글꼴 · 단락 · 그리기 · 편집): 글 편집 중이면 고른 글자에만, 표 칸을 고르면 그 칸에, 아니면 선택한 객체에 적용. 취소선 · 자간 · 대소문자 · 형광펜 · 줄 간격 · 다단 · 텍스트 방향 · 빠른 스타일 · 도형 채우기/윤곽선/효과 · 구역. Ctrl+F1로 접기. 왼쪽에 화면 단위 썸네일(슬라이드 창), 오른쪽 클릭 메뉴 |
| HTML 프로토타입 | 인터랙션 영역의 동작 'HTML 프로토타입': HTML 파일 올리기 · 서버 폴더에서 고르기 · 주소 · 코드 붙여넣기. 원래 크기(예: 1080×720)를 영역에 맞춰 축소, 미리보기에서 실제로 동작, 편집 화면에서는 더블클릭으로 체험(Esc로 끝). sandbox iframe으로 편집기와 격리. .html 파일을 캔버스에 끌어다 놓아도 됨 |

## 3·4단계 연결 지점

| 다음 단계 | 연결 지점 |
|---|---|
| 백엔드 (Supabase·Firebase) | `store.js`의 `saveLocal`, `openLocal`, `listLocal`을 교체 |
| 실시간 동시 편집 (Yjs·Liveblocks) | `History.onChange`의 `ops`를 공유 문서에 반영 |
| 댓글 | 노드 id · 프레임 id에 연결 (프레임 메모와는 별개) |
| 리비전 비교 | 저장본 JSON 두 개를 id 단위로 비교 |
| 정책 변수 | 테마 색 토큰(`theme:key`)과 같은 방식으로 글에 변수 토큰을 두면 됨 |
| 오브젝트 상태, QA, Jira | `description` 노드를 단위로 확장 |
