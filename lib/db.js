// D1 도우미와 DB 준비(스키마 적용·기본값 입력)
import { SCHEMA, ALTERS, SCHEMA_VERSION, DEFAULT_SETTINGS, DEFAULT_ZONES, DEFAULT_BASE } from './schema.js';
import { ApiError, iso, nowMs } from './util.js';

export function getDb(env) {
  if (!env || !env.DB) {
    throw new ApiError(503, 'db_not_bound', 'D1 데이터베이스가 아직 연결되지 않았어요. Cloudflare Pages 설정에서 DB 바인딩을 추가해 주세요.');
  }
  return env.DB;
}

export const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
export const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
export const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
export const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);

/** INSERT 후 새 id를 돌려줍니다. */
export async function insert(db, table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  const res = await db.prepare(sql).bind(...keys.map((k) => row[k])).run();
  return res.meta.last_row_id;
}
export async function update(db, table, id, row, idCol = 'id') {
  const keys = Object.keys(row);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE ${idCol}=?`;
  await db.prepare(sql).bind(...keys.map((k) => row[k]), id).run();
}

// ---------- 설정 ----------
let settingsCache = null;
let settingsCacheAt = 0;

export async function getSettings(db, fresh = false) {
  if (!fresh && settingsCache && nowMs() - settingsCacheAt < 15000) return settingsCache;
  const rows = await all(db, 'SELECT key, value FROM settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    const def = DEFAULT_SETTINGS[r.key];
    s[r.key] = typeof def === 'number' ? Number(r.value) : r.value;
  }
  settingsCache = s;
  settingsCacheAt = nowMs();
  return s;
}
export async function setSettings(db, patch) {
  const stmts = Object.entries(patch).map(([k, v]) =>
    stmt(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v)),
  );
  if (stmts.length) await db.batch(stmts);
  settingsCache = null;
}

// ---------- DB 준비 ----------
export async function schemaStatus(env) {
  if (!env || !env.DB) return { bound: false, ready: false, version: 0, hasAdmin: false };
  try {
    const row = await first(env.DB, "SELECT value FROM settings WHERE key='schema_version'");
    const version = row ? Number(row.value) : 0;
    const admin = await first(env.DB, 'SELECT COUNT(*) AS n FROM admins');
    return { bound: true, ready: version > 0, version, latest: SCHEMA_VERSION, hasAdmin: (admin?.n || 0) > 0 };
  } catch {
    return { bound: true, ready: false, version: 0, latest: SCHEMA_VERSION, hasAdmin: false };
  }
}

export async function applySchema(db) {
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  for (const sql of ALTERS) {
    try {
      await db.prepare(sql).run();
    } catch (e) {
      if (!/duplicate column/i.test(String(e && e.message))) throw e;
    }
  }
  // 기본 설정: 이미 있는 값은 건드리지 않습니다.
  const stmts = Object.entries(DEFAULT_SETTINGS).map(([k, v]) =>
    stmt(db, 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', k, String(v)),
  );
  stmts.push(
    stmt(db, "INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", String(SCHEMA_VERSION)),
  );
  await db.batch(stmts);
  // 기본 지역(존): 하나도 없을 때만 넣습니다.
  const z = await first(db, 'SELECT COUNT(*) AS n FROM zones');
  if (!z || !z.n) {
    await db.batch(
      DEFAULT_ZONES.map((zone, i) =>
        stmt(
          db,
          'INSERT INTO zones (slug, names, lat, lng, base_s, base_m, base_l, floor_pct, cap_pct, sort) VALUES (?,?,?,?,?,?,?,?,?,?)',
          zone.slug, JSON.stringify(zone.names), zone.lat, zone.lng,
          DEFAULT_BASE.s, DEFAULT_BASE.m, DEFAULT_BASE.l, DEFAULT_BASE.floor, DEFAULT_BASE.cap, i,
        ),
      ),
    );
  }
  settingsCache = null;
  return { version: SCHEMA_VERSION };
}

let ensured = false;
/** 스키마 버전이 코드보다 낮으면 첫 요청에서 자동으로 맞춥니다. (설치 전에는 아무것도 하지 않음) */
export async function ensureSchema(env) {
  if (ensured || !env || !env.DB) return;
  try {
    const row = await first(env.DB, "SELECT value FROM settings WHERE key='schema_version'");
    if (row && Number(row.value) < SCHEMA_VERSION) await applySchema(env.DB);
    if (row) ensured = true;
  } catch {
    /* 아직 설치 전 */
  }
}

export async function logStatus(db, bookingId, status, byKind, byId, note = '') {
  await insert(db, 'status_logs', { booking_id: bookingId, status, by_kind: byKind, by_id: byId ?? null, note, created_at: iso(nowMs()) });
}
