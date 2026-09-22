import type { TetrisGame } from './game';

const LOG_INTERVAL_MS = 500;
type LogMode = 'debug' | 'model';

const MODE_KEY: Readonly<Record<string, LogMode>> = {
  KeyD: 'debug',
  KeyM: 'model',
};

export class GameDebugLogger {
  private readonly listeners = new AbortController();
  private readonly intervalIds: Record<LogMode, number | null> = {
    debug: null,
    model: null,
  };

  constructor(private readonly game: TetrisGame) {
    window.addEventListener('keydown', this.onKeyDown, {
      signal: this.listeners.signal,
    });
  }

  dispose(): void {
    this.stop('debug');
    this.stop('model');
    this.listeners.abort();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const mode = MODE_KEY[event.code];
    if (!mode || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    event.preventDefault();
    if (this.intervalIds[mode] === null) this.start(mode);
    else this.stop(mode);
  };

  private start(mode: LogMode): void {
    const key = mode === 'debug' ? 'D' : 'M';
    console.info(`[Tetris ${mode}] Enabled. Press ${key} to stop logging.`);
    this.logSnapshot(mode);
    this.intervalIds[mode] = window.setInterval(
      () => this.logSnapshot(mode),
      LOG_INTERVAL_MS,
    );
  }

  private stop(mode: LogMode): void {
    const intervalId = this.intervalIds[mode];
    if (intervalId === null) return;

    window.clearInterval(intervalId);
    this.intervalIds[mode] = null;
    console.info(`[Tetris ${mode}] Disabled.`);
  }

  private logSnapshot(mode: LogMode): void {
    if (mode === 'model') {
      console.info('[Tetris model state]', this.game.getModelState());
      return;
    }

    console.info('[Tetris debug]', {
      state: this.game.getState(),
      availableActions: this.game.getAvailableActions(),
    });
  }
}
