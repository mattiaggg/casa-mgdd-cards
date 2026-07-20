# Casa MGDD Cards

Libreria di card custom Lovelace per Home Assistant, usate nella dashboard di casa.

Il file `casa-mgdd-cards.js` registra più elementi custom in un'unica risorsa.

## Card incluse

| Card | Tipo (`type`) | Descrizione |
|------|---------------|-------------|
| Temperatura (bento / lista) | `custom:temperature-bento-card` | Panoramica temperatura/umidità stanze, layout `bento` o `list`. Editor visuale disponibile. |
| Riga temperatura | `custom:temperature-row-card` | Riga compatta singola stanza. |
| Allerta meteo | `custom:weather-alert-card` | Meteo + allerte DPC. |
| Potenza energia | `custom:energy-power-card` | Carichi attivi, oggi/mese, panoramica potenza. |
| Controlli energia | `custom:energy-controls-card` | Controlli circuiti. |
| Storico energia | `custom:energy-history-card` | Istogramma consumo con base fissa. |

## Installazione via HACS

1. HACS → menu ⋮ → **Custom repositories**.
2. URL: `https://github.com/mattiaggg/casa-mgdd-cards`, categoria **Dashboard**.
3. Installa **Casa MGDD Cards**.
4. HACS aggiunge automaticamente la risorsa Lovelace.
5. Ricarica la pagina (Ctrl/Cmd + F5).

## Aggiornamenti

Pubblicando una nuova release su GitHub, HACS mostrerà l'aggiornamento disponibile.

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
