/* ==========================================================================
   Lined Notes Application Coordinator & Entry Point
   ========================================================================== */

import { state } from './state.js';
import { APP_CONFIG } from './config.js';
import { LinedNotesDB } from './db.js';
import { PlayerController } from './player.js';
import { TimelineEngine } from './timeline.js';
import { NotesManager } from './notes.js';
import { SessionsManager } from './sessions.js';
import { ExportManager } from './export.js';
import { ImportManager } from './import.js';
import { showToast } from './utils.js';

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
    this.pauseToggleBtn = document.getElementById('pause-toggle-btn');
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
    } catch (e) {}
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
      } catch (e) {}
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
      this.updatePauseToggleUI();
    } catch (e) {}
  }

  togglePauseOnType(enabled) {
    if (typeof enabled === 'boolean') {
      state.pauseOnType = enabled;
    } else {
      state.pauseOnType = !state.pauseOnType;
    }
    try {
      localStorage.setItem(APP_CONFIG.pauseOnTypeKey, state.pauseOnType ? 'true' : 'false');
    } catch (e) {}
    this.updatePauseToggleUI();
  }

  updatePauseToggleUI() {
    const btn = this.pauseToggleBtn || document.getElementById('pause-toggle-btn');
    if (btn) {
      btn.classList.toggle('active', !!state.pauseOnType);
      btn.setAttribute('aria-pressed', state.pauseOnType ? 'true' : 'false');
      btn.setAttribute('title', state.pauseOnType ? 'Pause while typing is ON (Click to disable)' : 'Pause while typing is OFF (Click to enable)');
    }
  }

  setupWindowEvents() {
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement ? document.activeElement.tagName : '';
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // Enter in note input adds note
      if (e.key === 'Enter' && document.activeElement === this.notes.noteInput) {
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

      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.player.togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.player.skip(e.shiftKey ? -1 : -5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.player.skip(e.shiftKey ? 1 : 5);
          break;
        case 'j':
        case 'J':
          this.player.skip(-10);
          break;
        case 'k':
        case 'K':
          this.player.togglePlay();
          break;
        case 'l':
        case 'L':
          if (e.shiftKey) {
            e.preventDefault();
            this.player.toggleLoop();
          } else {
            this.player.skip(10);
          }
          break;
        case '+':
        case '=':
          e.preventDefault();
          this.timeline.setZoom(state.zoom * 1.5);
          break;
        case '-':
        case '_':
          e.preventDefault();
          this.timeline.setZoom(state.zoom / 1.5);
          break;
        case ',':
          this.player.stepFrame(-1);
          break;
        case '.':
          this.player.stepFrame(1);
          break;
        case 'n':
        case 'N':
          e.preventDefault();
          this.notes.captureCurrentTime();
          break;
        case 'i':
        case 'I':
          this.notes.setInPoint();
          break;
        case 'o':
        case 'O':
          this.notes.setOutPoint();
          break;
        case '[':
          this.notes.jumpPrevNote();
          break;
        case ']':
          this.notes.jumpNextNote();
          break;
        case 'm':
        case 'M':
          this.player.toggleMute();
          break;
        case 'f':
        case 'F':
          this.player.toggleFullscreen();
          break;
        case 'p':
        case 'P':
          this.player.togglePiP();
          break;
        case 't':
        case 'T':
          this.toggleTheme();
          break;
        case '?':
          this.openShortcutsModal();
          break;
        case 'Escape':
          this.closeAllModals();
          break;
      }
    });

    // Auto-pause when user starts typing if enabled
    if (this.notes.noteInput) {
      this.notes.noteInput.addEventListener('focus', () => {
        if (state.pauseOnType && state.isPlaying) {
          this.player.videoEl.pause();
        }
      });
    }

    // Only warn on unload if there are genuine unsaved edits (ISSUE-08 fix)
    window.addEventListener('beforeunload', (e) => {
      if (state.isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  setupDragAndDrop() {
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
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        this.player.loadFile(files[0]);
      }
    });
  }

  // ─── MOBILE VIEW SWITCHER ──────────────────────────────────────────
  setMobileTab(tab) {
    state.mobileTab = tab;
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
    if (this.shortcutsModal) this.shortcutsModal.classList.add('open');
  }

  closeShortcutsModal() {
    if (this.shortcutsModal) this.shortcutsModal.classList.remove('open');
  }

  closeAllModals() {
    this.export.closeExportModal();
    this.import.closeImportModal();
    this.sessions.closeSessionsModal();
    this.notes.closeLightbox();
    this.closeShortcutsModal();
    this.closeMobileMenu();
    const tagMenu = document.getElementById('tag-menu-dropdown');
    if (tagMenu) tagMenu.classList.remove('open');
  }

  // ─── PWA & INSTALLATION ────────────────────────────────────────────
  initPwa() {
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then((reg) => {
            console.log('[PWA] Service Worker registered with scope:', reg.scope);
          })
          .catch((err) => {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
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

  onDrop(e) {
    e.preventDefault();
    if (this.dropZone) this.dropZone.classList.remove('dragging');
    const files = e.dataTransfer ? e.dataTransfer.files : null;
    if (files && files.length > 0) {
      this.player.loadFile(files[0]);
    }
  }

  onDragOver(e) {
    e.preventDefault();
    if (this.dropZone) this.dropZone.classList.add('dragging');
  }

  onDragLeave(e) {
    if (this.dropZone) this.dropZone.classList.remove('dragging');
  }

  setZoom(zoom) {
    this.timeline.setZoom(zoom);
  }

  resetZoom() {
    this.timeline.resetZoom();
  }

  startScrub(e) {
    this.timeline.startScrub(e);
  }

  onTimelineHover(e) {
    this.timeline.onTimelineHover(e);
  }

  clearHover() {
    this.timeline.clearHover();
  }

  onTimelineWheel(e) {
    this.timeline.onTimelineWheel(e);
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

  setInPoint() {
    this.notes.setInPoint();
  }

  setOutPoint() {
    this.notes.setOutPoint();
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
export default app;
