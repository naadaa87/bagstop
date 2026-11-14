// 백스톱 Admin 시작점: 설치 확인 → 로그인 → 메뉴와 화면
import { html, render, useState, useEffect, api, useLoad, Spinner, useBusy, toast } from '/assets/js/lib/core.js';
import { useHash, nav, useForm, Field, Page, Stat, Table, StatusBadge, won, fmtLocal, linesText } from '/assets/js/lib/console.js';
import { Hosts, HostDetail, Spots, Bookings, BookingDetail, Settlements, Incidents, Reviews, Inquiries } from './ops.js';
import { Policy, Contents, Notifications, Admins, System } from './config.js';

const MENU = [
  ['운영', [['', '대시보드', 'view'], ['hosts', '호스트 심사', 'view'], ['spots', '스팟', 'view'], ['bookings', '예약', 'view']]],
  ['정산·보상', [['settle', '정산', 'view'], ['incidents', '사고·보상', 'view']]],
  ['고객 응대', [['inquiries', '문의', 'view'], ['reviews', '리뷰', 'view'], ['notifications', '알림 내역', 'view']]],
  ['설정', [['policy', '가격·수수료 정책', 'view'], ['contents', '콘텐츠', 'view'], ['admins', '관리자·기록', 'admins'], ['system', '시스템', 'view']]],
];

// ---------- 설치 ----------
function Setup({ st, reload }) {
  const [v, bind] = useForm({ name: '', email: '', password: '' });
  const [busy, run] = useBusy();
  const prep = () => run(async () => { await api('/admin/setup/db', { method: 'POST' }); toast('DB 준비를 마쳤어요.'); reload(); });
  const create = (e) => { e.preventDefault(); run(async () => { await api('/admin/setup/admin', { method: 'POST', body: v }); toast('관리자를 만들었어요.'); reload(); }); };
  const step = !st.bound ? 1 : !st.ready ? 2 : 3;
  return html`<div class="auth"><div class="auth-card col gap12" style="max-width:480px">
    <img class="hero" src="/assets/img/jimbo-hi.svg" alt="" />
    <div class="logo" style="justify-content:center"><b class="wm">Bag<em>Stop</em></b><small class="console-tag">Admin 설치</small></div>
    <ol class="checklist panel">
      <li><span class="tick ${step > 1 ? 'on' : ''}">${step > 1 ? '✓' : '1'}</span><div class="grow"><p class="b">D1 데이터베이스 연결</p>
        ${step === 1 ? html`<p class="small sub">Cloudflare Pages 프로젝트의 설정 → 바인딩에서 D1 데이터베이스를 변수 이름 <b>DB</b>로 연결한 뒤, 배포를 다시 실행해 주세요.</p>` : html`<p class="small sub">연결됐어요.</p>`}</div></li>
      <li><span class="tick ${step > 2 ? 'on' : ''}">${step > 2 ? '✓' : '2'}</span><div class="grow"><p class="b">DB 준비하기</p>
        <p class="small sub">표를 만들고 기본 정책과 지역, 기본 안내문을 넣어요.</p>
        ${step === 2 ? html`<button class="btn primary mt8" disabled=${busy} onClick=${prep}>DB 준비하기</button>` : null}</div></li>
      <li><span class="tick">3</span><div class="grow"><p class="b">최초 관리자 만들기</p>
        ${step === 3 ? html`<form class="col gap8 mt8" onSubmit=${create}>
          <${Field} label="이름"><input class="input" ...${bind('name')} required /><//>
          <${Field} label="이메일"><input class="input" type="email" ...${bind('email')} required /><//>
          <${Field} label="비밀번호" hint="8자 이상"><input class="input" type="password" ...${bind('password')} required minlength="8" autocomplete="new-password" /><//>
          <button class="btn primary" disabled=${busy}>관리자 만들기</button>
        </form>` : html`<p class="small sub">총괄 권한을 가진 첫 계정이에요.</p>`}</div></li>
    </ol>
    ${step === 1 ? html`<button class="btn line" onClick=${reload}>다시 확인</button>` : null}
  </div></div>`;
}

function Login({ reload }) {
  const [v, bind] = useForm({ email: '', password: '' });
  const [busy, run] = useBusy();
  const submit = (e) => { e.preventDefault(); run(async () => { await api('/admin/login', { method: 'POST', body: v }); reload(); }); };
  return html`<div class="auth"><form class="auth-card col gap12" onSubmit=${submit}>
    <img class="hero" src="/assets/img/jimbo-guard.svg" alt="" />
    <div class="logo" style="justify-content:center"><b class="wm">Bag<em>Stop</em></b><small class="console-tag">Admin</small></div>
    <${Field} label="이메일"><input class="input" type="email" ...${bind('email')} required autocomplete="email" /><//>
    <${Field} label="비밀번호"><input class="input" type="password" ...${bind('password')} required autocomplete="current-password" /><//>
    <button class="btn primary lg" disabled=${busy}>로그인</button>
  </form></div>`;
}

// ---------- 대시보드 ----------
function Dashboard() {
  const s = useLoad(() => api('/admin/dashboard'), []);
  if (s.loading) return html`<${Page} title="대시보드"><${Spinner} /><//>`;
  if (s.error) return html`<${Page} title="대시보드"><div class="empty">${s.error.message}</div><//>`;
  const d = s.data;
  const max = Math.max(1, ...d.daily.map((x) => x.n));
  const todo = [
    ['심사 대기 호스트', d.todo.hosts, '#/hosts?status=applied'], ['처리 중인 사고', d.todo.incidents, '#/incidents'], ['답변 대기 문의', d.todo.inquiries, '#/inquiries'],
    ['지급 전 정산', d.todo.settlements, '#/settle'], ['초과 요금 미납', d.todo.overdue_unpaid, '#/bookings?status=overdue_unpaid'],
  ];
  return html`<${Page} title="대시보드" sub="오늘 처리할 일과 이번 달 흐름을 한눈에 봐요.">
    <div class="grid4 keep2">
      <${Stat} label="오늘 결제된 예약" value=${d.today} tone="p" />
      <${Stat} label="이번 달 예약" value=${d.month.count} />
      <${Stat} label="이번 달 거래액" value=${won(d.month.gmv)} />
      <${Stat} label="이번 달 수수료" value=${won(d.month.fee)} sub="환불 반영 후" />
    </div>
    <div class="panel mt16"><h2>처리할 일</h2>
      <div class="grid4 keep2 mt12" style="grid-template-columns:repeat(5,minmax(0,1fr))">${todo.map(([label, n, href]) => html`<a class="stat ${n ? 'p' : ''}" href=${href} style="padding:12px"><span class="label">${label}</span><b style="font-size:22px">${n}</b></a>`)}</div>
    </div>
    <div class="grid2 mt16">
      <div class="panel"><h2>지금 진행 중</h2>
        <div class="kv mt8"><span>승인 대기</span><span>${d.active.pending || 0}</span></div><div class="kv"><span>예약 확정(방문 전)</span><span>${d.active.confirmed || 0}</span></div>
        <div class="kv"><span>보관 중</span><span>${d.active.stored || 0}</span></div><div class="kv"><span>미수령</span><span>${d.active.overdue || 0}</span></div>
        <div class="kv"><span>공개 중인 스팟</span><span>${d.spots_live}</span></div></div>
      <div class="panel"><h2>최근 14일 예약</h2>
        ${d.daily.length ? html`<div class="bars">${d.daily.map((x) => html`<div title="${x.d} · ${x.n}건"><i style="height:${(x.n / max) * 100}%"></i><span>${x.d.slice(8)}</span></div>`)}</div>` : html`<p class="small sub mt8">아직 예약이 없어요.</p>`}</div>
    </div>
    <div class="panel mt16"><div class="row between"><h2>최근 예약</h2><a class="small b" style="color:var(--p-d)" href="#/bookings">전체 보기</a></div>
      <${Table} rows=${d.recent} onRow=${(b) => nav(`/bookings/${b.code}`)} cols=${[
        { label: '예약번호', key: 'code', cls: 'num' }, { label: '스팟', key: 'spot_name' }, { label: '손님', render: (b) => b.guest.name }, { label: '맡기는 시각', render: (b) => fmtLocal(b.drop), cls: 'nowrap' },
        { label: '상품', render: linesText }, { label: '상태', render: (b) => html`<${StatusBadge} status=${b.status} />` }, { label: '결제', render: (b) => won(b.total_amount), cls: 'r num' }]} /></div>
  <//>`;
}

function Shell({ me, reload, route }) {
  const [open, setOpen] = useState(false);
  const seg = route.path[0] || '';
  useEffect(() => setOpen(false), [route.path.join('/')]);
  const can = (p) => me.perms.includes(p);
  const logout = async () => { await api('/admin/logout', { method: 'POST' }); reload(); };
  const ctx = { me, can, query: route.query };
  const pages = {
    '': () => html`<${Dashboard} />`,
    hosts: () => (route.path[1] ? html`<${HostDetail} id=${route.path[1]} key=${route.path[1]} ...${ctx} />` : html`<${Hosts} ...${ctx} />`),
    spots: () => html`<${Spots} ...${ctx} />`,
    bookings: () => (route.path[1] ? html`<${BookingDetail} code=${route.path[1]} key=${route.path[1]} ...${ctx} />` : html`<${Bookings} ...${ctx} />`),
    settle: () => html`<${Settlements} ...${ctx} />`,
    incidents: () => html`<${Incidents} ...${ctx} />`,
    reviews: () => html`<${Reviews} ...${ctx} />`,
    inquiries: () => html`<${Inquiries} ...${ctx} />`,
    policy: () => html`<${Policy} ...${ctx} />`,
    contents: () => html`<${Contents} ...${ctx} />`,
    notifications: () => html`<${Notifications} />`,
    admins: () => html`<${Admins} ...${ctx} />`,
    system: () => html`<${System} ...${ctx} />`,
  };
  return html`<div class="shell">
    <div class="topbar"><span>백스톱 Admin</span><button class="btn ghost sm" onClick=${() => setOpen(!open)}>메뉴</button></div>
    <aside class="side ${open ? 'open' : ''}">
      <div class="logo"><img src="/favicon.svg" width="28" height="28" alt="" /><b class="wm">Bag<em>Stop</em></b> <small>Admin</small></div>
      ${MENU.map(([group, items]) => html`<h4>${group}</h4>${items.filter((i) => can(i[2])).map(([to, label]) => html`<a class="nav ${seg === to ? 'on' : ''}" href="#/${to}">${label}</a>`)}`)}
      <div class="me"><p class="b">${me.admin.name} <span class="badge">${me.roles[me.admin.role]}</span></p><p class="sub">${me.admin.email}</p>
        <div class="row mt8"><a class="btn line sm" href="/" target="_blank">고객 화면</a><button class="btn ghost sm" onClick=${logout}>로그아웃</button></div></div>
    </aside>
    <main class="main">${(pages[seg] || pages[''])()}</main>
  </div>`;
}

function App() {
  const route = useHash();
  const setup = useLoad(() => api('/admin/setup'), []);
  const me = useLoad(() => api('/admin/me').catch((e) => (e.status === 401 || e.status === 503 ? null : Promise.reject(e))), []);
  if (setup.loading || me.loading) return html`<${Spinner} />`;
  const reload = async () => { await setup.reload(); await me.reload(); };
  if (setup.error) return html`<div class="auth"><div class="auth-card center"><p class="b">${setup.error.message}</p><button class="btn line mt16" onClick=${reload}>다시 시도</button></div></div>`;
  if (!setup.data.bound || !setup.data.ready || !setup.data.hasAdmin) return html`<${Setup} st=${setup.data} reload=${reload} />`;
  if (!me.data) return html`<${Login} reload=${reload} />`;
  return html`<${Shell} me=${me.data} reload=${reload} route=${route} />`;
}

render(html`<${App} />`, document.getElementById('app'));
