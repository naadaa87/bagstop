// 공통 도구: 응답, 오류, 시간(KST), 코드 생성, 입력 검증

export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const bad = (code, message, extra) => new ApiError(400, code, message, extra);
export const notFound = (message = '찾을 수 없어요.') => new ApiError(404, 'not_found', message);
export const forbidden = (message = '권한이 없어요.') => new ApiError(403, 'forbidden', message);
export const unauthorized = (message = '로그인이 필요해요.') => new ApiError(401, 'unauthorized', message);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

// ---------- 시간 ----------
// 저장은 UTC ISO 문자열, 화면과 정책 계산은 한국 시간(KST, UTC+9, 서머타임 없음)
const KST = 9 * 3600 * 1000;
export const MIN = 60 * 1000;
export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;

export const nowMs = () => Date.now();
export const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const ms = (isoStr) => new Date(isoStr).getTime();

/** 'YYYY-MM-DDTHH:mm' (KST) → epoch ms */
export function kstToMs(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(local || ''));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - KST;
}
/** epoch ms → KST 구성 요소 */
export function kstParts(t) {
  const d = new Date(t + KST);
  const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
  const hh = d.getUTCHours(), mm = d.getUTCMinutes();
  const p2 = (n) => String(n).padStart(2, '0');
  return {
    y, mo, da, hh, mm,
    weekday: d.getUTCDay(),
    date: `${y}-${p2(mo)}-${p2(da)}`,
    time: `${p2(hh)}:${p2(mm)}`,
    month: `${y}-${p2(mo)}`,
    minOfDay: hh * 60 + mm,
    local: `${y}-${p2(mo)}-${p2(da)}T${p2(hh)}:${p2(mm)}`,
  };
}
/** KST 날짜 문자열의 0시 → epoch ms */
export const kstDayStart = (dateStr) => kstToMs(`${dateStr}T00:00`);
/** KST 월('YYYY-MM')의 시작·끝(다음 달 1일 0시) */
export function kstMonthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const from = Date.UTC(y, m - 1, 1) - KST;
  const to = Date.UTC(y, m, 1) - KST;
  return { from, to };
}

// ---------- 코드·토큰 ----------
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function randomCode(len = 6) {
  const b = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[b[i] % CODE_CHARS.length];
  return s;
}
export function randomHex(bytes = 16) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export const randomPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- 입력 검증 ----------
export const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
export const int = (v, def = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : def;
};
export const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ''));
export const oneOf = (v, list, def) => (list.includes(v) ? v : def);

export function need(cond, code, message) {
  if (!cond) throw bad(code, message);
}

export function slugify(text) {
  const s = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s;
}

export const LANGS = ['ko', 'en', 'ja', 'zh-hans', 'zh-hant'];
export const pickLang = (v) => (LANGS.includes(v) ? v : 'en');

export const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;

export function safeJson(text, def) {
  try {
    const v = JSON.parse(text);
    return v == null ? def : v;
  } catch {
    return def;
  }
}
