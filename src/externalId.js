// -----------------------------------------------------------------------------
// External id prefixing.
//
// The Gladys core REQUIRES every device/feature external_id published by an
// external integration to start with `ext:<selector>:` (e.g.
// `ext:ext-dev-freebox:`). Internally we keep the native Freebox scheme
// ("freebox:{nodeId}:{epId}", "freebox:player:{id}:{type}"), so we add the
// prefix right before publishing and strip it back when we receive a device
// from Gladys (poll / setValue / getImage).
// -----------------------------------------------------------------------------

/**
 * Build the `ext:<selector>:` prefix of the current integration.
 * @param {object} gladys - The Gladys SDK instance.
 * @returns {string} The prefix, e.g. "ext:ext-dev-freebox:".
 */
function prefix(gladys) {
  return `ext:${gladys.selector}:`;
}

/**
 * Add the core prefix to a native Freebox id.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {string} nativeId - Native id, e.g. "freebox:12:1".
 * @returns {string} Prefixed id, e.g. "ext:ext-dev-freebox:freebox:12:1".
 * @example
 * toExternalId(gladys, 'freebox:12:1');
 */
export function toExternalId(gladys, nativeId) {
  return `${prefix(gladys)}${nativeId}`;
}

/**
 * Strip the core prefix and return the native Freebox id.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {string} externalId - Prefixed id from Gladys.
 * @returns {string} Native id, e.g. "freebox:12:1".
 * @example
 * toNativeId(gladys, 'ext:ext-dev-freebox:freebox:12:1');
 */
export function toNativeId(gladys, externalId) {
  const p = prefix(gladys);
  return externalId.startsWith(p) ? externalId.slice(p.length) : externalId;
}

/**
 * Shorten an external_id for LOGGING only: the `ext:<selector>:` prefix is the
 * same on every line of every log, so printing it in full only pushes the part
 * that identifies the device off the right of the screen. Never use this to
 * build a payload — the core wants the prefixed id.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {string} externalId - Prefixed id from Gladys.
 * @returns {string} Native id, e.g. "freebox:12:1".
 * @example
 * logger.info(`onPoll <- ${forLog(gladys, device.external_id)}`); // "freebox:12"
 */
export function forLog(gladys, externalId) {
  return toNativeId(gladys, externalId);
}

/**
 * Return a copy of a Gladys device whose device/feature external_ids are
 * converted back to the native Freebox scheme, so the rest of the code can
 * parse them as "freebox:...".
 * @param {object} gladys - The Gladys SDK instance.
 * @param {object} device - The Gladys device received from the core.
 * @returns {object} Device with native external_ids.
 * @example
 * const native = toNativeDevice(gladys, device);
 */
export function toNativeDevice(gladys, device) {
  return {
    ...device,
    external_id: toNativeId(gladys, device.external_id),
    features: (device.features || []).map((feature) => ({
      ...feature,
      external_id: toNativeId(gladys, feature.external_id),
    })),
  };
}

/**
 * Return a copy of a discovered device with the core prefix added to its
 * device/feature external_ids, ready to be published.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {object} device - The device built with native external_ids.
 * @returns {object} Device with prefixed external_ids.
 * @example
 * const prefixed = toPublishedDevice(gladys, device);
 */
export function toPublishedDevice(gladys, device) {
  return {
    ...device,
    external_id: toExternalId(gladys, device.external_id),
    features: (device.features || []).map((feature) => ({
      ...feature,
      external_id: toExternalId(gladys, feature.external_id),
    })),
  };
}
