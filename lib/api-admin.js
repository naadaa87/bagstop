// 백스톱 Admin API (본사 운영)
import { all, first, run, insert, update, stmt, getSettings, setSettings, schemaStatus, applySchema, logStatus } from './db.js';
import { bad, notFound, forbidden, iso, ms, nowMs, kstParts, kstMonthRange, str, int, num, bool, isEmail, oneOf, safeJson, slugify, DAY, LANGS } from './util.js';
import { DEFAULT_SETTINGS } from './schema.js';
import * as P from './policy.js';
import * as C from './core.js';
import { hashPassword, verifyPassword, checkPasswordRule, createSession, destroySession, requireAdmin, guardLogin, noteLoginFail, audit, ROLES, permsOf, listAdmins } from './auth.js';
import { refund, notifyHost, sendPlain, payMode } from './services.js';
import { seedDemo, clearDemo, seedContents } from './seed.js';

const like = (q) => `%${q}%`;

export function register(r) {
  // ---------- 설치 ----------
  r.get('/admin/setup', async ({ env }) => ({
    ...(await schemaStatus(env)), pay_mode: payMode(env), mail: !!(env.RESEND_API_KEY && env.MAIL_FROM),
    files: env.FILES ? 'r2' : 'd1', ai: !!env.AI, site_url: env.SITE_URL || '',
  }));
  r.post('/admin/setup/db', async ({ db, env, request }) => {
    const st = await schemaStatus(env);
    if (st.hasAdmin) await requireAdmin(db, request, 'admins'); // 운영 중에는 총괄만 다시 실행할 수 있습니다.
    const res = await applySchema(db);
    await seedContents(db);
    return { ok: true, ...res };
  });
  r.post('/admin/setup/admin', async ({ db, env, request, body }) => {
    const st = await schemaStatus(env);
    if (!st.ready) throw bad('not_ready', '먼저 DB 준비하기를 눌러 주세요.');
    if (st.hasAdmin) throw forbidden('이미 관리자가 있어요. 로그인해 주세요.');
    const email = str(body.email, 120).toLowerCase();
    if (!isEmail(email) || !str(body.name, 40)) throw bad('input', '이름과 이메일을 확인해 주세요.');
    checkPasswordRule(body.password);
    const id = await insert(db, 'admins', { email, name: str(body.name, 40), pw_hash: await hashPassword(body.password), role: 'owner', created_at: iso(nowMs()) });
    return { ok: true, _cookie: await createSession(db, request, 'admin', id) };
  });

  // ---------- 로그인 ----------
  r.post('/admin/login', async ({ db, request, body }) => {
    const email = str(body.email, 120).toLowerCase();
    await guardLogin(db, `admin:${email}`);
    const a = await first(db, 'SELECT * FROM admins WHERE email=? AND active=1', email);
    if (!a || !(await verifyPassword(String(body.password || ''), a.pw_hash))) {
      await noteLoginFail(db, `admin:${email}`);
      throw bad('login', '이메일이나 비밀번호가 맞지 않아요.');
    }
    await update(db, 'admins', a.id, { last_login_at: iso(nowMs()) });
    return { ok: true, _cookie: await createSession(db, request, 'admin', a.id) };
  });
  r.post('/admin/logout', async ({ db, request }) => ({ ok: true, _cookie: await destroySession(db, request, 'admin') }));
  r.get('/admin/me', async ({ db, request }) => {
    const a = await requireAdmin(db, request);
    return { admin: a, perms: permsOf(a.role), roles: ROLES };
  });

  // ---------- 대시보드 ----------
  r.get('/admin/dashboard', async ({ db, env, request }) => {
    await requireAdmin(db, request, 'view');
    await C.sweep(env, db);
    const now = nowMs();
    const p = kstParts(now);
    const day0 = iso(ms(`${p.date}T00:00:00+09:00`));
    const { from } = kstMonthRange(p.month);
    const since14 = iso(ms(`${p.date}T00:00:00+09:00`) - 13 * DAY);
    const [today, month, status, hostsApplied, spotsLive, incidents, inquiries, settle, recent, daily, overdueUnpaid] = await Promise.all([
      first(db, "SELECT COUNT(*) AS n FROM bookings WHERE paid_at >= ?", day0),
      first(db, "SELECT COUNT(*) AS n, COALESCE(SUM(total_amount - refund_amount + overdue_paid),0) AS gmv, COALESCE(SUM(fee_amount),0) AS fee FROM bookings WHERE paid_at >= ?", iso(from)),
      all(db, "SELECT status, COUNT(*) AS n FROM bookings WHERE status IN ('pending','confirmed','stored','overdue') GROUP BY status"),
      first(db, "SELECT COUNT(*) AS n FROM hosts WHERE status='applied'"),
      first(db, "SELECT COUNT(*) AS n FROM spots WHERE status='live'"),
      first(db, "SELECT COUNT(*) AS n FROM incidents WHERE status!='closed'"),
      first(db, "SELECT COUNT(*) AS n FROM inquiries WHERE status='open'"),
      first(db, "SELECT COUNT(*) AS n, COALESCE(SUM(payout),0) AS amount FROM settlements WHERE status IN ('ready','hold')"),
      all(db, "SELECT b.*, s.name AS spot_name FROM bookings b JOIN spots s ON s.id=b.spot_id WHERE b.status NOT IN ('hold','expired') ORDER BY b.id DESC LIMIT 8"),
      all(db, "SELECT substr(datetime(paid_at,'+9 hours'),1,10) AS d, COUNT(*) AS n FROM bookings WHERE paid_at >= ? GROUP BY d ORDER BY d", since14),
      first(db, "SELECT COUNT(*) AS n FROM bookings WHERE status='done' AND overdue_amount > overdue_paid"),
    ]);
    return {
      today: today?.n || 0, month: { count: month?.n || 0, gmv: month?.gmv || 0, fee: month?.fee || 0 },
      active: Object.fromEntries(status.map((s) => [s.status, s.n])),
      todo: {
        hosts: hostsApplied?.n || 0, incidents: incidents?.n || 0, inquiries: inquiries?.n || 0,
        settlements: settle?.n || 0, settle_amount: settle?.amount || 0, overdue_unpaid: overdueUnpaid?.n || 0,
      },
      spots_live: spotsLive?.n || 0, daily,
      recent: recent.map((b) => ({ ...C.bookingView(b, 'admin'), spot_name: b.spot_name })),
    };
  });

  // ---------- 호스트 ----------
  r.get('/admin/hosts', async ({ db, request, query }) => {
    await requireAdmin(db, request, 'view');
    const status = str(query.get('status'), 20), q = str(query.get('q'), 40);
    const cond = [], args = [];
    if (status) cond.push('h.status=?'), args.push(status);
    if (q) cond.push('(h.name LIKE ? OR h.email LIKE ? OR h.biz_name LIKE ?)'), args.push(like(q), like(q), like(q));
    const rows = await all(
      db,
      `SELECT h.id, h.email, h.name, h.phone, h.type, h.biz_name, h.status, h.account_verified, h.is_demo, h.created_at, h.applied_at,
              s.name AS spot_name, s.status AS spot_status
       FROM hosts h LEFT JOIN spots s ON s.host_id=h.id ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
       ORDER BY CASE h.status WHEN 'applied' THEN 0 ELSE 1 END, h.id DESC LIMIT 300`,
      ...args,
    );
    return { hosts: rows };
  });
  r.get('/admin/hosts/:id', async ({ db, request, params }) => {
    await requireAdmin(db, request, 'view');
    const h = await first(db, 'SELECT * FROM hosts WHERE id=?', int(params.id));
    if (!h) throw notFound();
    const spot = await first(db, 'SELECT * FROM spots WHERE host_id=? ORDER BY id LIMIT 1', h.id);
    const stats = await first(
      db,
      `SELECT COUNT(*) AS bookings, SUM(status='done') AS done, SUM(status='cancelled' AND cancel_by='host') AS host_cancels, SUM(status='noshow') AS noshows
       FROM bookings WHERE host_id=? AND status NOT IN ('hold','expired')`, h.id,
    );
    const inc = await first(db, 'SELECT COUNT(*) AS n FROM incidents WHERE host_id=?', h.id);
    delete h.pw_hash;
    return { host: h, spot: spot ? { ...spot, photos: safeJson(spot.photos, []) } : null, stats: { ...stats, incidents: inc?.n || 0 } };
  });
  r.post('/admin/hosts/:id/decision', async ({ db, env, request, params, body }) => {
    const admin = await requireAdmin(db, request, 'hosts');
    const h = await first(db, 'SELECT * FROM hosts WHERE id=?', int(params.id));
    if (!h) throw notFound();
    const action = oneOf(body.action, ['approve', 'reject', 'suspend', 'restore'], '');
    const reason = str(body.reason, 300);
    if (action === 'approve') {
      if (!['applied', 'rejected'].includes(h.status)) throw bad('status', '심사를 기다리는 호스트가 아니에요.');
      await update(db, 'hosts', h.id, { status: 'approved', approved_at: iso(nowMs()), reject_reason: '' });
      await notifyHost(env, db, 'approved', h.id, null, null);
    } else if (action === 'reject') {
      if (!reason) throw bad('reason', '반려 사유를 적어 주세요. 호스트에게 그대로 전달돼요.');
      await update(db, 'hosts', h.id, { status: 'rejected', reject_reason: reason });
      await notifyHost(env, db, 'rejected', h.id, null, null, { text: reason });
    } else if (action === 'suspend') {
      if (!reason) throw bad('reason', '이용 정지 사유를 적어 주세요.');
      await db.batch([
        stmt(db, "UPDATE hosts SET status='suspended', reject_reason=? WHERE id=?", reason, h.id),
        stmt(db, "UPDATE spots SET status='blocked' WHERE host_id=? AND status IN ('live','paused')", h.id),
      ]);
    } else if (action === 'restore') {
      await db.batch([
        stmt(db, "UPDATE hosts SET status='approved', reject_reason='' WHERE id=?", h.id),
        stmt(db, "UPDATE spots SET status='paused' WHERE host_id=? AND status='blocked'", h.id),
      ]);
    } else throw bad('action', '알 수 없는 처리예요.');
    await audit(db, admin, `host.${action}`, `host:${h.id}`, reason);
    return { ok: true };
  });
  r.put('/admin/hosts/:id', async ({ db, request, params, body }) => {
    const admin = await requireAdmin(db, request, body.account_verified !== undefined ? 'settle' : 'hosts');
    const patch = {};
    if (body.admin_memo !== undefined) patch.admin_memo = str(body.admin_memo, 1000);
    if (body.account_verified !== undefined) patch.account_verified = bool(body.account_verified);
    await update(db, 'hosts', int(params.id), patch);
    if (patch.account_verified === 1) await run(db, "UPDATE settlements SET status='ready', hold_reason='' WHERE host_id=? AND status='hold' AND hold_reason='계좌 미확인'", int(params.id));
    await audit(db, admin, 'host.update', `host:${params.id}`, patch);
    return { ok: true };
  });

  // ---------- 스팟 ----------
  r.get('/admin/spots', async ({ db, request, query }) => {
    await requireAdmin(db, request, 'view');
    const status = str(query.get('status'), 20), q = str(query.get('q'), 40);
    const cond = [], args = [];
    if (status) cond.push('s.status=?'), args.push(status);
    if (q) cond.push('(s.name LIKE ? OR s.address LIKE ?)'), args.push(like(q), like(q));
    const rows = await all(
      db,
      `SELECT s.id, s.slug, s.name, s.category, s.address, s.status, s.zone_id, s.rating_avg, s.rating_count, s.instant_confirm, s.overnight_units, s.host_id,
              h.name AS host_name, h.status AS host_status, h.is_demo,
              (SELECT day_price FROM spot_prices WHERE spot_id=s.id AND size='m') AS day_m,
              (SELECT COUNT(*) FROM bundles WHERE spot_id=s.id AND active=1) AS bundles,
              (SELECT COUNT(*) FROM bookings WHERE spot_id=s.id AND status NOT IN ('hold','expired')) AS bookings
       FROM spots s JOIN hosts h ON h.id=s.host_id ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY s.id DESC LIMIT 300`,
      ...args,
    );
    return { spots: rows };
  });
  r.put('/admin/spots/:id', async ({ db, request, params, body }) => {
    const admin = await requireAdmin(db, request, 'hosts');
    const s = await first(db, 'SELECT * FROM spots WHERE id=?', int(params.id));
    if (!s) throw notFound();
    const patch = { updated_at: iso(nowMs()) };
    if (body.status) patch.status = oneOf(body.status, ['live', 'paused', 'blocked'], s.status);
    if (body.zone_id) patch.zone_id = int(body.zone_id);
    await update(db, 'spots', s.id, patch);
    await audit(db, admin, 'spot.update', `spot:${s.id}`, patch);
    return { ok: true };
  });

  // ---------- 예약 ----------
  r.get('/admin/bookings', async ({ db, env, request, query }) => {
    await requireAdmin(db, request, 'view');
    await C.sweep(env, db);
    const status = str(query.get('status'), 20), q = str(query.get('q'), 60);
    const cond = ["b.status NOT IN ('hold','expired')"], args = [];
    if (status === 'overdue_unpaid') cond.push("b.status='done' AND b.overdue_amount > b.overdue_paid");
    else if (status) cond.push('b.status=?'), args.push(status);
    if (q) cond.push('(b.code LIKE ? OR b.guest_name LIKE ? OR b.guest_email LIKE ? OR s.name LIKE ?)'), args.push(like(q.toUpperCase()), like(q), like(q.toLowerCase()), like(q));
    const rows = await all(db, `SELECT b.*, s.name AS spot_name FROM bookings b JOIN spots s ON s.id=b.spot_id WHERE ${cond.join(' AND ')} ORDER BY b.id DESC LIMIT 300`, ...args);
    return { bookings: rows.map((b) => ({ ...C.bookingView(b, 'admin'), spot_name: b.spot_name })) };
  });
  r.get('/admin/bookings/:code', async ({ db, request, params }) => {
    await requireAdmin(db, request, 'view');
    const b = await C.getBookingByCode(db, params.code);
    const [spot, host, payments, logs, msgs, checkins, incident] = await Promise.all([
      first(db, 'SELECT id, slug, name, address, phone FROM spots WHERE id=?', b.spot_id),
      first(db, 'SELECT id, name, email, phone FROM hosts WHERE id=?', b.host_id),
      all(db, 'SELECT * FROM payments WHERE booking_id=? ORDER BY id', b.id),
      all(db, 'SELECT * FROM status_logs WHERE booking_id=? ORDER BY id', b.id),
      all(db, 'SELECT sender, body, translated, created_at FROM messages WHERE booking_id=? ORDER BY id', b.id),
      all(db, 'SELECT kind, photos, note, created_at FROM checkins WHERE booking_id=? ORDER BY id', b.id),
      first(db, 'SELECT id, status FROM incidents WHERE booking_id=? ORDER BY id DESC', b.id),
    ]);
    return {
      booking: C.bookingView(b, 'admin'), spot, host, payments, logs, messages: msgs, incident,
      checkins: checkins.map((c) => ({ ...c, photos: safeJson(c.photos, []).map((id) => `/api/files/${id}`) })),
    };
  });
  // 운영자 취소·환불: 환불액을 직접 정합니다.
  r.post('/admin/bookings/:code/refund', async ({ db, env, request, params, body }) => {
    const admin = await requireAdmin(db, request, 'bookings');
    const b = await C.getBookingByCode(db, params.code);
    const amount = int(body.amount);
    const reason = str(body.reason, 200);
    if (!reason) throw bad('reason', '처리 사유를 적어 주세요.');
    const paid = b.total_amount + (b.overdue_paid || 0) - (b.refund_amount || 0);
    if (amount < 0 || amount > paid) throw bad('amount', `환불할 수 있는 금액은 ${paid.toLocaleString()}원까지예요.`);
    if (body.cancel && ['pending', 'confirmed'].includes(b.status)) {
      await C.cancelBooking(env, db, b, { by: 'admin', byId: admin.id, refundAmount: amount, reason });
    } else {
      if (b.settlement_id) throw bad('settled', '이미 정산에 들어간 예약이에요. 정산 담당자와 조정해 주세요.');
      if (amount <= 0) throw bad('amount', '환불 금액을 입력해 주세요.');
      const done = await refund(env, db, b, amount, reason);
      const patch = { refund_amount: (b.refund_amount || 0) + done, updated_at: iso(nowMs()) };
      const money = P.recalcMoney({ ...b, ...patch });
      await update(db, 'bookings', b.id, { ...patch, fee_amount: money.fee_amount, payout_amount: money.payout_amount });
      await logStatus(db, b.id, b.status, 'admin', admin.id, `환불 ${done}원: ${reason}`);
    }
    await audit(db, admin, 'booking.refund', b.code, { amount, cancel: !!body.cancel, reason });
    return { ok: true };
  });
  // 운영자 대리 처리(호스트가 처리하지 못한 건)
  r.post('/admin/bookings/:code/close', async ({ db, env, request, params, body }) => {
    const admin = await requireAdmin(db, request, 'bookings');
    const b = await C.getBookingByCode(db, params.code);
    const spot = await first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id);
    await C.checkOut(env, db, b, spot, { byKind: 'admin', byId: admin.id, note: str(body.reason, 200) });
    await audit(db, admin, 'booking.close', b.code, str(body.reason, 200));
    return { ok: true };
  });

  // ---------- 가격·수수료 정책 ----------
  r.get('/admin/policy', async ({ db, request }) => {
    await requireAdmin(db, request, 'view');
    const [settings, zones] = await Promise.all([getSettings(db, true), all(db, 'SELECT * FROM zones ORDER BY sort, id')]);
    const out = [];
    for (const z of zones) {
      const spots = await all(db, "SELECT p.size, p.day_price FROM spot_prices p JOIN spots s ON s.id=p.spot_id WHERE s.zone_id=? AND s.status IN ('live','paused')", z.id);
      const outOfBand = spots.filter((p) => {
        const b = P.band(z, p.size);
        return p.day_price < b.min || p.day_price > b.max;
      }).length;
      const cnt = await first(db, 'SELECT COUNT(*) AS n FROM spots WHERE zone_id=?', z.id);
      out.push({ ...z, names: safeJson(z.names, {}), intro: safeJson(z.intro, {}), spots: cnt?.n || 0, out_of_band: outOfBand });
    }
    return { settings, defaults: DEFAULT_SETTINGS, zones: out };
  });
  r.put('/admin/settings', async ({ db, request, body }) => {
    const admin = await requireAdmin(db, request, 'policy');
    const rules = {
      fee_a: [0, 30], fee_b: [0, 30], fee_c: [0, 5000], unit_s: [0.5, 5], unit_m: [0.5, 5], unit_l: [0.5, 10], short_hours: [1, 12],
      hold_min: [3, 60], approve_hours: [1, 24], noshow_hours: [1, 24], overdue_grace_min: [0, 180], incident_days: [1, 30],
      incident_reply_hours: [12, 168], review_days: [1, 60], cover_basic_limit: [0, 5000000], settle_min_payout: [0, 100000],
      settle_pay_day: [1, 28], max_long_days: [1, 180], max_bags: [1, 30],
    };
    const patch = {};
    for (const [k, [lo, hi]] of Object.entries(rules)) {
      if (body[k] === undefined) continue;
      const v = num(body[k], NaN);
      if (!(v >= lo && v <= hi)) throw bad('range', `${k} 값은 ${lo}~${hi} 사이여야 해요.`);
      patch[k] = v;
    }
    for (const k of ['site_name', 'support_email']) if (body[k] !== undefined) patch[k] = str(body[k], 120);
    if (patch.fee_b !== undefined || patch.fee_a !== undefined) {
      const cur = await getSettings(db, true);
      if ((patch.fee_b ?? cur.fee_b) > (patch.fee_a ?? cur.fee_a)) throw bad('fee', '추가분 수수료율은 보관분 수수료율보다 높을 수 없어요.');
    }
    await setSettings(db, patch);
    await audit(db, admin, 'settings.update', '', patch);
    return { ok: true };
  });
  const saveZone = async ({ db, request, body, params }) => {
    const admin = await requireAdmin(db, request, 'policy');
    const names = {}, intro = {};
    for (const l of LANGS) {
      names[l] = str(body.names?.[l], 60);
      intro[l] = str(body.intro?.[l], 600);
    }
    if (!names.ko || !names.en) throw bad('names', '지역 이름은 한국어와 영어를 꼭 입력해 주세요.');
    const row = {
      names: JSON.stringify(names), intro: JSON.stringify(intro), lat: num(body.lat), lng: num(body.lng),
      base_s: int(body.base_s), base_m: int(body.base_m), base_l: int(body.base_l),
      floor_pct: int(body.floor_pct), cap_pct: int(body.cap_pct), active: bool(body.active ?? 1), sort: int(body.sort),
    };
    if (!(row.base_s > 0 && row.base_s < row.base_m && row.base_m < row.base_l)) throw bad('base', '기준가는 소형 < 일반 < 대형 순서로 입력해 주세요.');
    if (!(row.floor_pct >= 10 && row.floor_pct <= 100 && row.cap_pct >= 100 && row.cap_pct <= 300)) throw bad('band', '하한은 10~100%, 상한은 100~300% 사이로 정해 주세요.');
    if (!(row.lat > 33 && row.lat < 39 && row.lng > 124 && row.lng < 132)) throw bad('latlng', '지역 중심 좌표를 확인해 주세요.');
    if (params.id) {
      await update(db, 'zones', int(params.id), row);
      await audit(db, admin, 'zone.update', `zone:${params.id}`, row);
      return { id: int(params.id) };
    }
    const slug = slugify(body.slug || names.en);
    if (!slug) throw bad('slug', '주소에 쓸 영문 이름을 입력해 주세요.');
    if (await first(db, 'SELECT id FROM zones WHERE slug=?', slug)) throw bad('dup', '이미 있는 지역 주소예요.');
    const id = await insert(db, 'zones', { ...row, slug });
    await audit(db, admin, 'zone.create', `zone:${id}`, row);
    return { id };
  };
  r.post('/admin/zones', saveZone);
  r.put('/admin/zones/:id', saveZone);

  // ---------- 정산 ----------
  r.post('/admin/settlements/generate', async ({ db, env, request, body }) => {
    const admin = await requireAdmin(db, request, 'settle');
    const month = str(body.month, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw bad('month', '정산할 달을 골라 주세요.');
    const { to } = kstMonthRange(month);
    if (to > nowMs()) throw bad('month', '아직 끝나지 않은 달은 정산할 수 없어요.');
    const settings = await getSettings(db);
    const rows = await all(
      db,
      `SELECT b.id, b.host_id, b.total_amount, b.refund_amount, b.overdue_paid, b.fee_amount, b.payout_amount FROM bookings b
       WHERE b.settlement_id IS NULL AND b.status IN ('done','noshow','cancelled') AND b.closed_at < ? AND b.payout_amount > 0
         AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.booking_id=b.id AND i.status!='closed')`,
      iso(to),
    );
    const charges = await all(db, "SELECT id, host_id, host_charge FROM incidents WHERE status='closed' AND host_charge>0 AND charge_settlement_id IS NULL");
    const byHost = new Map();
    for (const b of rows) {
      const g = byHost.get(b.host_id) || { ids: [], gross: 0, fee: 0, payout: 0 };
      g.ids.push(b.id);
      g.gross += b.total_amount - b.refund_amount + b.overdue_paid;
      g.fee += b.fee_amount;
      g.payout += b.payout_amount;
      byHost.set(b.host_id, g);
    }
    let created = 0, carried = 0, skipped = 0;
    for (const [hostId, g] of byHost) {
      if (await first(db, 'SELECT id FROM settlements WHERE host_id=? AND month=?', hostId, month)) {
        skipped++;
        continue;
      }
      const mine = charges.filter((c) => c.host_id === hostId);
      const adjust = -mine.reduce((s, c) => s + c.host_charge, 0);
      const payout = g.payout + adjust;
      if (payout < settings.settle_min_payout) {
        carried++;
        continue;
      }
      const host = await first(db, 'SELECT bank_account, account_verified FROM hosts WHERE id=?', hostId);
      const okAccount = host && host.bank_account && host.account_verified;
      const id = await insert(db, 'settlements', {
        host_id: hostId, month, booking_count: g.ids.length, gross: g.gross, fee: g.fee, adjust, payout,
        status: okAccount ? 'ready' : 'hold', hold_reason: okAccount ? '' : '계좌 미확인', created_at: iso(nowMs()),
      });
      const stmts = [];
      for (let i = 0; i < g.ids.length; i += 50) stmts.push(stmt(db, `UPDATE bookings SET settlement_id=? WHERE id IN (${g.ids.slice(i, i + 50).join(',')})`, id));
      if (mine.length) stmts.push(stmt(db, `UPDATE incidents SET charge_settlement_id=? WHERE id IN (${mine.map((c) => c.id).join(',')})`, id));
      await db.batch(stmts);
      await notifyHost(env, db, 'settlement', hostId, null, null, { text: `${month.slice(0, 4)}년 ${Number(month.slice(5))}월` });
      created++;
    }
    await audit(db, admin, 'settlement.generate', month, { created, carried, skipped });
    return { created, carried, skipped };
  });
  r.get('/admin/settlements', async ({ db, request, query }) => {
    await requireAdmin(db, request, 'view');
    const month = str(query.get('month'), 7), status = str(query.get('status'), 10);
    const cond = [], args = [];
    if (month) cond.push('t.month=?'), args.push(month);
    if (status) cond.push('t.status=?'), args.push(status);
    const rows = await all(
      db,
      `SELECT t.*, h.name AS host_name, h.biz_name, h.bank_name, h.bank_account, h.bank_holder, h.account_verified
       FROM settlements t JOIN hosts h ON h.id=t.host_id ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY t.month DESC, t.id DESC LIMIT 500`,
      ...args,
    );
    const open = await first(db, "SELECT COUNT(*) AS n, COALESCE(SUM(payout_amount),0) AS amount FROM bookings WHERE settlement_id IS NULL AND status IN ('done','noshow','cancelled') AND payout_amount>0");
    return { settlements: rows, unsettled: open };
  });
  r.get('/admin/settlements/:id', async ({ db, request, params }) => {
    await requireAdmin(db, request, 'view');
    const st = await first(db, 'SELECT t.*, h.name AS host_name, h.bank_name, h.bank_account, h.bank_holder FROM settlements t JOIN hosts h ON h.id=t.host_id WHERE t.id=?', int(params.id));
    if (!st) throw notFound();
    const rows = await all(db, 'SELECT * FROM bookings WHERE settlement_id=? ORDER BY closed_at', st.id);
    const charges = await all(db, 'SELECT i.id, i.host_charge, b.code FROM incidents i JOIN bookings b ON b.id=i.booking_id WHERE i.charge_settlement_id=?', st.id);
    return { settlement: st, bookings: rows.map((b) => ({ ...C.bookingView(b, 'admin'), closed_at: b.closed_at })), charges };
  });
  r.post('/admin/settlements/:id/status', async ({ db, request, params, body }) => {
    const admin = await requireAdmin(db, request, 'settle');
    const st = await first(db, 'SELECT * FROM settlements WHERE id=?', int(params.id));
    if (!st) throw notFound();
    const status = oneOf(body.status, ['ready', 'hold', 'paid'], '');
    if (!status) throw bad('status', '상태를 확인해 주세요.');
    if (st.status === 'paid') throw bad('paid', '이미 지급한 정산이에요.');
    if (status === 'hold' && !str(body.reason, 100)) throw bad('reason', '보류 사유를 적어 주세요.');
    await update(db, 'settlements', st.id, { status, hold_reason: status === 'hold' ? str(body.reason, 100) : '', paid_at: status === 'paid' ? iso(nowMs()) : null });
    await audit(db, admin, `settlement.${status}`, `settlement:${st.id}`, str(body.reason, 100));
    return { ok: true };
  });

  // ---------- 사고·보상 ----------
  r.get('/admin/incidents', async ({ db, request, query }) => {
    await requireAdmin(db, request, 'view');
    const status = str(query.get('status'), 12);
    const rows = await all(
      db,
      `SELECT i.*, b.code, b.guest_name, b.guest_email, s.name AS spot_name, h.name AS host_name
       FROM incidents i JOIN bookings b ON b.id=i.booking_id JOIN spots s ON s.id=b.spot_id JOIN hosts h ON h.id=i.host_id
       ${status ? 'WHERE i.status=?' : ''} ORDER BY CASE i.status WHEN 'closed' THEN 1 ELSE 0 END, i.id DESC LIMIT 200`,
      ...(status ? [status] : []),
    );
    return { incidents: rows.map((i) => ({ ...i, photos: safeJson(i.photos, []).map((id) => `/api/files/${id}`) })) };
  });
  r.post('/admin/incidents/:id/verdict', async ({ db, request, params, body }) => {
    const admin = await requireAdmin(db, request, 'incidents');
    const inc = await first(db, 'SELECT * FROM incidents WHERE id=?', int(params.id));
    if (!inc) throw notFound();
    if (inc.status === 'closed') throw bad('closed', '이미 종결한 건이에요.');
    const settings = await getSettings(db);
    const comp = Math.max(0, int(body.comp_amount)), charge = Math.max(0, int(body.host_charge));
    if (comp > settings.cover_basic_limit) throw bad('limit', `보상액은 기본 보장 한도(${settings.cover_basic_limit.toLocaleString()}원)를 넘을 수 없어요.`);
    if (charge > comp) throw bad('charge', '호스트 부담액은 보상액보다 클 수 없어요.');
    const verdict = oneOf(body.verdict, ['host', 'guest', 'shared', 'none'], '');
    if (!verdict) throw bad('verdict', '판정 결과를 골라 주세요.');
    const close = bool(body.close);
    await update(db, 'incidents', inc.id, {
      verdict, verdict_note: str(body.note, 1000), comp_amount: comp, host_charge: charge,
      status: close ? 'closed' : 'judged', closed_at: close ? iso(nowMs()) : null,
    });
    await audit(db, admin, close ? 'incident.close' : 'incident.judge', `incident:${inc.id}`, { verdict, comp, charge });
    return { ok: true };
  });

  // ---------- 리뷰·문의 ----------
  r.get('/admin/reviews', async ({ db, request }) => {
    await requireAdmin(db, request, 'view');
    const rows = await all(db, 'SELECT r.*, s.name AS spot_name, b.code FROM reviews r JOIN spots s ON s.id=r.spot_id JOIN bookings b ON b.id=r.booking_id ORDER BY r.id DESC LIMIT 300');
    return { reviews: rows };
  });
  r.post('/admin/reviews/:id/hide', async ({ db, request, params, body }) => {
    const admin = await requireAdmin(db, request, 'cs');
    const rv = await first(db, 'SELECT id, spot_id FROM reviews WHERE id=?', int(params.id));
    if (!rv) throw notFound();
    await update(db, 'reviews', rv.id, { hidden: bool(body.hidden) });
    await C.refreshRating(db, rv.spot_id);
    await audit(db, admin, body.hidden ? 'review.hide' : 'review.show', `review:${rv.id}`, str(body.reason, 200));
    return { ok: true };
  });
  r.get('/admin/inquiries', async ({ db, request, query }) => {
    await requireAdmin(db, request, 'view');
    const status = str(query.get('status'), 10);
    const rows = await all(db, `SELECT * FROM inquiries ${status ? 'WHERE status=?' : ''} ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, id DESC LIMIT 300`, ...(status ? [status] : []));
    return { inquiries: rows };
  });
  r.post('/admin/inquiries/:id/reply', async ({ db, env, request, params, body }) => {
    const admin = await requireAdmin(db, request, 'cs');
    const q = await first(db, 'SELECT * FROM inquiries WHERE id=?', int(params.id));
    if (!q) throw notFound();
    const reply = str(body.reply, 3000);
    if (!reply) throw bad('reply', '답변 내용을 입력해 주세요.');
    await update(db, 'inquiries', q.id, { reply, status: 'done', replied_at: iso(nowMs()) });
    await sendPlain(env, db, { toKind: q.who, to: q.email, template: 'inquiry_reply', subject: q.lang === 'ko' ? '[백스톱] 문의에 답변드려요' : '[BagStop] Reply to your inquiry', body: `${reply}\n\n----\n${q.body}` });
    await audit(db, admin, 'inquiry.reply', `inquiry:${q.id}`);
    return { ok: true };
  });

  // ---------- 콘텐츠 ----------
  const KINDS = ['faq', 'notice', 'terms', 'privacy', 'rules', 'host_faq'];
  r.get('/admin/contents', async ({ db, request, query }) => {
    await requireAdmin(db, request, 'view');
    const rows = await all(db, 'SELECT * FROM contents WHERE kind=? AND lang=? ORDER BY sort, id', oneOf(query.get('kind'), KINDS, 'faq'), oneOf(query.get('lang'), LANGS, 'ko'));
    return { items: rows, kinds: KINDS };
  });
  const saveContent = async ({ db, request, body, params }) => {
    const admin = await requireAdmin(db, request, 'contents');
    const row = {
      kind: oneOf(body.kind, KINDS, 'faq'), lang: oneOf(body.lang, LANGS, 'ko'), title: str(body.title, 200), body: str(body.body, 20000),
      sort: int(body.sort), published: bool(body.published ?? 1), updated_at: iso(nowMs()),
    };
    if (!row.title || !row.body) throw bad('input', '제목과 내용을 입력해 주세요.');
    if (params.id) await update(db, 'contents', int(params.id), row);
    const id = params.id ? int(params.id) : await insert(db, 'contents', row);
    await audit(db, admin, params.id ? 'content.update' : 'content.create', `content:${id}`, row.title);
    return { id };
  };
  r.post('/admin/contents', saveContent);
  r.put('/admin/contents/:id', saveContent);
  r.delete('/admin/contents/:id', async ({ db, request, params }) => {
    const admin = await requireAdmin(db, request, 'contents');
    await run(db, 'DELETE FROM contents WHERE id=?', int(params.id));
    await audit(db, admin, 'content.delete', `content:${params.id}`);
    return { ok: true };
  });

  // ---------- 알림 내역·관리자·감사 기록 ----------
  r.get('/admin/notifications', async ({ db, request }) => {
    await requireAdmin(db, request, 'view');
    return { notifications: await all(db, 'SELECT * FROM notifications ORDER BY id DESC LIMIT 200') };
  });
  r.get('/admin/admins', async ({ db, request }) => {
    await requireAdmin(db, request, 'admins');
    return { admins: await listAdmins(db), roles: ROLES };
  });
  r.post('/admin/admins', async ({ db, request, body }) => {
    const admin = await requireAdmin(db, request, 'admins');
    const email = str(body.email, 120).toLowerCase();
    if (!isEmail(email) || !str(body.name, 40)) throw bad('input', '이름과 이메일을 확인해 주세요.');
    checkPasswordRule(body.password);
    if (await first(db, 'SELECT id FROM admins WHERE email=?', email)) throw bad('dup', '이미 등록된 이메일이에요.');
    const id = await insert(db, 'admins', { email, name: str(body.name, 40), pw_hash: await hashPassword(body.password), role: oneOf(body.role, Object.keys(ROLES), 'viewer'), created_at: iso(nowMs()) });
    await audit(db, admin, 'admin.create', `admin:${id}`, email);
    return { id };
  });
  r.put('/admin/admins/:id', async ({ db, request, params, body }) => {
    const admin = await requireAdmin(db, request, 'admins');
    const id = int(params.id);
    const patch = {};
    if (body.name) patch.name = str(body.name, 40);
    if (body.role) patch.role = oneOf(body.role, Object.keys(ROLES), 'viewer');
    if (body.active !== undefined) patch.active = bool(body.active);
    if (body.password) {
      checkPasswordRule(body.password);
      patch.pw_hash = await hashPassword(body.password);
    }
    if (id === admin.id && (patch.active === 0 || (patch.role && patch.role !== 'owner'))) throw bad('self', '내 계정의 총괄 권한은 스스로 내려놓을 수 없어요.');
    await update(db, 'admins', id, patch);
    if (patch.active === 0 || patch.pw_hash) await run(db, "DELETE FROM sessions WHERE kind='admin' AND user_id=? AND user_id!=?", id, admin.id);
    await audit(db, admin, 'admin.update', `admin:${id}`, { ...patch, pw_hash: patch.pw_hash ? '(변경)' : undefined });
    return { ok: true };
  });
  r.put('/admin/password', async ({ db, request, body }) => {
    const admin = await requireAdmin(db, request);
    const row = await first(db, 'SELECT pw_hash FROM admins WHERE id=?', admin.id);
    if (!(await verifyPassword(String(body.current || ''), row.pw_hash))) throw bad('current', '지금 쓰는 비밀번호가 맞지 않아요.');
    checkPasswordRule(body.password);
    await update(db, 'admins', admin.id, { pw_hash: await hashPassword(body.password) });
    return { ok: true };
  });
  r.get('/admin/audit', async ({ db, request }) => {
    await requireAdmin(db, request, 'admins');
    return { logs: await all(db, 'SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300') };
  });

  // ---------- 체험용 데이터 ----------
  r.post('/admin/demo', async ({ db, request }) => {
    const admin = await requireAdmin(db, request, 'admins');
    const res = await seedDemo(db);
    await audit(db, admin, 'demo.insert', '', { inserted: res.inserted });
    return res;
  });
  r.delete('/admin/demo', async ({ db, request }) => {
    const admin = await requireAdmin(db, request, 'admins');
    const res = await clearDemo(db);
    await audit(db, admin, 'demo.delete', '', res);
    return res;
  });
}
