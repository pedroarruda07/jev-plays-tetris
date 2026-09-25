import {
  PLAYER_ACTIONS,
  type GameAction,
  type PlayerAction,
  type TetrisGame,
} from '../game';
import { requestJevDecision } from './client';
import { JEV_ACTION_HISTORY_LIMIT, type Decide, type JevTrace } from './types';

export interface JevPlayerStatus {
  running: boolean;
  phase: 'idle' | 'thinking' | 'waiting' | 'error' | 'gameOver';
  freezeWhileThinking: boolean;
  message: string;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** One request, one validated action, then a fresh snapshot. No overlapping decisions. */
export class JevPlayer {
  private runController: AbortController | null = null;
  private lastDecision: JevTrace | null = null;
  private previousActions: PlayerAction[] = [];
  private applyingAction = false;
  private readonly listeners = new Set<(status: JevPlayerStatus) => void>();
  private readonly unsubscribe: () => void;
  private status: JevPlayerStatus = {
    running: false,
    phase: 'idle',
    freezeWhileThinking: false,
    message: 'Ready for Jev.',
  };

  constructor(
    private readonly game: TetrisGame,
    private readonly decide: Decide = requestJevDecision,
    private readonly decisionDelayMs = 100,
  ) {
    this.unsubscribe = game.subscribe((state, action) => {
      if (!this.status.running) return;
      if (state.status === 'gameOver') {
        this.stop('Game over.', 'gameOver');
      } else if (state.status === 'paused') {
        this.stop('Paused. Start Jev to continue.');
      } else if (!this.applyingAction && action && this.isManualAction(action)) {
        this.stop('Manual control.');
      }
    });
  }

  getStatus(): JevPlayerStatus {
    return { ...this.status };
  }
  getLastDecision(): JevTrace | null {
    return structuredClone(this.lastDecision);
  }

  subscribe(listener: (status: JevPlayerStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Used by the animation loop only while a decision is pending. */
  isClockSuspended(): boolean {
    return (
      this.status.running &&
      this.status.freezeWhileThinking &&
      this.status.phase === 'thinking'
    );
  }

  setFreezeWhileThinking(enabled: boolean): void {
    if (enabled === this.status.freezeWhileThinking) return;
    const resume = this.status.running;
    if (resume) this.stop('Changing timing mode.');
    this.status.freezeWhileThinking = enabled;
    this.emit();
    if (resume) this.begin(false);
  }

  start(): void {
    this.begin(true);
  }

  private begin(resetActionHistory: boolean): void {
    if (this.status.running) return;
    if (resetActionHistory) this.previousActions = [];
    this.applyingAction = true;
    try {
      const current = this.game.getState();
      if (current.status === 'gameOver') this.game.dispatch({ type: 'restart' });
      else if (current.status === 'paused') this.game.dispatch({ type: 'resume' });
    } finally {
      this.applyingAction = false;
    }
    const controller = new AbortController();
    this.runController = controller;
    this.status.running = true;
    void this.run(controller);
  }

  stop(message = 'Jev stopped.', phase: JevPlayerStatus['phase'] = 'idle'): void {
    this.runController?.abort();
    this.runController = null;
    this.status = { ...this.status, running: false, phase, message };
    this.emit();
  }

  dispose(): void {
    this.stop();
    this.unsubscribe();
    this.listeners.clear();
  }

  private async run(controller: AbortController): Promise<void> {
    const { signal } = controller;
    try {
      while (!signal.aborted) {
        const before = this.game.getState();
        if (before.status !== 'playing') {
          this.stop();
          return;
        }
        this.status.phase = 'thinking';
        this.status.message = 'Jev is deciding…';
        this.emit();
        const trace = await this.decide(
          this.game.getModelState(),
          signal,
          this.status.freezeWhileThinking,
          [...this.previousActions],
        );
        if (signal.aborted || this.runController !== controller) return;
        this.lastDecision = structuredClone(trace);
        const current = this.game.getState();
        if (current.status !== 'playing') return;
        if (
          current.piecesPlaced !== before.piecesPlaced ||
          !this.game.getAvailableActions().includes(trace.decision.action)
        ) {
          this.status.message = 'State changed; asking Jev again.';
          console.info(
            `[Jev ${trace.id}] Discarded: piece locked or action no longer legal.`,
          );
        } else {
          this.applyingAction = true;
          try {
            this.game.dispatch({ type: trace.decision.action });
            this.previousActions = [...this.previousActions, trace.decision.action].slice(
              -JEV_ACTION_HISTORY_LIMIT,
            );
          } finally {
            this.applyingAction = false;
          }
          console.info(`[Jev ${trace.id}] Executed ${trace.decision.action}.`);
          if (signal.aborted) return;
          this.status.message = `Jev: ${trace.decision.action}`;
        }
        this.status.phase = 'waiting';
        this.emit();
        await wait(this.decisionDelayMs, signal);
      }
    } catch (error) {
      if (signal.aborted || this.runController !== controller) return;
      const message = error instanceof Error ? error.message : 'Jev decision failed.';
      console.error('[Jev]', message);
      this.stop(message, 'error');
    }
  }

  private isManualAction(action: GameAction): boolean {
    return (
      action.type === 'restart' || PLAYER_ACTIONS.some((type) => type === action.type)
    );
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.getStatus());
  }
}
