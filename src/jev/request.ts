import type { ModelGameState, PlayerAction } from '../game';
import type { JevRequest } from './types';

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
  'board[y][x] contains only locked blocks (tetromino letters) or null for empty cells.',
  'active contains the type and absolute coordinates of all four falling cells;',
  'negative y coordinates are above the visible board.',
  'A 7-bag randomizer supplies one of each shape before reshuffling. next lists the next',
  'three pieces in spawn order. hold is the saved piece, and canHold says whether hold is',
  'currently legal; hold can be used only once before the active piece locks.',
  'availableActions contains the only legal inputs Jev may choose for this decision.',
  'previousAction is the last input Jev successfully executed in this autoplay session;',
  'null means it has not executed one yet. It is history, not an input waiting to run.',
  'Clearing 1/2/3/4 rows at once earns',
  '100/300/500/800 points, with no drop, combo, T-spin or level multiplier bonuses.',
  'Gravity starts at one row per second and speeds up by 65ms every five lines.',
  'lockElapsedMs is time already used from that delay.',
  'The game ends if a new piece cannot spawn without overlap or a piece locks with cells',
  'above the visible top. Each response selects one immediate input; after execution, Jev',
  'receives a new state and may need several successive inputs to position one piece.',
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
  'to clearing rows and reducing holes, stack height, and surface unevenness. Gravity and the',
  'lock timer place pieces automatically, so choose the best available movement, rotation, or',
  'hold input for the current snapshot and use later decisions for further inputs.',
].join(' ');

export const JEV_ACTIONS: readonly PlayerAction[] = [
  'left',
  'right',
  'rotate',
  'hold',
  // 'softDrop',
  // 'hardDrop',
];

export const ACTION_DESCRIPTIONS: Readonly<Partial<Record<PlayerAction, string>>> = {
  left: 'Move the falling piece exactly one column left, without changing its rotation.',
  right:
    'Move the falling piece exactly one column right, without changing its rotation.',
  rotate: 'Rotate the falling piece 90 degrees clockwise, applying wall kicks if needed.',
  // softDrop:
  //   'Move the falling piece exactly one row down. This does not force it to lock.',
  // hardDrop:
  //   'Drop to the lowest reachable position in the current column and rotation, then lock immediately.',
  hold: 'Save the falling piece and spawn the held piece (or next piece if hold is empty) in its initial rotation. Hold then becomes unavailable until a piece locks.',
};

export function getJevAvailableActions(state: ModelGameState): PlayerAction[] {
  return state.availableActions.filter((action) => JEV_ACTIONS.includes(action));
}

/** This object is the exact JSON body sent to TypeSafe AI. */
export function buildJevRequest(
  state: ModelGameState,
  model = 'jev-latest',
  freezeWhileThinking = false,
  previousAction: PlayerAction | null = null,
): JevRequest {
  const availableActions = getJevAvailableActions(state);
  if (!state.active || availableActions.length === 0) {
    throw new Error('Jev needs an active piece and at least one legal action.');
  }
  const context = { ...structuredClone(state), availableActions, previousAction };
  return {
    model,
    state: { game: GAME_DESCRIPTION, goal: GAME_GOAL, context },
    questions: {
      nextAction: {
        type: 'choice',
        instructions:
          'Which single legal action should be executed next to best advance the game goal ' +
          'from this exact state? Choose among the supplied actions; this is one immediate ' +
          'input, not an entire placement plan. ' +
          (freezeWhileThinking
            ? 'The game clock is frozen during this decision and advances between decisions.'
            : 'Gravity continues during the decision; the falling piece may be lower by execution time.'),
        criteria: Object.fromEntries(
          availableActions.map((action) => [action, ACTION_DESCRIPTIONS[action]!]),
        ),
      },
    },
  };
}
