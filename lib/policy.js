// 백스톱 정책 계산: 요금, 세트 안분, 수수료, 시간 블록 × 물량, 취소·환불
// DB를 건드리지 않는 순수 함수만 모아 두었습니다. (Node에서도 그대로 검증할 수 있습니다)
import { kstParts, kstDayStart, HOUR, DAY, MIN } from './util.js';

export const SIZES = ['s', 'm', 'l'];
export const PERIOD_RANK = { short: 0, day: 1, long: 2 };

// ---------- 가격 범위(기준가의 하한~상한) ----------
const ceil100 = (n) => Math.ceil(n / 100) * 100;
const floor100 = (n) => Math.floor(n / 100) * 100;

export function band(zone, size) {
  const base = zone[`base_${size}`];
  return { base, min: ceil100((base * zone.floor_pct) / 100), max: floor100((base * zone.cap_pct) / 100) };
}

/** 호스트가 입력한 가격표 검증. rows: { s:{short_price,day_price,week_price,month_price}, m:…, l:… } */
export function validatePrices(zone, rows) {
  const errors = [];
  const label = { s: '소형', m: '일반', l: '대형' };
  for (const size of SIZES) {
    const p = rows[size];
    if (!p) {
      errors.push(`${label[size]} 가격을 입력해 주세요.`);
      continue;
    }
    const fields = ['short_price', 'day_price', 'week_price', 'month_price'];
    for (const f of fields) {
      const v = p[f];
      if (v == null) continue;
      if (!Number.isInteger(v) || v <= 0 || v % 100 !== 0) errors.push(`${label[size]} 가격은 100원 단위로 입력해 주세요.`);
    }
    if (!p.short_price || !p.day_price) {
      errors.push(`${label[size]}의 잠깐·하루 가격은 꼭 필요해요.`);
      continue;
    }
    if (zone) {
      const b = band(zone, size);
      if (p.day_price < b.min || p.day_price > b.max) {
        errors.push(`${label[size]} 하루 가격은 ${b.min.toLocaleString()}원~${b.max.toLocaleString()}원 사이로 정해 주세요.`);
      }
    }
    if (p.short_price >= p.day_price) errors.push(`${label[size]} 잠깐 가격은 하루 가격보다 낮아야 해요.`);
    if (p.week_price != null && p.week_price >= p.day_price * 7) errors.push(`${label[size]} 1주 가격은 하루 가격 × 7보다 낮아야 해요.`);
    if (p.week_price != null && p.week_price < p.day_price) errors.push(`${label[size]} 1주 가격은 하루 가격보다 높아야 해요.`);
    const week = p.week_price ?? p.day_price * 7;
    if (p.month_price != null && p.month_price >= week * 4) errors.push(`${label[size]} 1달 가격은 1주 가격 × 4보다 낮아야 해요.`);
    if (p.month_price != null && p.month_price < week) errors.push(`${label[size]} 1달 가격은 1주 가격보다 높아야 해요.`);
  }
  return [...new Set(errors)];
}

// ---------- 기간과 요금 ----------
/** 맡기는 시각·찾는 시각으로 상품(잠깐/하루/오래)과 일수를 정합니다. */
export function planOf(settings, dropMs, pickMs) {
  const dur = pickMs - dropMs;
  if (dur <= settings.short_hours * HOUR) return { plan: 'short', days: 1 };
  const days = Math.max(1, Math.ceil(dur / DAY));
  const sameDay = kstParts(dropMs).date === kstParts(pickMs).date;
  return { plan: days === 1 && sameDay ? 'day' : 'long', days };
}

function longCost(p, days) {
  const day = p.day_price;
  const week = p.week_price ?? day * 7;
  const w = (d) => Math.floor(d / 7) * week + Math.min((d % 7) * day, week);
  if (p.month_price == null) return w(days);
  return Math.floor(days / 30) * p.month_price + Math.min(w(days % 30), p.month_price);
}
/** 짐 1개의 보관 요금 */
export function bagPrice(p, plan, days) {
  if (plan === 'short') return p.short_price;
  if (days <= 1) return p.day_price;
  return longCost(p, days);
}

/** 세트 가격을 보관분·추가분으로 나눕니다. */
export function splitBundle(setPrice, storagePrice, addonTotal) {
  const list = storagePrice + addonTotal;
  const storage = Math.round((setPrice * storagePrice) / list);
  return { storage, addon: setPrice - storage, list, save: list - setPrice };
}

/** 세트 등록 검증 */
export function validateBundle(bundle, priceRow, addon) {
  if (!priceRow) return '먼저 이 크기의 짐 보관 가격을 정해 주세요.';
  if (!addon || !addon.active) return '세트에 넣을 추가 서비스를 골라 주세요.';
  if (!['short', 'day'].includes(bundle.period)) return '세트는 잠깐 또는 하루 보관에만 만들 수 있어요.';
  if (!Number.isInteger(bundle.price) || bundle.price <= 0 || bundle.price % 100 !== 0) return '세트 가격은 100원 단위로 입력해 주세요.';
  if (!(bundle.addon_qty >= 1 && bundle.addon_qty <= 10)) return '추가 서비스 수량을 확인해 주세요.';
  const storagePrice = bundle.period === 'short' ? priceRow.short_price : priceRow.day_price;
  const list = storagePrice + addon.price * bundle.addon_qty;
  if (bundle.price >= list) return `세트 가격은 따로 살 때 가격(${list.toLocaleString()}원)보다 낮아야 해요.`;
  return '';
}

export function calcFee(storage, addon, a, b, c) {
  const net = storage + addon;
  if (net <= 0) return 0;
  return Math.min(net, Math.max(Math.round((storage * a) / 100 + (addon * b) / 100), c));
}

export function unitsOf(settings, bags) {
  return (bags.s || 0) * settings.unit_s + (bags.m || 0) * settings.unit_m + (bags.l || 0) * settings.unit_l;
}

/**
 * 견적. prices: {s,m,l} 가격표, bags: 세트에 포함되지 않은 짐 개수, bundle: 세트(+addon) 또는 null
 */
export function quote({ settings, prices, bags, bundle, bundleQty, dropMs, pickMs }) {
  const { plan, days } = planOf(settings, dropMs, pickMs);
  const lines = [];
  let storage = 0, addon = 0, list = 0;
  const totalBags = { s: bags.s || 0, m: bags.m || 0, l: bags.l || 0 };

  if (bundle && bundleQty > 0) {
    if (plan === 'long' || PERIOD_RANK[plan] > PERIOD_RANK[bundle.period]) {
      return { error: 'bundle_period', plan, days };
    }
    const p = prices[bundle.size];
    if (!p) return { error: 'no_price', plan, days };
    const storagePrice = bundle.period === 'short' ? p.short_price : p.day_price;
    const sp = splitBundle(bundle.price, storagePrice, bundle.addon.price * bundle.addon_qty);
    storage += sp.storage * bundleQty;
    addon += sp.addon * bundleQty;
    list += sp.list * bundleQty;
    totalBags[bundle.size] += bundleQty;
    lines.push({
      type: 'bundle', id: bundle.id, name: bundle.name, name_en: bundle.name_en, size: bundle.size, qty: bundleQty,
      unit: bundle.price, amount: bundle.price * bundleQty, list: sp.list * bundleQty,
      addon_name: bundle.addon.name, addon_name_en: bundle.addon.name_en, addon_qty: bundle.addon_qty,
    });
  }
  for (const size of SIZES) {
    const qty = bags[size] || 0;
    if (!qty) continue;
    const p = prices[size];
    if (!p) return { error: 'no_price', plan, days };
    const unit = bagPrice(p, plan, days);
    storage += unit * qty;
    list += unit * qty;
    lines.push({ type: 'bag', size, qty, unit, amount: unit * qty });
  }
  const total = storage + addon;
  const fee = calcFee(storage, addon, settings.fee_a, settings.fee_b, settings.fee_c);
  return {
    plan, days, lines, bags: totalBags, units: unitsOf(settings, totalBags),
    storage, addon, list, total, save: list - total, fee, payout: total - fee,
  };
}

/** 환불·초과 요금이 생긴 뒤의 수수료와 정산액을 다시 계산합니다. 환불은 보관분에서 먼저 뺍니다. */
export function recalcMoney(b) {
  const refund = b.refund_amount || 0;
  const overdue = b.overdue_paid || 0; // 온라인으로 받은 초과 요금
  const keptStorage = Math.max(0, b.storage_amount - refund) + overdue;
  const keptAddon = b.addon_amount - Math.max(0, refund - b.storage_amount);
  const net = keptStorage + Math.max(0, keptAddon);
  const fee = calcFee(keptStorage, Math.max(0, keptAddon), b.fee_a, b.fee_b, b.fee_c);
  return { net, fee_amount: fee, payout_amount: net - fee };
}

// ---------- 시간 블록 × 물량 ----------
// cfg = { blocks: [{weekday,start_min,end_min,units,allow_drop,allow_pick}], closures: Set<'YYYY-MM-DD'>, overnight }

function dayBlocks(cfg, dateStr, weekday) {
  if (cfg.closures.has(dateStr)) return [];
  return cfg.blocks.filter((b) => b.weekday === weekday).sort((a, b) => a.start_min - b.start_min);
}

/** 그 시각에 받을 수 있는 물량(칸) */
export function capacityAt(cfg, t) {
  const p = kstParts(t);
  const blocks = dayBlocks(cfg, p.date, p.weekday);
  let prev = null;
  for (const b of blocks) {
    if (p.minOfDay >= b.start_min && p.minOfDay < b.end_min) return b.units;
    if (p.minOfDay < b.start_min) return prev ? Math.min(prev.units, b.units) : cfg.overnight; // 블록 사이 쉬는 시간
    prev = b;
  }
  return cfg.overnight; // 영업 전·후, 휴무일
}

function boundaries(cfg, fromMs, toMs) {
  const pts = new Set([fromMs, toMs]);
  for (let d = kstDayStart(kstParts(fromMs).date); d <= toMs; d += DAY) {
    const p = kstParts(d);
    pts.add(d);
    for (const b of dayBlocks(cfg, p.date, p.weekday)) {
      pts.add(d + b.start_min * MIN);
      pts.add(d + b.end_min * MIN);
    }
  }
  return pts;
}

/**
 * 보관 기간 내내 (이미 잡힌 칸 + 새로 맡길 칸) ≤ 받을 수 있는 칸인지 확인합니다.
 * others: [{from,to,units}] 같은 스팟에서 자리를 차지하고 있는 예약
 */
export function checkCapacity(cfg, others, req) {
  const pts = boundaries(cfg, req.from, req.to);
  for (const o of others) {
    pts.add(o.from);
    pts.add(o.to);
  }
  const sorted = [...pts].filter((t) => t >= req.from && t <= req.to).sort((a, b) => a - b);
  let minLeft = Infinity;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (b <= a) continue;
    const mid = (a + b) / 2;
    const cap = capacityAt(cfg, mid);
    let used = 0;
    for (const o of others) if (o.from <= mid && mid < o.to) used += o.units;
    const left = cap - used;
    if (left < minLeft) minLeft = left;
    if (used + req.units > cap + 1e-9) {
      return { ok: false, at: a, cap, used, overnight: cap === cfg.overnight && !inBlock(cfg, mid) };
    }
  }
  return { ok: true, left: minLeft };
}

function inBlock(cfg, t) {
  const p = kstParts(t);
  return dayBlocks(cfg, p.date, p.weekday).some((b) => p.minOfDay >= b.start_min && p.minOfDay < b.end_min);
}

/** 맡기는 시각이 '맡기기 가능' 블록 안인지 */
export function canDropAt(cfg, t) {
  const p = kstParts(t);
  return dayBlocks(cfg, p.date, p.weekday).some((b) => b.allow_drop && p.minOfDay >= b.start_min && p.minOfDay < b.end_min);
}
/** 찾는 시각이 '찾기 가능' 블록 안(끝 시각 포함)인지 */
export function canPickAt(cfg, t) {
  const p = kstParts(t);
  if (dayBlocks(cfg, p.date, p.weekday).some((b) => b.allow_pick && p.minOfDay >= b.start_min && p.minOfDay <= b.end_min)) return true;
  if (p.minOfDay === 0) {
    const y = kstParts(t - MIN);
    return dayBlocks(cfg, y.date, y.weekday).some((b) => b.allow_pick && b.end_min === 1440);
  }
  return false;
}

/** 노쇼 처리 시각: 맡기는 시각 + N시간, 그날 맡기기 가능 시간이 끝나는 때 중 빠른 쪽 */
export function noshowDue(cfg, settings, dropMs) {
  const p = kstParts(dropMs);
  const day0 = kstDayStart(p.date);
  const ends = dayBlocks(cfg, p.date, p.weekday).filter((b) => b.allow_drop).map((b) => day0 + b.end_min * MIN);
  const lastEnd = ends.length ? Math.max(...ends) : dropMs;
  return Math.min(dropMs + settings.noshow_hours * HOUR, Math.max(lastEnd, dropMs));
}

/** 특정 날짜의 블록별 남은 칸 (화면 표시용) */
export function dayAvailability(cfg, others, dateStr) {
  const day0 = kstDayStart(dateStr);
  const p = kstParts(day0);
  return dayBlocks(cfg, p.date, p.weekday).map((b) => {
    const from = day0 + b.start_min * MIN, to = day0 + b.end_min * MIN;
    const r = checkCapacity(cfg, others, { from, to, units: 0 });
    return {
      start_min: b.start_min, end_min: b.end_min, units: b.units,
      allow_drop: !!b.allow_drop, allow_pick: !!b.allow_pick,
      left: Math.max(0, r.ok ? r.left : 0),
    };
  });
}

// ---------- 취소·환불 ----------
/** 고객이 직접 취소할 때의 환불액 */
export function guestCancelRefund(b, spot, preparedAddon, now) {
  const dropMs = new Date(b.drop_at).getTime();
  if (!['pending', 'confirmed'].includes(b.status)) return { allowed: false, reason: 'status' };
  if (now >= dropMs) return { allowed: false, reason: 'after_drop' };
  const deadlineH = Math.min(24, spot.cancel_deadline_h || 0);
  if (b.addon_amount > 0 && preparedAddon && deadlineH > 0 && now > dropMs - deadlineH * HOUR) {
    return { allowed: true, refund: b.storage_amount, partial: true };
  }
  return { allowed: true, refund: b.total_amount, partial: false };
}

/** 미수령 초과 요금: 찾는 시각 + 유예 시간이 지나면 하루 단위 */
export function overdueCharge(settings, prices, b, now) {
  const pickMs = new Date(b.pick_at).getTime();
  const late = now - pickMs - settings.overdue_grace_min * MIN;
  if (late <= 0) return { days: 0, amount: 0 };
  const days = Math.ceil((now - pickMs) / DAY);
  let amount = 0;
  for (const size of SIZES) {
    const qty = b[`qty_${size}`] || 0;
    if (qty && prices[size]) amount += prices[size].day_price * qty * days;
  }
  return { days, amount };
}
