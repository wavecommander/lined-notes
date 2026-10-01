/* ==========================================================================
   Media Player Controller & Waveform Audio Decoding
   ========================================================================== */

import { state } from './state.js';
import { APP_CONFIG } from './config.js';
import { formatTime, formatBytes, showToast } from './utils.js';
import {
  extractAudioFromWebM,
  calculateWaveformPeaks,
  generateSyntheticWaveform as createSyntheticPeaks
} from './waveform-utils.js';

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
      if (state.isSyntheticWaveform && state.mediaFile && state.duration > 0) {
        this.generateSyntheticWaveform(state.mediaFile, state.duration);
      }
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
      this.initAudioContext();
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      this.startAudioBarsAnimation();
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
  }

  resetPlaybackState() {
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

    // Check if attaching to an existing detached review session
    if (state.detachedMode && file.name === state.detachedSessionName) {
      this.resetPlaybackState();
      state.mediaFile = file;
      state.detachedMode = false;
      const detachedStage = document.getElementById('detached-stage');
      if (detachedStage) detachedStage.style.display = 'none';
      state.isAudio = file.type.startsWith('audio/');
      state.isSyntheticWaveform = false;

      if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
      state.mediaUrl = URL.createObjectURL(file);

      this.updateMediaUI(file);
      showToast(`Attached ${file.name} to session`);
      this.generateWaveformPeaks(file);

      state.emit('filereset');
      return;
    }

    // Auto-save previous active session before switching
    if (state.notes.length > 0) {
      state.emit('requestsave');
    }

    // Immediately stop and reset playback before changing source
    this.resetPlaybackState();

    state.detachedMode = false;
    state.detachedSessionKey = null;
    state.detachedSessionName = null;
    state.detachedSessionSize = 0;
    const detachedStage = document.getElementById('detached-stage');
    if (detachedStage) detachedStage.style.display = 'none';

    state.mediaFile = file;
    state.isAudio = file.type.startsWith('audio/');
    state.notes = [];
    state.activeNoteId = null;
    state.editingNoteId = null;
    state.APoint = null;
    state.BPoint = null;
    state.isLooping = false;
    state.isTimeStamped = false;
    state.waveformPeaks = null;
    state.isSyntheticWaveform = false;
    state.duration = 0;
    state.currentTime = 0;
    state.zoom = 1;
    state.scrollOffset = 0;

    if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
    state.mediaUrl = URL.createObjectURL(file);

    this.updateMediaUI(file);
    showToast(`Loaded ${file.name}`);
    this.generateWaveformPeaks(file);

    state.emit('filereset');
  }

  updateMediaUI(file) {
    const badge = document.getElementById('file-badge');
    const nameText = document.getElementById('file-name-text');
    if (badge) badge.classList.add('active');
    if (nameText) {
      nameText.textContent = file.name;
      nameText.title = `${file.name} (${formatBytes(file.size)})`;
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
      if (audioTitle) audioTitle.textContent = file.name;
      if (pipBtn) pipBtn.style.display = 'none';
    } else {
      this.audioStage.classList.remove('active');
      this.videoEl.classList.add('active');
      if (pipBtn) pipBtn.style.display = 'inline-flex';
    }

    if (this.dropZone) this.dropZone.classList.add('hidden');
  }

  generateSyntheticWaveform(file, duration) {
    const samples = APP_CONFIG.waveformSampleCount || 1600;
    const peaks = createSyntheticPeaks(file, duration, samples);
    state.waveformPeaks = peaks;
    state.isSyntheticWaveform = true;
    state.emit('timelinechanged');
    return peaks;
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

      const onMessage = (e) => {
        if (e.data && e.data.taskId === taskId && e.data.type === 'PEAKS_COMPLETED') {
          this.waveformWorker.removeEventListener('message', onMessage);
          this.waveformWorker.removeEventListener('error', onError);
          const peaks = new Float32Array(e.data.peaksBuffer);
          resolve(peaks);
        }
      };

      const onError = (err) => {
        console.warn('[WaveformWorker] Peak calculation error, falling back:', err);
        this.waveformWorker.removeEventListener('message', onMessage);
        this.waveformWorker.removeEventListener('error', onError);
        resolve(calculateWaveformPeaks(channelData, samples));
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
          } else if (e.data.type === 'DEMUX_FAILED') {
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
      this.generateSyntheticWaveform(file, state.duration);
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
          audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
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
          this.generateSyntheticWaveform(file, state.duration);
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

      // Fallback Path 3: Try direct decode if not already attempted
      if (!audioBuffer && isWebMOrMkv) {
        try {
          audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
        } catch (finalErr) {
          // Fall through to synthetic waveform
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

        state.waveformPeaks = peaks;
        state.isSyntheticWaveform = false;
        audioCtx.close();
        state.emit('timelinechanged');
      } else {
        // High-fidelity synthetic fallback
        this.generateSyntheticWaveform(file, state.duration);
        audioCtx.close();
      }
    } catch (err) {
      console.warn('Waveform decode fallback:', err);
      this.generateSyntheticWaveform(file, state.duration);
    }
  }

  togglePlay() {
    if (state.detachedMode) {
      showToast('Attach media file to play video/audio');
      return;
    }
    if (!state.mediaFile) return;
    if (this.videoEl.paused) {
      this.videoEl.play();
    } else {
      this.videoEl.pause();
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
    if (!state.mediaFile && !state.detachedMode) return;
    const target = Math.max(0, Math.min(state.duration, time));
    state.currentTime = target;
    if (this.videoEl && !state.detachedMode && this.videoEl.src) {
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
    if (this.videoEl && this.videoEl.src) this.videoEl.pause();
    this.seekTo(state.currentTime + dir * frameDuration);
  }

  setVolume(val) {
    state.volume = parseFloat(val);
    this.videoEl.volume = state.volume;
    state.isMuted = state.volume === 0;
    this.updateVolumeIcon();
  }

  toggleMute() {
    state.isMuted = !state.isMuted;
    this.videoEl.muted = state.isMuted;
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
    this.videoEl.playbackRate = state.playbackRate;
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
    if (!document.pictureInPictureElement) {
      if (this.videoEl && this.videoEl.requestPictureInPicture) {
        this.videoEl.requestPictureInPicture().catch(() => { });
      }
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

  initAudioContext() {
    if (this.audioSourceNode) return;
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

      // Real-time waveform refinement for synthetic waveforms during audio playback
      if (state.isSyntheticWaveform && state.waveformPeaks && state.duration > 0) {
        let peakEnergy = 0;
        for (let b = 1; b < Math.min(120, this.analyserNode.frequencyBinCount); b++) {
          if (this.freqData[b] > peakEnergy) peakEnergy = this.freqData[b];
        }
        const liveAmp = Math.min(1.0, (peakEnergy / 255) / (vol > 0.05 ? vol : 1.0));
        if (liveAmp > 0.03) {
          const progress = Math.max(0, Math.min(1, state.currentTime / state.duration));
          const idx = Math.floor(progress * (state.waveformPeaks.length - 1));
          state.waveformPeaks[idx] = state.waveformPeaks[idx] * 0.25 + liveAmp * 0.75;
        }
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
