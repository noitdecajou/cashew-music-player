import type { GameAnswer, GamePrompt, IslandEvent, IslandPrefs, IslandView, LyricsState } from './island';
import type { MiniTheme } from './themes';
import type { PlayerCommand, PlayerProgress, PlayerSnapshot, QueueState } from './player';

export type Panel = 'none' | 'search' | 'queue';

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

export type SettingsSection = 'general' | 'player' | 'island' | 'games' | 'updates' | 'about';

export interface DetectedApp {
  exe: string;
  title: string;
}

export interface Settings {
  version: string;
  startup: { supported: boolean; enabled: boolean; blocked: boolean };
  quietStartup: boolean;
  shortcut: string;
  shortcutError: string;
  island: IslandPrefs;
  islandShortcutError: string;
  /** Display names, primary first (the island's display is an index in this list). */
  displays: string[];
  /** Game detection works on this system (Windows). */
  gamesSupported: boolean;
  /** Fullscreen applications seen recently, to add them as games. */
  recentApps: DetectedApp[];
  /** Diagnostics: last application seen in front, last detection error. */
  foreground: { app: (DetectedApp & { fullscreen: boolean; game: boolean }) | null; error: string; knownGames: number };
}
export type SettingsPatch = Partial<{
  startup: boolean;
  quietStartup: boolean;
  shortcut: string;
  island: Partial<IslandPrefs>;
}>;

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
  'lyrics:state': LyricsState;
  'island:view': IslandView;
  'settings:section': SettingsSection;
  /** Island page: show the details for this many milliseconds. */
  'island:peek': number;
  'island:prompt': GamePrompt | null;
  /** Island page: the cursor entered or left the pill (watched by main). */
  'island:hover': boolean;
  'island:event': IslandEvent;
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
  /** Settings window: pick a game executable to add to the list. */
  chooseGame(): Promise<Settings>;
  /** Island page: the pointer entered or left the pill. */
  islandHover(hover: boolean): void;
  /** Island page: answer to "add this game to the list?". */
  islandAnswer(answer: GameAnswer): void;
  /** Island page: where the pill is (CSS pixels, window coordinates). */
  islandPill(rect: { x: number; y: number; width: number; height: number }): void;
  /** Island page: show the player window. */
  islandOpenPlayer(): void;
  /** Island page: move this track's lyrics by `delta` seconds. */
  islandLyricsOffset(delta: number): void;
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
  'lyrics:state',
  'island:view',
  'settings:section',
  'island:peek',
  'island:prompt',
  'island:hover',
  'island:event',
];

/** Errors thrown in main arrive prefixed by Electron: keep only our message. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
