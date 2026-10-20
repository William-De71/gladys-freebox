// -----------------------------------------------------------------------------
// Dashboard widgets of the Freebox integration.
//
//   - `box`      the box at a glance: download and upload rates, temperature,
//                traffic history kept by the box (RRD), internet link, public
//                IPv4, Wi-Fi, connected devices, fan; buttons to look back
//                in the history, to switch the Wi-Fi and to reboot (both
//                confirmed);
//   - `calls`    the call log (missed, received, outgoing), with a button to
//                mark the calls as read;
//   - `network`  the devices connected to the box (or the ones gone), with
//                their address, MAC address and connection, page by page.
//
// The builders are pure: index.js reads the box (or the watcher snapshot) and
// hands them plain objects, with the view (history offset, list page) the
// buttons of the card moved to. Content budget of a card: 8 components, 1 main
// one (chart or card-list), 6 tiles, 2 texts (1 body), 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { t, formatNumber } from './i18n.js';
import { hottest } from './freebox/read.js';

export const WIDGETS = { BOX: 'box', CALLS: 'calls', NETWORK: 'network' };
export const WIDGET_ACTIONS = {
  WIFI_ON: 'wifi_on',
  WIFI_OFF: 'wifi_off',
  REBOOT: 'reboot',
  MARK_CALLS_READ: 'mark_calls_read',
  HISTORY_EARLIER: 'history_earlier',
  HISTORY_LATER: 'history_later',
  PAGE_PREVIOUS: 'page_previous',
  PAGE_NEXT: 'page_next',
};

// Chart periods of the `box` widget, in seconds.
export const PERIODS = { hour: 3600, day: 86400, week: 604800 };
const DEFAULT_PERIOD = 'day';
// How many periods back the chart may go: a week of hours, a year of days or
// weeks. The box may keep less: an empty window stops the way back sooner.
const MAX_OFFSETS = { hour: 168, day: 365, week: 52 };
const AGO_TEXTS = { hour: 'agoHour', day: 'agoDay', week: 'agoWeek' };
const CALLS_SHOW = ['all', 'missed'];
const NETWORK_SHOW = ['connected', 'disconnected', 'all'];
const MAX_LIST_ITEMS = 8;

const INTERNET_COLORS = {
  up: 'success',
  going_up: 'warning',
  going_down: 'warning',
  down: 'danger',
};
const CALL_COLORS = { missed: 'danger', accepted: 'success', outgoing: 'info' };
// Freebox Wi-Fi band names -> frequency in GHz.
const BANDS = { '2d4g': 2.4, '5g': 5, '6g': 6, '60g': 60 };

/**
 * Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 * @example
 * clip('A very long title', 10); // 'A very lo…'
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * A widget content made of one message.
 * @param {string} message - The message.
 * @param {number} [ttl] - Its freshness, in seconds.
 * @returns {object} The content.
 * @example
 * messageContent('The Freebox is not paired');
 */
export function messageContent(message, ttl = 60) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: clip(message, 300) }],
  };
}

/**
 * Bytes per second -> Mbit/s, one decimal, as the language writes it.
 * @param {number} bytes - A rate in bytes per second.
 * @param {string} language - The language.
 * @returns {string} The rate, "–" when unknown.
 */
function mbps(bytes, language) {
  const value = Number(bytes);
  if (bytes === null || bytes === undefined || !Number.isFinite(value)) {
    return '–';
  }
  return formatNumber(Math.round((value * 8) / 100000) / 10, language, 1);
}

/**
 * "12 d 4 h" out of seconds.
 * @param {number|null} seconds - The uptime.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function formatUptime(seconds, language) {
  if (typeof seconds !== 'number') {
    return '?';
  }
  return t('uptimeValue', language, {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
  });
}

/**
 * The settings of the `box` widget.
 * @param {object} [settings] - The raw settings.
 * @returns {{ period: string }} The settings.
 * @example
 * readBoxSettings({ period: 'week' }); // { period: 'week' }
 */
export const readBoxSettings = (settings = {}) => ({
  period: Object.prototype.hasOwnProperty.call(PERIODS, settings.period)
    ? settings.period
    : DEFAULT_PERIOD,
});

/**
 * A whole number between bounds out of an action parameter.
 * @param {unknown} value - The raw parameter.
 * @param {number} min - The lowest value.
 * @param {number} max - The highest value.
 * @returns {number|null} The number, null when not a whole number.
 */
function wholeNumber(value, min, max) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : null;
}

/**
 * The history offset a button of the `box` widget asks for, in periods back.
 * @param {object} [params] - The action parameters.
 * @param {string} period - hour, day or week.
 * @returns {number|null} The offset, null when the parameter is invalid.
 * @example
 * readHistoryOffset({ offset: 2 }, 'day'); // 2
 */
export const readHistoryOffset = (params = {}, period = DEFAULT_PERIOD) =>
  wholeNumber(params.offset, 0, MAX_OFFSETS[period] ?? 0);

/**
 * The page a button of the `network` widget asks for, from 1.
 * @param {object} [params] - The action parameters.
 * @returns {number|null} The page, null when the parameter is invalid.
 * @example
 * readListPage({ page: 2 }); // 2
 */
export const readListPage = (params = {}) => wholeNumber(params.page, 1, 1000);

/**
 * The `box` widget.
 * @param {object} options - Options.
 * @param {object} options.connection - The `result` of `/connection/`.
 * @param {object|null} options.system - readSystem(), null when unreadable.
 * @param {object|null} options.wifi - The `result` of `/wifi/config/`, or null.
 * @param {number|null} options.devices - Hosts connected now, null when unknown.
 * @param {{ down: Array, up: Array }|null} options.history - readNetHistory(), or null.
 * @param {string} options.language - The user language.
 * @param {string} [options.period] - hour, day or week: the width of the chart.
 * @param {number} [options.offset] - How many periods back the chart ends.
 * @returns {object} The content.
 * @example
 * buildBoxWidget({ connection, system, wifi, devices: 12, history, language: 'fr' });
 */
export function buildBoxWidget({
  connection,
  system,
  wifi,
  devices,
  history,
  language,
  period = DEFAULT_PERIOD,
  offset = 0,
}) {
  const components = [
    {
      type: 'text',
      variant: 'caption',
      text: clip(
        t('boxCaption', language, {
          model: (system && system.model) || 'Freebox',
          firmware: (system && system.firmware) || '?',
          uptime: formatUptime(system && system.uptimeSeconds, language),
        }),
        80,
      ),
    },
    {
      type: 'value',
      value: mbps(connection.rate_down, language),
      unit: 'Mbit/s',
      label: t('tileDownload', language),
      icon: 'download',
      color: 'info',
    },
    {
      type: 'value',
      value: mbps(connection.rate_up, language),
      unit: 'Mbit/s',
      label: t('tileUpload', language),
      icon: 'upload',
      color: 'primary',
    },
  ];
  const charted = Boolean(history && (history.down.length > 1 || history.up.length > 1));
  if (charted) {
    components.push({
      type: 'chart',
      chart_type: 'area',
      title:
        offset > 0
          ? t('chartTrafficAgo', language, {
              ago: t(AGO_TEXTS[period], language, { count: offset }),
            })
          : t('chartTraffic', language),
      unit: 'Mbit/s',
      series: [
        { name: t('seriesDownload', language), points: history.down },
        { name: t('seriesUpload', language), points: history.up },
      ].filter((series) => series.points.length > 0),
    });
  }

  const state = connection.state in INTERNET_COLORS ? connection.state : 'unknown';
  const media = connection.media ? ` · ${String(connection.media).toUpperCase()}` : '';
  const items = [
    {
      label: t('rowInternet', language),
      value: clip(`${t(`internet_${state}`, language)}${media}`, 40),
      icon: 'globe',
      color: INTERNET_COLORS[state] || 'neutral',
    },
  ];
  if (connection.ipv4) {
    items.push({
      label: t('rowIpv4', language),
      value: clip(connection.ipv4, 40),
      icon: 'map-pin',
    });
  }
  const wifiKnown = wifi && typeof wifi.enabled === 'boolean';
  if (wifiKnown) {
    items.push({
      label: t('rowWifi', language),
      value: t(wifi.enabled ? 'wifiOn' : 'wifiOff', language),
      icon: 'wifi',
      color: wifi.enabled ? 'success' : 'warning',
    });
  }
  if (typeof devices === 'number') {
    items.push({ label: t('rowDevices', language), value: devices, icon: 'smartphone' });
  }
  // A row, not a tile: the 8 components of a card go to the rates, the chart
  // and three buttons.
  const temperature = hottest((system && system.sensors) || []);
  if (temperature !== null) {
    items.push({
      label: t('rowTemperature', language),
      value: `${formatNumber(temperature, language, 0)} °C`,
      icon: 'thermometer',
      color: temperature >= 85 ? 'danger' : temperature >= 75 ? 'warning' : 'success',
    });
  }
  const fan = system && system.fans && system.fans[0];
  if (fan) {
    items.push({
      label: t('rowFan', language),
      value: `${formatNumber(fan.value, language, 0)} ${t('rpm', language)}`,
      icon: 'wind',
    });
  }
  components.push({ type: 'status', items });
  if (offset > 0 && !charted) {
    components.push({ type: 'text', variant: 'body', text: t('historyEmpty', language) });
  }

  // Back in time while the box has something to show, forward again until
  // the chart ends now.
  if (charted && offset < (MAX_OFFSETS[period] ?? 0)) {
    components.push({
      type: 'button',
      label: t('buttonEarlier', language),
      icon: 'chevron-left',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.HISTORY_EARLIER, params: { offset: offset + 1 } },
    });
  }
  if (offset > 0) {
    components.push({
      type: 'button',
      label: t('buttonLater', language),
      icon: 'chevron-right',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.HISTORY_LATER, params: { offset: offset - 1 } },
    });
  }

  // Looking back, the two buttons of the box give way to the way forward: a
  // card holds 8 components, and no reboot is one tap away from "Later".
  if (offset > 0) {
    return { ttl_seconds: 30, components };
  }
  if (wifiKnown) {
    components.push(
      wifi.enabled
        ? {
            type: 'button',
            label: t('buttonWifiOff', language),
            icon: 'wifi-off',
            style: 'secondary',
            // Turning the Wi-Fi off from a tablet on that Wi-Fi cuts the
            // dashboard itself: always ask first.
            action: { key: WIDGET_ACTIONS.WIFI_OFF, confirm: true },
          }
        : {
            type: 'button',
            label: t('buttonWifiOn', language),
            icon: 'wifi',
            style: 'primary',
            action: { key: WIDGET_ACTIONS.WIFI_ON },
          },
    );
  }
  components.push({
    type: 'button',
    label: t('buttonReboot', language),
    icon: 'power',
    style: 'danger',
    action: { key: WIDGET_ACTIONS.REBOOT, confirm: true },
  });
  return { ttl_seconds: 30, components };
}

/**
 * "Label: value" lines of a detail panel, the empty values left out (French
 * puts a space before the colon).
 * @param {Array<[string, unknown]>} rows - Label and value pairs.
 * @param {string} language - The language.
 * @returns {string} The lines.
 */
function detailLines(rows, language) {
  const separator = language === 'fr' ? ' : ' : ': ';
  return rows
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}${separator}${value}`)
    .join('\n');
}

/**
 * The settings of the `calls` widget.
 * @param {object} [settings] - The raw settings.
 * @returns {{ show: string }} The settings.
 * @example
 * readCallsSettings({ show: 'missed' }); // { show: 'missed' }
 */
export const readCallsSettings = (settings = {}) => ({
  show: CALLS_SHOW.includes(settings.show) ? settings.show : 'all',
});

/**
 * "3 min 05 s" out of seconds.
 * @param {number} seconds - The duration.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function formatDuration(seconds, language) {
  return t('callDuration', language, {
    minutes: Math.floor(seconds / 60),
    seconds: String(seconds % 60).padStart(2, '0'),
  });
}

/**
 * The `calls` widget.
 * @param {object} options - Options.
 * @param {Array<object>|null} options.calls - readCalls(), null when not read yet.
 * @param {string|null} options.error - The error code of the last reading.
 * @param {string} options.language - The user language.
 * @param {string} [options.show] - all or missed.
 * @returns {object} The content.
 * @example
 * buildCallsWidget({ calls, error: null, language: 'fr', show: 'all' });
 */
export function buildCallsWidget({ calls, error, language, show = 'all' }) {
  if (error === 'insufficient_rights') {
    return messageContent(t('callsNoPermission', language), 300);
  }
  if (!Array.isArray(calls)) {
    return messageContent(t('callsUnavailable', language), 30);
  }
  const unread = calls.filter((call) => call.type === 'missed' && call.isNew).length;
  const components = [
    {
      type: 'text',
      variant: 'caption',
      text: clip(
        unread > 0
          ? t('callsCaptionUnread', language, { count: unread })
          : t('callsCaptionNone', language),
        80,
      ),
    },
  ];
  const listed = calls.filter((call) => show === 'all' || call.type === 'missed');
  if (listed.length === 0) {
    components.push({
      type: 'text',
      variant: 'body',
      text: t(show === 'missed' ? 'callsEmptyMissed' : 'callsEmpty', language),
    });
  } else {
    components.push({
      type: 'card-list',
      display: 'list',
      // The front shows the date in place of the subtitle in the list: the
      // number and the duration go to the detail panel a tap opens.
      items: listed.slice(0, MAX_LIST_ITEMS).map((call) => ({
        title: clip(call.name || call.number || '?', 60),
        date: new Date(call.at).toISOString(),
        badge: { text: clip(t(`call_${call.type}`, language), 16), color: CALL_COLORS[call.type] },
        description: detailLines(
          [
            [t('detailNumber', language), call.number],
            [
              t('detailDuration', language),
              call.type === 'missed' ? null : formatDuration(call.duration, language),
            ],
          ],
          language,
        ),
      })),
    });
  }
  if (calls.some((call) => call.isNew)) {
    components.push({
      type: 'button',
      label: t('buttonMarkRead', language),
      icon: 'check',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.MARK_CALLS_READ },
    });
  }
  return { ttl_seconds: 60, components };
}

/**
 * The settings of the `network` widget.
 * @param {object} [settings] - The raw settings.
 * @returns {{ show: string }} The settings.
 * @example
 * readNetworkSettings({ show: 'all' }); // { show: 'all' }
 */
export const readNetworkSettings = (settings = {}) => ({
  show: NETWORK_SHOW.includes(settings.show) ? settings.show : 'connected',
});

/**
 * The badge of a host: its band, Ethernet, or "offline".
 * @param {object} host - A readHosts() entry.
 * @param {string} language - The language.
 * @returns {{ text: string, color: string }} The badge.
 */
function hostBadge(host, language) {
  if (!host.active) {
    return { text: clip(t('badgeOffline', language), 16), color: 'neutral' };
  }
  if (host.medium === 'ethernet') {
    return { text: clip(t('badgeEthernet', language), 16), color: 'info' };
  }
  if (host.medium === 'wifi') {
    const band = BANDS[host.band];
    const label = band
      ? `${t('badgeWifi', language)} ${formatNumber(band, language, 1)} GHz`
      : t('badgeWifi', language);
    return { text: clip(label, 16), color: 'success' };
  }
  return { text: clip(t('tileConnected', language), 16), color: 'success' };
}

/**
 * The detail panel of a host: address, MAC address, manufacturer, connection.
 * @param {object} host - A readHosts() entry.
 * @param {string} language - The language.
 * @returns {string} One line per known detail.
 */
function hostDetail(host, language) {
  const band = BANDS[host.band];
  const connection =
    host.medium === 'ethernet'
      ? t('badgeEthernet', language)
      : host.medium === 'wifi'
        ? `${t('badgeWifi', language)}${band ? ` ${formatNumber(band, language, 1)} GHz` : ''}`
        : null;
  return detailLines(
    [
      [t('detailIp', language), host.ip],
      [t('detailMac', language), host.mac],
      [t('detailVendor', language), host.vendor],
      [t('detailConnection', language), connection],
    ],
    language,
  );
}

/**
 * The `network` widget: connected hosts by name, gone ones most recent first.
 * @param {object} options - Options.
 * @param {Array<object>|null} options.hosts - readHosts(), null when not read yet.
 * @param {string} options.language - The user language.
 * @param {string} [options.show] - connected, disconnected or all.
 * @param {number} [options.page] - The page of the list, from 1 (brought back
 * to the last one when the list got shorter).
 * @returns {object} The content.
 * @example
 * buildNetworkWidget({ hosts, language: 'fr', show: 'connected', page: 2 });
 */
export function buildNetworkWidget({ hosts, language, show = 'connected', page = 1 }) {
  if (!Array.isArray(hosts)) {
    return messageContent(t('networkUnavailable', language), 30);
  }
  const active = hosts.filter((host) => host.active);
  const components = [
    {
      type: 'text',
      variant: 'caption',
      text: clip(t('networkCaption', language, { active: active.length, total: hosts.length }), 80),
    },
    {
      type: 'value',
      value: active.length,
      label: t('tileConnected', language),
      icon: 'smartphone',
      color: 'primary',
    },
  ];
  // Older firmwares do not tell Wi-Fi from Ethernet: no tiles rather than two zeros.
  if (active.some((host) => host.medium)) {
    components.push(
      {
        type: 'value',
        value: active.filter((host) => host.medium === 'wifi').length,
        label: t('tileWifi', language),
        icon: 'wifi',
        color: 'success',
      },
      {
        type: 'value',
        value: active.filter((host) => host.medium === 'ethernet').length,
        label: t('tileEthernet', language),
        icon: 'server',
        color: 'info',
      },
    );
  }

  const listed = hosts
    .filter((host) => show === 'all' || host.active === (show === 'connected'))
    .sort((a, b) => {
      if (a.active !== b.active) {
        return a.active ? -1 : 1;
      }
      if (!a.active) {
        return (b.lastSeen ?? 0) - (a.lastSeen ?? 0);
      }
      return a.name.localeCompare(b.name, language);
    });
  if (listed.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t('networkEmpty', language) });
    return { ttl_seconds: 60, components };
  }
  const pages = Math.ceil(listed.length / MAX_LIST_ITEMS);
  const current = Math.min(Math.max(1, page), pages);
  const first = (current - 1) * MAX_LIST_ITEMS;
  components.push({
    type: 'card-list',
    display: 'list',
    // A device gone shows when it was last seen (the front puts the date in
    // place of the subtitle); a tap opens every detail, the MAC address the
    // presence trigger filters on included.
    items: listed.slice(first, first + MAX_LIST_ITEMS).map((host) => ({
      title: clip(host.name, 60),
      subtitle: clip([host.ip, host.mac].filter(Boolean).join(' · '), 80),
      ...(!host.active && host.lastSeen ? { date: new Date(host.lastSeen).toISOString() } : {}),
      badge: hostBadge(host, language),
      description: hostDetail(host, language),
    })),
  });
  if (pages > 1) {
    components.push({
      type: 'text',
      variant: 'body',
      text: t('networkPage', language, {
        page: current,
        pages,
        from: first + 1,
        to: Math.min(first + MAX_LIST_ITEMS, listed.length),
        count: listed.length,
      }),
    });
    // The buttons carry the page to show, not a direction: two taps on the
    // same card land on the same page.
    if (current > 1) {
      components.push({
        type: 'button',
        label: t('buttonPrevious', language),
        icon: 'chevron-left',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.PAGE_PREVIOUS, params: { page: current - 1 } },
      });
    }
    if (current < pages) {
      components.push({
        type: 'button',
        label: t('buttonNext', language),
        icon: 'chevron-right',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.PAGE_NEXT, params: { page: current + 1 } },
      });
    }
  }
  return { ttl_seconds: 60, components };
}
