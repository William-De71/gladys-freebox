// -----------------------------------------------------------------------------
// Snapshots -> scene trigger transitions (pure logic, tested alone).
//
// The first reading is a baseline: a previous snapshot of `null` yields no
// transition, so a restart of the integration never replays the call log nor
// announces every host of the network as "connected".
// -----------------------------------------------------------------------------

/**
 * The hosts whose connection changed between two readings.
 * @param {Array<object>|null} previous - readHosts() of the previous round.
 * @param {Array<object>} next - readHosts() of this round.
 * @returns {Array<{ host: object, event: 'connected'|'disconnected' }>} The
 * transitions, connections first.
 * @example
 * diffPresence(previousHosts, hosts); // [{ host, event: 'connected' }]
 */
export function diffPresence(previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next)) {
    return [];
  }
  const before = new Map(previous.map((host) => [host.mac, host]));
  const changes = [];
  next.forEach((host) => {
    const known = before.get(host.mac);
    const wasActive = Boolean(known && known.active);
    if (host.active !== wasActive) {
      changes.push({ host, event: host.active ? 'connected' : 'disconnected' });
    }
  });
  // A host the box forgot while it was connected has left too.
  const now = new Set(next.map((host) => host.mac));
  previous
    .filter((host) => host.active && !now.has(host.mac))
    .forEach((host) => changes.push({ host: { ...host, active: false }, event: 'disconnected' }));
  return changes.sort((a, b) => (a.event === b.event ? 0 : a.event === 'connected' ? -1 : 1));
}

/**
 * The calls that entered the log since the previous reading, oldest first.
 * A call is new when its id was not listed before and it is not older than
 * the newest call already known (a log the user emptied, then filled again,
 * never brings back old calls).
 * @param {Array<object>|null} previous - readCalls() of the previous round.
 * @param {Array<object>} next - readCalls() of this round.
 * @returns {Array<object>} The new calls.
 * @example
 * newCalls(previousCalls, calls); // [{ id: 70, type: 'missed', ... }]
 */
export function newCalls(previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next)) {
    return [];
  }
  const known = new Set(previous.map((call) => call.id));
  const newest = previous.reduce((max, call) => Math.max(max, call.at), 0);
  return next
    .filter((call) => !known.has(call.id) && call.at >= newest)
    .sort((a, b) => a.at - b.at || a.id - b.id);
}

/**
 * A signature of what the network widget shows: changes when a host connects,
 * leaves, or moves to another address or band.
 * @param {Array<object>|null} hosts - readHosts().
 * @returns {string} The signature.
 * @example
 * hostsSignature(hosts);
 */
export function hostsSignature(hosts) {
  return (hosts || [])
    .filter((host) => host.active)
    .map((host) => `${host.mac}|${host.ip}|${host.medium}|${host.band}|${host.name}`)
    .sort()
    .join(',');
}

/**
 * A signature of what the calls widget shows.
 * @param {Array<object>|null} calls - readCalls().
 * @returns {string} The signature.
 * @example
 * callsSignature(calls);
 */
export function callsSignature(calls) {
  return (calls || []).map((call) => `${call.id}|${call.isNew}`).join(',');
}
