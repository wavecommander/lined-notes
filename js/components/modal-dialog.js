/* ==========================================================================
   <modal-dialog> Web Component
   Accessible, responsive modal dialog wrapper with backdrop, drag indicator,
   and keyboard/click dismissal.
   ========================================================================== */

export class ModalDialog extends HTMLElement {
  static get observedAttributes() {
    return ['open', 'modal-title', 'size'];
  }

  constructor() {
    super();
    this._onBackdropClick = this._onBackdropClick.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onCloseButtonClick = this._onCloseButtonClick.bind(this);
  }

  connectedCallback() {
    this.classList.add('modal-overlay');
    this.setAttribute('role', 'dialog');
    this.setAttribute('aria-modal', 'true');

    this.addEventListener('click', this._onBackdropClick);
    this.addEventListener('click', this._onCloseButtonClick);
    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onBackdropClick);
    this.removeEventListener('click', this._onCloseButtonClick);
    document.removeEventListener('keydown', this._onKeyDown);
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === 'open') {
      if (newVal !== null) {
        this.classList.add('open');
      } else {
        this.classList.remove('open');
      }
    }
  }

  get isOpen() {
    return this.classList.contains('open') || this.hasAttribute('open');
  }

  open() {
    if (this.isOpen) return;
    this.classList.add('open');
    this.setAttribute('open', '');
    this.dispatchEvent(new CustomEvent('modal-open', { bubbles: true }));

    // Focus first interactive control or close button
    const target = this.querySelector('input:not([type="hidden"]), button.modal-close-btn, button.btn-primary');
    if (target) {
      setTimeout(() => target.focus(), 60);
    }
  }

  close() {
    if (!this.isOpen) return;
    this.classList.remove('open');
    this.removeAttribute('open');
    this.dispatchEvent(new CustomEvent('modal-close', { bubbles: true }));
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  _onBackdropClick(e) {
    if (e.target === this) {
      this.close();
    }
  }

  _onCloseButtonClick(e) {
    const btn = e.target.closest('.modal-close-btn, [data-modal-close]');
    if (btn) {
      e.stopPropagation();
      this.close();
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Escape' && this.isOpen) {
      e.preventDefault();
      this.close();
    }
  }
}

if (!customElements.get('modal-dialog')) {
  customElements.define('modal-dialog', ModalDialog);
}
