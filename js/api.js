// Spec Studio 서버(tools/serve.py) API 찾기
// 편집기를 serve.py 로 열었으면 같은 주소, 아니면(파일로 열기 · 다른 포트의 정적 서버) 이 PC에서 켜져 있는 serve.py 를 찾아 쓴다.
const CANDIDATES = ['http://localhost:5180', 'http://127.0.0.1:5180'];
let base = null;   // 찾은 서버 주소 ('' = 같은 주소)

async function ping(b, ms = 1500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(b + '/api/ping', { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.ok ? j : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// 서버 찾기 → { base, info } 또는 null
export async function findServer(force) {
  if (base !== null && !force) {
    const info = await ping(base);
    if (info) return { base, info };
    base = null;
  }
  const list = (location.protocol.startsWith('http') ? [''] : []).concat(CANDIDATES.filter((c) => c !== location.origin));
  for (const b of list) {
    const info = await ping(b);
    if (info) { base = b; return { base: b, info }; }
  }
  return null;
}

// API 호출: 서버를 찾아서 보낸다. 서버가 없으면 { offline: true }
export async function call(path, opts) {
  const s = await findServer();
  if (!s) return { offline: true };
  try {
    const res = await fetch(s.base + path, opts);
    const body = await res.json().catch(() => null);
    return { res, body, base: s.base };
  } catch (e) {
    base = null;   // 도중에 서버가 꺼졌다
    return { offline: true, error: e };
  }
}
