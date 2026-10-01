/* ==========================================================================
   <mobile-tabs> Web Component
   Encapsulates mobile view switching between Media and Notes panels.
   ========================================================================== */

import { state } from '../state.js';

export class MobileTabs extends HTMLElement {
  constructor() {
    super();
    this._onTabClick = this._onTabClick.bind(this);
  }

  connectedCallback() {
    this.classList.add('mobile-tabs');
    this.setAttribute('role', 'tablist');
    this.render();
    this.addEventListener('click', this._onTabClick);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onTabClick);
  }

  setTab(tab) {
    state.mobileTab = tab;
    const mediaBtn = this.querySelector('#tab-btn-media');
    const notesBtn = this.querySelector('#tab-btn-notes');

    if (mediaBtn && notesBtn) {
      if (tab === 'notes') {
        mediaBtn.classList.remove('active');
        mediaBtn.setAttribute('aria-selected', 'false');
        notesBtn.classList.add('active');
        notesBtn.setAttribute('aria-selected', 'true');
      } else {
        notesBtn.classList.remove('active');
        notesBtn.setAttribute('aria-selected', 'false');
        mediaBtn.classList.add('active');
        mediaBtn.setAttribute('aria-selected', 'true');
      }
    }

    const appEl = document.getElementById('app');
    if (appEl) {
      appEl.setAttribute('data-mobile-view', tab);
    }

    this.dispatchEvent(new CustomEvent('tab-select', {
      bubbles: true,
      detail: { tab }
    }));
  }

  setCount(count) {
    const badge = this.querySelector('#mobile-tab-count');
    if (badge) {
      badge.textContent = count;
    }
  }

  _onTabClick(e) {
    const btn = e.target.closest('.mobile-tab-btn');
    if (!btn) return;
    const tab = btn.dataset.tab;
    if (tab) {
      this.setTab(tab);
    }
  }

  render() {
    const isNotes = state.mobileTab === 'notes';
    const count = state.notes ? state.notes.length : 0;

    this.innerHTML = `
      <button class="mobile-tab-btn ${!isNotes ? 'active' : ''}" id="tab-btn-media" data-tab="media" role="tab" aria-selected="${!isNotes}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span>Media</span>
      </button>
      <button class="mobile-tab-btn ${isNotes ? 'active' : ''}" id="tab-btn-notes" data-tab="notes" role="tab" aria-selected="${isNotes}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        <span>Notes</span>
        <span class="mobile-tab-badge" id="mobile-tab-count">${count}</span>
      </button>
    `;
  }
}

if (!customElements.get('mobile-tabs')) {
  customElements.define('mobile-tabs', MobileTabs);
}
