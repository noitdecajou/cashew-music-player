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
const shortcut = $<HTMLInputElement>('#shortcut');
const shortcutStatus = $('.shortcut-status');
startup.addEventListener('change', () => void update({ startup: startup.checked }));
quiet.addEventListener('change', () => void update({ quietStartup: quiet.checked }));
$('#resetShortcut').addEventListener('click', () => void update({ shortcut: 'Ctrl+Alt+M' }));
$('#clearShortcut').addEventListener('click', () => void update({ shortcut: '' }));
shortcut.addEventListener('focus', () => {
  api.captureShortcut(true);
  setText(shortcutStatus, 'Appuie sur la nouvelle combinaison…');
});
shortcut.addEventListener('blur', () => {
  api.captureShortcut(false);
  void refresh();
});
window.addEventListener('blur', () => {
  if (document.activeElement === shortcut) shortcut.blur();
});
shortcut.addEventListener('keydown', event => {
  if (event.key === 'Tab') return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    shortcut.blur();
    return;
  }
  if (event.repeat || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const parts = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'];
  void update({ shortcut: [...parts.filter(Boolean), key].join('+') });
});

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
  games: 'L’island s’affiche quand un jeu de la liste (section Jeux) est au premier plan.',
};

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
    const value = String(island[group.dataset.setting as 'mode' | 'position' | 'clock']);
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

  // Games
  setText(
    $('.games-mode-hint'),
    island.mode === 'games'
      ? 'L’island est réglée sur « Seulement en jeu » : elle s’affiche pour les jeux cochés, à la position choisie.'
      : 'Ces réglages servent quand l’island est réglée sur « Seulement en jeu » (section Island).',
  );
  $('.games-unsupported').hidden = settings.gamesSupported;
  const seen = settings.foreground.app;
  setText(
    $('.detected'),
    !settings.gamesSupported
      ? ''
      : seen
        ? `Dernière application au premier plan : ${seen.title || seen.exe}${seen.exe ? ` (${seen.exe})` : ''} · ` +
          (seen.fullscreen ? 'plein écran détecté' : 'pas en plein écran')
        : settings.foreground.error
          ? `Détection en échec : ${settings.foreground.error}`
          : 'Bascule sur ton jeu (Alt+Tab) puis reviens ici : il s’affichera ci-dessous.',
  );
  $<HTMLInputElement>('#autoFullscreen').checked = island.autoFullscreen;
  const list = $('.games');
  list.replaceChildren(
    ...(island.games.length
      ? island.games.map(game => gameRow(game, island.games))
      : [el('li', { className: 'empty hint' }, 'Aucun jeu. Ajoute un jeu, ou un des jeux détectés ci-dessous.')]),
  );
  const recent = $('.recent');
  recent.replaceChildren(
    ...(settings.recentApps.length
      ? settings.recentApps.map(app => {
          const add = el('button', {}, 'Ajouter');
          add.addEventListener('click', () =>
            setGames([
              ...island.games,
              { exe: app.exe, name: app.title || app.exe.replace(/\.exe$/, ''), enabled: true, position: 'center' },
            ]),
          );
          return el(
            'li',
            { className: 'game' },
            el('span', { className: 'name truncate' }, app.title || app.exe),
            el('span', { className: 'exe hint truncate' }, app.exe),
            add,
          );
        })
      : [el('li', { className: 'empty hint' }, 'Rien pour l’instant.')]),
  );
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.activeElement !== shortcut) window.close();
});
window.addEventListener('focus', () => void refresh());
// The Games section follows the detection live.
window.setInterval(() => {
  if (!$('section[data-section="games"]').hidden && document.visibilityState === 'visible') void refresh();
}, 2000);
void refresh();
void current;
