# Music Player 2

Lecteur desktop **Windows** pour YouTube Music, avec un mini-player à 5 apparences.
Réécriture complète de la 1.7.x (Electron + TypeScript).

> **Statut : bêta (2.0.0-beta.1).** Toutes les fonctions sont en place :
> mini-player à 5 apparences (volume et progression glissable), panneaux en surimpression
> (recherche dans ses playlists, ses playlists et tout YouTube Music ; file interactive ; réglages),
> reprise de la dernière écoute, raccourci global, démarrage avec Windows, plein écran vidéo, hors ligne.

## Lancer depuis les sources (Windows)

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
| `npm.cmd run dist:win` / `dist:portable` | Installeur NSIS / exécutable portable |

## Documentation

- [docs/architecture.md](docs/architecture.md) : processus, flux de données, sécurité.
- [docs/ytm-bridge.md](docs/ytm-bridge.md) : ce qu’on utilise de YouTube Music, vérifié sur le vrai site.
- [docs/roadmap.md](docs/roadmap.md) : étapes et suivi.
