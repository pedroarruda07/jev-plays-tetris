import {
  cells,
  fits,
  isGrounded,
  LOCK_DELAY,
  movedPiece,
  reduceGame,
  type GameState,
  type ModelActivePiece,
  type Piece,
  type PlayerAction,
} from './game';
import { boardMetrics, type BoardMetrics } from './board-metrics';

// TypeSafe Choice accepts at most 255 options.
export const MAX_PLACEMENTS = 255;
export interface PlacementOption {
  id: string;
  usesHold: boolean;
  landing: ModelActivePiece;
  linesCleared: number;
  scoreGain: number;
  gameOver: boolean;
  metrics: BoardMetrics;
  /** Rows from top to bottom; '.' is empty and tetromino letters are locked cells. */
  boardAfter: string[];
}
export interface PlacementPlan extends PlacementOption {
  actions: PlayerAction[];
}

const MOVES: PlayerAction[] = ['left', 'right', 'rotate', 'softDrop'];
const pieceKey = (piece: Piece) => `${piece.x},${piece.y},${piece.rotation}`;

/** Stable across gravity ticks and equivalent rotations; distinct for hold choices. */
function placementId(piece: Piece, usesHold: boolean): string {
  const coordinates = cells(piece).sort((a, b) => a.y - b.y || a.x - b.x);
  return `p_${usesHold ? 'hold' : 'active'}_${piece.type}_${coordinates
    .map(({ x, y }) => `${x}_${y}`)
    .join('_')}`;
}

/** Search legal input paths, including slides and kicks, without advancing the clock.
 * The executor applies these paths in one synchronous batch, then lets the lock clock run.
 * No real RNG is consumed and no state or bag is sent to the model.
 */
export function planPlacements(state: GameState): PlacementPlan[] {
  if (state.status !== 'playing' || !state.active || !fits(state, state.active))
    return [];
  const plans = new Map<string, PlacementPlan>();
  const roots = [{ state, usesHold: false }];
  if (state.canHold) {
    roots.push({ state: reduceGame(state, { type: 'hold' }, () => 0.5), usesHold: true });
  }
  for (const root of roots) {
    if (root.state.status !== 'playing' || !root.state.active) continue;
    const queue: { piece: Piece; actions: PlayerAction[] }[] = [
      { piece: root.state.active, actions: root.usesHold ? ['hold'] : [] },
    ];
    const visited = new Set([pieceKey(root.state.active)]);
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index];
      const current = { ...root.state, active: node.piece };
      if (isGrounded(current)) {
        const id = placementId(node.piece, root.usesHold);
        if (!plans.has(id)) {
          const after = reduceGame(
            current,
            {
              type: 'tick',
              deltaMs: Math.max(0.001, LOCK_DELAY - current.lockElapsedMs),
            },
            () => 0.5,
          );
          plans.set(id, {
            id,
            usesHold: root.usesHold,
            landing: { type: node.piece.type, cells: cells(node.piece) },
            linesCleared: after.lines - state.lines,
            scoreGain: after.score - state.score,
            gameOver: after.status === 'gameOver',
            metrics: boardMetrics(after.board),
            boardAfter: after.board.map((row) => row.map((cell) => cell ?? '.').join('')),
            actions: node.actions,
          });
        }
      }
      for (const action of MOVES) {
        const piece = movedPiece(current, action);
        if (!piece || cells(piece).some(({ y }) => y < -4)) continue;
        const key = pieceKey(piece);
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ piece, actions: [...node.actions, action] });
      }
    }
  }
  return [...plans.values()];
}

/** Only shortlist if an unusually complex board exceeds the API's option limit. */
export function placementOptions(plans: readonly PlacementPlan[]): PlacementOption[] {
  let selected = [...plans];
  if (selected.length > MAX_PLACEMENTS) {
    selected = selected
      .sort(
        (a, b) =>
          Number(a.gameOver) - Number(b.gameOver) ||
          b.linesCleared - a.linesCleared ||
          a.metrics.holes - b.metrics.holes ||
          a.metrics.maxHeight - b.metrics.maxHeight ||
          a.metrics.bumpiness - b.metrics.bumpiness,
      )
      .slice(0, MAX_PLACEMENTS);
  }
  return selected.map((plan) => ({
    id: plan.id,
    usesHold: plan.usesHold,
    landing: structuredClone(plan.landing),
    linesCleared: plan.linesCleared,
    scoreGain: plan.scoreGain,
    gameOver: plan.gameOver,
    metrics: structuredClone(plan.metrics),
    boardAfter: [...plan.boardAfter],
  }));
}
