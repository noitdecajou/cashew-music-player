# Music Player 2

Lecteur desktop **Windows** pour YouTube Music, avec un mini-player à 5 apparences.
Réécriture complète de la 1.7.x (Electron + TypeScript).

> **Statut : bêta.** Mini-player à 5 apparences (volume, progression glissable), recherche dans ses playlists
> et dans tout YouTube Music, file interactive, reprise de la dernière écoute, raccourci global,
> démarrage avec Windows, plein écran vidéo, mises à jour automatiques.

## Installer (Windows 10/11, 64 bits)

1. Ouvrir la page [**Releases**](https://github.com/noitdecajou/cashew-music-player/releases), prendre la version
   la plus récente (en haut de la liste ; pendant la bêta, elles sont marquées « Pre-release ») et, dans **Assets**,
   télécharger `MusicPlayer-Setup-<version>.exe` (pas « Source code »).
2. Lancer l’installeur. L’application n’étant pas signée, Windows SmartScreen peut afficher « Windows a protégé
   votre ordinateur » : cliquer sur **Informations complémentaires** puis **Exécuter quand même**.
3. Se connecter à YouTube Music dans le grand lecteur.

**Mises à jour :** l’application vérifie au démarrage puis toutes les 6 heures. Quand une version est disponible,
un message l’annonce ; **Réglages → Mises à jour → Télécharger et installer**, puis **Redémarrer et installer**.
Rien n’est téléchargé sans ton accord.

## Développer (depuis les sources)

Quitter d’abord la 1.x (icône de notification → Quitter). Dans le dossier du projet :

```powershell
npm.cmd ci
npm.cmd run dev        # développement, rechargement à chaud
npm.cmd run build ; npm.cmd start   # version compilée
```

La 2.x réutilise la session de connexion (`persist:music`), l’identifiant Windows et les préférences de la 1.x
(`window-preferences.json` est migré en `preferences.json` au premier lancement, sans être modifié).

## Commandes

| Commande | Rôle |
|---|---|
| `npm.cmd test` | Tests unitaires (Vitest) |
| `npm.cmd run test:e2e` | Tests de bout en bout dans un vrai Electron, contre une fausse page YouTube Music |
| `npm.cmd run typecheck` | Vérification TypeScript |
| `npm.cmd run dist:win` | Installeur NSIS local, sans publication (`dist/`) |

## Documentation

- [docs/architecture.md](docs/architecture.md) : processus, flux de données, sécurité.
- [docs/ytm-bridge.md](docs/ytm-bridge.md) : ce qu’on utilise de YouTube Music, vérifié sur le vrai site.
- [docs/roadmap.md](docs/roadmap.md) : étapes et suivi.
- [docs/releasing.md](docs/releasing.md) : publier une version.
- [CHANGELOG.md](CHANGELOG.md) : historique des versions.
