import { describe, expect, it } from 'vitest';
import { isAllowedNavigation, isYtmUrl } from '../../src/main/ytm/navigation';

describe('YouTube Music view navigation', () => {
  it('allows YouTube Music and Google sign-in pages', () => {
    for (const url of [
      'https://music.youtube.com/watch?v=x', 'https://accounts.google.com/signin', 'https://accounts.google.fr/x',
      'https://accounts.google.co.uk/x', 'https://accounts.google.com.br/x', 'https://consent.youtube.com/m',
    ]) expect(isAllowedNavigation(url), url).toBe(true);
  });

  it('refuses lookalike domains, other schemes and credentials in the URL (security audit)', () => {
    for (const url of [
      'https://accounts.google.attacker.example/signin', 'https://accounts.google.com.evil.example/w',
      'https://accounts.google.evil/x', 'https://evil.example/', 'http://music.youtube.com/',
      'https://user:pass@music.youtube.com/', 'javascript:alert(1)', 'file:///C:/x', 'not a url',
    ]) expect(isAllowedNavigation(url), url).toBe(false);
  });

  it('only music.youtube.com itself is the music page', () => {
    expect(isYtmUrl('https://music.youtube.com/watch?v=x')).toBe(true);
    expect(isYtmUrl('https://music.youtube.com')).toBe(true);
    expect(isYtmUrl('https://accounts.google.com/')).toBe(false);
    expect(isYtmUrl('https://music.youtube.com.evil.example/')).toBe(false);
    expect(isYtmUrl(undefined)).toBe(false);
  });
});
