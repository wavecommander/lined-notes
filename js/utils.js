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
  if (!isFinite(secs) || isNaN(secs)) secs = 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.round((secs % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function formatVTTTime(secs) {
  return formatSRTTime(secs).replace(',', '.');
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

export function showToast(msg, showUndo = false, onUndo = null) {
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
  }, 2800);
}
