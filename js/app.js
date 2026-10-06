/* ==========================================================================
   Lined Notes Application Coordinator & Entry Point
   ========================================================================== */

import './components/index.js';
import { state } from './state.js';
import { APP_CONFIG } from './config.js';
import { LinedNotesDB } from './db.js';
import { PlayerController } from './player.js';
import { TimelineEngine } from './timeline.js';
import { NotesManager } from './notes.js';
import { SessionsManager } from './sessions.js';
import { ExportManager } from './export.js';
import { ImportManager } from './import.js';
import { showToast, parseLaunchParams, formatBytes } from './utils.js';

export class LinedNotesApp {
  constructor() {
    this.state = state;
    this.db = new LinedNotesDB();
    this.player = new PlayerController();
    this.timeline = new TimelineEngine(this.player);
    this.notes = new NotesManager(this.player);
    this.sessions = new SessionsManager(this.db, this.player);
    this.export = new ExportManager();
    this.import = new ImportManager();

    this.shortcutsModal = document.getElementById('shortcuts-modal');
    this.settingsModal = document.getElementById('settings-modal');
    this.dropZone = document.getElementById('drop-zone');
    this.deferredInstallPrompt = null;

    this.init();
  }

  init() {
    this.initTheme();
    this.initPreferences();
    this.setupWindowEvents();
    this.setupDragAndDrop();
    this.initPwa();

    // Listen for mobile tab requests from notes manager
    state.on('requestmobiletab', (tab) => this.setMobileTab(tab));

    this.handleLaunchParams();
  }

  /**
   * Handles how the app was launched: manifest shortcut (?action=open), deep links
   * (?v=…&t=…) and shared links from the Web Share Target (?url=… / ?text=…).
   */
  handleLaunchParams() {
    const { action, mediaInput } = parseLaunchParams(window.location.search, window.location.hash);
    if (!action && !mediaInput) return;
    // Strip the params so a reload doesn't re-trigger them
    try {
      history.replaceState(null, '', window.location.pathname);
    } catch (e) { }

    if (mediaInput) {
      this.player.loadExternalUrl(mediaInput);
      return;
    }
    if (action === 'open' && this.dropZone) {
      // A file picker can't be opened without a user gesture: point at the drop zone instead
      this.dropZone.classList.remove('hidden');
      this.dropZone.classList.add('dragging');
      setTimeout(() => this.dropZone.classList.remove('dragging'), 1600);
      showToast('Click here or drop a file to open media', false, null, 5000);
    }
  }

  initTheme() {
    try {
      const saved = localStorage.getItem(APP_CONFIG.themeStorageKey);
      const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      const theme = saved || (prefersLight ? 'light' : 'dark');
      this.applyTheme(theme, false, false);

      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
          if (!localStorage.getItem(APP_CONFIG.themeStorageKey)) {
            this.applyTheme(e.matches ? 'light' : 'dark', false, true);
          }
        });
      }
    } catch (e) { }
  }

  applyTheme(theme, save = true, animate = false) {
    state.theme = theme;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'light' ? '#f7f4ee' : '#141210');
    }
    if (save) {
      try {
        localStorage.setItem(APP_CONFIG.themeStorageKey, theme);
      } catch (e) { }
    }

    if (!animate) {
      document.documentElement.setAttribute('data-theme', theme);
      state.emit('themechanged', { theme, transitioning: false });
      return;
    }

    // Coordinated zero-flicker transition across entire DOM and canvas
    clearTimeout(this.themeTransitionTimeout);
    document.documentElement.classList.add('theme-transitioning');
    document.documentElement.setAttribute('data-theme', theme);

    state.emit('themechanged', { theme, transitioning: true, duration: 300 });

    this.themeTransitionTimeout = setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning');
      state.emit('themechanged', { theme, transitioning: false });
    }, 320);
  }

  toggleTheme() {
    const next = state.theme === 'light' ? 'dark' : 'light';
    this.applyTheme(next, true, true);
    showToast(`Theme: ${next.charAt(0).toUpperCase() + next.slice(1)} Mode`);
  }

  initPreferences() {
    try {
      const savedPause = localStorage.getItem(APP_CONFIG.pauseOnTypeKey);
      state.pauseOnType = savedPause === 'true';

      const copyKey = (APP_CONFIG && APP_CONFIG.copyIncludeTimestampKey) || 'ln_copy_include_timestamp';
      const savedCopyTimestamp = localStorage.getItem(copyKey);
      state.copyIncludeTimestamp = savedCopyTimestamp === 'true';

      const savedOffset = parseFloat(localStorage.getItem(APP_CONFIG.stampOffsetKey));
      state.stampOffset = isFinite(savedOffset) && savedOffset >= 0 ? savedOffset : 0;
      this.updateSettingsUI();
    } catch (e) { }
  }

  setStampOffset(val) {
    const secs = parseFloat(val);
    state.stampOffset = isFinite(secs) && secs >= 0 ? secs : 0;
    try {
      localStorage.setItem(APP_CONFIG.stampOffsetKey, String(state.stampOffset));
    } catch (e) { }
    this.updateSettingsUI();
    showToast(state.stampOffset ? `Timestamps captured while playing move back ${state.stampOffset}s` : 'Stamp offset off');
  }

  async updateStorageInfo() {
    const infoEl = document.getElementById('storage-info');
    const btn = document.getElementById('storage-persist-btn');
    const storage = navigator.storage;
    if (!infoEl) return;
    if (!storage || typeof storage.estimate !== 'function') {
      infoEl.textContent = 'Storage details are not available in this browser. Use "Back Up All" in Projects to keep a copy.';
      return;
    }
    try {
      const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([
        storage.estimate(),
        typeof storage.persisted === 'function' ? storage.persisted() : Promise.resolve(false)
      ]);
      const protection = persisted
        ? 'Protected from automatic clean-up.'
        : 'Not protected: the browser may delete projects when disk space is low.';
      infoEl.textContent = `${formatBytes(usage)} used of ${formatBytes(quota)}. ${protection}`;
      if (btn) btn.style.display = persisted || typeof storage.persist !== 'function' ? 'none' : 'inline-flex';
    } catch (e) {
      infoEl.textContent = 'Could not read storage usage.';
    }
  }

  async requestPersistentStorage() {
    try {
      const granted = await navigator.storage.persist();
      showToast(granted ? 'Projects are now protected from automatic clean-up' : 'The browser declined; back up projects regularly', false, null, 5000);
    } catch (e) {
      showToast('Persistent storage is not supported here');
    }
    this.updateStorageInfo();
  }

  togglePauseOnType(enabled) {
    if (typeof enabled === 'boolean') {
      state.pauseOnType = enabled;
    } else {
      state.pauseOnType = !state.pauseOnType;
    }
    try {
      localStorage.setItem(APP_CONFIG.pauseOnTypeKey, state.pauseOnType ? 'true' : 'false');
    } catch (e) { }
    this.updateSettingsUI();
  }

  toggleCopyIncludeTimestamp(enabled) {
    if (typeof enabled === 'boolean') {
      state.copyIncludeTimestamp = enabled;
    } else {
      state.copyIncludeTimestamp = !state.copyIncludeTimestamp;
    }
    try {
      const copyKey = (APP_CONFIG && APP_CONFIG.copyIncludeTimestampKey) || 'ln_copy_include_timestamp';
      localStorage.setItem(copyKey, state.copyIncludeTimestamp ? 'true' : 'false');
    } catch (e) { }
    this.updateSettingsUI();
    showToast(state.copyIncludeTimestamp ? 'Copy timecode enabled' : 'Copy timecode disabled');
  }

  updateSettingsUI() {
    const copyToggle = document.getElementById('setting-copy-timestamp');
    if (copyToggle) {
      copyToggle.checked = !!state.copyIncludeTimestamp;
    }
    const pauseToggle = document.getElementById('setting-pause-on-type');
    if (pauseToggle) {
      pauseToggle.checked = !!state.pauseOnType;
    }
    const offsetSelect = document.getElementById('setting-stamp-offset');
    if (offsetSelect) {
      offsetSelect.value = String(state.stampOffset || 0);
    }
  }

  setupWindowEvents() {
    const keyActions = {
      ' ': (e) => {
        e.preventDefault();
        this.player.togglePlay();
      },
      'arrowleft': (e) => {
        e.preventDefault();
        this.player.skip(e.shiftKey ? -1 : -5);
      },
      'arrowright': (e) => {
        e.preventDefault();
        this.player.skip(e.shiftKey ? 1 : 5);
      },
      'j': () => this.player.skip(-10),
      'k': () => this.player.togglePlay(),
      'l': (e) => {
        if (e.shiftKey) {
          e.preventDefault();
          this.player.toggleLoop();
        } else {
          this.player.skip(10);
        }
      },
      '+': (e) => {
        e.preventDefault();
        this.zoomIn();
      },
      '-': (e) => {
        e.preventDefault();
        this.zoomOut();
      },
      'n': (e) => {
        e.preventDefault();
        this.notes.captureCurrentTime();
      },
      'i': () => this.notes.setAPoint(),
      'o': () => this.notes.setBPoint(),
      'a': () => this.notes.setAPoint(),
      'b': () => this.notes.setBPoint(),
      ',': () => this.jumpPrevNote(),
      '.': () => this.jumpNextNote(),
      'm': () => this.player.toggleMute(),
      'f': () => this.player.toggleFullscreen(),
      'p': () => this.player.togglePiP(),
      't': () => this.toggleTheme(),
      '?': () => this.openShortcutsModal(),
      'escape': () => this.closeAllModals()
    };
    keyActions['='] = keyActions['+'];
    keyActions['_'] = keyActions['-'];
    keyActions['['] = keyActions[','];
    keyActions[']'] = keyActions['.'];
    // Shift+, / Shift+. (US layout: < and >) nudge the active note
    keyActions['<'] = (e) => {
      e.preventDefault();
      this.notes.nudgeActiveNote(-0.1);
    };
    keyActions['>'] = (e) => {
      e.preventDefault();
      this.notes.nudgeActiveNote(0.1);
    };

    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement ? document.activeElement.tagName : '';
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // Enter in note input adds note (Shift+Enter or mobile/touch keyboards allow paragraph newlines)
      if (e.key === 'Enter' && document.activeElement === this.notes.noteInput) {
        const isMobileOrTablet = window.matchMedia && (
          window.matchMedia('(max-width: 1024px)').matches ||
          window.matchMedia('(pointer: coarse)').matches
        );
        if (e.shiftKey || (isMobileOrTablet && !e.ctrlKey && !e.metaKey)) {
          // Allow multiline paragraph formatting
          return;
        }
        e.preventDefault();
        this.notes.saveNote();
        return;
      }

      if (isInput) {
        if (e.key === 'Escape') {
          document.activeElement.blur();
        }
        return;
      }

      // Ctrl/Cmd+Z outside text fields undoes the last note change
      const modalOpen = Boolean(document.querySelector('modal-dialog.open'));
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key || '').toLowerCase() === 'z' && !modalOpen) {
        e.preventDefault();
        this.notes.undo();
        return;
      }

      // Leave browser/OS shortcuts (Ctrl/Cmd+A, Ctrl+−, Ctrl+P, Alt+←, …) alone
      // (AltGr reports as Ctrl+Alt on some layouts and is needed to type [ ] on e.g. German keyboards)
      const isAltGraph = typeof e.getModifierState === 'function' && e.getModifierState('AltGraph');
      if ((e.ctrlKey || e.metaKey || e.altKey) && !isAltGraph) return;

      // While a dialog is open only Escape applies (modal-dialog handles its own close)
      if (modalOpen && e.key !== 'Escape') return;

      const key = (e.key || '').toLowerCase();
      const action = keyActions[key];
      if (action) {
        action(e);
      }
    });

    // Dismiss modals when clicking directly on overlay backdrop
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.closeAllModals();
        }
      });
    });

    // Pause while typing a note (if enabled) and resume once it's saved or abandoned
    if (this.notes.noteInput) {
      const input = this.notes.noteInput;
      const pauseForTyping = () => {
        if (state.pauseOnType && state.isPlaying) {
          this.pausedForTyping = true;
          this.player.pause();
        }
      };
      const resumeAfterTyping = () => {
        if (!this.pausedForTyping) return;
        this.pausedForTyping = false;
        if (!state.isPlaying) this.player.play();
      };
      input.addEventListener('focus', pauseForTyping);
      // Focus may stay in the box after Enter saves a note, so also catch the next keystroke
      input.addEventListener('input', () => {
        if (input.value) pauseForTyping();
      });
      input.addEventListener('blur', () => {
        if (!input.value.trim()) resumeAfterTyping();
      });
      state.on('notesaved', resumeAfterTyping);
      // Switching media must not resume the new source
      state.on('filereset', () => { this.pausedForTyping = false; });
    }

    // Only warn on unload if there are genuine unsaved edits (ISSUE-08 fix)
    window.addEventListener('beforeunload', (e) => {
      const hasDraft = Boolean(this.notes.noteInput && this.notes.noteInput.value.trim());
      if (state.isDirty || hasDraft) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  setupDragAndDrop() {
    // Prevent Firefox and other browsers from navigating the entire window to the dropped file
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      // Already handled by the drop zone's own listener
      if (e.defaultPrevented) return;
      e.preventDefault();
      // If dropped outside the initial dropZone, seamlessly load the dropped file or URL
      if (!this.dropZone || this.dropZone.classList.contains('hidden') || !this.dropZone.contains(e.target)) {
        const text = e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('text/uri-list');
        if (text && text.trim().startsWith('http')) {
          this.player.loadExternalUrl(text.trim());
          return;
        }
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          this.player.loadFile(files[0]);
        }
      }
    });

    if (!this.dropZone) return;
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('dragging');
    });
    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('dragging');
    });
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('dragging');

      // Check if dropped item was a URL string / link
      const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
      if (text && text.trim().startsWith('http')) {
        this.player.loadExternalUrl(text.trim());
        return;
      }

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        this.player.loadFile(files[0]);
      }
    });

    // Global clipboard paste detection for YouTube / video URLs
    window.addEventListener('paste', (e) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
      if (isInput) return;

      const pastedText = ((e.clipboardData || window.clipboardData)?.getData('text') || '').trim();
      const looksLikeUrl = /^https?:\/\/\S+$/i.test(pastedText) || /^(www\.|m\.)?(youtube\.com|youtu\.be)\/\S+$/i.test(pastedText);
      if (!looksLikeUrl) return;
      e.preventDefault();
      if (state.hasMedia() || state.notes.length > 0) {
        // A project is open: let the user confirm instead of switching immediately
        this.openUrlModal(pastedText);
      } else {
        this.player.loadExternalUrl(pastedText);
      }
    });
  }

  // ─── MOBILE VIEW SWITCHER ──────────────────────────────────────────
  setMobileTab(tab) {
    state.mobileTab = tab;
    const mobileTabs = document.querySelector('mobile-tabs');
    if (mobileTabs && typeof mobileTabs.setTab === 'function') {
      mobileTabs.setTab(tab);
    } else {
      const appEl = document.getElementById('app');
      if (appEl) {
        appEl.setAttribute('data-mobile-view', tab);
      }
      const tabMedia = document.getElementById('tab-btn-media');
      const tabNotes = document.getElementById('tab-btn-notes');
      if (tabMedia && tabNotes) {
        if (tab === 'notes') {
          tabMedia.classList.remove('active');
          tabMedia.setAttribute('aria-selected', 'false');
          tabNotes.classList.add('active');
          tabNotes.setAttribute('aria-selected', 'true');
        } else {
          tabNotes.classList.remove('active');
          tabNotes.setAttribute('aria-selected', 'false');
          tabMedia.classList.add('active');
          tabMedia.setAttribute('aria-selected', 'true');
        }
      }
    }
    if (tab === 'media') {
      setTimeout(() => this.timeline.drawTimeline(), 50);
    }
  }

  toggleMobileTools() {
    const drawer = document.getElementById('secondary-tools-group');
    const btn = document.getElementById('mobile-tools-toggle');
    if (drawer) {
      const isOpen = drawer.classList.toggle('open');
      if (btn) btn.classList.toggle('active', isOpen);
    }
  }

  toggleMobileMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('mobile-dropdown-menu');
    if (menu) {
      const isOpen = menu.classList.toggle('open');
      if (isOpen) {
        const onOutsideClick = (evt) => {
          if (!menu.contains(evt.target)) {
            menu.classList.remove('open');
            document.removeEventListener('click', onOutsideClick);
          }
        };
        setTimeout(() => document.addEventListener('click', onOutsideClick), 0);
      }
    }
  }

  closeMobileMenu() {
    const menu = document.getElementById('mobile-dropdown-menu');
    if (menu) menu.classList.remove('open');
  }

  // ─── MODAL CONTROLS ────────────────────────────────────────────────
  openShortcutsModal() {
    if (this.shortcutsModal) {
      if (typeof this.shortcutsModal.open === 'function') this.shortcutsModal.open();
      else this.shortcutsModal.classList.add('open');
    }
  }

  closeShortcutsModal() {
    if (this.shortcutsModal) {
      if (typeof this.shortcutsModal.close === 'function') this.shortcutsModal.close();
      else this.shortcutsModal.classList.remove('open');
    }
  }

  openSettingsModal() {
    this.updateSettingsUI();
    this.updateStorageInfo();
    const modal = this.settingsModal || document.getElementById('settings-modal');
    if (modal) {
      if (typeof modal.open === 'function') modal.open();
      else modal.classList.add('open');
    }
  }

  closeSettingsModal() {
    const modal = this.settingsModal || document.getElementById('settings-modal');
    if (modal) {
      if (typeof modal.close === 'function') modal.close();
      else modal.classList.remove('open');
    }
  }

  closeAllModals() {
    document.querySelectorAll('modal-dialog').forEach(m => m.close());
    this.closeMobileMenu();
    this.closeUrlModal();
    const tagPicker = document.querySelector('tag-picker');
    if (tagPicker) tagPicker.closeMenu();
  }

  // ─── URL MODAL CONTROLS ───────────────────────────────────────────
  openUrlModal(prefill = '') {
    const modal = document.getElementById('url-modal');
    const input = document.getElementById('url-modal-input');
    if (input) input.value = typeof prefill === 'string' ? prefill : '';
    if (modal) {
      if (typeof modal.open === 'function') modal.open();
      else modal.classList.add('open');
      setTimeout(() => input?.focus(), 80);
    }
  }

  closeUrlModal() {
    const modal = document.getElementById('url-modal');
    if (modal) {
      if (typeof modal.close === 'function') modal.close();
      else modal.classList.remove('open');
    }
  }

  async loadFromUrlModal() {
    const input = document.getElementById('url-modal-input');
    const val = input ? input.value.trim() : '';
    if (!val) {
      showToast('Please enter a YouTube or video URL');
      input?.focus();
      return;
    }
    const success = await this.player.loadExternalUrl(val);
    if (success) {
      this.closeUrlModal();
    }
  }

  async loadFromDropUrlInput() {
    const input = document.getElementById('drop-url-input');
    const val = input ? input.value.trim() : '';
    if (!val) {
      showToast('Please enter a YouTube or video URL');
      input?.focus();
      return;
    }
    const success = await this.player.loadExternalUrl(val);
    if (success && input) {
      input.value = '';
    }
  }

  // ─── PWA & INSTALLATION ────────────────────────────────────────────
  initPwa() {
    // OS "Open with Lined Notes" (manifest file_handlers)
    if ('launchQueue' in window && typeof window.launchQueue.setConsumer === 'function') {
      window.launchQueue.setConsumer(async (launchParams) => {
        const handle = launchParams && launchParams.files && launchParams.files[0];
        if (!handle) return;
        try {
          this.player.loadFile(await handle.getFile());
        } catch (err) {
          console.warn('[PWA] Could not open launched file:', err);
          showToast('Could not open that file');
        }
      });
    }

    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
          .then((reg) => {
            console.log('[PWA] Service Worker registered with scope:', reg.scope);
            // Proactively check for Service Worker updates at HEAD
            reg.update().catch(() => { });
          })
          .catch((err) => {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
      });

      // Proactively check for updates when returning to the PWA window or tab
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          navigator.serviceWorker.getRegistration().then((reg) => {
            reg?.update().catch(() => { });
          });
        }
      });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      const installBtn = document.getElementById('pwa-install-btn');
      if (installBtn) installBtn.style.display = 'inline-flex';
      const menuItem = document.getElementById('menu-item-install');
      if (menuItem) menuItem.style.display = 'flex';
    });

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      const installBtn = document.getElementById('pwa-install-btn');
      if (installBtn) installBtn.style.display = 'none';
      const menuItem = document.getElementById('menu-item-install');
      if (menuItem) menuItem.style.display = 'none';
      showToast('Lined Notes installed successfully!');
    });

    window.addEventListener('online', () => {
      const badge = document.getElementById('offline-badge');
      if (badge) badge.style.display = 'none';
      showToast('Back online');
    });

    window.addEventListener('offline', () => {
      const badge = document.getElementById('offline-badge');
      if (badge) badge.style.display = 'inline-flex';
      showToast('Offline mode — working locally');
    });

    if (!navigator.onLine) {
      const badge = document.getElementById('offline-badge');
      if (badge) badge.style.display = 'inline-flex';
    }
  }

  async promptPwaInstall() {
    if (!this.deferredInstallPrompt) {
      showToast('App is already installed or not supported by this browser');
      return;
    }
    this.deferredInstallPrompt.prompt();
    const choice = await this.deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      showToast('Installing Lined Notes…');
    }
    this.deferredInstallPrompt = null;
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) installBtn.style.display = 'none';
  }

  // ─── CONVENIENCE PROXIES FOR DOM HANDLERS ─────────────────────────
  get zoom() {
    return state.zoom;
  }

  handleFileSelect(file) {
    if (!file) return;
    this.player.loadFile(file);
    const picker = document.getElementById('file-picker');
    if (picker) picker.value = '';
  }

  newProject() {
    const hasMedia = state.hasMedia();
    if (!hasMedia && state.notes.length === 0) {
      showToast('Already on a new project');
      return;
    }

    // Auto-save existing session so no work is lost
    if (state.notes.length > 0) {
      state.emit('requestsave');
    }

    // Stop & reset playback
    this.player.resetPlaybackState();
    const picker = document.getElementById('file-picker');
    if (picker) picker.value = '';
    const dropUrlInput = document.getElementById('drop-url-input');
    if (dropUrlInput) dropUrlInput.value = '';

    if (state.mediaUrl && state.mediaUrl.startsWith('blob:')) {
      URL.revokeObjectURL(state.mediaUrl);
    }
    state.mediaUrl = null;

    if (this.player.videoEl) {
      try {
        this.player.videoEl.pause();
      } catch (e) { }
      this.player.videoEl.removeAttribute('src');
      this.player.videoEl.load();
      this.player.videoEl.classList.remove('active');
    }

    if (this.player.youtubeStage) {
      this.player.youtubeStage.classList.remove('active');
    }

    if (this.player.audioStage) {
      this.player.audioStage.classList.remove('active');
    }

    const detachedStage = document.getElementById('detached-stage');
    if (detachedStage) detachedStage.style.display = 'none';

    // Clear application state
    state.mediaFile = null;
    state.mediaSourceType = null;
    state.externalUrl = null;
    state.youtubeVideoId = null;
    state.mediaTitle = null;
    state.detachedMode = false;
    state.detachedSessionKey = null;
    state.detachedSessionName = null;
    state.detachedSessionSize = 0;
    state.notes = [];
    state.isDirty = false;
    state.activeNoteId = null;
    state.editingNoteId = null;
    state.APoint = null;
    state.BPoint = null;
    state.isLooping = false;
    state.isTimeStamped = false;
    state.waveformPeaks = null;
    state.isWaveformPending = false;
    state.duration = 0;
    state.currentTime = 0;
    state.zoom = 1;
    state.scrollOffset = 0;

    // Restore empty drop-zone and header badge
    const badge = document.getElementById('file-badge');
    const nameText = document.getElementById('file-name-text');
    if (badge) badge.classList.remove('active');
    if (nameText) nameText.textContent = 'No media loaded';
    document.title = 'Lined Notes — Audio & Video Annotation';

    const dropZone = document.getElementById('drop-zone');
    if (dropZone) dropZone.classList.remove('hidden');

    // Switch mobile tab to media panel so drop zone is visible
    if (window.innerWidth <= 1024) {
      state.emit('requestmobiletab', 'media');
    }

    state.emit('filereset');
    state.emit('noteschange');
    state.emit('timelinechanged');

    showToast('Started new project');
  }

  setZoom(zoom) {
    this.timeline.setZoom(zoom);
  }

  resetZoom() {
    this.timeline.resetZoom();
  }

  zoomIn() {
    const nextZoom = state.zoom * 1.5;
    if (this.timeline && typeof this.timeline.zoomIn === 'function') {
      this.timeline.zoomIn();
    } else if (this.timeline && typeof this.timeline.setZoom === 'function') {
      this.timeline.setZoom(nextZoom);
    }
  }

  zoomOut() {
    const nextZoom = state.zoom / 1.5;
    if (this.timeline && typeof this.timeline.zoomOut === 'function') {
      this.timeline.zoomOut();
    } else if (this.timeline && typeof this.timeline.setZoom === 'function') {
      this.timeline.setZoom(nextZoom);
    }
  }

  togglePlay() {
    this.player.togglePlay();
  }

  skip(delta) {
    this.player.skip(delta);
  }

  cycleSpeed() {
    this.player.cycleSpeed();
  }

  stepFrame(delta) {
    this.player.stepFrame(delta);
  }

  jumpPrevNote() {
    this.notes.jumpPrevNote();
  }

  jumpNextNote() {
    this.notes.jumpNextNote();
  }

  setInPoint() {
    this.notes.setAPoint();
  }

  setOutPoint() {
    this.notes.setBPoint();
  }

  toggleLoop() {
    this.player.toggleLoop();
  }

  clearRange() {
    this.notes.clearRange();
  }

  toggleMute() {
    this.player.toggleMute();
  }

  setVolume(val) {
    this.player.setVolume(val);
  }

  setSpeed(val) {
    this.player.setSpeed(val);
  }

  togglePiP() {
    this.player.togglePiP();
  }

  toggleFullscreen() {
    this.player.toggleFullscreen();
  }

  captureCurrentTime() {
    this.notes.captureCurrentTime();
  }

  toggleTagMenu(e) {
    this.notes.toggleTagMenu(e);
  }

  saveNote() {
    this.notes.saveNote();
  }

  clearAllNotes() {
    this.notes.clearAllNotes();
  }

  onSearchInput(val) {
    this.notes.onSearchInput(val);
  }

  downloadLightboxImage() {
    this.notes.downloadLightboxImage();
  }

  openLightbox(src, timecode = null) {
    this.notes.openLightbox(src, timecode);
  }

  closeLightbox() {
    this.notes.closeLightbox();
  }

  onToastAction() {
    const undoBtn = document.getElementById('toast-action');
    if (undoBtn && undoBtn.onclick) {
      undoBtn.onclick();
    }
  }

  openSessionsModal() {
    this.sessions.openSessionsModal();
  }

  closeSessionsModal() {
    this.sessions.closeSessionsModal();
  }

  refreshSessionsModal() {
    this.sessions.refreshSessionsModal();
  }

  filterSessionsList(val) {
    this.sessions.filterSessionsList(val);
  }

  openExportModal() {
    this.export.openExportModal();
  }

  closeExportModal() {
    this.export.closeExportModal();
  }

  selectExportFmt(el) {
    this.export.selectExportFmt(el);
  }

  shareExport() {
    this.export.shareExport();
  }

  copyExportToClipboard() {
    this.export.copyExportToClipboard();
  }

  doExportDownload() {
    this.export.doExportDownload();
  }

  openImportModal() {
    this.import.openImportModal();
  }

  closeImportModal() {
    this.import.closeImportModal();
  }

  handleImportFile(file) {
    this.import.handleImportFile(file);
  }
}

// Global bootstrap instance
const app = new LinedNotesApp();
window.app = app;
window.state = state;
export default app;
