# JEV plays Tetris

A responsive TypeScript Tetris game with an independent, typed game engine.

## Run

```sh
npm install
npm run dev
```

Use Node.js 20.19+ or 22.13+. `npm test` runs the rule tests; `npm run build` type-checks and builds to `dist/`; `npm run preview` serves that build.

## Repository standards

Run `npm run lint` for ESLint checks, `npm run format` to format project files, and `npm run format:check` to check formatting without changing files. VS Code is set up to format on save and apply available ESLint fixes. The shared rules live in `eslint.config.js`, `.prettierrc.json`, and `.editorconfig`.

## Controls and rules

| Action           | Key          |
| ---------------- | ------------ |
| Move             | Left / Right |
| Rotate clockwise | Up           |
| Soft drop        | Down         |
| Hard drop        | Space        |
| Hold             | C or Shift   |
| Pause / resume   | P or Escape  |
| Toggle debug log | D            |
| Toggle model log | M            |

Touch controls appear on smaller screens. Losing focus pauses the game. Personal best is saved locally when storage is available.

Press `D` to log a detached game state snapshot and the currently available player actions to the browser console immediately and at the configured logging interval. Press `D` again to stop logging.

Press `M` to log the model state on the same schedule. This compact state omits `bag`, `elapsedMs`, `gravityElapsedMs`, `lastClear`, `piecesPlaced`, and `status`. Its `active` piece contains its type and the coordinates of all four occupied cells instead of its rotation and origin. Legal player actions are included as `availableActions`.

The game uses a 10×20 board, seven colored tetrominoes, a Fisher–Yates 7-bag randomizer, three next pieces, and one hold per falling piece. Clockwise rotations use SRS wall kicks; O stays stationary. Clearing 1/2/3/4 lines awards 100/300/500/800 points, with no drop, combo, T-spin, or level multiplier bonuses.

Gravity starts at 1000ms per row and speeds up by 65ms every five lines, down to 150ms. Ground contact gives a 500ms lock delay. Movement and rotation do not reset that timer. Time off the ground suspends the lock timer. Hard drop locks immediately. Obstructed spawns and pieces locking above the board end the game.

## Let Jev play

Set `JEV_API_KEY` in the root `.env` file, then run `npm run dev`. Click **Let Jev play** or press `J` to start or stop autonomous play. Jev resumes a paused round and starts a fresh round if the previous game is over. It stops automatically at game over, on an API error, or when you pause, restart, or take manual control.

The **Freeze while thinking** checkbox switches between two modes while playing:

- Unchecked (default): normal gravity continues during requests. Replies for pieces that have already locked are discarded. The controller finds a fresh path to the chosen landing from the current position; if it is no longer reachable, it requests a new decision.
- Checked: gravity and the lock timer pause during each request, then resume for execution and locking. Changing the mode cancels the current request and gets a fresh decision.

Jev chooses a **final placement** for each piece. The local planner searches legal paths using left, right, clockwise rotation with wall kicks, soft drop, and optional hold. Each option includes its landing cells, resulting board, rows cleared, score gained, game-over flag, holes, column heights, maximum height, total height, and surface unevenness. Measurements are taken after line clearing. The request also contains the game rules and goal, model state, and ghost. Jev selects a placement ID through the TypeSafe Choice API; every option's probability is retained.

The controller rechecks reachability and executes the chosen path one normal game input at a time, with 60ms between inputs so movement is visible. It replans between inputs to account for gravity, then waits for the normal lock timer. It does not ask for another placement until the piece locks, unless the plan becomes invalid or the timing mode changes. No hard-drop input is used. Only one model request is pending at a time. Rate limits and overload responses use bounded retries with backoff; a decision times out after 30 seconds.

Equivalent landings are deduplicated, with hold and non-hold options kept distinct. Search keeps cells at or below y = -4, matching the model-state boundary. If more than 255 placements are reachable, the API limit is met by prioritizing survival, line clears, fewer holes, lower height, and a smoother surface. Otherwise every reachable placement is offered. Consequences cover the current placement and the next spawn; they do not predict a full future game.

Both the **terminal running Vite** and the **browser console** show each exact request body, raw response (including every probability), and selected placement. Candidate boards use one string per row, with a dot for an empty cell. The API key is read on the server and is never placed in the frontend bundle or logs. Keep the key named `JEV_API_KEY`, without a `VITE_` prefix. Optional `JEV_MODEL` defaults to `jev-latest`. Restart Vite after changing `.env`.

```ts
window.jev.start();
window.jev.stop();
window.jev.setFreezeWhileThinking(true);
window.jev.getStatus();
window.jev.getLastDecision(); // Request with placements, raw response, probabilities, placement ID, timing.
```

The implementation is divided into small modules:

| Module                  | Responsibility                                                    |
| ----------------------- | ----------------------------------------------------------------- |
| `src/placements.ts`     | Reachable landing search, paths, and simulated outcomes           |
| `src/board-metrics.ts`  | Holes, heights, and surface unevenness                            |
| `src/jev/execution.ts`  | Replan from live state and execute checked inputs                 |
| `src/jev/request.ts`    | Game description, goal, placement choices, exact TypeSafe payload |
| `src/jev/types.ts`      | Request, decision, and trace contracts                            |
| `src/jev/validation.ts` | Validates model state received by the server                      |
| `src/jev/response.ts`   | Validates probabilities and selects the maximum                   |
| `server/jev-client.ts`  | Authenticated HTTP transport, retries, cancellation               |
| `server/jev-route.ts`   | Local API endpoint and terminal logging                           |
| `src/jev/client.ts`     | Browser-to-server call and browser logging                        |
| `src/jev/player.ts`     | Autonomous loop, stale replies, and timing modes                  |
| `src/jev/controls.ts`   | Jev button, shortcut, and mode checkbox                           |
| `vite.config.ts`        | Loads server environment and mounts the API for dev and preview   |

This uses the [TypeSafe Choice API](https://docs.typesafe.ai/primitives/choice) at `POST https://api.typesafe.ai/v1/systemone`. `npm run build` builds the browser app; `npm run preview` runs it with the same server-side Jev route. Hosting only the static `dist/` files will require a separately deployed backend for `/api/jev/decision`.

`npm run jev:check` makes **one real API request** using your key, logs the trace, and executes its selected placement in an in-memory game. It consumes API usage. The ordinary `npm test` suite uses mocked requests and does not contact TypeSafe AI.

## Engine and automation API

`src/game.ts` has no DOM dependencies. `GameState` includes the board, active piece, next queue, remaining bag, hold slot and eligibility, status, score, lines, level, pieces placed, and all timers. Coordinates start at the upper left; active pieces can extend above the board with negative Y coordinates.

```ts
import { TetrisGame, ghostPiece } from './src/game';

const game = new TetrisGame(); // Optional RNG: () => number in [0, 1).
const snapshot = game.getState(); // Detached, serializable snapshot.
const modelState = game.getModelState(); // Compact snapshot for model input.
const actions = game.getAvailableActions(); // Player actions that can change play.
game.dispatch({ type: 'left' });
game.dispatch({ type: 'rotate' });
game.dispatch({ type: 'tick', deltaMs: 16 });
const unsubscribe = game.subscribe((state) => console.log(state.score));
unsubscribe();
ghostPiece(snapshot); // Predicted landing position.
```

`PlayerAction` is `left | right | rotate | softDrop | hardDrop | hold`. `GameAction` additionally includes `pause`, `resume`, `restart`, and `tick` with a finite positive `deltaMs`. Subscriptions receive a snapshot immediately and after each dispatch. The engine advances only when ticked; paused and ended games ignore gameplay actions.

In the browser, the same instance is exposed as **`window.tetris`**. Use `getState()`, `getModelState()`, `getAvailableActions()`, `dispatch(...)`, and `subscribe(...)` at any point. The interface supplies ticks through its animation loop; pause for stable inspection.

For simulations, use the immutable `createInitialState(rng)` and `reduceGame(state, action, rng)` functions with a seeded RNG. Replay the same actions and random sequence for deterministic results. Save the RNG's own state separately when resuming across future bag refills. Query helpers include `availableActions`, `cells`, `fits`, `ghostPiece`, `isGrounded`, and `gravityInterval`. Engine time advances at event boundaries independently of frame frequency; browser frame deltas are capped at 100ms to avoid catch-up after stalls.
