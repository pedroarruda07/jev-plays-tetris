import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cells,
  createInitialState,
  isGrounded,
  LOCK_DELAY,
  reduceGame,
  TetrisGame,
  type PieceType,
  type PlayerAction,
} from '../src/game';
import { boardMetrics } from '../src/board-metrics';
import { placementOptions, planPlacements } from '../src/placements';
import { executePlacement } from '../src/jev/execution';

const initial = () => createInitialState(() => 0.5);

afterEach(() => vi.useRealTimers());

describe('placement planner', () => {
  it.each<[PieceType, number]>([
    ['I', 17],
    ['O', 9],
    ['T', 34],
    ['S', 17],
    ['Z', 17],
    ['J', 34],
    ['L', 34],
  ])('finds all distinct empty-board landings for %s (%i)', (type, count) => {
    const state = initial();
    state.active = { type, rotation: 0, x: type === 'O' ? 4 : 3, y: 0 };
    state.canHold = false;
    const before = structuredClone(state);
    const plans = planPlacements(state);
    expect(plans).toHaveLength(count);
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(count);
    expect(state).toEqual(before);
    for (const plan of plans) {
      const landed = plan.actions.reduce(
        (s, type) => reduceGame(s, { type }, () => 0.5),
        state,
      );
      expect(isGrounded(landed)).toBe(true);
      expect(cells(landed.active!)).toEqual(plan.landing.cells);
      const after = reduceGame(landed, { type: 'tick', deltaMs: LOCK_DELAY }, () => 0.5);
      expect(plan.boardAfter).toEqual(
        after.board.map((row) => row.map((cell) => cell ?? '.').join('')),
      );
      expect(plan.metrics).toEqual(boardMetrics(after.board));
    }
  });
  it('includes hold paths only when allowed, without consuming the real bag', () => {
    const state = initial();
    const before = structuredClone(state);
    const held = planPlacements(state).filter((p) => p.usesHold);
    expect(held.length).toBeGreaterThan(0);
    expect(
      held.every((p) => p.landing.type === state.next[0] && p.actions[0] === 'hold'),
    ).toBe(true);
    expect(state).toEqual(before);
    state.hold = 'I';
    expect(
      planPlacements(state)
        .filter((p) => p.usesHold)
        .every((p) => p.landing.type === 'I'),
    ).toBe(true);
    state.canHold = false;
    expect(planPlacements(state).some((p) => p.usesHold)).toBe(false);
  });
  it('reports four-line clear consequences after rows disappear', () => {
    const state = initial();
    state.active = { type: 'I', rotation: 0, x: 3, y: 0 };
    state.canHold = false;
    for (let y = 16; y < 20; y++)
      state.board[y] = Array.from({ length: 10 }, (_, x) => (x === 5 ? null : 'J'));
    const tetris = planPlacements(state).find((p) => p.linesCleared === 4)!;
    expect(tetris).toBeDefined();
    expect(tetris.scoreGain).toBe(800);
    expect(tetris.metrics).toMatchObject({
      holes: 0,
      maxHeight: 0,
      aggregateHeight: 0,
      bumpiness: 0,
    });
    expect(tetris.boardAfter.every((row) => row === '..........')).toBe(true);
  });
  it('finds a slide under an overhang that a straight-down projection cannot reach', () => {
    const state = initial();
    state.active = { type: 'O', rotation: 0, x: 0, y: 0 };
    state.canHold = false;
    for (let x = 2; x < 10; x++) state.board[16][x] = 'J';
    const tucked = planPlacements(state).find(
      (p) =>
        Math.min(...p.landing.cells.map(({ x }) => x)) === 4 &&
        Math.min(...p.landing.cells.map(({ y }) => y)) === 18,
    )!;
    expect(tucked).toBeDefined();
    const landed = tucked.actions.reduce((s, type) => reduceGame(s, { type }), state);
    expect(cells(landed.active!)).toEqual(tucked.landing.cells);
  });
  it('flags locking above the top and obstructed next spawns as game over', () => {
    const state = initial();
    state.canHold = false;
    state.active = { type: 'O', rotation: 0, x: 4, y: -1 };
    state.board[1][4] = 'J';
    expect(planPlacements(state).find((p) => p.actions.length === 0)?.gameOver).toBe(
      true,
    );
    const blocked = initial();
    blocked.canHold = false;
    blocked.active = { type: 'O', rotation: 0, x: 0, y: 18 };
    blocked.next[0] = 'O';
    blocked.board[0][4] = 'J';
    expect(planPlacements(blocked).find((p) => p.actions.length === 0)?.gameOver).toBe(
      true,
    );
  });
  it('returns nothing for inactive games and detaches public options without paths', () => {
    const state = initial();
    expect(planPlacements({ ...state, status: 'paused' })).toEqual([]);
    expect(planPlacements({ ...state, active: null })).toEqual([]);
    const plans = planPlacements(state);
    const options = placementOptions(plans);
    expect(options[0]).not.toHaveProperty('actions');
    options[0].landing.cells[0].x = 100;
    expect(plans[0].landing.cells[0].x).not.toBe(100);
    expect(
      placementOptions(
        Array.from({ length: 300 }, (_, i) => ({ ...plans[0], id: String(i) })),
      ),
    ).toHaveLength(255);
  });
});

describe('board measurements', () => {
  it('counts covered holes and adjacent height differences', () => {
    const state = initial();
    state.board[17][0] = 'I';
    state.board[19][0] = 'I';
    state.board[19][1] = 'O';
    expect(boardMetrics(state.board)).toEqual({
      holes: 1,
      maxHeight: 3,
      aggregateHeight: 4,
      bumpiness: 3,
      columnHeights: [3, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  });
});

describe('placement execution', () => {
  it('rejects a landing cut off by a wall after the piece has fallen', async () => {
    const state = initial();
    state.canHold = false;
    state.active = { type: 'O', rotation: 0, x: 6, y: 0 };
    for (let y = 10; y < 20; y++) state.board[y][4] = 'J';
    const target = planPlacements(state).find((p) =>
      p.landing.cells.some(({ x }) => x === 0),
    )!;
    expect(target).toBeDefined();
    state.active.y = 18;
    const game = new TetrisGame(() => 0.5);
    const snapshot = vi.spyOn(game, 'getState').mockReturnValue(state);
    const dispatch = vi.spyOn(game, 'dispatch');
    expect(
      await executePlacement(game, target, 0, new AbortController().signal, {
        actionIntervalMs: 0,
      }),
    ).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    snapshot.mockRestore();
    dispatch.mockRestore();
  });
  it('replans after gravity, reaches the target and preserves natural lock delay', async () => {
    const game = new TetrisGame(() => 0.5);
    const target = planPlacements(game.getState()).find(
      (p) => !p.usesHold && p.landing.cells.some(({ x }) => x === 0),
    )!;
    game.dispatch({ type: 'tick', deltaMs: 2000 });
    expect(
      await executePlacement(game, target, 0, new AbortController().signal, {
        actionIntervalMs: 0,
      }),
    ).toBe(true);
    expect(isGrounded(game.getState())).toBe(true);
    expect(game.getState().piecesPlaced).toBe(0);
    game.dispatch({ type: 'tick', deltaMs: 499 });
    expect(game.getState().piecesPlaced).toBe(0);
    game.dispatch({ type: 'tick', deltaMs: 1 });
    expect(game.getState().piecesPlaced).toBe(1);
  });
  it('executes a hold placement through engine inputs', async () => {
    const game = new TetrisGame(() => 0.5);
    const old = game.getState().active!.type;
    const target = planPlacements(game.getState()).find((p) => p.usesHold)!;
    expect(
      await executePlacement(game, target, 0, new AbortController().signal, {
        actionIntervalMs: 0,
      }),
    ).toBe(true);
    expect(game.getState().hold).toBe(old);
    expect(game.getState().active!.type).toBe(target.landing.type);
    expect(cells(game.getState().active!)).toEqual(target.landing.cells);
  });
  it('dispatches inputs individually at the configured interval', async () => {
    vi.useFakeTimers();
    const game = new TetrisGame(() => 0.5);
    const target = planPlacements(game.getState()).find(
      (plan) => !plan.usesHold && plan.actions.length > 3,
    )!;
    const dispatch = vi.fn((action: PlayerAction) => game.dispatch({ type: action }));
    const execution = executePlacement(game, target, 0, new AbortController().signal, {
      actionIntervalMs: 60,
      dispatch,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    expect(await execution).toBe(true);
    expect(dispatch.mock.calls.length).toBeGreaterThan(3);
  });
  it('refuses aborted, stale and unreachable targets without moving the piece', async () => {
    const game = new TetrisGame(() => 0.5);
    const target = planPlacements(game.getState())[0];
    const before = game.getState();
    expect(await executePlacement(game, target, 0, AbortSignal.abort())).toBe(false);
    expect(await executePlacement(game, target, 1, new AbortController().signal)).toBe(
      false,
    );
    expect(
      await executePlacement(
        game,
        { ...target, id: 'missing' },
        0,
        new AbortController().signal,
      ),
    ).toBe(false);
    expect(game.getState()).toEqual(before);
  });
});
