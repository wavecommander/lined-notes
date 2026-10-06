/* ==========================================================================
   Unit tests for pure helpers — run with: node --test tests/*.test.mjs
   No dependencies; only modules without top-level DOM access are imported.
   ========================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSRTTime,
  formatVTTTime,
  parseTimeToSeconds,
  parseMediaUrl,
  sanitizeImageSrc
} from '../js/utils.js';
import { ImportManager } from '../js/import.js';

// ImportManager's constructor touches the DOM; its parsers don't, so call them on a bare instance
const importer = Object.create(ImportManager.prototype);

test('formatSRTTime never produces 4-digit milliseconds', () => {
  assert.equal(formatSRTTime(1.9996), '00:00:02,000');
  assert.equal(formatSRTTime(59.9999), '00:01:00,000');
  assert.equal(formatSRTTime(3725.5), '01:02:05,500');
  assert.equal(formatSRTTime(-1), '00:00:00,000');
  assert.equal(formatVTTTime(1.25), '00:00:01.250');
});

test('parseTimeToSeconds handles SRT, VTT and short forms', () => {
  assert.equal(parseTimeToSeconds('00:01:02,500'), 62.5);
  assert.equal(parseTimeToSeconds('01:02.5'), 62.5);
  assert.equal(parseTimeToSeconds('42'), 42);
  assert.ok(Number.isNaN(parseTimeToSeconds('')));
});

test('parseMediaUrl recognises YouTube forms and start times', () => {
  assert.equal(parseMediaUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s').startTime, 90);
  assert.equal(parseMediaUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
  const direct = parseMediaUrl('https://example.com/media/talk.mp3');
  assert.equal(direct.type, 'direct');
  assert.equal(direct.isAudio, true);
  assert.equal(parseMediaUrl('ftp://example.com/a.mp4'), null);
});

test('sanitizeImageSrc only allows image data URLs and http(s)', () => {
  assert.equal(sanitizeImageSrc('x" onerror="alert(1)'), null);
  assert.equal(sanitizeImageSrc('javascript:alert(1)'), null);
  assert.equal(sanitizeImageSrc('data:text/html;base64,PHNjcmlwdD4='), null);
  assert.equal(sanitizeImageSrc('data:image/jpeg;base64,/9j/4AAQ=='), 'data:image/jpeg;base64,/9j/4AAQ==');
  assert.equal(sanitizeImageSrc('https://img.youtube.com/vi/x/hqdefault.jpg'), 'https://img.youtube.com/vi/x/hqdefault.jpg');
  assert.equal(sanitizeImageSrc(null), null);
});

test('JSON import notes are validated', () => {
  assert.equal(importer.normalizeJsonNote({ start: 'abc', text: 'x' }), null);
  assert.equal(importer.normalizeJsonNote({ start: -3, text: 'x' }), null);
  const n = importer.normalizeJsonNote({ id: 7, start: '4.5', end: 2, text: 'hi', tag: 'bogus', thumb: 'x" onerror="y' });
  assert.equal(n.id, '7');
  assert.equal(n.start, 4.5);
  assert.equal(n.end, null); // end before start is dropped
  assert.equal(n.tag, 'note'); // unknown tags fall back
  assert.equal(n.thumb, null);
});

test('CSV import handles quotes, commas and newlines in cells', () => {
  const csv = 'Start Time,Start Seconds,End Time,End Seconds,Tag,Note\n' +
    '"00:00:01.0",1.000,"","","Issue","He said ""hi"", then\nleft"\n';
  const [note] = importer.parseCSVNotes(csv);
  assert.equal(note.start, 1);
  assert.equal(note.tag, 'issue');
  assert.equal(note.text, 'He said "hi", then\nleft');
});

test('subtitle import parses cues', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,500\nFirst line\n\n2\n00:00:05,000 --> 00:00:06,000\nSecond\n';
  const notes = importer.parseSubtitleCues(srt);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].end, 3.5);
  assert.equal(notes[1].text, 'Second');
});

// ─── UX round: launch params, note editing, undo, backups ─────────────

import { parseLaunchParams, resolveNoteTimes } from '../js/utils.js';
import { UndoHistory } from '../js/history.js';
import { parseBackup, mergeSessionData } from '../js/sessions.js';

test('parseLaunchParams reads deep links, share targets and shortcuts', () => {
  assert.deepEqual(parseLaunchParams('?action=open', ''), { action: 'open', mediaInput: null });
  assert.equal(parseLaunchParams('?v=dQw4w9WgXcQ&t=90').mediaInput, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90');
  assert.equal(parseLaunchParams('?v=dQw4w9WgXcQ', '#t=1m30s').mediaInput, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s');
  // a URL that already carries its own start time is left alone
  assert.equal(parseLaunchParams('?url=' + encodeURIComponent('https://youtu.be/dQw4w9WgXcQ?t=5') + '&t=90').mediaInput, 'https://youtu.be/dQw4w9WgXcQ?t=5');
  // Android share sheets often put the link inside free text
  assert.equal(parseLaunchParams('?text=' + encodeURIComponent('Watch this https://youtu.be/dQw4w9WgXcQ !')).mediaInput, 'https://youtu.be/dQw4w9WgXcQ');
  assert.deepEqual(parseLaunchParams('', ''), { action: null, mediaInput: null });
});

test('resolveNoteTimes validates edited start/end', () => {
  const note = { start: 10.04, end: null };
  assert.deepEqual(resolveNoteTimes(note, null, null, 60), { start: 10.04, end: null }); // unchanged keeps precision
  assert.deepEqual(resolveNoteTimes(note, '00:00:05.0', '00:00:08', 60), { start: 5, end: 8 });
  assert.deepEqual(resolveNoteTimes({ start: 5, end: 8 }, null, '', 60), { start: 5, end: null });
  assert.equal(resolveNoteTimes(note, 'abc', null, 60).error, 'Invalid start time');
  assert.equal(resolveNoteTimes(note, null, '00:00:09', 60).error, 'End time must be after the start time');
  assert.equal(resolveNoteTimes(note, '02:00', null, 60).error, 'Start is past the end of the media');
  assert.deepEqual(resolveNoteTimes(note, null, '99', 60), { start: 10.04, end: 60 }); // end clamped to duration
});

test('UndoHistory caps size, snapshots shallowly and merges repeated keys', () => {
  const h = new UndoHistory(3);
  const notes = [{ id: 'a', start: 1 }];
  for (let i = 0; i < 5; i++) h.push(`op${i}`, notes);
  assert.equal(h.size, 3);
  assert.equal(h.undo(notes).label, 'op4');

  const h2 = new UndoHistory();
  h2.push('nudge', [{ id: 'a', start: 1 }], 'nudge:a');
  h2.push('nudge', [{ id: 'a', start: 1.1 }], 'nudge:a');
  assert.equal(h2.size, 1);
  assert.equal(h2.undo([]).notes[0].start, 1); // the run reverts to before the first nudge

  const live = [{ id: 'b', start: 2 }];
  h2.push('edit', live);
  live[0].start = 99;
  assert.equal(h2.undo(live).notes[0].start, 2); // later mutation doesn't leak into the snapshot
});

test('UndoHistory redo walks forward and is cleared by a new change', () => {
  const h = new UndoHistory();
  const v0 = [{ id: 'a', text: 'v0' }];
  const v1 = [{ id: 'a', text: 'v1' }];
  const v2 = [{ id: 'a', text: 'v2' }];
  h.push('edit', v0); // v0 -> v1
  h.push('edit', v1); // v1 -> v2
  assert.equal(h.undo(v2).notes[0].text, 'v1');
  assert.equal(h.undo(v1).notes[0].text, 'v0');
  assert.equal(h.undo(v0), null);
  assert.equal(h.redo(v0).notes[0].text, 'v1');
  assert.equal(h.redo(v1).notes[0].text, 'v2');
  assert.equal(h.redo(v2), null);

  assert.equal(h.undo(v2).notes[0].text, 'v1');
  h.push('delete', v1); // a new change after undo drops the redo branch
  assert.equal(h.redoSize, 0);
  assert.equal(h.redo(v1), null);
});

test('UndoHistory only merges back-to-back runs', () => {
  const h = new UndoHistory();
  h.push('nudge', [{ id: 'a', start: 1 }], 'nudge:a');   // run 1 starts at 1
  h.undo([{ id: 'a', start: 1.3 }]);                    // undo run 1
  h.redo([{ id: 'a', start: 1 }]);                      // redo it -> start 1.3
  h.push('nudge', [{ id: 'a', start: 1.3 }], 'nudge:a'); // run 2 must be its own step
  assert.equal(h.size, 2);
  assert.equal(h.undo([{ id: 'a', start: 1.6 }]).notes[0].start, 1.3);
});

test('parseBackup validates the file and sanitises notes', () => {
  assert.throws(() => parseBackup('not json'), /not valid JSON/);
  assert.throws(() => parseBackup('{"notes":[]}'), /Not a Lined Notes backup/);
  const entries = parseBackup(JSON.stringify({
    type: 'backup',
    sessions: [
      { key: 'ln_session_a.mp4_1', data: { fileName: 'a.mp4', notes: [{ id: 1, start: 2, text: 'ok', thumb: 'x" onerror="y' }, { start: 'bad' }] } },
      { key: 'other_key', data: { notes: [] } }
    ]
  }));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.notes.length, 1);
  assert.equal(entries[0].data.notes[0].thumb, null);
});

test('mergeSessionData keeps existing metadata and unions notes by id', () => {
  const existing = { fileName: 'Renamed', updatedAt: '2026-01-02T00:00:00Z', notes: [{ id: '1', start: 5 }] };
  const incoming = { fileName: 'orig.mp4', updatedAt: '2026-03-01T00:00:00Z', notes: [{ id: '1', start: 5 }, { id: '2', start: 1 }] };
  const merged = mergeSessionData(existing, incoming);
  assert.equal(merged.fileName, 'Renamed');
  assert.deepEqual(merged.notes.map(n => n.id), ['2', '1']);
  assert.equal(merged.updatedAt, '2026-03-01T00:00:00Z');
  assert.equal(mergeSessionData(null, incoming), incoming);
});

// ─── Getting Started guide ──────────────────────────────────────────────

import { shouldAutoShowOnboarding, ONBOARDING_STEPS } from '../js/onboarding.js';

test('onboarding auto-shows only on a genuine first visit', () => {
  const fresh = { seen: false, hasSavedProjects: false, launchedWithMedia: false };
  assert.deepEqual(shouldAutoShowOnboarding(fresh), { show: true, markSeen: true });
  assert.deepEqual(shouldAutoShowOnboarding({ ...fresh, seen: true }), { show: false, markSeen: false });
  // existing users aren't first-time visitors
  assert.deepEqual(shouldAutoShowOnboarding({ ...fresh, hasSavedProjects: true }), { show: false, markSeen: true });
  // opened straight into media: don't interrupt, show next time
  assert.deepEqual(shouldAutoShowOnboarding({ ...fresh, launchedWithMedia: true }), { show: false, markSeen: false });
});

test('onboarding steps provide desktop and touch copy', () => {
  assert.equal(ONBOARDING_STEPS.length, 6);
  for (const step of ONBOARDING_STEPS) {
    assert.ok(step.title && step.body(false).trim() && step.body(true).trim(), step.id);
  }
  // keyboard tips are swapped out on touch devices
  const capture = ONBOARDING_STEPS.find(s => s.id === 'capture');
  assert.match(capture.body(false), /<kbd>N<\/kbd>/);
  assert.doesNotMatch(capture.body(true), /<kbd>/);
});
