/* ==========================================================================
   <tag-picker> Web Component
   Encapsulates tag indicator pill, dropdown menu, and selection events.
   ========================================================================== */

import { state } from '../state.js';
import { escapeHtml } from '../utils.js';

export class TagPicker extends HTMLElement {
  constructor() {
    super();
    this._onOutsideClick = this._onOutsideClick.bind(this);
    this._onButtonClick = this._onButtonClick.bind(this);
  }

  connectedCallback() {
    this.classList.add('tag-picker-wrap');
    this.render();
    document.addEventListener('click', this._onOutsideClick);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this._onOutsideClick);
  }

  get selectedTag() {
    return state.selectedTag;
  }

  set selectedTag(tagId) {
    this.selectTag(tagId);
  }

  selectTag(tagId) {
    state.selectedTag = tagId;
    const tagObj = state.tags.find(t => t.id === tagId) || state.tags[0] || { label: 'Note', color: '#d97742' };

    const dot = this.querySelector('.tag-dot');
    if (dot) dot.style.background = tagObj.color;

    const label = this.querySelector('.tag-label-text');
    if (label) label.textContent = tagObj.label;

    const dropdown = this.querySelector('.tag-menu-dropdown');
    if (dropdown) dropdown.classList.remove('open');

    this.dispatchEvent(new CustomEvent('tag-select', {
      bubbles: true,
      detail: { tagId, tag: tagObj }
    }));
  }

  toggleMenu(e) {
    if (e) e.stopPropagation();
    const dropdown = this.querySelector('.tag-menu-dropdown');
    if (dropdown) {
      dropdown.classList.toggle('open');
    }
  }

  closeMenu() {
    const dropdown = this.querySelector('.tag-menu-dropdown');
    if (dropdown) dropdown.classList.remove('open');
  }

  _onButtonClick(e) {
    e.stopPropagation();
    this.toggleMenu();
  }

  _onOutsideClick(e) {
    if (!this.contains(e.target)) {
      this.closeMenu();
    }
  }

  render() {
    const activeTag = state.tags.find(t => t.id === state.selectedTag) || state.tags[0] || { label: 'Note', color: '#d97742' };

    let menuItems = '';
    state.tags.forEach(tag => {
      menuItems += `
        <div class="tag-menu-item" data-tag-id="${escapeHtml(tag.id)}">
          <span class="tag-dot" style="background:${tag.color}"></span>
          <span>${escapeHtml(tag.label)}</span>
        </div>
      `;
    });

    this.innerHTML = `
      <div class="tag-badge-btn" id="current-tag-btn" title="Select annotation tag">
        <span class="tag-dot" id="current-tag-dot" style="background:${activeTag.color}"></span>
        <span class="tag-label-text" id="current-tag-label">${escapeHtml(activeTag.label)}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      <div class="tag-menu-dropdown" id="tag-menu-dropdown">
        ${menuItems}
      </div>
    `;

    const btn = this.querySelector('.tag-badge-btn');
    if (btn) btn.addEventListener('click', this._onButtonClick);

    const dropdown = this.querySelector('.tag-menu-dropdown');
    if (dropdown) {
      dropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.tag-menu-item');
        if (item && item.dataset.tagId) {
          e.stopPropagation();
          this.selectTag(item.dataset.tagId);
        }
      });
    }
  }
}

if (!customElements.get('tag-picker')) {
  customElements.define('tag-picker', TagPicker);
}
