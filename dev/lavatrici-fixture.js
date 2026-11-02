// Stati finti per l'harness della casa-mgdd-laundry-card: numeri del mockup
// (docs/2026-11-02-pianificatore-lavatrici-mockup.html), lunedì 2 novembre ore 12.
(function () {
  const ora = '2026-11-02T12:00:00+01:00';
  const st = (state, attributes, last_updated) => ({ state: String(state), attributes: attributes || {}, last_updated: last_updated || ora });

  // SOC orario da lun 12:00 a sab 24:00 (132 ore): scarica la notte, ricarica col sole
  const kwhGiorno = [10, 5.5, 9, 11, 12.5, 10.5];
  const lav = { 2: 2.2, 3: 4.0, 4: 7.0, 5: 2.7 };
  const soc = [];
  let b = 9.3;
  for (let i = 0; i < 132; i++) {
    const h = (12 + i) % 24;
    const g = Math.floor((12 + i) / 24);
    const sole = h >= 7 && h < 17 ? (kwhGiorno[g] * Math.sin(Math.PI * (h + 0.5 - 7) / 10)) / 6.3 : 0;
    const extra = h >= 15 && h <= 19 ? (lav[g] || 0) / 5 : 0;
    b = Math.max(0, Math.min(13.5, b + sole - 0.36 - extra));
    soc.push(Math.round((b / 13.5) * 100));
  }

  const giorni = [
    { data: '2026-11-02', nome: 'Lun', fasce: ['partlycloudy', 'partlycloudy', 'cloudy'], meteo: 'partlycloudy', kwh: 10, colore: 'rosso', fabbisogno: 8.7, lavaggi: [], migliore: false, soc_alba: null, picco: { ora: '15:00', pct: 80 } },
    { data: '2026-11-03', nome: 'Mar', fasce: ['cloudy', 'cloudy', 'cloudy'], meteo: 'cloudy', kwh: 5.5, colore: 'rosso', fabbisogno: 8.7, lavaggi: [], migliore: false, soc_alba: 35, picco: { ora: '15:00', pct: 52 } },
    { data: '2026-11-04', nome: 'Mer', fasce: ['partlycloudy', 'partlycloudy', 'partlycloudy'], meteo: 'partlycloudy', kwh: 9, colore: 'ambra', fabbisogno: 10.9, lavaggi: ['delicati'], migliore: false, soc_alba: 0, picco: { ora: '15:00', pct: 60 } },
    { data: '2026-11-05', nome: 'Gio', fasce: ['partlycloudy', 'sunny', 'partlycloudy'], meteo: 'partlycloudy', kwh: 11, colore: 'verde', fabbisogno: 12.7, lavaggi: ['cotoni'], migliore: false, soc_alba: 12, picco: { ora: '14:00', pct: 85 } },
    { data: '2026-11-06', nome: 'Ven', fasce: ['sunny', 'sunny', 'sunny'], meteo: 'sunny', kwh: 12.5, colore: 'verde', fabbisogno: 17.2, lavaggi: ['cotoni', 'stracci'], migliore: true, soc_alba: 30, picco: { ora: '14:00', pct: 100 } },
    { data: '2026-11-07', nome: 'Sab', fasce: ['partlycloudy', 'partlycloudy', 'partlycloudy'], meteo: 'partlycloudy', kwh: 10.5, colore: 'verde', fabbisogno: 11.4, lavaggi: ['sintetici'], migliore: false, soc_alba: 18, picco: { ora: '15:00', pct: 82 } },
  ];
  const assegnazioni = [
    { cat: 'cotoni', data: '2026-11-05', kwh: 4.0, enel_extra: 0, sconsigliato: false },
    { cat: 'cotoni', data: '2026-11-06', kwh: 4.0, enel_extra: 0, sconsigliato: false },
    { cat: 'stracci', data: '2026-11-06', kwh: 4.5, enel_extra: 0, sconsigliato: false },
    { cat: 'sintetici', data: '2026-11-07', kwh: 2.7, enel_extra: 0, sconsigliato: false },
    { cat: 'delicati', data: '2026-11-04', kwh: 2.2, enel_extra: 0.6, sconsigliato: false },
  ];
  const reali = [11.7, 12.3, 5.2, 3.7, 11.0, 8.2, 4.5, 3.4, 11.9, 11.6, 6.7, 9.4, 11.0, 10.6, 10.1];
  const stime = [11.2, 10.9, 6.7, 4.1, 9.4, 9.4, 3.4, 4.5, 10.1, 10.5, 8.2, 10.1, 11.2, 11.2, 9.4];
  const accGiorni = reali.map((r, i) => {
    const d = new Date(2026, 9, 18 + i);
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { data: iso, stima: stime[i], reale: r };
  });

  const piano = st('rosso', {
    aggiornato: '2026-11-02T06:00:00+01:00',
    meteo_ok: true,
    giorni,
    assegnazioni,
    obiettivo: { cotoni: { target: 2, fatti: 0 }, stracci: { target: 1, fatti: 0 }, delicati: { target: 1, fatti: 0 }, sintetici: { target: 1, fatti: 0 } },
    se_lavassi_oggi: { delicati: 1.9, sintetici: 2.4, cotoni: 3.6, stracci: 4.1 },
    consiglio: {
      titolo: 'Niente lavatrici oggi',
      testo: 'Anche senza lavaggi la batteria si esaurisce mercoledì verso le 03:00.',
      suggerimenti: ['Prossimo giorno buono: Gio', 'Giorno migliore: Ven'],
    },
    parametri: {
      tetto: 13.0, consumo_fisso: 8.7, notturno_kw: 0.36, capacita: 13.5,
      coeff: { sunny: 0.95, partlycloudy: 0.85, cloudy: 0.45, rainy: 0.3, altro: 0.25 },
      profilo: new Array(24).fill(0.36), alba: 7.1, tramonto: 16.9,
      consumi: { cotoni: 4.0, stracci: 4.5, delicati: 2.2, sintetici: 2.7 },
    },
    accuratezza: { errore_pct: 14.2, giorni: accGiorni },
  });

  const batteria = st(69, {
    aggiornato: ora, inizio: ora, soc,
    eventi: [{ inizio: '2026-11-04T03:00:00+01:00', fine: '2026-11-04T07:00:00+01:00', kwh: 0.6 }],
    enel_tot: 0.6, esaurimento: '2026-11-04T03:00:00+01:00',
    picco_oggi: { ora: '15:00', pct: 80 }, alba_domani: 35,
    unit_of_measurement: '%',
  });

  const lavaggi = st(0, {
    lavaggi: [
      { inizio: '2026-10-24T11:00:00+02:00', fine: '2026-10-24T15:30:00+02:00', cat: 'cotoni', programma: 'Cotton Pr Eco40-60', kwh_lav: 1.1, kwh_asc: 2.7, sole: 0.15, batteria: 0.1, enel: 0.75 },
      { inizio: '2026-10-27T13:00:00+01:00', fine: '2026-10-27T17:00:00+01:00', cat: 'sintetici', programma: 'Synthetic Pr Synthetics', kwh_lav: 0.8, kwh_asc: 1.9, sole: 0.4, batteria: 0.6, enel: 0 },
      { inizio: '2026-10-29T12:30:00+01:00', fine: '2026-10-29T17:00:00+01:00', cat: 'cotoni', programma: 'Cotton Pr Cottons', kwh_lav: 1.0, kwh_asc: 2.5, sole: 0.45, batteria: 0.55, enel: 0 },
      { inizio: '2026-10-30T12:00:00+01:00', fine: '2026-10-30T17:30:00+01:00', cat: 'cotoni', programma: 'Cotton Pr Cottons', kwh_lav: 1.3, kwh_asc: 3.1, sole: 0.6, batteria: 0.32, enel: 0.08 },
      { inizio: '2026-10-31T13:00:00+01:00', fine: '2026-10-31T18:00:00+01:00', cat: 'delicati', programma: 'Delicate Pr Delicates', kwh_lav: 0.6, kwh_asc: 1.6, sole: 0.55, batteria: 0.45, enel: 0 },
    ],
    medie: { cotoni: 4.0, stracci: 4.5, delicati: 2.2, sintetici: 2.7 },
  });

  const comuni = {
    'sensor.powerwall3_solar_power': st('2.1', { unit_of_measurement: 'kW' }),
    'sensor.powerwall3_load_power': st('0.2', { unit_of_measurement: 'kW' }),
    'sensor.powerwall3_site_power': st('0.0', { unit_of_measurement: 'kW' }),
    'sensor.powerwall3_battery_power': st('-1.9', { unit_of_measurement: 'kW' }),
    'input_number.lavatrici_soglia_enel': st('1.0'),
  };

  window.LD_FIXTURE = {
    ora,
    normale: Object.assign({}, comuni, {
      'sensor.lavatrici_piano': piano,
      'sensor.lavatrici_batteria': batteria,
      'sensor.lavatrici_lavaggi': lavaggi,
      'sensor.lavatrici_storico': st(15, { giorni: accGiorni }),
      'sensor.lavatrici_consiglio_ai': st('ok', {
        testo: 'Il sole arriva da giovedì. Oggi e domani niente lavatrici: martedì è coperto e nella notte tra martedì e mercoledì la batteria si svuota comunque. Mercoledì va bene un delicato; i due cotoni e gli stracci tienili per giovedì e venerdì, che è il giorno migliore della settimana. Sabato chiudi con i sintetici.',
        generato: '2026-11-02T06:02:00+01:00',
      }),
      'sensor.powerwall3_charge': st('69', { unit_of_measurement: '%' }),
    }),
    // dati mancanti: SOC assente, meteo non disponibile, previsione corta, niente storico né Gemini
    assente: Object.assign({}, comuni, {
      'sensor.lavatrici_piano': st('rosso', Object.assign({}, piano.attributes, {
        meteo_ok: false, giorni: giorni.slice(0, 3), assegnazioni: assegnazioni.filter((a) => a.data <= '2026-11-04'),
        accuratezza: { errore_pct: null, giorni: [] },
      })),
      'sensor.lavatrici_batteria': st('unavailable', {}),
      'sensor.lavatrici_lavaggi': st(0, { lavaggi: [], medie: { cotoni: 4.0, stracci: 3.0, delicati: 2.2, sintetici: 2.7 } }),
      'sensor.lavatrici_storico': st(0, { giorni: [] }),
      'sensor.powerwall3_charge': st('unavailable', {}),
    }),
  };
})();
