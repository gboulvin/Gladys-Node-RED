// -----------------------------------------------------------------------------
// User-facing texts of the runtime (action results, connection statuses,
// widget labels...).
//
// Gladys picks the user's language from a multi-language object
// (`{ en, fr, de, es }`), with `en` as the fallback: the integration never has
// to know who is looking. Every text exists in the four languages of the
// Gladys UI; `test/i18n.test.js` fails when one is missing.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const MESSAGES = {
  passwordMissing: {
    en: 'Set a password (8 characters minimum) to start Node-RED.',
    fr: 'Définissez un mot de passe (8 caractères minimum) pour démarrer Node-RED.',
    de: 'Lege ein Passwort (mindestens 8 Zeichen) fest, um Node-RED zu starten.',
    es: 'Defina una contraseña (8 caracteres como mínimo) para iniciar Node-RED.',
  },
  usernameInvalid: {
    en: 'The username may only contain letters, digits, dots, dashes and underscores.',
    fr: "Le nom d'utilisateur ne peut contenir que des lettres, chiffres, points, tirets et tirets bas.",
    de: 'Der Benutzername darf nur Buchstaben, Ziffern, Punkte, Binde- und Unterstriche enthalten.',
    es: 'El nombre de usuario solo puede contener letras, cifras, puntos, guiones y guiones bajos.',
  },
  startFailed: {
    en: 'Node-RED could not be started, check the integration logs.',
    fr: "Node-RED n'a pas pu être démarré, consultez les logs de l'intégration.",
    de: 'Node-RED konnte nicht gestartet werden, prüfe die Logs der Integration.',
    es: 'No se pudo iniciar Node-RED, consulte los registros de la integración.',
  },
  unreachable: {
    en: 'Node-RED does not answer yet: it may still be starting.',
    fr: 'Node-RED ne répond pas encore : il est peut-être en cours de démarrage.',
    de: 'Node-RED antwortet noch nicht: Es startet möglicherweise noch.',
    es: 'Node-RED aún no responde: puede que todavía se esté iniciando.',
  },
  authRefused: {
    en: 'Node-RED refused the credentials: restart Node-RED to apply the configuration.',
    fr: 'Node-RED a refusé les identifiants : redémarrez Node-RED pour appliquer la configuration.',
    de: 'Node-RED hat die Zugangsdaten abgelehnt: Starte Node-RED neu, um die Konfiguration anzuwenden.',
    es: 'Node-RED rechazó las credenciales: reinicie Node-RED para aplicar la configuración.',
  },
  restarted: {
    en: 'Node-RED is restarting, the editor is back in a few seconds.',
    fr: "Node-RED redémarre, l'éditeur revient dans quelques secondes.",
    de: 'Node-RED startet neu, der Editor ist in wenigen Sekunden wieder da.',
    es: 'Node-RED se está reiniciando, el editor vuelve en unos segundos.',
  },
  flowsStarted: {
    en: 'Flows started.',
    fr: 'Flux démarrés.',
    de: 'Flows gestartet.',
    es: 'Flujos iniciados.',
  },
  flowsStopped: {
    en: 'Flows stopped.',
    fr: 'Flux arrêtés.',
    de: 'Flows gestoppt.',
    es: 'Flujos detenidos.',
  },
  notAFlow: {
    en: 'This device is not a Node-RED flow.',
    fr: "Cet appareil n'est pas un flux Node-RED.",
    de: 'Dieses Gerät ist kein Node-RED-Flow.',
    es: 'Este dispositivo no es un flujo de Node-RED.',
  },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  started: { en: 'Started', fr: 'Démarrés', de: 'Gestartet', es: 'Iniciados' },
  stopped: { en: 'Stopped', fr: 'Arrêtés', de: 'Gestoppt', es: 'Detenidos' },
  enabled: { en: 'Enabled', fr: 'Activé', de: 'Aktiv', es: 'Activado' },
  disabled: { en: 'Disabled', fr: 'Désactivé', de: 'Deaktiviert', es: 'Desactivado' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  status: { en: 'Node-RED', fr: 'Node-RED', de: 'Node-RED', es: 'Node-RED' },
  version: { en: 'Version', fr: 'Version', de: 'Version', es: 'Versión' },
  flows: { en: 'Flows', fr: 'Flux', de: 'Flows', es: 'Flujos' },
  editorPort: {
    en: 'Editor port',
    fr: "Port de l'éditeur",
    de: 'Editor-Port',
    es: 'Puerto del editor',
  },
  flowsRunning: {
    en: 'Flows running',
    fr: 'Flux en marche',
    de: 'Flows aktiv',
    es: 'Flujos activos',
  },
  startFlows: {
    en: 'Start flows',
    fr: 'Démarrer les flux',
    de: 'Flows starten',
    es: 'Iniciar flujos',
  },
  stopFlows: {
    en: 'Stop flows',
    fr: 'Arrêter les flux',
    de: 'Flows stoppen',
    es: 'Detener flujos',
  },
  restart: { en: 'Restart', fr: 'Redémarrer', de: 'Neu starten', es: 'Reiniciar' },
  noFlow: {
    en: 'No flow yet: open the Node-RED editor to create one.',
    fr: "Aucun flux pour l'instant : ouvrez l'éditeur Node-RED pour en créer un.",
    de: 'Noch kein Flow: Öffne den Node-RED-Editor, um einen zu erstellen.',
    es: 'Todavía no hay flujos: abra el editor de Node-RED para crear uno.',
  },
  instanceName: {
    en: 'Node-RED',
    fr: 'Node-RED',
    de: 'Node-RED',
    es: 'Node-RED',
  },
};

/**
 * Build a multi-language object from a template applied to every language,
 * e.g. `format((lang) => `${MESSAGES.flows[lang]}: 3`)`.
 * @param {(lang: string) => string} render
 */
export function format(render) {
  return Object.fromEntries(LANGUAGES.map((lang) => [lang, render(lang)]));
}

/**
 * The connection-test result shown under the button.
 */
export function connectionOk({ version, total, enabled, hostPort }) {
  const port = hostPort ?? '?';
  return {
    en: `Node-RED ${version} is running: ${total} flow(s), ${enabled} enabled. Editor on port ${port}.`,
    fr: `Node-RED ${version} fonctionne : ${total} flux, dont ${enabled} activé(s). Éditeur sur le port ${port}.`,
    de: `Node-RED ${version} läuft: ${total} Flow(s), davon ${enabled} aktiv. Editor auf Port ${port}.`,
    es: `Node-RED ${version} está en marcha: ${total} flujo(s), ${enabled} activado(s). Editor en el puerto ${port}.`,
  };
}
