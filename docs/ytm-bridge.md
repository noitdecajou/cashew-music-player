# Pont YouTube Music : ce qui est utilisé

Relevé sur music.youtube.com le 2026-11-05 (Electron 45, non connecté), puis agent validé sur la vraie page.

## Lecteur `#movie_player`

Méthodes utilisées : `getPlayerState` (−1 non démarré, 0 fini, 1 lecture, 2 pause, 3 chargement, 5 prêt),
`getVideoData` (`video_id`, `title`, `author`), `getCurrentTime`, `getDuration`, `getVolume`, `isMuted`,
`setVolume`, `mute`, `unMute`, `seekTo(s, true)`, `playVideo`, `pauseVideo`, `addEventListener`.

Événements : `onStateChange`, `onVideoDataChange`, `onVolumeChange` (`{volume, muted}`).

## File (`ytmusic-player-queue` → `.queue.store.store`)

`getState().queue` : `items`, `selectedItemIndex`, `shuffleEnabled`, `repeatMode`, `automixItems`,
`queueContextParams`, `nextQueueItemId`… ; `subscribe(fn)`. Lignes : `playlistPanelVideoRenderer`
(ou `playlistPanelVideoWrapperRenderer.primaryRenderer…`) avec `videoId`, `title`, `shortBylineText`, `thumbnail`.

## Barre `ytmusic-player-bar`

Boutons cliqués (pour garder la logique de file de Music) : `#play-pause-button`, `.next-button`,
`.previous-button`, `.shuffle`, `.repeat`. Attributs : `shuffle-on`, `repeat-mode`.
`ytmusic-like-button-renderer[like-status]` : `LIKE` / `DISLIKE` / `INDIFFERENT`.

## Requêtes (`ytmusic-app.networkManager.fetch`)

- `/browse {browseId: 'FEmusic_liked_playlists'}` puis `{continuation}` : playlists (`musicTwoRowItemRenderer`, `VL…`).
- `/browse {browseId: 'VL…'}` : titres dans `musicPlaylistShelfRenderer` ; suite par `continuationItemRenderer`
  puis `appendContinuationItemsAction`.
- `/search {query}` : renvoie des puces de filtre (`chipCloudChipRenderer.navigationEndpoint.searchEndpoint.params`).
  Non connecté depuis le conteneur, il n’y a pas de puce « Songs », seulement « Videos » : l’agent prend « Songs »
  si elle existe, sinon « Videos ». Résultats : `musicResponsiveListItemRenderer`.
- `/music/get_queue {queueContextParams, queueInsertPosition: 'INSERT_AFTER_CURRENT_VIDEO', videoIds}`.

## File : actions

- Lire un élément : clic sur `ytmusic-play-button-renderer` de l’élément rendu (`ytmusic-player-queue #contents > *`),
  dans le même ordre que `items` — vérifié : passage du 1er au 4e titre.
- Retirer : `queueElement.dispatch({type: 'REMOVE_ITEM', payload: index})`.
- Insérer : `ADD_ITEMS` avec les éléments renvoyés par `/music/get_queue`.
- Navigation : `ytmusic-app.dispatchEvent(new CustomEvent('yt-navigate', {bubbles, composed, detail: {endpoint: {watchEndpoint}}}))`.

## Divers

- `navigator.mediaSession.metadata` : utilisé seulement pour l’album et la pochette de secours, et
  seulement si son titre correspond (il n’est pas lié à un identifiant).
- `ytcfg.get('LOGGED_IN')` : état de connexion.
- Exemple réel : le lecteur donne « Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster) »,
  la file donne « Never Gonna Give You Up » → c’est ce dernier qui est affiché.

## Limites de l’environnement de développement

Depuis le conteneur de développement, le son ne passe pas (flux vidéo inaccessibles) et l’ouverture directe
d’une page `watch` déclenche l’anti-robot de Google ; la navigation interne depuis l’accueil fonctionne.
La lecture réelle, la connexion et les enchaînements se valident sur Windows.
