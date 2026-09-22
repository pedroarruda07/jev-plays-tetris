The app keeps responsibilities in separate modules: 
- `src/game.ts` owns game rules and state.
- `src/ui.ts` renders the existing page.
- `src/input.ts` handles keyboard and touch actions.
- `src/loop.ts` advances the game clock.
- `src/main.ts` wires them together. 

Page markup lives in `index.html`; it is not assembled in a TypeScript string. 
`src/vite-env.d.ts` declares Vite client types so editor tooling understands CSS imports.

Always strive to keep things as modular as possible and reuse existing code whenever possible.
