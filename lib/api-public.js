// 고객 웹이 쓰는 API (로그인 없음. 예약은 예약번호 + 접근 토큰으로 확인)
import { all, first, run, insert, update, getSettings } from './db.js';
import { bad, notFound, forbidden, iso, ms, nowMs, kstParts, kstToMs, str, int, isEmail, pickLang, safeJson, DAY, LANGS } from './util.js';
import * as P from './policy.js';
import * as C from './core.js';
import { saveFile, fileResponse, translate, notifyHost, payMode, verifyPayment } from './services.js';
import { guardLogin, noteLoginFail, requireAdmin, requireHost } from './auth.js';

const ko = (lang) => lang === 'ko';
const loc = (row, field, lang) => (ko(lang) ? row[field] : row[`${field}_en`] || row[field]);
const fileUrl = (id) => `/api/files/${id}`;
// 가정형은 예약이 확정되기 전까지 대략적인 위치(약 200m 단위)만 보여 줍니다.
const isPrivate = (s) => s.host_type === 'home';
const approx = (v) => Math.round(v * 500) / 500;

function todayHours(blocks, closed) {
  const p = kstParts(nowMs());
  const today = closed ? [] : blocks.filter((b) => b.weekday === p.weekday).sort((a, b) => a.start_min - b.start_min);
  return {
    today: today.map((b) => [b.start_min, b.end_min]),
    open_now: today.some((b) => p.minOfDay >= b.start_min && p.minOfDay < b.end_min),
  };
}

function bundleView(b, addon, prices, lang) {
  const p = prices[b.size];
  if (!p || !addon) return null;
  const storagePrice = b.period === 'short' ? p.short_price : p.day_price;
  const sp = P.splitBundle(b.price, storagePrice, addon.price * b.addon_qty);
  return {
    id: b.id, name: loc(b, 'name', lang), size: b.size, period: b.period, price: b.price, list: sp.list, save: sp.save,
    note: b.note, addon: { name: loc(addon, 'name', lang), qty: b.addon_qty, price: addon.price, prepared: !!addon.prepared },
  };
}

async function liveSpots(db, where = '', args = []) {
  return all(
    db,
    `SELECT s.*, z.slug AS zone_slug, h.type AS host_type FROM spots s JOIN hosts h ON h.id=s.host_id LEFT JOIN zones z ON z.id=s.zone_id
     WHERE s.status='live' AND h.status='approved' ${where} ORDER BY s.rating_count DESC, s.id DESC LIMIT 200`,
    ...args,
  );
}
async function getLiveSpot(db, slug) {
  const rows = await liveSpots(db, 'AND s.slug=?', [slug]);
  if (!rows.length) throw notFound('지금은 예약을 받지 않는 스팟이에요.');
  return rows[0];
}

async function guestBooking(db, code, token) {
  const b = await C.getBookingByCode(db, code);
  if (!token || token !== b.token) throw forbidden('예약을 확인할 수 없어요. 예약번호와 이메일로 다시 찾아 주세요.');
  return b;
}

export function register(r) {
  // ---------- 기본 정보 ----------
  r.get('/public/config', async ({ db, env }) => {
    const s = await getSettings(db);
    const zones = await all(
      db,
      `SELECT z.*, (SELECT COUNT(*) FROM spots s JOIN hosts h ON h.id=s.host_id WHERE s.zone_id=z.id AND s.status='live' AND h.status='approved') AS spot_count
       FROM zones z WHERE z.active=1 ORDER BY z.sort, z.id`,
    );
    return {
      site_name: s.site_name, support_email: s.support_email, pay_mode: payMode(env), langs: LANGS,
      zones: zones.map((z) => ({
        slug: z.slug, names: safeJson(z.names, {}), intro: safeJson(z.intro, {}), lat: z.lat, lng: z.lng, spot_count: z.spot_count,
        base: { s: z.base_s, m: z.base_m, l: z.base_l }, floor_pct: z.floor_pct, cap_pct: z.cap_pct,
      })),
      policy: {
        short_hours: s.short_hours, max_bags: s.max_bags, max_long_days: s.max_long_days, hold_min: s.hold_min,
        noshow_hours: s.noshow_hours, overdue_grace_min: s.overdue_grace_min, review_days: s.review_days,
        incident_days: s.incident_days, cover_basic_limit: s.cover_basic_limit,
        units: { s: s.unit_s, m: s.unit_m, l: s.unit_l }, fee: { a: s.fee_a, b: s.fee_b, c: s.fee_c },
      },
    };
  });

  // ---------- 스팟 목록 ----------
  r.get('/public/spots', async ({ db, query }) => {
    const lang = pickLang(query.get('lang'));
    const zone = str(query.get('zone'), 40);
    const spots = zone ? await liveSpots(db, 'AND z.slug=?', [zone]) : await liveSpots(db);
    if (!spots.length) return { spots: [] };
    const ids = spots.map((s) => s.id);
    const inList = ids.join(',');
    const today = kstParts(nowMs()).date;
    const [prices, bundles, addons, blocks, closures] = await Promise.all([
      all(db, `SELECT * FROM spot_prices WHERE spot_id IN (${inList})`),
      all(db, `SELECT * FROM bundles WHERE active=1 AND spot_id IN (${inList}) ORDER BY sort, id`),
      all(db, `SELECT * FROM addons WHERE active=1 AND spot_id IN (${inList})`),
      all(db, `SELECT spot_id, weekday, start_min, end_min FROM spot_blocks WHERE spot_id IN (${inList})`),
      all(db, `SELECT spot_id FROM spot_closures WHERE date=? AND spot_id IN (${inList})`, today),
    ]);
    const closedToday = new Set(closures.map((c) => c.spot_id));
    return {
      spots: spots.map((s) => {
        const pr = {};
        for (const p of prices) if (p.spot_id === s.id) pr[p.size] = p;
        const bs = bundles
          .filter((b) => b.spot_id === s.id)
          .map((b) => bundleView(b, addons.find((a) => a.id === b.addon_id), pr, lang))
          .filter(Boolean);
        const photos = safeJson(s.photos, []);
        return {
          slug: s.slug, name: loc(s, 'name', lang), category: s.category, zone: s.zone_slug,
          address: isPrivate(s) ? '' : loc(s, 'address', lang), lat: isPrivate(s) ? approx(s.lat) : s.lat, lng: isPrivate(s) ? approx(s.lng) : s.lng, photo: photos[0] ? fileUrl(photos[0]) : '',
          rating: s.rating_avg, reviews: s.rating_count, instant: !!s.instant_confirm, overnight: s.overnight_units > 0,
          sizes: Object.keys(pr),
          price_day: pr.m?.day_price ?? pr.s?.day_price ?? pr.l?.day_price ?? 0,
          price_from: Math.min(...Object.values(pr).map((p) => p.short_price), Infinity) || 0,
          bundle: bs[0] || null, bundle_count: bs.length,
          ...todayHours(blocks.filter((b) => b.spot_id === s.id), closedToday.has(s.id)),
        };
      }).filter((s) => s.sizes.length && s.lat != null),
    };
  });

  // ---------- 스팟 상세 ----------
  r.get('/public/spots/:slug', async ({ db, params, query }) => {
    const lang = pickLang(query.get('lang'));
    const s = await getLiveSpot(db, params.slug);
    const today = kstParts(nowMs()).date;
    const [prices, addons, bundles, benefits, blocks, closures, reviews, score] = await Promise.all([
      C.loadPrices(db, s.id),
      all(db, 'SELECT * FROM addons WHERE spot_id=? AND active=1 ORDER BY sort, id', s.id),
      all(db, 'SELECT * FROM bundles WHERE spot_id=? AND active=1 ORDER BY sort, id', s.id),
      all(db, 'SELECT * FROM benefits WHERE spot_id=? AND active=1 ORDER BY id', s.id),
      all(db, 'SELECT weekday, start_min, end_min, units, allow_drop, allow_pick FROM spot_blocks WHERE spot_id=? ORDER BY weekday, start_min', s.id),
      all(db, 'SELECT date FROM spot_closures WHERE spot_id=? AND date>=? ORDER BY date LIMIT 90', s.id, today),
      all(db, 'SELECT rating, body, lang, guest_name, guest_country, reply, created_at FROM reviews WHERE spot_id=? AND hidden=0 ORDER BY id DESC LIMIT 20', s.id),
      first(db, 'SELECT AVG(NULLIF(price_score,0)) AS price, AVG(NULLIF(service_score,0)) AS service, AVG(NULLIF(find_score,0)) AS find FROM reviews WHERE spot_id=? AND hidden=0', s.id),
    ]);
    const round1 = (v) => (v ? Math.round(v * 10) / 10 : 0);
    return {
      spot: {
        slug: s.slug, name: loc(s, 'name', lang), name_ko: s.name, category: s.category, zone: s.zone_slug,
        address: loc(s, 'address', lang), address_ko: s.address, address_detail: s.address_detail, lat: s.lat, lng: s.lng, phone: s.phone,
        ...(isPrivate(s) ? { address: '', address_ko: '', address_detail: '', lat: approx(s.lat), lng: approx(s.lng), phone: '', approx: true } : {}),
        intro: loc(s, 'intro', lang), guide: isPrivate(s) ? '' : loc(s, 'guide', lang), rules: s.rules,
        photos: safeJson(s.photos, []).map(fileUrl), rating: s.rating_avg, reviews: s.rating_count,
        instant: !!s.instant_confirm, overnight: s.overnight_units > 0, cancel_deadline_h: s.cancel_deadline_h,
        ...todayHours(blocks, closures.some((c) => c.date === today)),
      },
      prices: Object.fromEntries(Object.entries(prices).map(([k, p]) => [k, { short: p.short_price, day: p.day_price, week: p.week_price, month: p.month_price }])),
      blocks: blocks.map((b) => ({ weekday: b.weekday, start_min: b.start_min, end_min: b.end_min, drop: !!b.allow_drop, pick: !!b.allow_pick })),
      closures: closures.map((c) => c.date),
      bundles: bundles.map((b) => bundleView(b, addons.find((a) => a.id === b.addon_id), prices, lang)).filter(Boolean),
      benefits: benefits.map((b) => loc(b, 'text', lang)),
      reviews: reviews.map((v) => ({ ...v, guest_name: v.guest_name.slice(0, 1) + '**' })),
      scores: { price: round1(score?.price), service: round1(score?.service), find: round1(score?.find) },
    };
  });

  // 날짜별 블록과 남은 칸
  r.get('/public/spots/:slug/availability', async ({ db, params, query }) => {
    const s = await getLiveSpot(db, params.slug);
    const date = str(query.get('date'), 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('date', '날짜를 확인해 주세요.');
    const cfg = await C.loadCfg(db, s);
    const from = kstToMs(`${date}T00:00`);
    const others = await C.loadOthers(db, s.id, from, from + DAY);
    return { date, closed: cfg.closures.has(date), blocks: P.dayAvailability(cfg, others, date), overnight: cfg.overnight };
  });

  r.post('/public/spots/:slug/quote', async ({ db, params, body }) => {
    const s = await getLiveSpot(db, params.slug);
    const { q } = await C.buildQuote(db, s, body);
    return { quote: { plan: q.plan, days: q.days, lines: q.lines, list: q.list, total: q.total, save: q.save, units: q.units } };
  });

  // ---------- 예약 ----------
  r.post('/public/spots/:slug/bookings', async ({ db, env, params, body }) => {
    await C.sweep(env, db);
    const s = await getLiveSpot(db, params.slug);
    const b = await C.createBooking(env, db, s, body);
    return { code: b.code, token: b.token, total: b.total_amount, hold_expires_at: b.hold_expires_at, payment: C.paymentRequest(env, b, s, b.total_amount) };
  });

  r.post('/public/bookings/:code/pay', async ({ db, env, params, body }) => {
    const b = await guestBooking(db, params.code, body.token);
    const spot = await first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id);
    const nb = await C.payBooking(env, db, b, spot, str(body.paymentId, 100));
    return { status: nb.status };
  });

  r.get('/public/bookings/:code', async ({ db, env, params, query }) => {
    await C.sweep(env, db);
    const b = await guestBooking(db, params.code, query.get('t'));
    const lang = pickLang(query.get('lang') || b.lang);
    const settings = await getSettings(db);
    const [spot, msgs, review, incident, checkin, addonPrepared] = await Promise.all([
      first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id),
      all(db, 'SELECT id, sender, body, translated, created_at FROM messages WHERE booking_id=? ORDER BY id', b.id),
      first(db, 'SELECT rating, body, reply, created_at FROM reviews WHERE booking_id=?', b.id),
      first(db, 'SELECT id, kind, status, body, verdict, verdict_note, comp_amount, created_at FROM incidents WHERE booking_id=? ORDER BY id DESC', b.id),
      first(db, "SELECT photos, created_at FROM checkins WHERE booking_id=? AND kind='in' ORDER BY id DESC", b.id),
      Promise.resolve(safeJson(b.snapshot, {}).prepared),
    ]);
    await run(db, "UPDATE messages SET read_guest=1 WHERE booking_id=? AND sender!='guest' AND read_guest=0", b.id);
    const now = nowMs();
    const cancel = P.guestCancelRefund(b, spot, addonPrepared, now);
    const prices = await C.loadPrices(db, spot.id);
    const over = ['stored', 'overdue'].includes(b.status) ? P.overdueCharge(settings, prices, b, now) : { days: 0, amount: 0 };
    const closed = b.closed_at ? ms(b.closed_at) : 0;
    const host = await first(db, 'SELECT type FROM hosts WHERE id=?', b.host_id);
    const hidden = host?.type === 'home' && !['confirmed', 'stored', 'overdue', 'done'].includes(b.status);
    if (hidden) Object.assign(spot, { address: '', address_en: '', address_detail: '', guide: '', guide_en: '', phone: '', lat: approx(spot.lat), lng: approx(spot.lng) });
    return {
      booking: C.bookingView(b, 'guest'),
      spot: {
        slug: spot.slug, name: loc(spot, 'name', lang), name_ko: spot.name, address: loc(spot, 'address', lang), address_ko: spot.address,
        address_detail: spot.address_detail, lat: spot.lat, lng: spot.lng, phone: spot.phone, guide: loc(spot, 'guide', lang),
        photo: safeJson(spot.photos, [])[0] ? fileUrl(safeJson(spot.photos, [])[0]) : '', approx: hidden,
      },
      messages: msgs,
      review, incident,
      checkin_photos: checkin ? safeJson(checkin.photos, []).map((id) => `${fileUrl(id)}?code=${b.code}&t=${b.token}`) : [],
      can: {
        cancel: cancel.allowed, cancel_refund: cancel.allowed ? cancel.refund : 0, cancel_partial: !!cancel.partial,
        extend: ['confirmed', 'stored'].includes(b.status),
        review: b.status === 'done' && !review && now - closed < settings.review_days * DAY,
        report: !incident && (['stored', 'overdue'].includes(b.status) || (b.status === 'done' && now - closed < settings.incident_days * DAY)),
        message: ['pending', 'confirmed', 'stored', 'overdue'].includes(b.status),
      },
      overdue: { days: over.days, amount: over.amount, unpaid: Math.max(0, over.amount - (b.overdue_paid || 0)) },
      payment: b.status === 'hold' ? C.paymentRequest(env, b, spot, b.total_amount) : null,
    };
  });

  r.post('/public/lookup', async ({ db, request, body }) => {
    const who = `lookup:${request.headers.get('cf-connecting-ip') || 'local'}`;
    await guardLogin(db, who);
    const b = await first(db, 'SELECT code, token, lang, guest_email FROM bookings WHERE code=?', str(body.code, 20).toUpperCase().replace(/\s/g, ''));
    if (!b || b.guest_email !== str(body.email, 120).toLowerCase()) {
      await noteLoginFail(db, who);
      throw notFound('예약번호나 이메일이 맞지 않아요.');
    }
    return { code: b.code, token: b.token, lang: b.lang };
  });

  r.post('/public/bookings/:code/cancel', async ({ db, env, params, body }) => {
    const b = await guestBooking(db, params.code, body.token);
    if (b.status === 'hold') {
      await C.cancelBooking(env, db, b, { by: 'guest', refundAmount: 0, reason: '결제 전 취소' });
      return { status: 'cancelled', refund: 0 };
    }
    const spot = await first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id);
    const rule = P.guestCancelRefund(b, spot, safeJson(b.snapshot, {}).prepared, nowMs());
    if (!rule.allowed) {
      throw bad('cancel_closed', rule.reason === 'after_drop' ? '맡기는 시각이 지나서 직접 취소할 수 없어요. 고객센터로 문의해 주세요.' : '취소할 수 없는 예약이에요.');
    }
    const nb = await C.cancelBooking(env, db, b, { by: 'guest', refundAmount: rule.refund, reason: str(body.reason, 200) });
    return { status: nb.status, refund: nb.refund_amount };
  });

  r.post('/public/bookings/:code/extend', async ({ db, env, params, body }) => {
    const b = await guestBooking(db, params.code, body.token);
    const spot = await first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id);
    if (body.preview) {
      const x = await C.extendQuote(db, b, spot, body.pick);
      return { diff: x.diff, plan: x.plan, days: x.days, payment: x.diff > 0 ? C.paymentRequest(env, b, spot, x.diff, 'ext') : null };
    }
    const nb = await C.extendBooking(env, db, b, spot, body.pick, str(body.paymentId, 100));
    return { pick: kstParts(ms(nb.pick_at)).local, total: nb.total_amount };
  });

  // 미수령 초과 요금 결제
  r.post('/public/bookings/:code/overdue', async ({ db, env, params, body }) => {
    const b = await guestBooking(db, params.code, body.token);
    if (!['stored', 'overdue'].includes(b.status)) throw bad('status', '초과 요금이 없는 예약이에요.');
    const spot = await first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id);
    const settings = await getSettings(db);
    const over = P.overdueCharge(settings, await C.loadPrices(db, spot.id), b, nowMs());
    const due = over.amount - (b.overdue_paid || 0);
    if (due <= 0) return { paid: b.overdue_paid || 0, due: 0 };
    if (body.preview) return { due, payment: C.paymentRequest(env, b, spot, due, 'over') };
    const pay = await verifyPayment(env, str(body.paymentId, 100), due);
    await insert(db, 'payments', { booking_id: b.id, kind: 'overdue', amount: due, provider: pay.provider, provider_id: pay.providerId, status: 'paid', created_at: iso(nowMs()) });
    const patch = { overdue_amount: over.amount, overdue_paid: over.amount, updated_at: iso(nowMs()) };
    Object.assign(patch, (({ fee_amount, payout_amount }) => ({ fee_amount, payout_amount }))(P.recalcMoney({ ...b, ...patch })));
    await update(db, 'bookings', b.id, patch);
    return { paid: over.amount, due: 0 };
  });

  // ---------- 메시지 ----------
  r.post('/public/bookings/:code/messages', async ({ db, env, params, body }) => {
    const b = await guestBooking(db, params.code, body.token);
    if (!['pending', 'confirmed', 'stored', 'overdue'].includes(b.status)) throw bad('status', '끝난 예약에는 메시지를 보낼 수 없어요.');
    const text = str(body.text, 1000);
    if (!text) throw bad('empty', '메시지를 입력해 주세요.');
    const translated = b.lang === 'ko' ? '' : await translate(env, text, b.lang, 'ko');
    const id = await insert(db, 'messages', { booking_id: b.id, sender: 'guest', body: text, lang: b.lang, translated, read_guest: 1, created_at: iso(nowMs()) });
    const spot = await first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id);
    await notifyHost(env, db, 'message', b.host_id, b, spot, { text: translated || text });
    return { id, translated };
  });

  // ---------- 리뷰 ----------
  r.post('/public/bookings/:code/review', async ({ db, params, body }) => {
    const b = await guestBooking(db, params.code, body.token);
    const settings = await getSettings(db);
    if (b.status !== 'done') throw bad('status', '짐을 찾은 뒤에 리뷰를 쓸 수 있어요.');
    if (nowMs() - ms(b.closed_at) > settings.review_days * DAY) throw bad('late', `리뷰는 찾은 날부터 ${settings.review_days}일 안에 쓸 수 있어요.`);
    if (await first(db, 'SELECT id FROM reviews WHERE booking_id=?', b.id)) throw bad('dup', '이미 리뷰를 남기셨어요.');
    const score = (v) => Math.min(5, Math.max(0, int(v)));
    const rating = score(body.rating);
    if (rating < 1) throw bad('rating', '별점을 골라 주세요.');
    await insert(db, 'reviews', {
      booking_id: b.id, spot_id: b.spot_id, rating, price_score: score(body.price_score), service_score: score(body.service_score),
      find_score: score(body.find_score), body: str(body.body, 1000), lang: b.lang, guest_name: b.guest_name, guest_country: b.guest_country,
      created_at: iso(nowMs()),
    });
    await C.refreshRating(db, b.spot_id);
    return { ok: true };
  });

  // ---------- 사고 접수 ----------
  r.post('/public/bookings/:code/incident', async ({ db, env, params, body }) => {
    const b = await guestBooking(db, params.code, body.token);
    const settings = await getSettings(db);
    const okStatus = ['stored', 'overdue'].includes(b.status) || (b.status === 'done' && nowMs() - ms(b.closed_at) < settings.incident_days * DAY);
    if (!okStatus) throw bad('late', `사고 접수는 짐을 찾은 날부터 ${settings.incident_days}일 안에 할 수 있어요.`);
    if (await first(db, "SELECT id FROM incidents WHERE booking_id=? AND status!='closed'", b.id)) throw bad('dup', '이미 접수된 건이 있어요.');
    const text = str(body.body, 2000);
    if (text.length < 10) throw bad('body', '어떤 일이 있었는지 조금 더 자세히 적어 주세요.');
    const kind = ['lost', 'damaged', 'other'].includes(body.kind) ? body.kind : 'other';
    const id = await insert(db, 'incidents', {
      booking_id: b.id, host_id: b.host_id, kind, body: text, photos: JSON.stringify((body.photos || []).slice(0, 6).map((x) => str(x, 40))),
      claim_amount: Math.max(0, int(body.claim_amount)), status: 'received',
      host_reply_due: iso(nowMs() + settings.incident_reply_hours * 3600 * 1000), created_at: iso(nowMs()),
    });
    const spot = await first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id);
    await notifyHost(env, db, 'incident', b.host_id, b, spot);
    return { id };
  });

  r.post('/public/bookings/:code/files', async ({ db, env, params, body }) => {
    const b = await guestBooking(db, params.code, body.token);
    const n = await first(db, "SELECT COUNT(*) AS n FROM files WHERE owner_kind='booking' AND owner_id=?", b.id);
    if ((n?.n || 0) >= 12) throw bad('too_many', '사진을 더 올릴 수 없어요.');
    return { id: await saveFile(env, db, { dataUrl: body.dataUrl, scope: 'private', ownerKind: 'booking', ownerId: b.id }) };
  });

  // ---------- 문의·콘텐츠 ----------
  r.post('/public/inquiries', async ({ db, body }) => {
    const row = {
      who: body.who === 'host' ? 'host' : 'guest', name: str(body.name, 80), email: str(body.email, 120).toLowerCase(),
      lang: pickLang(body.lang), booking_code: str(body.booking_code, 20).toUpperCase(), topic: str(body.topic, 60), body: str(body.body, 3000),
      created_at: iso(nowMs()),
    };
    if (!row.name || !isEmail(row.email)) throw bad('contact', '이름과 이메일을 확인해 주세요.');
    if (row.body.length < 5) throw bad('body', '문의 내용을 입력해 주세요.');
    return { id: await insert(db, 'inquiries', row) };
  });

  r.get('/public/contents', async ({ db, query }) => {
    const kind = str(query.get('kind'), 30);
    const lang = pickLang(query.get('lang'));
    for (const l of [...new Set([lang, 'en', 'ko'])]) {
      const rows = await all(db, 'SELECT id, title, body, updated_at FROM contents WHERE kind=? AND lang=? AND published=1 ORDER BY sort, id', kind, l);
      if (rows.length) return { lang: l, items: rows };
    }
    return { lang, items: [] };
  });

  // ---------- 파일 내려받기 ----------
  r.get('/files/:id', async ({ db, env, request, params, query }) => {
    const f = await first(db, 'SELECT * FROM files WHERE id=?', params.id);
    if (!f) return new Response('Not found', { status: 404 });
    if (f.scope !== 'public') {
      let ok = false;
      // 1) 예약 당사자(예약번호 + 토큰)
      const code = query.get('code'), t = query.get('t');
      if (code && t) {
        const b = await first(db, 'SELECT id, token, host_id FROM bookings WHERE code=?', code);
        if (b && b.token === t) {
          if (f.owner_kind === 'booking' && f.owner_id === b.id) ok = true;
          if (f.owner_kind === 'host' && f.owner_id === b.host_id) {
            const ci = await first(db, "SELECT photos FROM checkins WHERE booking_id=? AND kind='in' ORDER BY id DESC", b.id);
            ok = !!ci && safeJson(ci.photos, []).includes(f.id);
          }
        }
      }
      // 2) 관리자
      if (!ok) ok = await requireAdmin(db, request).then(() => true, () => false);
      // 3) 파일을 올린 호스트, 또는 그 호스트의 예약에 붙은 사진
      if (!ok) {
        const host = await requireHost(db, request).catch(() => null);
        if (host) {
          if (f.owner_kind === 'host' && f.owner_id === host.id) ok = true;
          if (f.owner_kind === 'booking') ok = !!(await first(db, 'SELECT id FROM bookings WHERE id=? AND host_id=?', f.owner_id, host.id));
        }
      }
      if (!ok) return new Response('Forbidden', { status: 403 });
    }
    return fileResponse(env, db, f);
  });
}
