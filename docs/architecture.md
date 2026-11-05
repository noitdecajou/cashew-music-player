# Architecture

```
┌────────────────────────── BrowserWindow (sans cadre) ──────────────────────────┐
│ Shell (src/renderer) : barre de titre, barre d’outils, mini-player, panneaux    │
│   window.player (src/preload/shell.ts)                                          │
│        │ shell:command / shell:window / shell:drag      ▲ player:snapshot        │
│        ▼                                                │ player:progress        │
│ Main (src/main)                                         │ ui:state               │
│   index.ts ── valide tout ce qui entre (sanitizeCommand / sanitizeAgentMessage) │
│   window/main-window.ts : modes, tailles des thèmes, panneaux, déplacement      │
│   ytm/ytm-view.ts : vue YouTube Music, navigation, permissions                  │
│        │ ytm:command                                    ▲ ytm:message            │
│        ▼                                                │                        │
│ WebContentsView music.youtube.com (partition persist:music)                     │
│   src/preload/ytm.ts (monde isolé) : simple relais                              │
│   src/preload/page-agent.ts (monde de la page) : s’abonne au lecteur YTM        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Principes

1. **Pousser, pas interroger.** L’agent de page s’abonne aux événements du lecteur
   (`onStateChange`, `onVideoDataChange`, `onVolumeChange`), aux événements média et au store de la
   file. Il n’y a pas d’observateur sur tout le DOM ni de battement rapide : seulement un filet de
   sécurité toutes les 3 s (quelques lectures de propriétés).
2. **Une carte, puis son horloge.** L’agent publie l’instantané (`snapshot`) d’un morceau avant sa
   première position (`progress`), sur un seul canal ordonné. Chaque position porte l’identifiant de
   son morceau ; le shell ignore celles qui ne correspondent pas à la carte affichée. Les courses
   métadonnées/horloge de la 1.x sont ainsi impossibles par construction (test e2e dédié).
3. **L’identité vient du lecteur.** `getVideoData().video_id` désigne le morceau ; le titre et
   l’artiste « Music » viennent de la ligne de file portant cet identifiant, sinon des données du lecteur.
4. **Rien n’est fait confiance.** Les messages de la page et les commandes du shell sont validés
   (formes, bornes, identifiants, URL https). La page YouTube Music n’a accès qu’à deux fonctions de relais.
5. **Économie quand c’est caché.** La position n’est diffusée que si la fenêtre est visible.
6. **La main gagne.** Pendant un glisser (progression, volume), les mises à jour externes sont ignorées ;
   la progression ne cherche qu’au relâchement.

## Fenêtre

- Grand lecteur : barre de titre (30 px) + barre d’outils (52 px) ; YouTube Music en dessous.
- Panneaux (recherche, file, réglages) : une page du renderer (`?view=drawer`) dans sa propre vue native,
  empilée au-dessus de YouTube Music. En grand lecteur, elle recouvre les 380 px de droite sans
  redimensionner YouTube Music et se ferme quand on revient dans YouTube Music ; en mini, elle occupe
  l’espace sous la carte (hauteur totale 450).
- Mini : taille de contenu fixée par le thème (`src/shared/themes.ts`), + 30 px si la barre de titre
  est visible ; panneau ouvert = hauteur totale 450. La vue YouTube Music est détachée et continue de jouer.
- Déplacement du mini sans barre : poignée, pochette ou titre (capture du pointeur, positions écran du
  processus principal), flèches du clavier sur la poignée.

## Tests

- `test/unit` : validation, préférences et migration 1.x, géométrie.
- `test/e2e` : vrai Electron + `test/fixtures/ytm.html`, une fausse page qui reproduit l’API du lecteur
  observée sur le vrai site. Couvre l’ordre carte/horloge pendant des enchaînements naturels avec une file
  en retard, les commandes, le glisser de progression, le volume, les tailles des thèmes et le refus des
  commandes invalides.
