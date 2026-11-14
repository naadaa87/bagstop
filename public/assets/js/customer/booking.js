// 결제 화면과 예약 확인 화면(QR·번호표·메시지·시간 변경·취소·리뷰·사고 접수)
import { html, useState, useEffect, useRef, api, useLoad, Spinner, Modal, QR, StarPick, PhotoPicker, useBusy, toast, minToHM, fmtLocal, kstNow, addDays, copyText, loadScript, isoToLocal } from '/assets/js/lib/core.js';
import { S, t, go, Link, money, sizeName, mapLinks, rememberBooking, statusBadge, errText } from './shared.js';

const COUNTRIES = ['KR', 'US', 'JP', 'CN', 'TW', 'HK', 'SG', 'TH', 'VN', 'MY', 'ID', 'PH', 'AU', 'CA', 'GB', 'FR', 'DE', 'ES', 'IT', 'Other'];

// ---------- 결제 창 ----------
// 테스트 결제(실제 청구 없음)와 포트원 결제를 같은 모양으로 다룹니다. 끝나면 onPaid(paymentId)
export function PayModal({ payment, customer, redirectUrl, onPaid, onClose }) {
  const [busy, run] = useBusy();
  const [error, setError] = useState('');
  const portone = async () => {
    await loadScript('https://cdn.portone.io/v2/browser-sdk.js');
    const res = await window.PortOne.requestPayment({
      storeId: payment.storeId, channelKey: payment.channelKey, paymentId: payment.paymentId, orderName: payment.orderName,
      totalAmount: payment.amount, currency: 'CURRENCY_KRW', payMethod: 'CARD', redirectUrl,
      customer: { fullName: customer?.name, email: customer?.email, phoneNumber: customer?.phone || undefined },
    });
    if (res?.code) throw new Error(res.message || t('err_pay'));
    await onPaid(payment.paymentId);
  };
  const pay = () => run(async () => {
    setError('');
    try {
      if (payment.mode === 'portone') await portone();
      else await onPaid(payment.paymentId);
    } catch (e) {
      setError(errText(e));
    }
  });
  return html`<${Modal} title=${t('pay_title')} onClose=${busy ? null : onClose}>
    <div class="kv total"><span>${t('pay_amount')}</span><span class="num">${money(payment.amount)}</span></div>
    ${payment.mode === 'test' ? html`<div class="note a mt12">${t('pay_test_note')}</div>` : html`<p class="small sub mt12">${t('pay_card_note')}</p>`}
    ${error ? html`<p class="err mt8">${error}</p>` : null}
    <button class="btn primary lg block mt16" disabled=${busy} onClick=${pay}>${busy ? t('processing') : payment.mode === 'test' ? t('pay_test_btn') : t('pay_btn', { amount: money(payment.amount) })}</button>
  <//>`;
}

function Summary({ spotName, drop, pick, lines, total, plan, days }) {
  return html`<div class="card">
    <h3>${spotName}</h3>
    <div class="kv mt8"><span>${t('drop_time')}</span><span>${fmtLocal(drop, S.lang)}</span></div>
    <div class="kv"><span>${t('pick_time')}</span><span>${fmtLocal(pick, S.lang)}</span></div>
    <div class="hr"></div>
    ${plan ? html`<p class="small sub">${t(`plan_${plan}`, { n: days, h: S.config.policy.short_hours })}</p>` : null}
    ${lines.map((l) => html`<div class="kv"><span>${l.type === 'bundle' ? (S.lang === 'ko' ? l.name : l.name_en || l.name) : sizeName(l.size)} × ${l.qty}</span><span class="num">${money(l.amount)}</span></div>`)}
    <div class="kv total"><span>${t('total')}</span><span class="num">${money(total)}</span></div>
  </div>`;
}

// ---------- 결제 화면 ----------
export function CheckoutPage() {
  const draft = useRef(null);
  if (!draft.current) {
    try {
      draft.current = JSON.parse(sessionStorage.getItem('bagstop_draft') || 'null');
    } catch {
      draft.current = null;
    }
  }
  const d = draft.current;
  const [guest, setGuest] = useState({ name: '', email: '', phone: '', country: '' });
  const [agree, setAgree] = useState(false);
  const [busy, run] = useBusy();
  const [error, setError] = useState('');
  const [pay, setPay] = useState(null);
  useEffect(() => { if (!d) go('/spots', { replace: true }); }, []);
  if (!d) return null;
  const g = (k) => ({ value: guest[k], onInput: (e) => setGuest({ ...guest, [k]: e.target.value }) });
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      setError('');
      try {
        const r = await api(`/public/spots/${d.slug}/bookings`, { method: 'POST', body: { ...d.body, guest, lang: S.lang, agree } });
        rememberBooking(r.code, r.token, { spot: d.spot.name, when: fmtLocal(d.body.drop, S.lang) });
        setPay(r);
      } catch (err) {
        setError(errText(err));
      }
    });
  };
  const onPaid = async (paymentId) => {
    await api(`/public/bookings/${pay.code}/pay`, { method: 'POST', body: { token: pay.token, paymentId } });
    sessionStorage.removeItem('bagstop_draft');
    go(`/b/${pay.code}?t=${pay.token}`, { replace: true });
  };
  return html`<main class="wrap narrow page">
    <button class="btn ghost sm" onClick=${() => history.back()}>← ${t('back')}</button>
    <h1 class="mt8">${t('co_title')}</h1>
    <div class="mt16"><${Summary} spotName=${d.spot.name} drop=${d.body.drop} pick=${d.body.pick} lines=${d.quote.lines} total=${d.quote.total} plan=${d.quote.plan} days=${d.quote.days} /></div>
    <form class="col gap12 mt24" onSubmit=${submit}>
      <h2>${t('co_guest')}</h2>
      <div class="form-grid">
        <div class="field"><label>${t('name')}</label><input class="input" ...${g('name')} autocomplete="name" required /></div>
        <div class="field"><label>${t('email')}</label><input class="input" type="email" ...${g('email')} autocomplete="email" required /></div>
        <div class="field"><label>${t('phone')} (${t('optional')})</label><input class="input" type="tel" ...${g('phone')} autocomplete="tel" /></div>
        <div class="field"><label>${t('country')} (${t('optional')})</label>
          <select class="select" value=${guest.country} onChange=${(e) => setGuest({ ...guest, country: e.target.value })}><option value="">–</option>${COUNTRIES.map((c) => html`<option>${c}</option>`)}</select></div>
      </div>
      <p class="hint">${t('co_email_hint')}</p>
      <div class="note">
        <ul class="dots small">
          <li>${t('co_rule_cancel')}</li>
          ${d.bundle?.prepared && d.cancel_deadline_h ? html`<li>${t('prepared_note', { h: d.cancel_deadline_h })}</li>` : null}
          <li>${t('rule_3', { g: S.config.policy.overdue_grace_min })}</li>
          <li>${t('co_rule_noshow', { h: S.config.policy.noshow_hours })}</li>
        </ul>
      </div>
      <label class="check"><input type="checkbox" checked=${agree} onChange=${(e) => setAgree(e.target.checked)} />
        <span>${t('co_agree_1')} <${Link} to="/help?tab=terms" target="_blank" style="text-decoration:underline">${t('terms')}<//> · <${Link} to="/help?tab=rules" target="_blank" style="text-decoration:underline">${t('rules')}<//> · <${Link} to="/help?tab=privacy" target="_blank" style="text-decoration:underline">${t('privacy')}<//></span></label>
      ${error ? html`<p class="err">${error}</p>` : null}
      <button class="btn primary lg" disabled=${busy || !agree}>${t('pay_btn', { amount: money(d.quote.total) })}</button>
      <p class="tiny mute center">${d.spot.instant ? t('instant_note') : t('approve_note')}</p>
    </form>
    ${pay && html`<${PayModal} payment=${pay.payment} customer=${guest} redirectUrl=${`${location.origin}/${S.lang}/b/${pay.code}?t=${pay.token}`} onPaid=${onPaid}
      onClose=${() => { setPay(null); go(`/b/${pay.code}?t=${pay.token}`); }} />`}
  </main>`;
}

// ---------- 예약 확인 화면 ----------
const POSE = { hold: 'hi', pending: 'hi', confirmed: 'ok', stored: 'guard', overdue: 'sorry', done: 'love', cancelled: 'sorry', noshow: 'sorry', expired: 'sorry' };
const PHRASES = ['ph_drop', 'ph_pick', 'ph_where', 'ph_late', 'ph_set', 'ph_thanks'];
const PHRASE_KO = {
  ph_drop: '백스톱으로 예약했어요. 짐을 맡기러 왔어요.', ph_pick: '맡긴 짐을 찾으러 왔어요.', ph_where: '짐을 어디에 두면 될까요?',
  ph_late: '조금 늦을 것 같아요. 기다려 주실 수 있나요?', ph_set: '세트로 예약했어요. 지금 받을 수 있나요?', ph_thanks: '감사합니다. 잘 이용했어요!',
};

function ExtendModal({ b, slug, onClose, onDone }) {
  const [date, setDate] = useState(b.pick.slice(0, 10));
  const [min, setMin] = useState(null);
  const [avail, setAvail] = useState(null);
  const [pv, setPv] = useState(null);
  const [error, setError] = useState('');
  const [pay, setPay] = useState(null);
  const [busy, run] = useBusy();
  const pickLocal = min != null ? `${date}T${minToHM(min)}` : '';
  useEffect(() => {
    setAvail(null);
    api(`/public/spots/${slug}/availability?date=${date}`).then(setAvail).catch(() => setAvail({ blocks: [] }));
  }, [date]);
  const opts = [];
  for (const blk of avail?.blocks || []) if (blk.allow_pick) for (let m = blk.start_min; m <= blk.end_min; m += 30) if (m < 1440 && `${date}T${minToHM(m)}` > b.pick && !opts.includes(m)) opts.push(m);
  useEffect(() => { if (avail) setMin(opts[0] ?? null); }, [avail]);
  useEffect(() => {
    setPv(null);
    setError('');
    if (!pickLocal) return;
    api(`/public/bookings/${b.code}/extend`, { method: 'POST', body: { token: b.token, pick: pickLocal, preview: true } }).then(setPv).catch((e) => setError(errText(e)));
  }, [pickLocal]);
  const confirm = (paymentId) => run(async () => {
    await api(`/public/bookings/${b.code}/extend`, { method: 'POST', body: { token: b.token, pick: pickLocal, paymentId } });
    toast(t('ext_done'));
    onDone();
  });
  if (pay) return html`<${PayModal} payment=${pay} customer=${b.guest} redirectUrl=${location.href} onPaid=${confirm} onClose=${() => setPay(null)} />`;
  return html`<${Modal} title=${t('ext_title')} onClose=${onClose}>
    <p class="small sub">${t('ext_now', { when: fmtLocal(b.pick, S.lang) })}</p>
    <div class="row gap8 mt12">
      <div class="field grow"><label>${t('pick_date')}</label><input class="input" type="date" value=${date} min=${b.pick.slice(0, 10)} max=${addDays(kstNow().date, 60)} onChange=${(e) => e.target.value && setDate(e.target.value)} /></div>
      <div class="field grow"><label>${t('pick_time')}</label><select class="select" value=${min ?? ''} onChange=${(e) => setMin(Number(e.target.value))} disabled=${!opts.length}>
        ${opts.length ? opts.map((m) => html`<option value=${m}>${minToHM(m)}</option>`) : html`<option value="">${avail ? t('no_time') : '…'}</option>`}</select></div>
    </div>
    ${error ? html`<p class="err mt12">${error}</p>` : pv ? html`<div class="kv total mt12"><span>${t('ext_diff')}</span><span class="num">${money(pv.diff)}</span></div>` : null}
    <button class="btn primary lg block mt16" disabled=${!pv || busy} onClick=${() => (pv.diff > 0 ? setPay(pv.payment) : confirm())}>${pv && pv.diff > 0 ? t('pay_btn', { amount: money(pv.diff) }) : t('ext_btn')}</button>
  <//>`;
}

function ReviewForm({ b, onDone }) {
  const [v, setV] = useState({ rating: 0, price_score: 0, service_score: 0, find_score: 0, body: '' });
  const [busy, run] = useBusy();
  const send = () => run(async () => {
    await api(`/public/bookings/${b.code}/review`, { method: 'POST', body: { token: b.token, ...v } });
    toast(t('rv_done'));
    onDone();
  });
  return html`<div class="card col gap12">
    <h3>${t('rv_title')}</h3>
    <${StarPick} value=${v.rating} onChange=${(n) => setV({ ...v, rating: n })} />
    <div class="col gap4">${[['price_score', 'score_price'], ['service_score', 'score_service'], ['find_score', 'score_find']].map(([k, label]) => html`<div class="row between small"><span class="sub">${t(label)}</span>
      <div class="row gap4">${[1, 2, 3, 4, 5].map((n) => html`<button class="dot ${v[k] >= n ? 'on' : ''}" onClick=${() => setV({ ...v, [k]: n })} aria-label="${n}"></button>`)}</div></div>`)}</div>
    <textarea class="textarea" placeholder=${t('rv_ph')} value=${v.body} onInput=${(e) => setV({ ...v, body: e.target.value })}></textarea>
    <button class="btn primary" disabled=${busy || !v.rating} onClick=${send}>${t('rv_send')}</button>
  </div>`;
}

function IncidentModal({ b, onClose, onDone }) {
  const [v, setV] = useState({ kind: 'damaged', body: '', claim_amount: '' });
  const [photos, setPhotos] = useState([]);
  const [busy, run] = useBusy();
  const upload = async (dataUrl) => (await api(`/public/bookings/${b.code}/files`, { method: 'POST', body: { token: b.token, dataUrl } })).id;
  const send = () => run(async () => {
    await api(`/public/bookings/${b.code}/incident`, { method: 'POST', body: { token: b.token, ...v, claim_amount: Number(v.claim_amount) || 0, photos: photos.map((p) => p.id) } });
    toast(t('inc_done'));
    onDone();
  });
  return html`<${Modal} title=${t('inc_title')} onClose=${onClose}>
    <div class="col gap12">
      <div class="row fw">${['damaged', 'lost', 'other'].map((k) => html`<button class="chip ${v.kind === k ? 'on' : ''}" onClick=${() => setV({ ...v, kind: k })}>${t(`inc_${k}`)}</button>`)}</div>
      <div class="field"><label>${t('inc_body')}</label><textarea class="textarea" value=${v.body} onInput=${(e) => setV({ ...v, body: e.target.value })}></textarea></div>
      <div class="field"><label>${t('inc_photos')}</label><${PhotoPicker} value=${photos} onChange=${setPhotos} upload=${upload} label=${t('add_photo')} /></div>
      <div class="field"><label>${t('inc_amount')} (${t('optional')})</label><input class="input num" type="number" min="0" value=${v.claim_amount} onInput=${(e) => setV({ ...v, claim_amount: e.target.value })} /></div>
      <p class="hint">${t('inc_note', { limit: money(S.config.policy.cover_basic_limit) })}</p>
      <button class="btn primary lg" disabled=${busy || v.body.trim().length < 10} onClick=${send}>${t('inc_send')}</button>
    </div>
  <//>`;
}

export function BookingPage({ code, token, query }) {
  const { data, loading, error, reload } = useLoad(() => api(`/public/bookings/${code}?t=${token}&lang=${S.lang}`), [code, token]);
  const [modal, setModal] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, run] = useBusy();
  const b = data?.booking;
  // 모바일 결제창에서 돌아온 경우 결제 확인을 이어서 합니다.
  useEffect(() => {
    const pid = query.get('paymentId');
    if (b && b.status === 'hold' && pid && !query.get('code')) {
      api(`/public/bookings/${code}/pay`, { method: 'POST', body: { token, paymentId: pid } }).then(reload).catch((e) => toast(errText(e), 'err'));
    }
  }, [b?.status]);
  useEffect(() => {
    if (!b) return;
    rememberBooking(b.code, b.token, { spot: data.spot.name, when: fmtLocal(b.drop, S.lang) });
    if (!['hold', 'pending', 'confirmed', 'stored', 'overdue'].includes(b.status)) return;
    const timer = setInterval(() => !document.hidden && reload(), 25000);
    return () => clearInterval(timer);
  }, [b?.status]);
  if (loading) return html`<main class="wrap narrow page"><${Spinner} /></main>`;
  if (error) return html`<main class="wrap narrow page"><div class="empty"><img src="/assets/img/jimbo-sorry.svg" alt="" /><p class="b">${errText(error)}</p><${Link} to="/my" class="btn line mt16">${t('lookup_title')}<//></div></main>`;
  const { spot, can, overdue, messages, review, incident } = data;
  const live = ['confirmed', 'stored', 'overdue'].includes(b.status);
  const act = (fn) => run(async () => { await fn(); setModal(''); await reload(); });
  const cancel = () => act(async () => {
    const r = await api(`/public/bookings/${code}/cancel`, { method: 'POST', body: { token } });
    toast(t('cancel_done', { amount: money(r.refund) }));
  });
  const send = (e) => {
    e.preventDefault();
    if (!msg.trim()) return;
    run(async () => {
      await api(`/public/bookings/${code}/messages`, { method: 'POST', body: { token, text: msg } });
      setMsg('');
      await reload();
    });
  };
  const payMain = async (paymentId) => {
    await api(`/public/bookings/${code}/pay`, { method: 'POST', body: { token, paymentId } });
    setModal('');
    await reload();
  };
  const payOverdue = async () => {
    const pv = await api(`/public/bookings/${code}/overdue`, { method: 'POST', body: { token, preview: true } });
    if (pv.due > 0) setModal({ overduePay: pv.payment });
  };
  const paidOverdue = async (paymentId) => {
    await api(`/public/bookings/${code}/overdue`, { method: 'POST', body: { token, paymentId } });
    setModal('');
    await reload();
  };
  return html`<main class="wrap narrow page booking">
    <div class="b-head">
      <img src="/assets/img/jimbo-${POSE[b.status] || 'hi'}.svg" alt="" width="96" height="106" />
      <div>${statusBadge(b.status)}<h1 class="mt4">${t(`bh_${b.status}`)}</h1><p class="sub small mt4">${t(`bd_${b.status}`, { refund: money(b.refund_amount), tag: b.tag_no })}</p></div>
    </div>

    ${b.status === 'hold' ? html`<div class="card tint mt16 col gap8">
      <p class="b">${t('hold_note', { min: S.config.policy.hold_min })}</p>
      <button class="btn primary lg" onClick=${() => setModal('pay')}>${t('pay_btn', { amount: money(b.total_amount) })}</button>
      <button class="btn ghost sm" disabled=${busy} onClick=${cancel}>${t('cancel_btn')}</button>
    </div>` : null}

    ${live ? html`<div class="ticket mt16">
      <div class="ticket-qr"><${QR} text=${`${b.code}:${b.pin}`} size=${176} /></div>
      <div class="ticket-info">
        <p class="label">${t('booking_no')}</p><p class="code num">${b.code}</p>
        <div class="row gap16 mt8">
          <div><p class="label">${t('pin')}</p><p class="tk-pin num">${b.pin}</p></div>
          ${b.tag_no ? html`<div><p class="label">${t('tag_no')}</p><p class="tk-pin num">${b.tag_no}</p></div>` : null}
        </div>
        <p class="tiny mute mt8">${b.status === 'confirmed' ? t('qr_note_drop') : t('qr_note_pick')}</p>
      </div>
    </div>` : null}

    ${b.status === 'overdue' || overdue.unpaid > 0 ? html`<div class="note r mt16">
      <p class="b">${t('over_title')}</p><p class="mt4">${t('over_desc', { days: overdue.days, amount: money(overdue.amount) })}</p>
      ${overdue.unpaid > 0 ? html`<button class="btn primary sm mt8" disabled=${busy} onClick=${() => run(payOverdue)}>${t('pay_btn', { amount: money(overdue.unpaid) })}</button>` : html`<p class="small mt4 b">${t('over_paid')}</p>`}
    </div>` : null}

    <div class="mt16"><${Summary} spotName=${spot.name} drop=${b.drop} pick=${b.pick} lines=${b.lines} total=${b.total_amount} plan=${b.plan} days=${b.days} /></div>
    ${b.refund_amount > 0 ? html`<div class="kv mt8"><span>${t('refunded')}</span><span class="num">${money(b.refund_amount)}</span></div>` : null}

    ${live || b.status === 'pending' ? html`<div class="row fw mt12">
      ${can.extend ? html`<button class="btn line sm" onClick=${() => setModal('extend')}>${t('ext_title')}</button>` : null}
      <button class="btn line sm" onClick=${() => setModal('phrases')}>${t('phrase_btn')}</button>
      ${can.cancel ? html`<button class="btn danger sm" onClick=${() => setModal('cancel')}>${t('cancel_btn')}</button>` : null}
    </div>` : null}

    <section class="blk">
      <h2>${t('loc_title')}</h2>
      <p class="mt8 b">${spot.name}</p>
      ${spot.approx ? html`<div class="note mt8">${t('approx_loc')}</div>` : html`<p>${spot.address} ${spot.address_detail}</p>`}
      ${S.lang !== 'ko' && !spot.approx ? html`<p class="small sub">${spot.address_ko} ${spot.address_detail}</p>` : null}
      <div class="row fw mt8 ${spot.approx ? 'hide' : ''}">
        <button class="btn line sm" onClick=${() => copyText(`${spot.address_ko} ${spot.address_detail}`.trim(), t('copied'))}>${t('copy_addr')}</button>
        ${mapLinks(spot).map(([label, url]) => html`<a class="btn line sm" href=${url} target="_blank" rel="noopener">${label}</a>`)}
        ${spot.phone ? html`<a class="btn line sm" href="tel:${spot.phone}">${spot.phone}</a>` : null}
      </div>
      ${spot.guide ? html`<div class="note mt12"><p class="b" style="color:var(--ink)">${t('guide_title')}</p><p class="pre mt4">${spot.guide}</p></div>` : null}
    </section>

    ${data.checkin_photos.length ? html`<section class="blk"><h2>${t('photos_title')}</h2><p class="small sub mt4">${t('photos_sub')}</p>
      <div class="photos mt8">${data.checkin_photos.map((src) => html`<a class="ph" href=${src} target="_blank"><img src=${src} alt="" /></a>`)}</div></section>` : null}

    ${can.message || messages.length ? html`<section class="blk">
      <h2>${t('msg_title')}</h2><p class="small sub mt4">${t('msg_sub')}</p>
      <div class="thread mt12">${messages.map((m) => html`<div class="msg ${m.sender === 'guest' ? 'me' : ''}" key=${m.id}>
        <p>${m.sender === 'guest' ? m.body : m.translated || m.body}</p>
        ${m.sender !== 'guest' && m.translated ? html`<p class="tiny orig">${m.body}</p>` : null}
        <span class="tiny mute">${fmtLocal(isoToLocal(m.created_at), S.lang)}</span>
      </div>`)}</div>
      ${can.message ? html`<form class="row mt8" onSubmit=${send}><input class="input grow" value=${msg} onInput=${(e) => setMsg(e.target.value)} placeholder=${t('msg_ph')} maxlength="1000" /><button class="btn dark" disabled=${busy}>${t('send')}</button></form>` : null}
    </section>` : null}

    ${can.review ? html`<section class="blk"><${ReviewForm} b=${b} onDone=${reload} /></section>` : null}
    ${review ? html`<section class="blk"><h2>${t('rv_mine')}</h2><div class="review mt8"><span class="stars">${'★'.repeat(review.rating)}</span><p class="mt4">${review.body}</p>${review.reply ? html`<p class="reply small"><b>${t('host_reply')}</b> ${review.reply}</p>` : null}</div></section>` : null}

    ${incident ? html`<section class="blk"><h2>${t('inc_title')}</h2><div class="card mt8">
      <span class="badge ${incident.status === 'closed' ? '' : 'a'}">${t(`inc_st_${incident.status}`)}</span>
      <p class="mt8 pre">${incident.body}</p>
      ${incident.status === 'closed' ? html`<div class="hr"></div><p class="b">${t('inc_result', { amount: money(incident.comp_amount) })}</p>${incident.verdict_note ? html`<p class="small sub mt4 pre">${incident.verdict_note}</p>` : null}` : null}
    </div></section>` : null}
    ${can.report ? html`<p class="center mt24"><button class="btn ghost sm" onClick=${() => setModal('incident')}>${t('inc_link')}</button></p>` : null}
    <p class="center mt16"><${Link} to="/help?tab=ask" class="small sub" style="text-decoration:underline">${t('ask')}<//></p>

    ${modal === 'pay' && data.payment ? html`<${PayModal} payment=${data.payment} customer=${b.guest} redirectUrl=${location.href} onPaid=${payMain} onClose=${() => setModal('')} />` : null}
    ${modal?.overduePay ? html`<${PayModal} payment=${modal.overduePay} customer=${b.guest} redirectUrl=${location.href} onPaid=${paidOverdue} onClose=${() => setModal('')} />` : null}
    ${modal === 'extend' ? html`<${ExtendModal} b=${b} slug=${spot.slug} onClose=${() => setModal('')} onDone=${() => { setModal(''); reload(); }} />` : null}
    ${modal === 'incident' ? html`<${IncidentModal} b=${b} onClose=${() => setModal('')} onDone=${() => { setModal(''); reload(); }} />` : null}
    ${modal === 'cancel' ? html`<${Modal} title=${t('cancel_title')} onClose=${() => setModal('')}>
      <div class="kv total"><span>${t('refund_amount')}</span><span class="num">${money(can.cancel_refund)}</span></div>
      ${can.cancel_partial ? html`<div class="note a mt12">${t('cancel_partial')}</div>` : html`<p class="small sub mt8">${t('cancel_full')}</p>`}
      <button class="btn danger lg block mt16" disabled=${busy} onClick=${cancel}>${t('cancel_confirm')}</button>
    <//>` : null}
    ${modal === 'phrases' ? html`<${Modal} title=${t('phrase_btn')} onClose=${() => setModal('')}>
      <p class="small sub">${t('phrase_sub')}</p>
      <div class="col gap8 mt12">${PHRASES.map((k) => html`<div class="phrase"><p class="ko">${PHRASE_KO[k]}</p>${S.lang !== 'ko' ? html`<p class="small sub">${t(k)}</p>` : null}</div>`)}</div>
    <//>` : null}
  </main>`;
}
