/* ==========================================================================
   Timeline Canvas Renderer, Scrubber & Waveform Visualizer
   High-performance on-demand rendering with Detached Mode support
   ========================================================================== */

import { state } from './state.js';
import { formatTime, interpolateColor } from './utils.js';

function createCubicBezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;

  function sampleX(t) { return ((ax * t + bx) * t + cx) * t; }
  function sampleY(t) { return ((ay * t + by) * t + cy) * t; }
  function sampleDerivX(t) { return (3 * ax * t + 2 * bx) * t + cx; }

  return function solve(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const currentX = sampleX(t) - x;
      if (Math.abs(currentX) < 1e-4) return sampleY(t);
      const d = sampleDerivX(t);
      if (Math.abs(d) < 1e-4) break;
      t -= currentX / d;
    }
    return sampleY(t);
  };
}

const themeEaseCurve = createCubicBezier(0.4, 0, 0.2, 1);

export class TimelineEngine {
  constructor(playerController) {
    this.player = playerController;
    this.canvasWrap = document.getElementById('timeline-canvas-wrap');
    this.canvas = document.getElementById('timeline-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.cachedW = 0;
    this.cachedH = 0;
    this.animFrame = null;
    this.currentThemeColors = null;
    this.themeAnimFrame = null;

    this.init();
  }

  init() {
    this.setupResizeObserver();
    this.setupPointerEvents();
    this.setupLoopManager();
    this.setupThemeTransition();

    state.on('timelinechanged', () => this.drawTimeline());
    state.on('medialoaded', () => this.drawTimeline());
    state.on('timeupdate', () => {
      if (!state.isPlaying) {
        this.drawTimeline();
      }
    });
    state.on('noteschange', () => this.drawTimeline());
    state.on('filereset', () => this.resetTimelineState());
    state.on('filerestet', () => this.resetTimelineState());
  }

  resetTimelineState() {
    this.resetZoom();
    state.hoverTime = null;
    state.hoverX = null;
    state.isPanning = false;
    state.isScrubbing = false;
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this.drawTimeline();
  }

  setupResizeObserver() {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const dpr = window.devicePixelRatio || 1;
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0 && h > 0) {
          this.cachedW = w;
          this.cachedH = h;
          this.canvas.width = Math.round(w * dpr);
          this.canvas.height = Math.round(h * dpr);
          this.drawTimeline();
        }
      }
    });
    ro.observe(this.canvasWrap);
  }

  setupLoopManager() {
    const loop = () => {
      if (state.isPlaying) {
        this.drawTimeline();
        this.animFrame = requestAnimationFrame(loop);
      } else {
        this.animFrame = null;
      }
    };

    state.on('playstatechange', (isPlaying) => {
      if (isPlaying) {
        if (!this.animFrame) {
          this.animFrame = requestAnimationFrame(loop);
        }
      } else {
        if (this.animFrame) {
          cancelAnimationFrame(this.animFrame);
          this.animFrame = null;
        }
        this.drawTimeline();
      }
    });
  }

  setupPointerEvents() {
    this.canvasWrap.addEventListener('pointerdown', (e) => this.startScrub(e));
    this.canvasWrap.addEventListener('pointermove', (e) => this.onTimelineHover(e));
    this.canvasWrap.addEventListener('pointerleave', () => this.clearHover());
    this.canvasWrap.addEventListener('wheel', (e) => this.onTimelineWheel(e), { passive: false });
  }

  getVisibleDuration() {
    if (!state.duration || state.duration <= 0) return 1;
    return state.duration / state.zoom;
  }

  timeToX(time, width) {
    if (!state.duration || state.duration <= 0) return 0;
    const visDur = this.getVisibleDuration();
    return ((time - state.scrollOffset) / visDur) * width;
  }

  xToTime(x, width) {
    if (!state.duration || state.duration <= 0) return 0;
    const visDur = this.getVisibleDuration();
    return Math.max(0, Math.min(state.duration, state.scrollOffset + (x / width) * visDur));
  }

  clampScrollOffset() {
    const visDur = this.getVisibleDuration();
    const maxOffset = Math.max(0, state.duration - visDur);
    state.scrollOffset = Math.max(0, Math.min(maxOffset, state.scrollOffset));
  }

  setZoom(val, centerTime = null) {
    const hasMedia = Boolean(state.mediaFile || state.detachedMode);
    if (!hasMedia || !state.duration) {
      state.zoom = 1;
      state.scrollOffset = 0;
      const zoomVal = document.getElementById('zoom-val');
      if (zoomVal) zoomVal.textContent = '1.0×';
      return;
    }
    state.zoom = Math.max(1, Math.min(32, val));
    const zoomVal = document.getElementById('zoom-val');
    if (zoomVal) zoomVal.textContent = `${state.zoom.toFixed(1)}×`;

    if (state.zoom === 1) {
      state.scrollOffset = 0;
    } else {
      const center = centerTime !== null ? centerTime : state.currentTime;
      const visDur = this.getVisibleDuration();
      state.scrollOffset = center - (visDur / 2);
      this.clampScrollOffset();
    }
    this.drawTimeline();
  }

  resetZoom() {
    this.setZoom(1);
    state.scrollOffset = 0;
    this.drawTimeline();
  }

  zoomIn() {
    this.setZoom(state.zoom * 1.5);
  }

  zoomOut() {
    this.setZoom(state.zoom / 1.5);
  }

  startScrub(e) {
    const hasMedia = Boolean(state.mediaFile || state.detachedMode);
    if (!hasMedia || state.duration === 0) return;
    this.canvas.setPointerCapture(e.pointerId);

    if (e.button === 1 || e.shiftKey || (state.zoom > 1 && e.altKey)) {
      state.isPanning = true;
      state.panStartX = e.clientX;
      state.panStartOffset = state.scrollOffset;
    } else {
      state.isScrubbing = true;
      this.seekByPointer(e);
    }

    const onPointerMove = (moveEvent) => {
      if (state.isPanning) {
        const deltaX = moveEvent.clientX - state.panStartX;
        const rect = this.canvas.getBoundingClientRect();
        const visDur = this.getVisibleDuration();
        const timeDelta = (deltaX / rect.width) * visDur;
        state.scrollOffset = state.panStartOffset - timeDelta;
        this.clampScrollOffset();
        this.drawTimeline();
      } else if (state.isScrubbing) {
        this.seekByPointer(moveEvent);
      }
    };

    const onPointerUp = () => {
      state.isScrubbing = false;
      state.isPanning = false;
      this.canvas.removeEventListener('pointermove', onPointerMove);
      this.canvas.removeEventListener('pointerup', onPointerUp);
      this.drawTimeline();
    };

    this.canvas.addEventListener('pointermove', onPointerMove);
    this.canvas.addEventListener('pointerup', onPointerUp);
  }

  seekByPointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const targetTime = this.xToTime(clientX, rect.width);
    this.player.seekTo(targetTime);
  }

  onTimelineHover(e) {
    const hasMedia = Boolean(state.mediaFile || state.detachedMode);
    if (!hasMedia || state.duration === 0) return;
    const rect = this.canvas.getBoundingClientRect();
    state.hoverX = e.clientX - rect.left;
    state.hoverTime = this.xToTime(state.hoverX, rect.width);
    this.drawTimeline();
  }

  onTimelineWheel(e) {
    const hasMedia = Boolean(state.mediaFile || state.detachedMode);
    if (!hasMedia || state.duration === 0) return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const hoverTime = this.xToTime(mouseX, rect.width);

    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.25 : 0.8;
      this.setZoom(state.zoom * factor, hoverTime);
    } else {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const visDur = this.getVisibleDuration();
      const timeDelta = (delta / rect.width) * visDur * 0.4;
      state.scrollOffset += timeDelta;
      this.clampScrollOffset();
      this.drawTimeline();
    }
  }

  clearHover() {
    state.hoverX = null;
    state.hoverTime = null;
    this.drawTimeline();
  }

  calculateTickInterval(dur) {
    const W = this.cachedW || 800;
    const widthFactor = W < 420 ? 2.2 : (W < 640 ? 1.6 : (W < 900 ? 1.2 : 1));
    const scaledDur = dur * widthFactor;

    if (scaledDur <= 5) return 0.5;
    if (scaledDur <= 15) return 1;
    if (scaledDur <= 30) return 2;
    if (scaledDur <= 60) return 5;
    if (scaledDur <= 120) return 10;
    if (scaledDur <= 300) return 30;
    if (scaledDur <= 600) return 60;
    if (scaledDur <= 1800) return 120;
    if (scaledDur <= 3600) return 300;
    if (scaledDur <= 7200) return 600;
    return 1200;
  }

  setupThemeTransition() {
    this.currentThemeColors = this.getThemeColorsFor(state.theme);

    state.on('themechanged', (payload) => {
      const targetTheme = (payload && payload.theme) || state.theme;
      const isTransitioning = payload && payload.transitioning;
      const targetColors = this.getThemeColorsFor(targetTheme);

      if (this.themeAnimFrame) {
        cancelAnimationFrame(this.themeAnimFrame);
        this.themeAnimFrame = null;
      }

      if (!isTransitioning) {
        this.currentThemeColors = targetColors;
        this.drawTimeline();
        return;
      }

      const fromColors = { ...(this.currentThemeColors || this.getThemeColorsFor(targetTheme === 'light' ? 'dark' : 'light')) };
      const duration = (payload && payload.duration) || 300;
      const startTime = performance.now();

      const step = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, Math.max(0, elapsed / duration));
        const eased = themeEaseCurve(progress);

        const current = {};
        for (const key of Object.keys(targetColors)) {
          if (key === 'isLight') {
            current[key] = progress >= 0.5 ? targetColors[key] : fromColors[key];
          } else if (typeof targetColors[key] === 'string' && typeof fromColors[key] === 'string') {
            current[key] = interpolateColor(fromColors[key], targetColors[key], eased);
          } else {
            current[key] = targetColors[key];
          }
        }

        this.currentThemeColors = current;
        this.drawTimeline();

        if (progress < 1) {
          this.themeAnimFrame = requestAnimationFrame(step);
        } else {
          this.currentThemeColors = targetColors;
          this.themeAnimFrame = null;
          this.drawTimeline();
        }
      };

      this.themeAnimFrame = requestAnimationFrame(step);
    });
  }

  getThemeColorsFor(theme = state.theme) {
    const isLight = theme === 'light';
    if (isLight) {
      return {
        isLight: true,
        canvasBg: '#ffffff',
        trackBg: '#dfd8cd',
        emptyText: '#6e6357',
        waveUnplayed: '#b8ad9e',
        wavePlayed: '#c25e2a',
        tickMajor: '#6e6357',
        tickMinor: '#dfd8cd',
        tickText: '#6e6357',
        hoverLine: 'rgba(43, 36, 30, 0.3)',
        tooltipBg: '#ffffff',
        tooltipBorder: '#dfd8cd',
        tooltipText: '#2b241e',
        playhead: '#c25e2a',
        rangeHighlight: 'rgba(194, 94, 42, 0.16)'
      };
    }
    return {
      isLight: false,
      canvasBg: '#1b1815',
      trackBg: '#38312b',
      emptyText: '#a89f91',
      waveUnplayed: '#4d443c',
      wavePlayed: '#d97742',
      tickMajor: '#a89f91',
      tickMinor: '#2b2520',
      tickText: '#a89f91',
      hoverLine: 'rgba(245, 242, 235, 0.25)',
      tooltipBg: '#231f1b',
      tooltipBorder: '#4d443c',
      tooltipText: '#f5f2eb',
      playhead: '#d97742',
      rangeHighlight: 'rgba(217, 119, 66, 0.16)'
    };
  }

  getThemeColors() {
    return this.currentThemeColors || this.getThemeColorsFor(state.theme);
  }

  drawTimeline() {
    const dpr = window.devicePixelRatio || 1;
    const c = this.ctx;
    const W = this.cachedW || (this.canvas.width / dpr);
    const H = this.cachedH || (this.canvas.height / dpr);
    const tc = this.getThemeColors();
    const monoFont = 'ui-monospace, SFMono-Regular, Menlo, monospace';

    c.save();
    c.scale(dpr, dpr);
    c.clearRect(0, 0, W, H);

    // Support both active media and Detached Review Mode (ISSUE-02 fix)
    const hasMedia = Boolean(state.mediaFile || state.detachedMode);
    if (!hasMedia || state.duration === 0) {
      c.fillStyle = tc.trackBg;
      c.fillRect(0, H / 2 - 1, W, 2);
      c.fillStyle = tc.emptyText;
      c.font = `11px ${monoFont}`;
      c.textAlign = 'center';
      c.restore();
      return;
    }

    const visDur = this.getVisibleDuration();
    const visStart = state.scrollOffset;
    const visEnd = state.scrollOffset + visDur;

    // 1. In/Out Range Highlight if set
    if (state.inPoint !== null) {
      const inX = this.timeToX(state.inPoint, W);
      const outX = this.timeToX(state.outPoint !== null ? state.outPoint : state.currentTime, W);
      const leftX = Math.max(0, Math.min(inX, outX));
      const rightX = Math.min(W, Math.max(inX, outX));

      if (rightX > leftX) {
        c.fillStyle = tc.rangeHighlight;
        c.fillRect(leftX, 0, rightX - leftX, H);
      }

      if (inX >= 0 && inX <= W) {
        c.fillStyle = tc.playhead;
        c.fillRect(inX - 1, 0, 2, H);
      }
      if (state.outPoint !== null && outX >= 0 && outX <= W) {
        c.fillStyle = tc.playhead;
        c.fillRect(outX - 1, 0, 2, H);
      }
    }

    // 2. Waveform Visualization (HD Decoded or Realistic Synthetic)
    const midY = H / 2 + 6;
    if (state.waveformPeaks && state.waveformPeaks.length > 0) {
      const peaks = state.waveformPeaks;
      const count = peaks.length;
      const progressX = this.timeToX(state.currentTime, W);
      const peakDuration = state.duration / count;
      const barW = Math.max(1, (peakDuration / visDur) * W);

      for (let i = 0; i < count; i++) {
        const tPeak = i * peakDuration;
        if (tPeak + peakDuration < visStart || tPeak > visEnd) continue;
        const x = this.timeToX(tPeak, W);
        const isPlayed = x <= progressX;
        const amp = Math.max(1.5, peaks[i] * (H * 0.38));

        c.fillStyle = isPlayed ? tc.wavePlayed : tc.waveUnplayed;
        c.fillRect(x, midY - amp, Math.max(1, barW - 0.5), amp * 2);
      }
    } else {
      // Pending / Empty Waveform Track with active progress indicator
      c.fillStyle = tc.trackBg;
      c.fillRect(0, midY - 1, W, 2);
      const playedX = this.timeToX(state.currentTime, W);
      const startX = this.timeToX(0, W);
      c.fillStyle = tc.wavePlayed;
      const clampStart = Math.max(0, Math.min(W, startX));
      const clampEnd = Math.max(0, Math.min(W, playedX));
      if (clampEnd > clampStart) {
        c.fillRect(clampStart, midY - 1, clampEnd - clampStart, 2);
      }

      // If media file is loaded and still analyzing, render subtle animated placeholder wave
      if (state.mediaFile) {
        const barStep = 5;
        const barCount = Math.floor(W / barStep);
        c.fillStyle = tc.waveUnplayed;
        c.globalAlpha = 0.3;
        for (let i = 0; i < barCount; i++) {
          const bx = i * barStep;
          const h = 3 + Math.sin(i * 0.25) * 2;
          c.fillRect(bx, midY - h, 2, h * 2);
        }
        c.globalAlpha = 1.0;
      }
    }

    // 3. Range Annotation Blocks
    state.notes.forEach(note => {
      if (note.end && note.end > note.start) {
        const startX = this.timeToX(note.start, W);
        const endX = this.timeToX(note.end, W);
        const left = Math.max(0, Math.min(startX, endX));
        const right = Math.min(W, Math.max(startX, endX));
        if (right > left) {
          const tagObj = state.tags.find(t => t.id === note.tag) || state.tags[0];
          c.fillStyle = tagObj.color + '26'; // ~15% alpha
          c.fillRect(left, 4, right - left, H - 8);
        }
      }
    });

    // 4. Tick Marks & Time Scale
    const tickInterval = this.calculateTickInterval(visDur);
    const firstTick = Math.floor(visStart / tickInterval) * tickInterval;
    const lastTick = Math.ceil(visEnd / tickInterval) * tickInterval;
    let lastLabelX = -999;

    c.font = `9px ${monoFont}`;
    c.textAlign = 'center';

    for (let t = firstTick; t <= lastTick; t += tickInterval) {
      if (t < 0 || t > state.duration + 0.001) continue;
      const x = this.timeToX(t, W);
      if (x < -10 || x > W + 10) continue;

      const pixelSpacing = (W / Math.max(1, visDur)) * tickInterval;
      const isMajor = pixelSpacing >= 50 ? true : (Math.abs(Math.round(t / tickInterval) % 5) === 0);
      c.fillStyle = isMajor ? tc.tickMajor : tc.tickMinor;
      c.fillRect(x, 0, 1, isMajor ? 9 : 4);

      if (isMajor && x > 24 && x < W - 24 && (x - lastLabelX >= 48)) {
        c.fillStyle = tc.tickText;
        const h = Math.floor(t / 3600);
        const m = Math.floor((t % 3600) / 60);
        const s = Math.floor(t % 60);
        let label;
        if (tickInterval < 1) {
          const frac = (t % 1).toFixed(1).substring(1);
          label = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${frac}` : `${m}:${String(s).padStart(2, '0')}${frac}`;
        } else {
          label = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
        }
        c.fillText(label, x, 20);
        lastLabelX = x;
      }
    }

    // 5. Note Markers
    state.notes.forEach(note => {
      const x = this.timeToX(note.start, W);
      if (x < -10 || x > W + 10) return;
      const isNear = Math.abs(note.start - state.currentTime) < (visDur * 0.015);
      const tagObj = state.tags.find(t => t.id === note.tag) || state.tags[0];

      // Marker stem
      c.fillStyle = tagObj.color;
      c.fillRect(x - 0.5, 0, 1, H);

      // Marker diamond
      c.save();
      c.translate(x, midY);
      c.rotate(Math.PI / 4);
      const sz = isNear ? 9 : 6;
      c.fillStyle = tagObj.color;
      c.fillRect(-sz / 2, -sz / 2, sz, sz);
      if (isNear) {
        c.strokeStyle = tc.isLight ? '#2b241e' : '#ffffff';
        c.lineWidth = 1.5;
        c.strokeRect(-sz / 2, -sz / 2, sz, sz);
      }
      c.restore();
    });

    // 6. Hover Guide
    if (state.hoverX !== null && state.hoverTime !== null) {
      const hx = state.hoverX;
      if (hx >= 0 && hx <= W) {
        c.strokeStyle = tc.hoverLine;
        c.lineWidth = 1;
        c.setLineDash([3, 3]);
        c.beginPath();
        c.moveTo(hx, 0);
        c.lineTo(hx, H);
        c.stroke();
        c.setLineDash([]);

        const tipText = formatTime(state.hoverTime);
        c.font = `10px ${monoFont}`;
        const textW = c.measureText(tipText).width;
        const tipX = Math.max(4, Math.min(W - textW - 14, hx - textW / 2 - 7));
        c.fillStyle = tc.tooltipBg;
        c.fillRect(tipX, H - 24, textW + 14, 18);
        c.strokeStyle = tc.tooltipBorder;
        c.strokeRect(tipX, H - 24, textW + 14, 18);
        c.fillStyle = tc.tooltipText;
        c.textAlign = 'left';
        c.fillText(tipText, tipX + 7, H - 11);
      }
    }

    // 7. Playhead
    const playX = this.timeToX(state.currentTime, W);
    if (playX >= -10 && playX <= W + 10) {
      c.fillStyle = tc.playhead;
      c.beginPath();
      c.moveTo(playX - 6, 0);
      c.lineTo(playX + 6, 0);
      c.lineTo(playX, 8);
      c.closePath();
      c.fill();

      c.fillStyle = tc.playhead;
      c.fillRect(playX - 1, 8, 2, H - 8);
    }

    // 8. Zoom Minimap
    if (state.zoom > 1) {
      c.fillStyle = tc.trackBg;
      c.fillRect(0, 0, W, 3);
      const winX = (state.scrollOffset / state.duration) * W;
      const winW = (visDur / state.duration) * W;
      c.fillStyle = tc.playhead;
      c.fillRect(winX, 0, Math.max(6, winW), 3);
    }

    c.restore();
  }
}
