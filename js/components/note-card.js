/* ==========================================================================
   <note-card> Web Component
   Encapsulates note presentation, time jumping, formatting, snapshot preview,
   and inline editing.
   ========================================================================== */

import { formatTime, escapeHtml, sanitizeImageSrc } from '../utils.js';
import { state } from '../state.js';

export class NoteCard extends HTMLElement {
  static get observedAttributes() {
    return ['active', 'editing'];
  }

  constructor() {
    super();
    this._note = null;
    this._isEditing = false;
    this._onClick = this._onClick.bind(this);
  }

  connectedCallback() {
    this.classList.add('note-card');
    this.addEventListener('click', this._onClick);
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onClick);
  }

  get note() {
    return this._note;
  }

  set note(val) {
    this._note = val;
    this.dataset.id = val ? val.id : '';
    this.dataset.start = val ? val.start : '';
    this.render();
  }

  get isEditing() {
    return this._isEditing;
  }

  set isEditing(val) {
    this._isEditing = !!val;
    this.render();
    if (this._isEditing) {
      const textarea = this.querySelector('textarea');
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    }
  }

  setActive(isActive) {
    this.classList.toggle('active', !!isActive);
  }

  formatNoteText(text) {
    let esc = escapeHtml(text);
    // Timestamps e.g. 00:01:23.4, 01:23 clickable
    esc = esc.replace(/\b(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\b/g, (match) => {
      return `<span class="note-time-chip" data-time-str="${match}" title="Jump to ${match}">⏱️ ${match}</span>`;
    });
    esc = esc.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    esc = esc.replace(/\*(.+?)\*/g, '<em>$1</em>');
    esc = esc.replace(/`(.+?)`/g, '<code>$1</code>');
    return esc;
  }

  render() {
    if (!this._note) {
      this.innerHTML = '';
      return;
    }

    const note = this._note;
    const tagObj = state.tags.find(t => t.id === note.tag) || state.tags[0] || { label: 'Note', color: '#d97742' };
    this.style.borderLeftColor = tagObj.color;

    if (this._isEditing) {
      const tagOptions = state.tags.map(t =>
        `<option value="${escapeHtml(t.id)}"${t.id === note.tag ? ' selected' : ''}>${escapeHtml(t.label)}</option>`
      ).join('');
      this.innerHTML = `
        <div class="note-edit-box">
          <div class="note-edit-fields">
            <label class="note-edit-field">
              <span>Start</span>
              <input type="text" class="note-edit-time" data-field="start" value="${formatTime(note.start)}"
                spellcheck="false" autocomplete="off" aria-label="Start time">
              <button type="button" class="note-edit-now" data-action="set-now" data-target="start"
                title="Use current playback time">Now</button>
            </label>
            <label class="note-edit-field">
              <span>End</span>
              <input type="text" class="note-edit-time" data-field="end" value="${note.end ? formatTime(note.end) : ''}"
                placeholder="none" spellcheck="false" autocomplete="off" aria-label="End time (optional)">
              <button type="button" class="note-edit-now" data-action="set-now" data-target="end"
                title="Use current playback time">Now</button>
            </label>
            <select class="note-edit-tag" aria-label="Tag">${tagOptions}</select>
          </div>
          <textarea class="note-edit-textarea">${escapeHtml(note.text)}</textarea>
          <div class="note-edit-btns">
            <button class="btn btn-ghost btn-sm" data-action="cancel-edit">Cancel</button>
            <button class="btn btn-primary btn-sm" data-action="save-edit">Save</button>
          </div>
        </div>
      `;
      return;
    }

    const rangeText = note.end ? ` → ${formatTime(note.end)}` : '';
    const thumbSrc = sanitizeImageSrc(note.thumb);
    const thumbHtml = thumbSrc
      ? `<img class="note-card-thumb" src="${escapeHtml(thumbSrc)}" data-time="${escapeHtml(note.start)}" alt="Snapshot">`
      : '';

    this.innerHTML = `
      <div class="note-card-header">
        <div class="note-card-badges">
          <span class="note-time-badge">${formatTime(note.start)}${rangeText}</span>
          <span class="note-tag-badge" style="background:${tagObj.color}">${escapeHtml(tagObj.label)}</span>
        </div>
        <div class="note-card-actions">
          <button class="note-act-btn" data-action="edit" title="Edit Note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button class="note-act-btn" data-action="copy" title="Copy Note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="note-act-btn del" data-action="delete" title="Delete Note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      ${thumbHtml}
      <div class="note-card-body">${this.formatNoteText(note.text)}</div>
    `;
  }

  _onClick(e) {
    if (!this._note) return;

    // 1. Time chip inside note body
    const timeChip = e.target.closest('.note-time-chip');
    if (timeChip) {
      e.stopPropagation();
      const timeStr = timeChip.dataset.timeStr;
      if (timeStr) {
        this.dispatchEvent(new CustomEvent('note-seek', {
          bubbles: true,
          detail: { timeStr }
        }));
      }
      return;
    }

    // 2. Snapshot thumbnail
    const thumbImg = e.target.closest('.note-card-thumb');
    if (thumbImg) {
      e.stopPropagation();
      this.dispatchEvent(new CustomEvent('note-lightbox', {
        bubbles: true,
        detail: {
          src: thumbImg.src,
          time: this._note.start
        }
      }));
      return;
    }

    // 3. Action buttons
    const actBtn = e.target.closest('[data-action]');
    if (actBtn) {
      e.stopPropagation();
      const action = actBtn.dataset.action;
      if (action === 'edit') {
        this.dispatchEvent(new CustomEvent('note-edit', {
          bubbles: true,
          detail: { id: this._note.id }
        }));
      } else if (action === 'set-now') {
        const input = this.querySelector(`.note-edit-time[data-field="${actBtn.dataset.target}"]`);
        if (input) input.value = formatTime(state.currentTime);
      } else if (action === 'save-edit') {
        const textarea = this.querySelector('textarea');
        const text = textarea ? textarea.value.trim() : this._note.text;
        // Only send times the user changed, so unchanged values keep full precision
        const changed = (field) => {
          const input = this.querySelector(`.note-edit-time[data-field="${field}"]`);
          return input && input.value.trim() !== input.defaultValue ? input.value.trim() : null;
        };
        const tagSelect = this.querySelector('.note-edit-tag');
        this.dispatchEvent(new CustomEvent('note-save', {
          bubbles: true,
          detail: {
            id: this._note.id,
            text,
            startStr: changed('start'),
            endStr: changed('end'),
            tag: tagSelect ? tagSelect.value : this._note.tag
          }
        }));
      } else if (action === 'cancel-edit') {
        this.dispatchEvent(new CustomEvent('note-cancel', {
          bubbles: true,
          detail: { id: this._note.id }
        }));
      } else if (action === 'copy') {
        this.dispatchEvent(new CustomEvent('note-copy', {
          bubbles: true,
          detail: { id: this._note.id }
        }));
      } else if (action === 'delete') {
        this.dispatchEvent(new CustomEvent('note-delete', {
          bubbles: true,
          detail: { id: this._note.id }
        }));
      }
      return;
    }

    // 4. Clicking the card body or badges jumps to the note timestamp
    if (!this._isEditing) {
      this.dispatchEvent(new CustomEvent('note-jump', {
        bubbles: true,
        detail: { start: this._note.start }
      }));
    }
  }
}

if (!customElements.get('note-card')) {
  customElements.define('note-card', NoteCard);
}
