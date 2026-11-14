// 세 화면(고객 웹·호스트센터·Admin)이 함께 쓰는 도구
import { html, render, useState, useEffect, useRef, useCallback, useMemo } from '/assets/vendor/preact-htm.js';
export { html, render, useState, useEffect, useRef, useCallback, useMemo };

// ---------- API ----------
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    const e = new Error('인터넷 연결을 확인해 주세요.');
    e.code = 'network';
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data?.error?.message || '문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.');
    e.code = data?.error?.code || 'error';
    e.status = res.status;
    e.data = data?.error;
    throw e;
  }
  return data;
}

/** 데이터를 불러오는 훅. reload()로 다시 불러옵니다. */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const seq = useRef(0);
  const load = useCallback(async (quiet) => {
    const my = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (my === seq.current) setState({ loading: false, data, error: null });
    } catch (error) {
      if (my === seq.current) setState({ loading: false, data: null, error });
    }
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: () => load(true) };
}

// ---------- 표시 형식 ----------
export const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
export const krw = (n) => `₩${Number(n || 0).toLocaleString('en-US')}`;
export const minToHM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const WD = {
  ko: ['일', '월', '화', '수', '목', '금', '토'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ja: ['日', '月', '火', '水', '木', '金', '土'],
  'zh-hans': ['周日', '周一', '周二', '周三', '周四', '周五', '周六'], 'zh-hant': ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
};
export const weekdayName = (i, lang = 'ko') => (WD[lang] || WD.en)[i];
/** 'YYYY-MM-DDTHH:mm'(한국 시간) → '11/20 (금) 10:00' */
export function fmtLocal(local, lang = 'ko', withTime = true) {
  if (!local) return '';
  const [d, t] = local.split('T');
  const [y, m, da] = d.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, da)).getUTCDay();
  return `${m}/${da} (${weekdayName(wd, lang)})${withTime && t ? ` ${t.slice(0, 5)}` : ''}`;
}
/** UTC ISO → 한국 시간 'YYYY-MM-DDTHH:mm' */
export function isoToLocal(iso) {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16);
}
export const fmtIso = (iso, lang = 'ko') => fmtLocal(isoToLocal(iso), lang);
/** 지금의 한국 시간 */
export function kstNow() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), month: d.toISOString().slice(0, 7) };
}
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- 토스트 ----------
export function toast(message, type = '') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 4500 : 2800);
}
export const toastErr = (e) => toast(e?.message || String(e), 'err');

// ---------- 공통 컴포넌트 ----------
export function Modal({ title, onClose, wide, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, []);
  return html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && onClose && onClose()}>
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${title}</h3>${onClose && html`<button class="modal-x" onClick=${onClose} aria-label="닫기">×</button>`}</div>
      ${children}
    </div>
  </div>`;
}
export const Spinner = () => html`<div class="spinner" role="status" aria-label="불러오는 중"></div>`;

export function Stepper({ value, onChange, min = 0, max = 10 }) {
  return html`<div class="stepper">
    <button type="button" disabled=${value <= min} onClick=${() => onChange(value - 1)} aria-label="줄이기">−</button>
    <span>${value}</span>
    <button type="button" disabled=${value >= max} onClick=${() => onChange(value + 1)} aria-label="늘리기">+</button>
  </div>`;
}
export function Stars({ value }) {
  const n = Math.round(value || 0);
  return html`<span class="stars" aria-label="${value}/5">${'★'.repeat(n)}<span style="color:var(--line)">${'★'.repeat(5 - n)}</span></span>`;
}
export function StarPick({ value, onChange }) {
  return html`<div class="star-pick row gap4">
    ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" class=${n <= value ? 'on' : ''} onClick=${() => onChange(n)} aria-label="${n}점">★</button>`)}
  </div>`;
}

/** 버튼을 누르는 동안 중복 클릭을 막아 주는 훅 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
}

// ---------- 사진 ----------
/** 사진을 긴 변 1200px JPEG로 줄여 data URL로 돌려줍니다. PDF는 그대로. */
export function fileToDataUrl(file, max = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽지 못했어요.'));
    reader.onload = () => {
      if (file.type === 'application/pdf') return resolve(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error('사진 파일을 열 수 없어요.'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** 사진 여러 장 올리기. upload(dataUrl) → 파일 id. value는 [{id, url}] */
export function PhotoPicker({ value, onChange, upload, max = 6, label = '사진', capture }) {
  const [busy, setBusy] = useState(false);
  const onPick = async (e) => {
    const files = [...e.target.files].slice(0, max - value.length);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      const added = [];
      for (const f of files) {
        const dataUrl = await fileToDataUrl(f);
        const id = await upload(dataUrl);
        added.push({ id, url: dataUrl });
      }
      onChange([...value, ...added]);
    } catch (err) {
      toastErr(err);
    } finally {
      setBusy(false);
    }
  };
  return html`<div class="photos">
    ${value.map((p) => html`<div class="ph" key=${p.id}><img src=${p.url} alt="" /><button type="button" onClick=${() => onChange(value.filter((x) => x.id !== p.id))} aria-label="지우기">×</button></div>`)}
    ${value.length < max &&
    html`<label class="add">${busy ? html`<span>올리는 중…</span>` : html`<b>+</b><span>${label}</span>`}
      <input type="file" accept="image/*" capture=${capture} multiple=${!capture} class="hide" onChange=${onPick} disabled=${busy} />
    </label>`}
  </div>`;
}

// 지도 타일. 방문자가 늘면 유료 타일 서비스 주소로 바꿔 주세요.
export const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// ---------- 스크립트·QR ----------
const loaded = {};
export function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('필요한 파일을 불러오지 못했어요.'));
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}
export function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}
export function QR({ text, size = 200 }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    loadScript('/assets/vendor/qrcode.js').then(() => {
      const qr = window.qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      setSvg(qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
    });
  }, [text]);
  return html`<div style="width:${size}px;height:${size}px" dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

export const copyText = async (text, done = '복사했어요.') => {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast(text);
  }
};
