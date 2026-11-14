// 호스트센터 설정 화면: 호스트 신청, 스팟 정보, 받는 시간·물량, 가격, 세트·추가 서비스
import { html, useState, useEffect, useRef, api, useLoad, Spinner, useBusy, toast, toastErr, PhotoPicker, Modal, loadScript, loadCss, minToHM, fileToDataUrl, kstNow, TILE, TILE_ATTR } from '/assets/js/lib/core.js';
import { Page, Field, Switch, confirmBox, useForm, won, SIZE, CATS, HOST_TYPE, HOST_ST, SPOT_ST } from '/assets/js/lib/console.js';

const SIZES = ['s', 'm', 'l'];
const WD = [1, 2, 3, 4, 5, 6, 0];
const WD_NAME = ['일', '월', '화', '수', '목', '금', '토'];
const TIMES = Array.from({ length: 49 }, (_, i) => i * 30);
const NeedSpot = () => html`<div class="panel"><div class="empty small"><img src="/assets/img/jimbo-hi.svg" alt="" />먼저 스팟 정보를 저장해 주세요.<br /><a class="btn primary sm mt12" href="#/spot">스팟 정보 입력하기</a></div></div>`;

// ---------- 호스트 신청 ----------
function DocUpload({ label, hint, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(f, 1600, 0.82);
      onChange((await api('/host/files', { method: 'POST', body: { dataUrl, scope: 'private' } })).id);
    } catch (err) {
      toastErr(err);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Field} label=${label} hint=${hint}>
    <div class="row">
      <label class="btn line sm">${busy ? '올리는 중…' : value ? '다시 올리기' : '파일 고르기'}<input type="file" accept="image/*,application/pdf" class="hide" onChange=${pick} disabled=${busy} /></label>
      ${value ? html`<a class="small b" style="color:var(--green)" href="/api/files/${value}" target="_blank">올린 파일 보기 ✓</a>` : html`<span class="small mute">사진이나 PDF</span>`}
    </div>
  <//>`;
}

export function Apply({ me, reload }) {
  const h = me.host;
  const [v, bind, setV] = useForm({ name: h.name, phone: h.phone, type: h.type, biz_name: h.biz_name, biz_no: h.biz_no, rep_name: h.rep_name, doc_file: h.doc_file, doc2_file: h.doc2_file });
  const [busy, run] = useBusy();
  const editable = ['draft', 'rejected'].includes(h.status);
  const biz = ['store', 'stay'].includes(v.type);
  const save = (apply) => run(async () => {
    await api('/host/profile', { method: 'PUT', body: v });
    if (apply) {
      await api('/host/apply', { method: 'POST' });
      toast('신청했어요. 심사 결과는 이메일로 알려 드려요.');
    } else toast('저장했어요.');
    reload();
  });
  const tone = { draft: '', applied: 'a', approved: 'g', rejected: 'r', suspended: 'r' }[h.status];
  return html`<${Page} title="호스트 신청 정보" sub="서류를 확인한 뒤 승인되면 스팟을 공개할 수 있어요.">
    <div class="note ${tone}" style="margin-bottom:14px"><b>지금 상태: ${HOST_ST[h.status]}</b>
      ${h.status === 'applied' ? ' — 운영팀이 서류를 확인하고 있어요. 그동안 스팟 정보를 채워 두세요.' : ''}
      ${h.status === 'rejected' ? html`<p class="mt4">반려 사유: ${h.reject_reason} — 내용을 고쳐 다시 신청할 수 있어요.</p>` : ''}
      ${h.status === 'suspended' ? html`<p class="mt4">사유: ${h.reject_reason}</p>` : ''}</div>
    <div class="panel col gap12">
      <h2>호스트 유형</h2>
      <div class="grid2">${Object.entries(HOST_TYPE).map(([k, label]) => html`<label class="prod-pick ${v.type === k ? 'on' : ''}">
        <input type="radio" name="type" checked=${v.type === k} disabled=${!editable} onChange=${() => setV({ ...v, type: k })} />
        <div><p class="b">${label}</p><p class="small sub">${{ store: '카페·음식점·편의점·상점 등 사업자등록을 한 매장', stay: '게스트하우스·호텔 등 숙박업 신고를 한 숙소', home: '개인 주거 공간 (시범 운영 — 순서대로 심사해요)', space: '사무실·창고 등 그 밖의 공간 (시범 운영)' }[k]}</p></div>
      </label>`)}</div>
      <style>.prod-pick{display:flex;gap:10px;border:1.5px solid var(--line);border-radius:12px;padding:12px;cursor:pointer}.prod-pick.on{border-color:var(--p);background:var(--p-t)}.prod-pick input{accent-color:var(--p);margin-top:4px}</style>
    </div>
    <div class="panel">
      <h2>신청자 정보</h2>
      <div class="form-grid mt12">
        <${Field} label="이름"><input class="input" ...${bind('name')} /><//>
        <${Field} label="연락처"><input class="input" type="tel" ...${bind('phone')} placeholder="010-0000-0000" /><//>
        ${biz ? html`
          <${Field} label="상호"><input class="input" ...${bind('biz_name')} disabled=${!editable} /><//>
          <${Field} label="대표자 이름"><input class="input" ...${bind('rep_name')} disabled=${!editable} /><//>
          <${Field} label="사업자등록번호" hint="숫자 10자리"><input class="input num" ...${bind('biz_no')} disabled=${!editable} inputmode="numeric" /><//>` : null}
      </div>
      ${editable ? html`<div class="col gap12 mt16">
        <${DocUpload} label=${biz ? '사업자등록증' : '본인 확인 서류'} hint=${biz ? '' : '신분증의 주민등록번호 뒷자리는 가리고 올려 주세요.'} value=${v.doc_file} onChange=${(id) => setV({ ...v, doc_file: id })} />
        ${v.type === 'stay' ? html`<${DocUpload} label="숙박업 영업신고증(또는 등록증)" value=${v.doc2_file} onChange=${(id) => setV({ ...v, doc2_file: id })} />` : null}
        ${v.type === 'home' ? html`<div class="note a">가정형은 공동주택 관리 규약과 안전 문제를 따로 확인해야 해서 시범 운영 중이에요. 식품이 들어간 세트는 팔 수 없고, 정확한 주소는 예약이 확정된 손님에게만 보여요.</div>` : null}
      </div>` : null}
      <div class="row mt16"><button class="btn line" disabled=${busy} onClick=${() => save(false)}>저장</button>
        ${editable ? html`<button class="btn primary" disabled=${busy} onClick=${() => save(true)}>${h.status === 'rejected' ? '다시 신청하기' : '신청하기'}</button>` : null}</div>
    </div>
  <//>`;
}

// ---------- 스팟 정보 ----------
function MapPicker({ lat, lng, center, onPick }) {
  const box = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  useEffect(() => {
    loadCss('/assets/vendor/leaflet.css');
    loadScript('/assets/vendor/leaflet.js').then(() => {
      if (!box.current) return;
      const L = window.L;
      map.current = L.map(box.current).setView(lat != null ? [lat, lng] : center, lat != null ? 17 : 14);
      L.tileLayer(TILE, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map.current);
      const icon = L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [0, 0] });
      if (lat != null) marker.current = L.marker([lat, lng], { icon }).addTo(map.current);
      map.current.on('click', (e) => {
        if (marker.current) marker.current.setLatLng(e.latlng);
        else marker.current = L.marker(e.latlng, { icon }).addTo(map.current);
        onPick(Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6);
      });
    });
    return () => map.current && map.current.remove();
  }, []);
  useEffect(() => { if (map.current && lat == null) map.current.setView(center, 14); }, [center.join(',')]);
  return html`<div class="mappick" ref=${box}></div>`;
}

export function SpotInfo({ me, reload }) {
  const s = useLoad(() => api('/host/spot'), []);
  const [v, bind, setV] = useForm(null);
  const [photos, setPhotos] = useState([]);
  const [busy, run] = useBusy();
  useEffect(() => {
    if (!s.data) return;
    const sp = s.data.spot || { name: '', name_en: '', category: 'cafe', address: '', address_en: '', address_detail: '', lat: null, lng: null, phone: '', intro: '', intro_en: '', guide: '', guide_en: '', rules: '', instant_confirm: 1, overnight_units: 0, cancel_deadline_h: 0, zone_id: s.data.zones[0]?.id || '', photos: [] };
    setV(sp);
    setPhotos((sp.photos || []).map((id) => ({ id, url: `/api/files/${id}` })));
  }, [s.data]);
  if (s.loading || !v) return html`<${Page} title="스팟 정보"><${Spinner} /><//>`;
  const zones = s.data.zones;
  const zone = zones.find((z) => z.id === Number(v.zone_id)) || zones[0];
  const upload = async (dataUrl) => (await api('/host/files', { method: 'POST', body: { dataUrl, scope: 'public' } })).id;
  const save = () => run(async () => {
    const r = await api('/host/spot', { method: 'PUT', body: { ...v, photos: photos.map((p) => p.id) } });
    toast(r.stopped?.length ? `저장했어요. 조건이 맞지 않게 된 세트(${r.stopped.join(', ')})는 판매를 멈췄어요.` : '저장했어요.');
    await s.reload();
    reload();
  });
  const publish = (on) => run(async () => {
    const r = await api('/host/spot/publish', { method: 'POST', body: { on } });
    toast(r.status === 'live' ? '스팟을 공개했어요. 이제 예약을 받을 수 있어요.' : '스팟을 비공개로 바꿨어요.');
    await s.reload();
    reload();
  });
  const st = s.data.spot?.status;
  return html`<${Page} title="스팟 정보" sub="손님이 보는 내용이에요. 영어 칸을 채우면 외국 손님에게 그대로 보여요."
    actions=${s.data.spot ? html`<span class="badge ${st === 'live' ? 'g' : st === 'blocked' ? 'r' : ''}">${SPOT_ST[st]}</span>
      ${st === 'live' ? html`<button class="btn line sm" disabled=${busy} onClick=${() => publish(false)}>비공개로</button>` : st !== 'blocked' ? html`<button class="btn primary sm" disabled=${busy} onClick=${() => publish(true)}>공개하기</button>` : null}` : null}>
    ${me.missing?.length && st !== 'live' ? html`<div class="note a" style="margin-bottom:14px">공개하려면 더 필요해요: ${me.missing.join(', ')}</div>` : null}
    <div class="panel">
      <h2>기본 정보</h2>
      <div class="form-grid mt12">
        <${Field} label="스팟 이름"><input class="input" ...${bind('name')} placeholder="예: 연남 모먼트 커피" /><//>
        <${Field} label="영어 이름"><input class="input" ...${bind('name_en')} placeholder="Yeonnam Moment Coffee" /><//>
        <${Field} label="업종"><select class="select" value=${v.category} onChange=${(e) => setV({ ...v, category: e.target.value })}>${Object.entries(CATS).map(([k, label]) => html`<option value=${k}>${label}</option>`)}</select><//>
        <${Field} label="지역" hint="지역마다 가격 기준이 달라요."><select class="select" value=${v.zone_id} onChange=${(e) => setV({ ...v, zone_id: Number(e.target.value) })}>${zones.map((z) => html`<option value=${z.id}>${z.name}</option>`)}</select><//>
        <${Field} label="전화번호"><input class="input" type="tel" ...${bind('phone')} /><//>
        <${Field} label="사진 (첫 장이 대표 사진)" cls="full"><${PhotoPicker} value=${photos} onChange=${setPhotos} upload=${upload} max=${8} label="사진 추가" /><//>
      </div>
    </div>
    <div class="panel">
      <h2>위치</h2>
      <div class="form-grid mt12">
        <${Field} label="주소"><input class="input" ...${bind('address')} placeholder="도로명 주소" /><//>
        <${Field} label="영어 주소"><input class="input" ...${bind('address_en')} /><//>
        <${Field} label="상세 위치"><input class="input" ...${bind('address_detail')} placeholder="예: 2층, 엘리베이터 없음" /><//>
        <${Field} label="지도 위치" hint=${v.lat != null ? `찍은 위치: ${v.lat}, ${v.lng}` : '지도에서 가게 입구를 눌러 주세요.'} cls="full">
          <${MapPicker} lat=${v.lat} lng=${v.lng} center=${[zone.lat, zone.lng]} onPick=${(lat, lng) => setV((x) => ({ ...x, lat, lng }))} /><//>
        <${Field} label="찾아오는 길"><textarea class="textarea" ...${bind('guide')} placeholder="가까운 역 출구, 눈에 띄는 표지 등"></textarea><//>
        <${Field} label="찾아오는 길 (영어)"><textarea class="textarea" ...${bind('guide_en')}></textarea><//>
      </div>
    </div>
    <div class="panel">
      <h2>소개와 운영 방식</h2>
      <div class="form-grid mt12">
        <${Field} label="소개"><textarea class="textarea" ...${bind('intro')}></textarea><//>
        <${Field} label="소개 (영어)"><textarea class="textarea" ...${bind('intro_en')}></textarea><//>
        <${Field} label="우리 스팟만의 안내" hint="예: 계단이 있어 30kg 넘는 짐은 받기 어려워요." cls="full"><textarea class="textarea" ...${bind('rules')}></textarea><//>
        <div class="field"><label>예약 확정 방식</label>
          <${Switch} on=${!!v.instant_confirm} onChange=${(on) => setV({ ...v, instant_confirm: on ? 1 : 0 })} label=${v.instant_confirm ? '즉시 확정 (결제하면 바로 확정)' : '승인 후 확정 (호스트가 확인하고 승인)'} />
          <span class="hint">즉시 확정이 예약이 더 잘 들어와요.</span></div>
        <${Field} label="준비형 세트 취소 마감 (시간)" hint="미리 준비하는 세트는 맡기는 시각 몇 시간 전부터 추가분을 환불하지 않을지 정해요. 0이면 쓰지 않아요. (최대 24)">
          <input class="input num" type="number" min="0" max="24" ...${bind('cancel_deadline_h')} /><//>
      </div>
    </div>
    ${s.data.spot ? html`<${StickerPanel} spot=${s.data.spot} />` : null}
    <div class="row" style="position:sticky;bottom:12px;justify-content:flex-end"><button class="btn primary lg" disabled=${busy} onClick=${save} style="box-shadow:var(--shadow)">저장</button></div>
  <//>`;
}

// ---------- 가게 문 스티커 ----------
// 외국인 손님이 가게 앞에서 바로 알아보도록 'BAG STOP' 스티커를 만들어 줍니다. QR을 찍으면 이 스팟 예약 화면으로 갑니다.
const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
async function buildSticker(spot) {
  await loadScript('/assets/vendor/qrcode.js');
  const url = `${location.origin}/en/spot/${spot.slug}`;
  const qr = window.qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const size = 330, cell = size / n;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${(c * cell).toFixed(2)} ${(r * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
  const mascot = (await (await fetch('/assets/img/jimbo-hi.svg')).text()).replace('<svg ', '<svg x="60" y="650" width="390" height="429" ');
  const F = "Pretendard, 'Noto Sans KR', 'Apple SD Gothic Neo', 'Noto Sans CJK KR', sans-serif";
  const name = esc(spot.name_en ? `${spot.name} · ${spot.name_en}` : spot.name);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1414" viewBox="0 0 1000 1414" font-family="${F}">
  <rect width="1000" height="1414" rx="48" fill="#fff"/>
  <rect width="1000" height="380" rx="48" fill="#E8613C"/><rect y="330" width="1000" height="50" fill="#E8613C"/>
  <text x="500" y="225" text-anchor="middle" font-size="168" font-weight="900" fill="#fff" letter-spacing="4">BAG STOP</text>
  <text x="500" y="312" text-anchor="middle" font-size="38" font-weight="700" fill="#fff" fill-opacity="0.92">Luggage storage · 짐 보관 · 荷物預かり · 行李寄存</text>
  <text x="500" y="492" text-anchor="middle" font-size="78" font-weight="900" fill="#26221F">Bags welcome here</text>
  <text x="500" y="562" text-anchor="middle" font-size="38" font-weight="600" fill="#6B645E">${name}</text>
  ${mascot}
  <rect x="510" y="640" width="430" height="500" rx="32" fill="#fff" stroke="#E8613C" stroke-width="6"/>
  <g transform="translate(560,680)"><rect x="-10" y="-10" width="${size + 20}" height="${size + 20}" fill="#fff"/><path d="${path}" fill="#26221F"/></g>
  <text x="725" y="1070" text-anchor="middle" font-size="44" font-weight="900" fill="#26221F">Scan to book</text>
  <text x="725" y="1114" text-anchor="middle" font-size="28" font-weight="600" fill="#6B645E">예약 · 予約 · 预订 · 預訂</text>
  <rect x="60" y="1200" width="880" height="2" fill="#E9E4DE"/>
  <text x="500" y="1290" text-anchor="middle" font-size="62" font-weight="900" fill="#E8613C">Leave it with us.</text>
  <text x="500" y="1350" text-anchor="middle" font-size="28" font-weight="600" fill="#9A928A">${esc(location.host)}</text>
</svg>`;
}

function StickerPanel({ spot }) {
  const [svg, setSvg] = useState('');
  useEffect(() => { buildSticker(spot).then(setSvg).catch(() => setSvg('')); }, [spot.slug, spot.name, spot.name_en]);
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = `bagstop-sticker-${spot.slug}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const print = () => {
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>BAG STOP 스티커</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>@page{size:A5;margin:0}html,body{margin:0}svg{display:block;width:100%;height:auto}</style></head>
<body>${svg}<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`;
    const w = window.open(URL.createObjectURL(new Blob([page], { type: 'text/html' })), '_blank');
    if (!w) toast('팝업이 막혀 있어요. 브라우저에서 팝업을 허용해 주세요.', 'err');
  };
  return html`<div class="panel">
    <div class="row between top fw"><div><h2>가게 문 스티커</h2><p class="sub">문이나 계산대 옆에 붙여 두면 외국인 손님이 바로 알아봐요. QR을 찍으면 이 스팟 예약 화면이 열려요.</p></div>
      <div class="row"><button class="btn line sm" disabled=${!svg} onClick=${download}>SVG 내려받기</button><button class="btn primary sm" disabled=${!svg} onClick=${print}>인쇄하기 (A5)</button></div></div>
    ${spot.status !== 'live' ? html`<p class="small mute mt8">스팟을 공개해야 QR 예약 화면이 열려요. 미리 인쇄해 두셔도 돼요.</p>` : null}
    <div class="sticker-preview mt12" dangerouslySetInnerHTML=${{ __html: svg }}></div>
  </div>`;
}

// ---------- 받는 시간·물량 ----------
export function Hours({ reload }) {
  const s = useLoad(() => api('/host/spot'), []);
  const [blocks, setBlocks] = useState([]);
  const [closures, setClosures] = useState([]);
  const [overnight, setOvernight] = useState(0);
  const [newDate, setNewDate] = useState('');
  const [busy, run] = useBusy();
  useEffect(() => {
    if (!s.data?.spot) return;
    setBlocks(s.data.blocks.map((b) => ({ ...b })));
    setClosures(s.data.closures);
    setOvernight(s.data.spot.overnight_units);
  }, [s.data]);
  if (s.loading) return html`<${Page} title="받는 시간·물량"><${Spinner} /><//>`;
  if (!s.data.spot) return html`<${Page} title="받는 시간·물량"><${NeedSpot} /><//>`;
  const u = s.data.units;
  const set = (b, patch) => setBlocks(blocks.map((x) => (x === b ? { ...x, ...patch } : x)));
  const add = (w) => {
    const day = blocks.filter((b) => b.weekday === w).sort((a, b) => a.start_min - b.start_min);
    const start = day.length ? Math.min(day[day.length - 1].end_min + 60, 1380) : 600;
    setBlocks([...blocks, { weekday: w, start_min: start, end_min: Math.min(start + (day.length ? 180 : 600), 1440), units: day[0]?.units || 4, allow_drop: 1, allow_pick: 1 }]);
  };
  const copyAll = (w) => {
    const src = blocks.filter((b) => b.weekday === w);
    setBlocks(WD.flatMap((d) => src.map((b) => ({ ...b, weekday: d }))));
    toast(`${WD_NAME[w]}요일 설정을 모든 요일에 복사했어요. 저장을 눌러야 반영돼요.`);
  };
  const save = () => run(async () => {
    await api('/host/spot/blocks', { method: 'PUT', body: { blocks } });
    const c = await api('/host/spot/closures', { method: 'PUT', body: { dates: closures } });
    if (Number(overnight) !== s.data.spot.overnight_units) await api('/host/spot', { method: 'PUT', body: { ...s.data.spot, overnight_units: overnight } });
    toast(c.conflicts?.length ? `저장했어요. 휴무일에 이미 잡힌 예약이 ${c.conflicts.length}건 있어요. 예약 화면에서 확인해 주세요.` : '저장했어요.');
    await s.reload();
    reload();
  });
  return html`<${Page} title="받는 시간·물량" sub="요일과 시간대마다 받을 수 있는 칸 수를 정해요. 그만큼만 예약이 들어와요.">
    <div class="note" style="margin-bottom:14px">짐 크기별로 차지하는 칸: 소형 ${u.s}칸 · 일반 ${u.m}칸 · 대형 ${u.l}칸. 칸 수를 줄여도 이미 받은 예약은 그대로 남아요.</div>
    <div class="panel">
      <h2>요일별 시간 블록</h2>
      ${WD.map((w) => {
        const day = blocks.filter((b) => b.weekday === w).sort((a, b) => a.start_min - b.start_min);
        return html`<div class="day-row"><b>${WD_NAME[w]}</b><div>
          ${day.length ? day.map((b) => html`<div class="blk-row">
            <select class="select num" value=${b.start_min} onChange=${(e) => set(b, { start_min: Number(e.target.value) })}>${TIMES.slice(0, 48).map((m) => html`<option value=${m}>${minToHM(m)}</option>`)}</select>
            <span class="mute">–</span>
            <select class="select num" value=${b.end_min} onChange=${(e) => set(b, { end_min: Number(e.target.value) })}>${TIMES.slice(1).map((m) => html`<option value=${m}>${m === 1440 ? '24:00' : minToHM(m)}</option>`)}</select>
            <input class="input units num" type="number" min="0.5" step="0.5" value=${b.units} onInput=${(e) => set(b, { units: Number(e.target.value) })} aria-label="칸 수" /><span class="small sub">칸</span>
            <button type="button" class="tgl ${b.allow_drop ? 'on' : ''}" onClick=${() => set(b, { allow_drop: b.allow_drop ? 0 : 1 })}>맡기기</button>
            <button type="button" class="tgl ${b.allow_pick ? 'on' : ''}" onClick=${() => set(b, { allow_pick: b.allow_pick ? 0 : 1 })}>찾기</button>
            <button type="button" class="btn ghost sm" onClick=${() => setBlocks(blocks.filter((x) => x !== b))} aria-label="지우기">지우기</button>
          </div>`) : html`<p class="small mute" style="padding:8px 0">쉬는 날</p>`}
          <div class="row"><button type="button" class="btn line sm" onClick=${() => add(w)}>+ 시간 추가</button>
            ${day.length ? html`<button type="button" class="btn ghost sm" onClick=${() => copyAll(w)}>모든 요일에 복사</button>` : null}</div>
        </div></div>`;
      })}
    </div>
    <div class="grid2 mt16">
      <div class="panel col gap12"><h2>밤새 보관 물량</h2>
        <p class="small sub">영업이 끝난 뒤에도 가게에 둘 수 있는 칸 수예요. 0이면 손님은 영업시간 안에 찾아가야 하고, 여러 날 맡기는 예약은 받을 수 없어요.</p>
        <div class="row"><input class="input num" style="width:110px" type="number" min="0" step="0.5" value=${overnight} onInput=${(e) => setOvernight(Number(e.target.value))} /><span class="small sub">칸</span></div></div>
      <div class="panel col gap12"><h2>쉬는 날</h2>
        <div class="row"><input class="input" type="date" min=${kstNow().date} value=${newDate} onChange=${(e) => setNewDate(e.target.value)} />
          <button class="btn line" disabled=${!newDate || closures.some((c) => c.date === newDate)} onClick=${() => { setClosures([...closures, { date: newDate, reason: '' }].sort((a, b) => a.date.localeCompare(b.date))); setNewDate(''); }}>추가</button></div>
        ${closures.length ? html`<div class="row fw">${closures.map((c) => html`<span class="chip">${c.date}<button onClick=${() => setClosures(closures.filter((x) => x !== c))} aria-label="지우기">×</button></span>`)}</div>` : html`<p class="small mute">따로 정한 휴무일이 없어요.</p>`}</div>
    </div>
    <div class="row mt16" style="position:sticky;bottom:12px;justify-content:flex-end"><button class="btn primary lg" disabled=${busy} onClick=${save} style="box-shadow:var(--shadow)">저장</button></div>
  <//>`;
}

// ---------- 가격 ----------
export function Prices({ reload }) {
  const s = useLoad(() => api('/host/spot'), []);
  const [rows, setRows] = useState(null);
  const [errors, setErrors] = useState([]);
  const [busy, run] = useBusy();
  useEffect(() => {
    if (!s.data?.spot) return;
    const r = {};
    for (const k of SIZES) {
      const p = s.data.prices[k];
      r[k] = p ? { on: true, short_price: p.short_price, day_price: p.day_price, week_price: p.week_price ?? '', month_price: p.month_price ?? '' } : { on: false, short_price: '', day_price: '', week_price: '', month_price: '' };
    }
    setRows(r);
  }, [s.data]);
  if (s.loading) return html`<${Page} title="가격"><${Spinner} /><//>`;
  if (!s.data.spot) return html`<${Page} title="가격"><${NeedSpot} /><//>`;
  if (!rows) return null;
  const zone = s.data.zones.find((z) => z.id === s.data.spot.zone_id);
  const fee = s.data.fee;
  const set = (k, f, val) => setRows({ ...rows, [k]: { ...rows[k], [f]: val } });
  const save = () => run(async () => {
    setErrors([]);
    const body = {};
    for (const k of SIZES) if (rows[k].on) body[k] = rows[k];
    try {
      const r = await api('/host/spot/prices', { method: 'PUT', body });
      toast(r.stopped?.length ? `저장했어요. 조건이 맞지 않게 된 세트(${r.stopped.join(', ')})는 판매를 멈췄어요.` : '가격을 저장했어요.');
      await s.reload();
      reload();
    } catch (e) {
      setErrors(e.data?.errors || [e.message]);
    }
  });
  const cell = (k, f, ph) => html`<input class="input num" type="number" step="100" min="0" placeholder=${ph} value=${rows[k][f]} disabled=${!rows[k].on} onInput=${(e) => set(k, f, e.target.value)} />`;
  return html`<${Page} title="가격" sub="가격은 호스트가 정해요. 백스톱은 지역 기준가와 정할 수 있는 범위만 알려 드려요.">
    ${zone ? html`<div class="note p" style="margin-bottom:14px"><b>${zone.name} 지역 기준</b> — 하루 가격을 아래 범위 안에서 정해 주세요. (100원 단위)
      <div class="row fw gap16 mt4">${SIZES.map((k) => html`<span>${SIZE[k]} <b class="num">${won(zone.band[k].min)} ~ ${won(zone.band[k].max)}</b> <span class="tiny">(기준가 ${won(zone.band[k].base)})</span></span>`)}</div></div>`
      : html`<div class="note a" style="margin-bottom:14px">먼저 스팟 정보에서 지역을 골라 주세요.</div>`}
    <div class="panel">
      ${SIZES.map((k) => {
        const day = Number(rows[k].day_price) || 0;
        const f = day ? Math.max(Math.round((day * fee.a) / 100), fee.c) : 0;
        return html`<div style="padding:14px 0;border-bottom:1px solid var(--line)">
          <div class="row between"><div><h2>${SIZE[k]}</h2><p class="small sub">${{ s: '배낭·쇼핑백', m: '기내용~24인치 캐리어', l: '25인치 이상·긴 짐' }[k]}</p></div>
            <${Switch} on=${rows[k].on} onChange=${(on) => set(k, 'on', on)} label=${rows[k].on ? '받아요' : '안 받아요'} /></div>
          <div class="grid4 keep2 mt12">
            <${Field} label="잠깐 (4시간 이내)">${cell(k, 'short_price', '필수')}<//>
            <${Field} label="하루">${cell(k, 'day_price', '필수')}<//>
            <${Field} label="1주 (선택)">${cell(k, 'week_price', '비우면 하루×일수')}<//>
            <${Field} label="1달 (선택)">${cell(k, 'month_price', '비우면 주 단위')}<//>
          </div>
          ${rows[k].on && day ? html`<p class="tiny mute mt8">하루 ${won(day)}에 팔면 수수료 ${won(f)}, 정산 ${won(day - f)}</p>` : null}
        </div>`;
      })}
      <p class="tiny mute mt12">규칙: 잠깐 &lt; 하루, 1주 &lt; 하루×7, 1달 &lt; 1주×4. 수수료는 보관분 ${fee.a}% · 추가분 ${fee.b}% · 건당 최소 ${won(fee.c)}이에요.</p>
      ${errors.length ? html`<div class="note r mt12">${errors.map((e) => html`<p>${e}</p>`)}</div>` : null}
      <div class="row mt16" style="justify-content:flex-end"><button class="btn primary lg" disabled=${busy} onClick=${save}>저장</button></div>
    </div>
  <//>`;
}

// ---------- 세트·추가 서비스·혜택 ----------
function AddonForm({ item, onClose, onSaved }) {
  const [v, bind, setV] = useForm(item || { name: '', name_en: '', price: '', note: '', prepared: 0 });
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    const r = await api(item ? `/host/addons/${item.id}` : '/host/addons', { method: item ? 'PUT' : 'POST', body: { ...v, price: Number(v.price) } });
    if (r.stopped?.length) toast(`조건이 맞지 않게 된 세트(${r.stopped.join(', ')})는 판매를 멈췄어요.`);
    onSaved();
  });
  return html`<${Modal} title=${item ? '추가 서비스 고치기' : '추가 서비스 만들기'} onClose=${onClose}>
    <div class="col gap12">
      <${Field} label="이름"><input class="input" ...${bind('name')} placeholder="예: 아메리카노" /><//>
      <${Field} label="영어 이름"><input class="input" ...${bind('name_en')} placeholder="Americano" /><//>
      <${Field} label="정가 (원)" hint="매장에서 평소 받는 가격"><input class="input num" type="number" step="100" ...${bind('price')} /><//>
      <label class="check"><input type="checkbox" checked=${!!v.prepared} onChange=${(e) => setV({ ...v, prepared: e.target.checked ? 1 : 0 })} /><span>미리 준비해야 하는 상품이에요 <span class="sub">(취소 마감 뒤에는 이 금액을 환불하지 않아요)</span></span></label>
      <button class="btn primary" disabled=${busy || !v.name || !Number(v.price)} onClick=${save}>저장</button>
    </div>
  <//>`;
}

function BundleForm({ item, addons, prices, fee, onClose, onSaved }) {
  const [v, bind, setV] = useForm(item || { name: '짐앤', name_en: '', size: prices.m ? 'm' : Object.keys(prices)[0], period: 'short', addon_id: addons[0]?.id, addon_qty: 1, price: '' });
  const [busy, run] = useBusy();
  const addon = addons.find((a) => a.id === Number(v.addon_id));
  const p = prices[v.size];
  const storage = p ? (v.period === 'short' ? p.short_price : p.day_price) : 0;
  const list = storage + (addon ? addon.price * Number(v.addon_qty || 1) : 0);
  const price = Number(v.price) || 0;
  const ok = price > 0 && price % 100 === 0 && price < list;
  const sStorage = list ? Math.round((price * storage) / list) : 0;
  const feeAmt = ok ? Math.min(price, Math.max(Math.round((sStorage * fee.a) / 100 + ((price - sStorage) * fee.b) / 100), fee.c)) : 0;
  const save = () => run(async () => {
    await api(item ? `/host/bundles/${item.id}` : '/host/bundles', { method: item ? 'PUT' : 'POST', body: { ...v, price, addon_id: Number(v.addon_id), addon_qty: Number(v.addon_qty) } });
    onSaved();
  });
  return html`<${Modal} title=${item ? '세트 고치기' : '세트 만들기'} onClose=${onClose}>
    <div class="col gap12">
      <div class="form-grid">
        <${Field} label="세트 이름" hint="'짐앤○○'처럼 지으면 알아보기 쉬워요."><input class="input" ...${bind('name')} placeholder="짐앤커피" /><//>
        <${Field} label="영어 이름"><input class="input" ...${bind('name_en')} placeholder="Bag & Coffee" /><//>
        <${Field} label="짐 크기"><select class="select" value=${v.size} onChange=${(e) => setV({ ...v, size: e.target.value })}>${SIZES.filter((k) => prices[k]).map((k) => html`<option value=${k}>${SIZE[k]} 짐 1개</option>`)}</select><//>
        <${Field} label="보관 기간"><select class="select" value=${v.period} onChange=${(e) => setV({ ...v, period: e.target.value })}><option value="short">잠깐 (4시간 이내)</option><option value="day">하루</option></select><//>
        <${Field} label="추가 서비스"><select class="select" value=${v.addon_id} onChange=${(e) => setV({ ...v, addon_id: Number(e.target.value) })}>${addons.map((a) => html`<option value=${a.id}>${a.name} (${won(a.price)})</option>`)}</select><//>
        <${Field} label="수량"><input class="input num" type="number" min="1" max="10" ...${bind('addon_qty')} /><//>
      </div>
      <${Field} label="세트 가격 (원)" hint=${`따로 살 때 ${won(list)}보다 낮아야 해요. (보관 ${won(storage)} + ${addon?.name || '추가 서비스'} ${won(list - storage)})`}><input class="input num" type="number" step="100" ...${bind('price')} /><//>
      ${price > 0 ? (ok ? html`<div class="note g">
          <div class="kv"><span>손님 할인</span><span class="num">${won(list - price)}</span></div>
          <div class="kv"><span>보관분 / 추가분</span><span class="num">${won(sStorage)} / ${won(price - sStorage)}</span></div>
          <div class="kv"><span>백스톱 수수료</span><span class="num">− ${won(feeAmt)}</span></div>
          <div class="kv total"><span>세트 1개 정산</span><span class="num">${won(price - feeAmt)}</span></div>
        </div>` : html`<div class="note r">${price % 100 ? '100원 단위로 입력해 주세요.' : `세트 가격은 ${won(list)}보다 낮아야 해요.`}</div>`) : null}
      <button class="btn primary" disabled=${busy || !ok || !v.name.trim()} onClick=${save}>저장</button>
    </div>
  <//>`;
}

export function Products() {
  const s = useLoad(() => api('/host/spot'), []);
  const [modal, setModal] = useState(null);
  const [benefits, setBenefits] = useState([]);
  const [busy, run] = useBusy();
  useEffect(() => { if (s.data) setBenefits(s.data.benefits.map((b) => ({ text: b.text, text_en: b.text_en }))); }, [s.data]);
  if (s.loading) return html`<${Page} title="세트·추가 서비스"><${Spinner} /><//>`;
  if (!s.data.spot) return html`<${Page} title="세트·추가 서비스"><${NeedSpot} /><//>`;
  const { addons, bundles, prices, fee } = s.data;
  const done = async () => { setModal(null); await s.reload(); };
  const del = async (kind, item) => {
    if (!(await confirmBox({ message: `'${item.name}'을(를) 지울까요?`, yes: '지우기', danger: true }))) return;
    run(async () => { await api(`/host/${kind}/${item.id}`, { method: 'DELETE' }); await s.reload(); });
  };
  const toggle = (b) => run(async () => { await api(`/host/bundles/${b.id}`, { method: 'PUT', body: { ...b, active: b.active ? 0 : 1 } }); await s.reload(); });
  const saveBenefits = () => run(async () => { await api('/host/benefits', { method: 'PUT', body: { items: benefits } }); toast('혜택을 저장했어요.'); await s.reload(); });
  const hasPrice = Object.keys(prices).length > 0;
  return html`<${Page} title="세트·추가 서비스" sub="짐 보관에 우리 가게 메뉴를 묶어 팔 수 있어요. 따로 살 때보다 싸게 정해야 해요.">
    <div class="panel">
      <div class="row between"><div><h2>세트 (짐앤○○)</h2><p class="sub">짐 보관 + 추가 서비스를 묶은 상품</p></div>
        <button class="btn primary sm" disabled=${!addons.length || !hasPrice} onClick=${() => setModal({ bundle: null })}>+ 세트 만들기</button></div>
      ${!hasPrice ? html`<p class="small mute mt12">먼저 가격을 정해 주세요.</p>` : !addons.length ? html`<p class="small mute mt12">먼저 아래에서 추가 서비스를 만들어 주세요.</p>` : null}
      ${bundles.map((b) => html`<div class="bk" key=${b.id}>
        <div class="grow"><p class="b">${b.name} ${b.invalid ? html`<span class="badge r">조건 안 맞음</span>` : b.active ? html`<span class="badge g">판매 중</span>` : html`<span class="badge">판매 중지</span>`}</p>
          <p class="small sub">${SIZE[b.size]} 짐 1개 (${b.period === 'short' ? '잠깐' : '하루'}) + ${addons.find((a) => a.id === b.addon_id)?.name || '?'} ×${b.addon_qty}</p>
          ${b.split ? html`<p class="tiny mute">따로 살 때 ${won(b.split.list)} → <b style="color:var(--ink)">${won(b.price)}</b> (${won(b.split.save)} 할인) · 수수료 ${won(b.fee)} · 정산 ${won(b.payout)}</p>` : null}</div>
        ${b.invalid ? null : html`<${Switch} on=${!!b.active} onChange=${() => toggle(b)} />`}
        <button class="btn line sm" onClick=${() => setModal({ bundle: b })}>고치기</button><button class="btn ghost sm" onClick=${() => del('bundles', b)}>지우기</button>
      </div>`)}
    </div>
    <div class="panel">
      <div class="row between"><div><h2>추가 서비스</h2><p class="sub">세트에 묶을 메뉴나 서비스</p></div><button class="btn line sm" onClick=${() => setModal({ addon: null })}>+ 추가 서비스</button></div>
      ${addons.length ? addons.map((a) => html`<div class="bk" key=${a.id}>
        <div class="grow"><p class="b">${a.name} ${a.prepared ? html`<span class="badge a">미리 준비</span>` : null}</p><p class="small sub">${a.name_en || '영어 이름 없음'} · 정가 ${won(a.price)}</p></div>
        <button class="btn line sm" onClick=${() => setModal({ addon: a })}>고치기</button><button class="btn ghost sm" onClick=${() => del('addons', a)}>지우기</button>
      </div>`) : html`<p class="small mute mt12">아직 없어요. 커피, 식사, 샤워실 이용처럼 짐 맡기는 손님에게 함께 팔 만한 것을 만들어 보세요.</p>`}
    </div>
    <div class="panel col gap12">
      <div><h2>백스톱 혜택</h2><p class="sub">결제 없이 매장에서 직접 드리는 혜택이에요. 스팟 화면에 보여요. (최대 5개)</p></div>
      ${benefits.map((b, i) => html`<div class="row"><input class="input" placeholder="예: 짐 맡긴 손님 아메리카노 500원 할인" value=${b.text} onInput=${(e) => setBenefits(benefits.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
        <input class="input" placeholder="영어 문구" value=${b.text_en} onInput=${(e) => setBenefits(benefits.map((x, j) => (j === i ? { ...x, text_en: e.target.value } : x)))} />
        <button class="btn ghost sm" onClick=${() => setBenefits(benefits.filter((_, j) => j !== i))}>지우기</button></div>`)}
      <div class="row">${benefits.length < 5 ? html`<button class="btn line sm" onClick=${() => setBenefits([...benefits, { text: '', text_en: '' }])}>+ 혜택 추가</button>` : null}<button class="btn primary sm" disabled=${busy} onClick=${saveBenefits}>혜택 저장</button></div>
    </div>
    ${modal && 'addon' in modal ? html`<${AddonForm} item=${modal.addon} onClose=${() => setModal(null)} onSaved=${done} />` : null}
    ${modal && 'bundle' in modal ? html`<${BundleForm} item=${modal.bundle} addons=${addons.filter((a) => a.active)} prices=${prices} fee=${fee} onClose=${() => setModal(null)} onSaved=${done} />` : null}
  <//>`;
}
