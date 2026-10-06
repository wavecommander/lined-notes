/* ==========================================================================
   Annotations & Notes Manager
   Handles Note CRUD, formatting, search, tagging, and lightbox
   ========================================================================== */

import { state } from './state.js';
import { APP_CONFIG } from './config.js';
import { formatTime, parseTimeToSeconds, escapeHtml, copyText, showToast, getYouTubeThumbnailUrl, createCompositeThumbnail, confirmDialog, resolveNoteTimes } from './utils.js';
import './components/note-card.js';

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
    this.tagPicker = document.querySelector('tag-picker');
    this._autoStamped = false;

    this.init();
  }

  init() {
    if (this.tagPicker) {
      this.tagPicker.addEventListener('tag-select', (e) => {
        state.selectedTag = e.detail.tagId;
      });
    } else {
      this.renderTagMenu();
    }
    this.renderTagFilters();
    this.renderNotes();
    this.setupEvents();
    this.setupResponsivePlaceholder();

    state.on('timeupdate', () => this.checkActiveNote());
    state.on('noteschange', () => {
      this.renderNotes();
      this.renderTagFilters();
    });
    state.on('filereset', () => {
      // Undo history is per project
      state.undoHistory.clear();
      this.resetRangeAndInputState();
    });
    state.on('requestundo', () => this.undo());
  }

  /** Snapshot the notes before a change so it can be undone (Ctrl/Cmd+Z or a toast's Undo). */
  recordUndo(label, mergeKey = null) {
    state.undoHistory.push(label, state.notes, mergeKey);
  }

  undo() {
    const entry = state.undoHistory.pop();
    if (!entry) {
      showToast('Nothing to undo');
      return;
    }
    state.notes = entry.notes;
    state.editingNoteId = null;
    state.emit('noteschange');
    state.emit('timelinechanged');
    state.emit('requestsave');
    showToast(`Undid ${entry.label}`);
  }

  resetRangeAndInputState() {
    this.clearRange();
    state.isTimeStamped = false;
    this._autoStamped = false;
    state.stampTime = 0;
    if (this.stampBadge) this.stampBadge.classList.remove('locked');
    if (this.stampBadgeVal) this.stampBadgeVal.textContent = '00:00';
    if (this.noteInput) this.noteInput.value = '';
    state.editingNoteId = null;
    state.activeNoteId = null;
    state.searchQuery = '';
    state.filterTag = 'all';
    const searchInput = document.getElementById('search-notes-input');
    if (searchInput) searchInput.value = '';
    this.renderTagFilters();
    this.renderNotes();
  }

  setupEvents() {
    // Componentized event listeners from <note-card> custom elements
    if (this.notesList) {
      this.notesList.addEventListener('note-jump', (e) => this.jumpToNote(e.detail.start));
      this.notesList.addEventListener('note-seek', (e) => this.seekToTimeStr(e.detail.timeStr));
      this.notesList.addEventListener('note-lightbox', (e) => this.openLightbox(e.detail.src, e.detail.time));
      this.notesList.addEventListener('note-edit', (e) => this.startEditNote(e.detail.id));
      this.notesList.addEventListener('note-save', (e) => this.saveEditNote(e.detail.id, e.detail.text, e.detail));
      this.notesList.addEventListener('note-cancel', (e) => this.cancelEditNote(e.detail.id));
      this.notesList.addEventListener('note-copy', (e) => this.copyNoteText(e.detail.id));
      this.notesList.addEventListener('note-delete', (e) => this.deleteNote(e.detail.id));
    }

    // Auto-capture timestamp on start typing and handle multi-line auto-expand
    if (this.noteInput) {
      this.noteInput.addEventListener('input', () => {
        if (!state.isTimeStamped && this.noteInput.value.length > 0) {
          this.captureCurrentTime();
          this._autoStamped = true;
        } else if (this._autoStamped && this.noteInput.value.trim() === '') {
          state.isTimeStamped = false;
          this._autoStamped = false;
          if (this.stampBadge) this.stampBadge.classList.remove('locked');
        }
        this.adjustInputHeight();
      });

      this.noteInput.addEventListener('focus', () => {
        this.noteInput.classList.add('expanded');
        this.adjustInputHeight();
      });

      this.noteInput.addEventListener('blur', () => {
        if (!this.noteInput.value.trim()) {
          this.noteInput.classList.remove('expanded');
          this.resetInputHeight();
        }
      });
    }

    // Close tag menu on outside click if legacy dropdown is used
    document.addEventListener('click', () => {
      if (this.tagMenuDropdown) this.tagMenuDropdown.classList.remove('open');
    });
  }

  setupResponsivePlaceholder() {
    if (!this.noteInput) return;

    const desktopPlaceholder = this.noteInput.dataset.placeholderDesktop ||
      'Type annotation note here…\n(Press Enter to save, N to capture timestamp)';
    const mobilePlaceholder = this.noteInput.dataset.placeholderMobile ||
      'Type annotation note here…';

    const mediaQuery = window.matchMedia('(max-width: 1024px)');
    const updatePlaceholder = () => {
      this.noteInput.placeholder = mediaQuery.matches ? mobilePlaceholder : desktopPlaceholder;
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updatePlaceholder);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(updatePlaceholder);
    }
    window.addEventListener('resize', updatePlaceholder, { passive: true });

    updatePlaceholder();
  }

  adjustInputHeight() {
    if (!this.noteInput) return;
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 1024px)').matches;
    const isFocused = document.activeElement === this.noteInput || this.noteInput.classList.contains('expanded');
    if (!isFocused && !this.noteInput.value) {
      this.resetInputHeight();
      return;
    }
    const minH = isMobile ? 140 : 96;
    this.noteInput.style.height = 'auto';
    const targetH = Math.min(Math.max(this.noteInput.scrollHeight, minH), 280);
    this.noteInput.style.height = `${targetH}px`;
  }

  resetInputHeight() {
    if (!this.noteInput) return;
    this.noteInput.style.height = '';
  }

  captureCurrentTime() {
    state.isTimeStamped = true;
    this._autoStamped = false;
    // Reaction-time compensation only applies while playing; a paused playhead was placed deliberately
    const offset = state.isPlaying ? (state.stampOffset || 0) : 0;
    state.stampTime = Math.max(0, state.currentTime - offset);
    if (this.stampBadge) this.stampBadge.classList.add('locked');
    if (this.stampBadgeVal) this.stampBadgeVal.textContent = formatTime(state.stampTime);
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

  setAPoint() {
    state.APoint = state.currentTime;
    if (state.BPoint !== null && state.BPoint < state.APoint) {
      state.BPoint = null;
    }
    this.updateRangeStatusUI();
    state.emit('timelinechanged');
    showToast(`A Point set at ${formatTime(state.APoint)}`);
  }

  setBPoint() {
    if (state.APoint === null) {
      state.APoint = 0;
    }
    state.BPoint = Math.max(state.APoint, state.currentTime);
    this.updateRangeStatusUI();
    state.emit('timelinechanged');
    showToast(`B Point set at ${formatTime(state.BPoint)}`);
  }

  clearRange() {
    state.APoint = null;
    state.BPoint = null;
    state.isLooping = false;
    const loopBtn = document.getElementById('loop-range-btn');
    if (loopBtn) loopBtn.classList.remove('active');
    const inBtn = document.getElementById('A-point-btn');
    const outBtn = document.getElementById('B-point-btn');
    if (inBtn) inBtn.classList.remove('active');
    if (outBtn) outBtn.classList.remove('active');
    this.updateRangeStatusUI();
    state.emit('timelinechanged');
  }

  updateRangeStatusUI() {
    const clearBtn = document.getElementById('clear-range-btn');
    const inBtn = document.getElementById('A-point-btn');
    const outBtn = document.getElementById('B-point-btn');

    if (inBtn) inBtn.classList.toggle('active', state.APoint !== null);
    if (outBtn) outBtn.classList.toggle('active', state.BPoint !== null);
    if (clearBtn) clearBtn.style.display = state.APoint !== null ? 'inline-flex' : 'none';
  }

  async takeSnapshot(noteTime = null) {
    if (state.isAudio) {
      return null;
    }

    // YouTube Video Snapshot (HQ thumbnail with composite timecode overlay)
    if (state.mediaSourceType === 'youtube' && state.youtubeVideoId) {
      try {
        const thumbUrl = getYouTubeThumbnailUrl(state.youtubeVideoId);
        const timecode = noteTime !== null ? noteTime : (state.APoint !== null ? state.APoint : (state.isTimeStamped ? state.stampTime : state.currentTime));
        this.flashCapture();
        return await createCompositeThumbnail(thumbUrl, timecode);
      } catch (err) {
        console.warn('YouTube thumbnail capture error:', err);
        return getYouTubeThumbnailUrl(state.youtubeVideoId);
      }
    }

    if (!state.mediaFile && state.mediaSourceType !== 'url') {
      return null;
    }

    try {
      const v = this.player.videoEl;
      if (!v || !v.videoWidth) return null;
      const maxW = APP_CONFIG.snapshotMaxWidth || 480;

      // The playhead may have moved on since the timestamp was stamped (e.g. typing while playing):
      // grab the frame at the note's time from an offscreen element rather than the current frame.
      let source = v;
      if (noteTime !== null && isFinite(noteTime) && Math.abs(v.currentTime - noteTime) > 0.25) {
        source = (await this.renderFrameOffscreen(noteTime)) || v;
      }
      const srcW = source.videoWidth || source.width || 640;
      const srcH = source.videoHeight || source.height || 360;
      const scale = Math.min(1, maxW / srcW);
      const offCanvas = document.createElement('canvas');
      offCanvas.width = Math.round(srcW * scale);
      offCanvas.height = Math.round(srcH * scale);
      const offCtx = offCanvas.getContext('2d');
      offCtx.drawImage(source, 0, 0, offCanvas.width, offCanvas.height);
      const dataUrl = offCanvas.toDataURL('image/jpeg', APP_CONFIG.snapshotQuality || 0.72);
      this.flashCapture();
      return dataUrl;
    } catch (e) {
      console.warn('Snapshot capture error (CORS or video access):', e);
      return null;
    }
  }

  async saveNote() {
    const text = this.noteInput.value.trim();
    if (!text) {
      this.noteInput.focus();
      return;
    }
    const hasMedia = state.hasMedia();
    if (!hasMedia) {
      showToast('Open a media file or URL first');
      return;
    }

    const noteStart = state.APoint !== null
      ? state.APoint
      : (state.isTimeStamped ? state.stampTime : state.currentTime);
    const noteEnd = state.BPoint !== null ? state.BPoint : null;

    let thumb = null;
    if (!state.isAudio && (state.mediaFile || state.mediaSourceType === 'youtube' || state.mediaSourceType === 'url')) {
      thumb = await this.takeSnapshot(noteStart);
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

    this.recordUndo('add note');
    state.notes.push(note);
    state.notes.sort((a, b) => a.start - b.start);

    // Reset input
    this.noteInput.value = '';
    this.noteInput.classList.remove('expanded');
    this.resetInputHeight();
    this.clearRange();
    state.isTimeStamped = false;
    this._autoStamped = false;
    if (this.stampBadge) this.stampBadge.classList.remove('locked');
    state.stampTime = state.currentTime;
    if (this.stampBadgeVal) this.stampBadgeVal.textContent = formatTime(state.currentTime);

    state.emit('noteschange');
    state.emit('requestsave');
    state.emit('notesaved', note);
    showToast(`Note saved at ${formatTime(note.start)}`);
  }

  deleteNote(id) {
    const idx = state.notes.findIndex(n => n.id === id);
    if (idx !== -1) {
      this.recordUndo('delete');
      state.notes.splice(idx, 1);
      state.emit('noteschange');
      state.emit('timelinechanged');
      state.emit('requestsave');
      showToast('Note deleted', true, () => this.undo());
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

  /**
   * Applies an edit from <note-card>. `fields` may carry startStr / endStr (null = unchanged,
   * '' end = no range) and tag. Invalid times keep the card in edit mode.
   */
  saveEditNote(id, text = null, fields = {}) {
    const note = state.notes.find(n => n.id === id);
    if (!note) {
      state.editingNoteId = null;
      this.renderNotes();
      return;
    }

    const times = resolveNoteTimes(note, fields.startStr ?? null, fields.endStr ?? null, state.duration);
    if (times.error) {
      showToast(times.error);
      return;
    }

    this.recordUndo('edit');
    if (typeof text === 'string') {
      note.text = text.trim() || note.text;
    } else {
      const editArea = this.notesList ? this.notesList.querySelector('textarea') : null;
      if (editArea) note.text = editArea.value.trim() || note.text;
    }
    note.start = times.start;
    note.end = times.end;
    if (fields.tag && state.tags.some(t => t.id === fields.tag)) note.tag = fields.tag;
    note.updatedAt = new Date().toISOString();
    state.notes.sort((a, b) => a.start - b.start);

    state.editingNoteId = null;
    state.emit('noteschange');
    state.emit('timelinechanged');
    state.emit('requestsave');
    showToast('Note updated', true, () => this.undo());
  }

  /**
   * Moves the active note (and its range end) by `delta` seconds. Repeated nudges of the
   * same note collapse into one undo step.
   */
  nudgeActiveNote(delta) {
    const note = state.notes.find(n => n.id === state.activeNoteId);
    if (!note) {
      showToast('Jump to a note first ( , / . ) to nudge it');
      return;
    }
    const maxStart = state.duration > 0 ? state.duration : Infinity;
    const newStart = Math.min(maxStart, Math.max(0, note.start + delta));
    const shift = newStart - note.start;
    if (shift === 0) return;

    this.recordUndo('nudge', `nudge:${note.id}`);
    note.start = Math.round(newStart * 1000) / 1000;
    if (note.end) note.end = Math.round((note.end + shift) * 1000) / 1000;
    note.updatedAt = new Date().toISOString();
    state.notes.sort((a, b) => a.start - b.start);

    state.emit('noteschange');
    state.emit('requestsave');
    // Follow the note so the active highlight and the timeline marker stay on it
    this.player.seekTo(note.start);
    state.activeNoteId = note.id;
    showToast(`Note moved to ${formatTime(note.start)}`);
  }

  jumpToNote(start) {
    this.player.seekTo(start);
    if (window.innerWidth <= 1024) {
      state.emit('requestmobiletab', 'media');
    }
  }

  getCurrentNoteIndex() {
    if (!state.notes || state.notes.length === 0) return -1;
    if (state.activeNoteId) {
      const idx = state.notes.findIndex(n => n.id === state.activeNoteId);
      if (idx !== -1) return idx;
    }
    return state.notes.findIndex(n => {
      if (n.end && n.end > n.start) {
        return state.currentTime >= n.start - 0.2 && state.currentTime <= n.end + 0.2;
      }
      return Math.abs(n.start - state.currentTime) < 0.5;
    });
  }

  jumpPrevNote() {
    if (!state.notes || state.notes.length === 0) {
      showToast('No notes to move to');
      return;
    }
    if (state.notes.length === 1) {
      this.jumpToNote(state.notes[0].start);
      return;
    }

    const currentIndex = this.getCurrentNoteIndex();
    if (currentIndex !== -1) {
      // When on a note, wrap around between notes
      const prevIndex = (currentIndex - 1 + state.notes.length) % state.notes.length;
      this.jumpToNote(state.notes[prevIndex].start);
      return;
    }

    // In arbitrary time (not on a note), seek to nearest past note without wrapping time
    const past = state.notes.filter(n => n.start < state.currentTime - 0.3);
    if (past.length > 0) {
      this.jumpToNote(past[past.length - 1].start);
    } else {
      this.jumpToNote(state.notes[0].start);
    }
  }

  jumpNextNote() {
    if (!state.notes || state.notes.length === 0) {
      showToast('No notes to move to');
      return;
    }
    if (state.notes.length === 1) {
      this.jumpToNote(state.notes[0].start);
      return;
    }

    const currentIndex = this.getCurrentNoteIndex();
    if (currentIndex !== -1) {
      // When on a note, wrap around between notes
      const nextIndex = (currentIndex + 1) % state.notes.length;
      this.jumpToNote(state.notes[nextIndex].start);
      return;
    }

    // In arbitrary time (not on a note), seek to nearest future note without wrapping time
    const future = state.notes.filter(n => n.start > state.currentTime + 0.3);
    if (future.length > 0) {
      this.jumpToNote(future[0].start);
    } else {
      this.jumpToNote(state.notes[state.notes.length - 1].start);
    }
  }

  async clearAllNotes() {
    if (state.notes.length === 0) return;
    const ok = await confirmDialog({
      title: 'Clear all annotations?',
      message: `All ${state.notes.length} annotations in this project will be removed. You can undo this right afterwards.`,
      confirmLabel: 'Clear All',
      danger: true
    });
    if (!ok) return;
    this.recordUndo('clear all');
    state.notes = [];
    this.resetRangeAndInputState();
    state.emit('noteschange');
    state.emit('timelinechanged');
    state.emit('requestsave');
    showToast('All notes cleared', true, () => this.undo(), 6000);
  }

  copyNoteText(id) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    const str = state.copyIncludeTimestamp
      ? `[${formatTime(note.start)}] ${note.text}`
      : note.text;
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
      if (this.notesList) {
        this.notesList.querySelectorAll('note-card, .note-card').forEach(card => {
          const isActive = card.dataset.id === state.activeNoteId;
          if (typeof card.setActive === 'function') {
            card.setActive(isActive);
          } else {
            card.classList.toggle('active', isActive);
          }
          if (isActive) {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });
      }
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
    const secs = parseTimeToSeconds(str);
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
      const card = document.createElement('note-card');
      card.note = note;
      card.setActive(note.id === state.activeNoteId);
      card.isEditing = (state.editingNoteId === note.id);
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
    if (this.tagPicker && typeof this.tagPicker.selectTag === 'function') {
      this.tagPicker.selectTag(tagId);
      return;
    }
    const tagObj = state.tags.find(t => t.id === tagId) || state.tags[0];
    if (this.currentTagDot) this.currentTagDot.style.background = tagObj.color;
    if (this.currentTagLabel) this.currentTagLabel.textContent = tagObj.label;
  }

  toggleTagMenu(e) {
    if (e) e.stopPropagation();
    if (this.tagPicker && typeof this.tagPicker.toggleMenu === 'function') {
      this.tagPicker.toggleMenu(e);
      return;
    }
    if (this.tagMenuDropdown) this.tagMenuDropdown.classList.toggle('open');
  }

  openLightbox(src, timecode = null) {
    const modal = document.getElementById('lightbox-modal');
    const img = document.getElementById('lightbox-img');
    if (modal && img) {
      img.src = src;
      this.currentLightboxTimecode = (timecode !== null && isFinite(timecode)) ? timecode : null;
      if (typeof modal.open === 'function') {
        modal.open();
      } else {
        modal.classList.add('open');
      }
    }
  }

  closeLightbox() {
    const modal = document.getElementById('lightbox-modal');
    if (modal) {
      if (typeof modal.close === 'function') {
        modal.close();
      } else {
        modal.classList.remove('open');
      }
    }
    this.currentLightboxTimecode = null;
  }

  /**
   * Seeks a hidden copy of the current media to `timecode` and returns a full-resolution
   * canvas of that frame, or null (timeout, decode error, or cross-origin tainting).
   */
  renderFrameOffscreen(timecode) {
    if (!state.mediaUrl || state.isAudio || state.mediaSourceType === 'youtube') return Promise.resolve(null);
    return new Promise((resolve) => {
      const offVideo = document.createElement('video');
      offVideo.muted = true;
      offVideo.playsInline = true;
      offVideo.preload = 'auto';
      offVideo.src = state.mediaUrl;

      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        offVideo.removeAttribute('src');
        offVideo.load();
        resolve(result);
      };
      const timer = setTimeout(() => finish(null), 3000);

      const onSeeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = offVideo.videoWidth || 640;
          canvas.height = offVideo.videoHeight || 360;
          canvas.getContext('2d').drawImage(offVideo, 0, 0, canvas.width, canvas.height);
          canvas.toDataURL('image/png', 0); // throws early if the canvas is cross-origin tainted
          finish(canvas);
        } catch (err) {
          finish(null);
        }
      };

      offVideo.addEventListener('loadedmetadata', () => {
        const targetTime = Math.max(0, Math.min(timecode, offVideo.duration || timecode));
        if (Math.abs(offVideo.currentTime - targetTime) < 0.05) {
          // Wait for frame data at the start position before drawing
          if (offVideo.readyState >= 2) onSeeked();
          else offVideo.addEventListener('loadeddata', onSeeked, { once: true });
        } else {
          offVideo.addEventListener('seeked', onSeeked, { once: true });
          offVideo.currentTime = targetTime;
        }
      }, { once: true });
      offVideo.addEventListener('error', () => finish(null), { once: true });
    });
  }

  async captureFullResFrame(timecode) {
    if (state.mediaSourceType === 'youtube' && state.youtubeVideoId) {
      return getYouTubeThumbnailUrl(state.youtubeVideoId, 'maxresdefault') || getYouTubeThumbnailUrl(state.youtubeVideoId, 'hqdefault');
    }

    if (!state.mediaUrl || state.isAudio) return null;

    // 1. Try offscreen video element to avoid disrupting playback
    try {
      const canvas = await this.renderFrameOffscreen(timecode);
      if (canvas) {
        const blobUrl = await new Promise((resolve) => {
          canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png');
        });
        if (blobUrl) return blobUrl;
      }
    } catch (e) {
      console.warn('Offscreen full-res capture failed, trying primary video element:', e);
    }

    // 2. Fallback to primary video element
    const v = this.player?.videoEl;
    if (v && v.videoWidth > 0) {
      const prevTime = v.currentTime;
      const wasPaused = v.paused;
      if (!wasPaused) v.pause();

      try {
        const targetTime = Math.max(0, Math.min(timecode, v.duration || timecode));
        if (Math.abs(v.currentTime - targetTime) >= 0.05) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 2000);
            v.addEventListener('seeked', () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
            v.currentTime = targetTime;
          });
        }

        const canvas = document.createElement('canvas');
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

        // Restore playback position
        if (Math.abs(v.currentTime - prevTime) >= 0.05) {
          v.currentTime = prevTime;
          if (!wasPaused) v.play().catch(() => { });
        }

        return new Promise((resolve) => {
          canvas.toBlob((blob) => {
            resolve(blob ? URL.createObjectURL(blob) : null);
          }, 'image/png');
        });
      } catch (err) {
        console.warn('Primary video full-res capture failed:', err);
        if (!wasPaused && v.paused) v.play().catch(() => { });
      }
    }

    return null;
  }

  async downloadLightboxImage() {
    const img = document.getElementById('lightbox-img');
    if (!img) return;

    const downloadBtn = document.getElementById('lightbox-download-btn');
    const originalText = downloadBtn ? downloadBtn.innerHTML : '';
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.innerHTML = `
        <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
          <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"/>
        </svg>
        Capturing…
      `;
    }

    const timecode = this.currentLightboxTimecode;
    let fullResUrl = null;

    if (timecode !== null && isFinite(timecode)) {
      fullResUrl = await this.captureFullResFrame(timecode);
    }

    const finalUrl = fullResUrl || img.src;
    if (!finalUrl) {
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalText;
      }
      return;
    }

    const baseName = (state.mediaTitle || state.mediaFile?.name || 'snapshot').replace(/\.[^/.]+$/, '');
    const timeStr = timecode !== null ? formatTime(timecode).replace(/[:.]/g, '-') : 'frame';
    const isPng = finalUrl.startsWith('blob:') || finalUrl.startsWith('data:image/png');
    const filename = `${baseName}_${timeStr}.${isPng ? 'png' : 'jpg'}`;

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = finalUrl;
    a.download = filename;
    document.body.appendChild(a);
    try {
      a.click();
    } catch (e) {
      window.open(finalUrl, '_blank');
    }

    showToast('Downloaded snapshot');

    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      if (fullResUrl && fullResUrl.startsWith('blob:')) {
        URL.revokeObjectURL(fullResUrl);
      }
    }, 4000);

    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.innerHTML = originalText;
    }
  }
}
