import { afterEach, describe, expect, it, vi } from 'vitest';
import { isGrounded, TetrisGame, type ModelGameState } from '../src/game';
import { placementOptions, planPlacements } from '../src/placements';
import { buildJevRequest } from '../src/jev/request';
import { parseJevDecision } from '../src/jev/response';
import { parseModelState, parsePlacements } from '../src/jev/validation';
import { JevPlayer } from '../src/jev/player';
import { requestJevDecision } from '../src/jev/client';
import { JevApiClient, JEV_ENDPOINT } from '../server/jev-client';
import type { Decide, JevTrace } from '../src/jev/types';

const initial = () => new TetrisGame(() => 0.5);
const options = () => placementOptions(planPlacements(initial().getState()));
function requestFor(state = initial().getModelState()) {
  return buildJevRequest(state, 'jev-latest', false, options());
}
function answer(probabilities: Record<string, unknown>, choice = 'a') {
  return {
    answers: {
      nextPlacement: { type: 'choice', choice, confidence: 0.8, probabilities },
    },
  };
}
function trace(state: ModelGameState, placements = options()): JevTrace {
  const id = placements[0].id;
  const response = answer(
    Object.fromEntries(placements.map((p) => [p.id, p.id === id ? 1 : 0])),
    id,
  );
  return {
    id: 'test-decision',
    durationMs: 10,
    request: buildJevRequest(state, 'jev-latest', false, placements),
    response,
    decision: parseJevDecision(
      response,
      placements.map((p) => p.id),
    ),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Jev payload boundary', () => {
  it('sends detached placement consequences while stripping internal fields', () => {
    const state = initial().getModelState();
    state.lockElapsedMs = 125.375;
    const parsed = parseModelState({
      ...state,
      bag: ['I'],
      status: 'playing',
      apiKey: 'not-a-real-key',
    });
    const candidates = options();
    const payload = buildJevRequest(parsed, 'jev-latest', true, candidates);
    expect(payload.state.context).toEqual({
      board: state.board,
      active: state.active,
      ghost: state.ghost,
      next: state.next,
      hold: state.hold,
      canHold: state.canHold,
      score: state.score,
      lines: state.lines,
      level: state.level,
      lockElapsedMs: state.lockElapsedMs,
    });
    expect(Object.keys(payload.questions.nextPlacement.criteria)).toEqual(
      candidates.map((p) => p.id),
    );
    expect(payload.questions.nextPlacement.instructions).toContain('frozen');
    expect(requestFor().questions.nextPlacement.instructions).toContain(
      'Gravity continues',
    );
    expect(payload.state.context).not.toHaveProperty('bag');
    expect(payload.state.context).not.toHaveProperty('apiKey');
    expect(payload.state.context).not.toHaveProperty('availableActions');
    expect(payload.state.context).not.toHaveProperty('placements');
    const firstCriterion = payload.questions.nextPlacement.criteria[candidates[0].id];
    expect(firstCriterion).toContain(candidates[0].boardAfter.join('\n'));
    expect(firstCriterion).toContain(JSON.stringify(candidates[0].landing.cells));
    expect(firstCriterion).toContain(`holes=${candidates[0].metrics.holes}`);
    expect(firstCriterion).toContain(
      `columnHeights=${JSON.stringify(candidates[0].metrics.columnHeights)}`,
    );
    expect(firstCriterion).toContain(`maxHeight=${candidates[0].metrics.maxHeight}`);
    expect(firstCriterion).toContain(
      `aggregateHeight=${candidates[0].metrics.aggregateHeight}`,
    );
    expect(firstCriterion).toContain(`bumpiness=${candidates[0].metrics.bumpiness}`);
    expect(firstCriterion).not.toMatch(/linesCleared|scoreGain|gameOver/);
    parsed.board[0][0] = 'T';
    candidates[0].landing.cells[0].x = 9;
    expect(payload.state.context.board[0][0]).toBeNull();
    expect(payload.questions.nextPlacement.criteria[candidates[0].id]).toBe(
      firstCriterion,
    );
  });
  it('validates candidate limits, duplicate IDs, geometry and metrics, stripping paths', () => {
    const candidates = options();
    expect(parsePlacements(candidates)).toEqual(candidates);
    expect(() => parsePlacements([])).toThrow();
    expect(() => parsePlacements(Array(256).fill(candidates[0]))).toThrow();
    expect(() => parsePlacements([candidates[0], candidates[0]])).toThrow();
    expect(() =>
      parsePlacements([
        { ...candidates[0], metrics: { ...candidates[0].metrics, holes: -1 } },
      ]),
    ).toThrow();
    expect(() =>
      parsePlacements([
        {
          ...candidates[0],
          landing: { type: 'O', cells: Array(4).fill({ x: 0, y: 0 }) },
        },
      ]),
    ).toThrow();
    expect(
      parsePlacements([{ ...candidates[0], actions: ['restart'] }])[0],
    ).not.toHaveProperty('actions');
    expect(() => buildJevRequest(initial().getModelState())).toThrow(
      'distinct reachable placements',
    );
  });
  it('rejects malformed model state', () => {
    const state = initial().getModelState();
    expect(() => parseModelState({ ...state, board: [] })).toThrow();
    expect(() => parseModelState({ ...state, availableActions: ['restart'] })).toThrow();
    expect(() => parseModelState({ ...state, ghost: null })).toThrow();
  });
});

describe('Jev probability selection', () => {
  it('selects the maximum and preserves every probability', () => {
    const decision = parseJevDecision(answer({ a: 0.1, b: 0.9 }), ['a', 'b']);
    expect(decision.placementId).toBe('b');
    expect(decision.modelChoice).toBe('a');
    expect(decision.probabilities).toEqual({ a: 0.1, b: 0.9 });
  });
  it('uses the model choice to break ties', () => {
    expect(
      parseJevDecision(answer({ a: 0.5, b: 0.5 }, 'b'), ['a', 'b']).placementId,
    ).toBe('b');
  });
  it.each([
    { a: 0.5 },
    { a: 1, unknown: 0 },
    { a: -0.1, b: 1.1 },
    { a: NaN, b: 0.5 },
    { a: 0.1, b: 0.1 },
  ])('rejects invalid distributions: %j', (probabilities) => {
    expect(() => parseJevDecision(answer(probabilities), ['a', 'b'])).toThrow();
  });
});

describe('Jev transport', () => {
  it('sends the exact payload and bearer header only to TypeSafe AI', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(answer({ a: 1 }))));
    const client = new JevApiClient('test-key', http);
    const request = requestFor();
    await client.evaluate(request, new AbortController().signal);
    expect(http).toHaveBeenCalledWith(
      JEV_ENDPOINT,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
      }),
    );
  });
  it('carries candidates through the browser and checks the returned placement', async () => {
    const state = initial().getModelState();
    const placements = options();
    const response = trace(state, placements);
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(response)));
    vi.stubGlobal('fetch', http);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'table').mockImplementation(() => {});
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    expect(
      (await requestJevDecision(state, new AbortController().signal, true, placements))
        .decision,
    ).toEqual(response.decision);
    expect(http).toHaveBeenCalledWith(
      '/api/jev/decision',
      expect.objectContaining({
        body: JSON.stringify({
          state,
          freezeWhileThinking: true,
          placements,
        }),
      }),
    );
  });
  it('does not attempt a request without a key', async () => {
    const http = vi.fn<typeof fetch>();
    await expect(
      new JevApiClient('', http).evaluate(requestFor(), new AbortController().signal),
    ).rejects.toThrow('JEV_API_KEY');
    expect(http).not.toHaveBeenCalled();
  });
  it('reports auth failures without exposing secrets', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('test-key', { status: 401 }));
    await expect(
      new JevApiClient('test-key', http).evaluate(
        requestFor(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('Jev rejected JEV_API_KEY');
    expect(http).toHaveBeenCalledTimes(1);
  });
});

describe('Jev placement loop', () => {
  it('executes one plan, waits for lock, then requests placements for the next piece', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const game = initial();
    const first = deferred<JevTrace>();
    const decide = vi
      .fn<Decide>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValue(new Promise(() => {}));
    const player = new JevPlayer(game, decide);
    player.setFreezeWhileThinking(true);
    player.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0][3].length).toBeGreaterThan(0);
    first.resolve(trace(decide.mock.calls[0][0], [...decide.mock.calls[0][3]]));
    await vi.advanceTimersByTimeAsync(0);
    expect(player.getStatus().phase).toBe('executing');
    await vi.advanceTimersByTimeAsync(5000);
    expect(isGrounded(game.getState())).toBe(true);
    expect(player.isClockSuspended()).toBe(false);
    expect(game.getState().piecesPlaced).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(decide).toHaveBeenCalledTimes(1);
    game.dispatch({ type: 'tick', deltaMs: 500 });
    await vi.advanceTimersByTimeAsync(100);
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1][3].length).toBeGreaterThan(0);
    expect(decide.mock.calls[1][0].board.flat().filter(Boolean)).toHaveLength(4);
    player.dispose();
  });
  it('ignores late replies after manual control or restart', async () => {
    for (const type of ['left', 'restart', 'hardDrop'] as const) {
      const game = initial();
      const pending = deferred<JevTrace>();
      const decision = trace(game.getModelState());
      const player = new JevPlayer(game, () => pending.promise);
      player.start();
      game.dispatch({ type });
      const state = game.getState();
      pending.resolve(decision);
      await Promise.resolve();
      expect(player.getStatus().running).toBe(false);
      expect(game.getState()).toEqual(state);
      player.dispose();
    }
  });
  it('discards a response for a piece that gravity locked', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const game = initial();
    const result = deferred<JevTrace>();
    const player = new JevPlayer(game, () => result.promise);
    const decision = trace(game.getModelState());
    player.start();
    game.dispatch({ type: 'tick', deltaMs: 25000 });
    const state = game.getState();
    expect(state.piecesPlaced).toBeGreaterThan(0);
    result.resolve(decision);
    await Promise.resolve();
    expect(game.getState()).toEqual(state);
    expect(player.getStatus().message).toContain('State changed');
    player.dispose();
  });
  it('cancels pending decisions on timing mode changes', () => {
    const game = initial();
    const decide = vi.fn<Decide>().mockReturnValue(new Promise(() => {}));
    const player = new JevPlayer(game, decide);
    player.setFreezeWhileThinking(true);
    player.start();
    expect(player.isClockSuspended()).toBe(true);
    const signal = decide.mock.calls[0][1];
    player.setFreezeWhileThinking(false);
    expect(signal.aborted).toBe(true);
    expect(player.isClockSuspended()).toBe(false);
    expect(decide.mock.calls[1][2]).toBe(false);
    player.dispose();
  });
  it('stops on game over and API errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const game = initial();
    const player = new JevPlayer(game, async () => {
      throw new Error('Unavailable');
    });
    player.start();
    await Promise.resolve();
    expect(player.getStatus()).toMatchObject({
      running: false,
      phase: 'error',
      message: 'Unavailable',
    });
    player.dispose();
    const other = new JevPlayer(game, () => new Promise(() => {}));
    other.start();
    game.dispatch({ type: 'tick', deltaMs: 1_000_000 });
    expect(other.getStatus()).toMatchObject({ running: false, phase: 'gameOver' });
    other.dispose();
  });
});
