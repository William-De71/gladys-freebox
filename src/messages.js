// -----------------------------------------------------------------------------
// Every message this integration shows to the user, in the four languages of
// Gladys (en, fr, de, es).
//
// Gathered here rather than inline in `index.js`: a message added in English
// only would show up in English in a German interface, and keeping them side by
// side is what makes a missing translation visible in review. The messages test
// checks that every entry carries the four languages.
//
// The connection status and the action results take a `{ en, fr, de, es }`
// object; Gladys picks the user's language and falls back to English.
// -----------------------------------------------------------------------------

/**
 * Messages without parameters, and builders for the ones that carry values.
 * Values (device counts, error messages from the box) are never translated.
 */
export const MESSAGES = {
  notPaired: {
    en: 'Freebox not paired. Click "Pair with the Freebox".',
    fr: 'Freebox non appairée. Cliquez sur « Appairer avec la Freebox ».',
    de: 'Freebox nicht gekoppelt. Klicken Sie auf „Mit der Freebox koppeln“.',
    es: 'Freebox no vinculada. Haga clic en «Vincular con la Freebox».',
  },
  notPairedYet: {
    en: 'Freebox not paired. Click "Pair with the Freebox" first.',
    fr: "Freebox non appairée. Cliquez d'abord sur « Appairer avec la Freebox ».",
    de: 'Freebox nicht gekoppelt. Klicken Sie zuerst auf „Mit der Freebox koppeln“.',
    es: 'Freebox no vinculada. Haga clic primero en «Vincular con la Freebox».',
  },
  alreadyPaired: {
    en: 'The Freebox is already paired. Use "Unpair" first to pair again.',
    fr: 'La Freebox est déjà appairée. Utilisez « Désappairer » pour réappairer.',
    de: 'Die Freebox ist bereits gekoppelt. Verwenden Sie zuerst „Kopplung aufheben“, um sie erneut zu koppeln.',
    es: 'La Freebox ya está vinculada. Use primero «Desvincular» para volver a vincularla.',
  },
  paired: {
    en: 'Freebox paired successfully! You can now create your devices.',
    fr: 'Freebox appairée avec succès ! Vous pouvez maintenant créer vos appareils.',
    de: 'Freebox erfolgreich gekoppelt! Sie können jetzt Ihre Geräte anlegen.',
    es: '¡Freebox vinculada correctamente! Ya puede crear sus dispositivos.',
  },
  pairedNoDevices: {
    en: 'Freebox paired successfully, but its devices could not be listed yet. Grant the permissions in Freebox OS, then run a scan from the Discover tab.',
    fr: "Freebox appairée avec succès, mais ses appareils n'ont pas encore pu être listés. Accordez les permissions dans Freebox OS, puis lancez un scan depuis l'onglet Découverte.",
    de: 'Freebox erfolgreich gekoppelt, aber ihre Geräte konnten noch nicht aufgelistet werden. Erteilen Sie die Berechtigungen in Freebox OS und starten Sie dann eine Suche im Tab „Entdecken“.',
    es: 'Freebox vinculada correctamente, pero aún no se han podido listar sus dispositivos. Conceda los permisos en Freebox OS y luego lance una búsqueda desde la pestaña Descubrir.',
  },
  unpaired: {
    en: 'Freebox unpaired. The stored token has been removed.',
    fr: 'Freebox désappairée. Le token stocké a été supprimé.',
    de: 'Kopplung mit der Freebox aufgehoben. Das gespeicherte Token wurde gelöscht.',
    es: 'Freebox desvinculada. Se ha eliminado el token almacenado.',
  },
  rebootRequested: {
    en: 'Reboot requested. Your Freebox will restart in a few seconds.',
    fr: 'Redémarrage demandé. Votre Freebox va redémarrer dans quelques secondes.',
    de: 'Neustart angefordert. Ihre Freebox startet in wenigen Sekunden neu.',
    es: 'Reinicio solicitado. Su Freebox se reiniciará en unos segundos.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, prüfen Sie die Protokolle der Integration.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },

  /**
   * @param {string} reason - Error message from the box or the network.
   * @returns {object} Localized message.
   */
  pairingFailed: (reason) => ({
    en: `Pairing failed: ${reason}`,
    fr: `Échec de l'appairage : ${reason}`,
    de: `Kopplung fehlgeschlagen: ${reason}`,
    es: `La vinculación ha fallado: ${reason}`,
  }),

  /**
   * @param {number} count - Devices found on the Freebox.
   * @returns {object} Localized message.
   */
  connectionOk: (count) => ({
    en: `Connection OK: ${count} device(s) available on the Freebox.`,
    fr: `Connexion OK : ${count} appareil(s) disponible(s) sur la Freebox.`,
    de: `Verbindung OK: ${count} Gerät(e) auf der Freebox verfügbar.`,
    es: `Conexión correcta: ${count} dispositivo(s) disponible(s) en la Freebox.`,
  }),

  /**
   * @param {string} reason - Error message from the box or the network.
   * @returns {object} Localized message.
   */
  connectionFailed: (reason) => ({
    en: `Connection failed: ${reason}`,
    fr: `Échec de la connexion : ${reason}`,
    de: `Verbindung fehlgeschlagen: ${reason}`,
    es: `La conexión ha fallado: ${reason}`,
  }),

  /**
   * @param {string} reason - Error message from the box or the network.
   * @returns {object} Localized message.
   */
  rebootFailed: (reason) => ({
    en: `Reboot failed: ${reason}`,
    fr: `Échec du redémarrage : ${reason}`,
    de: `Neustart fehlgeschlagen: ${reason}`,
    es: `El reinicio ha fallado: ${reason}`,
  }),
};
