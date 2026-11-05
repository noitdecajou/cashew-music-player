import { join } from 'node:path';
import { Menu, Tray, nativeImage } from 'electron';

export interface TrayActions { open(): void; togglePlay(): void; quit(): void }

export function createTray(actions: TrayActions): Tray {
  const icon = join(__dirname, '../../resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip('Music Player');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Music Player', click: actions.open },
    { label: 'Lecture / Pause', click: actions.togglePlay },
    { type: 'separator' },
    { label: 'Quitter', click: actions.quit },
  ]));
  tray.on('click', actions.open);
  return tray;
}
