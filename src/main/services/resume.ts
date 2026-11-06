import { join } from 'node:path';
import type { ResumeState } from '../../shared/ipc';
import { ACCOUNT_KEY, PLAYLIST_ID, VIDEO_ID, httpsUrl, str } from '../../shared/player';
import { readJson, writeJson } from './json-file';

export interface SavedSession {
  videoId: string;
  playlistId: string;
  position: number;
  title: string;
  artist: string;
  artwork: string;
  savedAt: number;
}

export function parseSession(raw: unknown): SavedSession | null {
  const s = raw as Record<string, unknown> | null;
  if (!s || !VIDEO_ID.test(str(s.videoId))) return null;
  const position =
    typeof s.position === 'number' && Number.isFinite(s.position) ? Math.min(86400, Math.max(0, s.position)) : 0;
  return {
    videoId: str(s.videoId),
    playlistId: PLAYLIST_ID.test(str(s.playlistId)) ? str(s.playlistId) : '',
    position,
    title: str(s.title),
    artist: str(s.artist),
    artwork: httpsUrl(s.artwork),
    savedAt: typeof s.savedAt === 'number' ? s.savedAt : 0,
  };
}

/** Last played track per account, offered on the next start when nothing plays. */
export class ResumeStore {
  constructor(private readonly directory: string) {}
  private file(account: string): string {
    return join(this.directory, 'sessions', `${account}.json`);
  }

  async load(account: string): Promise<SavedSession | null> {
    return ACCOUNT_KEY.test(account) ? parseSession(await readJson(this.file(account))) : null;
  }

  save(account: string, session: SavedSession): Promise<void> {
    return ACCOUNT_KEY.test(account) ? writeJson(this.file(account), session) : Promise.resolve();
  }
}

export function resumeState(session: SavedSession | null, busy: boolean, error: string): ResumeState {
  return session
    ? {
        available: true,
        busy,
        error,
        title: session.title,
        artist: session.artist,
        artwork: session.artwork,
        position: session.position,
      }
    : { available: false, busy: false, error: '', title: '', artist: '', artwork: '', position: 0 };
}
