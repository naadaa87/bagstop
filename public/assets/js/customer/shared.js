// 고객 웹 공통: 언어, 주소 이동, 작은 컴포넌트
import { html, useState, useEffect, krw, minToHM } from '/assets/js/lib/core.js';

export const LANGS = ['ko', 'en', 'ja', 'zh-hans', 'zh-hant'];
export const LANG_NAME = { ko: '한국어', en: 'English', ja: '日本語', 'zh-hans': '简体中文', 'zh-hant': '繁體中文' };
export const S = { lang: 'en', dict: {}, config: null };

export function t(key, vars) {
  let s = S.dict[key];
  if (s == null) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : vars[k]));
  return s;
}
export const money = (n) => (S.lang === 'ko' ? `${Number(n || 0).toLocaleString('ko-KR')}원` : krw(n));

// ---------- 주소 이동 ----------
const listeners = new Set();
export function parseRoute() {
  const parts = location.pathname.split('/').filter(Boolean);
  return { lang: parts[0], path: parts.slice(1), query: new URLSearchParams(location.search) };
}
export function go(to, { replace = false } = {}) {
  const url = `/${S.lang}${to}`;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  listeners.forEach((fn) => fn());
  if (!replace) window.scrollTo(0, 0);
}
export function useRoute() {
  const [route, setRoute] = useState(parseRoute());
  useEffect(() => {
    const fn = () => setRoute(parseRoute());
    listeners.add(fn);
    window.addEventListener('popstate', fn);
    return () => {
      listeners.delete(fn);
      window.removeEventListener('popstate', fn);
    };
  }, []);
  return route;
}
export function Link({ to, children, ...rest }) {
  const onClick = (e) => {
    if (rest.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; // 새 창으로 여는 링크는 그대로 둡니다
    e.preventDefault();
    go(to);
  };
  return html`<a href="/${S.lang}${to}" onClick=${onClick} ...${rest}>${children}</a>`;
}

// ---------- 이름 붙이기 ----------
export const zoneName = (slug) => {
  const z = S.config?.zones.find((x) => x.slug === slug);
  return z ? z.names[S.lang] || z.names.en : '';
};
export const sizeName = (k) => t(`size_${k}`);
export const catName = (k) => t(`cat_${k}`);
export const hoursText = (ranges) => (ranges && ranges.length ? ranges.map(([a, b]) => `${minToHM(a)}–${minToHM(b)}`).join(', ') : t('closed_today'));

export function mapLinks(spot) {
  const q = encodeURIComponent(spot.address_ko || spot.address);
  return [
    ['Naver Map', `https://map.naver.com/p/search/${q}`],
    ['KakaoMap', `https://map.kakao.com/link/map/${encodeURIComponent(spot.name_ko || spot.name)},${spot.lat},${spot.lng}`],
    ['Google Maps', `https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lng}`],
  ];
}

// ---------- 스팟 사진(없으면 업종별 그림) ----------
const CAT_TINT = { cafe: '#FDEFE9', restaurant: '#FBF3E0', cvs: '#E9F4EF', shop: '#EAF1FA', stay: '#F3ECFA', home: '#F6F4F1', space: '#F6F4F1', etc: '#F6F4F1' };
const CAT_POSE = { cafe: 'coffee', restaurant: 'love', cvs: 'ok', shop: 'hi', stay: 'guard', home: 'hi', space: 'guard', etc: 'hi' };
export function SpotPhoto({ spot, src, cls = '' }) {
  const url = src || spot.photo;
  if (url) return html`<div class="spot-photo ${cls}"><img src=${url} alt=${spot.name} loading="lazy" /></div>`;
  return html`<div class="spot-photo ph ${cls}" style="background:${CAT_TINT[spot.category] || CAT_TINT.etc}">
    <img src="/assets/img/jimbo-${CAT_POSE[spot.category] || 'hi'}.svg" alt="" loading="lazy" />
  </div>`;
}

export function SpotCard({ spot, active, onHover }) {
  return html`<${Link} to="/spot/${spot.slug}" class="spot-card ${active ? 'on' : ''}" onMouseEnter=${() => onHover && onHover(spot.slug)}>
    <${SpotPhoto} spot=${spot} />
    <div class="spot-card-body">
      <div class="row gap4 fw">
        <span class="badge">${catName(spot.category)}</span>
        ${spot.open_now ? html`<span class="badge g">${t('open_now')}</span>` : null}
        ${spot.overnight ? html`<span class="badge b">${t('overnight_ok')}</span>` : null}
      </div>
      <h3>${spot.name}</h3>
      <p class="small sub">${zoneName(spot.zone)}${spot.reviews ? html` · <span class="b" style="color:var(--ink)">★ ${spot.rating}</span> (${spot.reviews})` : ''}</p>
      <p class="small sub">${t('today')} ${hoursText(spot.today)}</p>
      <div class="row between mt8">
        <span class="small sub">${t('day_price_from')}</span>
        <span class="price num">${money(spot.price_day)}</span>
      </div>
      ${spot.bundle &&
      html`<div class="set-line"><span class="b">${spot.bundle.name}</span><span class="num">${money(spot.bundle.price)}</span><span class="badge p">${t('save_n', { n: money(spot.bundle.save) })}</span></div>`}
    </div>
  <//>`;
}

// ---------- 내 예약(이 기기에 저장) ----------
const KEY = 'bagstop_bookings';
export function myBookings() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}
export function rememberBooking(code, token, extra = {}) {
  try {
    const list = myBookings().filter((b) => b.code !== code);
    list.unshift({ code, token, ...extra });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* 저장할 수 없는 환경이면 주소의 토큰으로만 확인합니다 */
  }
}

export function statusBadge(status) {
  const cls = { hold: 'a', pending: 'a', confirmed: 'p', stored: 'g', overdue: 'r', done: '', cancelled: '', noshow: 'r', expired: '' }[status] ?? '';
  return html`<span class="badge ${cls}">${t(`st_${status}`)}</span>`;
}

/** 서버 오류를 화면 언어로 바꿔 보여 줍니다. 사전에 없으면 한국어 화면에서만 서버 문구를 그대로 씁니다. */
export function errText(e) {
  const key = `err_${e?.code}`;
  if (S.dict[key]) return S.dict[key];
  return S.lang === 'ko' ? e?.message || t('err_generic') : t('err_generic');
}
