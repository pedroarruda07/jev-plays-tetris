import type { ModelGameState, PlayerAction } from '../game';

export interface JevModelContext extends ModelGameState {
  /** The last action Jev successfully executed in this autoplay session. */
  previousAction: PlayerAction | null;
}

export interface JevRequest {
  model: string;
  state: { game: string; goal: string; context: JevModelContext };
  questions: {
    nextAction: {
      type: 'choice';
      instructions: string;
      criteria: Partial<Record<PlayerAction, string>>;
    };
  };
}

export interface JevDecision {
  action: PlayerAction;
  modelChoice: PlayerAction;
  confidence: number;
  probabilities: Partial<Record<PlayerAction, number>>;
}

/** Everything needed to inspect one decision, without authentication headers. */
export interface JevTrace {
  id: string;
  durationMs: number;
  request: JevRequest;
  response: unknown;
  decision: JevDecision;
}

export type Decide = (
  state: ModelGameState,
  signal: AbortSignal,
  freezeWhileThinking: boolean,
  previousAction: PlayerAction | null,
) => Promise<JevTrace>;
