import type { UpdateState } from '../../shared/ipc';

/** The subset of electron-updater's autoUpdater we use (injectable for tests). */
export interface UpdateEngine {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown;
  on(event: 'update-available' | 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 15 * 1000;

/**
 * Update flow: check quietly (at start, then every 6 h), tell the user when a
 * version is available, download only when they ask, then restart to install.
 * A downloaded update is also installed when the app quits.
 */
export class Updater {
  private value: UpdateState;
  private timers: NodeJS.Timeout[] = [];
  private manualCheck = false;

  constructor(
    private readonly engine: UpdateEngine | null,
    currentVersion: string,
    private readonly notify: (state: UpdateState) => void,
    private readonly beforeInstall: () => void = () => undefined,
  ) {
    this.value = { status: engine ? 'idle' : 'unsupported', current: currentVersion, version: '', percent: 0, error: '' };
    if (!engine) return;
    engine.autoDownload = false;
    engine.autoInstallOnAppQuit = true;
    engine.on('checking-for-update', () => this.set({ status: 'checking', error: '' }));
    engine.on('update-not-available', () => this.set({ status: 'up-to-date' }));
    engine.on('update-available', info => this.set({ status: 'available', version: info.version }));
    engine.on('download-progress', progress => this.set({ status: 'downloading', percent: Math.round(progress.percent) }));
    engine.on('update-downloaded', info => this.set({ status: 'ready', version: info.version, percent: 100 }));
    engine.on('error', error => {
      // A failed background check stays silent; failures the user asked for are shown.
      const shown = this.manualCheck || this.value.status === 'downloading';
      this.set({ status: shown ? 'error' : this.value.version ? 'available' : 'idle', error: shown ? friendly(error) : '' });
    });
  }

  get state(): UpdateState { return this.value; }

  private set(patch: Partial<UpdateState>): void {
    this.value = { ...this.value, ...patch };
    this.notify(this.value);
  }

  start(): void {
    if (!this.engine) return;
    this.timers.push(setTimeout(() => void this.check(false), FIRST_CHECK_AFTER_MS));
    this.timers.push(setInterval(() => void this.check(false), CHECK_EVERY_MS));
  }

  async check(manual = true): Promise<UpdateState> {
    if (!this.engine || ['checking', 'downloading', 'ready'].includes(this.value.status)) return this.value;
    this.manualCheck = manual;
    try { await this.engine.checkForUpdates(); } catch { /* reported through 'error' */ }
    return this.value;
  }

  async download(): Promise<UpdateState> {
    if (!this.engine || this.value.status !== 'available') return this.value;
    this.set({ status: 'downloading', percent: 0, error: '' });
    try { await this.engine.downloadUpdate(); } catch { /* reported through 'error' */ }
    return this.value;
  }

  install(): void {
    if (!this.engine || this.value.status !== 'ready') return;
    this.beforeInstall();
    // Silent install, then relaunch: no wizard for an update.
    this.engine.quitAndInstall(true, true);
  }

  dispose(): void { for (const timer of this.timers) clearTimeout(timer); this.timers = []; }
}

function friendly(error: Error): string {
  const message = error.message || String(error);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|network/i.test(message)) return 'Impossible de joindre GitHub. Vérifie ta connexion.';
  if (/404|Cannot find latest|No published versions/i.test(message)) return 'Aucune version publiée trouvée sur GitHub.';
  if (/sha512|checksum/i.test(message)) return 'Le téléchargement est corrompu. Réessaie.';
  return 'La mise à jour a échoué. Réessaie plus tard.';
}

/** Test-only engine: pretends that version 9.9.9 is available and downloads it. */
export function fakeEngine(): UpdateEngine {
  const listeners = new Map<string, ((value?: unknown) => void)[]>();
  const emit = (event: string, value?: unknown): void => { for (const listener of listeners.get(event) ?? []) listener(value); };
  return {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on(event: string, listener: (value?: never) => void) { listeners.set(event, [...(listeners.get(event) ?? []), listener as (value?: unknown) => void]); return this; },
    async checkForUpdates() { emit('checking-for-update'); await new Promise(r => setTimeout(r, 50)); emit('update-available', { version: '9.9.9' }); },
    async downloadUpdate() {
      for (const percent of [25, 50, 100]) { await new Promise(r => setTimeout(r, 50)); emit('download-progress', { percent }); }
      emit('update-downloaded', { version: '9.9.9' });
    },
    quitAndInstall() { (globalThis as { __fakeInstalled?: boolean }).__fakeInstalled = true; },
  } as UpdateEngine;
}
