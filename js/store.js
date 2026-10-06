// 저장소: 브라우저 IndexedDB(자동 저장) + 파일(.tnspec.json) 저장 · 열기
// 3단계에서 Supabase/Firebase로 바꿀 때 이 파일의 함수만 갈아 끼우면 된다.
import { serialize, load } from './model.js';

const DB = 'tn-spec-studio', STORE = 'docs';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  }));
}

// 저장 전에 "다시 열어도 깨지지 않는지" 확인: 직렬화 → 다시 읽기 → 검증
export function verifiedJSON(doc) {
  const json = serialize(doc);
  load(json);
  return json;
}

export async function saveLocal(doc) {
  const json = verifiedJSON(doc);
  await tx('readwrite', (s) => s.put({ id: doc.id, title: doc.meta.title, updated: Date.now(), size: json.length, json }));
  return json.length;
}
export async function listLocal() {
  const all = await tx('readonly', (s) => s.getAll());
  return (all || []).map(({ id, title, updated, size }) => ({ id, title, updated, size })).sort((a, b) => b.updated - a.updated);
}
export async function openLocal(id) {
  const rec = await tx('readonly', (s) => s.get(id));
  if (!rec) throw new Error('저장된 문서를 찾을 수 없습니다');
  return load(rec.json);
}
export function removeLocal(id) { return tx('readwrite', (s) => s.delete(id)); }

export function fileName(doc) {
  return (doc.meta.title || 'spec').replace(/[\\/:*?"<>|]/g, '_') + '_v' + (doc.meta.version || '0.1') + '.tnspec.json';
}

const FILE_TYPES = [{ description: '투네이션 기획서 (JSON)', accept: { 'application/json': ['.json'] } }];

// 파일로 저장: 지원 브라우저는 같은 파일에 덮어쓰기, 아니면 내려받기
export async function saveFile(doc, handle, saveAs = false) {
  const json = verifiedJSON(doc);
  if (window.showSaveFilePicker) {
    if (!handle || saveAs) handle = await window.showSaveFilePicker({ suggestedName: fileName(doc), types: FILE_TYPES });
    const w = await handle.createWritable();
    await w.write(json);
    await w.close();
    return handle;
  }
  download(json, fileName(doc));
  return null;
}

export function download(text, name, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function openFile() {
  if (window.showOpenFilePicker) {
    const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES });
    const f = await handle.getFile();
    return { doc: load(await f.text()), handle };
  }
  const f = await new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = () => res(i.files[0]);
    i.click();
  });
  if (!f) throw new Error('취소됨');
  return { doc: load(await f.text()), handle: null };
}

export function readImageFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => res({ mime: file.type, data: r.result, w: img.naturalWidth, h: img.naturalHeight, name: file.name || '' });
      img.onerror = () => rej(new Error('이미지를 읽을 수 없습니다'));
      img.src = r.result;
    };
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}
