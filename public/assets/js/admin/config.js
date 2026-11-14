// Admin 설정 화면: 가격·수수료 정책, 콘텐츠, 알림 내역, 관리자·기록, 시스템
import { html, useState, useEffect, api, useLoad, Spinner, useBusy, toast, Modal } from '/assets/js/lib/core.js';
import { Page, Table, Field, Switch, confirmBox, useForm, won, fmtIso, LANG_KO } from '/assets/js/lib/console.js';

const Loading = ({ s, children }) => (s.loading ? html`<${Spinner} />` : s.error ? html`<div class="empty">${s.error.message}</div>` : children());
const LANGS = ['ko', 'en', 'ja', 'zh-hans', 'zh-hant'];
const ceil100 = (n) => Math.ceil(n / 100) * 100, floor100 = (n) => Math.floor(n / 100) * 100;

// ---------- 가격·수수료 정책 ----------
const RULES = [
  ['short_hours', "'잠깐 맡기기' 기준 시간", '시간'], ['hold_min', '결제 대기 시간', '분'], ['approve_hours', '호스트 승인 기한', '시간'], ['noshow_hours', '노쇼 처리 기준 (맡기는 시각 이후)', '시간'],
  ['overdue_grace_min', '초과 요금 유예 (찾는 시각 이후)', '분'], ['review_days', '리뷰 작성 기간', '일'], ['incident_days', '사고 접수 기간 (찾은 날부터)', '일'], ['incident_reply_hours', '호스트 소명 기한', '시간'],
  ['cover_basic_limit', '기본 보장 한도 (건당)', '원'], ['settle_min_payout', '최소 지급액 (미만은 이월)', '원'], ['settle_pay_day', '정산 지급일 (매달)', '일'], ['max_long_days', '오래 맡기기 최대 기간', '일'], ['max_bags', '한 예약의 최대 짐 개수', '개'],
];

function ZoneForm({ zone, onClose, onSaved }) {
  const blank = { names: {}, intro: {}, lat: 37.5563, lng: 126.97, base_s: 5200, base_m: 8600, base_l: 11900, floor_pct: 60, cap_pct: 150, active: 1, sort: 0, slug: '' };
  const [v, setV] = useState(zone ? { ...zone } : blank);
  const [busy, run] = useBusy();
  const n = (k) => ({ value: v[k], onInput: (e) => setV({ ...v, [k]: e.target.value }) });
  const save = () => run(async () => {
    await api(zone ? `/admin/zones/${zone.id}` : '/admin/zones', { method: zone ? 'PUT' : 'POST', body: v });
    toast('지역을 저장했어요.');
    onSaved();
  });
  return html`<${Modal} title=${zone ? '지역 고치기' : '지역 추가'} wide onClose=${onClose}>
    <div class="col gap12">
      <div class="form-grid">${LANGS.map((l) => html`<${Field} label=${`이름 (${LANG_KO[l]})`}><input class="input" value=${v.names[l] || ''} onInput=${(e) => setV({ ...v, names: { ...v.names, [l]: e.target.value } })} /><//>`)}
        ${zone ? null : html`<${Field} label="주소에 쓸 영문 (예: gangnam)" hint="/area/gangnam 처럼 쓰여요. 만든 뒤에는 바꿀 수 없어요."><input class="input" ...${n('slug')} /><//>`}</div>
      <div class="form-grid">
        <${Field} label="중심 위도"><input class="input num" type="number" step="0.0001" ...${n('lat')} /><//><${Field} label="중심 경도"><input class="input num" type="number" step="0.0001" ...${n('lng')} /><//>
        <${Field} label="기준가 · 소형 (하루)"><input class="input num" type="number" step="100" ...${n('base_s')} /><//><${Field} label="기준가 · 일반 (하루)"><input class="input num" type="number" step="100" ...${n('base_m')} /><//>
        <${Field} label="기준가 · 대형 (하루)"><input class="input num" type="number" step="100" ...${n('base_l')} /><//><${Field} label="정렬 순서"><input class="input num" type="number" ...${n('sort')} /><//>
        <${Field} label="하한 (%)" hint="기준가의 몇 %까지 낮출 수 있는지"><input class="input num" type="number" ...${n('floor_pct')} /><//><${Field} label="상한 (%)" hint="기준가의 몇 %까지 올릴 수 있는지"><input class="input num" type="number" ...${n('cap_pct')} /><//>
      </div>
      <div class="note p">호스트가 정할 수 있는 하루 가격: ${['s', 'm', 'l'].map((k) => `${{ s: '소형', m: '일반', l: '대형' }[k]} ${won(ceil100((v[`base_${k}`] * v.floor_pct) / 100))}~${won(floor100((v[`base_${k}`] * v.cap_pct) / 100))}`).join(' · ')}</div>
      <${Field} label="지역 소개 (한국어)" hint="지역 페이지 위쪽에 보여요. 다른 언어는 저장 후 다시 열어 채울 수 있어요."><textarea class="textarea" value=${v.intro.ko || ''} onInput=${(e) => setV({ ...v, intro: { ...v.intro, ko: e.target.value } })}></textarea><//>
      <${Field} label="지역 소개 (영어)"><textarea class="textarea" value=${v.intro.en || ''} onInput=${(e) => setV({ ...v, intro: { ...v.intro, en: e.target.value } })}></textarea><//>
      <${Switch} on=${!!v.active} onChange=${(on) => setV({ ...v, active: on ? 1 : 0 })} label=${v.active ? '고객 화면에 보여요' : '숨김'} />
      <button class="btn primary" disabled=${busy} onClick=${save}>저장</button>
    </div>
  <//>`;
}

export function Policy({ can }) {
  const s = useLoad(() => api('/admin/policy'), []);
  const [v, bind, setV] = useForm(null);
  const [zone, setZone] = useState(undefined);
  const [busy, run] = useBusy();
  useEffect(() => { if (s.data) setV({ ...s.data.settings }); }, [s.data]);
  if (s.loading || !v) return html`<${Page} title="가격·수수료 정책"><${Spinner} /><//>`;
  const edit = can('policy');
  const save = (keys, msg) => run(async () => {
    await api('/admin/settings', { method: 'PUT', body: Object.fromEntries(keys.map((k) => [k, v[k]])) });
    toast(msg);
    await s.reload();
  });
  const a = Number(v.fee_a) || 0, b = Number(v.fee_b) || 0, c = Number(v.fee_c) || 0;
  const ex = (st, ad) => Math.min(st + ad, Math.max(Math.round((st * a) / 100 + (ad * b) / 100), c));
  const numInput = (k, unit, step = 1) => html`<div class="row"><input class="input num" type="number" step=${step} ...${bind(k)} disabled=${!edit} style="max-width:150px" /><span class="small sub">${unit}</span></div>`;
  return html`<${Page} title="가격·수수료 정책" sub="백스톱은 기준과 범위만 정하고, 가격은 호스트가 그 안에서 정해요. 여기 값은 저장하는 즉시 새 예약부터 적용돼요.">
    <div class="note a" style="margin-bottom:14px">처음 들어 있는 값은 임시 기본값이에요. 사업 조건(수수료율, 보장 한도, PG 정산 방식)이 정해지면 꼭 맞게 바꿔 주세요. ${edit ? '' : '이 화면은 총괄 권한만 고칠 수 있어요.'}</div>
    <div class="grid2">
      <div class="panel col gap12">
        <h2>수수료</h2><p class="sub">건 수수료 = max(보관분 × a + 추가분 × b, c) · 호스트 정산액 = 판매가 − 수수료</p>
        <${Field} label="a · 보관분 수수료율">${numInput('fee_a', '%', 0.5)}<//>
        <${Field} label="b · 추가분(세트 메뉴) 수수료율" hint="a보다 높을 수 없어요.">${numInput('fee_b', '%', 0.5)}<//>
        <${Field} label="c · 건당 최소 수수료">${numInput('fee_c', '원', 100)}<//>
        <div class="note"><b>지금 값으로 계산하면</b>
          <div class="kv"><span>짐만 8,600원</span><span class="num">수수료 ${won(ex(8600, 0))} · 정산 ${won(8600 - ex(8600, 0))}</span></div>
          <div class="kv"><span>세트 9,000원 (보관분 5,143 + 추가분 3,857)</span><span class="num">수수료 ${won(ex(5143, 3857))} · 정산 ${won(9000 - ex(5143, 3857))}</span></div>
          <div class="kv"><span>소형 잠깐 3,000원</span><span class="num">수수료 ${won(ex(3000, 0))} · 정산 ${won(3000 - ex(3000, 0))}</span></div></div>
        ${edit ? html`<button class="btn primary" style="align-self:flex-start" disabled=${busy} onClick=${() => save(['fee_a', 'fee_b', 'fee_c'], '수수료를 저장했어요. 새 예약부터 적용돼요.')}>수수료 저장</button>` : null}
        <p class="tiny mute">이미 받은 예약은 예약할 때의 수수료율로 계산돼요.</p>
      </div>
      <div class="panel col gap12">
        <h2>물량 단위와 사이트 정보</h2><p class="sub">짐 크기별로 차지하는 칸 수</p>
        <div class="grid3"><${Field} label="소형">${numInput('unit_s', '칸', 0.5)}<//><${Field} label="일반">${numInput('unit_m', '칸', 0.5)}<//><${Field} label="대형">${numInput('unit_l', '칸', 0.5)}<//></div>
        <${Field} label="서비스 이름"><input class="input" ...${bind('site_name')} disabled=${!edit} /><//>
        <${Field} label="고객센터 이메일" hint="고객 화면 아래쪽에 보여요."><input class="input" type="email" ...${bind('support_email')} disabled=${!edit} /><//>
        ${edit ? html`<button class="btn primary" style="align-self:flex-start" disabled=${busy} onClick=${() => save(['unit_s', 'unit_m', 'unit_l', 'site_name', 'support_email'], '저장했어요.')}>저장</button>` : null}
      </div>
    </div>
    <div class="panel mt16">
      <div class="row between"><div><h2>지역별 기준가와 범위</h2><p class="sub">호스트는 하루 가격을 기준가의 하한~상한 안에서 100원 단위로 정해요.</p></div>${edit ? html`<button class="btn line sm" onClick=${() => setZone(null)}>+ 지역 추가</button>` : null}</div>
      <${Table} rows=${s.data.zones} onRow=${edit ? (z) => setZone(z) : undefined} cols=${[
        { label: '지역', render: (z) => html`<b>${z.names.ko}</b> <span class="tiny mute">/${z.slug}</span>${z.active ? '' : html` <span class="badge">숨김</span>`}` },
        { label: '기준가 (소형 / 일반 / 대형)', render: (z) => `${won(z.base_s)} / ${won(z.base_m)} / ${won(z.base_l)}`, cls: 'num' },
        { label: '범위', render: (z) => `${z.floor_pct}% ~ ${z.cap_pct}%`, cls: 'num' },
        { label: '일반 하루 허용 가격', render: (z) => `${won(ceil100((z.base_m * z.floor_pct) / 100))} ~ ${won(floor100((z.base_m * z.cap_pct) / 100))}`, cls: 'num' },
        { label: '스팟', key: 'spots', cls: 'r' },
        { label: '범위 밖 가격', render: (z) => (z.out_of_band ? html`<span class="badge r">${z.out_of_band}건</span>` : '-'), cls: 'r' }]} />
      <p class="tiny mute mt8">기준을 바꿔 범위를 벗어나게 된 가격은 자동으로 고쳐지지 않아요. 해당 호스트에게 안내해 주세요.</p>
    </div>
    <div class="panel">
      <h2>운영 기준</h2>
      <div class="grid3 mt12">${RULES.map(([k, label, unit]) => html`<${Field} label=${label}>${numInput(k, unit)}<//>`)}</div>
      ${edit ? html`<button class="btn primary mt16" disabled=${busy} onClick=${() => save(RULES.map((r) => r[0]), '운영 기준을 저장했어요.')}>운영 기준 저장</button>` : null}
    </div>
    ${zone !== undefined ? html`<${ZoneForm} zone=${zone} onClose=${() => setZone(undefined)} onSaved=${() => { setZone(undefined); s.reload(); }} />` : null}
  <//>`;
}

// ---------- 콘텐츠 ----------
const KIND = { faq: '자주 묻는 질문', rules: '보관 규정', terms: '이용약관', privacy: '개인정보 처리방침', host_faq: '호스트 안내', notice: '공지' };
export function Contents({ can }) {
  const [kind, setKind] = useState('faq');
  const [lang, setLang] = useState('ko');
  const s = useLoad(() => api(`/admin/contents?kind=${kind}&lang=${lang}`), [kind, lang]);
  const [item, setItem] = useState(undefined);
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    await api(item.id ? `/admin/contents/${item.id}` : '/admin/contents', { method: item.id ? 'PUT' : 'POST', body: { ...item, kind, lang } });
    toast('저장했어요.');
    setItem(undefined);
    await s.reload();
  });
  const del = async () => {
    if (!(await confirmBox({ message: '이 글을 지울까요?', yes: '지우기', danger: true }))) return;
    run(async () => { await api(`/admin/contents/${item.id}`, { method: 'DELETE' }); setItem(undefined); await s.reload(); });
  };
  return html`<${Page} title="콘텐츠" sub="고객 화면의 도움말과 규정이에요. 해당 언어 글이 없으면 영어 → 한국어 순으로 대신 보여요."
    actions=${can('contents') ? html`<button class="btn primary sm" onClick=${() => setItem({ title: '', body: '', sort: (s.data?.items.length || 0) + 1, published: 1 })}>+ 글 추가</button>` : null}>
    <div class="tabs">${Object.entries(KIND).map(([k, l]) => html`<button class="tab ${kind === k ? 'on' : ''}" onClick=${() => setKind(k)}>${l}</button>`)}</div>
    <div class="panel" style="border-top-left-radius:0;border-top-right-radius:0;border-top:0">
      <div class="toolbar">${LANGS.map((l) => html`<button class="chip ${lang === l ? 'on' : ''}" onClick=${() => setLang(l)}>${LANG_KO[l]}</button>`)}</div>
      <${Loading} s=${s}>${() => html`<${Table} rows=${s.data.items} onRow=${can('contents') ? (x) => setItem({ ...x }) : undefined} empty="이 언어로 쓴 글이 없어요." cols=${[
        { label: '순서', key: 'sort', cls: 'r' }, { label: '제목', render: (x) => html`<b>${x.title}</b>` }, { label: '내용', render: (x) => x.body.slice(0, 70) },
        { label: '상태', render: (x) => html`<span class="badge ${x.published ? 'g' : ''}">${x.published ? '공개' : '숨김'}</span>` }, { label: '고친 날', render: (x) => fmtIso(x.updated_at), cls: 'nowrap' }]} />`}<//>
      ${['terms', 'privacy'].includes(kind) ? html`<p class="tiny mute mt12">약관과 개인정보 처리방침은 초안이 들어 있어요. 운영 전에 법률 검토를 거친 내용으로 바꿔 주세요.</p>` : null}
    </div>
    ${item ? html`<${Modal} title=${`${KIND[kind]} · ${LANG_KO[lang]}`} wide onClose=${() => setItem(undefined)}>
      <div class="col gap12">
        <${Field} label="제목"><input class="input" value=${item.title} onInput=${(e) => setItem({ ...item, title: e.target.value })} /><//>
        <${Field} label="내용"><textarea class="textarea" style="min-height:220px" value=${item.body} onInput=${(e) => setItem({ ...item, body: e.target.value })}></textarea><//>
        <div class="row"><${Field} label="순서"><input class="input num" type="number" style="width:90px" value=${item.sort} onInput=${(e) => setItem({ ...item, sort: e.target.value })} /><//>
          <${Switch} on=${!!item.published} onChange=${(on) => setItem({ ...item, published: on ? 1 : 0 })} label=${item.published ? '공개' : '숨김'} /></div>
        <div class="row between"><button class="btn primary" disabled=${busy || !item.title.trim() || !item.body.trim()} onClick=${save}>저장</button>${item.id ? html`<button class="btn danger sm" disabled=${busy} onClick=${del}>지우기</button>` : null}</div>
      </div>
    <//>` : null}
  <//>`;
}

// ---------- 알림 내역 ----------
export function Notifications() {
  const s = useLoad(() => api('/admin/notifications'), []);
  const [open, setOpen] = useState(null);
  const ST = { sent: ['발송', 'g'], logged: ['기록만', ''], failed: ['실패', 'r'] };
  return html`<${Page} title="알림 내역" sub="손님·호스트에게 나간 메일이에요. 메일 발송 설정 전에는 '기록만' 남아요.">
    <div class="panel"><${Loading} s=${s}>${() => html`<${Table} rows=${s.data.notifications} onRow=${setOpen} cols=${[
      { label: '시각', render: (n) => fmtIso(n.created_at), cls: 'nowrap' }, { label: '받는 사람', render: (n) => html`${n.to_addr} <span class="badge">${n.to_kind === 'host' ? '호스트' : '손님'}</span>` },
      { label: '제목', key: 'subject' }, { label: '상태', render: (n) => html`<span class="badge ${ST[n.status][1]}">${ST[n.status][0]}</span>` }]} />`}<//></div>
    ${open ? html`<${Modal} title=${open.subject} wide onClose=${() => setOpen(null)}><p class="tiny mute">${open.to_addr} · ${fmtIso(open.created_at)}</p><div class="note mt8 pre">${open.body}</div><//>` : null}
  <//>`;
}

// ---------- 관리자·기록 ----------
const PERM_TABLE = [
  ['호스트 심사·스팟 운영 중지', ['owner', 'ops']], ['예약 취소·환불', ['owner', 'ops', 'cs']], ['사고 판정·보상', ['owner', 'ops', 'cs']], ['문의 답변·리뷰 숨김', ['owner', 'ops', 'cs']],
  ['정산 생성·지급·계좌 확인', ['owner', 'finance']], ['콘텐츠 편집', ['owner', 'content']], ['가격·수수료 정책', ['owner']], ['관리자 계정·체험 데이터', ['owner']],
];
export function Admins({ me }) {
  const s = useLoad(() => api('/admin/admins'), []);
  const logs = useLoad(() => api('/admin/audit'), []);
  const [form, setForm] = useState(undefined);
  const [busy, run] = useBusy();
  const roles = me.roles;
  const save = () => run(async () => {
    await api(form.id ? `/admin/admins/${form.id}` : '/admin/admins', { method: form.id ? 'PUT' : 'POST', body: form });
    toast('저장했어요.');
    setForm(undefined);
    await s.reload();
  });
  return html`<${Page} title="관리자·기록" actions=${html`<button class="btn primary sm" onClick=${() => setForm({ name: '', email: '', role: 'ops', password: '', active: 1 })}>+ 관리자 추가</button>`}>
    <div class="panel"><h2>관리자 계정</h2><${Loading} s=${s}>${() => html`<${Table} rows=${s.data.admins} onRow=${(a) => setForm({ ...a, password: '' })} cols=${[
      { label: '이름', render: (a) => html`<b>${a.name}</b>` }, { label: '이메일', key: 'email' }, { label: '역할', render: (a) => html`<span class="badge ${a.role === 'owner' ? 'k' : ''}">${roles[a.role]}</span>` },
      { label: '상태', render: (a) => html`<span class="badge ${a.active ? 'g' : 'r'}">${a.active ? '사용 중' : '사용 중지'}</span>` }, { label: '마지막 로그인', render: (a) => (a.last_login_at ? fmtIso(a.last_login_at) : '-'), cls: 'nowrap' }]} />`}<//></div>
    <div class="panel"><h2>역할별 권한</h2><p class="sub">모든 역할은 화면을 볼 수 있고, 아래 일은 표시된 역할만 할 수 있어요.</p>
      <div class="tbl-wrap"><table class="tbl mt8"><thead><tr><th>할 수 있는 일</th>${Object.values(roles).map((r) => html`<th class="r">${r}</th>`)}</tr></thead>
        <tbody>${PERM_TABLE.map(([label, list]) => html`<tr><td>${label}</td>${Object.keys(roles).map((r) => html`<td class="r">${list.includes(r) ? '●' : ''}</td>`)}</tr>`)}</tbody></table></div></div>
    <div class="panel"><h2>처리 기록</h2><p class="sub">누가 언제 무엇을 바꿨는지 남아요. (최근 300건)</p>
      <${Loading} s=${logs}>${() => html`<${Table} rows=${logs.data.logs} cols=${[{ label: '시각', render: (l) => fmtIso(l.created_at), cls: 'nowrap' }, { label: '관리자', key: 'admin_name' }, { label: '한 일', key: 'action' }, { label: '대상', key: 'target' },
        { label: '내용', render: (l) => html`<span class="tiny mute">${l.detail.slice(0, 90)}</span>` }]} />`}<//></div>
    ${form ? html`<${Modal} title=${form.id ? '관리자 고치기' : '관리자 추가'} onClose=${() => setForm(undefined)}>
      <div class="col gap12">
        <${Field} label="이름"><input class="input" value=${form.name} onInput=${(e) => setForm({ ...form, name: e.target.value })} /><//>
        <${Field} label="이메일"><input class="input" type="email" value=${form.email} disabled=${!!form.id} onInput=${(e) => setForm({ ...form, email: e.target.value })} /><//>
        <${Field} label="역할"><select class="select" value=${form.role} onChange=${(e) => setForm({ ...form, role: e.target.value })}>${Object.entries(roles).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select><//>
        <${Field} label=${form.id ? '새 비밀번호 (바꿀 때만)' : '비밀번호'} hint="8자 이상"><input class="input" type="password" autocomplete="new-password" value=${form.password} onInput=${(e) => setForm({ ...form, password: e.target.value })} /><//>
        ${form.id ? html`<${Switch} on=${!!form.active} onChange=${(on) => setForm({ ...form, active: on ? 1 : 0 })} label=${form.active ? '사용 중' : '사용 중지'} />` : null}
        <button class="btn primary" disabled=${busy || !form.name.trim()} onClick=${save}>저장</button>
      </div>
    <//>` : null}
  <//>`;
}

// ---------- 시스템 ----------
export function System({ can }) {
  const s = useLoad(() => api('/admin/setup'), []);
  const [pw, bindPw, setPw] = useForm({ current: '', password: '' });
  const [demo, setDemo] = useState(null);
  const [busy, run] = useBusy();
  const row = (label, ok, desc) => html`<li><span class="tick ${ok ? 'on' : ''}">${ok ? '✓' : ''}</span><div class="grow"><p class="b">${label}</p><p class="small sub">${desc}</p></div></li>`;
  const savePw = (e) => { e.preventDefault(); run(async () => { await api('/admin/password', { method: 'PUT', body: pw }); toast('비밀번호를 바꿨어요.'); setPw({ current: '', password: '' }); }); };
  const addDemo = () => run(async () => { const r = await api('/admin/demo', { method: 'POST' }); setDemo(r); toast(r.message); });
  const delDemo = async () => {
    if (!(await confirmBox({ title: '체험용 데이터 지우기', message: '체험용 호스트·스팟·예약·리뷰를 모두 지워요. 실제 데이터는 그대로 남아요.', yes: '지우기', danger: true }))) return;
    run(async () => { const r = await api('/admin/demo', { method: 'DELETE' }); setDemo(null); toast(r.deleted ? `체험용 호스트 ${r.deleted}곳과 딸린 데이터를 지웠어요.` : '지울 체험용 데이터가 없어요.'); });
  };
  const rerun = () => run(async () => { await api('/admin/setup/db', { method: 'POST' }); toast('DB 구조를 최신으로 맞췄어요.'); await s.reload(); });
  return html`<${Page} title="시스템" sub="연결 상태를 확인하고, 체험용 데이터를 넣거나 지울 수 있어요.">
    <${Loading} s=${s}>${() => {
      const d = s.data;
      return html`<div class="grid2">
        <div class="panel"><h2>연결 상태</h2><ul class="checklist mt8">
          ${row('데이터베이스 (D1)', d.ready, `구조 버전 ${d.version} / 최신 ${d.latest}`)}
          ${row('결제', d.pay_mode === 'portone', d.pay_mode === 'portone' ? '포트원으로 실제 결제를 받고 있어요.' : '테스트 결제 상태예요. 실제 청구는 일어나지 않아요. PORTONE_STORE_ID · PORTONE_CHANNEL_KEY · PORTONE_API_SECRET 환경 변수를 넣으면 실제 결제로 바뀌어요.')}
          ${row('메일 발송', d.mail, d.mail ? '예약 안내 메일을 보내고 있어요.' : '지금은 발송 기록만 남아요. RESEND_API_KEY · MAIL_FROM 환경 변수를 넣으면 실제로 발송돼요.')}
          ${row('사진 저장소', true, d.files === 'r2' ? 'R2에 저장하고 있어요.' : 'D1에 저장하고 있어요. 사진이 많아지면 R2 버킷을 FILES 이름으로 연결해 주세요.')}
          ${row('메시지 번역', d.ai, d.ai ? 'Workers AI로 번역하고 있어요.' : '번역 없이 원문 그대로 전달돼요. Workers AI를 AI 이름으로 연결하면 자동 번역돼요.')}
          ${row('사이트 주소', !!d.site_url, d.site_url || 'SITE_URL 환경 변수를 넣으면 메일 속 링크와 검색엔진용 주소에 쓰여요.')}
        </ul>
        ${can('admins') ? html`<button class="btn line sm mt12" disabled=${busy} onClick=${rerun}>DB 준비하기 다시 실행</button><p class="tiny mute mt4">새 버전을 올린 뒤 구조가 바뀌었을 때 눌러요. 데이터는 지워지지 않아요.</p>` : null}</div>
        <div>
          ${can('admins') ? html`<div class="panel col gap8"><h2>체험용 데이터</h2><p class="small sub">스팟 6곳과 예약·리뷰를 넣어 화면을 미리 살펴볼 수 있어요. 실제 운영을 시작하기 전에 꼭 지워 주세요.</p>
            <div class="row"><button class="btn primary sm" disabled=${busy} onClick=${addDemo}>체험용 데이터 넣기</button><button class="btn danger sm" disabled=${busy} onClick=${delDemo}>모두 지우기</button></div>
            ${demo?.login ? html`<div class="note p">체험용 호스트 계정으로 <a href="/host/" target="_blank" class="b" style="text-decoration:underline">호스트센터</a>를 살펴볼 수 있어요.<br />이메일 <b>${demo.login.email}</b> · 비밀번호 <b>${demo.login.password}</b></div>` : null}</div>` : null}
          <form class="panel col gap12" onSubmit=${savePw}><h2>내 비밀번호 바꾸기</h2>
            <${Field} label="지금 비밀번호"><input class="input" type="password" ...${bindPw('current')} required autocomplete="current-password" /><//>
            <${Field} label="새 비밀번호" hint="8자 이상"><input class="input" type="password" ...${bindPw('password')} required minlength="8" autocomplete="new-password" /><//>
            <button class="btn line" style="align-self:flex-start" disabled=${busy}>비밀번호 바꾸기</button></form>
        </div>
      </div>`;
    }}<//>
  <//>`;
}
