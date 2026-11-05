/**
 * Accessible horizontal slider driven by pointer capture.
 * - preview(value) on every move while dragging (no command sent),
 * - commit(value) once on release, click, or keyboard.
 * value is a ratio in [0, 1].
 */
export interface SliderOptions {
  element: HTMLElement;
  fill: HTMLElement;
  thumb?: HTMLElement;
  step: () => number; // keyboard step as a ratio
  preview?: (value: number) => void;
  commit: (value: number) => void;
  /** Commit continuously while dragging (volume) instead of on release (progress). */
  live?: boolean;
}

export class Slider {
  private value = 0;
  private dragging = false;
  private enabled = true;

  constructor(private readonly options: SliderOptions) {
    const { element } = options;
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup', this.onUp);
    element.addEventListener('pointercancel', this.onCancel);
    element.addEventListener('lostpointercapture', this.onCancel);
    element.addEventListener('keydown', this.onKey);
  }

  get isDragging(): boolean { return this.dragging; }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.options.element.setAttribute('aria-disabled', String(!enabled));
    if (!enabled && this.dragging) this.dragging = false;
  }

  /** External updates are ignored during a drag: the user's hand wins. */
  set(value: number): void {
    if (this.dragging) return;
    this.render(value);
  }

  private render(value: number): void {
    this.value = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
    const percent = `${(this.value * 100).toFixed(3)}%`;
    this.options.fill.style.width = percent;
    if (this.options.thumb) this.options.thumb.style.left = percent;
    this.options.element.setAttribute('aria-valuenow', String(Math.round(this.value * 100)));
  }

  private ratioAt(event: PointerEvent): number {
    const box = this.options.element.getBoundingClientRect();
    return box.width > 0 ? (event.clientX - box.left) / box.width : 0;
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.options.element.setPointerCapture(event.pointerId);
    this.dragging = true;
    this.options.element.classList.add('dragging');
    this.update(this.ratioAt(event));
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (this.dragging) this.update(this.ratioAt(event));
  };

  private update(value: number): void {
    this.render(value);
    this.options.preview?.(this.value);
    if (this.options.live) this.options.commit(this.value);
  }

  private readonly onUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.render(this.ratioAt(event));
    this.finish(true);
  };

  private readonly onCancel = (): void => { if (this.dragging) this.finish(true); };

  private finish(commit: boolean): void {
    this.dragging = false;
    this.options.element.classList.remove('dragging');
    if (commit) this.options.commit(this.value);
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    const step = this.options.step();
    const keys: Record<string, number> = {
      ArrowLeft: this.value - step, ArrowDown: this.value - step,
      ArrowRight: this.value + step, ArrowUp: this.value + step,
      PageDown: this.value - step * 4, PageUp: this.value + step * 4,
      Home: 0, End: 1,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    this.render(next);
    this.options.preview?.(this.value);
    this.options.commit(this.value);
  };
}
