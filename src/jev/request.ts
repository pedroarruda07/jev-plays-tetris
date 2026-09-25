import type { ModelGameState, PlayerAction } from '../game';
import { JEV_ACTION_HISTORY_LIMIT, type JevRequest } from './types';

export const GAME_DESCRIPTION = [
  'This is a falling-block puzzle played on a 10-column, 20-row board.',
  'Each piece is one of seven shapes (I, O, T, S, Z, J, or L) made from four cells.',
  'One active piece falls automatically. Before it locks into the board, it can be moved',
  'left or right one column at a time, rotated clockwise, or exchanged with the hold slot.',
  'A move is legal only when every active cell remains inside the horizontal board bounds',
  'and does not overlap a locked cell. Rotation may use a small wall kick to fit near an edge.',
  'When gravity cannot move a grounded piece down, a 500ms lock delay starts. Movement and',
  'rotation do not reset that timer; airborne time suspends it. After the delay, its four',
  'cells become locked board cells and the next piece spawns at the top.',
  'Whenever every cell in a horizontal row is filled, that row disappears and all rows',
  'above it move down. Multiple complete rows can disappear after one piece locks.',
  'Coordinates start at the top left:',
  'x increases rightward from 0 to 9; y increases downward from 0 to 19.',
  'occupied lists the coordinates of locked cells. All visible coordinates not in occupied',
  'are empty; the full 20-by-10 board array is not sent.',
  'active contains the type and absolute coordinates of all four falling cells;',
  'negative y coordinates are above the visible board.',
  'ghost contains the active piece at the lowest position it would reach if it fell',
  'straight down without further movement or rotation. Its cells show the landing for',
  'the current placement; it is a projection, not a second piece.',
  'landingPositions lists all distinct four-cell final positions reachable from the active',
  'piece by legal left, right, clockwise rotation, and downward moves. Each entry is the',
  'four coordinates the piece would occupy when grounded. The ghost is one of these entries.',
  'These are geometric possibilities; gravity and the remaining lock time may prevent',
  'reaching distant positions in time. Hold would spawn a different piece and is not included.',
  'A 7-bag randomizer supplies one of each shape before reshuffling. next lists the next',
  'three pieces in spawn order. hold is the saved piece, and canHold says whether hold is',
  'currently legal; hold can be used only once before the active piece locks.',
  'availableActions contains the only legal inputs Jev may choose for this decision.',
  'previousActions contains up to three inputs Jev already executed, oldest first.',
  'An empty list means no input has run yet. The list may include inputs for an earlier piece.',
  'Clearing 1/2/3/4 rows at once earns',
  '100/300/500/800 points, with no drop, combo, T-spin or level multiplier bonuses.',
  'Gravity starts at one row per second and speeds up by 65ms every five lines.',
  'lockElapsedMs is time already used from that delay.',
  'The game ends if a new piece cannot spawn without overlap or a piece locks with cells',
  'above the visible top. Each response selects one immediate input. After that input',
  'executes, Jev receives an updated state and can choose another input for the same',
  'falling piece until it locks. Gravity also moves the piece between requests.',
].join(' ');

export const GAME_GOAL = [
  'Maximize total score and survive as long as possible by positioning each falling piece',
  'before it locks. Fill all ten cells of horizontal rows to clear them and score points.',
  'Prevent the locked stack from reaching the spawn area at the top of the board.',
  'Prefer placements that keep the stack low and reasonably even, complete rows, and leave',
  'useful open surfaces for the upcoming pieces. Avoid creating holes (empty cells with locked',
  'cells above them), deep narrow gaps that the available shapes cannot reach, tall isolated',
  'columns, and overhangs that trap empty space. Use the next-three preview and hold slot to',
  'plan beyond the active piece. Give highest priority to avoiding imminent game over, then',
  'to clearing rows and reducing holes, stack height, and surface unevenness. For the active',
  'piece, first identify the best landing in landingPositions using occupied to see which',
  'rows it would fill. Compare that target with the ghost, which shows where the piece would',
  'land without further changes. If lockElapsedMs is high, favor a target reachable quickly.',
  'Take the next step toward the target while there is time; later responses can continue',
  'moving and rotating this same piece. Use softDrop only after the piece is positioned for',
  'the desired landing or no useful placement change remains. Falling downward by itself',
  'does not improve the board or score; gravity and the lock timer handle that automatically.',
].join(' ');

export const JEV_ACTIONS: readonly PlayerAction[] = [
  'left',
  'right',
  'rotate',
  'hold',
  'softDrop',
  // 'hardDrop',
];

export const ACTION_DESCRIPTIONS: Readonly<Partial<Record<PlayerAction, string>>> = {
  left: 'Move the falling piece exactly one column left. Prefer this when it moves toward a better reachable landing, even when additional left moves or a rotation must follow.',
  right:
    'Move the falling piece exactly one column right. Prefer this when it moves toward a better reachable landing, even when additional right moves or a rotation must follow.',
  rotate:
    'Rotate the falling piece 90 degrees clockwise, applying wall kicks if needed. Prefer this when the new orientation helps reach a better landing, even when more moves or rotations must follow.',
  softDrop:
    'Move the piece exactly one row down when possible, keeping its column and rotation. If grounded, its position stays the same while the normal lock timer continues. This does not clear lines or lock immediately. Prefer this only if the current ghost is already a good final landing or no placement change would help. Falling sooner alone is not useful.',
  // hardDrop:
  //   'Drop to the lowest reachable position in the current column and rotation, then lock immediately.',
  hold: 'Save the falling piece and spawn the held piece (or next piece if hold is empty) in its initial rotation. Hold then becomes unavailable until a piece locks. Prefer this if the incoming piece offers a better reachable placement or saving the active piece helps a future placement.',
};

export function getJevAvailableActions(state: ModelGameState): PlayerAction[] {
  return state.availableActions.filter((action) => JEV_ACTIONS.includes(action));
}

/** This object is the exact JSON body sent to TypeSafe AI. */
export function buildJevRequest(
  state: ModelGameState,
  model = 'jev-latest',
  freezeWhileThinking = false,
  previousActions: readonly PlayerAction[] = [],
): JevRequest {
  const availableActions = getJevAvailableActions(state);
  if (!state.active || availableActions.length === 0) {
    throw new Error('Jev needs an active piece and at least one legal action.');
  }
  if (previousActions.length > JEV_ACTION_HISTORY_LIMIT) {
    throw new Error(`Jev accepts at most ${JEV_ACTION_HISTORY_LIMIT} previous actions.`);
  }
  const context = {
    ...structuredClone(state),
    availableActions,
    previousActions: [...previousActions],
  };
  return {
    model,
    state: { game: GAME_DESCRIPTION, goal: GAME_GOAL, context },
    questions: {
      nextAction: {
        type: 'choice',
        instructions:
          'Which one legal input should be executed next to move toward the best reachable ' +
          'final landing for this piece? Compare landingPositions with occupied and the ' +
          'current ghost. Select one step toward the target even if further moves or rotations ' +
          'are needed: after this input, you will receive a fresh state and can act again on ' +
          'the same piece. Use softDrop only when the current landing is already good or no ' +
          'useful placement change remains. Use previousActions as history, not as commands ' +
          'to repeat blindly. ' +
          (freezeWhileThinking
            ? 'The game clock is frozen during this decision and advances between decisions.'
            : 'Gravity continues during this decision; the falling piece may be lower by execution time.'),
        criteria: Object.fromEntries(
          availableActions.map((action) => [action, ACTION_DESCRIPTIONS[action]!]),
        ),
      },
    },
  };
}
