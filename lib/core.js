// 예약의 한 살이: 견적 → 자리 잡기(hold) → 결제 → 맡기기 → 찾기, 그리고 취소·연장·상태 자동 전환
import { all, first, run, insert, update, stmt, getSettings, logStatus } from './db.js';
import { bad, notFound, iso, ms, nowMs, kstToMs, kstParts, randomCode, randomHex, randomPin, MIN, HOUR, DAY, safeJson, str, int, isEmail, pickLang } from './util.js';
import * as P from './policy.js';
import { verifyPayment, refund, notifyGuest, notifyHost, payClientConfig, payMode } from './services.js';

export const ACTIVE = ['hold', 'pending', 'confirmed', 'stored', 'overdue'];

// ---------- 스팟 설정 불러오기 ----------
export async function loadCfg(db, spot) {
  const [blocks, closures] = await Promise.all([
    all(db, 'SELECT weekday, start_min, end_min, units, allow_drop, allow_pick FROM spot_blocks WHERE spot_id=?', spot.id),
    all(db, 'SELECT date FROM spot_closures WHERE spot_id=? AND date>=?', spot.id, kstParts(nowMs() - DAY).date),
  ]);
  return { blocks, closures: new Set(closures.map((c) => c.date)), overnight: spot.overnight_units || 0 };
}
export async function loadPrices(db, spotId) {
  const rows = await all(db, 'SELECT * FROM spot_prices WHERE spot_id=?', spotId);
  const out = {};
  for (const r of rows) out[r.size] = r;
  return out;
}
/** 같은 스팟에서 자리를 차지하고 있는 예약들 */
export async function loadOthers(db, spotId, fromMs, toMs, { excludeId = 0, beforeId = 0 } = {}) {
  const now = nowMs();
  const rows = await all(
    db,
    `SELECT id, status, units, drop_at, pick_at, hold_expires_at FROM bookings
     WHERE spot_id=? AND status IN ('hold','pending','confirmed','stored','overdue') AND drop_at < ? AND id != ?`,
    spotId, iso(toMs), excludeId,
  );
  const out = [];
  for (const r of rows) {
    if (beforeId && r.id >= beforeId) continue;
    if (r.status === 'hold' && ms(r.hold_expires_at) < now) continue;
    let to = ms(r.pick_at);
    if ((r.status === 'stored' || r.status === 'overdue') && to < now) to = now + 12 * HOUR; // 아직 안 찾아간 짐
    if (to <= fromMs) continue;
    out.push({ from: ms(r.drop_at), to, units: r.units });
  }
  return out;
}

// ---------- 상태 자동 전환 ----------
let lastSweep = 0;
export async function sweep(env, db, force = false) {
  const now = nowMs();
  if (!force && now - lastSweep < 20000) return;
  lastSweep = now;
  const s = await getSettings(db);
  const t = iso(now);
  await db.batch([
    stmt(db, "UPDATE bookings SET status='expired', updated_at=? WHERE status='hold' AND hold_expires_at < ?", t, t),
    stmt(db, "UPDATE bookings SET status='noshow', closed_at=?, updated_at=? WHERE status='confirmed' AND noshow_due < ?", t, t, t),
    stmt(db, "UPDATE bookings SET status='overdue', updated_at=? WHERE status='stored' AND pick_at < ?", t, iso(now - s.overdue_grace_min * MIN)),
  ]);
  // 승인 기한이 지난 예약은 전액 환불로 취소합니다.
  const late = await all(db, "SELECT * FROM bookings WHERE status='pending' AND approve_due < ? LIMIT 20", t);
  for (const b of late) {
    try {
      await cancelBooking(env, db, b, { by: 'system', refundAmount: b.total_amount, reason: '호스트 승인 기한 초과' });
    } catch (e) {
      console.log('auto-cancel failed', b.code, e && e.message);
    }
  }
}

// ---------- 견적 ----------
function readItems(body, settings) {
  const bags = { s: int(body.bags?.s), m: int(body.bags?.m), l: int(body.bags?.l) };
  const bundleQty = body.bundle_id ? Math.max(1, int(body.bundle_qty, 1)) : 0;
  for (const k of P.SIZES) if (bags[k] < 0) throw bad('bags', '짐 개수를 확인해 주세요.');
  const count = bags.s + bags.m + bags.l + bundleQty;
  if (count < 1) throw bad('bags', '맡길 짐을 1개 이상 골라 주세요.');
  if (count > settings.max_bags) throw bad('bags_max', `한 번에 ${settings.max_bags}개까지 맡길 수 있어요.`);
  return { bags, bundleId: int(body.bundle_id), bundleQty };
}

export async function buildQuote(db, spot, body, { excludeId = 0 } = {}) {
  const settings = await getSettings(db);
  const { bags, bundleId, bundleQty } = readItems(body, settings);
  const dropMs = kstToMs(body.drop), pickMs = kstToMs(body.pick);
  if (!Number.isFinite(dropMs) || !Number.isFinite(pickMs)) throw bad('time', '맡기는 시각과 찾는 시각을 골라 주세요.');
  if (pickMs - dropMs < 30 * MIN) throw bad('time_order', '찾는 시각은 맡기는 시각보다 30분 이상 뒤여야 해요.');
  if (dropMs < nowMs() - 30 * MIN) throw bad('time_past', '이미 지난 시각이에요. 맡기는 시각을 다시 골라 주세요.');
  if (pickMs - dropMs > settings.max_long_days * DAY) throw bad('time_long', `최대 ${settings.max_long_days}일까지 맡길 수 있어요.`);

  const [cfg, prices] = await Promise.all([loadCfg(db, spot), loadPrices(db, spot.id)]);
  let bundle = null;
  if (bundleId) {
    bundle = await first(db, 'SELECT * FROM bundles WHERE id=? AND spot_id=? AND active=1', bundleId, spot.id);
    if (!bundle) throw bad('bundle', '지금은 팔지 않는 세트예요.');
    bundle.addon = await first(db, 'SELECT * FROM addons WHERE id=? AND active=1', bundle.addon_id);
    if (!bundle.addon) throw bad('bundle', '지금은 팔지 않는 세트예요.');
  }
  const q = P.quote({ settings, prices, bags, bundle, bundleQty, dropMs, pickMs });
  if (q.error === 'bundle_period') throw bad('bundle_period', '이 세트는 보관 시간이 더 짧을 때만 살 수 있어요. 시간을 줄이거나 짐만 맡기기를 골라 주세요.');
  if (q.error) throw bad('no_price', '이 크기의 짐은 받지 않는 스팟이에요.');

  if (!P.canDropAt(cfg, dropMs)) throw bad('drop_closed', '그 시각에는 짐을 맡길 수 없어요. 맡기기 가능한 시간을 골라 주세요.');
  if (!P.canPickAt(cfg, pickMs)) throw bad('pick_closed', '그 시각에는 짐을 찾을 수 없어요. 찾기 가능한 시간을 골라 주세요.');
  const others = await loadOthers(db, spot.id, dropMs, pickMs, { excludeId });
  const cap = P.checkCapacity(cfg, others, { from: dropMs, to: pickMs, units: q.units });
  if (!cap.ok) {
    if (cap.overnight) throw bad('no_overnight', '이 스팟은 영업시간 밖에는 짐을 보관하지 않아요. 영업시간 안에서 찾는 시각을 골라 주세요.');
    throw bad('full', '그 시간대에는 자리가 모자라요. 시간이나 짐 개수를 바꿔 보세요.');
  }
  return { settings, cfg, prices, bundle, bags, bundleQty, dropMs, pickMs, q };
}

// ---------- 예약 만들기(자리 잡기) ----------
export async function createBooking(env, db, spot, body) {
  const guest = {
    name: str(body.guest?.name, 80), email: str(body.guest?.email, 120).toLowerCase(),
    phone: str(body.guest?.phone, 40), country: str(body.guest?.country, 40),
  };
  if (!guest.name) throw bad('guest_name', '이름을 입력해 주세요.');
  if (!isEmail(guest.email)) throw bad('guest_email', '이메일 주소를 확인해 주세요.');
  if (!body.agree) throw bad('agree', '이용약관과 보관 규정에 동의해 주세요.');

  const holds = await first(db, "SELECT COUNT(*) AS n FROM bookings WHERE guest_email=? AND status='hold' AND hold_expires_at > ?", guest.email, iso(nowMs()));
  if ((holds?.n || 0) >= 3) throw bad('too_many', '결제를 기다리는 예약이 너무 많아요. 먼저 결제하거나 취소해 주세요.');
  const { settings, cfg, prices, bundle, bundleQty, dropMs, pickMs, q } = await buildQuote(db, spot, body);
  const now = nowMs();
  // 연장할 때 비교할 기준: 모든 짐을 일반 보관 요금으로 계산한 금액
  let baseStorage = 0;
  for (const size of P.SIZES) if (q.bags[size] && prices[size]) baseStorage += P.bagPrice(prices[size], q.plan, q.days) * q.bags[size];
  let code = '';
  for (let i = 0; i < 5; i++) {
    code = `BAG${randomCode(6)}`;
    if (!(await first(db, 'SELECT id FROM bookings WHERE code=?', code))) break;
  }
  const row = {
    code, token: randomHex(16), pin: randomPin(), spot_id: spot.id, host_id: spot.host_id, status: 'hold',
    plan: q.plan, days: q.days, qty_s: q.bags.s, qty_m: q.bags.m, qty_l: q.bags.l, units: q.units,
    bundle_id: bundle ? bundle.id : null, bundle_qty: bundleQty,
    drop_at: iso(dropMs), pick_at: iso(pickMs), noshow_due: iso(P.noshowDue(cfg, settings, dropMs)),
    guest_name: guest.name, guest_email: guest.email, guest_phone: guest.phone, guest_country: guest.country,
    lang: pickLang(body.lang),
    storage_amount: q.storage, addon_amount: q.addon, list_amount: q.list, total_amount: q.total,
    fee_amount: q.fee, payout_amount: q.payout, fee_a: settings.fee_a, fee_b: settings.fee_b, fee_c: settings.fee_c,
    snapshot: JSON.stringify({ lines: q.lines, prepared: bundle ? !!bundle.addon.prepared : false, base_storage: baseStorage }),
    hold_expires_at: iso(now + settings.hold_min * MIN), created_at: iso(now), updated_at: iso(now),
  };
  const id = await insert(db, 'bookings', row);
  // 동시에 들어온 예약끼리는 먼저 들어온 쪽만 남깁니다.
  const earlier = await loadOthers(db, spot.id, dropMs, pickMs, { beforeId: id });
  const again = P.checkCapacity(cfg, earlier, { from: dropMs, to: pickMs, units: q.units });
  if (!again.ok) {
    await run(db, 'DELETE FROM bookings WHERE id=?', id);
    throw bad('full', '방금 다른 손님이 먼저 예약했어요. 시간이나 짐 개수를 바꿔 보세요.');
  }
  await logStatus(db, id, 'hold', 'guest', null);
  return { ...row, id };
}

export function paymentRequest(env, b, spot, amount, purpose = 'main') {
  const cfg = payClientConfig(env);
  return {
    ...cfg, amount, paymentId: `jb-${b.code.toLowerCase()}-${purpose}-${randomHex(4)}`,
    orderName: `BagStop ${spot.name_en || spot.name}`.slice(0, 60),
  };
}

// ---------- 결제 완료 → 확정 ----------
export async function payBooking(env, db, b, spot, paymentId) {
  if (['pending', 'confirmed', 'stored'].includes(b.status)) return b; // 이미 처리됨(새로고침·중복 호출)
  if (!['hold', 'expired'].includes(b.status)) throw bad('status', '결제할 수 없는 예약이에요.');
  const settings = await getSettings(db);
  const pay = await verifyPayment(env, paymentId, b.total_amount);
  const now = nowMs();
  if (b.status === 'expired' || ms(b.hold_expires_at) < now) {
    // 결제 대기 시간이 지났다면 자리가 아직 남아 있는지 다시 봅니다.
    const cfg = await loadCfg(db, spot);
    const others = await loadOthers(db, spot.id, ms(b.drop_at), ms(b.pick_at), { excludeId: b.id });
    if (!P.checkCapacity(cfg, others, { from: ms(b.drop_at), to: ms(b.pick_at), units: b.units }).ok) {
      await insert(db, 'payments', { booking_id: b.id, kind: 'main', amount: b.total_amount, provider: pay.provider, provider_id: pay.providerId, status: 'paid', created_at: iso(now) });
      await refund(env, db, b, b.total_amount, '결제 대기 시간 초과');
      throw bad('hold_expired', '결제 대기 시간이 지나 자리가 마감됐어요. 결제는 바로 취소했어요.');
    }
  }
  const status = spot.instant_confirm ? 'confirmed' : 'pending';
  // 승인 기한: 맡기는 시각 전까지, 다만 임박한 예약도 호스트가 볼 시간은 30분 이상 줍니다.
  const approveDue = status === 'pending' ? iso(Math.max(Math.min(now + settings.approve_hours * HOUR, ms(b.drop_at)), now + 30 * MIN)) : null;
  await db.batch([
    stmt(db, 'UPDATE bookings SET status=?, paid_at=?, approve_due=?, updated_at=? WHERE id=?', status, iso(now), approveDue, iso(now), b.id),
    stmt(db, "INSERT INTO payments (booking_id, kind, amount, provider, provider_id, status, created_at) VALUES (?, 'main', ?, ?, ?, 'paid', ?)",
      b.id, b.total_amount, pay.provider, pay.providerId, iso(now)),
  ]);
  await logStatus(db, b.id, status, 'guest', null, pay.provider === 'test' ? '테스트 결제' : '');
  const nb = { ...b, status, paid_at: iso(now), approve_due: approveDue };
  await notifyGuest(env, db, status, nb, spot);
  await notifyHost(env, db, status === 'pending' ? 'need_approve' : 'new_booking', b.host_id, nb, spot);
  return nb;
}

// ---------- 취소 ----------
export async function cancelBooking(env, db, b, { by, byId = null, refundAmount, reason = '' }) {
  if (!['pending', 'confirmed', 'hold'].includes(b.status)) throw bad('status', '취소할 수 없는 예약이에요.');
  const now = nowMs();
  let refunded = 0;
  if (b.status !== 'hold' && refundAmount > 0) refunded = await refund(env, db, b, refundAmount, reason || '예약 취소');
  const money = P.recalcMoney({ ...b, refund_amount: refunded });
  await update(db, 'bookings', b.id, {
    status: 'cancelled', cancelled_at: iso(now), cancel_by: by, cancel_reason: reason, refund_amount: refunded,
    fee_amount: money.fee_amount, payout_amount: money.payout_amount, closed_at: iso(now), updated_at: iso(now),
  });
  await logStatus(db, b.id, 'cancelled', by, byId, reason);
  const nb = { ...b, status: 'cancelled', refund_amount: refunded };
  const spot = await first(db, 'SELECT * FROM spots WHERE id=?', b.spot_id);
  if (b.status !== 'hold') {
    await notifyGuest(env, db, 'cancelled', nb, spot);
    if (by !== 'host') await notifyHost(env, db, 'cancelled', b.host_id, nb, spot);
  }
  return nb;
}

// ---------- 맡기기(체크인)·찾기(체크아웃) ----------
export async function checkIn(env, db, b, spot, { photos, tagNo, note, byKind, byId }) {
  if (b.status !== 'confirmed') throw bad('status', b.status === 'pending' ? '아직 승인하지 않은 예약이에요. 먼저 승인해 주세요.' : '맡기기 처리를 할 수 없는 예약이에요.');
  const now = nowMs();
  if (now < ms(b.drop_at) - HOUR) throw bad('too_early', '맡기는 시각 1시간 전부터 받을 수 있어요.');
  if (!Array.isArray(photos) || photos.length < 2) throw bad('photos', '짐 사진을 2장 이상 찍어 주세요.');
  if (!str(tagNo, 20)) throw bad('tag', '번호표 번호를 입력해 주세요.');
  await db.batch([
    stmt(db, "UPDATE bookings SET status='stored', checked_in_at=?, tag_no=?, updated_at=? WHERE id=?", iso(now), str(tagNo, 20), iso(now), b.id),
    stmt(db, "INSERT INTO checkins (booking_id, kind, photos, note, by_kind, by_id, created_at) VALUES (?, 'in', ?, ?, ?, ?, ?)",
      b.id, JSON.stringify(photos.slice(0, 6)), str(note, 300), byKind, byId, iso(now)),
  ]);
  await logStatus(db, b.id, 'stored', byKind, byId, `번호표 ${str(tagNo, 20)}`);
  const nb = { ...b, status: 'stored', checked_in_at: iso(now), tag_no: str(tagNo, 20) };
  await notifyGuest(env, db, 'stored', nb, spot);
  return nb;
}

export async function checkOut(env, db, b, spot, { byKind, byId, note = '' }) {
  if (!['stored', 'overdue'].includes(b.status)) throw bad('status', '찾기 처리를 할 수 없는 예약이에요.');
  const settings = await getSettings(db);
  const prices = await loadPrices(db, spot.id);
  const now = nowMs();
  const patch = { status: 'done', checked_out_at: iso(now), closed_at: iso(now), updated_at: iso(now) };
  const over = P.overdueCharge(settings, prices, b, now);
  if (over.amount > 0) patch.overdue_amount = Math.max(over.amount, b.overdue_paid || 0);
  let refunded = 0;
  // 오래 맡기기를 일찍 끝내면 실제 맡긴 일수로 다시 계산해 차액을 돌려줍니다.
  if (b.plan === 'long' && !b.bundle_id && over.amount === 0) {
    const usedDays = Math.max(1, Math.ceil((now - ms(b.drop_at)) / DAY));
    if (usedDays < b.days) {
      let used = 0;
      for (const size of P.SIZES) if (b[`qty_${size}`] && prices[size]) used += P.bagPrice(prices[size], 'long', usedDays) * b[`qty_${size}`];
      const diff = b.storage_amount - (b.refund_amount || 0) - used;
      if (diff > 0) refunded = await refund(env, db, b, diff, '오래 맡기기 중도 종료');
    }
  }
  if (refunded) patch.refund_amount = (b.refund_amount || 0) + refunded;
  const money = P.recalcMoney({ ...b, ...patch });
  patch.fee_amount = money.fee_amount;
  patch.payout_amount = money.payout_amount;
  await update(db, 'bookings', b.id, patch);
  await insert(db, 'checkins', { booking_id: b.id, kind: 'out', photos: '[]', note: str(note, 300), by_kind: byKind, by_id: byId, created_at: iso(now) });
  await logStatus(db, b.id, 'done', byKind, byId, refunded ? `중도 종료 환불 ${refunded}원` : '');
  const nb = { ...b, ...patch };
  await notifyGuest(env, db, 'done', nb, spot);
  return nb;
}

// ---------- 연장 ----------
export async function extendQuote(db, b, spot, pickLocal) {
  if (!['confirmed', 'stored'].includes(b.status)) throw bad('status', '지금은 시간을 바꿀 수 없어요.');
  const newPick = kstToMs(pickLocal);
  if (!Number.isFinite(newPick) || newPick <= ms(b.pick_at)) throw bad('time', '지금 찾는 시각보다 늦은 시각을 골라 주세요.');
  const settings = await getSettings(db);
  if (newPick - ms(b.drop_at) > settings.max_long_days * DAY) throw bad('time_long', `최대 ${settings.max_long_days}일까지 맡길 수 있어요.`);
  const [cfg, prices] = await Promise.all([loadCfg(db, spot), loadPrices(db, spot.id)]);
  if (!P.canPickAt(cfg, newPick)) throw bad('pick_closed', '그 시각에는 짐을 찾을 수 없어요. 찾기 가능한 시간을 골라 주세요.');
  const others = await loadOthers(db, spot.id, ms(b.pick_at), newPick, { excludeId: b.id });
  const cap = P.checkCapacity(cfg, others, { from: ms(b.pick_at), to: newPick, units: b.units });
  if (!cap.ok) throw bad(cap.overnight ? 'no_overnight' : 'full', cap.overnight ? '이 스팟은 영업시간 밖에는 짐을 보관하지 않아요.' : '그 시간까지는 자리가 모자라요.');
  // 세트로 산 짐도 연장분은 일반 보관 요금으로 계산합니다.
  const { plan, days } = P.planOf(settings, ms(b.drop_at), newPick);
  let fresh = 0;
  for (const size of P.SIZES) if (b[`qty_${size}`] && prices[size]) fresh += P.bagPrice(prices[size], plan, days) * b[`qty_${size}`];
  const snap = safeJson(b.snapshot, {});
  const base = snap.base_storage ?? b.storage_amount;
  const diff = Math.max(0, fresh - base);
  return { newPick, plan, days, diff, fresh };
}

export async function extendBooking(env, db, b, spot, pickLocal, paymentId) {
  const x = await extendQuote(db, b, spot, pickLocal);
  const now = nowMs();
  if (x.diff > 0) {
    const pay = await verifyPayment(env, paymentId, x.diff);
    await insert(db, 'payments', { booking_id: b.id, kind: 'extend', amount: x.diff, provider: pay.provider, provider_id: pay.providerId, status: 'paid', created_at: iso(now) });
  }
  const snap = safeJson(b.snapshot, {});
  snap.base_storage = x.fresh;
  const patch = {
    pick_at: iso(x.newPick), plan: x.plan, days: x.days, storage_amount: b.storage_amount + x.diff,
    list_amount: b.list_amount + x.diff, total_amount: b.total_amount + x.diff, snapshot: JSON.stringify(snap), updated_at: iso(now),
  };
  const money = P.recalcMoney({ ...b, ...patch });
  patch.fee_amount = money.fee_amount;
  patch.payout_amount = money.payout_amount;
  await update(db, 'bookings', b.id, patch);
  await logStatus(db, b.id, b.status, 'guest', null, `찾는 시각 변경 → ${kstParts(x.newPick).local} (+${x.diff}원)`);
  return { ...b, ...patch };
}

// ---------- 조회용 ----------
export async function getBookingByCode(db, code) {
  const b = await first(db, 'SELECT * FROM bookings WHERE code=?', String(code || '').toUpperCase());
  if (!b) throw notFound('예약을 찾을 수 없어요.');
  return b;
}

/** 화면에 내려보내는 예약 정보. who: guest | host | admin */
export function bookingView(b, who) {
  const snap = safeJson(b.snapshot, {});
  const v = {
    code: b.code, status: b.status, plan: b.plan, days: b.days,
    bags: { s: b.qty_s, m: b.qty_m, l: b.qty_l }, units: b.units,
    drop: kstParts(ms(b.drop_at)).local, pick: kstParts(ms(b.pick_at)).local,
    lines: snap.lines || [], prepared: !!snap.prepared,
    storage_amount: b.storage_amount, addon_amount: b.addon_amount, list_amount: b.list_amount, total_amount: b.total_amount,
    refund_amount: b.refund_amount, overdue_amount: b.overdue_amount, overdue_paid: b.overdue_paid,
    tag_no: b.tag_no, lang: b.lang,
    guest: { name: b.guest_name, country: b.guest_country },
    created: b.created_at, paid_at: b.paid_at, checked_in_at: b.checked_in_at, checked_out_at: b.checked_out_at,
    cancelled_at: b.cancelled_at, cancel_by: b.cancel_by, cancel_reason: b.cancel_reason,
    hold_expires_at: b.hold_expires_at, approve_due: b.approve_due,
  };
  if (who === 'guest') {
    v.pin = b.pin;
    v.token = b.token;
    v.guest.email = b.guest_email;
    v.guest.phone = b.guest_phone;
  } else {
    v.id = b.id;
    v.fee_amount = b.fee_amount;
    v.payout_amount = b.payout_amount;
    v.guest.phone = b.guest_phone;
    v.settlement_id = b.settlement_id;
    if (who === 'admin') {
      v.guest.email = b.guest_email;
      v.fee = { a: b.fee_a, b: b.fee_b, c: b.fee_c };
      v.host_id = b.host_id;
      v.spot_id = b.spot_id;
    }
  }
  return v;
}

export async function refreshRating(db, spotId) {
  const r = await first(db, 'SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE spot_id=? AND hidden=0', spotId);
  await run(db, 'UPDATE spots SET rating_avg=?, rating_count=? WHERE id=?', r?.avg ? Math.round(r.avg * 10) / 10 : 0, r?.n || 0, spotId);
}

export { payMode };
