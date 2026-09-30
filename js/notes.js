/* ==========================================================================
   Annotations & Notes Manager
   Handles Note CRUD, formatting, search, tagging, and lightbox
   ========================================================================== */

import { state } from './state.js';
import { APP_CONFIG } from './config.js';
import { formatTime, escapeHtml, copyText, showToast } from './utils.js';

export class NotesManager {
  constructor(playerController) {
    this.player = playerController;
    this.noteInput = document.getElementById('note-text-input');
    this.notesList = document.getElementById('notes-list');
    this.notesCountBadge = document.getElementById('notes-count-badge');
    this.mobileTabCount = document.getElementById('mobile-tab-count');
    this.emptyState = document.getElementById('notes-empty-state');
    this.stampBadge = document.getElementById('stamp-badge');
    this.stampBadgeVal = document.getElementById('stamp-badge-val');
    this.tagFiltersRow = document.getElementById('tag-filters-row');
    this.tagMenuDropdown = document.getElementById('tag-menu-dropdown');
    this.currentTagDot = document.getElementById('current-tag-dot');
    this.currentTagLabel = document.getElementById('current-tag-label');

    this.init();
  }

  init() {
    this.renderTagMenu();
    this.renderTagFilters();
    this.renderNotes();
    this.setupEvents();

    state.on('timeupdate', () => this.checkActiveNote());
    state.on('noteschange', () => {
      this.renderNotes();
      this.renderTagFilters();
    });
  }

  setupEvents() {
    // Delegated click handler on notes list for editing, copying, deleting, and lightbox
    if (this.notesList) {
      this.notesList.addEventListener('click', (e) => {
        const timeChip = e.target.closest('.note-time-chip');
        if (timeChip) {
          e.stopPropagation();
          const timeStr = timeChip.dataset.timeStr;
          if (timeStr) this.seekToTimeStr(timeStr);
          return;
        }

        const thumbImg = e.target.closest('.note-card-thumb');
        if (thumbImg) {
          e.stopPropagation();
          this.openLightbox(thumbImg.src);
          return;
        }

        const actBtn = e.target.closest('[data-note-action]');
        if (actBtn) {
          e.stopPropagation();
          const action = actBtn.dataset.noteAction;
          const noteId = actBtn.dataset.noteId;
          if (action === 'edit') this.startEditNote(noteId);
          if (action === 'copy') this.copyNoteText(noteId);
          if (action === 'delete') this.deleteNote(noteId);
          if (action === 'save-edit') this.saveEditNote(noteId);
          if (action === 'cancel-edit') this.cancelEditNote(noteId);
          return;
        }

        const card = e.target.closest('.note-card');
        if (card && card.dataset.start) {
          this.jumpToNote(parseFloat(card.dataset.start));
        }
      });
    }

    // Close tag menu on outside click
    document.addEventListener('click', () => {
      if (this.tagMenuDropdown) this.tagMenuDropdown.classList.remove('open');
    });
  }

  captureCurrentTime() {
    state.isTimeStamped = true;
    state.stampTime = state.currentTime;
    if (this.stampBadge) this.stampBadge.classList.add('locked');
    if (this.stampBadgeVal) this.stampBadgeVal.textContent = formatTime(state.currentTime);
    if (this.noteInput) this.noteInput.focus();
    this.flashCapture();
  }

  flashCapture() {
    const flash = document.getElementById('capture-flash');
    if (!flash) return;
    flash.classList.remove('flash');
    void flash.offsetWidth;
    flash.classList.add('flash');
  }

  setInPoint() {
    state.inPoint = state.currentTime;
    if (state.outPoint !== null && state.outPoint < state.inPoint) {
      state.outPoint = null;
    }
    this.updateRangeStatusUI();
    state.emit('timelinechanged');
    showToast(`In Point set at ${formatTime(state.inPoint)}`);
  }

  setOutPoint() {
    if (state.inPoint === null) {
      state.inPoint = 0;
    }
    state.outPoint = Math.max(state.inPoint, state.currentTime);
    this.updateRangeStatusUI();
    state.emit('timelinechanged');
    showToast(`Out Point set at ${formatTime(state.outPoint)}`);
  }

  clearRange() {
    state.inPoint = null;
    state.outPoint = null;
    state.isLooping = false;
    const loopBtn = document.getElementById('loop-range-btn');
    if (loopBtn) loopBtn.classList.remove('active');
    this.updateRangeStatusUI();
    state.emit('timelinechanged');
  }

  updateRangeStatusUI() {
    const rangeText = document.getElementById('range-status-text');
    const rangeVal = document.getElementById('range-val');
    const clearBtn = document.getElementById('clear-range-btn');
    if (state.inPoint !== null) {
      if (rangeText) rangeText.style.display = 'inline';
      if (clearBtn) clearBtn.style.display = 'inline-flex';
      const outStr = state.outPoint !== null ? formatTime(state.outPoint) : '…';
      if (rangeVal) rangeVal.textContent = `${formatTime(state.inPoint)} → ${outStr}`;
    } else {
      if (rangeText) rangeText.style.display = 'none';
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }

  async takeSnapshot() {
    if (state.isAudio || !state.mediaFile) {
      return null;
    }
    try {
      const v = this.player.videoEl;
      const maxW = APP_CONFIG.snapshotMaxWidth || 480;
      const scale = Math.min(1, maxW / (v.videoWidth || 640));
      const offCanvas = document.createElement('canvas');
      offCanvas.width = Math.round((v.videoWidth || 640) * scale);
      offCanvas.height = Math.round((v.videoHeight || 360) * scale);
      const offCtx = offCanvas.getContext('2d');
      offCtx.drawImage(v, 0, 0, offCanvas.width, offCanvas.height);
      const dataUrl = offCanvas.toDataURL('image/jpeg', APP_CONFIG.snapshotQuality || 0.72);
      this.flashCapture();
      return dataUrl;
    } catch (e) {
      console.warn('Snapshot capture error:', e);
      return null;
    }
  }

  async saveNote() {
    const text = this.noteInput.value.trim();
    if (!text) {
      this.noteInput.focus();
      return;
    }
    const hasMedia = Boolean(state.mediaFile || state.detachedMode);
    if (!hasMedia) {
      showToast('Open a media file first');
      return;
    }

    const noteStart = state.inPoint !== null
      ? state.inPoint
      : (state.isTimeStamped ? state.stampTime : state.currentTime);
    const noteEnd = state.outPoint !== null ? state.outPoint : null;

    let thumb = null;
    if (!state.isAudio && state.mediaFile) {
      thumb = await this.takeSnapshot();
    }

    const note = {
      id: Date.now() + Math.random().toString(36).substring(2, 6),
      start: noteStart,
      end: noteEnd,
      text: text,
      tag: state.selectedTag,
      thumb: thumb,
      createdAt: new Date().toISOString()
    };

    state.notes.push(note);
    state.notes.sort((a, b) => a.start - b.start);

    // Reset input
    this.noteInput.value = '';
    this.clearRange();
    state.isTimeStamped = false;
    if (this.stampBadge) this.stampBadge.classList.remove('locked');
    state.stampTime = state.currentTime;
    if (this.stampBadgeVal) this.stampBadgeVal.textContent = formatTime(state.currentTime);

    state.emit('noteschange');
    state.emit('requestsave');
    showToast(`Note saved at ${formatTime(note.start)}`);
  }

  deleteNote(id) {
    const idx = state.notes.findIndex(n => n.id === id);
    if (idx !== -1) {
      const removed = state.notes.splice(idx, 1)[0];
      state.deletedHistory.push(removed);
      state.emit('noteschange');
      state.emit('requestsave');
      showToast('Note deleted', true, () => this.restoreLastDeleted());
    }
  }

  restoreLastDeleted() {
    if (state.deletedHistory.length > 0) {
      const restored = state.deletedHistory.pop();
      state.notes.push(restored);
      state.notes.sort((a, b) => a.start - b.start);
      state.emit('noteschange');
      state.emit('requestsave');
      showToast('Note restored');
    }
  }

  startEditNote(id) {
    state.editingNoteId = id;
    this.renderNotes();
  }

  cancelEditNote() {
    state.editingNoteId = null;
    this.renderNotes();
  }

  saveEditNote(id) {
    const editArea = document.getElementById(`edit-text-${id}`);
    if (!editArea) return;
    const note = state.notes.find(n => n.id === id);
    if (note) {
      note.text = editArea.value.trim() || note.text;
      note.updatedAt = new Date().toISOString();
    }
    state.editingNoteId = null;
    state.emit('noteschange');
    state.emit('requestsave');
    showToast('Note updated');
  }

  jumpToNote(start) {
    this.player.seekTo(start);
    if (window.innerWidth <= 768) {
      state.emit('requestmobiletab', 'media');
    }
  }

  jumpPrevNote() {
    if (state.notes.length === 0) return;
    const past = state.notes.filter(n => n.start < state.currentTime - 0.5);
    if (past.length > 0) {
      this.jumpToNote(past[past.length - 1].start);
    } else {
      this.jumpToNote(state.notes[0].start);
    }
  }

  jumpNextNote() {
    if (state.notes.length === 0) return;
    const future = state.notes.filter(n => n.start > state.currentTime + 0.5);
    if (future.length > 0) {
      this.jumpToNote(future[0].start);
    } else {
      this.jumpToNote(state.notes[state.notes.length - 1].start);
    }
  }

  clearAllNotes() {
    if (state.notes.length === 0) return;
    if (!confirm(`Delete all ${state.notes.length} annotations? This action cannot be undone.`)) return;
    state.notes = [];
    state.emit('noteschange');
    state.emit('requestsave');
    showToast('All notes cleared');
  }

  copyNoteText(id) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    const str = `[${formatTime(note.start)}] ${note.text}`;
    copyText(str, 'Note copied to clipboard');
  }

  checkActiveNote() {
    const active = state.notes.find(n => {
      if (n.end) {
        return state.currentTime >= n.start && state.currentTime <= n.end;
      }
      return Math.abs(n.start - state.currentTime) < 1.2;
    });
    const newActiveId = active ? active.id : null;
    if (newActiveId !== state.activeNoteId) {
      state.activeNoteId = newActiveId;
      document.querySelectorAll('.note-card').forEach(card => {
        const isActive = card.dataset.id === state.activeNoteId;
        card.classList.toggle('active', isActive);
        if (isActive) {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }
  }

  onSearchInput(val) {
    state.searchQuery = val.toLowerCase().trim();
    this.renderNotes();
  }

  setFilterTag(tagId) {
    state.filterTag = tagId;
    this.renderTagFilters();
    this.renderNotes();
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

  seekToTimeStr(str) {
    const clean = str.replace(',', '.');
    const parts = clean.split(':');
    let secs = 0;
    if (parts.length === 3) {
      secs = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      secs = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    } else {
      secs = parseFloat(clean);
    }
    if (!isNaN(secs)) {
      this.player.seekTo(secs);
    }
  }

  renderTagFilters() {
    if (!this.tagFiltersRow) return;
    this.tagFiltersRow.innerHTML = '';

    const allChip = document.createElement('div');
    allChip.className = `tag-chip ${state.filterTag === 'all' ? 'active' : ''}`;
    allChip.textContent = 'All';
    allChip.onclick = () => this.setFilterTag('all');
    this.tagFiltersRow.appendChild(allChip);

    const usedTags = new Set(state.notes.map(n => n.tag).filter(Boolean));
    state.tags.forEach(tag => {
      if (usedTags.has(tag.id)) {
        const chip = document.createElement('div');
        chip.className = `tag-chip ${state.filterTag === tag.id ? 'active' : ''}`;
        chip.textContent = tag.label;
        chip.onclick = () => this.setFilterTag(tag.id);
        this.tagFiltersRow.appendChild(chip);
      }
    });
  }

  renderNotes() {
    if (!this.notesList) return;
    const count = state.notes.length;
    if (this.notesCountBadge) this.notesCountBadge.textContent = count;
    if (this.mobileTabCount) this.mobileTabCount.textContent = count;

    let filtered = state.notes;
    if (state.filterTag !== 'all') {
      filtered = filtered.filter(n => n.tag === state.filterTag);
    }
    if (state.searchQuery) {
      filtered = filtered.filter(n => n.text.toLowerCase().includes(state.searchQuery));
    }

    if (filtered.length === 0) {
      if (this.emptyState) this.emptyState.style.display = 'flex';
      this.notesList.querySelectorAll('.note-card').forEach(el => el.remove());
      return;
    }

    if (this.emptyState) this.emptyState.style.display = 'none';
    this.notesList.querySelectorAll('.note-card').forEach(el => el.remove());

    filtered.forEach(note => {
      const card = document.createElement('div');
      card.className = `note-card ${note.id === state.activeNoteId ? 'active' : ''}`;
      card.dataset.id = note.id;
      card.dataset.start = note.start;
      const tagObj = state.tags.find(t => t.id === note.tag) || state.tags[0];
      card.style.borderLeftColor = tagObj.color;

      if (state.editingNoteId === note.id) {
        // Edit Mode
        card.innerHTML = `
          <div class="note-edit-box">
            <textarea id="edit-text-${note.id}" class="note-edit-textarea">${escapeHtml(note.text)}</textarea>
            <div class="note-edit-btns">
              <button class="btn btn-ghost btn-sm" data-note-action="cancel-edit" data-note-id="${note.id}">Cancel</button>
              <button class="btn btn-primary btn-sm" data-note-action="save-edit" data-note-id="${note.id}">Save</button>
            </div>
          </div>
        `;
      } else {
        // View Mode
        const rangeText = note.end ? ` → ${formatTime(note.end)}` : '';
        const thumbHtml = note.thumb ? `<img class="note-card-thumb" src="${note.thumb}" alt="Snapshot">` : '';

        card.innerHTML = `
          <div class="note-card-header">
            <div class="note-card-badges">
              <span class="note-time-badge">${formatTime(note.start)}${rangeText}</span>
              <span class="note-tag-badge" style="background:${tagObj.color}">${escapeHtml(tagObj.label)}</span>
            </div>
            <div class="note-card-actions">
              <button class="note-act-btn" data-note-action="edit" data-note-id="${note.id}" title="Edit Note">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              </button>
              <button class="note-act-btn" data-note-action="copy" data-note-id="${note.id}" title="Copy Note">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              <button class="note-act-btn del" data-note-action="delete" data-note-id="${note.id}" title="Delete Note">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
          ${thumbHtml}
          <div class="note-card-body">${this.formatNoteText(note.text)}</div>
        `;
      }

      this.notesList.appendChild(card);
    });
  }

  renderTagMenu() {
    if (!this.tagMenuDropdown) return;
    this.tagMenuDropdown.innerHTML = '';
    state.tags.forEach(tag => {
      const item = document.createElement('div');
      item.className = 'tag-menu-item';
      item.innerHTML = `<span class="tag-dot" style="background:${tag.color}"></span><span>${escapeHtml(tag.label)}</span>`;
      item.onclick = (e) => {
        e.stopPropagation();
        this.selectTag(tag.id);
        this.tagMenuDropdown.classList.remove('open');
      };
      this.tagMenuDropdown.appendChild(item);
    });
  }

  selectTag(tagId) {
    state.selectedTag = tagId;
    const tagObj = state.tags.find(t => t.id === tagId) || state.tags[0];
    if (this.currentTagDot) this.currentTagDot.style.background = tagObj.color;
    if (this.currentTagLabel) this.currentTagLabel.textContent = tagObj.label;
  }

  toggleTagMenu(e) {
    if (e) e.stopPropagation();
    if (this.tagMenuDropdown) this.tagMenuDropdown.classList.toggle('open');
  }

  openLightbox(src) {
    const modal = document.getElementById('lightbox-modal');
    const img = document.getElementById('lightbox-img');
    if (modal && img) {
      img.src = src;
      modal.classList.add('open');
    }
  }

  closeLightbox() {
    const modal = document.getElementById('lightbox-modal');
    if (modal) modal.classList.remove('open');
  }

  downloadLightboxImage() {
    const img = document.getElementById('lightbox-img');
    if (!img || !img.src) return;
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = img.src;
    a.download = `snapshot_${formatTime(state.currentTime).replace(/[:.]/g, '-')}.jpg`;
    document.body.appendChild(a);
    try {
      a.click();
    } catch (e) {
      window.open(img.src, '_blank');
    }
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 2000);
  }
}
