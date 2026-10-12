// Spec Studio 서버 API 찾기
//  · 같은 주소: tools/serve.py 로 연 편집기, 또는 배포된 사이트의 변환 함수(Vercel api/*.py)
//  · 이 PC의 serve.py (localhost:5180): 파일로 열었거나 변환 API가 없는 정적 서버에서 연 경우,
//    그리고 자동 구현(AI)처럼 로컬 서버에만 있는 기능 (preferLocal)
const LOCAL = ['http://localhost:5180', 'http://127.0.0.1:5180'];
const found = { same: undefined, local: undefined };   // undefined = 아직 모름, null = 없음, 그 밖 = { base, info }

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

async function same(force) {
  if (!location.protocol.startsWith('http')) return null;
  if (found.same === undefined || force || found.same === null) {
    const info = await ping('');
    found.same = info ? { base: '', info } : null;
  }
  return found.same;
}
async function local(force) {
  if (found.local && !force) return found.local;
  for (const b of LOCAL) {
    if (b === location.origin) continue;
    const info = await ping(b);
    if (info) return (found.local = { base: b, info });
  }
  return (found.local = null);
}

// 서버 찾기 → { base, info } 또는 null
export async function findServer(force, preferLocal) {
  const s = await same(force);
  if (s && (s.info.local || !preferLocal)) return s;
  const l = await local(force);
  return l || s;
}

// API 호출: 서버를 찾아서 보낸다. 서버가 없으면 { offline: true }
export async function call(path, opts, preferLocal) {
  const s = await findServer(false, preferLocal);
  if (!s) return { offline: true };
  try {
    const res = await fetch(s.base + path, opts);
    const body = await res.json().catch(() => null);
    return { res, body, base: s.base, info: s.info };
  } catch (e) {
    found.same = found.local = undefined;   // 도중에 서버가 꺼졌다
    return { offline: true, error: e };
  }
}
