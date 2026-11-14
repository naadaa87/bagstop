// Admin 운영 화면: 호스트 심사, 스팟, 예약, 정산, 사고·보상, 리뷰, 문의
import { html, useState, api, useLoad, Spinner, useBusy, toast, Modal, Stars, kstNow } from '/assets/js/lib/core.js';
import { Page, Table, Field, Stat, StatusBadge, MoneyRows, Thread, confirmBox, useForm, nav, won, fmtLocal, fmtIso, bagsText, linesText, PLAN, CATS, HOST_TYPE, HOST_ST, SPOT_ST, LANG_KO } from '/assets/js/lib/console.js';

const Loading = ({ s, children }) => (s.loading ? html`<${Spinner} />` : s.error ? html`<div class="empty">${s.error.message}</div>` : children());
const HOST_CLS = { draft: '', applied: 'a', approved: 'g', rejected: 'r', suspended: 'r' };
const SPOT_CLS = { live: 'g', blocked: 'r' };
const Tabs = ({ items, value, base }) => html`<div class="tabs">${items.map(([k, label]) => html`<a class="tab ${value === k ? 'on' : ''}" href="#/${base}${k ? `?status=${k}` : ''}">${label}</a>`)}</div>`;
const tabPanel = 'border-top-left-radius:0;border-top-right-radius:0;border-top:0';

// ---------- 호스트 ----------
export function Hosts({ query }) {
  const status = query.get('status') || '';
  const [q, setQ] = useState('');
  const s = useLoad(() => api(`/admin/hosts?status=${status}&q=${encodeURIComponent(q)}`), [status, q]);
  return html`<${Page} title="호스트 심사" sub="서류를 확인하고 승인하면 호스트가 스팟을 공개할 수 있어요.">
    <${Tabs} base="hosts" value=${status} items=${[['', '전체'], ['applied', '심사 대기'], ['approved', '승인'], ['rejected', '반려'], ['suspended', '이용 정지'], ['draft', '작성 중']]} />
    <div class="panel" style=${tabPanel}>
      <div class="toolbar"><input class="input sm" placeholder="이름·이메일·상호 검색" onChange=${(e) => setQ(e.target.value.trim())} /></div>
      <${Loading} s=${s}>${() => html`<${Table} rows=${s.data.hosts} onRow=${(h) => nav(`/hosts/${h.id}`)} cols=${[
        { label: '호스트', render: (h) => html`<b>${h.name}</b>${h.is_demo ? html` <span class="badge">체험용</span>` : ''}<br /><span class="tiny mute">${h.email}</span>` },
        { label: '유형', render: (h) => HOST_TYPE[h.type] }, { label: '상호', key: 'biz_name' },
        { label: '스팟', render: (h) => (h.spot_name ? html`${h.spot_name} <span class="badge ${SPOT_CLS[h.spot_status] || ''}">${SPOT_ST[h.spot_status]}</span>` : html`<span class="mute">없음</span>`) },
        { label: '신청일', render: (h) => (h.applied_at ? fmtIso(h.applied_at) : '-'), cls: 'nowrap' },
        { label: '상태', render: (h) => html`<span class="badge ${HOST_CLS[h.status]}">${HOST_ST[h.status]}</span>` }]} />`}<//>
    </div>
  <//>`;
}

export function HostDetail({ id, can }) {
  const s = useLoad(() => api(`/admin/hosts/${id}`), [id]);
  const [memo, setMemo] = useState(null);
  const [busy, run] = useBusy();
  const decide = async (action, label, needReason) => {
    const reason = needReason ? await confirmBox({ title: label, message: needReason, prompt: '사유', yes: label, danger: action !== 'approve' }) : await confirmBox({ title: label, message: `${label} 처리할까요?`, yes: label });
    if (!reason) return;
    run(async () => { await api(`/admin/hosts/${id}/decision`, { method: 'POST', body: { action, reason: reason === true ? '' : reason } }); toast('처리했어요.'); await s.reload(); });
  };
  const patch = (body, msg) => run(async () => { await api(`/admin/hosts/${id}`, { method: 'PUT', body }); toast(msg); await s.reload(); });
  return html`<${Page} title="호스트 상세" actions=${html`<a class="btn ghost sm" href="#/hosts">← 목록</a>`}>
    <${Loading} s=${s}>${() => {
      const { host: h, spot, stats } = s.data;
      return html`<div class="grid2"><div>
        <div class="panel">
          <div class="row between"><h2>${h.name}</h2><span class="badge ${HOST_CLS[h.status]}">${HOST_ST[h.status]}</span></div>
          <div class="kv mt8"><span>이메일</span><span>${h.email}</span></div><div class="kv"><span>연락처</span><span>${h.phone || '-'}</span></div>
          <div class="kv"><span>유형</span><span>${HOST_TYPE[h.type]}</span></div><div class="kv"><span>상호</span><span>${h.biz_name || '-'}</span></div>
          <div class="kv"><span>대표자</span><span>${h.rep_name || '-'}</span></div><div class="kv"><span>사업자등록번호</span><span class="num">${h.biz_no || '-'}</span></div>
          <div class="kv"><span>서류</span><span>${h.doc_file ? html`<a href="/api/files/${h.doc_file}" target="_blank" style="text-decoration:underline">${['store', 'stay'].includes(h.type) ? '사업자등록증' : '본인 확인 서류'}</a>` : '없음'}
            ${h.doc2_file ? html` · <a href="/api/files/${h.doc2_file}" target="_blank" style="text-decoration:underline">영업신고증</a>` : ''}</span></div>
          ${h.reject_reason ? html`<div class="note r mt8">사유: ${h.reject_reason}</div>` : null}
          ${['home', 'space'].includes(h.type) ? html`<div class="note a mt8">가정형·공간형은 시범 운영 대상이에요. 공동주택 규약, 안전, 정산 방식(개인 지급 가능 여부)을 확인한 뒤 승인해 주세요.</div>` : null}
          ${can('hosts') ? html`<div class="row fw mt12">
            ${['applied', 'rejected'].includes(h.status) ? html`<button class="btn primary" disabled=${busy} onClick=${() => decide('approve', '승인')}>승인</button>` : null}
            ${h.status === 'applied' ? html`<button class="btn danger" disabled=${busy} onClick=${() => decide('reject', '반려', '반려 사유는 호스트에게 그대로 전달돼요.')}>반려</button>` : null}
            ${h.status === 'approved' ? html`<button class="btn danger" disabled=${busy} onClick=${() => decide('suspend', '이용 정지', '이용을 정지하면 스팟도 함께 내려가요. 이미 받은 예약은 따로 확인해 주세요.')}>이용 정지</button>` : null}
            ${h.status === 'suspended' ? html`<button class="btn line" disabled=${busy} onClick=${() => decide('restore', '정지 해제')}>정지 해제</button>` : null}
          </div>` : null}
        </div>
        <div class="panel"><div class="row between"><h2>정산 계좌</h2><span class="badge ${h.account_verified ? 'g' : 'a'}">${h.account_verified ? '확인 완료' : '확인 전'}</span></div>
          <p class="mt8">${h.bank_account ? `${h.bank_name} ${h.bank_account} (${h.bank_holder})` : html`<span class="mute">등록 전</span>`}</p>
          ${can('settle') && h.bank_account ? html`<button class="btn line sm mt8" disabled=${busy} onClick=${() => patch({ account_verified: h.account_verified ? 0 : 1 }, '계좌 확인 상태를 바꿨어요.')}>${h.account_verified ? '확인 취소' : '계좌 확인 완료로 표시'}</button>` : null}</div>
      </div><div>
        <div class="panel"><h2>스팟</h2>
          ${spot ? html`<div class="kv mt8"><span>이름</span><span>${spot.name}</span></div><div class="kv"><span>상태</span><span><span class="badge ${SPOT_CLS[spot.status] || ''}">${SPOT_ST[spot.status]}</span></span></div>
            <div class="kv"><span>주소</span><span>${spot.address} ${spot.address_detail}</span></div><div class="kv"><span>업종</span><span>${CATS[spot.category]}</span></div>
            ${spot.photos.length ? html`<div class="photos mt8">${spot.photos.map((pid) => html`<a class="ph" href="/api/files/${pid}" target="_blank"><img src="/api/files/${pid}" alt="" /></a>`)}</div>` : null}
            ${spot.status === 'live' ? html`<a class="btn line sm mt8" href="/ko/spot/${spot.slug}" target="_blank">고객 화면에서 보기</a>` : null}` : html`<p class="small sub mt8">아직 스팟 정보를 입력하지 않았어요.</p>`}</div>
        <div class="panel"><h2>이용 기록</h2>
          <div class="grid4 keep2 mt8" style="gap:8px">${[['예약', stats.bookings], ['완료', stats.done], ['호스트 취소', stats.host_cancels], ['사고', stats.incidents]].map(([l, n]) => html`<div class="stat" style="padding:10px"><span class="label">${l}</span><b style="font-size:20px">${n || 0}</b></div>`)}</div></div>
        <div class="panel col gap8"><h2>운영 메모</h2><textarea class="textarea" value=${memo ?? h.admin_memo} onInput=${(e) => setMemo(e.target.value)} placeholder="호스트에게는 보이지 않아요."></textarea>
          ${can('hosts') ? html`<button class="btn line sm" style="align-self:flex-start" disabled=${busy || memo == null} onClick=${() => patch({ admin_memo: memo }, '메모를 저장했어요.')}>메모 저장</button>` : null}</div>
      </div></div>`;
    }}<//>
  <//>`;
}

// ---------- 스팟 ----------
export function Spots({ can }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const s = useLoad(() => api(`/admin/spots?status=${status}&q=${encodeURIComponent(q)}`), [status, q]);
  const [busy, run] = useBusy();
  const setSt = async (sp, st) => {
    if (st === 'blocked' && !(await confirmBox({ title: '운영 중지', message: `'${sp.name}'을(를) 운영 중지할까요? 호스트가 직접 다시 공개할 수 없게 돼요.`, yes: '운영 중지', danger: true }))) return;
    run(async () => { await api(`/admin/spots/${sp.id}`, { method: 'PUT', body: { status: st } }); await s.reload(); });
  };
  return html`<${Page} title="스팟" sub="공개 상태를 살피고, 문제가 있는 스팟은 운영을 멈출 수 있어요.">
    <div class="panel">
      <div class="toolbar"><select class="select sm" value=${status} onChange=${(e) => setStatus(e.target.value)}><option value="">전체 상태</option>${Object.entries(SPOT_ST).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
        <input class="input sm" placeholder="이름·주소 검색" onChange=${(e) => setQ(e.target.value.trim())} /></div>
      <${Loading} s=${s}>${() => html`<${Table} rows=${s.data.spots} cols=${[
        { label: '스팟', render: (sp) => html`<b>${sp.name}</b>${sp.is_demo ? html` <span class="badge">체험용</span>` : ''}<br /><span class="tiny mute">${CATS[sp.category]} · ${sp.address}</span>` },
        { label: '호스트', render: (sp) => html`<a href="#/hosts/${sp.host_id}" style="text-decoration:underline">${sp.host_name}</a>` },
        { label: '일반 하루', render: (sp) => (sp.day_m ? won(sp.day_m) : '-'), cls: 'r num' }, { label: '세트', key: 'bundles', cls: 'r' }, { label: '예약', key: 'bookings', cls: 'r' },
        { label: '평점', render: (sp) => (sp.rating_count ? `★ ${sp.rating_avg} (${sp.rating_count})` : '-'), cls: 'nowrap' },
        { label: '상태', render: (sp) => html`<span class="badge ${SPOT_CLS[sp.status] || ''}">${SPOT_ST[sp.status]}</span>` },
        { label: '', render: (sp) => (can('hosts') ? (sp.status === 'blocked' ? html`<button class="btn line sm" disabled=${busy} onClick=${() => setSt(sp, 'paused')}>중지 해제</button>` : ['live', 'paused'].includes(sp.status) ? html`<button class="btn danger sm" disabled=${busy} onClick=${() => setSt(sp, 'blocked')}>운영 중지</button>` : null) : null), cls: 'r' }]} />`}<//>
    </div>
  <//>`;
}

// ---------- 예약 ----------
export function Bookings({ query }) {
  const [status, setStatus] = useState(query.get('status') || '');
  const [q, setQ] = useState('');
  const s = useLoad(() => api(`/admin/bookings?status=${status}&q=${encodeURIComponent(q)}`), [status, q]);
  const opts = [['', '전체 상태'], ['pending', '승인 대기'], ['confirmed', '예약 확정'], ['stored', '보관 중'], ['overdue', '미수령'], ['done', '찾기 완료'], ['cancelled', '취소'], ['noshow', '노쇼'], ['overdue_unpaid', '초과 요금 미납']];
  return html`<${Page} title="예약">
    <div class="panel">
      <div class="toolbar"><select class="select sm" value=${status} onChange=${(e) => setStatus(e.target.value)}>${opts.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
        <input class="input sm" style="min-width:240px" placeholder="예약번호·손님·이메일·스팟 검색" onChange=${(e) => setQ(e.target.value.trim())} /></div>
      <${Loading} s=${s}>${() => html`<${Table} rows=${s.data.bookings} onRow=${(b) => nav(`/bookings/${b.code}`)} cols=${[
        { label: '예약번호', key: 'code', cls: 'num' }, { label: '스팟', key: 'spot_name' }, { label: '손님', render: (b) => html`${b.guest.name}<br /><span class="tiny mute">${b.guest.email}</span>` },
        { label: '맡기는 시각', render: (b) => fmtLocal(b.drop), cls: 'nowrap' }, { label: '찾는 시각', render: (b) => fmtLocal(b.pick), cls: 'nowrap' },
        { label: '상태', render: (b) => html`<${StatusBadge} status=${b.status} />` }, { label: '결제', render: (b) => won(b.total_amount), cls: 'r num' }, { label: '수수료', render: (b) => won(b.fee_amount), cls: 'r num' }]} />`}<//>
    </div>
  <//>`;
}

function RefundModal({ b, onClose, onDone }) {
  const paid = b.total_amount + b.overdue_paid - b.refund_amount;
  const canCancel = ['pending', 'confirmed'].includes(b.status);
  const [v, bind, setV] = useForm({ amount: canCancel ? paid : '', reason: '', cancel: canCancel });
  const [busy, run] = useBusy();
  const go = () => run(async () => {
    await api(`/admin/bookings/${b.code}/refund`, { method: 'POST', body: { amount: Number(v.amount), reason: v.reason, cancel: v.cancel } });
    toast('처리했어요.');
    onDone();
  });
  return html`<${Modal} title="취소·환불" onClose=${onClose}>
    <div class="col gap12">
      <div class="kv"><span>환불할 수 있는 금액</span><span class="num">${won(paid)}</span></div>
      ${canCancel ? html`<label class="check"><input type="checkbox" checked=${v.cancel} onChange=${(e) => setV({ ...v, cancel: e.target.checked })} /><span>예약도 함께 취소해요</span></label>` : html`<p class="small sub">이미 진행된 예약이라 상태는 그대로 두고 금액만 환불해요.</p>`}
      <${Field} label="환불 금액 (원)"><input class="input num" type="number" min="0" max=${paid} ...${bind('amount')} /><//>
      <${Field} label="처리 사유" hint="기록에 남고, 취소일 때는 손님에게 안내돼요."><textarea class="textarea" ...${bind('reason')}></textarea><//>
      <button class="btn danger lg" disabled=${busy || !v.reason.trim() || v.amount === ''} onClick=${go}>처리하기</button>
    </div>
  <//>`;
}

export function BookingDetail({ code, can }) {
  const s = useLoad(() => api(`/admin/bookings/${code}`), [code]);
  const [modal, setModal] = useState('');
  const [busy, run] = useBusy();
  const close = async () => {
    const reason = await confirmBox({ title: '대리 찾기 처리', message: '호스트 대신 찾기 완료로 바꿔요. 초과 요금이 있으면 함께 계산돼요.', prompt: '처리 사유', yes: '찾기 완료 처리' });
    if (reason) run(async () => { await api(`/admin/bookings/${code}/close`, { method: 'POST', body: { reason } }); await s.reload(); });
  };
  const PAY = { main: '결제', extend: '시간 연장', overdue: '초과 요금', refund: '환불' };
  return html`<${Page} title="예약 상세" actions=${html`<a class="btn ghost sm" href="#/bookings">← 목록</a>`}>
    <${Loading} s=${s}>${() => {
      const { booking: b, spot, host, payments, logs, messages, checkins, incident } = s.data;
      return html`<div class="grid2"><div>
        <div class="panel">
          <div class="row between"><h2 class="num">${b.code}</h2><${StatusBadge} status=${b.status} /></div>
          <div class="kv mt8"><span>스팟</span><span>${spot.name}</span></div>
          <div class="kv"><span>호스트</span><span><a href="#/hosts/${host.id}" style="text-decoration:underline">${host.name}</a> · ${host.phone}</span></div>
          <div class="kv"><span>손님</span><span>${b.guest.name}${b.guest.country ? ` (${b.guest.country})` : ''} · ${LANG_KO[b.lang] || b.lang}</span></div>
          <div class="kv"><span>이메일</span><span>${b.guest.email}</span></div>${b.guest.phone ? html`<div class="kv"><span>연락처</span><span>${b.guest.phone}</span></div>` : null}
          <div class="kv"><span>맡기는 시각</span><span>${fmtLocal(b.drop)}</span></div><div class="kv"><span>찾는 시각</span><span>${fmtLocal(b.pick)}</span></div>
          <div class="kv"><span>상품</span><span>${PLAN[b.plan]}${b.plan === 'long' ? ` ${b.days}일` : ''} · ${linesText(b)}</span></div>
          <div class="kv"><span>짐</span><span>${bagsText(b.bags)} (${b.units}칸)</span></div>
          ${b.tag_no ? html`<div class="kv"><span>번호표</span><span>${b.tag_no}</span></div>` : null}
          ${b.cancel_reason ? html`<div class="note mt8">취소(${{ guest: '손님', host: '호스트', admin: '운영자', system: '자동' }[b.cancel_by] || '-'}): ${b.cancel_reason}</div>` : null}
          ${incident ? html`<div class="note a mt8">사고 접수 건이 있어요. <a href="#/incidents" class="b" style="text-decoration:underline">사고·보상에서 보기</a></div>` : null}
          ${can('bookings') ? html`<div class="row fw mt12">
            ${!['cancelled', 'expired', 'hold'].includes(b.status) ? html`<button class="btn danger" onClick=${() => setModal('refund')}>취소·환불</button>` : null}
            ${['stored', 'overdue'].includes(b.status) ? html`<button class="btn line" disabled=${busy} onClick=${close}>대리 찾기 처리</button>` : null}</div>` : null}
        </div>
        <div class="panel"><h2>금액</h2><p class="tiny mute">수수료 기준: 보관분 ${b.fee.a}% + 추가분 ${b.fee.b}%, 최소 ${won(b.fee.c)} (예약 시점 값)</p><div class="mt8"><${MoneyRows} b=${b} /></div>
          ${b.settlement_id ? html`<p class="tiny mute mt8">정산 #${b.settlement_id}에 포함됨</p>` : null}</div>
        <div class="panel"><h2>결제 기록</h2><${Table} rows=${payments} cols=${[{ label: '시각', render: (p) => fmtIso(p.created_at), cls: 'nowrap' }, { label: '구분', render: (p) => PAY[p.kind] || p.kind },
          { label: '수단', render: (p) => (p.provider === 'test' ? '테스트' : '포트원') }, { label: '금액', render: (p) => won(p.amount), cls: 'r num' }, { label: '메모', key: 'note' }]} /></div>
      </div><div>
        ${checkins.some((c) => c.photos.length) ? html`<div class="panel"><h2>맡을 때 찍은 사진</h2><div class="photos mt8">${checkins.flatMap((c) => c.photos).map((src) => html`<a class="ph" href=${src} target="_blank"><img src=${src} alt="" /></a>`)}</div></div>` : null}
        <div class="panel"><h2>메시지</h2><div class="mt8"><${Thread} messages=${messages.map((m, i) => ({ ...m, id: i }))} me="host" /></div></div>
        <div class="panel"><h2>처리 기록</h2><ul class="mt8 small">${logs.map((l) => html`<li class="kv"><span>${fmtIso(l.created_at)}</span><span>${{ hold: '예약 시작', pending: '결제(승인 대기)', confirmed: '예약 확정', stored: '맡기기 완료', overdue: '미수령', done: '찾기 완료', cancelled: '취소' }[l.status] || l.status} · ${{ guest: '손님', host: '호스트', admin: '운영자', system: '자동' }[l.by_kind] || l.by_kind}${l.note ? ` · ${l.note}` : ''}</span></li>`)}</ul></div>
      </div></div>
      ${modal === 'refund' ? html`<${RefundModal} b=${b} onClose=${() => setModal('')} onDone=${() => { setModal(''); s.reload(); }} />` : null}`;
    }}<//>
  <//>`;
}

// ---------- 정산 ----------
const SETTLE_ST = { ready: ['지급 예정', 'p'], hold: ['보류', 'a'], paid: ['지급 완료', 'g'] };
function lastMonth() {
  const [y, m] = kstNow().month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
export function Settlements({ can }) {
  const [month, setMonth] = useState(lastMonth());
  const [filter, setFilter] = useState('');
  const s = useLoad(() => api(`/admin/settlements?status=${filter}`), [filter]);
  const [detail, setDetail] = useState(null);
  const [busy, run] = useBusy();
  const generate = async () => {
    if (!(await confirmBox({ title: '정산 만들기', message: `${month}까지 끝난 예약을 호스트별로 모아 정산 내역을 만들어요.\n사고 조사 중인 예약과 최소 지급액에 못 미치는 호스트는 다음으로 넘어가요.`, yes: '만들기' }))) return;
    run(async () => { const r = await api('/admin/settlements/generate', { method: 'POST', body: { month } }); toast(`정산 ${r.created}건을 만들었어요. (이월 ${r.carried} · 이미 있음 ${r.skipped})`); await s.reload(); });
  };
  const setSt = async (t, status) => {
    let reason = '';
    if (status === 'hold') { reason = await confirmBox({ title: '지급 보류', message: `${t.host_name} · ${won(t.payout)}`, prompt: '보류 사유', yes: '보류' }); if (!reason) return; }
    else if (!(await confirmBox({ title: status === 'paid' ? '지급 완료' : '보류 해제', message: `${t.host_name} · ${won(t.payout)}\n${status === 'paid' ? `${t.bank_name} ${t.bank_account} (${t.bank_holder})로 보낸 뒤 눌러 주세요. 되돌릴 수 없어요.` : '지급 예정으로 되돌려요.'}`, yes: '확인' }))) return;
    run(async () => { await api(`/admin/settlements/${t.id}/status`, { method: 'POST', body: { status, reason } }); await s.reload(); });
  };
  const open = (t) => api(`/admin/settlements/${t.id}`).then(setDetail).catch((e) => toast(e.message, 'err'));
  return html`<${Page} title="정산" sub="매달 1일에 지난달 내역을 만들고, 이체를 마친 뒤 지급 완료로 표시해요. 실제 이체는 은행에서 직접 해야 해요.">
    <${Loading} s=${s}>${() => html`
      <div class="grid2">
        <${Stat} label="아직 정산에 들어가지 않은 금액" value=${won(s.data.unsettled.amount)} sub=${`예약 ${s.data.unsettled.n}건`} />
        <div class="stat"><span class="label">정산 만들기</span>
          <div class="row mt8"><input class="input sm" type="month" value=${month} max=${lastMonth()} onChange=${(e) => setMonth(e.target.value)} style="width:auto" />
            <button class="btn primary sm" disabled=${busy || !can('settle')} onClick=${generate}>이 달까지 정산 만들기</button></div></div>
      </div>
      <div class="panel mt16">
        <div class="toolbar"><select class="select sm" value=${filter} onChange=${(e) => setFilter(e.target.value)}><option value="">전체</option><option value="ready">지급 예정</option><option value="hold">보류</option><option value="paid">지급 완료</option></select></div>
        <${Table} rows=${s.data.settlements} empty="정산 내역이 없어요." cols=${[
          { label: '정산 월', key: 'month' }, { label: '호스트', render: (t) => html`<b>${t.host_name}</b><br /><span class="tiny mute">${t.bank_account ? `${t.bank_name} ${t.bank_account} (${t.bank_holder})` : '계좌 미등록'}</span>` },
          { label: '예약', render: (t) => html`<button style="text-decoration:underline" onClick=${() => open(t)}>${t.booking_count}건</button>`, cls: 'r' },
          { label: '판매 금액', render: (t) => won(t.gross), cls: 'r num' }, { label: '수수료', render: (t) => won(t.fee), cls: 'r num' }, { label: '조정', render: (t) => (t.adjust ? won(t.adjust) : '-'), cls: 'r num' },
          { label: '지급액', render: (t) => html`<b>${won(t.payout)}</b>`, cls: 'r num' },
          { label: '상태', render: (t) => html`<span class="badge ${SETTLE_ST[t.status][1]}">${SETTLE_ST[t.status][0]}</span>${t.hold_reason ? html`<br /><span class="tiny mute">${t.hold_reason}</span>` : ''}` },
          { label: '', cls: 'r nowrap', render: (t) => (can('settle') && t.status !== 'paid' ? html`${t.status === 'ready' ? html`<button class="btn primary sm" disabled=${busy} onClick=${() => setSt(t, 'paid')}>지급 완료</button> <button class="btn line sm" disabled=${busy} onClick=${() => setSt(t, 'hold')}>보류</button>` : html`<button class="btn line sm" disabled=${busy} onClick=${() => setSt(t, 'ready')}>보류 해제</button>`}` : null) }]} />
      </div>
      ${detail ? html`<${Modal} title=${`${detail.settlement.host_name} · ${detail.settlement.month}`} wide onClose=${() => setDetail(null)}>
        <${Table} rows=${detail.bookings} onRow=${(b) => { setDetail(null); nav(`/bookings/${b.code}`); }} cols=${[{ label: '끝난 날', render: (b) => fmtIso(b.closed_at), cls: 'nowrap' }, { label: '예약번호', key: 'code', cls: 'num' },
          { label: '상태', render: (b) => html`<${StatusBadge} status=${b.status} />` }, { label: '보관분', render: (b) => won(b.storage_amount), cls: 'r num' }, { label: '추가분', render: (b) => won(b.addon_amount), cls: 'r num' },
          { label: '수수료', render: (b) => won(b.fee_amount), cls: 'r num' }, { label: '정산', render: (b) => won(b.payout_amount), cls: 'r num' }]} />
        ${detail.charges.map((c) => html`<div class="kv"><span>사고 부담액 (${c.code})</span><span class="num">− ${won(c.host_charge)}</span></div>`)}
      <//>` : null}`}<//>
  <//>`;
}

// ---------- 사고·보상 ----------
const INC_ST = { received: ['호스트 소명 대기', 'r'], replied: ['판정 대기', 'a'], judged: ['판정 완료', 'b'], closed: ['종결', ''] };
const INC_KIND = { damaged: '파손', lost: '분실', other: '기타' };
const VERDICT = { host: '호스트 책임', guest: '손님 책임(보상 없음)', shared: '일부 책임', none: '책임 없음(확인 불가)' };
function VerdictForm({ i, onDone }) {
  const [v, bind, setV] = useForm({ verdict: i.verdict || 'host', comp_amount: i.comp_amount || '', host_charge: i.host_charge || '', note: i.verdict_note || '' });
  const [busy, run] = useBusy();
  const save = (close) => run(async () => {
    await api(`/admin/incidents/${i.id}/verdict`, { method: 'POST', body: { ...v, comp_amount: Number(v.comp_amount) || 0, host_charge: Number(v.host_charge) || 0, close } });
    toast(close ? '종결했어요. 호스트 부담액은 다음 정산에서 빠져요.' : '판정을 저장했어요.');
    onDone();
  });
  return html`<div class="col gap12 mt12" style="border-top:1px solid var(--line);padding-top:12px">
    <div class="form-grid">
      <${Field} label="판정"><select class="select" value=${v.verdict} onChange=${(e) => setV({ ...v, verdict: e.target.value })}>${Object.entries(VERDICT).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select><//>
      <${Field} label="보상액 (원)" hint="기본 보장 한도 안에서"><input class="input num" type="number" min="0" ...${bind('comp_amount')} /><//>
      <${Field} label="그중 호스트 부담액 (원)" hint="종결하면 호스트의 다음 정산에서 빠져요."><input class="input num" type="number" min="0" ...${bind('host_charge')} /><//>
      <${Field} label="판정 근거" hint="손님과 호스트에게 보여요."><textarea class="textarea" ...${bind('note')}></textarea><//>
    </div>
    <div class="row"><button class="btn line" disabled=${busy} onClick=${() => save(0)}>판정 저장</button><button class="btn primary" disabled=${busy} onClick=${() => save(1)}>종결</button></div>
    <p class="tiny mute">보상금은 이 화면에서 자동으로 보내지지 않아요. 손님에게 따로 지급한 뒤 종결해 주세요.</p>
  </div>`;
}
export function Incidents({ can }) {
  const [status, setStatus] = useState('');
  const s = useLoad(() => api(`/admin/incidents?status=${status}`), [status]);
  return html`<${Page} title="사고·보상" sub="접수 → 맡길 때 사진과 대조 → 호스트 소명 → 판정 → 보상 → 정산 반영 순서로 처리해요.">
    <div class="toolbar"><select class="select sm" value=${status} onChange=${(e) => setStatus(e.target.value)}><option value="">전체</option>${Object.entries(INC_ST).map(([k, [l]]) => html`<option value=${k}>${l}</option>`)}</select></div>
    <${Loading} s=${s}>${() => (s.data.incidents.length ? s.data.incidents.map((i) => html`<div class="panel" key=${i.id}>
      <div class="row between"><h2>${INC_KIND[i.kind]} · <a href="#/bookings/${i.code}" class="num" style="text-decoration:underline">${i.code}</a> · ${i.spot_name}</h2><span class="badge ${INC_ST[i.status][1]}">${INC_ST[i.status][0]}</span></div>
      <p class="tiny mute mt4">손님 ${i.guest_name} (${i.guest_email}) · 호스트 ${i.host_name} · 접수 ${fmtIso(i.created_at)}${i.claim_amount ? ` · 청구 ${won(i.claim_amount)}` : ''}</p>
      <div class="grid2 mt12">
        <div><p class="label">손님이 알린 내용</p><p class="pre mt4">${i.body}</p>
          ${i.photos.length ? html`<div class="photos mt8">${i.photos.map((src) => html`<a class="ph" href=${src} target="_blank"><img src=${src} alt="" /></a>`)}</div>` : null}
          <a class="small b mt8" style="display:inline-block;color:var(--p-d)" href="#/bookings/${i.code}">맡길 때 사진과 대조하기 →</a></div>
        <div><p class="label">호스트 소명 ${i.host_replied_at ? '' : `(기한 ${fmtIso(i.host_reply_due)})`}</p><p class="pre mt4">${i.host_reply || html`<span class="mute">아직 답하지 않았어요.</span>`}</p></div>
      </div>
      ${i.status === 'closed' ? html`<div class="note mt12"><b>${VERDICT[i.verdict]}</b> · 보상 ${won(i.comp_amount)} · 호스트 부담 ${won(i.host_charge)}${i.verdict_note ? html`<p class="pre mt4">${i.verdict_note}</p>` : null}</div>`
        : can('incidents') ? html`<${VerdictForm} i=${i} onDone=${s.reload} />` : null}
    </div>`) : html`<div class="panel"><div class="empty small"><img src="/assets/img/jimbo-guard.svg" alt="" />접수된 사고가 없어요.</div></div>`)}<//>
  <//>`;
}

// ---------- 리뷰 ----------
export function Reviews({ can }) {
  const s = useLoad(() => api('/admin/reviews'), []);
  const [busy, run] = useBusy();
  const hide = (r) => run(async () => { await api(`/admin/reviews/${r.id}/hide`, { method: 'POST', body: { hidden: r.hidden ? 0 : 1 } }); await s.reload(); });
  return html`<${Page} title="리뷰" sub="욕설·개인정보·광고가 담긴 리뷰는 숨길 수 있어요. 숨기면 평점에서도 빠져요.">
    <div class="panel"><${Loading} s=${s}>${() => html`<${Table} rows=${s.data.reviews} cols=${[
      { label: '날짜', render: (r) => fmtIso(r.created_at), cls: 'nowrap' }, { label: '스팟', key: 'spot_name' }, { label: '별점', render: (r) => html`<${Stars} value=${r.rating} />`, cls: 'nowrap' },
      { label: '내용', render: (r) => html`${r.body}${r.reply ? html`<br /><span class="tiny mute">호스트 답글: ${r.reply}</span>` : ''}` }, { label: '작성자', render: (r) => `${r.guest_name} ${r.guest_country}` },
      { label: '', cls: 'r', render: (r) => html`${r.hidden ? html`<span class="badge r">숨김</span> ` : ''}${can('cs') ? html`<button class="btn line sm" disabled=${busy} onClick=${() => hide(r)}>${r.hidden ? '다시 보이기' : '숨기기'}</button>` : ''}` }]} />`}<//></div>
  <//>`;
}

// ---------- 문의 ----------
export function Inquiries({ can }) {
  const s = useLoad(() => api('/admin/inquiries'), []);
  const [open, setOpen] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, run] = useBusy();
  const send = () => run(async () => { await api(`/admin/inquiries/${open.id}/reply`, { method: 'POST', body: { reply } }); toast('답변을 보냈어요.'); setOpen(null); setReply(''); await s.reload(); });
  return html`<${Page} title="문의" sub="답변은 문의한 사람의 이메일로 전달돼요.">
    <div class="panel"><${Loading} s=${s}>${() => html`<${Table} rows=${s.data.inquiries} onRow=${(q) => { setOpen(q); setReply(q.reply || ''); }} cols=${[
      { label: '접수', render: (q) => fmtIso(q.created_at), cls: 'nowrap' }, { label: '보낸 사람', render: (q) => html`${q.name} <span class="badge">${q.who === 'host' ? '호스트' : '손님'}</span><br /><span class="tiny mute">${q.email}</span>` },
      { label: '언어', render: (q) => LANG_KO[q.lang] || q.lang }, { label: '내용', render: (q) => q.body.slice(0, 60) }, { label: '예약', key: 'booking_code', cls: 'num' },
      { label: '상태', render: (q) => html`<span class="badge ${q.status === 'open' ? 'a' : 'g'}">${q.status === 'open' ? '답변 대기' : '답변 완료'}</span>` }]} />`}<//></div>
    ${open ? html`<${Modal} title="문의 답변" wide onClose=${() => setOpen(null)}>
      <p class="tiny mute">${open.name} · ${open.email} · ${LANG_KO[open.lang] || open.lang}${open.booking_code ? html` · <a href="#/bookings/${open.booking_code}" style="text-decoration:underline">${open.booking_code}</a>` : ''}</p>
      <div class="note mt8 pre">${open.body}</div>
      <textarea class="textarea mt12" style="min-height:140px" placeholder="답변 내용 (문의한 언어로 써 주세요)" value=${reply} onInput=${(e) => setReply(e.target.value)} disabled=${!can('cs')}></textarea>
      ${can('cs') ? html`<button class="btn primary mt12" disabled=${busy || !reply.trim()} onClick=${send}>${open.status === 'open' ? '답변 보내기' : '다시 보내기'}</button>` : null}
    <//>` : null}
  <//>`;
}
