import { join } from 'node:path';
import { Menu, Tray, nativeImage } from 'electron';
import type { UpdateState } from '../shared/ipc';

export interface TrayActions {
  open(): void;
  toggleMini(): void;
  command(type: 'toggle-play' | 'next' | 'previous'): void;
  quit(): void;
  update(): void;
}

export interface AppTray { setUpdate(state: UpdateState): void; destroy(): void; isDestroyed(): boolean }

export function createTray(actions: TrayActions): AppTray {
  const icon = join(__dirname, '../../resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip('Music Player');
  let update: UpdateState | null = null;
  const build = (): void => tray.setContextMenu(Menu.buildFromTemplate([
    ...(update && ['available', 'downloading', 'ready'].includes(update.status)
      ? [{ label: update.status === 'ready' ? `Redémarrer pour installer ${update.version}` : `Mise à jour ${update.version} disponible…`, click: actions.update }, { type: 'separator' as const }]
      : []),
    { label: 'Ouvrir Music Player', click: actions.open },
    { label: 'Mini-player / Grand lecteur', click: actions.toggleMini },
    { type: 'separator' },
    { label: 'Lecture / Pause', click: () => actions.command('toggle-play') },
    { label: 'Suivant', click: () => actions.command('next') },
    { label: 'Précédent', click: () => actions.command('previous') },
    { type: 'separator' },
    { label: 'Quitter', click: actions.quit },
  ]));
  build();
  tray.on('click', actions.open);
  return {
    setUpdate: state => {
      const changed = state.status !== update?.status || state.version !== update?.version;
      update = state;
      if (changed && !tray.isDestroyed()) build();
    },
    destroy: () => tray.destroy(),
    isDestroyed: () => tray.isDestroyed(),
  };
}
