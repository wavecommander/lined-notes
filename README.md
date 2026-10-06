<div align="center">

<img src="icons/icon-512.png" alt="Lined Notes Logo" width="96" height="96" />

# Lined Notes

**Professional Timeline Audio & Video Annotation Application**  
*100% Client-Side • Zero Dependencies • Offline-First Progressive Web App (PWA)*

Created using Gemini 3.8 Flash

[**Features**](#-key-features) •
[**Quick Start**](#-quick-start) •
[**Keyboard Shortcuts**](#-keyboard-shortcuts) •
[**Export & Import**](#-export--import) •
[**Architecture**](#-architecture)

</div>

---

## 📌 Overview

**Lined Notes** is a fast, lightweight, and modern media annotation workstation built directly into your browser. Designed for video editors, podcasters, researchers, educators, and content reviewers, it allows you to log precise timestamped notes, mark In/Out playback loops, capture video frame snapshots, and export annotations into industry-standard editing formats (SRT, WebVTT, Markdown, CSV, JSON, and standalone HTML reports).

### 🔒 100% Private & Client-Side
No media files or notes are ever uploaded to an external server or cloud service. Everything—audio waveform decoding, video snapshot extraction, IndexedDB persistence, and subtitle export generation—runs entirely on your local machine within the browser.

---

## ✨ Key Features

### 🎬 Flexible Media Loading
- **Local File Playback:** Drag and drop or browse local video and audio files (`.mp4`, `.mkv`, `.webm`, `.mov`, `.avi`, `.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`, `.opus`, `.aac`).
- **YouTube Integration:** Paste any YouTube video link (regular links, `youtu.be`, `/shorts/`, or `/embed/`) with automatic video title synchronization and timeline scrubbing.
- **External Video Streams:** Direct playback of remote HTTP/HTTPS video and audio streams.
- **Detached Review Mode:** Load and review saved project annotations, search notes, and export reports even without the source media file attached.

### 📊 Interactive Canvas Waveform & Timeline
- **Hardware-Accelerated Timeline:** Smooth canvas scrubbing, high-DPI scaling, and responsive hover timecodes.
- **Web Worker Audio Decoding:** Background audio demuxing and waveform peak calculation off the main thread for smooth 60 FPS UI performance.
- **Live Frequency Visualizer:** Web Audio API frequency visualizer disc card for dedicated audio file playback.
- **Timeline Annotation Flags:** Visual indicators on the timeline displaying note positions and colored category tags.
- **Zoom & Pan:** Zoom timeline in/out using shortcut keys (`+`/`-`) or `Ctrl` + mouse wheel.

### 📝 Precision Annotation & Note-Taking
- **Instant Timestamp Capture:** Press <kbd>N</kbd> while playing to mark the exact timecode and jump straight into writing.
- **A-B Range In/Out Points:** Mark In (<kbd>I</kbd>) and Out (<kbd>O</kbd>) points to annotate continuous time ranges.
- **Range Looping:** Toggle A-B range looping (<kbd>Shift</kbd> + <kbd>L</kbd>) for detailed transcription or repeating critical moments.
- **Color-Coded Categorization:** Tag annotations with curated categories (**Note**, **Action**, **Highlight**, **Issue**, **Quote**) and filter notes by tag.
- **Automatic Frame Snapshots:** Captures video thumbnail snapshots for every timestamped note.
- **Snapshot Lightbox:** Click any thumbnail to view full-resolution video frames and download snapshot images.
- **Pause While Typing:** Optional setting to automatically pause playback while typing notes and resume once the note is saved.
- **Editable Notes:** Change a saved note's text, start/end time (with "Now" buttons) and tag; nudge timing with <kbd>Shift</kbd> + <kbd>,</kbd>/<kbd>.</kbd>.
- **Reaction-Time Offset:** Optionally stamp 1–3 s earlier when capturing during playback.
- **Undo:** <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd> (or the toast's Undo button) reverts adds, edits, deletes, imports and clear-all.
- **Instant Search:** Real-time text filtering across all annotations in the sidebar.

### 💾 Local Projects & Session Management
- **IndexedDB Auto-Save:** Changes are persisted locally across reloads and media changes in `LinedNotesDB`.
- **Project Switcher & Manager:** Browse all past sessions, search by media title or tags, restore projects, and manage stored sessions.
- **Inline Project Renaming:** Rename session titles directly from the project manager with confirm/cancel controls.
- **Back Up & Restore:** Download every project as one JSON file and restore it later (restores merge with existing projects).
- **Persistent Storage:** Asks the browser to protect saved projects from automatic clean-up; usage is shown in Settings.

### 📱 Responsive PWA & Mobile Support
- **Installable PWA:** Install as a standalone native app on macOS, Windows, Linux, Android, and iOS.
- **Window Controls Overlay:** Clean desktop title bar integration on supported platforms.
- **Mobile Segmented Tabs:** Dedicated responsive mobile tabs (`Player`, `Timeline`, `Notes`) for compact screens.
- **PWA File Handling:** Open media files directly into Lined Notes from your operating system file manager.
- **Web Share API:** Share exported notes directly to native apps (Google Drive, Slack, Messages, Files) on mobile devices.
- **Share Target & Deep Links:** Share a YouTube or video link to Lined Notes on Android, or open `index.html?v=<YouTube ID or URL>&t=90` to load media at a time.
- **Dark & Light Themes:** Instant toggle (<kbd>T</kbd>) with automatic system `prefers-color-scheme` detection.

---

## 🚀 Quick Start

Because **Lined Notes** is built purely with vanilla web standards, **no build step, bundler, or `npm install` is required**.

### Running Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/wavecommander/lined-notes.git
   cd lined-notes
   ```

2. **Serve with any static file server:**
   *Using Python:*
   ```bash
   python -m http.server 8080
   ```

   *Using Node.js (`npx`):*
   ```bash
   npx serve .
   ```

   *Using PHP:*
   ```bash
   php -S localhost:8080
   ```

3. **Open in your browser:**  
   Navigate to `http://localhost:8080`.

### Running Tests

Unit tests for the parsers and formatters use Node's built-in runner (no install needed):

```bash
node --test tests/*.test.mjs
```

> **Note:** Serving via a local HTTP server (rather than opening `index.html` via `file://`) is required for Service Workers, Web Workers, and Web Components to function correctly.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|:---|:---|
| <kbd>Space</kbd> or <kbd>K</kbd> | Play / Pause playback |
| <kbd>N</kbd> | Capture current timestamp & focus annotation input |
| <kbd>←</kbd> / <kbd>→</kbd> | Skip backward / forward 5 seconds |
| <kbd>J</kbd> / <kbd>L</kbd> | Skip backward / forward 10 seconds |
| <kbd>,</kbd> / <kbd>.</kbd> or <kbd>[</kbd> / <kbd>]</kbd> | Jump to previous / next annotation note |
| <kbd>I</kbd> / <kbd>O</kbd> | Set **In Point** / **Out Point** for range annotations |
| <kbd>Shift</kbd> + <kbd>L</kbd> | Toggle A-B range loop playback |
| <kbd>Shift</kbd> + <kbd>,</kbd> / <kbd>.</kbd> | Nudge the active note 0.1 s earlier / later |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd> | Undo the last note change (add, edit, delete, import, clear all) |
| <kbd>+</kbd> / <kbd>−</kbd> | Zoom timeline in / out (or <kbd>Ctrl</kbd> + Scroll) |
| <kbd>M</kbd> | Mute / unmute audio |
| <kbd>F</kbd> | Toggle fullscreen video mode |
| <kbd>P</kbd> | Picture-in-Picture mode |
| <kbd>T</kbd> | Toggle Dark / Light theme |
| <kbd>Esc</kbd> | Dismiss active input / close dialogs / exit fullscreen |

---

## 📤 Export & Import

Export your timeline annotations at any time into a variety of production formats:

| Format | File Extension | Description / Target Tools |
|:---|:---:|:---|
| **JSON** | `.json` | Full-fidelity project backup containing all timestamps, In/Out ranges, tags, snapshots, and metadata. |
| **Markdown** | `.md` | Formatted notes with timestamp anchors ready for **Obsidian**, **Notion**, or **GitHub**. |
| **SubRip Subtitles** | `.srt` | Standard subtitle cues for **Premiere Pro**, **DaVinci Resolve**, **Final Cut Pro**, and **VLC**. |
| **WebVTT** | `.vtt` | Web video subtitles, HTML5 `<track>` elements, and chapter markers. |
| **CSV** | `.csv` | Tabular spreadsheet format ready for **Excel**, **Google Sheets**, or Python/Pandas data pipelines. |
| **HTML Report** | `.html` | Standalone, self-contained interactive dark-mode report with clickable timecode links. |

### Importing Annotations
Already have existing notes or subtitles? Use the **Import** dialog to load `.json`, `.srt`, `.vtt`, or `.csv` files into your timeline. You can choose to **Replace** current annotations or **Merge** them with existing notes.

---

## 🏗️ Architecture

Lined Notes is engineered with modern, dependency-free vanilla web technologies:

```
lined-notes/
├── css/
│   ├── main.css              # Main CSS aggregator
│   ├── tokens.css            # Design system CSS custom properties & color palettes
│   ├── base.css              # Global styles and resets
│   ├── header.css            # Header bar, search, theme switcher
│   ├── player.css            # Video/audio stage, drop zone, disc visualizer
│   ├── controls.css          # Transport controls, In/Out range buttons, speed/volume
│   ├── timeline.css          # Canvas scrubber container styles
│   ├── notes.css             # Sidebar notes list, note cards, tag filters
│   ├── modals.css            # Accessible modal dialogs and bottom sheets
│   └── mobile.css            # Responsive layout adjustments & touch targets
├── js/
│   ├── app.js                # Core controller and event dispatcher
│   ├── state.js              # Centralized reactive application state
│   ├── config.js             # Configuration, default tags, and export presets
│   ├── player.js             # HTML5 media controller & YouTube IFrame API bridge
│   ├── timeline.js           # 60 FPS Canvas timeline scrubber and render engine
│   ├── notes.js              # Annotation CRUD, tagging, and thumbnail snapshot logic
│   ├── sessions.js           # Multi-project session management & persistence
│   ├── db.js                 # IndexedDB wrapper (LinedNotesDB)
│   ├── export.js             # Multi-format serializers (JSON, MD, SRT, VTT, CSV, HTML)
│   ├── import.js             # Multi-format deserializers (JSON, SRT, VTT, CSV)
│   ├── waveform-utils.js     # Web Audio API decode utilities and peak calculation
│   ├── waveform-worker.js    # Dedicated Web Worker for off-thread waveform decoding
│   ├── utils.js              # Time formatting, DOM helpers, toast notification helpers
│   └── components/           # Autonomous Web Components (Custom Elements)
│       ├── modal-dialog.js   # <modal-dialog> accessible dialog overlay
│       ├── note-card.js      # <note-card> interactive timestamped note item
│       ├── tag-picker.js     # <tag-picker> category tag selector
│       ├── time-display.js   # <time-display> current timecode / duration display
│       ├── toast-notification.js # <toast-notification> non-intrusive toast messages
│       └── mobile-tabs.js    # <mobile-tabs> responsive view switcher
├── icons/                    # Vector SVG and multi-resolution PNG icons
├── manifest.webmanifest      # Progressive Web App manifest
├── sw.js                     # Offline Service Worker (Network-First with cache fallback)
└── index.html                # Application shell and UI layout
```

### Key Engineering Decisions
- **Zero Dependencies:** No framework lock-in, no node vulnerability updates, no bundle build delays. Instant load and high longevity.
- **Web Components:** Encapsulated custom elements (`<note-card>`, `<tag-picker>`, `<modal-dialog>`) provide modularity without the overhead of heavy frameworks.
- **Dedicated Web Worker:** Offloads waveform analysis from the main thread, keeping user interaction silky smooth even with large media files.
- **Offline-First via Service Worker:** Automatically precaches the application shell and assets, allowing you to use Lined Notes on airplanes, trains, or on-site without an internet connection.
