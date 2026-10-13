// -----------------------------------------------------------------------------
// Sample Freebox payloads, shaped like the answers of `/home/tileset/all`
// (grouped by node, see FreeboxClient.loadDevices) and `/player`.
//
// One node per kind of device the integration publishes: they feed the
// structure non-regression test (test/structure.test.js) and its baseline.
// -----------------------------------------------------------------------------

const ui = (access, extra = {}) => ({ access, ...extra });

/** Home-automation nodes, keyed by a readable name. */
export const SAMPLE_NODES = {
  openingSensor: {
    node_id: 12,
    specifications: [
      {
        node_id: 12,
        label: 'Porte entrée',
        type: 'alarm_sensor',
        action: 'dws',
        data: [
          { ep_id: 6, name: 'trigger', label: 'État', ui: ui('r') },
          { ep_id: 7, name: 'cover', label: 'Couvercle', ui: ui('r') },
          { ep_id: 8, name: 'battery_warning', label: 'Niveau de batterie', ui: ui('r') },
          { ep_id: 0, name: 'alarm1', label: '', ui: null },
          { ep_id: 1, name: 'alarm2', label: '', ui: null },
        ],
      },
    ],
  },
  motionSensor: {
    node_id: 16,
    specifications: [
      {
        node_id: 16,
        label: 'Détecteur salon',
        type: 'alarm_sensor',
        action: 'pir',
        data: [
          { ep_id: 6, name: 'trigger', label: 'Détection', ui: ui('r') },
          { ep_id: 7, name: 'cover', label: 'Couvercle', ui: ui('r') },
          { ep_id: 8, name: 'battery_warning', label: 'Niveau de batterie', ui: ui('r') },
        ],
      },
    ],
  },
  sliderShutter: {
    node_id: 21,
    specifications: [
      {
        node_id: 21,
        label: 'Volet bureau',
        type: 'basic_shutter',
        action: 'store_slider',
        data: [
          { ep_id: 1, name: 'stop', label: 'Stop', ui: ui('w', { display: 'button' }) },
          { ep_id: 3, name: 'position', label: "Consigne d'ouverture", ui: ui('rw') },
        ],
      },
    ],
  },
  legacyShutter: {
    node_id: 22,
    specifications: [
      {
        node_id: 22,
        label: 'Volet chambre',
        type: 'basic_shutter',
        action: 'store',
        data: [{ ep_id: 1, name: 'stop', label: 'Stop', ui: ui('w', { display: 'button' }) }],
      },
    ],
  },
  alarmPanel: {
    node_id: 9,
    specifications: [
      {
        node_id: 9,
        label: "Système d'alarme",
        type: 'alarm_control',
        data: [
          { ep_id: 1, name: 'alarm1', label: 'Alarme principale', ui: ui('w') },
          { ep_id: 2, name: 'alarm2', label: 'Alarme secondaire', ui: ui('w') },
          { ep_id: 3, name: 'skip', label: 'Passer le délai', ui: ui('w') },
          { ep_id: 4, name: 'off', label: "Désactiver l'alarme", ui: ui('w') },
          { ep_id: 11, name: 'state', label: "État de l'alarme", ui: ui('r') },
          { ep_id: 20, name: 'battery_warning', label: 'Batterie faible', ui: ui('r') },
        ],
      },
    ],
  },
  keyfob: {
    node_id: 11,
    specifications: [
      {
        node_id: 11,
        label: 'Télécommande',
        type: 'alarm_remote',
        data: [
          { ep_id: 2, name: 'pushed', label: 'Bouton appuyé', ui: ui('r') },
          { ep_id: 5, name: 'battery_warning', label: 'Niveau de batterie', ui: ui('r') },
        ],
      },
    ],
  },
  camera: {
    node_id: 30,
    specifications: [
      {
        node_id: 30,
        label: 'Caméra jardin',
        type: 'camera',
        data: [
          {
            ep_id: 1,
            name: 'cam',
            label: 'Flux vidéo',
            value: 'http://freeboxcam:secret@192.168.1.40/img/stream.m3u8',
            ui: ui('r', { display: 'cam' }),
          },
        ],
      },
    ],
  },
};

/** Freebox Players exposing their local API. */
export const SAMPLE_PLAYERS = {
  player: { id: 1, device_name: 'Player Salon', api_version: '7.0', api_available: true },
};

/**
 * A client answering the samples, as the discovery reads them.
 * @param {object} [overrides] - Methods to replace.
 * @returns {object} The fake FreeboxClient.
 * @example
 * const client = sampleClient();
 */
export function sampleClient(overrides = {}) {
  return {
    loadDevices: async () => Object.values(SAMPLE_NODES),
    loadPlayers: async () => Object.values(SAMPLE_PLAYERS),
    ...overrides,
  };
}
