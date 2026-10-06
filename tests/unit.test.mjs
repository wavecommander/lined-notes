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
