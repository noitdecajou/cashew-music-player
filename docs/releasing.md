# Publier une version

Les versions sont construites et publiées par GitHub Actions (`.github/workflows/release.yml`) sur un
runner Windows. Les applications installées trouvent la nouvelle version dans les **Releases** du dépôt
(fichier `latest.yml` publié avec l’installeur).

## Prérequis (une seule fois)

- Le dépôt doit être **public** : sinon personne ne peut télécharger l’installeur, et les applications
  installées ne peuvent pas vérifier les mises à jour (GitHub → Settings → General → Danger Zone → Change visibility).
- GitHub → Settings → Actions → General → Workflow permissions : « Read and write permissions »
  (le workflow crée la Release avec le jeton fourni par GitHub).

## Publier

1. Mettre à jour `CHANGELOG.md`.
2. Changer la version dans `package.json` (par exemple `2.0.0`, ou `2.1.0-beta.1` pour une préversion), puis
   `npm.cmd install --package-lock-only`.
3. Commit et push sur `main`, puis **au choix** :
   - sur GitHub : **Actions → Release → Run workflow**, cocher **Publier**, puis **Run workflow** ;
   - ou en ligne de commande, créer et pousser l’étiquette :

   ```powershell
   git commit -am "Version 2.0.0"
   git tag v2.0.0
   git push origin main v2.0.0
   ```

4. Le workflow vérifie que l’étiquette correspond à `package.json` (et qu’elle n’existe pas déjà), lance les tests, construit
   `MusicPlayer-Setup-2.0.0.exe` et publie la Release, avec la section correspondante de `CHANGELOG.md`
   comme notes. Une version avec suffixe (`-beta.N`) est publiée comme préversion.

Les applications installées en version stable ne proposent que des versions stables ; une préversion
(`-beta.N`) propose aussi les préversions suivantes.

## Construire sans publier

Actions → Release → **Run workflow** sans cocher « Publier » : l’installeur est disponible dans les artefacts de l’exécution.
En local : `npm.cmd run dist:win` (sortie dans `dist/`).

## Signature

L’installeur n’est pas signé : SmartScreen avertit au premier lancement. Une signature (certificat de
signature de code, ou Azure Trusted Signing) supprimerait cet avertissement ; à prévoir avant une diffusion large.
