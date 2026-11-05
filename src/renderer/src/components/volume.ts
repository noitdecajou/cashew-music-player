import type { PlayerCommand, PlayerSnapshot } from '../../../shared/player';
import { Slider } from './slider';

const CLOSE_AFTER_MS = 3500;

/**
 * Volume without growing the mini player: the button opens a slider that
 * temporarily covers the "up next" area. Wheel over the button or slider
 * changes the volume by 5; clicking the button while open toggles mute.
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
    private readonly host: HTMLElement, // element that gets .volume-open
    private readonly button: HTMLButtonElement,
    private readonly track: HTMLElement,
    private readonly send: (command: PlayerCommand) => void,
  ) {
    this.slider = new Slider({
      element: track,
      fill: track.querySelector('.fill') as HTMLElement,
      thumb: track.querySelector('.thumb') as HTMLElement,
      step: () => 0.05,
      live: true,
      commit: ratio => this.setVolume(Math.round(ratio * 100)),
    });
    button.addEventListener('click', () => {
      if (!this.open) this.show();
      else this.send({ type: 'mute', muted: !this.muted });
      this.armClose();
    });
    for (const element of [button, track]) {
      element.addEventListener('wheel', event => {
        event.preventDefault();
        if (!this.open) this.show();
        this.setVolume(this.volume + (event.deltaY < 0 ? 5 : -5));
        this.slider.set(this.volume / 100);
        this.armClose();
      }, { passive: false });
    }
    track.addEventListener('pointerdown', () => this.armClose());
    track.addEventListener('keydown', event => { if (event.key === 'Escape') this.hide(); else this.armClose(); });
  }

  private setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(100, volume));
    this.render();
    // Throttle to ~20 commands/s while dragging; always send the final value.
    window.clearTimeout(this.sendTimer);
    const wait = 50 - (Date.now() - this.lastSent);
    const flush = (): void => { this.lastSent = Date.now(); this.send({ type: 'volume', volume: this.volume }); };
    if (wait <= 0) flush(); else this.sendTimer = window.setTimeout(flush, wait);
  }

  private show(): void {
    this.open = true;
    this.host.classList.add('volume-open');
    this.button.setAttribute('aria-expanded', 'true');
    this.slider.set(this.volume / 100);
  }

  hide(): void {
    this.open = false;
    window.clearTimeout(this.closeTimer);
    this.host.classList.remove('volume-open');
    this.button.setAttribute('aria-expanded', 'false');
  }

  private armClose(): void {
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      if (this.slider.isDragging || this.track.matches(':hover') || this.button.matches(':hover')) this.armClose();
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
    this.button.dataset.level = String(level);
    const label = this.muted ? `Son coupé (volume ${this.volume} %)` : `Volume ${this.volume} %`;
    this.button.title = `${label} — molette pour régler`;
    this.button.setAttribute('aria-label', label);
    this.track.setAttribute('aria-valuetext', `${this.volume} %${this.muted ? ', son coupé' : ''}`);
    this.track.classList.toggle('muted', this.muted);
    if (!this.slider.isDragging) this.slider.set(this.volume / 100);
  }
}
