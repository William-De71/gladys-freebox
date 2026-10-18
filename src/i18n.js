// -----------------------------------------------------------------------------
// Runtime texts of the widgets and of their buttons, in the four languages of
// Gladys (en, fr, de, es), with the vocabulary of the Gladys and Freebox OS
// interfaces. The messages of the manifest actions live in src/messages.js.
//
// `t(key, language, params)` falls back on English for a language Gladys may
// add later; `{name}` placeholders are replaced by `params.name`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const TEXTS = {
  // --- box widget ------------------------------------------------------------
  boxCaption: {
    en: '{model} · firmware {firmware} · up {uptime}',
    fr: '{model} · firmware {firmware} · allumée depuis {uptime}',
    de: '{model} · Firmware {firmware} · läuft seit {uptime}',
    es: '{model} · firmware {firmware} · en marcha {uptime}',
  },
  uptimeValue: {
    en: '{days} d {hours} h',
    fr: '{days} j {hours} h',
    de: '{days} T. {hours} Std.',
    es: '{days} d {hours} h',
  },
  tileDownload: {
    en: 'Download',
    fr: 'Descendant',
    de: 'Download',
    es: 'Descarga',
  },
  tileUpload: {
    en: 'Upload',
    fr: 'Montant',
    de: 'Upload',
    es: 'Subida',
  },
  tileTemperature: {
    en: 'Temperature',
    fr: 'Température',
    de: 'Temperatur',
    es: 'Temperatura',
  },
  chartTraffic: {
    en: 'Internet traffic',
    fr: 'Trafic internet',
    de: 'Internetverkehr',
    es: 'Tráfico de internet',
  },
  seriesDownload: {
    en: 'Download',
    fr: 'Descendant',
    de: 'Download',
    es: 'Descarga',
  },
  seriesUpload: {
    en: 'Upload',
    fr: 'Montant',
    de: 'Upload',
    es: 'Subida',
  },
  rowInternet: {
    en: 'Internet',
    fr: 'Internet',
    de: 'Internet',
    es: 'Internet',
  },
  rowIpv4: {
    en: 'Public IPv4',
    fr: 'IPv4 publique',
    de: 'Öffentliche IPv4',
    es: 'IPv4 pública',
  },
  rowWifi: {
    en: 'Wi-Fi',
    fr: 'Wi-Fi',
    de: 'WLAN',
    es: 'Wi-Fi',
  },
  rowDevices: {
    en: 'Connected devices',
    fr: 'Appareils connectés',
    de: 'Verbundene Geräte',
    es: 'Dispositivos conectados',
  },
  rowFan: {
    en: 'Fan',
    fr: 'Ventilateur',
    de: 'Lüfter',
    es: 'Ventilador',
  },
  rpm: {
    en: 'rpm',
    fr: 'tr/min',
    de: 'U/min',
    es: 'rpm',
  },
  internet_up: {
    en: 'Connected',
    fr: 'Connectée',
    de: 'Verbunden',
    es: 'Conectada',
  },
  internet_going_up: {
    en: 'Connecting',
    fr: 'Connexion en cours',
    de: 'Verbindungsaufbau',
    es: 'Conectando',
  },
  internet_going_down: {
    en: 'Disconnecting',
    fr: 'Déconnexion en cours',
    de: 'Verbindungsabbau',
    es: 'Desconectando',
  },
  internet_down: {
    en: 'Disconnected',
    fr: 'Déconnectée',
    de: 'Getrennt',
    es: 'Desconectada',
  },
  internet_unknown: {
    en: 'Unknown',
    fr: 'Inconnu',
    de: 'Unbekannt',
    es: 'Desconocido',
  },
  wifiOn: {
    en: 'On',
    fr: 'Activé',
    de: 'Ein',
    es: 'Activado',
  },
  wifiOff: {
    en: 'Off',
    fr: 'Désactivé',
    de: 'Aus',
    es: 'Desactivado',
  },
  buttonWifiOff: {
    en: 'Turn Wi-Fi off',
    fr: 'Couper le Wi-Fi',
    de: 'WLAN ausschalten',
    es: 'Apagar el Wi-Fi',
  },
  buttonWifiOn: {
    en: 'Turn Wi-Fi on',
    fr: 'Activer le Wi-Fi',
    de: 'WLAN einschalten',
    es: 'Encender el Wi-Fi',
  },
  buttonReboot: {
    en: 'Reboot',
    fr: 'Redémarrer',
    de: 'Neu starten',
    es: 'Reiniciar',
  },
  boxUnreachable: {
    en: 'The Freebox could not be read: {reason}',
    fr: "La Freebox n'a pas pu être lue : {reason}",
    de: 'Die Freebox konnte nicht gelesen werden: {reason}',
    es: 'No se ha podido leer la Freebox: {reason}',
  },
  notPaired: {
    en: 'Freebox not paired: open the integration and click "Pair with the Freebox".',
    fr: "Freebox non appairée : ouvrez l'intégration et cliquez sur « Appairer avec la Freebox ».",
    de: 'Freebox nicht gekoppelt: Öffnen Sie die Integration und klicken Sie auf „Mit der Freebox koppeln“.',
    es: 'Freebox no vinculada: abra la integración y haga clic en «Vincular con la Freebox».',
  },

  // --- calls widget ----------------------------------------------------------
  callsCaptionUnread: {
    en: '{count} unread missed call(s)',
    fr: '{count} appel(s) manqué(s) non lu(s)',
    de: '{count} ungelesene(r) verpasste(r) Anruf(e)',
    es: '{count} llamada(s) perdida(s) sin leer',
  },
  callsCaptionNone: {
    en: 'No unread missed call',
    fr: 'Aucun appel manqué non lu',
    de: 'Kein ungelesener verpasster Anruf',
    es: 'Ninguna llamada perdida sin leer',
  },
  callsEmpty: {
    en: 'No call in the Freebox log.',
    fr: 'Aucun appel dans le journal de la Freebox.',
    de: 'Keine Anrufe im Protokoll der Freebox.',
    es: 'Ninguna llamada en el registro de la Freebox.',
  },
  callsEmptyMissed: {
    en: 'No missed call in the Freebox log.',
    fr: 'Aucun appel manqué dans le journal de la Freebox.',
    de: 'Keine verpassten Anrufe im Protokoll der Freebox.',
    es: 'Ninguna llamada perdida en el registro de la Freebox.',
  },
  callsNoPermission: {
    en: 'The call log needs the "Call log access" permission: in Freebox OS > Settings > Access management > Applications, edit Gladys Assistant and tick it.',
    fr: "Le journal d'appels nécessite la permission « Accès au journal d'appels » : dans Freebox OS > Paramètres > Gestion des accès > Applications, modifiez Gladys Assistant et cochez-la.",
    de: 'Das Anrufprotokoll benötigt die Berechtigung „Zugriff auf das Anrufprotokoll“: In Freebox OS > Settings > Access management > Applications Gladys Assistant bearbeiten und sie aktivieren.',
    es: 'El registro de llamadas necesita el permiso «Acceso al registro de llamadas»: en Freebox OS > Settings > Access management > Applications, edite Gladys Assistant y márquelo.',
  },

  callsUnavailable: {
    en: 'The call log could not be read yet.',
    fr: "Le journal d'appels n'a pas encore pu être lu.",
    de: 'Das Anrufprotokoll konnte noch nicht gelesen werden.',
    es: 'Todavía no se ha podido leer el registro de llamadas.',
  },
  call_missed: {
    en: 'Missed',
    fr: 'Manqué',
    de: 'Verpasst',
    es: 'Perdida',
  },
  call_accepted: {
    en: 'Received',
    fr: 'Reçu',
    de: 'Angenommen',
    es: 'Recibida',
  },
  call_outgoing: {
    en: 'Outgoing',
    fr: 'Émis',
    de: 'Ausgehend',
    es: 'Saliente',
  },
  callDuration: {
    en: '{minutes} min {seconds} s',
    fr: '{minutes} min {seconds} s',
    de: '{minutes} Min. {seconds} s',
    es: '{minutes} min {seconds} s',
  },
  detailNumber: {
    en: 'Number',
    fr: 'Numéro',
    de: 'Nummer',
    es: 'Número',
  },
  detailDuration: {
    en: 'Duration',
    fr: 'Durée',
    de: 'Dauer',
    es: 'Duración',
  },
  detailIp: {
    en: 'IP address',
    fr: 'Adresse IP',
    de: 'IP-Adresse',
    es: 'Dirección IP',
  },
  detailMac: {
    en: 'MAC address',
    fr: 'Adresse MAC',
    de: 'MAC-Adresse',
    es: 'Dirección MAC',
  },
  detailVendor: {
    en: 'Manufacturer',
    fr: 'Fabricant',
    de: 'Hersteller',
    es: 'Fabricante',
  },
  detailConnection: {
    en: 'Connection',
    fr: 'Connexion',
    de: 'Verbindung',
    es: 'Conexión',
  },
  buttonMarkRead: {
    en: 'Mark as read',
    fr: 'Marquer comme lus',
    de: 'Als gelesen markieren',
    es: 'Marcar como leídas',
  },
  callsMarkedRead: {
    en: 'Every call is marked as read.',
    fr: 'Tous les appels sont marqués comme lus.',
    de: 'Alle Anrufe sind als gelesen markiert.',
    es: 'Todas las llamadas están marcadas como leídas.',
  },

  // --- network widget --------------------------------------------------------
  tileConnected: {
    en: 'Connected',
    fr: 'Connectés',
    de: 'Verbunden',
    es: 'Conectados',
  },
  tileWifi: {
    en: 'Wi-Fi',
    fr: 'Wi-Fi',
    de: 'WLAN',
    es: 'Wi-Fi',
  },
  tileEthernet: {
    en: 'Ethernet',
    fr: 'Ethernet',
    de: 'Ethernet',
    es: 'Ethernet',
  },
  networkCaption: {
    en: '{active} of {total} known devices connected',
    fr: '{active} appareil(s) connecté(s) sur {total} connu(s)',
    de: '{active} von {total} bekannten Geräten verbunden',
    es: '{active} de {total} dispositivos conocidos conectados',
  },
  networkMore: {
    en: '… and {count} more',
    fr: '… et {count} de plus',
    de: '… und {count} weitere',
    es: '… y {count} más',
  },
  networkEmpty: {
    en: 'No device to show.',
    fr: 'Aucun appareil à afficher.',
    de: 'Kein Gerät anzuzeigen.',
    es: 'Ningún dispositivo que mostrar.',
  },
  networkUnavailable: {
    en: 'The devices of the network could not be read yet.',
    fr: "Les appareils du réseau n'ont pas encore pu être lus.",
    de: 'Die Geräte des Netzwerks konnten noch nicht gelesen werden.',
    es: 'Todavía no se han podido leer los dispositivos de la red.',
  },
  badgeEthernet: {
    en: 'Ethernet',
    fr: 'Ethernet',
    de: 'Ethernet',
    es: 'Ethernet',
  },
  badgeWifi: {
    en: 'Wi-Fi',
    fr: 'Wi-Fi',
    de: 'WLAN',
    es: 'Wi-Fi',
  },
  badgeOffline: {
    en: 'Offline',
    fr: 'Déconnecté',
    de: 'Offline',
    es: 'Desconectado',
  },
  lastSeen: {
    en: 'last seen',
    fr: 'vu',
    de: 'zuletzt gesehen',
    es: 'visto',
  },

  // --- toasts of the widget buttons ------------------------------------------
  wifiSwitchedOn: {
    en: 'Wi-Fi turned on.',
    fr: 'Wi-Fi activé.',
    de: 'WLAN eingeschaltet.',
    es: 'Wi-Fi encendido.',
  },
  wifiSwitchedOff: {
    en: 'Wi-Fi turned off.',
    fr: 'Wi-Fi coupé.',
    de: 'WLAN ausgeschaltet.',
    es: 'Wi-Fi apagado.',
  },
  settingsPermission: {
    en: 'Refused by the Freebox: tick the "Freebox settings modification" permission of Gladys Assistant in Freebox OS.',
    fr: 'Refusé par la Freebox : cochez la permission « Modification des réglages de la Freebox » de Gladys Assistant dans Freebox OS.',
    de: 'Von der Freebox abgelehnt: Aktivieren Sie in Freebox OS die Berechtigung „Änderung der Freebox-Einstellungen“ von Gladys Assistant.',
    es: 'Rechazado por la Freebox: marque el permiso «Modificación de los ajustes de la Freebox» de Gladys Assistant en Freebox OS.',
  },

  actionFailed: {
    en: 'Failed: {reason}',
    fr: 'Échec : {reason}',
    de: 'Fehlgeschlagen: {reason}',
    es: 'Error: {reason}',
  },
};

/**
 * The text of `key` in `language`, English when the language is unknown.
 * @param {string} key - A key of TEXTS.
 * @param {string} [language] - en, fr, de or es.
 * @param {object} [params] - Values of the `{name}` placeholders.
 * @returns {string} The text.
 * @example
 * t('networkMore', 'fr', { count: 3 }); // '… et 3 de plus'
 */
export function t(key, language, params = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[language] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    params[name] === undefined || params[name] === null ? match : String(params[name]),
  );
}

/**
 * The text of `key` in the four languages: a toast or a status message.
 * @param {string} key - A key of TEXTS.
 * @param {object} [params] - Values of the `{name}` placeholders.
 * @returns {{ en: string, fr: string, de: string, es: string }} The texts.
 * @example
 * all('wifiSwitchedOff');
 */
export function all(key, params = {}) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, t(key, language, params)]));
}

/**
 * Format a number the way the language writes it.
 * @param {number} value - The number.
 * @param {string} language - The language.
 * @param {number} [digits] - Maximum fraction digits.
 * @returns {string} The formatted number.
 * @example
 * formatNumber(12.5, 'fr', 1); // '12,5'
 */
export function formatNumber(value, language, digits = 0) {
  return new Intl.NumberFormat(LANGUAGES.includes(language) ? language : 'en', {
    maximumFractionDigits: digits,
  }).format(value);
}
