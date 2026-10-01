/* ==========================================================================
   Annotations & Notes Manager
   Handles Note CRUD, formatting, search, tagging, and lightbox
   ========================================================================== */

import { state } from './state.js';
import { APP_CONFIG } from './config.js';
import { formatTime, parseTimeToSeconds, escapeHtml, copyText, showToast } from './utils.js';
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
    state.on('filereset', () => this.resetRangeAndInputState());
  }

  resetRangeAndInputState() {
    this.clearRange();
    state.isTimeStamped = false;
    state.stampTime = 0;
    if (this.stampBadge) this.stampBadge.classList.remove('locked');
    if (this.stampBadgeVal) this.stampBadgeVal.textContent = '00:00';
    if (this.noteInput) this.noteInput.value = '';
    state.editingNoteId = null;
    state.activeNoteId = null;
    state.deletedHistory = [];
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
      this.notesList.addEventListener('note-save', (e) => this.saveEditNote(e.detail.id, e.detail.text));
      this.notesList.addEventListener('note-cancel', (e) => this.cancelEditNote(e.detail.id));
      this.notesList.addEventListener('note-copy', (e) => this.copyNoteText(e.detail.id));
      this.notesList.addEventListener('note-delete', (e) => this.deleteNote(e.detail.id));
    }

    // Close tag menu on outside click if legacy dropdown is used
    document.addEventListener('click', () => {
      if (this.tagMenuDropdown) this.tagMenuDropdown.classList.remove('open');
    });
  }

  setupResponsivePlaceholder() {
    if (!this.noteInput) return;

    const desktopPlaceholder = this.noteInput.dataset.placeholderDesktop ||
      'Type annotation note here… (Press Enter to save, N to capture timestamp)';
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
    const inBtn = document.getElementById('in-point-btn');
    const outBtn = document.getElementById('out-point-btn');
    if (inBtn) inBtn.classList.remove('active');
    if (outBtn) outBtn.classList.remove('active');
    this.updateRangeStatusUI();
    state.emit('timelinechanged');
  }

  updateRangeStatusUI() {
    const clearBtn = document.getElementById('clear-range-btn');
    const inBtn = document.getElementById('in-point-btn');
    const outBtn = document.getElementById('out-point-btn');

    if (inBtn) inBtn.classList.toggle('active', state.inPoint !== null);
    if (outBtn) outBtn.classList.toggle('active', state.outPoint !== null);
    if (clearBtn) clearBtn.style.display = state.inPoint !== null ? 'inline-flex' : 'none';
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

  saveEditNote(id, text = null) {
    const note = state.notes.find(n => n.id === id);
    if (note) {
      if (typeof text === 'string') {
        note.text = text.trim() || note.text;
      } else {
        const editArea = this.notesList ? this.notesList.querySelector(`textarea`) : null;
        if (editArea) note.text = editArea.value.trim() || note.text;
      }
      note.updatedAt = new Date().toISOString();
    }
    state.editingNoteId = null;
    state.emit('noteschange');
    state.emit('requestsave');
    showToast('Note updated');
  }

  jumpToNote(start) {
    this.player.seekTo(start);
    if (window.innerWidth <= 1024) {
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
    this.resetRangeAndInputState();
    state.emit('noteschange');
    state.emit('requestsave');
    showToast('All notes cleared');
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

  async captureFullResFrame(timecode) {
    if (!state.mediaUrl || state.isAudio) return null;

    // 1. Try offscreen video element to avoid disrupting playback
    try {
      const offscreenResult = await new Promise((resolve) => {
        const offVideo = document.createElement('video');
        offVideo.muted = true;
        offVideo.playsInline = true;
        offVideo.preload = 'auto';
        offVideo.src = state.mediaUrl;

        let resolved = false;
        const cleanup = () => {
          if (resolved) return;
          resolved = true;
          offVideo.removeAttribute('src');
          offVideo.load();
        };

        const timer = setTimeout(() => {
          cleanup();
          resolve(null);
        }, 3000);

        const onSeeked = () => {
          clearTimeout(timer);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = offVideo.videoWidth || 640;
            canvas.height = offVideo.videoHeight || 360;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(offVideo, 0, 0, canvas.width, canvas.height);
            cleanup();
            canvas.toBlob((blob) => {
              resolve(blob ? URL.createObjectURL(blob) : null);
            }, 'image/png');
          } catch (err) {
            cleanup();
            resolve(null);
          }
        };

        offVideo.addEventListener('loadedmetadata', () => {
          const targetTime = Math.max(0, Math.min(timecode, offVideo.duration || timecode));
          if (Math.abs(offVideo.currentTime - targetTime) < 0.05) {
            onSeeked();
          } else {
            offVideo.currentTime = targetTime;
          }
        }, { once: true });

        offVideo.addEventListener('seeked', onSeeked, { once: true });
        offVideo.addEventListener('error', () => {
          clearTimeout(timer);
          cleanup();
          resolve(null);
        }, { once: true });
      });

      if (offscreenResult) return offscreenResult;
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

    const baseName = (state.mediaFile?.name || 'snapshot').replace(/\.[^/.]+$/, '');
    const timeStr = timecode !== null ? formatTime(timecode).replace(/[:.]/g, '-') : 'frame';
    const isPng = Boolean(fullResUrl);
    const filename = `${baseName}_${timeStr}.png`;

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
