// -----------------------------------------------------------------------------
// Sample answers of the system, LAN, call log and RRD APIs, shaped like the
// examples of https://dev.freebox.fr/sdk/os/ and the fields recent firmwares
// add (`sensors` / `fans`, `access_point`, `model_info`).
// -----------------------------------------------------------------------------

// 2026-10-18 12:00:00 UTC, in seconds.
export const NOW_S = 1792324800;

export const SAMPLE_SYSTEM = {
  firmware_version: '4.9.12',
  uptime_val: 3 * 86400 + 5 * 3600,
  model_info: { pretty_name: 'Freebox v7 (Delta)' },
  sensors: [
    { id: 'temp_cpu_cp_master', name: 'Température CPU', value: 62 },
    { id: 'temp_hdd0', name: 'Disque dur', value: 41 },
  ],
  fans: [{ id: 'fan0_speed', name: 'Ventilateur 1', value: 2140 }],
};

// The same box seen by an older firmware: fixed keys instead of lists.
export const LEGACY_SYSTEM = {
  firmware_version: '3.5.2',
  uptime_val: 598186,
  temp_cpum: 62,
  temp_cpub: 63,
  temp_sw: 52,
  fan_rpm: 1832,
};

/**
 * A `LanHost` as the box lists it.
 * @param {object} options - Options.
 * @returns {object} The host.
 */
export function lanHost({
  mac,
  name,
  ip,
  active = true,
  medium = 'wifi',
  band = '5g',
  lastActivity = NOW_S,
  vendor = null,
}) {
  return {
    id: `ether-${mac}`,
    l2ident: { id: mac, type: 'mac_address' },
    primary_name: name,
    names: [{ name, source: 'dhcp' }],
    vendor_name: vendor,
    active,
    reachable: active,
    last_activity: lastActivity,
    l3connectivities: [{ addr: ip, af: 'ipv4', active, reachable: active }],
    access_point: medium
      ? {
          connectivity_type: medium,
          ...(medium === 'wifi' ? { wifi_information: { band } } : {}),
        }
      : undefined,
    interface: 'pub',
  };
}

export const SAMPLE_HOSTS = [
  lanHost({ mac: 'd0:23:db:36:15:aa', name: 'iPhone de Camille', ip: '192.168.1.20' }),
  lanHost({
    mac: '00:24:d4:7e:00:4c',
    name: 'Freebox Player',
    ip: '192.168.1.30',
    medium: 'ethernet',
    vendor: 'FREEBOX SA',
  }),
  lanHost({
    mac: '3c:22:fb:11:22:33',
    name: 'MacBook',
    ip: '192.168.1.42',
    band: '2d4g',
  }),
  lanHost({
    mac: 'a4:5e:60:aa:bb:cc',
    name: 'Tablette',
    ip: '192.168.1.51',
    active: false,
    lastActivity: NOW_S - 7200,
  }),
];

export const SAMPLE_CALLS = [
  {
    id: 69,
    type: 'missed',
    number: '0612345678',
    name: 'Alice',
    duration: 0,
    datetime: NOW_S - 600,
    new: true,
  },
  {
    id: 68,
    type: 'outgoing',
    number: '0102030405',
    name: '0102030405',
    duration: 125,
    datetime: NOW_S - 3600,
    new: false,
  },
  {
    id: 67,
    type: 'accepted',
    number: '0698765432',
    name: 'Bob',
    duration: 42,
    datetime: NOW_S - 86400,
    new: false,
  },
];

/**
 * A rate history of `count` points, one a minute, ending at NOW_S.
 * @param {number} count - Number of points.
 * @returns {Array<object>} The points.
 */
export function netHistory(count) {
  return Array.from({ length: count }, (_, i) => ({
    time: NOW_S - (count - 1 - i) * 60,
    rate_down: 1250000 + (i % 7) * 250000,
    rate_up: 125000 + (i % 5) * 25000,
  }));
}
