import type { ModelGameState } from '../game';
import { MAX_PLACEMENTS, type PlacementOption } from '../placements';
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
  'ghost contains the active piece at the lowest position it would reach by falling straight',
  'down with no further horizontal movement or rotation. Its four cells are the projected',
  'landing position if nothing about the placement changes; it is not a second real piece.',
  'A 7-bag randomizer supplies one of each shape before reshuffling. next lists the next',
  'three pieces in spawn order. hold is the saved piece, and canHold says whether hold is',
  'currently legal; hold can be used only once before the active piece locks.',
  'Your choices are final placements, not individual movement buttons. placements lists',
  'reachable landings calculated by the game engine.',
  'Each placement has an id, usesHold, landing (type and four coordinates before rows clear),',
  'linesCleared, scoreGain, gameOver, metrics, and boardAfter. usesHold means exchanging the',
  'current piece with hold (or next when hold is empty) before placing it.',
  'boardAfter uses 20 strings of 10 cells, top to bottom: dot is empty; letters are locked cells.',
  'Metrics describe that board AFTER line clearing: holes are empty cells below locked cells;',
  'columnHeights are heights from the floor; maxHeight is their maximum; aggregateHeight is',
  'their sum; bumpiness is the sum of absolute differences between neighboring column heights.',
  'gameOver includes both locking above the top and obstructing the next spawn.',
  'Clearing 1/2/3/4 rows at once earns',
  '100/300/500/800 points, with no drop, combo, T-spin or level multiplier bonuses.',
  'Gravity starts at one row per second and speeds up by 65ms every five lines.',
  'lockElapsedMs is time already used from that delay.',
  'The game ends if a new piece cannot spawn without overlap or a piece locks with cells',
  'above the visible top. Select one supplied placement id. The controller handles the legal',
  'movement, rotation, hold and soft-drop path, then lets the normal lock delay finish.',
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
  'to clearing rows and reducing holes, stack height, and surface unevenness.',
  'Compare the supplied resulting boards and measured consequences. Avoid gameOver placements',
  'whenever a surviving option exists. Use next and hold to judge future flexibility.',
  'The ghost is only the current straight-down landing; it has no preference over alternatives.',
].join(' ');

/** This object is the exact JSON body sent to TypeSafe AI. */
export function buildJevRequest(
  state: ModelGameState,
  model = 'jev-latest',
  freezeWhileThinking = false,
  placements: readonly PlacementOption[] = [],
): JevRequest {
  if (!state.active) throw new Error('Jev needs an active piece.');
  if (
    !placements.length ||
    placements.length > MAX_PLACEMENTS ||
    new Set(placements.map(({ id }) => id)).size !== placements.length
  ) {
    throw new Error('Jev needs 1 to 255 distinct reachable placements.');
  }
  const snapshot = structuredClone(state);
  const context = {
    board: snapshot.board,
    active: snapshot.active,
    ghost: snapshot.ghost,
    next: snapshot.next,
    hold: snapshot.hold,
    canHold: snapshot.canHold,
    score: snapshot.score,
    lines: snapshot.lines,
    level: snapshot.level,
    lockElapsedMs: snapshot.lockElapsedMs,
    placements: structuredClone([...placements]),
  };
  return {
    model,
    state: { game: GAME_DESCRIPTION, goal: GAME_GOAL, context },
    questions: {
      nextPlacement: {
        type: 'choice',
        instructions:
          'Which supplied final placement best advances the game goal? Compare gameOver, ' +
          'linesCleared, scoreGain, holes, height, bumpiness, and the resulting board. ' +
          'Select its id; the controller executes the path. ' +
          (freezeWhileThinking
            ? 'The game clock is frozen during this decision and resumes for execution and locking.'
            : 'Gravity continues during the decision; the controller rechecks reachability before execution.'),
        criteria: Object.fromEntries(
          placements.map((placement) => [
            placement.id,
            `${placement.usesHold ? 'Use hold, then place' : 'Place'} ${placement.landing.type} at ` +
              `${JSON.stringify(placement.landing.cells)}. Clears ${placement.linesCleared} rows; ` +
              `gains ${placement.scoreGain} points; gameOver=${placement.gameOver}; ` +
              `holes=${placement.metrics.holes}; maxHeight=${placement.metrics.maxHeight}; ` +
              `aggregateHeight=${placement.metrics.aggregateHeight}; bumpiness=${placement.metrics.bumpiness}.`,
          ]),
        ),
      },
    },
  };
}
