import type { Panel } from '../../shared/ipc';

const TITLES: Record<Panel, string> = { none: '', search: 'Recherche', queue: 'File d’attente', settings: 'Réglages' };

/** The drawer page: a separate native view stacked over YouTube Music. */
export function startDrawer(): void {
  const api = window.player;
  const panel = document.getElementById('panel') as HTMLElement;
  const title = panel.querySelector('.panel-title') as HTMLElement;
  document.body.classList.add('drawer-view');
  panel.hidden = false;
  panel.querySelector('[data-window="close-panel"]')?.addEventListener('click', () => api.window('close-panel'));
  api.on('ui:state', state => {
    document.body.classList.remove('booting');
    document.body.classList.toggle('mini', state.mini);
    document.body.classList.toggle('large', !state.mini);
    document.body.dataset.panel = state.panel;
    title.textContent = TITLES[state.panel];
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') api.window('close-panel');
    else if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); api.window('toggle-search'); }
  });
}
