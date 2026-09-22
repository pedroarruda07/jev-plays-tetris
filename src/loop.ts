import type { TetrisGame } from './game';
import type { GameControls } from './input';

const MAX_FRAME_DELTA_MS = 100;

export class GameLoop {
  private frameId: number | null = null;
  private previousFrameAt = 0;

  constructor(
    private readonly game: TetrisGame,
    private readonly controls: GameControls,
    private readonly isClockSuspended: () => boolean = () => false,
  ) {}

  start(): void {
    if (this.frameId !== null) return;

    this.previousFrameAt = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.frameId === null) return;

    cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  private readonly frame = (now: number): void => {
    const deltaMs = Math.min(now - this.previousFrameAt, MAX_FRAME_DELTA_MS);
    this.previousFrameAt = now;

    if (this.game.getState().status === 'playing' && !this.isClockSuspended()) {
      this.controls.dispatchRepeats(now);
      this.game.dispatch({ type: 'tick', deltaMs });
    } else {
      this.controls.clearHeld();
    }

    this.frameId = requestAnimationFrame(this.frame);
  };
}
