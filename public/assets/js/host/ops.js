// 호스트센터 운영 화면: 오늘, 예약, QR 체크인, 메시지, 리뷰, 정산, 사고, 계정
import { html, useState, useEffect, useRef, api, useLoad, Spinner, useBusy, toast, PhotoPicker, loadScript, minToHM, Stars, kstNow } from '/assets/js/lib/core.js';
import { Page, Table, Field, Stat, StatusBadge, MoneyRows, Thread, confirmBox, useForm, nav, won, fmtLocal, fmtIso, hm, dayLabel, bagsText, linesText, PLAN, SPOT_ST, HOST_ST, LANG_KO } from '/assets/js/lib/console.js';

const Loading = ({ s, children }) => (s.loading ? html`<${Spinner} />` : s.error ? html`<div class="empty">${s.error.message}</div>` : children());
const guestLine = (b) => `${b.guest.name}${b.guest.country ? ` (${b.guest.country})` : ''}`;

function BookingRow({ b, mode }) {
  const t = mode === 'pick' ? b.pick : b.drop;
  const today = kstNow().date;
  return html`<a class="bk" href="#/bookings/${b.code}">
    <div class="time num">${hm(t)}<small>${t.slice(0, 10) === today ? (mode === 'pick' ? '찾기' : '맡기기') : dayLabel(t)}</small></div>
    <div class="grow"><p class="b">${guestLine(b)} <${StatusBadge} status=${b.status} /></p>
      <p class="small sub">${linesText(b)}${b.tag_no ? ` · 번호표 ${b.tag_no}` : ''} · <span class="num">${b.code}</span></p></div>
    <span class="mute">›</span>
  </a>`;
}

// ---------- 오늘 ----------
export function Today({ me, reload }) {
  const s = useLoad(() => api('/host/today'), []);
  const [busy, run] = useBusy();
  const c = me.checklist;
  if (!me.spot || me.host.status !== 'approved' || me.spot.status !== 'live') {
    const steps = [
      [c.applied, '호스트 신청하기', '사업자 정보와 서류를 올려 주세요.', '/apply'],
      [c.approved, '심사 통과', me.host.status === 'applied' ? '심사 중이에요. 그동안 스팟 정보를 채워 두세요.' : me.host.status === 'rejected' ? `반려됐어요: ${me.host.reject_reason}` : '신청하면 운영팀이 확인해요.', '/apply'],
      [c.spot, '스팟 정보 입력', '이름, 주소, 지도 위치, 사진', '/spot'],
      [c.blocks, '받는 시간·물량 정하기', '요일·시간대별로 받을 수 있는 칸 수', '/hours'],
      [c.prices, '가격 정하기', '크기별 잠깐·하루 가격', '/prices'],
      [c.bank, '정산 계좌 등록', '정산금을 받을 계좌', '/account'],
      [c.live, '스팟 공개하기', '모두 끝나면 스팟 정보 화면에서 공개해요.', '/spot'],
    ];
    return html`<${Page} title="시작하기" sub="아래 순서대로 마치면 손님을 받을 수 있어요.">
      <div class="panel"><ul class="checklist">${steps.map(([done, title, desc, to]) => html`<li>
        <span class="tick ${done ? 'on' : ''}">${done ? '✓' : ''}</span>
        <div class="grow"><p class="b">${title}</p><p class="small sub">${desc}</p></div>
        ${done ? null : html`<a class="btn line sm" href="#${to}">하러 가기</a>`}
      </li>`)}</ul></div>
    <//>`;
  }
  const act = (fn) => run(async () => { await fn(); await s.reload(); });
  const approve = (b) => act(() => api(`/host/bookings/${b.code}/approve`, { method: 'POST' }).then(() => toast('예약을 승인했어요.')));
  const reject = async (b) => {
    const reason = await confirmBox({ title: '예약 거절', message: '거절하면 손님에게 전액 환불돼요.', prompt: '손님에게 전할 사유', yes: '거절하기', danger: true });
    if (reason) act(() => api(`/host/bookings/${b.code}/cancel`, { method: 'POST', body: { reason } }));
  };
  return html`<${Page} title="오늘" sub=${`${fmtLocal(`${kstNow().date}T00:00`, 'ko', false)} · ${me.spot.name}`} actions=${html`<a class="btn primary" href="#/scan">QR 체크인</a>`}>
    <${Loading} s=${s}>${() => {
      const d = s.data;
      return html`
        <div class="grid4 keep2">
          <${Stat} label="오늘 맡으러 올 예약" value=${d.arriving.filter((b) => b.drop.slice(0, 10) === d.date).length} tone="p" />
          <${Stat} label="보관 중" value=${d.stored.length} />
          <${Stat} label="승인 대기" value=${d.pending.length} />
          <${Stat} label="안 읽은 메시지" value=${d.unread} href="#/messages" />
        </div>
        ${d.pending.length ? html`<div class="panel mt16" style="border-color:var(--p)">
          <h2>승인을 기다리는 예약</h2><p class="sub">기한 안에 승인하지 않으면 자동으로 취소되고 전액 환불돼요.</p>
          ${d.pending.map((b) => html`<div class="bk">
            <div class="grow"><p class="b">${guestLine(b)} · ${linesText(b)}</p><p class="small sub">${fmtLocal(b.drop)} → ${fmtLocal(b.pick)} · 정산 ${won(b.payout_amount)}</p></div>
            <button class="btn line sm" disabled=${busy} onClick=${() => reject(b)}>거절</button><button class="btn primary sm" disabled=${busy} onClick=${() => approve(b)}>승인</button>
          </div>`)}
        </div>` : null}
        <div class="grid2 mt16">
          <div class="panel"><h2>맡으러 올 예약</h2>
            ${d.arriving.length ? d.arriving.map((b) => html`<${BookingRow} b=${b} />`) : html`<p class="small sub mt8">오늘 예정된 예약이 없어요.</p>`}</div>
          <div class="panel"><h2>보관 중인 짐</h2>
            ${d.stored.length ? d.stored.map((b) => html`<${BookingRow} b=${b} mode="pick" />`) : html`<p class="small sub mt8">맡아 둔 짐이 없어요.</p>`}</div>
        </div>
        <div class="panel mt16"><div class="row between"><h2>오늘 시간대별 자리</h2><a class="small b" style="color:var(--p-d)" href="#/hours">시간·물량 바꾸기</a></div>
          ${d.closed ? html`<p class="small sub mt8">오늘은 휴무로 설정되어 있어요.</p>` : d.blocks.length ? d.blocks.map((b) => html`<div class="mt12">
            <div class="row between small"><span class="b num">${minToHM(b.start_min)}–${minToHM(b.end_min)}</span><span class="sub num">${b.units - b.left} / ${b.units}칸 사용</span></div>
            <div class="usage mt4"><i style="width:${Math.min(100, ((b.units - b.left) / b.units) * 100)}%"></i></div>
          </div>`) : html`<p class="small sub mt8">오늘은 받는 시간이 없어요.</p>`}
        </div>
        ${d.finished.length ? html`<div class="panel mt16"><h2>오늘 끝난 예약</h2>${d.finished.map((b) => html`<${BookingRow} b=${b} mode="pick" />`)}</div>` : null}`;
    }}<//>
  <//>`;
}

// ---------- 예약 ----------
export function Bookings({ query }) {
  const tab = query.get('tab') || 'upcoming';
  const [q, setQ] = useState('');
  const s = useLoad(() => api(`/host/bookings?tab=${tab}&q=${encodeURIComponent(q)}`), [tab, q]);
  const tabs = [['upcoming', '예정'], ['stored', '보관 중'], ['done', '완료'], ['cancelled', '취소']];
  return html`<${Page} title="예약">
    <div class="tabs">${tabs.map(([k, label]) => html`<a class="tab ${tab === k ? 'on' : ''}" href="#/bookings?tab=${k}">${label}</a>`)}</div>
    <div class="panel" style="border-top-left-radius:0;border-top-right-radius:0;border-top:0">
      <div class="toolbar"><input class="input sm" placeholder="예약번호·이름 검색" value=${q} onChange=${(e) => setQ(e.target.value.trim())} /></div>
      <${Loading} s=${s}>${() => html`<${Table} rows=${s.data.bookings} onRow=${(b) => nav(`/bookings/${b.code}`)} empty="해당하는 예약이 없어요."
        cols=${[
          { label: '맡기는 시각', render: (b) => fmtLocal(b.drop), cls: 'nowrap' },
          { label: '찾는 시각', render: (b) => fmtLocal(b.pick), cls: 'nowrap' },
          { label: '손님', render: guestLine },
          { label: '짐·상품', render: linesText },
          { label: '상태', render: (b) => html`<${StatusBadge} status=${b.status} />` },
          { label: '정산', render: (b) => won(b.payout_amount), cls: 'r num nowrap' },
        ]} />`}<//>
    </div>
  <//>`;
}

export function BookingDetail({ code }) {
  const s = useLoad(() => api(`/host/bookings/${code}`), [code]);
  const [msg, setMsg] = useState('');
  const [busy, run] = useBusy();
  const act = (fn) => run(async () => { await fn(); await s.reload(); });
  const send = (e) => {
    e.preventDefault();
    if (msg.trim()) act(async () => { await api(`/host/bookings/${code}/messages`, { method: 'POST', body: { text: msg } }); setMsg(''); });
  };
  const cancel = async (b) => {
    const reason = await confirmBox({ title: b.status === 'pending' ? '예약 거절' : '예약 취소', message: '호스트가 취소하면 손님에게 전액 환불돼요. 취소가 잦으면 노출이 줄어들 수 있어요.', prompt: '손님에게 전할 사유', yes: '취소하기', danger: true });
    if (reason) act(() => api(`/host/bookings/${code}/cancel`, { method: 'POST', body: { reason } }));
  };
  return html`<${Page} title="예약 상세" actions=${html`<a class="btn ghost sm" href="#/bookings">← 목록</a>`}>
    <${Loading} s=${s}>${() => {
      const { booking: b, messages, checkins, logs, incident, review } = s.data;
      const open = ['pending', 'confirmed', 'stored', 'overdue'].includes(b.status);
      return html`<div class="grid2">
        <div>
          <div class="panel">
            <div class="row between"><h2 class="num">${b.code}</h2><${StatusBadge} status=${b.status} /></div>
            <div class="kv mt8"><span>손님</span><span>${guestLine(b)} · ${LANG_KO[b.lang] || b.lang}</span></div>
            ${b.guest.phone ? html`<div class="kv"><span>연락처</span><span>${b.guest.phone}</span></div>` : null}
            <div class="kv"><span>맡기는 시각</span><span>${fmtLocal(b.drop)}</span></div>
            <div class="kv"><span>찾는 시각</span><span>${fmtLocal(b.pick)}</span></div>
            <div class="kv"><span>상품</span><span>${PLAN[b.plan]} 맡기기${b.plan === 'long' ? ` (${b.days}일)` : ''}</span></div>
            <div class="kv"><span>짐</span><span>${bagsText(b.bags)} (${b.units}칸)</span></div>
            ${b.lines.filter((l) => l.type === 'bundle').map((l) => html`<div class="kv"><span>세트</span><span>${l.name} ×${l.qty} (${l.addon_name} ${l.addon_qty * l.qty}개 제공)</span></div>`)}
            ${b.tag_no ? html`<div class="kv"><span>번호표</span><span>${b.tag_no}</span></div>` : null}
            ${b.cancel_reason ? html`<div class="note mt8">취소 사유: ${b.cancel_reason}</div>` : null}
            <div class="row fw mt12">
              ${b.status === 'pending' ? html`<button class="btn primary" disabled=${busy} onClick=${() => act(() => api(`/host/bookings/${code}/approve`, { method: 'POST' }))}>승인하기</button>` : null}
              ${b.status === 'confirmed' ? html`<a class="btn primary" href="#/scan/${b.code}">맡기기 처리</a>` : null}
              ${['stored', 'overdue'].includes(b.status) ? html`<a class="btn primary" href="#/scan/${b.code}">찾기 처리</a>` : null}
              ${['pending', 'confirmed'].includes(b.status) ? html`<button class="btn danger" disabled=${busy} onClick=${() => cancel(b)}>${b.status === 'pending' ? '거절' : '예약 취소'}</button>` : null}
            </div>
          </div>
          <div class="panel"><h2>금액</h2><div class="mt8"><${MoneyRows} b=${b} /></div></div>
          ${checkins.some((c) => c.photos.length) ? html`<div class="panel"><h2>맡을 때 찍은 사진</h2><div class="photos mt8">${checkins.flatMap((c) => c.photos).map((src) => html`<a class="ph" href=${src} target="_blank"><img src=${src} alt="" /></a>`)}</div></div>` : null}
          ${review ? html`<div class="panel"><h2>손님 리뷰</h2><p class="mt8"><${Stars} value=${review.rating} /></p><p class="mt4">${review.body}</p></div>` : null}
          ${incident ? html`<div class="panel"><div class="row between"><h2>사고 접수</h2><a class="btn line sm" href="#/incidents">확인하기</a></div></div>` : null}
        </div>
        <div>
          <div class="panel"><h2>손님과 메시지</h2><p class="sub">한국어로 쓰면 손님 언어로 번역되어 전달돼요.</p>
            <div class="mt12"><${Thread} messages=${messages} me="host" /></div>
            ${open ? html`<form class="row mt12" onSubmit=${send}><input class="input grow" value=${msg} onInput=${(e) => setMsg(e.target.value)} placeholder="메시지 입력" maxlength="1000" /><button class="btn dark" disabled=${busy}>보내기</button></form>` : null}
          </div>
          <div class="panel"><h2>처리 기록</h2><ul class="mt8 small">${logs.map((l) => html`<li class="kv"><span>${fmtIso(l.created_at)}</span><span>${{ hold: '예약 시작', pending: '결제(승인 대기)', confirmed: '예약 확정', stored: '맡기기 완료', done: '찾기 완료', cancelled: '취소' }[l.status] || l.status}${l.note ? ` · ${l.note}` : ''}</span></li>`)}</ul></div>
        </div>
      </div>`;
    }}<//>
  <//>`;
}

// ---------- QR 체크인 ----------
async function startCamera(video, onCode) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  video.srcObject = stream;
  await video.play();
  let stop = false;
  const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  if (!detector) await loadScript('/assets/vendor/jsqr.js');
  const canvas = document.createElement('canvas');
  const tick = async () => {
    if (stop) return;
    try {
      let text = '';
      if (detector) text = (await detector.detect(video))[0]?.rawValue || '';
      else if (video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        text = window.jsQR(img.data, img.width, img.height)?.data || '';
      }
      if (text) return onCode(text);
    } catch { /* 다음 프레임에서 다시 */ }
    setTimeout(tick, 250);
  };
  tick();
  return () => { stop = true; stream.getTracks().forEach((t) => t.stop()); };
}

export function Scan({ code }) {
  const [found, setFound] = useState(null); // { booking, pin_ok }
  const [pin, setPin] = useState('');
  const [manual, setManual] = useState(code);
  const [cam, setCam] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [tag, setTag] = useState('');
  const [noPin, setNoPin] = useState('');
  const [result, setResult] = useState(null);
  const [busy, run] = useBusy();
  const video = useRef(null);
  const lookup = (raw, p = '') => run(async () => {
    const r = await api('/host/scan', { method: 'POST', body: { code: raw, pin: p } });
    setFound(r);
    setCam(false);
    const m = /[:.\- ](\d{4})$/.exec(raw);
    setPin(r.pin_ok ? (m ? m[1] : p) : '');
  });
  useEffect(() => { if (code) lookup(code); }, []);
  useEffect(() => {
    if (!cam) return;
    let stop = () => {};
    startCamera(video.current, (text) => lookup(text)).then((fn) => (stop = fn)).catch(() => {
      toast('카메라를 쓸 수 없어요. 예약번호를 직접 입력해 주세요.', 'err');
      setCam(false);
    });
    return () => stop();
  }, [cam]);
  const upload = async (dataUrl) => (await api('/host/files', { method: 'POST', body: { dataUrl, scope: 'private' } })).id;
  const b = found?.booking;
  const checkin = () => run(async () => {
    await api('/host/checkin', { method: 'POST', body: { code: b.code, pin, photos: photos.map((p) => p.id), tag_no: tag } });
    setResult({ title: '맡기기 완료', desc: `번호표 ${tag}번 · 찾는 시각 ${fmtLocal(b.pick)}` });
  });
  const checkout = () => run(async () => {
    const r = await api('/host/checkout', { method: 'POST', body: pin ? { code: b.code, pin } : { code: b.code, manual: 1, note: noPin } });
    setResult({ title: '찾기 완료', desc: r.overdue_unpaid > 0 ? `초과 요금 ${won(r.overdue_unpaid)}이 미납 상태예요. 운영팀이 확인해요.` : '짐을 손님에게 돌려드렸어요.' });
  });
  const reset = () => { setFound(null); setResult(null); setPhotos([]); setTag(''); setPin(''); setManual(''); setNoPin(''); nav('/scan'); };

  if (result) return html`<${Page} title="QR 체크인"><div class="panel center"><img src="/assets/img/jimbo-ok.svg" alt="" style="width:120px;margin:0 auto" />
    <h2 class="mt8" style="font-size:20px">${result.title}</h2><p class="sub mt4">${result.desc}</p>
    <div class="row mt16" style="justify-content:center"><button class="btn primary" onClick=${reset}>다음 손님</button><a class="btn line" href="#/">오늘 화면으로</a></div></div><//>`;

  if (!b) return html`<${Page} title="QR 체크인" sub="손님 화면의 QR 코드를 찍거나 예약번호를 입력해 주세요.">
    <div class="grid2">
      <div class="panel center">
        ${cam ? html`<div class="scan-box"><video ref=${video} playsinline muted></video></div><button class="btn line mt12" onClick=${() => setCam(false)}>카메라 끄기</button>`
          : html`<img src="/assets/img/jimbo-hi.svg" alt="" style="width:110px;margin:8px auto" /><button class="btn primary lg" onClick=${() => setCam(true)}>카메라로 QR 찍기</button>`}
      </div>
      <form class="panel col gap12" onSubmit=${(e) => { e.preventDefault(); lookup(manual, pin); }}>
        <h2>직접 입력</h2>
        <${Field} label="예약번호"><input class="input num" value=${manual} onInput=${(e) => setManual(e.target.value)} placeholder="BAG······" required /><//>
        <${Field} label="확인 번호 4자리" hint="손님 예약 화면에 보여요."><input class="input num" inputmode="numeric" maxlength="4" value=${pin} onInput=${(e) => setPin(e.target.value)} /><//>
        <button class="btn dark" disabled=${busy}>예약 찾기</button>
      </form>
    </div>
  <//>`;

  const isIn = b.status === 'confirmed', isOut = ['stored', 'overdue'].includes(b.status);
  return html`<${Page} title=${isIn ? '맡기기 처리' : isOut ? '찾기 처리' : 'QR 체크인'} actions=${html`<button class="btn ghost sm" onClick=${reset}>← 다시 찾기</button>`}>
    <div class="grid2">
      <div class="panel">
        <div class="row between"><h2 class="num">${b.code}</h2><${StatusBadge} status=${b.status} /></div>
        <div class="kv mt8"><span>손님</span><span>${guestLine(b)}</span></div>
        <div class="kv"><span>짐</span><span>${bagsText(b.bags)}</span></div>
        ${b.lines.filter((l) => l.type === 'bundle').map((l) => html`<div class="note p mt8"><b>${l.name} ×${l.qty}</b> — ${l.addon_name} ${l.addon_qty * l.qty}개를 함께 드려야 해요.</div>`)}
        <div class="kv"><span>맡기는 시각</span><span>${fmtLocal(b.drop)}</span></div>
        <div class="kv"><span>찾는 시각</span><span>${fmtLocal(b.pick)}</span></div>
        ${b.tag_no ? html`<div class="kv"><span>번호표</span><span class="b" style="font-size:18px">${b.tag_no}</span></div>` : null}
      </div>
      <div class="panel col gap12">
        ${isIn ? html`
          <${Field} label="확인 번호 4자리" hint=${found.pin_ok ? 'QR 코드로 확인했어요.' : '손님 예약 화면의 번호를 입력해 주세요.'}><input class="input num" inputmode="numeric" maxlength="4" value=${pin} onInput=${(e) => setPin(e.target.value)} /><//>
          <${Field} label="짐 사진 (2장 이상)" hint="짐 전체와 흠집·손상된 곳이 보이게 찍어 주세요. 사고가 났을 때 기준이 돼요."><${PhotoPicker} value=${photos} onChange=${setPhotos} upload=${upload} label="사진 찍기" capture="environment" /><//>
          <${Field} label="번호표 번호"><input class="input" value=${tag} onInput=${(e) => setTag(e.target.value)} placeholder="예: 12" /><//>
          <button class="btn primary lg" disabled=${busy || photos.length < 2 || !tag.trim() || pin.length !== 4} onClick=${checkin}>맡기기 완료</button>`
        : isOut ? html`
          ${b.status === 'overdue' ? html`<div class="note r">찾는 시각이 지난 예약이에요. 초과 요금은 손님이 예약 화면에서 결제해요.</div>` : null}
          <${Field} label="확인 번호 4자리" hint="번호표와 손님 화면의 번호를 함께 확인해 주세요."><input class="input num" inputmode="numeric" maxlength="4" value=${pin} onInput=${(e) => setPin(e.target.value)} /><//>
          ${pin.length !== 4 ? html`<${Field} label="번호를 확인할 수 없을 때" hint="번호표와 이름으로 확인했다면 그 내용을 적어 주세요. 기록으로 남아요."><input class="input" value=${noPin} onInput=${(e) => setNoPin(e.target.value)} placeholder="예: 번호표 12번, 예약자 이름 확인" /><//>` : null}
          <button class="btn primary lg" disabled=${busy || (pin.length !== 4 && noPin.trim().length < 4)} onClick=${checkout}>찾기 완료</button>`
        : html`<div class="note">${b.status === 'pending' ? '아직 승인하지 않은 예약이에요.' : '지금은 처리할 수 없는 예약이에요.'}</div><a class="btn line" href="#/bookings/${b.code}">예약 상세 보기</a>`}
      </div>
    </div>
  <//>`;
}

// ---------- 메시지 ----------
export function Messages() {
  const s = useLoad(() => api('/host/messages'), []);
  return html`<${Page} title="메시지" sub="손님 메시지는 한국어로 번역해서 보여 드려요.">
    <div class="panel"><${Loading} s=${s}>${() => (s.data.threads.length ? s.data.threads.map((t) => html`<a class="bk" href="#/bookings/${t.code}">
      <div class="grow"><p class="b">${t.guest_name}${t.guest_country ? ` (${t.guest_country})` : ''} ${t.unread ? html`<span class="badge p">새 메시지 ${t.unread}</span>` : null}</p>
        <p class="small sub">${(t.last_translated || t.last_body || '').slice(0, 70)}</p></div>
      <span class="tiny mute">${fmtIso(t.last_at)}</span>
    </a>`) : html`<div class="empty small">아직 메시지가 없어요.</div>`)}<//></div>
  <//>`;
}

// ---------- 리뷰 ----------
export function Reviews() {
  const s = useLoad(() => api('/host/reviews'), []);
  const [edit, setEdit] = useState({});
  const [busy, run] = useBusy();
  const save = (r) => run(async () => {
    await api(`/host/reviews/${r.id}/reply`, { method: 'POST', body: { reply: edit[r.id] } });
    toast('답글을 남겼어요.');
    setEdit({});
    await s.reload();
  });
  return html`<${Page} title="리뷰">
    <${Loading} s=${s}>${() => (s.data.reviews.length ? s.data.reviews.map((r) => html`<div class="panel" key=${r.id}>
      <div class="row between"><${Stars} value=${r.rating} /><span class="tiny mute">${r.guest_name} ${r.guest_country} · ${fmtIso(r.created_at)} · ${r.code}</span></div>
      <p class="mt8">${r.body || html`<span class="mute">(내용 없음)</span>`}</p>
      <p class="tiny mute mt4">가격 ${r.price_score || '-'} · 응대 ${r.service_score || '-'} · 찾기 쉬움 ${r.find_score || '-'}</p>
      ${edit[r.id] !== undefined
        ? html`<textarea class="textarea mt8" value=${edit[r.id]} onInput=${(e) => setEdit({ ...edit, [r.id]: e.target.value })}></textarea>
            <div class="row mt8"><button class="btn primary sm" disabled=${busy} onClick=${() => save(r)}>답글 저장</button><button class="btn ghost sm" onClick=${() => setEdit({})}>닫기</button></div>`
        : html`${r.reply ? html`<div class="note mt8"><b>내 답글</b> ${r.reply}</div>` : null}<button class="btn line sm mt8" onClick=${() => setEdit({ [r.id]: r.reply || '' })}>${r.reply ? '답글 고치기' : '답글 달기'}</button>`}
    </div>`) : html`<div class="panel"><div class="empty small">아직 리뷰가 없어요.</div></div>`)}<//>
  <//>`;
}

// ---------- 정산 ----------
const SETTLE_ST = { ready: ['지급 예정', 'p'], hold: ['보류', 'a'], paid: ['지급 완료', 'g'] };
export function Settlements({ me }) {
  const s = useLoad(() => api('/host/settlements'), []);
  return html`<${Page} title="정산" sub="한 달 동안 끝난 예약을 모아 다음 달에 보내 드려요.">
    <${Loading} s=${s}>${() => {
      const d = s.data;
      return html`
        ${!me.host.bank_account ? html`<div class="note a" style="margin-bottom:14px">정산 계좌가 아직 없어요. <a href="#/account" class="b" style="text-decoration:underline">계좌 등록하기</a></div>`
          : !me.host.account_verified ? html`<div class="note" style="margin-bottom:14px">등록한 계좌를 운영팀이 확인하고 있어요. 확인이 끝나야 지급돼요.</div>` : null}
        <div class="grid2">
          <${Stat} label="아직 정산되지 않은 금액" value=${won(d.open_total)} sub=${`예약 ${d.open.length}건`} tone="p" />
          <div class="stat"><span class="label">정산 기준</span><p class="small mt8">매달 1일에 지난달 내역을 만들고 ${d.rule.pay_day}일까지 보내 드려요. ${won(d.rule.min_payout)} 미만이면 다음 달로 넘겨요. 사고 조사 중인 예약은 끝날 때까지 보류돼요.</p></div>
        </div>
        <div class="panel mt16"><h2>정산 내역</h2>
          <${Table} rows=${d.settlements} onRow=${(t) => nav(`/settle/${t.id}`)} empty="아직 정산 내역이 없어요."
            cols=${[{ label: '정산 월', key: 'month' }, { label: '예약', render: (t) => `${t.booking_count}건`, cls: 'r' }, { label: '판매 금액', render: (t) => won(t.gross), cls: 'r num' }, { label: '수수료', render: (t) => won(t.fee), cls: 'r num' },
              { label: '조정', render: (t) => (t.adjust ? won(t.adjust) : '-'), cls: 'r num' }, { label: '정산 금액', render: (t) => html`<b>${won(t.payout)}</b>`, cls: 'r num' },
              { label: '상태', render: (t) => html`<span class="badge ${SETTLE_ST[t.status][1]}">${SETTLE_ST[t.status][0]}</span>${t.hold_reason ? html` <span class="tiny mute">${t.hold_reason}</span>` : ''}` }]} /></div>
        <div class="panel"><h2>정산을 기다리는 예약</h2>
          <${Table} rows=${d.open} onRow=${(b) => nav(`/bookings/${b.code}`)} empty="정산을 기다리는 예약이 없어요."
            cols=${[{ label: '끝난 날', render: (b) => fmtIso(b.closed_at), cls: 'nowrap' }, { label: '예약번호', key: 'code', cls: 'num' }, { label: '상태', render: (b) => html`<${StatusBadge} status=${b.status} />` },
              { label: '판매 금액', render: (b) => won(b.total_amount - b.refund_amount + b.overdue_paid), cls: 'r num' }, { label: '수수료', render: (b) => won(b.fee_amount), cls: 'r num' }, { label: '정산', render: (b) => won(b.payout_amount), cls: 'r num' }]} /></div>`;
    }}<//>
  <//>`;
}
export function SettlementDetail({ id }) {
  const s = useLoad(() => api(`/host/settlements/${id}`), [id]);
  return html`<${Page} title="정산 상세" actions=${html`<a class="btn ghost sm" href="#/settle">← 목록</a>`}>
    <${Loading} s=${s}>${() => {
      const { settlement: t, bookings, charges } = s.data;
      return html`<div class="grid4 keep2">
          <${Stat} label="정산 월" value=${t.month} /><${Stat} label="판매 금액" value=${won(t.gross)} /><${Stat} label="수수료" value=${won(t.fee)} /><${Stat} label="정산 금액" value=${won(t.payout)} tone="p" sub=${SETTLE_ST[t.status][0]} />
        </div>
        ${charges.length ? html`<div class="panel mt16"><h2>사고 보상 부담액</h2>${charges.map((c) => html`<div class="kv"><span>${c.code}</span><span class="num">− ${won(c.host_charge)}</span></div>`)}</div>` : null}
        <div class="panel mt16"><h2>포함된 예약</h2>
          <${Table} rows=${bookings} onRow=${(b) => nav(`/bookings/${b.code}`)}
            cols=${[{ label: '끝난 날', render: (b) => fmtIso(b.closed_at), cls: 'nowrap' }, { label: '예약번호', key: 'code', cls: 'num' }, { label: '상태', render: (b) => html`<${StatusBadge} status=${b.status} />` },
              { label: '보관분', render: (b) => won(b.storage_amount), cls: 'r num' }, { label: '추가분', render: (b) => won(b.addon_amount), cls: 'r num' }, { label: '수수료', render: (b) => won(b.fee_amount), cls: 'r num' }, { label: '정산', render: (b) => won(b.payout_amount), cls: 'r num' }]} /></div>`;
    }}<//>
  <//>`;
}

// ---------- 사고 ----------
const INC_ST = { received: ['소명 필요', 'r'], replied: ['검토 중', 'a'], judged: ['판정 완료', 'b'], closed: ['종결', ''] };
const INC_KIND = { damaged: '파손', lost: '분실', other: '기타' };
export function Incidents() {
  const s = useLoad(() => api('/host/incidents'), []);
  const [text, setText] = useState({});
  const [busy, run] = useBusy();
  const reply = (i) => run(async () => {
    await api(`/host/incidents/${i.id}/reply`, { method: 'POST', body: { text: text[i.id] } });
    toast('소명 내용을 보냈어요.');
    await s.reload();
  });
  return html`<${Page} title="사고" sub="접수된 건은 기한 안에 당시 상황을 알려 주세요. 맡을 때 찍은 사진이 판단 기준이 돼요.">
    <${Loading} s=${s}>${() => (s.data.incidents.length ? s.data.incidents.map((i) => html`<div class="panel" key=${i.id}>
      <div class="row between"><h2>${INC_KIND[i.kind]} · <a href="#/bookings/${i.code}" class="num" style="text-decoration:underline">${i.code}</a></h2><span class="badge ${INC_ST[i.status][1]}">${INC_ST[i.status][0]}</span></div>
      <p class="tiny mute mt4">${i.guest_name} · 접수 ${fmtIso(i.created_at)}${i.claim_amount ? ` · 청구 ${won(i.claim_amount)}` : ''}</p>
      <p class="mt8 pre">${i.body}</p>
      ${i.photos.length ? html`<div class="photos mt8">${i.photos.map((src) => html`<a class="ph" href=${src} target="_blank"><img src=${src} alt="" /></a>`)}</div>` : null}
      ${i.host_reply ? html`<div class="note mt12"><b>내 소명</b><p class="pre mt4">${i.host_reply}</p></div>` : null}
      ${['received', 'replied'].includes(i.status) ? html`<textarea class="textarea mt12" placeholder="맡을 때와 돌려줄 때의 상황을 적어 주세요." value=${text[i.id] ?? ''} onInput=${(e) => setText({ ...text, [i.id]: e.target.value })}></textarea>
        <div class="row between mt8"><span class="tiny mute">소명 기한 ${fmtIso(i.host_reply_due)}</span><button class="btn primary sm" disabled=${busy || (text[i.id] || '').trim().length < 10} onClick=${() => reply(i)}>${i.host_reply ? '다시 보내기' : '소명 보내기'}</button></div>` : null}
      ${i.verdict ? html`<div class="note ${i.host_charge ? 'r' : 'g'} mt12"><b>판정 결과</b> 보상 ${won(i.comp_amount)} · 호스트 부담 ${won(i.host_charge)}${i.verdict_note ? html`<p class="pre mt4">${i.verdict_note}</p>` : null}</div>` : null}
    </div>`) : html`<div class="panel"><div class="empty small"><img src="/assets/img/jimbo-guard.svg" alt="" />접수된 사고가 없어요.</div></div>`)}<//>
  <//>`;
}

// ---------- 계정 ----------
export function Account({ me, reload }) {
  const [bank, bindBank] = useForm({ bank_name: me.host.bank_name, bank_account: me.host.bank_account, bank_holder: me.host.bank_holder });
  const [pw, bindPw, setPw] = useForm({ current: '', password: '' });
  const [busy, run] = useBusy();
  const saveBank = (e) => { e.preventDefault(); run(async () => { await api('/host/account', { method: 'PUT', body: bank }); toast('계좌를 저장했어요. 운영팀 확인 뒤 정산에 쓰여요.'); reload(); }); };
  const savePw = (e) => { e.preventDefault(); run(async () => { await api('/host/password', { method: 'PUT', body: pw }); toast('비밀번호를 바꿨어요.'); setPw({ current: '', password: '' }); }); };
  return html`<${Page} title="계좌·비밀번호">
    <div class="grid2">
      <form class="panel col gap12" onSubmit=${saveBank}>
        <div class="row between"><h2>정산 계좌</h2>${me.host.bank_account ? html`<span class="badge ${me.host.account_verified ? 'g' : 'a'}">${me.host.account_verified ? '확인 완료' : '확인 중'}</span>` : null}</div>
        <${Field} label="은행"><input class="input" ...${bindBank('bank_name')} required /><//>
        <${Field} label="계좌번호"><input class="input num" ...${bindBank('bank_account')} required /><//>
        <${Field} label="예금주" hint="사업자 명의 계좌를 권해요."><input class="input" ...${bindBank('bank_holder')} required /><//>
        <button class="btn primary" disabled=${busy}>저장</button>
      </form>
      <form class="panel col gap12" onSubmit=${savePw}>
        <h2>비밀번호 바꾸기</h2>
        <${Field} label="지금 비밀번호"><input class="input" type="password" ...${bindPw('current')} required autocomplete="current-password" /><//>
        <${Field} label="새 비밀번호" hint="8자 이상"><input class="input" type="password" ...${bindPw('password')} required minlength="8" autocomplete="new-password" /><//>
        <button class="btn line" disabled=${busy}>비밀번호 바꾸기</button>
        <p class="tiny mute">로그인 이메일: ${me.host.email} · 호스트 상태: ${HOST_ST[me.host.status]}${me.spot ? ` · 스팟: ${SPOT_ST[me.spot.status]}` : ''}</p>
      </form>
    </div>
  <//>`;
}
