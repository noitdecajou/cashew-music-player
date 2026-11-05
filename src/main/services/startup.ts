import { app } from 'electron';

/** "Start with Windows" for the packaged app. The portable exe keeps its own path. */
function target(): { path: string; args: string[] } | null {
  if (process.platform !== 'win32' || !app.isPackaged) return null;
  return { path: process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe'), args: ['--startup'] };
}

export function startupState(): { supported: boolean; enabled: boolean; blocked: boolean } {
  const t = target();
  if (!t) return { supported: false, enabled: false, blocked: false };
  const settings = app.getLoginItemSettings(t);
  return { supported: true, enabled: settings.openAtLogin, blocked: settings.openAtLogin && settings.executableWillLaunchAtLogin === false };
}

export function setStartup(enabled: boolean): void {
  const t = target();
  if (!t) throw new Error('Disponible dans la version installée ou portable (.exe).');
  app.setLoginItemSettings({ ...t, openAtLogin: enabled });
}
