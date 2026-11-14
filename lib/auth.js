// 비밀번호 해시, 세션, 관리자 권한
import { all, first, run, insert } from './db.js';
import { ApiError, forbidden, unauthorized, iso, nowMs, randomHex, sha256Hex, DAY, MIN } from './util.js';

const ITER = 100000; // Workers에서 허용되는 PBKDF2 최대 반복 횟수

async function pbkdf2(password, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export async function hashPassword(password) {
  const salt = randomHex(16);
  return `pbkdf2$${ITER}$${salt}$${await pbkdf2(password, salt, ITER)}`;
}
export async function verifyPassword(password, stored) {
  const [alg, iter, salt, hash] = String(stored || '').split('$');
  if (alg !== 'pbkdf2' || !salt || !hash) return false;
  const got = await pbkdf2(password, salt, Number(iter));
  let diff = got.length ^ hash.length;
  for (let i = 0; i < got.length && i < hash.length; i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
export function checkPasswordRule(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new ApiError(400, 'weak_password', '비밀번호는 8자 이상으로 정해 주세요.');
}

// ---------- 세션 ----------
const COOKIE = { host: 'bagstop_host', admin: 'bagstop_admin' };
const TTL = { host: 30 * DAY, admin: 12 * 3600 * 1000 };

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}
function cookieHeader(request, name, value, maxAgeSec) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export async function createSession(db, request, kind, userId) {
  const token = randomHex(32);
  const now = nowMs();
  await insert(db, 'sessions', {
    token_hash: await sha256Hex(token), kind, user_id: userId,
    expires_at: iso(now + TTL[kind]), created_at: iso(now),
  });
  // 오래된 세션은 로그인할 때 함께 치웁니다.
  await run(db, 'DELETE FROM sessions WHERE expires_at < ?', iso(now));
  return cookieHeader(request, COOKIE[kind], token, Math.floor(TTL[kind] / 1000));
}
export async function destroySession(db, request, kind) {
  const token = readCookie(request, COOKIE[kind]);
  if (token) await run(db, 'DELETE FROM sessions WHERE token_hash=?', await sha256Hex(token));
  return cookieHeader(request, COOKIE[kind], '', 0);
}
async function sessionUser(db, request, kind) {
  const token = readCookie(request, COOKIE[kind]);
  if (!token) return null;
  const s = await first(db, 'SELECT user_id, expires_at FROM sessions WHERE token_hash=? AND kind=?', await sha256Hex(token), kind);
  if (!s || s.expires_at < iso(nowMs())) return null;
  return s.user_id;
}

export async function requireHost(db, request) {
  const id = await sessionUser(db, request, 'host');
  if (!id) throw unauthorized();
  const host = await first(db, 'SELECT * FROM hosts WHERE id=?', id);
  if (!host) throw unauthorized();
  return host;
}
export async function requireAdmin(db, request, perm) {
  const id = await sessionUser(db, request, 'admin');
  if (!id) throw unauthorized();
  const admin = await first(db, 'SELECT id, email, name, role, active FROM admins WHERE id=?', id);
  if (!admin || !admin.active) throw unauthorized();
  if (perm && !can(admin.role, perm)) throw forbidden('이 작업을 할 수 있는 권한이 없어요.');
  return admin;
}

// ---------- 관리자 역할과 권한 ----------
export const ROLES = {
  owner: '총괄',
  ops: '운영',
  cs: 'CS',
  finance: '정산',
  content: '콘텐츠',
  viewer: '조회',
};
// 권한 → 허용 역할. 'view'는 모든 역할이 가집니다.
const PERMS = {
  view: ['owner', 'ops', 'cs', 'finance', 'content', 'viewer'],
  hosts: ['owner', 'ops'], // 호스트 심사·스팟 상태 변경
  bookings: ['owner', 'ops', 'cs'], // 예약 취소·환불
  policy: ['owner'], // 가격·수수료·운영 정책
  settle: ['owner', 'finance'], // 정산 생성·지급·보류
  incidents: ['owner', 'ops', 'cs'], // 사고 판정·보상
  cs: ['owner', 'ops', 'cs'], // 문의 답변·리뷰 숨김
  contents: ['owner', 'content'], // 콘텐츠 편집
  admins: ['owner'], // 관리자 계정·데모 데이터·설정
};
export const can = (role, perm) => (PERMS[perm] || []).includes(role);
export const permsOf = (role) => Object.keys(PERMS).filter((p) => can(role, p));

export async function audit(db, admin, action, target = '', detail = '') {
  await insert(db, 'audit_logs', {
    admin_id: admin?.id ?? null, admin_name: admin?.name || '', action, target: String(target),
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail), created_at: iso(nowMs()),
  });
}

// ---------- 로그인 시도 제한 ----------
export async function guardLogin(db, who) {
  const since = iso(nowMs() - 10 * MIN);
  const row = await first(db, 'SELECT COUNT(*) AS n FROM login_attempts WHERE who=? AND created_at>?', who, since);
  if ((row?.n || 0) >= 8) throw new ApiError(429, 'too_many', '시도가 너무 많았어요. 10분 뒤에 다시 해 주세요.');
}
export async function noteLoginFail(db, who) {
  await insert(db, 'login_attempts', { who, created_at: iso(nowMs()) });
  await run(db, 'DELETE FROM login_attempts WHERE created_at<?', iso(nowMs() - DAY));
}
export const listAdmins = (db) => all(db, 'SELECT id, email, name, role, active, created_at, last_login_at FROM admins ORDER BY id');
