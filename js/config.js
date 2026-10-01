/* ==========================================================================
   Application Configuration & Default Constants
   ========================================================================== */

export const APP_CONFIG = {
  name: 'Lined Notes',
  version: '1.1.0',
  storageDbName: 'LinedNotesDB',
  storageStoreName: 'sessions',
  storageDbVersion: 1,

  // Theme settings
  defaultTheme: 'dark',
  themeStorageKey: 'ln_theme',
  pauseOnTypeKey: 'ln_pause_on_type',
  copyIncludeTimestampKey: 'ln_copy_include_timestamp',

  // Audio waveform decoding limits (memory safe for desktop and mobile)
  maxDecodeSizeDesktop: 500 * 1024 * 1024, // 500MB
  maxDecodeSizeMobile: 120 * 1024 * 1024,   // 120MB
  waveformSampleCount: 1600,

  // Snapshot configuration
  snapshotMaxWidth: 480,
  snapshotQuality: 0.72
};

export const DEFAULT_TAGS = [
  { id: 'note', label: 'Note', color: '#d97742' },        // Warm Terracotta
  { id: 'action', label: 'Action', color: '#4a90e2' },    // Slate Blue
  { id: 'highlight', label: 'Highlight', color: '#709775' },// Sage Green
  { id: 'issue', label: 'Issue', color: '#c85a54' },      // Rust Red
  { id: 'quote', label: 'Quote', color: '#b07dac' }       // Dusty Mauve
];

export const EXPORT_FORMATS = [
  { id: 'json', label: 'JSON (Project)', ext: 'json', mime: 'application/json' },
  { id: 'md', label: 'Markdown (.md)', ext: 'md', mime: 'text/markdown' },
  { id: 'srt', label: 'SubRip (.srt)', ext: 'srt', mime: 'text/srt' },
  { id: 'vtt', label: 'WebVTT (.vtt)', ext: 'vtt', mime: 'text/vtt' },
  { id: 'csv', label: 'CSV (.csv)', ext: 'csv', mime: 'text/csv' },
  { id: 'html', label: 'HTML Report', ext: 'html', mime: 'text/html' }
];
