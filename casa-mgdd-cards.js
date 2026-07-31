/*
 * Casa MGDD - Custom Lovelace Cards
 * Libreria unica di card custom per la dashboard Home Assistant.
 * Contiene: temperature-bento-card, temperature-row-card, weather-alert-card,
 * energy-power-card, energy-controls-card, energy-history-card,
 * energy-monthly-card, energy-flow-card, casa-mgdd-doors-card.
 *
 * Version: 1.56.0
 */

// Firma degli stati (state + last_updated) delle entità indicate.
// Evita di ricostruire il DOM a ogni cambio di hass globale: senza, qualunque
// entità che si aggiorna (es. sensori di potenza ogni 1-2s) forza il re-render
// e su iOS Safari lo scroll della vista torna in cima di continuo.
// Solo il valore, non last_updated: molti sensori di potenza ripubblicano lo
// stesso stato ogni 1-2 s, e includere il timestamp faceva ricostruire il DOM
// anche quando sullo schermo non cambiava nulla.
function mgddStatesSig(hass, ids) {
  if (!hass) return '';
  let out = '';
  for (const id of ids) {
    const s = id && hass.states[id];
    out += id + '=' + (s ? s.state : 'x') + ';';
  }
  return out;
}

// Il foglio di stile viene inserito una volta sola per elemento: a ogni
// aggiornamento si riscrive solo il contenuto. Reinserire lo <style> forzava un
// ricalcolo di stile dell'intero sottoalbero a ogni refresh e su iOS Safari
// bastava a far risalire lo scroll della vista.
// Il contenitore e' display:contents, quindi non introduce una scatola in piu'
// e non altera ne' il layout ne' i selettori fra fratelli.
// Ultimo istante in cui l'utente ha agito sullo scorrimento: dito, rotella o
// tastiera. Deliberatamente NON include l'evento `scroll`, che arriva anche
// quando e' il browser a spostare la posizione da solo: e' proprio quel caso che
// la rete di sicurezza in mgddPaint deve poter distinguere e annullare.
let mgddLastInput = 0;
function mgddScrollGuard() {
  if (mgddScrollGuard._on) return;
  mgddScrollGuard._on = true;
  const input = () => {
    mgddLastInput = Date.now();
  };
  ['touchstart', 'touchmove', 'touchend', 'wheel', 'keydown'].forEach((ev) =>
    window.addEventListener(ev, input, { capture: true, passive: true })
  );
}

// Riscrivere il contenuto svuota e ricrea il sottoalbero. Se in quell'istante
// qualcosa forza un calcolo del layout (un getBoundingClientRect di un'altra
// card, un ResizeObserver, una container query da rivalutare) il browser vede
// per un attimo una pagina piu' corta e, se sei vicino al fondo, riaggancia
// subito la posizione di scorrimento entro il nuovo massimo. Il contenuto
// ricompare, l'altezza torna, ma lo scorrimento resta dov'e' stato agganciato:
// e' il salto verso l'alto, e per questo cade sempre subito dopo un ridisegno e
// non durante lo scorrimento.
// Rimedio: la card non puo' diventare piu' bassa durante lo scambio. Si fissa
// l'altezza corrente come minimo, si scambia, e si libera al frame successivo,
// quando il nuovo contenuto e' gia' impaginato.
function mgddPaint(el, styles, html) {
  mgddScrollGuard();
  if (!el._mgddBody || el._mgddBody.parentNode !== el) {
    el.innerHTML = styles + '<div class="mgdd-body" style="display:contents"></div>';
    el._mgddBody = el.querySelector('.mgdd-body');
  }
  let h = 0;
  try {
    h = el.offsetHeight || 0;
  } catch (e) {
    h = 0;
  }
  if (h > 0) {
    el.style.minHeight = h + 'px';
    if (el._mgddRelease) cancelAnimationFrame(el._mgddRelease);
    el._mgddRelease = requestAnimationFrame(() => {
      el._mgddRelease = null;
      el.style.minHeight = '';
    });
  }
  // Rete di sicurezza: si annota la posizione di scorrimento prima dello scambio
  // e, se il browser la sposta da solo mentre l'utente non sta facendo nulla, la
  // si rimette dov'era. Non conta perche' il browser la sposti (riaggancio a un
  // massimo momentaneo, riallineamento a uno snap, correzione di ancoraggio):
  // qui la si annulla in ogni caso, entro lo stesso frame, quindi non si vede.
  const sc = document.scrollingElement || document.documentElement;
  const top0 = sc ? sc.scrollTop : 0;
  const inputStamp = mgddLastInput;
  el._mgddBody.innerHTML = html;
  if (sc && top0 > 0) {
    // La correzione del browser non arriva sempre nello stesso frame dello
    // scambio: si ricontrolla per qualche frame. Soglia bassa, perche' anche uno
    // spostamento di pochi pixel si vede come scatto.
    let tries = 0;
    const restore = () => {
      // se nel frattempo e' arrivato un tocco o una rotellata, l'utente comanda
      if (mgddLastInput !== inputStamp || Date.now() - mgddLastInput < 150) return;
      const d = sc.scrollTop - top0;
      if (d < -2 || d > 2) sc.scrollTop = top0;
      if (++tries < 6) requestAnimationFrame(restore);
    };
    restore();
  }
}

// ===== temperature-bento-card.js =====
class TemperatureBentoCard extends HTMLElement {
  setConfig(config) {
    if (!config.rooms || !Array.isArray(config.rooms)) {
      throw new Error('Config "rooms" mancante o non valida');
    }
    this.config = config;
    this._chartSvg = null;
    this._sparkData = {};
    this._historyFetchedAt = 0;
    this._lastSig = null;
    if (!this._uid) {
      TemperatureBentoCard._seq = (TemperatureBentoCard._seq || 0) + 1;
      this._uid = TemperatureBentoCard._seq;
    }
  }

  set hass(hass) {
    this._hass = hass;
    const ids = (this.config.rooms || []).flatMap((r) => [r.temp, r.hum]).filter(Boolean);
    const sig = mgddStatesSig(hass, ids);
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._render();
    }
    this._maybeFetchHistory();
  }

  getCardSize() {
    return 6;
  }

  _num(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isNaN(v) ? null : v;
  }

  _fmt(v, deg) {
    if (v === null) return '--';
    return v.toFixed(1) + (deg || '\u00b0C');
  }

  _colorFor(t) {
    if (t === null) return '#8a8d93';
    if (t < 18) return '#378ADD';
    if (t < 22) return '#1D9E75';
    if (t < 27) return '#BA7517';
    return '#E24B4A';
  }

  _iconThermo(size) {
    const s = size || 22;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4v10.5a3.5 3.5 0 1 1-4 0V4a2 2 0 1 1 4 0Z"/><circle cx="12" cy="17.3" r="1.15" fill="currentColor" stroke="none"/></svg>';
  }

  _iconHome(size) {
    const s = size || 28;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9"/><path d="M12 20v-4"/></svg>';
  }

  async _maybeFetchHistory() {
    const isList = this.config.layout === 'list';
    const dayEntity = this.config.zona_giorno;
    const nightEntity = this.config.zona_notte;
    const wantChart = dayEntity && nightEntity;
    const wantSpark = isList;
    if (!wantChart && !wantSpark) return;
    const now = Date.now();
    if (this._historyFetchedAt && now - this._historyFetchedAt < 5 * 60 * 1000) return;
    this._historyFetchedAt = now;
    const hours = wantChart ? this.config.chart_hours || 48 : this.config.spark_hours || 24;
    const entities = [];
    if (wantChart) entities.push(dayEntity, nightEntity);
    if (wantSpark) this.config.rooms.forEach((r) => { if (r.temp) entities.push(r.temp); });
    if (!entities.length || !this._hass) return;
    const start = new Date(now - hours * 3600 * 1000).toISOString();
    try {
      const path = 'history/period/' + start + '?filter_entity_id=' + entities.join(',') + '&minimal_response';
      const data = await this._hass.callApi('GET', path);
      let idx = 0;
      if (wantChart) {
        this._chartSvg = this._buildChartSvg(data[idx], data[idx + 1], now, hours);
        idx += 2;
      }
      if (wantSpark) {
        this.config.rooms.forEach((r) => {
          if (r.temp) {
            this._sparkData[r.temp] = this._roomSeries(data[idx], now, hours);
            idx += 1;
          }
        });
      }
      this._render();
    } catch (e) {
      /* silent: history unavailable, keep loading state */
    }
  }

  _toPoints(arr) {
    return (arr || [])
      .map((p) => ({ t: new Date(p.last_changed).getTime(), v: parseFloat(p.state) }))
      .filter((p) => !Number.isNaN(p.v));
  }

  _bucketize(pts, buckets, minT, span) {
    const out = [];
    for (let i = 0; i < buckets; i++) out.push([]);
    pts.forEach((p) => {
      let idx = Math.floor(((p.t - minT) / span) * buckets);
      if (idx < 0) idx = 0;
      if (idx >= buckets) idx = buckets - 1;
      out[idx].push(p.v);
    });
    return out.map((a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null));
  }

  _fillGaps(arr) {
    let last = null;
    const res = arr.map((v) => {
      if (v !== null) last = v;
      return last;
    });
    let next = null;
    for (let i = res.length - 1; i >= 0; i--) {
      if (res[i] !== null) next = res[i];
      else res[i] = next;
    }
    return res;
  }

  // grafico zona: area morbida con gradiente + linea; metadati per il tooltip interattivo
  _buildZoneChart(vals, color, minT, span, gid) {
    if (!vals.length) return '';
    const vmin = Math.min.apply(null, vals);
    const vmax = Math.max.apply(null, vals);
    const range = vmax - vmin || 1;
    const W = 200,
      H = 44,
      pad = 6,
      n = vals.length;
    const X = (i) => (n === 1 ? W / 2 : (i * W) / (n - 1));
    const Y = (v) => H - pad - ((v - vmin) / range) * (H - pad * 2);
    const p = vals.map((v, i) => ({ x: X(i), y: Y(v) }));
    const fx = (x) => x.toFixed(1);
    let d = 'M' + fx(p[0].x) + ',' + fx(p[0].y);
    const t = 0.18;
    for (let i = 0; i < n - 1; i++) {
      const a = p[i - 1] || p[i];
      const b = p[i];
      const c = p[i + 1];
      const e = p[i + 2] || c;
      d += 'C' + fx(b.x + (c.x - a.x) * t) + ',' + fx(b.y + (c.y - a.y) * t) + ' ' + fx(c.x - (e.x - b.x) * t) + ',' + fx(c.y - (e.y - b.y) * t) + ' ' + fx(c.x) + ',' + fx(c.y);
    }
    const areaD = n < 2 ? '' : d + ' L' + fx(p[n - 1].x) + ',' + H + ' L' + fx(p[0].x) + ',' + H + ' Z';
    // metadati (posizione %, ora, valore) per il tooltip al passaggio di mouse/dito
    const meta = vals.map((v, i) => ({
      x: +(n === 1 ? 50 : (i / (n - 1)) * 100).toFixed(2),
      y: +((p[i].y / H) * 100).toFixed(2),
      t: new Date(minT + (n === 1 ? 0 : (i / (n - 1)) * span)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      v: v.toFixed(1),
    }));
    const svg =
      '<svg class="zc-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + color + '" stop-opacity="0.32"/>' +
      '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      (areaD ? '<path d="' + areaD + '" fill="url(#' + gid + ')"/>' : '') +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return '<div class="zchart" data-pts=\'' + JSON.stringify(meta) + '\' style="--zc:' + color + '">' + svg + '<div class="zc-mark"></div><div class="zc-dot"></div><div class="zc-tip"></div></div>';
  }

  _wireZoneCharts() {
    this.querySelectorAll('.zchart').forEach((el) => {
      let pts;
      try {
        pts = JSON.parse(el.getAttribute('data-pts') || '[]');
      } catch (e) {
        pts = [];
      }
      if (!pts.length) return;
      const mark = el.querySelector('.zc-mark');
      const dot = el.querySelector('.zc-dot');
      const tip = el.querySelector('.zc-tip');
      const show = (clientX) => {
        const rect = el.getBoundingClientRect();
        let frac = (clientX - rect.left) / (rect.width || 1);
        if (frac < 0) frac = 0;
        if (frac > 1) frac = 1;
        let idx = Math.round(frac * (pts.length - 1));
        if (idx < 0) idx = 0;
        if (idx >= pts.length) idx = pts.length - 1;
        const pt = pts[idx];
        mark.style.left = pt.x + '%';
        dot.style.left = pt.x + '%';
        dot.style.top = pt.y + '%';
        tip.style.left = pt.x + '%';
        tip.textContent = pt.t + ' \u00b7 ' + pt.v + '\u00b0';
        el.classList.add('zc-active');
      };
      const hide = () => el.classList.remove('zc-active');
      const scheduleHide = () => { clearTimeout(el._hideTimer); el._hideTimer = setTimeout(hide, 2500); };
      const showAt = (e) => { clearTimeout(el._hideTimer); show(e.clientX); };
      el.addEventListener('pointermove', showAt);
      el.addEventListener('pointerdown', showAt);
      // col mouse nascondi subito all'uscita; col dito lascia il tooltip ancora un po'
      el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); else scheduleHide(); });
      el.addEventListener('pointerup', scheduleHide);
      el.addEventListener('pointercancel', scheduleHide);
    });
  }

  _buildChartSvg(dayArr, nightArr, nowMs, hours) {
    const dayPoints = this._toPoints(dayArr);
    const nightPoints = this._toPoints(nightArr);
    const buckets = 24;
    const maxT = nowMs;
    const minT = nowMs - hours * 3600 * 1000;
    const span = maxT - minT || 1;
    const dayF = this._fillGaps(this._bucketize(dayPoints, buckets, minT, span)).filter((v) => v !== null);
    const nightF = this._fillGaps(this._bucketize(nightPoints, buckets, minT, span)).filter((v) => v !== null);
    if (!dayF.length && !nightF.length) return null;
    const dayVal = this._num(this.config.zona_giorno);
    const nightVal = this._num(this.config.zona_notte);
    const dayChart = dayF.length ? this._buildZoneChart(dayF, '#EF9F27', minT, span, 'tbcd' + this._uid) : '';
    const nightChart = nightF.length ? this._buildZoneChart(nightF, '#378ADD', minT, span, 'tbcn' + this._uid) : '';
    return (
      '<div class="zonecard zday"><div class="zc-top"><span class="zc-label">Zona giorno</span><span class="zc-tag">' + hours + 'h</span></div>' +
      '<div class="zc-val">' + this._fmt(dayVal) + '</div>' + dayChart + '</div>' +
      '<div class="zonecard znight"><div class="zc-top"><span class="zc-label">Zona notte</span><span class="zc-tag">' + hours + 'h</span></div>' +
      '<div class="zc-val">' + this._fmt(nightVal) + '</div>' + nightChart + '</div>'
    );
  }

  // serie storica di una stanza: valori bucketizzati + min/max di periodo (per l'area + etichette)
  _roomSeries(arr, nowMs, hours) {
    const pts = this._toPoints(arr);
    if (!pts.length) return null;
    const buckets = 16;
    const minT = nowMs - hours * 3600 * 1000;
    const span = hours * 3600 * 1000;
    const vals = this._fillGaps(this._bucketize(pts, buckets, minT, span)).filter((v) => v !== null);
    if (!vals.length) return null;
    return { vals: vals, min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) };
  }

  // sparkline ad area morbida a piena larghezza (colore = fascia temperatura)
  _buildRoomArea(vals, color, gid) {
    if (!vals.length) return '';
    const vmin = Math.min.apply(null, vals);
    const vmax = Math.max.apply(null, vals);
    const range = vmax - vmin || 1;
    const W = 100,
      H = 40,
      pad = 6,
      n = vals.length;
    const X = (i) => (n === 1 ? W / 2 : (i * W) / (n - 1));
    const Y = (v) => H - pad - ((v - vmin) / range) * (H - pad * 2);
    const p = vals.map((v, i) => ({ x: X(i), y: Y(v) }));
    const fx = (x) => x.toFixed(1);
    let d = 'M' + fx(p[0].x) + ',' + fx(p[0].y);
    const t = 0.18;
    for (let i = 0; i < n - 1; i++) {
      const a = p[i - 1] || p[i];
      const b = p[i];
      const c = p[i + 1];
      const e = p[i + 2] || c;
      d += 'C' + fx(b.x + (c.x - a.x) * t) + ',' + fx(b.y + (c.y - a.y) * t) + ' ' + fx(c.x - (e.x - b.x) * t) + ',' + fx(c.y - (e.y - b.y) * t) + ' ' + fx(c.x) + ',' + fx(c.y);
    }
    const areaD = n < 2 ? '' : d + ' L' + fx(p[n - 1].x) + ',' + H + ' L' + fx(p[0].x) + ',' + H + ' Z';
    return (
      '<svg class="tr-area" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + color + '" stop-opacity="0.30"/>' +
      '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      (areaD ? '<path d="' + areaD + '" fill="url(#' + gid + ')"/>' : '') +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );
  }

  _iconDrop(size) {
    const s = size || 13;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/></svg>';
  }

  _render() {
    if (this.config.layout === 'list') {
      this._renderList();
    } else {
      this._renderBento();
    }
  }

  _renderList() {
    const rooms = this.config.rooms;
    // colonne: default 1 / 2 / 3, sovrascrivibili con grid_columns (max) e breakpoint via config
    const bp2 = this.config.grid_bp_2 || 480;
    const bp3 = this.config.grid_bp_3 || 820;
    const maxCols = this.config.grid_columns || 3;
    // NB: classi prefissate .tr-* per evitare collisioni con i wrapper della sezione (card in light DOM)
    const roomsHtml = rooms
      .map((r, i) => {
        const t = this._num(r.temp);
        const hum = this._num(r.hum);
        const c = this._colorFor(t);
        const series = this._sparkData[r.temp];
        const chart = series ? this._buildRoomArea(series.vals, c, 'trc' + this._uid + '_' + i) : '<svg class="tr-area" viewBox="0 0 100 40" preserveAspectRatio="none"></svg>';
        const mm = series ? '<div class="tr-mm"><span>min ' + series.min.toFixed(1) + '\u00b0</span><span>max ' + series.max.toFixed(1) + '\u00b0</span></div>' : '';
        const humHtml = hum === null ? '' : '<span class="tr-drop">' + this._iconDrop(13) + '</span>' + hum.toFixed(0) + '%';
        return (
          '<div class="tr-room" data-entity="' + r.temp + '">' +
          '<div class="tr-head">' +
          '<div class="tr-ava" style="background:' + c + '22;color:' + c + '">' + this._iconThermo(20) + '</div>' +
          '<div class="tr-info"><div class="tr-name">' + r.name + '</div>' +
          '<div class="tr-hum">' + humHtml + '</div></div>' +
          '<div class="tr-val" style="color:' + c + '">' + this._fmt(t, '\u00b0') + '</div>' +
          '</div>' +
          '<div class="tr-chart">' + chart + '</div>' + mm +
          '</div>'
        );
      })
      .join('');

    this.innerHTML =
      '<style>' +
      "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');" +
      ':host{display:block;}' +
      // colonne dinamiche in base alla larghezza REALE della card (container query): 1 -> 2 -> 3
      // il container-type è impostato via JS sull'host (light DOM: :host non si applica)
      '.tr-grid{display:grid;grid-template-columns:1fr;gap:10px;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
      '@container (min-width:' + bp2 + 'px){.tr-grid{grid-template-columns:repeat(' + Math.min(2, maxCols) + ',1fr);}}' +
      '@container (min-width:' + bp3 + 'px){.tr-grid{grid-template-columns:repeat(' + maxCols + ',1fr);}}' +
      '.tr-room{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:16px;padding:14px 16px 12px;cursor:pointer;overflow:hidden;}' +
      '.tr-room:active{opacity:.6;}' +
      '.tr-head{display:flex;align-items:center;gap:12px;}' +
      '.tr-ava{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}' +
      '.tr-info{flex:1;min-width:0;}' +
      '.tr-name{font-size:15px;font-weight:500;color:var(--primary-text-color,#1c1c1e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.tr-hum{font-size:12px;color:var(--secondary-text-color,#6b6f76);display:flex;align-items:center;}' +
      '.tr-drop{display:inline-flex;margin-right:3px;}' +
      '.tr-val{font-size:30px;font-weight:600;letter-spacing:-0.5px;flex:0 0 auto;font-variant-numeric:tabular-nums;}' +
      '.tr-chart{margin:10px -16px 0;}' +
      '.tr-area{display:block;width:100%;height:44px;overflow:visible;}' +
      '.tr-mm{display:flex;justify-content:space-between;font-size:11px;color:var(--secondary-text-color,#6b6f76);margin-top:4px;font-variant-numeric:tabular-nums;}' +
      '</style>' +
      '<div class="tr-grid">' + roomsHtml + '</div>';
    // light DOM: :host non funziona, quindi il container query si àncora all'elemento host
    this.style.display = 'block';
    this.style.containerType = 'inline-size';
    this._wireRowClicks();
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    const event = new CustomEvent('hass-more-info', {
      detail: { entityId: entityId },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  _wireRowClicks() {
    this.querySelectorAll('.tr-room[data-entity]').forEach((row) => {
      row.addEventListener('click', () => this._openMoreInfo(row.getAttribute('data-entity')));
    });
  }

  _renderBento() {
    const rooms = this.config.rooms;
    const temps = rooms.map((r) => this._num(r.temp));
    const valid = temps.filter((v) => v !== null);
    const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;

    let hotIdx = -1;
    let coldIdx = -1;
    temps.forEach((t, i) => {
      if (t === null) return;
      if (hotIdx === -1 || t > temps[hotIdx]) hotIdx = i;
      if (coldIdx === -1 || t < temps[coldIdx]) coldIdx = i;
    });
    const hot = hotIdx >= 0 ? rooms[hotIdx] : null;
    const cold = coldIdx >= 0 ? rooms[coldIdx] : null;
    const hotVal = hotIdx >= 0 ? temps[hotIdx] : null;
    const coldVal = coldIdx >= 0 ? temps[coldIdx] : null;

    const thermo = this._iconThermo(22);
    const home = this._iconHome(18);
    const hours = this.config.chart_hours || 48;

    const chartInner = this._chartSvg || '<div class="chart-loading">Caricamento\u2026</div>';

    this.innerHTML =
      '<style>' +
      "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');" +
      ':host{display:block;}' +
      '.wrap{--ha-card-box-shadow:none;box-shadow:none;border:none;background:transparent;padding:0;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
      '.top2{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:stretch;}' +
      // colA si allunga fino all'altezza della colonna zone: l'hero "Media casa" prende lo spazio extra
      '.colA{display:grid;gap:12px;grid-template-rows:1fr auto;}' +
      '.colB{display:grid;gap:12px;align-content:start;}' +
      '.hero{background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:18px;padding:16px;display:flex;flex-direction:column;justify-content:center;gap:6px;border:1px solid var(--divider-color,rgba(0,0,0,.08));}' +
      '.hero .lbl{display:flex;align-items:center;gap:6px;color:var(--secondary-text-color,#6b6f76);font-size:13px;font-weight:600;}' +
      '.hero .val{font-size:38px;font-weight:600;color:var(--primary-text-color,#1c1c1e);letter-spacing:-1px;}' +
      '.hero .cap{font-size:12px;color:var(--secondary-text-color,#6b6f76);opacity:.85;}' +
      '.hotcoldgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}' +
      '.mini{border-radius:18px;padding:16px;display:flex;flex-direction:column;justify-content:center;gap:6px;}' +
      '.mini .lbl{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;}' +
      '.mini .val{font-size:26px;font-weight:600;letter-spacing:-0.5px;}' +
      '.mini .cap{font-size:12px;opacity:.85;}' +
      '.zonecard{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:18px;padding:16px;}' +
      '.zc-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;}' +
      '.zc-label{font-size:12px;font-weight:600;color:var(--primary-text-color,#1c1c1e);}' +
      '.zc-tag{font-size:11px;color:var(--secondary-text-color,#6b6f76);}' +
      '.zc-val{font-size:26px;font-weight:600;color:var(--primary-text-color,#1c1c1e);letter-spacing:-0.5px;margin-bottom:8px;}' +
      '.zchart{position:relative;height:46px;margin:2px 0 -6px;touch-action:pan-y;}' +
      '.zc-spark{display:block;width:100%;height:46px;overflow:visible;}' +
      '.zc-mark{position:absolute;top:0;bottom:0;width:1px;background:var(--zc);opacity:0;transform:translateX(-0.5px);pointer-events:none;transition:opacity .1s;}' +
      '.zc-dot{position:absolute;width:8px;height:8px;border-radius:50%;background:var(--zc);border:2px solid var(--ha-card-background,var(--card-background-color,#fff));opacity:0;transform:translate(-50%,-50%);pointer-events:none;transition:opacity .1s;}' +
      '.zc-tip{position:absolute;top:-4px;transform:translate(-50%,-100%);background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color,#1c1c1e);border:1px solid var(--divider-color,rgba(0,0,0,.1));box-shadow:0 6px 18px rgba(0,0,0,.18);border-radius:10px;padding:5px 9px;font-size:11px;font-weight:600;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .1s;z-index:2;}' +
      '.zchart.zc-active .zc-mark,.zchart.zc-active .zc-dot,.zchart.zc-active .zc-tip{opacity:1;}' +
      '.chart-loading{grid-column:1/-1;font-size:12px;color:var(--secondary-text-color,#6b6f76);padding:30px 0;text-align:center;}' +
      '@media (max-width:700px){.top2{grid-template-columns:1fr;}}' +
      '</style>' +
      '<ha-card class="wrap">' +
      '<div class="top2">' +
      '<div class="colA">' +
      '<div class="hero"><div class="lbl">' + home + '<span>Media casa</span></div>' +
      '<div class="val">' + this._fmt(avg) + '</div>' +
      '<div class="cap">' + rooms.length + ' stanze monitorate</div></div>' +
      '<div class="hotcoldgrid">' +
      '<div class="mini" style="background:#E24B4A1c;color:#B93C3C"><div class="lbl">' + thermo + '<span>Pi\u00f9 calda</span></div>' +
      '<div class="val">' + this._fmt(hotVal) + '</div>' +
      '<div class="cap">' + (hot ? hot.name : '') + '</div></div>' +
      '<div class="mini" style="background:#378ADD1c;color:#2B6CAE"><div class="lbl">' + thermo + '<span>Pi\u00f9 fredda</span></div>' +
      '<div class="val">' + this._fmt(coldVal) + '</div>' +
      '<div class="cap">' + (cold ? cold.name : '') + '</div></div>' +
      '</div>' +
      '</div>' +
      '<div class="colB">' + chartInner + '</div>' +
      '</div>' +
      '</ha-card>';
    this._wireZoneCharts();
  }
}

TemperatureBentoCard.getStubConfig = function () {
  return {
    layout: 'bento',
    rooms: [
      { name: 'Soggiorno', temp: 'sensor.temperature', hum: 'sensor.humidity' }
    ],
  };
};

TemperatureBentoCard.getConfigElement = function () {
  return document.createElement('temperature-bento-card-editor');
};

class TemperatureBentoCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = Object.assign({ layout: 'bento', rooms: [] }, config || {});
    if (!Array.isArray(this._config.rooms)) this._config.rooms = [];
    if (this._built) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._built = true;
      this._render();
    } else {
      this.querySelectorAll('ha-entity-picker').forEach((p) => { p.hass = hass; });
    }
  }

  _emit() {
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  _set(key, val) {
    const c = Object.assign({}, this._config);
    if (val === '' || val === undefined || val === null) delete c[key];
    else c[key] = val;
    this._config = c;
    this._emit();
  }

  _setRoom(i, key, val) {
    const rooms = this._config.rooms.map((r) => Object.assign({}, r));
    if (val === '' || val === undefined || val === null) delete rooms[i][key];
    else rooms[i][key] = val;
    this._config = Object.assign({}, this._config, { rooms: rooms });
    this._emit();
  }

  _addRoom() {
    const rooms = this._config.rooms.concat([{ name: '', temp: '', hum: '' }]);
    this._config = Object.assign({}, this._config, { rooms: rooms });
    this._emit();
    this._render();
  }

  _delRoom(i) {
    const rooms = this._config.rooms.slice();
    rooms.splice(i, 1);
    this._config = Object.assign({}, this._config, { rooms: rooms });
    this._emit();
    this._render();
  }

  _moveRoom(i, d) {
    const j = i + d;
    const rooms = this._config.rooms.slice();
    if (j < 0 || j >= rooms.length) return;
    const t = rooms[i]; rooms[i] = rooms[j]; rooms[j] = t;
    this._config = Object.assign({}, this._config, { rooms: rooms });
    this._emit();
    this._render();
  }

  _mkEntity(label, value, cb) {
    const p = document.createElement('ha-entity-picker');
    p.hass = this._hass;
    p.label = label;
    p.includeDomains = ['sensor'];
    p.allowCustomEntity = true;
    p.value = value || '';
    p.style.width = '100%';
    p.addEventListener('value-changed', (e) => { e.stopPropagation(); cb(e.detail.value); });
    return p;
  }

  _mkText(label, value, cb) {
    const t = document.createElement('ha-textfield');
    t.label = label;
    t.value = value || '';
    t.style.width = '100%';
    t.addEventListener('input', (e) => cb(e.target.value));
    return t;
  }

  _mkNum(label, value, placeholder, cb) {
    const t = document.createElement('ha-textfield');
    t.label = label;
    t.type = 'number';
    t.value = value !== undefined && value !== null ? String(value) : '';
    t.placeholder = String(placeholder);
    t.style.width = '100%';
    t.addEventListener('input', (e) => { const v = e.target.value; cb(v === '' ? '' : Number(v)); });
    return t;
  }

  _mkIcon(icon, cb) {
    const b = document.createElement('ha-icon-button');
    b.innerHTML = '<ha-icon icon="' + icon + '"></ha-icon>';
    b.addEventListener('click', cb);
    return b;
  }

  _render() {
    if (!this._config) this._config = { layout: 'bento', rooms: [] };
    const layout = this._config.layout || 'bento';
    this.innerHTML =
      '<style>' +
      '.bento-ed{display:flex;flex-direction:column;gap:16px;padding:8px 2px;}' +
      '.ed-field{display:flex;flex-direction:column;}' +
      '.ed-cond{display:flex;flex-direction:column;gap:12px;}' +
      '.ed-title{font-weight:600;font-size:13px;margin:4px 0 -4px;}' +
      '.ed-lbl{font-size:12px;color:var(--secondary-text-color,#6b6f76);margin-bottom:4px;}' +
      '.rooms{display:flex;flex-direction:column;gap:10px;}' +
      '.room{display:flex;flex-direction:column;gap:8px;border:1px solid var(--divider-color,rgba(0,0,0,.12));border-radius:10px;padding:12px;}' +
      '.room-head{display:flex;align-items:center;justify-content:space-between;}' +
      '.room-head .t{font-size:12px;font-weight:600;color:var(--secondary-text-color,#6b6f76);}' +
      '.room-head .b{display:flex;}' +
      'ha-textfield,ha-entity-picker{width:100%;display:block;}' +
      '.add{align-self:flex-start;margin-top:2px;}' +
      '</style>' +
      '<div class="bento-ed">' +
      '<div class="ed-field"><span class="ed-lbl">Layout</span><select id="s-layout" style="padding:9px;border-radius:6px;border:1px solid var(--divider-color,rgba(0,0,0,.2));background:var(--card-background-color,#fff);color:var(--primary-text-color,#1c1c1e);font-size:14px;"></select></div>' +
      '<div class="ed-cond" id="s-cond"></div>' +
      '<div class="ed-title">Stanze</div>' +
      '<div class="rooms" id="s-rooms"></div>' +
      '<mwc-button class="add" id="s-add" outlined label="+ Aggiungi stanza"></mwc-button>' +
      '</div>';

    // layout select
    const sel = this.querySelector('#s-layout');
    [['bento', 'Riepilogo (media + caldo/freddo + zone)'], ['list', 'Lista stanze']].forEach((o) => {
      const op = document.createElement('option');
      op.value = o[0]; op.textContent = o[1];
      if (layout === o[0]) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener('change', () => { this._set('layout', sel.value); this._render(); });

    // campi condizionali per layout
    const cond = this.querySelector('#s-cond');
    if (layout === 'bento') {
      cond.appendChild(this._mkEntity('Zona giorno (sensore medio)', this._config.zona_giorno, (v) => this._set('zona_giorno', v)));
      cond.appendChild(this._mkEntity('Zona notte (sensore medio)', this._config.zona_notte, (v) => this._set('zona_notte', v)));
      cond.appendChild(this._mkNum('Ore grafico zone (default 48)', this._config.chart_hours, 48, (v) => this._set('chart_hours', v)));
    } else {
      cond.appendChild(this._mkNum('Ore sparkline (default 24)', this._config.spark_hours, 24, (v) => this._set('spark_hours', v)));
      cond.appendChild(this._mkNum('Colonne massime (default 3)', this._config.grid_columns, 3, (v) => this._set('grid_columns', v)));
      cond.appendChild(this._mkNum('Larghezza per passare a 2 col. (px, default 560)', this._config.grid_bp_2, 560, (v) => this._set('grid_bp_2', v)));
      cond.appendChild(this._mkNum('Larghezza per passare a 3 col. (px, default 900)', this._config.grid_bp_3, 900, (v) => this._set('grid_bp_3', v)));
    }

    // lista stanze
    const rc = this.querySelector('#s-rooms');
    this._config.rooms.forEach((r, i) => {
      const row = document.createElement('div'); row.className = 'room';
      const head = document.createElement('div'); head.className = 'room-head';
      const t = document.createElement('span'); t.className = 't'; t.textContent = 'Stanza ' + (i + 1);
      const b = document.createElement('span'); b.className = 'b';
      b.appendChild(this._mkIcon('mdi:arrow-up', () => this._moveRoom(i, -1)));
      b.appendChild(this._mkIcon('mdi:arrow-down', () => this._moveRoom(i, 1)));
      b.appendChild(this._mkIcon('mdi:delete', () => this._delRoom(i)));
      head.appendChild(t); head.appendChild(b);
      row.appendChild(head);
      row.appendChild(this._mkText('Nome stanza', r.name, (v) => this._setRoom(i, 'name', v)));
      row.appendChild(this._mkEntity('Temperatura', r.temp, (v) => this._setRoom(i, 'temp', v)));
      row.appendChild(this._mkEntity('Umidità (opz.)', r.hum, (v) => this._setRoom(i, 'hum', v)));
      rc.appendChild(row);
    });
    const add = this.querySelector('#s-add');
    add.addEventListener('click', () => this._addRoom());
  }
}
customElements.define('temperature-bento-card-editor', TemperatureBentoCardEditor);

customElements.define('temperature-bento-card', TemperatureBentoCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'temperature-bento-card',
  name: 'Temperature Bento',
  description: 'Card temperature: media casa, calda/fredda, zona giorno/notte, o vista lista stanze. Editor visuale + YAML.',
});

// ===== temperature-row-card.js =====
class TemperatureRowCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    if (this._built) this._syncValues();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    else this._syncHass();
  }

  _build() {
    this._built = true;
    this.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:16px;padding:8px 2px;">' +
      '<div id="f-entity"></div>' +
      '<div id="f-hum"></div>' +
      '<div id="f-name"></div>' +
      '</div>';

    const entityPicker = document.createElement('ha-entity-picker');
    entityPicker.hass = this._hass;
    entityPicker.label = 'Sensore temperatura (obbligatorio)';
    entityPicker.includeDomains = ['sensor'];
    entityPicker.value = this._config.entity || '';
    entityPicker.addEventListener('value-changed', (e) => {
      e.stopPropagation();
      this._updateConfig('entity', e.detail.value);
    });
    this.querySelector('#f-entity').appendChild(entityPicker);
    this._entityPicker = entityPicker;

    const humPicker = document.createElement('ha-entity-picker');
    humPicker.hass = this._hass;
    humPicker.label = 'Sensore umidit\u00e0 (opzionale)';
    humPicker.includeDomains = ['sensor'];
    humPicker.value = this._config.hum_entity || '';
    humPicker.addEventListener('value-changed', (e) => {
      e.stopPropagation();
      this._updateConfig('hum_entity', e.detail.value);
    });
    this.querySelector('#f-hum').appendChild(humPicker);
    this._humPicker = humPicker;

    const nameField = document.createElement('ha-textfield');
    nameField.label = 'Nome (opzionale, altrimenti usa il nome dell\u2019entit\u00e0)';
    nameField.value = this._config.name || '';
    nameField.style.width = '100%';
    nameField.addEventListener('input', (e) => {
      this._updateConfig('name', e.target.value);
    });
    this.querySelector('#f-name').appendChild(nameField);
    this._nameField = nameField;
  }

  _syncHass() {
    if (this._entityPicker) this._entityPicker.hass = this._hass;
    if (this._humPicker) this._humPicker.hass = this._hass;
  }

  _syncValues() {
    if (this._entityPicker && this._entityPicker.value !== (this._config.entity || '')) this._entityPicker.value = this._config.entity || '';
    if (this._humPicker && this._humPicker.value !== (this._config.hum_entity || '')) this._humPicker.value = this._config.hum_entity || '';
    if (this._nameField && this._nameField.value !== (this._config.name || '')) this._nameField.value = this._config.name || '';
  }

  _updateConfig(key, value) {
    this._config = Object.assign({}, this._config, { [key]: value });
    const event = new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true });
    this.dispatchEvent(event);
  }
}
customElements.define('temperature-row-card-editor', TemperatureRowCardEditor);

class TemperatureRowCard extends HTMLElement {
  setConfig(config) {
    this.config = config || {};
    this._sparkline = null;
    this._fetchedAt = 0;
    this._lastSig = null;
  }

  static getConfigElement() {
    return document.createElement('temperature-row-card-editor');
  }

  static getStubConfig() {
    return { entity: '', hum_entity: '', name: '' };
  }

  set hass(hass) {
    this._hass = hass;
    const ids = [this.config.entity, this.config.hum_entity].filter(Boolean);
    const sig = mgddStatesSig(hass, ids);
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._render();
    }
    this._maybeFetchHistory();
  }

  getCardSize() {
    return 1;
  }

  _num(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isNaN(v) ? null : v;
  }

  _fmt(v) {
    return v === null ? '--' : v.toFixed(1) + '\u00b0';
  }

  _colorFor(t) {
    if (t === null) return '#8a8d93';
    if (t < 18) return '#378ADD';
    if (t < 22) return '#1D9E75';
    if (t < 27) return '#BA7517';
    return '#E24B4A';
  }

  _iconThermo() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4v10.5a3.5 3.5 0 1 1-4 0V4a2 2 0 1 1 4 0Z"/><circle cx="12" cy="17.3" r="1.15" fill="currentColor" stroke="none"/></svg>';
  }

  async _maybeFetchHistory() {
    const now = Date.now();
    if (this._fetchedAt && now - this._fetchedAt < 5 * 60 * 1000) return;
    if (!this._hass || !this.config.entity) return;
    this._fetchedAt = now;
    const hours = this.config.spark_hours || 24;
    const start = new Date(now - hours * 3600 * 1000).toISOString();
    try {
      const data = await this._hass.callApi('GET', 'history/period/' + start + '?filter_entity_id=' + this.config.entity + '&minimal_response');
      this._sparkline = this._buildSparkline(data[0]);
      this._render();
    } catch (e) {
      /* keep placeholder */
    }
  }

  _toPoints(arr) {
    return (arr || [])
      .map((p) => ({ t: new Date(p.last_changed).getTime(), v: parseFloat(p.state) }))
      .filter((p) => !Number.isNaN(p.v));
  }

  _buildSparkline(arr) {
    const pts = this._toPoints(arr);
    if (!pts.length) return null;
    const buckets = 12;
    const minT = Math.min.apply(null, pts.map((p) => p.t));
    const maxT = Math.max.apply(null, pts.map((p) => p.t));
    const span = maxT - minT || 1;
    const out = [];
    for (let i = 0; i < buckets; i++) out.push([]);
    pts.forEach((p) => {
      let idx = Math.floor(((p.t - minT) / span) * buckets);
      if (idx < 0) idx = 0;
      if (idx >= buckets) idx = buckets - 1;
      out[idx].push(p.v);
    });
    const bucketed = out.map((a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null));
    let last = null;
    const filled = bucketed.map((v) => {
      if (v !== null) last = v;
      return last;
    });
    let next = null;
    for (let i = filled.length - 1; i >= 0; i--) {
      if (filled[i] !== null) next = filled[i];
      else filled[i] = next;
    }
    const vals = filled.filter((v) => v !== null);
    if (!vals.length) return null;
    const vmin = Math.min.apply(null, vals);
    const vmax = Math.max.apply(null, vals);
    const range = vmax - vmin || 1;
    const W = 60;
    const H = 22;
    const pad = 3;
    const x = (i) => (i / (buckets - 1)) * W;
    const y = (v) => H - pad - ((v - vmin) / range) * (H - pad * 2);
    const lastVal = vals[vals.length - 1];
    const color = this._colorFor(lastVal);
    const path = filled
      .map((v, i) => (v === null ? null : (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(v).toFixed(1)))
      .filter(Boolean)
      .join(' ');
    if (!path) return null;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="60" height="22"><path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round"/></svg>';
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    const event = new CustomEvent('hass-more-info', { detail: { entityId: entityId }, bubbles: true, composed: true });
    this.dispatchEvent(event);
  }

  _render() {
    if (!this.config.entity) {
      this.innerHTML = '<div style="padding:16px;color:var(--secondary-text-color,#6b6f76);font-size:13px;">Seleziona un sensore di temperatura nelle impostazioni della card.</div>';
      return;
    }
    const t = this._num(this.config.entity);
    const hum = this._num(this.config.hum_entity);
    const color = this._colorFor(t);
    const s = this._hass && this._hass.states[this.config.entity];
    const name = this.config.name || (s && s.attributes && s.attributes.friendly_name) || this.config.entity;
    const spark = this._sparkline || '<svg viewBox="0 0 60 22" width="60" height="22"></svg>';

    this.innerHTML =
      '<style>' +
      "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');" +
      ':host{display:block;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
      '.wrap{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:18px;padding:6px 16px;}' +
      '.row{display:flex;align-items:center;gap:14px;padding:10px 0;cursor:pointer;}' +
      '.avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}' +
      '.rowinfo{flex:1;min-width:0;}' +
      '.rowname{font-size:15px;color:var(--primary-text-color,#1c1c1e);}' +
      '.rowhum{font-size:13px;color:var(--secondary-text-color,#6b6f76);}' +
      '.rowspark{flex:0 0 auto;}' +
      '.rowval{font-size:20px;font-weight:600;color:var(--primary-text-color,#1c1c1e);min-width:56px;text-align:right;}' +
      '</style>' +
      '<div class="wrap"><div class="row">' +
      '<div class="avatar" style="background:' + color + '22;color:' + color + '">' + this._iconThermo() + '</div>' +
      '<div class="rowinfo"><div class="rowname">' + name + '</div>' +
      (hum === null ? '' : '<div class="rowhum">' + hum.toFixed(0) + '% umidit\u00e0</div>') +
      '</div>' +
      '<div class="rowspark">' + spark + '</div>' +
      '<div class="rowval">' + this._fmt(t) + '</div>' +
      '</div></div>';
    const row = this.querySelector('.row');
    if (row) row.addEventListener('click', () => this._openMoreInfo(this.config.entity));
  }
}

customElements.define('temperature-row-card', TemperatureRowCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'temperature-row-card',
  name: 'Temperatura Riga Singola',
  description: 'Una riga con temperatura, umidit\u00e0 opzionale e mini grafico per una stanza. Configurabile interamente dall\u2019interfaccia (nessun YAML necessario). Aggiungine pi\u00f9 di una e impilale per ricreare una lista completa.',
});

// ===== weather-alert-card.js =====
class WeatherAlertCard extends HTMLElement {
  setConfig(config) {
    if (!config.weather_entity) {
      throw new Error('Config "weather_entity" mancante');
    }
    this.config = config;
    this._forecast = null;
    this._forecastFetchedAt = 0;
    this._lastSig = null;
  }

  set hass(hass) {
    this._hass = hass;
    const ids = [this.config.weather_entity].concat(this.config.dpc_entities || []).filter(Boolean);
    const sig = mgddStatesSig(hass, ids);
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._render();
    }
    this._maybeFetchForecast();
  }

  getCardSize() {
    return 4;
  }

  _num(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isNaN(v) ? null : v;
  }

  _state(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    return s || null;
  }

  _fmt(v, deg) {
    if (v === null || v === undefined) return '--';
    return Math.round(v) + (deg || '\u00b0');
  }

  async _maybeFetchForecast() {
    const now = Date.now();
    if (this._forecastFetchedAt && now - this._forecastFetchedAt < 5 * 60 * 1000) return;
    this._forecastFetchedAt = now;
    try {
      const hourlyResp = await this._hass.callWS({
        type: 'call_service',
        domain: 'weather',
        service: 'get_forecasts',
        service_data: { entity_id: this.config.weather_entity, type: 'hourly' },
        return_response: true,
      });
      const hourlyList = hourlyResp && hourlyResp.response && hourlyResp.response[this.config.weather_entity] && hourlyResp.response[this.config.weather_entity].forecast;
      this._forecast = hourlyList || null;
    } catch (e) {
      this._forecast = null;
    }
    try {
      const dailyResp = await this._hass.callWS({
        type: 'call_service',
        domain: 'weather',
        service: 'get_forecasts',
        service_data: { entity_id: this.config.weather_entity, type: 'daily' },
        return_response: true,
      });
      const dailyList = dailyResp && dailyResp.response && dailyResp.response[this.config.weather_entity] && dailyResp.response[this.config.weather_entity].forecast;
      this._dailyForecast = dailyList || null;
    } catch (e) {
      this._dailyForecast = null;
    }
    this._render();
  }

  _iconFor(condition, size) {
    const s = size || 20;
    const c = condition || '';
    const svg = (inner) => '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '">' + inner + '</svg>';
    const sun = '<circle cx="12" cy="12" r="5" fill="#EF9F27"/><g stroke="#EF9F27" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M4.5 19.5l2-2M17.5 6.5l2-2"/></g>';
    const moon = '<path d="M18 15.5A7.5 7.5 0 1 1 8.7 5.2a6 6 0 0 0 9.3 10.3Z" fill="#7F77DD"/>';
    const partly = '<circle cx="9" cy="9" r="4" fill="#EF9F27"/><path d="M6.5 19h11a3.3 3.3 0 0 0 .4-6.6 4.6 4.6 0 0 0-8.8-1.6A3.7 3.7 0 0 0 6.5 19Z" fill="#D3D1C7" stroke="#888780" stroke-width="0.5"/>';
    const cloud = '<path d="M5 18h13a3.6 3.6 0 0 0 .5-7.1A5.2 5.2 0 0 0 8.5 8 4.3 4.3 0 0 0 5 18Z" fill="#B4B2A9" stroke="#5F5E5A" stroke-width="0.5"/>';
    const rainCloud = '<path d="M5 14h13a3.6 3.6 0 0 0 .5-7.1A5.2 5.2 0 0 0 8.5 4 4.3 4.3 0 0 0 5 14Z" fill="#B5D4F4" stroke="#185FA5" stroke-width="0.5"/>';
    const rainDrops = '<g stroke="#378ADD" stroke-width="2" stroke-linecap="round"><path d="M8 18v3M12 18v3M16 18v3"/></g>';
    const stormCloud = '<path d="M5 13h13a3.6 3.6 0 0 0 .5-7.1A5.2 5.2 0 0 0 8.5 3 4.3 4.3 0 0 0 5 13Z" fill="#8a8d93" stroke="#444441" stroke-width="0.5"/>';
    const bolt = '<path d="M13 12l-3.5 5h3.5l-2 5" fill="#F7C1C1" stroke="#E24B4A" stroke-width="1.2" stroke-linejoin="round"/>';
    const snowDots = '<g fill="#378ADD"><circle cx="8" cy="19" r="1.4"/><circle cx="12" cy="20" r="1.4"/><circle cx="16" cy="19" r="1.4"/></g>';
    if (c === 'sunny') return svg(sun);
    if (c === 'clear-night') return svg(moon);
    if (c === 'partlycloudy') return svg(partly);
    if (c === 'cloudy' || c === 'fog' || c === 'exceptional') return svg(cloud);
    if (c === 'rainy' || c === 'pouring') return svg(rainCloud + rainDrops);
    if (c === 'lightning' || c === 'lightning-rainy' || c === 'hail') return svg(stormCloud + bolt);
    if (c === 'snowy' || c === 'snowy-rainy') return svg(rainCloud + snowDots);
    if (c === 'windy' || c === 'windy-variant') return svg(cloud);
    return svg(cloud);
  }

  _iconTriangle(color, size) {
    const s = size || 22;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.6" fill="' + color + '" stroke="none"/></svg>';
  }

  _iconStorm(color, size) {
    const s = size || 22;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 17 8a4 4 0 0 1 0 6"/><path d="M13 12l-3 4h3l-2 3"/></svg>';
  }

  _dpcColors(level) {
    if (level >= 4) return { bg: '#FCEBEB', text: '#791F1F', icon: '#E24B4A' };
    if (level >= 3) return { bg: '#FCEBEB', text: '#A32D2D', icon: '#E24B4A' };
    return { bg: '#FAEEDA', text: '#854F0B', icon: '#EF9F27' };
  }

  _buildDemoBanners() {
    const dpcColors = this._dpcColors(3);
    const dpcBanner =
      '<div class="banner" style="background:' + dpcColors.bg + '">' +
      '<div class="banner-icon" style="color:' + dpcColors.icon + '">' + this._iconTriangle(dpcColors.icon) + '</div>' +
      '<div class="banner-body">' +
      '<div class="banner-title" style="color:' + dpcColors.text + '">Temporali \u2014 ALLERTA ARANCIONE</div>' +
      '<div class="banner-sub" style="color:' + dpcColors.text + '">Protezione Civile \u00b7 Bacino del Livenza e del Lemene (demo)</div>' +
      '</div>' +
      '<span class="banner-tag" style="color:' + dpcColors.text + '">Elevato</span>' +
      '</div>';
    const rainBanner =
      '<div class="banner" style="background:#FCEBEB">' +
      '<div class="banner-icon" style="color:#E24B4A">' + this._iconStorm('#E24B4A') + '</div>' +
      '<div class="banner-body">' +
      '<div class="banner-title" style="color:#791F1F">Possibili temporali nelle prossime 6 ore (demo)</div>' +
      '<div class="banner-sub" style="color:#791F1F">iLMeteo.it \u00b7 ~8.4mm previsti</div>' +
      '</div>' +
      '<span class="banner-tag" style="color:#791F1F">Alto</span>' +
      '</div>';
    return [dpcBanner, rainBanner];
  }

  _buildDpcBanners() {
    const entities = this.config.dpc_entities || [];
    const banners = [];
    entities.forEach((eid) => {
      const s = this._state(eid);
      if (!s || s.state !== 'on') return;
      const a = s.attributes || {};
      const level = a.level || 2;
      const c = this._dpcColors(level);
      const label = { 2: 'Moderato', 3: 'Elevato', 4: 'Alto' }[level] || 'Attivo';
      const when = eid.endsWith('_domani') ? 'Domani' : (eid.endsWith('_oggi') ? 'Oggi' : '');
      banners.push(
        '<div class="banner" style="background:' + c.bg + '">' +
        '<div class="banner-icon" style="color:' + c.icon + '">' + this._iconTriangle(c.icon) + '</div>' +
        '<div class="banner-body">' +
        '<div class="banner-title" style="color:' + c.text + '">' + (a.risk || 'Allerta') + ' \u2014 ' + (a.alert || '') + (when ? ' \u00b7 ' + when : '') + '</div>' +
        '<div class="banner-sub" style="color:' + c.text + '">Protezione Civile \u00b7 ' + (a.zone_name || '') + '</div>' +
        '</div>' +
        '<span class="banner-tag" style="color:' + c.text + '">' + label + '</span>' +
        '</div>'
      );
    });
    return banners;
  }

  _buildRainBanner() {
    if (!this._forecast) return '';
    const hours = this.config.rain_alert_hours || 6;
    const threshold = this.config.rain_alert_mm != null ? this.config.rain_alert_mm : 3;
    const now = Date.now();
    const window = this._forecast.filter((f) => {
      const t = new Date(f.datetime).getTime();
      return t >= now && t <= now + hours * 3600 * 1000;
    });
    if (!window.length) return '';
    const totalMm = window.reduce((sum, f) => sum + (f.precipitation || 0), 0);
    const stormy = window.some((f) => ['lightning', 'lightning-rainy', 'hail'].indexOf(f.condition) >= 0);
    if (!stormy && totalMm < threshold) return '';
    const severe = stormy || totalMm >= threshold * 2;
    const bg = severe ? '#FCEBEB' : '#FAEEDA';
    const text = severe ? '#791F1F' : '#854F0B';
    const icon = severe ? '#E24B4A' : '#EF9F27';
    const label = severe ? 'Alto' : 'Moderato';
    const title = stormy ? 'Possibili temporali nelle prossime ' + hours + ' ore' : 'Pioggia intensa nelle prossime ' + hours + ' ore';
    return (
      '<div class="banner" style="background:' + bg + '">' +
      '<div class="banner-icon" style="color:' + icon + '">' + this._iconStorm(icon) + '</div>' +
      '<div class="banner-body">' +
      '<div class="banner-title" style="color:' + text + '">' + title + '</div>' +
      '<div class="banner-sub" style="color:' + text + '">iLMeteo.it \u00b7 ~' + totalMm.toFixed(1) + 'mm previsti</div>' +
      '</div>' +
      '<span class="banner-tag" style="color:' + text + '">' + label + '</span>' +
      '</div>'
    );
  }

  _buildHourlyRow() {
    if (!this._forecast) return '<div class="strip-loading">Caricamento\u2026</div>';
    const count = this.config.hourly_count || 5;
    const points = this._forecast.slice(0, count);
    return points
      .map((f) => {
        const d = new Date(f.datetime);
        const hh = d.getHours().toString().padStart(2, '0');
        return (
          '<div class="hour">' +
          '<div class="hour-t">' + hh + '</div>' +
          '<div class="hour-icon">' + this._iconFor(f.condition, 36) + '</div>' +
          '<div class="hour-v">' + this._fmt(f.temperature, '\u00b0') + '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  _buildDailyList() {
    if (!this._dailyForecast || this._dailyForecast.length < 2) return '<div class="strip-loading">Caricamento\u2026</div>';
    const count = this.config.daily_count || 4;
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    const days = this._dailyForecast.slice(1, 1 + count);
    return days
      .map((f, i) => {
        const d = new Date(f.datetime);
        const label = i === 0 ? 'Domani' : dayNames[d.getDay()];
        return (
          '<div class="day-row">' +
          '<span class="day-label">' + label + '</span>' +
          '<span class="day-icon">' + this._iconFor(f.condition, 18) + '</span>' +
          '<span class="day-range">' + this._fmt(f.templow, '\u00b0') + '/' + this._fmt(f.temperature, '\u00b0') + '</span>' +
          '</div>'
        );
      })
      .join('');
  }

  _render() {
    const w = this._state(this.config.weather_entity);
    const cond = w ? w.state : null;
    const temp = w && w.attributes ? w.attributes.temperature : null;
    const condLabels = {
      sunny: 'Sereno',
      'clear-night': 'Sereno',
      partlycloudy: 'Poco nuvoloso',
      cloudy: 'Nuvoloso',
      fog: 'Nebbia',
      rainy: 'Pioggia',
      pouring: 'Pioggia intensa',
      lightning: 'Temporale',
      'lightning-rainy': 'Temporale',
      hail: 'Grandine',
      snowy: 'Neve',
      'snowy-rainy': 'Pioggia e neve',
      windy: 'Ventoso',
      'windy-variant': 'Ventoso',
      exceptional: 'Condizioni estreme',
    };
    const condLabel = condLabels[cond] || cond || '';

    const banners = this.config.demo_alert ? this._buildDemoBanners() : this._buildDpcBanners();
    const rainBanner = this.config.demo_alert ? '' : this._buildRainBanner();
    if (rainBanner) banners.push(rainBanner);
    const bannersHtml = banners.join('');

    const hourlyHtml = this._buildHourlyRow();
    const dailyHtml = this._buildDailyList();

    this.innerHTML =
      '<style>' +
      "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');" +
      ':host{display:block;}' +
      '.wrap{font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
      '.banners{display:flex;flex-direction:column;gap:8px;margin-bottom:' + (banners.length ? '12px' : '0') + ';}' +
      '.banner{border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px;}' +
      '.banner-icon{flex:0 0 auto;display:flex;}' +
      '.banner-body{flex:1;min-width:0;}' +
      '.banner-title{font-size:13px;font-weight:600;}' +
      '.banner-sub{font-size:11px;opacity:0.85;margin-top:1px;}' +
      '.banner-tag{font-size:11px;font-weight:600;background:var(--card-background-color,#fff);padding:3px 10px;border-radius:20px;flex:0 0 auto;}' +
      '.weathercard{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:18px;padding:14px 16px;cursor:pointer;}' +
      '.weathercard:active{opacity:0.7;}' +
      '.wc-top{display:flex;justify-content:space-between;align-items:center;}' +
      '.wc-loc{font-size:12px;color:var(--secondary-text-color,#6b6f76);}' +
      '.wc-temp{font-size:40px;font-weight:600;letter-spacing:-1px;color:var(--primary-text-color,#1c1c1e);margin-top:2px;}' +
      '.wc-cond{font-size:13px;color:var(--secondary-text-color,#6b6f76);margin-top:2px;}' +
      '.wc-split{display:grid;grid-template-columns:1.4fr 1fr;gap:0;margin-top:12px;padding-top:12px;border-top:1px solid var(--divider-color,rgba(0,0,0,.08));}' +
      '.wc-hours{padding-right:16px;display:flex;flex-direction:column;justify-content:center;}' +
      '.wc-days{border-left:1px solid var(--divider-color,rgba(0,0,0,.08));padding-left:16px;}' +
      '.section-label{font-size:11px;color:var(--secondary-text-color,#6b6f76);margin-bottom:10px;}' +
      '.hour-row{display:flex;}' +
      '.hour{text-align:center;flex:1;}' +
      '.hour-t{font-size:12px;color:var(--secondary-text-color,#6b6f76);}' +
      '.hour-icon{margin:4px auto;display:flex;justify-content:center;}' +
      '.hour-v{font-size:17px;font-weight:500;color:var(--primary-text-color,#1c1c1e);}' +
      '.day-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;}' +
      '.day-label{font-size:12px;color:var(--secondary-text-color,#6b6f76);width:52px;}' +
      '.day-icon{display:flex;}' +
      '.day-range{font-size:13px;font-weight:500;color:var(--primary-text-color,#1c1c1e);}' +
      '.strip-loading{font-size:12px;color:var(--secondary-text-color,#6b6f76);}' +
      '@media (max-width:520px){.wc-split{grid-template-columns:1fr;}.wc-hours{padding-right:0;padding-bottom:14px;}.wc-days{border-left:none;padding-left:0;border-top:1px solid var(--divider-color,rgba(0,0,0,.08));padding-top:14px;}}' +
      '</style>' +
      '<div class="wrap">' +
      (bannersHtml ? '<div class="banners">' + bannersHtml + '</div>' : '') +
      '<div class="weathercard">' +
      '<div class="wc-top"><div>' +
      '<div class="wc-loc">' + (this.config.title || 'Casa') + ' \u00b7 iLMeteo.it</div>' +
      '<div class="wc-temp">' + this._fmt(temp) + '</div>' +
      '<div class="wc-cond">' + condLabel + '</div>' +
      '</div>' + this._iconFor(cond, 52) + '</div>' +
      '<div class="wc-split">' +
      '<div class="wc-hours"><div class="section-label">Prossime ore</div><div class="hour-row">' + hourlyHtml + '</div></div>' +
      '<div class="wc-days"><div class="section-label">Prossimi giorni</div>' + dailyHtml + '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
    const wc = this.querySelector('.weathercard');
    if (wc) {
      wc.addEventListener('click', () => this._openMoreInfo(this.config.weather_entity));
    }
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    const event = new CustomEvent('hass-more-info', {
      detail: { entityId: entityId },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }
}

WeatherAlertCard.getStubConfig = function () {
  return {
    weather_entity: 'weather.home',
    dpc_entities: [],
  };
};

customElements.define('weather-alert-card', WeatherAlertCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'weather-alert-card',
  name: 'Meteo e Allerte',
  description: 'Card meteo (ore/giorni) con banner allerta Protezione Civile e rischio pioggia/temporale. Config manuale via YAML.',
});

// ===== energy-power-card.js =====
class EnergyPowerCard extends HTMLElement {
  setConfig(config) {
    this.config = config;
    this._trend = null;
    this._sparklines = {};
    this._fetchedAt = 0;
    this._lastSig = null;
    if (!this._uid) {
      EnergyPowerCard._seq = (EnergyPowerCard._seq || 0) + 1;
      this._uid = EnergyPowerCard._seq;
    }
  }

  set hass(hass) {
    this._hass = hass;
    const cfg = this.config || {};
    const ids = [];
    if (cfg.power_entity) ids.push(cfg.power_entity);
    if (cfg.energy_day_entity) ids.push(cfg.energy_day_entity);
    if (cfg.energy_month_entity) ids.push(cfg.energy_month_entity);
    if (cfg.total_energy_entity) ids.push(cfg.total_energy_entity);
    ['grid_import', 'grid_export', 'house', 'solar', 'battery_charge', 'battery_discharge'].forEach((k) => {
      if (cfg[k]) ids.push(cfg[k]);
    });
    (cfg.circuits || []).forEach((c) => {
      if (c.entity) ids.push(c.entity);
      if (c.switch) ids.push(c.switch);
    });
    const sig = mgddStatesSig(hass, ids);
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._paintThrottled();
    }
    this._maybeFetchHistory();
  }

  // I sensori di potenza pubblicano ogni 1-2 s: senza un intervallo minimo la
  // card ridisegna di continuo. `refresh` (secondi, default 2) accorpa gli
  // aggiornamenti ravvicinati; l'ultimo arrivato viene comunque disegnato.
  _paintThrottled() {
    const gap = (this.config.refresh != null ? this.config.refresh : 2) * 1000;
    const now = Date.now();
    if (!gap || !this._paintedAt || now - this._paintedAt >= gap) {
      this._paintedAt = now;
      this._render();
      return;
    }
    if (this._paintTimer) return;
    this._paintTimer = setTimeout(() => {
      this._paintTimer = null;
      this._paintedAt = Date.now();
      this._render();
    }, gap - (now - this._paintedAt));
  }

  disconnectedCallback() {
    if (this._paintTimer) {
      clearTimeout(this._paintTimer);
      this._paintTimer = null;
    }
    if (this._mqNarrow && this._mqOnChange) {
      if (this._mqNarrow.removeEventListener) this._mqNarrow.removeEventListener('change', this._mqOnChange);
      else this._mqNarrow.removeListener(this._mqOnChange);
      this._mqNarrow = null;
    }
  }

  getCardSize() {
    return 5;
  }

  _num(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isNaN(v) ? null : v;
  }
  // potenza normalizzata a W leggendo l'unita' dell'entita' (kW->W). Preserva il segno.
  _pw(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    if (Number.isNaN(v)) return null;
    const u = ((s.attributes && s.attributes.unit_of_measurement) || '').toLowerCase();
    if (u === 'kw') return v * 1000;
    if (u === 'mw') return v * 1e6;
    return v; // W o unita' non dichiarata: assume W
  }

  _fmt(v, unit, dec) {
    if (v === null || v === undefined) return '--';
    return v.toFixed(dec === undefined ? 0 : dec) + (unit || '');
  }

  async _maybeFetchHistory() {
    const now = Date.now();
    if (this._fetchedAt && now - this._fetchedAt < 5 * 60 * 1000) return;
    this._fetchedAt = now;
    const entities = [];
    const perCircuit = this.config.layout === 'circuits' || this.config.layout === 'tiles' || this.config.layout === 'controls' || this.config.layout === 'headergraph';
    if (this.config.layout === 'overview' && this.config.power_entity) entities.push(this.config.power_entity);
    if (perCircuit && this.config.circuits) {
      this.config.circuits.forEach((c) => entities.push(c.entity));
    }
    if (entities.length && this._hass) {
      const hours = this.config.history_hours || 24;
      const start = new Date(now - hours * 3600 * 1000).toISOString();
      try {
        const path = 'history/period/' + start + '?filter_entity_id=' + entities.join(',') + '&minimal_response';
        const data = await this._hass.callApi('GET', path);
        if (this.config.layout === 'overview') {
          this._trendArea = this._buildTileSpark(data[0], now, hours, this.config.hero_color || '#7F77DD', 'epcov' + this._uid, 56);
        } else if (this.config.layout === 'tiles' || this.config.layout === 'controls' || this.config.layout === 'headergraph') {
          this.config.circuits.forEach((c, i) => {
            this._sparklines[c.entity] = this._buildTileSpark(data[i], now, hours, c.color || this._paletteColor(i), 'epcg' + this._uid + '_' + i);
          });
        } else {
          this.config.circuits.forEach((c, i) => {
            this._sparklines[c.entity] = this._buildSparkline(data[i], now, hours, this._paletteColor(i));
          });
        }
      } catch (e) {
        /* keep loading state */
      }
    }
    // Layout balance: statistiche orarie (change + state) dei contatori, dall'ora
    // prima di mezzanotte a ora. Una sola callWS per tutti i sensori. Alimenta sia
    // il riepilogo del giorno sia il profilo orario: una fonte, due viste.
    //
    // Le statistiche, e non lo stato live dei contatori *_today, perche' il
    // recorder ricostruisce la crescita del contatore anche attraverso i buchi:
    // un utility_meter che perde il collegamento alla sorgente perde per sempre
    // l'energia accumulata mentre era irraggiungibile.
    if (this.config.layout === 'balance' && this._hass) {
      const cfg = this.config;
      const ids = [cfg.house, cfg.solar, cfg.grid_import, cfg.grid_export,
        cfg.battery_charge, cfg.battery_discharge].filter(Boolean);
      if (ids.length) {
        const nowD = new Date(now);
        const dayStart = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate());
        // un'ora prima di mezzanotte: la riga delle 23 porta il valore del contatore
        // a fine ora, cioe' a mezzanotte. E' il riferimento da cui misurare la prima
        // ora del giorno, quando di righe di oggi non ce n'e' ancora nessuna.
        const from = new Date(dayStart.getTime() - 3600 * 1000);
        try {
          const resp = await this._hass.callWS({
            type: 'recorder/statistics_during_period',
            start_time: from.toISOString(),
            end_time: nowD.toISOString(),
            statistic_ids: ids,
            period: 'hour',
            types: ['change', 'state'],
          });
          this._balStats = this._buildBalStats(resp, ids, dayStart);
        } catch (e) {
          /* senza recorder la card mostra "--": nessun numero inventato */
        }
      }
    }
    const statsEntity = this.config.total_energy_entity || this.config.energy_day_entity;
    if (this.config.layout === 'overview' && statsEntity && this._hass) {
      const nowD = new Date(now);
      // confronto equo: ieri fino alla stessa ora
      try {
        const yStart = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate() - 1);
        const yEnd = new Date(now - 24 * 3600 * 1000);
        const resp = await this._hass.callWS({
          type: 'recorder/statistics_during_period',
          start_time: yStart.toISOString(),
          end_time: yEnd.toISOString(),
          statistic_ids: [statsEntity],
          period: 'hour',
          types: ['change'],
        });
        const list = (resp && resp[statsEntity]) || [];
        if (list.length) this._yesterday = list.reduce((s, r) => s + (r.change || 0), 0);
      } catch (e) {
        /* comparison optional, ignore errors */
      }
      // confronto equo: mese precedente fino allo stesso giorno/ora
      try {
        const pmStart = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1);
        let pmEnd = new Date(nowD.getFullYear(), nowD.getMonth() - 1, nowD.getDate(), nowD.getHours(), nowD.getMinutes());
        const curStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
        if (pmEnd > curStart) pmEnd = curStart;
        const respM = await this._hass.callWS({
          type: 'recorder/statistics_during_period',
          start_time: pmStart.toISOString(),
          end_time: pmEnd.toISOString(),
          statistic_ids: [statsEntity],
          period: 'hour',
          types: ['change'],
        });
        const listM = (respM && respM[statsEntity]) || [];
        if (listM.length) this._lastMonth = listM.reduce((s, r) => s + (r.change || 0), 0);
      } catch (e) {
        /* comparison optional, ignore errors */
      }
      // Oggi e Mese dal solo contatore cumulativo, quando non sono indicate entita'
      // dedicate: un contatore cumulativo le contiene entrambe. Qui si memorizza la
      // parte gia' compilata dalle statistiche e il valore del contatore a quel
      // confine; il resto lo calcola _renderOverview leggendo il valore live, cosi' i
      // due numeri non aspettano ne' questo fetch (5 min) ne' la compilazione oraria.
      if (statsEntity && (!this.config.energy_day_entity || !this.config.energy_month_entity)) {
        try {
          const mStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
          const respD = await this._hass.callWS({
            type: 'recorder/statistics_during_period',
            start_time: mStart.toISOString(),
            end_time: nowD.toISOString(),
            statistic_ids: [statsEntity],
            period: 'day',
            types: ['change', 'state'],
          });
          const rows = (respD && respD[statsEntity]) || [];
          if (rows.length) {
            const dayStart = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
            const todayRow = rows.find((r) => new Date(r.start).getTime() === dayStart);
            this._mtd = {
              month: rows.reduce((s, r) => s + (r.change || 0), 0),
              day: todayRow ? todayRow.change || 0 : 0,
              upTo: parseFloat(rows[rows.length - 1].state),
            };
          }
        } catch (e) {
          /* senza recorder i riquadri restano a "—": nessun valore inventato */
        }
      }
    }
    this._render();
  }

  // Da risposta statistiche a, per ogni entita': i kWh per ora del giorno, il loro
  // totale, e il valore del contatore al confine dell'ultima ora compilata. Le righe
  // prima di mezzanotte non entrano nei bucket: servono solo a fissare il confine.
  _buildBalStats(resp, ids, dayStart) {
    const out = {};
    ids.forEach((id) => {
      const hours = new Array(24).fill(0);
      let compiled = 0;
      let edge = null;
      ((resp && resp[id]) || []).forEach((r) => {
        const s = parseFloat(r.state);
        if (!Number.isNaN(s)) edge = s;
        const d = new Date(r.start);
        if (d < dayStart) return;
        const h = d.getHours();
        const v = Math.max(0, r.change || 0);
        if (h >= 0 && h < 24) hours[h] += v;
        compiled += v;
      });
      out[id] = { hours: hours, compiled: compiled, edge: edge };
    });
    return out;
  }

  _toPoints(arr) {
    return (arr || [])
      .map((p) => ({ t: new Date(p.last_changed).getTime(), v: parseFloat(p.state) }))
      .filter((p) => !Number.isNaN(p.v));
  }

  _bucketize(pts, buckets, minT, span) {
    const out = [];
    for (let i = 0; i < buckets; i++) out.push([]);
    pts.forEach((p) => {
      let idx = Math.floor(((p.t - minT) / span) * buckets);
      if (idx < 0) idx = 0;
      if (idx >= buckets) idx = buckets - 1;
      out[idx].push(p.v);
    });
    return out.map((a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null));
  }

  _fillGaps(arr) {
    let last = null;
    const res = arr.map((v) => {
      if (v !== null) last = v;
      return last;
    });
    let next = null;
    for (let i = res.length - 1; i >= 0; i--) {
      if (res[i] !== null) next = res[i];
      else res[i] = next;
    }
    return res;
  }

  _buildTrend(arr, nowMs, hours) {
    const pts = this._toPoints(arr);
    if (!pts.length) return null;
    const buckets = 24;
    const minT = nowMs - hours * 3600 * 1000;
    const span = hours * 3600 * 1000;
    const f = this._fillGaps(this._bucketize(pts, buckets, minT, span)).filter((v) => v !== null);
    if (!f.length) return null;
    const vmin = Math.min.apply(null, f);
    const vmax = Math.max.apply(null, f);
    const range = vmax - vmin || 1;
    const ramp = ['#CDE9B9', '#EF9F27', '#D85A30', '#B93C3C'];
    const bars = f
      .map((v) => {
        const t = (v - vmin) / range;
        const heightPct = 20 + t * 80;
        const idx = Math.round(t * (ramp.length - 1));
        return '<div style="flex:1;background:' + ramp[idx] + ';border-radius:2px;height:' + heightPct.toFixed(0) + '%;"></div>';
      })
      .join('');
    const html = '<div class="trend-bars">' + bars + '</div>';
    return { html: html, min: vmin, max: vmax };
  }

  _paletteColor(i) {
    const palette = ['#EF9F27', '#378ADD', '#639922', '#7F77DD', '#D85A30', '#D4537E', '#1D9E75', '#BA7517'];
    return palette[i % palette.length];
  }

  _buildSparkline(arr, nowMs, hours, color) {
    const pts = this._toPoints(arr);
    if (!pts.length) return null;
    const buckets = 16;
    const minT = nowMs - hours * 3600 * 1000;
    const span = hours * 3600 * 1000;
    const f = this._fillGaps(this._bucketize(pts, buckets, minT, span)).filter((v) => v !== null);
    if (!f.length) return null;
    const vmin = Math.min.apply(null, f);
    const vmax = Math.max.apply(null, f);
    const range = vmax - vmin || 1;
    const W = 60;
    const H = 22;
    const pad = 3;
    const x = (i) => (i / (f.length - 1)) * W;
    const y = (v) => H - pad - ((v - vmin) / range) * (H - pad * 2);
    const line = f.map((v, i) => (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="60" height="22"><path d="' + line + '" fill="none" stroke="' + (color || '#EF9F27') + '" stroke-width="1.6"/></svg>';
  }

  // loads e plugs stanno spesso affiancati nella stessa riga: si allungano
  // all'altezza della riga invece di fermarsi al proprio contenuto.
  // Solo da EPC_FILL_MIN in su: sotto quella larghezza la vista e' a colonna
  // singola, l'allungamento non serve, e forzare height:100% dentro una riga di
  // griglia ad altezza automatica crea una dipendenza circolare fra contenuto e
  // riga. Su iOS Safari basta a far risalire lo scroll della vista.
  _applyFill() {
    const c = this.config || {};
    const wide = !(this._mqNarrow && this._mqNarrow.matches);
    const fill = (c.layout === 'plugs' || c.layout === 'loads') && c.stretch !== false && wide;
    this.classList.toggle('epc-fill', fill);
    this.style.display = fill ? 'block' : '';
    this.style.height = fill ? '100%' : '';
    // hui-card sta fra la cella della griglia e questa card: senza altezza
    // propria il 100% qui sopra non avrebbe riferimento
    const p = this.parentElement;
    if (p && p.localName === 'hui-card') {
      p.style.display = fill ? 'block' : '';
      p.style.height = fill ? '100%' : '';
    }
  }

  connectedCallback() {
    if (!this._mqNarrow && window.matchMedia) {
      const min = this.config && this.config.stretch_min != null ? this.config.stretch_min : 768;
      this._mqNarrow = window.matchMedia('(max-width:' + (min - 1) + 'px)');
      this._mqOnChange = () => this._applyFill();
      if (this._mqNarrow.addEventListener) this._mqNarrow.addEventListener('change', this._mqOnChange);
      else this._mqNarrow.addListener(this._mqOnChange);
    }
    this._applyFill();
  }

  _render() {
    this._applyFill();
    if (this.config.layout === 'plugs') this._renderPlugs();
    else if (this.config.layout === 'loads') this._renderLoads();
    else if (this.config.layout === 'controls') this._renderControlTiles();
    else if (this.config.layout === 'headergraph') this._renderHeaderGraph();
    else if (this.config.layout === 'balance') this._renderBalance();
    else if (this.config.layout === 'tiles') this._renderTiles();
    else if (this.config.layout === 'circuits') this._renderCircuits();
    else this._renderOverview();
  }

  // sparkline area a piena larghezza per le tile (scala da zero)
  _buildTileSpark(arr, nowMs, hours, color, gid) {
    const pts = this._toPoints(arr);
    if (!pts.length) return null;
    const buckets = 20;
    const minT = nowMs - hours * 3600 * 1000;
    const span = hours * 3600 * 1000;
    const f = this._fillGaps(this._bucketize(pts, buckets, minT, span)).filter((v) => v !== null);
    if (!f.length) return null;
    const vmax = Math.max.apply(null, f) || 1;
    const W = 120,
      H = 36,
      padTop = 6,
      n = f.length;
    const xA = (i) => (n === 1 ? W / 2 : (i * W) / (n - 1));
    const yA = (v) => H - (Math.max(0, v) / vmax) * (H - padTop);
    const p = f.map((v, i) => ({ x: xA(i), y: yA(v) }));
    const fx = (x) => x.toFixed(1);
    let d = 'M' + fx(p[0].x) + ',' + fx(p[0].y);
    const t = 0.18;
    for (let i = 0; i < n - 1; i++) {
      const a = p[i - 1] || p[i];
      const b = p[i];
      const c = p[i + 1];
      const e = p[i + 2] || c;
      d += 'C' + fx(b.x + (c.x - a.x) * t) + ',' + fx(b.y + (c.y - a.y) * t) + ' ' + fx(c.x - (e.x - b.x) * t) + ',' + fx(c.y - (e.y - b.y) * t) + ' ' + fx(c.x) + ',' + fx(c.y);
    }
    const areaD = n < 2 ? '' : d + ' L' + fx(p[n - 1].x) + ',' + H + ' L' + fx(p[0].x) + ',' + H + ' Z';
    return (
      '<svg class="epc-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + color + '" stop-opacity="0.30"/>' +
      '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      (areaD ? '<path d="' + areaD + '" fill="url(#' + gid + ')"/>' : '') +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );
  }

  _renderTiles() {
    const circuits = this.config.circuits || [];
    const tiles = circuits
      .map((c, i) => {
        const v = this._num(c.entity);
        const color = this._paletteColor(i);
        const spark = this._sparklines[c.entity] || '<svg class="epc-spark" viewBox="0 0 120 36" preserveAspectRatio="none"></svg>';
        return (
          '<div class="epc-tile" data-entity="' + c.entity + '">' +
          '<div class="epc-tile-head"><span class="epc-dot" style="background:' + color + '"></span>' +
          '<span class="epc-name">' + c.name + '</span></div>' +
          '<div class="epc-val">' + this._fmt(v, '', v !== null && v < 10 ? 1 : 0) + '<span class="epc-u"> W</span></div>' +
          '<div class="epc-sparkwrap">' + spark + '</div>' +
          '</div>'
        );
      })
      .join('');
    mgddPaint(this, this._styles(), '<div class="epc-tiles">' + tiles + '</div>');
    this._wireClicks();
  }

  _isOn(entity) {
    if (!entity || !this._hass) return false;
    const s = this._hass.states[entity];
    return !!s && s.state === 'on';
  }

  // layout A3: nome + eventuale interruttore in alto; potenza a sinistra e sparkline a destra
  _renderControlTiles() {
    const circuits = this.config.circuits || [];
    const tiles = circuits
      .map((c, i) => {
        const v = this._num(c.entity);
        const spark = this._sparklines[c.entity] || '<svg class="epc-spark" viewBox="0 0 120 36" preserveAspectRatio="none"></svg>';
        const hasSwitch = !!c.switch;
        const on = hasSwitch ? this._isOn(c.switch) : true;
        const off = hasSwitch && !on; // tile grigiata quando lo switch e spento
        let ctrl = '';
        if (hasSwitch) {
          ctrl =
            '<button class="epcs-sw' + (on ? ' on' : '') + '" data-switch="' + c.switch + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + c.name + '">' +
            '<span class="epcs-dot"></span>' + (on ? 'On' : 'Off') +
            '</button>';
        }
        return (
          '<div class="epcs-tile' + (off ? ' off' : '') + '" data-entity="' + c.entity + '">' +
          '<div class="epcs-head"><span class="epcs-name">' + c.name + '</span>' + ctrl + '</div>' +
          '<div class="epcs-body">' +
          '<span class="epcs-val">' + this._fmt(v, '', v !== null && v < 10 ? 1 : 0) + '<span class="epcs-u"> W</span></span>' +
          '<div class="epcs-spark">' + spark + '</div>' +
          '</div></div>'
        );
      })
      .join('');
    mgddPaint(this, this._styles(), '<div class="epcs-tiles">' + tiles + '</div>');
    this._wireSwitches();
    this._wireClicks();
  }

  // layout F: header colorato per stato (nome + eventuale toggle On/Off) e
  // grafico ad area a piena larghezza sotto il valore in W.
  _renderHeaderGraph() {
    const circuits = this.config.circuits || [];
    const tiles = circuits
      .map((c, i) => {
        const v = this._num(c.entity);
        const color = c.color || this._paletteColor(i);
        const hasSwitch = !!c.switch;
        const on = hasSwitch ? this._isOn(c.switch) : true;
        const off = hasSwitch && !on;
        const head = off ? '#aab0b8' : color;
        const spark = this._sparklines[c.entity] || '<svg class="epc-spark" viewBox="0 0 120 36" preserveAspectRatio="none"></svg>';
        const ctrl = hasSwitch
          ? '<button class="ephg-sw" data-switch="' + c.switch + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + c.name + '">' + (on ? 'On' : 'Off') + '</button>'
          : '';
        return (
          '<div class="ephg-tile' + (off ? ' off' : '') + '" data-entity="' + c.entity + '">' +
          '<div class="ephg-head" style="background:' + head + '"><span class="ephg-name">' + c.name + '</span>' + ctrl + '</div>' +
          '<div class="ephg-body">' +
          '<div class="ephg-val">' + this._fmt(v, '', v !== null && v < 10 ? 1 : 0) + '<span class="ephg-u"> W</span></div>' +
          '<div class="ephg-spark">' + spark + '</div>' +
          '</div></div>'
        );
      })
      .join('');
    mgddPaint(this, this._styles(), '<div class="ephg-tiles">' + tiles + '</div>');
    this._wireSwitches();
    this._wireClicks();
  }

  // kWh per ora di oggi di un contatore: la parte compilata dal recorder piu' il
  // pezzo di ora in corso, ricavato dal valore live. Senza quest'ultimo i numeri
  // aspetterebbero la compilazione oraria del recorder, cioe' fino a un'ora.
  //
  // `cumulative: true` dichiara contatori che non azzerano a mezzanotte: il pezzo
  // vivo si misura dal confine dell'ultima ora compilata. Con i contatori *_today,
  // che azzerano, si misura invece dal totale di oggi gia' compilato.
  _balanceHours(id) {
    const st = this._balStats && this._balStats[id];
    if (!st) return null;
    const hours = st.hours.slice();
    const live = this._num(id);
    if (live !== null) {
      const base = this.config.cumulative === true ? st.edge : st.compiled;
      if (base !== null && isFinite(base) && live > base) hours[new Date().getHours()] += live - base;
    }
    return hours;
  }

  // layout balance (variante "Arc"): bilancio energetico giornaliero.
  // Scomposizione del consumo di casa nelle tre origini, ora per ora. Il riepilogo
  // del giorno e' la somma delle ore, non un secondo calcolo sui totali: i due non
  // possono raccontare cose diverse, e la scomposizione oraria e' molto piu' fedele
  // (nella singola ora consumo e produzione sono davvero contemporanei).
  //
  // Il solare viene LETTO dal sensore, non dedotto per differenza. Prima era il
  // residuo casa-batteria-rete: siccome quei contatori hanno un solo decimale e non
  // scattano nello stesso istante, ogni ora sballava di +-0.1 kWh e quel decimo
  // finiva etichettato come solare anche con i pannelli staccati. Ora il residuo e'
  // la RETE, che e' il numero grande: li' 0.1 kWh e' rumore invisibile.
  //
  // Il solare copre PRIMA la casa e poi la batteria: e' l'ordine di priorita' reale
  // del Powerwall in autoconsumo. Il consumo di casa e' quello di casa e basta: la
  // carica della batteria non ci viene sommata. Sommarla senza accreditare anche il
  // solare che l'ha prodotta gonfiava la rete, che qui e' il residuo, e schiacciava
  // l'autosufficienza (con i dati del 31/07: rete 9.3 kWh invece di 3.6, 27% invece
  // di 52%). L'errore era invisibile finche' la batteria caricava 0.5 kWh al giorno.
  //
  // La batteria conta come autoprodotta solo per la frazione con cui e' stata
  // caricata dal sole. Caricarla dalla rete e riscaricarla non e' autosufficienza:
  // e' la stessa energia della rete che fa un giro. La frazione si calcola sul
  // GIORNO, non sull'ora: si carica di pomeriggio e si scarica di sera, quando la
  // carica e' zero e una frazione oraria risulterebbe nulla: tutta la scarica della
  // sera finirebbe etichettata come rete.
  _balanceModel() {
    const c = this.config;
    const house = c.house ? this._balanceHours(c.house) : null;
    if (!house) return null;
    const zero = () => new Array(24).fill(0);
    const solar = this._balanceHours(c.solar) || zero();
    const gexp = this._balanceHours(c.grid_export) || zero();
    const chg = this._balanceHours(c.battery_charge) || zero();
    const dis = this._balanceHours(c.battery_discharge) || zero();

    const sun = zero();
    let chgTot = 0;
    let greenTot = 0;
    for (let h = 0; h < 24; h++) {
      // solare rimasto in casa: prodotto meno quello immesso in rete
      const site = Math.max(0, solar[h] - gexp[h]);
      sun[h] = Math.min(site, house[h]);
      chgTot += chg[h];
      greenTot += Math.min(chg[h], site - sun[h]);
    }
    const green = chgTot > 0 ? greenTot / chgTot : 0;

    const rows = [];
    const day = { house: 0, sun: 0, batt: 0, grid: 0, self: null };
    const upTo = new Date().getHours();
    for (let h = 0; h <= upTo; h++) {
      const rest = Math.max(0, house[h] - sun[h]);
      const batt = Math.min(dis[h] * green, rest);
      rows.push({ h: h, house: house[h], sun: sun[h], batt: batt, grid: rest - batt });
      day.house += house[h];
      day.sun += sun[h];
      day.batt += batt;
      day.grid += rest - batt;
    }
    if (day.house > 0) {
      day.self = Math.max(0, Math.min(100, ((day.sun + day.batt) / day.house) * 100));
    }
    return { rows: rows, day: day };
  }

  // Arco dell'autosufficienza + riga consumo casa + striscia con la scomposizione
  // (solare / batteria / rete) e legenda + 4 KPI.
  // Progettato per i sensori utility_meter *_today della Powerwall.
  _renderBalance() {
    const c = this.config;
    const ic = {
      down: '<path d="M12 3.5v17M6 13.5l6 6.5 6-6.5"/>',
      up: '<path d="M12 20.5v-17M6 10.5l6-6.5 6 6.5"/>',
      home: '<path d="M3.6 11.2 12 4l8.4 7.2M6 10v10h12V10"/>',
      sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/>',
      batt: '<rect x="3.5" y="7.5" width="14.5" height="9" rx="2"/><path d="M20.5 10.8v2.4"/>',
    };
    const svg = (p, color, s) =>
      '<svg class="epb-ic" viewBox="0 0 24 24" width="' + (s || 15) + '" height="' + (s || 15) + '" fill="none" stroke="' + color +
      '" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';

    const model = this._balanceModel();
    this._hourly = model ? model.rows : null;
    const day = model ? model.day : null;
    const house = day ? day.house : null;
    const battH = day ? day.batt : 0;
    const gridH = day ? day.grid : 0;
    const sunH = day ? day.sun : 0;
    const selfSuff = day ? day.self : null;
    // totale di oggi di un contatore, per i quattro riquadri in fondo
    const dayTot = (id) => {
      const hrs = this._balanceHours(id);
      return hrs ? hrs.reduce((s, v) => s + v, 0) : null;
    };
    const pctTxt = selfSuff === null ? '--' : Math.round(selfSuff);
    // semicerchio r=62 -> lunghezza pi*62
    const ARC = 194.8;
    const arcFill = selfSuff === null ? 0 : (ARC * selfSuff) / 100;
    const gauge =
      '<div class="epb-arc">' +
      '<svg viewBox="0 0 150 84" width="150" height="84" aria-hidden="true">' +
      '<path d="M13 75a62 62 0 0 1 124 0" fill="none" stroke="var(--epb-track)" stroke-width="11" stroke-linecap="round"/>' +
      '<path d="M13 75a62 62 0 0 1 124 0" fill="none" stroke="var(--epb-good)" stroke-width="11" stroke-linecap="round" stroke-dasharray="' +
      arcFill.toFixed(1) + ' ' + ARC + '"/>' +
      '</svg>' +
      '<div class="epb-arc-c"><div class="epb-arc-p">' + pctTxt + '<span class="epb-arc-pp">%</span></div>' +
      '<div class="epb-arc-l">autosufficienza</div></div>' +
      '</div>';

    const parts = [
      ['Solare', sunH, 'sun'],
      ['Batteria', battH, 'bat'],
      ['Rete', gridH, 'grid'],
    ];
    const tot = house !== null && house > 0 ? house : 0;
    let segs = '';
    let leg = '';
    parts.forEach((p) => {
      const share = tot ? (p[1] / tot) * 100 : 0;
      if (share >= 0.4) segs += '<div class="epb-seg epb-c-' + p[2] + '" style="flex:' + share.toFixed(3) + '"></div>';
      // legenda sempre presente: l'identita' non deve dipendere dal solo colore
      leg += '<span class="epb-lg"><i class="epb-dot epb-c-' + p[2] + '"></i>' + p[0] +
        '<b>' + (tot ? Math.round(share) : '--') + '%</b></span>';
    });
    if (!segs) segs = '<div class="epb-seg epb-seg-empty" style="flex:1"></div>';

    const kpi = (icon, color, label, entity) =>
      '<div class="epb-k" style="--k:' + color + '" data-entity="' + (entity || '') + '">' + svg(icon, color) +
      '<div><div class="epb-kl">' + label + '</div><div class="epb-kv">' +
      this._fmt(dayTot(entity), '', 1) + '<span class="epb-u"> kWh</span></div></div></div>';

    mgddPaint(this, this._styles(),
      '<div class="epb-wrap' + (this._isDark() ? ' epb-dark' : '') + '">' +
      '<div class="epb-hd"><span class="epb-t">' + (c.title || 'Bilancio energetico') + '</span>' +
      '<span class="epb-pill">' + (c.period_label || 'oggi') + '</span></div>' +
      gauge +
      '<div class="epb-sub" data-entity="' + (c.house || '') + '">' + svg(ic.home, 'var(--epb-tx2)') +
      '<span>Consumo casa</span><b>' + this._fmt(house, ' kWh', 1) + '</b></div>' +
      '<div class="epb-mx">' + segs + '</div>' +
      '<div class="epb-leg">' + leg + '</div>' +
      this._balanceHourly() +
      '<div class="epb-grid">' +
      kpi(ic.sun, 'var(--epb-sun)', 'Solare prodotto', c.solar) +
      kpi(ic.down, 'var(--epb-grid)', 'Prelevata rete', c.grid_import) +
      kpi(ic.up, 'var(--epb-grid)', 'Immessa in rete', c.grid_export) +
      kpi(ic.batt, 'var(--epb-bat)', 'Batteria scaricata', c.battery_discharge) +
      '</div>' +
      '</div>');
    this._wireClicks();
    this._wireBalanceTip();
  }

  // Profilo orario: barre impilate con la stessa scomposizione della striscia.
  // Le ore non ancora trascorse restano vuote (non a zero). Riusa colori e legenda
  // gia' presenti sopra, quindi non introduce ne' tinte ne' legende aggiuntive.
  _balanceHourly() {
    if (this.config.hourly === false) return '';
    const rows = this._hourly;
    if (!rows || !rows.length) return '';
    let max = 0;
    rows.forEach((r) => {
      if (r.house > max) max = r.house;
    });
    if (!(max > 0)) return '';
    let bars = '';
    for (let h = 0; h < 24; h++) {
      const r = rows[h];
      if (!r) {
        bars += '<div class="epb-hb epb-hb-void"></div>';
        continue;
      }
      let inner = '';
      [[r.grid, 'grid'], [r.batt, 'bat'], [r.sun, 'sun']].forEach((p) => {
        if (p[0] > max / 250) inner += '<i class="epb-c-' + p[1] + '" style="flex:' + p[0].toFixed(4) + '"></i>';
      });
      const hh = ((r.house / max) * 100).toFixed(1);
      // i valori restano sull'elemento: il tooltip li legge senza rigenerare l'HTML
      bars +=
        '<div class="epb-hb" data-h="' + r.h + '" data-tot="' + r.house.toFixed(3) + '"' +
        ' data-sun="' + r.sun.toFixed(3) + '" data-bat="' + r.batt.toFixed(3) + '" data-grid="' + r.grid.toFixed(3) + '">' +
        '<div class="epb-hb-in" style="height:' + hh + '%">' + inner + '</div></div>';
    }
    return (
      '<div class="epb-hr">' +
      '<div class="epb-hr-hd"><span>Profilo orario</span><b>max ' + max.toFixed(2) + ' kWh/h</b></div>' +
      '<div class="epb-hr-plot">' + bars + '<div class="epb-tip" hidden></div></div>' +
      '<div class="epb-hr-ax"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>' +
      '</div>'
    );
  }

  // Tooltip del profilo orario: ora, consumo e scomposizione per sorgente.
  // Sostituisce il title nativo, che mostrava solo il totale.
  _wireBalanceTip() {
    const plot = this.querySelector('.epb-hr-plot');
    const tip = this.querySelector('.epb-tip');
    if (!plot || !tip) return;
    const row = (label, cls, val, tot) =>
      '<div class="epb-tr"><i class="epb-dot epb-c-' + cls + '"></i><span>' + label + '</span>' +
      '<b>' + val.toFixed(2) + '</b><em>' + (tot ? Math.round((val / tot) * 100) : 0) + '%</em></div>';
    const show = (bar) => {
      const tot = parseFloat(bar.getAttribute('data-tot'));
      const sun = parseFloat(bar.getAttribute('data-sun'));
      const bat = parseFloat(bar.getAttribute('data-bat'));
      const grid = parseFloat(bar.getAttribute('data-grid'));
      const h = parseInt(bar.getAttribute('data-h'), 10);
      tip.innerHTML =
        '<div class="epb-tt">' + (h < 10 ? '0' : '') + h + ':00 – ' + (h < 9 ? '0' : '') + (h + 1) + ':00' +
        '<b>' + tot.toFixed(2) + ' kWh</b></div>' +
        row('Solare', 'sun', sun, tot) + row('Batteria', 'bat', bat, tot) + row('Rete', 'grid', grid, tot);
      tip.hidden = false;
      // ancorato alla barra, poi rientrato nei bordi del grafico
      const pw = plot.clientWidth;
      const tw = tip.offsetWidth;
      let left = bar.offsetLeft + bar.offsetWidth / 2 - tw / 2;
      if (left < 0) left = 0;
      if (left + tw > pw) left = pw - tw;
      tip.style.left = left + 'px';
    };
    plot.addEventListener('mousemove', (ev) => {
      const bar = ev.target.closest ? ev.target.closest('.epb-hb') : null;
      if (bar && bar.hasAttribute('data-tot')) show(bar);
      else tip.hidden = true;
    });
    plot.addEventListener('mouseleave', () => {
      tip.hidden = true;
    });
  }

  // true quando il tema Home Assistant attivo e' scuro (non dipende dall'OS).
  _isDark() {
    return !!(this._hass && this._hass.themes && this._hass.themes.darkMode);
  }

  _wireSwitches() {
    this.querySelectorAll('[data-switch]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const entityId = el.getAttribute('data-switch');
        if (entityId && this._hass) this._hass.callService('switch', 'toggle', { entity_id: entityId });
      });
    });
  }

  // Blocco "Carichi attivi adesso". Usato dal layout overview (salvo loads: false)
  // e disponibile come card a se' con layout: loads, cosi' e' spostabile in dashboard.
  _loadsHtml() {
    const power = this._pw(this.config.power_entity);
    const circuits = this.config.circuits || [];
    const threshold = this.config.active_threshold != null ? this.config.active_threshold : 1;
    const activeCount = this.config.active_count || 6;
    const active = circuits
      .map((c) => ({ name: c.name, val: this._num(c.entity), entity: c.entity }))
      .filter((c) => c.val !== null && c.val > threshold)
      .sort((a, b) => b.val - a.val)
      .slice(0, activeCount);

    const monitored = circuits.map((c) => this._num(c.entity)).filter((v) => v !== null);
    const monitoredSum = monitored.reduce((a, b) => a + b, 0);
    const other = power !== null && power - monitoredSum > 1 ? power - monitoredSum : null;
    const pctOf = (v) => (power ? Math.round((v / power) * 100) + '%' : '');
    // barra di composizione: segmenti proporzionali sul totale
    const compSegs = active
      .map((c) => {
        const color = this._paletteColor(circuits.findIndex((x) => x.entity === c.entity));
        const w = power ? (c.val / power) * 100 : 0;
        return '<div style="width:' + w.toFixed(1) + '%;background:' + color + '"></div>';
      })
      .join('');
    const compBar = active.length && power ? '<div class="comp">' + compSegs + '<div style="flex:1;background:var(--divider-color,rgba(0,0,0,.08))"></div></div>' : '';
    const list = active.map((c) => {
      const color = this._paletteColor(circuits.findIndex((x) => x.entity === c.entity));
      return (
        '<div class="load-row" data-entity="' + c.entity + '">' +
        '<span class="load-dot" style="background:' + color + '"></span>' +
        '<span class="load-name">' + c.name + '</span>' +
        '<span class="load-pct">' + pctOf(c.val) + '</span>' +
        '<span class="load-w">' + this._fmt(c.val, ' W', c.val < 10 ? 1 : 0) + '</span>' +
        '</div>'
      );
    });
    if (other !== null && active.length) {
      list.push(
        '<div class="load-row load-other">' +
          '<span class="load-dot" style="background:var(--divider-color,rgba(0,0,0,.08))"></span>' +
          '<span class="load-name">Altro (non monitorato)</span>' +
          '<span class="load-pct">' + pctOf(other) + '</span>' +
          '<span class="load-w">~' + other.toFixed(0) + ' W</span>' +
          '</div>'
      );
    }
    if (!list.length) return '';
    // Altezza fissa: la lista tiene sempre lo stesso numero di righe. Senza
    // questo, un carico che scende sotto soglia fa sparire una riga, la card si
    // accorcia e su iOS lo scroll della vista risale. I posti liberi restano
    // vuoti; il segnaposto contiene uno spazio nella stessa classe della
    // potenza, cosi' la riga misura esattamente come una reale.
    const slots = this.config.loads_rows != null ? this.config.loads_rows : activeCount + 1;
    list[list.length - 1] = list[list.length - 1].replace('class="load-row', 'class="load-row load-end');
    while (list.length < slots) list.push('<div class="load-row load-ph"><span class="load-w">&nbsp;</span></div>');
    const rows = list.join('');
    return (
      '<div class="loadlist">' +
      '<div class="load-top"><span class="hero-l">' + (this.config.loads_title || 'Carichi attivi adesso') +
      '</span><span class="hero-tag">' + this._fmt(power, ' W', 0) + '</span></div>' +
      compBar +
      rows +
      '</div>'
    );
  }

  _renderLoads() {
    mgddPaint(this, this._styles(), this._loadsHtml());
    this._wireClicks();
  }

  // Icone delle prese. Chiave `icon` del circuito: tv, wash, dry, iron, heat, plug.
  _plugIcon(kind) {
    const p = {
      tv: '<rect x="2.5" y="4.5" width="19" height="12.5" rx="2"/><path d="M8 20.5h8"/>',
      wash: '<rect x="4" y="2.8" width="16" height="18.4" rx="2.5"/><circle cx="12" cy="14" r="4.4"/><path d="M7.6 6.6h2"/>',
      dry: '<rect x="4" y="2.8" width="16" height="18.4" rx="2.5"/><circle cx="12" cy="14" r="4.4"/><path d="M12 9.8v8.4"/>',
      iron: '<path d="M3 16.5h13a5 5 0 0 0-5-5H6.5A3.5 3.5 0 0 0 3 15v1.5ZM16 16.5h5M8 8.2V7a2 2 0 0 1 2-2h6"/>',
      heat: '<path d="M9 3.5c1.8 2 .4 3.4 0 5.2-.4 1.9 1.2 3 1.2 3M14.5 3.5c1.8 2 .4 3.4 0 5.2-.4 1.9 1.2 3 1.2 3M4.5 14.5h15M6.5 18.5h11"/>',
      plug: '<path d="M9 3v6M15 3v6M6 9h12v2.5a6 6 0 0 1-12 0V9ZM12 17.5v3.5"/>',
    };
    return p[kind] || p.plug;
  }

  // layout plugs: pannello di comando in stile Mushroom (variante verticale).
  // Solo i circuiti con `switch`: griglia di riquadri con icona in alto, nome e
  // stato sotto. Nessun interruttore separato: l'icona colorata e' insieme
  // indicatore di stato e comando (tocco = commuta); il resto del riquadro
  // (nome e stato) apre il more-info.
  _plugsHtml(title) {
    const c = this.config;
    const items = (c.circuits || []).filter((x) => x.switch);
    const cols = c.plugs_columns || c.columns || 3;
    let onCount = 0;
    let tiles = '';
    items.forEach((x) => {
      const st = this._hass ? this._hass.states[x.switch] : null;
      const on = !!(st && st.state === 'on');
      if (on) onCount++;
      const w = this._pw(x.entity);
      // "In attesa" = presa alimentata ma senza assorbimento (elettrodomestico fermo)
      const det = w !== null && w > 0.5 ? this._fmt(w, ' W', w < 10 ? 1 : 0) : on ? 'In attesa' : 'Spenta';
      tiles +=
        '<div class="mv-t' + (on ? '' : ' off') + '" data-info="' + (x.entity || x.switch) +
        '" title="' + x.name + ' · dettagli">' +
        '<span class="mv-sh" data-plug="' + x.switch + '" title="' +
        (on ? 'Spegni' : 'Accendi') + ' ' + x.name + '">' +
        '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
        this._plugIcon(x.icon) + '</svg></span>' +
        '<span class="mv-n">' + x.name + '</span>' +
        '<span class="mv-s">' + det + '</span>' +
        '</div>';
    });
    if (!tiles) tiles = '<div class="pwempty">Nessun circuito con interruttore configurato.</div>';
    const accent = c.accent === 'teal' ? ' mv-teal' : '';
    return (
      '<div class="pwcard' + (this._isDark() ? ' pw-dark' : '') + accent + '">' +
      '<div class="load-top"><span class="hero-l">' + (title || c.title || 'Prese') + '</span>' +
      '<span class="hero-tag">' + onCount + ' accese · ' + (items.length - onCount) + ' spente</span></div>' +
      '<div class="mv-grid" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr));">' + tiles + '</div>' +
      '</div>'
    );
  }

  // l'icona commuta, il resto del riquadro apre il more-info
  _wirePlugs() {
    this.querySelectorAll('[data-plug]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = el.getAttribute('data-plug');
        if (id && this._hass) this._hass.callService('switch', 'toggle', { entity_id: id });
      });
    });
    this.querySelectorAll('[data-info]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._openMoreInfo(el.getAttribute('data-info'));
      });
    });
  }

  _renderPlugs() {
    mgddPaint(this, this._styles(), this._plugsHtml());
    this._wirePlugs();
  }

  _renderOverview() {
    const power = this._pw(this.config.power_entity);
    let day = this._num(this.config.energy_day_entity);
    let month = this._num(this.config.energy_month_entity);
    // senza entita' dedicate: parte compilata dalle statistiche + delta live del
    // contatore cumulativo. Lo stesso delta vale per entrambi, perche' l'ora non ancora
    // compilata cade sia dentro oggi sia dentro il mese.
    if (this._mtd && (!this.config.energy_day_entity || !this.config.energy_month_entity)) {
      const cum = this._num(this.config.total_energy_entity || this.config.energy_day_entity);
      const live = cum !== null && isFinite(this._mtd.upTo) && cum > this._mtd.upTo ? cum - this._mtd.upTo : 0;
      if (!this.config.energy_day_entity) day = this._mtd.day + live;
      if (!this.config.energy_month_entity) month = this._mtd.month + live;
    }

    const trendHtml = this._trendArea
      ? '<div class="hero-spark">' + this._trendArea + '</div>'
      : '<div class="loading">Caricamento\u2026</div>';

    // pillola di confronto: didascalia breve sotto, quella estesa nel tooltip
    const pillVs = (current, prev, cap, capFull, dec) => {
      if (current === null || prev === undefined || prev === null || prev <= 0) return '<div class="ov-d">\u2014</div>';
      const diff = current - prev;
      const up = diff > 0;
      const arrow = up ? '\u2191' : '\u2193';
      const cls = up ? 'pill-up' : 'pill-down';
      return (
        '<div class="ov-d" title="' + capFull + '"><span class="pill ' + cls + '">' + arrow + ' ' +
        Math.abs(diff).toFixed(dec) + ' kWh</span><span class="ov-cap">' + cap + '</span></div>'
      );
    };
    const monthNames = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const nowD = new Date();
    const prevMonthName = monthNames[(nowD.getMonth() + 11) % 12];
    const dayTrend = pillVs(day, this._yesterday, 'vs ieri', 'vs ieri, stessa ora', 1);
    const monthTrend = pillVs(month, this._lastMonth, 'vs ' + prevMonthName, 'vs ' + prevMonthName + ', stesso giorno', 0);
    // terza colonna: proiezione di fine mese, in grigio perche' e' una stima
    let projVal = null;
    if (month !== null) {
      const monthStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
      const monthEnd = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 1);
      const frac = (nowD - monthStart) / (monthEnd - monthStart);
      if (frac > 0.03) projVal = Math.round(month / frac);
    }
    const projCell =
      '<div class="ov-c"><div class="ov-l">Fine mese</div>' +
      '<div class="ov-v ov-est">' + (projVal === null ? '\u2014' : '~' + projVal + '<span class="ov-vu"> kWh</span>') + '</div>' +
      '<div class="ov-d"><span class="ov-cap">proiezione</span></div></div>';

    // i carichi restano nella card solo se non sono stati spostati su una card propria
    const activeHtml = this.config.loads === false ? '' : this._loadsHtml();

    mgddPaint(this, this._styles(),
      // card unica: potenza, curva 24h e le tre scale temporali
      '<div class="ovc">' +
      '<div class="ov-hd"><span class="ov-t">' + (this.config.title || 'Consumo casa') + '</span>' +
      '<span class="ov-p">' + (this.config.history_hours || 24) + 'h</span></div>' +
      '<div class="ov-hero">' + this._fmt(power, '', power !== null && power < 10 ? 1 : 0) +
      '<span class="ov-u">W</span></div>' +
      trendHtml +
      '<div class="ov-row">' +
      '<div class="ov-c"><div class="ov-l">Oggi</div><div class="ov-v">' +
      this._fmt(day, '', 1) + '<span class="ov-vu"> kWh</span></div>' + dayTrend + '</div>' +
      '<div class="ov-c"><div class="ov-l">Mese</div><div class="ov-v">' +
      this._fmt(month, '', 0) + '<span class="ov-vu"> kWh</span></div>' + monthTrend + '</div>' +
      projCell +
      '</div>' +
      '</div>' +
      activeHtml);
    this._wireClicks();
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    const event = new CustomEvent('hass-more-info', { detail: { entityId: entityId }, bubbles: true, composed: true });
    this.dispatchEvent(event);
  }

  _wireClicks() {
    this.querySelectorAll('[data-entity]').forEach((el) => {
      el.addEventListener('click', () => this._openMoreInfo(el.getAttribute('data-entity')));
    });
  }

  _iconBolt() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 4 14h6l-1 7 9-11h-6l1-7Z"/></svg>';
  }

  _iconDots() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>';
  }

  _renderCircuits() {
    const circuits = this.config.circuits || [];
    const bolt = this._iconBolt();
    const rows = circuits
      .map((c, i) => {
        const v = this._num(c.entity);
        const color = this._paletteColor(i);
        const spark = this._sparklines[c.entity] || '<svg viewBox="0 0 60 22" width="60" height="22"></svg>';
        const dim = '';
        const isLast = i === circuits.length - 1;
        return (
          '<div class="row" data-entity="' + c.entity + '"' + dim + (isLast ? '' : ' data-border') + '>' +
          '<div class="avatar" style="background:' + color + '22;color:' + color + '">' + bolt + '</div>' +
          '<div class="rowinfo"><div class="rowname">' + c.name + '</div></div>' +
          '<div class="rowspark">' + spark + '</div>' +
          '<div class="rowval">' + this._fmt(v, ' W', v !== null && v < 10 ? 1 : 0) + '</div>' +
          '</div>'
        );
      })
      .join('');
    mgddPaint(this, this._styles(), '<div class="wrap">' + rows + '</div>');
    this._wireClicks();
  }

  _styles() {
    return (
      '<style>' +
      "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');" +
      ':host{display:block;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
      '.hero{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:18px;padding:20px;margin-bottom:10px;}' +
      '.hero-top{display:flex;justify-content:space-between;align-items:baseline;}' +
      '.hero-l{font-size:13px;font-weight:600;color:var(--secondary-text-color,#6b6f76);}' +
      '.hero-tag{font-size:11px;color:var(--secondary-text-color,#6b6f76);}' +
      '.hero-v{font-size:40px;font-weight:600;letter-spacing:-1px;margin:4px 0 10px;color:var(--primary-text-color,#1c1c1e);}' +
      '.trend-bars{display:flex;align-items:flex-end;gap:3px;height:48px;}' +
      '.trend-range{display:flex;justify-content:space-between;font-size:12px;color:var(--secondary-text-color,#6b6f76);margin-top:6px;}' +
      '.hero-spark{margin-top:2px;}' +
      '.hero-spark svg{display:block;width:100%;height:56px;overflow:visible;}' +
      '.pairhero{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:18px;padding:16px;margin-bottom:14px;}' +
      '.pair{display:grid;grid-template-columns:1fr 1fr;gap:0;}' +
      '.stat-tile{text-align:center;padding:2px 12px;}' +
      '.stat-tile + .stat-tile{border-left:1px solid var(--divider-color,rgba(0,0,0,.08));}' +
      '.pairhalf{text-align:center;padding:0 8px;}' +
      '.pairhalf-b{border-left:1px solid var(--divider-color,rgba(0,0,0,.08));}' +
      '.section-label{font-size:12px;font-weight:600;color:var(--secondary-text-color,#6b6f76);margin:14px 0 8px;}' +
      '.stat-l{font-size:12px;font-weight:600;color:var(--secondary-text-color,#6b6f76);}' +
      '.stat-v{font-size:24px;font-weight:600;letter-spacing:-0.5px;margin-top:4px;color:var(--primary-text-color,#1c1c1e);}' +
      '.pair-trend{font-size:12px;margin-top:4px;color:var(--secondary-text-color,#6b6f76);}' +
      '.pill{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;border-radius:20px;padding:3px 9px;margin-top:7px;}' +
      '.pill-down{color:#1D9E75;background:#1D9E751f;}' +
      '.pill-up{color:#E24B4A;background:#E24B4A1f;}' +
      // layout overview (variante A): potenza, curva e tre scale temporali in una card,
      // staccata dalla lista dei carichi attivi da uno spacer piu' ampio
      // container-type: la card si adatta alla PROPRIA larghezza, non a quella del
      // viewport. Una media query qui sbagliava bersaglio: su desktop in colonna
      // stretta restava a 3 colonne larghe, su mobile spezzava anche quando ci stava.
      '.ovc{container-type:inline-size;background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:20px;padding:16px 16px 17px;}' +
      '.ovc + .loadlist{margin-top:22px;}' +
      '.ov-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}' +
      '.ov-t{font-size:11px;font-weight:700;letter-spacing:.85px;text-transform:uppercase;color:var(--secondary-text-color,#6b7280);}' +
      '.ov-p{font-size:10.5px;font-weight:600;color:var(--secondary-text-color,#6b7280);background:rgba(127,127,127,.10);padding:3px 9px;border-radius:20px;}' +
      '.ov-hero{font-size:46px;font-weight:670;letter-spacing:-2.4px;line-height:1;color:var(--primary-text-color,#10131a);font-variant-numeric:tabular-nums;display:flex;align-items:baseline;}' +
      '.ov-u{font-size:16px;font-weight:550;letter-spacing:0;color:var(--secondary-text-color,#6b7280);margin-left:5px;}' +
      '.ov-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--divider-color,rgba(0,0,0,.08));border-radius:14px;overflow:hidden;margin-top:12px;}' +
      // le tre celle sono incolonnate e centrate: la pillola di confronto sta SOTTO
      // il valore, non di fianco, cosi' "Fine mese" non ha bisogno di una riga sua
      '.ov-c{background:var(--ha-card-background,var(--card-background-color,#fff));padding:11px 6px 12px;text-align:center;}' +
      '.ov-l{font-size:10.5px;letter-spacing:.2px;color:var(--secondary-text-color,#6b7280);}' +
      '.ov-v{font-size:20px;font-weight:660;letter-spacing:-.6px;margin-top:3px;color:var(--primary-text-color,#10131a);font-variant-numeric:tabular-nums;}' +
      '.ov-vu{font-size:11px;font-weight:500;color:var(--secondary-text-color,#6b7280);letter-spacing:0;}' +
      '.ov-est,.ov-est .ov-vu{color:var(--secondary-text-color,#6b7280);}' +
      '.ov-d{display:block;min-height:20px;font-size:12px;color:var(--secondary-text-color,#6b7280);}' +
      '.ov-cap{display:block;font-size:9.5px;color:var(--secondary-text-color,#6b7280);margin-top:5px;}' +
      '.ovc .hero-spark{margin-top:4px;}' +
      '.ovc .hero-spark svg{height:66px;}' +
      // sotto i 400px di CARD si stringono i caratteri e le spaziature, ma le tre
      // colonne restano: e' l'informazione che serve, spezzarla peggiora la lettura
      '@container (max-width:400px){.ovc .ov-hero{font-size:38px;letter-spacing:-1.8px;}' +
      '.ovc .ov-c{padding:10px 5px 11px;}.ovc .ov-l{font-size:10px;}' +
      '.ovc .ov-v{font-size:19px;letter-spacing:-.5px;}.ovc .ov-vu{font-size:10.5px;}' +
      '.ovc .pill{font-size:10.5px;padding:2px 7px;margin-top:7px;}.ovc .ov-cap{font-size:9.5px;margin-top:5px;}}' +
      // solo quando davvero non ci stanno (card sotto i 290px) si passa a 2 + 1
      '@container (max-width:290px){.ovc .ov-row{grid-template-columns:1fr 1fr;}.ovc .ov-c:last-child{grid-column:span 2;}}' +
      '.pill-cap{font-size:10px;color:var(--secondary-text-color,#6b6f76);margin-top:5px;}' +
      '.proj{font-size:11px;color:var(--secondary-text-color,#6b6f76);margin-top:14px;padding-top:10px;border-top:1px solid var(--divider-color,rgba(0,0,0,.07));display:flex;justify-content:space-between;}' +
      '.proj b{color:var(--primary-text-color,#1c1c1e);font-weight:600;}' +
      '.loadlist{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:16px;padding:14px 16px 6px;}' +
      // card affiancate (loads/plugs): riempiono l'altezza della riga della griglia
      'energy-power-card.epc-fill{display:block;height:100%;}' +
      '.epc-fill .loadlist,.epc-fill .pwcard{height:100%;box-sizing:border-box;}' +
      '.load-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px;}' +
      '.comp{display:flex;height:6px;border-radius:3px;overflow:hidden;margin-bottom:5px;}' +
      '.load-row{display:flex;align-items:center;gap:10px;padding:8px 0;cursor:pointer;border-bottom:1px solid var(--divider-color,rgba(0,0,0,.07));}' +
      '.load-row:last-child{border-bottom:none;}' +
      '.load-other{opacity:.65;cursor:default;}' +
      // ultima riga reale e segnaposti: nessun divisore, nessun cursore
      '.load-end{border-bottom:none;}' +
      '.load-ph{border-bottom:none;cursor:default;pointer-events:none;}' +
      '.load-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;}' +
      '.load-name{flex:1;min-width:0;font-size:13px;color:var(--primary-text-color,#1c1c1e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.load-pct{font-size:11px;color:var(--secondary-text-color,#6b6f76);width:38px;text-align:right;flex:0 0 auto;}' +
      '.load-w{font-size:15px;font-weight:600;color:var(--primary-text-color,#1c1c1e);width:56px;text-align:right;flex:0 0 auto;}' +
      // layout plugs: pannello di comando in stile Mushroom (griglia verticale).
      // --mv-on / --mv-bg sono le tinte dello stato acceso: ambra (default, come
      // lo stato attivo degli switch in HA) o teal con accent: teal.
      '.pwcard{--mv-on:#B87503;--mv-bg:rgba(184,117,3,.16);container-type:inline-size;' +
      'background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:16px;padding:14px 14px 15px;}' +
      '.pwcard.mv-teal{--mv-on:#0E9384;--mv-bg:rgba(14,147,132,.16);}' +
      '.pwcard.pw-dark{--mv-on:#D79A2B;--mv-bg:rgba(215,154,43,.22);}' +
      '.pwcard.pw-dark.mv-teal{--mv-on:#12A08C;--mv-bg:rgba(18,160,140,.22);}' +
      '.pwempty{font-size:12px;color:var(--secondary-text-color,#6b6f76);padding:6px 0 10px;}' +
      '.mv-grid{display:grid;gap:8px;}' +
      // riquadro sulla superficie della card (niente riempimento grigio): a
      // delimitarlo basta il bordo, cosi' l'unica tinta e' quella dell'icona
      '.mv-t{background:var(--ha-card-background,var(--card-background-color,#fff));' +
      'border:1px solid var(--divider-color,rgba(0,0,0,.08));box-sizing:border-box;' +
      'border-radius:12px;padding:11px 8px 9px;display:flex;flex-direction:column;align-items:center;gap:7px;cursor:pointer;min-width:0;transition:background .12s;}' +
      // hover come il tile card di HA: velo del colore di stato all'8%, non un blocco grigio
      '.mv-t:hover{background:color-mix(in srgb,var(--mv-on) 6%,var(--ha-card-background,var(--card-background-color,#fff)));}' +
      '.mv-t.off:hover{background:rgba(127,127,127,.06);}' +
      // forma icona Mushroom: quadrato arrotondato 42px, tinta dello stato.
      // E' anche il comando: tocco = commuta, quindi ha un hover suo piu' marcato.
      '.mv-sh{width:42px;height:42px;border-radius:12px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:var(--mv-bg);color:var(--mv-on);flex:0 0 auto;cursor:pointer;transition:background .12s,color .12s,box-shadow .12s;}' +
      '.mv-sh:hover{box-shadow:0 0 0 2px color-mix(in srgb,var(--mv-on) 40%,transparent);}' +
      '.mv-t.off .mv-sh{background:transparent;border:1px solid var(--divider-color,rgba(0,0,0,.13));color:var(--secondary-text-color,#8b909a);}' +
      '.mv-t.off .mv-sh:hover{box-shadow:0 0 0 2px rgba(127,127,127,.28);}' +
      '.mv-n{font-size:12px;font-weight:500;color:var(--primary-text-color,#1c1c1e);text-align:center;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}' +
      '.mv-t.off .mv-n{color:var(--secondary-text-color,#6b6f76);}' +
      '.mv-s{font-size:10.5px;color:var(--secondary-text-color,#6b6f76);font-variant-numeric:tabular-nums;}' +
      '@container (max-width:300px){.mv-grid{grid-template-columns:repeat(2,minmax(0,1fr)) !important;}}' +
      '.wrap{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:18px;padding:6px 16px;}' +
      '.row{display:flex;align-items:center;gap:14px;padding:12px 0;cursor:pointer;}' +
      '.row[data-border]{border-bottom:1px solid var(--divider-color,rgba(0,0,0,.07));}' +
      '.avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}' +
      '.rowinfo{flex:1;min-width:0;}' +
      '.rowname{font-size:15px;color:var(--primary-text-color,#1c1c1e);}' +
      '.rowspark{flex:0 0 auto;}' +
      '.rowval{font-size:20px;font-weight:600;color:var(--primary-text-color,#1c1c1e);min-width:64px;text-align:right;}' +
      '.loading{font-size:12px;color:var(--secondary-text-color,#6b6f76);padding:10px 0;}' +
      // layout tiles: 2 per riga (1 su schermi molto stretti)
      '.epc-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}' +
      '@media (max-width:359px){.epc-tiles{grid-template-columns:1fr;}}' +
      '.epc-tile{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;cursor:pointer;transition:border-color .12s;}' +
      '.epc-tile:hover{border-color:var(--divider-color,rgba(0,0,0,.22));}' +
      '.epc-tile-head{display:flex;align-items:center;gap:8px;min-width:0;}' +
      '.epc-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;}' +
      '.epc-name{font-size:13px;color:var(--secondary-text-color,#6b6f76);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.epc-val{font-size:24px;font-weight:600;letter-spacing:-0.5px;color:var(--primary-text-color,#1c1c1e);line-height:1;}' +
      '.epc-u{font-size:13px;font-weight:500;color:var(--secondary-text-color,#6b6f76);}' +
      '.epc-sparkwrap{width:100%;}' +
      '.epc-spark{display:block;width:100%;height:36px;overflow:visible;}' +
      // layout controls (A3): 2 per riga, 1 su schermo stretto
      '.epcs-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}' +
      '@media (max-width:439px){.epcs-tiles{grid-template-columns:1fr;}}' +
      '.epcs-tile{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:16px;padding:11px 14px;cursor:pointer;transition:border-color .12s;overflow:hidden;}' +
      '.epcs-tile:hover{border-color:var(--divider-color,rgba(0,0,0,.22));}' +
      '.epcs-head{display:flex;align-items:center;gap:8px;min-width:0;min-height:28px;}' +
      '.epcs-name{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--secondary-text-color,#6b6f76);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.epcs-tag{font-size:11px;color:var(--secondary-text-color,#6b6f76);opacity:.8;flex:0 0 auto;}' +
      '.epcs-body{display:flex;align-items:flex-end;gap:12px;margin-top:8px;}' +
      '.epcs-val{font-size:26px;font-weight:600;letter-spacing:-0.5px;line-height:1;color:var(--primary-text-color,#1c1c1e);flex:0 0 auto;font-variant-numeric:tabular-nums;}' +
      '.epcs-u{font-size:13px;font-weight:500;color:var(--secondary-text-color,#6b6f76);}' +
      '.epcs-spark{flex:1;min-width:0;}' +
      '.epcs-spark .epc-spark{height:34px;}' +
      // interruttore S1
      // toggle D: pill con solo contorno (niente sfondo), verde da acceso
      '.epcs-sw{position:relative;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:26px;padding:0 11px;border-radius:20px;cursor:pointer;font-size:12px;font-weight:500;line-height:1;font-family:inherit;background:transparent;border:1px solid var(--divider-color,rgba(0,0,0,.18));color:var(--secondary-text-color,#9aa0aa);transition:color .15s,border-color .15s;}' +
      '.epcs-sw::before{content:"";position:absolute;inset:-9px;}' + // area di tocco estesa (~46px) per il dito
      '.epcs-sw:hover{border-color:var(--divider-color,rgba(0,0,0,.32));}' +
      '.epcs-sw.on{color:#1D9E75;border-color:#1D9E75;}' +
      '.epcs-dot{width:7px;height:7px;border-radius:50%;background:#b4b2a9;flex:0 0 auto;}' +
      '.epcs-sw.on .epcs-dot{background:#1D9E75;}' +
      '.epcs-tile.off .epcs-val{color:var(--secondary-text-color,#9aa0aa);}' +
      '.epcs-tile.off .epcs-spark{filter:grayscale(1);opacity:.5;}' +
      // layout F (headergraph): header colorato + grafico ad area grande
      '.ephg-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}' +
      '@media (max-width:439px){.ephg-tiles{grid-template-columns:1fr;}}' +
      '.ephg-tile{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:16px;overflow:hidden;cursor:pointer;transition:border-color .12s;}' +
      '.ephg-tile:hover{border-color:var(--divider-color,rgba(0,0,0,.22));}' +
      '.ephg-head{display:flex;align-items:center;gap:8px;padding:3px 11px;min-height:22px;}' +
      '.ephg-name{flex:1;min-width:0;font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.ephg-sw{position:relative;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-height:20px;padding:0 10px;border-radius:20px;cursor:pointer;font-size:11px;font-weight:500;line-height:1;font-family:inherit;color:#fff;background:rgba(255,255,255,.24);border:none;transition:background .15s;}' +
      '.ephg-sw::before{content:"";position:absolute;inset:-9px;}' + // area di tocco estesa per il dito
      '.ephg-sw:hover{background:rgba(255,255,255,.36);}' +
      '.ephg-body{padding:8px 12px 11px;}' +
      '.ephg-val{font-size:22px;font-weight:600;letter-spacing:-.5px;line-height:1;color:var(--primary-text-color,#1c1c1e);font-variant-numeric:tabular-nums;}' +
      '.ephg-u{font-size:12px;font-weight:500;color:var(--secondary-text-color,#6b6f76);}' +
      '.ephg-spark{height:30px;margin-top:3px;}' +
      '.ephg-spark .epc-spark{height:30px;}' +
      '.ephg-tile.off .ephg-val{color:var(--secondary-text-color,#9aa0aa);}' +
      '.ephg-tile.off .ephg-spark{filter:grayscale(1);opacity:.45;}' +
      // layout balance ("Arc"): arco autosufficienza + scomposizione + 4 KPI.
      // Tinte dati allineate a energy-flow-card: sole arancio, batteria verde,
      // rete azzurro. L'arco dell'autosufficienza usa il viola della casa, cosi'
      // non si confonde con nessuna delle tre sorgenti. Step distinti per chiaro
      // e scuro (non un'inversione automatica).
      '.epb-wrap{--epb-sun:#E08A00;--epb-bat:#0FB57E;--epb-grid:#0EA5E9;--epb-good:#6D5AE6;' +
      '--epb-tx:var(--primary-text-color,#10131a);--epb-tx2:var(--secondary-text-color,#6b7280);' +
      '--epb-bd:var(--divider-color,rgba(15,23,42,.09));--epb-fill:rgba(127,127,127,.09);' +
      '--epb-track:rgba(127,127,127,.18);' +
      'background:var(--ha-card-background,var(--card-background-color,#fff));' +
      'border:1px solid var(--epb-bd);border-radius:20px;padding:17px 17px 18px;color:var(--epb-tx);}' +
      '.epb-wrap.epb-dark{--epb-sun:#F5B301;--epb-bat:#22E39A;--epb-grid:#38BDF8;--epb-good:#8B7BFF;' +
      '--epb-fill:rgba(255,255,255,.055);--epb-track:rgba(255,255,255,.12);}' +
      '.epb-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}' +
      '.epb-t{font-size:11px;font-weight:700;letter-spacing:.85px;text-transform:uppercase;color:var(--epb-tx2);}' +
      '.epb-pill{font-size:10.5px;font-weight:600;letter-spacing:.4px;color:var(--epb-tx2);background:var(--epb-fill);padding:3px 9px;border-radius:20px;}' +
      '.epb-ic{flex:0 0 auto;display:block;}' +
      '.epb-arc{position:relative;display:flex;justify-content:center;}' +
      '.epb-arc svg{display:block;}' +
      '.epb-arc-c{position:absolute;left:0;right:0;bottom:2px;text-align:center;}' +
      '.epb-arc-p{font-size:34px;font-weight:670;letter-spacing:-1.6px;line-height:1;font-variant-numeric:tabular-nums;}' +
      '.epb-arc-pp{font-size:16px;font-weight:600;letter-spacing:-.3px;color:var(--epb-tx2);margin-left:1px;}' +
      '.epb-arc-l{font-size:9.5px;letter-spacing:.7px;text-transform:uppercase;color:var(--epb-tx2);margin-top:4px;}' +
      '.epb-sub{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--epb-tx2);margin:14px 0 9px;cursor:pointer;}' +
      '.epb-sub b{margin-left:auto;color:var(--epb-tx);font-weight:650;font-size:14.5px;font-variant-numeric:tabular-nums;}' +
      // 2px di superficie fra i segmenti: separa senza aggiungere un colore di bordo
      '.epb-mx{display:flex;height:9px;border-radius:5px;overflow:hidden;gap:2px;background:var(--epb-track);}' +
      '.epb-seg{height:100%;}' +
      '.epb-seg-empty{background:var(--epb-track);}' +
      '.epb-c-sun{background:var(--epb-sun);}' +
      '.epb-c-bat{background:var(--epb-bat);}' +
      '.epb-c-grid{background:var(--epb-grid);}' +
      '.epb-leg{display:flex;flex-wrap:wrap;gap:5px 14px;margin-top:9px;}' +
      '.epb-lg{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--epb-tx2);}' +
      '.epb-lg b{color:var(--epb-tx);font-weight:650;font-variant-numeric:tabular-nums;}' +
      '.epb-dot{width:9px;height:9px;border-radius:3px;flex:0 0 auto;}' +
      // profilo orario: barre impilate, stessa scomposizione della striscia
      '.epb-hr{margin-top:15px;padding-top:13px;border-top:1px solid var(--epb-bd);}' +
      '.epb-hr-hd{display:flex;justify-content:space-between;align-items:baseline;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--epb-tx2);margin-bottom:8px;}' +
      '.epb-hr-hd b{font-size:11px;letter-spacing:0;text-transform:none;font-weight:550;opacity:.85;font-variant-numeric:tabular-nums;}' +
      '.epb-hr-plot{position:relative;display:flex;align-items:flex-end;gap:2px;height:46px;}' +
      '.epb-hb{flex:1;height:100%;display:flex;align-items:flex-end;min-width:0;}' +
      '.epb-hb[data-tot]:hover .epb-hb-in{outline:1.5px solid var(--epb-tx2);outline-offset:1px;}' +
      // Tooltip: superficie della card, bordo e ombra. Stessa ricetta per tutti
      // (profilo orario, consumo giornaliero/mensile, grafico di zona): la pillola
      // invertita con sfondo --primary-text-color diventava illeggibile in tema
      // scuro, dove quel colore e' quasi bianco come il testo che ci stava sopra.
      // tooltip del profilo orario: ora, totale e scomposizione per sorgente
      '.epb-tip{position:absolute;bottom:calc(100% + 8px);z-index:5;pointer-events:none;' +
      'min-width:158px;padding:9px 11px 8px;border-radius:11px;' +
      'background:var(--ha-card-background,var(--card-background-color,#fff));' +
      'border:1px solid var(--epb-bd);box-shadow:0 6px 20px rgba(0,0,0,.13);}' +
      '.epb-tip[hidden]{display:none;}' +
      '.epb-tt{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:11px;' +
      'color:var(--epb-tx2);padding-bottom:6px;margin-bottom:5px;border-bottom:1px solid var(--epb-bd);}' +
      '.epb-tt b{font-size:12.5px;font-weight:650;color:var(--epb-tx);font-variant-numeric:tabular-nums;}' +
      '.epb-tr{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--epb-tx2);padding:1.5px 0;}' +
      '.epb-tr span{flex:1;}' +
      '.epb-tr b{font-weight:650;color:var(--epb-tx);font-variant-numeric:tabular-nums;}' +
      '.epb-tr em{font-style:normal;width:32px;text-align:right;opacity:.75;font-variant-numeric:tabular-nums;}' +
      '.epb-hb-in{width:100%;display:flex;flex-direction:column-reverse;border-radius:2px;overflow:hidden;background:var(--epb-track);}' +
      '.epb-hb-in i{display:block;width:100%;}' +
      '.epb-hb-void{opacity:0;}' +
      '.epb-hr-ax{display:flex;justify-content:space-between;font-size:9.5px;color:var(--epb-tx2);margin-top:5px;opacity:.8;font-variant-numeric:tabular-nums;}' +
      '.epb-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--epb-bd);border-radius:13px;overflow:hidden;margin-top:14px;}' +
      '.epb-k{display:flex;align-items:center;gap:9px;padding:11px 12px;cursor:pointer;' +
      'background:var(--ha-card-background,var(--card-background-color,#fff));transition:background .12s;}' +
      '.epb-k:hover{background:color-mix(in srgb,var(--k,#888) 8%,var(--ha-card-background,var(--card-background-color,#fff)));}' +
      '.epb-kl{font-size:11px;color:var(--epb-tx2);line-height:1.2;}' +
      '.epb-kv{font-size:16px;font-weight:650;letter-spacing:-.3px;margin-top:3px;font-variant-numeric:tabular-nums;}' +
      '.epb-u{font-size:11px;font-weight:500;color:var(--epb-tx2);}' +
      '@media (max-width:359px){.epb-grid{grid-template-columns:1fr;}}' +
      '</style>'
    );
  }
}

EnergyPowerCard.getStubConfig = function () {
  return {
    layout: 'overview',
    power_entity: 'sensor.power',
    energy_day_entity: 'sensor.energy_day',
    energy_month_entity: 'sensor.energy_month',
    total_energy_entity: 'sensor.energy_total',
    circuits: [],
  };
};

customElements.define('energy-power-card', EnergyPowerCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'energy-power-card',
  name: 'Energy Panoramica/Circuiti',
  description: 'Consumo istantaneo con trend, oggi/mese, carichi attivi, oppure lista circuiti con sparkline. Config manuale via YAML.',
});

// ===== energy-controls-card.js =====
class EnergyControlsCard extends HTMLElement {
  setConfig(config) {
    this.config = config;
    this._lastSig = null;
  }

  set hass(hass) {
    this._hass = hass;
    const c = this.config || {};
    const u = c.ups || {};
    const ids = (c.switches || []).map((s) => s.entity).concat(
      [u.battery_entity, u.load_entity, u.status_entity, u.time_left_entity, u.power_entity, u.energy_entity,
        u.voltage_entity, u.time_on_battery_entity, u.last_transfer_entity]
    ).filter(Boolean);
    const sig = mgddStatesSig(hass, ids);
    if (sig === this._lastSig) return;
    this._lastSig = sig;
    this._render();
  }

  getCardSize() {
    return 4;
  }

  _num(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isNaN(v) ? null : v;
  }

  _state(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    return s || null;
  }

  _fmt(v, unit, dec) {
    if (v === null || v === undefined) return '--';
    return v.toFixed(dec === undefined ? 0 : dec) + (unit || '');
  }

  _toggle(entityId) {
    if (!entityId || !this._hass) return;
    this._hass.callService('switch', 'toggle', { entity_id: entityId });
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    const event = new CustomEvent('hass-more-info', { detail: { entityId: entityId }, bubbles: true, composed: true });
    this.dispatchEvent(event);
  }

  _render() {
    if (this.config.layout === 'ups-status') this._renderUpsStatus();
    else if (this.config.layout === 'ups') this._renderUps();
    else this._renderSwitches();
  }

  _renderSwitches() {
    const items = this.config.switches || [];
    const rows = items
      .map((it) => {
        const s = this._state(it.entity);
        const on = s && s.state === 'on';
        const knobStyle = on
          ? 'background:#639922;'
          : 'background:var(--card-background-color,#fff);border:1px solid var(--divider-color,rgba(0,0,0,.15));';
        const dotStyle = on ? 'right:2px;background:#fff;' : 'left:2px;background:var(--secondary-text-color,#8a8d93);';
        return (
          '<div class="row" data-entity="' + it.entity + '">' +
          '<span class="row-name" style="' + (on ? '' : 'color:var(--secondary-text-color,#6b6f76)') + '">' + it.name + '</span>' +
          '<div class="toggle" data-toggle="' + it.entity + '" style="' + knobStyle + '"><div class="knob" style="' + dotStyle + '"></div></div>' +
          '</div>'
        );
      })
      .join('');
    mgddPaint(this, this._styles(), '<div class="grid2">' + rows + '</div>');
    this.querySelectorAll('.row').forEach((row) => {
      row.addEventListener('click', (e) => {
        const entity = row.getAttribute('data-entity');
        if (e.target.closest('.toggle')) this._toggle(entity);
        else this._openMoreInfo(entity);
      });
    });
  }

  // Traduce il motivo dell'ultimo trasferimento di apcupsd. Quelli non mappati
  // restano in inglese minuscolo: meglio una parola inglese di una inventata.
  _upsMotivo(raw) {
    if (!raw) return '';
    const m = {
      'high line voltage': 'alta tensione',
      'low line voltage': 'bassa tensione',
      'blackout': 'blackout',
      'line voltage notch or spike': 'picco di tensione',
      'automatic or manual self test': 'autotest',
      'input voltage out of range': 'tensione fuori range',
      'no transfers since turnon': '',
    };
    const k = String(raw).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : k;
  }

  // "da 45 s" sotto il minuto, poi "da 3 min": durante una commutazione i
  // secondi contano, dopo no.
  _upsDurata(sec) {
    if (sec === null || !(sec > 0)) return '';
    return sec < 60 ? 'da ' + Math.round(sec) + ' s' : 'da ' + Math.round(sec / 60) + ' min';
  }

  _renderUpsStatus() {
    const c = this.config.ups || {};
    const st = this._state(c.status_entity);
    const raw = st ? String(st.state) : '';
    const noto = !!st && raw !== 'unavailable' && raw !== 'unknown';
    // binary_sensor: acceso = alimentato dalla rete. Sensore testuale di apcupsd:
    // ONLINE (o OL) = rete, qualunque altro stato noto = batteria.
    const binario = /^binary_sensor\./.test(c.status_entity || '');
    const aRete = binario ? raw === 'on' : /^(online|ol)\b/i.test(raw.trim());
    const suBatteria = noto && !aRete;

    const batteria = this._num(c.battery_entity);
    const autonomia = this._num(c.time_left_entity);
    const potenza = this._num(c.power_entity);
    const tensione = this._num(c.voltage_entity);
    const daQuanto = this._upsDurata(this._num(c.time_on_battery_entity));
    const motivo = suBatteria ? this._upsMotivo(this._state(c.last_transfer_entity) && this._state(c.last_transfer_entity).state) : '';

    let testo;
    let coda;
    if (!noto) {
      testo = 'Stato non disponibile';
      coda = '';
    } else if (suBatteria) {
      testo = 'Su batteria';
      coda = [daQuanto, motivo].filter(Boolean).join(' · ');
    } else {
      testo = 'Alimentato dalla rete';
      coda = tensione !== null ? this._fmt(tensione, ' V', 0) : '';
    }

    // Il filo in basso segue il livello della batteria, non lo stato: durante uno
    // svuotamento si accorcia e vira, dando l'andamento che i numeri non danno.
    const soglia = c.low_battery === undefined ? 40 : c.low_battery;
    const critica = c.critical_battery === undefined ? 20 : c.critical_battery;
    const colore = batteria === null ? '#8a8d93' : batteria <= critica ? '#e5484d' : batteria <= soglia ? '#e08a00' : '#0fb57e';
    const larghezza = batteria === null ? 0 : Math.max(0, Math.min(100, batteria));

    const cella = (label, valore, unita, entity) =>
      '<div' + (entity ? ' data-entity="' + entity + '"' : '') + '>' +
      '<div class="ups-l">' + label + '</div>' +
      '<div class="ups-v">' + valore + (unita ? '<span class="ups-u">' + unita + '</span>' : '') + '</div></div>';

    const html =
      '<div class="ups-c">' +
      '<div class="ups-band' + (suBatteria ? ' b' : '') + '"' +
      (c.status_entity ? ' data-entity="' + c.status_entity + '"' : '') + '>' +
      '<i class="ups-dot"></i><span class="ups-txt">' + testo + '</span>' +
      '<span class="ups-when">' + coda + '</span></div>' +
      '<div class="ups-vals">' +
      cella('Batteria', batteria === null ? '--' : this._fmt(batteria, '', 0), '%', c.battery_entity) +
      cella('Autonomia', autonomia === null ? '--' : this._fmt(autonomia, '', 0), 'min', c.time_left_entity) +
      cella('Carico', potenza === null ? '--' : this._fmt(potenza, '', 0), 'W', c.power_entity) +
      '</div>' +
      '<div class="ups-edge"><i style="width:' + larghezza + '%;background:' + colore + '"></i></div>' +
      '</div>';

    mgddPaint(this, this._styles(), html);
    this.querySelectorAll('[data-entity]').forEach((el) => {
      el.addEventListener('click', () => this._openMoreInfo(el.getAttribute('data-entity')));
    });
  }

  _renderUps() {
    const c = this.config.ups || {};
    const battery = this._num(c.battery_entity);
    const load = this._num(c.load_entity);
    const status = this._state(c.status_entity);
    const timeLeft = this._num(c.time_left_entity);
    const power = this._num(c.power_entity);
    const energy = this._num(c.energy_entity);
    const stats = [
      { l: 'Batteria', v: this._fmt(battery, '%', 0), color: battery !== null && battery >= 90 ? '#639922' : undefined },
      { l: 'Carico', v: this._fmt(load, '%', 0) },
      { l: 'Stato', v: status ? (status.state === 'ONLINE' ? 'Online' : status.state) : '--', color: status && status.state === 'ONLINE' ? '#639922' : undefined },
      { l: 'Autonomia', v: timeLeft !== null ? Math.round(timeLeft) + ' min' : '--' },
      { l: 'Potenza', v: this._fmt(power, ' W', 0) },
      { l: 'Energia', v: this._fmt(energy, ' kWh', 1) },
    ];
    const html = stats
      .map((s) => '<div class="stat"><div class="stat-l">' + s.l + '</div><div class="stat-v"' + (s.color ? ' style="color:' + s.color + '"' : '') + '>' + s.v + '</div></div>')
      .join('');
    mgddPaint(this, this._styles(), '<div class="grid2">' + html + '</div>');
  }

  _styles() {
    return (
      '<style>' +
      "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');" +
      ':host{display:block;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
      '.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}' +
      '.row{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:16px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;}' +
      '.row-name{font-size:14px;font-weight:500;color:var(--primary-text-color,#1c1c1e);}' +
      '.toggle{width:38px;height:22px;border-radius:12px;position:relative;flex:0 0 auto;transition:background .15s;}' +
      '.knob{width:17px;height:17px;border-radius:50%;position:absolute;top:2px;transition:left .15s,right .15s;}' +
      '.stat{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:16px;padding:16px;}' +
      '.stat-l{font-size:12px;font-weight:600;color:var(--secondary-text-color,#6b6f76);}' +
      '.stat-v{font-size:22px;font-weight:600;letter-spacing:-0.5px;margin-top:4px;color:var(--primary-text-color,#1c1c1e);}' +
      // layout ups-status: fascia di stato, tre valori, filo della batteria a
      // bordo carta. A rete la fascia resta neutra: colorarla di verde tutti i
      // giorni la trasformerebbe in carta da parati e spegnerebbe il rosso.
      '.ups-c{background:var(--ha-card-background,var(--card-background-color,#fff));' +
      'border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:16px;overflow:hidden;' +
      'font-variant-numeric:tabular-nums;}' +
      '.ups-band{display:flex;align-items:center;gap:7px;padding:6px 13px;font-size:12.5px;font-weight:600;' +
      'background:rgba(127,127,127,.09);color:var(--secondary-text-color,#6b6f76);cursor:pointer;}' +
      // la coda si accorcia con l'ellissi invece di mandare a capo la banda: senza
      // min-width:0 un flex item non scende sotto il proprio min-content e la card
      // cambierebbe altezza proprio quando passa su batteria
      '.ups-band .ups-txt{white-space:nowrap;flex:0 0 auto;}' +
      '.ups-band .ups-when{margin-left:auto;padding-left:10px;font-weight:500;font-size:11.5px;opacity:.85;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto;text-align:right;}' +
      '.ups-band.b{background:#e5484d;color:#fff;font-weight:680;}' +
      '.ups-band.b .ups-when{opacity:.88;font-weight:600;}' +
      '.ups-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto;opacity:.7;}' +
      '.ups-vals{display:flex;align-items:center;padding:8px 13px 9px;}' +
      '.ups-vals>div{flex:1;min-width:0;cursor:pointer;}' +
      '.ups-vals>div+div{border-left:1px solid var(--divider-color,rgba(0,0,0,.08));padding-left:13px;}' +
      '.ups-l{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;' +
      'color:var(--secondary-text-color,#9096a0);}' +
      '.ups-v{font-size:17px;font-weight:650;letter-spacing:-.5px;line-height:1.2;' +
      'color:var(--primary-text-color,#1c1c1e);}' +
      '.ups-u{font-size:11px;font-weight:600;color:var(--secondary-text-color,#6b6f76);' +
      'margin-left:2px;letter-spacing:0;}' +
      '.ups-edge{height:3px;background:rgba(127,127,127,.18);}' +
      '.ups-edge>i{display:block;height:100%;}' +
      '</style>'
    );
  }
}

EnergyControlsCard.getStubConfig = function () {
  return {
    layout: 'switches',
    switches: [],
  };
};

customElements.define('energy-controls-card', EnergyControlsCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'energy-controls-card',
  name: 'Energy Interruttori/UPS',
  description: 'Griglia di interruttori accendi/spegni, oppure statistiche UPS. Config manuale via YAML.',
});

// ===== energy-history-card.js =====
class EnergyHistoryCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) throw new Error('Config "entity" mancante');
    this.config = config;
    this._daily = null;
    this._monthly = null;
    this._fetchedAt = 0;
    this._lastSig = null;
  }

  set hass(hass) {
    this._hass = hass;
    const sig = mgddStatesSig(hass, [this.config.entity]);
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._render();
    }
    this._maybeFetch();
  }

  getCardSize() {
    return 4;
  }

  async _maybeFetch() {
    const now = Date.now();
    if (this._fetchedAt && now - this._fetchedAt < 10 * 60 * 1000) return;
    this._fetchedAt = now;
    const daysToShow = this.config.days_to_show || 14;
    const monthsToShow = this.config.months_to_show || 7;
    const nowIso = new Date(now).toISOString();
    this._dailyError = null;
    this._monthlyError = null;
    try {
      const dailyStart = new Date(now - daysToShow * 24 * 3600 * 1000).toISOString();
      const dailyResp = await this._hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: dailyStart,
        end_time: nowIso,
        statistic_ids: [this.config.entity],
        period: 'day',
        types: ['change'],
      });
      this._daily = (dailyResp && dailyResp[this.config.entity]) || [];
    } catch (e) {
      // dati precedenti conservati: vedi energy-monthly-card
      if (!this._daily || !this._daily.length) {
        this._daily = [];
        this._dailyError = (e && e.message) || String(e);
      }
      console.error('energy-history-card: errore statistiche giornaliere', e);
    }
    try {
      const monthlyStart = new Date(now - monthsToShow * 31 * 24 * 3600 * 1000).toISOString();
      const monthlyResp = await this._hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: monthlyStart,
        end_time: nowIso,
        statistic_ids: [this.config.entity],
        period: 'month',
        types: ['change'],
      });
      this._monthly = (monthlyResp && monthlyResp[this.config.entity]) || [];
    } catch (e) {
      // dati precedenti conservati: vedi energy-monthly-card
      if (!this._monthly || !this._monthly.length) {
        this._monthly = [];
        this._monthlyError = (e && e.message) || String(e);
      }
      console.error('energy-history-card: errore statistiche mensili', e);
    }
    this._render();
  }

  _bars(data, labelFn, tipFn, ramp, errorMsg, opts) {
    if (errorMsg) return '<div class="loading">Errore: ' + errorMsg + '</div>';
    if (data === null) return '<div class="loading">Caricamento\u2026</div>';
    if (!data.length) return '<div class="loading">Nessun dato statistico disponibile per questo periodo</div>';
    const o = opts || {};
    const vals = data.map((d) => d.change || 0);
    const vmin = Math.min.apply(null, vals);
    const vmax = Math.max.apply(null, vals) || 1;
    const range = vmax - vmin || 1;
    // base fissa: altezza proporzionale al valore reale (scala da zero)
    const bars = data
      .map((d, i) => {
        const val = d.change || 0;
        const heightPct = (val / vmax) * 100;
        const idx = Math.round(((val - vmin) / range) * (ramp.length - 1));
        const tip = tipFn(d, i);
        const partial = o.isCurrent && o.isCurrent(d) ? ' bar-partial' : '';
        return (
          '<div class="bcol"><div class="bar' + partial + '" data-t="' + tip.t + '" data-v="' + tip.v + '" style="height:' + heightPct.toFixed(1) + '%;background:' + ramp[idx] + '"></div></div>'
        );
      })
      .join('');
    let avgLine = '';
    if (o.avg !== null && o.avg !== undefined && o.avg > 0 && o.avg <= vmax) {
      const topPct = (1 - o.avg / vmax) * 100;
      avgLine = '<div class="avgline" style="top:' + topPct.toFixed(1) + '%"><span>media ' + o.avgFmt + '</span></div>';
    }
    const labels = data.map((d, i) => '<span>' + (labelFn(d, i) || '') + '</span>').join('');
    return '<div class="bars">' + avgLine + bars + '</div><div class="xlabels">' + labels + '</div>';
  }

  _wireTooltips() {
    const containers = this.querySelectorAll('.bars');
    containers.forEach((container) => {
      let tip = container.querySelector('.bartip');
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'bartip';
        tip.style.cssText =
          'position:absolute;pointer-events:none;background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color,#1c1c1e);border:1px solid var(--divider-color,rgba(0,0,0,.1));box-shadow:0 6px 18px rgba(0,0,0,.18);border-radius:10px;padding:5px 9px;font-size:11px;font-weight:600;white-space:nowrap;opacity:0;transition:opacity .1s;z-index:2;transform:translate(-50%,-100%);top:-6px;';
        container.appendChild(tip);
      }
      const showTip = (bar) => {
        tip.textContent = bar.getAttribute('data-t') + ' \u00b7 ' + bar.getAttribute('data-v');
        tip.style.left = bar.offsetLeft + bar.offsetWidth / 2 + 'px';
        tip.style.opacity = '1';
      };
      const hideTip = () => {
        tip.style.opacity = '0';
      };
      container.addEventListener('mousemove', (e) => {
        const bar = e.target.closest('.bar');
        if (bar) showTip(bar);
        else hideTip();
      });
      container.addEventListener('mouseleave', hideTip);
      container.addEventListener('click', (e) => {
        const bar = e.target.closest('.bar');
        if (!bar) return;
        showTip(bar);
        clearTimeout(container._hideTimer);
        container._hideTimer = setTimeout(hideTip, 2500);
      });
    });
  }

  _render() {
    const dayLabels = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
    const monthLabels = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    const amberRamp = ['#FAEEDA', '#FAC775', '#EF9F27', '#BA7517'];
    const blueRamp = ['#E6F1FB', '#B5D4F4', '#85B7EB', '#378ADD'];
    const now = new Date();
    const isSameDay = (d) => {
      const dt = new Date(d.start);
      return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate();
    };
    const isSameMonth = (d) => {
      const dt = new Date(d.start);
      return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
    };
    const completedDaily = this._daily ? this._daily.filter((d) => !isSameDay(d)) : [];
    const completedMonthly = this._monthly ? this._monthly.filter((d) => !isSameMonth(d)) : [];
    const dailyAvg = completedDaily.length ? completedDaily.reduce((s, d) => s + (d.change || 0), 0) / completedDaily.length : null;
    const monthlyAvg = completedMonthly.length ? completedMonthly.reduce((s, d) => s + (d.change || 0), 0) / completedMonthly.length : null;
    const dailyHtml = this._bars(
      this._daily,
      (d, i) => {
        if (isSameDay(d)) return 'oggi';
        const showEvery = this.config.daily_label_every || 2;
        if (i % showEvery !== 0) return '';
        const dt = new Date(d.start);
        return dt.getDate() + ' ' + dt.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '');
      },
      (d) => {
        const dt = new Date(d.start);
        const label = dayLabels[dt.getDay()] + ' ' + dt.getDate() + ' ' + dt.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '');
        return { t: label, v: (d.change || 0).toFixed(1) + ' kWh' };
      },
      amberRamp,
      this._dailyError,
      { avg: dailyAvg, avgFmt: dailyAvg !== null ? dailyAvg.toFixed(1) : '', isCurrent: isSameDay }
    );
    const monthlyHtml = this._bars(
      this._monthly,
      (d) => {
        const dt = new Date(d.start);
        return monthLabels[dt.getMonth()];
      },
      (d) => {
        const dt = new Date(d.start);
        const label = monthLabels[dt.getMonth()] + ' ' + dt.getFullYear();
        return { t: label, v: (d.change || 0).toFixed(0) + ' kWh' };
      },
      blueRamp,
      this._monthlyError,
      { avg: monthlyAvg, avgFmt: monthlyAvg !== null ? monthlyAvg.toFixed(0) : '', isCurrent: isSameMonth }
    );

    mgddPaint(this, this._styles(),
      '<ha-card class="flat">' +
      '<div class="hcard">' +
      '<div class="card-top"><span class="card-label">Consumo giornaliero</span><span class="card-tag">' + (this.config.days_to_show || 14) + 'gg</span></div>' +
      '<div class="card-total">' + (dailyAvg !== null ? dailyAvg.toFixed(1) + ' kWh/g' : '--') + '</div>' +
      '<div class="card-sub">media, esclude oggi</div>' +
      dailyHtml +
      '</div>' +
      '<div class="hcard">' +
      '<div class="card-top"><span class="card-label">Consumo mensile</span><span class="card-tag">' + (this.config.months_to_show || 7) + ' mesi</span></div>' +
      '<div class="card-total">' + (monthlyAvg !== null ? monthlyAvg.toFixed(0) + ' kWh/mese' : '--') + '</div>' +
      '<div class="card-sub">media, esclude mese in corso</div>' +
      monthlyHtml +
      '</div>' +
      '</ha-card>');
    this._wireTooltips();
  }

  _styles() {
    return (
      '<style>' +
      "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');" +
      ':host{display:block;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:transparent!important;border:none!important;box-shadow:none!important;}' +
      '.flat{--ha-card-box-shadow:none;box-shadow:none;border:none;background:transparent;border-radius:0;padding:0;display:block;}' +
      // NB: niente selettore generico ".card" — collide con i wrapper .card dello shadow root della sezione (le card sono in light DOM)
      '.hcard{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:18px;padding:18px;margin-bottom:12px;}' +
      '.hcard:last-child{margin-bottom:0;}' +
      '.card-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;}' +
      '.card-label{font-size:13px;font-weight:600;color:var(--secondary-text-color,#6b6f76);}' +
      '.card-tag{font-size:11px;color:var(--secondary-text-color,#6b6f76);}' +
      '.card-total{font-size:26px;font-weight:600;letter-spacing:-0.5px;margin:4px 0 2px;color:var(--primary-text-color,#1c1c1e);}' +
      '.card-sub{font-size:11px;color:var(--secondary-text-color,#6b6f76);margin-bottom:12px;}' +
      '.bars{position:relative;display:flex;align-items:flex-end;gap:3px;height:90px;}' +
      '.bcol{flex:1;display:flex;align-items:flex-end;height:100%;}' +
      '.bar{width:100%;border-radius:3px 3px 0 0;min-height:3px;}' +
      '.bar-partial{opacity:.45;background-image:repeating-linear-gradient(-45deg,transparent 0 3px,rgba(255,255,255,.55) 3px 5px);}' +
      '.avgline{position:absolute;left:0;right:0;border-top:1px dashed var(--secondary-text-color,rgba(0,0,0,.3));opacity:.55;pointer-events:none;}' +
      '.avgline span{position:absolute;right:0;top:-14px;font-size:9px;color:var(--secondary-text-color,#6b6f76);}' +
      '.xlabels{display:flex;gap:3px;margin-top:6px;height:13px;}' +
      '.xlabels span{flex:1;font-size:10px;color:var(--secondary-text-color,#6b6f76);text-align:center;white-space:nowrap;}' +
      '.loading{font-size:12px;color:var(--secondary-text-color,#6b6f76);padding:24px 0;text-align:center;}' +
      '</style>'
    );
  }
}

EnergyHistoryCard.getStubConfig = function () {
  return {
    entity: 'sensor.energy_total',
  };
};

customElements.define('energy-history-card', EnergyHistoryCard);

// ===== energy-monthly-card.js =====
// Area chart del consumo mensile (kWh/mese) da statistiche a lungo termine.
// Card standalone: type: custom:energy-monthly-card
class EnergyMonthlyCard extends HTMLElement {
  setConfig(config) {
    const period = config && config.period === 'day' ? 'day' : 'month';
    const defaults =
      period === 'day'
        ? { entity: 'sensor.energy_totale_sonoff_casa', period: 'day', days: 14, title: 'Consumo giornaliero', color: '#EF9F27' }
        : { entity: 'sensor.energy_totale_sonoff_casa', period: 'month', months: 12, title: 'Consumo mensile', color: '#7C6CF0' };
    this.config = Object.assign(defaults, config || {});
    this._data = null;
    this._error = null;
    this._fetchedAt = 0;
    this._lastSig = null;
    // id gradiente univoco per istanza: in light DOM gli id sono globali,
    // due card con lo stesso id condividerebbero il colore del riempimento
    if (!this._uid) {
      EnergyMonthlyCard._seq = (EnergyMonthlyCard._seq || 0) + 1;
      this._uid = EnergyMonthlyCard._seq;
    }
  }

  set hass(hass) {
    this._hass = hass;
    const sig = mgddStatesSig(hass, [this.config.entity]);
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._render();
    }
    this._maybeFetch();
  }

  getCardSize() {
    return 4;
  }

  async _maybeFetch() {
    const now = Date.now();
    if (this._fetchedAt && now - this._fetchedAt < 10 * 60 * 1000) return;
    this._fetchedAt = now;
    const period = this.config.period === 'day' ? 'day' : 'month';
    let start;
    if (period === 'day') {
      const days = Math.max(2, this.config.days || 14);
      start = new Date(now - days * 24 * 3600 * 1000);
    } else {
      const months = Math.max(2, this.config.months || 12);
      start = new Date();
      start.setMonth(start.getMonth() - (months - 1));
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    }
    this._error = null;
    try {
      const resp = await this._hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: start.toISOString(),
        end_time: new Date(now).toISOString(),
        statistic_ids: [this.config.entity],
        period: period,
        // `state` serve a completare il periodo in corso: e' il valore del
        // contatore a fine ultima ora compilata (vedi _render)
        types: ['change', 'state'],
      });
      let arr = (resp && resp[this.config.entity]) || [];
      arr = arr.slice().sort((a, b) => new Date(a.start) - new Date(b.start));
      this._data = arr;
    } catch (e) {
      // si tengono i dati precedenti: azzerarli faceva collassare la card a una
      // riga di testo, e un salto di altezza in fondo alla vista sposta lo scroll
      if (!this._data || !this._data.length) {
        this._data = [];
        this._error = (e && e.message) || String(e);
      }
      console.error('energy-monthly-card: errore statistiche mensili', e);
    }
    this._render();
  }

  // Spline morbida (Catmull-Rom -> Bezier) su punti {x,y}
  _smoothPath(pts) {
    if (pts.length < 2) return '';
    const f = (n) => n.toFixed(2);
    let d = 'M' + f(pts[0].x) + ',' + f(pts[0].y);
    const t = 0.18;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) * t;
      const c1y = p1.y + (p2.y - p0.y) * t;
      const c2x = p2.x - (p3.x - p1.x) * t;
      const c2y = p2.y - (p3.y - p1.y) * t;
      d += 'C' + f(c1x) + ',' + f(c1y) + ' ' + f(c2x) + ',' + f(c2y) + ' ' + f(p2.x) + ',' + f(p2.y);
    }
    return d;
  }

  _render() {
    if (!this._hass) return;
    const monthLabels = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    const dayLabels = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
    const cfg = this.config;
    const isDay = cfg.period === 'day';
    const st = this._hass.states[cfg.entity];
    const uom = (st && st.attributes.unit_of_measurement) || 'kWh';
    const fmt = (v) => v.toFixed(v >= 100 ? 0 : 1);
    this._hover = null;
    let body = '';
    let bigVal = '--';
    let bigCap = '';

    if (this._error) {
      body = '<div class="emc-loading">Errore: ' + this._error + '</div>';
    } else if (this._data === null) {
      body = '<div class="emc-loading">Caricamento…</div>';
    } else if (!this._data.length) {
      body = '<div class="emc-loading">Nessun dato statistico disponibile</div>';
    } else {
      const now = new Date();
      const data = this._data;
      const n = data.length;
      const isCurrent = (d) => {
        const dt = new Date(d.start);
        if (isDay) return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate();
        return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
      };
      // etichetta completa (tooltip) per un dato
      const fullLabel = (d) => {
        const dt = new Date(d.start);
        if (isDay) return dayLabels[dt.getDay()] + ' ' + dt.getDate() + ' ' + monthLabels[dt.getMonth()];
        return monthLabels[dt.getMonth()] + ' ' + dt.getFullYear();
      };
      const curIdx = data.findIndex(isCurrent);
      // Il periodo in corso si fermerebbe all'ultima ora compilata dal recorder
      // (le statistiche a lungo termine sono orarie): lo completiamo col delta
      // fra il valore live del contatore e quello di fine ultima ora, che la
      // statistica riporta in `state`. Cosi' il periodo in corso coincide con
      // il contatore giornaliero invece di restare fino a un'ora indietro.
      let live = 0;
      if (curIdx >= 0 && cfg.live_current !== false && st) {
        const cum = parseFloat(st.state);
        const upTo = parseFloat(data[curIdx].state);
        if (isFinite(cum) && isFinite(upTo) && cum > upTo) live = cum - upTo;
      }
      const vals = data.map((d, i) => Math.max(0, (d.change || 0) + (i === curIdx ? live : 0)));
      const vmax = Math.max.apply(null, vals) || 1;
      const showIdx = curIdx >= 0 ? curIdx : n - 1;
      bigVal = fmt(vals[showIdx]) + ' ' + uom;
      bigCap = curIdx >= 0 ? (isDay ? 'oggi' : 'mese in corso') : fullLabel(data[showIdx]);

      if (n < 2) {
        body = '<div class="emc-loading">Servono almeno 2 ' + (isDay ? 'giorni' : 'mesi') + ' di storico</div>';
      } else {
        const W = 300,
          H = 120,
          padX = 3,
          padTop = 12;
        const xAt = (i) => padX + (i * (W - 2 * padX)) / (n - 1);
        const yAt = (v) => H - (v / vmax) * (H - padTop);
        const pts = vals.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
        // linea media (esclude il periodo in corso)
        let avgHtml = '';
        if (cfg.show_average !== false) {
          const compl = vals.filter((v, i) => i !== curIdx);
          const avg = compl.length ? compl.reduce((s, v) => s + v, 0) / compl.length : null;
          if (avg !== null && avg > 0) {
            const topPx = H - (avg / vmax) * (H - padTop);
            avgHtml =
              '<div class="emc-avg" style="top:' + topPx.toFixed(1) + 'px;border-top-color:' + cfg.color + '"></div>' +
              '<div class="emc-avglab" style="top:' + topPx.toFixed(1) + 'px;color:' + cfg.color + '">media ' + fmt(avg) + ' ' + uom + '</div>';
          }
        }
        const linePath = this._smoothPath(pts);
        const areaPath = linePath + ' L' + pts[n - 1].x.toFixed(2) + ',' + H + ' L' + pts[0].x.toFixed(2) + ',' + H + ' Z';
        const nowLine =
          curIdx >= 0
            ? '<line class="emc-now" x1="' + pts[curIdx].x.toFixed(2) + '" y1="0" x2="' + pts[curIdx].x.toFixed(2) + '" y2="' + H + '"/>'
            : '';
        const gid = 'emcgrad' + this._uid;
        const svg =
          '<svg class="emc-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
          '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + cfg.color + '" stop-opacity="0.35"/>' +
          '<stop offset="1" stop-color="' + cfg.color + '" stop-opacity="0"/>' +
          '</linearGradient></defs>' +
          '<path d="' + areaPath + '" fill="url(#' + gid + ')" stroke="none"/>' +
          nowLine +
          '<path class="emc-line" d="' + linePath + '" fill="none" stroke="' + cfg.color + '"/>' +
          '</svg>';
        // etichette asse X: mensile tutte; giornaliero diradate per non affollare
        const step = isDay ? (n > 10 ? Math.ceil(n / 7) : 1) : 1;
        const labels = data
          .map((d, i) => {
            const dt = new Date(d.start);
            let txt = '';
            if (i % step === 0) txt = isDay ? String(dt.getDate()) : monthLabels[dt.getMonth()];
            return '<span>' + txt + '</span>';
          })
          .join('');
        body =
          '<div class="emc-chart">' +
          svg +
          avgHtml +
          '<div class="emc-hline"></div><div class="emc-hdot"></div><div class="emc-tip"></div>' +
          '</div><div class="emc-xlabels">' + labels + '</div>';
        // dati per l'hover
        this._hover = { n: n, vals: vals, vmax: vmax, uom: uom, H: H, padTop: padTop, labels: data.map(fullLabel), color: cfg.color };
      }
    }

    mgddPaint(this, this._styles(),
      '<ha-card class="emc-flat">' +
      '<div class="emc-card">' +
      '<div class="emc-top">' +
      '<div class="emc-titles"><span class="emc-title">' + cfg.title + '</span>' + (bigCap ? '<span class="emc-sub">' + bigCap + '</span>' : '') + '</div>' +
      '<div class="emc-big">' + bigVal + '</div>' +
      '</div>' +
      body +
      '</div>' +
      '</ha-card>');
    this._wire();
  }

  _wire() {
    const h = this._hover;
    const chart = this.querySelector('.emc-chart');
    if (!h || !chart) return;
    const hline = chart.querySelector('.emc-hline');
    const hdot = chart.querySelector('.emc-hdot');
    const tip = chart.querySelector('.emc-tip');
    hdot.style.background = h.color;
    const fmt = (v) => v.toFixed(v >= 100 ? 0 : 1);
    const show = (idx, rectW) => {
      const leftPct = h.n === 1 ? 50 : (idx / (h.n - 1)) * 100;
      const dotY = h.H - (h.vals[idx] / h.vmax) * (h.H - h.padTop); // px (svg alto 120px)
      hline.style.left = leftPct + '%';
      hline.style.opacity = '1';
      hdot.style.left = leftPct + '%';
      hdot.style.top = dotY + 'px';
      hdot.style.opacity = '1';
      tip.textContent = h.labels[idx] + ' · ' + fmt(h.vals[idx]) + ' ' + h.uom;
      tip.style.left = leftPct + '%';
      tip.style.top = Math.max(0, dotY - 10) + 'px';
      tip.style.opacity = '1';
    };
    const hide = () => {
      hline.style.opacity = '0';
      hdot.style.opacity = '0';
      tip.style.opacity = '0';
    };
    const idxFromEvent = (e) => {
      const rect = chart.getBoundingClientRect();
      const rel = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      return Math.min(h.n - 1, Math.max(0, Math.round(rel * (h.n - 1))));
    };
    chart.addEventListener('mousemove', (e) => show(idxFromEvent(e)));
    chart.addEventListener('mouseleave', hide);
    chart.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length) show(idxFromEvent(e.touches[0]));
    }, { passive: true });
    chart.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length) show(idxFromEvent(e.touches[0]));
    }, { passive: true });
    // senza questo il riquadro restava appeso al grafico dopo lo scorrimento
    chart.addEventListener('touchend', hide, { passive: true });
    chart.addEventListener('touchcancel', hide, { passive: true });
  }

  _styles() {
    return (
      '<style>' +
      ':host{display:block;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:transparent!important;border:none!important;box-shadow:none!important;}' +
      '.emc-flat{--ha-card-box-shadow:none;box-shadow:none;border:none;background:transparent;border-radius:0;padding:0;display:block;}' +
      // niente selettore generico ".card": collide con i wrapper della sezione (light DOM)
      '.emc-card{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:18px;padding:18px;}' +
      '.emc-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;}' +
      '.emc-titles{display:flex;flex-direction:column;gap:2px;min-width:0;}' +
      '.emc-title{font-size:13px;font-weight:600;color:var(--secondary-text-color,#6b6f76);}' +
      '.emc-sub{font-size:11px;color:var(--secondary-text-color,#6b6f76);}' +
      '.emc-big{font-size:26px;font-weight:600;letter-spacing:-0.5px;color:var(--primary-text-color,#1c1c1e);white-space:nowrap;}' +
      '.emc-chart{width:100%;position:relative;}' +
      '.emc-svg{display:block;width:100%;height:120px;overflow:visible;}' +
      '.emc-line{stroke-width:2;vector-effect:non-scaling-stroke;stroke-linecap:round;stroke-linejoin:round;}' +
      '.emc-now{stroke:var(--secondary-text-color,#8a8d93);stroke-width:1;stroke-dasharray:3 3;opacity:.4;vector-effect:non-scaling-stroke;}' +
      '.emc-avg{position:absolute;left:0;right:0;height:0;border-top:1.5px dashed;opacity:.8;pointer-events:none;transform:translateY(-0.75px);}' +
      '.emc-avglab{position:absolute;left:4px;transform:translateY(-50%);font-size:10px;font-weight:600;background:var(--ha-card-background,var(--card-background-color,#fff));padding:0 5px;border-radius:8px;pointer-events:none;white-space:nowrap;}' +
      '.emc-hline{position:absolute;top:0;height:120px;width:1px;background:var(--secondary-text-color,#8a8d93);opacity:0;transform:translateX(-0.5px);pointer-events:none;transition:opacity .08s;}' +
      '.emc-hdot{position:absolute;width:8px;height:8px;border-radius:50%;border:2px solid var(--ha-card-background,#fff);opacity:0;transform:translate(-50%,-50%);pointer-events:none;transition:opacity .08s;}' +
      '.emc-tip{position:absolute;opacity:0;transform:translate(-50%,-100%);pointer-events:none;background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color,#1c1c1e);border:1px solid var(--divider-color,rgba(0,0,0,.1));box-shadow:0 6px 18px rgba(0,0,0,.18);border-radius:10px;padding:5px 9px;font-size:11px;font-weight:600;white-space:nowrap;transition:opacity .08s;z-index:2;}' +
      '.emc-xlabels{display:flex;margin-top:6px;}' +
      '.emc-xlabels span{flex:1;font-size:10px;color:var(--secondary-text-color,#6b6f76);text-align:center;white-space:nowrap;}' +
      '.emc-loading{font-size:12px;color:var(--secondary-text-color,#6b6f76);padding:32px 0;text-align:center;}' +
      '</style>'
    );
  }
}

EnergyMonthlyCard.getStubConfig = function () {
  return { entity: 'sensor.energy_totale_sonoff_casa', months: 12, title: 'Consumo mensile' };
};

customElements.define('energy-monthly-card', EnergyMonthlyCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'energy-history-card',
  name: 'Energy Storico',
  description: 'Consumo giornaliero e mensile da statistiche a lungo termine. Config manuale via YAML.',
});

// ===== energy-flow-card.js =====
// Flusso energia neon (Rete/Solare/Batteria/Casa) con linee dritte e luce che scorre.
// type: custom:energy-flow-card
class EnergyFlowCard extends HTMLElement {
  setConfig(config) {
    this.config = Object.assign({ title: 'Flusso energia', max_power: 3500, threshold: 5 }, config || {});
    this._built = false;
    this._flows = {};
    this._pulses = [];
    this._akeys = '';
    this._raf = null;
    this._W = 0;
    this._H = 0;
    this.BEAM = 0.44;
    this.SOFT = 15;
    this._mobile = undefined;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._compute();
    if (this.isConnected) this._start();
  }

  connectedCallback() { if (this._built) this._start(); }
  disconnectedCallback() { this._stop(); }
  getCardSize() { return 6; }

  _num(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isNaN(v) ? null : v;
  }
  // potenza normalizzata a W leggendo l'unita' dell'entita' (kW->W). Preserva il segno.
  _pw(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    if (Number.isNaN(v)) return null;
    const u = ((s.attributes && s.attributes.unit_of_measurement) || '').toLowerCase();
    if (u === 'kw') return v * 1000;
    if (u === 'mw') return v * 1e6;
    return v; // W o unita' non dichiarata: assume W
  }

  _routes() {
    if (this._mobile) {
      // mobile (radiale compatto): Solare in alto -> Casa dritto, e bracci verso Rete/Batteria; Rete/Batteria -> Casa in basso
      return {
        sole_casa: { p: [[0.5, 0.14], [0.5, 0.82]], c: 'sole' },
        sole_rete: { p: [[0.5, 0.14], [0.14, 0.14], [0.14, 0.46]], c: 'sole' },
        sole_batt: { p: [[0.5, 0.14], [0.86, 0.14], [0.86, 0.46]], c: 'sole' },
        rete_casa: { p: [[0.14, 0.46], [0.14, 0.82], [0.5, 0.82]], c: 'rete' },
        batt_casa: { p: [[0.86, 0.46], [0.86, 0.82], [0.5, 0.82]], c: 'batt' },
      };
    }
    return {
      rete_casa: { p: [[0.13, 0.66], [0.5, 0.66]], c: 'rete' },
      batt_casa: { p: [[0.87, 0.66], [0.5, 0.66]], c: 'batt' },
      sole_casa: { p: [[0.5, 0.2], [0.5, 0.66]], c: 'sole' },
      sole_batt: { p: [[0.5, 0.2], [0.87, 0.2], [0.87, 0.66]], c: 'sole' },
      sole_rete: { p: [[0.5, 0.2], [0.13, 0.2], [0.13, 0.66]], c: 'sole' },
      rete_batt: { p: [[0.13, 0.66], [0.13, 0.88], [0.87, 0.88], [0.87, 0.66]], c: 'rete' },
    };
  }
  // flowKey -> [routeKey, reverse, colorKey]
  _flowDef(key) {
    const F = {
      rete_casa: ['rete_casa', false, 'rete'],
      casa_rete: ['rete_casa', true, 'rete'],
      batt_casa: ['batt_casa', false, 'batt'],
      casa_batt: ['batt_casa', true, 'batt'],
      sole_casa: ['sole_casa', false, 'sole'],
      sole_batt: ['sole_batt', false, 'sole'],
      sole_rete: ['sole_rete', false, 'sole'],
      rete_batt: ['rete_batt', false, 'rete'],
    };
    return F[key];
  }
  _routeOn(rk) {
    const c = this.config;
    if (c.predispose) return true; // disegna tutte le linee anche senza entità (predisposizione)
    if (rk === 'rete_casa') return !!c.grid_power;
    if (rk === 'sole_casa' || rk === 'sole_batt' || rk === 'sole_rete') return !!c.solar_power;
    if (rk === 'batt_casa') return !!c.battery_power;
    if (rk === 'rete_batt') return !!(this._flows && this._flows.rete_batt); // solo con carica reale da rete
    return false;
  }

  _icon(k) {
    const I = {
      sole: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
      rete: '<path d="M6 22 12 2l6 20"/><path d="M9 22 12 2l3 20"/><path d="M6.8 8h10.4M7.7 13h8.6M8.6 18h6.8"/>',
      // in carica le due tacche lasciano il posto al livello che sale (classe ef-chg)
      batt: '<rect x="3" y="8" width="15" height="8" rx="2"/><path d="M21 11v2"/>' +
        '<path class="ef-bars" d="M6.5 10.5v3M10 10.5v3"/>' +
        '<rect class="ef-fill" x="5" y="10.2" width="10.5" height="3.6" rx="1"/>',
      casa: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>',
    };
    return '<svg viewBox="0 0 24 24">' + I[k] + '</svg>';
  }
  _node(id, name) {
    // posizioni gestite via CSS (classi desktop/mobile), qui solo il colore
    return (
      '<div class="ef-nd" data-n="' + id + '" style="--c:var(--ef-' + id + ')">' +
      '<span class="ef-ic" data-ic="' + id + '">' + this._icon(id) +
      // il SOC sta in una pastiglia appoggiata all'icona: fuori dal flusso, quindi non
      // aggiunge una terza riga e non alza il nodo rispetto agli altri tre
      (id === 'batt' ? '<span class="ef-soc" data-soc="batt"></span>' : '') + '</span>' +
      '<span class="ef-lab"><span class="ef-k" data-k="' + id + '">' + name + '</span>' +
      '<span class="ef-v">' +
      // freccia del verso, valorizzata solo su mobile dove l'etichetta non ha spazio
      (id === 'batt' ? '<span class="ef-ar" data-ar="batt"></span>' : '') +
      '<span data-v="' + id + '">—</span> <small data-u="' + id + '"></small></span>' +
      // riga secondaria: compare solo se valorizzata (potenza senza freccia propria)
      '<span class="ef-x" data-x="' + id + '"></span></span>' +
      // bordo per arrival: edge. viewBox e rect vengono dimensionati in px da _measure():
      // con preserveAspectRatio non uniforme gli angoli arrotondati diventerebbero ellittici
      '<svg class="ef-edge"><rect pathLength="100"/></svg></div>'
    );
  }

  _build() {
    mgddPaint(this, this._styles(),
      '<div class="ef-card">' +
      '<div class="ef-stage"><canvas></canvas>' +
      '<span class="ef-live"><i></i>ora</span>' +
      this._node('sole', 'Solare') +
      this._node('rete', 'Rete') +
      this._node('batt', 'Batteria') +
      this._node('casa', 'Casa') +
      '</div></div>');
    this._card = this.querySelector('.ef-card');
    this._live = this.querySelector('.ef-live');
    this._stage = this.querySelector('.ef-stage');
    this._cv = this.querySelector('canvas');
    this._ctx = this._cv.getContext('2d');
    // riferimenti stabili: _build gira una volta sola, i nodi non vengono ricreati
    this._nds = {};
    ['sole', 'rete', 'batt', 'casa'].forEach((id) => { this._nds[id] = this.querySelector('.ef-nd[data-n=' + id + ']'); });
    this._battIc = this.querySelector('[data-ic=batt]');
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this._stage);
    this._resize();
    this._built = true;
  }

  _resize() {
    if (!this._stage) return;
    // decide layout in base alla larghezza della card (mobile < 480px), poi rileggi (l'aspect cambia)
    const w0 = this._stage.getBoundingClientRect().width;
    const mobile = w0 > 0 && w0 < 480;
    // Il cambio di ramo va ricalcolato, non solo ri-stilato: etichetta della batteria,
    // freccia del verso e ramo Rete->Batteria dipendono tutti da _mobile, e senza questo
    // resterebbero quelli dell'altro ramo fino al successivo cambio di stato — cioe' al
    // primo render, dove _mobile e' ancora indefinito quando gira _compute().
    const cambioRamo = mobile !== this._mobile;
    if (cambioRamo) { this._mobile = mobile; if (this._card) this._card.classList.toggle('ef-mobile', mobile); }
    // senza il ramo Rete->Batteria la fascia sotto i nodi resta vuota: stage piu' basso
    // e nodi riavvicinati, cosi' lo spazio sopra e sotto torna simmetrico
    const compact = !mobile && this.config.grid_to_battery === false;
    if (compact !== this._compact) { this._compact = compact; if (this._card) this._card.classList.toggle('ef-compact', compact); }
    const r = this._stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this._W = r.width;
    this._H = r.height;
    this._cv.width = this._W * dpr;
    this._cv.height = this._H * dpr;
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._measure();
    if (cambioRamo && this._hass) this._compute(); // _compute rimisura da se', non ricorre qui
  }

  // rileva tema (testo chiaro => tema scuro) e misura i box dei nodi
  _measure() {
    if (!this._stage) return;
    let dark = false;
    const cs = this._live ? getComputedStyle(this._live).color : '';
    const mm = cs && cs.match(/[\d.]+/g);
    if (mm && mm.length >= 3) { const l = (0.299 * +mm[0] + 0.587 * +mm[1] + 0.114 * +mm[2]) / 255; dark = l > 0.6; }
    this._dark = dark;
    const P = this._palette();
    if (this._card) { this._card.style.setProperty('--ef-rete', P.rete); this._card.style.setProperty('--ef-sole', P.sole); this._card.style.setProperty('--ef-batt', P.batt); this._card.style.setProperty('--ef-casa', P.casa); }
    const sr = this._stage.getBoundingClientRect();
    const R = {};
    ['sole', 'rete', 'batt', 'casa'].forEach((id) => {
      const el = this.querySelector('.ef-nd[data-n=' + id + ']');
      if (!el) return;
      const r = el.getBoundingClientRect();
      R[id] = { cx: r.left - sr.left + r.width / 2, cy: r.top - sr.top + r.height / 2, hw: r.width / 2, hh: r.height / 2 };
      // bordo di arrival: edge, in unita' px cosi' rx resta uguale sui due assi
      const sv = el.querySelector('.ef-edge'), rc = sv && sv.querySelector('rect');
      if (rc && r.width) {
        const w = r.width + 2, h = r.height + 2;
        // width/height espliciti: senza questi il box dell'svg (elemento rimpiazzato con
        // aspect ratio intrinseco) non coincide col viewBox e ogni motore lo risolve a
        // modo suo, scalando tracciato e rx. Su WebKit il bordo finiva fuori dalla card.
        sv.setAttribute('width', w); sv.setAttribute('height', h);
        sv.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        rc.setAttribute('x', 1.2); rc.setAttribute('y', 1.2);
        rc.setAttribute('width', w - 2.4); rc.setAttribute('height', h - 2.4);
        // raggio letto dal nodo invece che duplicato qui: se il tema cambia il
        // border-radius il tracciato lo segue
        rc.setAttribute('rx', parseFloat(getComputedStyle(el).borderTopLeftRadius) || (this._mobile ? 13 : 16));
      }
    });
    this._nrects = R;
  }

  _palette() {
    return this._dark
      ? { rete: '#38BDF8', sole: '#F5B301', batt: '#22E39A', casa: '#8B7BFF' }
      : { rete: '#0EA5E9', sole: '#E08A00', batt: '#0FB57E', casa: '#6D5AE6' };
  }

  _setNode(id, val, unit) {
    const v = this.querySelector('[data-v=' + id + ']');
    const u = this.querySelector('[data-u=' + id + ']');
    if (!v) return;
    if (val === null || val === undefined) { v.textContent = '—'; u.textContent = ''; return; }
    if (unit) { v.textContent = String(Math.round(val)); u.textContent = unit; return; } // unità fissa (es. batteria in %)
    const a = Math.abs(val);
    if (a >= 1000) { v.textContent = (val / 1000).toFixed(1); u.textContent = 'kW'; }
    else { v.textContent = String(Math.round(val)); u.textContent = 'W'; }
  }

  _pcount(power) {
    const r = power / (this.config.max_power || 3500);
    return r > 0.5 ? 3 : r > 0.2 ? 2 : 1;
  }

  _compute() {
    const c = this.config;
    const g = this._pw(c.grid_power), s = this._pw(c.solar_power), b = this._pw(c.battery_power), soc = this._num(c.battery_soc), h = this._pw(c.house_power);
    const P0 = !!c.predispose; // se predisposto, mostra 0 dove l'entità manca invece di "—"
    // soc_scale: mostra il SOC "app Tesla" nascondendo la riserva ~5% -> (soc-5)/0.95, clamp 0-100
    const socDisp = (soc !== null && c.soc_scale) ? Math.max(0, Math.min(100, (soc - 5) / 0.95)) : soc;
    this._setNode('sole', s === null && P0 ? 0 : s);
    this._setNode('rete', g === null ? (P0 ? 0 : null) : Math.abs(g));
    // La batteria mostra la POTENZA come gli altri tre nodi, non la percentuale: era
    // l'unico nodo con una grandezza diversa, e il residuo "non disegnato" che stava su
    // una terza riga si azzerava proprio in scarica, quando la freccia lo assorbiva.
    // Il verso lo dice la riga piccola (carica/scarica), il SOC la pastiglia sull'icona.
    this._setNode('batt', b === null ? (P0 ? 0 : null) : Math.abs(b));
    const bs = this.querySelector('[data-soc=batt]');
    if (bs) {
      bs.textContent = socDisp === null ? '' : Math.round(socDisp) + '%';
      // soc_low/soc_critical non hanno default: con questo impianto (nessun backup) la
      // batteria scende a 0% legittimamente e un colore d'allarme sarebbe un falso positivo
      const low = c.soc_low;
      const crit = c.soc_critical;
      let bg = '';
      if (socDisp !== null) {
        if (crit !== undefined && socDisp <= crit) bg = '#e5484d';
        else if (low !== undefined && socDisp <= low) bg = '#e08a00';
      }
      bs.style.background = bg;
    }
    // il nodo Casa viene impostato dopo i flussi, insieme alla riga della potenza
    // batteria non rappresentata da alcuna freccia (vedi sotto)
    const bk = this.querySelector('[data-k=batt]');
    // verso: 1 scarica, -1 carica, 0 ferma o sconosciuto. Soglia ±5 W e non
    // battery_min_flow, cosi' il verso si conosce anche quando non c'e' nessun ramo.
    const verso = b === null ? 0 : b > 5 ? 1 : b < -5 ? -1 : 0;
    // Su mobile il nodo e' largo ~56 px: "Batteria · scarica" andrebbe a capo su tre righe
    // e alzerebbe il solo nodo batteria. Li' l'etichetta resta una parola e il verso passa
    // sul valore come freccia, che funziona anche sotto battery_min_flow, dove non c'e' ne'
    // il ramo verso Casa ne' l'icona animata.
    if (bk) bk.textContent = 'Batteria' + (this._mobile || !verso ? '' : verso > 0 ? ' · scarica' : ' · carica');
    const bar = this.querySelector('[data-ar=batt]');
    if (bar) bar.textContent = this._mobile && verso ? (verso > 0 ? '↑' : '↓') : '';
    const rk = this.querySelector('[data-k=rete]');
    if (rk) rk.textContent = g !== null && g < -5 ? 'Rete · immissione' : 'Rete';
    const TH = c.threshold || 5;
    // soglia dedicata ai soli flussi batteria: nasconde il consumo parassita/standby della PW (~40-150W)
    // senza toccare gli altri rami (rete/solare/casa restano su TH)
    const TB = c.battery_min_flow || 120;
    // icona in carica: stessa soglia che genera i flussi verso la batteria, cosi' il livello
    // non si anima per il solo assorbimento parassita della Powerwall
    if (this._battIc) this._battIc.classList.toggle('ef-chg', b !== null && b < -TB);
    const flows = {};
    // batteria: in scarica -> Casa; in carica -> ripartita tra surplus solare e prelievo da rete
    let reteBatt = 0;
    let reteBattVisibile = false;
    if (b !== null && b < -TB) {
      const chg = -b;
      const surplus = (s !== null) ? Math.max(0, s - (h !== null ? h : 0)) : 0; // solare oltre il consumo casa
      const soleBatt = Math.min(chg, surplus);
      reteBatt = chg - soleBatt; // resto della carica: dalla rete
      if (soleBatt > TB) flows.sole_batt = soleBatt;
      // su mobile la linea Rete->Batteria attraverserebbe le altre: la ometto (caso raro).
      // grid_to_battery: false la toglie anche da desktop.
      if (reteBatt > TB && !this._mobile && c.grid_to_battery !== false) {
        flows.rete_batt = reteBatt;
        reteBattVisibile = true;
      }
    } else if (b !== null && b > TB) {
      flows.batt_casa = b;
    }
    if (g !== null) {
      // Scorporo della quota che carica la batteria SOLO se quel ramo e' davvero
      // disegnato, altrimenti sarebbe potenza prelevata e non rappresentata da nessuna
      // linea: Rete->Casa mostrerebbe meno di quanto la rete sta erogando.
      if (g > TH) { const rc = reteBattVisibile ? g - reteBatt : g; if (rc > TH) flows.rete_casa = rc; }
      else if (g < -TH) flows.casa_rete = -g;
    }
    if (s !== null && s > TH) flows.sole_casa = s;
    // Casa resta il valore puro del sensore: sommarci il Powerwall la faceva divergere
    // dalla card "Consumo casa" e dalla card dei carichi, che leggono lo stesso sensore.
    this._setNode('casa', h === null && P0 ? 0 : h);
    // Il residuo "potenza della batteria che nessuna freccia rappresenta" non viene piu'
    // scritto: serviva a spiegare perche' Rete includesse watt senza linea, e ora che il
    // nodo mostra la potenza vera della batteria quella riconciliazione si legge da se'.
    // La riga .ef-x resta disponibile per altri nodi, oggi nessuno la usa.
    this._flows = flows;
    const keys = Object.keys(flows).sort().join(',');
    if (keys !== this._akeys) {
      this._akeys = keys;
      this._pulses = [];
      Object.keys(flows).forEach((k) => { this._pulses.push({ key: k, head: 0 }); });
    }
    this._measure();
  }

  _polyPx(rk) { return this._routes()[rk].p.map((p) => [p[0] * this._W, p[1] * this._H]); }
  // polilinea del percorso con estremi portati al CENTRO dei nodi: la scia entra sotto il box
  // (il nodo e' opaco e sta sopra il canvas, quindi la testa "sparisce dentro" l'entita')
  _trimmedPoly(rk) {
    const poly = this._polyPx(rk).map((p) => p.slice());
    const R = this._nrects || {};
    const ends = { rete_casa: ['rete', 'casa'], batt_casa: ['batt', 'casa'], sole_casa: ['sole', 'casa'], sole_batt: ['sole', 'batt'], sole_rete: ['sole', 'rete'], rete_batt: ['rete', 'batt'] }[rk];
    if (ends && R[ends[0]] && poly.length > 1) poly[0] = [R[ends[0]].cx, R[ends[0]].cy];
    if (ends && R[ends[1]] && poly.length > 1) poly[poly.length - 1] = [R[ends[1]].cx, R[ends[1]].cy];
    // percorsi a squadra: anche il gomito viene dai nodi misurati, non dalle frazioni.
    // Il verso lo dice la definizione stessa del percorso: se il primo tratto e'
    // orizzontale il gomito sta sopra/sotto la destinazione, altrimenti sopra la
    // partenza. Cosi' la geometria segue il layout senza tabelle duplicate nel CSS.
    if (poly.length === 3 && ends && R[ends[0]] && R[ends[1]]) {
      const p = this._routes()[rk].p;
      const orizzPrima = Math.abs(p[1][1] - p[0][1]) < Math.abs(p[1][0] - p[0][0]);
      poly[1] = orizzPrima
        ? [R[ends[1]].cx, R[ends[0]].cy]
        : [R[ends[0]].cx, R[ends[1]].cy];
    }
    return this._round(poly, 16);
  }
  // arrotonda gli angoli inserendo un arco (bezier quadratica) su ogni vertice interno
  _round(poly, r) {
    if (poly.length < 3) return poly;
    const out = [poly[0]];
    for (let i = 1; i < poly.length - 1; i++) {
      const a = poly[i - 1], v = poly[i], c = poly[i + 1];
      const d1 = Math.hypot(v[0] - a[0], v[1] - a[1]), d2 = Math.hypot(c[0] - v[0], c[1] - v[1]);
      const rr = Math.min(r, d1 / 2, d2 / 2);
      const p1 = [v[0] - (v[0] - a[0]) / d1 * rr, v[1] - (v[1] - a[1]) / d1 * rr];
      const p2 = [v[0] + (c[0] - v[0]) / d2 * rr, v[1] + (c[1] - v[1]) / d2 * rr];
      out.push(p1);
      const st = 8;
      for (let s = 1; s < st; s++) { const t = s / st; out.push([(1 - t) * (1 - t) * p1[0] + 2 * (1 - t) * t * v[0] + t * t * p2[0], (1 - t) * (1 - t) * p1[1] + 2 * (1 - t) * t * v[1] + t * t * p2[1]]); }
      out.push(p2);
    }
    out.push(poly[poly.length - 1]);
    return out;
  }
  _meta(poly) { let seg = [], L = 0; for (let i = 0; i < poly.length - 1; i++) { const d = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]); seg.push(d); L += d; } return { seg, L }; }
  _ptAt(poly, m, f) { let t = f * m.L, a = 0; for (let i = 0; i < m.seg.length; i++) { if (a + m.seg[i] >= t) { const u = m.seg[i] ? (t - a) / m.seg[i] : 0; return [poly[i][0] + (poly[i + 1][0] - poly[i][0]) * u, poly[i][1] + (poly[i + 1][1] - poly[i][1]) * u]; } a += m.seg[i]; } return poly[poly.length - 1]; }

  _stroke(poly) { const ctx = this._ctx; ctx.beginPath(); ctx.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]); ctx.stroke(); }
  _tube(poly, color) {
    const ctx = this._ctx, dark = this._dark, SOFT = this.SOFT;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.shadowColor = color;
    if (dark) {
      ctx.globalAlpha = 0.22; ctx.lineWidth = 5; ctx.shadowBlur = SOFT; this._stroke(poly);
      ctx.globalAlpha = 0.6; ctx.lineWidth = 1.6; ctx.shadowBlur = SOFT * 0.5; this._stroke(poly);
    } else {
      // tema chiaro: alone colorato morbido + core netto
      ctx.globalAlpha = 0.28; ctx.lineWidth = 3; ctx.shadowBlur = SOFT; this._stroke(poly);
      ctx.globalAlpha = 0.95; ctx.lineWidth = 1.8; ctx.shadowBlur = 0; this._stroke(poly);
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }
  // fascio unico: coda affusolata + testa luminosa; su tema scuro con bloom morbido (stile reference).
  _beam(poly, m, head, color) {
    const ctx = this._ctx, steps = 34, BEAM = this.BEAM, dark = this._dark, SOFT = this.SOFT;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.shadowColor = color;
    for (let i = steps - 1; i >= 0; i--) { // coda -> testa: la testa resta netta sopra
      const s0 = i / steps, h0 = head - s0 * BEAM, h1 = head - (i + 1) / steps * BEAM;
      if (h0 < 0 || h0 > 1) continue;
      const p0 = this._ptAt(poly, m, h0), p1 = this._ptAt(poly, m, Math.max(0, h1)), k = 1 - s0, g = k * k;
      ctx.globalAlpha = 0.85 * g; ctx.lineWidth = dark ? (1.8 + 3.4 * g) : (1.6 + 2.8 * g); ctx.shadowBlur = dark ? (5 + 14 * g) : (4 + 10 * g);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }
    if (head > 0 && head < 1) {
      const ph = this._ptAt(poly, m, head); ctx.globalAlpha = 1;
      if (dark) {
        ctx.shadowBlur = 18; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(ph[0], ph[1], 4, 0, 7); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.arc(ph[0], ph[1], 1.9, 0, 7); ctx.fill();
      } else {
        ctx.shadowBlur = 12; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(ph[0], ph[1], 3.4, 0, 7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  // nodi [sorgente, destinazione] di un flusso, tenendo conto dell'eventuale reverse
  _flowEnds(key) {
    const def = this._flowDef(key); if (!def) return null;
    const em = { rete_casa: ['rete', 'casa'], batt_casa: ['batt', 'casa'], sole_casa: ['sole', 'casa'], sole_batt: ['sole', 'batt'], sole_rete: ['sole', 'rete'], rete_batt: ['rete', 'batt'] }[def[0]];
    if (!em) return null;
    return def[1] ? [em[1], em[0]] : em;
  }
  // Effetto sul nodo di destinazione all'arrivo del fascio. In entrambi i modi il colore
  // e' quello della SORGENTE, cosi' guardando Casa si capisce da dove e' arrivata
  // l'energia. Nessuno dei due si espande: era l'anello che cresceva a dare fastidio.
  //   arrival: pulse (default) -> bordo e sfondo icona lampeggiano e sfumano sul posto
  //   arrival: edge            -> un segmento di luce fa un giro del bordo del nodo
  _hit(node, color) {
    const el = this._nds && this._nds[node]; if (!el) return;
    const cls = this.config.arrival === 'edge' ? 'ef-hit-edge' : 'ef-hit';
    el.style.setProperty('--ef-hit', color);
    el.classList.remove('ef-hit', 'ef-hit-edge'); // l'opzione puo' cambiare a caldo
    void el.offsetWidth; // reflow: senza questo l'animazione non riparte da capo
    el.classList.add(cls);
  }

  _start() {
    if (this._raf) return;
    const maxP = this.config.max_power || 3500;
    let last = 0;
    const loop = (ts) => {
      const dt = Math.min(50, ts - last) / 1000; last = ts;
      const ctx = this._ctx;
      if (ctx && this._W) {
        const NCOL = this._palette();
        ctx.clearRect(0, 0, this._W, this._H);
        ctx.globalCompositeOperation = this._dark ? 'lighter' : 'source-over';
        const routes = this._routes();
        for (const rk in routes) if (this._routeOn(rk)) this._tube(this._trimmedPoly(rk), NCOL[routes[rk].c]);
        this._pulses.forEach((pl) => {
          const def = this._flowDef(pl.key); if (!def) return;
          let poly = this._trimmedPoly(def[0]); if (def[1]) poly = poly.slice().reverse();
          const m = this._meta(poly), power = this._flows[pl.key] || 0;
          const sp = 0.12 + Math.min(1, power / maxP) * 0.8;
          pl.head += dt * sp;
          if (pl.head > 1) { pl.head -= 1; const en = this._flowEnds(pl.key); if (en) this._hit(en[1], NCOL[def[2]]); }
          this._beam(poly, m, pl.head, NCOL[def[2]]);
        });
        ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }
  _stop() { if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; } }

  _styles() {
    return (
      '<style>' +
      ':host{display:block}' +
      '.ef-card{--ef-rete:#38BDF8;--ef-sole:#F5B301;--ef-batt:#22E39A;--ef-casa:#8B7BFF;' +
      'position:relative;border-radius:18px;padding:10px 14px;overflow:hidden;' +
      'background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));}' +
      '.ef-stage{position:relative;width:100%;aspect-ratio:2.6/1;}' +
      '.ef-stage canvas{position:absolute;inset:0;width:100%;height:100%;z-index:1;}' +
      '.ef-live{position:absolute;right:2px;top:2px;z-index:4;display:flex;align-items:center;gap:6px;font-size:11px;color:var(--secondary-text-color,#6b6f76);}' +
      '.ef-live i{width:7px;height:7px;border-radius:50%;background:var(--ef-batt);}' +
      '.ef-nd{position:absolute;transform:translate(-50%,-50%);z-index:3;pointer-events:none;display:flex;align-items:center;gap:13px;' +
      'padding:11px 17px;border-radius:16px;background:var(--ha-card-background,var(--card-background-color,#fff));' +
      'border:1px solid var(--divider-color,rgba(0,0,0,.1));white-space:nowrap;}' +
      '.ef-ic{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;flex:0 0 auto;' +
      'background:color-mix(in srgb,var(--c) 18%,transparent);position:relative;}' +
      // pastiglia del SOC: grigia, perche' una percentuale di carica non ha un verso e col
      // colore della batteria si leggerebbe come un flusso. Assoluta, quindi non alza il nodo.
      '.ef-soc{position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);' +
      'background:var(--secondary-text-color,#8a8d93);color:#fff;font-size:9.5px;font-weight:700;' +
      'line-height:1;padding:3px 5px;border-radius:999px;white-space:nowrap;font-variant-numeric:tabular-nums;' +
      'box-shadow:0 0 0 2px var(--ha-card-background,var(--card-background-color,#fff));}' +
      '.ef-soc:empty{display:none;}' +
      '.ef-ic svg{width:27px;height:27px;stroke:var(--c);fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;}' +
      // arrivo del fascio: bordo e sfondo icona lampeggiano nel colore della sorgente e
      // sfumano sul posto. Nessuna espansione, quindi nessuna aureola.
      '.ef-nd.ef-hit{animation:efHit .55s cubic-bezier(.2,.7,.3,1);}' +
      '@keyframes efHit{' +
      '0%{border-color:var(--ef-hit,var(--c));box-shadow:0 0 14px 0 color-mix(in srgb,var(--ef-hit,var(--c)) 50%,transparent);}' +
      '100%{border-color:var(--divider-color,rgba(0,0,0,.1));box-shadow:0 0 0 0 transparent;}}' +
      '.ef-nd.ef-hit .ef-ic{animation:efHitIc .55s ease-out;}' +
      '@keyframes efHitIc{' +
      '0%{background:color-mix(in srgb,var(--ef-hit,var(--c)) 42%,transparent);}' +
      '100%{background:color-mix(in srgb,var(--c) 18%,transparent);}}' +
      // arrival: edge -> un segmento di luce percorre una volta il bordo del nodo
      '.ef-edge{position:absolute;left:-1px;top:-1px;pointer-events:none;opacity:0;}' +
      '.ef-edge rect{fill:none;stroke:var(--ef-hit,var(--c));stroke-width:2.4;stroke-linecap:round;' +
      'stroke-dasharray:16 84;stroke-dashoffset:0;}' +
      '.ef-nd.ef-hit-edge .ef-edge{animation:efEdgeFade .72s linear;}' +
      '.ef-nd.ef-hit-edge .ef-edge rect{animation:efEdgeRun .72s cubic-bezier(.35,0,.3,1);}' +
      '@keyframes efEdgeRun{from{stroke-dashoffset:0;}to{stroke-dashoffset:-100;}}' +
      '@keyframes efEdgeFade{0%{opacity:0;}12%{opacity:1;}75%{opacity:1;}100%{opacity:0;}}' +
      // batteria in carica: il livello sale dentro la sagoma e lo sfondo dell'icona respira
      '.ef-ic .ef-fill{display:none;}' +
      '.ef-ic.ef-chg .ef-bars{display:none;}' +
      '.ef-ic.ef-chg .ef-fill{display:block;fill:var(--c);stroke:none;' +
      'transform-box:fill-box;transform-origin:left center;animation:efChg 2.1s cubic-bezier(.45,0,.55,1) infinite;}' +
      '@keyframes efChg{0%{transform:scaleX(.06);opacity:.5;}70%,88%{transform:scaleX(1);opacity:.95;}100%{transform:scaleX(1);opacity:0;}}' +
      '.ef-ic.ef-chg{animation:efChgIc 2.1s ease-in-out infinite;}' +
      '@keyframes efChgIc{0%,100%{background:color-mix(in srgb,var(--c) 14%,transparent);}' +
      '60%{background:color-mix(in srgb,var(--c) 34%,transparent);}}' +
      '.ef-lab{display:flex;flex-direction:column;line-height:1.15;}' +
      '.ef-k{font-size:12px;font-weight:600;color:var(--secondary-text-color,#6b6f76);}' +
      // nowrap sul valore: su mobile il nodo e' stretto e "↓ 64 W" si spezzerebbe su due
      // righe, rialzando il nodo. Meglio che cresca in larghezza di qualche pixel.
      '.ef-v{font-size:19px;font-weight:700;color:var(--primary-text-color,#1c1c1e);margin-top:3px;' +
      'font-variant-numeric:tabular-nums;white-space:nowrap;}' +
      '.ef-ar{color:var(--c);font-weight:700;margin-right:2px;}' +
      '.ef-ar:empty{display:none;}' +
      '.ef-v small{font-size:12px;color:var(--secondary-text-color,#6b6f76);font-weight:500;}' +
      '.ef-x{font-size:11px;font-weight:600;color:var(--c);margin-top:2px;}' +
      '.ef-x:empty{display:none;}' +
      // posizioni desktop
      '.ef-nd[data-n=sole]{left:50%;top:20%;} .ef-nd[data-n=rete]{left:13%;top:66%;} .ef-nd[data-n=batt]{left:87%;top:66%;} .ef-nd[data-n=casa]{left:50%;top:66%;}' +
      // layout compatto (grid_to_battery: false): la fascia in basso ospitava solo il ramo
      // Rete->Batteria, quindi lo stage si abbassa e i nodi si riavvicinano
      '.ef-card.ef-compact .ef-stage{aspect-ratio:3.1/1;}' +
      '.ef-compact .ef-nd[data-n=sole]{top:24%;}' +
      '.ef-compact .ef-nd[data-n=rete],.ef-compact .ef-nd[data-n=batt],.ef-compact .ef-nd[data-n=casa]{top:76%;}' +
      // layout mobile (radiale compatto): stage quadrato, nodi compatti in colonna (icona/nome/valore)
      '.ef-mobile .ef-stage{aspect-ratio:1/1;}' +
      '.ef-mobile .ef-nd{flex-direction:column;align-items:center;gap:3px;padding:7px 10px;border-radius:13px;white-space:normal;}' +
      '.ef-mobile .ef-ic{width:32px;height:32px;border-radius:10px;} .ef-mobile .ef-ic svg{width:20px;height:20px;}' +
      '.ef-mobile .ef-lab{align-items:center;text-align:center;}' +
      '.ef-mobile .ef-k{font-size:9.5px;} .ef-mobile .ef-v{font-size:13px;margin-top:0;} .ef-mobile .ef-v small{font-size:9px;}' +
      '.ef-mobile .ef-x{font-size:9px;margin-top:1px;}' +
      // su mobile il nodo e' una colonna e l'etichetta sta 3px sotto l'icona: la pastiglia
      // la coprirebbe. Lo spazio lo apre un margine sull'icona, che vale per TUTTI i nodi,
      // percio' crescono insieme e restano allineati fra loro.
      '.ef-mobile .ef-ic{margin-bottom:8px;}' +
      '.ef-mobile .ef-soc{font-size:8.5px;padding:2px 4px;bottom:-5px;}' +
      '.ef-mobile .ef-nd[data-n=sole]{left:50%;top:14%;} .ef-mobile .ef-nd[data-n=rete]{left:14%;top:46%;} .ef-mobile .ef-nd[data-n=batt]{left:86%;top:46%;} .ef-mobile .ef-nd[data-n=casa]{left:50%;top:82%;}' +
      '</style>'
    );
  }
}

EnergyFlowCard.getStubConfig = function () {
  return { title: 'Flusso energia', grid_power: 'sensor.sonoff_10023341b5_power', house_power: 'sensor.sonoff_10023341b5_power' };
};

customElements.define('energy-flow-card', EnergyFlowCard);
window.customCards.push({
  type: 'energy-flow-card',
  name: 'Energy Flusso',
  description: 'Flusso energia Rete/Solare/Batteria/Casa con linee neon animate. Config via YAML.',
});

// ===== doors-card.js =====
// Quadro "Porte e finestre" della vista Doors: stato di tutte le aperture a
// colpo d'occhio con l'orario dell'ultimo evento, cronologia della porta
// d'ingresso, tapparelle, perdite acqua, presenze e qualita' dell'aria.
//
// Gli orari NON vengono da `last_changed`: dopo ogni riavvio di Home Assistant
// tutte le entita' passano per unavailable/unknown e `last_changed` diventa
// l'ora del riavvio. Si legge quindi la cronologia dal recorder e si scartano
// gli stati non validi, ricucendo i tratti uguali: cosi' "chiusa alle 08:27"
// resta 08:27 anche dopo un riavvio delle 09:35.
class DoorsCard extends HTMLElement {
  setConfig(config) {
    if (!config || !Array.isArray(config.openings)) {
      throw new Error('Config "openings" mancante o non valida');
    }
    this.config = config;
    this._lastSig = null;
    this._hist = {}; // entity_id -> [{state, ts}] transizioni reali, dalla piu' vecchia
    this._pm = {}; // entity_id -> {mean:[], max:[], min:[]}
    this._histAt = 0;
    this._statAt = 0;
    if (!this._uid) {
      DoorsCard._seq = (DoorsCard._seq || 0) + 1;
      this._uid = DoorsCard._seq;
    }
  }

  set hass(hass) {
    this._hass = hass;
    const sig = mgddStatesSig(hass, this._allIds());
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._render();
    }
    this._maybeFetchHistory();
    this._maybeFetchStats();
  }

  getCardSize() {
    return 14;
  }

  _allIds() {
    const c = this.config || {};
    const ids = [];
    (c.openings || []).forEach((o) => o.entity && ids.push(o.entity));
    (c.covers || []).forEach((o) => o.entity && ids.push(o.entity));
    (c.water || []).forEach((o) => o.entity && ids.push(o.entity));
    (c.presence || []).forEach((o) => o.entity && ids.push(o.entity));
    (c.air || []).forEach((a) => {
      if (a.entity) ids.push(a.entity);
      if (a.pm) ids.push(a.pm);
    });
    if (c.entrance) {
      if (c.entrance.lock) ids.push(c.entrance.lock);
      if (c.entrance.battery) ids.push(c.entrance.battery);
    }
    return ids;
  }

  // ---------- cronologia ----------

  _historyIds() {
    const ids = (this.config.openings || []).map((o) => o.entity).filter(Boolean);
    const en = this.config.entrance;
    if (en && en.entity && ids.indexOf(en.entity) < 0) ids.push(en.entity);
    return ids;
  }

  async _maybeFetchHistory() {
    const now = Date.now();
    if (this._histAt && now - this._histAt < 2 * 60 * 1000) return;
    this._histAt = now;
    if (!this._hass) return;
    const ids = this._historyIds();
    if (!ids.length) return;
    const hours = this.config.history_hours || 48;
    const start = new Date(now - hours * 3600 * 1000).toISOString();
    try {
      const path = 'history/period/' + start + '?filter_entity_id=' + ids.join(',') + '&minimal_response';
      const data = await this._hass.callApi('GET', path);
      const out = {};
      (data || []).forEach((arr) => {
        if (!arr || !arr.length) return;
        const id = arr[0].entity_id;
        if (!id) return;
        const ev = [];
        arr.forEach((s) => {
          if (s.state === 'unavailable' || s.state === 'unknown' || s.state === 'None') return;
          const ts = new Date(s.last_changed || s.last_updated).getTime();
          if (!ts) return;
          // Tratti uguali consecutivi vengono ricuciti: si tiene il timestamp
          // piu' VECCHIO del tratto, cioe' il cambio di stato vero.
          if (!ev.length || ev[ev.length - 1].state !== s.state) ev.push({ state: s.state, ts: ts });
        });
        out[id] = ev;
      });
      this._hist = out;
      this._render();
    } catch (e) {
      /* recorder non disponibile: si mostra comunque lo stato corrente */
    }
  }

  async _maybeFetchStats() {
    const now = Date.now();
    if (this._statAt && now - this._statAt < 5 * 60 * 1000) return;
    this._statAt = now;
    const ids = (this.config.air || []).map((a) => a.pm).filter(Boolean);
    if (!ids.length || !this._hass || !this._hass.callWS) return;
    const req = {
      type: 'recorder/statistics_during_period',
      start_time: new Date(now - 24 * 3600 * 1000).toISOString(),
      statistic_ids: ids,
      period: 'hour',
      types: ['mean', 'max', 'min'],
    };
    let res = null;
    try {
      res = await this._hass.callWS(req);
    } catch (e) {
      delete req.types; // versioni piu' vecchie non accettano `types`
      try {
        res = await this._hass.callWS(req);
      } catch (e2) {
        res = null;
      }
    }
    if (!res) return;
    const out = {};
    ids.forEach((id) => {
      const rows = res[id];
      if (!rows || !rows.length) return;
      out[id] = {
        mean: rows.map((r) => (r.mean == null ? 0 : r.mean)),
        max: rows.map((r) => (r.max == null ? r.mean || 0 : r.max)),
        min: rows.map((r) => (r.min == null ? r.mean || 0 : r.min)),
      };
    });
    this._pm = out;
    this._render();
  }

  // ---------- helper stato ----------

  _st(entity) {
    return (this._hass && this._hass.states[entity]) || null;
  }

  _isOpen(o) {
    const s = this._st(o.entity);
    if (!s) return null;
    if (o.entity.indexOf('lock.') === 0) return s.state === 'unlocked';
    return s.state === 'on';
  }

  _labels(o) {
    if (o.open_label || o.closed_label) return [o.open_label || 'Aperto', o.closed_label || 'Chiuso'];
    if (o.entity && o.entity.indexOf('lock.') === 0) return ['Sbloccato', 'Bloccato'];
    if (o.icon === 'garage') return ['Aperto', 'Chiuso'];
    return ['Aperta', 'Chiusa'];
  }

  // Ultimo cambio di stato reale (dal recorder). null se nella finestra
  // osservata l'entita' non si e' mai mossa.
  _lastEvent(entity) {
    const ev = this._hist[entity];
    if (!ev || ev.length < 2) return null; // il primo elemento e' solo lo stato a inizio finestra
    return ev[ev.length - 1];
  }

  _pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  _hhmm(ts) {
    const d = new Date(ts);
    return this._pad(d.getHours()) + ':' + this._pad(d.getMinutes());
  }

  _hhmmss(ts) {
    const d = new Date(ts);
    return this._pad(d.getHours()) + ':' + this._pad(d.getMinutes()) + ':' + this._pad(d.getSeconds());
  }

  _sameDay(ts, offset) {
    const a = new Date(ts);
    const b = new Date();
    b.setDate(b.getDate() - (offset || 0));
    return a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  }

  _when(ts) {
    if (this._sameDay(ts, 0)) return this._hhmm(ts);
    if (this._sameDay(ts, 1)) return 'ieri ' + this._hhmm(ts);
    const d = new Date(ts);
    return this._pad(d.getDate()) + '/' + this._pad(d.getMonth() + 1) + ' ' + this._hhmm(ts);
  }

  _dur(ms) {
    if (ms < 0) ms = 0;
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' m';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + this._pad(m % 60) + 'm';
    return Math.floor(h / 24) + ' gg';
  }

  // Testo dell'orario mostrato nel riquadro dell'apertura.
  _stamp(o, open) {
    const ev = this._lastEvent(o.entity);
    if (!ev) {
      const hours = this.config.history_hours || 48;
      return '> ' + (hours >= 48 ? Math.floor(hours / 24) + ' gg' : hours + ' h');
    }
    if (open) return this._when(ev.ts) + ' · ' + this._dur(Date.now() - ev.ts);
    return this._when(ev.ts);
  }

  // ---------- icone ----------

  _di(kind, size) {
    const P = {
      door: 'M3 21h18M6 21V3.6a.6.6 0 0 1 .6-.6h10.8a.6.6 0 0 1 .6.6V21M14.2 12.2h.01',
      window: 'M4 4h16v16H4zM12 4v16M4 12h16',
      lock: 'M5 11h14v10H5zM8.5 11V7a3.5 3.5 0 0 1 7 0v4',
      garage: 'M3 21V9.5L12 4l9 5.5V21M7 21v-7h10v7M7 17.2h10',
      shutter: 'M3 4h18M3 4v14.5a1.5 1.5 0 0 0 1.5 1.5h15a1.5 1.5 0 0 0 1.5-1.5V4M3 9h18M3 14h18',
      water: 'M12 3.2s6 6.6 6 10a6 6 0 0 1-12 0c0-3.4 6-10 6-10z',
      presence: 'M12 11.2a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2zM5 20.5a7 7 0 0 1 14 0',
      air: 'M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h9',
      up: 'M12 19V5M5.5 11.5 12 5l6.5 6.5',
      down: 'M12 5v14M18.5 12.5 12 19l-6.5-6.5',
      stop: 'M7.5 7.5h9v9h-9z',
      key: 'M20 4l-8.5 8.5M17 7l2 2M14.5 9.5 16 11M9.5 10.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z',
      bell: 'M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 7.5-2.5 7.5h17S18 15 18 8.5M13.8 20a2 2 0 0 1-3.6 0',
      alert: 'M12 9v4.5M12 17.2h.01M10.4 4 2.3 17.8A1.8 1.8 0 0 0 3.9 20.5h16.2a1.8 1.8 0 0 0 1.6-2.7L13.6 4a1.8 1.8 0 0 0-3.2 0z',
      shield: 'M12 3 5 6v5.5c0 4.4 3 8.1 7 9.5 4-1.4 7-5.1 7-9.5V6l-7-3zM9 12l2 2 4-4',
    };
    const d = P[kind] || P.door;
    return (
      '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'
    );
  }

  _isDark() {
    return !!(this._hass && this._hass.themes && this._hass.themes.darkMode);
  }

  // ---------- grafici PM2.5 ----------

  _band(v) {
    if (v <= 5) return '#22B573';
    if (v <= 15) return '#8CC63F';
    if (v <= 35) return '#E8A33D';
    return '#DC4B48';
  }

  _chart(id, W, H) {
    const d = this._pm[id];
    if (!d || !d.mean || d.mean.length < 2) {
      return '<div class="dr-chempty" style="height:' + H + 'px">dati non ancora disponibili</div>';
    }
    const style = this.config.air_chart || 'bars';
    if (style === 'strip') return this._chartStrip(d, W, 16);
    if (style === 'band') return this._chartBand(d, W, H);
    return this._chartBars(d, W, H);
  }

  _chartBars(d, W, H) {
    const n = d.mean.length;
    const step = W / n;
    const pad = 5;
    let top = 6;
    d.mean.forEach((v) => {
      if (v * 1.35 > top) top = v * 1.35;
    });
    let s = '';
    d.mean.forEach((v, i) => {
      const h = Math.max(2.5, (H - pad * 2) * (v / top));
      const bw = step * 0.62;
      s +=
        '<rect x="' + (i * step + (step - bw) / 2).toFixed(1) + '" y="' + (H - pad - h).toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.6" fill="' + this._band(v) + '"/>';
    });
    s +=
      '<line x1="0" y1="' + (H - pad) + '" x2="' + W + '" y2="' + (H - pad) +
      '" stroke="currentColor" stroke-opacity=".16" stroke-width="1"/>';
    return '<svg class="dr-ch" viewBox="0 0 ' + W + ' ' + H + '" style="height:' + H + 'px">' + s + '</svg>';
  }

  _chartBand(d, W, H) {
    const n = d.mean.length;
    const step = W / (n - 1);
    const pad = 5;
    let top = 6;
    d.max.forEach((v) => {
      if (v * 1.12 > top) top = v * 1.12;
    });
    const y = (v) => pad + (H - pad * 2) * (1 - v / top);
    let up = '';
    let dn = '';
    d.max.forEach((v, i) => {
      up += (i ? 'L' : 'M') + (i * step).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
    });
    for (let i = n - 1; i >= 0; i--) dn += 'L' + (i * step).toFixed(1) + ' ' + y(d.min[i]).toFixed(1) + ' ';
    let ln = '';
    d.mean.forEach((v, i) => {
      ln += (i ? 'L' : 'M') + (i * step).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
    });
    const c = 'var(--dr-air)';
    return (
      '<svg class="dr-ch" viewBox="0 0 ' + W + ' ' + H + '" style="height:' + H + 'px">' +
      '<path d="' + up + dn + 'Z" fill="' + c + '" opacity=".17"/>' +
      '<path d="' + up + '" fill="none" stroke="' + c + '" stroke-opacity=".45" stroke-width="1"/>' +
      '<path d="' + ln + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + ((n - 1) * step).toFixed(1) + '" cy="' + y(d.mean[n - 1]).toFixed(1) + '" r="2.9" fill="' + c + '"/>' +
      '<line x1="0" y1="' + (H - pad) + '" x2="' + W + '" y2="' + (H - pad) + '" stroke="' + c + '" stroke-opacity=".2" stroke-width="1"/>' +
      '</svg>'
    );
  }

  _chartStrip(d, W, H) {
    const n = d.mean.length;
    const step = W / n;
    let s = '';
    d.mean.forEach((v, i) => {
      s +=
        '<rect x="' + (i * step + 0.8).toFixed(1) + '" y="0" width="' + (step - 1.6).toFixed(1) +
        '" height="' + H + '" rx="2.5" fill="' + this._band(v) + '"/>';
    });
    return '<svg class="dr-ch" viewBox="0 0 ' + W + ' ' + H + '" style="height:' + H + 'px">' + s + '</svg>';
  }

  // ---------- markup ----------

  _render() {
    if (!this.config || !this._hass) return;
    mgddPaint(this, this._styles(), this._html());
    this._wire();
  }

  _html() {
    const c = this.config;
    const ops = c.openings || [];
    const open = [];
    const closed = [];
    ops.forEach((o) => {
      const isOpen = this._isOpen(o);
      const item = { o: o, open: !!isOpen, miss: isOpen === null };
      if (isOpen) open.push(item);
      else closed.push(item);
    });
    const ordered = open.concat(closed);

    // ---- intestazione
    const total = ops.length;
    const nClosed = total - open.length;
    let sub;
    if (!open.length) sub = 'Tutte le aperture risultano chiuse';
    else {
      const f = open[0];
      const ev = this._lastEvent(f.o.entity);
      sub = f.o.name + (ev ? ' aperto dalle ' + this._hhmm(ev.ts) : ' aperto');
      if (open.length > 1) sub += ' · altre ' + (open.length - 1) + ' aperte';
    }
    sub += ' · aggiornato ' + this._hhmm(Date.now());

    const qa = (c.actions || [])
      .map(
        (a) =>
          '<button class="dr-qb' + (a.primary ? ' dr-pri' : '') + '" data-script="' + (a.script || '') +
          '" title="' + (a.name || '') + '">' + this._di(a.icon || 'key', 18) +
          '<span>' + (a.name || '') + '</span></button>'
      )
      .join('');

    // ---- status board (desktop) + lista (mobile)
    const tiles = ordered
      .map((it) => {
        const l = this._labels(it.o);
        const lab = it.miss ? 'Non disp.' : it.open ? l[0] : l[1];
        return (
          '<div class="dr-t' + (it.open ? ' dr-op' : '') + (it.miss ? ' dr-na' : '') +
          '" data-more="' + it.o.entity + '">' +
          '<span class="dr-ti">' + this._di(it.o.icon || 'door', 18) + '</span>' +
          '<span class="dr-tn">' + it.o.name + '</span>' +
          '<span class="dr-ts">' + lab + '</span>' +
          '<span class="dr-tm">' + (it.miss ? '—' : this._stamp(it.o, it.open)) + '</span></div>'
        );
      })
      .join('');

    const rowOf = (it) => {
      const l = this._labels(it.o);
      const ev = this._lastEvent(it.o.entity);
      const lab = it.miss ? 'Non disponibile' : it.open ? l[0] + (ev ? ' da ' + this._dur(Date.now() - ev.ts) : '') : l[1];
      return (
        '<div class="dr-r' + (it.open ? ' dr-op' : '') + '" data-more="' + it.o.entity + '">' +
        '<span class="dr-ri">' + this._di(it.o.icon || 'door', 18) + '</span>' +
        '<span class="dr-rn"><b>' + it.o.name + '</b><i>' + lab + '</i></span>' +
        '<span class="dr-rt">' + (it.miss ? '—' : this._stamp(it.o, false)) + '</span></div>'
      );
    };
    const list =
      open.map(rowOf).join('') +
      (closed.length ? '<div class="dr-card dr-mt">' + closed.map(rowOf).join('') + '</div>' : '');

    // ---- pannelli
    return (
      '<div class="dr-shell' + (this._isDark() ? ' dr-dark' : '') + '">' +
      '<div class="dr-hd"><span class="dr-hdi">' + this._di('shield', 20) + '</span>' +
      '<div class="dr-hdx"><div class="dr-hdt">' + nClosed + ' su ' + total + ' chiuse</div>' +
      '<div class="dr-hds">' + sub + '</div></div>' +
      '<div class="dr-qa">' + qa + '</div></div>' +
      '<div class="dr-grid">' + tiles + '</div>' +
      '<div class="dr-list">' + list + '</div>' +
      '<div class="dr-pg">' +
      this._panelEntrance() +
      this._panelAir() +
      this._panelCovers() +
      this._panelBin(c.water, 'Perdite acqua', 'Asciutto', 'BAGNATO') +
      this._panelBin(c.presence, 'Presenze', 'Assente', 'PRESENTE') +
      '</div></div>'
    );
  }

  _panelEntrance() {
    const en = this.config.entrance;
    if (!en || !en.entity) return '';
    const ev = this._hist[en.entity] || [];
    const now = Date.now();
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    let todayOpens = 0;
    ev.forEach((e, i) => {
      if (e.state === 'on' && e.ts >= midnight.getTime() && i > 0) todayOpens++;
    });
    const lock = en.lock ? this._st(en.lock) : null;
    const batt = en.battery ? this._st(en.battery) : null;
    const cur = this._st(en.entity);
    const isOpen = cur && cur.state === 'on';
    const last = this._lastEvent(en.entity);

    const rows = [];
    for (let i = ev.length - 1; i >= 1 && rows.length < 6; i--) {
      const e = ev[i];
      const opened = e.state === 'on';
      const end = i + 1 < ev.length ? ev[i + 1].ts : now;
      rows.push(
        '<div class="dr-ln"><span class="dr-d' + (opened ? ' dr-w' : ' dr-n') + '"></span>' +
        '<span>' + (opened ? 'Aperto · ' + this._dur(end - e.ts) : 'Chiuso') + '</span>' +
        '<u' + (opened ? ' class="dr-w"' : '') + '>' + this._hhmmss(e.ts) + '</u></div>'
      );
    }
    if (!rows.length) rows.push('<div class="dr-ln"><span class="dr-d dr-n"></span><span>Nessun movimento</span><u>—</u></div>');

    const meta = [];
    if (last) meta.push('Ultima ' + (isOpen ? 'apertura' : 'chiusura') + ' ' + this._hhmmss(last.ts) + ' · ' + this._dur(now - last.ts) + ' fa');
    if (batt && !isNaN(parseFloat(batt.state))) meta.push('batteria ' + Math.round(parseFloat(batt.state)) + '%');

    return (
      '<div class="dr-pn dr-w2"><div class="dr-lab">' + (en.name || 'Porta ingresso') +
      ' <b>' + todayOpens + (todayOpens === 1 ? ' APERTURA OGGI' : ' APERTURE OGGI') + '</b></div>' +
      '<div class="dr-encols">' +
      '<div><div class="dr-val" data-more="' + en.entity + '">' + (isOpen ? 'Aperta' : 'Chiusa') +
      (lock ? '<small>' + (lock.state === 'locked' ? 'bloccata' : 'sbloccata') + '</small>' : '') + '</div>' +
      '<div class="dr-enmeta">' + meta.join('<br>') + '</div></div>' +
      '<div>' + rows.join('') + '</div></div></div>'
    );
  }

  _panelAir() {
    const air = this.config.air || [];
    if (!air.length) return '';
    const style = this.config.air_chart || 'bars';
    let worst = 0;
    air.forEach((a) => {
      const v = parseFloat((this._st(a.pm) || {}).state);
      if (!isNaN(v) && v > worst) worst = v;
    });
    const verdict = worst <= 5 ? 'ECCELLENTE' : worst <= 15 ? 'BUONA' : worst <= 35 ? 'MEDIA' : 'SCADENTE';

    const one = (a) => {
      const pm = this._st(a.pm);
      const on = (this._st(a.entity) || {}).state === 'on';
      const v = pm && !isNaN(parseFloat(pm.state)) ? Math.round(parseFloat(pm.state)) : '--';
      const d = this._pm[a.pm];
      let peak = '';
      if (d && d.max && d.max.length) peak = ' · picco ' + Math.round(Math.max.apply(null, d.max));
      if (style === 'strip') {
        return (
          '<div class="dr-striprow" data-more="' + a.entity + '">' +
          '<div class="dr-stripv"><div class="dr-big">' + v + '<small>µg/m³</small></div>' +
          '<div class="dr-stripn">' + a.name + (on ? '' : ' · spento') + '</div></div>' +
          '<div class="dr-stripc"><div class="dr-cht"><span>ultime 24 h</span><u>' +
          peak.replace(' · ', '') + '</u></div>' + this._chart(a.pm, 240, 16) +
          '<div class="dr-chx"><span>-24 h</span><span>-12 h</span><span>ora</span></div></div></div>'
        );
      }
      return (
        '<div data-more="' + a.entity + '"><div class="dr-cht">' + a.name +
        ' <u>' + v + ' µg/m³' + peak + '</u></div>' + this._chart(a.pm, 240, 62) +
        '<div class="dr-chx"><span>-24 h</span><span>-12 h</span><span>ora</span></div></div>'
      );
    };

    const legend =
      style === 'band'
        ? '<div class="dr-lgd"><span><i class="dr-lg-a"></i>escursione min–max dell\'ora</span>' +
          '<span><i class="dr-lg-b"></i>media oraria</span></div>'
        : '<div class="dr-lgd"><span><i style="background:#22B573"></i>0–5 ottimo</span>' +
          '<span><i style="background:#8CC63F"></i>5–15 buono</span>' +
          '<span><i style="background:#E8A33D"></i>15–35 medio</span>' +
          '<span><i style="background:#DC4B48"></i>oltre 35</span></div>';

    return (
      '<div class="dr-pn dr-w2"><div class="dr-lab">Qualità dell\'aria <b>' + verdict + '</b></div>' +
      (style === 'strip' ? air.map(one).join('') : '<div class="dr-chw">' + air.map(one).join('') + '</div>') +
      legend + '</div>'
    );
  }

  _panelCovers() {
    const cv = this.config.covers || [];
    if (!cv.length) return '';
    let ok = 0;
    const items = cv.map((x) => {
      const s = this._st(x.entity);
      const avail = !!(s && s.state !== 'unavailable' && s.state !== 'unknown');
      if (avail) ok++;
      const pos = avail && s.attributes && s.attributes.current_position != null ? Math.round(s.attributes.current_position) : null;
      const btns = avail
        ? '<button class="dr-ar" data-cover="' + x.entity + '" data-act="open" title="Alza">' + this._di('up', 13) + '</button>' +
          '<button class="dr-ar" data-cover="' + x.entity + '" data-act="stop" title="Ferma">' + this._di('stop', 13) + '</button>' +
          '<button class="dr-ar" data-cover="' + x.entity + '" data-act="close" title="Abbassa">' + this._di('down', 13) + '</button>'
        : '<button class="dr-ar" data-more="' + x.entity + '" title="Non disponibile">' + this._di('alert', 13) + '</button>';
      return (
        '<div class="dr-sh' + (avail ? '' : ' dr-na') + '"><b data-more="' + x.entity + '">' + x.name + '</b>' +
        '<em>' + (avail ? (pos == null ? (s.state === 'open' ? 'Aperta' : 'Chiusa') : pos + '%') : 'N/D') + '</em>' +
        btns + '</div>'
      );
    });
    const half = Math.ceil(items.length / 2);
    const colA = items.slice(0, half);
    const colB = items.slice(half);
    return (
      '<div class="dr-pn dr-w2"><div class="dr-lab">Tapparelle <span>' + ok + ' / ' + cv.length + ' operative</span></div>' +
      '<div class="dr-2col"><div>' + colA.join('') + '</div><div>' + colB.join('') + '</div></div></div>'
    );
  }

  _panelBin(items, title, okLabel, alarmLabel) {
    if (!items || !items.length) return '';
    let alarm = 0;
    const rows = items
      .map((x) => {
        const s = this._st(x.entity);
        const on = s && s.state === 'on';
        if (on) alarm++;
        return (
          '<div class="dr-ln" data-more="' + x.entity + '"><span class="dr-d' + (on ? ' dr-w' : ' dr-n') + '"></span>' +
          '<span>' + x.name + '</span><u' + (on ? ' class="dr-w"' : '') + '>' + (on ? alarmLabel : okLabel) + '</u></div>'
        );
      })
      .join('');
    const badge = alarm ? '<b class="dr-w">' + alarm + ' ATTIVI</b>' : '<b>NESSUNO</b>';
    return '<div class="dr-pn"><div class="dr-lab">' + title + ' ' + badge + '</div><div class="dr-mt8">' + rows + '</div></div>';
  }

  // ---------- interazione ----------

  _wire() {
    this.querySelectorAll('[data-script]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = el.getAttribute('data-script');
        if (id && this._hass) this._hass.callService('script', 'turn_on', { entity_id: id });
      });
    });
    this.querySelectorAll('[data-cover]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = el.getAttribute('data-cover');
        const act = el.getAttribute('data-act');
        const svc = act === 'open' ? 'open_cover' : act === 'close' ? 'close_cover' : 'stop_cover';
        if (id && this._hass) this._hass.callService('cover', svc, { entity_id: id });
      });
    });
    this.querySelectorAll('[data-more]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = el.getAttribute('data-more');
        if (!id) return;
        this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
      });
    });
  }

  _styles() {
    return (
      '<style>' +
      '.dr-shell{container-type:inline-size;border-radius:16px;padding:16px;' +
      '--dr-bg:#f3f4f7;--dr-pnl:#fff;--dr-hair:rgba(16,20,28,.09);--dr-t1:#14161a;--dr-t2:#858b95;' +
      '--dr-t3:#525862;--dr-acc:#0E9B6C;--dr-warn:#C07405;--dr-warn2:#8A5300;--dr-air:#6A57E0;' +
      '--dr-tile:#fff;--dr-tileb:rgba(16,20,28,.09);--dr-tileh:#fbfbfc;--dr-glow:none;' +
      '--dr-sh:0 1px 2px rgba(16,20,28,.05),0 6px 18px rgba(16,20,28,.05);--dr-grid:rgba(16,20,28,.028);' +
      '--dr-op:linear-gradient(150deg,#D68C0C,#A96303);--dr-opsh:0 8px 22px rgba(201,130,13,.24);' +
      'background:var(--dr-bg);color:var(--dr-t1);border:1px solid rgba(16,20,28,.06);' +
      'background-image:linear-gradient(var(--dr-grid) 1px,transparent 1px),' +
      'linear-gradient(90deg,var(--dr-grid) 1px,transparent 1px);background-size:34px 34px;' +
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}' +
      '.dr-shell.dr-dark{--dr-bg:#07080b;--dr-pnl:#0a0c10;--dr-hair:rgba(255,255,255,.09);' +
      '--dr-t1:#e4e9ef;--dr-t2:#5d6774;--dr-t3:#98a2ae;--dr-acc:#35E0A1;--dr-warn:#FFB020;' +
      '--dr-warn2:#FFD48A;--dr-air:#9083FF;--dr-tile:rgba(255,255,255,.035);' +
      '--dr-tileb:rgba(255,255,255,.09);--dr-tileh:rgba(255,255,255,.065);' +
      '--dr-glow:0 0 7px currentColor;--dr-sh:none;--dr-grid:rgba(255,255,255,.022);' +
      '--dr-op:linear-gradient(150deg,#C9820D,#9A5A02);--dr-opsh:0 8px 22px rgba(201,130,13,.30);' +
      'border-color:transparent;}' +
      '.dr-shell *{box-sizing:border-box;}' +
      '.dr-shell svg{display:block;}' +
      '.dr-shell button{font:inherit;cursor:pointer;}' +

      '.dr-hd{display:flex;align-items:center;gap:13px;flex-wrap:wrap;margin-bottom:14px;}' +
      '.dr-hdi{width:44px;height:44px;border-radius:14px;flex:none;display:grid;place-items:center;' +
      'background:color-mix(in srgb,var(--dr-acc) 14%,transparent);color:var(--dr-acc);}' +
      '.dr-hdx{min-width:0;}' +
      '.dr-hdt{font-size:16px;font-weight:645;letter-spacing:-.4px;}' +
      '.dr-hds{font-size:11.5px;color:var(--dr-t2);}' +
      '.dr-qa{display:grid;grid-template-columns:repeat(5,minmax(78px,1fr));gap:8px;margin-left:auto;}' +
      '.dr-qb{background:var(--dr-tile);border:1px solid var(--dr-tileb);border-radius:10px;' +
      'padding:11px 8px;color:var(--dr-t3);display:flex;flex-direction:column;align-items:center;' +
      'gap:7px;font-size:9.5px;font-weight:650;letter-spacing:.8px;text-transform:uppercase;' +
      'box-shadow:var(--dr-sh);transition:background .15s,border-color .15s,color .15s;line-height:1.15;' +
      'text-align:center;}' +
      '.dr-qb:hover{background:color-mix(in srgb,var(--dr-acc) 10%,var(--dr-tile));' +
      'border-color:color-mix(in srgb,var(--dr-acc) 42%,transparent);color:var(--dr-acc);}' +
      '.dr-qb.dr-pri{color:var(--dr-acc);border-color:color-mix(in srgb,var(--dr-acc) 45%,transparent);' +
      'background:color-mix(in srgb,var(--dr-acc) 9%,var(--dr-tile));}' +

      '.dr-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;}' +
      '.dr-t{border-radius:16px;padding:13px 12px 12px;background:var(--dr-tile);' +
      'border:1px solid var(--dr-tileb);display:flex;flex-direction:column;gap:8px;' +
      'box-shadow:var(--dr-sh);cursor:pointer;transition:background .15s;}' +
      '.dr-t:hover{background:var(--dr-tileh);}' +
      '.dr-ti{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;' +
      'color:var(--dr-acc);background:color-mix(in srgb,var(--dr-acc) 13%,transparent);}' +
      '.dr-tn{font-size:11.5px;font-weight:560;color:var(--dr-t1);line-height:1.25;}' +
      '.dr-ts{font-size:9.5px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:var(--dr-acc);}' +
      '.dr-tm{font-size:14px;font-weight:620;color:var(--dr-t2);font-variant-numeric:tabular-nums;letter-spacing:-.3px;}' +
      '.dr-t.dr-op{background:var(--dr-op);border-color:transparent;box-shadow:var(--dr-opsh);}' +
      '.dr-t.dr-op .dr-ti{background:rgba(255,255,255,.22);color:#fff;}' +
      '.dr-t.dr-op .dr-tn,.dr-t.dr-op .dr-ts{color:#fff;}' +
      '.dr-t.dr-op .dr-tm{color:rgba(255,255,255,.88);}' +
      '.dr-t.dr-na{opacity:.5;}' +

      '.dr-list{display:none;}' +
      '.dr-card{background:var(--dr-pnl);border:1px solid var(--dr-hair);border-radius:15px;' +
      'padding:4px 13px;box-shadow:var(--dr-sh);}' +
      '.dr-mt{margin-top:9px;}' +
      '.dr-r{display:flex;align-items:center;gap:11px;min-height:52px;padding:7px 0;' +
      'border-bottom:1px solid var(--dr-hair);cursor:pointer;}' +
      '.dr-r:last-child{border-bottom:none;}' +
      '.dr-ri{width:34px;height:34px;border-radius:11px;flex:none;display:grid;place-items:center;' +
      'color:var(--dr-acc);background:color-mix(in srgb,var(--dr-acc) 13%,transparent);}' +
      '.dr-rn{flex:1;min-width:0;}' +
      '.dr-rn b{display:block;font-size:13px;font-weight:545;color:var(--dr-t1);' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.dr-rn i{font-style:normal;font-size:10px;font-weight:700;letter-spacing:1px;' +
      'text-transform:uppercase;color:var(--dr-acc);}' +
      '.dr-rt{font-size:13.5px;font-weight:620;color:var(--dr-t2);font-variant-numeric:tabular-nums;' +
      'letter-spacing:-.3px;text-align:right;white-space:nowrap;}' +
      '.dr-r.dr-op{background:var(--dr-op);border-radius:14px;padding:8px 11px;margin:3px 0;' +
      'border-bottom:none;box-shadow:var(--dr-opsh);}' +
      '.dr-r.dr-op .dr-ri{background:rgba(255,255,255,.22);color:#fff;}' +
      '.dr-r.dr-op .dr-rn b,.dr-r.dr-op .dr-rn i,.dr-r.dr-op .dr-rt{color:#fff;}' +

      '.dr-pg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin-top:12px;' +
      'background:var(--dr-hair);border:1px solid var(--dr-hair);border-radius:11px;overflow:hidden;}' +
      '.dr-pn{background:var(--dr-pnl);padding:14px 15px;}' +
      '.dr-pn.dr-w2{grid-column:span 2;}' +
      '.dr-lab{font-size:9.5px;font-weight:700;letter-spacing:1.7px;text-transform:uppercase;' +
      'color:var(--dr-t2);display:flex;justify-content:space-between;align-items:center;gap:10px;}' +
      '.dr-lab b{color:var(--dr-acc);font-weight:700;}' +
      '.dr-lab b.dr-w{color:var(--dr-warn2);}' +
      '.dr-mt8{margin-top:9px;}' +
      '.dr-val{font-size:23px;font-weight:400;letter-spacing:-1px;margin-top:8px;color:var(--dr-t1);cursor:pointer;}' +
      '.dr-val small{font-size:12px;color:var(--dr-t2);letter-spacing:0;margin-left:5px;}' +
      '.dr-enmeta{font-size:11.5px;color:var(--dr-t2);margin-top:6px;line-height:1.5;}' +
      '.dr-encols{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1fr);gap:16px;margin-top:10px;}' +
      '.dr-ln{display:flex;align-items:center;gap:9px;padding:5px 0;font-size:11.5px;' +
      'border-bottom:1px solid var(--dr-hair);}' +
      '.dr-ln:last-child{border-bottom:none;}' +
      '.dr-d{width:5px;height:5px;border-radius:99px;flex:none;background:var(--dr-acc);' +
      'color:var(--dr-acc);box-shadow:var(--dr-glow);}' +
      '.dr-d.dr-w{background:var(--dr-warn);color:var(--dr-warn);}' +
      '.dr-d.dr-n{background:var(--dr-t2);box-shadow:none;opacity:.65;}' +
      '.dr-ln span:nth-child(2){flex:1;color:var(--dr-t3);min-width:0;white-space:nowrap;' +
      'overflow:hidden;text-overflow:ellipsis;}' +
      '.dr-ln u{text-decoration:none;font-size:10.5px;color:var(--dr-t2);letter-spacing:.6px;' +
      'font-variant-numeric:tabular-nums;text-transform:uppercase;}' +
      '.dr-ln u.dr-w{color:var(--dr-warn2);}' +

      '.dr-2col{display:grid;grid-template-columns:1fr 1fr;gap:0 18px;margin-top:8px;}' +
      '.dr-sh{display:flex;align-items:center;gap:9px;padding:6px 0;font-size:11.5px;' +
      'border-bottom:1px solid var(--dr-hair);}' +
      '.dr-sh:last-child{border-bottom:none;}' +
      '.dr-sh.dr-na{opacity:.45;}' +
      '.dr-sh b{flex:1;font-weight:520;color:var(--dr-t3);min-width:0;cursor:pointer;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.dr-sh em{font-style:normal;color:var(--dr-acc);font-variant-numeric:tabular-nums;' +
      'font-size:12px;min-width:36px;text-align:right;font-weight:600;}' +
      '.dr-ar{width:26px;height:24px;border-radius:6px;border:1px solid var(--dr-tileb);' +
      'background:none;color:var(--dr-t2);display:grid;place-items:center;flex:none;}' +
      '.dr-ar:hover{color:var(--dr-acc);border-color:color-mix(in srgb,var(--dr-acc) 42%,transparent);}' +

      '.dr-chw{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px;}' +
      '.dr-cht{font-size:11px;font-weight:620;color:var(--dr-t3);display:flex;' +
      'justify-content:space-between;align-items:baseline;margin-bottom:5px;gap:8px;}' +
      '.dr-cht u{text-decoration:none;font-size:10.5px;color:var(--dr-t2);' +
      'font-variant-numeric:tabular-nums;white-space:nowrap;}' +
      '.dr-chx{display:flex;justify-content:space-between;font-size:9.5px;color:var(--dr-t2);' +
      'margin-top:3px;font-variant-numeric:tabular-nums;}' +
      '.dr-ch{width:100%;color:var(--dr-t2);}' +
      '.dr-chempty{display:grid;place-items:center;font-size:10.5px;color:var(--dr-t2);' +
      'border:1px dashed var(--dr-hair);border-radius:8px;}' +
      '.dr-lgd{display:flex;gap:13px;flex-wrap:wrap;font-size:10px;color:var(--dr-t2);' +
      'margin-top:10px;letter-spacing:.2px;}' +
      '.dr-lgd i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;}' +
      '.dr-lg-a{background:var(--dr-air);opacity:.35;}.dr-lg-b{background:var(--dr-air);}' +
      '.dr-striprow{display:flex;align-items:center;gap:14px;margin-top:13px;cursor:pointer;}' +
      '.dr-stripv{min-width:96px;}' +
      '.dr-stripc{flex:1;min-width:0;}' +
      '.dr-stripn{font-size:11px;color:var(--dr-t2);margin-top:3px;}' +
      '.dr-big{font-size:27px;font-weight:670;letter-spacing:-1.2px;line-height:1;' +
      'font-variant-numeric:tabular-nums;}' +
      '.dr-big small{font-size:11.5px;font-weight:550;color:var(--dr-t2);letter-spacing:0;margin-left:4px;}' +

      // ---- mobile: lista al posto della griglia, pannelli in colonna
      '@container (max-width:720px){' +
      '.dr-shell{padding:12px;}' +
      '.dr-hd{gap:11px;}' +
      '.dr-hdt{font-size:19px;letter-spacing:-.6px;}' +
      '.dr-qa{order:3;width:100%;margin-left:0;display:flex;gap:8px;overflow-x:auto;' +
      'padding-bottom:3px;scrollbar-width:none;}' +
      '.dr-qa::-webkit-scrollbar{display:none;}' +
      '.dr-qb{flex:none;flex-direction:row;height:46px;padding:0 15px;border-radius:99px;' +
      'font-size:12px;font-weight:600;letter-spacing:0;text-transform:none;gap:8px;}' +
      '.dr-grid{display:none;}' +
      '.dr-list{display:block;}' +
      '.dr-pg{grid-template-columns:1fr;}' +
      '.dr-pn.dr-w2{grid-column:auto;}' +
      '.dr-encols{grid-template-columns:1fr;gap:10px;}' +
      '.dr-chw{grid-template-columns:1fr;}' +
      '.dr-2col{grid-template-columns:1fr;}' +
      '.dr-ar{width:34px;height:32px;}' +
      '.dr-sh{padding:8px 0;font-size:13px;}' +
      '.dr-sh em{font-size:13px;}' +
      '.dr-ln{padding:7px 0;font-size:12.5px;}' +
      '}' +
      '@container (min-width:721px) and (max-width:1000px){' +
      '.dr-grid{grid-template-columns:repeat(3,minmax(0,1fr));}' +
      '.dr-pg{grid-template-columns:repeat(2,minmax(0,1fr));}' +
      '}' +
      '</style>'
    );
  }
}

DoorsCard.getStubConfig = function () {
  return { openings: [], covers: [], water: [], presence: [], air: [], actions: [] };
};

customElements.define('casa-mgdd-doors-card', DoorsCard);
window.customCards.push({
  type: 'casa-mgdd-doors-card',
  name: 'Casa MGDD Porte e Finestre',
  description: 'Quadro aperture con orari dal recorder, ingresso, tapparelle, acqua, presenze e aria. Config via YAML.',
});
