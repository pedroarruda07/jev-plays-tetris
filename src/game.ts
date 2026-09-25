export const WIDTH = 10;
export const HEIGHT = 20;
export const LOCK_DELAY = 500;
export const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
export type PieceType = (typeof TYPES)[number];
export type Cell = PieceType | null;
export type Rotation = 0 | 1 | 2 | 3;
export type Position = { x: number; y: number };
export interface Piece extends Position {
  type: PieceType;
  rotation: Rotation;
}
export type PlayerAction = 'left' | 'right' | 'rotate' | 'softDrop' | 'hardDrop' | 'hold';
export const PLAYER_ACTIONS: readonly PlayerAction[] = [
  'left',
  'right',
  'rotate',
  'softDrop',
  // 'hardDrop',
  'hold',
];
export type GameAction =
  | { type: PlayerAction | 'pause' | 'resume' | 'restart' }
  | { type: 'tick'; deltaMs: number };
export interface GameState {
  board: Cell[][];
  active: Piece | null;
  next: PieceType[];
  bag: PieceType[];
  hold: PieceType | null;
  canHold: boolean;
  status: 'playing' | 'paused' | 'gameOver';
  score: number;
  lines: number;
  level: number;
  piecesPlaced: number;
  elapsedMs: number;
  gravityElapsedMs: number;
  lockElapsedMs: number;
  lastClear: number;
}
export interface ModelActivePiece {
  type: PieceType;
  cells: Position[];
}
export interface ModelGameState {
  occupied: Position[];
  active: ModelActivePiece | null;
  ghost: ModelActivePiece | null;
  landingPositions: Position[][];
  next: PieceType[];
  hold: PieceType | null;
  canHold: boolean;
  score: number;
  lines: number;
  level: number;
  lockElapsedMs: number;
  availableActions: PlayerAction[];
}
export type Random = () => number;
const SHAPES: Record<PieceType, readonly string[]> = {
  I: ['0000', '1111', '0000', '0000'],
  O: ['11', '11'],
  T: ['010', '111', '000'],
  S: ['011', '110', '000'],
  Z: ['110', '011', '000'],
  J: ['100', '111', '000'],
  L: ['001', '111', '000'],
};
export function cells(piece: Piece): Position[] {
  const shape = SHAPES[piece.type];
  const result: Position[] = [];
  shape.forEach((row, y) =>
    [...row].forEach((value, x) => {
      if (value !== '1') return;
      let px = x,
        py = y;
      for (let i = 0; i < piece.rotation; i++) [px, py] = [shape.length - 1 - py, px];
      result.push({ x: px + piece.x, y: py + piece.y });
    }),
  );
  return result;
}
export function fits(state: GameState, piece: Piece): boolean {
  return cells(piece).every(
    ({ x, y }) =>
      x >= 0 && x < WIDTH && y < HEIGHT && (y < 0 || state.board[y][x] === null),
  );
}
export function isGrounded(state: GameState): boolean {
  return (
    state.active !== null && !fits(state, { ...state.active, y: state.active.y + 1 })
  );
}
export function ghostPiece(state: GameState): Piece | null {
  if (!state.active) return null;
  const ghost = { ...state.active };
  while (fits(state, { ...ghost, y: ghost.y + 1 })) ghost.y++;
  return ghost;
}
export function gravityInterval(state: GameState): number {
  return Math.max(150, 1000 - (state.level - 1) * 65);
}
function draw(state: GameState, random: Random): PieceType {
  if (!state.bag.length) {
    state.bag = [...TYPES];
    for (let i = state.bag.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
      [state.bag[i], state.bag[j]] = [state.bag[j], state.bag[i]];
    }
  }
  return state.bag.pop()!;
}
function spawn(state: GameState, random: Random, held?: PieceType): void {
  const type = held ?? state.next.shift()!;
  while (state.next.length < 3) state.next.push(draw(state, random));
  state.active = {
    type,
    rotation: 0,
    x: type === 'O' ? 4 : 3,
    y: type === 'I' ? -1 : 0,
  };
  state.gravityElapsedMs = 0;
  state.lockElapsedMs = 0;
  if (!fits(state, state.active)) state.status = 'gameOver';
}
export function createInitialState(random: Random = Math.random): GameState {
  const state: GameState = {
    board: Array.from({ length: HEIGHT }, () => Array<Cell>(WIDTH).fill(null)),
    active: null,
    next: [],
    bag: [],
    hold: null,
    canHold: true,
    status: 'playing',
    score: 0,
    lines: 0,
    level: 1,
    piecesPlaced: 0,
    elapsedMs: 0,
    gravityElapsedMs: 0,
    lockElapsedMs: 0,
    lastClear: 0,
  };
  while (state.next.length < 3) state.next.push(draw(state, random));
  spawn(state, random);
  return state;
}
function lock(state: GameState, random: Random): void {
  if (!state.active) return;
  const occupied = cells(state.active);
  if (occupied.some(({ y }) => y < 0)) {
    state.status = 'gameOver';
    return;
  }
  for (const { x, y } of occupied) state.board[y][x] = state.active.type;
  state.piecesPlaced++;
  const remaining = state.board.filter((row) => row.some((cell) => cell === null));
  const cleared = HEIGHT - remaining.length;
  state.board = [
    ...Array.from({ length: cleared }, () => Array<Cell>(WIDTH).fill(null)),
    ...remaining,
  ];
  state.lastClear = cleared;
  state.score += [0, 100, 300, 500, 800][cleared];
  state.lines += cleared;
  state.level = 1 + Math.floor(state.lines / 5);
  state.canHold = true;
  spawn(state, random);
}
// Clockwise SRS kicks, with vertical offsets expressed in screen coordinates.
const KICKS: Position[][] = [
  [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
].map((list) => list.map(([x, y]) => ({ x, y })));
const I_KICKS: Position[][] = [
  [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, 1],
    [1, -2],
  ],
  [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, -2],
    [2, 1],
  ],
  [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, -1],
    [-1, 2],
  ],
  [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, 2],
    [-2, -1],
  ],
].map((list) => list.map(([x, y]) => ({ x, y })));
function move(state: GameState, action: PlayerAction): boolean {
  const active = state.active;
  if (!active) return false;
  let candidate: Piece | undefined;
  if (action === 'rotate') {
    if (active.type === 'O') return false;
    const kicks = (active.type === 'I' ? I_KICKS : KICKS)[active.rotation];
    candidate = kicks
      .map((offset) => ({
        ...active,
        rotation: ((active.rotation + 1) % 4) as Rotation,
        x: active.x + offset.x,
        y: active.y + offset.y,
      }))
      .find((piece) => fits(state, piece));
  } else {
    const proposed = {
      ...active,
      x: active.x + (action === 'left' ? -1 : action === 'right' ? 1 : 0),
      y: active.y + (action === 'softDrop' ? 1 : 0),
    };
    if (fits(state, proposed)) candidate = proposed;
  }
  if (!candidate) return false;
  state.active = candidate;
  return true;
}

const POSITIONING_ACTIONS = ['left', 'right', 'rotate', 'softDrop'] as const;

/** Distinct grounded cell sets reachable through legal inputs from the current pose. */
export function reachableLandings(state: GameState): Position[][] {
  if (state.status !== 'playing' || !state.active) return [];

  const pending: Piece[] = [{ ...state.active }];
  const visited = new Set<string>();
  const landings = new Map<string, Position[]>();

  for (let index = 0; index < pending.length; index++) {
    const piece = pending[index];
    const poseKey = `${piece.x},${piece.y},${piece.rotation}`;
    if (visited.has(poseKey)) continue;
    visited.add(poseKey);

    if (!fits(state, { ...piece, y: piece.y + 1 })) {
      const positions = cells(piece);
      const key = positions
        .map(({ x, y }) => `${x},${y}`)
        .sort()
        .join('|');
      if (!landings.has(key)) landings.set(key, positions);
    }

    for (const action of POSITIONING_ACTIONS) {
      // move only changes active, so share the read-only board during the search.
      const candidate = { ...state, active: piece };
      if (move(candidate, action)) pending.push(candidate.active!);
    }
  }

  return [...landings.values()];
}
function tick(state: GameState, deltaMs: number, random: Random): void {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
  let remaining = deltaMs;
  // Consume time at event boundaries so results don't depend on rendering frequency.
  while (remaining > 0 && state.status === 'playing') {
    const grounded = isGrounded(state);
    const untilEvent = grounded
      ? LOCK_DELAY - state.lockElapsedMs
      : gravityInterval(state) - state.gravityElapsedMs;
    const step = Math.min(remaining, Math.max(0, untilEvent));
    state.elapsedMs += step;
    remaining -= step;
    if (grounded) {
      state.lockElapsedMs += step;
      if (state.lockElapsedMs >= LOCK_DELAY) lock(state, random);
    } else {
      state.gravityElapsedMs += step;
      if (state.gravityElapsedMs >= gravityInterval(state)) {
        state.gravityElapsedMs = 0;
        move(state, 'softDrop');
      }
    }
  }
}
/** Immutable transition. Supply a seeded RNG to reproduce bag generation. */
export function reduceGame(
  previous: GameState,
  action: GameAction,
  random: Random = Math.random,
): GameState {
  if (action.type === 'restart') return createInitialState(random);
  const state = structuredClone(previous);
  if (action.type === 'pause' && state.status === 'playing') state.status = 'paused';
  if (action.type === 'resume' && state.status === 'paused') state.status = 'playing';
  if (state.status !== 'playing' || !state.active) return state;
  switch (action.type) {
    case 'tick':
      tick(state, action.deltaMs, random);
      break;
    case 'left':
    case 'right':
    case 'rotate':
    case 'softDrop':
      move(state, action.type);
      break;
    case 'hardDrop':
      state.active = ghostPiece(state);
      lock(state, random);
      break;
    case 'hold': {
      if (!state.canHold) break;
      const old = state.hold;
      state.hold = state.active.type;
      spawn(state, random, old ?? undefined);
      state.canHold = false;
      break;
    }
  }
  return state;
}
/** Legal player inputs; pause/restart remain separate lifecycle actions. */
export function availableActions(state: GameState): PlayerAction[] {
  if (state.status !== 'playing' || !state.active) return [];
  return PLAYER_ACTIONS.filter((action) => {
    if (action === 'hold') return state.canHold;
    if (action === 'softDrop' || action === 'hardDrop') return true;
    return move(structuredClone(state), action);
  });
}

/** A compact, detached snapshot intended to be sent to a model. */
export function modelGameState(state: GameState): ModelGameState {
  const ghost = ghostPiece(state);
  return {
    occupied: state.board.flatMap((row, y) =>
      row.flatMap((cell, x) => (cell === null ? [] : [{ x, y }])),
    ),
    active: state.active
      ? {
          type: state.active.type,
          cells: cells(state.active),
        }
      : null,
    ghost: ghost
      ? {
          type: ghost.type,
          cells: cells(ghost),
        }
      : null,
    landingPositions: reachableLandings(state),
    next: [...state.next],
    hold: state.hold,
    canHold: state.canHold,
    score: state.score,
    lines: state.lines,
    level: state.level,
    lockElapsedMs: state.lockElapsedMs,
    availableActions: availableActions(state),
  };
}

export class TetrisGame {
  private state: GameState;
  private listeners = new Set<(state: GameState, action?: GameAction) => void>();
  constructor(private random: Random = Math.random) {
    this.state = createInitialState(random);
  }
  getState(): GameState {
    return structuredClone(this.state);
  }
  getAvailableActions(): PlayerAction[] {
    return availableActions(this.state);
  }
  getModelState(): ModelGameState {
    return modelGameState(this.state);
  }
  dispatch(action: GameAction): GameState {
    this.state = reduceGame(this.state, action, this.random);
    for (const listener of this.listeners) listener(this.getState(), action);
    return this.getState();
  }
  subscribe(listener: (state: GameState, action?: GameAction) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }
}
