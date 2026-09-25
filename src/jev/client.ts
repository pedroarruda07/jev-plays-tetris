import type { ModelGameState, PlayerAction } from '../game';
import { getJevAvailableActions } from './request';
import { parseJevDecision } from './response';
import type { JevTrace } from './types';
import { isRecord } from './validation';

/** Calls our local server. The API key is never passed to browser code. */
export async function requestJevDecision(
  state: ModelGameState,
  signal: AbortSignal,
  freezeWhileThinking: boolean,
  previousActions: readonly PlayerAction[],
): Promise<JevTrace> {
  const response = await fetch('/api/jev/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, freezeWhileThinking, previousActions }),
    signal,
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      isRecord(body) && typeof body.error === 'string'
        ? body.error
        : `Jev request failed (HTTP ${response.status}).`,
    );
  }
  if (
    !isRecord(body) ||
    typeof body.id !== 'string' ||
    typeof body.durationMs !== 'number' ||
    !isRecord(body.request)
  )
    throw new Error('Invalid response from the local Jev server.');
  const decision = parseJevDecision(body.response, getJevAvailableActions(state));
  // The local server creates the request; raw model output is validated above.
  const trace = { ...body, decision } as unknown as JevTrace;
  console.groupCollapsed(
    `[Jev ${trace.id}] ${decision.action} (${trace.durationMs.toFixed(0)}ms)`,
  );
  console.info('Request sent to TypeSafe AI', trace.request);
  console.info('Raw TypeSafe AI response', trace.response);
  console.table(decision.probabilities);
  console.info('Selected action', decision.action, 'Confidence', decision.confidence);
  console.groupEnd();
  return trace;
}
