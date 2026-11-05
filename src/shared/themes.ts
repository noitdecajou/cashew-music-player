export const MINI_THEMES = {
  modern: { label: 'Actuel', width: 420, height: 128 },
  autoradio: { label: 'Autoradio', width: 420, height: 168 },
  hifi: { label: 'Hi-fi', width: 420, height: 168 },
  'autoradio-hf': { label: 'Autoradio 2000 (HF)', width: 720, height: 192 },
  'hifi-hf': { label: 'Hi-Fi de salon (HF)', width: 640, height: 192 },
} as const;

export type MiniTheme = keyof typeof MINI_THEMES;
export const DEFAULT_THEME: MiniTheme = 'modern';
/** Total content height when the search or queue panel is open. */
export const PANEL_HEIGHT = 450;
/** Custom title bar height, hidden in seamless mini mode. */
export const TITLE_BAR_HEIGHT = 30;
/** Height of the large-mode toolbar above the YouTube Music view. */
export const LARGE_TOOLBAR_HEIGHT = 52;

export function isMiniTheme(value: unknown): value is MiniTheme {
  return typeof value === 'string' && Object.hasOwn(MINI_THEMES, value);
}

/** 1.x stored 'retro' for what is now 'autoradio'. */
export function normalizeTheme(value: unknown): MiniTheme {
  if (value === 'retro') return 'autoradio';
  return isMiniTheme(value) ? value : DEFAULT_THEME;
}

export function miniContentSize(theme: MiniTheme, panelOpen: boolean): { width: number; height: number } {
  const { width, height } = MINI_THEMES[theme];
  return { width, height: panelOpen ? PANEL_HEIGHT : height };
}
