import { globalShortcut } from 'electron';

/** Accepts Ctrl/Alt/Super (+ optional Shift) with a letter, digit, F-key or Space. */
export function normalizeShortcut(value: unknown): string | null {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 80) return null;
  const parts = value.split('+');
  const key = parts.pop() ?? '';
  const modifiers = ['Ctrl', 'Alt', 'Shift', 'Super'];
  if (!parts.length || new Set(parts).size !== parts.length || !parts.every(p => modifiers.includes(p))) return null;
  if (!parts.some(p => p !== 'Shift')) return null;
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)$/.test(key)) return null;
  return [...modifiers.filter(m => parts.includes(m)), key].join('+');
}

export class GlobalShortcut {
  private active = '';
  constructor(private readonly callback: () => void) {}

  get current(): string {
    return this.active;
  }

  /** Returns an error message, or '' on success. Keeps the previous one on failure. */
  set(value: string): string {
    const next = normalizeShortcut(value);
    if (next === null) return 'Choisis Ctrl, Alt ou Windows avec une lettre, un chiffre, une touche F ou Espace.';
    if (next === this.active) return '';
    if (next) {
      let registered = false;
      try {
        registered = globalShortcut.register(next, this.callback);
      } catch {
        registered = false;
      }
      if (!registered) return 'Ce raccourci est déjà utilisé par une autre application.';
    }
    if (this.active) globalShortcut.unregister(this.active);
    this.active = next;
    return '';
  }

  /** While the user types a new shortcut in the settings, ours must not fire. */
  suspend(suspended: boolean): void {
    if (!this.active) return;
    if (suspended) globalShortcut.unregister(this.active);
    else if (!globalShortcut.isRegistered(this.active)) {
      try {
        globalShortcut.register(this.active, this.callback);
      } catch {
        /* taken meanwhile */
      }
    }
  }

  dispose(): void {
    if (this.active) globalShortcut.unregister(this.active);
    this.active = '';
  }
}
