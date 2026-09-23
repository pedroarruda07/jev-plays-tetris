import { describe, expect, it } from 'vitest';
import {
  availableActions,
  cells,
  createInitialState,
  fits,
  ghostPiece,
  gravityInterval,
  reduceGame,
  TetrisGame,
  TYPES,
  type GameState,
  type PieceType,
} from '../src/game';
const initial = () => createInitialState(() => 0.5);
function lineFixture(count: number): GameState {
  const state = initial();
  for (let y = 20 - count; y < 20; y++)
    state.board[y] = Array.from({ length: 10 }, (_, x) => (x === 5 ? null : 'J'));
  state.active = { type: 'I', rotation: 1, x: 3, y: 15 };
  return state;
}
describe('Tetris rules', () => {
  it('generates seven unique pieces per bag and previews three', () => {
    let state = initial();
    const sequence: PieceType[] = [];
    for (let i = 0; i < 35; i++) {
      sequence.push(state.active!.type);
      expect(state.next).toHaveLength(3);
      state = reduceGame(state, { type: 'hardDrop' }, () => 0.5);
      state.board = initial().board;
    }
    for (let i = 0; i < 35; i += 7)
      expect(sequence.slice(i, i + 7).sort()).toEqual([...TYPES].sort());
  });
  it('keeps four distinct blocks in every rotation', () => {
    for (const type of TYPES)
      for (const rotation of [0, 1, 2, 3] as const)
        expect(
          new Set(cells({ type, rotation, x: 0, y: 0 }).map((p) => `${p.x},${p.y}`)).size,
        ).toBe(4);
  });
  it('blocks wall movement and kicks I away from the left wall', () => {
    const state = initial();
    state.active = { type: 'I', rotation: 1, x: -2, y: 5 };
    expect(fits(state, state.active)).toBe(true);
    expect(availableActions(state)).not.toContain('left');
    expect(reduceGame(state, { type: 'rotate' }).active).toEqual({
      type: 'I',
      rotation: 2,
      x: 0,
      y: 5,
    });
  });
  it('kicks T off the floor', () => {
    const state = initial();
    state.active = { type: 'T', rotation: 0, x: 3, y: 18 };
    const rotated = reduceGame(state, { type: 'rotate' });
    expect(rotated.active!.rotation).toBe(1);
    expect(rotated.active!.y).toBe(17);
  });
  it('allows hold once, resets after lock, and preserves next queue during a swap', () => {
    const state = initial();
    const first = state.active!.type;
    let held = reduceGame(state, { type: 'hold' });
    expect(held.hold).toBe(first);
    expect(held.active!.type).toBe(state.next[0]);
    expect(held.canHold).toBe(false);
    expect(reduceGame(held, { type: 'hold' })).toEqual(held);
    held = reduceGame(held, { type: 'hardDrop' });
    expect(held.canHold).toBe(true);
    const next = [...held.next];
    held = reduceGame(held, { type: 'hold' });
    expect(held.active!.type).toBe(first);
    expect(held.active!.rotation).toBe(0);
    expect(held.next).toEqual(next);
  });
  it.each([
    [1, 100],
    [2, 300],
    [3, 500],
    [4, 800],
  ])('clears %i rows for %i points', (count, score) => {
    const state = reduceGame(lineFixture(count), { type: 'hardDrop' });
    expect(state.lines).toBe(count);
    expect(state.score).toBe(score);
    expect(state.board).toHaveLength(20);
    expect(state.board.flat().filter(Boolean)).toHaveLength(4 - count);
  });
  it('speeds up every five lines without multiplying scores', () => {
    const state = lineFixture(1);
    state.lines = 4;
    const result = reduceGame(state, { type: 'hardDrop' });
    expect(result.level).toBe(2);
    expect(result.score).toBe(100);
    expect(gravityInterval(result)).toBe(935);
  });
  it('hard drop immediately locks at the ghost without bonuses', () => {
    const state = initial();
    const ghost = ghostPiece(state)!;
    const dropped = reduceGame(state, { type: 'hardDrop' });
    for (const { x, y } of cells(ghost)) expect(dropped.board[y][x]).toBe(ghost.type);
    expect(dropped.piecesPlaced).toBe(1);
    expect(dropped.score).toBe(0);
  });
  it('exposes projected ghost cells and soft drop in the model state', () => {
    const game = new TetrisGame(() => 0.5);
    const model = game.getModelState();
    const state = game.getState();
    const ghost = ghostPiece(state)!;
    expect(model.ghost).toEqual({ type: ghost.type, cells: cells(ghost) });
    expect(model.availableActions).toContain('softDrop');

    state.active = ghost;
    expect(availableActions(state)).toContain('softDrop');
    const grounded = reduceGame(state, { type: 'softDrop' });
    expect(grounded.active).toEqual(ghost);
  });
  it('starts gravity at one second', () => {
    const state = initial();
    let next = reduceGame(state, { type: 'tick', deltaMs: 999 });
    expect(next.active!.y).toBe(state.active!.y);
    next = reduceGame(next, { type: 'tick', deltaMs: 1 });
    expect(next.active!.y).toBe(state.active!.y + 1);
  });
  it('gives 500ms lock delay without resetting after movement', () => {
    let state = initial();
    state.active = ghostPiece(state);
    state = reduceGame(state, { type: 'tick', deltaMs: 499 });
    expect(state.piecesPlaced).toBe(0);
    state = reduceGame(state, { type: 'left' });
    expect(state.lockElapsedMs).toBe(499);
    expect(reduceGame(state, { type: 'tick', deltaMs: 1 }).piecesPlaced).toBe(1);
  });
  it('processes elapsed time independently of frame frequency', () => {
    const state = initial();
    const large = reduceGame(state, { type: 'tick', deltaMs: 25000 }, () => 0.5);
    let small = state;
    for (let i = 0; i < 250; i++)
      small = reduceGame(small, { type: 'tick', deltaMs: 100 }, () => 0.5);
    expect(large).toEqual(small);
  });
  it('freezes paused games and ignores invalid time deltas', () => {
    const state = initial();
    const paused = reduceGame(state, { type: 'pause' });
    expect(reduceGame(paused, { type: 'tick', deltaMs: 3000 })).toEqual(paused);
    expect(reduceGame(paused, { type: 'hardDrop' })).toEqual(paused);
    expect(availableActions(paused)).toEqual([]);
    for (const deltaMs of [-1, NaN, Infinity])
      expect(reduceGame(state, { type: 'tick', deltaMs })).toEqual(state);
    expect(reduceGame(paused, { type: 'resume' }).status).toBe('playing');
  });
  it('ends on obstructed spawn and restarts cleanly', () => {
    const state = initial();
    state.active = { type: 'O', rotation: 0, x: 0, y: 18 };
    state.board[0] = Array.from({ length: 10 }, (_, x) => (x === 0 ? null : 'Z'));
    state.board[1] = [...state.board[0]];
    const result = reduceGame(state, { type: 'hardDrop' });
    expect(result.status).toBe('gameOver');
    expect(availableActions(result)).toEqual([]);
    expect(reduceGame(result, { type: 'restart' }).status).toBe('playing');
  });
  it('ends when locking above the top', () => {
    const state = initial();
    state.active = { type: 'O', rotation: 0, x: 4, y: -1 };
    state.board[1][4] = 'J';
    expect(reduceGame(state, { type: 'hardDrop' }).status).toBe('gameOver');
  });
  it('provides immutable transitions, detached snapshots, and subscriptions', () => {
    const state = initial();
    const before = structuredClone(state);
    reduceGame(state, { type: 'hardDrop' });
    expect(state).toEqual(before);
    const game = new TetrisGame(() => 0.5);
    game.getState().board[0][0] = 'I';
    expect(game.getState().board[0][0]).toBeNull();
    let calls = 0;
    const unsubscribe = game.subscribe((snapshot) => {
      snapshot.score = 999;
      calls++;
    });
    game.dispatch({ type: 'left' });
    unsubscribe();
    game.dispatch({ type: 'right' });
    expect(calls).toBe(2);
    expect(game.getState().score).toBe(0);
    expect(JSON.parse(JSON.stringify(game.getState()))).toEqual(game.getState());
  });
});
