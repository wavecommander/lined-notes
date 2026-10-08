/* ==========================================================================
   Media Player Controller & Waveform Audio Decoding
   ========================================================================== */

import { state } from './state.js';
import { APP_CONFIG } from './config.js';
import { formatTime, formatBytes, showToast, parseMediaUrl } from './utils.js';
import { extractAudioFromWebM, calculateWaveformPeaks } from './waveform-utils.js';

export class PlayerController {
  constructor() {
    this.videoEl = document.getElementById('video-el');
    this.audioStage = document.getElementById('audio-stage');
    this.discVisualizer = document.getElementById('disc-visualizer');
    this.playBtn = document.getElementById('play-btn');
    this.playIcon = document.getElementById('play-icon');
    this.dropZone = document.getElementById('drop-zone');
    this.audioBars = document.getElementById('audio-bars');
    this.timeDisplay = document.getElementById('time-display');
    this.speedSelect = document.getElementById('speed-select');
    this.mobileSpeedBtn = document.getElementById('mobile-speed-btn');
    this.volumeRange = document.getElementById('volume-range');
    this.muteBtn = document.getElementById('mute-btn');
    this.volumeIcon = document.getElementById('volume-icon');
    this.playerArea = document.getElementById('player-area');
    this.fullscreenExitBtn = document.getElementById('fullscreen-exit-btn');
    this.fsHideTimer = null;
    this.isFsButtonHovered = false;

    // YouTube IFrame Player integration
    this.youtubeStage = document.getElementById('youtube-stage');
    this.ytPlayer = null;
    this.ytPlayerState = -1;
    this.ytApiPromise = null;
    this.ytTimeTickerId = null;

    // Live Web Audio & Frequency Visualizer state
    this.audioBarsCount = 32;
    this.audioBarElements = [];
    this.audioBarHeights = new Float32Array(this.audioBarsCount).fill(4);
    this.audioCtx = null;
    this.analyserNode = null;
    this.audioSourceNode = null;
    this.freqData = null;
    this.audioBarsRafId = null;

    // Dedicated Web Worker for off-thread waveform calculation & audio demuxing
    this.waveformWorker = null;
    this.waveformTaskId = 0;
    this.initWaveformWorker();

    this.initEvents();
    this.setupAudioBars();
    this.setupFullscreenListeners();
  }

  initEvents() {
    const v = this.videoEl;

    v.addEventListener('loadedmetadata', () => {
      state.duration = v.duration || 0;
      state.currentTime = v.currentTime || 0;
      this.updateTimeDisplay();
      state.emit('medialoaded');
    });

    v.addEventListener('timeupdate', () => {
      if (!state.isScrubbing) {
        state.currentTime = v.currentTime;
        state.duration = v.duration || 0;
        this.updateTimeDisplay();
        state.emit('timeupdate', state.currentTime);

        // While paused or seeking audio, reflect waveform at current playhead position
        if (!state.isPlaying && state.isAudio && state.waveformPeaks) {
          this.updateAudioBarsFromWaveform();
        }

        // A-B Range Looping
        if (state.isLooping && state.APoint !== null && state.BPoint !== null) {
          if (state.currentTime >= state.BPoint || state.currentTime < state.APoint) {
            this.seekTo(state.APoint);
          }
        }
      }
    });

    v.addEventListener('play', () => {
      state.isPlaying = true;
      this.updatePlayStateUI();
      if (state.isAudio) {
        this.initAudioContext();
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => { });
        }
        this.startAudioBarsAnimation();
      }
      state.emit('playstatechange', true);
    });

    v.addEventListener('pause', () => {
      state.isPlaying = false;
      this.updatePlayStateUI();
      this.startAudioBarsAnimation(); // Smooth decay to baseline
      state.emit('playstatechange', false);
    });

    v.addEventListener('ended', () => {
      state.isPlaying = false;
      this.updatePlayStateUI();
      this.startAudioBarsAnimation(); // Smooth decay to baseline
      state.emit('playstatechange', false);
    });

    v.addEventListener('emptied', () => {
      state.isPlaying = false;
      this.updatePlayStateUI();
      this.resetAudioBars();
      state.emit('playstatechange', false);
    });

    v.addEventListener('error', () => {
      const err = v.error;
      console.warn('[Player] Media playback error:', err);
      let message = 'Could not play media file.';
      if (err) {
        if (err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          const isMkv = state.mediaFile && /\.mkv$/i.test(state.mediaFile.name);
          const isFirefox = /Firefox/i.test(navigator.userAgent);
          if (isMkv && isFirefox) {
            message = 'Firefox cannot play this MKV (unsupported codec like AC3, DTS, or HEVC). Convert container with: ffmpeg -i input.mkv -c copy output.mp4';
          } else {
            message = 'Media format or codec is not supported by this browser.';
          }
        } else if (err.code === MediaError.MEDIA_ERR_DECODE) {
          message = 'Media playback aborted due to a decoding error.';
        } else if (err.code === MediaError.MEDIA_ERR_NETWORK) {
          message = 'A network error caused the media download to fail.';
        }
      }
      showToast(message, false, null, 7000);
      state.isPlaying = false;
      this.updatePlayStateUI();
      state.emit('playstatechange', false);
    });
  }

  resetPlaybackState() {
    if (this.ytTimeTickerId) {
      cancelAnimationFrame(this.ytTimeTickerId);
      this.ytTimeTickerId = null;
    }

    if (this.ytPlayer) {
      try {
        if (typeof this.ytPlayer.pauseVideo === 'function') {
          this.ytPlayer.pauseVideo();
        }
      } catch (e) { }
    }

    if (this.videoEl) {
      try {
        this.videoEl.pause();
      } catch (e) { }
      try {
        this.videoEl.currentTime = 0;
      } catch (e) { }
    }

    if (document.pictureInPictureElement) {
      try {
        document.exitPictureInPicture().catch(() => { });
      } catch (e) { }
    }

    state.isPlaying = false;
    state.currentTime = 0;
    state.isScrubbing = false;
    state.isPanning = false;

    this.updatePlayStateUI();
    this.resetAudioBars();
    this.updateTimeDisplay();

    state.emit('playstatechange', false);
  }

  resetAudioBars() {
    if (this.audioBarsRafId) {
      cancelAnimationFrame(this.audioBarsRafId);
      this.audioBarsRafId = null;
    }
    this.audioBarHeights.fill(4);
    if (this.audioBarElements && this.audioBarElements.length > 0) {
      for (let i = 0; i < this.audioBarsCount; i++) {
        if (this.audioBarElements[i]) {
          this.audioBarElements[i].style.height = '4px';
        }
      }
    }
  }

  async loadFile(file) {
    if (!file) return;

    // Check if attaching to an existing detached review session. The size must match too: a different
    // video with the same name (video.mp4, IMG_0001.MOV…) would otherwise get this project's notes
    const isDetachedMatch = Boolean(
      state.detachedMode && (
        (state.detachedSessionKey && state.detachedSessionKey === `ln_session_${file.name}_${file.size}`) ||
        (file.size === state.detachedSessionSize && (
          file.name === state.detachedSessionName ||
          (state.detachedOriginalFileName && file.name === state.detachedOriginalFileName)
        ))
      )
    );

    if (isDetachedMatch) {
      this.resetPlaybackState();
      state.mediaFile = file;
      state.mediaSourceType = 'file';
      state.externalUrl = null;
      state.youtubeVideoId = null;
      const preservedTitle = state.detachedSessionName || state.mediaTitle || file.name;
      state.mediaTitle = preservedTitle;
      state.detachedMode = false;
      state.detachedSessionKey = null;
      state.detachedSessionName = null;
      state.detachedOriginalFileName = null;
      state.detachedSessionSize = 0;
      const detachedStage = document.getElementById('detached-stage');
      if (detachedStage) detachedStage.style.display = 'none';
      if (this.youtubeStage) this.youtubeStage.classList.remove('active');
      state.isAudio = file.type.startsWith('audio/');
      state.waveformPeaks = null;
      state.isWaveformPending = true;

      if (state.mediaUrl && state.mediaUrl.startsWith('blob:')) URL.revokeObjectURL(state.mediaUrl);
      state.mediaUrl = URL.createObjectURL(file);

      this.updateMediaUI(file);
      showToast(`Attached ${file.name} to session "${preservedTitle}"`);
      this.generateWaveformPeaks(file);

      state.emit('filereset');
      return;
    }

    // Notes imported while no media was open have no session yet: carry them over to this file
    const orphanNotes = this.takeOrphanNotes();

    // Auto-save previous active session before switching
    if (state.notes.length > 0) {
      state.emit('requestsave');
    }

    // Immediately stop and reset playback before changing source
    this.resetPlaybackState();

    state.detachedMode = false;
    state.detachedSessionKey = null;
    state.detachedSessionName = null;
    state.detachedOriginalFileName = null;
    state.detachedSessionSize = 0;
    const detachedStage = document.getElementById('detached-stage');
    if (detachedStage) detachedStage.style.display = 'none';
    if (this.youtubeStage) this.youtubeStage.classList.remove('active');

    state.mediaSourceType = 'file';
    state.externalUrl = null;
    state.youtubeVideoId = null;
    state.mediaTitle = file.name;
    state.mediaFile = file;
    state.isAudio = file.type.startsWith('audio/');
    state.notes = orphanNotes;
    state.activeNoteId = null;
    state.editingNoteId = null;
    state.APoint = null;
    state.BPoint = null;
    state.isLooping = false;
    state.isTimeStamped = false;
    state.waveformPeaks = null;
    state.isWaveformPending = true;
    state.duration = 0;
    state.currentTime = 0;
    state.zoom = 1;
    state.scrollOffset = 0;

    if (state.mediaUrl && state.mediaUrl.startsWith('blob:')) URL.revokeObjectURL(state.mediaUrl);
    state.mediaUrl = URL.createObjectURL(file);

    this.updateMediaUI(file);
    showToast(`Loaded ${file.name}`);
    this.generateWaveformPeaks(file);

    state.emit('filereset');
  }

  /**
   * Returns notes that exist without a backing session (e.g. imported before any media
   * was opened) so a newly opened source can adopt them instead of discarding them.
   */
  takeOrphanNotes() {
    return state.getStorageKey() ? [] : state.notes.slice();
  }

  updateMediaUI(file) {
    const badge = document.getElementById('file-badge');
    const nameText = document.getElementById('file-name-text');
    if (badge) badge.classList.add('active');
    const displayTitle = state.mediaTitle || (file ? file.name : 'Media');
    if (nameText) {
      nameText.textContent = displayTitle;
      if (file) {
        nameText.title = `${displayTitle} (${file.name} • ${formatBytes(file.size)})`;
      }
    }
    if (displayTitle) {
      document.title = `${displayTitle} — Lined Notes`;
    }

    this.videoEl.src = state.mediaUrl;
    this.videoEl.volume = state.volume;
    this.videoEl.muted = state.isMuted;
    this.videoEl.playbackRate = state.playbackRate;
    this.updateVolumeIcon();
    if (this.speedSelect) this.speedSelect.value = state.playbackRate.toString();
    if (this.mobileSpeedBtn) this.mobileSpeedBtn.textContent = `${state.playbackRate}×`;

    const pipBtn = document.getElementById('pip-btn');

    if (state.isAudio) {
      this.videoEl.classList.remove('active');
      this.audioStage.classList.add('active');
      const audioTitle = document.getElementById('audio-title');
      if (audioTitle) audioTitle.textContent = displayTitle;
      if (pipBtn) pipBtn.style.display = 'none';
    } else {
      this.audioStage.classList.remove('active');
      this.videoEl.classList.add('active');
      if (pipBtn) pipBtn.style.display = 'inline-flex';
    }

    if (this.dropZone) this.dropZone.classList.add('hidden');
  }

  /**
   * No real audio data is available (oversized file, decode failure, no audio track):
   * the timeline falls back to a plain flat track.
   */
  markWaveformUnavailable() {
    state.waveformPeaks = null;
    state.isWaveformPending = false;
    state.emit('timelinechanged');
  }

  initWaveformWorker() {
    try {
      this.waveformWorker = new Worker('js/waveform-worker.js', { type: 'module' });
      this.waveformWorker.onerror = (err) => {
        console.warn('[WaveformWorker] Worker runtime error, falling back to in-thread calculation:', err);
      };
    } catch (err) {
      console.warn('[WaveformWorker] Worker initialization error, will use optimized in-thread fallback:', err);
      this.waveformWorker = null;
    }
  }

  /**
   * Offloads waveform peak extraction to the Web Worker.
   * Transfers the raw audio channel buffer for zero-copy high performance.
   */
  calculatePeaksWithWorker(channelData, samples, taskId) {
    return new Promise((resolve) => {
      if (!this.waveformWorker) {
        return resolve(calculateWaveformPeaks(channelData, samples));
      }

      const cleanup = () => {
        this.waveformWorker.removeEventListener('message', onMessage);
        this.waveformWorker.removeEventListener('error', onError);
      };
      // Once transferred, channelData is detached (length 0) and can't be used for a fallback
      const fallback = () => (channelData.length ? calculateWaveformPeaks(channelData, samples) : null);

      const onMessage = (e) => {
        if (!e.data || e.data.taskId !== taskId) return;
        if (e.data.type === 'PEAKS_COMPLETED') {
          cleanup();
          resolve(new Float32Array(e.data.peaksBuffer));
        } else if (e.data.type === 'ERROR') {
          console.warn('[WaveformWorker] Peak calculation failed:', e.data.error);
          cleanup();
          resolve(fallback());
        }
      };

      const onError = (err) => {
        console.warn('[WaveformWorker] Peak calculation error, falling back:', err);
        cleanup();
        resolve(fallback());
      };

      this.waveformWorker.addEventListener('message', onMessage);
      this.waveformWorker.addEventListener('error', onError);

      // Attempt zero-copy transfer of the channel buffer
      try {
        this.waveformWorker.postMessage({
          type: 'CALCULATE_PEAKS',
          buffer: channelData.buffer,
          samples,
          taskId
        }, [channelData.buffer]);
      } catch (transferErr) {
        try {
          this.waveformWorker.postMessage({
            type: 'CALCULATE_PEAKS',
            buffer: channelData.buffer,
            samples,
            taskId
          });
        } catch (postErr) {
          resolve(calculateWaveformPeaks(channelData, samples));
        }
      }
    });
  }

  /**
   * Offloads WebM/MKV EBML audio demuxing to the Web Worker.
   */
  demuxWebMWithWorker(arrayBuffer, taskId) {
    return new Promise((resolve) => {
      if (!this.waveformWorker) {
        return resolve(extractAudioFromWebM(arrayBuffer));
      }

      const onMessage = (e) => {
        if (e.data && e.data.taskId === taskId) {
          if (e.data.type === 'DEMUX_COMPLETED') {
            this.waveformWorker.removeEventListener('message', onMessage);
            this.waveformWorker.removeEventListener('error', onError);
            if (e.data.noAudioTrack) {
              resolve({ noAudioTrack: true });
            } else {
              resolve(e.data.audioBuffer);
            }
          } else if (e.data.type === 'DEMUX_FAILED' || e.data.type === 'ERROR') {
            this.waveformWorker.removeEventListener('message', onMessage);
            this.waveformWorker.removeEventListener('error', onError);
            resolve(null);
          }
        }
      };

      const onError = (err) => {
        console.warn('[WaveformWorker] Demux worker error, falling back to main-thread:', err);
        this.waveformWorker.removeEventListener('message', onMessage);
        this.waveformWorker.removeEventListener('error', onError);
        resolve(extractAudioFromWebM(arrayBuffer));
      };

      this.waveformWorker.addEventListener('message', onMessage);
      this.waveformWorker.addEventListener('error', onError);

      try {
        this.waveformWorker.postMessage({
          type: 'DEMUX_WEBM',
          arrayBuffer,
          taskId
        }, [arrayBuffer]);
      } catch (transferErr) {
        try {
          this.waveformWorker.postMessage({
            type: 'DEMUX_WEBM',
            arrayBuffer,
            taskId
          });
        } catch (postErr) {
          resolve(extractAudioFromWebM(arrayBuffer));
        }
      }
    });
  }

  async generateWaveformPeaks(file) {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const maxDecodeSize = isMobile ? APP_CONFIG.maxDecodeSizeMobile : APP_CONFIG.maxDecodeSizeDesktop;

    const taskId = ++this.waveformTaskId;

    if (file.size > maxDecodeSize) {
      this.markWaveformUnavailable();
      return;
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      if (taskId !== this.waveformTaskId) return;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error('Web Audio not supported');
      const audioCtx = new AudioCtx();

      let audioBuffer = null;

      // Check for WebM or Matroska container by extension, MIME type, or EBML magic header
      const isNamedWebM = /\.(webm|mkv)$/i.test(file.name) ||
        file.type === 'video/webm' ||
        file.type === 'video/x-matroska';
      const isEbmlHeader = arrayBuffer.byteLength >= 4 &&
        new Uint8Array(arrayBuffer, 0, 4).every((b, i) => b === [0x1A, 0x45, 0xDF, 0xA3][i]);
      const isWebMOrMkv = isNamedWebM || isEbmlHeader;

      // Fast Path 1: For non-WebM containers (MP4, MP3, WAV, AAC, FLAC, OGG), try direct decode
      if (!isWebMOrMkv) {
        try {
          // Non-WebM buffers aren't reused afterwards, so decode without an extra copy
          audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        } catch (directErr) {
          console.log('[Waveform] Direct decode skipped/failed, evaluating demuxer fallback');
        }
      }

      if (taskId !== this.waveformTaskId) {
        audioCtx.close();
        return;
      }

      // Demux Path 2: For WebM/MKV containers, isolate pure audio stream via Web Worker
      if (!audioBuffer && isWebMOrMkv) {
        let demuxResult = null;
        try {
          demuxResult = await this.demuxWebMWithWorker(arrayBuffer.slice(0), taskId);
        } catch (workerDemuxErr) {
          demuxResult = extractAudioFromWebM(arrayBuffer);
        }

        if (taskId !== this.waveformTaskId) {
          audioCtx.close();
          return;
        }

        if (demuxResult && demuxResult.noAudioTrack) {
          // File is a video with no audio track (e.g. screen recording or muted clip)
          this.markWaveformUnavailable();
          audioCtx.close();
          return;
        } else if (demuxResult instanceof ArrayBuffer) {
          try {
            audioBuffer = await audioCtx.decodeAudioData(demuxResult);
          } catch (demuxDecodeErr) {
            console.warn('[Waveform] Demuxed WebM/MKV audio decode error:', demuxDecodeErr);
          }
        }
      }

      // Fallback Path 3: Try direct decode if not already attempted (last use of the buffer)
      if (!audioBuffer && isWebMOrMkv) {
        try {
          audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        } catch (finalErr) {
          // Fall through to the flat track
        }
      }

      if (taskId !== this.waveformTaskId) {
        audioCtx.close();
        return;
      }

      if (audioBuffer) {
        const rawData = audioBuffer.getChannelData(0);
        const samples = APP_CONFIG.waveformSampleCount || 1600;

        // Offload waveform peak extraction to Web Worker (0ms main-thread cost)
        const peaks = await this.calculatePeaksWithWorker(rawData, samples, taskId);

        if (taskId !== this.waveformTaskId) {
          audioCtx.close();
          return;
        }

        if (!peaks) {
          this.markWaveformUnavailable();
          audioCtx.close();
          return;
        }

        state.waveformPeaks = peaks;
        state.isWaveformPending = false;
        audioCtx.close();
        state.emit('timelinechanged');
      } else {
        this.markWaveformUnavailable();
        audioCtx.close();
      }
    } catch (err) {
      console.warn('Waveform decode fallback:', err);
      this.markWaveformUnavailable();
    }
  }

  // ─── EXTERNAL URL & YOUTUBE PLAYER METHODS ──────────────────────

  ensureYouTubeStage() {
    if (!this.youtubeStage) {
      this.youtubeStage = document.getElementById('youtube-stage');
    }
    if (!this.youtubeStage && this.playerArea) {
      const stage = document.createElement('div');
      stage.id = 'youtube-stage';
      stage.innerHTML = '<div id="youtube-player"></div>';
      this.playerArea.appendChild(stage);
      this.youtubeStage = stage;
    }
  }

  loadYouTubeApi() {
    if (window.YT && window.YT.Player) {
      return Promise.resolve(window.YT);
    }
    if (this.ytApiPromise) {
      return this.ytApiPromise;
    }
    this.ytApiPromise = new Promise((resolve, reject) => {
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevCallback === 'function') prevCallback();
        resolve(window.YT);
      };
      if (!document.getElementById('yt-iframe-api')) {
        const script = document.createElement('script');
        script.id = 'yt-iframe-api';
        script.src = 'https://www.youtube.com/iframe_api';
        script.onerror = (e) => reject(new Error('Failed to load YouTube API script'));
        document.head.appendChild(script);
      }
    });
    return this.ytApiPromise;
  }

  async loadExternalUrl(inputUrl, options = {}) {
    if (!inputUrl) return false;
    const parsed = parseMediaUrl(inputUrl);
    if (!parsed) {
      showToast('Invalid URL. Enter a YouTube link or direct video URL');
      return false;
    }

    if (parsed.type === 'youtube') {
      return await this.loadYouTube(parsed, options);
    } else {
      return await this.loadDirectUrl(parsed, options);
    }
  }

  async loadYouTube(parsed, options = {}) {
    const orphanNotes = options.isRestoring ? [] : this.takeOrphanNotes();
    if (!options.isRestoring && state.notes.length > 0) {
      state.emit('requestsave');
    }

    this.resetPlaybackState();

    state.detachedMode = false;
    state.detachedSessionKey = null;
    state.detachedSessionName = null;
    state.detachedSessionSize = 0;
    const detachedStage = document.getElementById('detached-stage');
    if (detachedStage) detachedStage.style.display = 'none';

    state.mediaSourceType = 'youtube';
    state.externalUrl = parsed.url;
    state.youtubeVideoId = parsed.videoId;
    state.mediaTitle = options.title || parsed.title;
    state.mediaFile = null;
    state.isAudio = false;

    // Eagerly resolve YouTube title via public oEmbed API if title is placeholder
    const hasCustomOptionTitle = Boolean(options.title && !options.title.startsWith('YouTube:'));
    if (!hasCustomOptionTitle && (!state.mediaTitle || state.mediaTitle.startsWith('YouTube:'))) {
      fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${parsed.videoId}&format=json`)
        .then(res => res.json())
        .then(data => {
          if (data && data.title && state.mediaSourceType === 'youtube' && state.youtubeVideoId === parsed.videoId) {
            if (!state.mediaTitle || state.mediaTitle.startsWith('YouTube:')) {
              state.mediaTitle = data.title;
              this.updateMediaBadgeForUrl({
                type: 'youtube',
                title: data.title,
                url: parsed.url
              });
            }
          }
        })
        .catch(() => {});
    }

    if (state.mediaUrl && state.mediaUrl.startsWith('blob:')) {
      URL.revokeObjectURL(state.mediaUrl);
    }
    state.mediaUrl = parsed.url;

    if (!options.isRestoring) {
      state.notes = orphanNotes;
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
    } else {
      state.notes = options.notes || [];
      state.activeNoteId = null;
      state.editingNoteId = null;
      state.currentTime = 0;
    }

    if (this.dropZone) this.dropZone.classList.add('hidden');
    if (this.audioStage) this.audioStage.classList.remove('active');
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
      this.videoEl.classList.remove('active');
    }

    const pipBtn = document.getElementById('pip-btn');
    if (pipBtn) pipBtn.style.display = 'none';

    this.ensureYouTubeStage();
    if (this.youtubeStage) this.youtubeStage.classList.add('active');

    this.updateMediaBadgeForUrl({
      type: 'youtube',
      title: state.mediaTitle,
      url: parsed.url
    });

    try {
      await this.loadYouTubeApi();
      await this.initOrUpdateYouTubePlayer(parsed, options);
      state.emit('filereset');
      return true;
    } catch (err) {
      console.error('Failed to initialize YouTube player:', err);
      showToast('Could not load YouTube player. Check connection.');
      return false;
    }
  }

  initOrUpdateYouTubePlayer(parsed, options) {
    return new Promise((resolve) => {
      let resolved = false;
      const safeResolve = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      const onReady = () => {
        const dur = (this.ytPlayer && typeof this.ytPlayer.getDuration === 'function') ? this.ytPlayer.getDuration() : 0;
        state.duration = dur || 0;
        state.currentTime = 0;

        try {
          const data = typeof this.ytPlayer.getVideoData === 'function' ? this.ytPlayer.getVideoData() : null;
          if (data && data.title) {
            const hasCustomTitle = Boolean(options.title && !options.title.startsWith('YouTube:'));
            const currentTitleIsCustom = Boolean(state.mediaTitle && !state.mediaTitle.startsWith('YouTube:'));
            if (!hasCustomTitle && !currentTitleIsCustom) {
              state.mediaTitle = data.title;
              this.updateMediaBadgeForUrl({
                type: 'youtube',
                title: data.title,
                url: parsed.url
              });
            }
          }
        } catch (e) { }

        try {
          if (this.ytPlayer.setVolume) this.ytPlayer.setVolume(Math.round(state.volume * 100));
          if (state.isMuted && this.ytPlayer.mute) this.ytPlayer.mute();
          if (this.ytPlayer.setPlaybackRate) this.ytPlayer.setPlaybackRate(state.playbackRate);
        } catch (e) { }

        if (parsed.startTime) {
          this.seekTo(parsed.startTime);
        } else {
          this.updateTimeDisplay();
        }

        state.emit('medialoaded');
        if (options.isRestoring) {
          state.emit('noteschange');
          state.emit('timelinechanged');
          showToast(`Restored ${state.notes.length} notes for ${state.mediaTitle || 'YouTube'}`);
        } else {
          showToast(`Loaded ${state.mediaTitle || 'YouTube video'}`);
        }

        safeResolve();
      };

      if (this.ytPlayer && typeof this.ytPlayer.loadVideoById === 'function') {
        this.ytPlayer.loadVideoById({
          videoId: parsed.videoId,
          startSeconds: parsed.startTime || 0
        });
        setTimeout(onReady, 500);
        return;
      }

      this.ensureYouTubeStage();
      const container = document.getElementById('youtube-player');
      if (!container && this.youtubeStage) {
        this.youtubeStage.innerHTML = '<div id="youtube-player"></div>';
      }

      const isLocalOrigin = !window.location.origin ||
        window.location.origin === 'null' ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';

      const playerVars = {
        autoplay: 0,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        enablejsapi: 1
      };
      if (!isLocalOrigin) {
        playerVars.origin = window.location.origin;
      }

      this.ytPlayer = new window.YT.Player('youtube-player', {
        videoId: parsed.videoId,
        playerVars,
        events: {
          onReady: () => onReady(),
          onStateChange: (e) => this.onYouTubeStateChange(e),
          onError: (e) => this.onYouTubeError(e)
        }
      });

      setTimeout(safeResolve, 4000);
    });
  }

  onYouTubeStateChange(e) {
    this.ytPlayerState = e.data;
    if (e.data === 1) { // Playing
      state.isPlaying = true;
      this.updatePlayStateUI();
      this.startYtTimeTicker();
      state.emit('playstatechange', true);
    } else if (e.data === 2 || e.data === 0) { // Paused or Ended
      state.isPlaying = false;
      this.updatePlayStateUI();
      this.stopYtTimeTicker();
      state.emit('playstatechange', false);
    }
  }

  startYtTimeTicker() {
    this.stopYtTimeTicker();
    const tick = () => {
      if (!state.isPlaying || state.mediaSourceType !== 'youtube' || !this.ytPlayer) return;
      try {
        const curTime = this.ytPlayer.getCurrentTime();
        if (typeof curTime === 'number' && !isNaN(curTime) && !state.isScrubbing) {
          state.currentTime = curTime;
          const dur = this.ytPlayer.getDuration();
          if (dur && dur > 0 && Math.abs(dur - state.duration) > 1) {
            state.duration = dur;
          }
          this.updateTimeDisplay();
          state.emit('timeupdate', state.currentTime);

          if (state.isLooping && state.APoint !== null && state.BPoint !== null) {
            if (state.currentTime >= state.BPoint || state.currentTime < state.APoint) {
              this.seekTo(state.APoint);
            }
          }
        }
      } catch (err) { }
      this.ytTimeTickerId = requestAnimationFrame(tick);
    };
    this.ytTimeTickerId = requestAnimationFrame(tick);
  }

  stopYtTimeTicker() {
    if (this.ytTimeTickerId) {
      cancelAnimationFrame(this.ytTimeTickerId);
      this.ytTimeTickerId = null;
    }
  }

  onYouTubeError(e) {
    console.warn('YouTube error code:', e.data);
    let msg = 'Could not load YouTube video.';
    if (e.data === 101 || e.data === 150) {
      msg = 'This video does not allow embedded playback by request of its owner.';
    } else if (e.data === 100) {
      msg = 'YouTube video not found or removed.';
    } else if (e.data === 2) {
      msg = 'Invalid YouTube video ID parameter.';
    }
    showToast(msg);
  }

  async loadDirectUrl(parsed, options = {}) {
    const orphanNotes = options.isRestoring ? [] : this.takeOrphanNotes();
    if (!options.isRestoring && state.notes.length > 0) {
      state.emit('requestsave');
    }

    this.resetPlaybackState();

    state.detachedMode = false;
    state.detachedSessionKey = null;
    state.detachedSessionName = null;
    state.detachedSessionSize = 0;
    const detachedStage = document.getElementById('detached-stage');
    if (detachedStage) detachedStage.style.display = 'none';

    state.mediaSourceType = 'url';
    state.externalUrl = parsed.url;
    state.youtubeVideoId = null;
    state.mediaTitle = options.title || parsed.title;
    state.mediaFile = null;
    state.isAudio = !!parsed.isAudio;

    if (state.mediaUrl && state.mediaUrl.startsWith('blob:')) {
      URL.revokeObjectURL(state.mediaUrl);
    }
    state.mediaUrl = parsed.url;

    if (!options.isRestoring) {
      state.notes = orphanNotes;
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
    } else {
      state.notes = options.notes || [];
      state.activeNoteId = null;
      state.editingNoteId = null;
      state.currentTime = 0;
    }

    if (this.youtubeStage) this.youtubeStage.classList.remove('active');
    if (this.dropZone) this.dropZone.classList.add('hidden');

    this.updateMediaBadgeForUrl({
      type: 'url',
      title: state.mediaTitle,
      url: parsed.url
    });

    // Remote media is usually cross-origin; routed through Web Audio without CORS it would be silent
    this.releaseAudioGraph();
    this.videoEl.src = parsed.url;
    this.videoEl.volume = state.volume;
    this.videoEl.muted = state.isMuted;
    this.videoEl.playbackRate = state.playbackRate;
    this.updateVolumeIcon();

    const pipBtn = document.getElementById('pip-btn');

    if (state.isAudio) {
      this.videoEl.classList.remove('active');
      this.audioStage.classList.add('active');
      const audioTitle = document.getElementById('audio-title');
      if (audioTitle) audioTitle.textContent = state.mediaTitle;
      if (pipBtn) pipBtn.style.display = 'none';
    } else {
      this.audioStage.classList.remove('active');
      this.videoEl.classList.add('active');
      if (pipBtn) pipBtn.style.display = 'inline-flex';
    }

    state.emit('filereset');
    showToast(options.isRestoring ? `Restored ${state.notes.length} notes for ${state.mediaTitle}` : `Loaded ${state.mediaTitle}`);
    return true;
  }

  updateMediaBadgeForUrl(info) {
    const badge = document.getElementById('file-badge');
    const nameText = document.getElementById('file-name-text');
    if (badge) badge.classList.add('active');
    if (nameText) {
      const prefix = info.type === 'youtube' ? '▶ YouTube: ' : '🔗 ';
      nameText.textContent = `${prefix}${info.title}`;
      nameText.title = `${info.title} (${info.url})`;
    }
    if (info.title) {
      document.title = `${info.title} — Lined Notes`;
    }
  }

  // ─── TRANSPORT CONTROLS ───────────────────────────────────────────

  togglePlay() {
    if (state.detachedMode) {
      showToast('Attach media file to play video/audio');
      return;
    }
    const hasMedia = Boolean(state.mediaFile || state.mediaSourceType === 'youtube' || state.mediaSourceType === 'url');
    if (!hasMedia) return;

    if (state.mediaSourceType === 'youtube') {
      if (!this.ytPlayer) return;
      if (state.isPlaying) {
        if (typeof this.ytPlayer.pauseVideo === 'function') this.ytPlayer.pauseVideo();
      } else {
        if (typeof this.ytPlayer.playVideo === 'function') this.ytPlayer.playVideo();
      }
      return;
    }

    if (this.videoEl.paused) {
      this.videoEl.play();
    } else {
      this.videoEl.pause();
    }
  }

  /** Pauses whichever source is active (local/URL media element or YouTube). */
  pause() {
    if (state.mediaSourceType === 'youtube') {
      if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') this.ytPlayer.pauseVideo();
    } else if (this.videoEl && !this.videoEl.paused) {
      this.videoEl.pause();
    }
  }

  /** Resumes whichever source is active; no-op in detached review mode. */
  play() {
    if (state.detachedMode || !state.hasMedia()) return;
    if (state.mediaSourceType === 'youtube') {
      if (this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') this.ytPlayer.playVideo();
    } else if (this.videoEl && this.videoEl.paused) {
      this.videoEl.play().catch(() => { });
    }
  }

  toggleLoop() {
    if (state.APoint === null || state.BPoint === null) {
      showToast('Set both In and Out points to loop');
      return;
    }
    state.isLooping = !state.isLooping;
    const loopBtn = document.getElementById('loop-range-btn');
    if (loopBtn) loopBtn.classList.toggle('active', state.isLooping);
    showToast(state.isLooping ? 'A-B Range Loop enabled' : 'A-B Range Loop disabled');
  }

  updatePlayStateUI() {
    if (state.isPlaying) {
      this.playBtn.title = 'Pause (Space)';
      this.playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
      if (this.discVisualizer) this.discVisualizer.classList.add('playing');
    } else {
      this.playBtn.title = 'Play (Space)';
      this.playIcon.innerHTML = '<polygon points="7 4 19 12 7 20 7 4"/>';
      if (this.discVisualizer) this.discVisualizer.classList.remove('playing');
    }
  }

  seekTo(time) {
    const hasMedia = state.hasMedia();
    if (!hasMedia) return;
    const target = Math.max(0, Math.min(state.duration, time));
    state.currentTime = target;

    if (state.mediaSourceType === 'youtube' && this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
      this.ytPlayer.seekTo(target, true);
    } else if (this.videoEl && !state.detachedMode && this.videoEl.src) {
      this.videoEl.currentTime = target;
    }

    this.updateTimeDisplay();
    state.emit('timeupdate', target);
    state.emit('timelinechanged');
  }

  skip(secs) {
    this.seekTo(state.currentTime + secs);
  }

  stepFrame(dir) {
    const frameDuration = 0.04;
    if (state.mediaSourceType === 'youtube') {
      if (this.ytPlayer && state.isPlaying && typeof this.ytPlayer.pauseVideo === 'function') {
        this.ytPlayer.pauseVideo();
      }
    } else if (this.videoEl && this.videoEl.src) {
      this.videoEl.pause();
    }
    this.seekTo(state.currentTime + dir * frameDuration);
  }

  setVolume(val) {
    state.volume = parseFloat(val);
    if (this.videoEl) this.videoEl.volume = state.volume;
    if (this.ytPlayer && typeof this.ytPlayer.setVolume === 'function') {
      this.ytPlayer.setVolume(Math.round(state.volume * 100));
    }
    state.isMuted = state.volume === 0;
    if (this.videoEl) this.videoEl.muted = state.isMuted;
    if (this.ytPlayer) {
      const fn = state.isMuted ? this.ytPlayer.mute : this.ytPlayer.unMute;
      if (typeof fn === 'function') fn.call(this.ytPlayer);
    }
    this.updateVolumeIcon();
  }

  toggleMute() {
    state.isMuted = !state.isMuted;
    if (this.videoEl) this.videoEl.muted = state.isMuted;
    if (this.ytPlayer) {
      if (state.isMuted) {
        if (typeof this.ytPlayer.mute === 'function') this.ytPlayer.mute();
      } else {
        if (typeof this.ytPlayer.unMute === 'function') this.ytPlayer.unMute();
      }
    }
    this.updateVolumeIcon();
  }

  updateVolumeIcon() {
    if (!this.volumeIcon) return;
    if (state.isMuted || state.volume === 0) {
      this.volumeIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
      if (this.volumeRange) this.volumeRange.value = 0;
    } else {
      this.volumeIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>';
      if (this.volumeRange) this.volumeRange.value = state.volume;
    }
  }

  setSpeed(rate) {
    state.playbackRate = parseFloat(rate);
    if (this.videoEl) this.videoEl.playbackRate = state.playbackRate;
    if (this.ytPlayer && typeof this.ytPlayer.setPlaybackRate === 'function') {
      this.ytPlayer.setPlaybackRate(state.playbackRate);
    }
    if (this.speedSelect) this.speedSelect.value = state.playbackRate.toString();
    if (this.mobileSpeedBtn) this.mobileSpeedBtn.textContent = `${state.playbackRate}×`;
  }

  cycleSpeed() {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const curr = state.playbackRate;
    let idx = speeds.indexOf(curr);
    if (idx === -1) idx = speeds.indexOf(1);
    const next = speeds[(idx + 1) % speeds.length];
    this.setSpeed(next);
    showToast(`Speed: ${next}×`);
  }

  togglePiP() {
    if (state.mediaSourceType === 'youtube') {
      showToast('Picture-in-Picture for YouTube is available via YouTube player menu');
      return;
    }
    const hasPipSupport = Boolean(
      (document.pictureInPictureEnabled !== false) &&
      (this.videoEl && typeof this.videoEl.requestPictureInPicture === 'function')
    );
    if (!hasPipSupport) {
      showToast('Picture-in-Picture in Firefox is available via the browser video overlay toggle');
      return;
    }
    if (!document.pictureInPictureElement) {
      this.videoEl.requestPictureInPicture().catch(() => {
        showToast('Could not enter Picture-in-Picture');
      });
    } else {
      document.exitPictureInPicture().catch(() => { });
    }
  }

  toggleFullscreen() {
    const target = this.playerArea || (state.isAudio ? this.audioStage : this.videoEl);
    if (!document.fullscreenElement) {
      if (target && target.requestFullscreen) {
        target.requestFullscreen().catch(() => { });
      }
    } else {
      document.exitFullscreen().catch(() => { });
    }
  }

  setupFullscreenListeners() {
    if (!this.playerArea) return;

    const onActivity = () => {
      if (!document.fullscreenElement) return;
      this.showFullscreenExitButton();
      this.scheduleFullscreenExitHide();
    };

    this.playerArea.addEventListener('mousemove', onActivity);
    this.playerArea.addEventListener('touchstart', onActivity, { passive: true });
    this.playerArea.addEventListener('touchmove', onActivity, { passive: true });

    if (this.fullscreenExitBtn) {
      this.fullscreenExitBtn.addEventListener('mouseenter', () => {
        this.isFsButtonHovered = true;
        clearTimeout(this.fsHideTimer);
        this.showFullscreenExitButton();
      });
      this.fullscreenExitBtn.addEventListener('mouseleave', () => {
        this.isFsButtonHovered = false;
        this.scheduleFullscreenExitHide();
      });
    }

    const onFsChange = () => this.handleFullscreenChange();
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
  }

  handleFullscreenChange() {
    const isFs = !!document.fullscreenElement;
    if (this.playerArea) {
      this.playerArea.classList.toggle('is-fullscreen', isFs);
      if (!isFs) {
        this.playerArea.classList.remove('cursor-idle');
      }
    }

    if (isFs) {
      this.showFullscreenExitButton();
      this.scheduleFullscreenExitHide();
    } else {
      this.hideFullscreenExitButton();
    }
  }

  showFullscreenExitButton() {
    if (!this.fullscreenExitBtn) return;
    this.fullscreenExitBtn.classList.add('visible');
    if (this.playerArea) {
      this.playerArea.classList.remove('cursor-idle');
    }
  }

  hideFullscreenExitButton() {
    clearTimeout(this.fsHideTimer);
    if (!this.fullscreenExitBtn) return;
    this.fullscreenExitBtn.classList.remove('visible');
    if (this.playerArea && document.fullscreenElement) {
      this.playerArea.classList.add('cursor-idle');
    }
  }

  scheduleFullscreenExitHide() {
    clearTimeout(this.fsHideTimer);
    if (!document.fullscreenElement || this.isFsButtonHovered) return;
    this.fsHideTimer = setTimeout(() => {
      if (!this.isFsButtonHovered && document.fullscreenElement) {
        this.hideFullscreenExitButton();
      }
    }, 2500);
  }

  updateTimeDisplay() {
    if (!this.timeDisplay) return;
    const curStr = formatTime(state.currentTime);
    const durStr = formatTime(state.duration);
    this.timeDisplay.innerHTML = `${curStr} <span class="dur">/ ${durStr}</span>`;

    const stampBadgeVal = document.getElementById('stamp-badge-val');
    if (stampBadgeVal && !state.isTimeStamped) {
      stampBadgeVal.textContent = curStr;
      state.stampTime = state.currentTime;
    }

    const audioMeta = document.getElementById('audio-meta');
    if (audioMeta) {
      audioMeta.textContent = `${curStr} / ${durStr}`;
    }
  }

  /**
   * A media element can only ever feed one MediaElementAudioSourceNode and stays routed
   * through Web Audio for life. Swap in a fresh <video> element so later sources play
   * directly (needed for cross-origin URLs served without CORS headers).
   */
  releaseAudioGraph() {
    if (!this.audioSourceNode) return;
    try { this.audioSourceNode.disconnect(); } catch (e) { }
    try { if (this.audioCtx) this.audioCtx.close(); } catch (e) { }
    this.audioSourceNode = null;
    this.analyserNode = null;
    this.audioCtx = null;
    this.freqData = null;

    const oldEl = this.videoEl;
    const fresh = oldEl.cloneNode(false);
    fresh.removeAttribute('src');
    try { oldEl.pause(); } catch (e) { }
    oldEl.removeAttribute('src');
    oldEl.load();
    oldEl.replaceWith(fresh);
    this.videoEl = fresh;
    this.initEvents();
  }

  initAudioContext() {
    if (this.audioSourceNode) return;
    if (!state.isAudio) return; // Only route through Web Audio when playing audio files to avoid muting videos in Firefox
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.audioCtx = new AudioCtx();
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 256; // 128 frequency bins
      this.analyserNode.smoothingTimeConstant = 0.65; // Organic, responsive smoothing
      this.analyserNode.minDecibels = -85;
      this.analyserNode.maxDecibels = -25;
      this.freqData = new Uint8Array(this.analyserNode.frequencyBinCount);

      this.audioSourceNode = this.audioCtx.createMediaElementSource(this.videoEl);
      this.audioSourceNode.connect(this.analyserNode);
      this.analyserNode.connect(this.audioCtx.destination);
    } catch (err) {
      console.warn('[Web Audio] Analyser initialization error:', err);
    }
  }

  setupAudioBars() {
    if (!this.audioBars) return;
    this.audioBars.innerHTML = '';
    this.audioBarElements = [];
    this.audioBarHeights = new Float32Array(this.audioBarsCount).fill(4);

    // Create 32 bars with aesthetic multi-color gradient matching the in-app logo
    // Bass bars: terracotta (#d97742), mid bars: warm coral/magenta, treble bars: violet (#8b5cf6)
    for (let i = 0; i < this.audioBarsCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'audio-bar-seg';

      const t = i / (this.audioBarsCount - 1);
      const r = Math.round(217 + (139 - 217) * t);
      const g = Math.round(119 + (92 - 119) * t);
      const b = Math.round(66 + (246 - 66) * t);
      bar.style.background = `rgb(${r}, ${g}, ${b})`;
      bar.style.height = '4px';

      this.audioBars.appendChild(bar);
      this.audioBarElements.push(bar);
    }
  }

  startAudioBarsAnimation() {
    if (this.audioBarsRafId) return;

    const tick = () => {
      this.updateAudioBarsFrame();
      if (state.isPlaying && state.isAudio) {
        this.audioBarsRafId = requestAnimationFrame(tick);
      } else {
        // Smoothly decay to baseline (4px) when stopped or paused
        let needsDecay = false;
        for (let i = 0; i < this.audioBarsCount; i++) {
          if (this.audioBarHeights[i] > 4.1) {
            this.audioBarHeights[i] = Math.max(4, this.audioBarHeights[i] * 0.88);
            if (this.audioBarElements[i]) {
              this.audioBarElements[i].style.height = `${this.audioBarHeights[i].toFixed(1)}px`;
            }
            needsDecay = true;
          }
        }
        if (needsDecay) {
          this.audioBarsRafId = requestAnimationFrame(tick);
        } else {
          this.audioBarsRafId = null;
          for (let i = 0; i < this.audioBarsCount; i++) {
            this.audioBarHeights[i] = 4;
            if (this.audioBarElements[i]) {
              this.audioBarElements[i].style.height = '4px';
            }
          }
        }
      }
    };

    this.audioBarsRafId = requestAnimationFrame(tick);
  }

  updateAudioBarsFrame() {
    if (!this.audioBarElements || this.audioBarElements.length === 0) return;

    // 1. Live Web Audio FFT Frequency Analysis
    if (this.analyserNode && this.freqData && state.isPlaying && state.isAudio) {
      this.analyserNode.getByteFrequencyData(this.freqData);

      const binCount = this.analyserNode.frequencyBinCount; // 128
      const minBin = 1;
      const maxBin = Math.min(115, binCount - 1);
      const vol = state.isMuted ? 0.001 : (state.volume > 0.05 ? state.volume : 1.0);

      for (let i = 0; i < this.audioBarsCount; i++) {
        // Logarithmic frequency band distribution across 32 bars
        const t0 = i / this.audioBarsCount;
        const t1 = (i + 1) / this.audioBarsCount;
        const startBin = Math.max(minBin, Math.floor(minBin + (maxBin - minBin) * Math.pow(t0, 1.8)));
        const endBin = Math.min(maxBin, Math.max(startBin + 1, Math.floor(minBin + (maxBin - minBin) * Math.pow(t1, 1.8))));

        let sum = 0;
        let peak = 0;
        let count = 0;
        for (let b = startBin; b < endBin; b++) {
          const v = this.freqData[b];
          sum += v;
          if (v > peak) peak = v;
          count++;
        }

        const rawLevel = count > 0 ? (sum / count) * 0.4 + peak * 0.6 : 0;
        let normalized = rawLevel / 255;

        // Compensate for player volume attenuation if user lowered slider
        if (vol < 0.95 && !state.isMuted) {
          normalized = Math.min(1.0, normalized / vol);
        }

        // Map to container height (4px to 26px)
        const targetH = 4 + normalized * 22;

        // Fast attack, smooth decay
        if (targetH > this.audioBarHeights[i]) {
          this.audioBarHeights[i] = targetH;
        } else {
          this.audioBarHeights[i] = Math.max(4, this.audioBarHeights[i] * 0.88);
        }

        this.audioBarElements[i].style.height = `${this.audioBarHeights[i].toFixed(1)}px`;
      }

      return;
    }

    // 2. Fallback to decoded waveform peaks at current playback timestamp (e.g. while seeking or offline)
    this.updateAudioBarsFromWaveform();
  }

  updateAudioBarsFromWaveform() {
    if (!this.audioBarElements || this.audioBarElements.length === 0) return;
    if (!state.waveformPeaks || state.duration <= 0 || !state.isAudio) return;

    const progress = Math.max(0, Math.min(1, state.currentTime / state.duration));
    const totalPeaks = state.waveformPeaks.length;
    const centerIdx = Math.floor(progress * (totalPeaks - 1));

    for (let i = 0; i < this.audioBarsCount; i++) {
      const offset = i - Math.floor(this.audioBarsCount / 2);
      const idx = Math.max(0, Math.min(totalPeaks - 1, centerIdx + offset));
      const peakVal = state.waveformPeaks[idx] || 0;
      const targetH = 4 + peakVal * 20;

      if (state.isPlaying) {
        if (targetH > this.audioBarHeights[i]) {
          this.audioBarHeights[i] = targetH;
        } else {
          this.audioBarHeights[i] = Math.max(4, this.audioBarHeights[i] * 0.88);
        }
      } else {
        this.audioBarHeights[i] = targetH;
      }
      this.audioBarElements[i].style.height = `${this.audioBarHeights[i].toFixed(1)}px`;
    }
  }
}
