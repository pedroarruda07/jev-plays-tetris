import type { JevPlayer } from './player';

/** Jev-specific controls; game movement continues to live in GameControls. */
export class JevControls {
  private readonly listeners = new AbortController();
  private readonly unsubscribe: () => void;

  constructor(private readonly player: JevPlayer) {
    const button = document.querySelector<HTMLButtonElement>('#jev-toggle');
    const freeze = document.querySelector<HTMLInputElement>('#jev-freeze');
    const status = document.getElementById('jev-status');
    if (!button || !freeze || !status) throw new Error('Missing Jev controls.');
    const options = { signal: this.listeners.signal };
    button.addEventListener('click', this.toggle, options);
    freeze.addEventListener(
      'change',
      () => player.setFreezeWhileThinking(freeze.checked),
      options,
    );
    window.addEventListener(
      'keydown',
      (event) => {
        if (
          event.code !== 'KeyJ' ||
          event.repeat ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        )
          return;
        event.preventDefault();
        this.toggle();
      },
      options,
    );
    this.unsubscribe = player.subscribe((state) => {
      button.textContent = state.running ? 'Stop Jev · J' : 'Let Jev play · J';
      button.setAttribute('aria-pressed', String(state.running));
      freeze.checked = state.freezeWhileThinking;
      status.textContent = state.message;
    });
  }

  dispose(): void {
    this.listeners.abort();
    this.unsubscribe();
  }

  private readonly toggle = (): void => {
    if (this.player.getStatus().running) this.player.stop();
    else this.player.start();
  };
}
