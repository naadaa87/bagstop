// 짐 맡길 곳 찾기: 목록 + 지도(가격 말풍선)
import { html, useState, useEffect, useRef, api, useLoad, Spinner, loadScript, loadCss, TILE, TILE_ATTR } from '/assets/js/lib/core.js';
import { S, t, Link, go, zoneName, money, SpotCard } from './shared.js';

export function loadLeaflet() {
  loadCss('/assets/vendor/leaflet.css');
  return loadScript('/assets/vendor/leaflet.js');
}
export { TILE, TILE_ATTR };

function SpotsMap({ spots, center, active, onPick }) {
  const box = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let dead = false;
    loadLeaflet().then(() => {
      if (dead || !box.current) return;
      const L = window.L;
      map.current = L.map(box.current, { zoomControl: false, attributionControl: true }).setView(center, 14);
      L.control.zoom({ position: 'bottomright' }).addTo(map.current);
      L.tileLayer(TILE, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      setReady(true);
    });
    return () => {
      dead = true;
      if (map.current) map.current.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready || !map.current) return;
    const L = window.L;
    layer.current.clearLayers();
    for (const s of spots) {
      const icon = L.divIcon({
        className: '',
        html: `<div class="bubble ${s.slug === active ? 'on' : ''} ${s.bundle ? 'set' : ''}">${money(s.price_day)}</div>`,
        iconSize: [0, 0],
      });
      L.marker([s.lat, s.lng], { icon, zIndexOffset: s.slug === active ? 1000 : 0 }).on('click', () => onPick(s.slug)).addTo(layer.current);
    }
  }, [ready, spots, active]);
  useEffect(() => {
    if (!ready || !map.current) return;
    if (spots.length > 1) map.current.fitBounds(spots.map((s) => [s.lat, s.lng]), { padding: [50, 50], maxZoom: 15 });
    else map.current.setView(spots[0] ? [spots[0].lat, spots[0].lng] : center, 15);
  }, [ready, spots.map((s) => s.slug).join(','), center.join(',')]);
  return html`<div class="map" ref=${box}></div>`;
}

export function SpotsPage({ query, zone }) {
  const zoneSlug = zone || query.get('zone') || '';
  const [size, setSize] = useState('');
  const [onlySet, setOnlySet] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [active, setActive] = useState('');
  const [view, setView] = useState('list');
  const { data, loading, error } = useLoad(() => api(`/public/spots?lang=${S.lang}${zoneSlug ? `&zone=${zoneSlug}` : ''}`), [zoneSlug]);
  const z = S.config.zones.find((x) => x.slug === zoneSlug);
  const spots = (data?.spots || []).filter((s) => (!size || s.sizes.includes(size)) && (!onlySet || s.bundle) && (!onlyOpen || s.open_now));
  const center = z ? [z.lat, z.lng] : [37.5563, 126.97];
  const picked = spots.find((s) => s.slug === active);
  const pick = (slug) => {
    setActive(slug);
    document.getElementById(`card-${slug}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  return html`<main class="finder ${view}">
    <div class="finder-list">
      <div class="finder-head">
        <h1>${z ? t('area_h1', { zone: zoneName(zoneSlug) }) : t('spots_h1')}</h1>
        ${z && z.intro?.[S.lang] ? html`<p class="sub small mt4">${z.intro[S.lang]}</p>` : null}
        <div class="chips mt12">
          <${Link} to="/spots" class="chip ${zoneSlug ? '' : 'on'}">${t('all_areas')}<//>
          ${S.config.zones.map((x) => html`<${Link} to="/area/${x.slug}" class="chip ${x.slug === zoneSlug ? 'on' : ''}">${x.names[S.lang] || x.names.en}<//>`)}
        </div>
        <div class="chips mt8">
          ${['s', 'm', 'l'].map((k) => html`<button class="chip ${size === k ? 'on' : ''}" onClick=${() => setSize(size === k ? '' : k)}>${t(`size_${k}`)}</button>`)}
          <button class="chip ${onlySet ? 'on' : ''}" onClick=${() => setOnlySet(!onlySet)}>${t('f_set')}</button>
          <button class="chip ${onlyOpen ? 'on' : ''}" onClick=${() => setOnlyOpen(!onlyOpen)}>${t('open_now')}</button>
        </div>
      </div>
      ${loading
        ? html`<${Spinner} />`
        : error
          ? html`<div class="empty">${error.message}</div>`
          : spots.length
            ? html`<p class="small sub count">${t('n_spots', { n: spots.length })}</p>
                <div class="finder-cards">${spots.map((s) => html`<div id="card-${s.slug}" key=${s.slug}><${SpotCard} spot=${s} active=${s.slug === active} onHover=${setActive} /></div>`)}</div>`
            : html`<div class="empty"><img src="/assets/img/jimbo-sorry.svg" alt="" /><p class="b">${t('no_spots')}</p><p class="small mt4">${t('no_spots_sub')}</p></div>`}
    </div>
    <div class="finder-map">
      <${SpotsMap} spots=${spots} center=${center} active=${active} onPick=${pick} />
      ${picked && html`<div class="map-card"><${SpotCard} spot=${picked} /></div>`}
    </div>
    <button class="view-toggle btn dark" onClick=${() => setView(view === 'list' ? 'map' : 'list')}>${view === 'list' ? t('view_map') : t('view_list')}</button>
  </main>`;
}
