# Node-RED

Cette intégration fait tourner [Node-RED](https://nodered.org) à côté de
Gladys Assistant et relie les deux : vos flux peuvent démarrer des scènes
Gladys, les scènes Gladys peuvent appeler vos flux, et Node-RED s'affiche sur
vos tableaux de bord. Elle remplace l'intégration Node-RED native de Gladys.

## Où l'utiliser

- **Tous les pays, toutes les régions** : Node-RED tourne sur votre propre
  machine Gladys, sans compte ni service cloud.
- **Local uniquement** : tout reste sur votre réseau. Node-RED n'accède à
  Internet que si l'un de vos flux (ou le gestionnaire de palette) le fait.
- **Prérequis** : Gladys Assistant 5.1 ou plus récent, installé avec Docker
  (amd64 ou arm64, par ex. un Raspberry Pi 4/5). Node-RED utilise jusqu'à
  512 Mo de mémoire.

## Installation et configuration

1. Installez l'intégration **Node-RED** depuis le catalogue des intégrations.
2. Ouvrez son onglet **Configuration**, choisissez un **nom d'utilisateur**
   (`admin` par défaut) et un **mot de passe** (8 caractères minimum), puis
   enregistrez.
3. Node-RED démarre. Son éditeur s'ouvre sur `http://<adresse-gladys>:<port>` :
   le port est choisi par Gladys et affiché dans l'écran de configuration,
   dans le widget **État de Node-RED** et par le bouton **Tester la
   connexion**.

Node-RED ne démarre jamais sans mot de passe : son éditeur peut exécuter
n'importe quel code sur la machine. Changer l'identifiant ou le mot de passe
redémarre Node-RED.

Options :

- **Protéger les points d'accès HTTP des flux** (activé par défaut) : les
  nœuds `http in` demandent le même identifiant et mot de passe
  (authentification HTTP Basic). Ne la désactivez que si un appareil de votre
  réseau doit les appeler sans identifiants.
- **Conserver le contexte après un redémarrage** : enregistre le contexte des
  flux et global sur disque (`localfilesystem`) au lieu de la mémoire seule.

Les boutons de la configuration :

- **Tester la connexion** — vérifie que Node-RED répond, affiche sa version,
  ses flux et le port de l'éditeur.
- **Redémarrer Node-RED** — par exemple après l'installation de nœuds depuis
  la palette.

## Appareils

Dans l'onglet **Découverte** de l'intégration :

- **Node-RED** — un interrupteur qui démarre ou arrête tous les flux ;
- **Node-RED · <nom du flux>** — un appareil par onglet de flux, un
  interrupteur qui active ou désactive ce flux (comme le bouton de l'éditeur).

Ajoutez-les pour les utiliser sur les tableaux de bord et dans les scènes
(« contrôler un appareil », déclencheur « état d'un appareil »). Un nouveau
flux apparaît dans l'onglet Découverte en moins de 30 secondes.

## Scènes

L'intégration ajoute ses propres cartes à l'éditeur de scènes, dans la
catégorie **Intégrations**.

### Déclencheurs

- **Événement Node-RED** — un flux a envoyé un événement à Gladys. Indiquez
  le nom de l'événement pour ne réagir qu'à celui-ci, ou laissez vide pour
  tous. Les actions suivantes lisent `{{triggerEvent.data.event}}`,
  `{{triggerEvent.data.value}}` (un nombre) et `{{triggerEvent.data.text}}`.
- **Node-RED démarré ou arrêté** — Node-RED est devenu joignable ou
  injoignable (variables `status` et `version`).

Pour envoyer un événement depuis un nœud **function** :

```js
await global.get('gladys').trigger('door_opened', { value: 1, text: "Porte d'entrée" });
return msg;
```

Ou avec un nœud **http request** : méthode `POST`, URL `${GLADYS_EVENT_URL}`,
en-tête `Authorization` = `Bearer ${GLADYS_EVENT_TOKEN}`, et un corps JSON
`{ "event": "door_opened", "value": 1, "text": "Porte d'entrée" }`. Les deux
variables sont définies par l'intégration. Un nom d'événement compte 1 à 64
lettres, chiffres, `_`, `-`, `.` ou `:` ; `value` est un nombre (ou un
booléen, envoyé en 1/0) et `text` fait au plus 1 000 caractères.

### Actions

- **Envoyer à un flux Node-RED** — envoie en `POST`
  `{ "message": …, "value": …, "source": "gladys-scene" }` (JSON) à un nœud
  `http in` de vos flux, par ex. le chemin `/gladys/lumieres`. Le message
  accepte les variables de scène. Sorties : `success` (HTTP 2xx),
  `status_code` et `response` (le corps renvoyé par le nœud `http response`,
  10 000 caractères maximum).
- **Démarrer ou arrêter tous les flux** — sortie `running`.
- **Activer ou désactiver un flux** — choisissez l'appareil du flux ; sortie
  `enabled`.
- **Redémarrer Node-RED** — sortie `restarted`.

Exemple de flux recevant l'action : `http in` (POST, `/gladys/lumieres`) →
`function` (lit `msg.payload.message` et `msg.payload.value`) →
`http response`.

## Tableau de bord

Deux widgets sont disponibles dans l'éditeur de tableau de bord :

- **État de Node-RED** — si Node-RED fonctionne, sa version, le nombre de
  flux activés et le port de l'éditeur, avec les boutons **Démarrer / Arrêter
  les flux** et **Redémarrer** ;
- **Flux Node-RED** — la liste des flux avec leur badge activé / désactivé.

## Migrer depuis l'intégration native

1. Dans l'**ancien** éditeur Node-RED : menu **☰ → Exporter → Tous les flux →
   Télécharger**. Notez les nœuds supplémentaires installés dans **Gérer la
   palette**.
2. Installez et configurez cette intégration (voir plus haut), ouvrez le
   nouvel éditeur.
3. Installez les mêmes nœuds depuis **Gérer la palette**, puis **☰ →
   Importer** le fichier exporté.
4. Ressaisissez les mots de passe des nœuds de configuration (broker MQTT,
   identifiants HTTP…) : ils sont chiffrés et ne suivent pas l'export.
5. Dans les nœuds broker MQTT, remplacez `localhost` / `127.0.0.1` par
   l'**adresse IP de la machine Gladys** (voir les limites ci-dessous).
6. Désactivez l'intégration Node-RED native de Gladys
   (**Intégrations → Node-RED**), pour que les deux n'exécutent pas les mêmes
   flux.

## Limites

- Node-RED tourne dans son propre conteneur isolé, sur un réseau privé :
  `localhost` désigne Node-RED lui-même. Joignez les autres services de la
  machine (broker MQTT, Zigbee2MQTT…) par l'adresse IP de la machine Gladys.
- Pas d'accès aux ports USB / série ni de diffusion réseau (mDNS, découverte
  UDP) depuis les flux : le conteneur n'a pas d'accès privilégié.
- Node-RED 5 est installé ; il est mis à jour avec l'intégration.

## Dépannage

- **« Définissez un mot de passe »** dans l'écran de configuration : le mot de
  passe manque ou fait moins de 8 caractères.
- **« Node-RED a refusé les identifiants »** : appuyez sur **Redémarrer
  Node-RED**.
- **L'éditeur ne s'ouvre pas** : Node-RED est peut-être encore en train de
  démarrer (jusqu'à une minute sur un Raspberry Pi), utilisez **Tester la
  connexion**.
- Les logs de l'intégration (avec `LOG_LEVEL=debug` pour le détail) et de
  Node-RED sont disponibles dans l'écran de supervision de Gladys.
