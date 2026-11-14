// 고객 웹 시작점: 언어 불러오기 → 화면 고르기
import { html, render, useState, useEffect, api, useLoad, Spinner, toast, useBusy } from '/assets/js/lib/core.js';
import { S, t, LANGS, LANG_NAME, Link, go, useRoute, parseRoute, zoneName, money, SpotCard, myBookings, rememberBooking, statusBadge } from './shared.js';
import { SpotsPage } from './spots.js';
import { SpotPage } from './spot.js';
import { CheckoutPage, BookingPage } from './booking.js';

function Header({ path }) {
  const [open, setOpen] = useState(false);
  const rest = `/${path.join('/')}${location.search}`;
  const nav = [['/spots', t('nav_find')], ['/my', t('nav_my')], ['/hosts', t('nav_host')], ['/help', t('nav_help')]];
  return html`<header class="hd">
    <div class="wrap hd-in">
      <${Link} to="/" class="logo" aria-label="BagStop"><img src="/favicon.svg" alt="" width="32" height="32" /><b class="wm">Bag<em>Stop</em></b><//>
      <nav class="hd-nav ${open ? 'open' : ''}" onClick=${() => setOpen(false)}>
        ${nav.map(([to, label]) => html`<${Link} to=${to} class=${`/${path[0] || ''}` === to ? 'on' : ''}>${label}<//>`)}
      </nav>
      <select class="lang" aria-label="Language" value=${S.lang} onChange=${(e) => (location.href = `/${e.target.value}${rest === '/' ? '/' : rest}`)}>
        ${LANGS.map((l) => html`<option value=${l}>${LANG_NAME[l]}</option>`)}
      </select>
      <button class="hd-menu" aria-label="Menu" onClick=${() => setOpen(!open)}><span></span><span></span><span></span></button>
    </div>
  </header>`;
}

function Footer() {
  return html`<footer class="ft">
    <div class="wrap ft-in">
      <div>
        <div class="logo"><img src="/favicon.svg" alt="" width="28" height="28" /><b class="wm">Bag<em>Stop</em></b>${S.lang === 'ko' ? html`<span class="small sub">백스톱</span>` : null}</div>
        <p class="small sub mt8">${t('slogan')}</p>
      </div>
      <div class="ft-links">
        <${Link} to="/help">${t('nav_help')}<//>
        <${Link} to="/help?tab=rules">${t('rules')}<//>
        <${Link} to="/help?tab=terms">${t('terms')}<//>
        <${Link} to="/help?tab=privacy">${t('privacy')}<//>
        <a href="/host/">${t('host_center')}</a>
      </div>
    </div>
    <div class="wrap"><p class="tiny mute">${t('ft_note')}${S.config?.support_email ? ` · ${S.config.support_email}` : ''}</p></div>
  </footer>`;
}

// ---------- 홈 ----------
function Home() {
  const zones = S.config.zones;
  const { data } = useLoad(() => api(`/public/spots?lang=${S.lang}`), []);
  const { data: faq } = useLoad(() => api(`/public/contents?kind=faq&lang=${S.lang}`), []);
  const spots = data?.spots || [];
  const sets = spots.filter((s) => s.bundle).slice(0, 3);
  return html`<main>
    <section class="hero">
      <div class="wrap hero-in">
        <div class="hero-copy">
          <p class="eyebrow">${t('hero_eyebrow')}</p>
          <h1>${t('hero_title_1')}<br /><em>${t('hero_title_2')}</em></h1>
          <p class="hero-sub">${t('hero_sub')}</p>
          <div class="hero-search">
            <p class="label">${t('where')}</p>
            <div class="row fw">
              ${zones.map((z) => html`<${Link} to="/area/${z.slug}" class="chip">${z.names[S.lang] || z.names.en}<//>`)}
            </div>
            <${Link} to="/spots" class="btn primary lg block mt16">${t('find_now')}<//>
          </div>
        </div>
        <div class="hero-art"><div class="blob"></div><img src="/assets/img/jimbo-hi.svg" alt="${t('mascot_alt')}" width="400" height="440" /><span class="bubble-say">${t('hero_bubble')}</span></div>
      </div>
    </section>

    <section class="sec">
      <div class="wrap">
        <h2>${t('how_title')}</h2>
        <ol class="steps">
          ${[1, 2, 3].map((n) => html`<li><span class="step-n">${n}</span><h3>${t(`how_${n}_t`)}</h3><p class="sub">${t(`how_${n}_d`)}</p></li>`)}
        </ol>
      </div>
    </section>

    <section class="sec tinted">
      <div class="wrap">
        <div class="sec-head">
          <div><h2>${t('set_title')}</h2><p class="sub mt8">${t('set_sub')}</p></div>
          <img src="/assets/img/jimbo-coffee.svg" alt="" width="110" height="121" class="sec-art" />
        </div>
        <div class="set-cards">
          ${sets.length
            ? sets.map((s) => html`<${Link} to="/spot/${s.slug}" class="set-card">
                <span class="badge p">${t('save_n', { n: money(s.bundle.save) })}</span>
                <h3>${s.bundle.name}</h3>
                <p class="small sub">${t('set_formula', { size: t(`size_${s.bundle.size}`), addon: s.bundle.addon.name })}</p>
                <div class="row mt12"><span class="strike num">${money(s.bundle.list)}</span><span class="price num">${money(s.bundle.price)}</span></div>
                <p class="small sub mt8">${s.name} · ${zoneName(s.zone)}</p>
              <//>`)
            : html`<div class="set-card"><h3>${t('set_example_t')}</h3><p class="small sub mt8">${t('set_example_d')}</p></div>`}
        </div>
      </div>
    </section>

    <section class="sec">
      <div class="wrap">
        <div class="row between"><h2>${t('areas_title')}</h2><${Link} to="/spots" class="more">${t('see_all')} →<//></div>
        <div class="area-grid">
          ${zones.map((z) => html`<${Link} to="/area/${z.slug}" class="area-card">
            <h3>${z.names[S.lang] || z.names.en}</h3>
            <p class="small sub">${t('n_spots', { n: z.spot_count })}</p>
          <//>`)}
        </div>
        ${spots.length ? html`<div class="spot-grid mt24">${spots.slice(0, 6).map((s) => html`<${SpotCard} spot=${s} key=${s.slug} />`)}</div>` : null}
      </div>
    </section>

    <section class="sec">
      <div class="wrap">
        <h2>${t('size_title')}</h2>
        <div class="size-grid">
          ${[['s', 'mini'], ['m', 'ok'], ['l', 'big']].map(([k, img]) => html`<div class="size-card">
            <img src="/assets/img/jimbo-${img}.svg" alt="" width="120" height="132" />
            <h3>${t(`size_${k}`)}</h3><p class="small sub">${t(`size_${k}_d`)}</p>
          </div>`)}
        </div>
      </div>
    </section>

    <section class="sec">
      <div class="wrap trust">
        <img src="/assets/img/jimbo-guard.svg" alt="" width="150" height="165" />
        <div>
          <h2>${t('trust_title')}</h2>
          <ul class="ticks">
            <li>${t('trust_1')}</li><li>${t('trust_2', { limit: money(S.config.policy.cover_basic_limit) })}</li><li>${t('trust_3')}</li><li>${t('trust_4')}</li>
          </ul>
        </div>
      </div>
    </section>

    ${faq?.items?.length
      ? html`<section class="sec"><div class="wrap narrow">
          <div class="row between"><h2>${t('faq_title')}</h2><${Link} to="/help" class="more">${t('see_all')} →<//></div>
          <div class="faq mt16">${faq.items.slice(0, 4).map((f) => html`<details><summary>${f.title}</summary><p class="pre">${f.body}</p></details>`)}</div>
        </div></section>`
      : null}

    <section class="sec">
      <div class="wrap">
        <div class="host-band">
          <div><h2>${t('host_band_t')}</h2><p class="mt8">${t('host_band_d')}</p></div>
          <${Link} to="/hosts" class="btn dark lg">${t('host_band_btn')}<//>
        </div>
      </div>
    </section>
  </main>`;
}

// ---------- 내 예약 ----------
function MyPage() {
  const [list] = useState(myBookings());
  const [form, setForm] = useState({ code: '', email: '' });
  const [busy, run] = useBusy();
  const lookup = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api('/public/lookup', { method: 'POST', body: form });
      rememberBooking(r.code, r.token);
      go(`/b/${r.code}?t=${r.token}`);
    });
  };
  return html`<main class="wrap narrow page">
    <h1>${t('my_title')}</h1>
    ${list.length
      ? html`<div class="col mt16">${list.map((b) => html`<${Link} to="/b/${b.code}?t=${b.token}" class="card row between">
          <div><p class="b">${b.spot || b.code}</p><p class="small sub num">${b.code}${b.when ? ` · ${b.when}` : ''}</p></div><span class="mute">→</span>
        <//>`)}</div>`
      : html`<p class="sub mt8">${t('my_empty')}</p>`}
    <form class="card mt24 col gap12" onSubmit=${lookup}>
      <h3>${t('lookup_title')}</h3>
      <p class="small sub">${t('lookup_sub')}</p>
      <div class="field"><label>${t('booking_no')}</label><input class="input" value=${form.code} onInput=${(e) => setForm({ ...form, code: e.target.value })} placeholder="BAG······" required /></div>
      <div class="field"><label>${t('email')}</label><input class="input" type="email" value=${form.email} onInput=${(e) => setForm({ ...form, email: e.target.value })} required /></div>
      <button class="btn primary" disabled=${busy}>${t('lookup_btn')}</button>
    </form>
  </main>`;
}

// ---------- 호스트 되기 ----------
function HostsPage() {
  const fee = S.config.policy.fee;
  const [v, setV] = useState({ bags: 6, price: 8000, days: 26, setRatio: 30, addon: 4500 });
  const set = (k) => (e) => setV({ ...v, [k]: Math.max(0, Number(e.target.value) || 0) });
  // 입력한 값으로만 계산합니다. 수수료 = max(보관분×a + 추가분×b, 건당 최소)
  const perBag = Math.max((v.price * fee.a) / 100, fee.c);
  const storage = v.bags * v.days * v.price;
  const feeStorage = v.bags * v.days * perBag;
  const setCount = Math.round((v.bags * v.days * v.setRatio) / 100);
  const addonSales = setCount * v.addon;
  const feeAddon = (addonSales * fee.b) / 100;
  const payout = Math.round(storage - feeStorage + addonSales - feeAddon);
  return html`<main>
    <section class="hero host-hero">
      <div class="wrap hero-in">
        <div class="hero-copy">
          <p class="eyebrow">${t('hosts_eyebrow')}</p>
          <h1>${t('hosts_title')}</h1>
          <p class="hero-sub">${t('hosts_sub')}</p>
          <div class="row fw mt24"><a href="/host/#/signup" class="btn primary lg">${t('hosts_cta')}</a><a href="/host/" class="btn line lg">${t('host_center')}</a></div>
        </div>
        <div class="hero-art"><div class="blob"></div><img src="/assets/img/jimbo-love.svg" alt="" width="400" height="440" /></div>
      </div>
    </section>
    <section class="sec"><div class="wrap">
      <h2>${t('hosts_why')}</h2>
      <div class="why-grid">${[1, 2, 3, 4].map((n) => html`<div class="card"><span class="step-n">${n}</span><h3 class="mt12">${t(`hosts_why_${n}_t`)}</h3><p class="sub mt8">${t(`hosts_why_${n}_d`)}</p></div>`)}</div>
    </div></section>
    <section class="sec tinted"><div class="wrap">
      <h2>${t('calc_title')}</h2><p class="sub mt8">${t('calc_sub')}</p>
      <div class="calc">
        <div class="card col gap12">
          <div class="field"><label>${t('calc_bags')}</label><input class="input num" type="number" min="0" value=${v.bags} onInput=${set('bags')} /></div>
          <div class="field"><label>${t('calc_price')}</label><input class="input num" type="number" min="0" step="100" value=${v.price} onInput=${set('price')} /></div>
          <div class="field"><label>${t('calc_days')}</label><input class="input num" type="number" min="0" max="31" value=${v.days} onInput=${set('days')} /></div>
          <div class="field"><label>${t('calc_set_ratio')}</label><input class="input num" type="number" min="0" max="100" value=${v.setRatio} onInput=${set('setRatio')} /></div>
          <div class="field"><label>${t('calc_addon')}</label><input class="input num" type="number" min="0" step="100" value=${v.addon} onInput=${set('addon')} /></div>
        </div>
        <div class="card calc-out">
          <p class="label">${t('calc_result')}</p>
          <p class="calc-num num">${money(payout)}</p>
          <div class="hr"></div>
          <div class="kv"><span>${t('calc_storage')}</span><span class="num">${money(storage)}</span></div>
          <div class="kv"><span>${t('calc_addon_sales')}</span><span class="num">${money(addonSales)}</span></div>
          <div class="kv"><span>${t('calc_fee')}</span><span class="num">− ${money(Math.round(feeStorage + feeAddon))}</span></div>
          <p class="tiny mute mt12">${t('calc_note', { a: fee.a, b: fee.b, c: money(fee.c) })}</p>
        </div>
      </div>
    </div></section>
    <section class="sec"><div class="wrap narrow">
      <h2>${t('hosts_steps')}</h2>
      <ol class="vsteps">${[1, 2, 3, 4].map((n) => html`<li><span class="step-n">${n}</span><div><h3>${t(`hosts_step_${n}_t`)}</h3><p class="sub">${t(`hosts_step_${n}_d`)}</p></div></li>`)}</ol>
      <a href="/host/#/signup" class="btn primary lg block mt24">${t('hosts_cta')}</a>
    </div></section>
  </main>`;
}

// ---------- 도움말 ----------
function HelpPage({ query }) {
  const tabs = [['faq', t('faq_title')], ['rules', t('rules')], ['terms', t('terms')], ['privacy', t('privacy')], ['ask', t('ask')]];
  const tab = tabs.some((x) => x[0] === query.get('tab')) ? query.get('tab') : 'faq';
  const { data, loading } = useLoad(() => (tab === 'ask' ? Promise.resolve(null) : api(`/public/contents?kind=${tab}&lang=${S.lang}`)), [tab]);
  const [form, setForm] = useState({ name: '', email: '', booking_code: '', body: '' });
  const [busy, run] = useBusy();
  const [sent, setSent] = useState(false);
  const send = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/public/inquiries', { method: 'POST', body: { ...form, lang: S.lang } });
      setSent(true);
    });
  };
  const f = (k) => ({ value: form[k], onInput: (e) => setForm({ ...form, [k]: e.target.value }) });
  return html`<main class="wrap narrow page">
    <h1>${t('nav_help')}</h1>
    <div class="tabs mt16">${tabs.map(([k, label]) => html`<${Link} to="/help?tab=${k}" class="tab ${tab === k ? 'on' : ''}">${label}<//>`)}</div>
    <div class="mt16">
      ${tab === 'ask'
        ? sent
          ? html`<div class="empty"><img src="/assets/img/jimbo-ok.svg" alt="" /><p class="b">${t('ask_sent')}</p></div>`
          : html`<form class="col gap12" onSubmit=${send}>
              <div class="form-grid">
                <div class="field"><label>${t('name')}</label><input class="input" ...${f('name')} required /></div>
                <div class="field"><label>${t('email')}</label><input class="input" type="email" ...${f('email')} required /></div>
              </div>
              <div class="field"><label>${t('booking_no')} (${t('optional')})</label><input class="input" ...${f('booking_code')} /></div>
              <div class="field"><label>${t('ask_body')}</label><textarea class="textarea" ...${f('body')} required></textarea></div>
              <button class="btn primary" disabled=${busy}>${t('ask_send')}</button>
            </form>`
        : loading
          ? html`<${Spinner} />`
          : tab === 'faq'
            ? html`<div class="faq">${(data?.items || []).map((x) => html`<details><summary>${x.title}</summary><p class="pre">${x.body}</p></details>`)}</div>`
            : (data?.items || []).map((x) => html`<article class="doc"><h2>${x.title}</h2><p class="pre mt12">${x.body}</p></article>`)}
    </div>
  </main>`;
}

function NotFound() {
  return html`<main class="wrap page"><div class="empty"><img src="/assets/img/jimbo-sorry.svg" alt="" /><h2>${t('nf_title')}</h2><p class="mt8">${t('nf_sub')}</p><${Link} to="/" class="btn primary mt16">${t('go_home')}<//></div></main>`;
}

function App() {
  const { path, query } = useRoute();
  const [seg, arg] = path;
  let page;
  if (!seg) page = html`<${Home} />`;
  else if (seg === 'spots') page = html`<${SpotsPage} query=${query} />`;
  else if (seg === 'area' && arg) page = html`<${SpotsPage} query=${query} zone=${arg} key=${arg} />`;
  else if (seg === 'spot' && arg) page = html`<${SpotPage} slug=${arg} key=${arg} />`;
  else if (seg === 'checkout') page = html`<${CheckoutPage} />`;
  else if (seg === 'b' && arg) page = html`<${BookingPage} code=${arg} token=${query.get('t') || ''} query=${query} key=${arg} />`;
  else if (seg === 'my') page = html`<${MyPage} />`;
  else if (seg === 'hosts') page = html`<${HostsPage} />`;
  else if (seg === 'help') page = html`<${HelpPage} query=${query} />`;
  else page = html`<${NotFound} />`;
  const bare = seg === 'spots' || seg === 'area';
  return html`<${Header} path=${path} />${page}${bare ? null : html`<${Footer} />`}`;
}

async function start() {
  const root = document.getElementById('app');
  const { lang } = parseRoute();
  S.lang = LANGS.includes(lang) ? lang : 'en';
  try {
    const [dict, config] = await Promise.all([import(`./i18n/${S.lang}.js`), api('/public/config')]);
    S.dict = dict.default;
    S.config = config;
    render(html`<${App} />`, root);
  } catch (e) {
    // 설치 전(DB 준비 전)이거나 연결이 끊긴 경우
    root.innerHTML = `<div class="empty" style="padding-top:18vh"><img src="/assets/img/jimbo-sorry.svg" alt=""><h2>BagStop is getting ready</h2><p class="mt8">${
      e.code === 'db_not_ready' || e.code === 'db_not_bound' ? '서비스 준비 중이에요. 운영자는 <a href="/admin/" style="text-decoration:underline">/admin</a>에서 설치를 마쳐 주세요.' : 'Please check your connection and try again.'
    }</p></div>`;
  }
}
start();
export { toast };
