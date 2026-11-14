// 데이터베이스 구조. Admin의 "DB 준비하기"가 이 목록을 그대로 실행합니다.
// 구조를 바꿀 때는 SCHEMA_VERSION을 올리고, 새 컬럼은 ALTERS에 추가하세요.

export const SCHEMA_VERSION = 1;

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    pw_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, last_login_at TEXT)`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS hosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, pw_hash TEXT NOT NULL,
    name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'store', biz_name TEXT NOT NULL DEFAULT '', biz_no TEXT NOT NULL DEFAULT '',
    rep_name TEXT NOT NULL DEFAULT '', doc_file TEXT, doc2_file TEXT,
    status TEXT NOT NULL DEFAULT 'draft', reject_reason TEXT NOT NULL DEFAULT '',
    bank_name TEXT NOT NULL DEFAULT '', bank_account TEXT NOT NULL DEFAULT '', bank_holder TEXT NOT NULL DEFAULT '',
    account_verified INTEGER NOT NULL DEFAULT 0, admin_memo TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, applied_at TEXT, approved_at TEXT)`,

  `CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, names TEXT NOT NULL,
    lat REAL NOT NULL, lng REAL NOT NULL,
    base_s INTEGER NOT NULL, base_m INTEGER NOT NULL, base_l INTEGER NOT NULL,
    floor_pct INTEGER NOT NULL DEFAULT 60, cap_pct INTEGER NOT NULL DEFAULT 150,
    intro TEXT NOT NULL DEFAULT '{}', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0)`,

  `CREATE TABLE IF NOT EXISTS spots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, host_id INTEGER NOT NULL, zone_id INTEGER,
    slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_en TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'cafe',
    address TEXT NOT NULL DEFAULT '', address_en TEXT NOT NULL DEFAULT '', address_detail TEXT NOT NULL DEFAULT '',
    lat REAL, lng REAL, phone TEXT NOT NULL DEFAULT '',
    intro TEXT NOT NULL DEFAULT '', intro_en TEXT NOT NULL DEFAULT '',
    guide TEXT NOT NULL DEFAULT '', guide_en TEXT NOT NULL DEFAULT '',
    rules TEXT NOT NULL DEFAULT '', photos TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft', instant_confirm INTEGER NOT NULL DEFAULT 1,
    overnight_units REAL NOT NULL DEFAULT 0, cancel_deadline_h INTEGER NOT NULL DEFAULT 0,
    rating_avg REAL NOT NULL DEFAULT 0, rating_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_spots_host ON spots(host_id)`,
  `CREATE INDEX IF NOT EXISTS idx_spots_zone ON spots(zone_id, status)`,

  `CREATE TABLE IF NOT EXISTS spot_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, spot_id INTEGER NOT NULL, weekday INTEGER NOT NULL,
    start_min INTEGER NOT NULL, end_min INTEGER NOT NULL, units REAL NOT NULL,
    allow_drop INTEGER NOT NULL DEFAULT 1, allow_pick INTEGER NOT NULL DEFAULT 1)`,
  `CREATE INDEX IF NOT EXISTS idx_blocks_spot ON spot_blocks(spot_id)`,

  `CREATE TABLE IF NOT EXISTS spot_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, spot_id INTEGER NOT NULL, date TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_closures_spot ON spot_closures(spot_id, date)`,

  `CREATE TABLE IF NOT EXISTS spot_prices (
    spot_id INTEGER NOT NULL, size TEXT NOT NULL,
    short_price INTEGER NOT NULL, day_price INTEGER NOT NULL, week_price INTEGER, month_price INTEGER,
    PRIMARY KEY (spot_id, size))`,

  `CREATE TABLE IF NOT EXISTS addons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, spot_id INTEGER NOT NULL, name TEXT NOT NULL, name_en TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', prepared INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0)`,

  `CREATE TABLE IF NOT EXISTS bundles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, spot_id INTEGER NOT NULL, name TEXT NOT NULL, name_en TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL, period TEXT NOT NULL, addon_id INTEGER NOT NULL, addon_qty INTEGER NOT NULL DEFAULT 1,
    price INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0)`,

  `CREATE TABLE IF NOT EXISTS benefits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, spot_id INTEGER NOT NULL, text TEXT NOT NULL, text_en TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1)`,

  `CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, token TEXT NOT NULL, pin TEXT NOT NULL,
    spot_id INTEGER NOT NULL, host_id INTEGER NOT NULL, status TEXT NOT NULL,
    plan TEXT NOT NULL, days INTEGER NOT NULL DEFAULT 1,
    qty_s INTEGER NOT NULL DEFAULT 0, qty_m INTEGER NOT NULL DEFAULT 0, qty_l INTEGER NOT NULL DEFAULT 0,
    units REAL NOT NULL, bundle_id INTEGER, bundle_qty INTEGER NOT NULL DEFAULT 0,
    drop_at TEXT NOT NULL, pick_at TEXT NOT NULL, noshow_due TEXT, approve_due TEXT,
    guest_name TEXT NOT NULL, guest_email TEXT NOT NULL, guest_phone TEXT NOT NULL DEFAULT '',
    guest_country TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT 'en',
    storage_amount INTEGER NOT NULL, addon_amount INTEGER NOT NULL DEFAULT 0,
    list_amount INTEGER NOT NULL, total_amount INTEGER NOT NULL,
    fee_amount INTEGER NOT NULL, payout_amount INTEGER NOT NULL,
    fee_a REAL NOT NULL, fee_b REAL NOT NULL, fee_c INTEGER NOT NULL,
    refund_amount INTEGER NOT NULL DEFAULT 0, overdue_amount INTEGER NOT NULL DEFAULT 0, overdue_paid INTEGER NOT NULL DEFAULT 0,
    snapshot TEXT NOT NULL DEFAULT '{}', hold_expires_at TEXT, paid_at TEXT,
    checked_in_at TEXT, checked_out_at TEXT, tag_no TEXT NOT NULL DEFAULT '',
    cancelled_at TEXT, cancel_by TEXT, cancel_reason TEXT NOT NULL DEFAULT '', closed_at TEXT,
    settlement_id INTEGER, is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_spot ON bookings(spot_id, status, drop_at)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_host ON bookings(host_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(guest_email)`,

  `CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL,
    provider TEXT NOT NULL, provider_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id)`,

  `CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL, kind TEXT NOT NULL,
    photos TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', by_kind TEXT NOT NULL, by_id INTEGER, created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_kind TEXT NOT NULL, owner_id INTEGER,
    mime TEXT NOT NULL, size INTEGER NOT NULL, data TEXT, created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL, sender TEXT NOT NULL,
    body TEXT NOT NULL, lang TEXT NOT NULL DEFAULT '', translated TEXT NOT NULL DEFAULT '',
    read_guest INTEGER NOT NULL DEFAULT 0, read_host INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_booking ON messages(booking_id)`,

  `CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL UNIQUE, spot_id INTEGER NOT NULL,
    rating INTEGER NOT NULL, price_score INTEGER NOT NULL DEFAULT 0, service_score INTEGER NOT NULL DEFAULT 0, find_score INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '', guest_name TEXT NOT NULL DEFAULT '', guest_country TEXT NOT NULL DEFAULT '',
    reply TEXT NOT NULL DEFAULT '', replied_at TEXT, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_spot ON reviews(spot_id, hidden)`,

  `CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL, host_id INTEGER NOT NULL,
    kind TEXT NOT NULL, body TEXT NOT NULL, photos TEXT NOT NULL DEFAULT '[]', claim_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'received', host_reply TEXT NOT NULL DEFAULT '', host_reply_due TEXT, host_replied_at TEXT,
    verdict TEXT NOT NULL DEFAULT '', verdict_note TEXT NOT NULL DEFAULT '',
    comp_amount INTEGER NOT NULL DEFAULT 0, host_charge INTEGER NOT NULL DEFAULT 0, charge_settlement_id INTEGER,
    created_at TEXT NOT NULL, closed_at TEXT)`,

  `CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT NOT NULL DEFAULT 'guest', name TEXT NOT NULL, email TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT '', booking_code TEXT NOT NULL DEFAULT '', topic TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', reply TEXT NOT NULL DEFAULT '', replied_at TEXT, created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, host_id INTEGER NOT NULL, month TEXT NOT NULL,
    booking_count INTEGER NOT NULL, gross INTEGER NOT NULL, fee INTEGER NOT NULL, adjust INTEGER NOT NULL DEFAULT 0, payout INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready', hold_reason TEXT NOT NULL DEFAULT '', paid_at TEXT, created_at TEXT NOT NULL,
    UNIQUE (host_id, month))`,

  `CREATE TABLE IF NOT EXISTS status_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL, status TEXT NOT NULL,
    by_kind TEXT NOT NULL, by_id INTEGER, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_status_logs_booking ON status_logs(booking_id)`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, admin_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, to_kind TEXT NOT NULL, to_addr TEXT NOT NULL, channel TEXT NOT NULL,
    template TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL,
    booking_id INTEGER, created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS contents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, lang TEXT NOT NULL, title TEXT NOT NULL,
    body TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_contents_kind ON contents(kind, lang, published)`,

  `CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT NOT NULL, created_at TEXT NOT NULL)`,
];

// 이후 버전에서 컬럼을 더할 때 여기에 적습니다. 이미 있는 컬럼이면 조용히 건너뜁니다.
export const ALTERS = [];

// 처음 설치할 때 넣는 정책 기본값. 모두 Admin > 가격·수수료 정책에서 바꿀 수 있습니다.
export const DEFAULT_SETTINGS = {
  site_name: '백스톱',
  support_email: '',
  fee_a: 15, // 보관분 수수료율(%)
  fee_b: 8, // 추가분 수수료율(%)
  fee_c: 500, // 건당 최소 수수료(원)
  unit_s: 0.5,
  unit_m: 1,
  unit_l: 2,
  short_hours: 4, // '잠깐 맡기기' 기준 시간
  hold_min: 10, // 결제 대기 시간(분)
  approve_hours: 2, // 승인 후 확정 스팟의 승인 기한(시간)
  noshow_hours: 3, // 맡기는 시각 이후 이 시간이 지나면 노쇼
  overdue_grace_min: 30, // 찾는 시각 이후 이 시간까지는 초과 요금 없음
  incident_days: 7, // 찾기 완료 후 사고 접수 가능 기간(일)
  incident_reply_hours: 48, // 호스트 소명 기한(시간)
  review_days: 14, // 리뷰 작성 가능 기간(일)
  cover_basic_limit: 300000, // 기본 보장 한도(원)
  settle_min_payout: 10000, // 이 금액 미만은 다음 달로 이월
  settle_pay_day: 10, // 매달 지급일
  max_long_days: 60, // 오래 맡기기 최대 일수
  max_bags: 10, // 한 번에 맡길 수 있는 짐 개수
};

export const DEFAULT_ZONES = [
  {
    slug: 'hongdae',
    names: { ko: '홍대·연남', en: 'Hongdae · Yeonnam', ja: '弘大・延南', 'zh-hans': '弘大·延南', 'zh-hant': '弘大·延南' },
    lat: 37.5572, lng: 126.9245,
  },
  {
    slug: 'myeongdong',
    names: { ko: '명동·을지로', en: 'Myeongdong · Euljiro', ja: '明洞・乙支路', 'zh-hans': '明洞·乙支路', 'zh-hant': '明洞·乙支路' },
    lat: 37.5609, lng: 126.9863,
  },
  {
    slug: 'seongsu',
    names: { ko: '성수', en: 'Seongsu', ja: '聖水', 'zh-hans': '圣水', 'zh-hant': '聖水' },
    lat: 37.5446, lng: 127.0559,
  },
  {
    slug: 'seoul-station',
    names: { ko: '서울역·용산', en: 'Seoul Station · Yongsan', ja: 'ソウル駅・龍山', 'zh-hans': '首尔站·龙山', 'zh-hant': '首爾站·龍山' },
    lat: 37.5547, lng: 126.9707,
  },
];
export const DEFAULT_BASE = { s: 5200, m: 8600, l: 11900, floor: 60, cap: 150 };
