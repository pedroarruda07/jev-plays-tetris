import './style.css';
import { GameDebugLogger } from './debug';
import { TetrisGame } from './game';
import { GameControls } from './input';
import { GameLoop } from './loop';
import { GameView } from './ui';

const game = new TetrisGame();
const debugLogger = new GameDebugLogger(game);

declare global {
  interface Window {
    tetris: TetrisGame;
  }
}

window.tetris = game;

new GameView(game);
const controls = new GameControls(game);
const loop = new GameLoop(game, controls);

window.addEventListener(
  'pagehide',
  () => {
    loop.stop();
    controls.dispose();
    debugLogger.dispose();
  },
  { once: true },
);

loop.start();
