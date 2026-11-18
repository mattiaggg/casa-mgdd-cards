// Stati finti per il banco della casa-mgdd-monitor-card: numeri del mockup
// "HA Monitor" del 2026-11-18, entità con gli ID reali di casa.
// Espone MON_FIXTURE(scenario) -> oggetto hass completo (states, entities,
// devices, callWS, connection).
(function () {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const H = 3600000;
  const D = 86400000;

  function build(scenario) {
    const states = {};
    const entities = {};
    const devices = {};
    const s = (id, state, attrs, extra) => {
      states[id] = Object.assign({
        entity_id: id,
        state: String(state),
        attributes: attrs || {},
        last_changed: iso(now - 2 * H),
        last_updated: iso(now - 10 * 60000),
      }, extra || {});
      return id;
    };
    const dev = (did, name, ids, platform) => {
      devices[did] = { id: did, name: name, name_by_user: null };
      ids.forEach((id) => (entities[id] = { entity_id: id, device_id: did, platform: platform || 'x' }));
    };
    const unit = (u, extra) => Object.assign({ unit_of_measurement: u, state_class: 'measurement' }, extra || {});
    const upd = (id, inst, latest, title) =>
      s(id, inst === latest ? 'off' : 'on', { installed_version: inst, latest_version: latest, title: title, friendly_name: title + ' Update' });

    // host
    const temp = scenario === 'allarmi' ? 87 : 70;
    s('sensor.system_monitor_processor_use', scenario === 'allarmi' ? 91 : 39, unit('%', { friendly_name: 'Processor use' }));
    s('sensor.system_monitor_processor_temperature', temp, unit('°C', { friendly_name: 'Processor temperature' }));
    s('sensor.system_monitor_memory_usage', 26.3, unit('%'));
    s('sensor.system_monitor_memory_use', 4.3532681216, unit('GB'));
    s('sensor.system_monitor_memory_free', 12.1836142592, unit('GB'));
    s('sensor.system_monitor_disk_use', scenario === 'allarmi' ? 410 : 158.27, unit('GB'));
    s('sensor.system_monitor_disk_free', scenario === 'allarmi' ? 72.9 : 324.59, unit('GB'));
    s('sensor.system_monitor_last_boot', iso(now - (8 * D + 18 * H)), { device_class: 'timestamp' });

    // versioni (core/supervisor/os) e card
    upd('update.home_assistant_core_update', '2026.11.2', scenario === 'allarmi' ? '2026.11.3' : '2026.11.2', 'Home Assistant Core');
    upd('update.home_assistant_supervisor_update', '2026.11.0', '2026.11.0', 'Home Assistant Supervisor');
    upd('update.home_assistant_operating_system_update', '18.4', '18.4', 'Home Assistant Operating System');
    upd('update.casa_mgdd_cards_update', 'v1.97.0', 'v1.97.0', 'casa-mgdd-cards');
    ['update.home_assistant_core_update', 'update.home_assistant_supervisor_update', 'update.home_assistant_operating_system_update']
      .forEach((id) => (entities[id] = { entity_id: id, platform: 'hassio' }));

    // backup
    s('event.backup_backup_automatico', iso(now - 9 * H), {
      event_types: ['completed', 'failed', 'in_progress'],
      event_type: scenario === 'allarmi' ? 'failed' : 'completed',
      failed_reason: scenario === 'allarmi' ? 'upload_failed' : null,
      friendly_name: 'Backup Backup automatico',
    });
    s('sensor.backup_backup_manager_state', 'idle');
    s('sensor.backup_last_successful_automatic_backup', iso(now - (scenario === 'allarmi' ? 40 : 9) * H), { device_class: 'timestamp' });
    s('sensor.backup_last_attempted_automatic_backup', iso(now - 9 * H - 124000), { device_class: 'timestamp' });
    s('sensor.backup_next_scheduled_automatic_backup', iso(now + 16 * H), { device_class: 'timestamp' });
    s('sensor.backup_dimensione_ultimo_backup_automatico_riuscito', 1121.59, unit('MiB'));

    // app (Supervisor)
    const apps = [
      ['frigate', 'Frigate (Full Access)', 'update.frigate_full_access_update', '0.18.2', 'frigate_full_access', true, 18.4, 10.2, 'it'],
      ['z2m', 'Zigbee2MQTT', 'update.zigbee2mqtt_update', '2.14.3-1', 'zigbee2mqtt', true, 1.2, 0.7, 'it'],
      ['mosq', 'Mosquitto broker', 'update.mosquitto_broker_update', '7.1.3', 'mosquitto_broker', true, 0.3, 0.1, 'en'],
      ['ring', 'Ring-MQTT with Video Streaming', 'update.ring_mqtt_with_video_streaming_update', '5.9.3', 'ring_mqtt_with_video_streaming', true, 2.1, 0.5, 'en'],
      ['matter', 'Matter Server', 'update.matter_server_update', '9.3.0', 'matter_server', true, 0.6, 1.2, 'en'],
      ['otbr', 'OpenThread Border Router', 'update.openthread_border_router_update', '3.4.0'],
      ['adg', 'AdGuard Home', 'update.adguard_home_update', '6.3.2'],
      ['cf', 'Cloudflared', 'update.cloudflared_update', '7.0.21'],
      ['eufy', 'eufy-security-ws', 'update.eufy_security_ws_update', '3.1.0'],
      ['mcp', 'Home Assistant MCP Server', 'update.home_assistant_mcp_server_update', '9.2.0'],
      ['dep', 'DepilStop Scraper', 'update.depilstop_scraper_update', '1.2.0'],
      ['vsc', 'Studio Code Server', 'update.studio_code_server_update', '7.2.0'],
      ['ssh', 'Advanced SSH & Web Terminal', 'update.advanced_ssh_web_terminal_update', '24.2.1'],
      ['fe', 'File editor', 'update.file_editor_update', '6.3.1'],
      ['sql', 'SQLite Web', 'update.sqlite_web_update', '6.1.1'],
    ];
    apps.forEach((a) => {
      const ids = [upd(a[2], a[3], a[0] === 'adg' && scenario === 'allarmi' ? '6.4.0' : a[3], a[1])];
      if (a[5]) {
        const it = a[8] === 'it';
        const stopped = scenario === 'allarmi' && a[0] === 'ring';
        ids.push(s('binary_sensor.' + a[4] + (it ? '_in_esecuzione' : '_running'), stopped ? 'off' : 'on', { device_class: 'running' }));
        ids.push(s('sensor.' + a[4] + (it ? '_percentuale_cpu' : '_cpu_percent'), stopped ? 0 : a[6], unit('%')));
        ids.push(s('sensor.' + a[4] + (it ? '_percentuale_di_memoria' : '_memory_percent'), stopped ? 0 : a[7], unit('%')));
      }
      dev('app_' + a[0], a[1], ids, 'hassio');
    });

    // servizi
    s('binary_sensor.zigbee2mqtt_bridge_connection_state', 'on');
    s('sensor.zigbee2mqtt_bridge_version', '2.14.3');
    s('sensor.zigbee2mqtt_bridge_coordinator_version', '7.4.5 [GA]');
    s('switch.zigbee2mqtt_bridge_permit_join', 'off');
    s('select.zigbee2mqtt_bridge_log_level', 'info');
    s('sensor.frigate_status', 'running');
    s('sensor.frigate_uptime', 207.3, unit('h'));
    upd('update.frigate_server', '0.18.2', '0.18.2', 'Frigate Server');
    s('ai_task.google_ai_task', iso(now - 2.4 * H));
    s('sensor.lavatrici_piano', 'ok', {}, { last_updated: iso(now - 32 * 60000) });

    // rete
    s('sensor.cp4_k68150223_ip_wan', '203.0.113.42', {}, { last_changed: iso(now - 6 * D - 3 * H) });
    s('sensor.speedtest_scarica', 145.16, unit('Mbit/s'));
    s('sensor.speedtest_carica', 19.2, unit('Mbit/s'));
    s('sensor.speedtest_ping', 12, unit('ms'));
    s('sensor.mg_dd_clients', 35, unit(''));
    s('sensor.mg_dd_guest_clients', 0, unit(''));
    s('binary_sensor.ping_powerwall3', 'on');
    s('sensor.ping_powerwall3_round_trip_time_average', 16.05, unit('ms'));
    s('sensor.ping_powerwall3_perdita_di_pacchetti', 0, unit('%'));
    const uni = (p, cpu, mem, upDays, fw) => {
      s('sensor.' + p + '_state', 'connected');
      s('sensor.' + p + '_cpu_utilization', cpu, unit('%'));
      s('sensor.' + p + '_memory_utilization', mem, unit('%'));
      if (upDays) s('sensor.' + p + '_tempo_di_attivita', iso(now - upDays * D), { device_class: 'timestamp' });
      upd('update.' + p + '_firmware', fw, fw, p + ' firmware');
    };
    uni('express_7', 28.1, 57.5, 5, '5.2.15.34448');
    uni('usw_flex_2_5g_5', 6.4, 77.2, 8.75, '2.1.8.971');
    s('device_tracker.uapa69e', 'home');
    s('sensor.u7_mesh_cpu_utilization', 1.3, unit('%'));
    s('sensor.u7_mesh_memory_utilization', 60.6, unit('%'));
    upd('update.firmware', '8.8.14.20179', '8.8.14.20179', 'U7 Mesh firmware');
    s('binary_sensor.ups_tower_rete', scenario === 'allarmi' ? 'off' : 'on', { device_class: 'power' });
    s('sensor.ups_tower_livello_della_batteria', scenario === 'allarmi' ? 64 : 100, unit('%', { device_class: 'battery' }));
    s('sensor.ups_tower_durata_della_batteria', 60.8, unit('min'));
    s('sensor.ups_tower_potenza_di_uscita', 42, unit('W'));
    s('sensor.ups_tower_tensione_di_uscita', 227.7, unit('V'));
    s('sensor.ups_tower_corrente_di_uscita', 0.4, unit('A'));
    s('sensor.ups_tower_fattore_di_potenza_di_uscita', 0.461, unit(''));
    s('sensor.ups_tower_tensione_di_bypass', 227.7, unit('V'));
    for (let i = 1; i <= 10; i++) s('switch.ups_tower_outlet_' + i, scenario === 'allarmi' && i === 7 ? 'off' : 'on', { friendly_name: 'UPS Tower Outlet ' + i });
    s('sensor.adguard_home_query_dns', scenario === 'allarmi' ? 0 : 12480, unit('queries'));
    s('sensor.adguard_home_query_dns_bloccate', 2321, unit('queries'));
    s('sensor.adguard_home_rapporto_di_query_dns_bloccate', 18.6, unit('%'));
    s('sensor.adguard_home_velocita_di_elaborazione_media', 3.2, unit('ms'));
    s('sensor.adguard_home_navigazione_sicura_bloccata', 4, unit('requests'));
    s('device_tracker.raspberry5', 'home');
    s('sensor.daikin_zona_giorno_gateway_ip_address', '192.168.178.101');
    s('sensor.daikin_zona_notte_gateway_ip_address', '192.168.178.72');
    s('sensor.shellyproem50_uptime', iso(now - 26 * H));
    s('sensor.iphone18pro_mattia_iphone17pro_mattia2_app_version', '2026.10.3');
    s('sensor.iphone_di_deborah_app_version', '2026.10.3');

    // automazioni
    for (let i = 0; i < 64; i++) s('automation.auto_' + i, 'on', { friendly_name: 'Automazione ' + i });
    s('automation.frigate_reolink_avvisi_con_video_ai', 'unavailable', { id: '1773060668426', friendly_name: 'Frigate Reolink - Avvisi con video AI' });
    s('automation.risparmio_energetico_notturno', 'off', { friendly_name: 'Ogni giorno alle ore 00:30', last_triggered: '2025-07-21T22:30:00+00:00' });
    s('automation.webhook_apri_garage', 'off', { friendly_name: 'Webhook - apri garage', last_triggered: null });
    s('automation.lavatrice_terminata_backup', 'off', { friendly_name: 'Lavatrice terminata (backup)', last_triggered: null });
    for (let i = 0; i < 16; i++) s('script.script_' + i, 'off');

    // batterie
    const batt = [
      ['huewall_soggiornosx', 'HueWall-SoggiornoSx', scenario === 'allarmi' ? 12 : 35],
      ['nuki', 'Nuki Ultra', 48],
      ['nuki_mqtt', 'Nuki Ultra', 48],
      ['temp_soggiorno', 'Sensore Temperatura Soggiorno', 70],
      ['cp4', 'CP4(K68150223)', 77],
      ['aqara_th', 'Aqara Temp/Humidity Sensor', 80],
      ['shellyflood', 'ShellyFlood Lavanderia', 81],
      ['porta_stireria', 'Porta Stireria', 90],
      ['aqara_leak', 'Aqara Water Leak Sensor', 92],
      ['porta_cucina', 'Porta Cucina', 97],
    ];
    for (let i = 0; i < 26; i++) batt.push(['b' + i, 'Sensore ' + (i + 1), 98 + (i % 3)]);
    batt.forEach((b) => {
      const ids = [];
      for (let k = 0; k < (b[3] || 1); k++) ids.push(s('sensor.' + b[0] + '_batteria' + (k ? '_' + (k + 1) : ''), b[2], unit('%', { device_class: 'battery', friendly_name: b[1] + ' Batteria' })));
      dev('d_' + b[0], b[1], ids);
    });
    s('sensor.powerwall3_charge', 0, unit('%', { device_class: 'battery' }));
    s('sensor.iphone_di_deborah_battery_level', 95, unit('%', { device_class: 'battery' }));
    s('input_button.check_battery_status', iso(now - 6 * H));
    s('input_text.check_battery_result', 'Sensore Temperatura bagno Deborah: batteria non disponibile', {}, { last_changed: iso(now - 6 * H) });

    // entita' non disponibili, raggruppate per dispositivo come a casa
    const un = [
      ['dreame', 'DreameBot L20 Ultra Complete', 62, 140, 0.4],
      ['echo', 'Echo Plus di Mattia', 13, 20, 3],
      ['nous', 'Presa smart Nous', 11, 11, 6],
      ['meross', 'Presa smart Meross', 11, 11, 12],
      ['iphone15', 'iPhone15Pro-Deborah', 10, 40, 0.2],
      ['echodot', '2º Echo Dot di Mattia', 6, 12, 3],
      ['aeg', 'Lavatrice AEG 9000', 6, 20, 0.3],
      ['bagnodeb', 'Sensore Temperatura bagno Deborah', 4, 4, 4],
      ['ciabatta', 'Ciabatta soggiorno', 4, 4, 9],
      ['onedrive', 'OneDrive', 3, 3, 62],
      ['daikin', 'Daikin zona giorno ClimateControl', 2, 30, 1],
    ];
    un.forEach((u) => {
      const ids = [];
      for (let i = 0; i < u[3]; i++) {
        const dom = i % 5 === 0 ? 'select' : i % 3 === 0 ? 'switch' : 'sensor';
        ids.push(s(dom + '.' + u[0] + '_' + i, i < u[2] ? 'unavailable' : '1', {}, { last_changed: iso(now - u[4] * D) }));
      }
      dev('u_' + u[0], u[1], ids);
    });
    for (let i = 0; i < 9; i++) s('sensor.orfano_' + i, 'unknown');
    s('update.soggiorno_power_strip_firmware', 'unavailable', { friendly_name: 'Ciabatta soggiorno Firmware' });
    s('update.stireria_presa_smart_meross_firmware', 'unavailable', { friendly_name: 'Presa smart Meross Firmware' });
    for (let i = 0; i < 60; i++) upd('update.altro_' + i, '1.0.' + i, '1.0.' + i, 'Componente ' + i);

    // statistiche orarie e giornaliere
    const hourly = (fn, hours) => {
      const out = [];
      for (let i = hours - 1; i >= 0; i--) {
        const start = now - (i + 1) * H;
        out.push(Object.assign({ start: start, end: start + H }, fn(hours - 1 - i)));
      }
      return out;
    };
    const cpuSeries = hourly((i) => {
      const base = 30 + 12 * Math.sin(i / 3) + (i === 12 ? 30 : 0);
      return { mean: base, max: base + 9 + (i === 12 ? 20 : 0) };
    }, 24);
    const tempSeries = hourly((i) => ({ mean: 60 + 5 * Math.sin(i / 4), max: 66 + 6 * Math.sin(i / 4) + (i === 12 ? 4 : 0) }), 24);
    const day0 = new Date();
    day0.setHours(0, 0, 0, 0);
    const daily = (n, fn) => {
      const out = [];
      for (let i = n - 1; i >= 0; i--) {
        const start = day0.getTime() - i * D;
        out.push(Object.assign({ start: start, end: start + D }, fn(n - 1 - i)));
      }
      return out;
    };
    const sizeSeries = daily(14, (i) => ({ max: 1060 + i * 5 }));
    const downSeries = daily(7, (i) => ({ mean: [138, 142, 92, 132, 146, 141, 145][i] }));
    const upSeries = daily(7, (i) => ({ mean: [18, 19, 13, 18, 19.5, 18.6, 19.2][i] }));
    const clientsSeries = [];
    for (let h = 0; h <= new Date().getHours(); h++) clientsSeries.push({ start: day0.getTime() + h * H, max: h === 20 ? 41 : 30 + (h % 5) });

    const backupEvents = [];
    for (let i = 13; i >= 0; i--) {
      const t = day0.getTime() - i * D + 4 * H + 8 * 60000;
      const failed = i === 9 || (scenario === 'allarmi' && i === 0);
      backupEvents.push({ s: iso(t - 120000), a: { event_type: 'in_progress' }, lu: (t - 120000) / 1000 });
      backupEvents.push({ s: iso(t), a: { event_type: failed ? 'failed' : 'completed', failed_reason: failed ? 'upload_failed' : null }, lu: t / 1000 });
    }

    const callWS = async (msg) => {
      await new Promise((r) => setTimeout(r, 60));
      if (msg.type === 'recorder/statistics_during_period') {
        const out = {};
        msg.statistic_ids.forEach((id) => {
          if (id === 'sensor.system_monitor_processor_use') out[id] = cpuSeries;
          if (id === 'sensor.system_monitor_processor_temperature') out[id] = tempSeries;
          if (id === 'sensor.backup_dimensione_ultimo_backup_automatico_riuscito') out[id] = sizeSeries;
          if (id === 'sensor.speedtest_scarica') out[id] = downSeries;
          if (id === 'sensor.speedtest_carica') out[id] = upSeries;
          if (id === 'sensor.mg_dd_clients') out[id] = clientsSeries;
        });
        return out;
      }
      if (msg.type === 'history/history_during_period') return { 'event.backup_backup_automatico': backupEvents };
      if (msg.type === 'repairs/list_issues') {
        return { issues: scenario === 'allarmi' ? [{ domain: 'hacs', issue_id: 'restart_required', translation_key: 'restart_required', severity: 'warning', ignored: false }] : [] };
      }
      throw new Error('non simulato: ' + msg.type);
    };
    const connection = {
      subscribeMessage: (cb) => {
        setTimeout(() => cb({ type: 'current', notifications: { d1: { title: 'DreameBot L20 Ultra Complete', message: '### La spazzola laterale deve essere sostituita ![image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAzwAAAM8CAYAAAC)' }, m1: { title: '⚠️ Sacile: Piogge probabili (domani)', message: "<table><tr><td><img src='https://example.org/logo.png' width='72'></td><td>&nbsp;Pioggia **moderata** dalle 14</td></tr></table>" } } }), 50);
        return Promise.resolve(() => {});
      },
    };
    return {
      states: states,
      entities: entities,
      devices: devices,
      callWS: callWS,
      connection: connection,
      callService: (d, sv, data) => console.log('callService', d, sv, data),
      language: 'it',
    };
  }

  window.MON_FIXTURE = build;
})();
