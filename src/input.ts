import { PLAYER_ACTIONS, type PlayerAction, type TetrisGame } from './game';

const KEY_ACTIONS: Readonly<Record<string, PlayerAction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'rotate',
  ArrowDown: 'softDrop',
  Space: 'hardDrop',
  KeyC: 'hold',
  ShiftLeft: 'hold',
  ShiftRight: 'hold',
};

interface HeldAction {
  action: PlayerAction;
  nextAt: number;
}

export class GameControls {
  private readonly held = new Map<string, HeldAction>();
  private readonly listeners = new AbortController();

  constructor(private readonly game: TetrisGame) {
    const options = { signal: this.listeners.signal };

    window.addEventListener('keydown', this.onKeyDown, options);
    window.addEventListener('keyup', this.onKeyUp, options);
    window.addEventListener('blur', this.onBlur, options);
    document.addEventListener('visibilitychange', this.onVisibilityChange, options);

    document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      const action = PLAYER_ACTIONS.find(
        (candidate) => candidate === button.dataset.action,
      );

      if (!action) return;

      button.addEventListener(
        'pointerdown',
        (event) => {
          event.preventDefault();
          this.game.dispatch({ type: action });
        },
        options,
      );
    });

    document
      .getElementById('pause')
      ?.addEventListener('click', this.togglePause, options);
    document.getElementById('restart')?.addEventListener('click', this.restart, options);
    document
      .getElementById('continue')
      ?.addEventListener('click', this.continueGame, options);
  }

  /** Dispatch held movement actions after their initial repeat delay. */
  dispatchRepeats(now: number): void {
    for (const held of this.held.values()) {
      if (now < held.nextAt) continue;

      this.game.dispatch({ type: held.action });
      held.nextAt = now + (held.action === 'softDrop' ? 45 : 65);
    }
  }

  clearHeld(): void {
    this.held.clear();
  }

  dispose(): void {
    this.clearHeld();
    this.listeners.abort();
  }

  private readonly togglePause = (): void => {
    const status = this.game.getState().status;
    this.game.dispatch({ type: status === 'paused' ? 'resume' : 'pause' });
  };

  private readonly restart = (): void => {
    this.game.dispatch({ type: 'restart' });
  };

  private readonly continueGame = (): void => {
    this.game.dispatch({
      type: this.game.getState().status === 'gameOver' ? 'restart' : 'resume',
    });
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      (event.target instanceof HTMLElement && event.target.isContentEditable)
    ) {
      return;
    }
    if (
      event.target instanceof HTMLButtonElement &&
      (event.code === 'Space' || event.code === 'Enter')
    ) {
      return;
    }

    if (event.code === 'KeyP' || event.code === 'Escape') {
      event.preventDefault();
      if (!event.repeat) this.togglePause();
      return;
    }

    const action = KEY_ACTIONS[event.code];
    if (!action) return;

    event.preventDefault();
    if (event.repeat) return;

    this.game.dispatch({ type: action });

    if (action === 'left' || action === 'right' || action === 'softDrop') {
      this.held.set(event.code, {
        action,
        nextAt: performance.now() + (action === 'softDrop' ? 60 : 170),
      });
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.clearHeld();
    this.game.dispatch({ type: 'pause' });
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.onBlur();
  };
}
