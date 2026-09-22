import './style.css';
import { GameDebugLogger } from './debug';
import { TetrisGame } from './game';
import { GameControls } from './input';
import { GameLoop } from './loop';
import { GameView } from './ui';
import { JevPlayer } from './jev/player';
import { JevControls } from './jev/controls';

const game = new TetrisGame();
const debugLogger = new GameDebugLogger(game);

declare global {
  interface Window {
    tetris: TetrisGame;
    jev: JevPlayer;
  }
}

window.tetris = game;

new GameView(game);
const controls = new GameControls(game);
const jev = new JevPlayer(game);
const jevControls = new JevControls(jev);
window.jev = jev;
const loop = new GameLoop(game, controls, () => jev.isClockSuspended());

window.addEventListener(
  'pagehide',
  () => {
    loop.stop();
    controls.dispose();
    debugLogger.dispose();
    jevControls.dispose();
    jev.dispose();
  },
  { once: true },
);

loop.start();
