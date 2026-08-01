# Les commandes média (TELEVISION / MUSIC) ne sont pas cliquables sur le dashboard

## Résumé

Le catalogue de features annonce `television/play`, `television/pause`,
`television/stop`, `television/next`… comme des **boutons-poussoirs** (aperçu
« Appuyer »), mais sur le dashboard ces mêmes features s'affichent en
**capteur** avec le badge « Pas de valeur récente ». L'utilisateur voit la
fonction, mais ne peut pas s'en servir.

Deux logiques de rendu coexistent et se sont désynchronisées : le catalogue a
été complété (PR #2604 / #2634), le dashboard non.

| Feature                                                                      | Catalogue (`getCatalogPreviewMode`) | Dashboard (`DeviceRow`) |
| ---------------------------------------------------------------------------- | ----------------------------------- | ----------------------- |
| `television/volume`, `television/channel`                                    | contrôle continu                    | contrôle continu ✅     |
| `television/play`, `pause`, `stop`, `previous`, `next`, `rewind`, `forward`… | bouton « Appuyer »                  | **capteur** ❌          |
| `music/play`, `pause`, `previous`, `next`, `play_notification`               | bouton « Appuyer »                  | **capteur** ❌          |
| `button/push`                                                                | bouton « Appuyer »                  | bouton ✅               |

Reproduit avec l'intégration Freebox (le Player publie ses commandes média en
`television/*`), mais le problème est générique : il touche toute intégration
exposant une commande média — Android TV, Sonos, Spotify, MQTT…

## Cause

Le catalogue MQTT sait déjà classer ces features. Dans
`front/src/routes/integration/all/mqtt/device-page/utils.js` :

```js
const TELEVISION_CONTINUOUS_CONTROL_TYPES = new Set([
  DEVICE_FEATURE_TYPES.TELEVISION.BINARY,
  DEVICE_FEATURE_TYPES.TELEVISION.VOLUME,
  DEVICE_FEATURE_TYPES.TELEVISION.CHANNEL,
]);

const MUSIC_CONTINUOUS_CONTROL_TYPES = new Set([
  DEVICE_FEATURE_TYPES.MUSIC.VOLUME,
  DEVICE_FEATURE_TYPES.MUSIC.PLAYBACK_STATE,
]);

export const isCatalogPushButtonFeature = (category, type) => {
  if (category === DEVICE_FEATURE_CATEGORIES.BUTTON && type === DEVICE_FEATURE_TYPES.BUTTON.PUSH) {
    return true;
  }
  if (category === DEVICE_FEATURE_CATEGORIES.TELEVISION) {
    return !TELEVISION_CONTINUOUS_CONTROL_TYPES.has(type);
  }
  if (category === DEVICE_FEATURE_CATEGORIES.MUSIC) {
    return !MUSIC_CONTINUOUS_CONTROL_TYPES.has(type);
  }
  return false;
};
```

Cette règle est déjà la source de vérité du catalogue sur trois aspects — le
mode d'aperçu, les valeurs par défaut de la feature et sa valeur d'exemple :

```console
$ grep -rn "isCatalogPushButtonFeature" front/src --include=*.jsx --include=*.js
front/src/routes/integration/all/mqtt/device-page/utils.js:469  (définition)
front/src/routes/integration/all/mqtt/device-page/utils.js:486  (getCatalogPreviewMode -> 'push-button')
front/src/routes/integration/all/mqtt/device-page/utils.js:539  (getFeatureDefaultValues -> min:1, max:1, keep_history:false)
front/src/routes/integration/all/mqtt/device-page/utils.js:831  (valeur d'exemple -> null)
```

Mais elle reste confinée au dossier `routes/integration/all/mqtt/` : **aucun
consommateur en dehors du catalogue MQTT**, en particulier pas le dashboard.

Le dashboard, lui, route via une table indexée par type dans
`front/src/components/boxs/device-in-room/DeviceRow.jsx`, qui ne connaît que
deux types TELEVISION et aucun type MUSIC :

```js
[DEVICE_FEATURE_TYPES.TELEVISION.CHANNEL]: NumberDeviceFeature,
[DEVICE_FEATURE_TYPES.TELEVISION.VOLUME]: MultiLevelDeviceFeature,
```

`play`, `pause`, `stop`… n'y figurant pas, `elementType` est `undefined` et le
composant retombe sur `SensorDeviceFeature` — d'où « Pas de valeur récente »
sur une feature qui n'aura jamais de valeur, puisque c'est une commande.

## Correction proposée

### 1. Extraire la règle dans un module partagé

`isCatalogPushButtonFeature` décrit une propriété du modèle de données (« cette
feature est une commande fugitive »), pas une particularité du catalogue MQTT.
La laisser dans `routes/integration/all/mqtt/` condamne les deux chemins à
diverger à nouveau au prochain type ajouté.

La déplacer vers un module commun, par exemple
`front/src/utils/deviceFeature.js`, et la renommer `isPushButtonFeature`.
Conserver un ré-export dans `device-page/utils.js` pour ne pas casser les
imports existants du catalogue (4 usages, dont les valeurs par défaut d'une
feature nouvellement créée).

### 2. Router les boutons dans `DeviceRow.jsx`

Le routage actuel est indexé **par type seul**, ce qui pose un problème connu et
déjà documenté dans le fichier : `MUSIC.PLAY` et `TELEVISION.PLAY` valent tous
deux la chaîne `'play'`. C'est exactement la collision qui a causé le bug #2592
(`air-conditioning/mode` rendu comme `fan/mode`), et qui a motivé l'ajout de
`ROW_TYPE_BY_CATEGORY_AND_TYPE`.

Il ne faut donc **pas** ajouter les commandes média à `ROW_TYPE_BY_FEATURE_TYPE`.
Tester la règle avant la résolution par type :

```js
import { isPushButtonFeature } from '../../../utils/deviceFeature';

const DeviceRow = ({ children, ...props }) => {
  const { device, deviceFeature } = props;
  const rowName = deviceFeature.new_label || getDeviceName(device, deviceFeature);

  if (props.deviceFeature.read_only) {
    return <SensorDeviceFeature ... />;
  }

  // Les commandes fugitives (play/pause/next…) n'ont pas d'état à afficher :
  // elles se rendent en bouton, quelle que soit leur catégorie.
  if (isPushButtonFeature(deviceFeature.category, deviceFeature.type)) {
    return createElement(PushDeviceFeature, { ...props, rowName });
  }

  const elementType =
    get(ROW_TYPE_BY_CATEGORY_AND_TYPE, `${deviceFeature.category}.${deviceFeature.type}`) ||
    ROW_TYPE_BY_FEATURE_TYPE[props.deviceFeature.type];
  ...
};
```

Placer le test **après** le court-circuit `read_only` : une intégration qui
publierait `television/play` en lecture seule (remontée d'état plutôt que
commande) doit continuer à s'afficher en capteur.

`PushDeviceFeature` envoie `updateValue(deviceFeature, 1)`, ce que les
intégrations concernées interprètent déjà comme « déclenche la commande ».

### 3. Compléter `SUPPORTED_FEATURE_TYPES`

`front/src/components/boxs/device-in-room/SupportedFeatureTypes.jsx` filtre les
features proposées à l'édition du box « appareils dans une pièce » :

```js
// EditDeviceInRoom.jsx:41
if (feature.read_only || SUPPORTED_FEATURE_TYPES.includes(feature.type)) {
```

La liste contient `TELEVISION.CHANNEL` et `TELEVISION.VOLUME`, mais aucune
commande média. Sans cet ajout, le correctif du point 2 reste invisible : les
features ne seraient toujours pas sélectionnables.

Y ajouter les types push de TELEVISION et MUSIC. Attention, cette liste est
elle aussi comparée **par type seul** (`includes(feature.type)`) : ajouter
`'play'` une fois couvre mécaniquement MUSIC et TELEVISION. Ce n'est pas gênant
ici (le filtre est permissif, le rendu réel est décidé par `DeviceRow`), mais
cela mérite un commentaire pour éviter qu'on croie à un oubli.

### 4. Tests

- `isPushButtonFeature` : TELEVISION et MUSIC classés en bouton, sauf
  `binary`/`volume`/`channel` et `volume`/`playback_state` ; `button/push` vrai ;
  une catégorie non concernée (`light/binary`) faux.
- `DeviceRow` : `television/play` non read-only rend `PushDeviceFeature` ;
  `television/volume` rend toujours `MultiLevelDeviceFeature` ; `television/play`
  **read-only** rend `SensorDeviceFeature` (non-régression du court-circuit) ;
  `music/play` rend `PushDeviceFeature` et non le composant TV (non-régression
  de la collision de types).

## Fichiers concernés

| Fichier                                                              | Modification                                   |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| `front/src/utils/deviceFeature.js`                                   | _(nouveau)_ `isPushButtonFeature`              |
| `front/src/routes/integration/all/mqtt/device-page/utils.js`         | ré-exporte la règle déplacée                   |
| `front/src/components/boxs/device-in-room/DeviceRow.jsx`             | route les boutons avant la résolution par type |
| `front/src/components/boxs/device-in-room/SupportedFeatureTypes.jsx` | ajoute les commandes média                     |

## Notes

- Aucun changement côté serveur ni côté intégrations : celles-ci publient déjà
  les bons types. Le correctif est purement front.
- `television/binary` (power) est volontairement classé en contrôle continu et
  non en bouton : c'est un état on/off qui se lit et se bascule, pas une
  commande fugitive. Le comportement actuel est conservé.
- Un état de lecture (play/pause courant) reste hors périmètre : ces features
  sont des commandes. Une remontée d'état passerait par une feature dédiée
  (`music/playback_state`), déjà classée en contrôle continu.
