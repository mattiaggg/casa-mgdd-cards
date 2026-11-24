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
| Lavatrici | `custom:casa-mgdd-laundry-card` | Pianificatore lavatrici: tutta la dashboard in una card (`block: pagina`, per una vista panel) oppure un blocco per card (`block:` testata, oggi, batteria, enel, se-lavassi, gemini, settimana, grafico, perche, obiettivo, ultimi, programmi, stima). Legge i sensori `sensor.lavatrici_*`. Con `programma: /lovelace/lavatrici-programma` la pagina mostra in testa il pulsante verso la programmazione. |
| Programma lavatrice | `custom:casa-mgdd-laundry-program-card` | Programma la lavatrice AEG (`electrolux_status`): preferiti, programma, temperatura, centrifuga, antipiega, risciacquo, risparmio tempo e altre opzioni, filtrati con i vincoli che la lavatrice dichiara per ogni programma; partenza subito, all'ora scelta o con fine all'ora scelta (ritardo a passi di 30 minuti, max 20 ore); durata letta dalla lavatrice o stimata. Richiede `script.lavatrice_programma`, `script.lavatrice_programma_annulla`, `input_text.lavatrice_programma_impostazioni` e `sensor.lavatrici_durate_aeg` (config in HA). Opzione `back:` per il pulsante indietro. Per una vista panel. Banco: `dev/lavatrici-programma.html`. |
| Tile lavatrice | `custom:casa-mgdd-laundry-tile-card` | Una riga per la lavatrice AEG nella vista home: stato (in corso con fase e barra, programmata, pronta, finita, in pausa, allarme, spenta, disconnessa), programma impostato e orari (fine, partenza programmata). Il pulsante verso la pagina di programmazione (`programma:`, default `/lovelace/lavatrici-programma`) compare solo se la lavatrice è programmata o pronta con il controllo remoto attivo. Il resto della tile apre il more-info di `entity` (default `appliancestate`). Opzione `name:`. Banco: `dev/lavatrici-tile.html`. |
| Tile purificatore | `custom:casa-mgdd-purifier-tile-card` | Una tile per purificatore d'aria (`entity: fan.*`): modalità in pillola (verde Auto, blu manuale con ventola che gira, viola Notte), riga con i filtri o l'ora di spegnimento del timer, tasto accensione e segmenti con tutte le `preset_modes` (o `modes:`). Spento o non raggiungibile: tile a una riga come le native. Opzioni: `name:`, `filters:` (elenco di `entity`, `name`, `avviso`; sotto `filter_alert:` %, default 10, la tile diventa ambra), `timer:` (sensore in minuti), `auto_plus:` (switch: la pillola dice «Auto+»). Il resto della tile apre il more-info. Banco: `dev/purificatori-tile.html`. |
| Monitor | `custom:casa-mgdd-monitor-card` | Vista ha-monitor a pagina intera, da mettere in una vista panel: `page:` sistema (versioni, host, salute, backup, app, servizi), rete (UniFi, UPS, speedtest, AdGuard) o manutenzione (cose da fare, entità non disponibili per dispositivo, automazioni ferme, aggiornamenti, batterie). Sotto i 600 px la pagina sistema passa al layout da telefono. |
| Comandi rapidi | `custom:casa-mgdd-quick-actions-card` | Una tessera per comando, azionata con uno slide fino in fondo invece che con un tocco. `items:` con `name`, `icon`, `entity` (script, lock, button, scene, automation, switch; `action:` + `data:` per un servizio diverso). Con `lock:` la tessera mostra lo stato della serratura (verde bloccata, ambra sbloccata/aperta, rossa inceppata) e lo slide apre anche da sbloccata (scrocco); da aperta è disattivato. |
| Scene luci | `custom:casa-mgdd-scenes-card` | Selettore a segmenti per le scene luci: un tocco attiva la scena. `items:` con `name`, `icon`, `entity` (`scene.*`), `color` facoltativo. La voce dell'ultima scena attivata è evidenziata; con `watch:` (elenco di luci) lo resta solo se almeno una luce è accesa e nessuna è stata toccata dopo l'attivazione (`grace:` secondi di tolleranza, 30 di default). Banco: `dev/scene.html`. |

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
La pagina intera (`block: pagina`) si prova con `dev/lavatrici-pagina.html`, che imita `<ha-icon>` con il webfont MDI.
I banner di allerta della card meteo si provano con `dev/meteo-allerte.html` (verde, gialla, arancione e rossa, domani `unknown`).
Le tre pagine del monitor si provano con `dev/monitor.html` (`?page=sistema|rete|manutenzione`, dati normali o con allarmi, chiaro/scuro, ID sì/no); i dati finti stanno in `dev/monitor-fixture.js`.
I comandi rapidi si provano con `dev/comandi.html`: stati della Nuki a pulsante, servizi che rispondono o falliscono, chiaro/scuro; le chiamate ai servizi finiscono nel registro sotto la card.
La programmazione della lavatrice si prova con `dev/lavatrici-programma.html`: lavatrice simulata (scollegata, solo impostazioni, pronta, occupata, programmata, in lavaggio), script che accetta o rifiuta, chiaro/scuro.
La vista energia intera (bilancio, UPS, flusso, carichi, prese, totali, i cinque grafici) si prova con `dev/energia.html`: stati e statistiche finti, flusso di sera, a mezzogiorno o con la batteria caricata dalla rete, prese che commutano, chiaro/scuro.

## Uso — banner Protezione Civile in `weather-alert-card`

Con DPC Alert 2026.11.1 o successiva i binary_sensor dei rischi hanno solo lo
stato: livello e zona stanno in entità proprie. Passare i sensori `*_risk_level`
(banner da allerta gialla in su) e il sensore della zona:

```yaml
type: custom:weather-alert-card
weather_entity: weather.ilmeteo_site_1
dpc_entities:
  - sensor.dpc_today_hydraulic_risk_level
  - sensor.dpc_today_hydrogeological_risk_level
  - sensor.dpc_today_thunderstorm_risk_level
  - sensor.dpc_tomorrow_hydraulic_risk_level
  - sensor.dpc_tomorrow_hydrogeological_risk_level
  - sensor.dpc_tomorrow_thunderstorm_risk_level
dpc_zone_entity: sensor.dpc_alert_zone
```

I binary_sensor sono ancora accettati, ma senza livello: il banner dice solo "Attiva".

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
