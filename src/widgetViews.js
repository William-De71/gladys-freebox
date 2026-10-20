// -----------------------------------------------------------------------------
// Where the buttons of a widget moved it: how far back the traffic chart of
// the `box` widget looks, which page of the `network` widget is shown.
//
// Gladys tells no widget instance apart: it caches one content per widget,
// settings, language and units, and every dashboard showing that widget with
// the same settings gets it. The view is kept the same way, per widget and
// settings, in memory (a restart goes back to the default view). Left alone
// for a few minutes, a view goes back to its default: a wall tablet does not
// stay on page 3 or on last week.
// -----------------------------------------------------------------------------

const IDLE_MS = 5 * 60 * 1000;

/**
 * A store of widget views.
 * @param {object} [options] - Options.
 * @param {number} [options.idleMs] - How long a view outlives the last tap.
 * @param {() => number} [options.now] - The clock, for the tests.
 * @returns {{ get: Function, set: Function }} The store.
 * @example
 * const views = createViewStore();
 * views.set('network', { show: 'all' }, 2);
 * views.get('network', { show: 'all' }, 1); // 2
 */
export function createViewStore({ idleMs = IDLE_MS, now = Date.now } = {}) {
  const views = new Map();
  const keyOf = (widget, settings) => `${widget}:${JSON.stringify(settings)}`;
  return {
    /**
     * The current view, or the default one.
     * @param {string} widget - The widget key.
     * @param {object} settings - Its normalized settings.
     * @param {unknown} fallback - The default view.
     * @returns {unknown} The view.
     */
    get(widget, settings, fallback) {
      const key = keyOf(widget, settings);
      const view = views.get(key);
      if (!view || now() - view.at > idleMs) {
        views.delete(key);
        return fallback;
      }
      return view.value;
    },
    /**
     * Move a view.
     * @param {string} widget - The widget key.
     * @param {object} settings - Its normalized settings.
     * @param {unknown} value - The view.
     */
    set(widget, settings, value) {
      views.set(keyOf(widget, settings), { value, at: now() });
    },
  };
}
