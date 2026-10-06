/* ==========================================================================
   Notes Undo History
   Bounded stack of note-list snapshots for undoing edits, deletes, imports & clears
   ========================================================================== */

export class UndoHistory {
  constructor(limit = 20) {
    this.limit = limit;
    this.entries = [];
  }

  /**
   * Records the notes as they were *before* a change. Note objects are copied shallowly,
   * so large strings (thumbnail data URLs) are shared rather than duplicated.
   * Consecutive pushes with the same `mergeKey` (e.g. repeated nudges of one note)
   * collapse into the first snapshot so a single undo reverts the whole run.
   */
  push(label, notes, mergeKey = null) {
    const top = this.entries[this.entries.length - 1];
    if (mergeKey && top && top.mergeKey === mergeKey) return;
    this.entries.push({ label, mergeKey, notes: notes.map(n => ({ ...n })) });
    if (this.entries.length > this.limit) this.entries.shift();
  }

  pop() {
    return this.entries.pop() || null;
  }

  clear() {
    this.entries = [];
  }

  get size() {
    return this.entries.length;
  }
}
