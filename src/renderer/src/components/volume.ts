import type { PlayerCommand, PlayerSnapshot } from '../../../shared/player';
import { Slider } from './slider';

const CLOSE_AFTER_MS = 4000;

export interface VolumeElements {
  host: HTMLElement; // gets .volume-open
  button: HTMLButtonElement; // opens / closes
  mute: HTMLButtonElement; // mute toggle inside the panel
  track: HTMLElement; // slider
  value: HTMLElement; // "42"
}

/**
 * Volume without growing the mini player: the speaker button opens a panel
 * (slider, value, mute) that temporarily covers the "up next" area.
 * The speaker button closes it again, as do Escape, a click elsewhere, and
 * a few seconds without interaction. The wheel over the speaker or the panel
 * changes the volume by 5.
 */
export class VolumeControl {
  private readonly slider: Slider;
  private volume = 100;
  private muted = false;
  private open = false;
  private closeTimer: number | undefined;
  private lastSent = 0;
  private sendTimer: number | undefined;

  constructor(
    private readonly el: VolumeElements,
    private readonly send: (command: PlayerCommand) => void,
  ) {
    this.slider = new Slider({
      element: el.track,
      fill: el.track.querySelector('.fill') as HTMLElement,
      thumb: el.track.querySelector('.thumb') as HTMLElement,
      step: () => 0.05,
      live: true,
      commit: ratio => this.setVolume(Math.round(ratio * 100)),
    });
    const panel = el.track.parentElement as HTMLElement;

    el.button.addEventListener('click', () => {
      if (this.open) this.hide();
      else this.show();
    });
    el.mute.addEventListener('click', () => {
      this.send({ type: 'mute', muted: !this.muted });
      this.armClose();
    });
    for (const element of [el.button, panel]) {
      element.addEventListener(
        'wheel',
        event => {
          event.preventDefault();
          if (!this.open) this.show();
          this.setVolume(this.volume + (event.deltaY < 0 ? 5 : -5));
          this.slider.set(this.volume / 100);
          this.armClose();
        },
        { passive: false },
      );
    }
    panel.addEventListener('pointerdown', () => this.armClose());
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.hide();
        el.button.focus();
      } else this.armClose();
    });
    // A click anywhere else closes the panel.
    document.addEventListener(
      'pointerdown',
      event => {
        if (!this.open) return;
        const target = event.target as Node;
        if (!panel.contains(target) && !el.button.contains(target)) this.hide();
      },
      true,
    );
    window.addEventListener('blur', () => this.hide());
  }

  private setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(100, volume));
    this.render();
    // Throttle to ~20 commands/s while dragging; always send the final value.
    window.clearTimeout(this.sendTimer);
    const wait = 50 - (Date.now() - this.lastSent);
    const flush = (): void => {
      this.lastSent = Date.now();
      this.send({ type: 'volume', volume: this.volume });
    };
    if (wait <= 0) flush();
    else this.sendTimer = window.setTimeout(flush, wait);
  }

  private show(): void {
    this.open = true;
    this.el.host.classList.add('volume-open');
    this.el.button.setAttribute('aria-expanded', 'true');
    this.slider.set(this.volume / 100);
    this.armClose();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    window.clearTimeout(this.closeTimer);
    this.el.host.classList.remove('volume-open');
    this.el.button.setAttribute('aria-expanded', 'false');
  }

  private armClose(): void {
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      const panel = this.el.track.parentElement as HTMLElement;
      if (this.slider.isDragging || panel.matches(':hover') || this.el.button.matches(':hover')) this.armClose();
      else this.hide();
    }, CLOSE_AFTER_MS);
  }

  update(snapshot: PlayerSnapshot): void {
    this.muted = snapshot.muted;
    if (!this.slider.isDragging && Date.now() - this.lastSent > 400) this.volume = snapshot.volume;
    this.render();
  }

  private render(): void {
    const silent = this.muted || this.volume === 0;
    const level = silent ? 0 : this.volume < 34 ? 1 : this.volume < 67 ? 2 : 3;
    const { button, mute, track, value } = this.el;
    button.dataset.level = String(level);
    button.querySelector('use')?.setAttribute('href', level === 0 ? '#i-mute' : level === 1 ? '#i-vol-1' : '#i-vol-3');
    const label = this.muted ? `Son coupé (volume ${this.volume} %)` : `Volume ${this.volume} %`;
    button.setAttribute('aria-label', label);
    button.title = `${label} — clic pour ouvrir/fermer, molette pour régler`;
    mute.setAttribute('aria-pressed', String(this.muted));
    mute.title = this.muted ? 'Rétablir le son' : 'Couper le son';
    mute.setAttribute('aria-label', mute.title);
    value.textContent = String(this.volume);
    track.setAttribute('aria-valuetext', `${this.volume} %${this.muted ? ', son coupé' : ''}`);
    track.classList.toggle('muted', this.muted);
    if (!this.slider.isDragging) this.slider.set(this.volume / 100);
  }
}
