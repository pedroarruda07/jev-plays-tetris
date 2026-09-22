import { afterEach, describe, expect, it, vi } from 'vitest';
import { TetrisGame, type ModelGameState, type PlayerAction } from '../src/game';
import {
  buildJevRequest,
  GAME_DESCRIPTION,
  GAME_GOAL,
  getJevAvailableActions,
} from '../src/jev/request';
import { parseJevDecision } from '../src/jev/response';
import { parseModelState } from '../src/jev/validation';
import { JevPlayer } from '../src/jev/player';
import { JevApiClient, JEV_ENDPOINT } from '../server/jev-client';
import type { JevTrace } from '../src/jev/types';

const initial = () => new TetrisGame(() => 0.5);
function answer(probabilities: Record<string, unknown>, choice = 'left') {
  return {
    model: 'jev-latest',
    answers: {
      nextAction: {
        type: 'choice',
        choice,
        confidence: 0.8,
        probabilities,
      },
    },
  };
}
function trace(state: ModelGameState, action: PlayerAction = 'left'): JevTrace {
  const probabilities = Object.fromEntries(
    getJevAvailableActions(state).map((key) => [key, key === action ? 1 : 0]),
  );
  const response = answer(probabilities, action);
  return {
    id: 'test-decision',
    durationMs: 10,
    request: buildJevRequest(state),
    response,
    decision: parseJevDecision(response, getJevAvailableActions(state)),
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
  vi.useRealTimers();
});

describe('Jev payload boundary', () => {
  it('preserves fractional lock timing and strips internal or unexpected fields', () => {
    const state = initial().getModelState();
    state.lockElapsedMs = 125.375;
    const parsed = parseModelState({
      ...state,
      bag: ['I'],
      status: 'playing',
      apiKey: 'not-a-real-key',
    });
    const payload = buildJevRequest(parsed);
    expect(payload.state.context).toEqual({
      ...state,
      availableActions: getJevAvailableActions(state),
      previousAction: null,
    });
    expect(Object.keys(payload.questions.nextAction.criteria)).toEqual(
      getJevAvailableActions(state),
    );
    expect(payload.state.context).not.toHaveProperty('bag');
    expect(payload.state.context).not.toHaveProperty('apiKey');
    parsed.board[0][0] = 'T';
    expect(state.board[0][0]).toBeNull();
    expect(payload.state.context.board[0][0]).toBeNull();
  });
  it('rejects malformed boards, duplicate cells, and unsupported actions', () => {
    const state = initial().getModelState();
    expect(() => parseModelState({ ...state, board: [] })).toThrow();
    expect(() => parseModelState({ ...state, availableActions: ['restart'] })).toThrow();
    expect(() =>
      parseModelState({
        ...state,
        active: { type: 'O', cells: Array(4).fill({ x: 0, y: 0 }) },
      }),
    ).toThrow();
  });
  it('sends the chosen timing mode in the instructions', () => {
    const state = initial().getModelState();
    expect(
      buildJevRequest(state, 'jev-latest', true).questions.nextAction.instructions,
    ).toContain('frozen');
    expect(buildJevRequest(state).questions.nextAction.instructions).toContain(
      'Gravity continues',
    );
  });
  it('includes action history and explains the game and strategy without prior knowledge', () => {
    const payload = buildJevRequest(
      initial().getModelState(),
      'jev-latest',
      false,
      'rotate',
    );
    expect(payload.state.context.previousAction).toBe('rotate');
    expect(GAME_DESCRIPTION).toContain('One active piece falls automatically');
    expect(GAME_DESCRIPTION).toContain('horizontal row');
    expect(GAME_DESCRIPTION).toContain('game ends');
    expect(GAME_DESCRIPTION).toContain('previousAction');
    expect(GAME_GOAL).toContain('holes');
    expect(GAME_GOAL).toContain('imminent game over');
  });
});

describe('Jev probability selection', () => {
  it('uses the highest probability even if choice disagrees, and preserves all probabilities', () => {
    const decision = parseJevDecision(answer({ left: 0.1, right: 0.9 }), [
      'left',
      'right',
    ]);
    expect(decision.action).toBe('right');
    expect(decision.modelChoice).toBe('left');
    expect(decision.probabilities).toEqual({ left: 0.1, right: 0.9 });
  });
  it('uses the returned choice to break a tie', () => {
    expect(
      parseJevDecision(answer({ left: 0.5, right: 0.5 }, 'right'), ['left', 'right'])
        .action,
    ).toBe('right');
  });
  it.each([
    { left: 0.5 },
    { left: 1, restart: 0 },
    { left: -0.1, right: 1.1 },
    { left: NaN, right: 0.5 },
    { left: 0.1, right: 0.1 },
  ])('rejects incomplete or invalid distributions: %j', (probabilities) => {
    expect(() => parseJevDecision(answer(probabilities), ['left', 'right'])).toThrow();
  });
});

describe('Jev transport', () => {
  it('sends the exact payload and bearer header only to TypeSafe AI', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(answer({ left: 1 }))));
    const client = new JevApiClient('test-key', http);
    const request = buildJevRequest(initial().getModelState());
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
  it('does not attempt a request without a key', async () => {
    const http = vi.fn<typeof fetch>();
    await expect(
      new JevApiClient('', http).evaluate(
        buildJevRequest(initial().getModelState()),
        new AbortController().signal,
      ),
    ).rejects.toThrow('JEV_API_KEY');
    expect(http).not.toHaveBeenCalled();
  });
  it('reports authentication failures without including credentials or provider error bodies', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('test-key', { status: 401 }));
    await expect(
      new JevApiClient('test-key', http).evaluate(
        buildJevRequest(initial().getModelState()),
        new AbortController().signal,
      ),
    ).rejects.toThrow('Jev rejected JEV_API_KEY');
    expect(http).toHaveBeenCalledTimes(1);
  });
});

describe('Jev play loop', () => {
  it('waits for each decision, executes it, then gets a fresh state', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const game = initial();
    const first = deferred<JevTrace>();
    const decide = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValue(new Promise(() => {}));
    const player = new JevPlayer(game, decide);
    player.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0][3]).toBeNull();
    first.resolve(trace(game.getModelState()));
    await vi.advanceTimersByTimeAsync(0);
    expect(game.getState().active?.x).toBe(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1][0].board.flat().filter(Boolean)).toHaveLength(0);
    expect(decide.mock.calls[1][3]).toBe('left');
    player.dispose();
  });
  it('stops and ignores a late reply after a restart, even if transport ignores abort', async () => {
    const game = initial();
    const result = deferred<JevTrace>();
    const player = new JevPlayer(game, () => result.promise);
    const decision = trace(game.getModelState());
    player.start();
    game.dispatch({ type: 'restart' });
    result.resolve(decision);
    await Promise.resolve();
    expect(player.getStatus().running).toBe(false);
    expect(game.getState().piecesPlaced).toBe(0);
    player.dispose();
  });
  it('discards a reply once gravity has locked its piece', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const game = initial();
    const result = deferred<JevTrace>();
    const player = new JevPlayer(game, () => result.promise);
    const decision = trace(game.getModelState());
    player.start();
    game.dispatch({ type: 'tick', deltaMs: 25_000 });
    const placed = game.getState().piecesPlaced;
    expect(placed).toBeGreaterThan(0);
    result.resolve(decision);
    await Promise.resolve();
    expect(game.getState().piecesPlaced).toBe(placed);
    expect(player.getStatus().message).toContain('State changed');
    player.dispose();
  });
  it('suspends the clock only during requests when freeze is enabled, and cancels on mode change', () => {
    const game = initial();
    const decide = vi.fn().mockReturnValue(new Promise(() => {}));
    const player = new JevPlayer(game, decide);
    player.setFreezeWhileThinking(true);
    expect(player.isClockSuspended()).toBe(false);
    player.start();
    expect(player.isClockSuspended()).toBe(true);
    const signal: AbortSignal = decide.mock.calls[0][1];
    player.setFreezeWhileThinking(false);
    expect(signal.aborted).toBe(true);
    expect(player.isClockSuspended()).toBe(false);
    expect(decide.mock.calls[1][2]).toBe(false);
    player.stop();
    expect(player.getStatus().running).toBe(false);
    player.dispose();
  });
  it('stops on game over and on API errors', async () => {
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
    expect(player.isClockSuspended()).toBe(false);
    player.dispose();
    const otherGame = initial();
    const other = new JevPlayer(otherGame, () => new Promise(() => {}));
    other.start();
    otherGame.dispatch({ type: 'tick', deltaMs: 1_000_000 });
    expect(other.getStatus()).toMatchObject({ running: false, phase: 'gameOver' });
    other.dispose();
  });
});
