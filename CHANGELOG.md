# Historique

## 2.0.0

Première version stable de **cashew**, réécriture complète du lecteur 1.x (Electron + TypeScript). Depuis la 1.7 :

- **Mini-players** : 5 apparences (Actuel, Autoradio, Hi-fi, Autoradio 2000, Hi-Fi de salon), avec volume et barre de progression glissable dans chacune.
- **Bibliothèque et recherche** : recherche rapide dans tes playlists (sans accents ni majuscules), favoris, recherche dans tout YouTube Music.
- **File d’attente** interactive (lire, retirer, « Lire ensuite »), **reprise** de la dernière écoute à sa position.
- **Réglages** : raccourci global, démarrage avec Windows (discret ou non), épingler au premier plan.
- **Mises à jour** depuis l’application, sans rien télécharger sans ton accord.
- **Fiabilité** : détection des fichiers mis en quarantaine par un antivirus, réparation de l’affichage, journal de diagnostic.
- **Sécurité** : audit complet et correctifs (caméra et micro jamais accordés, navigation limitée à YouTube Music et Google, application et installation durcies) — voir `docs/security.md`.

Les installations bêta reçoivent cette version comme mise à jour ; ensuite, seules les versions stables sont proposées.

## 2.0.0-beta.9

- Dépôt GitHub recréé (historique nettoyé des données personnelles) : cette version republie la beta.8 à l’identique, pour que les applications installées retrouvent leurs mises à jour. Aucun changement dans l’application.

## 2.0.0-beta.8

Audit de sécurité (méthode Cloudflare *security-audit-skill*) et correctifs : voir `docs/security.md`.

- YouTube Music n’a plus accès à la caméra ni au micro (ils étaient accordés sans demande, à toute page affichée dans le lecteur) ; seuls le plein écran vidéo et la copie restent permis, et uniquement pour music.youtube.com.
- Navigation : les faux domaines du type `accounts.google.exemple-pirate.com` sont bloqués.
- Mises à jour : dès que les versions seront signées, l’application n’installera plus qu’une mise à jour signée par le même éditeur.
- Installation : toujours pour l’utilisateur courant, dans son dossier (`%LOCALAPPDATA%\Programs`) ; plus d’installation « pour tous les utilisateurs » ni de dossier au choix.
- Application durcie : l’exécutable ne peut plus servir à lancer du code Node.js ou à être débogué en ligne de commande ; il ne charge que son propre code, vérifié ; les cookies de session Google sont chiffrés sur le disque (Windows). Une fois cette version installée, revenir à une version antérieure obligerait à se reconnecter à YouTube Music.
- Divers : plein écran vidéo refusé en mini-player ; la position de reprise n’est plus enregistrée dans la session d’un autre compte.
- Projet : mises à jour des dépendances proposées chaque semaine (Dependabot), actions épinglées, publication réservée à `main`, contrôle du code (oxlint) et du formatage (Prettier) en CI.

## 2.0.0-beta.7

- Identité **cashew** : glyphe et nom dans la barre de titre, la fenêtre, la zone de notification et les raccourcis (« Cashew Music Player ») ; nouvelle icône d’application.
- Mini-players : libellé « CASHEW » ; le glyphe remplace la poignée (Actuel, Autoradio) ou la LED (Hi-fi), dans la couleur de chaque apparence ; « cashew » à l’écran de l’Autoradio au repos.
- Pochette vide : glyphe en ton sourd ; pied des Réglages avec la version ; écran de démarrage pendant le chargement de YouTube Music.
- Licence MIT ; vérification hebdomadaire automatique contre le vrai YouTube Music ; signature SignPath préparée.

## 2.0.0-beta.6

- Fichiers supprimés ou modifiés après l’installation (typiquement mis en quarantaine par un antivirus) : au lieu d’une fenêtre vide, un message explique la situation et propose de télécharger l’installeur ou d’ouvrir Sécurité Windows. L’installeur contient désormais l’inventaire de ses fichiers, vérifié à chaque démarrage.

## 2.0.0-beta.5

- Interface qui reste vide : surveillance automatique — si une page n’a pas reçu son état quelques secondes après son chargement, ou si son processus plante, l’état lui est renvoyé, puis la page est rechargée.
- Dépannage : « Réparer l’affichage » (menu de la zone de notification → Dépannage, et Réglages) repasse en grand lecteur avec sa barre et recharge l’interface.
- Journal de diagnostic dans le dossier de l’application (`logs/main.log`), ouvrable depuis le menu Dépannage.

## 2.0.0-beta.4

- Panneaux (réglages, file, recherche) : ils ne se ferment plus que sur un vrai clic dans YouTube Music. Auparavant, un simple changement de focus les refermait, ce qui pouvait les faire disparaître dès leur ouverture sous Windows.

## 2.0.0-beta.3

- Volume dans les mini-players Autoradio et Hi-fi : le réglage remplace « À suivre » au lieu de s’afficher par-dessus.
- Publication : une seule Release par version, marquée « préversion » pour les bêtas (les installations stables ne reçoivent pas les bêtas).

## 2.0.0-beta.2

- Mises à jour automatiques depuis GitHub Releases (vérification au démarrage puis toutes les 6 h, téléchargement à la demande, redémarrage pour installer) ; installeur Windows construit et publié par GitHub Actions.
- Épingle pleine quand la fenêtre est épinglée.
- Autoradio : titre lisible sur toute la largeur de l’écran, défilement des titres longs, « À suivre » sur une ligne, commandes sans contour.
- Autoradio 2000 (HF) : titre plus petit, commandes sans contour.
- Police à matrice de points remplacée par Doto (licence OFL), qui affiche les accents.

## 2.0.0-beta.1

- Les 5 apparences du mini-player ; recherche dans ses playlists, ses playlists et tout YouTube Music ; file interactive ; reprise ; réglages ; raccourci global ; démarrage Windows ; plein écran vidéo ; hors ligne.

## 2.0.0-alpha.1

- Réécriture complète (Electron + TypeScript) : pont YouTube Music événementiel, mini-player « Actuel » avec volume et progression glissable.
