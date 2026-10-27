// -----------------------------------------------------------------------------
// Scene trigger payloads, the Wake-on-LAN and reboot scene actions.
//
// Event data is flat (at most 30 keys, scalar values, strings of at most
// 1,000 characters). A field of a trigger filters on the data key of the same
// name (`call_type`, `number`, `event`, `mac`, `name`); the other keys are the
// variables the scenes read. The values stay raw (`missed`, `connected`): the
// core receives no language with an event, and a scene compares them as they
// are.
// -----------------------------------------------------------------------------

import { normalizeMac } from './freebox/read.js';

export const TRIGGERS = {
  PHONE_CALL: 'phone_call',
  NETWORK_DEVICE_PRESENCE: 'network_device_presence',
  HOME_REACHABILITY: 'home_reachability',
};

export const SCENE_ACTIONS = {
  WAKE_ON_LAN: 'wake_on_lan',
  REBOOT: 'reboot',
};

// A reboot cuts internet, TV and phone for a few minutes: a scene rebooting
// the box on every alarm must not do it again before this many minutes.
export const REBOOT_MIN_INTERVAL = { DEFAULT: 60, MIN: 15, MAX: 1440 };

const MAX_STRING = 1000;
const text = (value) => String(value ?? '').slice(0, MAX_STRING);

/**
 * The event of a call that entered the log.
 * @param {object} call - A readCalls() entry.
 * @returns {{ key: string, data: object }} The event.
 * @example
 * callEvent({ id: 70, type: 'missed', number: '0612345678', name: 'Alice', duration: 0 });
 */
export function callEvent(call) {
  return {
    key: TRIGGERS.PHONE_CALL,
    data: {
      call_type: call.type,
      number: text(call.number),
      name: text(call.name),
      duration: call.duration,
    },
  };
}

/**
 * The event of a host that connected to or left the network.
 * @param {{ host: object, event: string }} change - A diffPresence() entry.
 * @returns {{ key: string, data: object }} The event.
 * @example
 * presenceEvent({ host, event: 'connected' });
 */
export function presenceEvent({ host, event }) {
  return {
    key: TRIGGERS.NETWORK_DEVICE_PRESENCE,
    data: {
      event,
      mac: host.mac,
      name: text(host.name),
      ip: text(host.ip),
      connection: text(host.medium),
      vendor: text(host.vendor),
    },
  };
}

/**
 * Check the fields of the Wake-on-LAN scene action.
 * @param {object} fields - The resolved fields (`mac`).
 * @returns {string} The normalized MAC address.
 * @throws {Error} When the MAC address is not one.
 * @example
 * wakeOnLanMac({ mac: 'd0-23-db-36-15-aa' }); // 'D0:23:DB:36:15:AA'
 */
export function wakeOnLanMac(fields = {}) {
  const mac = normalizeMac(fields.mac);
  if (!mac) {
    throw new Error(`Wake-on-LAN: "${fields.mac ?? ''}" is not a MAC address`);
  }
  return mac;
}

/**
 * The event of the home automation lost or back (see homeHealth.js).
 * @param {{ event: string, cause: string, names: string[], minutes?: number }} change -
 * A homeHealth.update() event.
 * @returns {{ key: string, data: object }} The event.
 * @example
 * homeEvent({ event: 'unreachable', cause: 'devices_unreachable', names: ['Volet salon'] });
 */
export function homeEvent({ event, cause, names, minutes }) {
  return {
    key: TRIGGERS.HOME_REACHABILITY,
    data: {
      event,
      cause,
      count: names.length,
      names: text(names.join(', ')),
      minutes: minutes ?? 0,
    },
  };
}

/**
 * Whether the reboot scene action may reboot the box now.
 * @param {object} fields - The resolved fields (`min_interval_minutes`).
 * @param {number|null} lastRebootAt - When the action last rebooted the box, in ms.
 * @param {number} now - Now, in ms.
 * @returns {{ allowed: boolean, minutesAgo: number|null, interval: number }} The verdict.
 * @example
 * rebootAllowed({ min_interval_minutes: 60 }, Date.now() - 600000, Date.now());
 * // { allowed: false, minutesAgo: 10, interval: 60 }
 */
export function rebootAllowed(fields = {}, lastRebootAt, now) {
  const raw = fields.min_interval_minutes;
  const wanted = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
  const interval = Number.isFinite(wanted)
    ? Math.min(Math.max(Math.round(wanted), REBOOT_MIN_INTERVAL.MIN), REBOOT_MIN_INTERVAL.MAX)
    : REBOOT_MIN_INTERVAL.DEFAULT;
  if (!Number.isFinite(lastRebootAt)) {
    return { allowed: true, minutesAgo: null, interval };
  }
  const minutesAgo = Math.floor((now - lastRebootAt) / 60000);
  return { allowed: minutesAgo >= interval, minutesAgo, interval };
}
