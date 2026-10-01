/* ==========================================================================
   <toast-notification> Web Component
   Encapsulates application toast notifications, auto-dismissal, and undo actions.
   ========================================================================== */

export class ToastNotification extends HTMLElement {
  constructor() {
    super();
    this._timer = null;
    this._undoHandler = null;
    this._onUndoClick = this._onUndoClick.bind(this);
  }

  connectedCallback() {
    this.id = 'toast';
    this.render();
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
  }

  render() {
    this.innerHTML = `
      <span class="toast-text" id="toast-text"></span>
      <button class="toast-btn" id="toast-action" style="display:none;">Undo</button>
    `;

    const btn = this.querySelector('#toast-action');
    if (btn) btn.addEventListener('click', this._onUndoClick);
  }

  show(msg, showUndo = false, onUndo = null, duration = 2800) {
    const textEl = this.querySelector('#toast-text');
    const undoBtn = this.querySelector('#toast-action');
    if (!textEl) return;

    textEl.textContent = msg;
    this._undoHandler = onUndo;

    if (undoBtn) {
      undoBtn.style.display = showUndo ? 'inline-block' : 'none';
    }

    this.classList.add('show');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.dismiss();
    }, duration);
  }

  dismiss() {
    this.classList.remove('show');
    clearTimeout(this._timer);
    this._undoHandler = null;
  }

  _onUndoClick(e) {
    e.stopPropagation();
    if (typeof this._undoHandler === 'function') {
      const fn = this._undoHandler;
      this._undoHandler = null;
      fn();
    }
    this.dismiss();
  }
}

if (!customElements.get('toast-notification')) {
  customElements.define('toast-notification', ToastNotification);
}
