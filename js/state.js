/* ==========================================================================
   Reactive Application State Store & Event Bus
   ========================================================================== */

import { DEFAULT_TAGS, APP_CONFIG } from './config.js';

class StateStore {
  constructor() {
    this.listeners = new Map();

    // Media & Playback State
    this.mediaFile = null;
    this.mediaUrl = null;
    this.isAudio = false;
    this.currentTime = 0;
    this.duration = 0;
    this.isPlaying = false;
    this.isScrubbing = false;
    this.volume = 1;
    this.isMuted = false;
    this.playbackRate = 1;

    // Detached Review Mode State
    this.detachedMode = false;
    this.detachedSessionKey = null;
    this.detachedSessionName = null;
    this.detachedSessionSize = 0;

    // Timeline Zoom & Pan
    this.zoom = 1;
    this.scrollOffset = 0;
    this.hoverTime = null;
    this.hoverX = null;
    this.waveformPeaks = null;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartOffset = 0;

    // Range / In-Out & Loop State
    this.inPoint = null;
    this.outPoint = null;
    this.isLooping = false;
    this.stampTime = 0;
    this.isTimeStamped = false;

    // Notes Data
    this.notes = [];
    this.activeNoteId = null;
    this.editingNoteId = null;
    this.searchQuery = '';
    this.filterTag = 'all';
    this.tags = [...DEFAULT_TAGS];
    this.selectedTag = 'note';

    // Application Preferences & Flags
    this.theme = 'dark';
    this.pauseOnType = false;
    this.selectedExportFmt = 'json';
    this.deletedHistory = [];
    this.mobileTab = 'media';
    this.isDirty = false; // Only warns on exit when actually unsaved (ISSUE-08 fix)
  }

  on(event, fn) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(fn);
    }
  }

  emit(event, ...args) {
    if (this.listeners.has(event)) {
      for (const fn of this.listeners.get(event)) {
        try {
          fn(...args);
        } catch (err) {
          console.error(`Error in state event listener [${event}]:`, err);
        }
      }
    }
  }

  getStorageKey() {
    if (this.mediaFile) {
      return `ln_session_${this.mediaFile.name}_${this.mediaFile.size}`;
    }
    if (this.detachedSessionKey) {
      return this.detachedSessionKey;
    }
    return null;
  }
}

export const state = new StateStore();
