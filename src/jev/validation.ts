import { HEIGHT, LOCK_DELAY, PLAYER_ACTIONS, TYPES, WIDTH } from '../game';
import type { ModelGameState, PieceType, PlayerAction, Position } from '../game';

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

/** Validate at the HTTP boundary and copy only model-visible fields. */
export function parseModelState(value: unknown): ModelGameState {
  if (!isRecord(value)) throw new Error('Expected a model state object.');
  const {
    board,
    active,
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
    !Array.isArray(board) ||
    board.length !== HEIGHT ||
    !board.every(
      (row: unknown) =>
        Array.isArray(row) &&
        row.length === WIDTH &&
        row.every((cell: unknown) => cell === null || isPieceType(cell)),
    )
  )
    throw new Error('Invalid 10 by 20 board.');
  if (
    !isRecord(active) ||
    !isPieceType(active.type) ||
    !Array.isArray(active.cells) ||
    active.cells.length !== 4 ||
    !active.cells.every(isPosition) ||
    new Set(active.cells.map((p: Position) => `${p.x},${p.y}`)).size !== 4
  )
    throw new Error('Expected an active tetromino with four distinct cells.');
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
    board: board.map((row: (PieceType | null)[]) => [...row]),
    active: {
      type: active.type,
      cells: active.cells.map((p: Position) => ({ x: p.x, y: p.y })),
    },
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
