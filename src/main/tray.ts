import { join } from 'node:path';
import { Menu, Tray, nativeImage } from 'electron';

export interface TrayActions {
  open(): void;
  toggleMini(): void;
  command(type: 'toggle-play' | 'next' | 'previous'): void;
  quit(): void;
}

export function createTray(actions: TrayActions): Tray {
  const icon = join(__dirname, '../../resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip('Music Player');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Music Player', click: actions.open },
    { label: 'Mini-player / Grand lecteur', click: actions.toggleMini },
    { type: 'separator' },
    { label: 'Lecture / Pause', click: () => actions.command('toggle-play') },
    { label: 'Suivant', click: () => actions.command('next') },
    { label: 'Précédent', click: () => actions.command('previous') },
    { type: 'separator' },
    { label: 'Quitter', click: actions.quit },
  ]));
  tray.on('click', actions.open);
  return tray;
}
