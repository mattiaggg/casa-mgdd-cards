/*
 * Casa MGDD - Custom Lovelace Cards
 * Libreria unica di card custom per la dashboard Home Assistant.
 * Contiene: temperature-bento-card, temperature-row-card, weather-alert-card,
 * energy-power-card, energy-controls-card, energy-history-card,
 * energy-monthly-card.
 *
 * Version: 1.13.0
 */

// Firma degli stati (state + last_updated) delle entità indicate.
// Evita di ricostruire il DOM a ogni cambio di hass globale: senza, qualunque
// entità che si aggiorna (es. sensori di potenza ogni 1-2s) forza il re-render
// e su iOS Safari lo scroll della vista torna in cima di continuo.
function mgddStatesSig(hass, ids) {
  if (!hass) return '';
  let out = '';
  for (const id of ids) {
    const s = id && hass.states[id];
    out += id + '=' + (s ? s.state + '@' + s.last_updated : 'x') + ';';
  }
  return out;
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
      el.addEventListener('pointermove', (e) => show(e.clientX));
      el.addEventListener('pointerdown', (e) => show(e.clientX));
      el.addEventListener('pointerleave', hide);
      el.addEventListener('pointerup', () => {
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(hide, 2500);
      });
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
      '.zc-tip{position:absolute;top:-4px;transform:translate(-50%,-100%);background:var(--primary-text-color,#1c1c1e);color:var(--ha-card-background,var(--card-background-color,#fff));font-size:11px;font-weight:500;padding:3px 7px;border-radius:6px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .1s;z-index:2;}' +
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
    (cfg.circuits || []).forEach((c) => {
      if (c.entity) ids.push(c.entity);
      if (c.switch) ids.push(c.switch);
    });
    const sig = mgddStatesSig(hass, ids);
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._render();
    }
    this._maybeFetchHistory();
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
    }
    this._render();
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

  _render() {
    if (this.config.layout === 'controls') this._renderControlTiles();
    else if (this.config.layout === 'headergraph') this._renderHeaderGraph();
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
    this.innerHTML = this._styles() + '<div class="epc-tiles">' + tiles + '</div>';
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
    this.innerHTML = this._styles() + '<div class="epcs-tiles">' + tiles + '</div>';
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
    this.innerHTML = this._styles() + '<div class="ephg-tiles">' + tiles + '</div>';
    this._wireSwitches();
    this._wireClicks();
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

  _renderOverview() {
    const power = this._num(this.config.power_entity);
    const day = this._num(this.config.energy_day_entity);
    const month = this._num(this.config.energy_month_entity);
    const circuits = this.config.circuits || [];
    const threshold = this.config.active_threshold != null ? this.config.active_threshold : 1;
    const activeCount = this.config.active_count || 6;
    const active = circuits
      .map((c) => ({ name: c.name, val: this._num(c.entity), entity: c.entity }))
      .filter((c) => c.val !== null && c.val > threshold)
      .sort((a, b) => b.val - a.val)
      .slice(0, activeCount);

    const trendHtml = this._trendArea
      ? '<div class="hero-spark">' + this._trendArea + '</div>'
      : '<div class="loading">Caricamento\u2026</div>';

    const pillVs = (current, prev, cap, dec) => {
      if (current === null || prev === undefined || prev === null || prev <= 0) return '<div class="pair-trend">\u2014</div>';
      const diff = current - prev;
      const up = diff > 0;
      const arrow = up ? '\u2191' : '\u2193';
      const cls = up ? 'pill-up' : 'pill-down';
      return (
        '<div><span class="pill ' + cls + '">' + arrow + ' ' + Math.abs(diff).toFixed(dec) + ' kWh</span></div>' +
        '<div class="pill-cap">' + cap + '</div>'
      );
    };
    const monthNames = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const nowD = new Date();
    const prevMonthName = monthNames[(nowD.getMonth() + 11) % 12];
    const dayTrend = pillVs(day, this._yesterday, 'vs ieri, stessa ora', 1);
    const monthTrend = pillVs(month, this._lastMonth, 'vs ' + prevMonthName + ', stesso giorno', 0);
    let projHtml = '';
    if (month !== null) {
      const monthStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
      const monthEnd = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 1);
      const frac = (nowD - monthStart) / (monthEnd - monthStart);
      if (frac > 0.03) {
        projHtml = '<div class="proj"><span>Proiezione fine mese</span><b>~' + Math.round(month / frac) + ' kWh</b></div>';
      }
    }

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
    const activeHtml =
      active
        .map((c) => {
          const color = this._paletteColor(circuits.findIndex((x) => x.entity === c.entity));
          return (
            '<div class="load-row" data-entity="' + c.entity + '">' +
            '<span class="load-dot" style="background:' + color + '"></span>' +
            '<span class="load-name">' + c.name + '</span>' +
            '<span class="load-pct">' + pctOf(c.val) + '</span>' +
            '<span class="load-w">' + this._fmt(c.val, ' W', c.val < 10 ? 1 : 0) + '</span>' +
            '</div>'
          );
        })
        .join('') +
      (other !== null && active.length
        ? '<div class="load-row load-other">' +
          '<span class="load-dot" style="background:var(--divider-color,rgba(0,0,0,.08))"></span>' +
          '<span class="load-name">Altro (non monitorato)</span>' +
          '<span class="load-pct">' + pctOf(other) + '</span>' +
          '<span class="load-w">~' + other.toFixed(0) + ' W</span>' +
          '</div>'
        : '');

    this.innerHTML =
      this._styles() +
      '<div class="hero">' +
      '<div class="hero-top"><span class="hero-l">' + (this.config.title || 'Consumo casa') + '</span><span class="hero-tag">' + (this.config.history_hours || 24) + 'h</span></div>' +
      '<div class="hero-v">' + this._fmt(power, ' W', power !== null && power < 10 ? 1 : 0) + '</div>' +
      trendHtml +
      '</div>' +
      '<div class="pairhero">' +
      '<div class="pair">' +
      '<div class="stat-tile"><div class="stat-l">Oggi</div><div class="stat-v">' + this._fmt(day, ' kWh', 1) + '</div>' + dayTrend + '</div>' +
      '<div class="stat-tile"><div class="stat-l">Mese</div><div class="stat-v">' + this._fmt(month, ' kWh', 0) + '</div>' + monthTrend + '</div>' +
      '</div>' +
      projHtml +
      '</div>' +
      (activeHtml
        ? '<div class="loadlist">' +
          '<div class="load-top"><span class="hero-l">Carichi attivi adesso</span><span class="hero-tag">' + this._fmt(power, ' W', 0) + '</span></div>' +
          compBar +
          activeHtml +
          '</div>'
        : '');
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
    this.innerHTML = this._styles() + '<div class="wrap">' + rows + '</div>';
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
      '.pill-cap{font-size:10px;color:var(--secondary-text-color,#6b6f76);margin-top:5px;}' +
      '.proj{font-size:11px;color:var(--secondary-text-color,#6b6f76);margin-top:14px;padding-top:10px;border-top:1px solid var(--divider-color,rgba(0,0,0,.07));display:flex;justify-content:space-between;}' +
      '.proj b{color:var(--primary-text-color,#1c1c1e);font-weight:600;}' +
      '.loadlist{background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,rgba(0,0,0,.08));border-radius:16px;padding:14px 16px 6px;}' +
      '.load-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px;}' +
      '.comp{display:flex;height:6px;border-radius:3px;overflow:hidden;margin-bottom:5px;}' +
      '.load-row{display:flex;align-items:center;gap:10px;padding:10px 0;cursor:pointer;border-bottom:1px solid var(--divider-color,rgba(0,0,0,.07));}' +
      '.load-row:last-child{border-bottom:none;}' +
      '.load-other{opacity:.65;cursor:default;}' +
      '.load-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;}' +
      '.load-name{flex:1;min-width:0;font-size:13px;color:var(--primary-text-color,#1c1c1e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.load-pct{font-size:11px;color:var(--secondary-text-color,#6b6f76);width:38px;text-align:right;flex:0 0 auto;}' +
      '.load-w{font-size:15px;font-weight:600;color:var(--primary-text-color,#1c1c1e);width:56px;text-align:right;flex:0 0 auto;}' +
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
  }

  set hass(hass) {
    this._hass = hass;
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
    if (this.config.layout === 'ups') this._renderUps();
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
    this.innerHTML = this._styles() + '<div class="grid2">' + rows + '</div>';
    this.querySelectorAll('.row').forEach((row) => {
      row.addEventListener('click', (e) => {
        const entity = row.getAttribute('data-entity');
        if (e.target.closest('.toggle')) this._toggle(entity);
        else this._openMoreInfo(entity);
      });
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
    this.innerHTML = this._styles() + '<div class="grid2">' + html + '</div>';
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
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
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
      this._daily = [];
      this._dailyError = (e && e.message) || String(e);
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
      this._monthly = [];
      this._monthlyError = (e && e.message) || String(e);
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
          'position:absolute;pointer-events:none;background:var(--primary-text-color,#1c1c1e);color:#fff;font-size:11px;font-weight:500;padding:3px 8px;border-radius:6px;white-space:nowrap;opacity:0;transition:opacity .1s;z-index:2;transform:translate(-50%,-100%);top:-6px;';
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
        container._hideTimer = setTimeout(hideTip, 2000);
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

    this.innerHTML =
      this._styles() +
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
      '</ha-card>';
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
    // id gradiente univoco per istanza: in light DOM gli id sono globali,
    // due card con lo stesso id condividerebbero il colore del riempimento
    if (!this._uid) {
      EnergyMonthlyCard._seq = (EnergyMonthlyCard._seq || 0) + 1;
      this._uid = EnergyMonthlyCard._seq;
    }
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
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
        types: ['change'],
      });
      let arr = (resp && resp[this.config.entity]) || [];
      arr = arr.slice().sort((a, b) => new Date(a.start) - new Date(b.start));
      this._data = arr;
    } catch (e) {
      this._data = [];
      this._error = (e && e.message) || String(e);
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
      const vals = data.map((d) => Math.max(0, d.change || 0));
      const vmax = Math.max.apply(null, vals) || 1;
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

    this.innerHTML =
      this._styles() +
      '<ha-card class="emc-flat">' +
      '<div class="emc-card">' +
      '<div class="emc-top">' +
      '<div class="emc-titles"><span class="emc-title">' + cfg.title + '</span>' + (bigCap ? '<span class="emc-sub">' + bigCap + '</span>' : '') + '</div>' +
      '<div class="emc-big">' + bigVal + '</div>' +
      '</div>' +
      body +
      '</div>' +
      '</ha-card>';
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
      '.emc-tip{position:absolute;opacity:0;transform:translate(-50%,-100%);pointer-events:none;background:var(--primary-text-color,#1c1c1e);color:var(--ha-card-background,#fff);font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;white-space:nowrap;transition:opacity .08s;z-index:2;}' +
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
    this._rings = [];
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

  _routes() {
    if (this._mobile) {
      // mobile: sorgenti in alto, tutto converge su Casa in basso
      return {
        sole_casa: { p: [[0.5, 0.13], [0.5, 0.84]], c: 'sole' },
        rete_casa: { p: [[0.25, 0.45], [0.25, 0.84], [0.5, 0.84]], c: 'rete' },
        batt_casa: { p: [[0.75, 0.45], [0.75, 0.84], [0.5, 0.84]], c: 'batt' },
        sole_batt: { p: [[0.5, 0.13], [0.75, 0.13], [0.75, 0.45]], c: 'sole' },
        sole_rete: { p: [[0.5, 0.13], [0.25, 0.13], [0.25, 0.45]], c: 'sole' },
      };
    }
    return {
      rete_casa: { p: [[0.13, 0.74], [0.5, 0.74]], c: 'rete' },
      batt_casa: { p: [[0.87, 0.74], [0.5, 0.74]], c: 'batt' },
      sole_casa: { p: [[0.5, 0.24], [0.5, 0.74]], c: 'sole' },
      sole_batt: { p: [[0.5, 0.24], [0.87, 0.24], [0.87, 0.74]], c: 'sole' },
      sole_rete: { p: [[0.5, 0.24], [0.13, 0.24], [0.13, 0.74]], c: 'sole' },
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
    };
    return F[key];
  }
  _routeOn(rk) {
    const c = this.config;
    if (c.predispose) return true; // disegna tutte le linee anche senza entità (predisposizione)
    if (rk === 'rete_casa') return !!c.grid_power;
    if (rk === 'sole_casa' || rk === 'sole_batt' || rk === 'sole_rete') return !!c.solar_power;
    if (rk === 'batt_casa') return !!c.battery_power;
    return false;
  }

  _icon(k) {
    const I = {
      sole: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
      rete: '<path d="M6 22 12 2l6 20"/><path d="M9 22 12 2l3 20"/><path d="M6.8 8h10.4M7.7 13h8.6M8.6 18h6.8"/>',
      batt: '<rect x="3" y="8" width="15" height="8" rx="2"/><path d="M21 11v2"/><path d="M6.5 10.5v3M10 10.5v3"/>',
      casa: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>',
    };
    return '<svg viewBox="0 0 24 24">' + I[k] + '</svg>';
  }
  _node(id, name) {
    // posizioni gestite via CSS (classi desktop/mobile), qui solo il colore
    return (
      '<div class="ef-nd" data-n="' + id + '" style="--c:var(--ef-' + id + ')">' +
      '<span class="ef-ic">' + this._icon(id) + '</span>' +
      '<span class="ef-lab"><span class="ef-k" data-k="' + id + '">' + name + '</span>' +
      '<span class="ef-v"><span data-v="' + id + '">—</span> <small data-u="' + id + '"></small></span></span></div>'
    );
  }

  _build() {
    this.innerHTML =
      this._styles() +
      '<div class="ef-card">' +
      '<div class="ef-stage"><canvas></canvas>' +
      '<span class="ef-live"><i></i>ora</span>' +
      this._node('sole', 'Solare') +
      this._node('rete', 'Rete') +
      this._node('batt', 'Batteria') +
      this._node('casa', 'Casa') +
      '</div></div>';
    this._card = this.querySelector('.ef-card');
    this._live = this.querySelector('.ef-live');
    this._stage = this.querySelector('.ef-stage');
    this._cv = this.querySelector('canvas');
    this._ctx = this._cv.getContext('2d');
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
    if (mobile !== this._mobile) { this._mobile = mobile; if (this._card) this._card.classList.toggle('ef-mobile', mobile); }
    const r = this._stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this._W = r.width;
    this._H = r.height;
    this._cv.width = this._W * dpr;
    this._cv.height = this._H * dpr;
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._measure();
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
    });
    this._nrects = R;
  }

  _palette() {
    return this._dark
      ? { rete: '#38BDF8', sole: '#F5B301', batt: '#22E39A', casa: '#8B7BFF' }
      : { rete: '#0EA5E9', sole: '#E08A00', batt: '#0FB57E', casa: '#6D5AE6' };
  }

  _setNode(id, val) {
    const v = this.querySelector('[data-v=' + id + ']');
    const u = this.querySelector('[data-u=' + id + ']');
    if (!v) return;
    if (val === null || val === undefined) { v.textContent = '—'; u.textContent = ''; return; }
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
    const g = this._num(c.grid_power), s = this._num(c.solar_power), b = this._num(c.battery_power), soc = this._num(c.battery_soc), h = this._num(c.house_power);
    const P0 = !!c.predispose; // se predisposto, mostra 0 dove l'entità manca invece di "—"
    this._setNode('sole', s === null && P0 ? 0 : s);
    this._setNode('rete', g === null ? (P0 ? 0 : null) : Math.abs(g));
    this._setNode('batt', b === null ? (P0 ? 0 : null) : Math.abs(b));
    this._setNode('casa', h === null && P0 ? 0 : h);
    const bk = this.querySelector('[data-k=batt]');
    if (bk) { let t = 'Batteria'; if (soc !== null) t += ' · ' + Math.round(soc) + '%'; if (b !== null) t += b > 5 ? ' scarica' : b < -5 ? ' carica' : ''; bk.textContent = t; }
    const rk = this.querySelector('[data-k=rete]');
    if (rk) rk.textContent = g !== null && g < -5 ? 'Rete · immissione' : 'Rete';
    const TH = c.threshold || 5;
    const flows = {};
    if (g !== null) { if (g > TH) flows.rete_casa = g; else if (g < -TH) flows.casa_rete = -g; }
    if (s !== null && s > TH) flows.sole_casa = s;
    if (b !== null) { if (b > TH) flows.batt_casa = b; else if (b < -TH) flows.sole_batt = -b; }
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
  // sposta l'estremo (centro nodo) fino al bordo del box + gap, lungo il segmento adiacente
  _edge(rc, toward, gap) {
    const dx = toward[0] - rc.cx, dy = toward[1] - rc.cy;
    if (Math.abs(dx) >= Math.abs(dy)) return [rc.cx + Math.sign(dx) * (rc.hw + gap), rc.cy];
    return [rc.cx, rc.cy + Math.sign(dy) * (rc.hh + gap)];
  }
  // polilinea del percorso con estremi tagliati al bordo dei nodi (parte e arriva dal bordo, non dal centro)
  _trimmedPoly(rk) {
    const poly = this._polyPx(rk).map((p) => p.slice());
    const R = this._nrects || {};
    const ends = { rete_casa: ['rete', 'casa'], batt_casa: ['batt', 'casa'], sole_casa: ['sole', 'casa'], sole_batt: ['sole', 'batt'], sole_rete: ['sole', 'rete'] }[rk];
    const gap = 2;
    if (ends && R[ends[0]] && poly.length > 1) poly[0] = this._edge(R[ends[0]], poly[1], gap);
    if (ends && R[ends[1]] && poly.length > 1) poly[poly.length - 1] = this._edge(R[ends[1]], poly[poly.length - 2], gap);
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
    const em = { rete_casa: ['rete', 'casa'], batt_casa: ['batt', 'casa'], sole_casa: ['sole', 'casa'], sole_batt: ['sole', 'batt'], sole_rete: ['sole', 'rete'] }[def[0]];
    if (!em) return null;
    return def[1] ? [em[1], em[0]] : em;
  }
  // anello di assorbimento sul nodo di destinazione all'arrivo del fascio
  _ring(node, t, color) {
    const rc = (this._nrects || {})[node]; if (!rc) return;
    const ctx = this._ctx, dark = this._dark;
    const rad = Math.max(rc.hw, rc.hh) * 0.5 + t * 26;
    ctx.globalAlpha = (1 - t) * (dark ? 0.85 : 0.6); ctx.strokeStyle = color; ctx.shadowColor = color;
    ctx.shadowBlur = dark ? 15 : 9; ctx.lineWidth = 2.6 * (1 - t * 0.5);
    ctx.beginPath(); ctx.arc(rc.cx, rc.cy, rad, 0, 7); ctx.stroke();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
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
          if (pl.head > 1) { pl.head -= 1; const en = this._flowEnds(pl.key); if (en) this._rings.push({ node: en[1], t: 0, c: NCOL[def[2]] }); }
          this._beam(poly, m, pl.head, NCOL[def[2]]);
        });
        this._rings.forEach((rg) => { rg.t += dt * 1.6; });
        this._rings = this._rings.filter((rg) => { if (rg.t >= 1) return false; this._ring(rg.node, rg.t, rg.c); return true; });
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
      '.ef-stage{position:relative;width:100%;aspect-ratio:3.3/1;}' +
      '.ef-stage canvas{position:absolute;inset:0;width:100%;height:100%;z-index:1;}' +
      '.ef-live{position:absolute;right:2px;top:2px;z-index:4;display:flex;align-items:center;gap:6px;font-size:11px;color:var(--secondary-text-color,#6b6f76);}' +
      '.ef-live i{width:7px;height:7px;border-radius:50%;background:var(--ef-batt);}' +
      '.ef-nd{position:absolute;transform:translate(-50%,-50%);z-index:3;pointer-events:none;display:flex;align-items:center;gap:13px;' +
      'padding:11px 17px;border-radius:16px;background:var(--ha-card-background,var(--card-background-color,#fff));' +
      'border:1px solid var(--divider-color,rgba(0,0,0,.1));white-space:nowrap;}' +
      '.ef-ic{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;flex:0 0 auto;' +
      'background:color-mix(in srgb,var(--c) 18%,transparent);}' +
      '.ef-ic svg{width:27px;height:27px;stroke:var(--c);fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;}' +
      '.ef-lab{display:flex;flex-direction:column;line-height:1.15;}' +
      '.ef-k{font-size:12px;font-weight:600;color:var(--secondary-text-color,#6b6f76);}' +
      '.ef-v{font-size:19px;font-weight:700;color:var(--primary-text-color,#1c1c1e);margin-top:3px;font-variant-numeric:tabular-nums;}' +
      '.ef-v small{font-size:12px;color:var(--secondary-text-color,#6b6f76);font-weight:500;}' +
      // posizioni desktop
      '.ef-nd[data-n=sole]{left:50%;top:24%;} .ef-nd[data-n=rete]{left:13%;top:74%;} .ef-nd[data-n=batt]{left:87%;top:74%;} .ef-nd[data-n=casa]{left:50%;top:74%;}' +
      // layout mobile: stage piu' alto, sorgenti in alto, Casa in basso
      '.ef-mobile .ef-stage{aspect-ratio:1.02/1;}' +
      '.ef-mobile .ef-nd{gap:10px;padding:9px 13px;} .ef-mobile .ef-ic{width:40px;height:40px;} .ef-mobile .ef-ic svg{width:24px;height:24px;} .ef-mobile .ef-v{font-size:17px;}' +
      '.ef-mobile .ef-nd[data-n=sole]{left:50%;top:13%;} .ef-mobile .ef-nd[data-n=rete]{left:25%;top:45%;} .ef-mobile .ef-nd[data-n=batt]{left:75%;top:45%;} .ef-mobile .ef-nd[data-n=casa]{left:50%;top:84%;}' +
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

