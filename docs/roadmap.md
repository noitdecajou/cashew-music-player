# Feuille de route

| Étape | Contenu | État |
|---|---|---|
| 1. Squelette | electron-vite, TypeScript strict, main en modules, contrats IPC typés, tests unitaires et e2e | ✅ |
| 2. Pont YTM | agent de page événementiel, commandes, volume, validation | ✅ (lecture réelle à valider sur Windows) |
| 3. Mini-players | « Actuel » ✅ avec volume et progression glissable ; Autoradio, Hi-fi, Autoradio HF, Hi-Fi HF à refaire proprement | en cours |
| 4. Fonctions | bibliothèque et recherche, file interactive, reprise de session, réglages, raccourci global, démarrage Windows, plein écran vidéo, hors ligne | à faire |

## À valider sur Windows (alpha 1)

- Connexion conservée depuis la 1.x ; lecture, pause, suivant, précédent, aléatoire.
- Titre, artiste, pochette et « À suivre » justes, y compris lors des enchaînements automatiques.
- Glisser la progression ; volume (molette, glisser, clic = muet quand le curseur est ouvert).
- Mini : 420 × 128 (+ 30 avec la barre), Ctrl+Maj+B, déplacement par la poignée/pochette/titre, épinglage.
- Fermer la fenêtre → la musique continue, tray → Ouvrir / Quitter.
- Mesure de référence : mémoire et CPU dans le Gestionnaire des tâches, comparées à la 1.7.x.
