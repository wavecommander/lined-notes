/* ==========================================================================
   Utility Helpers & Formatting
   ========================================================================== */

let toastTimer = null;
let currentUndoHandler = null;

export function formatTime(secs, includeDecimals = true) {
  if (!isFinite(secs) || isNaN(secs)) secs = 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.floor((secs % 1) * 10);
  const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return includeDecimals ? `${base}.${ms}` : base;
}

export function formatSRTTime(secs) {
  if (!isFinite(secs) || isNaN(secs) || secs < 0) secs = 0;
  // Round to whole milliseconds first so 1.9996 becomes 00:00:02,000 (not 00:00:01,1000)
  const totalMs = Math.round(secs * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function formatVTTTime(secs) {
  return formatSRTTime(secs).replace(',', '.');
}

export function parseTimeToSeconds(str) {
  if (!str) return NaN;
  const clean = String(str).trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(clean);
}

export function calculateSubtitleCueEnd(note, nextNote) {
  if (note.end && note.end > note.start) {
    return note.end;
  }
  if (nextNote && nextNote.start > note.start + 0.5) {
    return Math.min(note.start + 3.0, nextNote.start);
  }
  return Math.max(note.start + 1.0, note.start + 2.5);
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Escapes characters for safe HTML injection, including single quotes (ISSUE-01 fix).
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Returns the value only if it is a safe image source for note thumbnails
 * (a data:image URL or an http(s) URL); otherwise null.
 */
export function sanitizeImageSrc(src) {
  if (typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch (e) { }
  return null;
}

export function timeAgo(dateStr) {
  if (!dateStr) return 'recently';
  const now = new Date();
  const date = new Date(dateStr);
  const secs = Math.floor((now - date) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * Robust clipboard copy with fallback to hidden textarea (ISSUE-10 fix).
 */
export async function copyText(text, successMsg = 'Copied to clipboard') {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showToast(successMsg);
  } catch (err) {
    console.warn('Clipboard write error:', err);
    showToast('Failed to copy to clipboard');
  }
}

export function interpolateColor(c1, c2, t) {
  const parseColor = (col) => {
    if (!col) return [0, 0, 0, 1];
    if (typeof col === 'string') {
      const trimmed = col.trim();
      if (trimmed.startsWith('#')) {
        const hex = trimmed.slice(1);
        if (hex.length === 3) {
          return [
            parseInt(hex[0] + hex[0], 16),
            parseInt(hex[1] + hex[1], 16),
            parseInt(hex[2] + hex[2], 16),
            1
          ];
        }
        if (hex.length === 6) {
          return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
            1
          ];
        }
        if (hex.length === 8) {
          return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
            parseInt(hex.slice(6, 8), 16) / 255
          ];
        }
      }
      const rgbaMatch = trimmed.match(/rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
      if (rgbaMatch) {
        return [
          parseFloat(rgbaMatch[1]),
          parseFloat(rgbaMatch[2]),
          parseFloat(rgbaMatch[3]),
          rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1
        ];
      }
    }
    return [0, 0, 0, 1];
  };

  const [r1, g1, b1, a1] = parseColor(c1);
  const [r2, g2, b2, a2] = parseColor(c2);

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  const a = +(a1 + (a2 - a1) * t).toFixed(3);

  return a >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function showToast(msg, showUndo = false, onUndo = null, duration = 2800) {
  const toastEl = document.querySelector('toast-notification') || document.getElementById('toast');
  if (toastEl) {
    const isNotesTab = window.innerWidth <= 1024 && document.getElementById('app')?.getAttribute('data-mobile-view') === 'notes';
    const targetParent = isNotesTab
      ? document.getElementById('notes-panel')
      : document.getElementById('player-area');
    if (targetParent && toastEl.parentElement !== targetParent) {
      targetParent.appendChild(toastEl);
    }
  }

  if (toastEl && typeof toastEl.show === 'function') {
    toastEl.show(msg, showUndo, onUndo, duration);
    return;
  }

  const toast = document.getElementById('toast');
  const text = document.getElementById('toast-text');
  const undoBtn = document.getElementById('toast-action');
  if (!toast || !text) return;

  text.textContent = msg;
  currentUndoHandler = onUndo;

  if (undoBtn) {
    undoBtn.style.display = showUndo ? 'inline-block' : 'none';
    undoBtn.onclick = () => {
      if (typeof currentUndoHandler === 'function') {
        currentUndoHandler();
        currentUndoHandler = null;
        toast.classList.remove('show');
      }
    };
  }

  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/**
 * Parses user-provided media URLs (YouTube or direct stream).
 * Supports YouTube standard, short, embed, live, and shorts formats,
 * as well as generic direct HTTP/HTTPS media URLs.
 */
export function parseMediaUrl(inputStr) {
  if (!inputStr || typeof inputStr !== 'string') return null;
  const raw = inputStr.trim();
  if (!raw) return null;

  // 1. YouTube URL matchers
  // Matches:
  // - https://www.youtube.com/watch?v=VIDEO_ID
  // - https://m.youtube.com/watch?v=VIDEO_ID
  // - https://youtu.be/VIDEO_ID
  // - https://www.youtube.com/embed/VIDEO_ID
  // - https://www.youtube.com/shorts/VIDEO_ID
  // - https://www.youtube.com/live/VIDEO_ID
  // - https://music.youtube.com/watch?v=VIDEO_ID
  const ytRegex = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
  const ytMatch = raw.match(ytRegex);

  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1];
    let startTime = null;

    // Check for timestamp query param: ?t=1m30s, ?t=90, ?start=90
    const timeMatch = raw.match(/[?&#](?:t|start)=([0-9hms]+)/i);
    if (timeMatch && timeMatch[1]) {
      const tVal = timeMatch[1];
      if (/^\d+$/.test(tVal)) {
        startTime = parseInt(tVal, 10);
      } else {
        let total = 0;
        const h = tVal.match(/(\d+)h/i);
        const m = tVal.match(/(\d+)m/i);
        const s = tVal.match(/(\d+)s/i);
        if (h) total += parseInt(h[1], 10) * 3600;
        if (m) total += parseInt(m[1], 10) * 60;
        if (s) total += parseInt(s[1], 10);
        if (total > 0) startTime = total;
      }
    }

    return {
      type: 'youtube',
      videoId,
      startTime,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: `YouTube: ${videoId}`
    };
  }

  // Raw 11-char YouTube ID pasted directly
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) {
    return {
      type: 'youtube',
      videoId: raw,
      startTime: null,
      url: `https://www.youtube.com/watch?v=${raw}`,
      title: `YouTube: ${raw}`
    };
  }

  // 2. Generic direct web media URL
  try {
    const parsed = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const pathname = parsed.pathname || '';
      const filename = pathname.split('/').filter(Boolean).pop() || parsed.hostname;
      const isAudio = Boolean(filename && filename.match(/\.(mp3|wav|ogg|m4a|aac|flac|opus|weba)($|\?)/i));
      return {
        type: 'direct',
        url: parsed.href,
        title: decodeURIComponent(filename),
        isAudio
      };
    }
  } catch (e) {
    return null;
  }

  return null;
}

export function getYouTubeThumbnailUrl(videoId, quality = 'hqdefault') {
  if (!videoId) return null;
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
}

/**
 * Creates a thumbnail data URL with an optional overlaid timecode badge.
 * Gracefully falls back to raw thumbnail URL if cross-origin canvas security blocks export.
 */
export async function createCompositeThumbnail(thumbUrl, timecode = null) {
  if (!thumbUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        if (timecode !== null && !isNaN(timecode)) {
          const tcStr = formatTime(timecode);
          ctx.font = '600 13px "JetBrains Mono", monospace';
          const textW = ctx.measureText(tcStr).width;
          const padX = 8, padY = 4;
          const badgeW = textW + padX * 2;
          const badgeH = 22;
          const x = canvas.width - badgeW - 10;
          const y = canvas.height - badgeH - 10;

          ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(x, y, badgeW, badgeH, 4) : ctx.rect(x, y, badgeW, badgeH);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.fillText(tcStr, x + padX, y + 16);
        }

        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve(dataUrl);
      } catch (err) {
        // Fallback to direct thumbnail URL if canvas is tainted
        resolve(thumbUrl);
      }
    };
    img.onerror = () => {
      resolve(thumbUrl);
    };
    img.src = thumbUrl;
  });
}
