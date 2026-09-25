import { HEIGHT, LOCK_DELAY, PLAYER_ACTIONS, TYPES, WIDTH } from '../game';
import type {
  ModelActivePiece,
  ModelGameState,
  PieceType,
  PlayerAction,
  Position,
} from '../game';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPlayerAction(value: unknown): value is PlayerAction {
  return PLAYER_ACTIONS.some((action) => action === value);
}

function isPieceType(value: unknown): value is PieceType {
  return TYPES.some((type) => type === value);
}

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function isPosition(value: unknown): value is Position {
  return (
    isRecord(value) &&
    integer(value.x, WIDTH - 1) &&
    Number.isInteger(value.y) &&
    Number(value.y) >= -4 &&
    Number(value.y) < HEIGHT
  );
}

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

function cellSetKey(positions: Position[]): string {
  return positions.map(positionKey).sort().join('|');
}

function isCellSet(value: unknown): value is Position[] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(isPosition) &&
    new Set(value.map(positionKey)).size === 4
  );
}

function isModelPiece(value: unknown): value is ModelActivePiece {
  return isRecord(value) && isPieceType(value.type) && isCellSet(value.cells);
}

/** Validate at the HTTP boundary and copy only model-visible fields. */
export function parseModelState(value: unknown): ModelGameState {
  if (!isRecord(value)) throw new Error('Expected a model state object.');
  const {
    occupied,
    active,
    ghost,
    landingPositions,
    next,
    hold,
    canHold,
    score,
    lines,
    level,
    lockElapsedMs,
    availableActions,
  } = value;
  if (
    !Array.isArray(occupied) ||
    occupied.length > WIDTH * HEIGHT ||
    !occupied.every(isPosition) ||
    occupied.some((position: Position) => position.y < 0) ||
    new Set(occupied.map(positionKey)).size !== occupied.length
  ) {
    throw new Error('Expected distinct occupied board positions.');
  }
  if (!isModelPiece(active))
    throw new Error('Expected an active tetromino with four distinct cells.');
  if (!isModelPiece(ghost) || ghost.type !== active.type) {
    throw new Error('Expected a matching ghost tetromino with four distinct cells.');
  }
  const occupiedKeys = new Set(occupied.map(positionKey));
  if (
    !Array.isArray(landingPositions) ||
    !landingPositions.length ||
    !landingPositions.every(isCellSet) ||
    new Set(landingPositions.map(cellSetKey)).size !== landingPositions.length ||
    !landingPositions.some(
      (landing: Position[]) => cellSetKey(landing) === cellSetKey(ghost.cells),
    ) ||
    landingPositions.some((landing: Position[]) =>
      landing.some((position) => occupiedKeys.has(positionKey(position))),
    )
  ) {
    throw new Error('Expected distinct reachable landing positions including the ghost.');
  }
  if (!Array.isArray(next) || next.length !== 3 || !next.every(isPieceType)) {
    throw new Error('Expected three next pieces.');
  }
  if (
    !(hold === null || isPieceType(hold)) ||
    typeof canHold !== 'boolean' ||
    !integer(score) ||
    !integer(lines) ||
    !integer(level) ||
    level < 1 ||
    typeof lockElapsedMs !== 'number' ||
    !Number.isFinite(lockElapsedMs) ||
    lockElapsedMs < 0 ||
    lockElapsedMs > LOCK_DELAY
  )
    throw new Error('Invalid game metadata.');
  if (
    !Array.isArray(availableActions) ||
    !availableActions.length ||
    !availableActions.every(isPlayerAction) ||
    new Set(availableActions).size !== availableActions.length ||
    (!canHold && availableActions.includes('hold'))
  )
    throw new Error('Invalid available actions.');

  return {
    occupied: occupied.map((position: Position) => ({ x: position.x, y: position.y })),
    active: {
      type: active.type,
      cells: active.cells.map((p: Position) => ({ x: p.x, y: p.y })),
    },
    ghost: {
      type: ghost.type,
      cells: ghost.cells.map((p: Position) => ({ x: p.x, y: p.y })),
    },
    landingPositions: landingPositions.map((landing: Position[]) =>
      landing.map((position) => ({ x: position.x, y: position.y })),
    ),
    next: [...next],
    hold,
    canHold,
    score,
    lines,
    level,
    lockElapsedMs,
    availableActions: [...availableActions],
  };
}
