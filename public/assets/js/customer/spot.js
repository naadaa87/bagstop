// 스팟 상세 + 예약 위젯(상품·짐·시간 고르기 → 견적)
import { html, useState, useEffect, useRef, api, useLoad, Spinner, Stepper, Stars, minToHM, weekdayName, kstNow, addDays, isoToLocal, copyText } from '/assets/js/lib/core.js';
import { S, t, go, zoneName, money, catName, sizeName, mapLinks, SpotPhoto, hoursText, errText } from './shared.js';
import { loadLeaflet, TILE, TILE_ATTR } from './spots.js';

const SIZES = ['s', 'm', 'l'];

function MiniMap({ lat, lng }) {
  const box = useRef(null);
  useEffect(() => {
    let map;
    loadLeaflet().then(() => {
      if (!box.current) return;
      const L = window.L;
      map = L.map(box.current, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false }).setView([lat, lng], 16);
      L.tileLayer(TILE, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
      L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [0, 0] }) }).addTo(map);
    });
    return () => map && map.remove();
  }, [lat, lng]);
  return html`<div class="minimap" ref=${box}></div>`;
}

/** 날짜별 맡기기·찾기 가능 시각(30분 단위) */
function slotOptions(avail, kind, date) {
  if (!avail || avail.closed) return [];
  const now = kstNow();
  const out = [];
  for (const b of avail.blocks) {
    if (kind === 'drop' ? !b.allow_drop : !b.allow_pick) continue;
    const last = kind === 'drop' ? b.end_min - 30 : b.end_min;
    for (let m = b.start_min; m <= last; m += 30) {
      if (date === now.date && m < now.min - (kind === 'drop' ? 29 : 0)) continue;
      if (m < 1440 && !out.includes(m)) out.push(m);
    }
  }
  return out.sort((a, b) => a - b);
}

function BookingWidget({ d }) {
  const { spot, prices, bundles } = d;
  const today = kstNow().date;
  const maxDate = addDays(today, 60);
  const [product, setProduct] = useState('storage'); // 'storage' 또는 세트 id
  const [bags, setBags] = useState({ s: 0, m: prices.m ? 1 : 0, l: 0 });
  const [setQty, setSetQty] = useState(1);
  const [dropDate, setDropDate] = useState(today);
  const [pickDate, setPickDate] = useState(today);
  const [dropMin, setDropMin] = useState(null);
  const [pickMin, setPickMin] = useState(null);
  const [avail, setAvail] = useState({});
  const [quote, setQuote] = useState({ loading: false });
  const bundle = product === 'storage' ? null : bundles.find((b) => b.id === product);

  // 날짜별 가능 시간 불러오기
  useEffect(() => {
    for (const date of [dropDate, pickDate]) {
      if (avail[date]) continue;
      api(`/public/spots/${spot.slug}/availability?date=${date}`).then((r) => setAvail((a) => ({ ...a, [date]: r }))).catch(() => {});
    }
  }, [dropDate, pickDate]);

  const dropOpts = slotOptions(avail[dropDate], 'drop', dropDate);
  const pickOpts = slotOptions(avail[pickDate], 'pick', pickDate).filter((m) => pickDate !== dropDate || dropMin == null || m >= dropMin + 30);

  // 기본값: 오늘 맡길 수 있는 시간이 없으면 내일로, 찾는 시각은 3시간 뒤 근처로
  useEffect(() => {
    if (!avail[dropDate]) return;
    if (!dropOpts.length) {
      if (dropDate === today && dropMin == null) {
        setDropDate(addDays(today, 1));
        setPickDate(addDays(today, 1));
      }
      return;
    }
    if (dropMin == null || !dropOpts.includes(dropMin)) setDropMin(dropOpts[0]);
  }, [avail[dropDate], dropDate]);
  useEffect(() => {
    if (!avail[pickDate] || dropMin == null) return;
    if (pickDate < dropDate) return setPickDate(dropDate);
    if (!pickOpts.length) return setPickMin(null);
    if (pickMin == null || !pickOpts.includes(pickMin)) setPickMin(pickOpts.find((m) => pickDate !== dropDate || m >= dropMin + 180) ?? pickOpts[pickOpts.length - 1]);
  }, [avail[pickDate], pickDate, dropDate, dropMin]);

  const count = bags.s + bags.m + bags.l + (bundle ? setQty : 0);
  const body = dropMin != null && pickMin != null && count > 0
    ? { bags, bundle_id: bundle ? bundle.id : undefined, bundle_qty: bundle ? setQty : undefined, drop: `${dropDate}T${minToHM(dropMin)}`, pick: `${pickDate}T${minToHM(pickMin)}` }
    : null;
  const bodyKey = JSON.stringify(body);
  useEffect(() => {
    if (!body) return setQuote({ loading: false });
    setQuote((q) => ({ ...q, loading: true }));
    const timer = setTimeout(() => {
      api(`/public/spots/${spot.slug}/quote`, { method: 'POST', body })
        .then((r) => setQuote({ loading: false, q: r.quote }))
        .catch((e) => setQuote({ loading: false, error: errText(e) }));
    }, 250);
    return () => clearTimeout(timer);
  }, [bodyKey]);

  const pickProduct = (p) => {
    setProduct(p);
    if (p !== 'storage') setBags({ s: 0, m: 0, l: 0 });
    else if (bags.s + bags.m + bags.l === 0) setBags({ s: 0, m: prices.m ? 1 : 0, l: 0, ...(prices.m ? {} : { [Object.keys(prices)[0]]: 1 }) });
  };
  const book = () => {
    sessionStorage.setItem('bagstop_draft', JSON.stringify({ slug: spot.slug, spot: { name: spot.name, address: spot.address, instant: spot.instant }, body, quote: quote.q, bundle: bundle ? { name: bundle.name, prepared: bundle.addon.prepared } : null, cancel_deadline_h: spot.cancel_deadline_h }));
    go('/checkout');
  };
  const dateField = (label, value, onChange, min) => html`<div class="field grow"><label>${label}</label>
    <input class="input" type="date" value=${value} min=${min} max=${maxDate} onChange=${(e) => e.target.value && onChange(e.target.value)} /></div>`;
  const timeField = (label, value, onChange, opts, loading) => html`<div class="field grow"><label>${label}</label>
    <select class="select" value=${value ?? ''} onChange=${(e) => onChange(Number(e.target.value))} disabled=${!opts.length}>
      ${opts.length ? opts.map((m) => html`<option value=${m}>${minToHM(m)}</option>`) : html`<option value="">${loading ? '…' : t('no_time')}</option>`}
    </select></div>`;

  return html`<div class="widget" id="book">
    <h2>${t('w_title')}</h2>
    <div class="col gap8 mt12">
      <label class="prod ${product === 'storage' ? 'on' : ''}">
        <input type="radio" name="prod" checked=${product === 'storage'} onChange=${() => pickProduct('storage')} />
        <div class="grow"><p class="b">${t('p_storage')}</p><p class="small sub">${t('p_storage_d')}</p></div>
      </label>
      ${bundles.map((b) => html`<label class="prod ${product === b.id ? 'on' : ''}" key=${b.id}>
        <input type="radio" name="prod" checked=${product === b.id} onChange=${() => pickProduct(b.id)} />
        <div class="grow">
          <div class="row gap4 fw"><p class="b">${b.name}</p><span class="badge p">${t('save_n', { n: money(b.save) })}</span></div>
          <p class="small sub">${t('set_formula', { size: sizeName(b.size), addon: `${b.addon.name}${b.addon.qty > 1 ? ` ×${b.addon.qty}` : ''}` })} · ${t(`per_${b.period}`)}</p>
        </div>
        <div class="right"><p class="strike small num">${money(b.list)}</p><p class="b num">${money(b.price)}</p></div>
      </label>`)}
    </div>

    <div class="col gap8 mt16">
      ${bundle && html`<div class="row between"><div><p class="b">${bundle.name}</p><p class="small sub">${t('set_qty_d', { size: sizeName(bundle.size) })}</p></div><${Stepper} value=${setQty} min=${1} max=${S.config.policy.max_bags} onChange=${setSetQty} /></div>`}
      ${bundle && html`<p class="label mt8">${t('extra_bags')}</p>`}
      ${SIZES.filter((k) => prices[k]).map((k) => html`<div class="row between" key=${k}>
        <div><p class="b">${sizeName(k)}</p><p class="small sub">${t(`size_${k}_d`)}</p></div>
        <${Stepper} value=${bags[k]} max=${S.config.policy.max_bags} onChange=${(v) => setBags({ ...bags, [k]: v })} />
      </div>`)}
    </div>

    <div class="row gap8 mt16">${dateField(t('drop_date'), dropDate, (v) => { setDropDate(v); if (pickDate < v || pickDate === dropDate) setPickDate(v); }, today)}${timeField(t('drop_time'), dropMin, setDropMin, dropOpts, !avail[dropDate])}</div>
    <div class="row gap8 mt8">${dateField(t('pick_date'), pickDate, setPickDate, dropDate)}${timeField(t('pick_time'), pickMin, setPickMin, pickOpts, !avail[pickDate])}</div>
    ${avail[dropDate]?.closed ? html`<p class="err mt8">${t('closed_day')}</p>` : null}

    <div class="quote mt16">
      ${quote.error
        ? html`<p class="err">${quote.error}</p>`
        : quote.q
          ? html`<div class="${quote.loading ? 'dim' : ''}">
              <p class="small sub">${t(`plan_${quote.q.plan}`, { n: quote.q.days, h: S.config.policy.short_hours })}</p>
              ${quote.q.lines.map((l) => html`<div class="kv"><span>${l.type === 'bundle' ? (S.lang === 'ko' ? l.name : l.name_en || l.name) : sizeName(l.size)} × ${l.qty}</span><span class="num">${money(l.amount)}</span></div>`)}
              ${quote.q.save > 0 ? html`<div class="kv"><span>${t('set_saving')}</span><span class="num" style="color:var(--p-d)">− ${money(quote.q.save)}</span></div>` : null}
              <div class="kv total"><span>${t('total')}</span><span class="num">${money(quote.q.total)}</span></div>
            </div>`
          : html`<p class="small sub">${count ? t('pick_times') : t('pick_bags')}</p>`}
    </div>
    <button class="btn primary lg block mt12" disabled=${!quote.q || quote.loading || !!quote.error} onClick=${book}>${t('book_btn')}</button>
    <p class="tiny mute center mt8">${spot.instant ? t('instant_note') : t('approve_note')}</p>
  </div>`;
}

export function SpotPage({ slug }) {
  const { data: d, loading, error } = useLoad(() => api(`/public/spots/${slug}?lang=${S.lang}`), [slug]);
  if (loading) return html`<main class="wrap page"><${Spinner} /></main>`;
  if (error) return html`<main class="wrap page"><div class="empty"><img src="/assets/img/jimbo-sorry.svg" alt="" /><p class="b">${errText(error)}</p><button class="btn line mt16" onClick=${() => go('/spots')}>${t('spots_h1')}</button></div></main>`;
  const { spot, prices, bundles, benefits, blocks, reviews, scores } = d;
  const byDay = [1, 2, 3, 4, 5, 6, 0].map((w) => [w, blocks.filter((b) => b.weekday === w)]);
  const hasLong = Object.values(prices).some((p) => p.week || p.month);
  return html`<main class="wrap page spot">
    <div class="spot-main">
      <div class="gallery">
        ${spot.photos.length ? spot.photos.map((src) => html`<${SpotPhoto} spot=${spot} src=${src} cls="big" />`) : html`<${SpotPhoto} spot=${spot} cls="big" />`}
      </div>
      <div class="row gap4 fw mt16">
        <span class="badge">${catName(spot.category)}</span>
        <span class="badge ${spot.instant ? 'g' : 'a'}">${spot.instant ? t('instant') : t('needs_approval')}</span>
        ${spot.overnight ? html`<span class="badge b">${t('overnight_ok')}</span>` : null}
        ${spot.open_now ? html`<span class="badge g">${t('open_now')}</span>` : null}
      </div>
      <h1 class="mt8">${spot.name}</h1>
      <p class="sub mt4">${zoneName(spot.zone)}${spot.reviews ? html` · <${Stars} value=${spot.rating} /> <b style="color:var(--ink)">${spot.rating}</b> (${spot.reviews})` : ''}</p>
      ${spot.intro ? html`<p class="mt12 pre">${spot.intro}</p>` : null}

      ${benefits.length ? html`<div class="note p mt16"><p class="b">${t('benefit_title')}</p><ul class="dots mt4">${benefits.map((b) => html`<li>${b}</li>`)}</ul></div>` : null}

      <section class="blk">
        <h2>${t('price_title')}</h2>
        <div class="table-scroll"><table class="ptable mt12">
          <thead><tr><th></th><th>${t('per_short_h', { h: S.config.policy.short_hours })}</th><th>${t('per_day')}</th>${hasLong ? html`<th>${t('per_week')}</th><th>${t('per_month')}</th>` : null}</tr></thead>
          <tbody>${SIZES.filter((k) => prices[k]).map((k) => html`<tr><th>${sizeName(k)}<span class="tiny mute">${t(`size_${k}_d`)}</span></th>
            <td class="num">${money(prices[k].short)}</td><td class="num">${money(prices[k].day)}</td>
            ${hasLong ? html`<td class="num">${prices[k].week ? money(prices[k].week) : '–'}</td><td class="num">${prices[k].month ? money(prices[k].month) : '–'}</td>` : null}</tr>`)}</tbody>
        </table></div>
        <p class="tiny mute mt8">${t('price_note', { g: S.config.policy.overdue_grace_min })}</p>
      </section>

      ${bundles.length ? html`<section class="blk">
        <h2>${t('set_title_spot')}</h2>
        <div class="col gap8 mt12">${bundles.map((b) => html`<div class="card row between">
          <div><div class="row gap4 fw"><h3>${b.name}</h3><span class="badge p">${t('save_n', { n: money(b.save) })}</span></div>
            <p class="small sub mt4">${t('set_formula', { size: sizeName(b.size), addon: `${b.addon.name}${b.addon.qty > 1 ? ` ×${b.addon.qty}` : ''}` })} · ${t(`per_${b.period}`)}</p>
            ${b.addon.prepared && spot.cancel_deadline_h ? html`<p class="tiny mute mt4">${t('prepared_note', { h: spot.cancel_deadline_h })}</p>` : null}</div>
          <div class="right"><p class="strike small num">${money(b.list)}</p><p class="price num">${money(b.price)}</p></div>
        </div>`)}</div>
      </section>` : null}

      <section class="blk">
        <h2>${t('hours_title')}</h2>
        <div class="hours mt12">${byDay.map(([w, bs]) => html`<div class="kv"><span>${weekdayName(w, S.lang)}</span><span class="num">${bs.length
          ? bs.map((b) => `${minToHM(b.start_min)}–${minToHM(b.end_min)}${!b.drop ? ` (${t('pick_only')})` : !b.pick ? ` (${t('drop_only')})` : ''}`).join(', ')
          : t('closed')}</span></div>`)}</div>
        <p class="tiny mute mt8">${t('today')}: ${hoursText(spot.today)}</p>
      </section>

      <section class="blk">
        <h2>${t('loc_title')}</h2>
        <${MiniMap} lat=${spot.lat} lng=${spot.lng} />
        ${spot.approx ? html`<div class="note mt12">${t('approx_loc')}</div>` : html`<p class="mt12 b">${spot.address} ${spot.address_detail}</p>
        ${S.lang !== 'ko' ? html`<p class="small sub">${spot.address_ko} ${spot.address_detail}</p>` : null}
        <div class="row fw mt8">
          <button class="btn line sm" onClick=${() => copyText(`${spot.address_ko} ${spot.address_detail}`.trim(), t('copied'))}>${t('copy_addr')}</button>
          ${mapLinks(spot).map(([label, url]) => html`<a class="btn line sm" href=${url} target="_blank" rel="noopener">${label}</a>`)}
        </div>`}
        ${spot.guide ? html`<div class="note mt12"><p class="b" style="color:var(--ink)">${t('guide_title')}</p><p class="pre mt4">${spot.guide}</p></div>` : null}
      </section>

      <section class="blk">
        <h2>${t('rules')}</h2>
        <ul class="dots mt12 sub">
          <li>${t('rule_1')}</li><li>${t('rule_2')}</li><li>${t('rule_3', { g: S.config.policy.overdue_grace_min })}</li><li>${t('rule_4', { limit: money(S.config.policy.cover_basic_limit) })}</li>
        </ul>
        ${spot.rules ? html`<p class="pre small sub mt8">${spot.rules}</p>` : null}
      </section>

      <section class="blk">
        <h2>${t('reviews_title')} ${spot.reviews ? html`<span class="sub">(${spot.reviews})</span>` : ''}</h2>
        ${reviews.length
          ? html`${scores.price || scores.service || scores.find ? html`<div class="row fw gap16 mt8 small sub">
                ${[['price', scores.price], ['service', scores.service], ['find', scores.find]].filter((x) => x[1]).map(([k, v]) => html`<span>${t(`score_${k}`)} <b style="color:var(--ink)">${v}</b></span>`)}
              </div>` : null}
              <div class="col gap12 mt12">${reviews.map((r) => html`<div class="review">
                <div class="row between"><${Stars} value=${r.rating} /><span class="tiny mute">${r.guest_name}${r.guest_country ? ` · ${r.guest_country}` : ''} · ${isoToLocal(r.created_at).slice(0, 10)}</span></div>
                ${r.body ? html`<p class="mt4">${r.body}</p>` : null}
                ${r.reply ? html`<p class="reply small"><b>${t('host_reply')}</b> ${r.reply}</p>` : null}
              </div>`)}</div>`
          : html`<p class="sub mt8">${t('no_reviews')}</p>`}
      </section>
    </div>
    <aside class="spot-side"><${BookingWidget} d=${d} /></aside>
    <a href="#book" class="book-bar btn primary lg" onClick=${(e) => { e.preventDefault(); document.getElementById('book').scrollIntoView({ behavior: 'smooth' }); }}>${t('book_btn')}</a>
  </main>`;
}
