# Casa MGDD Cards

Libreria di card custom Lovelace per Home Assistant, usate nella dashboard di casa.

Il file `casa-mgdd-cards.js` registra più elementi custom in un'unica risorsa.

## Card incluse

Tutte si configurano in YAML; solo le due card temperatura hanno l'editor visuale.

| Card | Tipo (`type`) | Descrizione |
|------|---------------|-------------|
| Temperatura (bento / lista) | `custom:temperature-bento-card` | Media casa, calda/fredda, zona giorno/notte, o lista stanze (`layout: bento` / `list`). Editor visuale. |
| Riga temperatura | `custom:temperature-row-card` | Una stanza: temperatura, umidità opzionale, mini grafico. Editor visuale. |
| Meteo e allerte | `custom:weather-alert-card` | Previsioni ore/giorni, banner allerta Protezione Civile, rischio pioggia/temporale. |
| Energia panoramica/circuiti | `custom:energy-power-card` | Consumo istantaneo con trend, oggi/mese, carichi attivi, o lista circuiti con sparkline. |
| Energia interruttori/UPS | `custom:energy-controls-card` | Griglia di interruttori, oppure statistiche UPS. |
| Energia storico | `custom:energy-history-card` | Consumo giornaliero da statistiche a lungo termine. |
| Energia mensile | `custom:energy-monthly-card` | Consumo mensile (`entity`, `months`). Non compare nel selettore card. |
| Energia flusso | `custom:energy-flow-card` | Flusso Rete/Solare/Batteria/Casa con linee animate. |
| Energia riassunto | `custom:energy-summary-card` | Solare/Casa/Rete/Batteria in una riga, con verso e SOC. |
| Energia (Home) | `custom:casa-mgdd-energy-live-card` | Consumo di oggi, profilo orario per provenienza, stato live. |
| Energia · anello | `custom:casa-mgdd-energy-ring-card` | Autosufficienza di oggi al centro di una corona, valori live e riepilogo. |
| Energia · schema | `custom:casa-mgdd-energy-scheme-card` | Sole, rete, batteria e casa con le tracce attive illuminate. |
| Porte e finestre | `custom:casa-mgdd-doors-card` | Quadro aperture con orari dal recorder, ingresso, tapparelle, acqua, presenze, aria. |
| Aperture (compatta) | `custom:casa-mgdd-openings-card` | Riga riassuntiva di porte, finestre e serrature con dettaglio espandibile. |
| Sensori (compatta) | `custom:casa-mgdd-sensors-card` | Perdite acqua (`mode: water`) o movimento (`mode: motion`). |
| Stato sistema | `custom:casa-mgdd-system-card` | Monitoraggio di HA, una sezione per card: summary, host, network, zigbee, backup, batteries. |
| Presenza | `custom:casa-mgdd-presence-card` | Una tessera per persona; il tempo trascorso viene dal recorder. |
| Aria | `custom:casa-mgdd-air-card` | Un quadrante PM2.5 per stanza; colonna PM1/PM2.5/PM10 con le chiavi facoltative `pm1:`/`pm10:`; avvisi filtro. |
| VMC | `custom:casa-mgdd-vmc-card` | Una tessera per VMC: corona della portata e due comandi. |
| Robot | `custom:casa-mgdd-vacuum-card` | Robot aspirapolvere: corona del completamento, fase, stanza, routine a scomparsa. |
| Lavatrici | `custom:casa-mgdd-laundry-card` | Pianificatore lavatrici: un blocco per card (`block:` testata, oggi, batteria, enel, se-lavassi, gemini, settimana, grafico, perche, obiettivo, ultimi, programmi, stima). Legge i sensori `sensor.lavatrici_*`. |

## Installazione via HACS

1. HACS → menu ⋮ → **Custom repositories**.
2. URL: `https://github.com/mattiaggg/casa-mgdd-cards`, categoria **Dashboard**.
3. Installa **Casa MGDD Cards**.
4. HACS aggiunge automaticamente la risorsa Lovelace.
5. Ricarica la pagina (Ctrl/Cmd + F5).

## Aggiornamenti

Il push di un tag `vX.Y.Z` fa pubblicare la Release al workflow
`.github/workflows/release.yml`; HACS mostra poi l'aggiornamento. Prima del tag,
aggiornare il campo `Version:` nell'header di `casa-mgdd-cards.js`.

## Sviluppo

Nessun build: il file JS si modifica e si pubblica così com'è.
In `dev/` c'è un banco di prova per la card lavatrici
(`lavatrici-harness.html` + `lavatrici-fixture.js`, fixture normale, dati assenti,
simulazione scaduta, tema chiaro/scuro). Va servito via HTTP dalla radice del repo,
ad esempio `python -m http.server 8765`, poi `http://localhost:8765/dev/lavatrici-harness.html`.

## Uso — esempio `temperature-bento-card`

```yaml
type: custom:temperature-bento-card
layout: bento            # oppure: list
zona_giorno: sensor.temp_zona_giorno
zona_notte: sensor.temperatura_media_zona_notte
chart_hours: 48
rooms:
  - name: Soggiorno
    temp: sensor.soggiorno_temperature
    hum: sensor.soggiorno_humidity
```

La card supporta l'**editor visuale** nell'interfaccia Lovelace.
