import type { ModelGameState, PlayerAction } from '../game';

export const JEV_ACTION_HISTORY_LIMIT = 3;

export interface JevModelContext extends ModelGameState {
  /** Successfully executed Jev actions, ordered oldest to newest. */
  previousActions: PlayerAction[];
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
  previousActions: readonly PlayerAction[],
) => Promise<JevTrace>;
