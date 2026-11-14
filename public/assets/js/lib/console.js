// 호스트센터·Admin이 함께 쓰는 화면 부품
import { html, render, useState, useEffect, Modal, won, fmtLocal, fmtIso } from '/assets/js/lib/core.js';

// ---------- 주소(#/...) ----------
export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, q] = raw.split('?');
  return { path: p.split('/').filter(Boolean), query: new URLSearchParams(q || '') };
}
export function useHash() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const fn = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);
  return route;
}
export const nav = (to) => { location.hash = to; };

// ---------- 이름 ----------
export const ST = { hold: '결제 대기', pending: '승인 대기', confirmed: '예약 확정', stored: '보관 중', overdue: '미수령', done: '찾기 완료', cancelled: '취소', noshow: '노쇼', expired: '만료' };
const ST_CLS = { hold: 'a', pending: 'a', confirmed: 'p', stored: 'g', overdue: 'r', done: '', cancelled: '', noshow: 'r', expired: '' };
export const StatusBadge = ({ status }) => html`<span class="badge ${ST_CLS[status] || ''}">${ST[status] || status}</span>`;
export const SIZE = { s: '소형', m: '일반', l: '대형' };
export const PLAN = { short: '잠깐', day: '하루', long: '오래' };
export const CATS = { cafe: '카페', restaurant: '음식점', cvs: '편의점', shop: '상점', stay: '숙소', home: '가정집', space: '공간', etc: '기타' };
export const HOST_TYPE = { store: '매장형', stay: '숙소형', home: '가정형', space: '공간형' };
export const HOST_ST = { draft: '작성 중', applied: '심사 대기', approved: '승인', rejected: '반려', suspended: '이용 정지' };
export const SPOT_ST = { draft: '준비 중', live: '공개 중', paused: '비공개', blocked: '운영 중지', review: '검토 중' };
export const LANG_KO = { ko: '한국어', en: '영어', ja: '일본어', 'zh-hans': '중국어(간체)', 'zh-hant': '중국어(번체)' };
export const bagsText = (bags) => ['s', 'm', 'l'].filter((k) => bags[k]).map((k) => `${SIZE[k]} ${bags[k]}`).join(' · ') || '-';
export const linesText = (b) => b.lines.map((l) => (l.type === 'bundle' ? `${l.name} ×${l.qty}` : `${SIZE[l.size]} ×${l.qty}`)).join(', ');
export const hm = (local) => (local || '').slice(11, 16);
export const dayLabel = (local) => fmtLocal(local, 'ko', false);
export { won, fmtLocal, fmtIso };

// ---------- 부품 ----------
export function Page({ title, sub, actions, children }) {
  return html`<div class="main-in">
    <div class="page-head"><div><h1>${title}</h1>${sub ? html`<p>${sub}</p>` : null}</div>${actions ? html`<div class="row fw">${actions}</div>` : null}</div>
    ${children}
  </div>`;
}
export function Table({ cols, rows, onRow, empty = '내역이 없어요.' }) {
  if (!rows || !rows.length) return html`<div class="empty small">${empty}</div>`;
  return html`<div class="tbl-wrap"><table class="tbl">
    <thead><tr>${cols.map((c) => html`<th class=${c.cls || ''}>${c.label}</th>`)}</tr></thead>
    <tbody>${rows.map((r, i) => html`<tr class=${onRow ? 'click' : ''} onClick=${onRow ? () => onRow(r) : undefined} key=${r.id ?? r.code ?? i}>
      ${cols.map((c) => html`<td class=${c.cls || ''}>${c.render ? c.render(r) : r[c.key]}</td>`)}
    </tr>`)}</tbody>
  </table></div>`;
}
export const Field = ({ label, hint, children, cls = '' }) => html`<div class="field ${cls}"><label>${label}</label>${children}${hint ? html`<span class="hint">${hint}</span>` : null}</div>`;
export const Stat = ({ label, value, sub, tone = '', href }) =>
  href
    ? html`<a class="stat ${tone}" href=${href}><span class="label">${label}</span><b>${value}</b>${sub ? html`<small>${sub}</small>` : null}</a>`
    : html`<div class="stat ${tone}"><span class="label">${label}</span><b>${value}</b>${sub ? html`<small>${sub}</small>` : null}</div>`;
export const Switch = ({ on, onChange, label }) => html`<button type="button" class="row" onClick=${() => onChange(!on)} role="switch" aria-checked=${on}>
  <span class="switch ${on ? 'on' : ''}"></span>${label ? html`<span class="small b">${label}</span>` : null}</button>`;

/** 폼 상태 도우미: const [v, bind, setV] = useForm(초깃값) → <input ...${bind('name')} /> */
export function useForm(init) {
  const [v, setV] = useState(init);
  const bind = (k) => ({ value: v[k] ?? '', onInput: (e) => setV((s) => ({ ...s, [k]: e.target.value })) });
  return [v, bind, setV];
}

/** 확인 창. 예/아니오를 Promise로 돌려줍니다. prompt를 주면 사유 입력란이 함께 나옵니다. */
export function confirmBox({ title = '확인', message, yes = '확인', danger = false, prompt = '' }) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const close = (val) => {
      render(null, host);
      host.remove();
      resolve(val);
    };
    function Box() {
      const [text, setText] = useState('');
      return html`<${Modal} title=${title} onClose=${() => close(false)}>
        <p class="pre">${message}</p>
        ${prompt ? html`<textarea class="textarea mt12" placeholder=${prompt} value=${text} onInput=${(e) => setText(e.target.value)}></textarea>` : null}
        <div class="row mt16" style="justify-content:flex-end">
          <button class="btn line" onClick=${() => close(false)}>닫기</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" disabled=${prompt && !text.trim()} onClick=${() => close(prompt ? text.trim() : true)}>${yes}</button>
        </div>
      <//>`;
    }
    render(html`<${Box} />`, host);
  });
}

/** 예약 금액 내역 */
export function MoneyRows({ b, showFee = true }) {
  return html`<div>
    <div class="kv"><span>보관분</span><span class="num">${won(b.storage_amount)}</span></div>
    ${b.addon_amount ? html`<div class="kv"><span>추가분</span><span class="num">${won(b.addon_amount)}</span></div>` : null}
    <div class="kv"><span>결제 금액</span><span class="num">${won(b.total_amount)}</span></div>
    ${b.refund_amount ? html`<div class="kv"><span>환불</span><span class="num">− ${won(b.refund_amount)}</span></div>` : null}
    ${b.overdue_amount ? html`<div class="kv"><span>초과 요금</span><span class="num">${won(b.overdue_amount)}${b.overdue_paid < b.overdue_amount ? ` (미납 ${won(b.overdue_amount - b.overdue_paid)})` : ''}</span></div>` : null}
    ${showFee ? html`<div class="kv"><span>백스톱 수수료</span><span class="num">− ${won(b.fee_amount)}</span></div>
      <div class="kv total"><span>정산 금액</span><span class="num">${won(b.payout_amount)}</span></div>` : null}
  </div>`;
}

export function Thread({ messages, me }) {
  if (!messages.length) return html`<p class="small sub">주고받은 메시지가 없어요.</p>`;
  return html`<div class="thread">${messages.map((m) => html`<div class="msg ${m.sender === me ? 'me' : ''}" key=${m.id}>
    <p>${m.sender === me ? m.body : m.translated || m.body}</p>
    ${m.translated ? html`<p class="tiny orig">${m.sender === me ? `번역: ${m.translated}` : `원문: ${m.body}`}</p>` : null}
    <span class="tiny mute">${m.sender === 'guest' ? '손님' : m.sender === 'host' ? '호스트' : '안내'} · ${fmtIso(m.created_at)}</span>
  </div>`)}</div>`;
}
