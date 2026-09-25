import { createServer } from 'vite';

// One real API request through the same server route used by the browser.
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, open: false },
});
try {
  await server.listen();
  const { TetrisGame } = await server.ssrLoadModule('/src/game.ts');
  const game = new TetrisGame();
  const address = server.httpServer.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/jev/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: game.getModelState(),
      freezeWhileThinking: true,
      previousActions: [],
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  game.dispatch({ type: result.decision.action });
  console.info(
    'Live Jev check succeeded:',
    result.decision.action,
    `(${result.durationMs.toFixed(0)}ms)`,
  );
} finally {
  await server.close();
}
