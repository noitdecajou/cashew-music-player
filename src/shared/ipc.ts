import type { MiniTheme } from './themes';
import type { PlayerCommand, PlayerProgress, PlayerSnapshot, QueueState } from './player';

export type Panel = 'none' | 'search' | 'queue' | 'settings';

export interface UiState {
  mini: boolean;
  theme: MiniTheme;
  panel: Panel;
  pinned: boolean;
  seamless: boolean; // mini without title bar
  maximized: boolean;
  online: boolean;
  videoFullscreen: boolean;
  /** YouTube Music is loading: large mode shows the splash instead of a blank view. */
  musicLoading: boolean;
}

export type WindowAction =
  | 'toggle-mini'
  | 'pin'
  | 'toggle-title-bar'
  | 'minimize'
  | 'maximize'
  | 'close'
  | 'toggle-search'
  | 'toggle-queue'
  | 'toggle-settings'
  | 'close-panel'
  | 'reload-music'
  | 'repair-display';

export interface LibraryStatus {
  state: 'idle' | 'indexing' | 'ready' | 'error';
  playlists: number;
  songs: number;
  done: number; // playlists indexed in the current run
  total: number;
  updatedAt: number;
  error: string;
}

export interface SongResult {
  videoId: string;
  title: string;
  artist: string;
  artwork: string;
  detail: string;
}
export interface PlaylistResult {
  id: string;
  title: string;
  subtitle: string;
  artwork: string;
  favorite: boolean;
}
export type SearchScope = 'library' | 'playlists' | 'web';
export interface SearchResponse {
  songs: SongResult[];
  playlists: PlaylistResult[];
  status: LibraryStatus;
}

export interface ResumeState {
  available: boolean;
  busy: boolean;
  error: string;
  title: string;
  artist: string;
  artwork: string;
  position: number;
}

export interface Settings {
  version: string;
  startup: { supported: boolean; enabled: boolean; blocked: boolean };
  quietStartup: boolean;
  shortcut: string;
  shortcutError: string;
}
export type SettingsPatch = Partial<{ startup: boolean; quietStartup: boolean; shortcut: string }>;

export interface Diagnostics {
  version: string;
  electron: string;
  memoryMB: number;
  cpu: number;
  processes: number;
  userData: string;
}

export interface UpdateState {
  status: 'unsupported' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';
  current: string;
  version: string; // available / downloaded version
  percent: number;
  error: string;
}

export type QueueAction =
  { action: 'play' | 'remove'; index: number; videoId: string } | { action: 'insert-next'; videoId: string };

/** main -> renderer pages */
export interface ShellEvents {
  'player:snapshot': PlayerSnapshot;
  'player:progress': PlayerProgress;
  'ui:state': UiState;
  'ui:notice': string;
  'library:status': LibraryStatus;
  'queue:state': QueueState;
  'resume:state': ResumeState;
  'update:state': UpdateState;
}

/** The API exposed to our renderer pages as window.player. */
export interface ShellApi {
  command(command: PlayerCommand): void;
  window(action: WindowAction): void;
  setTheme(theme: MiniTheme): Promise<UiState>;
  drag(phase: 'start' | 'move' | 'end' | 'cancel'): void;
  nudge(dx: number, dy: number): void;
  search(query: string, scope: SearchScope): Promise<SearchResponse>;
  refreshLibrary(): Promise<LibraryStatus>;
  favorite(playlistId: string, favorite: boolean): Promise<void>;
  play(target: { videoId?: string; playlistId?: string }): Promise<void>;
  queue(action: QueueAction): Promise<void>;
  resume(): Promise<void>;
  settings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  captureShortcut(capturing: boolean): void;
  network(online: boolean): void;
  diagnostics(): Promise<Diagnostics>;
  update(action: 'check' | 'download' | 'install'): Promise<UpdateState>;
  on<K extends keyof ShellEvents>(channel: K, listener: (value: ShellEvents[K]) => void): () => void;
}

export const SHELL_EVENT_CHANNELS: readonly (keyof ShellEvents)[] = [
  'player:snapshot',
  'player:progress',
  'ui:state',
  'ui:notice',
  'library:status',
  'queue:state',
  'resume:state',
  'update:state',
];

/** Errors thrown in main arrive prefixed by Electron: keep only our message. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
