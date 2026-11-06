# Feuille de route

| Étape | Contenu | État |
|---|---|---|
| 1. Squelette | electron-vite, TypeScript strict, main en modules, contrats IPC typés, tests unitaires et e2e | ✅ |
| 2. Pont YTM | agent de page événementiel, commandes, volume, opérations (bibliothèque, recherche, file, reprise), validation | ✅ |
| 3. Mini-players | Actuel, Autoradio, Hi-fi, Autoradio 2000 (HF), Hi-Fi de salon (HF) ; volume et progression glissable partout | ✅ |
| 4. Fonctions | bibliothèque indexée et favoris, recherche YouTube Music, file interactive (lire, retirer, « Lire ensuite »), reprise, réglages, raccourci global, démarrage Windows, plein écran vidéo, hors ligne et nouvelles tentatives, menu de la zone de notification | ✅ |

## Vérifié sur le vrai music.youtube.com (non connecté, depuis le conteneur)

Métadonnées, « À suivre », volume, recherche globale (20 résultats avec pochettes), file de 50 titres,
saut à un titre, retrait, « Lire ensuite ».

## À valider sur Windows (bêta 1)

- Bibliothèque : indexation de **tes** playlists (impossible à tester sans compte), favoris, lecture d’une playlist.
- Recherche « YouTube Music » connecté : le filtre « Titres » doit être utilisé.
- Reprise après redémarrage (titre, playlist, position).
- Les 5 apparences à 100 %, 125 %, 150 % d’échelle Windows ; déplacement sans barre.
- Plein écran vidéo (bouton de YouTube Music) puis Échap.
- Raccourci global, démarrage avec Windows (version installée), démarrage discret.
- Mesure : mémoire et CPU (Réglages → Mesurer la consommation), comparées à la 1.7.x.

## Distribution

| Élément | État |
|---|---|
| Installeur Windows (NSIS) construit par GitHub Actions sur étiquette `v*` | ✅ |
| Publication dans GitHub Releases + `latest.yml` | ✅ |
| Mises à jour dans l’application (vérifier, télécharger à la demande, redémarrer) | ✅ |
| Dépôt public (nécessaire pour télécharger et mettre à jour) | ✅ |
| Version stable 2.0.0 | ✅ |
| Signature de l’installeur (supprime l’avertissement SmartScreen) | plus tard : SignPath demande un projet déjà connu (`docs/signing.md`) |

## Idées pour la suite

- Boutons de miniature de la barre des tâches (précédent, lecture, suivant).
- J’aime / Je n’aime pas depuis le mini-player.
- Défilement des titres longs sur les écrans à matrice de points.
