# cashew

Lecteur **YouTube Music** pour **Windows**, avec un mini-player toujours à portée de main.

cashew affiche le site officiel de YouTube Music dans une fenêtre dédiée et y ajoute ce qui manque
à un onglet de navigateur : un mini-player compact à 5 apparences, une recherche rapide dans tes playlists,
une file d’attente interactive, la reprise de la dernière écoute et un raccourci global.

| Actuel | Autoradio | Hi-fi |
|---|---|---|
| ![Mini-player Actuel](docs/screenshots/mini-modern.png) | ![Mini-player Autoradio](docs/screenshots/mini-autoradio.png) | ![Mini-player Hi-fi](docs/screenshots/mini-hifi.png) |

![Mini-player Autoradio 2000 (HF)](docs/screenshots/mini-autoradio-hf.png)

![Mini-player Hi-Fi de salon (HF)](docs/screenshots/mini-hifi-hf.png)

## Fonctions

- **Mini-player** : Actuel, Autoradio, Hi-fi, Autoradio 2000 (HF), Hi-Fi de salon (HF). Progression qu’on fait
  glisser, volume intégré, épinglage au premier plan, barre de fenêtre masquable, déplacement à la poignée.
- **Recherche** dans les titres de tes playlists (même hors ligne), parmi tes playlists (avec favoris) ou dans tout
  YouTube Music ; « Lire maintenant » et « Lire ensuite ».
- **File d’attente** en direct : clic pour lire un titre, retrait d’un titre.
- **Reprise** de la dernière écoute après redémarrage, à la bonne position.
- **Raccourci global** (Ctrl+Alt+M par défaut), démarrage avec Windows, plein écran vidéo, mises à jour intégrées.

## Installer (Windows 10/11, 64 bits)

1. Ouvrir la page [**Releases**](https://github.com/noitdecajou/cashew-music-player/releases), prendre la version
   la plus récente (en haut de la liste) et, dans **Assets**, télécharger `MusicPlayer-Setup-<version>.exe`
   (pas « Source code »).
2. Lancer l’installeur. Tant que l’application n’est pas signée, Windows SmartScreen peut afficher « Windows a
   protégé votre ordinateur » : cliquer sur **Informations complémentaires** puis **Exécuter quand même**.
3. Se connecter à YouTube Music dans le grand lecteur.

**Mises à jour :** cashew vérifie au démarrage puis toutes les 6 heures. Quand une version est disponible, un
message l’annonce ; **Réglages → Mises à jour → Télécharger et installer**, puis **Redémarrer et installer**.
Rien n’est téléchargé sans ton accord.

**Antivirus :** certains antivirus signalent à tort des fichiers d’Electron (le moteur de l’application). Si la
fenêtre reste vide ou qu’un message indique des fichiers manquants, réinstaller cashew, ou restaurer les fichiers
depuis Sécurité Windows → Historique de protection.

## Confidentialité

- Ta connexion Google reste dans le profil local de l’application, sur ton PC (comme dans un navigateur).
  cashew ne lit ni ne transmet tes identifiants.
- cashew ne contient aucun suivi ni statistique d’utilisation.
- Connexions réseau : **music.youtube.com** et les services Google nécessaires à YouTube Music (lecture, connexion),
  et **github.com** pour vérifier les mises à jour. Rien d’autre.
- Données locales (dans `%APPDATA%\Music Player`) : préférences, index de tes playlists pour la recherche hors ligne,
  dernier titre écouté, journal de diagnostic.

## Avertissement

cashew est un projet indépendant, **non affilié à YouTube ni à Google**. YouTube et YouTube Music sont des marques
de Google LLC. cashew affiche le site officiel de YouTube Music ; son utilisation reste soumise aux conditions
d’utilisation de YouTube. Un abonnement YouTube Music Premium n’est pas fourni : les fonctions disponibles sont
celles de ton compte.

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org) — *une fois le projet accepté par SignPath Foundation
(voir [docs/signing.md](docs/signing.md)).*

- Committers and reviewers: [Ben Deurveilher](https://github.com/noitdecajou)
- Approvers: [Ben Deurveilher](https://github.com/noitdecajou)

Les binaires signés sont construits uniquement par le workflow GitHub Actions public de ce dépôt
(`.github/workflows/release.yml`), à partir des sources de ce dépôt.

Privacy policy: this program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it, except the connections described in
« Confidentialité » above (YouTube Music, and GitHub to check for updates).

## Développer

Dans le dossier du projet :

```powershell
npm.cmd ci
npm.cmd run dev        # développement, rechargement à chaud
npm.cmd run build ; npm.cmd start   # version compilée
```

| Commande | Rôle |
|---|---|
| `npm.cmd test` | Tests unitaires (Vitest) |
| `npm.cmd run test:e2e` | Tests de bout en bout dans un vrai Electron, contre une fausse page YouTube Music |
| `npm.cmd run test:live` | Vérification contre le vrai music.youtube.com (aussi lancée chaque semaine par GitHub Actions) |
| `npm.cmd run typecheck` | Vérification TypeScript |
| `npm.cmd run dist:win` | Installeur local, sans publication (`dist/`) |

Documentation : [architecture](docs/architecture.md) · [pont YouTube Music](docs/ytm-bridge.md) ·
[feuille de route](docs/roadmap.md) · [publier une version](docs/releasing.md) · [signature](docs/signing.md) ·
[historique](CHANGELOG.md)

## Licence

[MIT](LICENSE) © 2026 Ben Deurveilher
