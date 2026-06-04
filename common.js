/* ============================================================
   Oxford Summer Rooms — shared frontend toolkit
   Read-only Supabase access. Used by index / property / book pages.
   ============================================================ */

const SUPABASE_URL = 'https://rmoqgbrttdbgxntbxaxr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtb3FnYnJ0dGRiZ3hudGJ4YXhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc0NzM1NjEsImV4cCI6MjA1MzA0OTU2MX0.Ps1dT9HtOBVzNbiUikzSCWsBhHfg1_2tTevUB7gaL2c';
const MIN_NIGHTS = 14;
const CLEANING_FEE = 0; // £100 cleaning charge removed for now
const HOLDING_DEPOSIT = 100;
const MAP_PROXY = `${SUPABASE_URL}/functions/v1/static-map`;

/* Flip to true once the create-booking edge function + Stripe are deployed.
   While false, the booking form validates and shows a confirmation (no charge). */
const PAYMENTS_ENABLED = true;
const BOOKING_FN = `${SUPABASE_URL}/functions/v1/osr-create-booking`;

/* ---------- helpers ---------- */
async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

const param = (k) => new URLSearchParams(location.search).get(k);
const weeklyRent = (m) => (Number(m) * 12) / 52;
const fmtGBP = (n) => '£' + Math.round(n).toLocaleString('en-GB');
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const nightsBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inList = (ids) => `(${ids.join(',')})`;

/* Split an images jsonb array into photos / floorplans / videos */
function classifyImages(imgs) {
  const list = Array.isArray(imgs) ? imgs : [];
  const hasTypedFloorplan = list.some(i => (i.type || '').toLowerCase() === 'floorplans');
  const photos = [], floorplans = [], videos = [];
  for (const i of list) {
    const type = (i.type || '').toLowerCase();
    const url = i.imageFile || '';
    const title = i.title || '';
    const looksLikePlan = /plan/i.test(url) || /floor\s*plan/i.test(title);
    if (!url) continue;
    if (type === 'videos') videos.push({ url, title });
    else if (type === 'floorplans') floorplans.push({ url, title: title || 'Floor plan' });
    else if (looksLikePlan) { if (!hasTypedFloorplan) floorplans.push({ url, title: title || 'Floor plan' }); }
    else photos.push({ url, title, sort: i.sortOrder });
  }
  return { photos, floorplans, videos };
}

const bySort = (a, b) => (a.sort == null ? 1e9 : a.sort) - (b.sort == null ? 1e9 : b.sort);

function applyHero(photos, override) {
  const sorted = photos.slice().sort(bySort);
  if (!override || !override.url) return sorted;
  const rest = sorted.filter(p => p.url !== override.url);
  return [{ url: override.url, title: override.title || '' }, ...rest];
}

function videoMeta(v) {
  const url = v.url || '';
  const base = url.split('?')[0].toLowerCase();
  const is360 = /360/.test(v.title || '') || /boxbrownie/i.test(url);
  const isFile = /\.(mp4|webm|mov|ogg)$/.test(base);
  const yt = /youtu\.be|youtube\.com/.test(url);
  const vimeo = /vimeo\.com/.test(url);
  return { url, label: is360 ? '360° Tour' : 'Video', isFile, yt, vimeo, embeddable: isFile || yt || vimeo, is360 };
}

/* Availability windows that are long enough to book (>= MIN_NIGHTS) */
function bookableWindows(windows) {
  return (windows || [])
    .filter(w => nightsBetween(w.window_start, w.window_end) >= MIN_NIGHTS)
    .sort((a, b) => a.window_start.localeCompare(b.window_start));
}

/* ---------- icons ---------- */
const ICON_PLAN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h6V3M21 14h-6v7M9 14H3M15 3v6h6"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_360 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="10" ry="5"/><path d="M7 12a5 5 0 0 0 10 0"/></svg>';

/* ---------- gallery registry ---------- */
const GAL = {};
let galSeq = 0;
function registerGallery(items) { const id = 'g' + (++galSeq); GAL[id] = items; return id; }

/* ---------- injected chrome (footer + lightbox) ---------- */
const FOOTER_HTML = `
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-col footer-about">
        <div class="footer-brand">theRent.<span class="fb-guru">guru</span></div>
        <p>Since 1997, we've been letting flats, houses and rooms across Oxford, Cardiff, London and Swansea. Whether you're a student, a professional, or somewhere in between — come and have a look. Specialists in Oxford student accommodation and professional rentals UK-wide.</p>
      </div>
      <div class="footer-col footer-contact">
        <h4>Contact Us</h4>
        <ul>
          <li><svg viewBox="0 0 24 24" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg><a href="mailto:mail@therent.guru">mail@therent.guru</a></li>
          <li><svg viewBox="0 0 24 24" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg><a href="tel:+443334440016">0333 444 0016</a></li>
          <li><svg viewBox="0 0 24 24" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5z"/></svg><a href="https://wa.me/443334440016" target="_blank" rel="noopener">WhatsApp Us!</a></li>
          <li><svg viewBox="0 0 24 24" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span>PO Box 1145, Cardiff, UK. CF11 1WZ</span></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom"><div class="footer-bottom-inner">© 2026 Bannits Ltd trading as The Rent Guru. All rights reserved.</div></div>
  </footer>`;

const LIGHTBOX_HTML = `
  <div class="lb" id="lb" aria-hidden="true">
    <button class="lb-close" data-lb="close" aria-label="Close">×</button>
    <button class="lb-nav lb-prev" data-lb="prev" aria-label="Previous">‹</button>
    <div class="lb-stage" id="lbStage"></div>
    <button class="lb-nav lb-next" data-lb="next" aria-label="Next">›</button>
    <div class="lb-caption" id="lbCaption"></div>
    <div class="lb-count" id="lbCount"></div>
  </div>`;

const RG_LOGO_HTML = `<a class="rg-logo" href="https://www.therent.guru" target="_blank" rel="noopener" title="The Rent Guru"><img src="rent-guru-logo.png" alt="The Rent Guru" /></a>`;

document.body.insertAdjacentHTML('beforeend', RG_LOGO_HTML + FOOTER_HTML + LIGHTBOX_HTML);

/* ---------- lightbox ---------- */
const lb = document.getElementById('lb');
const lbStage = document.getElementById('lbStage');
const lbCount = document.getElementById('lbCount');
const lbCaption = document.getElementById('lbCaption');
let lbItems = [], lbIndex = 0;

function renderLb() {
  const it = lbItems[lbIndex];
  if (!it) return;
  const multi = lbItems.length > 1;
  lbStage.innerHTML = `<img src="${esc(it.url)}" alt="${esc(it.title || '')}">`;
  lbCount.textContent = multi ? `${lbIndex + 1} / ${lbItems.length}` : '';
  lbCaption.textContent = it.title && !/^image of property$/i.test(it.title) ? it.title : '';
  document.querySelector('.lb-prev').style.display = multi ? '' : 'none';
  document.querySelector('.lb-next').style.display = multi ? '' : 'none';
}
function openGallery(items, index) {
  if (!items || !items.length) return;
  lbItems = items; lbIndex = Math.max(0, Math.min(index || 0, items.length - 1));
  renderLb(); lb.classList.add('open'); lb.setAttribute('aria-hidden', 'false');
}
function openVideo(meta) {
  if (meta.embeddable) {
    let inner = '';
    if (meta.isFile) inner = `<video src="${esc(meta.url)}" controls autoplay playsinline></video>`;
    else if (meta.yt) { const id = (meta.url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/) || [])[1]; inner = `<iframe src="https://www.youtube.com/embed/${esc(id)}?autoplay=1" allow="autoplay; fullscreen" allowfullscreen></iframe>`; }
    else if (meta.vimeo) { const id = (meta.url.match(/vimeo\.com\/(\d+)/) || [])[1]; inner = `<iframe src="https://player.vimeo.com/video/${esc(id)}?autoplay=1" allow="autoplay; fullscreen" allowfullscreen></iframe>`; }
    lbItems = []; lbStage.innerHTML = inner; lbCount.textContent = ''; lbCaption.textContent = meta.label;
    document.querySelector('.lb-prev').style.display = 'none';
    document.querySelector('.lb-next').style.display = 'none';
    lb.classList.add('open'); lb.setAttribute('aria-hidden', 'false');
  } else {
    window.open(meta.url, '_blank', 'noopener');
  }
}
function closeLb() { lb.classList.remove('open'); lb.setAttribute('aria-hidden', 'true'); lbStage.innerHTML = ''; lbItems = []; }
function lbStep(d) { if (lbItems.length) { lbIndex = (lbIndex + d + lbItems.length) % lbItems.length; renderLb(); } }

document.addEventListener('click', (e) => {
  const lbBtn = e.target.closest('[data-lb]');
  if (lbBtn) { const a = lbBtn.dataset.lb; if (a === 'close') closeLb(); else if (a === 'prev') lbStep(-1); else if (a === 'next') lbStep(1); return; }
  if (e.target === lb) { closeLb(); return; }
  const galEl = e.target.closest('[data-gallery]');
  if (galEl) { openGallery(GAL[galEl.dataset.gallery], parseInt(galEl.dataset.index || '0', 10)); return; }
  const vidEl = e.target.closest('[data-video]');
  if (vidEl) { openVideo(JSON.parse(vidEl.dataset.video)); return; }
  const carBtn = e.target.closest('[data-car]');
  if (carBtn) { const track = carBtn.closest('.carousel').querySelector('.carousel-track'); track.scrollBy({ left: (carBtn.dataset.car === 'next' ? 1 : -1) * track.clientWidth, behavior: 'smooth' }); }
});
document.addEventListener('keydown', (e) => {
  if (!lb.classList.contains('open')) return;
  if (e.key === 'Escape') closeLb(); else if (e.key === 'ArrowLeft') lbStep(-1); else if (e.key === 'ArrowRight') lbStep(1);
});
let _tx = 0;
lb.addEventListener('touchstart', (e) => { _tx = e.changedTouches[0].clientX; }, { passive: true });
lb.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - _tx; if (Math.abs(dx) > 45) lbStep(dx < 0 ? 1 : -1); }, { passive: true });

/* If the static map fails (e.g. key not configured), show a clean fallback link. */
function mapError(img) { const loc = img.closest('.location'); if (loc) loc.classList.add('map-failed'); }

/* ---------- shared builders ---------- */
function extrasChips(floorplans, videos) {
  const bits = [];
  if (floorplans && floorplans.length) {
    const gid = registerGallery(floorplans);
    bits.push(`<button class="chip" data-gallery="${gid}" data-index="0">${ICON_PLAN} Floor plan</button>`);
  }
  for (const v of (videos || [])) {
    const meta = videoMeta(v);
    bits.push(`<button class="chip" data-video='${esc(JSON.stringify(meta))}'>${meta.is360 ? ICON_360 : ICON_PLAY} ${meta.label}</button>`);
  }
  return bits.join('');
}

function carousel(photos, floorplans, videos, gapLabel) {
  if (!photos.length) {
    return `<div class="carousel"><div style="height:clamp(210px,40vw,320px);background:#dfe3ec"></div>
      ${gapLabel ? `<span class="gap-badge">${esc(gapLabel)}</span>` : ''}
      <div class="car-extras">${extrasChips(floorplans, videos)}</div></div>`;
  }
  const gid = registerGallery(photos);
  const slides = photos.map((p, i) => `<img class="carousel-slide" src="${esc(p.url)}" alt="${esc(p.title || '')}" loading="lazy" data-gallery="${gid}" data-index="${i}">`).join('');
  const multi = photos.length > 1;
  return `
    <div class="carousel">
      <div class="carousel-track">${slides}</div>
      ${multi ? `<button class="car-btn car-prev" data-car="prev" aria-label="Previous">‹</button>
                 <button class="car-btn car-next" data-car="next" aria-label="Next">›</button>
                 <span class="car-count">1 / ${photos.length}</span>` : ''}
      ${gapLabel ? `<span class="gap-badge">${esc(gapLabel)}</span>` : ''}
      <div class="car-extras">${extrasChips(floorplans, videos)}</div>
    </div>`;
}

function wireCarousels() {
  document.querySelectorAll('.carousel-track').forEach(track => {
    const count = track.parentElement.querySelector('.car-count');
    if (!count) return;
    let raf = null;
    track.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const total = track.children.length;
        const idx = Math.round(track.scrollLeft / track.clientWidth) + 1;
        count.textContent = `${Math.min(idx, total)} / ${total}`;
      });
    }, { passive: true });
  });
}

/* Green pills: bills + free wifi + any USPs from a building meta row */
function pillsHtml(meta) {
  const usps = [meta && meta.usp1, meta && meta.usp2, meta && meta.usp3].map(u => (u || '').trim()).filter(Boolean);
  return ['Gas, electricity &amp; water included', 'Free Wifi', ...usps.map(esc)]
    .map(label => `<span class="bills-badge">${label}</span>`).join('');
}

function gapLabel(building) {
  return (building.preceding_agreement_end && building.start_date)
    ? `Summer gap: ${fmtDate(building.preceding_agreement_end)} – ${fmtDate(building.start_date)}` : '';
}

function locationSection(lat, lng, address) {
  if (!lat || !lng) return '';
  return `
    <div class="location">
      <h4 class="loc-title">Location</h4>
      <a class="map-link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat + ',' + lng)}" target="_blank" rel="noopener" aria-label="View ${esc(address)} on Google Maps">
        <img class="map-img" src="${MAP_PROXY}?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&zoom=15&size=600x300" alt="Map of ${esc(address)}" loading="lazy" onerror="mapError(this)">
        <span class="map-overlay">📍 View on map</span>
        <span class="map-fallback">📍 View on Google Maps</span>
      </a>
    </div>`;
}

/* Property summary card for the listings page (no rooms inline) */
function propertyCard(building, liveRooms, detailById, metaById, heroById) {
  const bDetail = detailById.get(building.property_id);
  const bMeta = metaById.get(building.property_id) || {};
  const cls = classifyImages(bDetail && bDetail.images);
  const photos = applyHero(cls.photos, heroById.get(building.property_id));
  const shortDesc = bMeta.short_description || bMeta.sd || '';
  const weeks = liveRooms.map(r => detailById.get(r.property_id)).filter(Boolean).map(d => weeklyRent(d.rent_per_month));
  const fromWeek = weeks.length ? Math.min(...weeks) : null;
  const roomCount = liveRooms.length;
  const metaBits = [
    building.city || 'Oxford',
    `${roomCount} room${roomCount === 1 ? '' : 's'} available`,
    fromWeek ? `from ${fmtGBP(fromWeek)}/week` : ''
  ].filter(Boolean);

  return `
    <section class="building">
      ${carousel(photos, [], [], gapLabel(building))}
      <div class="building-body">
        <h3>${esc(building.property_address || (bDetail && bDetail.property_name) || 'Property')}</h3>
        ${shortDesc ? `<p class="short-desc">${esc(shortDesc)}</p>` : ''}
        <div class="building-meta">${metaBits.map(m => `<span>${esc(m)}</span>`).join('')}</div>
        <div class="pills">${pillsHtml(bMeta)}</div>
        <div class="prop-cta"><a class="btn btn-lg btn-block" href="property.html?id=${building.property_id}">See the rooms →</a></div>
      </div>
    </section>`;
}

/* Compact property card for the split (list + map) listings layout.
   Image-forward and narrow; details live on the property page. */
function propertyCardCompact(building, liveRooms, detailById, metaById, heroById) {
  const id = building.property_id;
  const bDetail = detailById.get(id);
  const cls = classifyImages(bDetail && bDetail.images);
  const photos = applyHero(cls.photos, heroById.get(id));
  const weeks = liveRooms.map(r => detailById.get(r.property_id)).filter(Boolean).map(d => weeklyRent(d.rent_per_month));
  const fromWeek = weeks.length ? Math.min(...weeks) : null;
  const roomCount = liveRooms.length;
  const address = building.property_address || (bDetail && bDetail.property_name) || 'Property';
  return `
    <section class="pcard" id="pcard-${id}" data-pid="${id}">
      ${carousel(photos, [], [], gapLabel(building))}
      <div class="pcard-body">
        <a class="pcard-title" href="property.html?id=${id}">${esc(address)}</a>
        <div class="pcard-meta">${esc(building.city || 'Oxford')} · ${roomCount} room${roomCount === 1 ? '' : 's'} available</div>
        ${fromWeek ? `<div class="pcard-price">from <strong>${fmtGBP(fromWeek)}</strong> <span>/ week</span></div>` : ''}
        <div class="pcard-note">Bills included · Min stay 2 weeks</div>
        <a class="btn btn-block" href="property.html?id=${id}" style="margin-top:12px">See the rooms →</a>
      </div>
    </section>`;
}

/* Room card (used on the property page). bookHref enables the "Book this room" button. */
function roomCard(room, detail, windows, heroOverride, bookHref) {
  const name = room.room_location || (detail && detail.property_name) || 'Room';
  const cls = classifyImages(detail && detail.images);
  const floorplans = cls.floorplans, videos = cls.videos;
  const photos = applyHero(cls.photos, heroOverride);
  const week = detail ? weeklyRent(detail.rent_per_month) : null;
  const beds = detail ? detail.number_of_beds : null;
  const baths = detail ? detail.number_of_bathrooms : null;

  const specs = [];
  if (beds != null) specs.push(beds + (beds === 1 ? ' bed' : ' beds'));
  if (baths != null) specs.push(baths + (baths === 1 ? ' bath' : ' baths'));

  const bookable = bookableWindows(windows);
  const datesHtml = bookable.length
    ? bookable.map(w => `<div class="date-window">${fmtDate(w.window_start)} – ${fmtDate(w.window_end)} <span class="nights">· up to ${nightsBetween(w.window_start, w.window_end)} nights</span></div>`).join('')
    : `<div class="date-window" style="color:var(--muted)">No dates of 2+ weeks currently available</div>`;

  const photoHtml = photos.length
    ? `<div class="room-photo-wrap"><img class="room-photo" src="${esc(photos[0].url)}" alt="${esc(name)}" loading="lazy"></div>`
    : `<div class="room-photo"></div>`;

  const extras = [];
  if (floorplans.length) { const fgid = registerGallery(floorplans); extras.push(`<button class="extra-link" data-gallery="${fgid}" data-index="0">${ICON_PLAN} Floor plan</button>`); }
  for (const v of videos) { const meta = videoMeta(v); extras.push(`<button class="extra-link" data-video='${esc(JSON.stringify(meta))}'>${meta.is360 ? ICON_360 : ICON_PLAY} ${meta.label}</button>`); }

  let cta = '';
  if (bookHref && bookable.length) cta = `<a class="btn btn-green btn-block" href="${bookHref}">Book this room →</a>`;
  else if (bookHref) cta = `<div class="room-unavail">No available dates right now</div>`;

  return `
    <article class="room">
      ${photoHtml}
      <div class="room-info">
        <div class="room-name">${esc(name)}</div>
        ${specs.length ? `<div class="room-specs">${specs.join(' · ')}</div>` : ''}
        ${week ? `<div class="price-row"><span class="price">${fmtGBP(week)}</span><span class="price-unit">/ week</span></div>` : ''}
        <div><div class="dates-label">Available</div>${datesHtml}</div>
        ${extras.length ? `<div class="room-extras">${extras.join('')}</div>` : ''}
        <div class="terms">${week ? `${fmtGBP(week)}/week. ` : ''}Bills included · Min stay 2 weeks</div>
        ${cta}
      </div>
    </article>`;
}

/* Fetch live publish flags + optional hero overrides */
async function fetchLive() {
  const live = await sb('property_live_status?is_live=eq.true&select=property_id,is_live,hero_image_url,hero_image_sort,hero_image_title');
  const liveIds = new Set(live.map(r => r.property_id));
  const heroById = new Map(
    live.filter(r => r.hero_image_url).map(r => [r.property_id, { url: r.hero_image_url, title: r.hero_image_title || '', sort: r.hero_image_sort }])
  );
  return { liveIds, heroById };
}
