import { HEIGHT, LOCK_DELAY, PLAYER_ACTIONS, TYPES, WIDTH } from '../game';
import { MAX_PLACEMENTS, type PlacementOption } from '../placements';
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

function isModelPiece(value: unknown): value is ModelActivePiece {
  return (
    isRecord(value) &&
    isPieceType(value.type) &&
    Array.isArray(value.cells) &&
    value.cells.length === 4 &&
    value.cells.every(isPosition) &&
    new Set(value.cells.map((position: Position) => `${position.x},${position.y}`))
      .size === 4
  );
}

/** Candidate consequences come from the browser's planner; never accept executable paths. */
export function parsePlacements(value: unknown): PlacementOption[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PLACEMENTS) {
    throw new Error('Expected 1 to 255 placement options.');
  }
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !/^p_(active|hold)_[IOTSZJL]_(?:\d_-?\d{1,2}_){3}\d_-?\d{1,2}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.usesHold !== 'boolean' ||
      !isModelPiece(item.landing) ||
      !integer(item.linesCleared, 4) ||
      !integer(item.scoreGain, 800) ||
      typeof item.gameOver !== 'boolean' ||
      !isRecord(item.metrics) ||
      !integer(item.metrics.holes, WIDTH * HEIGHT) ||
      !integer(item.metrics.maxHeight, HEIGHT) ||
      !integer(item.metrics.aggregateHeight, WIDTH * HEIGHT) ||
      !integer(item.metrics.bumpiness, (WIDTH - 1) * HEIGHT) ||
      !Array.isArray(item.metrics.columnHeights) ||
      item.metrics.columnHeights.length !== WIDTH ||
      !item.metrics.columnHeights.every((height: unknown) => integer(height, HEIGHT)) ||
      !Array.isArray(item.boardAfter) ||
      item.boardAfter.length !== HEIGHT ||
      !item.boardAfter.every(
        (row: unknown) => typeof row === 'string' && /^[.IOTSZJL]{10}$/.test(row),
      )
    ) {
      throw new Error('Invalid placement option.');
    }
    ids.add(item.id);
    return {
      id: item.id,
      usesHold: item.usesHold,
      landing: {
        type: item.landing.type,
        cells: item.landing.cells.map(({ x, y }) => ({ x, y })),
      },
      linesCleared: item.linesCleared,
      scoreGain: item.scoreGain,
      gameOver: item.gameOver,
      metrics: {
        holes: item.metrics.holes,
        maxHeight: item.metrics.maxHeight,
        aggregateHeight: item.metrics.aggregateHeight,
        bumpiness: item.metrics.bumpiness,
        columnHeights: [...item.metrics.columnHeights] as number[],
      },
      boardAfter: [...item.boardAfter] as string[],
    };
  });
}

/** Validate at the HTTP boundary and copy only model-visible fields. */
export function parseModelState(value: unknown): ModelGameState {
  if (!isRecord(value)) throw new Error('Expected a model state object.');
  const {
    board,
    active,
    ghost,
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
  if (!isModelPiece(active))
    throw new Error('Expected an active tetromino with four distinct cells.');
  if (!isModelPiece(ghost) || ghost.type !== active.type) {
    throw new Error('Expected a matching ghost tetromino with four distinct cells.');
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
    board: board.map((row: (PieceType | null)[]) => [...row]),
    active: {
      type: active.type,
      cells: active.cells.map((p: Position) => ({ x: p.x, y: p.y })),
    },
    ghost: {
      type: ghost.type,
      cells: ghost.cells.map((p: Position) => ({ x: p.x, y: p.y })),
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
