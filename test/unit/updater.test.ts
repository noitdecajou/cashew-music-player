import { describe, expect, it, vi } from 'vitest';
import { type UpdateEngine, Updater, fakeEngine } from '../../src/main/services/updater';
import type { UpdateState } from '../../src/shared/ipc';

function setup(engine: UpdateEngine | null = fakeEngine()) {
  const states: UpdateState[] = [];
  const beforeInstall = vi.fn();
  const updater = new Updater(engine, '2.0.0', s => states.push(s), beforeInstall);
  return { updater, states, beforeInstall, engine };
}

describe('Updater', () => {
  it('is unsupported outside the installed app', async () => {
    const { updater } = setup(null);
    expect(updater.state.status).toBe('unsupported');
    expect((await updater.check()).status).toBe('unsupported');
  });

  it('never downloads by itself; downloads on request, then installs silently', async () => {
    const { updater, states, beforeInstall, engine } = setup();
    expect(engine!.autoDownload).toBe(false);
    expect(engine!.autoInstallOnAppQuit).toBe(true);
    await updater.check();
    expect(updater.state).toMatchObject({ status: 'available', version: '9.9.9' });
    await updater.download();
    expect(states.map(s => s.status)).toEqual(['checking', 'available', 'downloading', 'downloading', 'downloading', 'downloading', 'ready']);
    expect(updater.state.percent).toBe(100);
    updater.install();
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect((globalThis as { __fakeInstalled?: boolean }).__fakeInstalled).toBe(true);
  });

  it('reports errors only when the user asked, with a readable message', async () => {
    const listeners: Record<string, (value?: unknown) => void> = {};
    const failing = {
      autoDownload: true, autoInstallOnAppQuit: false,
      on(event: string, listener: (value?: unknown) => void) { listeners[event] = listener; return this; },
      checkForUpdates: async () => { listeners.error?.(new Error('net::ERR_INTERNET_DISCONNECTED')); },
      downloadUpdate: async () => undefined, quitAndInstall: () => undefined,
    } as unknown as UpdateEngine;
    const { updater } = setup(failing);
    await updater.check(false);
    expect(updater.state).toMatchObject({ status: 'idle', error: '' });
    await updater.check(true);
    expect(updater.state).toMatchObject({ status: 'error', error: 'Impossible de joindre GitHub. Vérifie ta connexion.' });
  });

  it('ignores install and download when not in the right state', async () => {
    const { updater, beforeInstall } = setup();
    updater.install();
    await updater.download();
    expect(beforeInstall).not.toHaveBeenCalled();
    expect(updater.state.status).toBe('idle');
  });
});
