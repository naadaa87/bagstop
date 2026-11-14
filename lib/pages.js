// 고객 웹 페이지 응답: 언어별 주소(/ko, /en, /ja, /zh-hans, /zh-hant), 검색엔진용 제목·설명, 사이트맵
import { LANGS, safeJson } from './util.js';

const HTML_LANG = { ko: 'ko', en: 'en', ja: 'ja', 'zh-hans': 'zh-Hans', 'zh-hant': 'zh-Hant' };

const META = {
  ko: {
    home: ['백스톱 BagStop | 짐은 백스톱에 맡기고, 여행은 가볍게', '카페·식당·숙소 등 가까운 가게에 짐을 맡기세요. 시간과 자리를 미리 확인하고 1분 만에 예약할 수 있어요.'],
    spots: ['짐 맡길 곳 찾기 | 백스톱', '지도에서 가까운 백스톱 스팟을 찾고 가격과 남은 자리를 비교해 보세요.'],
    area: ['{zone} 짐 보관 | 백스톱', '{zone}에서 짐을 맡길 수 있는 가게를 모았어요. 커피나 식사를 묶은 세트로 더 저렴하게 맡길 수 있어요.'],
    spot: ['{name} 짐 보관 | 백스톱', '{name}에 짐을 맡기세요. 가격, 받는 시간, 세트 상품을 확인하고 바로 예약할 수 있어요.'],
    hosts: ['백스톱 호스트 되기 | 남는 공간으로 손님 맞이하기', '가게의 남는 자리에 짐을 맡아 주고, 메뉴와 묶은 세트로 새 손님을 만나 보세요. 가격과 받는 시간은 호스트가 직접 정해요.'],
    help: ['도움말 | 백스톱', '백스톱 이용 방법, 취소·환불, 보관 규정을 안내해요.'],
  },
  en: {
    home: ['BagStop | Luggage storage at local shops in Seoul', 'Leave your bags at cafes, restaurants and guesthouses near you. Check hours and space, then book in a minute.'],
    spots: ['Find luggage storage near you | BagStop', 'Find a Bag Stop near you on the map and compare prices and available space.'],
    area: ['Luggage storage in {zone} | BagStop', 'Shops in {zone} that will keep your bags. Save more with sets that bundle storage with a coffee or a meal.'],
    spot: ['Luggage storage at {name} | BagStop', 'Store your bags at {name}. See prices, hours and sets, and book right away.'],
    hosts: ['Become a BagStop host | BagStop', 'Keep travellers\' bags in your spare space and meet new customers with sets that bundle your menu. You set the price and hours.'],
    help: ['Help | BagStop', 'How BagStop works, cancellation and refunds, and storage rules.'],
  },
  ja: {
    home: ['BagStop | ソウルの荷物預かり — 手ぶらで韓国を楽しもう', '近くのカフェ・食堂・宿に荷物を預けられます。営業時間と空きを確認して、1分で予約。'],
    spots: ['近くの荷物預かりスポットを探す | BagStop', '地図でBagStopスポットを探して、料金と空き状況を比べましょう。'],
    area: ['{zone}の荷物預かり | BagStop', '{zone}で荷物を預けられるお店をまとめました。コーヒーや食事とのセットならさらにお得です。'],
    spot: ['{name}で荷物預かり | BagStop', '{name}に荷物を預けましょう。料金・受付時間・セットを確認して、すぐに予約できます。'],
    hosts: ['BagStopホストになる | BagStop', 'お店の空きスペースで荷物を預かり、メニューとのセットで新しいお客様に出会えます。'],
    help: ['ヘルプ | BagStop', 'BagStopの使い方、キャンセル・返金、お預かり規定のご案内です。'],
  },
  'zh-hans': {
    home: ['BagStop | 首尔行李寄存 — 轻松游韩国', '把行李寄存在附近的咖啡店、餐厅或住宿。先确认营业时间和空位，1分钟完成预订。'],
    spots: ['查找附近的行李寄存点 | BagStop', '在地图上查找 BagStop 寄存点，比较价格和空位。'],
    area: ['{zone}行李寄存 | BagStop', '汇总了{zone}可以寄存行李的店铺。选择含咖啡或餐点的套餐更划算。'],
    spot: ['在{name}寄存行李 | BagStop', '把行李寄存在{name}。查看价格、营业时间和套餐，立即预订。'],
    hosts: ['成为 BagStop 店家 | BagStop', '利用店内空余空间寄存行李，并通过与菜单搭配的套餐迎接新顾客。'],
    help: ['帮助 | BagStop', 'BagStop 使用方法、取消与退款、寄存规定。'],
  },
  'zh-hant': {
    home: ['BagStop | 首爾行李寄放 — 輕鬆遊韓國', '把行李寄放在附近的咖啡店、餐廳或住宿。先確認營業時間與空位，1分鐘完成預訂。'],
    spots: ['尋找附近的行李寄放點 | BagStop', '在地圖上尋找 BagStop 寄放點，比較價格與空位。'],
    area: ['{zone}行李寄放 | BagStop', '整理了{zone}可以寄放行李的店家。選擇含咖啡或餐點的套餐更划算。'],
    spot: ['在{name}寄放行李 | BagStop', '把行李寄放在{name}。查看價格、營業時間與套餐，立即預訂。'],
    hosts: ['成為 BagStop 店家 | BagStop', '利用店內空餘空間寄放行李，並透過與菜單搭配的套餐迎接新顧客。'],
    help: ['說明 | BagStop', 'BagStop 使用方式、取消與退款、寄放規定。'],
  },
};

const fill = (pair, vars) => pair.map((s) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] || ''));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function preferredLang(request) {
  const cookie = /(?:^|;\s*)bagstop_lang=([a-z-]+)/.exec(request.headers.get('cookie') || '');
  if (cookie && LANGS.includes(cookie[1])) return cookie[1];
  const al = (request.headers.get('accept-language') || '').toLowerCase();
  for (const part of al.split(',')) {
    const tag = part.split(';')[0].trim();
    if (tag.startsWith('ko')) return 'ko';
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('zh')) return /tw|hk|mo|hant/.test(tag) ? 'zh-hant' : 'zh-hans';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

async function pageMeta(env, lang, rest) {
  const m = META[lang];
  const [kind, slug] = rest;
  let meta = m.home, noindex = false, jsonld = null;
  try {
    if (kind === 'spots') meta = m.spots;
    else if (kind === 'hosts') meta = m.hosts;
    else if (kind === 'help') meta = m.help;
    else if (kind === 'area' && slug && env.DB) {
      const z = await env.DB.prepare('SELECT names FROM zones WHERE slug=? AND active=1').bind(slug).first();
      if (z) meta = fill(m.area, { zone: safeJson(z.names, {})[lang] || safeJson(z.names, {}).en });
    } else if (kind === 'spot' && slug && env.DB) {
      const s = await env.DB.prepare("SELECT name, name_en, address, address_en, lat, lng, rating_avg, rating_count FROM spots WHERE slug=? AND status='live'").bind(slug).first();
      if (s) {
        const name = lang === 'ko' ? s.name : s.name_en || s.name;
        meta = fill(m.spot, { name });
        jsonld = {
          '@context': 'https://schema.org', '@type': 'LocalBusiness', name,
          address: lang === 'ko' ? s.address : s.address_en || s.address,
          geo: { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.lng },
        };
        if (s.rating_count > 0) jsonld.aggregateRating = { '@type': 'AggregateRating', ratingValue: s.rating_avg, reviewCount: s.rating_count };
      } else noindex = true;
    } else if (kind) noindex = true; // 예약 확인·결제 등 개인 화면
  } catch {
    /* DB 준비 전에는 기본 제목으로 */
  }
  return { title: meta[0], desc: meta[1], noindex, jsonld };
}

export async function handlePage({ request, env }) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const origin = (env.SITE_URL || url.origin).replace(/\/$/, '');

  if (url.pathname === '/sitemap.xml') return sitemap(env, origin);
  if (url.pathname === '/robots.txt') {
    return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /host/\nDisallow: /admin/\nSitemap: ${origin}/sitemap.xml\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (!parts.length) return Response.redirect(`${url.origin}/${preferredLang(request)}/${url.search}`, 302);
  if (!LANGS.includes(parts[0])) return env.ASSETS.fetch(request); // 정적 파일, /host, /admin

  const lang = parts[0];
  const rest = parts.slice(1);
  const shell = await env.ASSETS.fetch(new Request(`${url.origin}/`)); // 조건부 헤더(If-None-Match)는 넘기지 않습니다
  if (request.method !== 'GET') return shell;
  const meta = await pageMeta(env, lang, rest);
  const path = rest.length ? `/${rest.join('/')}` : '/';
  const alternates = LANGS.map((l) => `<link rel="alternate" hreflang="${HTML_LANG[l]}" href="${origin}/${l}${path}">`).join('') +
    `<link rel="alternate" hreflang="x-default" href="${origin}/en${path}">`;
  const extra = [
    `<link rel="canonical" href="${origin}/${lang}${path}">`, alternates,
    `<meta property="og:title" content="${esc(meta.title)}"><meta property="og:description" content="${esc(meta.desc)}">`,
    `<meta property="og:type" content="website"><meta property="og:url" content="${origin}/${lang}${path}"><meta property="og:image" content="${origin}/assets/img/og.png">`,
    meta.noindex ? '<meta name="robots" content="noindex">' : '',
    meta.jsonld ? `<script type="application/ld+json">${JSON.stringify(meta.jsonld).replace(/</g, '\\u003c')}</script>` : '',
  ].join('');
  const res = new HTMLRewriter()
    .on('html', { element: (el) => el.setAttribute('lang', HTML_LANG[lang]) })
    .on('title', { element: (el) => el.setInnerContent(meta.title) })
    .on('meta[name="description"]', { element: (el) => el.setAttribute('content', meta.desc) })
    .on('head', { element: (el) => el.append(extra, { html: true }) })
    .transform(shell);
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-cache');
  headers.append('set-cookie', `bagstop_lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`);
  return new Response(res.body, { status: 200, headers });
}

async function sitemap(env, origin) {
  const paths = ['/', '/spots', '/hosts', '/help'];
  try {
    if (env.DB) {
      const zones = await env.DB.prepare('SELECT slug FROM zones WHERE active=1').all();
      for (const z of zones.results || []) paths.push(`/area/${z.slug}`);
      const spots = await env.DB.prepare("SELECT s.slug FROM spots s JOIN hosts h ON h.id=s.host_id WHERE s.status='live' AND h.status='approved' LIMIT 5000").all();
      for (const s of spots.results || []) paths.push(`/spot/${s.slug}`);
    }
  } catch {
    /* DB 준비 전 */
  }
  const urls = paths
    .flatMap((p) => LANGS.map((l) => `<url><loc>${origin}/${l}${p}</loc>${LANGS.map((a) => `<xhtml:link rel="alternate" hreflang="${HTML_LANG[a]}" href="${origin}/${a}${p}"/>`).join('')}</url>`))
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`,
    { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } },
  );
}
