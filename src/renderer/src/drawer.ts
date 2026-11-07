import {
  type LibraryStatus,
  type Panel,
  type PlaylistResult,
  type SearchScope,
  type SongResult,
  errorMessage,
} from '../../shared/ipc';
import type { QueueState } from '../../shared/player';
import { $, $$, coverImage, el, setText } from './dom';

const TITLES: Record<Panel, string> = { none: '', search: 'Rechercher', queue: 'File d’attente' };

/** The drawer page: a separate native view stacked over YouTube Music. */
export function startDrawer(): void {
  const api = window.player;
  const panel = $('#panel');
  document.body.classList.add('drawer-view');
  panel.hidden = false;
  $('[data-window="close-panel"]', panel).addEventListener('click', () => api.window('close-panel'));
  for (const button of $$('[data-window]', panel)) {
    if (button.dataset.window !== 'close-panel')
      button.addEventListener('click', () => api.window(button.dataset.window as 'reload-music'));
  }

  const noticeBox = $('.panel-notice', panel);
  let noticeTimer = 0;
  const notice = (message: string): void => {
    setText(noticeBox, message);
    noticeBox.hidden = !message;
    window.clearTimeout(noticeTimer);
    if (message)
      noticeTimer = window.setTimeout(() => {
        noticeBox.hidden = true;
      }, 5000);
  };

  let current: Panel = 'none';
  const search = setupSearch(notice);
  const queue = setupQueue(notice);

  api.on('ui:state', state => {
    document.body.classList.remove('booting');
    document.body.classList.toggle('mini', state.mini);
    document.body.classList.toggle('large', !state.mini);
    if (state.panel === current) return;
    current = state.panel;
    setText($('.panel-title', panel), TITLES[state.panel]);
    for (const section of $$('section[data-panel]', panel)) section.hidden = section.dataset.panel !== state.panel;
    notice('');
    if (state.panel === 'search') search.open();
    queue.setOpen(state.panel === 'queue');
  });
  api.on('ui:notice', notice);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      api.window('close-panel');
    } else if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      api.window('toggle-search');
    }
  });
}

// ------------------------------------------------------------------ search --
function setupSearch(notice: (message: string) => void): { open(): void } {
  const api = window.player;
  const input = $<HTMLInputElement>('#query');
  const list = $('section[data-panel="search"] .results');
  const statusText = $('.library-status');
  let scope: SearchScope = 'library';
  let revision = 0;
  let timer = 0;
  let status: LibraryStatus | null = null;
  const placeholders: Record<SearchScope, string> = {
    library: 'Titre ou artiste dans mes playlists…',
    playlists: 'Filtrer mes playlists…',
    web: 'Rechercher dans YouTube Music…',
  };

  function renderStatus(): void {
    const s = status;
    let text = '';
    if (scope === 'web') text = 'Recherche dans tout YouTube Music · 50 résultats maximum';
    else if (!s || s.state === 'idle') text = 'Connecte-toi à YouTube Music pour indexer tes playlists.';
    else if (s.state === 'indexing') text = `Indexation… ${s.done}/${s.total || '?'} playlists · ${s.songs} titres`;
    else if (s.state === 'error') text = `Index indisponible : ${s.error}`;
    else text = `${s.playlists} playlists · ${s.songs} titres${s.error ? ` · ${s.error}` : ''}`;
    setText(statusText, text);
    $<HTMLButtonElement>('.refresh-library').hidden = scope === 'web';
    $<HTMLButtonElement>('.refresh-library').disabled = s?.state === 'indexing';
  }

  async function run(): Promise<void> {
    const mine = ++revision;
    const query = input.value;
    if (scope === 'web' && !query.trim()) {
      list.replaceChildren(empty('Tape un titre, un artiste ou un album.'));
      return;
    }
    if (scope === 'web') list.replaceChildren(empty('Recherche…'));
    try {
      const response = await api.search(query, scope);
      if (mine !== revision) return;
      status = response.status;
      renderStatus();
      if (scope === 'playlists') renderPlaylists(response.playlists);
      else renderSongs(response.songs, query);
    } catch (error) {
      if (mine === revision) list.replaceChildren(empty(errorMessage(error)));
    }
  }

  function empty(text: string): HTMLElement {
    return el('li', { className: 'empty' }, text);
  }

  function renderSongs(songs: SongResult[], query: string): void {
    if (!songs.length) {
      list.replaceChildren(
        empty(
          query.trim()
            ? 'Aucun résultat.'
            : scope === 'library'
              ? 'Cherche un titre ou un artiste parmi tes playlists.'
              : '',
        ),
      );
      return;
    }
    list.replaceChildren(
      ...songs.map(song => {
        const play = el(
          'button',
          { className: 'icon', title: 'Lire maintenant', ariaLabel: `Lire ${song.title}` },
          '▶',
        );
        const next = el('button', { className: 'pill', title: 'Lire après le morceau en cours' }, '+ Ensuite');
        play.addEventListener('click', () => act(play, () => api.play({ videoId: song.videoId }), 'Lecture lancée.'));
        next.addEventListener('click', () =>
          act(next, () => api.queue({ action: 'insert-next', videoId: song.videoId }), `À suivre : ${song.title}`),
        );
        return el(
          'li',
          { className: 'row' },
          coverImage(song.artwork),
          el(
            'div',
            { className: 'meta' },
            el('div', { className: 'title truncate', title: song.title }, song.title),
            el(
              'div',
              { className: 'sub truncate', title: song.detail ? `${song.artist} · ${song.detail}` : song.artist },
              song.artist,
            ),
          ),
          play,
          next,
        );
      }),
    );
  }

  function renderPlaylists(playlists: PlaylistResult[]): void {
    if (!playlists.length) {
      list.replaceChildren(
        empty(status?.state === 'indexing' ? 'Les playlists apparaissent pendant l’indexation…' : 'Aucune playlist.'),
      );
      return;
    }
    list.replaceChildren(
      ...playlists.map(playlist => {
        const play = el(
          'button',
          { className: 'icon', title: 'Lire la playlist', ariaLabel: `Lire ${playlist.title}` },
          '▶',
        );
        const star = el(
          'button',
          { className: 'icon star', title: playlist.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris' },
          playlist.favorite ? '★' : '☆',
        );
        star.setAttribute('aria-pressed', String(playlist.favorite));
        play.addEventListener('click', () =>
          act(play, () => api.play({ playlistId: playlist.id }), `Playlist lancée : ${playlist.title}`),
        );
        star.addEventListener('click', () =>
          act(star, async () => {
            await api.favorite(playlist.id, !playlist.favorite);
            await run();
          }),
        );
        return el(
          'li',
          { className: 'row' },
          coverImage(playlist.artwork),
          el(
            'div',
            { className: 'meta' },
            el('div', { className: 'title truncate', title: playlist.title }, playlist.title),
            el('div', { className: 'sub truncate' }, playlist.subtitle),
          ),
          star,
          play,
        );
      }),
    );
  }

  async function act(button: HTMLButtonElement, task: () => Promise<unknown>, success = ''): Promise<void> {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await task();
      if (success) notice(success);
    } catch (error) {
      notice(errorMessage(error));
    } finally {
      button.disabled = false;
    }
  }

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), scope === 'web' ? 400 : 120);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      window.clearTimeout(timer);
      void run();
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      list.querySelector<HTMLButtonElement>('button')?.focus();
    }
  });
  for (const tab of $$('[data-scope]')) {
    tab.addEventListener('click', () => {
      scope = tab.dataset.scope as SearchScope;
      for (const other of $$('[data-scope]')) other.setAttribute('aria-selected', String(other === tab));
      input.placeholder = placeholders[scope];
      renderStatus();
      void run();
      input.focus();
    });
  }
  $('.refresh-library').addEventListener('click', async () => {
    try {
      status = await window.player.refreshLibrary();
      renderStatus();
    } catch (error) {
      notice(errorMessage(error));
    }
  });
  window.player.on('library:status', value => {
    status = value;
    renderStatus();
    if (scope !== 'web' && !$('section[data-panel="search"]').hidden) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(), 300);
    }
  });
  input.placeholder = placeholders[scope];

  return {
    open: () => {
      input.focus();
      input.select();
      renderStatus();
      void run();
    },
  };
}

// ------------------------------------------------------------------- queue --
function setupQueue(notice: (message: string) => void): { setOpen(open: boolean): void } {
  const api = window.player;
  const list = $('.queue-list');
  const status = $('.queue-status');
  let open = false;
  let state: QueueState = { items: [], current: -1 };
  let scrolledFor = '';

  function render(): void {
    if (!state.items.length) {
      setText(status, 'La file est vide. Lance un morceau ou une playlist.');
      list.replaceChildren();
      return;
    }
    setText(status, `${state.items.length} morceaux · clic pour lire, ✕ pour retirer`);
    list.replaceChildren(
      ...state.items.map((item, index) => {
        const isCurrent = index === state.current;
        const row = el('li', {
          className: `row queue-row${isCurrent ? ' current' : ''}${index < state.current ? ' played' : ''}`,
        });
        const play = el(
          'button',
          { className: 'meta as-button', title: isCurrent ? 'En cours' : `Lire ${item.title}` },
          el('div', { className: 'title truncate' }, item.title),
          el('div', { className: 'sub truncate' }, item.artist),
        );
        if (isCurrent) play.setAttribute('aria-current', 'true');
        play.addEventListener('click', () => {
          if (!isCurrent) void run(play, () => api.queue({ action: 'play', index, videoId: item.videoId }));
        });
        row.append(coverImage(item.artwork), play, el('span', { className: 'duration' }, item.duration));
        if (!isCurrent) {
          const remove = el(
            'button',
            { className: 'icon remove', title: 'Retirer de la file', ariaLabel: `Retirer ${item.title}` },
            '✕',
          );
          remove.addEventListener(
            'click',
            () => void run(remove, () => api.queue({ action: 'remove', index, videoId: item.videoId })),
          );
          row.append(remove);
        } else row.append(el('span', { className: 'icon now', ariaHidden: 'true' }, '♪'));
        return row;
      }),
    );
    const key = `${state.items[state.current]?.videoId ?? ''}:${state.current}`;
    if (key !== scrolledFor) {
      scrolledFor = key;
      list.children[Math.max(0, state.current - 1)]?.scrollIntoView({ block: 'start' });
    }
  }

  async function run(button: HTMLButtonElement, task: () => Promise<unknown>): Promise<void> {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await task();
    } catch (error) {
      notice(errorMessage(error));
    } finally {
      button.disabled = false;
    }
  }

  api.on('queue:state', value => {
    state = value;
    if (open) render();
  });
  return {
    setOpen: value => {
      open = value;
      scrolledFor = '';
      if (open) render();
    },
  };
}
