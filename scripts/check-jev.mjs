import { createServer } from 'vite';

// One real API request through the same server route used by the browser.
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, open: false },
});
try {
  await server.listen();
  const { TetrisGame } = await server.ssrLoadModule('/src/game.ts');
  const { planPlacements, placementOptions } =
    await server.ssrLoadModule('/src/placements.ts');
  const { executePlacement } = await server.ssrLoadModule('/src/jev/execution.ts');
  const game = new TetrisGame();
  const placements = placementOptions(planPlacements(game.getState()));
  const address = server.httpServer.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/jev/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: game.getModelState(),
      freezeWhileThinking: true,
      placements,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  const target = placements.find(({ id }) => id === result.decision.placementId);
  if (
    !target ||
    !(await executePlacement(game, target, 0, new AbortController().signal, {
      actionIntervalMs: 0,
    }))
  ) {
    throw new Error('Selected placement could not be executed.');
  }
  game.dispatch({ type: 'tick', deltaMs: 500 });
  console.info(
    'Live Jev check succeeded:',
    result.decision.placementId,
    `(${result.durationMs.toFixed(0)}ms)`,
  );
} finally {
  await server.close();
}
