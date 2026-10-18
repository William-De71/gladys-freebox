// -----------------------------------------------------------------------------
// Freebox answers -> plain snapshots, with no network access (tested alone).
//
// The API changed shape across firmwares: the system state carries either a
// `sensors` / `fans` list (Freebox OS 4.2 and later, Delta, Pop, Ultra) or
// fixed `temp_cpum` / `temp_cpub` / `temp_sw` / `fan_rpm` keys (older boxes),
// and the LAN hosts gained an `access_point` block telling Wi-Fi from
// Ethernet. Every reader accepts both and returns null, never 0, for a value
// the box did not give.
// -----------------------------------------------------------------------------

// Fixed temperature keys of the older system state, with the label the
// Freebox OS interface gives them.
const LEGACY_SENSORS = [
  ['temp_cpum', 'Température CPU M'],
  ['temp_cpub', 'Température CPU B'],
  ['temp_sw', 'Température Switch'],
  ['temp_hdd', 'Température disque'],
];

const finite = (value) =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null
    : Number(value);

/**
 * A sensor id usable in an external id: lower case, `[a-z0-9_]` only.
 * @param {string} id - The id the box gives.
 * @returns {string} The cleaned id ("" when nothing is left).
 * @example
 * sensorId('temp_cpu_cp_master'); // 'temp_cpu_cp_master'
 */
export function sensorId(id) {
  return String(id ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Read the system state of the box.
 * @param {object} system - The `result` of `/system/`.
 * @returns {{ firmware: string|null, model: string|null, uptimeSeconds: number|null,
 * sensors: Array<{ id: string, name: string, value: number }>,
 * fans: Array<{ id: string, name: string, value: number }> }} The snapshot.
 * @example
 * readSystem({ firmware_version: '4.9.2', sensors: [{ id: 'temp_cpum', name: 'CPU', value: 60 }] });
 */
export function readSystem(system = {}) {
  const source = system && typeof system === 'object' ? system : {};
  const list = (entries) =>
    (Array.isArray(entries) ? entries : [])
      .map((entry) => ({
        id: sensorId(entry && entry.id),
        name: String((entry && (entry.name || entry.id)) || ''),
        value: finite(entry && entry.value),
      }))
      .filter((entry) => entry.id && entry.value !== null);

  let sensors = list(source.sensors);
  if (!Array.isArray(source.sensors)) {
    sensors = LEGACY_SENSORS.filter(([key]) => finite(source[key]) !== null).map(([key, name]) => ({
      id: key,
      name,
      value: finite(source[key]),
    }));
  }
  let fans = list(source.fans);
  if (!Array.isArray(source.fans) && finite(source.fan_rpm) !== null) {
    fans = [{ id: 'fan_rpm', name: 'Ventilateur', value: finite(source.fan_rpm) }];
  }

  const modelInfo =
    source.model_info && typeof source.model_info === 'object' ? source.model_info : {};
  return {
    firmware: source.firmware_version ? String(source.firmware_version) : null,
    model: modelInfo.pretty_name ? String(modelInfo.pretty_name) : null,
    uptimeSeconds: finite(source.uptime_val),
    sensors,
    fans,
  };
}

/**
 * The hottest temperature sensor of the box.
 * @param {Array<{ value: number }>} sensors - readSystem().sensors.
 * @returns {number|null} The temperature in °C.
 * @example
 * hottest([{ value: 52 }, { value: 61 }]); // 61
 */
export function hottest(sensors = []) {
  const values = sensors.map((sensor) => sensor.value).filter((value) => value !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

/**
 * Normalize a MAC address: upper case, colon separated.
 * @param {string} mac - A MAC address, any case, `:` or `-` separated.
 * @returns {string|null} "AA:BB:CC:DD:EE:FF", or null when it is not one.
 * @example
 * normalizeMac('d0-23-db-36-15-aa'); // 'D0:23:DB:36:15:AA'
 */
export function normalizeMac(mac) {
  const hex = String(mac ?? '')
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase();
  if (hex.length !== 12) {
    return null;
  }
  return hex.match(/.{2}/g).join(':');
}

/**
 * The connection of a host: `wifi`, `ethernet` or null when the box does not
 * say (older firmwares have no `access_point` block).
 * @param {object} host - A `LanHost`.
 * @returns {{ medium: string|null, band: string|null }} The connection.
 * @example
 * hostConnection({ access_point: { connectivity_type: 'wifi', wifi_information: { band: '5g' } } });
 */
function hostConnection(host) {
  const accessPoint = host && host.access_point;
  if (!accessPoint || typeof accessPoint !== 'object') {
    return { medium: null, band: null };
  }
  const type = String(accessPoint.connectivity_type || '').toLowerCase();
  const medium = type === 'wifi' ? 'wifi' : type === 'ethernet' ? 'ethernet' : null;
  const band =
    medium === 'wifi' && accessPoint.wifi_information && accessPoint.wifi_information.band
      ? String(accessPoint.wifi_information.band)
      : null;
  return { medium, band };
}

/**
 * Read the LAN hosts of the box, one entry per MAC address.
 * @param {Array<object>} hosts - FreeboxClient.loadLanHosts().
 * @returns {Array<{ mac: string, name: string, ip: string|null, vendor: string|null,
 * active: boolean, medium: string|null, band: string|null, lastSeen: number|null,
 * interface: string }>} The hosts; `lastSeen` in ms since the epoch.
 * @example
 * readHosts(await client.loadLanHosts(appToken));
 */
export function readHosts(hosts = []) {
  const byMac = new Map();
  (Array.isArray(hosts) ? hosts : []).forEach((host) => {
    if (!host || typeof host !== 'object') {
      return;
    }
    const mac = normalizeMac(host.l2ident && host.l2ident.id);
    if (!mac) {
      return;
    }
    const l3 = Array.isArray(host.l3connectivities) ? host.l3connectivities : [];
    const ipv4 =
      l3.find((entry) => entry && entry.af === 'ipv4' && entry.active) ||
      l3.find((entry) => entry && entry.af === 'ipv4');
    const names = Array.isArray(host.names) ? host.names : [];
    const lastActivity = finite(host.last_activity) ?? finite(host.last_time_reachable);
    const entry = {
      mac,
      name: String(host.primary_name || (names[0] && names[0].name) || mac),
      ip: ipv4 && ipv4.addr ? String(ipv4.addr) : null,
      vendor: host.vendor_name ? String(host.vendor_name) : null,
      active: host.active === true,
      ...hostConnection(host),
      lastSeen: lastActivity === null ? null : lastActivity * 1000,
      interface: String(host.interface || 'pub'),
    };
    // A host listed on two interfaces: keep the active entry.
    const known = byMac.get(mac);
    if (!known || (!known.active && entry.active)) {
      byMac.set(mac, entry);
    }
  });
  return [...byMac.values()];
}

// The call types of the Freebox log.
export const CALL_TYPES = ['missed', 'accepted', 'outgoing'];

/**
 * Read the call log, most recent first.
 * @param {Array<object>} calls - FreeboxClient.loadCallLog().
 * @returns {Array<{ id: number, type: string, number: string, name: string,
 * duration: number, at: number, isNew: boolean }>} The calls; `at` in ms.
 * @example
 * readCalls([{ id: 69, type: 'missed', number: '0102030405', datetime: 1359546363 }]);
 */
export function readCalls(calls = []) {
  return (Array.isArray(calls) ? calls : [])
    .filter(
      (call) =>
        call &&
        Number.isInteger(Number(call.id)) &&
        CALL_TYPES.includes(call.type) &&
        finite(call.datetime) !== null,
    )
    .map((call) => {
      const number = String(call.number ?? '');
      return {
        id: Number(call.id),
        type: call.type,
        number,
        // The box falls back on the number itself when it knows no name.
        name: String(call.name || number),
        duration: Math.max(0, finite(call.duration) ?? 0),
        at: finite(call.datetime) * 1000,
        isNew: call.new === true,
      };
    })
    .sort((a, b) => b.at - a.at || b.id - a.id);
}

/**
 * Turn the rate history of the box into chart points in Mbit/s, averaged
 * into at most `maxPoints` buckets (the widget chart takes 300 at most).
 * @param {Array<object>} points - FreeboxClient.loadNetHistory().
 * @param {number} [maxPoints] - Maximum number of points per series.
 * @returns {{ down: Array<{ t: string, v: number }>, up: Array<{ t: string, v: number }> }}
 * The two series.
 * @example
 * readNetHistory([{ time: 1700000000, rate_down: 125000, rate_up: 0 }]);
 */
export function readNetHistory(points = [], maxPoints = 120) {
  const valid = (Array.isArray(points) ? points : [])
    .filter((point) => point && finite(point.time) !== null)
    .sort((a, b) => a.time - b.time);
  const size = Math.max(1, Math.ceil(valid.length / maxPoints));
  const down = [];
  const up = [];
  const mbps = (bytes) => Math.round((bytes * 8) / 10000) / 100;
  for (let i = 0; i < valid.length; i += size) {
    const bucket = valid.slice(i, i + size);
    const average = (key) => {
      const values = bucket.map((point) => finite(point[key])).filter((v) => v !== null);
      return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
    };
    const t = new Date(bucket[bucket.length - 1].time * 1000).toISOString();
    const rateDown = average('rate_down');
    const rateUp = average('rate_up');
    if (rateDown !== null) {
      down.push({ t, v: mbps(rateDown) });
    }
    if (rateUp !== null) {
      up.push({ t, v: mbps(rateUp) });
    }
  }
  return { down, up };
}
