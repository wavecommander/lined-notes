/* ==========================================================================
   Import Suite
   Parses JSON, SRT, WebVTT, and standard RFC-4180 CSV files
   ========================================================================== */

import { state } from './state.js';
import { showToast, parseTimeToSeconds, sanitizeImageSrc } from './utils.js';

const newNoteId = () => Date.now() + Math.random().toString(36).substring(2, 6);

/**
 * Validates and normalises one note from an imported/backup JSON file; returns null if unusable.
 */
export function normalizeNote(n) {
  const start = parseFloat(n.start !== undefined ? n.start : n.time);
  if (!isFinite(start) || start < 0) return null;
  const end = parseFloat(n.end);
  const tag = state.tags.some(t => t.id === n.tag) ? n.tag : 'note';
  return {
    id: (typeof n.id === 'string' || typeof n.id === 'number') && String(n.id) ? String(n.id) : newNoteId(),
    start,
    end: isFinite(end) && end > start ? end : null,
    text: typeof n.text === 'string' ? n.text : String(n.text ?? ''),
    tag,
    thumb: sanitizeImageSrc(n.thumb),
    createdAt: typeof n.createdAt === 'string' ? n.createdAt : new Date().toISOString()
  };
}

export class ImportManager {
  constructor() {
    this.importModal = document.getElementById('import-modal');
    this.fileInput = document.getElementById('import-file-input');
  }

  openImportModal() {
    if (this.importModal) {
      if (typeof this.importModal.open === 'function') this.importModal.open();
      else this.importModal.classList.add('open');
    }
  }

  closeImportModal() {
    if (this.importModal) {
      if (typeof this.importModal.close === 'function') this.importModal.close();
      else this.importModal.classList.remove('open');
    }
  }

  handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      this.parseImportContent(e.target.result, file.name);
    };
    reader.readAsText(file);
    if (this.fileInput) this.fileInput.value = '';
  }

  parseImportContent(content, fileName) {
    const modeEl = document.querySelector('input[name="import-mode"]:checked');
    const mode = modeEl ? modeEl.value : 'replace';
    let importedNotes = [];

    try {
      // 1. JSON
      if (fileName.endsWith('.json') || content.trim().startsWith('{')) {
        const data = JSON.parse(content);
        if (Array.isArray(data.notes)) {
          importedNotes = data.notes
            .filter(n => n && typeof n === 'object')
            .map(n => this.normalizeJsonNote(n))
            .filter(Boolean);
        }
      }
      // 2. SRT / WebVTT
      else if (fileName.endsWith('.srt') || fileName.endsWith('.vtt') || content.includes('-->')) {
        importedNotes = this.parseSubtitleCues(content);
      }
      // 3. CSV (ISSUE-03 fix: RFC-4180 full support)
      else if (fileName.endsWith('.csv') || content.includes(',')) {
        importedNotes = this.parseCSVNotes(content);
      }

      if (importedNotes.length === 0) {
        showToast('No valid annotations found in file');
        return;
      }

      state.undoHistory.push('import', state.notes);
      if (mode === 'replace') {
        state.notes = importedNotes;
      } else {
        // Re-key imported notes whose ids collide with existing ones (e.g. merging the same file twice)
        const existingIds = new Set(state.notes.map(n => String(n.id)));
        importedNotes.forEach(n => {
          if (existingIds.has(String(n.id))) n.id = newNoteId();
          existingIds.add(String(n.id));
        });
        state.notes = [...state.notes, ...importedNotes];
      }

      state.notes.sort((a, b) => a.start - b.start);
      this.closeImportModal();
      state.emit('noteschange');
      state.emit('timelinechanged');
      state.emit('requestsave');
      if (state.getStorageKey()) {
        showToast(`Imported ${importedNotes.length} annotations`, true, () => state.emit('requestundo'));
      } else {
        // No active project yet: notes are kept in memory and attached to the next media opened
        showToast(`Imported ${importedNotes.length} annotations — open the matching media to save them`, false, null, 6000);
      }
    } catch (err) {
      console.error('Import parse error:', err);
      showToast('Failed to parse annotations file');
    }
  }

  normalizeJsonNote(n) {
    return normalizeNote(n);
  }

  parseSubtitleCues(text) {
    const list = [];
    const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/);
    blocks.forEach(block => {
      const lines = block.trim().split('\n');
      const timeLine = lines.find(l => l.includes('-->'));
      if (timeLine) {
        const parts = timeLine.split('-->').map(s => s.trim());
        const start = this.parseSubtitleTime(parts[0]);
        const end = this.parseSubtitleTime(parts[1]);
        const textLines = lines.slice(lines.indexOf(timeLine) + 1).join('\n');
        if (!isNaN(start) && textLines) {
          list.push({
            id: newNoteId(),
            start: start,
            end: isNaN(end) ? null : end,
            text: textLines.trim(),
            tag: 'note',
            createdAt: new Date().toISOString()
          });
        }
      }
    });
    return list;
  }

  parseSubtitleTime(str) {
    return parseTimeToSeconds(str);
  }

  /**
   * RFC-4180 Compliant CSV parser supporting quotes, commas, multiline cells & tags (ISSUE-03 fix).
   */
  parseCSVNotes(text) {
    const rows = [];
    let row = [''];
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            row[row.length - 1] += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          row[row.length - 1] += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === ',') {
          row.push('');
        } else if (c === '\r') {
          // Ignore CR
        } else if (c === '\n') {
          rows.push(row);
          row = [''];
        } else {
          row[row.length - 1] += c;
        }
      }
      i++;
    }
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
    }

    if (rows.length < 2) return [];

    // Header analysis
    const headers = rows[0].map(h => h.trim().toLowerCase());
    let startSecIdx = headers.indexOf('start seconds');
    let startTimeIdx = headers.indexOf('start time');
    let endSecIdx = headers.indexOf('end seconds');
    let endTimeIdx = headers.indexOf('end time');
    let tagIdx = headers.indexOf('tag');
    let noteIdx = headers.indexOf('note');

    // Default indices if header format varies
    if (startSecIdx === -1 && startTimeIdx === -1) startSecIdx = 0;
    if (noteIdx === -1) noteIdx = headers.length - 1;

    const result = [];
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];
      if (cols.length === 0 || (cols.length === 1 && !cols[0].trim())) continue;

      let start = NaN;
      if (startSecIdx !== -1 && cols[startSecIdx] !== undefined) {
        start = parseFloat(cols[startSecIdx]);
      }
      if (isNaN(start) && startTimeIdx !== -1 && cols[startTimeIdx]) {
        start = this.parseSubtitleTime(cols[startTimeIdx]);
      }
      if (isNaN(start)) continue;

      let end = null;
      if (endSecIdx !== -1 && cols[endSecIdx] && !isNaN(parseFloat(cols[endSecIdx]))) {
        end = parseFloat(cols[endSecIdx]);
      } else if (endTimeIdx !== -1 && cols[endTimeIdx]) {
        const parsedEnd = this.parseSubtitleTime(cols[endTimeIdx]);
        if (!isNaN(parsedEnd)) end = parsedEnd;
      }

      let tag = 'note';
      if (tagIdx !== -1 && cols[tagIdx]) {
        const tagLabel = cols[tagIdx].trim().toLowerCase();
        const found = state.tags.find(t => t.id === tagLabel || t.label.toLowerCase() === tagLabel);
        if (found) tag = found.id;
      }

      const noteText = (cols[noteIdx] !== undefined ? cols[noteIdx] : cols[cols.length - 1]).trim();
      if (!noteText) continue;

      result.push({
        id: newNoteId(),
        start,
        end: (end && end > start) ? end : null,
        text: noteText,
        tag,
        createdAt: new Date().toISOString()
      });
    }

    return result;
  }
}
