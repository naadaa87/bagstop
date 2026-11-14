// 백스톱 호스트센터 API
import { all, first, run, insert, update, stmt, getSettings, logStatus } from './db.js';
import { bad, notFound, iso, ms, nowMs, kstParts, kstToMs, str, int, num, bool, isEmail, oneOf, slugify, randomCode, safeJson, DAY } from './util.js';
import * as P from './policy.js';
import * as C from './core.js';
import { hashPassword, verifyPassword, checkPasswordRule, createSession, destroySession, requireHost, guardLogin, noteLoginFail } from './auth.js';
import { saveFile, translate, notifyGuest } from './services.js';

const HOST_TYPES = ['store', 'stay', 'home', 'space'];
const CATEGORIES = ['cafe', 'restaurant', 'cvs', 'shop', 'stay', 'home', 'space', 'etc'];

const hostView = (h) => ({
  id: h.id, email: h.email, name: h.name, phone: h.phone, type: h.type, biz_name: h.biz_name, biz_no: h.biz_no, rep_name: h.rep_name,
  doc_file: h.doc_file, doc2_file: h.doc2_file, status: h.status, reject_reason: h.reject_reason,
  bank_name: h.bank_name, bank_account: h.bank_account, bank_holder: h.bank_holder, account_verified: !!h.account_verified,
});

async function mySpot(db, host, must = true) {
  const s = await first(db, 'SELECT * FROM spots WHERE host_id=? ORDER BY id LIMIT 1', host.id);
  if (!s && must) throw bad('no_spot', '먼저 스팟 정보를 저장해 주세요.');
  return s;
}
async function myBooking(db, host, code) {
  const b = await C.getBookingByCode(db, code);
  if (b.host_id !== host.id) throw notFound('예약을 찾을 수 없어요.');
  return b;
}
/** 가격이나 추가 서비스가 바뀌면 조건에 맞지 않게 된 세트를 판매 중지합니다. */
async function revalidateBundles(db, spotId) {
  const [prices, bundles, addons] = await Promise.all([
    C.loadPrices(db, spotId),
    all(db, 'SELECT * FROM bundles WHERE spot_id=? AND active=1', spotId),
    all(db, 'SELECT * FROM addons WHERE spot_id=?', spotId),
  ]);
  const stopped = [];
  for (const b of bundles) {
    if (P.validateBundle(b, prices[b.size], addons.find((a) => a.id === b.addon_id))) {
      await run(db, 'UPDATE bundles SET active=0 WHERE id=?', b.id);
      stopped.push(b.name);
    }
  }
  return stopped;
}
function spotReady(spot, counts) {
  const missing = [];
  if (!spot.name || !spot.address) missing.push('스팟 이름과 주소');
  if (spot.lat == null || spot.lng == null) missing.push('지도 위치');
  if (!spot.zone_id) missing.push('지역');
  if (!safeJson(spot.photos, []).length) missing.push('사진 1장 이상');
  if (!counts.blocks) missing.push('받는 시간·물량');
  if (!counts.prices) missing.push('가격');
  return missing;
}

export function register(r) {
  // ---------- 가입·로그인 ----------
  r.post('/host/signup', async ({ db, request, body }) => {
    const email = str(body.email, 120).toLowerCase();
    if (!isEmail(email)) throw bad('email', '이메일 주소를 확인해 주세요.');
    checkPasswordRule(body.password);
    if (!str(body.name, 60)) throw bad('name', '이름을 입력해 주세요.');
    if (await first(db, 'SELECT id FROM hosts WHERE email=?', email)) throw bad('dup', '이미 가입한 이메일이에요. 로그인해 주세요.');
    const id = await insert(db, 'hosts', {
      email, pw_hash: await hashPassword(body.password), name: str(body.name, 60), phone: str(body.phone, 30),
      status: 'draft', created_at: iso(nowMs()),
    });
    return { ok: true, _cookie: await createSession(db, request, 'host', id) };
  });
  r.post('/host/login', async ({ db, request, body }) => {
    const email = str(body.email, 120).toLowerCase();
    await guardLogin(db, `host:${email}`);
    const h = await first(db, 'SELECT * FROM hosts WHERE email=?', email);
    if (!h || !(await verifyPassword(String(body.password || ''), h.pw_hash))) {
      await noteLoginFail(db, `host:${email}`);
      throw bad('login', '이메일이나 비밀번호가 맞지 않아요.');
    }
    return { ok: true, _cookie: await createSession(db, request, 'host', h.id) };
  });
  r.post('/host/logout', async ({ db, request }) => ({ ok: true, _cookie: await destroySession(db, request, 'host') }));

  r.get('/host/me', async ({ db, request }) => {
    const host = await requireHost(db, request);
    const spot = await mySpot(db, host, false);
    let checklist = { profile: !!host.biz_no || ['home', 'space'].includes(host.type), applied: host.status !== 'draft', approved: host.status === 'approved' };
    let missing = [];
    if (spot) {
      const c = await first(db, 'SELECT (SELECT COUNT(*) FROM spot_blocks WHERE spot_id=?1) AS blocks, (SELECT COUNT(*) FROM spot_prices WHERE spot_id=?1) AS prices', spot.id);
      missing = spotReady(spot, c);
      checklist = { ...checklist, spot: !!spot.name && spot.lat != null, blocks: c.blocks > 0, prices: c.prices > 0, live: spot.status === 'live' };
    }
    checklist.bank = !!host.bank_account;
    return { host: hostView(host), spot: spot ? { id: spot.id, slug: spot.slug, name: spot.name, status: spot.status } : null, checklist, missing };
  });

  // ---------- 호스트 신청 ----------
  r.put('/host/profile', async ({ db, request, body }) => {
    const host = await requireHost(db, request);
    const patch = { name: str(body.name, 60) || host.name, phone: str(body.phone, 30) };
    if (['draft', 'rejected'].includes(host.status)) {
      Object.assign(patch, {
        type: oneOf(body.type, HOST_TYPES, host.type), biz_name: str(body.biz_name, 80), biz_no: str(body.biz_no, 20).replace(/[^0-9]/g, ''),
        rep_name: str(body.rep_name, 40), doc_file: str(body.doc_file, 40) || null, doc2_file: str(body.doc2_file, 40) || null,
      });
    }
    await update(db, 'hosts', host.id, patch);
    return { ok: true };
  });
  r.post('/host/apply', async ({ db, request }) => {
    const host = await requireHost(db, request);
    if (!['draft', 'rejected'].includes(host.status)) throw bad('status', '이미 신청했어요.');
    if (!host.phone) throw bad('phone', '연락처를 입력해 주세요.');
    if (['store', 'stay'].includes(host.type)) {
      if (host.biz_no.length !== 10) throw bad('biz_no', '사업자등록번호 10자리를 입력해 주세요.');
      if (!host.biz_name || !host.rep_name) throw bad('biz', '상호와 대표자 이름을 입력해 주세요.');
      if (!host.doc_file) throw bad('doc', '사업자등록증을 올려 주세요.');
      if (host.type === 'stay' && !host.doc2_file) throw bad('doc2', '숙박업 영업신고증(또는 등록증)을 올려 주세요.');
    } else if (!host.doc_file) {
      throw bad('doc', '본인 확인 서류를 올려 주세요.');
    }
    await update(db, 'hosts', host.id, { status: 'applied', applied_at: iso(nowMs()), reject_reason: '' });
    return { ok: true };
  });

  r.post('/host/files', async ({ db, env, request, body }) => {
    const host = await requireHost(db, request);
    const n = await first(db, "SELECT COUNT(*) AS n FROM files WHERE owner_kind='host' AND owner_id=? AND created_at > ?", host.id, iso(nowMs() - DAY));
    if ((n?.n || 0) >= 300) throw bad('too_many', '오늘 올릴 수 있는 사진 수를 넘었어요. 내일 다시 시도해 주세요.');
    const scope = body.scope === 'public' ? 'public' : 'private';
    return { id: await saveFile(env, db, { dataUrl: body.dataUrl, scope, ownerKind: 'host', ownerId: host.id }) };
  });

  // ---------- 스팟 ----------
  r.get('/host/spot', async ({ db, request }) => {
    const host = await requireHost(db, request);
    const spot = await mySpot(db, host, false);
    const zones = (await all(db, 'SELECT * FROM zones WHERE active=1 ORDER BY sort, id')).map((z) => ({
      id: z.id, slug: z.slug, name: safeJson(z.names, {}).ko || z.slug, lat: z.lat, lng: z.lng,
      band: Object.fromEntries(P.SIZES.map((k) => [k, P.band(z, k)])),
    }));
    if (!spot) return { spot: null, zones, blocks: [], closures: [], prices: {}, addons: [], bundles: [], benefits: [] };
    const [blocks, closures, prices, addons, bundles, benefits] = await Promise.all([
      all(db, 'SELECT weekday, start_min, end_min, units, allow_drop, allow_pick FROM spot_blocks WHERE spot_id=? ORDER BY weekday, start_min', spot.id),
      all(db, 'SELECT date, reason FROM spot_closures WHERE spot_id=? AND date>=? ORDER BY date', spot.id, kstParts(nowMs()).date),
      C.loadPrices(db, spot.id),
      all(db, 'SELECT * FROM addons WHERE spot_id=? ORDER BY sort, id', spot.id),
      all(db, 'SELECT * FROM bundles WHERE spot_id=? ORDER BY sort, id', spot.id),
      all(db, 'SELECT * FROM benefits WHERE spot_id=? ORDER BY id', spot.id),
    ]);
    const settings = await getSettings(db);
    return {
      spot: { ...spot, photos: safeJson(spot.photos, []) }, zones, blocks, closures, prices, addons, benefits,
      bundles: bundles.map((b) => {
        const a = addons.find((x) => x.id === b.addon_id), p = prices[b.size];
        if (!a || !p) return { ...b, invalid: true };
        const sp = P.splitBundle(b.price, b.period === 'short' ? p.short_price : p.day_price, a.price * b.addon_qty);
        const fee = P.calcFee(sp.storage, sp.addon, settings.fee_a, settings.fee_b, settings.fee_c);
        return { ...b, split: sp, fee, payout: b.price - fee };
      }),
      fee: { a: settings.fee_a, b: settings.fee_b, c: settings.fee_c },
      units: { s: settings.unit_s, m: settings.unit_m, l: settings.unit_l },
    };
  });

  r.put('/host/spot', async ({ db, request, body }) => {
    const host = await requireHost(db, request);
    const spot = await mySpot(db, host, false);
    const name = str(body.name, 60);
    if (!name) throw bad('name', '스팟 이름을 입력해 주세요.');
    const lat = body.lat == null || body.lat === '' ? null : num(body.lat, null), lng = body.lng == null || body.lng === '' ? null : num(body.lng, null);
    if (lat != null && (lat < 33 || lat > 39 || lng < 124 || lng > 132)) throw bad('latlng', '지도에서 위치를 다시 찍어 주세요.');
    const zone = body.zone_id ? await first(db, 'SELECT id FROM zones WHERE id=? AND active=1', int(body.zone_id)) : null;
    const photos = (Array.isArray(body.photos) ? body.photos : []).slice(0, 8).map((x) => str(x, 40)).filter(Boolean);
    const patch = {
      name, name_en: str(body.name_en, 80), category: oneOf(body.category, CATEGORIES, 'etc'),
      address: str(body.address, 160), address_en: str(body.address_en, 200), address_detail: str(body.address_detail, 100),
      lat, lng, phone: str(body.phone, 30), intro: str(body.intro, 600), intro_en: str(body.intro_en, 800),
      guide: str(body.guide, 600), guide_en: str(body.guide_en, 800), rules: str(body.rules, 600),
      photos: JSON.stringify(photos), instant_confirm: bool(body.instant_confirm),
      overnight_units: Math.max(0, Math.min(200, Math.round(num(body.overnight_units) * 2) / 2)),
      cancel_deadline_h: Math.max(0, Math.min(24, int(body.cancel_deadline_h))),
      zone_id: zone ? zone.id : spot?.zone_id ?? null, updated_at: iso(nowMs()),
    };
    if (!spot) {
      const slug = `${slugify(patch.name_en) || 'spot'}-${randomCode(4).toLowerCase()}`;
      const id = await insert(db, 'spots', { ...patch, host_id: host.id, slug, status: 'draft', created_at: iso(nowMs()) });
      return { id, slug };
    }
    await update(db, 'spots', spot.id, patch);
    const stopped = patch.zone_id !== spot.zone_id ? await revalidateBundles(db, spot.id) : [];
    return { id: spot.id, slug: spot.slug, stopped };
  });

  r.put('/host/spot/blocks', async ({ db, request, body }) => {
    const host = await requireHost(db, request);
    const spot = await mySpot(db, host);
    const rows = [];
    for (const b of Array.isArray(body.blocks) ? body.blocks : []) {
      const row = {
        weekday: int(b.weekday, -1), start_min: int(b.start_min, -1), end_min: int(b.end_min, -1), units: Math.round(num(b.units) * 2) / 2,
        allow_drop: bool(b.allow_drop), allow_pick: bool(b.allow_pick),
      };
      if (row.weekday < 0 || row.weekday > 6) throw bad('weekday', '요일을 확인해 주세요.');
      if (row.start_min < 0 || row.end_min > 1440 || row.start_min >= row.end_min || row.start_min % 30 || row.end_min % 30) throw bad('time', '시간은 30분 단위로, 시작이 끝보다 빨라야 해요.');
      if (row.units <= 0 || row.units > 200) throw bad('units', '받을 수 있는 칸 수를 확인해 주세요.');
      if (!row.allow_drop && !row.allow_pick) throw bad('mode', '맡기기와 찾기 가운데 하나는 켜 주세요.');
      rows.push(row);
    }
    if (rows.length > 60) throw bad('too_many', '시간 블록이 너무 많아요.');
    for (let w = 0; w < 7; w++) {
      const day = rows.filter((x) => x.weekday === w).sort((a, b) => a.start_min - b.start_min);
      for (let i = 1; i < day.length; i++) if (day[i].start_min < day[i - 1].end_min) throw bad('overlap', '같은 요일에 겹치는 시간이 있어요.');
    }
    await db.batch([
      stmt(db, 'DELETE FROM spot_blocks WHERE spot_id=?', spot.id),
      ...rows.map((x) => stmt(db, 'INSERT INTO spot_blocks (spot_id, weekday, start_min, end_min, units, allow_drop, allow_pick) VALUES (?,?,?,?,?,?,?)',
        spot.id, x.weekday, x.start_min, x.end_min, x.units, x.allow_drop, x.allow_pick)),
    ]);
    return { ok: true, count: rows.length };
  });

  r.put('/host/spot/closures', async ({ db, request, body }) => {
    const host = await requireHost(db, request);
    const spot = await mySpot(db, host);
    const today = kstParts(nowMs()).date;
    const dates = (Array.isArray(body.dates) ? body.dates : [])
      .map((d) => ({ date: str(d.date, 10), reason: str(d.reason, 60) }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date >= today)
      .slice(0, 120);
    await db.batch([
      stmt(db, 'DELETE FROM spot_closures WHERE spot_id=? AND date>=?', spot.id, today),
      ...dates.map((d) => stmt(db, 'INSERT INTO spot_closures (spot_id, date, reason) VALUES (?,?,?)', spot.id, d.date, d.reason)),
    ]);
    // 휴무로 바꾼 날에 이미 잡힌 예약이 있으면 알려 줍니다(예약은 그대로 유지).
    const hit = dates.length
      ? await all(db, `SELECT code, drop_at FROM bookings WHERE spot_id=? AND status IN ('pending','confirmed') AND substr(datetime(drop_at,'+9 hours'),1,10) IN (${dates.map(() => '?').join(',')})`, spot.id, ...dates.map((d) => d.date))
      : [];
    return { ok: true, conflicts: hit.map((b) => b.code) };
  });

  r.put('/host/spot/prices', async ({ db, request, body }) => {
    const host = await requireHost(db, request);
    const spot = await mySpot(db, host);
    if (!spot.zone_id) throw bad('zone', '먼저 스팟 정보에서 지역을 골라 주세요.');
    const zone = await first(db, 'SELECT * FROM zones WHERE id=?', spot.zone_id);
    const rows = {};
    for (const size of P.SIZES) {
      const p = body[size];
      if (!p || !p.day_price) continue;
      const opt = (v) => (v == null || v === '' ? null : int(v));
      rows[size] = { short_price: int(p.short_price), day_price: int(p.day_price), week_price: opt(p.week_price), month_price: opt(p.month_price) };
    }
    if (!Object.keys(rows).length) throw bad('empty', '받을 짐 크기를 하나 이상 정하고 가격을 입력해 주세요.');
    const errors = P.validatePrices(zone, rows).filter((e) => Object.keys(rows).some((k) => e.startsWith({ s: '소형', m: '일반', l: '대형' }[k])));
    if (errors.length) throw bad('price_rule', errors[0], { errors });
    await db.batch([
      stmt(db, 'DELETE FROM spot_prices WHERE spot_id=?', spot.id),
      ...Object.entries(rows).map(([size, p]) => stmt(db, 'INSERT INTO spot_prices (spot_id, size, short_price, day_price, week_price, month_price) VALUES (?,?,?,?,?,?)',
        spot.id, size, p.short_price, p.day_price, p.week_price, p.month_price)),
    ]);
    return { ok: true, stopped: await revalidateBundles(db, spot.id) };
  });

  r.post('/host/spot/publish', async ({ db, request, body }) => {
    const host = await requireHost(db, request);
    const spot = await mySpot(db, host);
    if (spot.status === 'blocked') throw bad('blocked', '운영팀이 공개를 중지한 스팟이에요. 고객센터로 문의해 주세요.');
    if (!body.on) {
      await update(db, 'spots', spot.id, { status: 'paused', updated_at: iso(nowMs()) });
      return { status: 'paused' };
    }
    if (host.status !== 'approved') throw bad('not_approved', '호스트 심사가 끝난 뒤에 공개할 수 있어요.');
    const c = await first(db, 'SELECT (SELECT COUNT(*) FROM spot_blocks WHERE spot_id=?1) AS blocks, (SELECT COUNT(*) FROM spot_prices WHERE spot_id=?1) AS prices', spot.id);
    const missing = spotReady(spot, c);
    if (missing.length) throw bad('not_ready', `공개하려면 ${missing.join(', ')}을(를) 먼저 채워 주세요.`, { missing });
    await update(db, 'spots', spot.id, { status: 'live', updated_at: iso(nowMs()) });
    return { status: 'live' };
  });

  // ---------- 추가 서비스·세트·혜택 ----------
  const saveAddon = async ({ db, request, body, params }) => {
    const host = await requireHost(db, request);
    const spot = await mySpot(db, host);
    const row = {
      name: str(body.name, 40), name_en: str(body.name_en, 60), price: int(body.price), note: str(body.note, 120),
      prepared: bool(body.prepared), active: body.active === undefined ? 1 : bool(body.active), sort: int(body.sort),
    };
    if (!row.name) throw bad('name', '추가 서비스 이름을 입력해 주세요.');
    if (row.price <= 0 || row.price % 100) throw bad('price', '가격은 100원 단위로 입력해 주세요.');
    if (params.id) {
      const a = await first(db, 'SELECT id FROM addons WHERE id=? AND spot_id=?', int(params.id), spot.id);
      if (!a) throw notFound();
      await update(db, 'addons', a.id, row);
      return { id: a.id, stopped: await revalidateBundles(db, spot.id) };
    }
    return { id: await insert(db, 'addons', { ...row, spot_id: spot.id }) };
  };
  r.post('/host/addons', saveAddon);
  r.put('/host/addons/:id', saveAddon);
  r.delete('/host/addons/:id', async ({ db, request, params }) => {
    const host = await requireHost(db, request);
    const spot = await mySpot(db, host);
    if (await first(db, 'SELECT id FROM bundles WHERE addon_id=? AND spot_id=?', int(params.id), spot.id)) throw bad('in_use', '이 서비스를 쓰는 세트가 있어요. 세트를 먼저 지워 주세요.');
    await run(db, 'DELETE FROM addons WHERE id=? AND spot_id=?', int(params.id), spot.id);
    return { ok: true };
  });

  const saveBundle = async ({ db, request, body, params }) => {
    const host = await requireHost(db, request);
    const spot = await mySpot(db, host);
    const row = {
      name: str(body.name, 40), name_en: str(body.name_en, 60), size: oneOf(body.size, P.SIZES, 'm'), period: oneOf(body.period, ['short', 'day'], 'short'),
      addon_id: int(body.addon_id), addon_qty: Math.max(1, int(body.addon_qty, 1)), price: int(body.price), note: str(body.note, 160),
      active: body.active === undefined ? 1 : bool(body.active), sort: int(body.sort),
    };
    if (!row.name) throw bad('name', '세트 이름을 입력해 주세요. (예: 짐앤커피)');
    const [prices, addon] = await Promise.all([C.loadPrices(db, spot.id), first(db, 'SELECT * FROM addons WHERE id=? AND spot_id=?', row.addon_id, spot.id)]);
    const err = P.validateBundle(row, prices[row.size], addon);
    if (err) throw bad('bundle_rule', err);
    if (params.id) {
      const b = await first(db, 'SELECT id FROM bundles WHERE id=? AND spot_id=?', int(params.id), spot.id);
      if (!b) throw notFound();
      await update(db, 'bundles', b.id, row);
      return { id: b.id };
    }
    return { id: await insert(db, 'bundles', { ...row, spot_id: spot.id }) };
  };
  r.post('/host/bundles', saveBundle);
  r.put('/host/bundles/:id', saveBundle);
  r.delete('/host/bundles/:id', async ({ db, request, params }) => {
    const host = await requireHost(db, request);
    const spot = await mySpot(db, host);
    // 예약 기록에 남아 있는 세트는 지우지 않고 판매만 멈춥니다.
    if (await first(db, 'SELECT id FROM bookings WHERE bundle_id=? LIMIT 1', int(params.id))) await run(db, 'UPDATE bundles SET active=0 WHERE id=? AND spot_id=?', int(params.id), spot.id);
    else await run(db, 'DELETE FROM bundles WHERE id=? AND spot_id=?', int(params.id), spot.id);
    return { ok: true };
  });

  r.put('/host/benefits', async ({ db, request, body }) => {
    const host = await requireHost(db, request);
    const spot = await mySpot(db, host);
    const items = (Array.isArray(body.items) ? body.items : []).map((x) => ({ text: str(x.text, 80), text_en: str(x.text_en, 120) })).filter((x) => x.text).slice(0, 5);
    await db.batch([
      stmt(db, 'DELETE FROM benefits WHERE spot_id=?', spot.id),
      ...items.map((x) => stmt(db, 'INSERT INTO benefits (spot_id, text, text_en) VALUES (?,?,?)', spot.id, x.text, x.text_en)),
    ]);
    return { ok: true };
  });

  // ---------- 오늘 ----------
  r.get('/host/today', async ({ db, env, request }) => {
    const host = await requireHost(db, request);
    await C.sweep(env, db);
    const spot = await mySpot(db, host, false);
    if (!spot) return { spot: null };
    const today = kstParts(nowMs()).date;
    const from = kstToMs(`${today}T00:00`), to = from + DAY;
    const rows = await all(
      db,
      `SELECT * FROM bookings WHERE host_id=? AND (
         status IN ('pending','stored','overdue')
         OR (status='confirmed' AND drop_at < ?)
         OR (status IN ('done','noshow') AND closed_at >= ?))
       ORDER BY drop_at`,
      host.id, iso(to), iso(from),
    );
    const cfg = await C.loadCfg(db, spot);
    const others = await C.loadOthers(db, spot.id, from, to);
    const [unread, incidents] = await Promise.all([
      first(db, "SELECT COUNT(*) AS n FROM messages m JOIN bookings b ON b.id=m.booking_id WHERE b.host_id=? AND m.sender='guest' AND m.read_host=0", host.id),
      first(db, "SELECT COUNT(*) AS n FROM incidents WHERE host_id=? AND status='received'", host.id),
    ]);
    const view = (b) => C.bookingView(b, 'host');
    return {
      spot: { name: spot.name, status: spot.status, slug: spot.slug }, date: today,
      pending: rows.filter((b) => b.status === 'pending').map(view),
      arriving: rows.filter((b) => b.status === 'confirmed').map(view),
      stored: rows.filter((b) => ['stored', 'overdue'].includes(b.status)).map(view),
      finished: rows.filter((b) => ['done', 'noshow'].includes(b.status)).map(view),
      blocks: P.dayAvailability(cfg, others, today), closed: cfg.closures.has(today),
      unread: unread?.n || 0, incidents: incidents?.n || 0,
    };
  });

  // ---------- 예약 ----------
  r.get('/host/bookings', async ({ db, env, request, query }) => {
    const host = await requireHost(db, request);
    await C.sweep(env, db);
    const tab = query.get('tab') || 'upcoming';
    const sets = { upcoming: "('pending','confirmed')", stored: "('stored','overdue')", done: "('done','noshow')", cancelled: "('cancelled')" };
    const q = str(query.get('q'), 40);
    const where = q ? 'AND (code LIKE ?2 OR guest_name LIKE ?2)' : '';
    const order = tab === 'upcoming' ? 'drop_at ASC' : tab === 'stored' ? 'pick_at ASC' : 'id DESC';
    const rows = await all(db, `SELECT * FROM bookings WHERE host_id=?1 AND status IN ${sets[tab] || sets.upcoming} ${where} ORDER BY ${order} LIMIT 200`, ...(q ? [host.id, `%${q}%`] : [host.id]));
    return { bookings: rows.map((b) => C.bookingView(b, 'host')) };
  });

  r.get('/host/bookings/:code', async ({ db, request, params }) => {
    const host = await requireHost(db, request);
    const b = await myBooking(db, host, params.code);
    const [msgs, checkins, logs, incident, review] = await Promise.all([
      all(db, 'SELECT id, sender, body, translated, created_at FROM messages WHERE booking_id=? ORDER BY id', b.id),
      all(db, 'SELECT kind, photos, note, created_at FROM checkins WHERE booking_id=? ORDER BY id', b.id),
      all(db, 'SELECT status, by_kind, note, created_at FROM status_logs WHERE booking_id=? ORDER BY id', b.id),
      first(db, 'SELECT id, kind, status, created_at FROM incidents WHERE booking_id=? ORDER BY id DESC', b.id),
      first(db, 'SELECT id, rating, body, reply FROM reviews WHERE booking_id=? AND hidden=0', b.id),
    ]);
    await run(db, "UPDATE messages SET read_host=1 WHERE booking_id=? AND sender='guest' AND read_host=0", b.id);
    return {
      booking: C.bookingView(b, 'host'), messages: msgs, logs, incident, review,
      checkins: checkins.map((c) => ({ ...c, photos: safeJson(c.photos, []).map((id) => `/api/files/${id}`) })),
    };
  });

  r.post('/host/bookings/:code/approve', async ({ db, env, request, params }) => {
    const host = await requireHost(db, request);
    const b = await myBooking(db, host, params.code);
    if (b.status !== 'pending') throw bad('status', '승인을 기다리는 예약이 아니에요.');
    await update(db, 'bookings', b.id, { status: 'confirmed', updated_at: iso(nowMs()) });
    await logStatus(db, b.id, 'confirmed', 'host', host.id, '호스트 승인');
    const spot = await first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id);
    await notifyGuest(env, db, 'confirmed', { ...b, status: 'confirmed' }, spot);
    return { status: 'confirmed' };
  });
  // 거절·호스트 취소: 언제나 전액 환불
  r.post('/host/bookings/:code/cancel', async ({ db, env, request, params, body }) => {
    const host = await requireHost(db, request);
    const b = await myBooking(db, host, params.code);
    const reason = str(body.reason, 200);
    if (!reason) throw bad('reason', '손님에게 전할 사유를 적어 주세요.');
    const nb = await C.cancelBooking(env, db, b, { by: 'host', byId: host.id, refundAmount: b.total_amount, reason });
    return { status: nb.status };
  });

  // QR·예약번호로 예약 찾기
  r.post('/host/scan', async ({ db, request, body }) => {
    const host = await requireHost(db, request);
    const raw = str(body.code, 200).toUpperCase();
    const m = /(BAG[0-9A-Z]{6})(?:[:.\- ]?(\d{4}))?/.exec(raw);
    if (!m) throw bad('code', '백스톱 QR 코드나 예약번호가 아니에요.');
    const b = await myBooking(db, host, m[1]);
    const pin = m[2] || str(body.pin, 4);
    return { booking: C.bookingView(b, 'host'), pin_ok: !!pin && pin === b.pin };
  });
  r.post('/host/checkin', async ({ db, env, request, body }) => {
    const host = await requireHost(db, request);
    const b = await myBooking(db, host, body.code);
    if (str(body.pin, 4) !== b.pin) throw bad('pin', '확인 번호 4자리가 맞지 않아요. 손님 화면의 번호를 다시 확인해 주세요.');
    const spot = await first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id);
    const nb = await C.checkIn(env, db, b, spot, { photos: body.photos, tagNo: body.tag_no, note: body.note, byKind: 'host', byId: host.id });
    return { status: nb.status };
  });
  r.post('/host/checkout', async ({ db, env, request, body }) => {
    const host = await requireHost(db, request);
    const b = await myBooking(db, host, body.code);
    const manual = bool(body.manual);
    if (!manual && str(body.pin, 4) !== b.pin) throw bad('pin', '확인 번호 4자리가 맞지 않아요.');
    const spot = await first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id);
    const nb = await C.checkOut(env, db, b, spot, { byKind: 'host', byId: host.id, note: manual ? `번호 없이 확인: ${str(body.note, 200)}` : str(body.note, 200) });
    return { status: nb.status, overdue_amount: nb.overdue_amount, overdue_unpaid: Math.max(0, (nb.overdue_amount || 0) - (nb.overdue_paid || 0)) };
  });

  // ---------- 메시지 ----------
  r.get('/host/messages', async ({ db, request }) => {
    const host = await requireHost(db, request);
    const rows = await all(
      db,
      `SELECT b.code, b.guest_name, b.guest_country, b.status, b.lang,
              (SELECT body FROM messages WHERE booking_id=b.id ORDER BY id DESC LIMIT 1) AS last_body,
              (SELECT translated FROM messages WHERE booking_id=b.id ORDER BY id DESC LIMIT 1) AS last_translated,
              (SELECT created_at FROM messages WHERE booking_id=b.id ORDER BY id DESC LIMIT 1) AS last_at,
              (SELECT COUNT(*) FROM messages WHERE booking_id=b.id AND sender='guest' AND read_host=0) AS unread
       FROM bookings b WHERE b.host_id=? AND EXISTS (SELECT 1 FROM messages WHERE booking_id=b.id)
       ORDER BY last_at DESC LIMIT 100`,
      host.id,
    );
    return { threads: rows };
  });
  r.post('/host/bookings/:code/messages', async ({ db, env, request, params, body }) => {
    const host = await requireHost(db, request);
    const b = await myBooking(db, host, params.code);
    const text = str(body.text, 1000);
    if (!text) throw bad('empty', '메시지를 입력해 주세요.');
    const translated = b.lang === 'ko' ? '' : await translate(env, text, 'ko', b.lang);
    const id = await insert(db, 'messages', { booking_id: b.id, sender: 'host', body: text, lang: 'ko', translated, read_host: 1, created_at: iso(nowMs()) });
    const spot = await first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id);
    await notifyGuest(env, db, 'message', b, spot, { text: translated || text });
    return { id, translated };
  });

  // ---------- 리뷰 ----------
  r.get('/host/reviews', async ({ db, request }) => {
    const host = await requireHost(db, request);
    const rows = await all(db, 'SELECT r.*, b.code FROM reviews r JOIN bookings b ON b.id=r.booking_id WHERE b.host_id=? AND r.hidden=0 ORDER BY r.id DESC LIMIT 200', host.id);
    return { reviews: rows };
  });
  r.post('/host/reviews/:id/reply', async ({ db, request, params, body }) => {
    const host = await requireHost(db, request);
    const rv = await first(db, 'SELECT r.id FROM reviews r JOIN bookings b ON b.id=r.booking_id WHERE r.id=? AND b.host_id=?', int(params.id), host.id);
    if (!rv) throw notFound();
    await update(db, 'reviews', rv.id, { reply: str(body.reply, 600), replied_at: iso(nowMs()) });
    return { ok: true };
  });

  // ---------- 정산 ----------
  r.get('/host/settlements', async ({ db, request }) => {
    const host = await requireHost(db, request);
    const [list, open, settings] = await Promise.all([
      all(db, 'SELECT * FROM settlements WHERE host_id=? ORDER BY month DESC LIMIT 36', host.id),
      all(db, "SELECT * FROM bookings WHERE host_id=? AND settlement_id IS NULL AND status IN ('done','noshow','cancelled') AND payout_amount>0 ORDER BY closed_at DESC LIMIT 300", host.id),
      getSettings(db),
    ]);
    return {
      settlements: list,
      open: open.map((b) => ({ ...C.bookingView(b, 'host'), closed_at: b.closed_at })),
      open_total: open.reduce((s, b) => s + b.payout_amount, 0),
      rule: { pay_day: settings.settle_pay_day, min_payout: settings.settle_min_payout },
    };
  });
  r.get('/host/settlements/:id', async ({ db, request, params }) => {
    const host = await requireHost(db, request);
    const st = await first(db, 'SELECT * FROM settlements WHERE id=? AND host_id=?', int(params.id), host.id);
    if (!st) throw notFound();
    const [rows, charges] = await Promise.all([
      all(db, 'SELECT * FROM bookings WHERE settlement_id=? ORDER BY closed_at', st.id),
      all(db, 'SELECT i.id, i.host_charge, b.code FROM incidents i JOIN bookings b ON b.id=i.booking_id WHERE i.charge_settlement_id=?', st.id),
    ]);
    return { settlement: st, bookings: rows.map((b) => ({ ...C.bookingView(b, 'host'), closed_at: b.closed_at })), charges };
  });
  r.put('/host/account', async ({ db, request, body }) => {
    const host = await requireHost(db, request);
    const row = { bank_name: str(body.bank_name, 30), bank_account: str(body.bank_account, 40).replace(/[^0-9-]/g, ''), bank_holder: str(body.bank_holder, 40) };
    if (!row.bank_name || !row.bank_account || !row.bank_holder) throw bad('bank', '은행, 계좌번호, 예금주를 모두 입력해 주세요.');
    const changed = row.bank_account !== host.bank_account || row.bank_name !== host.bank_name || row.bank_holder !== host.bank_holder;
    await update(db, 'hosts', host.id, { ...row, account_verified: changed ? 0 : host.account_verified });
    return { ok: true };
  });
  r.put('/host/password', async ({ db, request, body }) => {
    const host = await requireHost(db, request);
    if (!(await verifyPassword(String(body.current || ''), host.pw_hash))) throw bad('current', '지금 쓰는 비밀번호가 맞지 않아요.');
    checkPasswordRule(body.password);
    await update(db, 'hosts', host.id, { pw_hash: await hashPassword(body.password) });
    return { ok: true };
  });

  // ---------- 사고 ----------
  r.get('/host/incidents', async ({ db, request }) => {
    const host = await requireHost(db, request);
    const rows = await all(db, 'SELECT i.*, b.code, b.guest_name FROM incidents i JOIN bookings b ON b.id=i.booking_id WHERE i.host_id=? ORDER BY i.id DESC LIMIT 100', host.id);
    return { incidents: rows.map((i) => ({ ...i, photos: safeJson(i.photos, []).map((id) => `/api/files/${id}`) })) };
  });
  r.post('/host/incidents/:id/reply', async ({ db, request, params, body }) => {
    const host = await requireHost(db, request);
    const inc = await first(db, 'SELECT * FROM incidents WHERE id=? AND host_id=?', int(params.id), host.id);
    if (!inc) throw notFound();
    if (!['received', 'replied'].includes(inc.status)) throw bad('status', '이미 판정이 끝난 건이에요.');
    const text = str(body.text, 2000);
    if (text.length < 10) throw bad('text', '당시 상황을 조금 더 자세히 적어 주세요.');
    await update(db, 'incidents', inc.id, { host_reply: text, host_replied_at: iso(nowMs()), status: 'replied' });
    return { ok: true };
  });
}
