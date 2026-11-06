# Signature de code (SignPath Foundation)

L’installeur et `Music Player.exe` peuvent être signés gratuitement par **SignPath Foundation**, qui
fournit un certificat aux projets open source. La signature réduit les avertissements SmartScreen et aide
l’application à gagner la confiance des antivirus.

Le workflow Release est **déjà prêt** : tant que SignPath n’est pas configuré, il publie comme aujourd’hui,
sans signature. Dès que les réglages ci-dessous existent sur GitHub, chaque version **publiée** est signée.
Les simples constructions de contrôle ne sont pas signées.

## Ce que fait le workflow

1. construit l’application (`dist/win-unpacked`) ;
2. l’envoie à SignPath, qui signe `Music Player.exe` (configuration `app`) ;
3. reconstruit l’installeur à partir de l’application signée (`--prepackaged`) ;
4. envoie l’installeur à SignPath (configuration `installer`) ;
5. recalcule l’empreinte, la taille et le `.blockmap` de l’installeur signé dans `latest.yml`
   (`build/update-metadata.cjs`), sans quoi les applications installées refuseraient la mise à jour ;
6. publie la Release.

Les bibliothèques d’Electron (`ffmpeg.dll`, etc.) ne sont pas signées par Electron et ne le sont pas
ici non plus : ce sont des fichiers tiers, que SignPath Foundation ne signe pas pour un autre projet.

## Mise en place (une fois)

1. **Conditions** : dépôt **public**, licence open source (MIT ✓), au moins une version déjà publiée, projet
   activement maintenu. Rendre le dépôt public avant la demande.
2. **Section « Code signing policy » dans le README** (exigée par SignPath Foundation) : elle est déjà
   rédigée dans le README ; la vérifier (rôles, confidentialité).
3. **Demande** sur https://signpath.org/apply avec l’adresse du dépôt. SignPath vérifie le projet ; compter
   quelques jours.
4. Dans l’espace SignPath du projet, une fois accepté :
   - activer la double authentification sur ton compte ;
   - créer le projet (par exemple `cashew-music-player`) relié au dépôt GitHub, avec la source « GitHub
     Actions » (« Trusted Build System ») ;
   - créer deux **artifact configurations** et y coller le contenu de :
     - `build/signpath/app.xml`, avec le *slug* **`app`** ;
     - `build/signpath/installer.xml`, avec le *slug* **`installer`** ;
   - noter le *slug* de la **signing policy** de publication (en général `release-signing`) ;
   - créer un **API token** pour l’intégration CI.
5. Sur GitHub, dépôt → Settings → Secrets and variables → Actions :
   - onglet **Secrets** : `SIGNPATH_API_TOKEN` = le jeton ;
   - onglet **Variables** :
     - `SIGNPATH_ORGANIZATION_ID` = l’identifiant de l’organisation SignPath,
     - `SIGNPATH_PROJECT_SLUG` = le slug du projet,
     - `SIGNPATH_SIGNING_POLICY_SLUG` = le slug de la signing policy,
     - `SIGNPATH_PUBLISHER_NAME` = le nom (CN) du certificat qui signe, tel qu’il apparaît dans les
       propriétés de l’installeur signé → Signatures numériques (pour SignPath Foundation :
       `SignPath Foundation`). **Obligatoire** : sans elle, le workflow refuse de publier une version
       signée.
6. Publier une version comme d’habitude (docs/releasing.md). Selon la politique choisie, SignPath peut
   demander une **approbation manuelle** de chaque signature : le workflow attend alors ta validation sur
   le site de SignPath.

## Après la première version signée

- Les versions signées inscrivent `SIGNPATH_PUBLISHER_NAME` dans `resources/app-update.yml` : elles
  n’installent plus qu’une mise à jour signée par cet éditeur (vérification Authenticode d’electron-updater).
  Sans cela, la seule vérification était l’empreinte de `latest.yml`, publiée au même endroit que
  l’installeur (audit de sécurité, 2.0.0-beta.8). Toutes les versions suivantes doivent donc être signées
  avec le même certificat.
- Les applications déjà installées (non signées) acceptent la première version signée normalement.

## Qui peut publier

- Le workflow ne publie que des commits de `main` (lancé depuis `main`, ou étiquette posée sur un commit de
  `main`).
- Toute personne ayant le droit d’écriture sur le dépôt peut lancer Release : garder ce droit pour soi, et
  idéalement protéger les étiquettes `v*` (Settings → Rules → Rulesets → Tag rules).
- Optionnel, pour exiger une approbation avant chaque publication : créer un environnement `release`
  (Settings → Environments) avec « Required reviewers », y déplacer `SIGNPATH_API_TOKEN`, et ajouter
  `environment: release` au job du workflow.
