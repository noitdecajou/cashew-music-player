// Which pages the YouTube Music view may show. Pure (no Electron) so it is unit-tested.

export const YTM_ORIGIN = 'https://music.youtube.com';

const ALLOWED_HOSTS = new Set([
  'music.youtube.com', 'accounts.google.com', 'accounts.youtube.com',
  'consent.youtube.com', 'consent.google.com', 'www.youtube.com',
]);

/**
 * Google's sign-in host on its country domains (accounts.google.fr, .co.uk, .com.br...).
 * Anchored to one or two short labels: accounts.google.attacker.example must not pass.
 */
const GOOGLE_ACCOUNTS = /^accounts\.google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

export function isAllowedNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && (ALLOWED_HOSTS.has(url.hostname) || GOOGLE_ACCOUNTS.test(url.hostname));
  } catch {
    return false;
  }
}

/** True for a document of music.youtube.com itself (not Google pages, not frames from elsewhere). */
export function isYtmUrl(value: string | undefined): boolean {
  if (!value) return false;
  try { return new URL(value).origin === YTM_ORIGIN; } catch { return false; }
}

/** Permissions the music page may use: playback needs nothing else (no camera, no microphone). */
export const YTM_PERMISSIONS: readonly string[] = ['fullscreen', 'clipboard-sanitized-write'];
