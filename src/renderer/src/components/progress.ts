import type { PlayerCommand, PlayerProgress } from '../../../shared/player';
import { formatTime } from '../format';
import { Slider } from './slider';

/** Seek bar: drag to preview, release to seek. The clock never fights the hand. */
export class ProgressBar {
  private readonly slider: Slider;
  private trackId = '';
  private duration = 0;
  private position = 0;
  /** After a seek, hold the target until the clock catches up (no snap-back). */
  private pendingSeek: { position: number; until: number } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly elapsed: HTMLElement,
    private readonly total: HTMLElement,
    send: (command: PlayerCommand) => void,
  ) {
    this.slider = new Slider({
      element: root,
      fill: root.querySelector('.fill') as HTMLElement,
      thumb: root.querySelector('.thumb') as HTMLElement,
      step: () => (this.duration > 0 ? 5 / this.duration : 0),
      preview: ratio => this.renderTime(ratio * this.duration),
      commit: ratio => {
        if (!this.trackId || this.duration <= 0) return;
        const position = ratio * this.duration;
        this.pendingSeek = { position, until: Date.now() + 2000 };
        this.renderTime(position);
        send({ type: 'seek', trackId: this.trackId, position });
      },
    });
    this.reset('');
  }

  reset(trackId: string): void {
    this.trackId = trackId;
    this.duration = 0;
    this.position = 0;
    this.pendingSeek = null;
    this.slider.set(0);
    this.slider.setEnabled(false);
    this.renderTime(0);
  }

  update(progress: PlayerProgress): void {
    if (progress.trackId !== this.trackId) return; // clock of another card
    this.duration = progress.duration;
    this.position = progress.position;
    if (this.pendingSeek) {
      const caughtUp = Math.abs(progress.position - this.pendingSeek.position) < 1.5;
      if (caughtUp || Date.now() > this.pendingSeek.until) this.pendingSeek = null;
      else return;
    }
    this.slider.setEnabled(this.duration > 0);
    if (this.slider.isDragging) return;
    this.slider.set(this.duration > 0 ? this.position / this.duration : 0);
    this.renderTime(this.position);
  }

  private renderTime(position: number): void {
    const known = this.duration > 0;
    this.elapsed.textContent = formatTime(position);
    this.total.textContent = known ? formatTime(this.duration) : '—';
    this.root.setAttribute(
      'aria-valuetext',
      known ? `${formatTime(position)} sur ${formatTime(this.duration)}` : 'Durée inconnue',
    );
  }
}
