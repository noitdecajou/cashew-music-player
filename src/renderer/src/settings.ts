// The settings window: sections in a sidebar on the left.

import {
  type Settings,
  type SettingsPatch,
  type SettingsSection,
  type UpdateState,
  errorMessage,
} from '../../shared/ipc';
import type { GameRule, IslandPosition, IslandPrefs } from '../../shared/island';
import { MINI_THEMES, type MiniTheme } from '../../shared/themes';
import { installGlyphSymbols } from './brand';
import { $, $$, el, setText } from './dom';
import type { ShellApi } from '../../shared/ipc';

declare global {
  interface Window {
    player: ShellApi;
  }
}

const api = window.player;
installGlyphSymbols($('#sprite'));

// --- Notice ------------------------------------------------------------------
const noticeBox = $('.notice');
let noticeTimer = 0;
function notice(message: string): void {
  setText(noticeBox, message);
  noticeBox.hidden = !message;
  window.clearTimeout(noticeTimer);
  if (message)
    noticeTimer = window.setTimeout(() => {
      noticeBox.hidden = true;
    }, 6000);
}

// --- Sections ------------------------------------------------------------------
const SECTIONS: SettingsSection[] = ['general', 'player', 'island', 'games', 'updates', 'about'];
function showSection(section: SettingsSection): void {
  for (const button of $$('.sidebar [data-section]')) {
    if (button.dataset.section === section) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const panel of $$('main section[data-section]')) panel.hidden = panel.dataset.section !== section;
  $('.content').scrollTop = 0;
  if (section === 'games') void refresh();
}
for (const button of $$('.sidebar [data-section]'))
  button.addEventListener('click', () => showSection(button.dataset.section as SettingsSection));
api.on('settings:section', section => {
  if (SECTIONS.includes(section)) showSection(section);
});

// --- Settings state ------------------------------------------------------------
let current: Settings | null = null;

async function update(patch: SettingsPatch): Promise<void> {
  try {
    render(await api.updateSettings(patch));
  } catch (error) {
    notice(errorMessage(error));
    render(await api.settings());
  }
}
const updateIsland = (island: Partial<IslandPrefs>): Promise<void> => update({ island });
async function refresh(): Promise<void> {
  try {
    render(await api.settings());
  } catch (error) {
    notice(errorMessage(error));
  }
}

// General
const startup = $<HTMLInputElement>('#startup');
const quiet = $<HTMLInputElement>('#quietStartup');
startup.addEventListener('change', () => void update({ startup: startup.checked }));
quiet.addEventListener('change', () => void update({ quietStartup: quiet.checked }));

/** A field that captures a key combination (global shortcuts are suspended meanwhile). */
function shortcutField(input: HTMLInputElement, status: HTMLElement, save: (value: string) => void): void {
  input.addEventListener('focus', () => {
    api.captureShortcut(true);
    setText(status, 'Appuie sur la nouvelle combinaison…');
  });
  input.addEventListener('blur', () => {
    api.captureShortcut(false);
    void refresh();
  });
  window.addEventListener('blur', () => {
    if (document.activeElement === input) input.blur();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      input.blur();
      return;
    }
    if (event.repeat || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
    const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
    const parts = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'];
    save([...parts.filter(Boolean), key].join('+'));
  });
}
const shortcut = $<HTMLInputElement>('#shortcut');
const shortcutStatus = $('.shortcut-status');
shortcutField(shortcut, shortcutStatus, value => void update({ shortcut: value }));
$('#resetShortcut').addEventListener('click', () => void update({ shortcut: 'Ctrl+Alt+M' }));
$('#clearShortcut').addEventListener('click', () => void update({ shortcut: '' }));
const islandShortcut = $<HTMLInputElement>('#islandShortcut');
const islandShortcutStatus = $('.island-shortcut-status');
shortcutField(islandShortcut, islandShortcutStatus, value => void updateIsland({ shortcut: value }));
$('#resetIslandShortcut').addEventListener('click', () => void updateIsland({ shortcut: 'Ctrl+Alt+I' }));
$('#clearIslandShortcut').addEventListener('click', () => void updateIsland({ shortcut: '' }));
const opacity = $<HTMLInputElement>('#islandOpacity');
opacity.addEventListener('input', () => setText($('.range-value'), `${opacity.value} %`));
opacity.addEventListener('change', () => void updateIsland({ opacity: Number(opacity.value) }));

// Player: mini-player skins
const grid = $('.theme-grid');
const cards = (Object.keys(MINI_THEMES) as MiniTheme[]).map(theme => {
  const info = MINI_THEMES[theme];
  const card = el(
    'button',
    { className: `theme-card theme-${theme}`, role: 'radio' },
    el('span', { className: 'swatch', ariaHidden: 'true' }),
    el('span', { className: 'name' }, info.label),
    el('span', { className: 'size' }, `${info.width} × ${info.height}`),
  );
  card.dataset.theme = theme;
  card.addEventListener('click', () => {
    void api.setTheme(theme).catch(error => notice(errorMessage(error)));
  });
  grid.append(card);
  return card;
});
$<HTMLInputElement>('#seamless').addEventListener('change', () => api.window('toggle-title-bar'));
api.on('ui:state', state => {
  document.body.classList.remove('booting');
  for (const card of cards) card.setAttribute('aria-checked', String(card.dataset.theme === state.theme));
  $<HTMLInputElement>('#seamless').checked = state.seamless;
});

// Island: segmented choices
for (const group of $$('.segmented[data-setting]')) {
  for (const button of $$<HTMLButtonElement>('button', group)) {
    button.setAttribute('role', 'radio');
    button.addEventListener(
      'click',
      () => void updateIsland({ [group.dataset.setting as 'mode']: button.dataset.value } as Partial<IslandPrefs>),
    );
  }
}
const displaySelect = $<HTMLSelectElement>('#islandDisplay');
displaySelect.addEventListener('change', () => void updateIsland({ display: Number(displaySelect.value) }));
$<HTMLInputElement>('#islandLyrics').addEventListener(
  'change',
  event => void updateIsland({ lyrics: (event.target as HTMLInputElement).checked }),
);
$<HTMLInputElement>('#islandEvents').addEventListener(
  'change',
  event => void updateIsland({ events: (event.target as HTMLInputElement).checked }),
);
$<HTMLSelectElement>('#islandIdle').addEventListener(
  'change',
  event => void updateIsland({ idleMinutes: Number((event.target as HTMLSelectElement).value) }),
);
$<HTMLInputElement>('#islandCapture').addEventListener(
  'change',
  event => void updateIsland({ hideFromCapture: (event.target as HTMLInputElement).checked }),
);
// Collapsible lists: their open/closed state is remembered on this computer.
for (const group of $$<HTMLDetailsElement>('details.group')) {
  const key = `cashew.settings.${group.dataset.group}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) group.open = saved === 'open';
  } catch {
    /* storage unavailable: defaults */
  }
  group.addEventListener('toggle', () => {
    try {
      localStorage.setItem(key, group.open ? 'open' : 'closed');
    } catch {
      /* ignore */
    }
  });
}
$<HTMLInputElement>('#autoFullscreen').addEventListener(
  'change',
  event => void updateIsland({ autoFullscreen: (event.target as HTMLInputElement).checked }),
);

// Games
const POSITION_LABELS: Record<IslandPosition, string> = { left: 'Gauche', center: 'Centre', right: 'Droite' };
function setGames(games: GameRule[]): void {
  void updateIsland({ games });
}
function gameRow(game: GameRule, games: GameRule[]): HTMLLIElement {
  const enabled = el('input', { type: 'checkbox', checked: game.enabled, title: 'Afficher l’island dans ce jeu' });
  enabled.setAttribute('aria-label', `Island dans ${game.name}`);
  enabled.addEventListener('change', () =>
    setGames(games.map(g => (g.exe === game.exe ? { ...g, enabled: enabled.checked } : g))),
  );
  const position = el('select', { title: 'Position de l’island dans ce jeu' });
  position.setAttribute('aria-label', `Position dans ${game.name}`);
  for (const value of ['left', 'center', 'right'] as const)
    position.append(el('option', { value, selected: game.position === value }, POSITION_LABELS[value]));
  position.addEventListener('change', () =>
    setGames(games.map(g => (g.exe === game.exe ? { ...g, position: position.value as IslandPosition } : g))),
  );
  const remove = el(
    'button',
    { className: 'icon', title: 'Retirer de la liste', ariaLabel: `Retirer ${game.name}` },
    '✕',
  );
  remove.addEventListener('click', () => setGames(games.filter(g => g.exe !== game.exe)));
  const row = el(
    'li',
    { className: 'game' },
    el('label', { className: 'check' }, enabled, el('span', { className: 'name truncate' }, game.name)),
    el('span', { className: 'exe hint truncate' }, game.exe),
    position,
    remove,
  );
  row.dataset.exe = game.exe;
  return row;
}
$('#addGame').addEventListener('click', async () => {
  try {
    render(await api.chooseGame());
  } catch (error) {
    notice(errorMessage(error));
  }
});

// Updates
const updateStatus = $('.update-status');
const updateButton = $<HTMLButtonElement>('#updateAction');
const updateBar = $('.update-progress');
let updateState: UpdateState | null = null;
function renderUpdate(state: UpdateState): void {
  updateState = state;
  const texts: Record<UpdateState['status'], string> = {
    unsupported: `Version ${state.current}. Les mises à jour automatiques fonctionnent dans la version installée.`,
    idle: `Version ${state.current}.`,
    checking: 'Recherche d’une mise à jour…',
    'up-to-date': `Version ${state.current} : à jour.`,
    available: `La version ${state.version} est disponible (actuelle : ${state.current}).`,
    downloading: `Téléchargement de la version ${state.version}… ${state.percent} %`,
    ready: `La version ${state.version} est prête. Le lecteur redémarre pour l’installer (quelques secondes).`,
    error: state.error,
  };
  setText(updateStatus, texts[state.status]);
  const actions: Partial<Record<UpdateState['status'], string>> = {
    idle: 'Rechercher',
    'up-to-date': 'Rechercher',
    error: 'Réessayer',
    available: 'Télécharger et installer',
    ready: 'Redémarrer et installer',
  };
  const label = actions[state.status];
  updateButton.hidden = !label;
  if (label) setText(updateButton, label);
  updateButton.classList.toggle('primary', state.status === 'available' || state.status === 'ready');
  updateBar.hidden = state.status !== 'downloading';
  $('.fill', updateBar).style.width = `${state.percent}%`;
}
updateButton.addEventListener('click', async () => {
  const action =
    updateState?.status === 'available' ? 'download' : updateState?.status === 'ready' ? 'install' : 'check';
  updateButton.disabled = true;
  try {
    renderUpdate(await api.update(action));
  } catch (error) {
    notice(errorMessage(error));
  } finally {
    updateButton.disabled = false;
  }
});
api.on('update:state', renderUpdate);

// About and troubleshooting
for (const button of $$('[data-window]'))
  button.addEventListener('click', () => api.window(button.dataset.window as 'reload-music'));
$('#diagnostics').addEventListener('click', async () => {
  try {
    const d = await api.diagnostics();
    setText(
      $('.diagnostics-result'),
      `Mémoire : ${d.memoryMB} Mo · CPU : ${d.cpu} % · ${d.processes} processus (Electron ${d.electron})`,
    );
  } catch (error) {
    notice(errorMessage(error));
  }
});

// --- Render ----------------------------------------------------------------------
const MODE_HINTS: Record<IslandPrefs['mode'], string> = {
  off: 'L’island est désactivée.',
  always: 'L’island reste affichée tant qu’un morceau est chargé.',
  track: 'L’island apparaît quelques secondes, en grand, à chaque nouveau morceau.',
  games: 'L’island s’affiche quand un jeu de la liste (section Jeux) est au premier plan.',
};

/** Rebuilds a list only when its content changed (the Games section refreshes every 2 s). */
const listKeys = new WeakMap<Element, string>();
function renderList(list: Element, key: unknown, build: () => Node[]): void {
  const k = JSON.stringify(key);
  if (listKeys.get(list) === k) return;
  listKeys.set(list, k);
  list.replaceChildren(...build());
}

function render(settings: Settings): void {
  current = settings;
  // General
  startup.checked = settings.startup.enabled;
  startup.disabled = !settings.startup.supported;
  startup.parentElement!.title = settings.startup.supported
    ? settings.startup.blocked
      ? 'Désactivé dans Paramètres Windows > Applications > Démarrage'
      : ''
    : 'Disponible dans la version installée (.exe)';
  quiet.checked = settings.quietStartup;
  shortcut.value = settings.shortcut;
  setText(
    shortcutStatus,
    settings.shortcutError || (settings.shortcut ? 'Actif, même depuis une autre application.' : 'Désactivé.'),
  );
  for (const v of $$('.version')) setText(v, `version ${settings.version}`);

  // Island
  const island = settings.island;
  for (const group of $$('.segmented[data-setting]')) {
    const value = String(island[group.dataset.setting as 'mode' | 'position' | 'clock' | 'size' | 'withMini']);
    for (const button of $$('button', group))
      button.setAttribute('aria-checked', String(button.dataset.value === value));
  }
  setText($('.mode-hint'), MODE_HINTS[island.mode]);
  displaySelect.replaceChildren(
    ...settings.displays.map((name, index) =>
      el('option', { value: String(index), selected: index === island.display }, name),
    ),
  );
  if (island.display >= settings.displays.length)
    displaySelect.append(el('option', { value: String(island.display), selected: true }, 'Écran débranché'));
  $<HTMLInputElement>('#islandLyrics').checked = island.lyrics;
  $<HTMLInputElement>('#islandEvents').checked = island.events;
  $<HTMLSelectElement>('#islandIdle').value = String(island.idleMinutes);
  $<HTMLInputElement>('#islandCapture').checked = island.hideFromCapture;
  setText($('details[data-group="games"] .count'), String(island.games.length));
  setText($('details[data-group="recent"] .count'), String(settings.recentApps.length));
  setText($('details[data-group="declined"] .count'), String(island.declined.length));
  if (document.activeElement !== opacity) opacity.value = String(island.opacity);
  setText($('.range-value'), `${island.opacity} %`);
  islandShortcut.value = island.shortcut;
  setText(
    islandShortcutStatus,
    settings.islandShortcutError ||
      (island.shortcut
        ? island.mode === 'off'
          ? 'Inactif tant que l’island est désactivée.'
          : 'Actif, même depuis un jeu ou une autre application.'
        : 'Désactivé.'),
  );

  // Games
  setText(
    $('.games-mode-hint'),
    island.mode === 'games'
      ? 'L’island est réglée sur « Seulement en jeu » : elle s’affiche pour les jeux cochés, à la position choisie.'
      : 'Ces réglages servent quand l’island est réglée sur « Seulement en jeu » (section Island).',
  );
  $('.games-unsupported').hidden = settings.gamesSupported;
  const seen = settings.foreground.app;
  const known = settings.foreground.knownGames;
  setText(
    $('.detected'),
    !settings.gamesSupported
      ? ''
      : (seen
          ? `Dernière application au premier plan : ${seen.title || seen.exe}${seen.exe ? ` (${seen.exe})` : ''} · ` +
            (seen.game ? 'reconnue comme jeu' : 'pas un jeu') +
            (seen.fullscreen ? ', plein écran' : '')
          : settings.foreground.error
            ? `Détection en échec : ${settings.foreground.error}`
            : 'Bascule sur ton jeu (Alt+Tab) puis reviens ici : il s’affichera ci-dessous.') +
          ` · ${known} jeu${known > 1 ? 'x' : ''} connu${known > 1 ? 's' : ''} de Windows`,
  );
  $<HTMLInputElement>('#autoFullscreen').checked = island.autoFullscreen;
  renderList($('.games'), island.games, () =>
    island.games.length
      ? island.games.map(game => gameRow(game, island.games))
      : [el('li', { className: 'empty hint' }, 'Aucun jeu. Ajoute un jeu, ou un des jeux détectés ci-dessous.')],
  );
  renderList($('.recent'), [settings.recentApps, island.games, island.declined], () =>
    settings.recentApps.length
      ? settings.recentApps.map(app => {
          const add = el('button', {}, 'Ajouter');
          add.addEventListener('click', () =>
            setGames([
              ...island.games,
              { exe: app.exe, name: app.title || app.exe.replace(/\.exe$/, ''), enabled: true, position: 'center' },
            ]),
          );
          const decline = el('button', {}, 'Refuser');
          decline.addEventListener('click', () => void updateIsland({ declined: [...island.declined, app.exe] }));
          const row = el(
            'li',
            { className: 'game choice' },
            el('span', { className: 'name truncate' }, app.title || app.exe),
            el('span', { className: 'exe hint truncate' }, app.exe),
            el('span', { className: 'actions' }, add, decline),
          );
          row.dataset.exe = app.exe;
          return row;
        })
      : [el('li', { className: 'empty hint' }, 'Rien pour l’instant.')],
  );
  renderList($('.declined'), [island.declined, island.games], () =>
    island.declined.length
      ? island.declined.map(exe => {
          const add = el('button', {}, 'Ajouter');
          add.addEventListener(
            'click',
            () =>
              void updateIsland({
                declined: island.declined.filter(d => d !== exe),
                games: [...island.games, { exe, name: exe.replace(/\.exe$/, ''), enabled: true, position: 'center' }],
              }),
          );
          const forget = el('button', { title: 'L’island pourra de nouveau proposer ce jeu' }, 'Ne plus refuser');
          forget.addEventListener(
            'click',
            () => void updateIsland({ declined: island.declined.filter(d => d !== exe) }),
          );
          const row = el(
            'li',
            { className: 'game choice' },
            el('span', { className: 'name truncate' }, exe.replace(/\.exe$/, '')),
            el('span', { className: 'exe hint truncate' }, exe),
            el('span', { className: 'actions' }, add, forget),
          );
          row.dataset.exe = exe;
          return row;
        })
      : [el('li', { className: 'empty hint' }, 'Aucun.')],
  );
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !(document.activeElement as HTMLElement | null)?.matches('.shortcut-input, #shortcut'))
    window.close();
});
window.addEventListener('focus', () => void refresh());
// The Games section follows the detection live.
window.setInterval(() => {
  if (!$('section[data-section="games"]').hidden && document.visibilityState === 'visible') void refresh();
}, 2000);
void refresh();
void current;
