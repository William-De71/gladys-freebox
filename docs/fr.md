# Intégration Freebox

Cette intégration permet de contrôler votre **Freebox** depuis Gladys Assistant, directement sur votre réseau local, sans cloud.

## Fonctionnalités

- **Domotique Freebox** : capteurs d'ouverture, capteurs de mouvement, niveau de batterie, volets roulants (état et position).
- **Freebox Players** (modèles compatibles, voir plus bas) : allumage détecté (lecture seule), volume, coupure du son, et contrôle de la lecture (play, pause, stop, précédent, suivant, retour et avance rapide).
- **Caméras Freebox** : image affichée sur le tableau de bord (rafraîchie automatiquement) et à la demande, via une capture ffmpeg du flux vidéo.
- **Actions** : appairer, tester la connexion, redémarrer la Freebox et désappairer, directement depuis l'écran de configuration.

## Prérequis

- Une Freebox (Delta, Ultra, Pop, Revolution...) avec le serveur domotique activé.
- Gladys Assistant et cette intégration doivent être sur le **même réseau local** que la Freebox (accès à `mafreebox.freebox.fr`).

## Appairage

1. Ouvrez l'écran de configuration de l'intégration Freebox dans Gladys.
2. Cliquez sur le bouton **« Appairer avec la Freebox »**.
3. Rendez-vous devant votre Freebox Server : l'écran LCD affiche une demande d'autorisation. Appuyez sur la **flèche de droite** pour valider.
4. L'appairage est mémorisé : vous n'avez à le faire qu'une seule fois.

⏱️ **Vous avez environ 55 secondes** pour appuyer sur la flèche de droite du LCD. Passé ce délai, l'appairage échoue avec le message « l'autorisation n'a pas été confirmée sur l'écran LCD » : relancez simplement l'action **« Appairer avec la Freebox »**. Pensez à être à côté de votre Freebox **avant** de cliquer sur le bouton.

## Permissions à cocher (important)

Après l'appairage, ouvrez les réglages de votre Freebox :

**Freebox OS > Paramètres > Gestion des accès > Applications > Gladys Assistant**

et **cochez** les permissions suivantes :

- **Gestion de la domotique et de l'alarme** (capteurs, volets)
- **Accès aux caméras**
- **Contrôle du Freebox Player**

⚠️ Sans ces cases cochées, les appareils correspondants **n'apparaîtront pas** lors de la découverte. C'est la cause la plus fréquente d'un appareil manquant.

Une fois les permissions accordées, lancez une découverte des appareils : Gladys vous proposera tous les appareils détectés sur votre Freebox. Choisissez ceux que vous souhaitez créer.

## Limitation des Freebox Player POP / Android TV

Les **Freebox Player POP** (et autres players basés sur **Android TV**) ne sont **pas contrôlables** par cette intégration : Free n'expose pas l'API de contrôle locale sur ces modèles (le player est signalé avec `api_available: false` et est donc ignoré). Pour piloter un Player POP, il faut passer par une intégration **Android TV** (protocole ADB), en dehors du périmètre de cette intégration.

Les Player des Freebox **Delta** et **Revolution** (qui exposent l'API player locale) restent, eux, pleinement contrôlables.

## Redémarrer la Freebox

L'action **« Redémarrer la Freebox »** de l'écran de configuration relance votre Freebox Server. Il n'existe pas d'action d'extinction : l'API Freebox n'expose que le redémarrage (une box éteinte ne pourrait pas être rallumée à distance).
