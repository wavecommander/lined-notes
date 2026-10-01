/* ==========================================================================
   Media Player Controller & Waveform Audio Decoding
   ========================================================================== */

import { state } from './state.js';
import { APP_CONFIG } from './config.js';
import { formatTime, formatBytes, showToast } from './utils.js';
/**
 * Demuxes audio streams from WebM and Matroska (.mkv) video files into a pure audio/webm
 * container that AudioContext.decodeAudioData can decode without video overhead or failure.
 *
 * @param {ArrayBuffer} arrayBuffer - Raw WebM / MKV file bytes
 * @returns {ArrayBuffer|{noAudioTrack: boolean}|null} Demuxed audio/webm ArrayBuffer or status object
 */
export function extractAudioFromWebM(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const len = data.length;

  function readVint(offset, raw = false) {
    if (offset >= len) return null;
    const first = data[offset];
    if (first === 0) return null;
    let mask = 0x80;
    let width = 1;
    while ((first & mask) === 0 && width <= 8) {
      mask >>= 1;
      width++;
    }
    if (offset + width > len) return null;
    let val = raw ? 0 : (first & (mask - 1));
    for (let i = (raw ? 0 : 1); i < width; i++) {
      val = (val * 256) + data[offset + i];
    }
    return { val, width };
  }

  function isUnknownSize(width, val) {
    if (width >= 1 && width <= 8) {
      return val === (Math.pow(2, 7 * width) - 1);
    }
    return false;
  }

  function readElement(offset) {
    if (offset >= len) return null;
    const idInfo = readVint(offset, true);
    if (!idInfo) return null;
    const sizeOffset = offset + idInfo.width;
    const sizeInfo = readVint(sizeOffset, false);
    if (!sizeInfo) return null;
    const dataOffset = sizeOffset + sizeInfo.width;
    const unknown = isUnknownSize(sizeInfo.width, sizeInfo.val);
    const size = unknown ? (len - dataOffset) : sizeInfo.val;
    return {
      id: idInfo.val,
      idWidth: idInfo.width,
      sizeWidth: sizeInfo.width,
      headerSize: idInfo.width + sizeInfo.width,
      size,
      unknownSize: unknown,
      dataOffset,
      end: dataOffset + size
    };
  }

  function encodeVint(val, fixedWidth = 0) {
    let width = 1;
    if (fixedWidth > 0) {
      width = fixedWidth;
    } else {
      while (val >= (1 << (7 * width)) - 1 && width < 8) {
        width++;
      }
    }
    const bytes = new Uint8Array(width);
    let v = val;
    for (let i = width - 1; i >= 0; i--) {
      bytes[i] = v & 0xff;
      v = Math.floor(v / 256);
    }
    bytes[0] |= (1 << (8 - width));
    return bytes;
  }

  // 1. Verify EBML Header (0x1A45DFA3)
  const ebmlHeader = readElement(0);
  if (!ebmlHeader || ebmlHeader.id !== 0x1A45DFA3) return null;

  // 2. Segment (0x18538067)
  const segment = readElement(ebmlHeader.end);
  if (!segment || segment.id !== 0x18538067) return null;

  let pos = segment.dataOffset;
  const segEnd = segment.end <= len ? segment.end : len;

  let segmentInfoBuf = null;
  let audioTrackNumber = null;
  let audioTrackEntryBuf = null;
  const audioClusters = [];

  while (pos < segEnd) {
    const el = readElement(pos);
    if (!el || el.end > len || el.headerSize === 0) break;

    if (el.id === 0x1549A966) { // Segment Info
      segmentInfoBuf = data.slice(pos, el.end);
    } else if (el.id === 0x1654AE6B) { // Tracks
      let trackPos = el.dataOffset;
      while (trackPos < el.end) {
        const tEntry = readElement(trackPos);
        if (!tEntry || tEntry.headerSize === 0) break;
        if (tEntry.id === 0xAE) { // TrackEntry
          let childPos = tEntry.dataOffset;
          let trackNum = null;
          let trackType = null;
          while (childPos < tEntry.end) {
            const child = readElement(childPos);
            if (!child || child.headerSize === 0) break;
            if (child.id === 0xD7) { // TrackNumber
              let n = 0;
              for (let i = 0; i < child.size; i++) n = (n * 256) + data[child.dataOffset + i];
              trackNum = n;
            } else if (child.id === 0x83) { // TrackType
              let t = 0;
              for (let i = 0; i < child.size; i++) t = (t * 256) + data[child.dataOffset + i];
              trackType = t; // 1 = Video, 2 = Audio
            }
            childPos = child.end;
          }
          if (trackType === 2 && audioTrackNumber === null) {
            audioTrackNumber = trackNum;
            audioTrackEntryBuf = data.slice(trackPos, tEntry.end);
          }
        }
        trackPos = tEntry.end;
      }
    } else if (el.id === 0x1F43B675) { // Cluster
      if (audioTrackNumber !== null) {
        let clusterChild = el.dataOffset;
        let timecodeBuf = null;
        const clusterAudioBlocks = [];
        while (clusterChild < el.end) {
          const blockEl = readElement(clusterChild);
          if (!blockEl || blockEl.headerSize === 0) break;
          if (blockEl.id === 0xE7) { // Timestamp/Timecode
            timecodeBuf = data.slice(clusterChild, blockEl.end);
          } else if (blockEl.id === 0xA3 || blockEl.id === 0xA1) { // SimpleBlock or Block
            const blockTrack = readVint(blockEl.dataOffset, false);
            if (blockTrack && blockTrack.val === audioTrackNumber) {
              clusterAudioBlocks.push(data.slice(clusterChild, blockEl.end));
            }
          }
          clusterChild = blockEl.end;
        }
        if (clusterAudioBlocks.length > 0) {
          let totalClusterPayload = (timecodeBuf ? timecodeBuf.length : 0);
          for (const b of clusterAudioBlocks) totalClusterPayload += b.length;
          const clusterIdBytes = new Uint8Array([0x1F, 0x43, 0xB6, 0x75]);
          const clusterSizeBytes = encodeVint(totalClusterPayload, 4);
          const clusterTotalLen = clusterIdBytes.length + clusterSizeBytes.length + totalClusterPayload;
          const newCluster = new Uint8Array(clusterTotalLen);
          let off = 0;
          newCluster.set(clusterIdBytes, off); off += clusterIdBytes.length;
          newCluster.set(clusterSizeBytes, off); off += clusterSizeBytes.length;
          if (timecodeBuf) {
            newCluster.set(timecodeBuf, off); off += timecodeBuf.length;
          }
          for (const b of clusterAudioBlocks) {
            newCluster.set(b, off); off += b.length;
          }
          audioClusters.push(newCluster);
        }
      }
    }
    pos = el.end;
  }

  if (audioTrackNumber === null || !audioTrackEntryBuf) {
    return { noAudioTrack: true };
  }

  // Assemble new Tracks element containing only the audio TrackEntry
  const tracksIdBytes = new Uint8Array([0x16, 0x54, 0xAE, 0x6B]);
  const tracksSizeBytes = encodeVint(audioTrackEntryBuf.length, 4);
  const newTracks = new Uint8Array(tracksIdBytes.length + tracksSizeBytes.length + audioTrackEntryBuf.length);
  let off = 0;
  newTracks.set(tracksIdBytes, off); off += tracksIdBytes.length;
  newTracks.set(tracksSizeBytes, off); off += tracksSizeBytes.length;
  newTracks.set(audioTrackEntryBuf, off);

  // Calculate segment size
  let segmentPayloadSize = (segmentInfoBuf ? segmentInfoBuf.length : 0) + newTracks.length;
  for (const c of audioClusters) segmentPayloadSize += c.length;

  const segmentIdBytes = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  const segmentSizeBytes = encodeVint(segmentPayloadSize, 8);

  const ebmlHeaderBuf = data.slice(0, ebmlHeader.end);
  const totalFileSize = ebmlHeaderBuf.length + segmentIdBytes.length + segmentSizeBytes.length + segmentPayloadSize;

  const finalBuffer = new Uint8Array(totalFileSize);
  let finalOffset = 0;
  finalBuffer.set(ebmlHeaderBuf, finalOffset); finalOffset += ebmlHeaderBuf.length;
  finalBuffer.set(segmentIdBytes, finalOffset); finalOffset += segmentIdBytes.length;
  finalBuffer.set(segmentSizeBytes, finalOffset); finalOffset += segmentSizeBytes.length;
  if (segmentInfoBuf) {
    finalBuffer.set(segmentInfoBuf, finalOffset); finalOffset += segmentInfoBuf.length;
  }
  finalBuffer.set(newTracks, finalOffset); finalOffset += newTracks.length;
  for (const c of audioClusters) {
    finalBuffer.set(c, finalOffset); finalOffset += c.length;
  }

  return finalBuffer.buffer;
}

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
        if (state.isLooping && state.inPoint !== null && state.outPoint !== null) {
          if (state.currentTime >= state.outPoint || state.currentTime < state.inPoint) {
            this.seekTo(state.inPoint);
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
      state.emit('filerestet');
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
    state.inPoint = null;
    state.outPoint = null;
    state.isLooping = false;
    state.isTimeStamped = false;
    state.waveformPeaks = null;
    state.isSyntheticWaveform = false;
    state.duration = 0;
    state.currentTime = 0;
    state.zoom = 1;
    state.scrollOffset = 0;

    const zoomVal = document.getElementById('zoom-val');
    if (zoomVal) zoomVal.textContent = '1.0×';

    if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
    state.mediaUrl = URL.createObjectURL(file);

    this.updateMediaUI(file);
    showToast(`Loaded ${file.name}`);
    this.generateWaveformPeaks(file);

    state.emit('filereset');
    state.emit('filerestet');
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

  /**
   * Generates a realistic synthetic waveform acoustic envelope when native decoding
   * is unsupported, oversized, or when the video lacks an audio track.
   * Deterministically seeded from file attributes for consistent timeline rendering.
   */
  generateSyntheticWaveform(file, duration) {
    const samples = APP_CONFIG.waveformSampleCount || 1600;
    const dur = (duration && duration > 0) ? duration : (state.duration > 0 ? state.duration : 60);

    // Deterministic PRNG seed based on filename, size, and duration
    let seed = 0x5a17b3d9;
    const key = `${(file && file.name) || 'media'}_${(file && file.size) || 0}_${Math.round(dur)}`;
    for (let i = 0; i < key.length; i++) {
      seed = (seed * 31 + key.charCodeAt(i)) & 0xffffffff;
    }

    function prng() {
      seed = (seed + 0x6d2b79f5) & 0xffffffff;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    const rawPeaks = new Float32Array(samples);
    const phrasePeriod = Math.max(8, samples / Math.max(1, dur / 4.8));
    const syllablePeriod = Math.max(3, samples / Math.max(1, dur * 1.7));

    for (let i = 0; i < samples; i++) {
      const phraseWave = Math.sin((i / phrasePeriod) * Math.PI * 2);
      const phraseMask = Math.max(0, phraseWave * 0.72 + 0.28);
      const rhythm = Math.sin((i / syllablePeriod) * Math.PI * 2) * 0.26 + 0.74;
      const noise = prng() * 0.48 + 0.12;
      let val = phraseMask * rhythm * noise;
      val = Math.max(0.06, Math.min(0.96, val * 1.52));
      rawPeaks[i] = val;
    }

    // 3-point smoothing for organic acoustic curve
    const peaks = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const prev = rawPeaks[Math.max(0, i - 1)];
      const curr = rawPeaks[i];
      const next = rawPeaks[Math.min(samples - 1, i + 1)];
      peaks[i] = (prev * 0.22) + (curr * 0.56) + (next * 0.22);
    }

    state.waveformPeaks = peaks;
    state.isSyntheticWaveform = true;
    state.emit('timelinechanged');
    return peaks;
  }

  async generateWaveformPeaks(file) {
    const statusText = document.getElementById('waveform-status-text');
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const maxDecodeSize = isMobile ? APP_CONFIG.maxDecodeSizeMobile : APP_CONFIG.maxDecodeSizeDesktop;

    if (file.size > maxDecodeSize) {
      if (statusText) statusText.textContent = 'Synthetic (Large File)';
      this.generateSyntheticWaveform(file, state.duration);
      return;
    }

    if (statusText) statusText.textContent = 'Analyzing…';
    try {
      const arrayBuffer = await file.arrayBuffer();
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

      // Demux Path 2: For WebM/MKV containers, isolate pure audio stream from video clusters
      if (!audioBuffer && isWebMOrMkv) {
        const demuxResult = extractAudioFromWebM(arrayBuffer);
        if (demuxResult && demuxResult.noAudioTrack) {
          // File is a video with no audio track (e.g. screen recording or muted clip)
          if (statusText) statusText.textContent = 'Synthetic (No Audio Track)';
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

      if (audioBuffer) {
        const rawData = audioBuffer.getChannelData(0);
        const samples = APP_CONFIG.waveformSampleCount || 1600;
        const blockSize = Math.floor(rawData.length / samples);
        const peaks = new Float32Array(samples);

        for (let i = 0; i < samples; i++) {
          const blockStart = blockSize * i;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[blockStart + j] || 0);
          }
          peaks[i] = sum / Math.max(1, blockSize);
        }

        let maxPeak = 0;
        for (let i = 0; i < samples; i++) {
          if (peaks[i] > maxPeak) maxPeak = peaks[i];
        }
        if (maxPeak > 0) {
          for (let i = 0; i < samples; i++) {
            peaks[i] = peaks[i] / maxPeak;
          }
        }

        state.waveformPeaks = peaks;
        state.isSyntheticWaveform = false;
        if (statusText) statusText.textContent = 'Decoded (HD)';
        audioCtx.close();
        state.emit('timelinechanged');
      } else {
        // High-fidelity synthetic fallback
        if (statusText) statusText.textContent = isWebMOrMkv ? 'Synthetic (WebM)' : 'Synthetic';
        this.generateSyntheticWaveform(file, state.duration);
        audioCtx.close();
      }
    } catch (err) {
      console.warn('Waveform decode fallback:', err);
      if (statusText) statusText.textContent = 'Synthetic';
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
    if (state.inPoint === null || state.outPoint === null) {
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
          const statusText = document.getElementById('waveform-status-text');
          if (statusText && statusText.textContent.startsWith('Synthetic')) {
            statusText.textContent = 'Live Audio';
          }
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
