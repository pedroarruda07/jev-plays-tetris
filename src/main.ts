import './style.css';
import { TetrisGame } from './game';
import { GameControls } from './input';
import { GameLoop } from './loop';
import { GameView } from './ui';

const game = new TetrisGame();

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
  },
  { once: true },
);

loop.start();
