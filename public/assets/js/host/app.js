// 백스톱 호스트센터 시작점: 로그인 확인 → 메뉴와 화면
import { html, render, useState, useEffect, api, useLoad, Spinner, useBusy, toast } from '/assets/js/lib/core.js';
import { useHash, nav, useForm, Field } from '/assets/js/lib/console.js';
import { Today, Bookings, BookingDetail, Scan, Messages, Reviews, Settlements, SettlementDetail, Incidents, Account } from './ops.js';
import { Apply, SpotInfo, Hours, Prices, Products } from './setup.js';

const MENU = [
  ['운영', [['', '오늘'], ['bookings', '예약'], ['scan', 'QR 체크인'], ['messages', '메시지']]],
  ['스팟 관리', [['spot', '스팟 정보'], ['hours', '받는 시간·물량'], ['prices', '가격'], ['products', '세트·추가 서비스']]],
  ['정산·기록', [['settle', '정산'], ['reviews', '리뷰'], ['incidents', '사고']]],
  ['계정', [['apply', '호스트 신청 정보'], ['account', '계좌·비밀번호']]],
];

function Auth({ mode, onDone }) {
  const [v, bind] = useForm({ email: '', password: '', name: '', phone: '' });
  const [busy, run] = useBusy();
  const signup = mode === 'signup';
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await api(signup ? '/host/signup' : '/host/login', { method: 'POST', body: v });
      nav(signup ? '/apply' : '/');
      onDone();
    });
  };
  return html`<div class="auth"><form class="auth-card col gap12" onSubmit=${submit}>
    <img class="hero" src="/assets/img/jimbo-${signup ? 'love' : 'hi'}.svg" alt="" />
    <div class="logo" style="justify-content:center"><b class="wm">Bag<em>Stop</em></b><small class="console-tag">호스트센터</small></div>
    <p class="sub center small">${signup ? '가입하고 호스트 신청을 시작해요.' : '가게의 남는 자리로 새 손님을 만나 보세요.'}</p>
    ${signup ? html`<${Field} label="이름"><input class="input" ...${bind('name')} required autocomplete="name" /><//>
      <${Field} label="연락처"><input class="input" type="tel" ...${bind('phone')} placeholder="010-0000-0000" required /><//>` : null}
    <${Field} label="이메일"><input class="input" type="email" ...${bind('email')} required autocomplete="email" /><//>
    <${Field} label="비밀번호" hint=${signup ? '8자 이상' : ''}><input class="input" type="password" ...${bind('password')} required minlength="8" autocomplete=${signup ? 'new-password' : 'current-password'} /><//>
    <button class="btn primary lg" disabled=${busy}>${signup ? '가입하기' : '로그인'}</button>
    <p class="center small sub">${signup ? html`이미 가입하셨나요? <a href="#/login" class="b" style="color:var(--p-d)">로그인</a>` : html`처음이신가요? <a href="#/signup" class="b" style="color:var(--p-d)">호스트 가입하기</a>`}</p>
    <p class="center tiny"><a href="/" class="mute">백스톱 홈으로</a></p>
  </form></div>`;
}

function Shell({ me, reload, route }) {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({ unread: 0, incidents: 0, pending: 0 });
  const seg = route.path[0] || '';
  useEffect(() => setOpen(false), [route.path.join('/')]);
  useEffect(() => {
    const tick = () => api('/host/today').then((d) => d.spot && setCounts({ unread: d.unread, incidents: d.incidents, pending: d.pending.length })).catch(() => {});
    tick();
    const timer = setInterval(() => !document.hidden && tick(), 60000);
    return () => clearInterval(timer);
  }, [seg]);
  const badge = { messages: counts.unread, incidents: counts.incidents, bookings: counts.pending };
  const logout = async () => {
    await api('/host/logout', { method: 'POST' });
    nav('/login');
    reload();
  };
  const ctx = { me, reload };
  const pages = {
    '': () => html`<${Today} ...${ctx} />`,
    bookings: () => (route.path[1] ? html`<${BookingDetail} code=${route.path[1]} key=${route.path[1]} />` : html`<${Bookings} query=${route.query} />`),
    scan: () => html`<${Scan} code=${route.path[1] || ''} key=${route.path[1] || 'scan'} />`,
    messages: () => html`<${Messages} />`,
    reviews: () => html`<${Reviews} />`,
    settle: () => (route.path[1] ? html`<${SettlementDetail} id=${route.path[1]} />` : html`<${Settlements} ...${ctx} />`),
    incidents: () => html`<${Incidents} />`,
    account: () => html`<${Account} ...${ctx} />`,
    apply: () => html`<${Apply} ...${ctx} />`,
    spot: () => html`<${SpotInfo} ...${ctx} />`,
    hours: () => html`<${Hours} ...${ctx} />`,
    prices: () => html`<${Prices} ...${ctx} />`,
    products: () => html`<${Products} ...${ctx} />`,
  };
  const page = (pages[seg] || pages[''])();
  return html`<div class="shell">
    <div class="topbar"><span>백스톱 호스트센터</span><span class="small sub">${me.spot?.name || me.host.name}</span></div>
    <aside class="side ${open ? 'open' : ''}">
      <div class="logo"><img src="/favicon.svg" width="28" height="28" alt="" /><b class="wm">Bag<em>Stop</em></b> <small>호스트센터</small></div>
      ${MENU.map(([group, items]) => html`<h4>${group}</h4>${items.map(([to, label]) => html`<a class="nav ${seg === to ? 'on' : ''}" href="#/${to}">${label}${badge[to] ? html`<span class="count">${badge[to]}</span>` : null}</a>`)}`)}
      <div class="me"><p class="b">${me.host.name}</p><p class="sub">${me.host.email}</p>
        <div class="row mt8">${me.spot?.status === 'live' ? html`<a class="btn line sm" href="/ko/spot/${me.spot.slug}" target="_blank">내 스팟 보기</a>` : null}<button class="btn ghost sm" onClick=${logout}>로그아웃</button></div></div>
    </aside>
    <main class="main">${page}</main>
    <nav class="tabbar">
      <a href="#/" class=${seg === '' ? 'on' : ''}><i>◉</i>오늘</a>
      <a href="#/bookings" class=${seg === 'bookings' ? 'on' : ''}><i>☰</i>예약${counts.pending ? html`<span class="count">${counts.pending}</span>` : null}</a>
      <a href="#/scan" class=${seg === 'scan' ? 'on' : ''}><i>▣</i>QR</a>
      <a href="#/messages" class=${seg === 'messages' ? 'on' : ''}><i>✉</i>메시지${counts.unread ? html`<span class="count">${counts.unread}</span>` : null}</a>
      <button onClick=${() => setOpen(!open)}><i>⋯</i>전체</button>
    </nav>
  </div>`;
}

function App() {
  const route = useHash();
  const { data: me, loading, error, reload } = useLoad(() => api('/host/me'), []);
  if (loading) return html`<${Spinner} />`;
  const seg = route.path[0];
  if (error) {
    if (error.status === 401) return html`<${Auth} mode=${seg === 'signup' ? 'signup' : 'login'} onDone=${reload} key=${seg} />`;
    return html`<div class="auth"><div class="auth-card center"><img class="hero" src="/assets/img/jimbo-sorry.svg" alt="" /><p class="b">${error.message}</p><button class="btn line mt16" onClick=${reload}>다시 시도</button></div></div>`;
  }
  if (seg === 'login' || seg === 'signup') nav('/');
  return html`<${Shell} me=${me} reload=${reload} route=${route} />`;
}

render(html`<${App} />`, document.getElementById('app'));
export { toast };
