/*
 * Casa MGDD - Custom Lovelace Cards
 * Libreria unica di card custom per la dashboard Home Assistant.
 * Contiene: temperature-bento-card, temperature-row-card, weather-alert-card,
 * energy-power-card, energy-controls-card, energy-history-card,
 * energy-monthly-card, energy-flow-card, energy-summary-card,
 * casa-mgdd-doors-card, casa-mgdd-system-card, casa-mgdd-openings-card,
 * casa-mgdd-sensors-card, casa-mgdd-energy-live-card,
 * casa-mgdd-energy-ring-card, casa-mgdd-energy-scheme-card,
 * casa-mgdd-presence-card.
 *
 * Version: 1.84.0
 */

// Inter, chiesto una volta sola per pagina.
//
// Prima stava come `@import` dentro il foglio di stile di SETTE card
// (temperature-bento, temperature-row, weather-alert, energy-power,
// energy-controls, energy-history). Poiche' in questa libreria non si usa mai
// lo shadow DOM, quell'import valeva per l'intera pagina: le altre card
// prendevano Inter solo se sulla vista aperta c'era per caso una di quelle
// sette, altrimenti ripiegavano su Segoe UI. La stessa card cambiava carattere
// a seconda della vista in cui la si metteva.
//
// Si chiede l'asse variabile 100..900 e non i quattro pesi statici di prima:
// la libreria usa 545, 580, 620, 640, 645, 650, 660, 670, 680... che con le
// facce statiche venivano arrotondate al peso piu' vicino.
//
// NB: e' l'unica cosa che questa libreria prende da internet. Senza rete il
// testo resta leggibile (`display=swap` e la catena di ripiego), ma cambia
// carattere.
function mgddFont() {
  if (typeof document === 'undefined' || document.getElementById('mgdd-inter')) return;
  const l = document.createElement('link');
  l.id = 'mgdd-inter';
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap';
  (document.head || document.documentElement).appendChild(l);
}
mgddFont();

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
    // layout devices: vive di statistiche a lungo termine, non di stati live. Tenere
    // fuori i sensori di potenza evita un ridisegno ogni 2 s, che azzererebbe il fuoco
    // sui comandi di navigazione mentre l'utente scorre i giorni.
    if (cfg.layout !== 'devices') {
      (cfg.circuits || []).forEach((c) => {
        if (c.entity) ids.push(c.entity);
        if (c.switch) ids.push(c.switch);
      });
    }
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
    const l = this.config && this.config.layout;
    if (l === 'devices') return 14;
    if (l === 'balance') return 10;
    if (l === 'prodcons') return 6;
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

  // Segno sempre esplicito, e meno tipografico invece del trattino: un saldo senza
  // segno si legge come una quantita' e non come una differenza.
  _fmtSigned(v) {
    if (v === null || v === undefined) return '--';
    const a = Math.abs(v).toFixed(1);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + a;
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
      await this._fetchBalance();
    }
    if (this.config.layout === 'devices' && this._hass) {
      await this._fetchDeviceStats();
    }
    if (this.config.layout === 'prodcons' && this._hass) {
      await this._fetchProdCons();
    }
    // Anche il layout balance usa questo blocco: gli servono il confronto con ieri
    // alla stessa ora e il mese in corso con la proiezione. Il contatore di
    // riferimento e' quello di casa, che nel balance e' `house`.
    const statsEntity = this.config.total_energy_entity || this.config.energy_day_entity ||
      (this.config.layout === 'balance' ? this.config.house : null);
    const wantsTrend = this.config.layout === 'overview' || this.config.layout === 'balance';
    if (wantsTrend && statsEntity && this._hass) {
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

  // Periodo mostrato dal bilancio. `back` conta a ritroso: 0 e' il periodo in corso,
  // il limite viene da days/months.
  //
  // Due granularita', non una: `hours` sono i bucket di CALCOLO (sempre ore, anche
  // nel mese), `n` sono le barre del profilo (24 ore o i giorni del mese). Il
  // modello deve girare sull'ora perche' la scomposizione si regge sulla
  // contemporaneita' di consumo e produzione: vedi il commento su _balanceModel.
  _balSelection() {
    const kind = this._balKind === 'month' ? 'month' : 'day';
    const max = (kind === 'month' ? this.config.months || 6 : this.config.days || 14) - 1;
    let back = this._balBack || 0;
    if (back < 0) back = 0;
    if (back > max) back = max;
    const now = new Date();
    let from;
    let to;
    let n;
    if (kind === 'month') {
      from = new Date(now.getFullYear(), now.getMonth() - back, 1);
      to = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
      n = Math.round((to - from) / 86400000);
    } else {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back + 1);
      n = 24;
    }
    // dalla differenza in millisecondi, non da n*24: un mese con cambio d'ora
    // legale ha 743 o 745 ore, non 744.
    const hours = Math.round((to - from) / 3600000);
    return { kind: kind, back: back, max: max, from: from, to: to, n: n, hours: hours, current: back === 0 };
  }

  // Ore lette PRIMA dell'inizio del periodo. Non finiscono nel grafico: dicono con
  // che cosa e' stata caricata la batteria che si scarica a inizio periodo.
  _balPreHours() {
    return 24;
  }

  async _fetchBalance() {
    const c = this.config;
    const ids = [c.house, c.solar, c.grid_import, c.grid_export, c.battery_charge, c.battery_discharge].filter(Boolean);
    if (!ids.length) return;
    const sel = this._balSelection();
    // Le righe prima dell'inizio servono a due cose: l'ultima porta il valore del
    // contatore al confine, cioe' il riferimento da cui misurare il primo bucket del
    // periodo quando di righe dentro il periodo non ce n'e' ancora nessuna, e tutte
    // insieme dicono da dove veniva l'energia in batteria. Un'ora sola non basta per
    // la seconda: alle 3 di notte la carica utile e' quella del pomeriggio prima.
    const from = new Date(sel.from.getTime() - this._balPreHours() * 3600 * 1000);
    const to = sel.current ? new Date() : sel.to;
    let resp = null;
    try {
      // sempre 'hour', anche per il mese: un mese sono ~744 righe per contatore,
      // ma e' l'unica granularita' su cui la scomposizione ha senso.
      resp = await this._hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: from.toISOString(),
        end_time: to.toISOString(),
        statistic_ids: ids,
        period: 'hour',
        types: ['change', 'state'],
      });
    } catch (e) {
      resp = null; // senza recorder la card mostra "--": nessun numero inventato
    }
    this._balStats = resp ? this._buildBalStats(resp, ids, sel) : null;
    this._balSel = sel;
  }

  // Da risposta statistiche a, per ogni entita': i kWh ORA per ORA del periodo, il
  // e il valore del contatore al confine dell'ultima ora compilata. Le righe fuori
  // dal periodo non entrano nei bucket: servono solo a fissare il confine.
  _buildBalStats(resp, ids, sel) {
    const out = {};
    ids.forEach((id) => {
      const buckets = new Array(sel.hours).fill(0);
      // `seen` distingue "riga a zero" da "nessuna riga": senza, un'ora in cui il
      // sensore era irraggiungibile diventa indistinguibile da un'ora a consumo
      // nullo, e il grafico afferma una cosa che non sa.
      const seen = new Array(sel.hours).fill(false);
      const PRE = this._balPreHours();
      const pre = new Array(PRE).fill(0);
      let edge = null;
      ((resp && resp[id]) || []).forEach((r) => {
        const s = parseFloat(r.state);
        if (!Number.isNaN(s)) edge = s;
        const d = new Date(r.start);
        const v = Math.max(0, r.change || 0);
        if (d < sel.from) {
          const j = Math.round((d - sel.from) / 3600000) + PRE;
          if (j >= 0 && j < PRE) pre[j] += v;
          return;
        }
        if (d >= sel.to) return;
        const i = Math.floor((d - sel.from) / 3600000);
        if (i >= 0 && i < sel.hours) {
          buckets[i] += v;
          seen[i] = true;
        }
      });
      out[id] = { buckets: buckets, seen: seen, pre: pre, edge: edge };
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
    else if (this.config.layout === 'devices') this._renderDevices();
    else if (this.config.layout === 'prodcons') this._renderProdCons();
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
  _balBuckets(id) {
    const st = this._balStats && this._balStats[id];
    if (!st) return null;
    const b = st.buckets.slice();
    const sel = this._balSel;
    // Il pezzo vivo esiste solo nel periodo in corso: su un giorno passato le
    // statistiche sono complete e sommarci lo stato attuale sarebbe un errore.
    if (sel && sel.current) {
      const live = this._num(id);
      if (live !== null) {
        const now = new Date();
        const i = Math.floor((now - sel.from) / 3600000);
        let base;
        if (this.config.cumulative === true) base = st.edge;
        else {
          // i contatori *_today azzerano a mezzanotte, quindi il valore live va
          // confrontato con quanto e' compilato OGGI: nel mese il totale del
          // periodo comprende i giorni precedenti e il confronto non tornerebbe.
          const i0 = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - sel.from) / 3600000);
          base = 0;
          for (let k = Math.max(0, i0); k < b.length; k++) base += b[k];
        }
        if (base !== null && base !== undefined && isFinite(base) && live > base && i >= 0 && i < b.length) {
          b[i] += live - base;
        }
      }
    }
    return b;
  }

  // Le ore prima dell'inizio del periodo. Niente pezzo vivo: sono tutte ore gia'
  // compilate dal recorder.
  _balPreBuckets(id) {
    const st = this._balStats && this._balStats[id];
    return st && st.pre ? st.pre.slice() : null;
  }

  // layout balance (variante "Arc"): bilancio energetico giornaliero.
  // Scomposizione del consumo di casa nelle tre origini, ora per ora. Il riepilogo
  // del giorno e' la somma delle ore, non un secondo calcolo sui totali: i due non
  // possono raccontare cose diverse, e la scomposizione oraria e' molto piu' fedele
  // (nella singola ora consumo e produzione sono davvero contemporanei).
  //
  // Solare e RETE si LEGGONO dai rispettivi sensori, non si deducono per differenza:
  // il residuo e' la batteria. Prima il residuo era la rete, e ogni imprecisione del
  // modello finiva etichettata come prelievo: il 5 agosto 2026 il grafico diceva 1.1
  // kWh di rete contro gli 0.3 kWh misurati dal contatore nella stessa card. Un
  // numero che il contatore misura non va dedotto.
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
  // e' la stessa energia della rete che fa un giro. Quella frazione e' uno STATO
  // della batteria, quindi si legge su una finestra mobile di 24 ore che scavalca la
  // mezzanotte, non sul giorno solare. Sul giorno solare, alle 6 del mattino il
  // denominatore e' ancora zero (di notte non si carica) e la frazione crollava a
  // zero: tutta la scarica notturna veniva etichettata come rete. Il 6 agosto 2026
  // alle 06:33 la card diceva rete 100% e autosufficienza 0% con 0.1 kWh davvero
  // prelevati: la casa aveva consumato batteria per tutta la notte.
  //
  // La quota di carica venuta dalla rete e' anch'essa MISURATA, non stimata dal
  // solare avanzato: e' il minimo fra la carica non coperta dal surplus solare e
  // l'import di rete di quell'ora. Senza il tetto sull'import, ogni ora in cui
  // solare e consumo si equivalgono (contatori a un decimale, surplus apparente
  // zero) marchiava come "di rete" una carica arrivata dal sole, e il 5 agosto
  // faceva scendere la frazione solare a 0.88 con la rete a zero per tutto il
  // pomeriggio.
  //
  // La scomposizione si calcola SEMPRE sull'ora, anche in modalita' mese, e solo
  // dopo le ore si sommano nella barra del giorno. Calcolarla direttamente sul
  // bucket giornaliero azzerava la batteria: nella giornata il solare prodotto
  // supera quasi sempre il consumo di casa, quindi min(solare, casa) si mangiava
  // tutto il consumo e non restava niente da attribuire a batteria e rete. Col
  // 2 agosto 2026: casa 15.8 kWh, solare in sito 17.9, batteria scaricata 6.1 e
  // il grafico dava 100% solare. Sull'ora il conto tiene, perche' e' li' che
  // consumo e produzione sono davvero contemporanei: di notte il solare e' zero e
  // la scarica resta scarica.
  _balanceModel() {
    const c = this.config;
    const house = c.house ? this._balBuckets(c.house) : null;
    if (!house) return null;
    const sel = this._balSel || this._balSelection();
    const n = house.length; // ore del periodo
    const slots = sel.n; // barre del profilo: 24 ore oppure i giorni del mese
    const zero = () => new Array(n).fill(0);
    const solar = this._balBuckets(c.solar) || zero();
    const gexp = this._balBuckets(c.grid_export) || zero();
    const gimp = this._balBuckets(c.grid_import) || zero();
    const chg = this._balBuckets(c.battery_charge) || zero();
    const dis = this._balBuckets(c.battery_discharge) || zero();

    // ora -> barra, letta dalla data vera e non per divisione, cosi' il cambio
    // d'ora legale non sfasa il mese di un'ora.
    const slotOf = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(sel.from.getTime() + i * 3600000);
      slotOf.push(sel.kind === 'month' ? d.getDate() - 1 : d.getHours());
    }

    // solare rimasto in casa: prodotto meno quello immesso in rete
    const sun = zero();
    for (let i = 0; i < n; i++) {
      sun[i] = Math.min(Math.max(0, solar[i] - gexp[i]), house[i]);
    }

    // Frazione solare dell'energia in batteria, su finestra mobile di PRE ore: il
    // periodo mostrato piu' le PRE ore che lo precedono, cosi' la scarica delle
    // prime ore trova la carica che l'ha riempita.
    const PRE = this._balPreHours();
    const pad = (id, cur) => (this._balPreBuckets(id) || new Array(PRE).fill(0)).concat(cur);
    const solX = pad(c.solar, solar);
    const gexX = pad(c.grid_export, gexp);
    const houX = pad(c.house, house);
    const gimX = pad(c.grid_import, gimp);
    const chgX = pad(c.battery_charge, chg);
    const fromGrid = [];
    const pChg = [0];
    const pGrid = [0];
    for (let i = 0; i < chgX.length; i++) {
      const surplus = Math.max(0, Math.max(0, solX[i] - gexX[i]) - houX[i]);
      fromGrid.push(Math.min(Math.max(0, chgX[i] - surplus), Math.max(0, gimX[i])));
      pChg.push(pChg[i] + chgX[i]);
      pGrid.push(pGrid[i] + fromGrid[i]);
    }
    // Senza carica nella finestra la frazione non e' zero: e' ignota, e l'unica
    // risposta onesta e' non penalizzare la batteria. Zero era la vecchia risposta,
    // e significava "tutta rete".
    const greenAt = (i) => {
      const a = Math.max(0, i - PRE + 1);
      const tot = pChg[i + 1] - pChg[a];
      if (tot <= 0) return 1;
      return Math.max(0, Math.min(1, 1 - (pGrid[i + 1] - pGrid[a]) / tot));
    };

    const rows = new Array(slots).fill(null);
    const day = { house: 0, sun: 0, batt: 0, grid: 0, self: null };
    // Nel periodo in corso le ore successive a quella attuale restano vuote, non a
    // zero: un'ora non ancora trascorsa non e' un'ora a consumo nullo. Su un periodo
    // passato si percorre tutto.
    const upTo = sel.current ? Math.floor((new Date() - sel.from) / 3600000) : n - 1;
    // Ore senza dato e ore di accumulo. Un'ora priva di righe non e' un'ora a consumo
    // zero, e l'ora subito dopo un buco porta l'energia di tutto il buco: va guardata
    // con sospetto invece di dettare la scala del grafico. L'ora in corso non ha
    // ancora una riga compilata dal recorder: e' parziale, non assente.
    const hst = this._balStats && this._balStats[c.house];
    const nowIdx = sel.current ? upTo : -1;
    const voidH = [];
    for (let i = 0; i < n; i++) {
      voidH.push(hst && hst.seen ? !hst.seen[i] && i !== nowIdx : false);
    }
    for (let i = 0; i <= upTo && i < n; i++) {
      const rest = Math.max(0, house[i] - sun[i]);
      // la rete andata ALLA CASA: importata meno la parte finita in batteria
      let grid = Math.min(rest, Math.max(0, gimp[i] - fromGrid[PRE + i]));
      // mai piu' batteria di quanta ne e' davvero uscita: lo scarto fra contatori a
      // un decimale che non scattano nello stesso istante resta attribuito alla rete
      let batt = Math.min(rest - grid, dis[i]);
      grid = rest - batt;
      // la parte caricata dalla rete non e' autoprodotta: e' rete che fa un giro
      const dirty = batt * (1 - greenAt(PRE + i));
      batt -= dirty;
      grid += dirty;
      const k = slotOf[i];
      if (k < 0 || k >= slots) continue;
      if (!rows[k]) rows[k] = { h: k, house: 0, sun: 0, batt: 0, grid: 0, gap: true, susp: false };
      if (!voidH[i]) rows[k].gap = false;
      if (i > 0 && voidH[i - 1] && !voidH[i]) rows[k].susp = true;
      rows[k].house += house[i];
      rows[k].sun += sun[i];
      rows[k].batt += batt;
      rows[k].grid += grid;
      day.house += house[i];
      day.sun += sun[i];
      day.batt += batt;
      day.grid += grid;
    }
    if (day.house > 0) {
      day.self = Math.max(0, Math.min(100, ((day.sun + day.batt) / day.house) * 100));
    }
    return { rows: rows, day: day, n: slots, kind: sel.kind };
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
    // totale del periodo scelto di un contatore, per i quattro riquadri in fondo
    const dayTot = (id) => {
      const hrs = this._balBuckets(id);
      return hrs ? hrs.reduce((s, v) => s + v, 0) : null;
    };
    const pctTxt = selfSuff === null ? '--' : Math.round(selfSuff);
    const sel = this._balSel || this._balSelection();
    // L'arco da 84px e' stato tolto: diceva la somma di due numeri che stanno nella
    // legenda dieci pixel sotto, e occupava un quarto dell'altezza della card. Lo
    // spazio va al profilo orario. I numeri restano in colore di TESTO e non in
    // accento: il colore qui dentro serve ai tre segmenti.
    //
    // Con `power_entity` la card assorbe anche la vecchia "Consumo casa": in testa i
    // watt di adesso e il consumo del periodo col confronto, poi l'autosufficienza su
    // una riga sua. Senza `power_entity` la testata resta quella di prima, con la
    // percentuale come numero grande: le due configurazioni convivono.
    const power = this._pw(c.power_entity);
    // Il confronto ha senso solo sul giorno in corso: "vs ieri alla stessa ora" non
    // significa niente su un mese o su una giornata passata.
    const canCmp = sel.current && sel.kind === 'day' &&
      this._yesterday !== undefined && this._yesterday !== null && this._yesterday > 0 &&
      house !== null;
    let chip = '';
    if (canCmp) {
      const diff = house - this._yesterday;
      const up = diff > 0;
      chip = '<span class="epb-chip ' + (up ? 'epb-up' : 'epb-dn') + '" title="ieri alla stessa ora: ' +
        this._yesterday.toFixed(1) + ' kWh">' + (up ? '↑' : '↓') + ' ' +
        Math.abs(diff).toFixed(1) + ' kWh</span> vs ieri';
    }
    const periodLab = sel.kind === 'month' ? 'consumo del mese' : 'consumo ' + this._balLabel(sel);
    // Due celle etichettate divise da un filo, etichetta sopra e valore sotto: lo
    // stesso schema del resto della card. Prima il consumo del periodo stava a destra
    // in corpo piccolo e la pillola "vs ieri" gli prendeva il posto dell'etichetta,
    // quindi di quel numero non si leggeva piu' a cosa si riferisse.
    const cell = (entity, label, value, extra) =>
      '<div class="epb-cell" data-entity="' + (entity || '') + '">' +
      '<div class="epb-cl">' + label + '</div>' + value + (extra || '') + '</div>';
    const kwhCell = cell(c.house, periodLab,
      '<div class="epb-cv epb-cv-s">' + this._fmt(house, '', 1) +
      '<span class="epb-cu">kWh</span></div>',
      chip ? '<div class="epb-cc">' + chip + '</div>' : '');
    let hero;
    if (power !== null) {
      hero =
        '<div class="epb-duo">' +
        cell(c.power_entity, 'adesso',
          '<div class="epb-cv">' + this._fmt(power, '', power < 10 ? 1 : 0) +
          '<span class="epb-cu">W</span></div>') +
        kwhCell + '</div>' +
        this._balSelfArc(pctTxt, selfSuff);
    } else {
      // senza power_entity il posto dei watt lo prende la percentuale, come prima
      hero =
        '<div class="epb-duo">' +
        cell('', 'autosufficienza',
          '<div class="epb-cv">' + pctTxt + '<span class="epb-cu">%</span></div>') +
        kwhCell + '</div>';
    }

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

    // Tooltip del mix: nella legenda c'e' spazio solo per la percentuale, quindi le
    // quantita' in kWh non stanno da nessuna parte. Stessa ricetta del profilo orario
    // (.epb-tip/.epb-tt/.epb-tr): nessuna regola CSS nuova, cambia solo cosa lo apre.
    let mixTip = '';
    if (tot) {
      let tr = '';
      parts.forEach((p) => {
        tr += '<div class="epb-tr"><i class="epb-dot epb-c-' + p[2] + '"></i><span>' + p[0] +
          '</span><b>' + p[1].toFixed(2) + '</b><em>' + Math.round((p[1] / tot) * 100) +
          '%</em></div>';
      });
      mixTip = '<div class="epb-tip epb-tip-mx" hidden><div class="epb-tt">' + periodLab +
        '<b>' + tot.toFixed(2) + ' kWh</b></div>' + tr + '</div>';
    }

    const kpi = (icon, color, label, entity) =>
      '<div class="epb-k" style="--k:' + color + '" data-entity="' + (entity || '') + '">' + svg(icon, color) +
      '<div><div class="epb-kl">' + label + '</div><div class="epb-kv">' +
      this._fmt(dayTot(entity), '', 1) + '<span class="epb-u"> kWh</span></div></div></div>';

    mgddPaint(this, this._styles(),
      '<div class="epb-wrap' + (this._isDark() ? ' epb-dark' : '') + '">' +
      '<div class="epb-hd"><span class="epb-t">' + (c.title || 'Bilancio energetico') + '</span>' +
      (this._balPill() ? '<span class="epb-pill">' + this._balPill() + '</span>' : '') +
      this._balSeg() + '</div>' +
      this._balNav() +
      hero +
      '<div class="epb-mxw">' +
      '<div class="epb-mx">' + segs + '</div>' +
      '<div class="epb-leg">' + leg + '</div>' + mixTip +
      '</div>' +
      this._balanceHourly() +
      this._balMonthBar() +
      '<div class="epb-grid">' +
      kpi(ic.sun, 'var(--epb-sun)', 'Solare prodotto', c.solar) +
      kpi(ic.down, 'var(--epb-grid)', 'Prelevata rete', c.grid_import) +
      kpi(ic.up, 'var(--epb-grid)', 'Immessa in rete', c.grid_export) +
      kpi(ic.batt, 'var(--epb-bat)', 'Batteria scaricata', c.battery_discharge) +
      '</div>' +
      '</div>');
    this._wireClicks();
    this._wireBalanceTip();
    this._wireMixTip();
    this._wireBalanceNav();
  }

  // Tooltip del mix: lo apre tutta la barra e tutta la legenda, non il singolo
  // segmento. Nei giorni in cui una sorgente fa il 3% il suo segmento e' largo dieci
  // pixel — col dito non lo prendi — e per confrontare le tre quote dovresti passarle
  // una a una: un riquadro solo con tutte e tre le righe risolve entrambe le cose.
  _wireMixTip() {
    const wrap = this.querySelector('.epb-mxw');
    const tip = wrap ? wrap.querySelector('.epb-tip-mx') : null;
    if (!wrap || !tip) return;
    // Al primo tocco l'hover smette di esistere: iOS sintetizza mouseenter sul tap, e
    // senza questo interruttore riaprirebbe il tooltip appena il tap dopo l'ha chiuso.
    let touched = false;
    wrap.addEventListener('touchstart', () => {
      touched = true;
      tip.hidden = !tip.hidden;
    }, { passive: true });
    wrap.addEventListener('mouseenter', () => {
      if (!touched) tip.hidden = false;
    });
    wrap.addEventListener('mouseleave', () => {
      if (!touched) tip.hidden = true;
    });
  }

  // ===========================================================================
  // layout: prodcons - prodotto contro consumato, due barre per giorno.
  //
  // La card risponde a una domanda sola: quel giorno l'impianto ha fatto piu' o meno
  // di quello che la casa ha chiesto. La scomposizione per provenienza (solare,
  // batteria, rete) la fa già il layout balance, e non va rifatta qui.
  //
  // Provata anche come area del consumo divisa fra coperto e prelevato: senza
  // immissione in rete il prelievo sta a 0.3 kWh al giorno, le due curve si
  // sovrappongono e la banda non si vede. Le due quantita' separate, invece, variano
  // entrambe in ogni stagione.
  //
  // Testata, altezza del grafico, riga di oggi ed etichette sono quelle di
  // energy-monthly-card, perche' in dashboard la card sta nella stessa colonna delle
  // sue tre sorelle; le barre hanno la sfumatura delle loro aree.
  // Config: production, consumption, grid_import (solo per il tooltip), days (10), title.
  // ===========================================================================
  async _fetchProdCons() {
    const c = this.config;
    const ids = [c.production, c.consumption].filter(Boolean);
    if (ids.length < 2) return;
    if (c.grid_import) ids.push(c.grid_import);
    const days = Math.max(2, c.days || 10);
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    try {
      const resp = await this._hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: from.toISOString(),
        end_time: now.toISOString(),
        statistic_ids: ids,
        period: 'day',
        types: ['change'],
      });
      const pick = (id) => {
        const map = {};
        ((resp && resp[id]) || []).forEach((r) => {
          const d = new Date(r.start);
          const k = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
          const v = r.change;
          // un change negativo e' un azzeramento del contatore, non produzione
          // negativa: si scarta invece di disegnare una barra all'ingiu'
          if (v !== null && v !== undefined && v >= -0.05) map[k] = Math.max(0, v);
        });
        return map;
      };
      const P = pick(c.production);
      const C = pick(c.consumption);
      const G = c.grid_import ? pick(c.grid_import) : null;
      const out = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const k = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
        out.push({
          d: d,
          prod: P[k] === undefined ? null : P[k],
          cons: C[k] === undefined ? null : C[k],
          imp: !G || G[k] === undefined ? null : G[k],
          today: i === 0,
        });
      }
      this._pc = out;
    } catch (e) {
      if (!this._pc) this._pc = null; // senza recorder la card resta in caricamento
    }
  }

  _renderProdCons() {
    const c = this.config;
    const rows = this._pc;
    const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    let body;
    let sub = '';
    let big = '—';
    if (!rows) {
      body = '<div class="epp-load">Caricamento…</div>';
      this._pcHover = null;
    } else {
      const W = 300;
      const H = 122;
      const padX = 3;
      const padTop = 12;
      const n = rows.length;
      const slot = (W - 2 * padX) / n;
      const xMid = (i) => padX + slot * (i + 0.5);
      let tp = 0;
      let tc = 0;
      let vmax = 0;
      rows.forEach((r) => {
        if (r.prod !== null) {
          tp += r.prod;
          if (r.prod > vmax) vmax = r.prod;
        }
        if (r.cons !== null) {
          tc += r.cons;
          if (r.cons > vmax) vmax = r.cons;
        }
      });
      if (!vmax) vmax = 1;
      const yAt = (v) => H - (v / vmax) * (H - padTop);
      // Barra con gli angoli arrotondati solo in cima: un fondo arrotondato la
      // staccherebbe dalla linea di base. Un rect con rx li arrotonda tutti e quattro,
      // percio' serve un percorso.
      const bar = (x, w, v, fill, faded) => {
        const h = Math.max(1.5, H - yAt(v));
        const y = H - h;
        const r = Math.min(2.5, w / 2, h);
        const d = 'M' + x.toFixed(2) + ',' + H +
          ' L' + x.toFixed(2) + ',' + (y + r).toFixed(2) +
          ' Q' + x.toFixed(2) + ',' + y.toFixed(2) + ' ' + (x + r).toFixed(2) + ',' + y.toFixed(2) +
          ' L' + (x + w - r).toFixed(2) + ',' + y.toFixed(2) +
          ' Q' + (x + w).toFixed(2) + ',' + y.toFixed(2) + ' ' + (x + w).toFixed(2) + ',' + (y + r).toFixed(2) +
          ' L' + (x + w).toFixed(2) + ',' + H + ' Z';
        return '<path d="' + d + '" fill="' + fill + '"' +
          (faded ? ' fill-opacity=".55"' : '') + '/>';
      };
      const gp = 'eppp' + this._uid;
      const gc = 'eppc' + this._uid;
      const bw = slot * 0.34;
      const gap = slot * 0.08;
      let bars = '';
      rows.forEach((r, i) => {
        const cx = xMid(i);
        // giorno senza dato: niente barra. Una barra a zero affermerebbe un consumo nullo
        if (r.prod !== null && r.prod > 0) bars += bar(cx - bw - gap / 2, bw, r.prod, 'url(#' + gp + ')', r.today);
        if (r.cons !== null) bars += bar(cx + gap / 2, bw, r.cons, 'url(#' + gc + ')', r.today);
      });
      const nowX = xMid(n - 1).toFixed(2);
      // La sfumatura e' in objectBoundingBox, cioe' calcolata sull'altezza di OGNI
      // barra: con un gradiente unico per il riquadro le barre basse cadrebbero tutte
      // nella parte trasparente e sbiadirebbero.
      const stops = (color) =>
        '<stop offset="0" stop-color="' + color + '" stop-opacity="1"/>' +
        '<stop offset="1" stop-color="' + color + '" stop-opacity="0.28"/>';
      const svg =
        '<svg class="epp-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
        '<defs>' +
        '<linearGradient id="' + gp + '" x1="0" y1="0" x2="0" y2="1">' + stops('var(--epb-sun)') + '</linearGradient>' +
        '<linearGradient id="' + gc + '" x1="0" y1="0" x2="0" y2="1">' + stops('var(--epp-cons)') + '</linearGradient>' +
        '</defs>' +
        bars +
        '<line class="epp-nl" x1="' + nowX + '" y1="0" x2="' + nowX + '" y2="' + H + '"/>' +
        '<line class="epp-bl" x1="0" y1="' + H + '" x2="' + W + '" y2="' + H + '"/>' +
        '</svg>';
      const ax = rows.map((r) => '<span>' + (r.d.getDate() === 1 || r.today
        ? r.d.getDate() + ' ' + MESI[r.d.getMonth()] : r.d.getDate()) + '</span>').join('');
      big = this._fmtSigned(tp - tc) + ' kWh';
      sub = (c.days || 10) + ' giorni · ' + this._fmt(tp, '', 1) + ' prodotti, ' +
        this._fmt(tc, '', 1) + ' consumati';
      body =
        '<div class="epp-chart">' +
        '<div class="epp-hb"></div>' + svg +
        '<div class="epb-tip epp-tip" hidden></div>' +
        '</div><div class="epp-ax">' + ax + '</div>' +
        '<div class="epb-leg"><span class="epb-lg"><i class="epb-dot epp-sw-p"></i>produzione</span>' +
        '<span class="epb-lg"><i class="epb-dot epp-sw-c"></i>consumo</span></div>';
      this._pcHover = { rows: rows, n: n, slot: slot, padX: padX, W: W, H: H, mesi: MESI };
    }
    mgddPaint(this, this._styles(),
      '<div class="epb-wrap epp-wrap' + (this._isDark() ? ' epb-dark' : '') + '">' +
      '<div class="epp-top"><div class="epp-titles">' +
      '<span class="epp-title">' + (c.title || 'Produzione e consumo') + '</span>' +
      (sub ? '<span class="epp-sub">' + sub + '</span>' : '') +
      '</div><div class="epp-big">' + big + '</div></div>' +
      body + '</div>');
    this._wireProdConsTip();
  }

  // Tooltip: la fascia sul giorno puntato e il riquadro con la giornata in chiaro.
  //
  // Il riquadro sta ACCANTO alla fascia e non sopra: centrato sul giorno copriva
  // proprio le due barre che si stanno leggendo, e non si capiva piu' su che giorno
  // fosse il puntatore. Va a destra nella metà sinistra del grafico e a sinistra
  // nell'altra metà; quando da nessuna delle due parti c'e' spazio (card molto stretta
  // o molti giorni) scende sotto il grafico, dove copre l'asse e non le barre.
  _wireProdConsTip() {
    const h = this._pcHover;
    const chart = this.querySelector('.epp-chart');
    if (!h || !chart) return;
    const band = chart.querySelector('.epp-hb');
    const tip = chart.querySelector('.epp-tip');
    if (!band || !tip) return;
    // Senza <em>: nel tooltip del profilo orario quella colonna porta la percentuale e
    // vale i suoi 32px, qui sarebbe vuota — e 32px di larghezza in piu' sono la
    // differenza fra un riquadro che entra di fianco al giorno e uno che non entra.
    const row = (label, cls, val) =>
      '<div class="epb-tr"><i class="epb-dot epp-sw-' + cls + '"></i><span>' + label + '</span>' +
      '<b>' + this._fmt(val, '', 1) + '</b></div>';
    const show = (idx) => {
      const r = h.rows[idx];
      if (!r) return;
      const rectW = chart.clientWidth;
      const lab = r.d.getDate() + ' ' + h.mesi[r.d.getMonth()] + (r.today ? ' · in corso' : '');
      // la fascia copre lo spicchio del giorno, non una riga sola: con due barre per
      // giorno una riga verticale cadrebbe nel mezzo e non direbbe a quale appartiene
      band.style.left = (((h.padX + h.slot * idx) / h.W) * 100).toFixed(3) + '%';
      band.style.width = ((h.slot / h.W) * 100).toFixed(3) + '%';
      band.style.opacity = '1';
      const saldo = r.prod === null || r.cons === null ? null : r.prod - r.cons;
      tip.innerHTML =
        '<div class="epb-tt">' + lab +
        (saldo === null ? '<b>nessun dato</b>'
          : '<b style="color:' + (saldo >= 0 ? 'var(--epb-sun)' : 'var(--epp-cons)') + '">' +
            this._fmtSigned(saldo) + ' kWh</b>') + '</div>' +
        (r.prod === null ? '' : row('Produzione', 'p', r.prod)) +
        (r.cons === null ? '' : row('Consumo', 'c', r.cons)) +
        (r.imp === null ? '' : '<div class="epp-tf"><span>Dalla rete</span><b>' +
          this._fmt(r.imp, '', 1) + '</b></div>');
      tip.hidden = false;
      const tw = tip.offsetWidth;
      const mid = ((h.padX + h.slot * (idx + 0.5)) / h.W) * rectW;
      const half = ((h.slot / h.W) * rectW) / 2 + 8;
      const roomL = mid - half;
      const roomR = rectW - (mid + half);
      let left;
      let top = 4;
      if (Math.max(roomL, roomR) >= tw) {
        // Di fianco: dalla parte opposta a dove sta il giorno, cosi' la scelta e'
        // prevedibile mentre si scorre il grafico; se da quel lato non ci sta, dall'altro.
        const preferRight = mid < rectW / 2;
        const okPreferred = preferRight ? roomR >= tw : roomL >= tw;
        const goRight = okPreferred ? preferRight : !preferRight;
        left = goRight ? mid + half : mid - half - tw;
      } else {
        // Su una card strettissima un riquadro da 140px non entra di fianco a un giorno
        // centrale. Allora va SOTTO il grafico: li' copre l'asse dei giorni e la legenda,
        // non le due barre che si stanno leggendo. Il giorno resta scritto nel riquadro.
        left = Math.max(0, Math.min(rectW - tw, mid - tw / 2));
        top = h.H + 6;
      }
      tip.style.left = Math.max(0, Math.min(rectW - tw, left)) + 'px';
      tip.style.top = top + 'px';
    };
    const hide = () => {
      band.style.opacity = '0';
      tip.hidden = true;
    };
    // Larghezza zero: succede se un movimento del mouse arriva mentre la card sta
    // ancora prendendo posto nella sezione. Senza il controllo la divisione da NaN
    // e l'indice pesca un giorno che non esiste.
    //
    // L'indice viene dallo spicchio in cui cade il puntatore e non dal giorno piu'
    // vicino: le barre stanno al centro dello spicchio, e col secondo criterio il
    // primo e l'ultimo giorno avrebbero mezza zona sensibile in meno.
    const idxFromEvent = (e) => {
      const rect = chart.getBoundingClientRect();
      if (!rect.width) return -1;
      const rel = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      return Math.min(h.n - 1, Math.max(0, Math.floor(rel * h.n)));
    };
    chart.addEventListener('mousemove', (e) => show(idxFromEvent(e)));
    chart.addEventListener('mouseleave', hide);
    chart.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length) show(idxFromEvent(e.touches[0]));
    }, { passive: true });
    chart.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length) show(idxFromEvent(e.touches[0]));
    }, { passive: true });
    chart.addEventListener('touchend', hide, { passive: true });
    chart.addEventListener('touchcancel', hide, { passive: true });
  }

  // Il mese come barra e non come numero: "~443 kWh" da solo non dice quanto sei
  // avanti. Il pieno e' quello che hai consumato, il resto e' quello che la proiezione
  // aggiunge. La proiezione e' lineare, percio' il grigio significa letteralmente
  // "se il resto del mese va come questi primi giorni".
  //
  // Compare solo sul periodo in corso: navigando nello storico il mese corrente non
  // c'entra niente con quello che si sta guardando.
  _balMonthBar() {
    if (this.config.month === false || !this._mtd) return '';
    const sel = this._balSel || this._balSelection();
    if (!sel.current) return '';
    const cum = this._num(this.config.total_energy_entity || this.config.house);
    const live = cum !== null && isFinite(this._mtd.upTo) && cum > this._mtd.upTo
      ? cum - this._mtd.upTo : 0;
    const month = this._mtd.month + live;
    if (!(month > 0)) return '';
    const now = new Date();
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const frac = (now - mStart) / (mEnd - mStart);
    // sotto il 3% del mese la proiezione e' rumore moltiplicato per trenta
    const proj = frac > 0.03 ? Math.round(month / frac) : null;
    const AB = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    const ab = AB[now.getMonth()];
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const pct = proj ? Math.max(0, Math.min(100, (month / proj) * 100)) : 0;
    return (
      '<div class="epb-mo">' +
      '<div class="epb-mo-hd"><span>Mese</span><b>' + month.toFixed(0) + ' kWh finora</b></div>' +
      '<div class="epb-mo-t"><i style="width:' + pct.toFixed(1) + '%"></i>' +
      '<span class="epb-mo-m" style="left:' + pct.toFixed(1) + '%"></span></div>' +
      '<div class="epb-mo-f"><span>1 ' + ab + '</span>' +
      '<span class="epb-mo-p">' +
      (proj ? 'proiezione ~' + proj + ' kWh' : 'proiezione non ancora attendibile') +
      '</span><span>' + last + ' ' + ab + '</span></div>' +
      '</div>'
    );
  }

  // Etichetta del periodo scelto. `history: false` riporta la card al solo "oggi".
  _balLabel(sel) {
    const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const GG = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const d = sel.from;
    if (sel.kind === 'month') return MESI[d.getMonth()] + ' ' + d.getFullYear();
    if (sel.back === 0) return 'oggi';
    if (sel.back === 1) return 'ieri';
    return GG[d.getDay()] + ' ' + d.getDate() + ' ' + MESI[d.getMonth()];
  }

  // Autosufficienza come semicerchio compatto IN LINEA col numero (layout "E2"):
  // il gauge a sinistra, il numero e l'etichetta accanto. Il numero resta in colore
  // di TESTO; il verde e' "autoprodotto" (solare+batteria = cio' che non e' rete).
  _balSelfArc(pctTxt, pct) {
    const has = pct !== null && pct !== undefined && !isNaN(pct);
    return (
      '<div class="epb-selfw"><div class="epb-self-il">' +
      this._balSelfSemi(has ? pct : 0, has) +
      '<div class="epb-self-tx"><div class="epb-self-n">' + pctTxt +
      '<span class="epb-self-u">%</span></div>' +
      '<div class="epb-self-l">autosufficienza</div></div></div></div>'
    );
  }

  // Semicerchio del gauge. Path campionato punto per punto: non dipende dai flag di
  // sweep del comando A (sul semicerchio pieno danno spesso il verso sbagliato).
  // `filled` distingue il dato presente (traccia + valore) dal "--" (sola traccia).
  _balSelfSemi(pct, filled) {
    const W = 84, SW = 9, R = (W - SW) / 2, CX = W / 2, CY = R + SW / 2, H = CY + SW / 2;
    const p = (deg) => {
      const a = (deg * Math.PI) / 180;
      return [CX + R * Math.cos(a), CY - R * Math.sin(a)];
    };
    const path = (d0, d1) => {
      let d = '';
      const n = 44;
      for (let k = 0; k <= n; k++) {
        const q = p(d0 + (d1 - d0) * k / n);
        d += (k ? ' L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2);
      }
      return d;
    };
    const end = 180 - (180 * Math.max(0, Math.min(100, pct))) / 100;
    const val = filled
      ? '<path class="epb-self-v" d="' + path(180, end) + '" fill="none" stroke-width="' + SW + '" stroke-linecap="round"/>'
      : '';
    return (
      '<svg class="epb-self-g" viewBox="0 0 ' + W + ' ' + H.toFixed(1) + '" width="' + W + '" aria-hidden="true">' +
      '<path class="epb-self-t" d="' + path(180, 0) + '" fill="none" stroke-width="' + SW + '" stroke-linecap="round"/>' +
      val + '</svg>'
    );
  }

  // Nel navigatore la data va in cifre: la forma lunga ("domenica 2 agosto") e' gia'
  // scritta nel sottotitolo del consumo, poche righe sopra. In modalita' Mese resta il
  // nome del mese, perche' li' il sottotitolo dice solo "consumo del mese".
  _balNavLabel(sel) {
    if (sel.kind === 'month') return this._balLabel(sel);
    if (sel.back === 0) return 'oggi';
    const p2 = (v) => (v < 10 ? '0' + v : '' + v);
    return p2(sel.from.getDate()) + '/' + p2(sel.from.getMonth() + 1);
  }

  // Con il navigatore acceso la pillola diceva "oggi" tre pixel sopra un pulsante che
  // dice "Oggi": serviva a distinguere oggi da storico quando il navigatore non c'era.
  _balPill() {
    if (this.config.history === false) return this.config.period_label || 'oggi';
    return '';
  }

  // Selettore giorno/mese: sta sulla riga del titolo, dove lo spazio c'e' gia'. Prima
  // era in riga col navigatore e insieme occupavano una riga intera prima del contenuto.
  _balSeg() {
    if (this.config.history === false) return '';
    const sel = this._balSelection();
    const seg = (v, label) =>
      '<button data-balk="' + v + '" aria-pressed="' + (sel.kind === v) + '">' + label + '</button>';
    return '<div class="epb-sg">' + seg('day', 'Giorno') + seg('month', 'Mese') + '</div>';
  }

  // Navigatore: frecce e data. Nessuna striscia di salto come nel layout devices,
  // perche' qui ogni periodo e' una query a se': la striscia richiederebbe di
  // scaricare tutta la finestra per disegnare le altezze.
  _balNav() {
    if (this.config.history === false) return '';
    const sel = this._balSelection();
    // Sul periodo corrente l'etichetta resta un testo: non c'e' niente a cui tornare,
    // e un pulsante che non fa nulla e' peggio di nessun pulsante.
    const lab = this._balNavLabel(sel);
    const nl = sel.back > 0
      ? '<button class="epb-nl" data-balhome title="' +
        (sel.kind === 'month' ? 'Torna al mese corrente' : 'Torna a oggi') + '">' + lab + '</button>'
      : '<span class="epb-nl">' + lab + '</span>';
    return (
      '<div class="epb-nv">' +
      '<div class="epb-ar">' +
      '<button data-balstep="-1" title="Periodo precedente"' + (sel.back >= sel.max ? ' disabled' : '') + '>‹</button>' +
      nl +
      '<button data-balstep="1" title="Periodo successivo"' + (sel.back <= 0 ? ' disabled' : '') + '>›</button>' +
      '</div></div>'
    );
  }

  // La navigazione non passa dal throttle dei 5 minuti: il periodo nuovo va letto
  // subito, altrimenti le frecce sembrerebbero non funzionare.
  _wireBalanceNav() {
    const go = async () => {
      this._balStats = null;
      this._render();
      await this._fetchBalance();
      this._render();
    };
    this.querySelectorAll('[data-balk]').forEach((el) => {
      el.addEventListener('click', () => {
        this._balKind = el.getAttribute('data-balk');
        this._balBack = 0;
        go();
      });
    });
    const home = this.querySelector('[data-balhome]');
    if (home) {
      home.addEventListener('click', () => {
        this._balBack = 0;
        go();
      });
    }
    this.querySelectorAll('[data-balstep]').forEach((el) => {
      el.addEventListener('click', () => {
        const sel = this._balSelection();
        // ‹ va indietro nel tempo, cioe' aumenta l'arretramento
        const next = sel.back - parseInt(el.getAttribute('data-balstep'), 10);
        if (next < 0 || next > sel.max) return;
        this._balBack = next;
        go();
      });
    });
  }

  // Profilo orario: barre impilate con la stessa scomposizione della striscia.
  // Le ore non ancora trascorse restano vuote (non a zero). Riusa colori e legenda
  // gia' presenti sopra, quindi non introduce ne' tinte ne' legende aggiuntive.
  _balanceHourly() {
    if (this.config.hourly === false) return '';
    const rows = this._hourly;
    if (!rows || !rows.length) return '';
    const sel = this._balSel || this._balSelection();
    const n = sel.n;
    const monthly = sel.kind === 'month';
    // La scala viene dalle barre ATTENDIBILI: con dato, non vuote e non di accumulo.
    // Prima la dettava il massimo assoluto, e una sola ora di recupero dopo un buco
    // schiacciava tutte le altre: il 4/8/2026 l'ora 04 valeva 1.30 kWh contro un
    // massimo vero di 0.50, e le undici ore reali stavano sotto il 40% dell'altezza.
    let scale = 0;
    let anyMax = 0;
    rows.forEach((r) => {
      if (!r || r.gap) return;
      if (r.house > anyMax) anyMax = r.house;
      if (!r.susp && r.house > scale) scale = r.house;
    });
    // se ogni barra e' sospetta non resta che il massimo assoluto
    if (!(scale > 0)) scale = anyMax;
    if (!(scale > 0)) return '';
    const pad = (v) => (v < 10 ? '0' + v : '' + v);
    let clipped = 0;
    let bars = '';
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      const lab = monthly ? 'giorno ' + (i + 1) : pad(i) + ':00 – ' + pad(i + 1) + ':00';
      if (!r) {
        // periodo in corso: ore non ancora trascorse, filo sulla linea di base
        bars += '<div class="epb-hb"><span class="epb-fut"></span></div>';
        continue;
      }
      if (r.gap) {
        bars += '<div class="epb-hb" title="' + lab + ' — nessun dato">' +
          '<span class="epb-gap"></span></div>';
        continue;
      }
      const over = r.susp && r.house > scale;
      if (over) clipped += 1;
      const shown = over ? scale : r.house;
      // Segmenti visibili, con le quote NORMALIZZATE a somma 1. Prima erano i kWh
      // grezzi passati a flex-grow: su ogni barra sotto 1 kWh la somma dei flex-grow
      // stava sotto 1, e il flexbox riempie solo quella frazione dello spazio
      // lasciando il resto della barra al grigio del contenitore. Una barra da
      // 0.5 kWh si disegnava mezza vuota, e la frazione grigia non significava nulla.
      const segs = [[r.grid, 'grid'], [r.batt, 'bat'], [r.sun, 'sun']]
        .filter((p) => p[0] > scale / 250);
      const segTot = segs.reduce((s, p) => s + p[0], 0);
      let inner = '';
      if (segTot > 0) {
        segs.forEach((p) => {
          inner += '<i class="epb-c-' + p[1] + '" style="flex:' + (p[0] / segTot).toFixed(4) + '"></i>';
        });
      }
      const hh = Math.max(1.5, (shown / scale) * 100);
      // Sotto gli ~8px lo stacco fra i segmenti vale piu' della barra stessa:
      // su un'ora da poche decine di Wh i 2px di gap si mangerebbero metà colonna.
      const tight = hh < 7;
      // i valori restano sull'elemento: il tooltip li legge senza rigenerare l'HTML
      bars +=
        '<div class="epb-hb" data-h="' + r.h + '" data-lab="' + lab + '" data-tot="' + r.house.toFixed(3) + '"' +
        ' data-sun="' + r.sun.toFixed(3) + '" data-bat="' + r.batt.toFixed(3) + '" data-grid="' + r.grid.toFixed(3) + '">' +
        (over ? '<b class="epb-fl">!</b>' : '') +
        '<div class="epb-hb-in' + (tight ? ' epb-tight' : '') + (over ? ' epb-clip' : '') +
        '" style="height:' + hh.toFixed(1) + '%">' + inner + '</div></div>';
    }
    const ax = monthly
      ? [1, 5, 10, 15, 20, 25, n].map((d) => '<span>' + d + '</span>').join('')
      : ['00', '06', '12', '18', '23'].map((h) => '<span>' + h + '</span>').join('');
    const unit = monthly ? ' kWh/g' : ' kWh/h';
    const w1 = monthly ? 'giorno' : 'ora';
    const wN = monthly ? 'giorni' : 'ore';
    const head = clipped
      ? 'scala ' + scale.toFixed(2) + unit + ' · ' + clipped + ' ' +
        (clipped === 1 ? w1 + (monthly ? ' tagliato' : ' tagliata') : wN + (monthly ? ' tagliati' : ' tagliate'))
      : 'max ' + scale.toFixed(2) + unit;
    // Nessuna nota sotto il grafico: il trattino e il retino col "!" si vedono, e
    // l'intestazione a destra dice già che la scala e' ridotta e quante barre sono
    // tagliate. Il valore vero della barra tagliata resta nel tooltip.
    return (
      '<div class="epb-hr">' +
      '<div class="epb-hr-hd"><span>' + (monthly ? 'Profilo giornaliero' : 'Profilo orario') + '</span>' +
      '<b>' + head + '</b></div>' +
      '<div class="epb-hr-wrap">' +
      '<div class="epb-hr-y"><span>' + scale.toFixed(2) + '</span><span>0</span></div>' +
      '<div class="epb-hr-plot">' + bars + '<div class="epb-tip" hidden></div></div>' +
      '</div>' +
      '<div class="epb-hr-axw"><div class="epb-hr-ax">' + ax + '</div></div>' +
      '</div>'
    );
  }

  // Tooltip del profilo orario: ora, consumo e scomposizione per sorgente.
  // Sostituisce il title nativo, che mostrava solo il totale.
  _wireBalanceTip() {
    const plot = this.querySelector('.epb-hr-plot');
    // Cercato DENTRO il grafico: da quando esiste anche il tooltip del mix, che nel
    // DOM viene prima, un querySelector sulla card intera pescava quello sbagliato e
    // il profilo orario si disegnava sotto la barra delle sorgenti.
    const tip = plot ? plot.querySelector('.epb-tip') : null;
    if (!plot || !tip) return;
    const row = (label, cls, val, tot) =>
      '<div class="epb-tr"><i class="epb-dot epb-c-' + cls + '"></i><span>' + label + '</span>' +
      '<b>' + val.toFixed(2) + '</b><em>' + (tot ? Math.round((val / tot) * 100) : 0) + '%</em></div>';
    const show = (bar) => {
      const tot = parseFloat(bar.getAttribute('data-tot'));
      const sun = parseFloat(bar.getAttribute('data-sun'));
      const bat = parseFloat(bar.getAttribute('data-bat'));
      const grid = parseFloat(bar.getAttribute('data-grid'));
      const lab = bar.getAttribute('data-lab') || '';
      tip.innerHTML =
        '<div class="epb-tt">' + lab +
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

  // ===========================================================================
  // layout: devices - totali per dispositivo, con navigazione fra giorni e mesi.
  //
  // La fonte sono le statistiche a lungo termine (period day/month) dei contatori
  // kWh: la history grezza dura ~10 giorni e non risponde su base mensile. Ogni
  // circuito porta `energy` (sensore kWh cumulativo); `house_energy` e' il
  // contatore di tutta la casa e serve solo a ricavare la quota e il residuo non
  // attribuito. Config: title, circuits[{name,energy}], house_energy, days (15),
  // months (9), mode (plain|compare), top (6 righe sempre visibili, il resto sotto
  // l'espansore), strip (false: la barretta dei periodi e' opt-in).
  // ===========================================================================
  _dp2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  _dkey(ts, period) {
    const d = new Date(ts);
    const m = this._dp2(d.getMonth() + 1);
    return period === 'month'
      ? d.getFullYear() + '-' + m
      : d.getFullYear() + '-' + m + '-' + this._dp2(d.getDate());
  }

  // L'asse dei periodi si genera qui, non dalla risposta: un buco nelle statistiche
  // deve restare visibile come buco invece di far scomparire la colonna.
  _daxis(period) {
    const n = period === 'month' ? this.config.months || 9 : this.config.days || 15;
    const now = new Date();
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d =
        period === 'month'
          ? new Date(now.getFullYear(), now.getMonth() - i, 1)
          : new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      out.push(this._dkey(d.getTime(), period));
    }
    return out;
  }

  _dlist() {
    return (this.config.circuits || []).filter((c) => c.energy);
  }

  async _fetchDeviceStats() {
    const c = this.config;
    const list = this._dlist();
    if (!list.length) return;
    const ids = list.map((d) => d.energy);
    if (c.house_energy) ids.push(c.house_energy);
    const now = new Date();
    const days = c.days || 15;
    const months = c.months || 9;
    const spans = [
      ['day', new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))],
      ['month', new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)],
    ];
    const out = {};
    for (let i = 0; i < spans.length; i++) {
      const period = spans[i][0];
      let resp = null;
      try {
        resp = await this._hass.callWS({
          type: 'recorder/statistics_during_period',
          start_time: spans[i][1].toISOString(),
          end_time: now.toISOString(),
          statistic_ids: ids,
          period: period,
          types: ['change'],
        });
      } catch (e) {
        resp = null; // senza recorder la card lo dice, non inventa numeri
      }
      out[period] = resp ? this._dbuckets(resp, ids, period) : null;
    }
    this._dstats = out;
  }

  // Per ogni sensore: chiave periodo -> kWh. Nessuna riga significa "sensore non
  // ancora esistente", che e' diverso da zero. Un calo del contatore e' un
  // azzeramento, non un consumo negativo: si marca invalido invece di appiattirlo
  // a zero, perche' un totale sbagliato e' peggio di un totale mancante.
  _dbuckets(resp, ids, period) {
    const map = {};
    ids.forEach((id) => {
      const rows = (resp && resp[id]) || null;
      if (!rows || !rows.length) {
        map[id] = null;
        return;
      }
      const b = {};
      rows.forEach((r) => {
        const v = r.change;
        if (v === null || v === undefined) return;
        const k = this._dkey(r.start, period);
        if (v < -0.05) b[k] = { bad: 'contatore azzerato' };
        else b[k] = { v: Math.max(0, v) };
      });
      map[id] = b;
    });
    return map;
  }

  _dcell(id, period, key) {
    const st = this._dstats && this._dstats[period];
    if (!st) return {};
    const b = st[id];
    if (!b) return { absent: true };
    const cell = b[key];
    if (!cell) return { absent: true };
    if (cell.bad) return { bad: cell.bad };
    return { v: cell.v };
  }

  _dsnap() {
    const period = this._dkind || 'day';
    const axis = this._daxis(period);
    let idx = this._didx;
    if (idx === null || idx === undefined || idx > axis.length - 1 || idx < 0) idx = axis.length - 1;
    const key = axis[idx];
    const pkey = idx > 0 ? axis[idx - 1] : null;
    const list = this._dlist().map((dev) => {
      const c = this._dcell(dev.energy, period, key);
      const p = pkey ? this._dcell(dev.energy, period, pkey) : {};
      return {
        name: dev.name || dev.energy,
        dev: dev,
        v: c.v === undefined ? null : c.v,
        bad: c.bad,
        prev: p.v === undefined ? null : p.v,
      };
    });
    list.sort((a, b) => {
      if (a.v === null && b.v === null) return 0;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      return b.v - a.v;
    });
    const meas = list.reduce((s, r) => s + (r.v || 0), 0);
    const prevMeas = pkey ? list.reduce((s, r) => s + (r.prev || 0), 0) : null;
    let house = null;
    if (this.config.house_energy) {
      const hc = this._dcell(this.config.house_energy, period, key);
      if (hc.v !== undefined && hc.v !== null) house = hc.v;
    }
    return {
      period: period,
      axis: axis,
      idx: idx,
      list: list,
      meas: meas,
      prevMeas: prevMeas,
      house: house,
      other: house !== null ? Math.max(0, house - meas) : null,
      partial: idx === axis.length - 1,
    };
  }

  _dnum(v) {
    return (v < 10 ? v.toFixed(2) : v.toFixed(1)).replace('.', ',');
  }

  _dfmt(v) {
    if (v === null || v === undefined) return '—';
    if (v === 0) return '0';
    if (v < 0.1) return Math.round(v * 1000) + ' Wh';
    return this._dnum(v) + ' kWh';
  }

  _dlabel(period, key) {
    const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const GG = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const p = key.split('-');
    if (period === 'month') return MESI[+p[1] - 1] + ' ' + p[0];
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    return GG[d.getDay()] + ' ' + +p[2] + ' ' + MESI[+p[1] - 1];
  }

  _dshort(period, key) {
    const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    const p = key.split('-');
    return period === 'month' ? MESI[+p[1] - 1] : String(+p[2]);
  }

  _ddeltaChip(cur, prev) {
    if (cur === null || prev === null || prev === undefined) return '<span class="epd-d epd-na">n.d.</span>';
    const d = cur - prev;
    if (Math.abs(d) < 0.005) return '<span class="epd-d epd-na">=</span>';
    return '<span class="epd-d ' + (d > 0 ? 'epd-up' : 'epd-dn') + '">' + (d > 0 ? '▲' : '▼') + ' ' + this._dfmt(Math.abs(d)) + '</span>';
  }

  _ddeltaCell(cur, prev) {
    if (cur === null || prev === null || prev === undefined) return '<div class="epd-dd epd-na">n.d.</div>';
    const d = cur - prev;
    if (Math.abs(d) < 0.005) return '<div class="epd-dd epd-na">=</div>';
    const a = Math.abs(d);
    const t = a < 0.1 ? a.toFixed(3).replace('.', ',') : this._dnum(a);
    return '<div class="epd-dd ' + (d > 0 ? 'epd-up' : 'epd-dn') + '" title="' + (d > 0 ? '+' : '−') + this._dfmt(a) + '">' + (d > 0 ? '+' : '−') + t + '</div>';
  }

  _dstripHtml(sn) {
    const tots = sn.axis.map((k) => {
      if (this.config.house_energy) {
        const h = this._dcell(this.config.house_energy, sn.period, k);
        if (h.v !== undefined && h.v !== null) return h.v;
      }
      return this._dlist().reduce((s, dev) => {
        const c = this._dcell(dev.energy, sn.period, k);
        return s + (c.v || 0);
      }, 0);
    });
    let mx = Math.max.apply(null, tots);
    if (!mx) mx = 1;
    return (
      '<div class="epd-strip">' +
      sn.axis
        .map((k, i) => {
          const h = Math.max(3, Math.round((tots[i] / mx) * 22));
          return (
            '<button class="epd-sb" data-epd-i="' + i + '" aria-pressed="' + (i === sn.idx) + '" ' +
            'title="' + this._dlabel(sn.period, k) + ' · ' + this._dfmt(tots[i]) + '">' +
            '<i style="height:' + h + 'px"></i><u>' + this._dshort(sn.period, k) + '</u></button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  // Le cifre di sintesi stanno sulla riga della navigazione: la data la dice gia' il
  // navigatore, quindi il vecchio blocco "Misurato - <data>" ripeteva l'etichetta
  // spendendo due righe di card.
  _dheadStats(sn) {
    const quota =
      sn.house !== null
        ? 'su ' + this._dnum(sn.house) + ' kWh di casa · ' + Math.round((sn.meas / sn.house) * 100) + '% attribuito'
        : 'totale casa non disponibile';
    return (
      '<div class="epd-st">' +
      '<span class="epd-v">' + this._dnum(sn.meas) + '<small>kWh</small></span>' +
      '<span title="vs ' + (sn.period === 'day' ? 'giorno' : 'mese') + ' precedente">' +
      this._ddeltaChip(sn.meas, sn.prevMeas) + '</span>' +
      '<span class="epd-k">' + quota + (sn.partial ? ' · in corso' : '') + '</span>' +
      '</div>'
    );
  }

  _dbodyHtml(sn) {
    const mode = this._dmode || this.config.mode || 'plain';
    const cls = mode === 'compare' ? 'epd-b' : 'epd-a';
    const active = sn.list.filter((r) => r.v !== null && r.v > 0);
    const zeros = sn.list.filter((r) => r.v === 0);
    const absent = sn.list.filter((r) => r.v === null);
    // La coda dei dispositivi trascurabili resta chiusa: sono le righe che facevano
    // crescere la card senza dire niente. La scala resta quella del primo circuito,
    // quindi aprire l'elenco non ridisegna le barre gia' lette.
    const top = this.config.top === undefined ? 6 : Math.max(1, this.config.top);
    const open = !!this._dopen;
    const tail = active.slice(top);
    const shown = open ? active : active.slice(0, top);
    const nHidden = tail.length + zeros.length + absent.length;
    const tailSum = tail.reduce((s, r) => s + (r.v || 0), 0);
    let mx = active.length ? active[0].v : 0;
    if (sn.other !== null && sn.other > mx) mx = sn.other;
    // In confronto le due barre della riga devono stare sulla STESSA scala, altrimenti
    // il confronto non significa niente. Senza includere il periodo precedente nel
    // massimo, un giorno prima piu' pesante di quello scelto disegnava la barra
    // fantasma oltre il bordo della card, coprendo valore e differenza.
    if (mode === 'compare') {
      sn.list.forEach((r) => {
        if (r.prev !== null && r.prev > mx) mx = r.prev;
      });
    }
    if (!mx) mx = 1;
    const w = (v) => Math.min(100, Math.max(0.4, (v / mx) * 100)).toFixed(2);

    let h = '<div class="epd-rows">';
    shown.forEach((r) => {
      h +=
        '<div class="epd-r ' + cls + '"><div class="epd-n" title="' + r.name + '">' + r.name + '</div>' +
        '<div class="epd-tr">' +
        (mode === 'compare' && r.prev !== null ? '<span class="epd-g" style="width:' + w(r.prev) + '%"></span>' : '') +
        '<span class="epd-bar" style="width:' + w(r.v) + '%"></span></div>' +
        '<div class="epd-val">' + this._dfmt(r.v) + '</div>' +
        (mode === 'compare'
          ? this._ddeltaCell(r.v, r.prev)
          : '<div class="epd-pc">' + (sn.house !== null ? Math.round((r.v / sn.house) * 100) + '%' : '—') + '</div>') +
        '</div>';
    });
    if (sn.other !== null && sn.other > 0) {
      h +=
        '<div class="epd-r ' + cls + '"><div class="epd-n">Non misurato</div>' +
        '<div class="epd-tr"><span class="epd-bar epd-oth" style="width:' + w(sn.other) + '%"></span></div>' +
        '<div class="epd-val">' + this._dfmt(sn.other) + '</div>' +
        (mode === 'plain'
          ? '<div class="epd-pc">' + Math.round((sn.other / sn.house) * 100) + '%</div>'
          : '<div class="epd-dd epd-na">—</div>') +
        '</div>';
    }
    if (open && zeros.length) {
      h +=
        '<div class="epd-r epd-off ' + cls + '"><div class="epd-n">' + zeros.length +
        (zeros.length === 1 ? ' dispositivo a zero' : ' dispositivi a zero') + '</div>' +
        '<div class="epd-tr"><span class="epd-z"></span></div><div class="epd-val">0</div><div></div></div>';
    }
    if (open && absent.length) {
      h +=
        '<div class="epd-r epd-off ' + cls + '"><div class="epd-n">' + absent.length + ' senza dato</div>' +
        '<div class="epd-tr"><span class="epd-z"></span></div><div class="epd-val">—</div><div></div></div>';
    }
    if (nHidden) {
      h +=
        '<button class="epd-more" data-epd-more="1" aria-expanded="' + open + '">' +
        '<span>' + (open ? '▾ nascondi i minori' : '▸ altri ' + nHidden + (nHidden === 1 ? ' dispositivo' : ' dispositivi')) + '</span>' +
        (open || tailSum <= 0 ? '<span></span>' : '<b>' + this._dfmt(tailSum) + '</b>') +
        '</button>';
    }
    h += '</div>';

    h += '<div class="epd-foot">';
    if (mode === 'compare') {
      h +=
        '<span><span class="epd-sw" style="background:var(--epd-weak)"></span>' +
        (sn.period === 'day' ? 'giorno' : 'mese') + ' precedente</span>' +
        '<span>Colonna a destra: <b>differenza in kWh</b></span>';
    }
    if (sn.other !== null) h += '<span><span class="epd-sw" style="background:#9A9993"></span>non attribuito a nessun sensore</span>';
    if (zeros.length) h += '<span>A zero: <b>' + zeros.map((r) => r.name).join(', ') + '</b></span>';
    h += '</div>';

    const bads = sn.list.filter((r) => r.bad);
    if (bads.length || absent.length) {
      h += '<div class="epd-warn">';
      if (bads.length) h += '<b>Dato scartato:</b> ' + bads.map((r) => r.name + ' (' + r.bad + ')').join(', ') + '. ';
      if (absent.length) h += '<b>Sensore assente in questo periodo:</b> ' + absent.map((r) => r.name).join(', ') + '.';
      h += '</div>';
    }
    return h;
  }

  _renderDevices() {
    const period = this._dkind || 'day';
    const mode = this._dmode || this.config.mode || 'plain';
    const axis = this._daxis(period);
    let idx = this._didx;
    if (idx === null || idx === undefined || idx > axis.length - 1 || idx < 0) idx = axis.length - 1;
    const seg = (attr, opts) =>
      '<div class="epd-seg">' +
      opts.map((o) => '<button data-epd-' + attr + '="' + o[0] + '" aria-pressed="' + o[2] + '">' + o[1] + '</button>').join('') +
      '</div>';

    const ready = !!(this._dstats && this._dstats[period] && this._dlist().length);
    const sn = ready ? this._dsnap() : null;

    let head =
      '<div class="epd-top">' +
      '<div class="epd-t">' + (this.config.title || 'Totali per dispositivo') + '</div>' +
      seg('mode', [
        ['plain', 'Quota', mode === 'plain'],
        ['compare', 'Confronto', mode === 'compare'],
      ]) +
      '</div>' +
      '<div class="epd-nvbar">' +
      seg('k', [
        ['day', 'Giorno', period === 'day'],
        ['month', 'Mese', period === 'month'],
      ]) +
      '<div class="epd-nav">' +
      '<button data-epd-step="-1" title="Precedente"' + (idx <= 0 ? ' disabled' : '') + '>‹</button>' +
      '<span class="epd-lbl">' + this._dlabel(period, axis[idx]) + '</span>' +
      '<button data-epd-step="1" title="Successivo"' + (idx >= axis.length - 1 ? ' disabled' : '') + '>›</button>' +
      '</div>' +
      (sn ? this._dheadStats(sn) : '') +
      '</div>' +
      // La barretta dei periodi costa ~50px di altezza: resta disponibile con
      // `strip: true` per chi la usa per saltare al giorno, ma non e' piu' il default.
      (sn && this.config.strip ? this._dstripHtml(sn) : '');

    let body;
    if (!this._dstats) body = '<div class="epd-load">Caricamento statistiche…</div>';
    else if (!this._dstats[period]) body = '<div class="epd-load">Statistiche non disponibili: il recorder non ha risposto.</div>';
    else if (!this._dlist().length) body = '<div class="epd-load">Nessun circuito con la chiave <code>energy</code> in configurazione.</div>';
    else body = this._dbodyHtml(sn);

    mgddPaint(this, this._styles(), '<div class="epd-wrap' + (this._isDark() ? ' epd-dark' : '') + '"><div class="epd-card">' + head + body + '</div></div>');
    this._wireDevices();
  }

  _wireDevices() {
    const rerender = () => this._render();
    this.querySelectorAll('[data-epd-k]').forEach((el) => {
      el.addEventListener('click', () => {
        this._dkind = el.getAttribute('data-epd-k');
        this._didx = null; // cambiando scala si torna al periodo in corso
        rerender();
      });
    });
    this.querySelectorAll('[data-epd-mode]').forEach((el) => {
      el.addEventListener('click', () => {
        this._dmode = el.getAttribute('data-epd-mode');
        rerender();
      });
    });
    this.querySelectorAll('[data-epd-more]').forEach((el) => {
      el.addEventListener('click', () => {
        this._dopen = !this._dopen;
        rerender();
      });
    });
    this.querySelectorAll('[data-epd-i]').forEach((el) => {
      el.addEventListener('click', () => {
        this._didx = parseInt(el.getAttribute('data-epd-i'), 10);
        rerender();
      });
    });
    this.querySelectorAll('[data-epd-step]').forEach((el) => {
      el.addEventListener('click', () => {
        const n = this._daxis(this._dkind || 'day').length;
        const cur = this._didx === null || this._didx === undefined ? n - 1 : this._didx;
        const next = Math.min(n - 1, Math.max(0, cur + parseInt(el.getAttribute('data-epd-step'), 10)));
        if (next !== cur) {
          this._didx = next;
          rerender();
        }
      });
    });
  }

  _styles() {
    return (
      '<style>' +
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
      '--epb-track:rgba(127,127,127,.18);--epb-hatch:rgba(15,23,42,.22);' +
      '--epb-trtrack:rgba(15,23,42,.16);' +
      'background:var(--ha-card-background,var(--card-background-color,#fff));' +
      'border:1px solid var(--epb-bd);border-radius:20px;padding:17px 17px 18px;color:var(--epb-tx);}' +
      // Passi scuri SCELTI, non schiariti: i precedenti (#F5B301 #22E39A #38BDF8)
      // stavano a luminosita' OKLCH 0.81/0.81/0.75 contro la banda ammessa 0.48-0.67.
      // Questi tengono le stesse tinte (scarto <=4 gradi) e passano i controlli:
      // dE CVD adiacente 9.5-10.7 (soglia 8), visione normale 20.2 (soglia 15),
      // contrasto 5.3-5.9:1 sul fondo scuro.
      '.epb-wrap.epb-dark{--epb-sun:#D27B00;--epb-bat:#00AE6F;--epb-grid:#0099E4;--epb-good:#8B7BFF;' +
      '--epb-fill:rgba(255,255,255,.055);--epb-track:rgba(255,255,255,.12);' +
      '--epb-hatch:rgba(255,255,255,.26);--epb-trtrack:rgba(255,255,255,.22);}' +
      '.epb-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}' +
      '.epb-t{font-size:11px;font-weight:700;letter-spacing:.85px;text-transform:uppercase;color:var(--epb-tx2);}' +
      '.epb-pill{font-size:10.5px;font-weight:600;letter-spacing:.4px;color:var(--epb-tx2);background:var(--epb-fill);padding:3px 9px;border-radius:20px;}' +
      '.epb-ic{flex:0 0 auto;display:block;}' +
      // Due celle divise da un filo. `align-items:stretch` e' quello che fa arrivare il
      // filo fino in fondo alla cella piu' alta, quella con la pillola del confronto.
      '.epb-duo{display:flex;align-items:stretch;gap:18px;margin-top:18px;}' +
      '.epb-cell{flex:1;min-width:0;}' +
      '.epb-cell+.epb-cell{border-left:1px solid var(--epb-bd);padding-left:18px;}' +
      '.epb-cell[data-entity]:not([data-entity=""]){cursor:pointer;}' +
      '.epb-cl{font-size:9.5px;letter-spacing:.7px;text-transform:uppercase;' +
      'color:var(--epb-tx2);font-weight:600;}' +
      '.epb-cv{font-size:42px;font-weight:670;letter-spacing:-2.1px;line-height:.95;' +
      'margin-top:8px;font-variant-numeric:tabular-nums;}' +
      '.epb-cv-s{font-size:34px;letter-spacing:-1.6px;}' +
      '.epb-cu{font-size:17px;font-weight:600;letter-spacing:0;color:var(--epb-tx2);margin-left:3px;}' +
      '.epb-cc{margin-top:10px;font-size:9.5px;letter-spacing:.7px;text-transform:uppercase;' +
      'color:var(--epb-tx2);display:flex;align-items:center;gap:6px;flex-wrap:wrap;}' +
      // confronto con ieri alla stessa ora: verde se hai consumato meno, ambra se piu'.
      // Non sono colori di stato buono/cattivo, sono direzione: per questo la freccia
      // c'e' sempre e il colore non e' l'unico segnale.
      '.epb-chip{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:650;' +
      'padding:2px 7px;border-radius:20px;background:var(--epb-fill);letter-spacing:.2px;' +
      'text-transform:none;font-variant-numeric:tabular-nums;}' +
      '.epb-up{color:#B4571A;}' +
      '.epb-dn{color:#0B8F5E;}' +
      '.epb-dark .epb-up{color:#F5B301;}' +
      '.epb-dark .epb-dn{color:#22E39A;}' +
      // autosufficienza: semicerchio compatto in linea col numero (layout E2), quando i
      // watt prendono il posto del numero grande. Il gauge a sinistra, numero+etichetta a
      // destra; la traccia usa --epb-trtrack (piu' marcata di --epb-track su fondo scuro).
      '.epb-selfw{margin:22px 0 12px;padding-top:14px;border-top:1px solid var(--epb-bd);}' +
      '.epb-self-il{display:flex;align-items:center;gap:16px;}' +
      '.epb-self-g{display:block;flex:0 0 auto;overflow:visible;}' +
      '.epb-self-t{stroke:var(--epb-trtrack);}' +
      '.epb-self-v{stroke:var(--epb-bat);}' +
      '.epb-self-tx{min-width:0;}' +
      '.epb-self-n{font-size:32px;font-weight:670;letter-spacing:-1.3px;line-height:1;' +
      'font-variant-numeric:tabular-nums;}' +
      '.epb-self-u{font-size:15px;font-weight:600;color:var(--epb-tx2);margin-left:2px;letter-spacing:0;}' +
      '.epb-self-l{font-size:9.5px;letter-spacing:.7px;text-transform:uppercase;color:var(--epb-tx2);' +
      'font-weight:600;margin-top:6px;}' +
      // mese: barra con dentro il consumato e la tacca di dove sei oggi
      '.epb-mo{margin-top:16px;padding-top:14px;border-top:1px solid var(--epb-bd);}' +
      '.epb-mo-hd{display:flex;justify-content:space-between;align-items:baseline;gap:10px;' +
      'font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--epb-tx2);margin-bottom:8px;}' +
      '.epb-mo-hd b{font-size:13px;letter-spacing:0;text-transform:none;font-weight:650;' +
      'color:var(--epb-tx);font-variant-numeric:tabular-nums;}' +
      '.epb-mo-t{position:relative;height:11px;border-radius:6px;background:var(--epb-track);}' +
      '.epb-mo-t i{display:block;height:100%;border-radius:6px;background:var(--epb-grid);}' +
      '.epb-mo-m{position:absolute;top:-3px;width:2px;height:17px;background:var(--epb-tx2);' +
      'border-radius:1px;opacity:.55;}' +
      '.epb-mo-f{display:flex;justify-content:space-between;align-items:baseline;gap:10px;' +
      'font-size:9.5px;color:var(--epb-tx2);margin-top:7px;letter-spacing:.3px;}' +
      '.epb-mo-p{color:var(--epb-tx2);font-weight:650;text-transform:uppercase;letter-spacing:.5px;opacity:.9;}' +
      // layout prodcons: arancio = produzione e viola = consumo casa. La coppia e'
      // molto piu' solida della terna a tre: dE 33.8 in daltonismo contro 10.2,
      // tritanopia 28.1 contro 3.3. Nel tema scuro il viola e' #8B7BFF perche'
      // #A99BFF stava fuori dalla banda di luminosita' ammessa.
      '.epb-wrap{--epp-cons:#6D5AE6;}' +
      '.epb-dark{--epp-cons:#8B7BFF;}' +
      //
      // Testata, altezza del grafico ed etichette sono quelle di energy-monthly-card:
      // in dashboard questa card sta nella stessa colonna delle sue tre sorelle, e una
      // testata diversa in mezzo alla sequenza si legge come un errore.
      '.epp-wrap{border-radius:18px;padding:18px;}' +
      '.epp-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;}' +
      '.epp-titles{display:flex;flex-direction:column;gap:2px;min-width:0;}' +
      '.epp-title{font-size:13px;font-weight:600;color:var(--epb-tx2);}' +
      '.epp-sub{font-size:11px;color:var(--epb-tx2);}' +
      '.epp-big{font-size:26px;font-weight:600;letter-spacing:-.5px;color:var(--epb-tx);' +
      'white-space:nowrap;font-variant-numeric:tabular-nums;}' +
      '.epp-chart{width:100%;position:relative;}' +
      // z-index: la fascia del giorno e' un div che sta PRIMA dell'svg nel DOM, e senza
      // impilamento esplicito coprirebbe le barre invece di stargli dietro.
      '.epp-svg{display:block;width:100%;height:122px;position:relative;z-index:1;}' +
      '.epp-nl{stroke:var(--epb-tx2);stroke-width:1;stroke-dasharray:3 3;opacity:.4;vector-effect:non-scaling-stroke;}' +
      '.epp-bl{stroke:var(--epb-bd);stroke-width:1;vector-effect:non-scaling-stroke;}' +
      '.epp-hb{position:absolute;top:0;height:122px;background:var(--epb-fill);border-radius:4px;' +
      'opacity:0;pointer-events:none;transition:opacity .08s;}' +
      // Selettore doppio e non solo `.epp-tip`: la regola base `.epb-tip` ancora il
      // riquadro sopra il contenitore con `bottom`, e sta piu' in basso nel foglio.
      // A pari specificita' vincerebbe lei e il tooltip finirebbe sopra la card.
      // Nessuna traslazione: la posizione la calcola il codice, che lo mette di fianco
      // al giorno puntato invece che sopra. E min-width azzerato: il riquadro deve
      // stringersi sul contenuto, altrimenti su una card stretta non entra mai di fianco
      // e finisce sempre sotto il grafico.
      '.epb-tip.epp-tip{bottom:auto;transform:none;z-index:6;min-width:0;white-space:nowrap;}' +
      '.epp-tf{display:flex;align-items:baseline;justify-content:space-between;gap:10px;' +
      'font-size:11.5px;color:var(--epb-tx2);margin-top:5px;padding-top:5px;' +
      'border-top:1px solid var(--epb-bd);}' +
      '.epp-tf b{font-weight:650;color:var(--epb-tx);font-variant-numeric:tabular-nums;}' +
      '.epp-ax{display:flex;margin-top:6px;}' +
      '.epp-ax span{flex:1;font-size:10px;color:var(--epb-tx2);text-align:center;' +
      'white-space:nowrap;font-variant-numeric:tabular-nums;}' +
      '.epp-sw-p{background:var(--epb-sun);}' +
      '.epp-sw-c{background:var(--epp-cons);}' +
      '.epp-load{font-size:12px;color:var(--epb-tx2);padding:34px 0;text-align:center;}' +
      // 2px di superficie fra i segmenti: separa senza aggiungere un colore di bordo.
      // Il contenitore serve solo ad ancorare il tooltip: vedi .epb-tip-mx sopra.
      '.epb-mxw{position:relative;}' +
      '.epb-mx{display:flex;height:11px;border-radius:6px;overflow:hidden;gap:2px;background:var(--epb-track);}' +
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
      // 116px invece di 46: e' lo spazio liberato dall'arco. Con la scala sui dati
      // veri, un'ora da 0.2 kWh passa da 7 a 46px, cioe' da indistinguibile a leggibile.
      '.epb-hr-wrap{display:flex;gap:7px;}' +
      '.epb-hr-y{width:26px;flex:none;display:flex;flex-direction:column;justify-content:space-between;' +
      'font-size:9px;color:var(--epb-tx2);opacity:.75;text-align:right;font-variant-numeric:tabular-nums;}' +
      '.epb-hr-plot{position:relative;display:flex;align-items:flex-end;gap:2px;height:116px;flex:1;' +
      'min-width:0;border-bottom:1px solid var(--epb-bd);}' +
      '.epb-hr-axw{margin-left:33px;}' +
      '.epb-hb{flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center;min-width:0;position:relative;}' +
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
      // Tooltip del mix, ancorato SOTTO la barra: sopra coprirebbe i watt e
      // l'autosufficienza, sotto copre la legenda, cioe' proprio il dato che sta
      // ripetendo con piu' dettaglio. Deve stare DOPO .epb-tip: `bottom:auto` serve a
      // annullare l'ancoraggio in alto della regola base, e con top e bottom insieme un
      // assoluto ad altezza automatica viene stirato fra i due (fondino accorciato e
      // testo fuori). L'offset e' fisso rispetto alla barra e non al fondo del
      // contenitore, cosi' non si sposta quando la legenda va a due righe.
      '.epb-tip-mx{top:19px;bottom:auto;left:0;}' +
      '.epb-tt{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:11px;' +
      'color:var(--epb-tx2);padding-bottom:6px;margin-bottom:5px;border-bottom:1px solid var(--epb-bd);}' +
      '.epb-tt b{font-size:12.5px;font-weight:650;color:var(--epb-tx);font-variant-numeric:tabular-nums;}' +
      '.epb-tr{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--epb-tx2);padding:1.5px 0;}' +
      '.epb-tr span{flex:1;}' +
      '.epb-tr b{font-weight:650;color:var(--epb-tx);font-variant-numeric:tabular-nums;}' +
      '.epb-tr em{font-style:normal;width:32px;text-align:right;opacity:.75;font-variant-numeric:tabular-nums;}' +
      // Nessun fondino: le quote sono normalizzate a somma 1, quindi i segmenti
      // riempiono sempre la barra. Il `gap` sottrae spazio prima della distribuzione,
      // percio' i 2px fra i segmenti mostrano la superficie della card e non
      // sfondano l'altezza. Angoli arrotondati solo in cima: la barra e' ancorata
      // alla linea di base, e un fondo arrotondato la staccherebbe da quella linea.
      '.epb-hb-in{width:100%;display:flex;flex-direction:column-reverse;gap:2px;' +
      'border-radius:4px 4px 0 0;overflow:hidden;position:relative;z-index:2;}' +
      '.epb-hb-in i{display:block;width:100%;}' +
      // ora fuori scala: retino sopra il colore, cosi' resta leggibile di che
      // sorgente e' fatta ma si vede che il valore e' troncato
      '.epb-tight{gap:0;}' +
      '.epb-clip{border-radius:0;}' +
      '.epb-clip::after{content:"";position:absolute;inset:0;' +
      'background:repeating-linear-gradient(135deg,transparent 0 3px,var(--epb-hatch) 3px 4.5px);}' +
      '.epb-fl{position:absolute;top:-13px;left:50%;transform:translateX(-50%);font-size:9px;' +
      'font-weight:700;color:var(--epb-tx2);z-index:3;}' +
      // filo sulla linea di base per le ore non ancora trascorse, trattino piu'
      // marcato per quelle senza dato: due assenze diverse, due segni diversi
      '.epb-fut{width:100%;height:1px;background:var(--epb-bd);}' +
      '.epb-gap{width:62%;height:1px;background:var(--epb-hatch);}' +
      '.epb-hr-ax{display:flex;justify-content:space-between;font-size:9.5px;color:var(--epb-tx2);margin-top:6px;opacity:.8;font-variant-numeric:tabular-nums;}' +
      '.epb-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--epb-bd);border-radius:13px;overflow:hidden;margin-top:14px;}' +
      '.epb-k{display:flex;align-items:center;gap:9px;padding:11px 12px;cursor:pointer;' +
      'background:var(--ha-card-background,var(--card-background-color,#fff));transition:background .12s;}' +
      '.epb-k:hover{background:color-mix(in srgb,var(--k,#888) 8%,var(--ha-card-background,var(--card-background-color,#fff)));}' +
      '.epb-kl{font-size:11px;color:var(--epb-tx2);line-height:1.2;}' +
      '.epb-kv{font-size:16px;font-weight:650;letter-spacing:-.3px;margin-top:3px;font-variant-numeric:tabular-nums;}' +
      '.epb-u{font-size:11px;font-weight:500;color:var(--epb-tx2);}' +
      // navigatore del periodo: stesso linguaggio del layout devices. Da quando il
      // selettore giorno/mese e' sulla riga del titolo qui resta solo il gruppo delle
      // frecce, allineato a sinistra.
      '.epb-nv{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 4px;}' +
      '.epb-sg,.epb-ar{display:flex;gap:2px;padding:3px;border-radius:11px;' +
      'border:1px solid var(--divider-color,rgba(0,0,0,.10));}' +
      '.epb-sg button,.epb-ar button{font:inherit;font-size:12px;font-weight:600;' +
      'color:var(--epb-tx2);background:none;border:0;padding:5px 10px;border-radius:8px;cursor:pointer;}' +
      '.epb-ar button{font-size:15px;line-height:1;padding:4px 10px;}' +
      '.epb-sg button[aria-pressed="true"]{background:color-mix(in srgb,var(--epb-tx) 10%,transparent);' +
      'color:var(--epb-tx);}' +
      '.epb-ar button:disabled{opacity:.35;cursor:default;}' +
      '.epb-ar button:hover:not(:disabled),.epb-sg button:hover{color:var(--epb-tx);}' +
      // piu' specifico di `.epb-ar button`, altrimenti l'etichetta-pulsante
      // prenderebbe il corpo 15px delle frecce
      '.epb-ar .epb-nl{min-width:112px;text-align:center;font-size:12.5px;font-weight:700;' +
      'padding:0 6px;text-transform:capitalize;color:var(--epb-tx);' +
      'font-variant-numeric:tabular-nums;}' +
      '.epb-ar button.epb-nl{background:none;border:0;line-height:1.35;cursor:pointer;' +
      'text-decoration:underline;text-decoration-color:transparent;text-underline-offset:3px;}' +
      '.epb-ar button.epb-nl:hover{text-decoration-color:var(--epb-tx2);}' +
      // Sotto i 360px le due celle non ci stanno affiancate (i watt a 42px chiedono
      // 115px da soli): il filo verticale diventa orizzontale e si impilano.
      '@media (max-width:359px){.epb-grid{grid-template-columns:1fr;}' +
      '.epb-ar .epb-nl{min-width:88px;}' +
      '.epb-duo{display:block;}' +
      '.epb-cell+.epb-cell{border-left:0;padding-left:0;margin-top:16px;padding-top:14px;' +
      'border-top:1px solid var(--epb-bd);}}' +
      // layout devices: un solo colore per tutte le barre. Il nome del dispositivo e'
      // gia' sulla riga, quindi tinte diverse per riga brucerebbero l'unico canale
      // libero; il colore torna a significare qualcosa (viola = consumo casa, grigio =
      // non attribuito, verde/rosso = solo la differenza).
      '.epd-wrap{--epd-acc:#6D5AE6;--epd-weak:#EDEBFB;--epd-up:#C0392B;--epd-dn:#0F8A4D;' +
      '--epd-tx:var(--primary-text-color,#1c1c1e);--epd-tx2:var(--secondary-text-color,#6b6f76);' +
      '--epd-bd:var(--divider-color,rgba(0,0,0,.10));' +
      // separatore interno fra le righe: con righe dense il divider pieno diventa
      // una griglia, quindi le righe usano una versione smorzata dello stesso colore
      '--epd-bd2:color-mix(in srgb,var(--epd-bd) 55%,transparent);}' +
      '.epd-wrap.epd-dark{--epd-acc:#A99BFF;--epd-weak:#2A2740;--epd-up:#F07167;--epd-dn:#3BD98A;}' +
      '.epd-card{background:var(--ha-card-background,var(--card-background-color,#fff));' +
      'border:1px solid var(--epd-bd);border-radius:18px;padding:13px 16px;}' +
      '.epd-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}' +
      '.epd-t{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--epd-tx2);}' +
      '.epd-nvbar{display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap;margin:10px 0 9px;}' +
      '.epd-seg,.epd-nav{display:flex;gap:2px;padding:3px;border-radius:11px;border:1px solid var(--epd-bd);}' +
      '.epd-seg button,.epd-nav button{font:inherit;font-size:12px;font-weight:600;color:var(--epd-tx2);' +
      'background:none;border:0;padding:5px 10px;border-radius:8px;cursor:pointer;}' +
      '.epd-nav button{font-size:15px;line-height:1;padding:4px 10px;}' +
      '.epd-seg button[aria-pressed="true"]{background:color-mix(in srgb,var(--epd-tx) 10%,transparent);color:var(--epd-tx);}' +
      '.epd-nav button:disabled{opacity:.35;cursor:default;}' +
      '.epd-lbl{min-width:168px;text-align:center;font-size:12.5px;font-weight:700;padding:0 6px;' +
      'text-transform:capitalize;color:var(--epd-tx);}' +
      '.epd-strip{display:flex;gap:3px;align-items:flex-end;height:40px;margin:0 0 10px;padding:5px 7px;' +
      'border-radius:11px;border:1px solid var(--epd-bd);}' +
      '.epd-sb{flex:1 1 0;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;' +
      'align-items:center;gap:2px;background:none;border:0;padding:0;height:100%;cursor:pointer;}' +
      '.epd-sb i{display:block;width:100%;border-radius:3px 3px 0 0;background:var(--epd-weak);}' +
      '.epd-sb[aria-pressed="true"] i{background:var(--epd-acc);}' +
      '.epd-sb u{font-size:8.5px;text-decoration:none;color:var(--epd-tx2);font-variant-numeric:tabular-nums;}' +
      '.epd-sb[aria-pressed="true"] u{color:var(--epd-tx);font-weight:700;}' +
      '.epd-st{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;}' +
      '.epd-k{font-size:11.5px;color:var(--epd-tx2);}' +
      '.epd-v{font-size:21px;font-weight:700;letter-spacing:-.4px;color:var(--epd-tx);' +
      'font-variant-numeric:tabular-nums;}' +
      '.epd-v small{font-size:11.5px;font-weight:600;color:var(--epd-tx2);margin-left:2px;}' +
      '.epd-d{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;' +
      'padding:3px 9px;border-radius:999px;border:1px solid var(--epd-bd);white-space:nowrap;}' +
      '.epd-up{color:var(--epd-up);} .epd-dn{color:var(--epd-dn);} .epd-na{color:var(--epd-tx2);}' +
      '.epd-rows{display:flex;flex-direction:column;}' +
      '.epd-r{display:grid;align-items:center;gap:10px;padding:3px 0;border-top:1px solid var(--epd-bd2);}' +
      '.epd-r:first-child{border-top:0;}' +
      '.epd-a{grid-template-columns:150px 1fr 76px 36px;}' +
      '.epd-b{grid-template-columns:150px 1fr 76px 64px;}' +
      '.epd-n{font-size:12px;color:var(--epd-tx2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      // overflow nascosto: nessuna barra puo' uscire dalla propria cella, qualunque
      // scala venga calcolata sopra
      '.epd-tr{position:relative;height:9px;overflow:hidden;}' +
      '.epd-tr span{position:absolute;left:0;top:0;height:100%;border-radius:0 4px 4px 0;}' +
      '.epd-g{background:var(--epd-weak);}' +
      '.epd-bar{background:var(--epd-acc);}' +
      '.epd-bar.epd-oth{background:#9A9993;}' +
      '.epd-z{width:2px;background:var(--epd-bd);border-radius:0;}' +
      '.epd-val{font-size:12px;font-weight:600;text-align:right;color:var(--epd-tx);' +
      'font-variant-numeric:tabular-nums;}' +
      '.epd-pc{font-size:10.5px;text-align:right;color:var(--epd-tx2);font-variant-numeric:tabular-nums;}' +
      '.epd-dd{font-size:11px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;}' +
      '.epd-off .epd-n,.epd-off .epd-val{color:var(--epd-tx2);}' +
      '.epd-more{font:inherit;font-size:11.5px;color:var(--epd-tx2);background:none;border:0;' +
      'border-top:1px solid var(--epd-bd2);width:100%;display:flex;justify-content:space-between;' +
      'gap:10px;align-items:center;padding:6px 0 2px;cursor:pointer;text-align:left;}' +
      '.epd-more b{color:var(--epd-tx);font-weight:600;font-variant-numeric:tabular-nums;}' +
      '.epd-more:hover{color:var(--epd-tx);}' +
      '.epd-foot{margin-top:10px;padding-top:9px;border-top:1px solid var(--epd-bd);display:flex;' +
      'flex-wrap:wrap;gap:5px 16px;font-size:11.5px;color:var(--epd-tx2);}' +
      '.epd-foot b{color:var(--epd-tx);}' +
      '.epd-sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;' +
      'vertical-align:-1px;}' +
      '.epd-warn{font-size:11.5px;margin-top:9px;padding:8px 10px;border-radius:10px;color:var(--epd-tx2);' +
      'background:rgba(192,57,43,.09);border:1px solid rgba(192,57,43,.26);}' +
      '.epd-warn b{color:var(--epd-tx);}' +
      '.epd-load{font-size:12.5px;color:var(--epd-tx2);padding:26px 0;text-align:center;}' +
      '@media (max-width:560px){.epd-a,.epd-b{grid-template-columns:104px 1fr 72px;}' +
      '.epd-a .epd-pc,.epd-b .epd-dd{display:none;}' +
      '.epd-lbl{min-width:118px;font-size:12px;}.epd-sb u{display:none;}' +
      '.epd-st{gap:7px;}.epd-v{font-size:19px;}}' +
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
    // Niente riga della media dentro il grafico: attraversava le barre senza aggiungere
    // una lettura che il numero in testata non dia già. La media resta scritta là.
    const labels = data.map((d, i) => '<span>' + (labelFn(d, i) || '') + '</span>').join('');
    return '<div class="bars">' + bars + '</div><div class="xlabels">' + labels + '</div>';
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
      { isCurrent: isSameDay }
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
      { isCurrent: isSameMonth }
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
    const p = config && config.period;
    const period = p === 'day' || p === 'hour' ? p : 'month';
    // `period: hour` + `metric: mean` serve alle MISURE (la carica della batteria),
    // non ai contatori: legge la media oraria invece della differenza, non completa
    // il periodo col delta di un cumulativo, e usa una scala fissa 0-100.
    // `hours` e' l'ampiezza della finestra mobile che finisce sull'ora in corso.
    const defaults =
      period === 'hour'
        ? { entity: 'sensor.powerwall3_charge', period: 'hour', metric: 'mean', hours: 24, y_max: 100, decimals: 0, title: 'Batteria', color: '#0FB57E' }
        : period === 'day'
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

  // Ampiezza della finestra oraria. Minimo 3 ore: con due punti la spline non
  // disegna un andamento. Massimo 168 (una settimana): oltre, i punti sono meno
  // larghi di un pixel e il grafico diventa una macchia.
  _hourSpan() {
    const h = parseInt(this.config.hours, 10);
    return Math.max(3, Math.min(168, isFinite(h) && h > 0 ? h : 24));
  }

  // Inizio della finestra: l'ora in corso arretrata di `hours - 1`. Ricalcolato a
  // ogni disegno, cosi' l'asse resta ancorato ad adesso anche fra due fetch.
  _hourStart(now) {
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    return d.getTime() - (this._hourSpan() - 1) * 3600 * 1000;
  }

  // Etichetta di un'ora per il tooltip: l'ora secca se e' oggi, con il giorno
  // davanti altrimenti, perche' in una finestra mobile "07:00" da solo e' ambiguo.
  _hourLabel(ts, now) {
    const GG = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
    const d = new Date(ts);
    const hh = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':00';
    const same = (a, b) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, now)) return hh;
    const ieri = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (same(d, ieri)) return 'ieri ' + hh;
    return GG[d.getDay()] + ' ' + hh;
  }

  async _maybeFetch() {
    const now = Date.now();
    if (this._fetchedAt && now - this._fetchedAt < 10 * 60 * 1000) return;
    this._fetchedAt = now;
    const period = this.config.period === 'day' || this.config.period === 'hour'
      ? this.config.period : 'month';
    const isMean = this.config.metric === 'mean';
    let start;
    if (period === 'hour') {
      // Finestra mobile che finisce sull'ora in corso: ancorare l'asse alla
      // mezzanotte lasciava vuota tutta la parte destra del grafico, che non e'
      // dato mancante ma il futuro.
      start = new Date(this._hourStart(now));
    } else if (period === 'day') {
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
        // contatore a fine ultima ora compilata (vedi _render). Per una misura
        // non esiste un contatore da completare: serve solo la media.
        types: isMean ? ['mean'] : ['change', 'state'],
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
    const fmt = (v) => v.toFixed(cfg.decimals !== undefined ? cfg.decimals : (v >= 100 ? 0 : 1));
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
      const isHour = cfg.period === 'hour';
      const isMean = cfg.metric === 'mean';
      const pad2 = (v) => (v < 10 ? '0' + v : '' + v);
      // Slot 0 = l'ora piu' vecchia della finestra, ultimo slot = l'ora in corso.
      const hourSpan = isHour ? this._hourSpan() : 0;
      const hourStart = isHour ? this._hourStart(now.getTime()) : 0;
      const hourAt = (i) => hourStart + i * 3600 * 1000;
      const curIdx = isHour ? hourSpan - 1 : data.findIndex(isCurrent);
      // Il periodo in corso si fermerebbe all'ultima ora compilata dal recorder
      // (le statistiche a lungo termine sono orarie): lo completiamo col delta
      // fra il valore live del contatore e quello di fine ultima ora, che la
      // statistica riporta in `state`. Cosi' il periodo in corso coincide con
      // il contatore giornaliero invece di restare fino a un'ora indietro.
      let live = 0;
      if (!isMean && !isHour && curIdx >= 0 && data[curIdx] && cfg.live_current !== false && st) {
        const cum = parseFloat(st.state);
        const upTo = parseFloat(data[curIdx].state);
        if (isFinite(cum) && isFinite(upTo) && cum > upTo) live = cum - upTo;
      }
      // Le ore mancanti restano `null`, non zero: la linea si interrompe invece di
      // attraversare un'ora che nessuno ha misurato. Nelle altre modalita' non ci
      // sono null e il disegno e' identico a prima.
      let vals;
      let labelsFull;
      let count;
      if (isHour) {
        count = hourSpan;
        vals = new Array(count).fill(null);
        data.forEach((d) => {
          // posizione = distanza in ore dall'inizio della finestra, non l'ora del
          // giorno: la finestra attraversa la mezzanotte
          const i = Math.round((new Date(d.start).getTime() - hourStart) / (3600 * 1000));
          const v = isMean ? d.mean : d.change;
          if (i >= 0 && i < count && v !== null && v !== undefined) vals[i] = v;
        });
        // per una misura il valore vivo E' il valore dell'ora in corso
        if (isMean && st) {
          const now2 = parseFloat(st.state);
          if (isFinite(now2)) vals[count - 1] = now2;
        }
        labelsFull = vals.map((v, i) => this._hourLabel(hourAt(i), now));
      } else {
        count = n;
        vals = data.map((d, i) => Math.max(0, (d.change || 0) + (i === curIdx ? live : 0)));
        labelsFull = data.map(fullLabel);
      }
      const seen = vals.filter((v) => v !== null);
      const vmax = cfg.y_max || Math.max.apply(null, seen.length ? seen : [1]) || 1;
      if (isMean) {
        // il grande e' il valore di adesso, il sottotitolo il minimo della giornata
        const lastV = curIdx >= 0 && vals[curIdx] !== null
          ? vals[curIdx] : (seen.length ? seen[seen.length - 1] : null);
        bigVal = lastV === null ? '--' : fmt(lastV) + ' ' + uom;
        if (seen.length) {
          const mn = Math.min.apply(null, seen);
          const mi = vals.indexOf(mn);
          // l'indice non e' piu' l'ora: va riconvertito in orologio
          const quando = isHour ? this._hourLabel(hourAt(mi), now).replace(':00', '') : pad2(mi);
          bigCap = (isHour ? 'ultime ' + count + ' h · ' : '') + 'minimo ' + fmt(mn) + ' ' + uom + ' alle ' + quando;
        } else {
          bigCap = '';
        }
      } else {
        const showIdx = curIdx >= 0 ? curIdx : count - 1;
        bigVal = fmt(vals[showIdx]) + ' ' + uom;
        bigCap = curIdx >= 0 ? (isDay ? 'oggi' : 'mese in corso') : labelsFull[showIdx];
      }

      if (seen.length < 2) {
        body = '<div class="emc-loading">Servono almeno 2 ' +
          (isHour ? 'ore' : isDay ? 'giorni' : 'mesi') + ' di storico</div>';
      } else {
        const W = 300,
          H = 120,
          padX = 3,
          padTop = 12;
        const xAt = (i) => padX + (i * (W - 2 * padX)) / (count - 1);
        const yAt = (v) => H - (v / vmax) * (H - padTop);
        // Niente riga della media: tagliava l'area in orizzontale con la sua etichetta
        // addosso alla curva, e con quattro grafici in colonna erano quattro righe
        // tratteggiate che non dicevano niente in piu' del disegno. La chiave
        // `show_average` non e' piu' letta.
        // un tratto per ogni sequenza contigua di valori: senza null e' un tratto
        // solo, quindi il disegno di giornaliero e mensile non cambia
        const segs = [];
        let cur = [];
        vals.forEach((v, i) => {
          if (v === null) {
            if (cur.length) segs.push(cur);
            cur = [];
          } else {
            cur.push(i);
          }
        });
        if (cur.length) segs.push(cur);
        const gid = 'emcgrad' + this._uid;
        let paths = '';
        let lines = '';
        segs.forEach((seg) => {
          if (seg.length < 2) return;
          const p = seg.map((i) => ({ x: xAt(i), y: yAt(vals[i]) }));
          const lp = this._smoothPath(p);
          paths += '<path d="' + lp + ' L' + p[p.length - 1].x.toFixed(2) + ',' + H +
            ' L' + p[0].x.toFixed(2) + ',' + H + ' Z" fill="url(#' + gid + ')" stroke="none"/>';
          lines += '<path class="emc-line" d="' + lp + '" fill="none" stroke="' + cfg.color + '"/>';
        });
        // Nella finestra mobile l'ora in corso E' il bordo destro: la tratteggiata
        // ci finirebbe sopra, leggendosi come una cornice invece che come "adesso".
        const nowLine =
          !isHour && curIdx >= 0 && curIdx < count
            ? '<line class="emc-now" x1="' + xAt(curIdx).toFixed(2) + '" y1="0" x2="' + xAt(curIdx).toFixed(2) + '" y2="' + H + '"/>'
            : '';
        const svg =
          '<svg class="emc-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
          '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + cfg.color + '" stop-opacity="0.35"/>' +
          '<stop offset="1" stop-color="' + cfg.color + '" stop-opacity="0"/>' +
          '</linearGradient></defs>' +
          paths + nowLine + lines +
          '</svg>';
        // etichette asse X: mensile tutte; giornaliero diradate; orario ogni 6 ore
        let labels = '';
        if (isHour) {
          // Sull'orologio, non sull'indice: lo slot 0 non e' piu' mezzanotte. L'ultima
          // etichetta e' sempre l'ora in corso; le multiple di 6 troppo vicine al bordo
          // vengono saltate, altrimenti i due numeri si toccano.
          const step = count > 72 ? 12 : 6;
          for (let i = 0; i < count; i++) {
            const hh = new Date(hourAt(i)).getHours();
            const last = i === count - 1;
            const tick = hh % step === 0 && i < count - 1 - step / 3;
            labels += '<span>' + (last || tick ? pad2(hh) : '') + '</span>';
          }
        } else {
          const step = isDay ? (n > 10 ? Math.ceil(n / 7) : 1) : 1;
          labels = data
            .map((d, i) => {
              const dt = new Date(d.start);
              let txt = '';
              if (i % step === 0) txt = isDay ? String(dt.getDate()) : monthLabels[dt.getMonth()];
              return '<span>' + txt + '</span>';
            })
            .join('');
        }
        body =
          '<div class="emc-chart">' +
          svg +
          '<div class="emc-hline"></div><div class="emc-hdot"></div><div class="emc-tip"></div>' +
          '</div><div class="emc-xlabels">' + labels + '</div>';
        // dati per l'hover
        this._hover = { n: count, vals: vals, vmax: vmax, uom: uom, H: H, padTop: padTop, labels: labelsFull, color: cfg.color, dec: cfg.decimals };
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
    const fmt = (v) => v.toFixed(h.dec !== undefined ? h.dec : (v >= 100 ? 0 : 1));
    const show = (idx, rectW) => {
      const leftPct = h.n === 1 ? 50 : (idx / (h.n - 1)) * 100;
      const v = h.vals[idx];
      hline.style.left = leftPct + '%';
      hline.style.opacity = '1';
      tip.style.left = leftPct + '%';
      tip.style.opacity = '1';
      // ora senza dato: la riga verticale e il riquadro restano, il punto no —
      // un pallino sulla linea affermerebbe un valore che non esiste
      if (v === null || v === undefined) {
        hdot.style.opacity = '0';
        tip.textContent = h.labels[idx] + ' · nessun dato';
        tip.style.top = '0px';
        return;
      }
      const dotY = h.H - (v / h.vmax) * (h.H - h.padTop); // px (svg alto 120px)
      hdot.style.left = leftPct + '%';
      hdot.style.top = dotY + 'px';
      hdot.style.opacity = '1';
      tip.textContent = h.labels[idx] + ' · ' + fmt(v) + ' ' + h.uom;
      tip.style.top = Math.max(0, dotY - 10) + 'px';
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
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
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

// ===== energy-summary-card.js =====
// Riassunto del flusso energia in una riga sola: Solare, Casa, Rete, Batteria.
// Stessi sensori e stessa palette della energy-flow-card, ma su una riga di
// griglia: serve in cima alla vista Home, dove il flusso animato costerebbe
// troppa altezza.
//
// Rete e Batteria non mostrano il segno del sensore: il verso passa
// nell'etichetta (Prelievo/Immissione, Carica/Scarica), che si legge senza
// dover ricordare quale segno significhi cosa. Sotto soglia l'etichetta torna
// neutra ("Rete", "Batteria"), cosi' il fondo scala non racconta un verso che
// non c'e'.
class EnergySummaryCard extends HTMLElement {
  setConfig(config) {
    this.config = Object.assign({ threshold: 5, battery_min_flow: 120 }, config || {});
    this._lastSig = null;
  }

  static getStubConfig() {
    return {
      solar_power: 'sensor.powerwall3_solar_power',
      house_power: 'sensor.powerwall3_load_power',
      grid_power: 'sensor.powerwall3_site_power',
      battery_power: 'sensor.powerwall3_battery_power',
      battery_soc: 'sensor.powerwall3_charge',
    };
  }

  set hass(hass) {
    this._hass = hass;
    const c = this.config;
    const ids = [c.solar_power, c.house_power, c.grid_power, c.battery_power, c.battery_soc].filter(Boolean);
    // i sensori di potenza ripubblicano lo stesso stato ogni 1-2 s: senza la
    // firma la riga si ricostruirebbe di continuo (vedi mgddPaint)
    const sig = mgddStatesSig(hass, ids);
    if (sig === this._lastSig) return;
    this._lastSig = sig;
    this._render();
  }

  getCardSize() { return 1; }

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

  // "406 W" / "2.7 kW": sotto 1 kW resta in W, sopra passa a kW con un
  // decimale. Sempre valore assoluto: il verso lo dice l'etichetta.
  _fmt(v) {
    if (v === null) return { v: '--', u: '' };
    const a = Math.abs(v);
    if (a >= 1000) return { v: (a / 1000).toFixed(1), u: 'kW' };
    return { v: a < 10 ? a.toFixed(1) : String(Math.round(a)), u: 'W' };
  }

  // stesso criterio della energy-flow-card: testo chiaro => tema scuro
  _dark() {
    const cs = getComputedStyle(this).color;
    const m = cs && cs.match(/[\d.]+/g);
    if (!m || m.length < 3) return false;
    return (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255 > 0.6;
  }

  _palette() {
    return this._dark()
      ? { rete: '#38BDF8', sole: '#F5B301', batt: '#22E39A', casa: '#8B7BFF' }
      : { rete: '#0EA5E9', sole: '#E08A00', batt: '#0FB57E', casa: '#6D5AE6' };
  }

  _icon(k) {
    const I = {
      sole: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
      rete: '<path d="M6 22 12 2l6 20"/><path d="M9 22 12 2l3 20"/><path d="M6.8 8h10.4M7.7 13h8.6M8.6 18h6.8"/>',
      batt: '<rect x="3" y="8" width="15" height="8" rx="2"/><path d="M21 11v2"/><path d="M6.5 10.5v3M10 10.5v3"/>',
      // in carica le tacche lasciano il posto al fulmine, come nel flusso
      battchg: '<rect x="3" y="8" width="15" height="8" rx="2"/><path d="M21 11v2"/><path d="M11.4 9.6 8.6 12.2h2.2l-.6 2.4 2.8-2.8h-2.2z"/>',
      casa: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>',
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + I[k] + '</svg>';
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: entityId }, bubbles: true, composed: true }));
  }

  _chip(color, icon, entity, value, label) {
    const f = this._fmt(value);
    return (
      '<div class="es-chip"' + (entity ? ' data-e="' + entity + '"' : '') + '>' +
      '<span class="es-ic" style="background:' + color + '22;color:' + color + '">' + this._icon(icon) + '</span>' +
      '<span class="es-tx">' +
      '<span class="es-v">' + f.v + (f.u ? '<small> ' + f.u + '</small>' : '') + '</span>' +
      '<span class="es-k">' + label + '</span>' +
      '</span></div>'
    );
  }

  _render() {
    const c = this.config;
    if (!c.solar_power && !c.house_power && !c.grid_power && !c.battery_power) {
      mgddPaint(this, this._styles(), '<div class="es-card"><div class="es-empty">Configura almeno un sensore di potenza (solar_power, house_power, grid_power, battery_power).</div></div>');
      return;
    }
    const P = this._palette();
    const TH = c.threshold || 5;
    // soglia dedicata alla batteria: nasconde l'assorbimento parassita della
    // Powerwall (~40-150 W), che altrimenti direbbe "carica" a impianto fermo
    const TB = c.battery_min_flow || 120;
    const s = this._pw(c.solar_power);
    const h = this._pw(c.house_power);
    const g = this._pw(c.grid_power);
    const b = this._pw(c.battery_power);
    const soc = this._num(c.battery_soc);
    // soc_scale: mostra il SOC "app Tesla" nascondendo la riserva ~5%
    const socDisp = (soc !== null && c.soc_scale) ? Math.max(0, Math.min(100, (soc - 5) / 0.95)) : soc;
    const socTxt = socDisp === null ? '' : ' · ' + Math.round(socDisp) + '%';

    let chips = '';
    if (c.solar_power) chips += this._chip(P.sole, 'sole', c.solar_power, s, 'Solare');
    if (c.house_power) chips += this._chip(P.casa, 'casa', c.house_power, h, 'Casa');
    if (c.grid_power) {
      const lab = g === null ? 'Rete' : g > TH ? 'Prelievo' : g < -TH ? 'Immissione' : 'Rete';
      chips += this._chip(P.rete, 'rete', c.grid_power, g, lab);
    }
    if (c.battery_power || c.battery_soc) {
      const chg = b !== null && b < -TB;
      const lab = (b === null ? 'Batteria' : chg ? 'Carica' : b > TB ? 'Scarica' : 'Batteria') + socTxt;
      chips += this._chip(P.batt, chg ? 'battchg' : 'batt', c.battery_power || c.battery_soc, b, lab);
    }

    mgddPaint(this, this._styles(),
      '<div class="es-card">' +
      (c.title ? '<div class="es-t">' + c.title + '</div>' : '') +
      '<div class="es-grid">' + chips + '</div></div>'
    );

    // il click sta sul contenitore, non sui chip: mgddPaint riscrive il
    // sottoalbero a ogni refresh e i listener sui chip andrebbero persi
    if (!this._clickBound) {
      this._clickBound = true;
      this.addEventListener('click', (ev) => {
        const chip = ev.target && ev.target.closest ? ev.target.closest('.es-chip') : null;
        if (chip && chip.dataset.e) this._openMoreInfo(chip.dataset.e);
      });
    }
  }

  _styles() {
    return (
      '<style>' +
      ':host{display:block;}' +
      '.es-card{background:var(--ha-card-background,var(--card-background-color,#fff));' +
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:var(--ha-card-border-radius,18px);' +
      'padding:10px 12px;box-sizing:border-box;}' +
      // auto-fit: quattro colonne a larghezza piena, due su mezza colonna, una
      // su mobile stretto. Nessuna misura in JS, nessun listener di resize.
      '.es-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(102px,1fr));gap:8px 10px;}' +
      '.es-chip{display:flex;align-items:center;gap:8px;min-width:0;padding:2px;border-radius:12px;cursor:pointer;}' +
      '.es-chip:hover{background:var(--secondary-background-color,rgba(0,0,0,.04));}' +
      '.es-ic{width:32px;height:32px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;}' +
      '.es-ic svg{width:19px;height:19px;}' +
      '.es-tx{min-width:0;display:flex;flex-direction:column;line-height:1.2;}' +
      '.es-v{font-size:16px;font-weight:600;color:var(--primary-text-color,#1c1c1e);white-space:nowrap;}' +
      '.es-v small{font-size:11px;font-weight:500;color:var(--secondary-text-color,#6b6f76);}' +
      '.es-k{font-size:11.5px;color:var(--secondary-text-color,#6b6f76);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.es-t{font-size:13px;font-weight:600;color:var(--secondary-text-color,#6b6f76);margin:0 2px 8px;}' +
      '.es-empty{font-size:13px;color:var(--secondary-text-color,#6b6f76);}' +
      '</style>'
    );
  }
}

customElements.define('energy-summary-card', EnergySummaryCard);
window.customCards.push({
  type: 'energy-summary-card',
  name: 'Energy Riassunto',
  description: 'Solare/Casa/Rete/Batteria in una riga compatta, con verso e SOC nell’etichetta. Config via YAML.',
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
      // `end_time` e' obbligatorio, non un di piu': senza, l'endpoint REST non
      // arriva a adesso ma si ferma a UN GIORNO dopo `start`. Chiedendo 48 ore
      // si riceveva la giornata di ieri l'altro, e l'ultimo evento mostrato era
      // quello di allora invece dell'ultimo vero.
      const path = 'history/period/' + start + '?end_time=' + encodeURIComponent(new Date(now).toISOString()) +
        '&filter_entity_id=' + ids.join(',') + '&minimal_response&no_attributes';
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

// ===== casa-mgdd-system-card.js =====
// Quadro di stato di Home Assistant. NON e' una card unica: la stessa classe
// disegna sei sezioni diverse scelte con `section:`, cosi' la vista ha-monitor
// resta una griglia di card componibili come tutte le altre viste, invece di un
// unico blocco che si stacca dal resto della dashboard.
//
// Stile ripreso dalla Energy Horizon card (hello-sebastian/Energy-Horizon):
// una `ha-card` vera, quindi il fondo e' quello del tema e non un rettangolo
// scuro appoggiato sopra; dentro, riquadri appena piu' chiari con angoli larghi,
// intestazione con icona tonda + titolo in maiuscoletto spaziato, numeri grandi
// con l'unita' in grigio accanto, pillole per gli scarti e una riga in fondo che
// dice a parole cosa sta succedendo. Il colore sta SOLO nei dati: riquadri e
// testo restano neutri e presi dal tema.
//
// Tre cose non arrivano da entita' e vanno prese altrove:
//  - le notifiche persistenti NON sono entita': si apre una sottoscrizione
//    websocket `persistent_notification/subscribe` (il vecchio `.../get` non
//    esiste piu' dal 2022.9);
//  - le riparazioni si leggono con `repairs/list_issues`, scartando le ignorate;
//  - conteggi (entita' non disponibili, aggiornamenti, batterie, LQI) si
//    ricavano scandendo `hass.states`, non da sensori che non esistono.
// Tutti e tre sono opzionali: se la chiamata fallisce la riga sparisce e il
// resto della card continua a funzionare.

// Entita' predefinite: sono quelle verificate sull'installazione di casa. Ogni
// chiave e' sovrascrivibile singolarmente dalla config; un'intera sezione si
// spegne con `false` (es. `zigbee: false`).
const SY_DEFAULTS = {
  host: {
    cpu: 'sensor.system_monitor_processor_use',
    cpu_temp: 'sensor.system_monitor_processor_temperature',
    memory: 'sensor.system_monitor_memory_usage',
    memory_free: 'sensor.system_monitor_memory_free',
    memory_used: 'sensor.system_monitor_memory_use',
    disk_free: 'sensor.system_monitor_disk_free',
    disk_use: 'sensor.system_monitor_disk_use',
    last_boot: 'sensor.system_monitor_last_boot',
  },
  network: {
    connected: 'binary_sensor.fritz_box_4060_connessione',
    ip: 'sensor.fritz_box_4060_ip_esterno',
    uptime: 'sensor.fritz_box_4060_tempo_di_attivita_della_connessione',
    link_down: 'sensor.fritz_box_4060_velocita_effettiva_di_scaricamento_del_collegamento',
    link_up: 'sensor.fritz_box_4060_velocita_effettiva_di_caricamento_del_collegamento',
    rate_down: 'sensor.fritz_box_4060_velocita_effettiva_di_scaricamento',
    rate_up: 'sensor.fritz_box_4060_velocita_effettiva_di_caricamento',
    speed_down: 'sensor.speedtest_scarica',
    speed_up: 'sensor.speedtest_carica',
    speed_ping: 'sensor.speedtest_ping',
    router_temp: 'sensor.fritz_box_4060_temperatura_cpu',
    repeater_temp: 'sensor.fritz_repeater_6000_temperatura_cpu',
    repeater_name: 'Repeater 6000',
    gateway_ping: 'binary_sensor.ping_powerwall3',
    gateway_rtt: 'sensor.ping_powerwall3_round_trip_time_average',
    gateway_loss: 'sensor.ping_powerwall3_perdita_di_pacchetti',
    gateway_name: 'Gateway Powerwall',
  },
  zigbee: {
    connection: 'binary_sensor.zigbee2mqtt_bridge_connection_state',
    version: 'sensor.zigbee2mqtt_bridge_version',
    coordinator: 'sensor.zigbee2mqtt_bridge_coordinator_version',
    permit_join: 'switch.zigbee2mqtt_bridge_permit_join',
    restart: 'button.zigbee2mqtt_bridge_restart',
    log_level: 'select.zigbee2mqtt_bridge_log_level',
  },
  backup: {
    state: 'sensor.backup_backup_manager_state',
    last_ok: 'sensor.backup_last_successful_automatic_backup',
    last_try: 'sensor.backup_last_attempted_automatic_backup',
    next: 'sensor.backup_next_scheduled_automatic_backup',
  },
};

// Soglie: superarle vale un avviso; i guasti veri (bridge caduto, linea giu',
// backup troppo vecchio) sono cablati nella logica.
const SY_TH = {
  cpu: 85, // %
  cpu_temp: 80, // °C
  memory: 85, // %
  disk: 85, // % occupato
  device_temp: 80, // °C su router/repeater
  ping: 60, // ms
  speed_ratio: 0.5, // frazione del link negoziato sotto cui la linea e' degradata
  speed_min: null, // alternativa assoluta in Mbit/s quando il link non e' noto
  packet_loss: 2, // %
  unavailable: 50, // numero di entita' non disponibili
  linkquality: 30, // LQI
  battery: 20, // %
  backup_age: 36, // ore dall'ultimo backup riuscito
};

const SY_SECTIONS = {
  summary: { title: 'Stato sistema', icon: 'gauge' },
  host: { title: 'Risorse', icon: 'chip' },
  network: { title: 'Rete e uplink', icon: 'globe' },
  zigbee: { title: 'Zigbee2MQTT', icon: 'hub' },
  backup: { title: 'Backup e integrità', icon: 'shield' },
  batteries: { title: 'Batterie', icon: 'battery' },
};

class SystemCard extends HTMLElement {
  setConfig(config) {
    const c = config || {};
    const sec = c.section || 'summary';
    if (!SY_SECTIONS[sec]) {
      throw new Error('"section" deve essere uno fra: ' + Object.keys(SY_SECTIONS).join(', '));
    }
    const part = (k) => (c[k] === false ? null : Object.assign({}, SY_DEFAULTS[k], c[k] || {}));
    this.config = {
      section: sec,
      title: c.title || SY_SECTIONS[sec].title,
      icon: c.icon || SY_SECTIONS[sec].icon,
      host: part('host'),
      network: part('network'),
      zigbee: part('zigbee'),
      backup: part('backup'),
      batteries: Object.assign(
        { count: 8 },
        c.batteries === true || c.batteries == null || c.batteries === false ? {} : c.batteries
      ),
      thresholds: Object.assign({}, SY_TH, c.thresholds || {}),
    };
    this._lastSig = null;
    this._stats = {}; // entity_id -> serie oraria per le sparkline
    this._statAt = 0;
    this._repairs = null; // null = non ancora letto, [] = nessuna
    this._repAt = 0;
    this._notif = null; // dizionario id -> notifica, dalla sottoscrizione
    this._scanAt = 0;
    this._scan = { unav: 0, upd: 0, updName: '', lq: null, lqName: '', batt: [] };
    if (!this._uid) {
      SystemCard._seq = (SystemCard._seq || 0) + 1;
      this._uid = SystemCard._seq;
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this._maybeScan();
    const sig =
      mgddStatesSig(hass, this._allIds()) +
      '|' + this._scan.unav + ';' + this._scan.upd + ';' + this._scan.lq +
      ';' + (this._notif ? Object.keys(this._notif).length : -1) +
      ';' + (this._repairs ? this._repairs.length : -1) +
      ';' + (this._isDark() ? 'd' : 'l');
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._render();
    }
    if (first) this._subscribeNotifications();
    this._maybeFetchStats();
    this._maybeFetchRepairs();
  }

  disconnectedCallback() {
    if (this._unsubNotif) {
      try {
        this._unsubNotif();
      } catch (e) {
        /* la connessione puo' essere gia' caduta */
      }
      this._unsubNotif = null;
    }
  }

  getCardSize() {
    const s = this.config ? this.config.section : 'summary';
    if (s === 'summary') return 6;
    if (s === 'host') return 8;
    if (s === 'batteries') return 5;
    return 7;
  }

  // Le sezioni che non servono a questa istanza non entrano nella firma: cosi'
  // una card "Zigbee" non si ridisegna a ogni battito dei sensori di rete.
  _allIds() {
    const ids = [];
    const s = this.config.section;
    const take = (k) => {
      const o = this.config[k];
      if (!o) return;
      Object.keys(o).forEach((kk) => {
        const v = o[kk];
        if (typeof v === 'string' && v.indexOf('.') > 0) ids.push(v);
      });
    };
    if (s === 'summary') {
      take('host');
      take('network');
      take('zigbee');
      take('backup');
    } else if (s === 'batteries') {
      const b = this.config.batteries;
      if (b.button) ids.push(b.button);
      if (b.result) ids.push(b.result);
    } else {
      take(s);
    }
    return ids;
  }

  // ---------- lettura stati ----------

  _isDark() {
    return !!(this._hass && this._hass.themes && this._hass.themes.darkMode);
  }

  _st(id) {
    return (id && this._hass && this._hass.states[id]) || null;
  }

  _num(id) {
    const s = this._st(id);
    if (!s) return null;
    const v = parseFloat(s.state);
    return isNaN(v) ? null : v;
  }

  _txt(id) {
    const s = this._st(id);
    if (!s || s.state === 'unknown' || s.state === 'unavailable') return null;
    return s.state;
  }

  _ts(id) {
    const s = this._txt(id);
    if (!s) return null;
    const t = new Date(s).getTime();
    return isNaN(t) ? null : t;
  }

  _on(id) {
    const s = this._st(id);
    if (!s) return null;
    if (s.state === 'unknown' || s.state === 'unavailable') return null;
    return s.state === 'on';
  }

  // ---------- formattazione ----------

  _pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  _n(v, dec) {
    if (v == null) return '—';
    return v.toFixed(dec == null ? 0 : dec).replace('.', ',');
  }

  _dur(ms) {
    if (ms == null || ms < 0) return '—';
    const m = Math.floor(ms / 60000);
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    if (d > 0) return d + ' gg ' + h + ' h';
    if (h > 0) return h + ' h ' + this._pad(m % 60) + ' m';
    return (m % 60) + ' m';
  }

  _hm(ts) {
    const d = new Date(ts);
    return this._pad(d.getHours()) + ':' + this._pad(d.getMinutes());
  }

  // "oggi", "domani", altrimenti "05/08"
  _day(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const now = new Date();
    const same = (a, b) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, now)) return 'oggi';
    if (same(d, new Date(now.getTime() + 86400000))) return 'domani';
    if (same(d, new Date(now.getTime() - 86400000))) return 'ieri';
    return this._pad(d.getDate()) + '/' + this._pad(d.getMonth() + 1);
  }

  _when(ts) {
    return ts ? this._day(ts) + ' ' + this._hm(ts) : '—';
  }

  // ---------- scansione degli stati ----------

  // Conteggi che nessun sensore espone: entita' non disponibili, aggiornamenti
  // in attesa, batterie, qualita' del collegamento Zigbee peggiore. Sono ~1500
  // stati da scorrere, quindi si rifa' al massimo ogni 30 s: senza il freno la
  // scansione ripartirebbe a ogni cambio di un sensore di potenza.
  _maybeScan() {
    const now = Date.now();
    if (this._scanAt && now - this._scanAt < 30000) return;
    this._scanAt = now;
    if (!this._hass) return;
    const st = this._hass.states;
    let unav = 0;
    let upd = 0;
    let updName = '';
    let lq = null;
    let lqName = '';
    const batt = [];
    Object.keys(st).forEach((id) => {
      const s = st[id];
      if (s.state === 'unavailable') {
        unav++;
        return;
      }
      if (id.indexOf('update.') === 0 && s.state === 'on') {
        upd++;
        // "Home Assistant Core Update" -> "Home Assistant Core": il suffisso e'
        // sempre lo stesso e nella riga stretta mangia il nome vero.
        if (!updName) {
          updName = String((s.attributes && s.attributes.friendly_name) || id).replace(/\s*update\s*$/i, '');
        }
        return;
      }
      if (s.state === 'unknown') return;
      if (id.indexOf('sensor.') === 0) {
        const a = s.attributes || {};
        if (/_linkquality$/.test(id)) {
          const v = parseFloat(s.state);
          if (!isNaN(v) && (lq === null || v < lq)) {
            lq = v;
            lqName = (a.friendly_name || id).replace(/\s*linkquality\s*$/i, '').trim();
          }
        } else if (a.device_class === 'battery') {
          const v = parseFloat(s.state);
          if (!isNaN(v)) batt.push({ entity: id, name: this._battName(a.friendly_name || id), val: v });
        }
      }
    });
    batt.sort((a, b) => a.val - b.val);
    this._scan = { unav: unav, upd: upd, updName: updName, lq: lq, lqName: lqName, batt: batt };
  }

  // Stessa ripulitura dei nomi che faceva il template auto-entities della vista
  // precedente: "Porta Cucina Battery" -> "Porta Cucina".
  _battName(fn) {
    let s = String(fn || '');
    s = s.replace(/\s*watch\s*battery\s*level\s*$/i, '');
    s = s.replace(/\s*watch\s*battery\s*$/i, '');
    s = s.replace(/\s*battery\s*level\s*$/i, '');
    s = s.replace(/\s*battery\s*$/i, '');
    s = s.replace(/\s*batteria\s*$/i, '');
    return s.replace(/\s+/g, ' ').trim();
  }

  // ---------- statistiche per le sparkline ----------

  _sparkIds() {
    if (this.config.section !== 'host') return [];
    const h = this.config.host || {};
    return [h.cpu, h.memory, h.disk_use].filter(Boolean);
  }

  async _maybeFetchStats() {
    const ids = this._sparkIds();
    if (!ids.length || !this._hass || !this._hass.callWS) return;
    const now = Date.now();
    if (this._statAt && now - this._statAt < 5 * 60 * 1000) return;
    this._statAt = now;
    const req = {
      type: 'recorder/statistics_during_period',
      start_time: new Date(now - 24 * 3600 * 1000).toISOString(),
      statistic_ids: ids,
      period: 'hour',
      types: ['mean'],
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
      if (rows && rows.length > 1) out[id] = rows.map((r) => (r.mean == null ? 0 : r.mean));
    });
    this._stats = out;
    this._render();
  }

  // ---------- riparazioni ----------

  async _maybeFetchRepairs() {
    const s = this.config.section;
    if (s !== 'summary' && s !== 'backup') return;
    const now = Date.now();
    if (this._repAt && now - this._repAt < 5 * 60 * 1000) return;
    this._repAt = now;
    if (!this._hass || !this._hass.callWS) return;
    try {
      const res = await this._hass.callWS({ type: 'repairs/list_issues' });
      const list = (res && res.issues) || [];
      this._repairs = list.filter((i) => !i.ignored);
      this._render();
    } catch (e) {
      this._repairs = null; // la riga resta muta invece di mentire
    }
  }

  // ---------- notifiche persistenti ----------

  // Non sono entita': l'unico modo e' la sottoscrizione websocket, che manda
  // prima l'elenco corrente e poi le variazioni.
  _subscribeNotifications() {
    const s = this.config.section;
    if (s !== 'summary' && s !== 'backup') return;
    if (this._unsubNotif || !this._hass || !this._hass.connection) return;
    let p = null;
    try {
      p = this._hass.connection.subscribeMessage(
        (msg) => {
          if (!msg) return;
          if (msg.type === 'current' || !this._notif) this._notif = {};
          const items = msg.notifications || {};
          if (msg.type === 'removed') {
            Object.keys(items).forEach((k) => delete this._notif[k]);
          } else {
            Object.keys(items).forEach((k) => {
              this._notif[k] = items[k];
            });
          }
          this._render();
        },
        { type: 'persistent_notification/subscribe' }
      );
    } catch (e) {
      p = null;
    }
    if (p && p.then) {
      p.then(
        (un) => {
          this._unsubNotif = un;
        },
        () => {
          this._unsubNotif = null;
        }
      );
    }
  }

  // ---------- valutazione ----------

  // Ogni riga dichiara il proprio livello: 0 ok, 1 avviso, 2 guasto, 3 dato
  // assente. Punteggio e pillole discendono da qui, non viceversa: cosi' non
  // puo' capitare un riepilogo verde con una riga rossa sotto.
  _eval() {
    const t = this.config.thresholds;
    const sub = { host: 0, backup: 0, zigbee: 0, rete: 0, entita: 0, riparazioni: 0 };
    const notes = []; // frasi per la riga narrativa, in ordine di gravita'
    let warn = 0;
    let crit = 0;
    const bump = (k, lv, note) => {
      if (lv === 1) warn++;
      if (lv === 2) crit++;
      if (lv > sub[k] && lv < 3) sub[k] = lv;
      if (note && (lv === 1 || lv === 2)) notes.push({ lv: lv, text: note });
      return lv;
    };
    const L = {};

    const h = this.config.host;
    if (h) {
      const cpu = this._num(h.cpu);
      const tmp = this._num(h.cpu_temp);
      const mem = this._num(h.memory);
      const df = this._num(h.disk_free);
      const du = this._num(h.disk_use);
      L.cpu = bump('host', cpu == null ? 3 : cpu >= t.cpu ? 1 : 0, 'il processore è al ' + this._n(cpu) + '%');
      L.temp = bump('host', tmp == null ? 3 : tmp >= t.cpu_temp ? 1 : 0, 'il processore è a ' + this._n(tmp) + ' °C');
      L.mem = bump('host', mem == null ? 3 : mem >= t.memory ? 1 : 0, 'la memoria è al ' + this._n(mem) + '%');
      const diskPct = df != null && du != null && df + du > 0 ? (du / (df + du)) * 100 : null;
      L.diskPct = diskPct;
      L.disk = bump('host', diskPct == null ? 3 : diskPct >= t.disk ? 1 : 0, 'il disco è pieno al ' + this._n(diskPct) + '%');
    }

    const b = this.config.backup;
    if (b) {
      const ok = this._ts(b.last_ok);
      const age = ok ? (Date.now() - ok) / 3600000 : null;
      L.backup = bump('backup', ok == null ? 3 : age > t.backup_age ? 2 : 0, "l'ultimo backup riuscito è di " + this._dur(Date.now() - (ok || Date.now())) + ' fa');
      const state = this._txt(b.state);
      if (state && state !== 'idle' && state !== 'completed') bump('backup', 1, 'il gestore dei backup è in stato ' + state);
      L.backupState = state;
    }

    const z = this.config.zigbee;
    if (z) {
      const conn = this._on(z.connection);
      L.zconn = bump('zigbee', conn == null ? 3 : conn ? 0 : 2, 'il bridge Zigbee non risponde');
      const log = this._txt(z.log_level);
      // il livello debug non e' un guasto ma gonfia log e disco: vale un avviso
      L.zlog = bump('zigbee', log == null ? 3 : log === 'debug' ? 1 : 0, 'il log Zigbee è in debug');
      const join = this._on(z.permit_join);
      L.zjoin = bump('zigbee', join ? 1 : 0, 'la rete Zigbee è aperta all’accoppiamento');
      L.zlq = bump('zigbee', this._scan.lq == null ? 3 : this._scan.lq < t.linkquality ? 1 : 0,
        'il collegamento più debole è ' + this._scan.lqName + ' (LQI ' + this._n(this._scan.lq) + ')');
    }

    const n = this.config.network;
    if (n) {
      const conn = this._on(n.connected);
      L.nconn = bump('rete', conn == null ? 3 : conn ? 0 : 2, 'la connessione a Internet è caduta');
      const sd = this._num(n.speed_down);
      const link = this._num(n.link_down);
      const floor = link != null ? link * t.speed_ratio : t.speed_min;
      L.nspeed = bump('rete', sd == null ? 3 : floor != null && sd < floor ? 1 : 0,
        'la banda in discesa è di ' + this._n(sd, 1) + ' Mbps su un link da ' + this._n(link) + ' Mbps');
      const ping = this._num(n.speed_ping);
      L.nping = bump('rete', ping == null ? 3 : ping >= t.ping ? 1 : 0, 'la latenza è di ' + this._n(ping) + ' ms');
      const rt = this._num(n.router_temp);
      const pt = this._num(n.repeater_temp);
      const hot = (rt || 0) >= t.device_temp ? 'il router' : (pt || 0) >= t.device_temp ? (n.repeater_name || 'il repeater') : null;
      L.ntemp = bump('rete', rt == null && pt == null ? 3 : hot ? 1 : 0,
        hot ? hot + ' è a ' + this._n(Math.max(rt || 0, pt || 0)) + ' °C' : null);
      const gw = this._on(n.gateway_ping);
      const loss = this._num(n.gateway_loss);
      L.ngw = bump('rete', gw == null ? 3 : !gw ? 2 : loss != null && loss > t.packet_loss ? 1 : 0,
        gw === false ? (n.gateway_name || 'il gateway') + ' non risponde' : 'si perdono pacchetti verso ' + (n.gateway_name || 'il gateway'));
    }

    L.upd = bump('entita', this._scan.upd > 0 ? 1 : 0,
      this._scan.upd === 1 ? 'c’è un aggiornamento per ' + this._scan.updName : 'ci sono ' + this._scan.upd + ' aggiornamenti in attesa');
    L.unav = bump('entita', this._scan.unav >= t.unavailable ? 1 : 0, this._scan.unav + ' entità non rispondono');
    const nn = this._notif ? Object.keys(this._notif).length : null;
    L.notif = bump('entita', nn == null ? 3 : nn > 0 ? 1 : 0,
      nn === 1 ? 'c’è una notifica aperta' : 'ci sono ' + nn + ' notifiche aperte');
    L.notifCount = nn;
    const rep = this._repairs;
    L.rep = bump('riparazioni', rep == null ? 3 : rep.length ? 1 : 0,
      rep && rep.length === 1 ? 'c’è una riparazione da sistemare' : rep ? 'ci sono ' + rep.length + ' riparazioni da sistemare' : null);
    L.repCount = rep == null ? null : rep.length;

    const low = this._scan.batt.filter((x) => x.val <= t.battery);
    L.battLow = low.length;
    L.battWorst = this._scan.batt.length ? this._scan.batt[0] : null;
    if (low.length) {
      bump('entita', 1, low.length === 1 ? 'la batteria di ' + low[0].name + ' è al ' + this._n(low[0].val) + '%' : low.length + ' batterie sono sotto il ' + t.battery + '%');
    }

    // Il punteggio conta le AREE, non le singole righe: pesare ogni riga
    // portava un impianto sano a 52/100 solo perche' sette dettagli minori
    // erano gialli, e il numero smetteva di corrispondere alle pillole accanto.
    let sw = 0;
    let sc = 0;
    Object.keys(sub).forEach((k) => {
      if (sub[k] === 1) sw++;
      if (sub[k] === 2) sc++;
    });
    notes.sort((a, b) => b.lv - a.lv);
    const score = Math.max(0, Math.min(100, 100 - sw * 8 - sc * 25));
    return { L: L, sub: sub, warn: warn, crit: crit, areasWarn: sw, areasCrit: sc, score: score, notes: notes };
  }

  // ---------- pezzi grafici ----------

  _ico(k) {
    const I = {
      gauge: '<path d="M4 19a8 8 0 1 1 16 0"/><path d="M12 19 15.5 11"/><circle cx="12" cy="19" r="1.4"/>',
      chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
      globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
      hub: '<circle cx="12" cy="12" r="2.4"/><path d="M12 4v5.6M12 14.4V20M4.6 8.2 9.9 11M14.1 13l5.3 3M4.6 15.8 9.9 13M14.1 11l5.3-3"/>',
      shield: '<path d="M12 3 20 6v6c0 4.4-3.2 7.7-8 9-4.8-1.3-8-4.6-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
      battery: '<rect x="3" y="8" width="15" height="8" rx="2"/><path d="M21 11v2"/><path d="M6.5 10.5v3M10 10.5v3"/>',
      up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
      down: '<path d="M12 5v14"/><path d="m5 12 7 7 7-7"/>',
      flat: '<path d="M4 12h16"/>',
    };
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + (I[k] || I.gauge) + '</svg>'
    );
  }

  _spark(id, tone) {
    const d = this._stats[id];
    if (!d || d.length < 2) return '';
    let min = d[0];
    let max = d[0];
    d.forEach((v) => {
      if (v < min) min = v;
      if (v > max) max = v;
    });
    const span = max - min || 1;
    const W = 200;
    const H = 30;
    const pts = d.map((v, i) => {
      const x = (i / (d.length - 1)) * W;
      const y = H - 4 - ((v - min) / span) * (H - 10);
      return { x: x, y: y };
    });
    const line = pts.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    const area = 'M0,' + H + ' L' + pts.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' L') + ' L' + W + ',' + H + ' Z';
    const c = 'var(--sy-' + tone + ')';
    const uid = 'syg' + this._uid + id.replace(/[^a-z0-9]/gi, '');
    return (
      '<svg class="sy-spk" viewBox="0 0 200 30" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + c + '" stop-opacity=".28"/>' +
      '<stop offset="1" stop-color="' + c + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#' + uid + ')"/>' +
      '<polyline fill="none" stroke="' + c + '" stroke-width="1.6" points="' + line + '"/>' +
      '<circle cx="' + pts[pts.length - 1].x.toFixed(1) + '" cy="' + pts[pts.length - 1].y.toFixed(1) +
      '" r="2.2" fill="' + c + '"/></svg>'
    );
  }

  _tone(lv) {
    return lv === 2 ? 'crit' : lv === 1 ? 'warn' : lv === 3 ? 'mute' : 'ok';
  }

  _pill(lv, text) {
    return '<span class="sy-pill sy-' + this._tone(lv) + '">' + text + '</span>';
  }

  _kv(label, value, unit, tone) {
    return (
      '<div class="sy-kv"><div class="sy-k">' + label + '</div>' +
      '<div class="sy-big' + (tone ? ' sy-' + tone : '') + '">' + value +
      (unit ? '<small>' + unit + '</small>' : '') + '</div></div>'
    );
  }

  // Riga di dettaglio: pallino, testo, valore a destra.
  _ln(lv, label, value, more) {
    return (
      '<div class="sy-ln"' + (more ? ' data-more="' + more + '"' : '') + '>' +
      '<i class="sy-dot sy-' + this._tone(lv) + '"></i>' +
      '<span>' + label + '</span><u class="sy-' + this._tone(lv) + '">' + value + '</u></div>'
    );
  }

  // ---------- disegno ----------

  _render() {
    if (!this.config || !this._hass) return;
    mgddPaint(this, this._styles(), this._html());
    this._wire();
  }

  _html() {
    const e = this._eval();
    const s = this.config.section;
    const body =
      s === 'summary' ? this._secSummary(e) :
      s === 'host' ? this._secHost(e) :
      s === 'network' ? this._secNet(e) :
      s === 'zigbee' ? this._secZig(e) :
      s === 'backup' ? this._secBackup(e) :
      this._secBatteries(e);
    return (
      '<ha-card class="sy-card' + (this._isDark() ? ' sy-dark' : '') + '"><div class="sy-in">' +
      body.head + body.body + '</div></ha-card>'
    );
  }

  _head(tone, sub, badge) {
    return (
      '<div class="sy-hd"><span class="sy-hdi sy-' + tone + '">' + this._ico(this.config.icon) + '</span>' +
      '<div class="sy-hdx"><div class="sy-hdt">' + this.config.title + '</div>' +
      '<div class="sy-hds">' + sub + '</div></div>' +
      (badge || '') + '</div>'
    );
  }

  // ---------- sezioni ----------

  _secSummary(e) {
    const tone = e.areasCrit ? 'crit' : e.areasWarn ? 'warn' : 'ok';
    const boot = this.config.host ? this._ts(this.config.host.last_boot) : null;
    const labels = { host: 'Host', backup: 'Backup', zigbee: 'Zigbee', rete: 'Rete', entita: 'Entità', riparazioni: 'Riparazioni' };
    const chips = Object.keys(labels)
      .map((k) => {
        const lv = k === 'riparazioni' && this._repairs == null ? 3 : e.sub[k];
        return (
          '<div class="sy-chip"><i class="sy-dot sy-' + this._tone(lv) + '"></i>' +
          '<span>' + labels[k] + '</span></div>'
        );
      })
      .join('');
    const ok = 6 - e.areasWarn - e.areasCrit;
    const scoreLab = e.areasCrit
      ? e.areasCrit + (e.areasCrit === 1 ? ' area in guasto' : ' aree in guasto')
      : e.areasWarn
      ? e.areasWarn + (e.areasWarn === 1 ? ' area da guardare' : ' aree da guardare')
      : 'tutto in regola';
    // La frase in fondo e' il pezzo piu' utile della sezione: dice a parole
    // cosa guardare, senza costringere a leggere sei pannelli.
    const top = e.notes.slice(0, 3).map((x) => x.text);
    const nar = top.length
      ? (top.length === 1 ? 'Una cosa da vedere: ' : 'Da vedere: ') +
        top.join('; ') + '.'
      : 'Nessuna segnalazione: host, backup, Zigbee, rete ed entità sono tutti in regola.';
    const narIco = e.areasCrit ? 'down' : e.areasWarn ? 'flat' : 'up';
    return {
      head: this._head(tone, 'Home Assistant ' + (this._hass.config.version || '—') +
        (boot ? ' · attivo da ' + this._dur(Date.now() - boot) : ''), this._pill(e.areasCrit ? 2 : e.areasWarn ? 1 : 0, scoreLab)),
      body:
        '<div class="sy-p sy-p2">' +
        '<div>' + this._kv('Punteggio', String(e.score), '/ 100', tone) +
        '<div class="sy-note">' + (e.warn + e.crit) + (e.warn + e.crit === 1 ? ' segnalazione' : ' segnalazioni') + ' in tutto</div></div>' +
        '<div>' + this._kv('Aree in regola', ok + ' / 6', '', ok === 6 ? 'ok' : null) +
        '<div class="sy-note">controllo continuo, conteggi ogni 30 s</div></div>' +
        '</div>' +
        '<div class="sy-chips">' + chips + '</div>' +
        '<div class="sy-p sy-nar"><span class="sy-nari sy-' + tone + '">' + this._ico(narIco) + '</span>' +
        '<p>' + nar + '</p></div>',
    };
  }

  _secHost(e) {
    const h = this.config.host;
    if (!h) return { head: this._head('mute', 'sezione disattivata'), body: '' };
    const L = e.L;
    const tone = this._tone(e.sub.host);
    const cpu = this._num(h.cpu);
    const tmp = this._num(h.cpu_temp);
    const mem = this._num(h.memory);
    const mf = this._num(h.memory_free);
    const mu = this._num(h.memory_used);
    const df = this._num(h.disk_free);
    const du = this._num(h.disk_use);
    const boot = this._ts(h.last_boot);
    const cell = (label, big, unit, sub, tn, spark) =>
      '<div class="sy-p">' + this._kv(label, big, unit, tn) +
      '<div class="sy-note">' + sub + '</div>' + (spark || '') + '</div>';
    return {
      head: this._head(tone, 'Processore, memoria, disco e tempo di attività',
        this._pill(e.sub.host, e.sub.host ? 'sotto pressione' : 'nella norma')),
      body:
        '<div class="sy-grid2">' +
        cell('Processore', this._n(cpu), '%', tmp == null ? 'temperatura non disponibile' : this._n(tmp) + ' °C',
          this._tone(Math.max(L.cpu === 3 ? 0 : L.cpu, L.temp === 3 ? 0 : L.temp)), this._spark(h.cpu, this._tone(L.cpu))) +
        cell('Memoria', this._n(mem, 1), '%', mf == null ? 'nessun dato' : this._n(mf, 1) + ' GB liberi di ' + this._n((mf || 0) + (mu || 0), 1),
          this._tone(L.mem), this._spark(h.memory, this._tone(L.mem))) +
        cell('Disco /', this._n(L.diskPct, 1), '%', df == null ? 'nessun dato' : this._n(df, 1) + ' GB liberi · ' + this._n(du, 1) + ' GB usati',
          this._tone(L.disk), this._spark(h.disk_use, this._tone(L.disk))) +
        '<div class="sy-p">' + this._kv('Attività', boot ? this._dur(Date.now() - boot) : '—', '') +
        '<div class="sy-note">riavvio ' + this._when(boot) + ' · Core ' + (this._hass.config.version || '—') + '</div>' +
        '<div class="sy-btns">' +
        '<button class="sy-btn" data-svc="homeassistant.reload_all" data-ask="Ricaricare tutta la configurazione YAML?">Ricarica YAML</button>' +
        '<button class="sy-btn sy-warn" data-svc="homeassistant.restart" data-ask="Riavviare Home Assistant?">Riavvia</button>' +
        '</div></div>' +
        '</div>',
    };
  }

  _secNet(e) {
    const n = this.config.network;
    if (!n) return { head: this._head('mute', 'sezione disattivata'), body: '' };
    const L = e.L;
    const tone = this._tone(e.sub.rete);
    const sd = this._num(n.speed_down);
    const su = this._num(n.speed_up);
    const pg = this._num(n.speed_ping);
    const ld = this._num(n.link_down);
    const lu = this._num(n.link_up);
    const upt = this._ts(n.uptime);
    const rows = [];
    rows.push(this._ln(L.nconn, 'Collegamento', L.nconn === 2 ? 'caduto' : L.nconn === 3 ? '—' : upt ? 'su da ' + this._dur(Date.now() - upt) : 'attivo', n.connected));
    const ip = this._txt(n.ip);
    if (ip) rows.push(this._ln(0, 'IP pubblico', ip, n.ip));
    if (ld != null || lu != null) rows.push(this._ln(0, 'Link negoziato', this._n(ld) + ' / ' + this._n(lu) + ' Mbit', n.link_down));
    const rd = this._num(n.rate_down);
    const ru = this._num(n.rate_up);
    if (rd != null || ru != null) rows.push(this._ln(0, 'Traffico adesso', this._n(rd, 1) + ' ↓ · ' + this._n(ru, 1) + ' ↑ Mbit/s', n.rate_down));
    const gw = this._on(n.gateway_ping);
    if (gw !== null) {
      rows.push(this._ln(L.ngw, n.gateway_name || 'Gateway',
        gw ? this._n(this._num(n.gateway_rtt)) + ' ms · ' + this._n(this._num(n.gateway_loss), 1) + '% persi' : 'non risponde', n.gateway_ping));
    }
    const rt = this._num(n.router_temp);
    const pt = this._num(n.repeater_temp);
    const th = this.config.thresholds.device_temp;
    if (rt != null) rows.push(this._ln(rt >= th ? 1 : 0, 'Router · CPU', this._n(rt) + ' °C', n.router_temp));
    if (pt != null) rows.push(this._ln(pt >= th ? 1 : 0, (n.repeater_name || 'Repeater') + ' · CPU', this._n(pt) + ' °C', n.repeater_temp));
    return {
      head: this._head(tone, ip ? 'FRITZ!Box · ' + ip : 'Collegamento a Internet',
        this._pill(e.sub.rete, e.sub.rete === 2 ? 'caduta' : e.sub.rete === 1 ? 'degradata' : 'in linea')),
      body:
        '<div class="sy-p sy-p2">' +
        '<div>' + this._kv('Banda misurata', this._n(sd, 1) + ' ↓', 'Mbps', this._tone(L.nspeed)) +
        '<div class="sy-note">' + this._n(su, 1) + ' Mbps in salita' + (ld != null ? ' · link da ' + this._n(ld) + ' Mbps' : '') + '</div></div>' +
        '<div>' + this._kv('Latenza', this._n(pg), 'ms', this._tone(L.nping)) +
        '<div class="sy-note">ultimo speedtest</div></div>' +
        '</div><div class="sy-lns">' + rows.join('') + '</div>',
    };
  }

  _secZig(e) {
    const z = this.config.zigbee;
    if (!z) return { head: this._head('mute', 'sezione disattivata'), body: '' };
    const L = e.L;
    const tone = this._tone(e.sub.zigbee);
    const v = this._txt(z.version);
    const co = this._txt(z.coordinator);
    const join = this._on(z.permit_join);
    const log = this._txt(z.log_level);
    const rows = [];
    rows.push(this._ln(L.zconn, 'Bridge', L.zconn === 2 ? 'disconnesso' : L.zconn === 3 ? '—' : 'connesso', z.connection));
    if (co) rows.push(this._ln(0, 'Coordinatore', co, z.coordinator));
    if (join !== null) rows.push(this._ln(join ? 1 : 0, 'Permit join', join ? 'aperto' : 'chiuso', z.permit_join));
    if (log) rows.push(this._ln(L.zlog, 'Livello log', log, z.log_level));
    const btns = [];
    if (z.permit_join) {
      // aprire la rete all'accoppiamento merita una conferma; richiuderla no
      btns.push('<button class="sy-btn" data-toggle="' + z.permit_join + '"' +
        (join ? '' : ' data-ask="Aprire la rete Zigbee all\'accoppiamento?"') + '>' +
        (join ? 'Chiudi join' : 'Permit join') + '</button>');
    }
    if (z.log_level && log === 'debug') {
      btns.push('<button class="sy-btn" data-select="' + z.log_level + '" data-opt="info">Log → info</button>');
    }
    if (z.restart) {
      btns.push('<button class="sy-btn sy-warn" data-press="' + z.restart + '" data-ask="Riavviare il bridge Zigbee2MQTT?">Riavvia bridge</button>');
    }
    return {
      head: this._head(tone, v ? 'Bridge ' + v : 'Bridge Zigbee',
        this._pill(e.sub.zigbee, e.sub.zigbee === 2 ? 'giù' : e.sub.zigbee === 1 ? 'da guardare' : 'regolare')),
      body:
        '<div class="sy-p sy-p2">' +
        '<div>' + this._kv('Collegamento più debole', this._scan.lq == null ? '—' : this._n(this._scan.lq), 'LQI', this._tone(L.zlq)) +
        '<div class="sy-note">' + (this._scan.lqName || 'nessun sensore di qualità') + '</div></div>' +
        '<div>' + this._kv('Versione', v || '—', '') +
        '<div class="sy-note">' + (co ? 'coordinatore ' + co : 'coordinatore sconosciuto') + '</div></div>' +
        '</div><div class="sy-lns">' + rows.join('') + '</div>' +
        (btns.length ? '<div class="sy-btns">' + btns.join('') + '</div>' : ''),
    };
  }

  _secBackup(e) {
    const b = this.config.backup;
    const L = e.L;
    const tone = this._tone(Math.max(e.sub.backup, e.sub.entita, e.sub.riparazioni));
    const ok = b ? this._ts(b.last_ok) : null;
    const nx = b ? this._ts(b.next) : null;
    const rows = [];
    if (b) {
      const stt = this._txt(b.state);
      if (stt) rows.push(this._ln(stt === 'idle' || stt === 'completed' ? 0 : 1, 'Gestore backup', stt, b.state));
      const tr = this._ts(b.last_try);
      if (tr) rows.push(this._ln(0, 'Ultimo tentativo', this._when(tr), b.last_try));
    }
    rows.push(this._ln(L.upd, 'Aggiornamenti in attesa',
      this._scan.upd ? (this._scan.upd === 1 ? this._scan.updName : this._scan.upd + ' pacchetti') : 'nessuno', null));
    rows.push(this._ln(L.unav, 'Entità non disponibili', String(this._scan.unav), null));
    rows.push(this._ln(L.notif, 'Notifiche aperte', L.notifCount == null ? '—' : String(L.notifCount), null));
    rows.push(this._ln(L.rep, 'Riparazioni', L.repCount == null ? '—' : L.repCount ? String(L.repCount) : 'nessuna', null));
    return {
      head: this._head(tone, 'Copie automatiche e salute dell’installazione',
        this._pill(Math.max(e.sub.backup, e.sub.entita, e.sub.riparazioni), tone === 'crit' ? 'da vedere subito' : tone === 'warn' ? 'da guardare' : 'a posto')),
      body:
        '<div class="sy-p sy-p2">' +
        '<div>' + this._kv('Ultimo riuscito', ok ? this._hm(ok) : '—', ok ? this._day(ok) : '', this._tone(L.backup)) +
        '<div class="sy-note">' + (ok ? this._dur(Date.now() - ok) + ' fa' : 'nessun backup registrato') + '</div></div>' +
        '<div>' + this._kv('Prossimo', nx ? this._hm(nx) : '—', nx ? this._day(nx) : '') +
        '<div class="sy-note">' + (nx ? 'fra ' + this._dur(nx - Date.now()) : 'nessuna pianificazione') + '</div></div>' +
        '</div><div class="sy-lns">' + rows.join('') + '</div>',
    };
  }

  _secBatteries(e) {
    const c = this.config.batteries;
    const t = this.config.thresholds.battery;
    const list = this._scan.batt.slice(0, c.count || 8);
    const low = e.L.battLow || 0;
    const tone = low ? 'warn' : 'ok';
    const tiles = list
      .map((x) => {
        const tn = x.val <= t ? 'crit' : x.val <= t * 1.75 ? 'warn' : 'ok';
        return (
          '<div class="sy-bt" data-more="' + x.entity + '">' +
          '<div class="sy-btv sy-' + tn + '">' + this._n(x.val) + '<small>%</small></div>' +
          '<div class="sy-btl">' + x.name + '</div>' +
          '<div class="sy-bar"><i class="sy-' + tn + '" style="width:' + Math.max(2, Math.min(100, x.val)) + '%"></i></div>' +
          '</div>'
        );
      })
      .join('');
    const res = c.result ? this._txt(c.result) : null;
    return {
      head: this._head(tone, this._scan.batt.length + ' dispositivi a batteria',
        this._pill(low ? 1 : 0, low ? low + ' sotto il ' + t + '%' : 'tutte cariche')),
      body:
        (list.length ? '<div class="sy-bts">' + tiles + '</div>' : '<div class="sy-p"><div class="sy-note">nessun sensore di batteria trovato</div></div>') +
        (res ? '<div class="sy-p sy-res">' + res + '</div>' : '') +
        (c.button ? '<div class="sy-btns"><button class="sy-btn" data-press="' + c.button + '">Verifica adesso</button></div>' : ''),
    };
  }

  // ---------- interazione ----------

  _wire() {
    const ask = (el) => {
      const q = el.getAttribute('data-ask');
      return !q || window.confirm(q);
    };
    this.querySelectorAll('[data-svc]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!this._hass || !ask(el)) return;
        const p = (el.getAttribute('data-svc') || '').split('.');
        if (p.length === 2) this._hass.callService(p[0], p[1], {});
      });
    });
    this.querySelectorAll('[data-toggle]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = el.getAttribute('data-toggle');
        if (id && this._hass && ask(el)) this._hass.callService('switch', 'toggle', { entity_id: id });
      });
    });
    this.querySelectorAll('[data-press]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = el.getAttribute('data-press');
        if (!id || !this._hass || !ask(el)) return;
        this._hass.callService(id.split('.')[0], 'press', { entity_id: id });
      });
    });
    this.querySelectorAll('[data-select]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = el.getAttribute('data-select');
        const opt = el.getAttribute('data-opt');
        if (id && opt && this._hass) this._hass.callService('select', 'select_option', { entity_id: id, option: opt });
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
      // Tutti i selettori partono da .sy-card: nel light DOM un `.sy-p` nudo
      // colpirebbe anche i contenitori della sezione (vedi la lezione delle
      // altre card della libreria).
      '.sy-card{container-type:inline-size;overflow:hidden;' +
      // fondo e testo vengono dal tema: la card NON si porta dietro un colore
      // proprio, altrimenti si stacca dal resto della dashboard
      '--sy-ok:#0E9B6C;--sy-warn:#B26A05;--sy-crit:#C0392B;--sy-mute:var(--secondary-text-color,#71767f);' +
      '--sy-panel:rgba(16,20,28,.045);--sy-hair:rgba(16,20,28,.10);--sy-t1:var(--primary-text-color,#14161a);' +
      '--sy-t2:var(--secondary-text-color,#70757f);}' +
      '.sy-card.sy-dark{--sy-ok:#35E0A1;--sy-warn:#FFB020;--sy-crit:#FF6B6B;' +
      '--sy-panel:rgba(255,255,255,.045);--sy-hair:rgba(255,255,255,.10);}' +
      '.sy-card *{box-sizing:border-box;}' +
      '.sy-card svg{display:block;}' +
      '.sy-card .sy-in{padding:18px 18px 20px;display:flex;flex-direction:column;gap:12px;' +
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--sy-t1);}' +
      '.sy-card .sy-ok{color:var(--sy-ok);}.sy-card .sy-warn{color:var(--sy-warn);}' +
      '.sy-card .sy-crit{color:var(--sy-crit);}.sy-card .sy-mute{color:var(--sy-mute);}' +

      // intestazione
      '.sy-card .sy-hd{display:flex;align-items:center;gap:13px;}' +
      '.sy-card .sy-hdi{width:44px;height:44px;flex:none;border-radius:14px;display:grid;place-items:center;' +
      'background:color-mix(in srgb,currentColor 13%,transparent);}' +
      '.sy-card .sy-hdi svg{width:22px;height:22px;}' +
      '.sy-card .sy-hdx{min-width:0;flex:1;}' +
      '.sy-card .sy-hdt{font-size:14.5px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;' +
      'line-height:1.2;}' +
      '.sy-card .sy-hds{font-size:12.5px;color:var(--sy-t2);margin-top:2px;overflow:hidden;' +
      'text-overflow:ellipsis;white-space:nowrap;}' +
      '.sy-card .sy-pill{flex:none;font-size:11.5px;font-weight:700;letter-spacing:.2px;border-radius:10px;' +
      'padding:6px 11px;background:color-mix(in srgb,currentColor 13%,transparent);white-space:nowrap;}' +

      // riquadri
      '.sy-card .sy-p{background:var(--sy-panel);border-radius:16px;padding:15px 17px 16px;min-width:0;}' +
      '.sy-card .sy-p2{display:grid;grid-template-columns:1fr 1fr;gap:17px;}' +
      '.sy-card .sy-p2>div:last-child{border-left:1px solid var(--sy-hair);padding-left:17px;}' +
      '.sy-card .sy-grid2{display:grid;grid-template-columns:1fr 1fr;gap:9px;}' +
      '.sy-card .sy-k{font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;' +
      'color:var(--sy-t2);}' +
      '.sy-card .sy-big{font-size:38px;font-weight:700;letter-spacing:-1.7px;line-height:1.12;margin-top:4px;' +
      'font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;}' +
      '.sy-card .sy-big small{font-size:15px;font-weight:600;letter-spacing:0;color:var(--sy-t2);margin-left:5px;}' +
      '.sy-card .sy-note{font-size:12.5px;color:var(--sy-t2);margin-top:6px;line-height:1.45;}' +
      '.sy-card .sy-spk{width:100%;height:30px;margin-top:10px;}' +

      // pillole di area
      '.sy-card .sy-chips{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}' +
      '.sy-card .sy-chip{display:flex;align-items:center;gap:8px;background:var(--sy-panel);' +
      'border-radius:12px;padding:10px 13px;font-size:12.5px;font-weight:600;min-width:0;}' +
      '.sy-card .sy-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.sy-card .sy-dot{width:7px;height:7px;border-radius:99px;flex:none;background:currentColor;}' +

      // riga narrativa
      '.sy-card .sy-nar{display:flex;align-items:center;gap:14px;}' +
      '.sy-card .sy-nari{width:46px;height:46px;flex:none;border-radius:99px;display:grid;place-items:center;' +
      'background:color-mix(in srgb,currentColor 15%,transparent);}' +
      '.sy-card .sy-nari svg{width:22px;height:22px;}' +
      '.sy-card .sy-nar p{margin:0;font-size:13.5px;line-height:1.5;}' +

      // righe di dettaglio
      '.sy-card .sy-lns{background:var(--sy-panel);border-radius:16px;padding:4px 17px;}' +
      '.sy-card .sy-ln{display:flex;align-items:center;gap:10px;padding:9px 0;font-size:13px;' +
      'border-bottom:1px solid var(--sy-hair);}' +
      '.sy-card .sy-ln:last-child{border-bottom:none;}' +
      '.sy-card .sy-ln[data-more]{cursor:pointer;}' +
      '.sy-card .sy-ln>span{flex:1;color:var(--sy-t2);min-width:0;overflow:hidden;text-overflow:ellipsis;' +
      'white-space:nowrap;}' +
      '.sy-card .sy-ln u{text-decoration:none;font-weight:650;font-variant-numeric:tabular-nums;' +
      'white-space:nowrap;flex:none;}' +
      '.sy-card .sy-ln u.sy-ok{color:var(--sy-t1);}' + // lo stato normale non urla in verde
      '.sy-card .sy-ln u.sy-mute{color:var(--sy-t2);}' +

      // comandi
      '.sy-card .sy-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}' +
      '.sy-card .sy-btn{font:inherit;font-size:12.5px;font-weight:650;cursor:pointer;border-radius:11px;' +
      'padding:9px 14px;border:1px solid var(--sy-hair);background:transparent;color:var(--sy-t2);' +
      'transition:border-color .15s,color .15s;}' +
      '.sy-card .sy-btn:hover{border-color:color-mix(in srgb,var(--sy-ok) 55%,transparent);color:var(--sy-ok);}' +
      '.sy-card .sy-btn.sy-warn:hover{border-color:color-mix(in srgb,var(--sy-warn) 60%,transparent);' +
      'color:var(--sy-warn);}' +
      '.sy-card .sy-btn:focus-visible{outline:2px solid var(--sy-ok);outline-offset:2px;}' +

      // batterie
      '.sy-card .sy-bts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;}' +
      '.sy-card .sy-bt{background:var(--sy-panel);border-radius:14px;padding:13px 14px 14px;cursor:pointer;' +
      'min-width:0;}' +
      '.sy-card .sy-btv{font-size:24px;font-weight:700;letter-spacing:-1px;line-height:1;' +
      'font-variant-numeric:tabular-nums;}' +
      '.sy-card .sy-btv small{font-size:12px;font-weight:600;color:var(--sy-t2);margin-left:2px;}' +
      '.sy-card .sy-btl{font-size:11.5px;color:var(--sy-t2);margin-top:6px;line-height:1.3;height:2.6em;' +
      'overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}' +
      '.sy-card .sy-bar{height:4px;border-radius:99px;background:var(--sy-hair);margin-top:8px;overflow:hidden;}' +
      '.sy-card .sy-bar i{display:block;height:100%;border-radius:99px;background:currentColor;}' +
      '.sy-card .sy-res{font-size:12.5px;color:var(--sy-t2);white-space:pre-wrap;line-height:1.5;}' +

      // la card vive dentro una colonna di sezione: a stringersi e' lei, non la
      // finestra, quindi i passaggi sono container query e non media query
      '@container (max-width:520px){' +
      '.sy-card .sy-in{padding:15px 15px 17px;gap:10px;}' +
      '.sy-card .sy-grid2{grid-template-columns:1fr;}' +
      '.sy-card .sy-chips{grid-template-columns:repeat(2,minmax(0,1fr));}' +
      '.sy-card .sy-bts{grid-template-columns:repeat(2,minmax(0,1fr));}' +
      '.sy-card .sy-big{font-size:31px;letter-spacing:-1.3px;}' +
      // in colonna stretta il sottotitolo va a capo invece di finire nei puntini
      '.sy-card .sy-hds{white-space:normal;}' +
      '}' +
      '@container (max-width:360px){' +
      '.sy-card .sy-p2{grid-template-columns:1fr;gap:14px;}' +
      '.sy-card .sy-p2>div:last-child{border-left:none;border-top:1px solid var(--sy-hair);' +
      'padding-left:0;padding-top:14px;}' +
      '.sy-card .sy-chips{grid-template-columns:1fr;}' +
      '}' +
      '</style>'
    );
  }
}

SystemCard.getStubConfig = function () {
  return { section: 'summary' };
};

customElements.define('casa-mgdd-system-card', SystemCard);
window.customCards.push({
  type: 'casa-mgdd-system-card',
  name: 'Casa MGDD Stato sistema',
  description:
    'Quadro di monitoraggio di Home Assistant, una sezione per card: summary, host, network, zigbee, backup, batteries. Tutte le entità hanno un valore predefinito.',
});

// ===== compact-cards.js =====
// Tre card compatte per la vista Home: aperture, perdite acqua, movimento.
// Sostituiscono una sezione di venti tile aperti (~900 px) con tre righe
// riassuntive da ~80 px, che si espandono al tocco.
//
// Anatomia comune, condivisa da MgddCompactCard:
//   riga di intestazione  icona · titolo · frase di stato · pastiglia · chevron
//   strip                 un segmento per sensore, colorato dal suo stato
//   corpo                 elenco di dettaglio, nascosto finche' non lo apri
//
// La strip NON e' un secondo elenco: e' generata dalle stesse righe del
// dettaglio, cosi' ordine e stati non possono divergere.
//
// Gli orari, come nella DoorsCard, vengono dal recorder e non da
// `last_changed`: dopo un riavvio di Home Assistant tutte le entita' passano
// per unavailable e `last_changed` diventerebbe l'ora del riavvio.

function mgddPad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function mgddHHMM(ts) {
  const d = new Date(ts);
  return mgddPad2(d.getHours()) + ':' + mgddPad2(d.getMinutes());
}

function mgddSameDay(ts, back) {
  const a = new Date(ts);
  const b = new Date();
  b.setDate(b.getDate() - (back || 0));
  return a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

// "14:07" oggi, "ieri 22:15", "03/08 09:40" piu' indietro.
function mgddWhen(ts) {
  if (mgddSameDay(ts, 0)) return mgddHHMM(ts);
  if (mgddSameDay(ts, 1)) return 'ieri ' + mgddHHMM(ts);
  const d = new Date(ts);
  return mgddPad2(d.getDate()) + '/' + mgddPad2(d.getMonth() + 1) + ' ' + mgddHHMM(ts);
}

function mgddDur(ms) {
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + mgddPad2(m % 60) + 'm';
  const g = Math.floor(h / 24);
  return g + (g === 1 ? ' giorno' : ' giorni');
}

function mgddEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MGDD_CI = {
  door: 'M3 21h18M6 21V3.6a.6.6 0 0 1 .6-.6h10.8a.6.6 0 0 1 .6.6V21M14.2 12.2h.01',
  window: 'M4 4h16v16H4zM12 4v16M4 12h16',
  lock: 'M5 11h14v10H5zM8.5 11V7a3.5 3.5 0 0 1 7 0v4',
  garage: 'M3 21V9.5L12 4l9 5.5V21M7 21v-7h10v7M7 17.2h10',
  water: 'M12 3.2s6 6.6 6 10a6 6 0 0 1-12 0c0-3.4 6-10 6-10z',
  presence: 'M12 11.2a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2zM5 20.5a7 7 0 0 1 14 0',
  shield: 'M12 3 5 6v5.5c0 4.4 3 8.1 7 9.5 4-1.4 7-5.1 7-9.5V6l-7-3zM9 12l2 2 4-4',
  motion: 'M13.5 5.2a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM9 22l2.2-5.4-2.4-2 .8-4.4-3.1 1.6L5 14M11.8 14.6l3.4 1.4L17 22M19.5 7.5a5.5 5.5 0 0 1 0 7M4.5 7.5a5.5 5.5 0 0 0 0 7',
  chev: 'M6 9.5 12 15.5l6-6',
};

function mgddIcon(kind, sw) {
  const d = MGDD_CI[kind] || MGDD_CI.door;
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.7) +
    '" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
}

// stato della riga -> classe del segmento nella strip
const MGDD_SEG = { open: 'w', wet: 'a', on: 'm', off: 'n', na: 'na' };

class MgddCompactCard extends HTMLElement {
  // ---------- ciclo di vita ----------

  set hass(hass) {
    this._hass = hass;
    const sig = mgddStatesSig(hass, this._ids());
    if (sig !== this._sig) {
      this._sig = sig;
      this._render();
    }
    this._maybeFetchHistory();
  }

  // In una vista a sezioni la card cambia altezza quando la apri: `auto` lascia
  // che sia il contenuto a decidere, invece di riservare righe fisse.
  getGridOptions() {
    return { rows: 'auto', columns: 'full', min_columns: 6 };
  }

  getCardSize() {
    return this._expanded ? 2 + Math.ceil(this._rows().length / 2) : 1;
  }

  _ids() {
    return (this._items() || []).map((i) => i.entity).filter(Boolean);
  }

  _st(entity) {
    return (this._hass && this._hass.states[entity]) || null;
  }

  _avail(s) {
    return !!(s && s.state !== 'unavailable' && s.state !== 'unknown' && s.state !== 'None');
  }

  // ---------- cronologia dal recorder ----------

  async _maybeFetchHistory() {
    const now = Date.now();
    if (this._histAt && now - this._histAt < 2 * 60 * 1000) return;
    this._histAt = now;
    if (!this._hass) return;
    const ids = this._ids();
    if (!ids.length) return;
    const hours = this._hours();
    const start = new Date(now - hours * 3600 * 1000).toISOString();
    try {
      // `end_time` e' obbligatorio, non un di piu': senza, l'endpoint REST non
      // arriva a adesso ma si ferma a UN GIORNO dopo `start` (e' il default
      // documentato). Chiedendo sette giorni si riceveva la sola giornata del
      // 31 luglio, e il portone del garage risultava "aperto dal 1° agosto".
      // `no_attributes` alleggerisce la query: con minimal_response gli
      // attributi non vengono comunque letti.
      const path = 'history/period/' + start + '?end_time=' + encodeURIComponent(new Date(now).toISOString()) +
        '&filter_entity_id=' + ids.join(',') + '&minimal_response&no_attributes';
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
          // tratti uguali ricuciti: si tiene il timestamp del cambio vero
          if (!ev.length || ev[ev.length - 1].state !== s.state) ev.push({ state: s.state, ts: ts });
        });
        out[id] = ev;
      });
      this._hist = out;
      this._render();
    } catch (e) {
      /* recorder non disponibile: restano gli stati correnti, senza orari */
    }
  }

  // Ultimo cambio reale. Il primo elemento e' lo stato a inizio finestra, non
  // una transizione: con meno di due elementi l'entita' non si e' mai mossa.
  _last(entity) {
    const ev = (this._hist || {})[entity];
    if (!ev || ev.length < 2) return null;
    return ev[ev.length - 1];
  }

  // Ultima accensione, non ultimo cambio. Per un sensore di movimento sono due
  // istanti diversi e quello che interessa e' il primo: se alle 11:26:46 e'
  // passato qualcuno e alle 11:27:02 il sensore e' ricaduto, "ultimo movimento"
  // sono le 11:26, non le 11:27.
  _lastOn(entity) {
    const ev = (this._hist || {})[entity];
    if (!ev) return null;
    for (let i = ev.length - 1; i >= 1; i--) {
      if (ev[i].state === 'on') return ev[i];
    }
    return null;
  }

  // Evento piu' recente fra tutte le entita' della card, con l'entita' che lo
  // ha prodotto: il riassunto vuole dire anche *chi* si e' mosso per ultimo.
  _lastAny() {
    let best = null;
    this._ids().forEach((id) => {
      const e = this._last(id);
      if (e && (!best || e.ts > best.ts)) best = { ts: e.ts, state: e.state, entity: id };
    });
    return best;
  }

  // Testo della colonna oraria quando nella finestra non c'e' nessuna
  // transizione. Un trattino direbbe "non lo so"; questo dice la cosa vera,
  // cioe' che l'ultimo movimento e' piu' vecchio di quanto la card guardi.
  _older() {
    const h = this._hours();
    return '> ' + (h >= 48 ? Math.floor(h / 24) + ' gg' : h + ' h');
  }

  _hours() {
    return (this.config && this.config.history_hours) || this._defaultHours();
  }

  _defaultHours() {
    return 48;
  }

  // ---------- markup ----------

  _render() {
    if (!this.config || !this._hass) return;
    mgddPaint(this, this._styles(), this._html());
    // mgddPaint ha ricostruito il sottoalbero, quindi il corpo e' tornato allo
    // stato di riposo del CSS: lo si riporta dov'era, ma senza animazione. Un
    // aggiornamento di stato non e' un'apertura.
    this._setBody(false);
    this._wire();
  }

  _html() {
    const groups = this._groups();
    const rows = [];
    groups.forEach((g) => g.rows.forEach((r) => rows.push(r)));
    const S = this._summary(rows);

    const strip = rows
      .map((r) =>
        '<span class="mc-seg ' + (MGDD_SEG[r.state] || 'ok') + '" tabindex="0" role="button"' +
        ' data-more="' + mgddEsc(r.entity) + '"' +
        ' data-n="' + mgddEsc(r.name) + '" data-s="' + mgddEsc(r.label) + '"' +
        ' aria-label="' + mgddEsc(r.name + ', ' + r.label) + '"><i></i></span>'
      )
      .join('');

    let body = '';
    groups.forEach((g) => {
      if (g.name) body += '<div class="mc-zone">' + mgddEsc(g.name) + '</div>';
      const html = g.rows.map((r) => this._rowHtml(r)).join('');
      body += this._twoCol() ? '<div class="mc-grid">' + html + '</div>' : html;
    });

    return (
      '<div class="mc' + (this._isDark() ? ' mc-dark' : '') + '" data-open="' + (this._expanded ? 'true' : 'false') + '">' +
      '<button class="mc-hd" type="button" aria-expanded="' + (this._expanded ? 'true' : 'false') + '">' +
      '<span class="mc-ic ' + S.tone + '">' + mgddIcon(S.icon) + '</span>' +
      '<span class="mc-tx"><span class="mc-t">' + mgddEsc(S.title) + '</span>' +
      '<span class="mc-s">' + S.sub + '</span></span>' +
      '<span class="mc-pill ' + S.pill.cls + '">' + mgddEsc(S.pill.txt) + '</span>' +
      '<svg class="mc-cv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="' + MGDD_CI.chev + '"/></svg>' +
      '</button>' +
      '<div class="mc-strip">' + strip + '<div class="mc-tip"></div></div>' +
      '<div class="mc-bd"><div class="mc-in">' + body + '</div></div>' +
      '</div>'
    );
  }

  _rowHtml(r) {
    const cls = r.state ? ' ' + r.state : '';
    return (
      '<div class="mc-r' + cls + '" data-more="' + mgddEsc(r.entity) + '">' +
      '<span class="mc-ri">' + mgddIcon(r.icon) + '</span>' +
      '<span class="mc-rn"><b>' + mgddEsc(r.name) + '</b><i>' + mgddEsc(r.label) + '</i></span>' +
      '<span class="mc-rt">' + mgddEsc(r.time) + '</span></div>'
    );
  }

  _isDark() {
    return !!(this._hass && this._hass.themes && this._hass.themes.darkMode);
  }

  // ---------- interazione ----------
  //
  // Tutto per delega sull'host e legato una volta sola: mgddPaint riscrive il
  // sottoalbero a ogni aggiornamento e i listener sui nodi interni sparirebbero.

  _wire() {
    if (this._wired) return;
    this._wired = true;

    this.addEventListener('touchstart', () => { this._touch = true; }, { passive: true });

    this.addEventListener('click', (ev) => {
      const seg = ev.target.closest ? ev.target.closest('.mc-seg') : null;
      if (seg) {
        // il tocco sulla strip parla al tooltip, non all'intestazione
        ev.stopPropagation();
        if (this._tipOn === seg) this._hideTip();
        else this._showTip(seg);
        return;
      }
      const hd = ev.target.closest ? ev.target.closest('.mc-hd') : null;
      if (hd) {
        this._toggle();
        return;
      }
      const row = ev.target.closest ? ev.target.closest('.mc-r') : null;
      const id = row && row.getAttribute('data-more');
      if (id) {
        this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
      }
    });

    // col mouse il tooltip segue il passaggio; col dito lo apre il tocco e lo
    // chiude il tocco successivo, perche' un hover non arriva mai
    this.addEventListener('pointerover', (ev) => {
      if (this._touch) return;
      const seg = ev.target.closest ? ev.target.closest('.mc-seg') : null;
      if (seg) this._showTip(seg);
      else if (this._tipOn) this._hideTip();
    });
    this.addEventListener('pointerleave', () => { if (!this._touch) this._hideTip(); });

    this.addEventListener('focusin', (ev) => {
      const seg = ev.target.closest ? ev.target.closest('.mc-seg') : null;
      if (seg) this._showTip(seg);
    });
    this.addEventListener('focusout', () => this._hideTip());
    this.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this._hideTip();
    });
  }

  // Apre e chiude senza rigenerare l'HTML: una ricostruzione salterebbe la
  // transizione, perche' il nodo nuovo nasce gia' nello stato di arrivo.
  _toggle() {
    this._expanded = !this._expanded;
    const card = this.querySelector('.mc');
    const hd = this.querySelector('.mc-hd');
    if (card) card.dataset.open = this._expanded ? 'true' : 'false';
    if (hd) hd.setAttribute('aria-expanded', this._expanded ? 'true' : 'false');
    this._setBody(true);
  }

  // Porta il corpo allo stato corrente. `animate` distingue il gesto
  // dell'utente dal semplice ridisegno.
  //
  // L'altezza di arrivo e' scrollHeight, misurato al momento; a transizione
  // finita si passa a `none`, cosi' il contenuto resta libero di crescere (una
  // riga che si riflowa girando il telefono, un'etichetta che si allunga) senza
  // restare tagliato da un'altezza congelata.
  _setBody(animate) {
    const bd = this.querySelector('.mc-bd');
    if (!bd) return;
    if (this._endTimer) {
      clearTimeout(this._endTimer);
      this._endTimer = null;
    }
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;

    // Nessun interruttore da spegnere e riaccendere per saltare l'animazione:
    // `none` non e' un valore interpolabile, quindi assegnarlo salta di suo. Il
    // vecchio giro con `transition:none` e un rAF per rimetterla lasciava la
    // transizione spenta per sempre in una scheda i cui frame non girano.
    if (!animate || reduce) {
      bd.style.maxHeight = this._expanded ? 'none' : '0px';
      return;
    }

    if (this._expanded) {
      bd.style.maxHeight = bd.scrollHeight + 'px';
      this._endTimer = setTimeout(() => { bd.style.maxHeight = 'none'; }, 300);
    } else {
      // da `none` non si anima: si fissa l'altezza reale, si forza un reflow,
      // poi si scende a zero
      bd.style.maxHeight = bd.scrollHeight + 'px';
      void bd.offsetHeight;
      bd.style.maxHeight = '0px';
    }
  }

  _showTip(seg) {
    const strip = seg.parentNode;
    const tip = strip && strip.querySelector('.mc-tip');
    if (!tip) return;
    if (this._tipOn && this._tipOn !== seg) this._tipOn.classList.remove('on');
    this._tipOn = seg;
    seg.classList.add('on');
    tip.innerHTML = '<b>' + mgddEsc(seg.dataset.n) + '</b><s>' + mgddEsc(seg.dataset.s) + '</s>';
    tip.classList.add('on');
    // ancorato al centro del segmento, poi rientrato dentro i bordi della card
    const sr = seg.getBoundingClientRect();
    const pr = strip.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const x = sr.left - pr.left + sr.width / 2;
    tip.style.left = Math.max(half + 4, Math.min(pr.width - half - 4, x)) + 'px';
  }

  _hideTip() {
    const tip = this.querySelector('.mc-tip');
    if (tip) tip.classList.remove('on');
    if (this._tipOn) this._tipOn.classList.remove('on');
    this._tipOn = null;
  }

  // ---------- da implementare nelle sottoclassi ----------
  _items() { return []; }
  _groups() { return []; }
  _rows() { const r = []; this._groups().forEach((g) => g.rows.forEach((x) => r.push(x))); return r; }
  _summary() { return { tone: '', icon: 'shield', title: '', sub: '', pill: { cls: '', txt: '' } }; }
  _twoCol() { return false; }

  _styles() {
    return (
      '<style>' +
      ':host{display:block;}' +
      // Sfondo, bordo e testi sono token del tema, come nella energy-summary-card:
      // la card deve sembrare una card di Home Assistant. Restano nostri solo i
      // colori semantici, che cambiano fra chiaro e scuro.
      '.mc{background:var(--ha-card-background,var(--card-background-color,#fff));' +
      'border:1px solid var(--divider-color,rgba(0,0,0,.08));' +
      'border-radius:var(--ha-card-border-radius,16px);overflow:hidden;container-type:inline-size;' +
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      '--mc-t1:var(--primary-text-color,#14161a);--mc-t2:var(--secondary-text-color,#858b95);' +
      '--mc-hair:var(--divider-color,rgba(16,20,28,.09));' +
      '--mc-ok:#0E9B6C;--mc-warn:#C07405;--mc-warn2:#8A5300;--mc-alarm:#C2413E;--mc-move:#6A57E0;' +
      '--mc-glow:none;' +
      '--mc-open:linear-gradient(150deg,#D68C0C,#A96303);--mc-opensh:0 8px 22px rgba(201,130,13,.24);' +
      '--mc-wet:linear-gradient(150deg,#D2504C,#9E2F2C);--mc-wetsh:0 8px 22px rgba(190,60,56,.24);}' +
      '.mc.mc-dark{--mc-ok:#35E0A1;--mc-warn:#FFB020;--mc-warn2:#FFD48A;--mc-alarm:#FF7B6E;' +
      '--mc-move:#9083FF;--mc-glow:0 0 7px currentColor;' +
      '--mc-open:linear-gradient(150deg,#C9820D,#9A5A02);--mc-opensh:0 8px 22px rgba(201,130,13,.30);' +
      '--mc-wet:linear-gradient(150deg,#B8433F,#7E2321);--mc-wetsh:0 8px 22px rgba(190,60,56,.30);}' +
      '.mc *{box-sizing:border-box;}' +
      '.mc svg{display:block;}' +

      '.mc-hd{width:100%;display:flex;align-items:center;gap:11px;padding:10px 12px;' +
      'background:none;border:none;text-align:left;font:inherit;color:inherit;cursor:pointer;}' +
      '.mc-hd:focus-visible{outline:2px solid var(--mc-ok);outline-offset:-3px;}' +
      '.mc-ic{width:36px;height:36px;border-radius:11px;flex:none;display:grid;place-items:center;' +
      'color:var(--mc-ok);background:color-mix(in srgb,var(--mc-ok) 13%,transparent);}' +
      '.mc-ic svg{width:20px;height:20px;}' +
      '.mc-ic.w{color:var(--mc-warn);background:color-mix(in srgb,var(--mc-warn) 15%,transparent);}' +
      '.mc-ic.a{color:var(--mc-alarm);background:color-mix(in srgb,var(--mc-alarm) 15%,transparent);}' +
      '.mc-ic.m{color:var(--mc-move);background:color-mix(in srgb,var(--mc-move) 14%,transparent);}' +
      '.mc-tx{flex:1;min-width:0;}' +
      '.mc-t{display:block;font-size:13.5px;font-weight:580;color:var(--mc-t1);letter-spacing:-.01em;line-height:1.25;}' +
      '.mc-s{display:block;font-size:11.5px;color:var(--mc-t2);white-space:nowrap;overflow:hidden;' +
      'text-overflow:ellipsis;margin-top:1px;}' +
      '.mc-s em{font-style:normal;color:var(--mc-warn2);font-weight:600;}' +
      '.mc-s em.a{color:var(--mc-alarm);}' +
      '.mc-pill{flex:none;font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;' +
      'padding:4px 9px;border-radius:99px;font-variant-numeric:tabular-nums;' +
      'color:var(--mc-ok);background:color-mix(in srgb,var(--mc-ok) 13%,transparent);}' +
      '.mc-pill.w{color:var(--mc-warn2);background:color-mix(in srgb,var(--mc-warn) 20%,transparent);}' +
      '.mc-pill.a{color:var(--mc-alarm);background:color-mix(in srgb,var(--mc-alarm) 16%,transparent);}' +
      '.mc-pill.m{color:var(--mc-move);background:color-mix(in srgb,var(--mc-move) 14%,transparent);}' +
      '.mc-pill.n{color:var(--mc-t2);background:color-mix(in srgb,var(--mc-t2) 16%,transparent);}' +
      '.mc-cv{width:18px;height:18px;flex:none;color:var(--mc-t2);transition:transform .22s ease;}' +
      '.mc[data-open="true"] .mc-cv{transform:rotate(180deg);}' +

      // La barra resta 5px, ma l'area sensibile e' 20px: un bersaglio da 5px
      // col pollice non si centra. Il padding sta sullo <span>, la barra e' la <i>.
      '.mc-strip{display:flex;gap:3px;padding:0 12px 4px;position:relative;}' +
      '.mc-seg{flex:1;height:20px;display:flex;align-items:center;cursor:pointer;' +
      '-webkit-tap-highlight-color:transparent;}' +
      '.mc-seg i{display:block;width:100%;height:5px;border-radius:99px;transition:height .12s ease;' +
      'background:color-mix(in srgb,var(--mc-ok) 42%,transparent);}' +
      '.mc-seg.w i{background:var(--mc-warn);color:var(--mc-warn);box-shadow:var(--mc-glow);}' +
      '.mc-seg.a i{background:var(--mc-alarm);color:var(--mc-alarm);box-shadow:var(--mc-glow);}' +
      '.mc-seg.m i{background:var(--mc-move);color:var(--mc-move);box-shadow:var(--mc-glow);}' +
      '.mc-seg.n i{background:color-mix(in srgb,var(--mc-t2) 45%,transparent);}' +
      '.mc-seg.na i{background:repeating-linear-gradient(45deg,' +
      'color-mix(in srgb,var(--mc-t2) 55%,transparent) 0 2px,transparent 2px 4px);}' +
      '.mc-seg.on i,.mc-seg:hover i{height:8px;}' +
      '.mc-seg:focus-visible{outline:2px solid var(--mc-ok);outline-offset:2px;border-radius:99px;}' +

      // stesso stile di .zc-tip nella temperature-bento-card
      '.mc-tip{position:absolute;bottom:20px;transform:translateX(-50%);' +
      'background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--mc-t1);' +
      'border:1px solid var(--divider-color,rgba(0,0,0,.1));box-shadow:0 6px 18px rgba(0,0,0,.18);' +
      'border-radius:10px;padding:5px 9px;font-size:11px;font-weight:600;white-space:nowrap;' +
      'opacity:0;pointer-events:none;transition:opacity .1s;z-index:3;}' +
      '.mc-tip.on{opacity:1;}' +
      '.mc-tip s{text-decoration:none;font-weight:500;color:var(--mc-t2);}' +
      '.mc-tip s::before{content:" \\00b7 ";}' +

      // L'apertura anima su max-height, non sul trucco grid 0fr/1fr: con
      // overflow:hidden sul contenuto la traccia flessibile resta a zero e la
      // card non cresce affatto. L'altezza di arrivo la misura _setBody(), cosi'
      // non c'e' nessun valore inventato da tenere allineato al contenuto.
      '.mc-bd{overflow:hidden;max-height:0;transition:max-height .26s ease;}' +
      '.mc-in{padding:2px 12px 10px;border-top:1px solid var(--mc-hair);}' +
      '@media (prefers-reduced-motion:reduce){.mc-bd,.mc-cv,.mc-seg i{transition:none;}}' +

      '.mc-zone{font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;' +
      'color:var(--mc-t2);padding:11px 2px 4px;}' +
      '.mc-r{display:flex;align-items:center;gap:10px;padding:7px 2px;min-height:40px;' +
      'border-bottom:1px solid var(--mc-hair);cursor:pointer;}' +
      '.mc-r:last-child{border-bottom:none;}' +
      '.mc-ri{width:28px;height:28px;border-radius:9px;flex:none;display:grid;place-items:center;' +
      'color:var(--mc-ok);background:color-mix(in srgb,var(--mc-ok) 12%,transparent);}' +
      '.mc-ri svg{width:16px;height:16px;}' +
      '.mc-rn{flex:1;min-width:0;}' +
      '.mc-rn b{display:block;font-size:12.5px;font-weight:520;color:var(--mc-t1);line-height:1.3;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.mc-rn i{font-style:normal;font-size:9.5px;font-weight:700;letter-spacing:.1em;' +
      'text-transform:uppercase;color:var(--mc-ok);}' +
      '.mc-rt{font-size:12.5px;font-weight:600;color:var(--mc-t2);font-variant-numeric:tabular-nums;' +
      'letter-spacing:-.02em;white-space:nowrap;}' +
      '.mc-r.open{background:var(--mc-open);border-radius:12px;border-bottom:none;padding:8px 10px;' +
      'margin:3px 0;box-shadow:var(--mc-opensh);}' +
      '.mc-r.open .mc-ri{background:rgba(255,255,255,.22);color:#fff;}' +
      '.mc-r.open .mc-rn b,.mc-r.open .mc-rn i,.mc-r.open .mc-rt{color:#fff;}' +
      '.mc-r.wet{background:var(--mc-wet);border-radius:12px;border-bottom:none;padding:8px 10px;' +
      'margin:3px 0;box-shadow:var(--mc-wetsh);}' +
      '.mc-r.wet .mc-ri{background:rgba(255,255,255,.22);color:#fff;}' +
      '.mc-r.wet .mc-rn b,.mc-r.wet .mc-rn i,.mc-r.wet .mc-rt{color:#fff;}' +
      '.mc-r.on .mc-ri{color:var(--mc-move);background:color-mix(in srgb,var(--mc-move) 13%,transparent);}' +
      '.mc-r.on .mc-rn i{color:var(--mc-move);}' +
      '.mc-r.off .mc-ri{color:var(--mc-t2);background:color-mix(in srgb,var(--mc-t2) 13%,transparent);}' +
      '.mc-r.off .mc-rn i{color:var(--mc-t2);}' +
      '.mc-r.na{opacity:.62;}' +
      '.mc-r.na .mc-ri{color:var(--mc-warn);background:color-mix(in srgb,var(--mc-warn) 14%,transparent);}' +
      '.mc-r.na .mc-rn i{color:var(--mc-warn2);}' +

      '.mc-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;}' +
      '@container (max-width:420px){.mc-grid{grid-template-columns:1fr;}}' +
      '</style>'
    );
  }
}

// ---------------------------------------------------------------------------
// casa-mgdd-openings-card — porte, finestre e serrature, raggruppate per zona
// ---------------------------------------------------------------------------
class OpeningsCard extends MgddCompactCard {
  setConfig(config) {
    if (!config || !Array.isArray(config.zones) || !config.zones.length) {
      throw new Error('Config "zones" mancante o vuota');
    }
    this.config = Object.assign({ title: 'Porte e finestre' }, config);
    this._expanded = !!config.expanded;
    this._sig = null;
    this._hist = {};
    this._histAt = 0;
  }

  // Una finestra che sta chiusa per giorni e' la normalita': con 48 ore meta'
  // delle righe restavano senza orario, perche' nella finestra c'erano solo i
  // passaggi da unavailable dei riavvii, che vengono scartati. Sette giorni
  // costano poco proprio perche' queste entita' cambiano di rado.
  _defaultHours() {
    return 168;
  }

  static getStubConfig() {
    return { zones: [{ name: 'Zona giorno', items: [] }] };
  }

  _items() {
    const out = [];
    (this.config.zones || []).forEach((z) => (z.items || []).forEach((i) => out.push(i)));
    return out;
  }

  // Icona per difetto dalla device_class, cosi' la config non deve ripeterla.
  _iconOf(item, s) {
    if (item.icon) return item.icon;
    if (item.entity && item.entity.indexOf('lock.') === 0) return 'lock';
    const dc = (s && s.attributes && s.attributes.device_class) || '';
    if (dc === 'window' || dc === 'opening') return 'window';
    if (dc === 'garage_door' || dc === 'garage') return 'garage';
    return 'door';
  }

  // [aperta, chiusa] col genere giusto per il tipo di apertura.
  _labelsOf(item, icon) {
    if (item.open_label || item.closed_label) return [item.open_label || 'Aperto', item.closed_label || 'Chiuso'];
    if (icon === 'lock') return ['Sbloccata', 'Bloccata'];
    if (icon === 'garage') return ['Aperto', 'Chiuso'];
    return ['Aperta', 'Chiusa'];
  }

  _mkRow(item) {
    const s = this._st(item.entity);
    const icon = this._iconOf(item, s);
    const isLock = icon === 'lock';
    const avail = this._avail(s);
    // Una Nuki passa anche per `open` (scrocco tirato) e `opening`: sono stati
    // in cui la porta NON e' chiusa a chiave, e contarli come "bloccata"
    // direbbe il falso proprio nel momento in cui conta.
    const active = avail && (isLock ? s.state !== 'locked' && s.state !== 'locking' : s.state === 'on');
    const L = this._labelsOf(item, icon);
    const ev = this._last(item.entity);
    const name = item.name || (s && s.attributes && s.attributes.friendly_name) || item.entity;

    let label;
    if (!avail) label = 'Non disponibile';
    else if (active) label = L[0] + (ev ? ' da ' + mgddDur(Date.now() - ev.ts) : '');
    else label = L[1];

    return {
      entity: item.entity,
      name: name,
      icon: icon,
      label: label,
      time: !avail ? '—' : ev ? mgddWhen(ev.ts) : this._older(),
      state: !avail ? 'na' : active ? 'open' : '',
      active: !!active,
      lock: isLock,
      // parola da usare nel riassunto: "aperto" per il portone, "aperta" per una
      // finestra, "sbloccata" per la serratura. Il genere lo detta l'apertura.
      word: L[0].toLowerCase(),
      ts: ev ? ev.ts : 0,
    };
  }

  _groups() {
    return (this.config.zones || []).map((z) => {
      const rows = (z.items || []).map((i) => this._mkRow(i));
      // dentro la zona le aperture salgono in cima: sono l'unica cosa da guardare
      rows.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
      return { name: z.name || null, rows: rows };
    });
  }

  _summary(rows) {
    const act = rows.filter((r) => r.active);
    const na = rows.filter((r) => r.state === 'na');
    const title = this.config.title;
    const naTail = na.length ? ' · <em>' + mgddEsc(na[0].name) + ' non disponibile</em>' : '';

    if (!act.length) {
      // Se non c'e' niente di aperto, l'ultimo evento di chiunque e' per forza
      // una chiusura: fosse un'apertura, quella riga sarebbe fra le attive.
      const ev = this._lastAny();
      const chi = ev && rows.filter((r) => r.entity === ev.entity)[0];
      let sub = 'Tutte chiuse';
      if (chi) sub += ' · ultima ' + mgddEsc(chi.name) + ' ' + mgddWhen(ev.ts);
      return { tone: '', icon: 'shield', title: title, sub: sub + naTail, pill: { cls: '', txt: 'Tutte chiuse' } };
    }

    const f = act[0];
    let sub = '<em>' + mgddEsc(f.name) + ' ' + f.word + '</em>';
    if (f.ts) sub += ' dalle ' + mgddHHMM(f.ts) + ' · ' + mgddDur(Date.now() - f.ts);
    if (act.length === 2) sub += ' · e un’altra';
    else if (act.length > 2) sub += ' · e altre ' + (act.length - 1);

    // Al singolare la pastiglia prende la parola dell'apertura ("1 aperto" per il
    // portone, "1 sbloccata" per la serratura). Al plurale servirebbe un genere
    // che un elenco misto non ha: "2 aperture" e' l'unica forma sempre vera.
    const txt = act.length === 1 ? '1 ' + f.word : act.length + ' aperture';

    return {
      tone: 'w',
      icon: 'shield',
      title: title,
      sub: sub + naTail,
      pill: { cls: 'w', txt: txt },
    };
  }
}

customElements.define('casa-mgdd-openings-card', OpeningsCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'casa-mgdd-openings-card',
  name: 'Casa MGDD Aperture (compatta)',
  description: 'Riga riassuntiva di porte, finestre e serrature con strip per sensore e dettaglio espandibile. Config via YAML.',
});

// ---------------------------------------------------------------------------
// casa-mgdd-sensors-card — perdite acqua oppure movimento, stessa anatomia
// ---------------------------------------------------------------------------
const MGDD_MODES = {
  water: {
    title: 'Perdite acqua',
    icon: 'water',
    rowIcon: 'water',
    on: 'Bagnato',
    off: 'Asciutto',
    tone: 'a',
    seg: 'wet',
    okPill: 'Asciutto',
    // I nomi sono aree, e l'area puo' essere maschile o femminile: la frase gira
    // attorno al nome invece di concordarci ("Perdita in Lavanderia").
    subOn: (n) => 'Perdita in <em class="a">' + n + '</em>',
    alarmPill: (n) => n + (n === 1 ? ' allarme' : ' allarmi'),
    idle: (n) => 'Tutti e ' + n + ' i sensori asciutti',
    idleOne: 'Sensore asciutto',
  },
  motion: {
    title: 'Movimento',
    icon: 'motion',
    rowIcon: 'presence',
    on: 'Movimento',
    off: 'Assente',
    tone: 'm',
    seg: 'on',
    okPill: 'Nessuno',
    subOn: (n) => 'Movimento in <em>' + n + '</em>',
    alarmPill: (n) => n + (n === 1 ? ' attivo' : ' attivi'),
    idle: () => 'Nessun movimento',
    idleOne: 'Nessun movimento',
  },
};

class SensorsCard extends MgddCompactCard {
  setConfig(config) {
    if (!config || !Array.isArray(config.items) || !config.items.length) {
      throw new Error('Config "items" mancante o vuota');
    }
    const mode = config.mode || 'water';
    if (!MGDD_MODES[mode]) throw new Error('mode deve essere "water" oppure "motion"');
    this.config = Object.assign({}, config, { mode: mode });
    this._m = MGDD_MODES[mode];
    this._expanded = !!config.expanded;
    this._sig = null;
    this._hist = {};
    this._histAt = 0;
  }

  // Un sensore di movimento fa centinaia di transizioni al giorno e l'ultima e'
  // quasi sempre di poche ore fa: due giorni bastano e la query resta corta. Un
  // sensore di allagamento invece, se funziona, non cambia mai: li' serve una
  // finestra larga per avere qualcosa da mostrare.
  _defaultHours() {
    return this.config.mode === 'motion' ? 48 : 168;
  }

  static getStubConfig() {
    return { mode: 'water', items: [] };
  }

  _items() {
    return this.config.items || [];
  }

  _twoCol() {
    return this.config.columns !== 1;
  }

  _mkRow(item) {
    const M = this._m;
    const s = this._st(item.entity);
    const avail = this._avail(s);
    const active = avail && s.state === 'on';
    const ev = this._last(item.entity);
    // Due istanti diversi: `ev` e' l'ultimo cambio (da quando e' assente),
    // `on` e' l'ultima accensione (quando e' passato qualcuno). L'etichetta
    // vuole il primo, la colonna oraria il secondo.
    const on = this._lastOn(item.entity);
    const name = item.name || (s && s.attributes && s.attributes.friendly_name) || item.entity;

    let label;
    if (!avail) label = 'Non disponibile';
    else if (active) label = M.on + (ev ? ' da ' + mgddDur(Date.now() - ev.ts) : '');
    else if (ev) label = M.off + ' da ' + mgddDur(Date.now() - ev.ts);
    else label = M.off;

    const stamp = active ? on || ev : on;
    return {
      entity: item.entity,
      name: name,
      icon: item.icon || M.rowIcon,
      label: label,
      time: !avail ? '—' : stamp ? mgddWhen(stamp.ts) : this._older(),
      state: !avail ? 'na' : active ? M.seg : 'off',
      active: !!active,
      ts: ev ? ev.ts : 0,
      // istante dell'ultimo evento vero (accensione), quello che il riassunto
      // chiama "ultimo movimento" / "ultima perdita"
      onTs: on ? on.ts : 0,
    };
  }

  _groups() {
    const rows = this._items().map((i) => this._mkRow(i));
    // attivi in cima, poi dall'evento piu' recente: la coda e' quella che non
    // succede da giorni, e sta bene in fondo
    rows.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.ts - a.ts);
    return [{ name: null, rows: rows }];
  }

  _summary(rows) {
    const M = this._m;
    const motion = this.config.mode === 'motion';
    const title = this.config.title || M.title;
    const act = rows.filter((r) => r.active);
    const na = rows.filter((r) => r.state === 'na');
    const naTail = na.length ? ' · <em>' + mgddEsc(na[0].name) + ' non disponibile</em>' : '';

    if (act.length) {
      const f = act[0];
      let sub = M.subOn(mgddEsc(f.name));
      if (f.ts) sub += ' dalle ' + mgddHHMM(f.ts);
      if (act.length === 2) sub += ' · e un altro';
      else if (act.length > 2) sub += ' · e altri ' + (act.length - 1);
      return {
        tone: M.tone,
        icon: M.icon,
        title: title,
        sub: sub + naTail,
        pill: { cls: M.tone, txt: M.alarmPill(act.length) },
      };
    }

    // A riposo la frase utile non e' "tutto a posto" ma quando e' successo
    // l'ultima volta: per il movimento e' l'unico dato che si legge di sfuggita.
    // Si ordina su onTs, l'ultima accensione, non sull'ultimo cambio: quello
    // sarebbe l'istante in cui il sensore e' ricaduto, che non dice niente.
    const ok = rows.filter((r) => r.state !== 'na');
    const recent = ok.filter((r) => r.onTs).sort((a, b) => b.onTs - a.onTs)[0];
    let sub;
    if (motion && recent) {
      // Solo l'orario, non anche "8 min fa": il tempo trascorso e' gia' nella
      // riga del dettaglio, e qui il sub deve lasciare spazio all'avviso di un
      // sensore non disponibile.
      sub = 'Ultimo movimento: ' + mgddEsc(recent.name) + ' ' + mgddWhen(recent.onTs);
    } else {
      sub = ok.length === 1 ? M.idleOne : M.idle(ok.length);
      if (recent) sub += ' · ultima ' + mgddWhen(recent.onTs);
    }

    return {
      tone: motion ? 'm' : '',
      icon: M.icon,
      title: title,
      sub: sub + naTail,
      pill: { cls: motion ? 'n' : '', txt: M.okPill },
    };
  }
}

customElements.define('casa-mgdd-sensors-card', SensorsCard);
window.customCards.push({
  type: 'casa-mgdd-sensors-card',
  name: 'Casa MGDD Sensori (compatta)',
  description: 'Riga riassuntiva di perdite acqua (mode: water) o movimento (mode: motion), con strip per sensore e dettaglio espandibile. Config via YAML.',
});

// ===== energy-live-card.js =====
// La card energia della vista Home. Tre pezzi, dall'alto in basso:
//
//   intestazione   stile Horizon come la casa-mgdd-system-card
//   consuntivo     consumo di casa di oggi + profilo orario a barre impilate
//   fascia live    pannelli, casa, batteria e rete adesso
//
// Il profilo orario e' quello della energy-power-card, stesse misure e stessi
// colori: chi guarda la vista Energy e poi la Home deve vedere lo stesso
// grafico, non un parente alla lontana.
//
// La scomposizione oraria segue la stessa regola del bilancio della
// energy-power-card: il solare copre per primo, poi la batteria, e solo il
// residuo viene dalla rete. Qui manca il correttivo per la batteria caricata da
// rete (in questo impianto la rete carica la batteria per pochi decimi l'anno),
// quindi il conto e' piu' semplice ma la gerarchia e' la stessa.

const EL_COLORS = {
  light: { sun: '#E08A00', bat: '#0FB57E', grid: '#0EA5E9', casa: '#6D5AE6' },
  dark: { sun: '#D27B00', bat: '#00AE6F', grid: '#0099E4', casa: '#8B7BFF' },
};

const EL_ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  casa: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>',
  grid: '<path d="M6 22 12 2l6 20"/><path d="M9 22 12 2l3 20"/><path d="M6.8 8h10.4M7.7 13h8.6M8.6 18h6.8"/>',
  bat: '<rect x="3" y="8" width="15" height="8" rx="2"/><path d="M21 11v2"/><path d="M6.5 10.5v3M10 10.5v3"/>',
  batchg: '<rect x="3" y="8" width="15" height="8" rx="2"/><path d="M21 11v2"/><path d="M11.4 9.6 8.6 12.2h2.2l-.6 2.4 2.8-2.8h-2.2z"/>',
  // frecce del riepilogo giornaliero: giu' = energia che entra in casa dalla
  // rete, su = energia che esce verso la rete
  dn: '<path d="M12 4v12.5"/><path d="m6.6 11.4 5.4 5.6 5.4-5.6"/><path d="M5 20h14"/>',
  up: '<path d="M12 20V7.5"/><path d="m6.6 12.6 5.4-5.6 5.4 5.6"/><path d="M5 4h14"/>',
};

// I disegni in EL_ICONS sono gia' markup completo (cerchi e tracciati), non
// solo l'attributo `d`: qui si aggiunge soltanto l'involucro.
function elIcon(k, sw) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.9) +
    '" stroke-linecap="round" stroke-linejoin="round">' + (EL_ICONS[k] || '') + '</svg>';
}

class EnergyLiveCard extends HTMLElement {
  setConfig(config) {
    if (!config) throw new Error('Configurazione mancante');
    this.config = Object.assign(
      {
        title: 'Energia',
        max_power: 3500,
        soc_scale: false,
        threshold: 5,
        battery_min_flow: 120,
      },
      config
    );
    this._sig = null;
    this._stats = null;
    this._statAt = 0;
  }

  static getStubConfig() {
    return {
      solar_power: 'sensor.powerwall3_solar_power',
      house_power: 'sensor.powerwall3_load_power',
      grid_power: 'sensor.powerwall3_site_power',
      battery_power: 'sensor.powerwall3_battery_power',
      battery_soc: 'sensor.powerwall3_charge',
      solar_energy: 'sensor.powerwall3_solar_export',
      house_energy: 'sensor.powerwall3_load_import',
      grid_import_energy: 'sensor.powerwall3_site_import',
      battery_export_energy: 'sensor.powerwall3_battery_export',
    };
  }

  set hass(hass) {
    this._hass = hass;
    const c = this.config;
    const ids = [c.solar_power, c.house_power, c.grid_power, c.battery_power, c.battery_soc,
      c.house_today, c.solar_today, c.grid_today].filter(Boolean);
    const sig = mgddStatesSig(hass, ids);
    if (sig !== this._sig) {
      this._sig = sig;
      this._render();
    }
    this._maybeFetchStats();
  }

  getCardSize() { return 8; }

  getGridOptions() { return { rows: 'auto', columns: 'full', min_columns: 6 }; }

  // ---------- letture ----------

  _num(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isNaN(v) ? null : v;
  }

  // potenza normalizzata a W leggendo l'unita' dell'entita' (kW->W), col segno
  _pw(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    if (Number.isNaN(v)) return null;
    const u = ((s.attributes && s.attributes.unit_of_measurement) || '').toLowerCase();
    if (u === 'kw') return v * 1000;
    if (u === 'mw') return v * 1e6;
    return v;
  }

  _isDark() {
    return !!(this._hass && this._hass.themes && this._hass.themes.darkMode);
  }

  _fmt(w) {
    if (w === null || w === undefined) return { v: '—', u: '' };
    const a = Math.abs(w);
    if (a >= 1000) return { v: (a / 1000).toFixed(2).replace('.', ','), u: 'kW' };
    return { v: String(Math.round(a)), u: 'W' };
  }

  _kwh(v) {
    if (v === null || v === undefined) return '—';
    return v.toFixed(1).replace('.', ',');
  }

  // ---------- statistiche orarie ----------

  // Le statistiche a lungo termine, non la cronologia degli stati: qui servono
  // i kWh consumati in ciascuna ora, che sono la `change` del contatore.
  async _maybeFetchStats() {
    const now = Date.now();
    if (this._statAt && now - this._statAt < 5 * 60 * 1000) return;
    this._statAt = now;
    if (!this._hass || !this._hass.callWS) return;
    const c = this.config;
    const ids = [c.house_energy, c.solar_energy, c.grid_import_energy, c.battery_export_energy].filter(Boolean);
    if (!ids.length) return;
    const mid = new Date();
    mid.setHours(0, 0, 0, 0);
    let res = null;
    const req = {
      type: 'recorder/statistics_during_period',
      start_time: mid.toISOString(),
      statistic_ids: ids,
      period: 'hour',
      types: ['change'],
    };
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
    // riga per ora locale: le statistiche arrivano con `start` in epoch ms
    const bucket = (id) => {
      const out = new Array(24).fill(null);
      const rows = res[id];
      if (!rows) return out;
      rows.forEach((r) => {
        const d = new Date(r.start);
        if (d < mid) return;
        const h = d.getHours();
        const v = r.change != null ? r.change : null;
        if (v == null) return;
        out[h] = (out[h] || 0) + v;
      });
      return out;
    };
    this._stats = {
      house: bucket(c.house_energy),
      sun: bucket(c.solar_energy),
      grid: bucket(c.grid_import_energy),
      dis: bucket(c.battery_export_energy),
    };
    this._render();
  }

  // Scomposizione oraria del consumo di casa: il sole copre per primo, poi la
  // batteria, il residuo e' rete. Stessa gerarchia del bilancio della
  // energy-power-card.
  _profile() {
    const st = this._stats;
    if (!st) return null;
    const rows = [];
    let scale = 0;
    const nowH = new Date().getHours();
    for (let i = 0; i < 24; i++) {
      if (i > nowH || st.house[i] == null) { rows.push(null); continue; }
      const house = Math.max(0, st.house[i] || 0);
      if (house <= 0) { rows.push({ h: i, house: 0, sun: 0, batt: 0, grid: 0 }); continue; }
      const sun = Math.min(house, Math.max(0, st.sun[i] || 0));
      const rest = house - sun;
      const batt = Math.min(rest, Math.max(0, st.dis[i] || 0));
      const grid = Math.max(0, rest - batt);
      rows.push({ h: i, house: house, sun: sun, batt: batt, grid: grid });
      if (house > scale) scale = house;
    }
    if (!(scale > 0)) return null;
    return { rows: rows, scale: scale };
  }

  // ---------- i quattro nodi live ----------

  _nodes() {
    const c = this.config;
    const TH = c.threshold;
    const TB = c.battery_min_flow;
    const s = this._pw(c.solar_power);
    const h = this._pw(c.house_power);
    const g = this._pw(c.grid_power);
    const b = this._pw(c.battery_power);
    const soc0 = this._num(c.battery_soc);
    const soc = (soc0 !== null && c.soc_scale) ? Math.max(0, Math.min(100, (soc0 - 5) / 0.95)) : soc0;
    const max = c.max_power || 3500;
    const chg = b !== null && b < -TB;
    const sca = b !== null && b > TB;
    const pren = g !== null && g > TH;
    const imm = g !== null && g < -TH;
    // Il colore NON cambia con lo stato: ogni entita' tiene il suo colore della
    // vista Energy, sempre. A dire se sta lavorando e' l'intensita' della banda,
    // non la tinta — altrimenti un rosso di prelievo diventerebbe un quinto
    // colore da imparare.
    return [
      { key: 'sun', icon: 'sun', name: 'Pannelli', v: s,
        state: s !== null && s > TH ? 'in produzione' : 'fermi',
        on: s !== null && s > TH,
        frac: s === null ? 0 : Math.min(1, Math.abs(s) / max) },
      { key: 'casa', icon: 'casa', name: 'Casa', v: h,
        state: 'in consumo', on: true,
        frac: h === null ? 0 : Math.min(1, Math.abs(h) / max) },
      { key: 'bat', icon: chg ? 'batchg' : 'bat', name: 'Batteria', v: b,
        state: (soc === null ? '' : Math.round(soc) + '% · ') +
          (chg ? 'in carica' : sca ? 'in scarica' : 'ferma'),
        on: chg || sca,
        frac: soc === null ? 0 : soc / 100 },
      { key: 'grid', icon: 'grid', name: 'Rete', v: g,
        state: pren ? 'in prelievo' : imm ? 'in immissione' : 'nessuno scambio',
        on: pren || imm,
        frac: g === null ? 0 : Math.min(1, Math.abs(g) / max) },
    ];
  }

  // ---------- markup ----------

  _render() {
    if (!this.config || !this._hass) return;
    mgddPaint(this, this._styles(), this._html());
    this._wire();
  }

  _html() {
    const c = this.config;
    const dark = this._isDark();
    const cons = this._num(c.house_today);
    const prod = this._num(c.solar_today);
    const fromGrid = this._num(c.grid_today);
    // autosufficienza di oggi: quanto del consumo NON e' venuto dalla rete
    let self = null;
    if (cons !== null && cons > 0 && fromGrid !== null) {
      self = Math.max(0, Math.min(100, ((cons - fromGrid) / cons) * 100));
    }

    const pill = self === null
      ? ''
      : '<span class="el-pill">' + Math.round(self) + '% dal sole</span>';

    let note = '';
    if (fromGrid !== null) {
      note = 'di cui <b class="el-cg">' + this._kwh(fromGrid) + ' kWh</b> dalla rete';
      if (prod !== null) note += ' · prodotti ' + this._kwh(prod) + ' kWh';
    } else if (prod !== null) {
      note = 'prodotti ' + this._kwh(prod) + ' kWh';
    }

    return (
      '<ha-card class="el' + (dark ? ' el-dark' : '') + '"><div class="el-in">' +
      // intestazione
      '<div class="el-hd"><span class="el-hdi">' + elIcon('sun') + '</span>' +
      '<div class="el-hdx"><div class="el-hdt">' + c.title + '</div>' +
      '<div class="el-hds">Da dove è arrivata, ora per ora</div></div>' + pill + '</div>' +
      // consuntivo + profilo
      '<div class="el-p"><div class="el-k">Consumo di casa oggi</div>' +
      '<div class="el-big">' + this._kwh(cons) + '<small>kWh</small></div>' +
      (note ? '<div class="el-note">' + note + '</div>' : '') +
      this._chart() +
      '</div>' +
      // fascia live
      this._live() +
      '</div></ha-card>'
    );
  }

  _chart() {
    const p = this._profile();
    if (!p) {
      return '<div class="el-chempty">profilo orario non ancora disponibile</div>';
    }
    const nowH = new Date().getHours();
    let bars = '';
    for (let i = 0; i < 24; i++) {
      const r = p.rows[i];
      if (!r || r.house <= 0) {
        bars += '<div class="el-hb"><span class="el-fut"></span></div>';
        continue;
      }
      const segs = [[r.grid, 'el-c-grid'], [r.batt, 'el-c-bat'], [r.sun, 'el-c-sun']]
        .filter((x) => x[0] > p.scale / 250);
      const tot = segs.reduce((a, x) => a + x[0], 0);
      let inner = '';
      if (tot > 0) {
        segs.forEach((x) => {
          inner += '<i class="' + x[1] + '" style="flex:' + (x[0] / tot).toFixed(4) + '"></i>';
        });
      }
      const hh = Math.max(1.5, (r.house / p.scale) * 100);
      bars += '<div class="el-hb" title="' + (i < 10 ? '0' : '') + i + ':00 · ' +
        r.house.toFixed(2).replace('.', ',') + ' kWh">' +
        '<div class="el-hb-in' + (hh < 7 ? ' el-tight' : '') + '" style="height:' + hh.toFixed(1) + '%">' +
        inner + '</div></div>';
    }
    return (
      '<div class="el-hr">' +
      '<div class="el-hr-hd"><span>Profilo orario</span><b>max ' +
      p.scale.toFixed(2).replace('.', ',') + ' kWh/h</b></div>' +
      '<div class="el-hr-wrap"><div class="el-hr-y"><span>' +
      p.scale.toFixed(2).replace('.', ',') + '</span><span>0</span></div>' +
      '<div class="el-hr-plot">' + bars + '</div></div>' +
      '<div class="el-hr-axw"><div class="el-hr-ax"><span>00</span><span>06</span>' +
      '<span>12</span><span>18</span><span>23</span></div></div>' +
      '<div class="el-lgd"><span><i class="el-c-sun"></i>Sole</span>' +
      '<span><i class="el-c-bat"></i>Batteria</span>' +
      '<span><i class="el-c-grid"></i>Rete</span></div></div>'
    );
  }

  _live() {
    const cells = this._nodes().map((n) => {
      const f = this._fmt(n.v);
      const ent = this._entityOf(n.key);
      return (
        '<div class="el-lc el-' + n.key + (n.on ? '' : ' el-off') + '"' +
        (ent ? ' data-more="' + ent + '"' : '') + '>' +
        '<div class="el-li">' + elIcon(n.icon, 2) + n.name + '</div>' +
        '<div class="el-lv">' + f.v + '<small> ' + f.u + '</small></div>' +
        '<div class="el-ls">' + n.state + '</div>' +
        '<div class="el-lb"><i style="width:' + Math.round(n.frac * 100) + '%"></i></div>' +
        '</div>'
      );
    });
    return '<div class="el-live">' + cells.join('') + '</div>';
  }

  _entityOf(key) {
    const c = this.config;
    return key === 'sun' ? c.solar_power
      : key === 'casa' ? c.house_power
      : key === 'bat' ? (c.battery_soc || c.battery_power)
      : c.grid_power;
  }

  _wire() {
    if (this._wired) return;
    this._wired = true;
    this.addEventListener('click', (ev) => {
      const el = ev.target.closest ? ev.target.closest('[data-more]') : null;
      const id = el && el.getAttribute('data-more');
      if (id) {
        this.dispatchEvent(new CustomEvent('hass-more-info',
          { detail: { entityId: id }, bubbles: true, composed: true }));
      }
    });
  }

  _styles() {
    const L = EL_COLORS.light;
    const D = EL_COLORS.dark;
    return (
      '<style>' +
      ':host{display:block;}' +
      // Fondo e testo dal tema, come nella system-card: la card non si porta
      // dietro un colore proprio. I quattro colori delle entita' sono quelli
      // della vista Energy, identici.
      '.el{--sun:' + L.sun + ';--bat:' + L.bat + ';--grid:' + L.grid + ';--casa:' + L.casa + ';' +
      '--el-ok:#0E9B6C;--el-panel:rgba(16,20,28,.045);--el-hair:rgba(16,20,28,.10);' +
      '--el-t1:var(--primary-text-color,#14161a);--el-t2:var(--secondary-text-color,#70757f);' +
      'container-type:inline-size;overflow:hidden;}' +
      '.el.el-dark{--sun:' + D.sun + ';--bat:' + D.bat + ';--grid:' + D.grid + ';--casa:' + D.casa + ';' +
      '--el-ok:#35E0A1;--el-panel:rgba(255,255,255,.045);--el-hair:rgba(255,255,255,.10);}' +
      '.el *{box-sizing:border-box;}' +
      '.el svg{display:block;}' +
      '.el .el-in{padding:14px 15px 15px;display:flex;flex-direction:column;gap:10px;' +
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--el-t1);}' +

      // intestazione
      '.el .el-hd{display:flex;align-items:center;gap:12px;}' +
      '.el .el-hdi{width:36px;height:36px;flex:none;border-radius:11px;display:grid;place-items:center;' +
      'color:var(--sun);background:color-mix(in srgb,var(--sun) 13%,transparent);}' +
      '.el .el-hdi svg{width:19px;height:19px;}' +
      '.el .el-hdx{min-width:0;flex:1;}' +
      '.el .el-hdt{font-size:13px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;}' +
      '.el .el-hds{font-size:11.5px;color:var(--el-t2);margin-top:2px;}' +
      '.el .el-pill{flex:none;font-size:11.5px;font-weight:700;border-radius:10px;padding:5px 10px;' +
      'color:var(--el-ok);background:color-mix(in srgb,var(--el-ok) 14%,transparent);white-space:nowrap;}' +

      // riquadro del consuntivo
      '.el .el-p{background:var(--el-panel);border-radius:15px;padding:12px 14px 13px;min-width:0;}' +
      '.el .el-k{font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:var(--el-t2);}' +
      '.el .el-big{font-size:33px;font-weight:700;letter-spacing:-1.5px;line-height:1.1;margin-top:3px;' +
      'font-variant-numeric:tabular-nums;}' +
      '.el .el-big small{font-size:15px;font-weight:600;letter-spacing:0;color:var(--el-t2);margin-left:5px;}' +
      '.el .el-note{font-size:12.5px;color:var(--el-t2);margin-top:5px;line-height:1.45;}' +
      '.el .el-note b{font-weight:640;}' +
      '.el .el-cg{color:var(--grid);}' +

      // profilo orario: misure e forme della energy-power-card
      '.el .el-hr{margin-top:11px;}' +
      '.el .el-hr-hd{display:flex;justify-content:space-between;align-items:baseline;font-size:10.5px;' +
      'letter-spacing:.5px;text-transform:uppercase;color:var(--el-t2);margin-bottom:8px;}' +
      '.el .el-hr-hd b{font-size:11px;letter-spacing:0;text-transform:none;font-weight:550;opacity:.85;' +
      'font-variant-numeric:tabular-nums;}' +
      '.el .el-hr-wrap{display:flex;gap:7px;}' +
      '.el .el-hr-y{width:26px;flex:none;display:flex;flex-direction:column;justify-content:space-between;' +
      'font-size:9.5px;color:var(--el-t2);opacity:.8;font-variant-numeric:tabular-nums;text-align:right;}' +
      '.el .el-hr-plot{position:relative;display:flex;align-items:flex-end;gap:2px;height:116px;flex:1;min-width:0;}' +
      '.el .el-hb{flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center;min-width:0;}' +
      '.el .el-hb-in{width:100%;display:flex;flex-direction:column-reverse;gap:2px;' +
      'border-radius:4px 4px 0 0;overflow:hidden;}' +
      '.el .el-hb-in i{display:block;width:100%;}' +
      '.el .el-tight{gap:0;}' +
      // ora non ancora trascorsa: filo sulla linea di base, non una barra a zero
      '.el .el-fut{width:100%;height:1px;background:var(--el-hair);}' +
      '.el .el-c-sun{background:var(--sun);}' +
      '.el .el-c-bat{background:var(--bat);}' +
      '.el .el-c-grid{background:var(--grid);}' +
      '.el .el-hr-axw{margin-left:33px;}' +
      '.el .el-hr-ax{display:flex;justify-content:space-between;font-size:9.5px;color:var(--el-t2);' +
      'margin-top:6px;opacity:.8;font-variant-numeric:tabular-nums;}' +
      '.el .el-lgd{display:flex;flex-wrap:wrap;gap:13px;font-size:11px;color:var(--el-t2);margin-top:9px;}' +
      '.el .el-lgd i{width:8px;height:8px;border-radius:2px;display:inline-block;margin-right:5px;}' +
      '.el .el-chempty{font-size:12px;color:var(--el-t2);margin-top:11px;padding:14px 0;text-align:center;' +
      'border:1px dashed var(--el-hair);border-radius:10px;}' +

      // fascia live: quattro riquadri con la banda di stato
      '.el .el-live{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;}' +
      '.el .el-lc{background:var(--el-panel);border-radius:14px;padding:11px 11px 12px;' +
      'position:relative;overflow:hidden;cursor:pointer;}' +
      '.el .el-lc::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:currentColor;}' +
      // il colore resta quello dell'entita': a dire che il nodo e' fermo e'
      // l'opacita', non una tinta diversa
      '.el .el-lc.el-off{opacity:.62;}' +
      '.el .el-sun{color:var(--sun);}.el .el-casa{color:var(--casa);}' +
      '.el .el-bat{color:var(--bat);}.el .el-grid{color:var(--grid);}' +
      '.el .el-li{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:800;' +
      'letter-spacing:.9px;text-transform:uppercase;}' +
      '.el .el-li svg{width:14px;height:14px;flex:none;}' +
      '.el .el-lv{font-size:23px;font-weight:700;letter-spacing:-1.1px;line-height:1;margin-top:9px;' +
      'color:var(--el-t1);font-variant-numeric:tabular-nums;}' +
      '.el .el-lv small{font-size:11px;font-weight:600;color:var(--el-t2);letter-spacing:0;}' +
      '.el .el-ls{font-size:11px;margin-top:5px;font-weight:600;}' +
      '.el .el-lb{height:4px;border-radius:99px;background:var(--el-hair);margin-top:8px;overflow:hidden;}' +
      '.el .el-lb i{display:block;height:100%;border-radius:99px;background:currentColor;}' +

      // stretto: due colonne per la fascia, numeri piu' piccoli
      '@container (max-width:430px){' +
      '.el .el-in{padding:12px 12px 13px;gap:9px;}' +
      '.el .el-big{font-size:29px;letter-spacing:-1.2px;}' +
      '.el .el-live{grid-template-columns:repeat(2,minmax(0,1fr));}' +
      '.el .el-hr-plot{height:96px;}' +
      '}' +
      '</style>'
    );
  }
}

customElements.define('casa-mgdd-energy-live-card', EnergyLiveCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'casa-mgdd-energy-live-card',
  name: 'Casa MGDD Energia (Home)',
  description: 'Consumo di oggi, profilo orario per provenienza e stato live di pannelli, casa, batteria e rete. Config via YAML.',
});

// ===== energia: anello e schema =====
// Due card per la Home, indipendenti fra loro e dalla energy-live-card: si
// scelgono in base a cosa deve saltare all'occhio.
//
//   casa-mgdd-energy-ring-card     un numero solo: quanto la casa si e' retta
//                                  da sola oggi, e da dove e' arrivata
//   casa-mgdd-energy-scheme-card   il quadro dell'impianto: chi sta alimentando
//                                  chi, adesso
//
// Chiudono con lo stesso riepilogo giornaliero (prodotta / importata / immessa)
// cosi' le due si possono affiancare senza che raccontino cose diverse.

// La palette e' quella della energy-flow-card, non quella della
// energy-live-card: chi mette lo schema accanto al diagramma di flusso deve
// vedere lo stesso giallo e lo stesso verde. In chiaro coincidono comunque.
const ENG_COLORS = {
  light: { sun: '#E08A00', bat: '#0FB57E', grid: '#0EA5E9', casa: '#6D5AE6' },
  dark: { sun: '#F5B301', bat: '#22E39A', grid: '#38BDF8', casa: '#8B7BFF' },
};

function engNum(hass, entity) {
  if (!entity || !hass) return null;
  const s = hass.states[entity];
  if (!s) return null;
  const v = parseFloat(s.state);
  return Number.isNaN(v) ? null : v;
}

// potenza normalizzata a W leggendo l'unita' dell'entita' (kW->W), col segno
function engPw(hass, entity) {
  if (!entity || !hass) return null;
  const s = hass.states[entity];
  if (!s) return null;
  const v = parseFloat(s.state);
  if (Number.isNaN(v)) return null;
  const u = ((s.attributes && s.attributes.unit_of_measurement) || '').toLowerCase();
  if (u === 'kw') return v * 1000;
  if (u === 'mw') return v * 1e6;
  return v;
}

function engFmt(w) {
  if (w === null || w === undefined) return { v: '—', u: '' };
  const a = Math.abs(w);
  if (a >= 1000) return { v: (a / 1000).toFixed(2).replace('.', ','), u: 'kW' };
  return { v: String(Math.round(a)), u: 'W' };
}

function engKwh(v) {
  if (v === null || v === undefined) return '—';
  return v.toFixed(1).replace('.', ',');
}

// arco di cerchio in coordinate SVG, angoli in gradi con 0 = ore 3
function engArc(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const s = p(a0);
  const e = p(a1);
  return 'M' + s[0].toFixed(2) + ',' + s[1].toFixed(2) +
    ' A' + r + ',' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + e[0].toFixed(2) + ',' + e[1].toFixed(2);
}

// spezzata ortogonale con gli angoli raccordati: e' la forma delle tracce
// dello schema, angoli a 90 gradi ma non taglienti
function engPoly(pts, rad) {
  let d = 'M' + pts[0][0] + ',' + pts[0][1];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const n = pts[i + 1];
    const v1x = c[0] - p[0];
    const v1y = c[1] - p[1];
    const v2x = n[0] - c[0];
    const v2y = n[1] - c[1];
    const l1 = Math.hypot(v1x, v1y) || 1;
    const l2 = Math.hypot(v2x, v2y) || 1;
    const r = Math.min(rad, l1 / 2, l2 / 2);
    d += ' L' + (c[0] - (v1x / l1) * r).toFixed(1) + ',' + (c[1] - (v1y / l1) * r).toFixed(1) +
      ' Q' + c[0] + ',' + c[1] + ' ' + (c[0] + (v2x / l2) * r).toFixed(1) + ',' + (c[1] + (v2y / l2) * r).toFixed(1);
  }
  const e = pts[pts.length - 1];
  return d + ' L' + e[0] + ',' + e[1];
}

// Il triangolo dello scarto e' disegnato, non preso dal carattere: le frecce
// tipografiche arrivano da font di ripiego diversi su Windows e su iOS e
// cambierebbero dimensione e appoggio tra i due.
function engTri(dir) {
  return '<svg viewBox="0 0 8 6" aria-hidden="true"><path d="' +
    (dir === 'up' ? 'M4 0 8 6H0z' : 'M4 6 0 0h8z') + '" fill="currentColor"/></svg>';
}

// Riepilogo giornaliero condiviso dalle due card. Sono le tre voci che si
// leggono in bolletta, non la scomposizione interna: prodotta, presa, resa.
//
// Le quattro righe stanno in UNA sola griglia, non una per riga: cosi' ogni
// colonna e' larga quanto la sua voce piu' larga e i numeri restano
// incolonnati. Prima erano quattro righe flex indipendenti, con l'etichetta a
// `flex:1`, e il bordo destro del numero finiva a "larghezza meno pastiglia":
// bastava che uno scarto fosse piu' largo degli altri perche' quella riga
// incolonnasse il numero altrove.
function engDailyHtml(prod, imp, exp, cons, deltas) {
  let n = 0;
  const row = (k, col, lab, v, d) => {
    // Il filetto e' un elemento che attraversa tutte le colonne: messo come
    // bordo sulle singole celle si spezzerebbe a ogni spazio tra colonne.
    const sep = n++ ? '<div class="eng-sep"></div>' : '';
    const dl = d
      ? '<span class="eng-d eng-' + d.c + '">' + (d.dir ? engTri(d.dir) : '') +
        '<span>' + d.t + '</span></span>'
      : '';
    return sep +
      '<div class="eng-ri" style="color:' + col + '">' + elIcon(k, 2) + '</div>' +
      '<div class="eng-rl">' + lab + '</div>' +
      '<div class="eng-rn">' + engKwh(v) + '<small>kWh</small></div>' +
      '<div class="eng-rd">' + dl + '</div>';
  };
  const D = deltas || {};
  return '<div class="eng-dr"><div class="eng-dh">Oggi</div><div class="eng-dg">' +
    (cons === undefined ? '' : row('casa', 'var(--casa)', 'Consumo casa', cons, D.cons)) +
    row('sun', 'var(--sun)', 'Energia prodotta', prod, D.prod) +
    row('dn', 'var(--grid)', 'Energia importata dalla rete', imp, D.imp) +
    row('up', 'var(--casa)', 'Energia immessa in rete', exp, D.exp) +
    '</div></div>';
}

// Scarto rispetto a ieri, detto in kWh e non in percentuale: su una voce da
// bolletta "un chilowattora in piu'" si capisce, "+12%" va ricalcolato a mente.
// La freccia dice il verso, il colore dice se e' un bene: `pol` vale +1 se
// salire e' un miglioramento (produzione), -1 se lo e' scendere (consumo,
// prelievo), 0 se non ha verso (immissione, che qui non si vende) — cosi'
// consumare di piu' resta ambra anche se la freccia sale.
//
// Sotto i 0,05 kWh la differenza si arrotonderebbe a "0,0": una freccia
// direbbe un movimento che non c'e', quindi resta scritto "come ieri".
// Nessuna divisione, quindi un ieri a zero non e' piu' un caso da scartare:
// oggi 3,2 contro ieri 0 ora si legge, prima spariva.
function engDelta(t, y, pol) {
  if (t === null || t === undefined || y === null || y === undefined) return null;
  const d = t - y;
  if (Math.abs(d) < 0.05) return { c: 'eq', t: 'come ieri' };
  const bene = pol === 0 ? null : ((d > 0) === (pol > 0));
  return {
    c: bene === null ? 'eq' : (bene ? 'good' : 'bad'),
    dir: d > 0 ? 'up' : 'dn',
    t: engKwh(Math.abs(d)),
  };
}

// Confronto onesto con ieri: oggi fino ad adesso contro ieri fino alla STESSA
// ora. Senza quel taglio, alle 9 del mattino la card direbbe -80% soltanto
// perche' la giornata non e' ancora finita, e mentirebbe ogni mattina.
//
// Entrambi i lati vengono dalle statistiche orarie, cosi' si confrontano due
// grandezze omogenee (nessuna delle due ha l'ora in corso). Il numero grande
// resta invece quello vivo del sensore `_today`: l'ora corrente si vede subito.
// Una sola chiamata per tutti e quattro i contatori cumulativi.
// I contatori cumulativi servono SOLO al confronto con ieri: i sensori `_today`
// si azzerano a mezzanotte e non permettono di risalire al giorno prima.
// Se non sono indicati in configurazione si ricavano dal nome di quelli
// giornalieri togliendo il suffisso `_today` — ma solo se l'entita' esiste
// davvero in hass.states. Cosi' una card gia' in dashboard non resta senza
// confronti solo perche' e' stata scritta prima che queste chiavi esistessero,
// e allo stesso tempo non ci si lega mai a un entity_id inventato.
function engTotal(hass, explicit, todayId) {
  if (explicit) return explicit;
  if (!todayId || !hass) return null;
  const guess = todayId.replace(/_today$/, '');
  if (guess === todayId) return null;
  return hass.states[guess] ? guess : null;
}

function engStatIds(hass, c) {
  return {
    cons: engTotal(hass, c.house_total, c.house_today),
    prod: engTotal(hass, c.solar_total, c.solar_today),
    imp: engTotal(hass, c.grid_import_total, c.grid_import_today || c.grid_today),
    exp: engTotal(hass, c.grid_export_total, c.grid_export_today),
  };
}

function engFetchStats(card) {
  const c = card.config;
  const h = card._hass;
  if (!h || !h.callWS) return;
  const map = engStatIds(h, c);
  const ids = [map.cons, map.prod, map.imp, map.exp].filter(Boolean);
  if (!ids.length) return;
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const y0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  // Si contano solo le ore CHIUSE, da entrambe le parti. L'ora in corso non e'
  // ancora stata aggregata da oggi, mentre di ieri la stessa ora c'e' tutta:
  // includerla darebbe -100% subito dopo la mezzanotte e uno sconto fasullo a
  // ogni cambio d'ora. Tagliando all'inizio dell'ora corrente i due lati hanno
  // sempre lo stesso numero di ore; nella prima ora del giorno non c'e' ancora
  // niente da confrontare e lo scarto semplicemente non compare.
  const hCut = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
  const yCut = hCut - 24 * 3600 * 1000;
  h.callWS({
    type: 'recorder/statistics_during_period',
    start_time: new Date(y0).toISOString(),
    end_time: now.toISOString(),
    statistic_ids: ids,
    period: 'hour',
    types: ['change'],
  }).then((resp) => {
    const out = {};
    ids.forEach((id) => {
      const rows = (resp && resp[id]) || [];
      let a = 0;
      let b = 0;
      rows.forEach((r) => {
        const ts = new Date(r.start).getTime();
        const v = r.change || 0;
        if (ts >= t0 && ts < hCut) a += v;
        else if (ts >= y0 && ts < yCut) b += v;
      });
      out[id] = rows.length ? { t: a, y: b } : null;
    });
    card._stats = out;
    card._sig = null;
    card._render();
  }).catch(() => {
    /* il confronto e' facoltativo: senza recorder le righe restano senza scarto */
  });
}

// Le statistiche orarie non cambiano piu' spesso di cosi'.
function engMaybeStats(card) {
  const now = Date.now();
  if (card._statsAt && now - card._statsAt < 300000) return;
  card._statsAt = now;
  engFetchStats(card);
}

function engDeltas(card) {
  const s = card._stats;
  if (!s || !card._hass) return null;
  const map = engStatIds(card._hass, card.config);
  const d = (id, pol) => {
    const r = id && s[id];
    return r ? engDelta(r.t, r.y, pol) : null;
  };
  return {
    cons: d(map.cons, -1),
    prod: d(map.prod, 1),
    imp: d(map.imp, -1),
    exp: d(map.exp, 0),
  };
}

function engDailyCss(s) {
  return s + ' .eng-dr{margin-top:12px;padding-top:10px;border-top:1px solid var(--eng-hair);}' +
    s + ' .eng-dh{font-size:10px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;' +
      'color:var(--eng-t2);margin-bottom:1px;}' +
    s + ' .eng-dg{display:grid;grid-template-columns:17px minmax(0,1fr) auto auto;' +
      'align-items:center;column-gap:7px;}' +
    s + ' .eng-dg>div{padding:7px 0;min-width:0;}' +
    s + ' .eng-sep{grid-column:1/-1;height:1px;padding:0;background:var(--eng-hair);}' +
    s + ' .eng-ri{display:grid;place-items:center;}' +
    s + ' .eng-ri svg{width:17px;height:17px;}' +
    s + ' .eng-rl{font-size:12.5px;color:var(--eng-t2);overflow:hidden;text-overflow:ellipsis;' +
      'white-space:nowrap;}' +
    // Valore e unita' stanno nella STESSA cella, allineata a destra. "kWh" e'
    // identico su ogni riga, quindi i numeri si incolonnano lo stesso e si
    // risparmia una colonna: su una card da 340px (l'iPhone) sono i pixel che
    // permettono a "Energia importata dalla rete" di restare intera invece che
    // venire troncata.
    s + ' .eng-rn{font-size:13.5px;font-weight:650;font-variant-numeric:tabular-nums;' +
      'text-align:right;white-space:nowrap;}' +
    s + ' .eng-rn small{font-size:10.5px;font-weight:600;color:var(--eng-t2);margin-left:3px;}' +
    s + ' .eng-rd{justify-self:end;}' +
    // lo scarto su ieri: verde se la giornata e' andata meglio, ambra se peggio
    s + ' .eng-d{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:650;' +
      'font-variant-numeric:tabular-nums;white-space:nowrap;padding:1.5px 7px;border-radius:99px;}' +
    s + ' .eng-d svg{display:block;width:7px;height:5px;flex:none;}' +
    s + ' .eng-good{color:var(--eng-ok);background:var(--eng-ok-bg);}' +
    s + ' .eng-bad{color:var(--eng-warn);background:var(--eng-warn-bg);}' +
    s + ' .eng-eq{color:var(--eng-t2);background:rgba(127,127,127,.12);}';
}

// Le tinte del confronto e del blackout, uguali per le due card.
function engStateVars(dark) {
  return dark
    ? '--eng-bad:#FF6B5E;--eng-ok:#22E39A;--eng-ok-bg:rgba(34,227,154,.15);' +
      '--eng-warn:#F5B301;--eng-warn-bg:rgba(245,179,1,.15);'
    : '--eng-bad:#C7291B;--eng-ok:#0A8F63;--eng-ok-bg:rgba(15,181,126,.14);' +
      '--eng-warn:#B4551A;--eng-warn-bg:rgba(224,138,0,.14);';
}

// Lo stato in alto dice l'EVENTO PRINCIPALE, non com'e' messa la rete: si
// misurano i flussi possibili e si nomina il piu' grande. Prima guardava solo
// il contatore, e con 17 W di rete scriveva "in prelievo" mentre la batteria
// ne stava dando 251 dei 252 consumati da casa: l'unica cosa che non contava.
//
// L'immissione in rete e' declassata a ULTIMA RISORSA, perche' in questo
// impianto non si vende: prima di immettere si carica la batteria. Non serve
// una regola per caso: declassandola escono da soli i due comportamenti giusti.
// A mezzogiorno il flusso maggiore diventa sole->batteria ("batteria in
// ricarica"); a batteria piena resta sole->casa ("autoconsumo solare").
// Con `can_export: true` l'immissione torna a concorrere alla pari.
//
// Niente piu' "in isola": senza Backup Gateway questo impianto NON regge il
// carico a rete assente. Se il gateway dice off e' un blackout, e si scrive in
// rosso.
function engRegime(hass, cfg, sW, hW, gW, bW) {
  const st = cfg.grid_status ? hass.states[cfg.grid_status] : null;
  if (st && st.state === 'off') return { t: 'blackout', c: 'var(--eng-bad)', bad: true };

  // Tutto muto e' anche la firma piu' probabile di un blackout vero: senza
  // corrente il Powerwall smette di rispondere e non fa in tempo a dire off.
  // Non lo si dichiara comunque: un guasto di rete darebbe lo stesso silenzio,
  // e gridare "blackout" a ogni disconnessione WiFi sarebbe peggio di tacere.
  if (sW === null && hW === null && gW === null && bW === null) {
    return { t: 'impianto non raggiungibile', c: 'var(--eng-t2)' };
  }

  const TH = cfg.threshold;
  const TB = cfg.battery_min_flow;
  const batH = (bW !== null && bW > TB) ? bW : 0;
  const gridH = (gW !== null && gW > TH) ? gW : 0;
  const sunH = (sW !== null && sW > TH)
    ? Math.min(sW, Math.max(0, (hW || 0) - batH - gridH)) : 0;
  const chg = (bW !== null && bW < -TB) ? -bW : 0;
  const sunB = chg ? Math.min(chg, Math.max(0, (sW || 0) - sunH)) : 0;
  const gridB = chg ? Math.max(0, chg - sunB) : 0;
  const toG = (gW !== null && gW < -TH) ? -gW : 0;

  const f = [
    { t: 'scarica batteria', v: batH, c: 'var(--bat)' },
    { t: 'prelievo da rete', v: gridH, c: 'var(--grid)' },
    { t: 'autoconsumo solare', v: sunH, c: 'var(--sun)' },
    { t: 'batteria in ricarica', v: sunB, c: 'var(--bat)' },
    { t: 'carica da rete', v: gridB, c: 'var(--grid)' },
  ];
  if (cfg.can_export) f.push({ t: 'immissione in rete', v: toG, c: 'var(--grid)' });
  f.sort((a, b) => b.v - a.v);
  if (f[0].v > TH) return { t: f[0].t, c: f[0].c };
  if (toG > TH) return { t: 'immissione in rete', c: 'var(--grid)' };
  return { t: 'impianto a riposo', c: 'var(--eng-t2)' };
}

// ===== energy-ring-card.js =====
// Un numero grande al centro — l'autosufficienza di oggi — e la corona che dice
// da dove e' arrivata l'energia che la casa ha consumato: sole diretto,
// batteria, rete. Sotto, i quattro valori istantanei e il riepilogo del giorno.
//
// La scomposizione segue la stessa gerarchia della energy-power-card: quello
// che non e' venuto dalla batteria ne' dalla rete e' arrivato dal sole.

class EnergyRingCard extends HTMLElement {
  setConfig(config) {
    if (!config) throw new Error('Configurazione mancante');
    this.config = Object.assign(
      // can_export: in questo impianto non si immette in rete, quindi
      // l'immissione e' l'ultima cosa che lo stato in alto nomina. Vedi engRegime.
      { title: 'Impianto', threshold: 5, battery_min_flow: 120, soc_scale: false, can_export: false },
      config
    );
    this._sig = null;
  }

  static getStubConfig() {
    return {
      solar_power: 'sensor.powerwall3_solar_power',
      house_power: 'sensor.powerwall3_load_power',
      grid_power: 'sensor.powerwall3_site_power',
      battery_power: 'sensor.powerwall3_battery_power',
      battery_soc: 'sensor.powerwall3_charge',
      house_today: 'sensor.powerwall3_load_import_today',
      solar_today: 'sensor.powerwall3_solar_export_today',
      grid_import_today: 'sensor.powerwall3_site_import_today',
      grid_export_today: 'sensor.powerwall3_site_export_today',
      battery_export_today: 'sensor.powerwall3_battery_export_today',
      grid_status: 'binary_sensor.powerwall3_grid_status',
      // solo per il confronto con ieri: vedi engFetchStats
      house_total: 'sensor.powerwall3_load_import',
      solar_total: 'sensor.powerwall3_solar_export',
      grid_import_total: 'sensor.powerwall3_site_import',
      grid_export_total: 'sensor.powerwall3_site_export',
    };
  }

  set hass(hass) {
    this._hass = hass;
    const c = this.config;
    const ids = [c.solar_power, c.house_power, c.grid_power, c.battery_power, c.battery_soc,
      c.house_today, c.solar_today, c.grid_import_today || c.grid_today, c.grid_export_today,
      c.battery_export_today, c.grid_status].filter(Boolean);
    const sig = mgddStatesSig(hass, ids);
    if (sig !== this._sig) {
      this._sig = sig;
      this._render();
    }
    engMaybeStats(this);
  }

  getCardSize() { return 7; }

  // A tutta sezione, come la energy-live-card: sono card da guardare, non
  // tessere da affiancare.
  getGridOptions() { return { rows: 'auto', columns: 'full', min_columns: 6 }; }

  _render() {
    if (!this.config || !this._hass) return;
    mgddPaint(this, this._styles(), this._html());
    this._wire();
  }

  _html() {
    const h = this._hass;
    const c = this.config;
    const dark = !!(h.themes && h.themes.darkMode);

    const cons = engNum(h, c.house_today);
    const prod = engNum(h, c.solar_today);
    const imp = engNum(h, c.grid_import_today || c.grid_today);
    const exp = engNum(h, c.grid_export_today);
    const bdis = engNum(h, c.battery_export_today);

    // quota arrivata dal sole senza passare dalla batteria
    const direct = cons === null ? null : Math.max(0, cons - (bdis || 0) - (imp || 0));
    const self = (cons !== null && cons > 0 && imp !== null)
      ? Math.max(0, Math.min(100, ((cons - imp) / cons) * 100)) : null;

    const segs = [
      { v: direct || 0, c: 'var(--sun)', l: 'Sole diretto' },
      { v: bdis || 0, c: 'var(--bat)', l: 'Dalla batteria' },
      { v: imp || 0, c: 'var(--grid)', l: 'Dalla rete' },
    ].filter((s) => s.v > 0);
    const tot = segs.reduce((a, s) => a + s.v, 0);

    const R = 80;
    const CC = 100;
    const SW = 13;
    let ang = -90;
    let arcs = '';
    let hits = '';
    segs.forEach((s) => {
      // una fetta minuscola (lo 0,1 kWh di rete di una giornata buona) deve
      // restare visibile: sotto i 3,2 gradi non si vedrebbe affatto
      const end = ang + Math.max((s.v / tot) * 360, 3.2);
      const d = engArc(CC, CC, R, ang, end - 2.4);
      arcs += '<path d="' + d + '" fill="none" stroke="' + s.c +
        '" stroke-width="' + SW + '" stroke-linecap="butt"/>';
      // Binario invisibile piu' largo sopra la fetta: il dito non prende 13
      // unita' di corona, e la fetta della rete in una bella giornata ne vale 3.
      hits += '<path class="er-seg" d="' + d + '" fill="none" stroke="transparent" stroke-width="30" ' +
        'pointer-events="stroke" data-l="' + s.l + '" data-v="' + engKwh(s.v) + '" data-c="' + s.c +
        '" data-p="' + Math.round((s.v / tot) * 100) + '%" data-a="' + ((ang + end) / 2 - 1.2).toFixed(1) + '"/>';
      ang = end;
    });

    const sW = engPw(h, c.solar_power);
    const hW = engPw(h, c.house_power);
    const gW = engPw(h, c.grid_power);
    const bW = engPw(h, c.battery_power);
    const soc0 = engNum(h, c.battery_soc);
    const soc = (soc0 !== null && c.soc_scale)
      ? Math.max(0, Math.min(100, (soc0 - 5) / 0.95)) : soc0;
    const gs = engRegime(h, c, sW, hW, gW, bW);

    const pill = (icon, col, lab, val, ent) => {
      return '<div class="er-p"' + (ent ? ' data-more="' + ent + '"' : '') + '>' +
        '<span class="er-pi" style="color:' + col + '">' + elIcon(icon, 2) + '</span>' +
        '<span class="er-px"><i>' + lab + '</i><b>' + val + '</b></span></div>';
    };
    const lbl = (f) => f.v + (f.u ? ' ' + f.u : '');
    const fs = engFmt(sW);
    const fh = engFmt(hW);
    const fg = engFmt(gW);

    return (
      '<ha-card class="er' + (dark ? ' er-dark' : '') + '"><div class="er-in">' +
      '<div class="er-hd"><span class="er-t">' + c.title + '</span>' +
      '<span class="er-st' + (gs.bad ? ' er-alarm' : '') + '" style="color:' + gs.c + '">' +
      '<i></i>' + gs.t + '</span></div>' +

      '<div class="er-ring"><div class="er-rw">' +
      '<svg viewBox="0 0 200 200" role="img" aria-label="Da dove e\' arrivata l\'energia consumata oggi">' +
      '<circle cx="' + CC + '" cy="' + CC + '" r="' + R + '" fill="none" stroke="var(--eng-hair)" stroke-width="' + SW + '"/>' +
      arcs + hits + '</svg>' +
      '<div class="er-c"><b>' + (self === null ? '—' : Math.round(self) + '%') + '</b>' +
      '<span>autosufficienza</span>' +
      '<em>' + (cons === null ? 'consumo non disponibile' : engKwh(cons) + ' kWh in casa') + '</em></div>' +
      '<div class="er-tip" hidden></div></div></div>' +

      '<div class="er-g">' +
      pill('sun', 'var(--sun)', 'Solare', lbl(fs), c.solar_power) +
      pill('casa', 'var(--casa)', 'Casa', lbl(fh), c.house_power) +
      pill('bat', 'var(--bat)', 'Batteria', soc === null ? '—' : Math.round(soc) + '%', c.battery_soc || c.battery_power) +
      pill('grid', 'var(--grid)', 'Rete', lbl(fg), c.grid_power) +
      '</div>' +

      engDailyHtml(prod, imp, exp, cons, engDeltas(this)) +
      '</div></ha-card>'
    );
  }

  // Il riquadro della fetta puntata. Posizionato al centro dell'arco e spinto
  // in fuori lungo il raggio, poi riportato dentro la scatola dell'anello: da
  // qualunque parte si punti resta leggibile e non esce dalla card.
  _tip(seg) {
    const tip = this.querySelector('.er-tip');
    if (!tip) return;
    if (!seg) {
      tip.hidden = true;
      return;
    }
    const at = (k) => seg.getAttribute('data-' + k) || '';
    tip.innerHTML = '<i><s style="background:' + at('c') + '"></s>' + at('l') + '</i>' +
      '<b>' + at('v') + '<small>kWh</small></b><em>' + at('p') + '</em>';
    tip.hidden = false;
    const box = tip.parentNode;
    const S = box.clientWidth || 196;
    const a = (parseFloat(at('a')) || 0) * Math.PI / 180;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    // 0,40 = raggio della corona (80) sul lato del viewBox (200)
    const x = S / 2 + Math.cos(a) * (S * 0.40 + 30) - w / 2;
    const y = S / 2 + Math.sin(a) * (S * 0.40 + 30) - h / 2;
    // Puo' sporgere dalla scatola dell'anello: ai lati c'e' il margine della
    // card, sopra c'e' l'intestazione. Coprire per un attimo quella e' meglio
    // che posarsi sulla fetta che si sta indicando.
    tip.style.left = Math.max(-24, Math.min(S - w + 24, x)) + 'px';
    tip.style.top = Math.max(-30, Math.min(S - h, y)) + 'px';
  }

  _wire() {
    if (this._wired) return;
    this._wired = true;
    this.addEventListener('click', (ev) => {
      const seg = ev.target.closest ? ev.target.closest('.er-seg') : null;
      // Col dito non esiste il passaggio del mouse: il tocco apre il riquadro e
      // ci pensa il timer a richiuderlo, come nei grafici a barre.
      if (seg) {
        this._tip(seg);
        clearTimeout(this._tipT);
        this._tipT = setTimeout(() => this._tip(null), 2500);
        return;
      }
      const el = ev.target.closest ? ev.target.closest('[data-more]') : null;
      const id = el && el.getAttribute('data-more');
      if (id) {
        this.dispatchEvent(new CustomEvent('hass-more-info',
          { detail: { entityId: id }, bubbles: true, composed: true }));
      }
    });
    this.addEventListener('mousemove', (ev) => {
      this._tip(ev.target.closest ? ev.target.closest('.er-seg') : null);
    });
    this.addEventListener('mouseleave', () => this._tip(null));
  }

  _styles() {
    const L = ENG_COLORS.light;
    const D = ENG_COLORS.dark;
    return (
      '<style>' +
      ':host{display:block;}' +
      '.er{--sun:' + L.sun + ';--bat:' + L.bat + ';--grid:' + L.grid + ';--casa:' + L.casa + ';' +
      engStateVars(false) +
      '--eng-hair:rgba(16,20,28,.11);--eng-t1:var(--primary-text-color,#14161a);' +
      '--eng-t2:var(--secondary-text-color,#70757f);container-type:inline-size;overflow:hidden;}' +
      '.er.er-dark{--sun:' + D.sun + ';--bat:' + D.bat + ';--grid:' + D.grid + ';--casa:' + D.casa + ';' +
      engStateVars(true) + '--eng-hair:rgba(255,255,255,.13);}' +
      '.er *{box-sizing:border-box;}' +
      '.er svg{display:block;}' +
      // La card prende tutta la sezione, ma il contenuto oltre i 520px si ferma
      // e resta centrato: la corona e' di misura fissa e, allargando ancora, si
      // ritroverebbe persa in mezzo al vuoto. Stessa regola dello schema.
      '.er .er-in{padding:14px 15px 13px;max-width:520px;margin-inline:auto;color:var(--eng-t1);' +
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}' +

      '.er .er-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;}' +
      '.er .er-t{font-size:11px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:var(--eng-t2);}' +
      '.er .er-st{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;text-align:right;}' +
      '.er .er-st i{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none;}' +
      '.er .er-st.er-alarm{font-weight:800;letter-spacing:.09em;text-transform:uppercase;}' +

      // La corona resta di misura fissa: e' l'unico modo perche' il testo al
      // centro mantenga sempre la stessa aria attorno, anche in una colonna
      // stretta o sul telefono.
      '.er .er-ring{display:flex;justify-content:center;margin:10px 0 2px;}' +
      '.er .er-rw{position:relative;width:196px;height:196px;}' +
      '.er .er-ring svg{width:196px;height:196px;}' +
      '.er .er-seg{cursor:pointer;}' +
      '.er .er-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:2px;pointer-events:none;}' +
      '.er .er-c b{font-size:38px;font-weight:700;letter-spacing:-1.4px;line-height:1;font-variant-numeric:tabular-nums;}' +
      '.er .er-c span{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--eng-t2);}' +
      '.er .er-c em{font-size:10px;font-style:normal;color:var(--eng-t2);margin-top:6px;font-variant-numeric:tabular-nums;}' +

      '.er .er-g{display:grid;grid-template-columns:1fr 1fr;gap:0 10px;margin-top:8px;}' +
      '.er .er-p{display:flex;align-items:center;gap:9px;padding:7px 0;cursor:pointer;border-radius:8px;}' +
      '.er .er-pi{flex:none;display:grid;place-items:center;}' +
      '.er .er-pi svg{width:21px;height:21px;}' +
      '.er .er-px{min-width:0;line-height:1.15;}' +
      '.er .er-px i{display:block;font-style:normal;font-size:10.5px;color:var(--eng-t2);}' +
      '.er .er-px b{display:block;font-size:15.5px;font-weight:640;font-variant-numeric:tabular-nums;}' +

      // Stessa ricetta dei riquadri degli altri grafici della libreria:
      // superficie della card, bordo del tema e ombra. La pillola invertita
      // spariva in tema scuro.
      '.er .er-tip{position:absolute;z-index:3;pointer-events:none;white-space:nowrap;' +
      'padding:5px 9px 6px;border-radius:10px;line-height:1.25;' +
      'background:var(--ha-card-background,var(--card-background-color,#fff));' +
      // ripiego su --eng-hair e non su un nero fisso: quello, in tema scuro,
      // sarebbe un bordo invisibile su fondo scuro
      'border:1px solid var(--divider-color,var(--eng-hair));box-shadow:0 6px 18px rgba(0,0,0,.18);}' +
      '.er .er-tip[hidden]{display:none;}' +
      '.er .er-tip i{display:block;font-style:normal;font-size:10px;color:var(--eng-t2);}' +
      '.er .er-tip i s{display:inline-block;width:7px;height:7px;border-radius:50%;' +
      'margin-right:5px;vertical-align:1px;text-decoration:none;}' +
      '.er .er-tip b{font-size:12.5px;font-weight:650;font-variant-numeric:tabular-nums;}' +
      '.er .er-tip b small{font-size:10px;font-weight:600;color:var(--eng-t2);margin-left:3px;}' +
      '.er .er-tip em{font-style:normal;font-size:11px;color:var(--eng-t2);margin-left:7px;' +
      'font-variant-numeric:tabular-nums;}' +
      engDailyCss('.er') +

      '@container (max-width:330px){' +
      '.er .er-in{padding:12px 12px 11px;}' +
      '.er .er-g{grid-template-columns:1fr;}' +
      '}' +
      '</style>'
    );
  }
}

customElements.define('casa-mgdd-energy-ring-card', EnergyRingCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'casa-mgdd-energy-ring-card',
  name: 'Casa MGDD Energia · anello',
  description: 'Autosufficienza di oggi al centro di una corona che ne mostra la provenienza, quattro valori live e il riepilogo del giorno. Config via YAML.',
});

// ===== energy-scheme-card.js =====
// Il quadro dell'impianto: quattro nodi e le tracce che li uniscono. Le tracce
// ci sono sempre tutte, anche spente: cosi' la card non cambia forma quando il
// sole va via, e si legge subito cosa NON sta succedendo.
//
// Ogni traccia attiva e' doppia: un binario fisso, tenue, e sopra una testa
// luminosa che lo percorre. La durata del giro e' inversamente proporzionale
// alla potenza, quindi piu' watt = luce piu' veloce, come nella
// energy-flow-card.
//
// Non e' disegnata la rete che carica la batteria: in questo impianto succede
// per pochi decimi di kWh l'anno e una sesta traccia costerebbe piu' di quanto
// renda. Se un giorno servisse, va aggiunta qui.

class EnergySchemeCard extends HTMLElement {
  setConfig(config) {
    if (!config) throw new Error('Configurazione mancante');
    this.config = Object.assign(
      { title: 'Impianto', threshold: 5, battery_min_flow: 120, max_power: 3500,
        soc_scale: false, animate: true, can_export: false },
      config
    );
    this._sig = null;
  }

  static getStubConfig() {
    return {
      solar_power: 'sensor.powerwall3_solar_power',
      house_power: 'sensor.powerwall3_load_power',
      grid_power: 'sensor.powerwall3_site_power',
      battery_power: 'sensor.powerwall3_battery_power',
      battery_soc: 'sensor.powerwall3_charge',
      solar_today: 'sensor.powerwall3_solar_export_today',
      grid_import_today: 'sensor.powerwall3_site_import_today',
      grid_export_today: 'sensor.powerwall3_site_export_today',
      house_today: 'sensor.powerwall3_load_import_today',
      grid_status: 'binary_sensor.powerwall3_grid_status',
      // contatori cumulativi: servono solo al confronto con ieri, che si legge
      // dalle statistiche orarie. I sensori `_today` si azzerano a mezzanotte e
      // non permettono di risalire alla giornata precedente.
      house_total: 'sensor.powerwall3_load_import',
      solar_total: 'sensor.powerwall3_solar_export',
      grid_import_total: 'sensor.powerwall3_site_import',
      grid_export_total: 'sensor.powerwall3_site_export',
    };
  }

  set hass(hass) {
    this._hass = hass;
    const c = this.config;
    const ids = [c.solar_power, c.house_power, c.grid_power, c.battery_power, c.battery_soc,
      c.solar_today, c.grid_import_today || c.grid_today, c.grid_export_today, c.house_today,
      c.grid_status].filter(Boolean);
    const sig = mgddStatesSig(hass, ids);
    if (sig !== this._sig) {
      this._sig = sig;
      this._render();
    }
    engMaybeStats(this);
  }

  getCardSize() { return 6; }

  // A tutta sezione, come la energy-live-card: sono card da guardare, non
  // tessere da affiancare.
  getGridOptions() { return { rows: 'auto', columns: 'full', min_columns: 6 }; }

  _render() {
    if (!this.config || !this._hass) return;
    mgddPaint(this, this._styles(), this._html());
    this._wire();
  }

  // durata del giro della testa luminosa: piu' potenza, piu' veloce
  _dur(w) {
    const f = Math.min(1, Math.abs(w || 0) / (this.config.max_power || 3500));
    return (3.4 - 2.6 * f).toFixed(2);
  }

  _html() {
    const h = this._hass;
    const c = this.config;
    const dark = !!(h.themes && h.themes.darkMode);
    const TH = c.threshold;
    const TB = c.battery_min_flow;

    const sW = engPw(h, c.solar_power);
    const hW = engPw(h, c.house_power);
    const gW = engPw(h, c.grid_power);
    const bW = engPw(h, c.battery_power);
    const soc0 = engNum(h, c.battery_soc);
    const soc = (soc0 !== null && c.soc_scale)
      ? Math.max(0, Math.min(100, (soc0 - 5) / 0.95)) : soc0;

    const chg = bW !== null && bW < -TB;
    const dis = bW !== null && bW > TB;
    const imp = gW !== null && gW > TH;
    const exp = gW !== null && gW < -TH;
    const sun = sW !== null && sW > TH;
    // Quanto del sole finisce davvero in casa: il resto del consumo lo stanno
    // coprendo batteria e rete. Il tetto e' la produzione: sotto la soglia di
    // `battery_min_flow` la batteria viene considerata ferma, e senza questo
    // limite il suo contributo finirebbe attribuito al sole.
    const solToHouse = (sun && hW !== null)
      ? Math.min(sW, Math.max(0, hW - (dis ? bW : 0) - (imp ? gW : 0))) : 0;

    const SX = 66; const SY = 46;
    const RX = 250; const RY = 46;
    const BX = 66; const BY = 158;
    const HX = 250; const HY = 158;

    // Le tracce escono dai nodi ad altezze diverse e passano nei corridoi
    // liberi (margini laterali e canale centrale): cosi' nessuna passa sopra
    // il valore scritto sotto un nodo.
    const routes = [
      { p: [[SX + 30, 34], [RX - 30, 34]], col: 'var(--sun)', on: sun && exp, w: -(gW || 0), d: 0 },
      { p: [[SX - 30, SY], [12, SY], [12, BY], [SX - 30, BY]], col: 'var(--sun)', on: sun && chg, w: -(bW || 0), d: 0.3 },
      { p: [[RX + 30, RY], [328, RY], [328, HY], [HX + 30, HY]], col: 'var(--grid)', on: imp, w: gW || 0, d: 0.15 },
      { p: [[SX + 30, 58], [158, 58], [158, 114], [HX, 114], [HX, HY - 30]], col: 'var(--sun)', on: sun && solToHouse > TH, w: solToHouse, d: 0 },
      { p: [[BX + 30, BY], [HX - 30, BY]], col: 'var(--bat)', on: dis, w: bW || 0, d: 0.55 },
    ];
    let lines = '';
    routes.forEach((r) => {
      const d = engPoly(r.p, 11);
      if (!r.on) {
        lines += '<path d="' + d + '" fill="none" stroke="' + r.col +
          '" stroke-width="3" stroke-linecap="round" opacity=".15"/>';
        return;
      }
      lines += '<path d="' + d + '" fill="none" stroke="' + r.col +
        '" stroke-width="3" stroke-linecap="round" opacity=".26"/>' +
        '<path class="es-fl" d="' + d + '" fill="none" stroke="currentColor" stroke-width="3" ' +
        'stroke-linecap="round" pathLength="100" stroke-dasharray="15 85" ' +
        'style="color:' + r.col + ';animation-duration:' + this._dur(r.w) + 's;animation-delay:' + r.d + 's"/>';
    });

    const node = (x, y, icon, col, wash, val, lab, ent) => {
      return '<g transform="translate(' + x + ',' + y + ')"' +
        (ent ? ' data-more="' + ent + '" class="es-n"' : '') + '>' +
        // il rettangolo del colore della card cancella la traccia sotto il nodo
        '<rect x="-30" y="-30" width="60" height="60" rx="19" fill="var(--card-background-color,#fff)"/>' +
        '<rect x="-22" y="-22" width="44" height="44" rx="13" fill="' + wash + '"/>' +
        '<g transform="translate(-11,-11)" style="color:' + col + '">' +
        '<svg x="0" y="0" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (EL_ICONS[icon] || '') + '</svg></g>' +
        // Pesi allineati al resto della card: il valore come i numeri del
        // riepilogo (650), il nome come le altre maiuscolette (800). A 9px il
        // peso normale sembrava un carattere diverso, non un testo piu' tenue.
        '<text y="38" text-anchor="middle" font-size="12.5" font-weight="650" fill="var(--eng-t1)" ' +
        'style="font-variant-numeric:tabular-nums">' + val + '</text>' +
        '<text y="50" text-anchor="middle" font-size="9" font-weight="800" fill="var(--eng-t2)" ' +
        'style="letter-spacing:1.05px;text-transform:uppercase">' + lab + '</text></g>';
    };
    const lbl = (f) => f.v + (f.u ? ' ' + f.u : '');
    const gs = engRegime(h, c, sW, hW, gW, bW);

    // La batteria e' l'unico nodo con due grandezze: quanta ne ha e quanta ne
    // sta scambiando. La freccia segue la convenzione del riepilogo: giu' entra,
    // su esce. Sotto `battery_min_flow` resta il solo stato di carica.
    const bf = (chg || dis) ? engFmt(bW) : null;
    const batVal = (soc === null ? '—' : Math.round(soc) + ' %') +
      (bf ? '<tspan fill="var(--bat)" font-size="11"> ' + (chg ? '↓' : '↑') +
        ' ' + bf.v + ' ' + bf.u + '</tspan>' : '');

    return (
      '<ha-card class="es' + (dark ? ' es-dark' : '') +
      (c.animate === false ? ' es-still' : '') + (c.animate === 'always' ? ' es-force' : '') +
      '"><div class="es-in">' +
      '<div class="es-hd"><span class="es-t">' + c.title + '</span>' +
      '<span class="es-st' + (gs.bad ? ' es-alarm' : '') + '" style="color:' + gs.c + '">' +
      '<i></i>' + gs.t + '</span></div>' +
      '<svg class="es-svg" viewBox="0 0 340 224" role="img" aria-label="Schema dell\'impianto">' +
      lines +
      node(SX, SY, 'sun', 'var(--sun)', 'var(--w-sun)', lbl(engFmt(sW)), 'Solare', c.solar_power) +
      node(RX, RY, 'grid', 'var(--grid)', 'var(--w-grid)', lbl(engFmt(gW)), 'Rete', c.grid_power) +
      node(BX, BY, chg ? 'batchg' : 'bat', 'var(--bat)', 'var(--w-bat)',
        batVal, 'Batteria', c.battery_soc || c.battery_power) +
      node(HX, HY, 'casa', 'var(--casa)', 'var(--w-casa)', lbl(engFmt(hW)), 'Casa', c.house_power) +
      '</svg>' +
      engDailyHtml(engNum(h, c.solar_today), engNum(h, c.grid_import_today || c.grid_today),
        engNum(h, c.grid_export_today),
        // La riga del consumo c'e' SEMPRE, anche senza `house_today`: nasconderla
        // faceva sparire una voce del riepilogo quando il browser aveva in cache
        // una configurazione Lovelace vecchia, e sembrava una funzione tolta.
        // Un trattino dice "manca un dato"; una riga assente non dice niente.
        engNum(h, c.house_today), engDeltas(this)) +
      '</div></ha-card>'
    );
  }

  _wire() {
    if (this._wired) return;
    this._wired = true;
    this.addEventListener('click', (ev) => {
      const el = ev.target.closest ? ev.target.closest('[data-more]') : null;
      const id = el && el.getAttribute('data-more');
      if (id) {
        this.dispatchEvent(new CustomEvent('hass-more-info',
          { detail: { entityId: id }, bubbles: true, composed: true }));
      }
    });
  }

  _styles() {
    const L = ENG_COLORS.light;
    const D = ENG_COLORS.dark;
    return (
      '<style>' +
      ':host{display:block;}' +
      '.es{--sun:' + L.sun + ';--bat:' + L.bat + ';--grid:' + L.grid + ';--casa:' + L.casa + ';' +
      engStateVars(false) +
      '--w-sun:rgba(224,138,0,.13);--w-bat:rgba(15,181,126,.13);--w-grid:rgba(14,165,233,.13);' +
      '--w-casa:rgba(109,90,230,.13);' +
      '--eng-hair:rgba(16,20,28,.11);--eng-t1:var(--primary-text-color,#14161a);' +
      '--eng-t2:var(--secondary-text-color,#70757f);container-type:inline-size;overflow:hidden;}' +
      '.es.es-dark{--sun:' + D.sun + ';--bat:' + D.bat + ';--grid:' + D.grid + ';--casa:' + D.casa + ';' +
      engStateVars(true) +
      '--w-sun:rgba(245,179,1,.15);--w-bat:rgba(34,227,154,.15);--w-grid:rgba(56,189,248,.15);' +
      '--w-casa:rgba(139,123,255,.15);--eng-hair:rgba(255,255,255,.13);}' +
      '.es *{box-sizing:border-box;}' +
      '.es .es-in{padding:13px 14px 12px;color:var(--eng-t1);' +
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}' +
      '.es .es-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;}' +
      '.es .es-t{font-size:11px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:var(--eng-t2);}' +
      '.es .es-st{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;text-align:right;}' +
      '.es .es-st i{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none;}' +
      // il blackout non e' uno stato come gli altri: piu' nero e maiuscoletto
      '.es .es-st.es-alarm{font-weight:800;letter-spacing:.09em;text-transform:uppercase;}' +
      // Lo schema scala con la card, ma oltre una certa larghezza diventerebbe
      // solo alto: sopra i 520px si ferma e resta centrato.
      '.es .es-svg{width:100%;max-width:520px;height:auto;display:block;margin:2px auto;}' +
      '.es .es-n{cursor:pointer;}' +

      // la testa luminosa: pathLength=100 normalizza il tratteggio, cosi' la
      // luce ha la stessa lunghezza su tracce di lunghezza diversa
      '@keyframes esrun{from{stroke-dashoffset:0}to{stroke-dashoffset:-100}}' +
      '.es .es-fl{animation-name:esrun;animation-timing-function:linear;animation-iteration-count:infinite;}' +
      '.es.es-dark .es-fl{filter:drop-shadow(0 0 3px currentColor);}' +
      // chi ha chiesto meno movimento al sistema operativo non lo subisce qui:
      // la luce resta ferma a meta' traccia, che dice comunque il verso
      '@media (prefers-reduced-motion:reduce){.es .es-fl{animation-name:none;stroke-dashoffset:-50;}}' +
      '.es.es-still .es-fl{animation-name:none;stroke-dashoffset:-50;}' +
      '.es.es-force .es-fl{animation-name:esrun;}' +
      engDailyCss('.es') +
      '</style>'
    );
  }
}

customElements.define('casa-mgdd-energy-scheme-card', EnergySchemeCard);
window.customCards.push({
  type: 'casa-mgdd-energy-scheme-card',
  name: 'Casa MGDD Energia · schema',
  description: 'Sole, rete, batteria e casa con le tracce che li uniscono e la luce che scorre su quelle attive. Config via YAML.',
});

// ===== presence-card.js =====
// Una tessera per persona: chi c'e' e da quanto. Niente mappa, niente batteria,
// niente indirizzo — quelli stanno gia' nel more-info, e qui toglierebbero
// spazio alle due sole cose che si guardano di sfuggita: il nome e lo stato.
//
// Gerarchia rovesciata di proposito: il nome scende a etichetta da 10,5 px e lo
// stato sale a 19. Chi apre la Home non cerca "Mattia", cerca "chi c'e'".
//
// Il verde e' l'unica tinta e compare solo per chi e' in casa. Chi e' fuori
// resta col colore del testo normale, non grigio-spento: cosi' la tessera verde
// salta all'occhio senza che l'altra sembri guasta.
//
// Il "da quanto" viene dal recorder, MAI da last_changed: a ogni riavvio di Home
// Assistant last_changed torna all'istante del riavvio e la card direbbe che sei
// uscito due minuti fa. Stessa lezione delle card compatte, stessa cura:
// `end_time` esplicito, altrimenti l'endpoint si ferma a un giorno dopo `start`.

const PR_OK = { light: '#0E9B6C', dark: '#35E0A1' };

class PresenceCard extends HTMLElement {
  setConfig(config) {
    if (!config) throw new Error('Configurazione mancante');
    const people = config.people || config.entities;
    if (!Array.isArray(people) || !people.length) {
      throw new Error('Indicare almeno una persona in `people:`');
    }
    this.config = Object.assign({ show_since: true, history_hours: 168 }, config);
    this._sig = null;
    this._hist = null;
    this._histAt = 0;
    this._timeSig = null;
  }

  static getStubConfig() {
    return { people: ['person.mattia', 'person.deborah'] };
  }

  set hass(hass) {
    this._hass = hass;
    const sig = mgddStatesSig(hass, this._ids());
    if (sig !== this._sig) {
      this._sig = sig;
      this._render();
    }
    this._maybeFetchHistory();
  }

  // Il tempo trascorso e' la seconda informazione della tessera: senza un battito
  // proprio resterebbe fermo all'ultimo cambio di stato, cioe' fermo per ore.
  // Si ridisegna solo quando il testo cambierebbe davvero, non a ogni giro.
  connectedCallback() {
    if (!this._tick) this._tick = setInterval(() => this._maybeTick(), 30000);
  }

  disconnectedCallback() {
    if (this._tick) {
      clearInterval(this._tick);
      this._tick = null;
    }
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return { rows: 'auto', columns: 'full', min_columns: 6 };
  }

  // ---------- dati ----------

  _people() {
    return (this.config.people || this.config.entities || [])
      .map((p) => (typeof p === 'string' ? { entity: p } : p || {}))
      .filter((p) => p.entity);
  }

  _ids() {
    return this._people().map((p) => p.entity);
  }

  _isDark() {
    return !!(this._hass && this._hass.themes && this._hass.themes.darkMode);
  }

  _name(p) {
    const s = this._hass && this._hass.states[p.entity];
    if (p.name) return p.name;
    if (s && s.attributes && s.attributes.friendly_name) return s.attributes.friendly_name;
    return String(p.entity).split('.')[1] || p.entity;
  }

  _initials(name) {
    const w = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    return (w[0][0] + (w.length > 1 ? w[1][0] : '')).toUpperCase();
  }

  // Lo stato di `person` e' `home`, `not_home` oppure il nome della zona in cui
  // si trova: nell'ultimo caso la parola giusta e' gia' quella, si capitalizza.
  _word(entity) {
    const s = this._hass && this._hass.states[entity];
    if (!s) return 'Sconosciuto';
    if (s.state === 'home') return 'In casa';
    if (s.state === 'not_home') return 'Fuori casa';
    if (s.state === 'unavailable' || s.state === 'unknown' || s.state === 'None') return 'Sconosciuto';
    return s.state.charAt(0).toUpperCase() + s.state.slice(1);
  }

  _home(entity) {
    const s = this._hass && this._hass.states[entity];
    return !!(s && s.state === 'home');
  }

  // ---------- cronologia dal recorder ----------

  async _maybeFetchHistory() {
    const now = Date.now();
    if (this._histAt && now - this._histAt < 2 * 60 * 1000) return;
    this._histAt = now;
    if (!this._hass) return;
    const ids = this._ids();
    if (!ids.length) return;
    const hours = this.config.history_hours || 168;
    const start = new Date(now - hours * 3600 * 1000).toISOString();
    try {
      // `end_time` e' obbligatorio, non un di piu': senza, l'endpoint REST non
      // arriva a adesso ma si ferma a UN GIORNO dopo `start`.
      const path = 'history/period/' + start + '?end_time=' + encodeURIComponent(new Date(now).toISOString()) +
        '&filter_entity_id=' + ids.join(',') + '&minimal_response&no_attributes';
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
          // tratti uguali ricuciti: si tiene il timestamp del cambio vero, non
          // quello dell'ultimo riavvio che ha solo ripubblicato lo stesso stato
          if (!ev.length || ev[ev.length - 1].state !== s.state) ev.push({ state: s.state, ts: ts });
        });
        out[id] = ev;
      });
      this._hist = out;
      this._render();
    } catch (e) {
      /* recorder non disponibile: restano gli stati correnti, senza orari */
    }
  }

  // Inizio del tratto in cui la persona si trova ADESSO. Con un solo elemento in
  // lista non c'e' stata nessuna transizione nella finestra: il vero inizio e'
  // piu' vecchio di quanto la card guardi, e va detto invece che inventato.
  _runStart(entity) {
    const st = this._hass && this._hass.states[entity];
    const ev = (this._hist || {})[entity];
    if (!st) return null;
    if (!ev || !ev.length) return null;
    const last = ev[ev.length - 1];
    if (last.state !== st.state) {
      // il recorder puo' essere indietro di qualche secondo: vince hass
      const ts = new Date(st.last_changed).getTime();
      return ts ? { ts: ts, capped: false } : null;
    }
    return { ts: last.ts, capped: ev.length < 2 };
  }

  _dur(ms) {
    if (ms < 0) ms = 0;
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'adesso';
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60 < 10 ? '0' : '') + (m % 60) + 'm';
    const d = Math.floor(h / 24);
    return d + (d === 1 ? ' giorno' : ' giorni');
  }

  _sinceText(entity) {
    if (this.config.show_since === false) return '';
    // Di uno stato sconosciuto non interessa "da quanto": la colonna sparisce e
    // lascia la sua larghezza alla parola, che e' la piu' lunga del vocabolario.
    const s = this._hass && this._hass.states[entity];
    if (!s || s.state === 'unavailable' || s.state === 'unknown' || s.state === 'None') return '';
    const r = this._runStart(entity);
    if (!r) return '';
    const h = this.config.history_hours || 168;
    if (r.capped) return '> ' + (h >= 48 ? Math.floor(h / 24) + ' gg' : h + ' h');
    return this._dur(Date.now() - r.ts);
  }

  _maybeTick() {
    if (!this._hass || !this.config) return;
    const sig = this._ids().map((id) => this._sinceText(id)).join('|');
    if (sig !== this._timeSig) this._render();
  }

  // ---------- markup ----------

  _render() {
    if (!this.config || !this._hass) return;
    this._timeSig = this._ids().map((id) => this._sinceText(id)).join('|');
    mgddPaint(this, this._styles(), this._html());
    this._wire();
    // La foto puo' non esserci o non caricare: in quel caso restano le iniziali
    // gia' presenti sotto. Legato a ogni ridisegno perche' mgddPaint rifa' il
    // sottoalbero e i listener sui nodi interni sparirebbero.
    this.querySelectorAll('.pr-av img').forEach((im) => {
      im.addEventListener('error', () => im.remove());
    });
  }

  _html() {
    const nosince = this.config.show_since === false;
    const tiles = this._people()
      .map((p) => {
        const st = this._hass.states[p.entity];
        const name = this._name(p);
        const word = this._word(p.entity);
        const pic = p.picture || (st && st.attributes && st.attributes.entity_picture) || '';
        const since = this._sinceText(p.entity);
        return (
          '<ha-card class="pr-t' + (this._home(p.entity) ? ' pr-home' : '') + '" ' +
          'data-more="' + mgddEsc(p.entity) + '" role="button" tabindex="0" ' +
          'aria-label="' + mgddEsc(name + ', ' + word) + '">' +
          '<div class="pr-in">' +
          '<span class="pr-av"><b>' + mgddEsc(this._initials(name)) + '</b>' +
          (pic ? '<img src="' + mgddEsc(pic) + '" alt="">' : '') + '</span>' +
          '<span class="pr-bd">' +
          '<span class="pr-n">' + mgddEsc(name) + '</span>' +
          '<span class="pr-s">' + mgddEsc(word) + '</span></span>' +
          (since ? '<span class="pr-since">' + mgddEsc(since) + '</span>' : '') +
          '</div></ha-card>'
        );
      })
      .join('');
    return (
      '<div class="pr' + (this._isDark() ? ' pr-dark' : '') + (nosince ? ' pr-nosince' : '') + '">' +
      tiles + '</div>'
    );
  }

  _wire() {
    if (this._wired) return;
    this._wired = true;
    this.addEventListener('click', (ev) => this._fire(ev));
    this.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        this._fire(ev);
      }
    });
  }

  _fire(ev) {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-more]') : null;
    const id = el && el.getAttribute('data-more');
    if (!id) return;
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
  }

  _styles() {
    // La soglia non e' un numero tondo scelto a occhio: e' la larghezza sotto la
    // quale "Fuori casa" a 19 px non ci sta piu' accanto al tempo (231 px misurati,
    // 236 con un margine). Dipende da quante tessere ci sono, quindi si calcola
    // qui invece di fissarla nel foglio di stile.
    const n = Math.max(1, this._people().length);
    const bp = n * 236 + (n - 1) * 12;
    return (
      '<style>' +
      '.pr{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:12px;' +
      'container-type:inline-size;' +
      '--pr-ok:' + PR_OK.light + ';--pr-t1:var(--primary-text-color,#14161a);' +
      '--pr-t2:var(--secondary-text-color,#70757f);--pr-hair:rgba(16,20,28,.14);' +
      '--pr-panel:rgba(16,20,28,.05);' +
      '--pr-bg:var(--ha-card-background,var(--card-background-color,#fff));}' +
      '.pr.pr-dark{--pr-ok:' + PR_OK.dark + ';--pr-hair:rgba(255,255,255,.16);' +
      '--pr-panel:rgba(255,255,255,.06);}' +
      '.pr *{box-sizing:border-box;}' +
      '.pr .pr-t{cursor:pointer;overflow:hidden;}' +
      '.pr .pr-t:focus-visible{outline:2px solid var(--pr-ok);outline-offset:2px;}' +

      // Tre colonne: foto, testo, tempo. Il tempo e' spinto in basso dal grid,
      // non da un margine a occhio, cosi' resta allineato fra tessere diverse.
      '.pr .pr-in{display:grid;grid-template-columns:auto minmax(0,1fr) auto;' +
      'grid-template-areas:"av bd tm";align-items:center;gap:14px;padding:16px;' +
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'color:var(--pr-t1);}' +
      '.pr.pr-nosince .pr-in{grid-template-columns:auto minmax(0,1fr);grid-template-areas:"av bd";}' +

      // L'anello e' 1,5 px con uno stacco del colore della card: si vede che c'e'
      // anche quando e' neutro, e non sembra un bordo dell'immagine.
      '.pr .pr-av{grid-area:av;position:relative;width:46px;height:46px;border-radius:50%;' +
      'flex:none;overflow:hidden;display:grid;place-items:center;background:var(--pr-panel);' +
      'box-shadow:0 0 0 2px var(--pr-bg),0 0 0 3.5px var(--pr-hair);}' +
      '.pr .pr-home .pr-av{box-shadow:0 0 0 2px var(--pr-bg),0 0 0 3.5px var(--pr-ok);}' +
      '.pr .pr-av b{font-size:16px;font-weight:800;letter-spacing:.3px;color:var(--pr-t2);}' +
      '.pr .pr-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}' +

      '.pr .pr-bd{grid-area:bd;min-width:0;}' +
      '.pr .pr-n{display:block;font-size:10.5px;font-weight:800;letter-spacing:1.35px;' +
      'text-transform:uppercase;color:var(--pr-t2);line-height:1;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.pr .pr-s{display:block;font-size:19px;font-weight:700;letter-spacing:-.5px;line-height:1;' +
      'margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.pr .pr-home .pr-s{color:var(--pr-ok);}' +

      '.pr .pr-since{grid-area:tm;align-self:end;font-size:11.5px;color:var(--pr-t2);' +
      'font-variant-numeric:tabular-nums;white-space:nowrap;}' +

      // Quando le tessere si stringono, il tempo passa sotto lo stato e la foto
      // copre entrambe le righe: la parola resta intera invece di troncarsi.
      '@container (max-width:' + bp + 'px){' +
      '.pr .pr-in{grid-template-columns:auto minmax(0,1fr);' +
      'grid-template-areas:"av bd" "av tm";row-gap:4px;column-gap:13px;padding:15px 14px;}' +
      '.pr.pr-nosince .pr-in{grid-template-areas:"av bd";}' +
      '.pr .pr-since{align-self:start;justify-self:start;}' +
      '.pr .pr-s{font-size:17.5px;}' +
      '.pr .pr-av{width:42px;height:42px;}}' +
      '</style>'
    );
  }
}

customElements.define('casa-mgdd-presence-card', PresenceCard);
window.customCards.push({
  type: 'casa-mgdd-presence-card',
  name: 'Casa MGDD Presenza',
  description: 'Una tessera per persona con foto, nome e stato. Il tempo trascorso viene dal recorder, non da last_changed. Config via YAML.',
});
