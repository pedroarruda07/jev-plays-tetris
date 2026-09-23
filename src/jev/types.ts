import type { ModelGameState } from '../game';
import type { PlacementOption } from '../placements';

export interface JevModelContext extends Omit<ModelGameState, 'availableActions'> {
  placements: PlacementOption[];
}

export interface JevRequest {
  model: string;
  state: { game: string; goal: string; context: JevModelContext };
  questions: {
    nextPlacement: {
      type: 'choice';
      instructions: string;
      criteria: Record<string, string>;
    };
  };
}

export interface JevDecision {
  placementId: string;
  modelChoice: string;
  confidence: number;
  probabilities: Record<string, number>;
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
  placements: readonly PlacementOption[],
) => Promise<JevTrace>;
