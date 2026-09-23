import {
  cells,
  isGrounded,
  reduceGame,
  type GameState,
  type PlayerAction,
  type TetrisGame,
} from '../game';
import { planPlacements, type PlacementOption } from '../placements';

export const PLACEMENT_ACTION_INTERVAL_MS = 60;

export interface PlacementExecutionOptions {
  actionIntervalMs?: number;
  dispatch?: (action: PlayerAction) => GameState;
}

function landingKey(placement: PlacementOption): string {
  return `${placement.landing.type}:${placement.landing.cells
    .map(({ x, y }) => `${x},${y}`)
    .sort()
    .join(';')}`;
}

function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (ms <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (completed: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve(completed);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function hasReachedTarget(state: GameState, target: PlacementOption): boolean {
  if (!state.active || !isGrounded(state)) return false;
  return (
    landingKey({
      ...target,
      landing: { type: state.active.type, cells: cells(state.active) },
    }) === landingKey(target)
  );
}

/** Dispatch one visible input at a time. Replanning between inputs accounts for gravity. */
export async function executePlacement(
  game: TetrisGame,
  target: PlacementOption,
  piecesPlaced: number,
  signal: AbortSignal,
  options: PlacementExecutionOptions = {},
): Promise<boolean> {
  const interval = options.actionIntervalMs ?? PLACEMENT_ACTION_INTERVAL_MS;
  const dispatch = options.dispatch ?? ((action) => game.dispatch({ type: action }));
  const targetKey = landingKey(target);
  let holdPending = target.usesHold;
  let firstStep = true;

  for (let step = 0; step < 200; step++) {
    const before = game.getState();
    if (
      signal.aborted ||
      before.status !== 'playing' ||
      before.piecesPlaced !== piecesPlaced
    )
      return false;
    if (hasReachedTarget(before, target)) return true;

    const plan = planPlacements(before).find(
      (candidate) =>
        landingKey(candidate) === targetKey &&
        (firstStep
          ? candidate.id === target.id
          : holdPending
            ? candidate.id === target.id
            : !candidate.usesHold),
    );
    const action = plan?.actions[0];
    if (!action) return false;

    const expected = reduceGame(before, { type: action }, () => 0.5);
    if (expected.status !== 'playing' || !expected.active) return false;
    const after = dispatch(action);
    if (
      signal.aborted ||
      after.status !== 'playing' ||
      after.piecesPlaced !== piecesPlaced ||
      JSON.stringify(after.active) !== JSON.stringify(expected.active)
    )
      return false;
    if (action === 'hold') holdPending = false;
    firstStep = false;
    if (hasReachedTarget(after, target)) return true;
    if (!(await wait(interval, signal))) return false;
  }
  return false;
}
