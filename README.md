# JEV / Tetris

A responsive TypeScript Tetris game with an independent, typed game engine.

## Run

```sh
npm install
npm run dev
```

Use Node.js 20.19+ or 22.13+. On PowerShell with restricted script execution, use `npm.cmd` instead of `npm`. `npm test` runs the rule tests; `npm run build` type-checks and builds to `dist/`; `npm run preview` serves that build.

## Repository standards

Run `npm run lint` for ESLint checks, `npm run format` to format project files, and `npm run format:check` to check formatting without changing files. VS Code is set up to format on save and apply available ESLint fixes. The shared rules live in `eslint.config.js`, `.prettierrc.json`, and `.editorconfig`.

The app keeps responsibilities in separate modules: `src/game.ts` owns game rules and state, `src/ui.ts` renders the existing page, `src/input.ts` handles keyboard and touch actions, `src/loop.ts` advances the game clock, and `src/main.ts` wires them together. Page markup lives in `index.html`; it is not assembled in a TypeScript string. `src/vite-env.d.ts` declares Vite client types so editor tooling understands CSS imports.

## Controls and rules

| Action           | Key          |
| ---------------- | ------------ |
| Move             | Left / Right |
| Rotate clockwise | Up           |
| Soft drop        | Down         |
| Hard drop        | Space        |
| Hold             | C or Shift   |
| Pause / resume   | P or Escape  |

Touch controls appear on smaller screens. Losing focus pauses the game. Personal best is saved locally when storage is available.

The game uses a 10×20 board, seven colored tetrominoes, a Fisher–Yates 7-bag randomizer, three next pieces, and one hold per falling piece. Clockwise rotations use SRS wall kicks; O stays stationary. Clearing 1/2/3/4 lines awards 100/300/500/800 points, with no drop, combo, T-spin, or level multiplier bonuses.

Gravity starts at 1000ms per row and speeds up by 65ms every five lines, down to 150ms. Ground contact gives a 500ms lock delay. Successful grounded movement or rotation resets it up to 15 times per piece. Time off the ground suspends the lock timer. Hard drop locks immediately. Obstructed spawns and pieces locking above the board end the game.

## Engine and automation API

`src/game.ts` has no DOM dependencies. `GameState` includes the board, active piece, next queue, remaining bag, hold slot and eligibility, status, score, lines, level, pieces placed, and all timers. Coordinates start at the upper left; active pieces can extend above the board with negative Y coordinates.

```ts
import { TetrisGame, ghostPiece } from './src/game';

const game = new TetrisGame(); // Optional RNG: () => number in [0, 1).
const snapshot = game.getState(); // Detached, serializable snapshot.
const actions = game.getAvailableActions(); // Player actions that can change play.
game.dispatch({ type: 'left' });
game.dispatch({ type: 'rotate' });
game.dispatch({ type: 'tick', deltaMs: 16 });
const unsubscribe = game.subscribe((state) => console.log(state.score));
unsubscribe();
ghostPiece(snapshot); // Predicted landing position.
```

`PlayerAction` is `left | right | rotate | softDrop | hardDrop | hold`. `GameAction` additionally includes `pause`, `resume`, `restart`, and `tick` with a finite positive `deltaMs`. Subscriptions receive a snapshot immediately and after each dispatch. The engine advances only when ticked; paused and ended games ignore gameplay actions.

In the browser, the same instance is exposed as **`window.tetris`**. Use `getState()`, `getAvailableActions()`, `dispatch(...)`, and `subscribe(...)` at any point. The interface supplies ticks through its animation loop; pause for stable inspection.

For simulations, use the immutable `createInitialState(rng)` and `reduceGame(state, action, rng)` functions with a seeded RNG. Replay the same actions and random sequence for deterministic results. Save the RNG's own state separately when resuming across future bag refills. Query helpers include `availableActions`, `cells`, `fits`, `ghostPiece`, `isGrounded`, and `gravityInterval`. Engine time advances at event boundaries independently of frame frequency; browser frame deltas are capped at 100ms to avoid catch-up after stalls.
