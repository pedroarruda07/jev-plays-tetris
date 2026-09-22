import {
  cells,
  ghostPiece,
  isGrounded,
  LOCK_DELAY,
  type GameState,
  type Piece,
  type PieceType,
} from './game';
import type { TetrisGame } from './game';

const WIDTH = 10;
const HEIGHT = 20;
const BEST_SCORE_KEY = 'jev-tetris-best';
const LINE_MESSAGES = [
  '',
  'One line. Nice and clean.',
  'Double. Finding your rhythm.',
  'Triple. Room to breathe.',
  'Tetris. Beautifully done.',
];

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required game element: #${id}`);
  return element as T;
}

function renderPiecePreview(type: PieceType | null): DocumentFragment {
  const preview = document.createDocumentFragment();

  if (!type) {
    const emptySlot = document.createElement('span');
    emptySlot.className = 'empty-hold';
    emptySlot.textContent = '+';
    preview.append(emptySlot);
    return preview;
  }

  const blocks = cells({ type, rotation: 0, x: 0, y: 0 });
  const minX = Math.min(...blocks.map(({ x }) => x));
  const minY = Math.min(...blocks.map(({ y }) => y));
  const width = Math.max(...blocks.map(({ x }) => x)) - minX + 1;
  const height = Math.max(...blocks.map(({ y }) => y)) - minY + 1;
  const piecePreview = document.createElement('div');

  piecePreview.className = 'mini';
  piecePreview.setAttribute('aria-label', `${type} piece`);
  piecePreview.style.width = `${width * 24}px`;
  piecePreview.style.height = `${height * 24}px`;

  for (const position of blocks) {
    const block = document.createElement('span');
    block.classList.add('block', type);
    block.style.left = `${(position.x - minX) * 24}px`;
    block.style.top = `${(position.y - minY) * 24}px`;
    piecePreview.append(block);
  }

  preview.append(piecePreview);
  return preview;
}

function readBestScore(): number {
  try {
    return Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
  } catch {
    return 0;
  }
}

export class GameView {
  private readonly boardCells: HTMLDivElement[] = [];
  private readonly board = getElement<HTMLDivElement>('board');
  private readonly hold = getElement<HTMLDivElement>('hold');
  private readonly next = getElement<HTMLDivElement>('next');
  private readonly pauseButton = getElement<HTMLButtonElement>('pause');
  private readonly overlay = getElement<HTMLDivElement>('overlay');
  private readonly continueButton = getElement<HTMLButtonElement>('continue');
  private bestScore = readBestScore();
  private previewKey = '';

  constructor(game: TetrisGame) {
    const boardContents = document.createDocumentFragment();

    for (let index = 0; index < WIDTH * HEIGHT; index++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      this.boardCells.push(cell);
      boardContents.append(cell);
    }

    this.board.append(boardContents);
    game.subscribe((state) => this.render(state));
  }

  private render(state: GameState): void {
    const classes = state.board
      .flat()
      .map((cell) => (cell ? `cell block ${cell}` : 'cell'));
    const ghost = ghostPiece(state);

    this.boardCells.forEach((cell, index) => {
      const className = classes[index];
      if (className && cell.className !== className) cell.className = className;
    });

    // Paint transient pieces after the settled board so they are not erased by
    // the board refresh. The active piece follows the ghost so it stays on top
    // when both occupy the same cells at the landing position.
    if (ghost && state.status !== 'gameOver') this.renderPiece(ghost, 'ghost');
    if (state.active) this.renderPiece(state.active, 'block');

    this.renderStats(state);
    this.renderStatus(state);
    this.renderPreviews(state);
  }

  private renderPiece(piece: Piece, appearance: 'block' | 'ghost'): void {
    for (const position of cells(piece)) {
      if (position.y < 0 || position.y >= HEIGHT) continue;

      const index = position.y * WIDTH + position.x;
      const cell = this.boardCells[index];
      if (cell) cell.className = `cell ${appearance} ${piece.type}`;
    }
  }

  private renderStats(state: GameState): void {
    if (state.score > this.bestScore) {
      this.bestScore = state.score;
      try {
        localStorage.setItem(BEST_SCORE_KEY, String(this.bestScore));
      } catch {
        // Best scores are optional when browser storage is unavailable.
      }
    }

    getElement('score').textContent = String(state.score).padStart(6, '0');
    getElement('best').textContent = this.bestScore.toLocaleString();
    getElement('level').textContent = String(state.level).padStart(2, '0');
    getElement('lines').textContent = String(state.lines).padStart(2, '0');
    getElement<HTMLDivElement>('progress').style.width = `${(state.lines % 5) * 20}%`;

    const linesToLevel = 5 - (state.lines % 5);
    getElement('level-note').textContent =
      `${linesToLevel} ${linesToLevel === 1 ? 'line' : 'lines'} to the next level`;

    const seconds = Math.floor(state.elapsedMs / 1000);
    getElement('time').textContent =
      `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    getElement('board-note').textContent =
      state.lastClear > 0
        ? (LINE_MESSAGES[state.lastClear] ?? 'Find a place for every piece.')
        : 'Find a place for every piece.';
    getElement<HTMLSpanElement>('lock').style.width =
      `${isGrounded(state) ? (state.lockElapsedMs / LOCK_DELAY) * 100 : 0}%`;
  }

  private renderStatus(state: GameState): void {
    const status =
      state.status === 'playing'
        ? 'IN PLAY'
        : state.status === 'paused'
          ? 'PAUSED'
          : 'GAME OVER';

    getElement('status').textContent = status;
    this.pauseButton.disabled = state.status === 'gameOver';
    this.pauseButton.setAttribute(
      'aria-label',
      state.status === 'paused' ? 'Resume game' : 'Pause game',
    );
    getElement('pause-label').textContent =
      state.status === 'paused' ? 'Resume' : 'Pause';
    getElement('pause-icon').textContent = state.status === 'paused' ? '▷' : 'Ⅱ';

    this.overlay.hidden = state.status === 'playing';
    getElement('overlay-label').textContent =
      state.status === 'gameOver' ? 'GAME OVER' : 'HAVE A KITKAT';
    getElement('overlay-title').textContent =
      state.status === 'gameOver' ? 'Stacked out.' : 'Paused.';
    getElement('overlay-copy').textContent =
      state.status === 'gameOver'
        ? `${state.score.toLocaleString()} points.`
        : '';
    getElement('continue-label').textContent =
      state.status === 'gameOver' ? 'Play again' : 'Keep playing';
    getElement('continue-icon').textContent = state.status === 'gameOver' ? '↗' : '→';
    this.continueButton.setAttribute(
      'aria-label',
      state.status === 'gameOver' ? 'Play again' : 'Keep playing',
    );
  }

  private renderPreviews(state: GameState): void {
    const key = `${state.hold}:${state.next.join('')}:${state.canHold}`;
    if (key === this.previewKey) return;

    this.previewKey = key;
    this.hold.replaceChildren(renderPiecePreview(state.hold));
    this.hold.classList.toggle('unavailable', !state.canHold);
    getElement('hold-note').textContent = state.canHold
      ? 'Save something for later.'
      : 'Available after this piece.';

    const nextPieces = document.createDocumentFragment();
    state.next.forEach((type, index) => {
      const nextPiece = document.createElement('div');
      const number = document.createElement('span');

      nextPiece.className = 'next-piece';
      number.className = 'next-number';
      number.textContent = `0${index + 1}`;
      nextPiece.append(number, renderPiecePreview(type));
      nextPieces.append(nextPiece);
    });
    this.next.replaceChildren(nextPieces);
  }
}
