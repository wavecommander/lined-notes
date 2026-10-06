/* ==========================================================================
   Notes Undo / Redo History
   Bounded stacks of note-list snapshots for undoing and redoing edits,
   deletes, nudges, imports & clears
   ========================================================================== */

// Note objects are copied shallowly, so large strings (thumbnail data URLs) are shared rather than duplicated
const snapshot = (label, notes, mergeKey = null) => ({ label, mergeKey, notes: notes.map(n => ({ ...n })) });

export class UndoHistory {
  constructor(limit = 20) {
    this.limit = limit;
    this.entries = [];
    this.redoEntries = [];
    this.lastMergeKey = null;
  }

  /**
   * Records the notes as they were *before* a change, and drops the redo stack (a new
   * change starts a new branch). Back-to-back pushes with the same `mergeKey` (e.g.
   * repeated nudges of one note) collapse into the first snapshot so one undo reverts the run.
   */
  push(label, notes, mergeKey = null) {
    this.redoEntries = [];
    const top = this.entries[this.entries.length - 1];
    const continuesRun = mergeKey && top && mergeKey === this.lastMergeKey;
    this.lastMergeKey = mergeKey;
    if (continuesRun) return;
    this.entries.push(snapshot(label, notes, mergeKey));
    if (this.entries.length > this.limit) this.entries.shift();
  }

  /**
   * Steps back: returns the snapshot to restore (or null) and keeps `currentNotes` for redo.
   */
  undo(currentNotes) {
    const entry = this.entries.pop();
    if (!entry) return null;
    this.lastMergeKey = null;
    this.redoEntries.push(snapshot(entry.label, currentNotes));
    return entry;
  }

  /**
   * Steps forward again: returns the snapshot to restore (or null) and keeps `currentNotes` for undo.
   */
  redo(currentNotes) {
    const entry = this.redoEntries.pop();
    if (!entry) return null;
    this.lastMergeKey = null;
    this.entries.push(snapshot(entry.label, currentNotes));
    if (this.entries.length > this.limit) this.entries.shift();
    return entry;
  }

  clear() {
    this.entries = [];
    this.redoEntries = [];
    this.lastMergeKey = null;
  }

  get size() {
    return this.entries.length;
  }

  get redoSize() {
    return this.redoEntries.length;
  }
}
