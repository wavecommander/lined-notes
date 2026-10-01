/* ==========================================================================
   Sessions & Saved Projects Manager
   Handles session auto-persistence, detached review mode & projects UI
   ========================================================================== */

import { state } from './state.js';
import { escapeHtml, timeAgo, formatTime, formatBytes, showToast } from './utils.js';

export class SessionsManager {
  constructor(db, playerController) {
    this.db = db;
    this.player = playerController;
    this.sessionsModal = document.getElementById('sessions-modal');
    this.sessionsList = document.getElementById('sessions-list');
    this.projectsBtn = document.getElementById('projects-btn');
    this.projectsBadge = document.getElementById('projects-count-badge');
    this.menuProjectsCount = document.getElementById('menu-projects-count');
    this.searchInput = document.getElementById('sessions-search-input');
    this.detachedStage = document.getElementById('detached-stage');
    this.editingSessionKey = null;

    this.init();
  }

  init() {
    state.on('requestsave', () => this.saveSession());
    state.on('medialoaded', () => this.autoRestoreSession());

    // Delegated click handler on sessions list for open, export, delete, and rename
    if (this.sessionsList) {
      this.sessionsList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-session-action]');
        if (!btn) return;
        e.stopPropagation();
        const action = btn.dataset.sessionAction;
        const key = btn.dataset.sessionKey;
        if (action === 'open') this.openSessionByKey(key);
        if (action === 'export') this.exportSessionByKey(key);
        if (action === 'delete') this.deleteSessionByKey(key, e);
        if (action === 'edit-name') this.startRename(key);
        if (action === 'save-name') {
          const card = this.getSessionCardByKey(key);
          const input = card ? card.querySelector('.session-rename-input') : null;
          if (input) this.renameSession(key, input.value);
        }
        if (action === 'cancel-name') this.cancelRename(key);
      });

      this.sessionsList.addEventListener('keydown', (e) => {
        if (e.target && e.target.classList.contains('session-rename-input')) {
          const key = e.target.dataset.sessionKey;
          if (e.key === 'Enter') {
            e.preventDefault();
            this.renameSession(key, e.target.value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            this.cancelRename(key);
          }
        }
      });
    }

    this.updateProjectsCountBadge();
  }

  async saveSession() {
    const key = state.getStorageKey();
    if (!key) return;

    const usedTags = Array.from(new Set(state.notes.map(n => n.tag).filter(Boolean)));
    const fileName = state.mediaTitle || (state.mediaFile ? state.mediaFile.name : (state.detachedSessionName || 'Untitled Media'));
    const originalFileName = state.mediaFile ? state.mediaFile.name : (state.detachedOriginalFileName || null);
    const fileSize = state.mediaFile ? state.mediaFile.size : (state.detachedSessionSize || 0);

    const payload = {
      fileName: fileName,
      originalFileName: originalFileName,
      fileSize: fileSize,
      duration: state.duration || 0,
      isAudio: state.isAudio,
      tags: usedTags,
      updatedAt: new Date().toISOString(),
      notes: state.notes,
      sourceType: state.mediaSourceType || (state.mediaFile ? 'file' : 'detached'),
      url: state.externalUrl || null,
      youtubeVideoId: state.youtubeVideoId || null
    };

    try {
      await this.db.set(key, payload);
      state.isDirty = false; // Reset dirty state on auto-save
      this.updateProjectsCountBadge();
    } catch (e) {
      console.warn('Persistence save error:', e);
    }
  }

  async autoRestoreSession() {
    const key = state.getStorageKey();
    if (!key) return;
    try {
      const data = await this.db.get(key);
      if (data) {
        // Restore custom project title if previously renamed or saved
        if (data.fileName && data.fileName !== state.mediaTitle) {
          state.mediaTitle = data.fileName;
          const nameText = document.getElementById('file-name-text');
          if (nameText) {
            if (state.mediaSourceType === 'youtube') {
              nameText.textContent = `▶ YouTube: ${data.fileName}`;
              nameText.title = `${data.fileName} (${state.externalUrl || ''})`;
            } else if (state.mediaSourceType === 'url') {
              nameText.textContent = `🔗 ${data.fileName}`;
              nameText.title = `${data.fileName} (${state.externalUrl || ''})`;
            } else {
              nameText.textContent = data.fileName;
              if (state.mediaFile) {
                nameText.title = `${data.fileName} (${state.mediaFile.name} • ${formatBytes(state.mediaFile.size)})`;
              }
            }
          }
          const audioTitle = document.getElementById('audio-title');
          if (audioTitle && state.isAudio) {
            audioTitle.textContent = data.fileName;
          }
          document.title = `${data.fileName} — Lined Notes`;
        }

        if (Array.isArray(data.notes) && data.notes.length > 0 && state.notes.length === 0) {
          state.notes = data.notes;
          state.emit('noteschange');
          state.emit('timelinechanged');
          showToast(`Restored ${state.notes.length} notes for ${state.mediaTitle || 'session'}`);
        }
      }
    } catch (e) {
      console.warn('Persistence restore error:', e);
    }
  }

  async updateProjectsCountBadge() {
    try {
      const sessions = await this.db.getAllSessions();
      const count = sessions.length;
      if (this.projectsBadge) {
        if (count > 0) {
          this.projectsBadge.textContent = count;
          this.projectsBadge.style.display = 'inline-flex';
        } else {
          this.projectsBadge.style.display = 'none';
        }
      }
      if (this.menuProjectsCount) {
        this.menuProjectsCount.textContent = count > 0 ? `(${count})` : '';
      }
    } catch (e) {
      console.warn('Failed to update projects badge:', e);
    }
  }

  openSessionsModal() {
    this.editingSessionKey = null;
    this.renderSessionsList();
    if (this.sessionsModal) {
      if (typeof this.sessionsModal.open === 'function') this.sessionsModal.open();
      else this.sessionsModal.classList.add('open');
    }
  }

  closeSessionsModal() {
    this.cancelRename();
    if (this.sessionsModal) {
      if (typeof this.sessionsModal.close === 'function') this.sessionsModal.close();
      else this.sessionsModal.classList.remove('open');
    }
  }

  getSessionCardByKey(key) {
    if (!this.sessionsList || !key) return null;
    const cards = this.sessionsList.querySelectorAll('.session-card');
    for (const card of cards) {
      if (card.dataset.sessionKey === key) return card;
    }
    return null;
  }

  async renderSessionsList(filterQuery = '') {
    if (!this.sessionsList) return;
    if (!this.sessionsList.hasChildNodes() || this.sessionsList.querySelector('.sessions-empty')) {
      this.sessionsList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-family:var(--font-mono);font-size:12px;">Loading saved sessions…</div>';
    }

    const rawSessions = await this.db.getAllSessions();
    rawSessions.sort((a, b) => {
      const tA = new Date(a.updatedAt || a.data?.updatedAt || 0).getTime();
      const tB = new Date(b.updatedAt || b.data?.updatedAt || 0).getTime();
      return tB - tA;
    });

    const currentKey = state.getStorageKey();
    const q = filterQuery.trim().toLowerCase();

    const filtered = rawSessions.filter(item => {
      if (!q) return true;
      const fileName = (item.data?.fileName || item.fileName || '').toLowerCase();
      if (fileName.includes(q)) return true;
      const notes = item.data?.notes || [];
      return notes.some(n => (n.text || '').toLowerCase().includes(q) || (n.tag || '').toLowerCase().includes(q));
    });

    if (filtered.length === 0) {
      if (rawSessions.length === 0) {
        this.sessionsList.innerHTML = `
          <div class="sessions-empty">
            <div class="sessions-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
            </div>
            <div class="sessions-empty-title">No Saved Projects Yet</div>
            <div class="sessions-empty-desc">Open an audio or video file and start creating notes. Your annotations will automatically save here so you can revisit them anytime.</div>
            <button class="btn btn-primary btn-sm" onclick="document.getElementById('file-picker').click(); app.sessions.closeSessionsModal();">
              Open Media File
            </button>
          </div>`;
      } else {
        this.sessionsList.innerHTML = `
          <div class="sessions-empty">
            <div class="sessions-empty-title">No Matching Projects</div>
            <div class="sessions-empty-desc">No saved sessions match "${escapeHtml(q)}". Try a different search term.</div>
          </div>`;
      }
      return;
    }

    let html = '';
    filtered.forEach(item => {
      const key = item.key;
      const isCurrent = (currentKey === key);
      const isEditing = (this.editingSessionKey === key);
      const fileName = item.data?.fileName || item.fileName || 'Untitled Media';
      const fileSize = item.data?.fileSize || item.fileSize || 0;
      const duration = item.data?.duration || 0;
      const isAudio = !!item.data?.isAudio;
      const notes = item.data?.notes || [];
      const noteCount = notes.length;
      const updatedAt = item.updatedAt || item.data?.updatedAt;
      const timeAgoText = timeAgo(updatedAt);

      const sessionTags = Array.from(new Set(notes.map(n => n.tag).filter(Boolean)));
      const tagPills = sessionTags.map(tagId => {
        const tagDef = state.tags.find(t => t.id === tagId);
        const label = tagDef ? tagDef.label : tagId;
        const color = tagDef ? tagDef.color : 'var(--accent-primary)';
        return `<span class="session-tag-pill" style="--tag-color:${color}">${escapeHtml(label)}</span>`;
      }).join('');

      let mediaIconSvg = isAudio
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="2" y="2" width="20" height="20" rx="4"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`;

      let typeBadge = '';
      if (item.data?.sourceType === 'youtube' || item.data?.youtubeVideoId) {
        mediaIconSvg = `<svg viewBox="0 0 24 24" fill="#ff0000" width="16" height="16"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`;
        typeBadge = '<span class="session-badge-type" style="background:rgba(255,0,0,0.12);color:#ff4e45;border:1px solid rgba(255,0,0,0.24);font-size:10px;padding:1px 6px;border-radius:var(--radius-full);font-weight:600;font-family:var(--font-mono);">YouTube</span>';
      } else if (item.data?.sourceType === 'url') {
        mediaIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="2" width="16" height="16"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
        typeBadge = '<span class="session-badge-type" style="background:rgba(56,189,248,0.12);color:var(--accent-cyan);border:1px solid rgba(56,189,248,0.24);font-size:10px;padding:1px 6px;border-radius:var(--radius-full);font-weight:600;font-family:var(--font-mono);">Web Video</span>';
      }

      const fileInfoHtml = `
        <div class="session-file-info">
          <div class="session-title-static">
            <span class="session-media-icon">${mediaIconSvg}</span>
            <span class="session-file-name" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</span>
            <button type="button" class="session-rename-btn" data-session-action="edit-name" data-session-key="${escapeHtml(key)}" title="Rename project" aria-label="Rename project">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </button>
            ${typeBadge}
            ${isCurrent ? '<span class="session-badge-current">Active</span>' : ''}
          </div>
          <div class="session-rename-form">
            <span class="session-media-icon">${mediaIconSvg}</span>
            <input type="text" class="session-rename-input" name="project-rename-input" aria-label="Project name" data-session-key="${escapeHtml(key)}" value="${escapeHtml(fileName)}" maxlength="120" spellcheck="false" autocomplete="off" />
            <button type="button" class="session-rename-action-btn check" data-session-action="save-name" data-session-key="${escapeHtml(key)}" title="Save project name (Enter)" aria-label="Save project name">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            <button type="button" class="session-rename-action-btn cancel" data-session-action="cancel-name" data-session-key="${escapeHtml(key)}" title="Cancel (Esc)" aria-label="Cancel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>`;

      // Using data-session-action and data-session-key (resolves ISSUE-01 single-quote bug)
      html += `
        <div class="session-card ${isCurrent ? 'active' : ''} ${isEditing ? 'is-editing-name' : ''}" data-session-key="${escapeHtml(key)}">
          <div class="session-card-header">
            ${fileInfoHtml}
            <div class="session-time-ago">${timeAgoText}</div>
          </div>

          <div class="session-card-meta">
            <span><strong>${noteCount}</strong> note${noteCount === 1 ? '' : 's'}</span>
            ${duration > 0 ? `<span>•</span><span>${formatTime(duration)}</span>` : ''}
            ${fileSize > 0 ? `<span>•</span><span>${formatBytes(fileSize)}</span>` : ''}
          </div>

          ${tagPills ? `<div class="session-tags-row">${tagPills}</div>` : ''}

          <div class="session-card-actions">
            <button class="btn btn-sm ${isCurrent ? 'btn-ghost' : 'btn-primary'}" data-session-action="open" data-session-key="${escapeHtml(key)}">
              ${isCurrent ? 'Current Session' : 'Open / Review'}
            </button>
            <button class="btn btn-ghost btn-sm" data-session-action="export" data-session-key="${escapeHtml(key)}" title="Export this session's annotations">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Export
            </button>
            <button class="btn btn-ghost btn-sm text-danger" style="margin-left:auto;" data-session-action="delete" data-session-key="${escapeHtml(key)}" title="Delete session">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Delete
            </button>
          </div>
        </div>`;
    });

    this.sessionsList.innerHTML = html;

    if (this.editingSessionKey) {
      const card = this.getSessionCardByKey(this.editingSessionKey);
      const activeInput = card ? card.querySelector('.session-rename-input') : null;
      if (activeInput) {
        activeInput.focus();
        activeInput.select();
      }
    }
  }

  startRename(key) {
    this.cancelRename();
    const card = this.getSessionCardByKey(key);
    if (!card) return;
    this.editingSessionKey = key;
    card.classList.add('is-editing-name');
    const input = card.querySelector('.session-rename-input');
    if (input) {
      const nameEl = card.querySelector('.session-file-name');
      if (nameEl) input.value = nameEl.textContent.trim();
      input.focus();
      input.select();
    }
  }

  cancelRename(key) {
    if (!this.sessionsList) return;
    const cards = this.sessionsList.querySelectorAll('.session-card.is-editing-name');
    cards.forEach(card => {
      if (!key || card.dataset.sessionKey === key) {
        card.classList.remove('is-editing-name');
        const input = card.querySelector('.session-rename-input');
        const nameEl = card.querySelector('.session-file-name');
        if (input && nameEl) {
          input.value = nameEl.textContent.trim();
        }
      }
    });
    if (!key || this.editingSessionKey === key) {
      this.editingSessionKey = null;
    }
  }

  async renameSession(key, newName) {
    const trimmed = (newName || '').trim();
    const card = this.getSessionCardByKey(key);
    if (!trimmed) {
      showToast('Project name cannot be empty');
      const input = card ? card.querySelector('.session-rename-input') : null;
      if (input) input.focus();
      return;
    }

    if (card) {
      const nameEl = card.querySelector('.session-file-name');
      if (nameEl) {
        nameEl.textContent = trimmed;
        nameEl.title = trimmed;
      }
      const input = card.querySelector('.session-rename-input');
      if (input) {
        input.value = trimmed;
      }
      card.classList.remove('is-editing-name');
    }
    this.editingSessionKey = null;

    const isActive = (state.getStorageKey() === key || state.detachedSessionKey === key);

    // If this session is the active session, update state & UI headers
    if (isActive) {
      state.mediaTitle = trimmed;
      if (state.detachedMode) {
        state.detachedSessionName = trimmed;
        const detachedFileNameEl = document.getElementById('detached-file-name');
        if (detachedFileNameEl) detachedFileNameEl.textContent = trimmed;
      }
      const nameText = document.getElementById('file-name-text');
      if (nameText) {
        if (state.mediaSourceType === 'youtube') {
          nameText.textContent = `▶ YouTube: ${trimmed}`;
          nameText.title = `${trimmed} (${state.externalUrl || ''})`;
        } else if (state.mediaSourceType === 'url') {
          nameText.textContent = `🔗 ${trimmed}`;
          nameText.title = `${trimmed} (${state.externalUrl || ''})`;
        } else if (state.detachedMode) {
          nameText.textContent = `${trimmed} (Detached)`;
          nameText.title = `${trimmed} (Detached Review Mode — media file not attached)`;
        } else {
          nameText.textContent = trimmed;
          if (state.mediaFile) {
            nameText.title = `${trimmed} (${state.mediaFile.name} • ${formatBytes(state.mediaFile.size)})`;
          }
        }
      }
      const audioTitle = document.getElementById('audio-title');
      if (audioTitle && state.isAudio) {
        audioTitle.textContent = trimmed;
      }
      document.title = `${trimmed} — Lined Notes`;
    }

    try {
      const data = (await this.db.get(key)) || {};
      data.fileName = trimmed;
      data.updatedAt = new Date().toISOString();
      if (isActive && state.mediaFile && !data.originalFileName) {
        data.originalFileName = state.mediaFile.name;
      }
      await this.db.set(key, data);
      showToast(`Project renamed to "${trimmed}"`);
    } catch (err) {
      console.error('Failed to persist renamed session:', err);
      showToast('Error saving project name');
    }
  }

  async openSessionByKey(key) {
    if (state.getStorageKey() === key && !state.detachedMode) {
      this.closeSessionsModal();
      showToast('Session already active');
      return;
    }

    if (state.notes.length > 0) {
      await this.saveSession();
    }

    const data = await this.db.get(key);
    if (!data) {
      showToast('Could not load session data');
      return;
    }

    const fileName = data.fileName || 'Untitled Media';
    const originalFileName = data.originalFileName || null;
    const fileSize = data.fileSize || 0;

    // Reset playback & all transport / input / range / timeline states
    this.player.resetPlaybackState();
    state.emit('filereset');

    // Check if active media file matches (by storage key, original filename, or disk name)
    const isCurrentFileMatch = Boolean(
      state.mediaFile && (
        state.getStorageKey() === key ||
        (state.mediaFile.size === fileSize && (
          state.mediaFile.name === fileName ||
          (originalFileName && state.mediaFile.name === originalFileName)
        ))
      )
    );

    if (isCurrentFileMatch) {
      state.detachedMode = false;
      state.detachedSessionKey = null;
      state.detachedSessionName = null;
      state.detachedOriginalFileName = null;
      state.mediaTitle = fileName;
      if (this.detachedStage) this.detachedStage.style.display = 'none';
      const nameText = document.getElementById('file-name-text');
      if (nameText) {
        nameText.textContent = fileName;
        nameText.title = `${fileName} (${state.mediaFile.name} • ${formatBytes(state.mediaFile.size)})`;
      }
      const audioTitle = document.getElementById('audio-title');
      if (audioTitle && state.isAudio) {
        audioTitle.textContent = fileName;
      }
      document.title = `${fileName} — Lined Notes`;

      state.notes = data.notes || [];
      state.currentTime = 0;
      if (this.player.videoEl) {
        try { this.player.videoEl.currentTime = 0; } catch (e) { }
      }
      this.player.updateTimeDisplay();
      state.emit('noteschange');
      state.emit('timelinechanged');
      this.closeSessionsModal();
      showToast(`Restored ${state.notes.length} notes for ${fileName}`);
      return;
    }

    // Auto-reload YouTube streams without entering Detached Review Mode
    if (data.sourceType === 'youtube' && (data.youtubeVideoId || data.url)) {
      this.closeSessionsModal();
      const videoId = data.youtubeVideoId || (data.url && (data.url.match(/v=([a-zA-Z0-9_-]{11})/i) || [])[1]);
      const loaded = await this.player.loadYouTube({
        videoId: videoId,
        url: data.url || `https://www.youtube.com/watch?v=${videoId}`,
        title: fileName
      }, {
        isRestoring: true,
        notes: data.notes || [],
        title: fileName
      });
      if (loaded) return;
    }

    // Auto-reload direct web video URLs without entering Detached Review Mode
    if (data.sourceType === 'url' && data.url) {
      this.closeSessionsModal();
      const loaded = await this.player.loadDirectUrl({
        url: data.url,
        title: fileName,
        isAudio: !!data.isAudio
      }, {
        isRestoring: true,
        notes: data.notes || [],
        title: fileName
      });
      if (loaded) return;
    }

    // Enter Detached Review Mode fallback (for local files or offline remote media)
    state.detachedMode = true;
    state.detachedSessionKey = key;
    state.detachedSessionName = fileName;
    state.detachedOriginalFileName = originalFileName;
    state.detachedSessionSize = fileSize;
    state.mediaTitle = fileName;
    state.mediaFile = null;

    if (state.mediaUrl) {
      URL.revokeObjectURL(state.mediaUrl);
      state.mediaUrl = null;
    }

    if (this.player.videoEl) {
      this.player.videoEl.pause();
      this.player.videoEl.removeAttribute('src');
      this.player.videoEl.load();
      this.player.videoEl.classList.remove('active');
    }
    if (this.player.audioStage) {
      this.player.audioStage.classList.remove('active');
    }

    state.isPlaying = false;
    this.player.updatePlayStateUI();

    if (this.detachedStage) {
      this.detachedStage.style.display = 'flex';
    }
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) dropZone.classList.add('hidden');

    const detachedFileNameEl = document.getElementById('detached-file-name');
    if (detachedFileNameEl) detachedFileNameEl.textContent = fileName;

    const badge = document.getElementById('file-badge');
    const nameText = document.getElementById('file-name-text');
    if (badge) badge.classList.add('active');
    if (nameText) {
      nameText.textContent = `${fileName} (Detached)`;
      nameText.title = `${fileName} (Detached Review Mode — media file not attached)`;
    }
    document.title = `${fileName} (Detached) — Lined Notes`;

    state.notes = data.notes || [];
    state.duration = data.duration || (state.notes.length > 0 ? Math.max(...state.notes.map(n => n.end || n.start || 0)) + 5 : 60);
    state.currentTime = 0;
    state.isAudio = !!data.isAudio;
    state.activeNoteId = null;
    state.editingNoteId = null;
    if (this.player && typeof this.player.generateSyntheticWaveform === 'function') {
      this.player.generateSyntheticWaveform({ name: fileName, size: data.fileSize || 0 }, state.duration);
    } else {
      state.waveformPeaks = null;
      state.isSyntheticWaveform = true;
    }

    this.player.updateTimeDisplay();
    state.emit('noteschange');
    state.emit('timelinechanged');

    this.closeSessionsModal();
    showToast(`Loaded ${fileName} (${state.notes.length} notes in review mode)`);
  }

  async exportSessionByKey(key) {
    await this.openSessionByKey(key);
    state.emit('requestexport');
  }

  async deleteSessionByKey(key, event) {
    if (event) event.stopPropagation();
    if (!confirm('Are you sure you want to delete this saved project? This will permanently remove all stored annotations for this file.')) {
      return;
    }

    await this.db.delete(key);

    if (state.getStorageKey() === key || state.detachedSessionKey === key) {
      this.player.resetPlaybackState();
      state.notes = [];
      state.detachedMode = false;
      state.detachedSessionKey = null;
      state.detachedSessionName = null;
      state.detachedOriginalFileName = null;
      state.detachedSessionSize = 0;
      state.mediaSourceType = null;
      state.externalUrl = null;
      state.youtubeVideoId = null;
      state.mediaTitle = null;
      if (this.detachedStage) this.detachedStage.style.display = 'none';

      if (!state.mediaFile) {
        const badge = document.getElementById('file-badge');
        const nameText = document.getElementById('file-name-text');
        if (badge) badge.classList.remove('active');
        if (nameText) nameText.textContent = 'No media loaded';
        const dropZone = document.getElementById('drop-zone');
        if (dropZone) dropZone.classList.remove('hidden');
      }

      state.emit('filereset');
      state.emit('noteschange');
      state.emit('timelinechanged');
    }

    await this.updateProjectsCountBadge();
    const query = this.searchInput ? this.searchInput.value : '';
    await this.renderSessionsList(query);
    showToast('Saved project deleted');
  }

  filterSessionsList(val) {
    this.renderSessionsList(val);
  }

  refreshSessionsModal() {
    const query = this.searchInput ? this.searchInput.value : '';
    this.renderSessionsList(query);
  }
}
