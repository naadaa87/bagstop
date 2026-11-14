// 기본 콘텐츠(FAQ·규정)와 체험용 데이터
import { all, first, run, insert, stmt, getSettings } from './db.js';
import { iso, nowMs, kstParts, kstToMs, randomHex, randomPin, randomCode, HOUR, DAY } from './util.js';
import * as P from './policy.js';
import { hashPassword } from './auth.js';

// ---------- 기본 콘텐츠 ----------
const CONTENTS = [
  ['faq', 'ko', '어떤 짐을 맡길 수 있나요?', '캐리어, 배낭, 쇼핑백처럼 손으로 들 수 있는 짐이면 맡길 수 있어요. 현금·귀금속 같은 귀중품, 상하기 쉬운 음식, 살아 있는 동물, 위험물은 받지 않아요.'],
  ['faq', 'ko', '예약 없이 가도 되나요?', '자리가 있는지 미리 확인할 수 있도록 예약 후 방문을 권해요. 스팟 앞에서 바로 예약해도 1분이면 끝나요.'],
  ['faq', 'ko', '찾는 시각보다 늦으면 어떻게 되나요?', '찾는 시각에서 30분까지는 추가 요금이 없어요. 그보다 늦으면 하루 단위로 초과 요금이 붙어요. 늦을 것 같으면 예약 화면에서 찾는 시각을 미리 바꿔 주세요.'],
  ['faq', 'ko', '취소하면 환불받을 수 있나요?', '맡기는 시각 전에 취소하면 전액 환불돼요. 미리 준비가 필요한 세트는 스팟이 정한 마감 시간이 지나면 보관 요금만 환불돼요.'],
  ['faq', 'ko', '짐이 없어지거나 망가지면요?', '짐을 찾은 날부터 7일 안에 예약 화면에서 사고를 접수해 주세요. 맡길 때 찍은 사진과 대조해 확인하고, 기본 보장 한도 안에서 보상해 드려요.'],
  ['faq', 'ko', '세트는 무엇인가요?', '짐 보관에 그 가게의 메뉴나 서비스를 묶어 더 싸게 파는 상품이에요. 예를 들어 카페의 "짐앤커피"는 짐 보관과 커피 한 잔을 따로 살 때보다 저렴해요.'],
  ['faq', 'en', 'What can I store?', 'Suitcases, backpacks, shopping bags — anything you can carry by hand. We do not accept cash, jewellery and other valuables, perishable food, live animals or dangerous goods.'],
  ['faq', 'en', 'Do I need to book in advance?', 'We recommend booking first so you know there is space. You can also book in front of the spot — it takes about a minute.'],
  ['faq', 'en', 'What if I am late for pick-up?', 'There is no extra charge for the first 30 minutes. After that, an overdue fee is charged per day. If you expect to be late, change your pick-up time on the booking page in advance.'],
  ['faq', 'en', 'Can I get a refund if I cancel?', 'Cancel before your drop-off time and you get a full refund. For sets that need preparation, only the storage fee is refunded once the spot\'s cut-off time has passed.'],
  ['faq', 'en', 'What if my bag is lost or damaged?', 'Report it from your booking page within 7 days of pick-up. We compare it with the check-in photos and compensate you within the basic coverage limit.'],
  ['faq', 'en', 'What is a set?', 'A set bundles luggage storage with something from the shop at a lower price. For example, "Bag & Coffee" at a cafe costs less than buying storage and a coffee separately.'],
  ['rules', 'ko', '보관 규정', '1. 맡길 수 없는 물건: 현금·유가증권·귀금속 등 귀중품, 상하기 쉬운 음식, 동물, 위험물, 법으로 금지된 물건\n2. 맡길 때 호스트가 짐 사진을 2장 이상 찍고 번호표를 드려요. 찾을 때는 예약 QR 코드나 확인 번호를 보여 주세요.\n3. 찾는 시각에서 30분이 지나면 하루 단위로 초과 요금이 붙어요.\n4. 맡기는 시각에서 3시간이 지나도록 오지 않으면 노쇼로 처리되고 환불되지 않아요.\n5. 사고는 짐을 찾은 날부터 7일 안에 접수해 주세요.'],
  ['rules', 'en', 'Storage rules', '1. Not accepted: cash, securities, jewellery and other valuables, perishable food, animals, dangerous goods, anything prohibited by law.\n2. At drop-off the host takes at least two photos of your bags and gives you a tag. Show your booking QR code or PIN at pick-up.\n3. An overdue fee is charged per day once you are more than 30 minutes late for pick-up.\n4. If you do not arrive within 3 hours of your drop-off time, the booking is treated as a no-show and is not refunded.\n5. Report any incident within 7 days of pick-up.'],
  ['terms', 'ko', '이용약관 (초안)', '이 문서는 서비스 구조를 설명하기 위한 초안이에요. 실제 운영 전에는 법률 검토를 거친 약관으로 바꿔 주세요.\n\n· 백스톱은 짐을 맡기려는 고객과 보관 공간을 가진 호스트를 이어 주는 중개 플랫폼이에요.\n· 보관 계약은 고객과 호스트 사이에 맺어지고, 백스톱은 예약·결제·보장 절차를 운영해요.\n· 요금, 취소·환불, 초과 요금, 보장 한도는 예약 화면과 보관 규정에 적힌 기준을 따라요.'],
  ['terms', 'en', 'Terms of service (draft)', 'This is a draft that explains how the service works. Replace it with terms reviewed by a lawyer before launch.\n\n· BagStop is a marketplace that connects travellers with hosts who have space to store luggage.\n· The storage agreement is between the guest and the host. BagStop runs booking, payment and coverage.\n· Prices, cancellation and refunds, overdue fees and coverage limits follow the booking page and the storage rules.'],
  ['privacy', 'ko', '개인정보 처리방침 (초안)', '이 문서는 초안이에요. 실제 운영 전에는 법률 검토를 거친 내용으로 바꿔 주세요.\n\n· 수집 항목: 이름, 이메일, 연락처(선택), 국가(선택), 결제 기록, 짐 사진\n· 여권번호 같은 고유식별정보는 받지 않아요.\n· 이용 목적: 예약 확인과 안내, 결제·환불, 사고 처리'],
  ['privacy', 'en', 'Privacy policy (draft)', 'This is a draft. Replace it with a policy reviewed by a lawyer before launch.\n\n· What we collect: name, email, phone (optional), country (optional), payment records, photos of your bags\n· We never ask for passport numbers.\n· Why: booking confirmation and notices, payment and refunds, incident handling'],
  ['host_faq', 'ko', '수수료는 어떻게 계산되나요?', '예약 한 건마다 보관분과 추가분에 각각 정해진 비율을 곱해 더하고, 그 금액이 건당 최소 수수료보다 적으면 최소 수수료를 받아요. 지금 적용되는 비율은 호스트센터 > 세트·추가 서비스 화면에서 확인할 수 있어요.'],
  ['host_faq', 'ko', '정산은 언제 받나요?', '한 달 동안 찾기 완료된 예약을 모아 다음 달 1일에 정산 내역을 만들고, 10일까지 등록한 계좌로 보내 드려요.'],
];
export async function seedContents(db) {
  const n = await first(db, 'SELECT COUNT(*) AS n FROM contents');
  if (n && n.n) return 0;
  const t = iso(nowMs());
  await db.batch(CONTENTS.map(([kind, lang, title, body], i) => stmt(db, 'INSERT INTO contents (kind, lang, title, body, sort, published, updated_at) VALUES (?,?,?,?,?,1,?)', kind, lang, title, body, i, t)));
  return CONTENTS.length;
}

// ---------- 체험용 데이터 ----------
export const DEMO_LOGIN = { email: 'demo-host@bagstop.example', password: 'bagstop-demo-1234' };

const W = [0, 1, 2, 3, 4, 5, 6];
const blocks = (days, start, end, units, drop = 1, pick = 1) => days.map((weekday) => ({ weekday, start_min: start * 60, end_min: end * 60, units, allow_drop: drop, allow_pick: pick }));

const DEMO = [
  {
    zone: 'hongdae', name: '연남 모먼트 커피', name_en: 'Yeonnam Moment Coffee', category: 'cafe', lat: 37.5609, lng: 126.9237,
    address: '서울 마포구 동교로 242', address_en: '242 Donggyo-ro, Mapo-gu, Seoul', detail: '1층',
    intro: '연남동 골목 안쪽의 로스터리 카페예요. 계산대 옆 선반에 짐을 보관해요.', intro_en: 'A roastery cafe in the back alleys of Yeonnam-dong. Bags are kept on the shelves next to the counter.',
    guide: '홍대입구역 3번 출구에서 걸어서 6분. 주황색 BAG STOP 스티커가 붙은 유리문을 찾아 주세요.', guide_en: '6 min walk from Hongik Univ. Station Exit 3. Look for the glass door with the orange BAG STOP sticker.',
    blocks: [...blocks(W, 10, 21, 8)], overnight: 0,
    prices: { s: [3000, 5000, null, null], m: [5500, 8500, null, null], l: [8000, 12000, null, null] },
    addons: [['아메리카노', 'Americano', 4500, 0], ['오늘의 디저트', 'Dessert of the day', 6500, 1]],
    bundles: [['짐앤커피', 'Bag & Coffee', 'm', 'short', 0, 1, 8500], ['짐앤디저트', 'Bag & Dessert', 'm', 'day', 1, 1, 13000]],
    benefits: [['짐 맡긴 손님 원두 10% 할인', '10% off coffee beans for BagStop guests']],
  },
  {
    zone: 'hongdae', name: '홍대 든든식당', name_en: 'Hongdae Deundeun Kitchen', category: 'restaurant', lat: 37.5558, lng: 126.9229,
    address: '서울 마포구 와우산로 94', address_en: '94 Wausan-ro, Mapo-gu, Seoul', detail: '2층',
    intro: '혼자 와도 편한 한식 백반집이에요. 점심·저녁 사이에도 짐은 계속 보관해요.', intro_en: 'A casual Korean set-meal restaurant. Your bags stay safe during our afternoon break.',
    guide: '홍대입구역 9번 출구에서 걸어서 5분, 건물 2층이에요.', guide_en: '5 min walk from Hongik Univ. Station Exit 9. We are on the 2nd floor.',
    blocks: [...blocks(W.slice(1), 11, 15, 6), ...blocks(W.slice(1), 17, 21, 6)], overnight: 0,
    prices: { s: [3500, 5500, null, null], m: [6000, 9000, null, null] },
    addons: [['제육 백반', 'Spicy pork set meal', 9000, 1]],
    bundles: [['짐앤런치', 'Bag & Lunch', 'm', 'day', 0, 1, 15500]],
    benefits: [],
  },
  {
    zone: 'myeongdong', name: '명동 스테이 라운지', name_en: 'Myeongdong Stay Lounge', category: 'stay', lat: 37.5627, lng: 126.9851,
    address: '서울 중구 명동8나길 21', address_en: '21 Myeongdong 8na-gil, Jung-gu, Seoul', detail: '1층 프런트',
    intro: '게스트하우스 프런트에서 짐을 맡아요. 투숙객이 아니어도 괜찮고, 밤새 보관과 오래 맡기기도 돼요.', intro_en: 'Leave your bags at our guesthouse front desk. Non-guests welcome — overnight and long-term storage available.',
    guide: '명동역 8번 출구에서 걸어서 3분. 프런트는 24시간이 아니니 시간을 꼭 확인해 주세요.', guide_en: '3 min walk from Myeongdong Station Exit 8. The front desk is not open 24 hours, so please check the hours.',
    blocks: [...blocks(W, 8, 22, 12)], overnight: 10, instant: 0,
    prices: { s: [3000, 4500, 24000, 80000], m: [5000, 8000, 45000, 150000], l: [7500, 11500, 65000, 210000] },
    addons: [['샤워실 이용', 'Shower room', 5000, 0]],
    bundles: [['짐앤샤워', 'Bag & Shower', 'm', 'day', 0, 1, 11000]],
    benefits: [['체크아웃 후 라운지 무료 이용', 'Free lounge access after check-out']],
  },
  {
    zone: 'myeongdong', name: '을지로 필름상점', name_en: 'Euljiro Film Shop', category: 'shop', lat: 37.5661, lng: 126.9912,
    address: '서울 중구 을지로 129', address_en: '129 Eulji-ro, Jung-gu, Seoul', detail: '3층',
    intro: '필름 카메라와 소품을 파는 작은 가게예요.', intro_en: 'A small shop selling film cameras and goods.',
    guide: '을지로3가역 10번 출구 바로 앞 건물 3층. 엘리베이터가 없어요.', guide_en: '3rd floor of the building right in front of Euljiro 3-ga Station Exit 10. No elevator.',
    blocks: [...blocks([2, 3, 4, 5, 6, 0], 12, 20, 4)], overnight: 0,
    prices: { s: [2500, 4000, null, null], m: [5000, 7500, null, null] },
    addons: [['일회용 필름 카메라', 'Disposable film camera', 19000, 0]],
    bundles: [['짐앤필름', 'Bag & Film', 's', 'day', 0, 1, 21000]],
    benefits: [['필름 현상 1,000원 할인', '₩1,000 off film developing']],
  },
  {
    zone: 'seongsu', name: '성수 베이크하우스', name_en: 'Seongsu Bake House', category: 'cafe', lat: 37.5441, lng: 127.0561,
    address: '서울 성동구 연무장길 41', address_en: '41 Yeonmujang-gil, Seongdong-gu, Seoul', detail: '1층',
    intro: '아침마다 베이글을 굽는 베이커리 카페예요.', intro_en: 'A bakery cafe that bakes bagels every morning.',
    guide: '성수역 4번 출구에서 걸어서 4분.', guide_en: '4 min walk from Seongsu Station Exit 4.',
    blocks: [...blocks(W, 9, 20, 6)], overnight: 0, deadline: 12,
    prices: { s: [3500, 5500, null, null], m: [6000, 9500, null, null], l: [8500, 13000, null, null] },
    addons: [['베이글 2개 세트', 'Two bagels', 7000, 1]],
    bundles: [['짐앤베이글', 'Bag & Bagel', 'm', 'short', 0, 1, 11000]],
    benefits: [],
  },
  {
    zone: 'seoul-station', name: '서울역 여행자 편의점', name_en: 'Seoul Station Traveller Mart', category: 'cvs', lat: 37.5562, lng: 126.9722,
    address: '서울 용산구 한강대로 405', address_en: '405 Hangang-daero, Yongsan-gu, Seoul', detail: '',
    intro: '서울역 광장 건너편 편의점이에요. 아침 일찍부터 밤늦게까지 열어요.', intro_en: 'A convenience store across from Seoul Station plaza. Open from early morning until late.',
    guide: '서울역 1번 출구에서 횡단보도를 건너 바로.', guide_en: 'Cross the street from Seoul Station Exit 1.',
    blocks: [...blocks(W, 7, 23, 10)], overnight: 4,
    prices: { s: [3000, 5000, 28000, null], m: [5500, 8600, 49000, null], l: [8000, 12000, 70000, null] },
    addons: [['유심·교통카드 세트', 'SIM & transit card set', 15000, 0]],
    bundles: [['짐앤교통카드', 'Bag & Transit', 'm', 'day', 0, 1, 21500]],
    benefits: [['생수 1병 무료', 'One free bottle of water']],
  },
];

const GUESTS = [
  ['Emma Wilson', 'emma.w@example.com', 'US', 'en'], ['佐藤 美咲', 'misaki.s@example.com', 'JP', 'ja'], ['王小明', 'xiaoming@example.com', 'CN', 'zh-hans'],
  ['陳怡君', 'yichun@example.com', 'TW', 'zh-hant'], ['김하늘', 'haneul@example.com', 'KR', 'ko'], ['Lucas Martin', 'lucas.m@example.com', 'FR', 'en'],
];
const REVIEWS = [
  [5, 'Super easy. Dropped my suitcase before check-in and had a great coffee too.', 'en'], [5, '場所が分かりやすく、スタッフの方も親切でした。', 'ja'],
  [4, '位置很方便，寄存很快。', 'zh-hans'], [5, '짐 맡기고 가볍게 돌아다녔어요. 세트가 따로 사는 것보다 싸서 좋았어요.', 'ko'], [4, 'Good value. The shop is on the 3rd floor with no elevator, though.', 'en'],
];

export async function seedDemo(db) {
  if (await first(db, 'SELECT id FROM hosts WHERE is_demo=1 LIMIT 1')) return { inserted: 0, message: '체험용 데이터가 이미 들어 있어요.', login: DEMO_LOGIN };
  const settings = await getSettings(db);
  const zones = await all(db, 'SELECT id, slug FROM zones');
  const now = nowMs(), t = iso(now);
  const pw = await hashPassword(DEMO_LOGIN.password);
  const spots = [];
  for (let i = 0; i < DEMO.length; i++) {
    const d = DEMO[i];
    const hostId = await insert(db, 'hosts', {
      email: i === 0 ? DEMO_LOGIN.email : `demo-host${i + 1}@bagstop.example`, pw_hash: i === 0 ? pw : `x$${randomHex(8)}`,
      name: `${d.name} 사장님`, phone: '010-0000-0000', type: d.category === 'stay' ? 'stay' : 'store', biz_name: d.name, biz_no: `10000000${10 + i}`,
      rep_name: '체험용', status: 'approved', bank_name: '체험은행', bank_account: `000-00-${100000 + i}`, bank_holder: d.name,
      account_verified: i % 2 === 0 ? 1 : 0, is_demo: 1, created_at: t, applied_at: t, approved_at: t,
    });
    const spotId = await insert(db, 'spots', {
      host_id: hostId, zone_id: zones.find((z) => z.slug === d.zone)?.id ?? null, slug: `demo-${d.name_en.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      name: d.name, name_en: d.name_en, category: d.category, address: d.address, address_en: d.address_en, address_detail: d.detail,
      lat: d.lat, lng: d.lng, phone: '02-000-0000', intro: d.intro, intro_en: d.intro_en, guide: d.guide, guide_en: d.guide_en,
      rules: '', photos: '[]', status: 'live', instant_confirm: d.instant ?? 1, overnight_units: d.overnight, cancel_deadline_h: d.deadline || 0,
      created_at: t, updated_at: t,
    });
    const stmts = d.blocks.map((b) => stmt(db, 'INSERT INTO spot_blocks (spot_id, weekday, start_min, end_min, units, allow_drop, allow_pick) VALUES (?,?,?,?,?,?,?)', spotId, b.weekday, b.start_min, b.end_min, b.units, b.allow_drop, b.allow_pick));
    for (const [size, p] of Object.entries(d.prices)) stmts.push(stmt(db, 'INSERT INTO spot_prices (spot_id, size, short_price, day_price, week_price, month_price) VALUES (?,?,?,?,?,?)', spotId, size, ...p));
    for (const [text, en] of d.benefits) stmts.push(stmt(db, 'INSERT INTO benefits (spot_id, text, text_en) VALUES (?,?,?)', spotId, text, en));
    await db.batch(stmts);
    const addonIds = [];
    for (const [name, en, price, prepared] of d.addons) addonIds.push(await insert(db, 'addons', { spot_id: spotId, name, name_en: en, price, prepared }));
    for (const [name, en, size, period, ai, qty, price] of d.bundles) await insert(db, 'bundles', { spot_id: spotId, name, name_en: en, size, period, addon_id: addonIds[ai], addon_qty: qty, price });
    spots.push({ id: spotId, hostId, d });
  }

  // 예약 몇 건: 오늘 화면·정산·리뷰를 바로 살펴볼 수 있게 상태를 섞어 둡니다.
  const mk = async (sp, gi, status, dropMs, pickMs, bags, extra = {}) => {
    const prices = {};
    for (const [size, p] of Object.entries(sp.d.prices)) prices[size] = { short_price: p[0], day_price: p[1], week_price: p[2], month_price: p[3] };
    const q = P.quote({ settings, prices, bags, bundle: null, bundleQty: 0, dropMs, pickMs });
    const g = GUESTS[gi % GUESTS.length];
    const id = await insert(db, 'bookings', {
      code: `BAG${randomCode(6)}`, token: randomHex(16), pin: randomPin(), spot_id: sp.id, host_id: sp.hostId, status,
      plan: q.plan, days: q.days, qty_s: q.bags.s, qty_m: q.bags.m, qty_l: q.bags.l, units: q.units,
      drop_at: iso(dropMs), pick_at: iso(pickMs), noshow_due: iso(dropMs + 3 * HOUR),
      guest_name: g[0], guest_email: g[1], guest_country: g[2], lang: g[3],
      storage_amount: q.storage, addon_amount: 0, list_amount: q.list, total_amount: q.total, fee_amount: q.fee, payout_amount: q.payout,
      fee_a: settings.fee_a, fee_b: settings.fee_b, fee_c: settings.fee_c, snapshot: JSON.stringify({ lines: q.lines, base_storage: q.storage }),
      paid_at: iso(Math.min(now, dropMs - HOUR)), is_demo: 1, created_at: iso(Math.min(now, dropMs - HOUR)), updated_at: t, ...extra,
    });
    await insert(db, 'payments', { booking_id: id, kind: 'main', amount: q.total, provider: 'test', provider_id: `demo_${id}`, status: 'paid', created_at: t });
    return id;
  };
  const today = kstParts(now).date;
  const at = (dayOffset, hhmm) => kstToMs(`${today}T${hhmm}`) + dayOffset * DAY;
  const s0 = spots[0], s2 = spots[2], s5 = spots[5];
  await mk(s0, 0, 'confirmed', at(0, '20:00'), at(0, '21:00'), { m: 1 });
  await mk(s0, 1, 'confirmed', at(1, '11:00'), at(1, '18:00'), { m: 2, s: 1 });
  await mk(s0, 2, 'stored', now - 2 * HOUR, now + 3 * HOUR, { l: 1 }, { checked_in_at: iso(now - 2 * HOUR), tag_no: '12' });
  await mk(s0, 3, 'overdue', now - 8 * HOUR, now - 2 * HOUR, { m: 1 }, { checked_in_at: iso(now - 8 * HOUR), tag_no: '7' });
  await mk(s2, 4, 'pending', at(1, '10:00'), at(3, '10:00'), { m: 1, l: 1 }, { approve_due: iso(now + 2 * HOUR) });
  await mk(s5, 5, 'confirmed', at(1, '08:00'), at(1, '20:00'), { m: 2 });
  let ri = 0;
  for (const [sp, gi, off] of [[s0, 0, -1], [s0, 1, -3], [spots[1], 2, -2], [s2, 3, -5], [spots[3], 5, -4], [s0, 4, -35], [s5, 2, -33], [spots[4], 0, -40]]) {
    const drop = at(off, '12:00'), pick = at(off, '18:00');
    const id = await mk(sp, gi, 'done', drop, pick, off < -30 ? { m: 2, l: 1 } : { m: 1 + (gi % 2) }, { checked_in_at: iso(drop), checked_out_at: iso(pick), closed_at: iso(pick), tag_no: String(3 + gi) });
    if (ri < REVIEWS.length) {
      const [rating, body, lang] = REVIEWS[ri++];
      const g = GUESTS[gi % GUESTS.length];
      await insert(db, 'reviews', { booking_id: id, spot_id: sp.id, rating, price_score: rating, service_score: 5, find_score: rating, body, lang, guest_name: g[0], guest_country: g[2], created_at: iso(pick + HOUR) });
    }
  }
  for (const sp of spots) {
    const r = await first(db, 'SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE spot_id=?', sp.id);
    await run(db, 'UPDATE spots SET rating_avg=?, rating_count=? WHERE id=?', r?.avg ? Math.round(r.avg * 10) / 10 : 0, r?.n || 0, sp.id);
  }
  return { inserted: spots.length, message: `체험용 스팟 ${spots.length}곳과 예약·리뷰를 넣었어요.`, login: DEMO_LOGIN };
}

export async function clearDemo(db) {
  const hosts = await all(db, 'SELECT id FROM hosts WHERE is_demo=1');
  if (!hosts.length) return { deleted: 0 };
  const h = hosts.map((x) => x.id).join(',');
  const spots = (await all(db, `SELECT id FROM spots WHERE host_id IN (${h})`)).map((x) => x.id).join(',') || '0';
  const bk = `SELECT id FROM bookings WHERE host_id IN (${h})`;
  await db.batch([
    ...['payments', 'checkins', 'messages', 'reviews', 'incidents', 'status_logs'].map((tb) => db.prepare(`DELETE FROM ${tb} WHERE booking_id IN (${bk})`)),
    db.prepare(`DELETE FROM notifications WHERE booking_id IN (${bk})`),
    db.prepare(`DELETE FROM bookings WHERE host_id IN (${h})`),
    ...['spot_blocks', 'spot_closures', 'spot_prices', 'addons', 'bundles', 'benefits'].map((tb) => db.prepare(`DELETE FROM ${tb} WHERE spot_id IN (${spots})`)),
    db.prepare(`DELETE FROM settlements WHERE host_id IN (${h})`),
    db.prepare(`DELETE FROM spots WHERE host_id IN (${h})`),
    db.prepare(`DELETE FROM sessions WHERE kind='host' AND user_id IN (${h})`),
    db.prepare(`DELETE FROM hosts WHERE id IN (${h})`),
  ]);
  return { deleted: hosts.length };
}
