/* ==========================================================================
   <time-display> Web Component
   Encapsulates formatted playback timecode and duration readout.
   ========================================================================== */

import { formatTime } from '../utils.js';
import { state } from '../state.js';

export class TimeDisplay extends HTMLElement {
  constructor() {
    super();
    this._unsubscribeTime = null;
    this._unsubscribeMedia = null;
  }

  connectedCallback() {
    this.classList.add('time-readout');
    this.render();

    this._unsubscribeTime = state.on('timeupdate', () => this.render());
    this._unsubscribeMedia = state.on('medialoaded', () => this.render());
  }

  disconnectedCallback() {
    if (this._unsubscribeTime) this._unsubscribeTime();
    if (this._unsubscribeMedia) this._unsubscribeMedia();
  }

  setTime(currentTime, duration) {
    const curStr = formatTime(currentTime);
    const durStr = formatTime(duration);
    this.innerHTML = `${curStr} <span class="dur">/ ${durStr}</span>`;
  }

  render() {
    this.setTime(state.currentTime, state.duration);
  }
}

if (!customElements.get('time-display')) {
  customElements.define('time-display', TimeDisplay);
}
