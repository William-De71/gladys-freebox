import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  WIDGETS,
  WIDGET_ACTIONS,
  PERIODS,
  buildBoxWidget,
  buildCallsWidget,
  buildNetworkWidget,
  readBoxSettings,
  readCallsSettings,
  readNetworkSettings,
} from '../src/widgets.js';
import { readSystem, readHosts, readCalls, readNetHistory } from '../src/freebox/read.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  SAMPLE_SYSTEM,
  LEGACY_SYSTEM,
  SAMPLE_HOSTS,
  SAMPLE_CALLS,
  lanHost,
  netHistory,
  NOW_S,
} from './helpers/network.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const connection = {
  state: 'up',
  media: 'ftth',
  ipv4: '82.64.12.34',
  rate_down: 2500000,
  rate_up: 125000,
};
const box = (overrides = {}) =>
  buildBoxWidget({
    connection,
    system: readSystem(SAMPLE_SYSTEM),
    wifi: { enabled: true },
    devices: 3,
    history: readNetHistory(netHistory(1440)),
    language: 'en',
    ...overrides,
  });

const types = (content) => content.components.map((component) => component.type);
const buttons = (content) => content.components.filter((component) => component.type === 'button');

test('every widget content fits the vocabulary and the budget, in the four languages', () => {
  const hosts = readHosts(SAMPLE_HOSTS);
  const calls = readCalls(SAMPLE_CALLS);
  for (const language of LANGUAGES) {
    const contents = [
      box({ language }),
      box({ language, system: readSystem(LEGACY_SYSTEM), wifi: { enabled: false } }),
      box({ language, system: null, wifi: null, devices: null, history: null }),
      buildCallsWidget({ calls, error: null, language }),
      buildCallsWidget({ calls, error: null, language, show: 'missed' }),
      buildCallsWidget({ calls: [], error: null, language }),
      buildCallsWidget({ calls: null, error: 'insufficient_rights', language }),
      buildCallsWidget({ calls: null, error: null, language }),
      buildNetworkWidget({ hosts, language }),
      buildNetworkWidget({ hosts, language, show: 'disconnected' }),
      buildNetworkWidget({ hosts, language, show: 'all' }),
      buildNetworkWidget({ hosts: [], language }),
      buildNetworkWidget({ hosts: null, language }),
    ];
    contents.forEach((content, i) =>
      assert.deepEqual(validateWidgetContent(content), [], `${language} content #${i}`),
    );
  }
});

test('box: rates, temperature, traffic chart, status and the two buttons', () => {
  const content = box();
  assert.deepEqual(types(content), [
    'text',
    'value',
    'value',
    'value',
    'chart',
    'status',
    'button',
    'button',
  ]);
  const [, down, up, temperature] = content.components;
  assert.equal(down.value, '20');
  assert.equal(up.value, '1');
  assert.equal(temperature.value, '62');
  assert.match(content.components[0].text, /Freebox v7 \(Delta\) · firmware 4\.9\.12 · up 3 d 5 h/);
  const chart = content.components[4];
  assert.equal(chart.series.length, 2);
  assert.ok(chart.series.every((series) => series.points.length <= 300));
  const status = content.components[5].items.map((item) => [item.label, item.value]);
  assert.deepEqual(status, [
    ['Internet', 'Connected · FTTH'],
    ['Public IPv4', '82.64.12.34'],
    ['Wi-Fi', 'On'],
    ['Connected devices', 3],
    ['Fan', '2,140 rpm'],
  ]);
  assert.deepEqual(
    buttons(content).map((button) => [button.action.key, button.action.confirm, button.style]),
    [
      [WIDGET_ACTIONS.WIFI_OFF, true, 'secondary'],
      [WIDGET_ACTIONS.REBOOT, true, 'danger'],
    ],
  );
});

test('box: the Wi-Fi button follows the state, and is absent when the state is unknown', () => {
  assert.equal(buttons(box({ wifi: { enabled: false } }))[0].action.key, WIDGET_ACTIONS.WIFI_ON);
  assert.deepEqual(
    buttons(box({ wifi: null })).map((button) => button.action.key),
    [WIDGET_ACTIONS.REBOOT],
  );
});

test('box: an unreadable system state or history drops their parts, not the card', () => {
  const content = box({ system: null, history: null, devices: null });
  assert.deepEqual(types(content), ['text', 'value', 'value', 'status', 'button', 'button']);
  assert.match(content.components[0].text, /^Freebox · firmware \? · up \?$/);
});

test('box: a line down is shown in red, in the user language', () => {
  const content = box({ connection: { state: 'down', media: 'xdsl' }, language: 'fr' });
  const internet = content.components.find((c) => c.type === 'status').items[0];
  assert.deepEqual([internet.value, internet.color], ['Déconnectée · XDSL', 'danger']);
  assert.equal(content.components[1].value, '–');
});

test('calls: the log, newest first, with a badge per type and a read button', () => {
  const content = buildCallsWidget({ calls: readCalls(SAMPLE_CALLS), error: null, language: 'fr' });
  assert.equal(content.components[0].text, '1 appel(s) manqué(s) non lu(s)');
  const list = content.components.find((c) => c.type === 'card-list');
  // The list shows the date; a tap opens the number and the duration.
  assert.deepEqual(
    list.items.map((item) => [item.title, item.description, item.badge.text, item.badge.color]),
    [
      ['Alice', 'Numéro : 0612345678', 'Manqué', 'danger'],
      ['0102030405', 'Numéro : 0102030405\nDurée : 2 min 05 s', 'Émis', 'info'],
      ['Bob', 'Numéro : 0698765432\nDurée : 0 min 42 s', 'Reçu', 'success'],
    ],
  );
  assert.equal(list.items[0].date, new Date((NOW_S - 600) * 1000).toISOString());
  assert.ok(list.items.every((item) => item.subtitle === undefined));
  assert.equal(buttons(content)[0].action.key, WIDGET_ACTIONS.MARK_CALLS_READ);
});

test('calls: only the missed ones on demand, and no read button once read', () => {
  const calls = readCalls(SAMPLE_CALLS).map((call) => ({ ...call, isNew: false }));
  const content = buildCallsWidget({ calls, error: null, language: 'en', show: 'missed' });
  assert.equal(content.components.find((c) => c.type === 'card-list').items.length, 1);
  assert.equal(buttons(content).length, 0);
  assert.equal(content.components[0].text, 'No unread missed call');
});

test('calls: a missing permission explains how to grant it', () => {
  const content = buildCallsWidget({ calls: null, error: 'insufficient_rights', language: 'en' });
  assert.match(content.components[0].text, /Call log access/);
});

test('network: connected devices by name, with their connection and MAC address', () => {
  const content = buildNetworkWidget({ hosts: readHosts(SAMPLE_HOSTS), language: 'fr' });
  assert.equal(content.components[0].text, '3 appareil(s) connecté(s) sur 4 connu(s)');
  assert.deepEqual(
    content.components.filter((c) => c.type === 'value').map((c) => [c.label, c.value]),
    [
      ['Connectés', 3],
      ['Wi-Fi', 2],
      ['Ethernet', 1],
    ],
  );
  const list = content.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.subtitle, item.badge.text]),
    [
      ['Freebox Player', '192.168.1.30 · 00:24:D4:7E:00:4C', 'Ethernet'],
      ['iPhone de Camille', '192.168.1.20 · D0:23:DB:36:15:AA', 'Wi-Fi 5 GHz'],
      ['MacBook', '192.168.1.42 · 3C:22:FB:11:22:33', 'Wi-Fi 2,4 GHz'],
    ],
  );
  assert.equal(
    list.items[0].description,
    'Adresse IP : 192.168.1.30\nAdresse MAC : 00:24:D4:7E:00:4C\nFabricant : FREEBOX SA\nConnexion : Ethernet',
  );
  assert.equal(
    buildNetworkWidget({ hosts: readHosts(SAMPLE_HOSTS), language: 'en' }).components.find(
      (c) => c.type === 'card-list',
    ).items[1].description,
    'IP address: 192.168.1.20\nMAC address: D0:23:DB:36:15:AA\nConnection: Wi-Fi 5 GHz',
  );
});

test('network: the devices gone, most recent first, with the time they were last seen', () => {
  const content = buildNetworkWidget({
    hosts: readHosts(SAMPLE_HOSTS),
    language: 'en',
    show: 'disconnected',
  });
  const [item] = content.components.find((c) => c.type === 'card-list').items;
  assert.equal(item.title, 'Tablette');
  assert.equal(item.badge.text, 'Offline');
  assert.ok(item.date);
});

test('network: past 8 devices, a line says how many more', () => {
  const hosts = readHosts(
    Array.from({ length: 11 }, (_, i) =>
      lanHost({
        mac: `00:00:00:00:00:${String(i).padStart(2, '0')}`,
        name: `Host ${i}`,
        ip: `192.168.1.${100 + i}`,
      }),
    ),
  );
  const content = buildNetworkWidget({ hosts, language: 'en' });
  assert.equal(content.components.find((c) => c.type === 'card-list').items.length, 8);
  assert.equal(content.components.at(-1).text, '… and 3 more');
  assert.deepEqual(validateWidgetContent(content), []);
});

test('network: an older firmware without Wi-Fi/Ethernet info shows one tile only', () => {
  const hosts = readHosts([{ l2ident: { id: '00:11:22:33:44:55' }, active: true }]);
  const content = buildNetworkWidget({ hosts, language: 'en' });
  assert.equal(content.components.filter((c) => c.type === 'value').length, 1);
  assert.equal(
    content.components.find((c) => c.type === 'card-list').items[0].badge.text,
    'Connected',
  );
});

test('the widgets of the manifest match the code: keys, settings and their options', () => {
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGETS),
  );
  const options = (key, setting) =>
    manifest.widgets
      .find((widget) => widget.key === key)
      .settings.find((field) => field.key === setting)
      .options.map((option) => option.value);
  assert.deepEqual(options('box', 'period'), Object.keys(PERIODS));
  options('box', 'period').forEach((period) =>
    assert.equal(readBoxSettings({ period }).period, period),
  );
  options('calls', 'show').forEach((show) => assert.equal(readCallsSettings({ show }).show, show));
  options('network', 'show').forEach((show) =>
    assert.equal(readNetworkSettings({ show }).show, show),
  );
  // Unknown or missing settings fall back on the declared defaults.
  assert.equal(readBoxSettings({}).period, 'day');
  assert.equal(readCallsSettings({ show: 'x' }).show, 'all');
  assert.equal(readNetworkSettings(undefined).show, 'connected');
  manifest.widgets.forEach((widget) =>
    widget.settings.forEach((field) => {
      if (field.default !== undefined) {
        assert.ok(
          field.options.some((option) => option.value === field.default),
          `${widget.key}.${field.key}`,
        );
      }
    }),
  );
});

test('widget labels hold 3 to 30 characters in each language', () => {
  manifest.widgets.forEach((widget) =>
    LANGUAGES.forEach((language) => {
      const { length } = widget.label[language];
      assert.ok(length >= 3 && length <= 30, `${widget.key}.${language}: ${length}`);
    }),
  );
});
