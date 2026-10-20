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
  readHistoryOffset,
  readListPage,
  readCallsSettings,
  readNetworkSettings,
} from '../src/widgets.js';
import { readSystem, readHosts, readCalls, readNetHistory } from '../src/freebox/read.js';
import { LANGUAGES } from '../src/i18n.js';
import { createViewStore } from '../src/widgetViews.js';
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

const manyHosts = (count) =>
  readHosts(
    Array.from({ length: count }, (_, i) =>
      lanHost({
        mac: `00:00:00:00:00:${String(i).padStart(2, '0')}`,
        name: `Host ${String(i).padStart(2, '0')}`,
        ip: `192.168.1.${100 + i}`,
      }),
    ),
  );

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
      box({ language, period: 'week', offset: 3 }),
      box({ language, period: 'hour', offset: 5, history: readNetHistory([]) }),
      buildCallsWidget({ calls, error: null, language }),
      buildCallsWidget({ calls, error: null, language, show: 'missed' }),
      buildCallsWidget({ calls: [], error: null, language }),
      buildCallsWidget({ calls: null, error: 'insufficient_rights', language }),
      buildCallsWidget({ calls: null, error: null, language }),
      buildNetworkWidget({ hosts, language }),
      buildNetworkWidget({ hosts, language, show: 'disconnected' }),
      buildNetworkWidget({ hosts, language, show: 'all' }),
      buildNetworkWidget({ hosts: manyHosts(20), language, page: 2 }),
      buildNetworkWidget({ hosts: [], language }),
      buildNetworkWidget({ hosts: null, language }),
    ];
    contents.forEach((content, i) =>
      assert.deepEqual(validateWidgetContent(content), [], `${language} content #${i}`),
    );
  }
});

test('box: rates, traffic chart, status with the temperature, and three buttons', () => {
  const content = box();
  assert.deepEqual(types(content), [
    'text',
    'value',
    'value',
    'chart',
    'status',
    'button',
    'button',
    'button',
  ]);
  const [, down, up] = content.components;
  assert.equal(down.value, '20');
  assert.equal(up.value, '1');
  assert.match(content.components[0].text, /Freebox v7 \(Delta\) · firmware 4\.9\.12 · up 3 d 5 h/);
  const chart = content.components[3];
  assert.equal(chart.title, 'Internet traffic');
  assert.equal(chart.series.length, 2);
  assert.ok(chart.series.every((series) => series.points.length <= 300));
  const status = content.components[4].items.map((item) => [item.label, item.value]);
  assert.deepEqual(status, [
    ['Internet', 'Connected · FTTH'],
    ['Public IPv4', '82.64.12.34'],
    ['Wi-Fi', 'On'],
    ['Connected devices', 3],
    ['Temperature', '62 °C'],
    ['Fan', '2,140 rpm'],
  ]);
  assert.deepEqual(
    buttons(content).map((button) => [
      button.action.key,
      button.action.params,
      button.action.confirm,
      button.style,
    ]),
    [
      [WIDGET_ACTIONS.HISTORY_EARLIER, { offset: 1 }, undefined, 'secondary'],
      [WIDGET_ACTIONS.WIFI_OFF, undefined, true, 'secondary'],
      [WIDGET_ACTIONS.REBOOT, undefined, true, 'danger'],
    ],
  );
});

test('box: looking back, the chart says how far, Later comes back, the box buttons step aside', () => {
  const content = box({ period: 'day', offset: 2, language: 'fr' });
  assert.equal(
    content.components.find((c) => c.type === 'chart').title,
    'Trafic internet · il y a 2 j',
  );
  assert.deepEqual(
    buttons(content).map((button) => [button.action.key, button.action.params, button.label]),
    [
      [WIDGET_ACTIONS.HISTORY_EARLIER, { offset: 3 }, 'Plus tôt'],
      [WIDGET_ACTIONS.HISTORY_LATER, { offset: 1 }, 'Plus tard'],
    ],
  );
  assert.equal(
    box({ period: 'week', offset: 1 }).components.find((c) => c.type === 'chart').title,
    'Internet traffic · 1 wk ago',
  );
});

test('box: no history that far back says so, and only Later is left', () => {
  const content = box({ period: 'hour', offset: 4, history: readNetHistory([]) });
  assert.equal(
    content.components.some((c) => c.type === 'chart'),
    false,
  );
  assert.equal(
    content.components.find((c) => c.type === 'text' && c.variant === 'body').text,
    'The Freebox keeps no traffic history that far back.',
  );
  assert.deepEqual(
    buttons(content).map((button) => button.action.key),
    [WIDGET_ACTIONS.HISTORY_LATER],
  );
});

test('box: the way back stops at its bound, and without a chart there is none', () => {
  const keys = (content) => buttons(content).map((button) => button.action.key);
  assert.ok(!keys(box({ period: 'hour', offset: 168 })).includes(WIDGET_ACTIONS.HISTORY_EARLIER));
  assert.ok(keys(box({ period: 'hour', offset: 167 })).includes(WIDGET_ACTIONS.HISTORY_EARLIER));
  assert.ok(!keys(box({ history: null })).includes(WIDGET_ACTIONS.HISTORY_EARLIER));
});

test('the view parameters of the buttons are whole numbers, kept within bounds', () => {
  assert.equal(readHistoryOffset({ offset: 3 }, 'day'), 3);
  assert.equal(readHistoryOffset({ offset: 999 }, 'week'), 52);
  assert.equal(readHistoryOffset({ offset: -2 }, 'hour'), 0);
  assert.equal(readHistoryOffset({ offset: '2' }, 'day'), null);
  assert.equal(readHistoryOffset({}, 'day'), null);
  assert.equal(readListPage({ page: 2 }), 2);
  assert.equal(readListPage({ page: 0 }), 1);
  assert.equal(readListPage({ page: 1.5 }), null);
});

test('box: the Wi-Fi button follows the state, and is absent when the state is unknown', () => {
  assert.equal(buttons(box({ wifi: { enabled: false } }))[1].action.key, WIDGET_ACTIONS.WIFI_ON);
  assert.deepEqual(
    buttons(box({ wifi: null })).map((button) => button.action.key),
    [WIDGET_ACTIONS.HISTORY_EARLIER, WIDGET_ACTIONS.REBOOT],
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

test('network: past 8 devices, the list goes page by page', () => {
  const titles = (content) =>
    content.components.find((c) => c.type === 'card-list').items.map((item) => item.title);
  const text = (content) => content.components.find((c) => c.variant === 'body').text;
  const pageButtons = (content) =>
    buttons(content).map((button) => [button.action.key, button.action.params]);
  const hosts = manyHosts(20);

  const first = buildNetworkWidget({ hosts, language: 'en' });
  assert.deepEqual(titles(first), [
    'Host 00',
    'Host 01',
    'Host 02',
    'Host 03',
    'Host 04',
    'Host 05',
    'Host 06',
    'Host 07',
  ]);
  assert.equal(text(first), 'Page 1 of 3 · devices 1 to 8 of 20');
  assert.deepEqual(pageButtons(first), [[WIDGET_ACTIONS.PAGE_NEXT, { page: 2 }]]);

  const middle = buildNetworkWidget({ hosts, language: 'fr', page: 2 });
  assert.equal(titles(middle)[0], 'Host 08');
  assert.equal(text(middle), 'Page 2 sur 3 · appareils 9 à 16 sur 20');
  assert.deepEqual(pageButtons(middle), [
    [WIDGET_ACTIONS.PAGE_PREVIOUS, { page: 1 }],
    [WIDGET_ACTIONS.PAGE_NEXT, { page: 3 }],
  ]);
  assert.deepEqual(validateWidgetContent(middle), []);

  // The list got shorter than the page asked for: its last page.
  const last = buildNetworkWidget({ hosts, language: 'en', page: 9 });
  assert.deepEqual(titles(last), ['Host 16', 'Host 17', 'Host 18', 'Host 19']);
  assert.deepEqual(pageButtons(last), [[WIDGET_ACTIONS.PAGE_PREVIOUS, { page: 2 }]]);

  const short = buildNetworkWidget({ hosts: manyHosts(8), language: 'en', page: 2 });
  assert.equal(titles(short).length, 8);
  assert.equal(buttons(short).length, 0);
  assert.equal(
    short.components.some((c) => c.variant === 'body'),
    false,
  );
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

test('a widget view is kept per settings, and goes back to its default when left alone', () => {
  let now = 0;
  const views = createViewStore({ idleMs: 1000, now: () => now });
  views.set('network', { show: 'all' }, 3);
  assert.equal(views.get('network', { show: 'all' }, 1), 3);
  assert.equal(views.get('network', { show: 'connected' }, 1), 1);
  assert.equal(views.get('box', { show: 'all' }, 0), 0);
  now = 1001;
  assert.equal(views.get('network', { show: 'all' }, 1), 1);
});
