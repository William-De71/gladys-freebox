// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// The three widgets on a made-up Freebox Delta and home network (fixed date,
// seeded randomness): the box with its traffic of the last 24 hours as the
// RRD API returns it, the call log with an unread missed call, and the
// devices connected right now. The answers of the box are made up; every
// line of the cards comes from src/widgets.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildBoxWidget, buildCallsWidget, buildNetworkWidget } = await load('src/widgets.js');
const { readSystem, readHosts, readCalls, readNetHistory } = await load('src/freebox/read.js');
const { LANGUAGES } = await load('src/i18n.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

// Sunday 18 October 2026, 20:00 in Paris.
const NOW = Date.parse('2026-10-18T18:00:00Z');
const NOW_S = NOW / 1000;

// mulberry32: the same "random" history on every run.
function random(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// The RRD answer of the last 24 hours, one point a minute, in bytes/s: busier
// in the evening, a large download around 20:30 the day before.
const next = random(7);
const history = [];
for (let m = 24 * 60; m >= 0; m -= 1) {
  const time = NOW_S - m * 60;
  const hour = (new Date(time * 1000).getUTCHours() + 2) % 24;
  const busy = hour >= 18 && hour <= 23 ? 1 : hour >= 8 && hour < 18 ? 0.35 : 0.04;
  const burst = m > 1320 && m < 1350 ? 20 : 0;
  history.push({
    time,
    rate_down: Math.round(((4 + 90 * busy * (0.5 + next()) + burst * 10) * 1e6) / 8),
    rate_up: Math.round(((0.5 + 12 * busy * (0.5 + next())) * 1e6) / 8),
  });
}

const system = {
  firmware_version: '4.9.12',
  uptime_val: 12 * 86400 + 7 * 3600,
  model_info: { pretty_name: 'Freebox Delta' },
  sensors: [
    { id: 'temp_cpu_cp_master', name: 'Température CPU', value: 61 },
    { id: 'temp_hdd0', name: 'Disque dur', value: 43 },
  ],
  fans: [{ id: 'fan0_speed', name: 'Ventilateur 1', value: 1840 }],
};
const connection = {
  state: 'up',
  media: 'ftth',
  ipv4: '82.64.12.34',
  rate_down: Math.round((48.6 * 1e6) / 8),
  rate_up: Math.round((6.2 * 1e6) / 8),
};

const host = (mac, name, ip, medium, band, active = true, minutesAgo = 0) => ({
  l2ident: { id: mac, type: 'mac_address' },
  primary_name: name,
  active,
  last_activity: NOW_S - minutesAgo * 60,
  l3connectivities: [{ addr: ip, af: 'ipv4', active }],
  access_point: {
    connectivity_type: medium,
    ...(medium === 'wifi' ? { wifi_information: { band } } : {}),
  },
  interface: 'pub',
});
const hosts = readHosts([
  host('a4:83:e7:12:34:56', 'Pixel de Camille', '192.168.1.23', 'wifi', '5g'),
  host('00:24:d4:7e:00:4c', 'Freebox Player', '192.168.1.30', 'ethernet'),
  host('00:11:32:aa:bb:cc', 'NAS', '192.168.1.10', 'ethernet'),
  host('f0:18:98:44:55:66', 'MacBook Air', '192.168.1.31', 'wifi', '5g'),
  host('b8:27:eb:77:88:99', 'Gladys', '192.168.1.5', 'ethernet'),
  host('24:0a:c4:10:20:30', 'Chaudière ESP32', '192.168.1.62', 'wifi', '2d4g'),
  host('dc:a6:32:00:00:01', 'Imprimante', '192.168.1.70', 'wifi', '2d4g'),
  host('44:65:0d:ab:cd:ef', 'Echo Dot', '192.168.1.88', 'wifi', '2d4g'),
  host('9c:b6:d0:11:22:33', 'iPhone de Tom', '192.168.1.27', 'wifi', '5g', false, 95),
]);

const call = (id, type, number, name, minutesAgo, duration, isNew = false) => ({
  id,
  type,
  number,
  name,
  duration,
  datetime: NOW_S - minutesAgo * 60,
  new: isNew,
});
const calls = readCalls([
  call(212, 'missed', '0612345678', 'Maman', 18, 0, true),
  call(211, 'accepted', '0698765432', 'Julien', 95, 312),
  call(210, 'outgoing', '0145678901', 'Pharmacie', 260, 74),
  call(209, 'missed', '0970123456', '0970123456', 1430, 0),
  call(208, 'accepted', '0612345678', 'Maman', 1530, 845),
]);

const contents = {};
for (const language of LANGUAGES) {
  contents[language] = {
    box: buildBoxWidget({
      connection,
      system: readSystem(system),
      wifi: { enabled: true },
      devices: hosts.filter((entry) => entry.active).length,
      history: readNetHistory(history),
      language,
    }),
    calls: buildCallsWidget({ calls, error: null, language }),
    network: buildNetworkWidget({ hosts, language }),
  };
}
const widgets = Object.fromEntries(
  manifest.widgets.map((w) => [w.key, { icon: w.icon, label: w.label }]),
);
writeFileSync(out, JSON.stringify({ now: NOW, widgets, contents }));
