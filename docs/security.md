# Sécurité

## Modèle

cashew affiche music.youtube.com dans une vue isolée (`persist:music`, sandbox, isolation de contexte,
pas de Node.js). La page ne parle à l’application que par un pont minimal (`emit` / `onCommand`), accepté
seulement depuis le cadre principal de music.youtube.com, et chaque message est validé par schéma
(`src/shared/player.ts`, `src/shared/ops.ts`). Nos propres pages (barre de titre, panneaux) n’acceptent
d’appels privilégiés que de leurs propres fenêtres (`fromUi`) et n’affichent les données de la page qu’en
texte. Les fichiers locaux sont revalidés à la lecture.

## Audit de novembre 2026 (2.0.0-beta.7 → beta.8)

Audit complet selon la méthode Cloudflare *security-audit-skill* (profil standard, révision `2a06548`) :
25 zones examinées, avec des vérifications exécutées hors ligne dans un bac à sable. Chaque résultat a été
revu par deux vérificateurs indépendants.

| Résultat | Statut | Correctif (beta.8) |
|---|---|---|
| Caméra et micro accordés sans demande à toute page ou cadre affiché dans la vue YouTube Music (moyenne) | confirmé | permissions limitées au plein écran et à la copie, pour le cadre principal de music.youtube.com ; `src/main/ytm/ytm-view.ts`, test `test/e2e/permissions.test.mjs` |
| Filtre de navigation : `accounts.google.<n’importe quoi>` accepté (faible) | confirmé | domaines pays de Google uniquement ; `src/main/ytm/navigation.ts`, test `test/unit/navigation.test.ts` |
| Mises à jour vérifiées seulement par l’empreinte de `latest.yml`, sans éditeur | à valider | éditeur inscrit dans `app-update.yml` pour les versions signées (`docs/signing.md`) |
| Installation « tous les utilisateurs » dans un dossier au choix, sans protection des droits | à valider | installation par utilisateur uniquement, dossier par défaut |

Durcissement : fuses Electron (pas de mode Node.js, pas de `NODE_OPTIONS` ni de `--inspect`, asar vérifié
et seul chargé, cookies chiffrés), aucune permission ni aucun téléchargement pour nos pages, aucun
téléchargement depuis la vue YouTube Music, CI en lecture seule, actions épinglées par SHA, publication
réservée à `main`, Dependabot, oxlint.

Réglages du dépôt en place (novembre 2026) : dépôt public, étiquettes `v*` protégées (ruleset décrit dans
`docs/signing.md`, « Qui peut publier »), signalement privé des failles activé, double authentification sur
le compte du propriétaire, droit d’écriture réservé au propriétaire.

Versions non signées pour l’instant (`docs/signing.md`) : l’authenticité des mises à jour repose donc sur
le compte GitHub du propriétaire, seul à pouvoir publier une Release. À l’activation de SignPath, définir
`SIGNPATH_PUBLISHER_NAME` pour que les applications n’acceptent plus que des mises à jour signées.

## Signaler une faille

Ouvre un signalement privé : onglet **Security** du dépôt → **Report a vulnerability**. Merci de ne pas
publier les détails avant qu’un correctif soit disponible.

Pour le propriétaire : ce bouton n’existe qu’une fois le signalement privé activé, ce que GitHub ne
propose que pour les dépôts publics. Après le passage en public : Settings → section **Security**
(**Advanced Security** ou **Code security** selon l’interface) → **Private vulnerability reporting** →
**Enable**.
