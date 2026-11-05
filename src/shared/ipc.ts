import type { MiniTheme } from './themes';
import type { PlayerCommand, PlayerProgress, PlayerSnapshot } from './player';

export type Panel = 'none' | 'search' | 'queue' | 'settings';

export interface UiState {
  mini: boolean;
  theme: MiniTheme;
  panel: Panel;
  pinned: boolean;
  seamless: boolean; // mini without title bar
  maximized: boolean;
  online: boolean;
}

export type WindowAction =
  | 'toggle-mini' | 'pin' | 'toggle-title-bar' | 'minimize' | 'maximize' | 'close'
  | 'toggle-search' | 'toggle-queue' | 'toggle-settings' | 'close-panel' | 'reload-music';

/** main -> shell */
export interface ShellEvents {
  'player:snapshot': PlayerSnapshot;
  'player:progress': PlayerProgress;
  'ui:state': UiState;
  'ui:notice': string;
}

/** The API exposed to the shell renderer as window.player. */
export interface ShellApi {
  command(command: PlayerCommand): void;
  window(action: WindowAction): void;
  setTheme(theme: MiniTheme): Promise<UiState>;
  drag(phase: 'start' | 'move' | 'end' | 'cancel'): void;
  nudge(dx: number, dy: number): void;
  on<K extends keyof ShellEvents>(channel: K, listener: (value: ShellEvents[K]) => void): () => void;
}

export const SHELL_EVENT_CHANNELS: readonly (keyof ShellEvents)[] = ['player:snapshot', 'player:progress', 'ui:state', 'ui:notice'];
