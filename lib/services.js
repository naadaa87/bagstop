// 바깥 서비스와 맞닿는 부분: 결제(테스트/포트원), 알림(메일), 번역, 파일 저장
import { all, first, insert } from './db.js';
import { ApiError, bad, iso, nowMs, randomHex, kstParts, ms, won } from './util.js';

// ---------- 결제 ----------
// PORTONE_* 환경 변수가 모두 있으면 실제 결제, 없으면 테스트 결제로 동작합니다.
export function payMode(env) {
  return env.PORTONE_API_SECRET && env.PORTONE_STORE_ID && env.PORTONE_CHANNEL_KEY ? 'portone' : 'test';
}
export function payClientConfig(env) {
  return payMode(env) === 'portone'
    ? { mode: 'portone', storeId: env.PORTONE_STORE_ID, channelKey: env.PORTONE_CHANNEL_KEY }
    : { mode: 'test' };
}

/** 결제 확인. 테스트 모드에서는 항상 성공합니다. */
export async function verifyPayment(env, paymentId, expectedAmount) {
  if (payMode(env) === 'test') return { ok: true, provider: 'test', providerId: paymentId || `test_${randomHex(8)}` };
  if (!paymentId) throw bad('pay_id_required', '결제 정보가 없어요.');
  const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `PortOne ${env.PORTONE_API_SECRET}` },
  });
  if (!res.ok) throw new ApiError(502, 'pay_verify_failed', '결제 확인에 실패했어요. 잠시 뒤 다시 시도해 주세요.');
  const p = await res.json();
  if (p.status !== 'PAID') throw bad('pay_not_paid', '결제가 완료되지 않았어요.');
  if (!p.amount || p.amount.total !== expectedAmount) throw bad('pay_amount_mismatch', '결제 금액이 예약 금액과 달라요.');
  return { ok: true, provider: 'portone', providerId: paymentId };
}

/** 환불. 결제 건별로 남은 금액 안에서 나누어 취소하고 payments에 기록합니다. */
export async function refund(env, db, booking, amount, reason) {
  if (amount <= 0) return 0;
  const rows = await all(db, "SELECT * FROM payments WHERE booking_id=? AND status='paid' ORDER BY id DESC", booking.id);
  const paid = rows.filter((r) => r.kind !== 'refund');
  let left = amount;
  for (const p of paid) {
    if (left <= 0) break;
    const refunded = rows.filter((r) => r.kind === 'refund' && r.provider_id === p.provider_id).reduce((s, r) => s - r.amount, 0);
    const can = Math.min(left, p.amount - refunded);
    if (can <= 0) continue;
    if (p.provider === 'portone') {
      const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(p.provider_id)}/cancel`, {
        method: 'POST',
        headers: { Authorization: `PortOne ${env.PORTONE_API_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || '예약 취소', amount: can }),
      });
      if (!res.ok) throw new ApiError(502, 'refund_failed', '환불 처리에 실패했어요. 잠시 뒤 다시 시도해 주세요.');
    }
    await insert(db, 'payments', {
      booking_id: booking.id, kind: 'refund', amount: -can, provider: p.provider, provider_id: p.provider_id,
      status: 'paid', note: reason || '', created_at: iso(nowMs()),
    });
    left -= can;
  }
  return amount - left;
}

// ---------- 번역 (Workers AI 바인딩 `AI`가 있을 때만) ----------
const AI_LANG = { ko: 'korean', en: 'english', ja: 'japanese', 'zh-hans': 'chinese', 'zh-hant': 'chinese' };
export async function translate(env, text, from, to) {
  if (!env.AI || !text || !AI_LANG[from] || !AI_LANG[to] || AI_LANG[from] === AI_LANG[to]) return '';
  try {
    const out = await env.AI.run('@cf/meta/m2m100-1.2b', { text: text.slice(0, 1000), source_lang: AI_LANG[from], target_lang: AI_LANG[to] });
    return (out && out.translated_text) || '';
  } catch {
    return '';
  }
}

// ---------- 파일 ----------
// R2 바인딩 `FILES`가 있으면 R2에, 없으면 D1에 저장합니다. 사진은 브라우저에서 줄여서 올립니다.
const MAX_FILE = 1_400_000;
export async function saveFile(env, db, { dataUrl, scope, ownerKind, ownerId }) {
  const m = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('file_type', '사진(JPG·PNG·WEBP)이나 PDF 파일만 올릴 수 있어요.');
  const size = Math.floor((m[2].length * 3) / 4);
  if (size > MAX_FILE) throw bad('file_size', '파일이 너무 커요. 1.4MB 이하로 올려 주세요.');
  const id = randomHex(12);
  let data = m[2];
  if (env.FILES) {
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    await env.FILES.put(id, bytes, { httpMetadata: { contentType: m[1] } });
    data = null;
  }
  await insert(db, 'files', { id, scope, owner_kind: ownerKind, owner_id: ownerId ?? null, mime: m[1], size, data, created_at: iso(nowMs()) });
  return id;
}
export async function fileResponse(env, db, file) {
  const headers = {
    'content-type': file.mime,
    'cache-control': file.scope === 'public' ? 'public, max-age=86400' : 'private, no-store',
    'x-content-type-options': 'nosniff',
  };
  if (file.data == null) {
    const obj = env.FILES ? await env.FILES.get(file.id) : null;
    if (!obj) return new Response('Not found', { status: 404 });
    return new Response(obj.body, { headers });
  }
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers });
}

// ---------- 알림 ----------
// RESEND_API_KEY와 MAIL_FROM이 있으면 메일을 보내고, 없으면 발송 기록만 남깁니다.
const fmtTime = (isoStr) => {
  const p = kstParts(ms(isoStr));
  return `${p.date} ${p.time} (KST)`;
};

const GUEST_MAIL = {
  confirmed: {
    ko: ['[백스톱] 예약이 확정됐어요 · {code}', '{name}님, {spot} 예약이 확정됐어요.\n\n맡기는 시각: {drop}\n찾는 시각: {pick}\n결제 금액: {amount}\n\n예약 확인·QR 코드: {link}\n\n스팟에 도착하면 QR 코드를 보여 주세요.'],
    en: ['[BagStop] Your booking is confirmed · {code}', 'Hi {name}, your booking at {spot} is confirmed.\n\nDrop-off: {drop}\nPick-up: {pick}\nPaid: {amount}\n\nBooking & QR code: {link}\n\nShow the QR code when you arrive.'],
    ja: ['[BagStop] ご予約が確定しました · {code}', '{name}様、{spot}のご予約が確定しました。\n\nお預け: {drop}\nお受け取り: {pick}\nお支払い金額: {amount}\n\n予約確認・QRコード: {link}\n\n到着したらQRコードをお見せください。'],
    'zh-hans': ['[BagStop] 预订已确认 · {code}', '{name}，您在{spot}的预订已确认。\n\n寄存时间：{drop}\n领取时间：{pick}\n支付金额：{amount}\n\n查看预订和二维码：{link}\n\n到店后请出示二维码。'],
    'zh-hant': ['[BagStop] 預訂已確認 · {code}', '{name}，您在{spot}的預訂已確認。\n\n寄放時間：{drop}\n領取時間：{pick}\n付款金額：{amount}\n\n查看預訂與 QR Code：{link}\n\n到店後請出示 QR Code。'],
  },
  pending: {
    ko: ['[백스톱] 호스트 승인을 기다리고 있어요 · {code}', '{name}님, {spot}에 예약 요청을 보냈어요. 호스트가 확인하면 바로 알려 드릴게요.\n승인되지 않으면 결제 금액은 전액 환불돼요.\n\n예약 확인: {link}'],
    en: ['[BagStop] Waiting for the host to accept · {code}', 'Hi {name}, your request was sent to {spot}. We will email you as soon as the host responds.\nIf it is not accepted, you get a full refund.\n\nBooking: {link}'],
    ja: ['[BagStop] ホストの承認待ちです · {code}', '{name}様、{spot}に予約リクエストを送りました。ホストが確認しだいお知らせします。\n承認されなかった場合は全額返金されます。\n\n予約確認: {link}'],
    'zh-hans': ['[BagStop] 等待店家确认 · {code}', '{name}，已向{spot}发送预订请求，店家确认后会立即通知您。\n如未被接受，将全额退款。\n\n查看预订：{link}'],
    'zh-hant': ['[BagStop] 等待店家確認 · {code}', '{name}，已向{spot}送出預訂請求，店家確認後會立即通知您。\n若未被接受，將全額退款。\n\n查看預訂：{link}'],
  },
  cancelled: {
    ko: ['[백스톱] 예약이 취소됐어요 · {code}', '{name}님, {spot} 예약이 취소됐어요.\n환불 금액: {refund}\n\n예약 확인: {link}'],
    en: ['[BagStop] Your booking was cancelled · {code}', 'Hi {name}, your booking at {spot} was cancelled.\nRefund: {refund}\n\nBooking: {link}'],
    ja: ['[BagStop] ご予約がキャンセルされました · {code}', '{name}様、{spot}のご予約がキャンセルされました。\n返金額: {refund}\n\n予約確認: {link}'],
    'zh-hans': ['[BagStop] 预订已取消 · {code}', '{name}，您在{spot}的预订已取消。\n退款金额：{refund}\n\n查看预订：{link}'],
    'zh-hant': ['[BagStop] 預訂已取消 · {code}', '{name}，您在{spot}的預訂已取消。\n退款金額：{refund}\n\n查看預訂：{link}'],
  },
  stored: {
    ko: ['[백스톱] 짐을 잘 맡았어요 · {code}', '{name}님, {spot}에서 짐을 맡았어요. 번호표: {tag}\n찾는 시각: {pick}\n\n맡긴 짐 사진 보기: {link}'],
    en: ['[BagStop] Your bags are checked in · {code}', 'Hi {name}, {spot} has your bags. Tag: {tag}\nPick-up: {pick}\n\nSee the check-in photos: {link}'],
    ja: ['[BagStop] お荷物をお預かりしました · {code}', '{name}様、{spot}でお荷物をお預かりしました。番号札: {tag}\nお受け取り: {pick}\n\nお預け時の写真: {link}'],
    'zh-hans': ['[BagStop] 行李已寄存 · {code}', '{name}，{spot}已收到您的行李。号码牌：{tag}\n领取时间：{pick}\n\n查看寄存照片：{link}'],
    'zh-hant': ['[BagStop] 行李已寄放 · {code}', '{name}，{spot}已收到您的行李。號碼牌：{tag}\n領取時間：{pick}\n\n查看寄放照片：{link}'],
  },
  done: {
    ko: ['[백스톱] 짐을 찾아가셨어요 · {code}', '{name}님, 이용해 주셔서 고마워요. {spot}은 어떠셨나요?\n\n리뷰 남기기: {link}'],
    en: ['[BagStop] Thanks for using BagStop · {code}', 'Hi {name}, thanks for storing with us. How was {spot}?\n\nLeave a review: {link}'],
    ja: ['[BagStop] ご利用ありがとうございました · {code}', '{name}様、ご利用ありがとうございました。{spot}はいかがでしたか？\n\nレビューを書く: {link}'],
    'zh-hans': ['[BagStop] 感谢使用 BagStop · {code}', '{name}，感谢您的使用。{spot}的体验如何？\n\n写评价：{link}'],
    'zh-hant': ['[BagStop] 感謝使用 BagStop · {code}', '{name}，感謝您的使用。{spot}的體驗如何？\n\n撰寫評價：{link}'],
  },
  message: {
    ko: ['[백스톱] 호스트가 메시지를 보냈어요 · {code}', '{spot}에서 메시지가 왔어요.\n\n"{text}"\n\n답장하기: {link}'],
    en: ['[BagStop] New message from your host · {code}', '{spot} sent you a message.\n\n"{text}"\n\nReply: {link}'],
    ja: ['[BagStop] ホストからメッセージが届きました · {code}', '{spot}からメッセージが届きました。\n\n"{text}"\n\n返信する: {link}'],
    'zh-hans': ['[BagStop] 店家发来了消息 · {code}', '{spot}给您发来了消息。\n\n"{text}"\n\n回复：{link}'],
    'zh-hant': ['[BagStop] 店家傳來了訊息 · {code}', '{spot}傳來了訊息。\n\n"{text}"\n\n回覆：{link}'],
  },
};

const HOST_MAIL = {
  new_booking: ['[백스톱] 새 예약이 들어왔어요 · {code}', '{spot}에 새 예약이 들어왔어요.\n\n손님: {name}\n맡기는 시각: {drop}\n찾는 시각: {pick}\n짐: {bags}\n\n호스트센터에서 확인하기: {hostLink}'],
  need_approve: ['[백스톱] 승인이 필요한 예약이 있어요 · {code}', '{spot}에 예약 요청이 들어왔어요. 기한 안에 승인하지 않으면 자동으로 취소돼요.\n\n손님: {name}\n맡기는 시각: {drop}\n찾는 시각: {pick}\n짐: {bags}\n\n호스트센터에서 승인하기: {hostLink}'],
  cancelled: ['[백스톱] 예약이 취소됐어요 · {code}', '{spot} 예약({drop})이 취소됐어요.\n\n호스트센터: {hostLink}'],
  message: ['[백스톱] 손님이 메시지를 보냈어요 · {code}', '{name}님이 메시지를 보냈어요.\n\n"{text}"\n\n호스트센터에서 답장하기: {hostLink}'],
  approved: ['[백스톱] 호스트 심사가 끝났어요', '{hostName}님, 백스톱 호스트로 승인됐어요.\n호스트센터에서 스팟 정보와 받는 시간·가격을 마저 채우고 공개해 주세요.\n\n{hostLink}'],
  rejected: ['[백스톱] 호스트 신청 결과를 알려 드려요', '{hostName}님, 아쉽지만 이번 신청은 승인되지 않았어요.\n사유: {text}\n\n내용을 보완해서 다시 신청하실 수 있어요.\n{hostLink}'],
  incident: ['[백스톱] 사고가 접수됐어요 · {code}', '{spot} 예약({code})에 사고가 접수됐어요. 기한 안에 호스트센터에서 내용을 확인하고 소명해 주세요.\n\n{hostLink}'],
  settlement: ['[백스톱] {text} 정산 내역이 나왔어요', '{hostName}님, {text} 정산 내역이 만들어졌어요. 호스트센터에서 확인해 주세요.\n\n{hostLink}'],
};

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));

async function deliver(env, db, { toKind, to, template, subject, body, bookingId }) {
  let status = 'logged';
  if (env.RESEND_API_KEY && env.MAIL_FROM && to) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text: body }),
      });
      status = res.ok ? 'sent' : 'failed';
    } catch {
      status = 'failed';
    }
  }
  await insert(db, 'notifications', {
    to_kind: toKind, to_addr: to || '', channel: 'email', template, subject, body, status,
    booking_id: bookingId ?? null, created_at: iso(nowMs()),
  });
}

/** 정해진 양식이 없는 메일(문의 답변 등) */
export const sendPlain = (env, db, msg) => deliver(env, db, msg).catch((e) => console.log('sendPlain failed', e && e.message));

function bookingVars(env, b, spot, extra = {}, lang = 'ko') {
  const cash = (n) => (lang === 'ko' ? won(n) : `₩${Number(n || 0).toLocaleString('en-US')}`);
  const site = (env.SITE_URL || '').replace(/\/$/, '');
  const bags = [b.qty_s && `소형 ${b.qty_s}`, b.qty_m && `일반 ${b.qty_m}`, b.qty_l && `대형 ${b.qty_l}`].filter(Boolean).join(', ');
  return {
    code: b.code, name: b.guest_name, spot: spot?.name || '', drop: fmtTime(b.drop_at), pick: fmtTime(b.pick_at),
    amount: cash(b.total_amount), refund: cash(b.refund_amount), tag: b.tag_no, bags,
    link: `${site}/${b.lang || 'en'}/b/${b.code}?t=${b.token}`, hostLink: `${site}/host/#/bookings/${b.code}`,
    ...extra,
  };
}

/** 알림은 본 흐름을 막지 않습니다. 실패해도 예약 처리는 그대로 끝납니다. */
export async function notifyGuest(env, db, template, b, spot, extra) {
  try {
    const lang = GUEST_MAIL[template][b.lang] ? b.lang : 'en';
    const vars = bookingVars(env, b, spot, extra, lang);
    if (lang !== 'ko' && spot?.name_en) vars.spot = spot.name_en;
    const [subject, body] = GUEST_MAIL[template][lang];
    await deliver(env, db, { toKind: 'guest', to: b.guest_email, template, subject: fill(subject, vars), body: fill(body, vars), bookingId: b.id });
  } catch (e) {
    console.log('notifyGuest failed', e && e.message);
  }
}
export async function notifyHost(env, db, template, hostId, b, spot, extra = {}) {
  try {
    const host = await first(db, 'SELECT email, name FROM hosts WHERE id=?', hostId);
    if (!host) return;
    const site = (env.SITE_URL || '').replace(/\/$/, '');
    const vars = b ? bookingVars(env, b, spot, extra) : { hostLink: `${site}/host/`, ...extra };
    vars.hostName = host.name;
    const [subject, body] = HOST_MAIL[template];
    await deliver(env, db, { toKind: 'host', to: host.email, template, subject: fill(subject, vars), body: fill(body, vars), bookingId: b?.id });
  } catch (e) {
    console.log('notifyHost failed', e && e.message);
  }
}
