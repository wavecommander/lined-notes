/* ==========================================================================
   Getting Started Guide (first-visit onboarding)
   Step-by-step welcome dialog; auto-shown once, reopenable from the ⋮ menu
   ========================================================================== */

/**
 * Decides whether the guide should open automatically on this page load.
 * - Already seen → never again.
 * - Launched straight into media (deep link, share target, "Open with") → don't interrupt;
 *   leave it unseen so it appears on the next plain visit.
 * - Existing saved projects → not a first-time visitor; mark seen silently.
 */
export function shouldAutoShowOnboarding({ seen, hasSavedProjects, launchedWithMedia }) {
  if (seen) return { show: false, markSeen: false };
  if (launchedWithMedia) return { show: false, markSeen: false };
  if (hasSavedProjects) return { show: false, markSeen: true };
  return { show: true, markSeen: true };
}

// Small line illustrations; colours come from CSS (currentColor + .accent) so they follow the theme
const svg = (inner) => `<svg viewBox="0 0 160 88" fill="none" stroke="currentColor" stroke-width="2.4"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const ILLUSTRATIONS = {
  welcome: svg(`
    <rect x="22" y="14" width="70" height="52" rx="8"/>
    <polygon class="accent-fill" points="50,30 66,40 50,50" stroke="none"/>
    <line x1="104" y1="22" x2="140" y2="22"/>
    <line x1="104" y1="36" x2="132" y2="36"/>
    <line x1="104" y1="50" x2="138" y2="50"/>
    <line class="accent" x1="22" y1="78" x2="140" y2="78"/>
    <circle class="accent-fill" cx="64" cy="78" r="4" stroke="none"/>`),
  open: svg(`
    <path d="M30 14h30l14 14v46a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z"/>
    <path d="M60 14v14h14"/>
    <path class="accent" d="M49 38v22M40 52l9 9 9-9"/>
    <path d="M104 36a10 10 0 0 1 14-14l6 6a10 10 0 0 1-14 14"/>
    <path class="accent" d="M126 52a10 10 0 0 1-14 14l-6-6a10 10 0 0 1 14-14"/>`),
  capture: svg(`
    <path d="M14 46h8l5-12 6 24 6-30 6 34 6-22 5 12 6-10 6 4h8"/>
    <line class="accent" x1="62" y1="12" x2="62" y2="76"/>
    <rect class="accent-fill" x="57" y="41" width="10" height="10" transform="rotate(45 62 46)" stroke="none"/>
    <rect x="96" y="30" width="52" height="30" rx="6"/>
    <line x1="104" y1="41" x2="134" y2="41"/>
    <line class="accent" x1="104" y1="50" x2="104" y2="50.1"/>
    <line x1="110" y1="50" x2="124" y2="50"/>`),
  review: svg(`
    <line x1="14" y1="58" x2="146" y2="58"/>
    <line class="accent" x1="38" y1="20" x2="38" y2="66"/>
    <line x1="72" y1="34" x2="72" y2="66"/>
    <line x1="118" y1="34" x2="118" y2="66"/>
    <polygon class="accent-fill" points="32,14 44,14 38,22" stroke="none"/>
    <rect x="54" y="18" width="36" height="14" rx="4"/>
    <rect x="100" y="18" width="36" height="14" rx="4"/>
    <path d="M52 76h56"/>`),
  export: svg(`
    <path d="M26 14h30l12 12v42a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z"/>
    <line x1="30" y1="38" x2="56" y2="38"/>
    <line x1="30" y1="48" x2="52" y2="48"/>
    <line x1="30" y1="58" x2="56" y2="58"/>
    <path class="accent" d="M78 44h22M92 36l8 8-8 8"/>
    <path d="M124 18l18 7v15c0 13-8 22-18 26-10-4-18-13-18-26V25z"/>
    <path class="accent" d="M116 42l6 6 11-12"/>`),
  ready: svg(`
    <circle cx="80" cy="44" r="30"/>
    <path class="accent" d="M66 45l10 10 20-22"/>
    <line x1="22" y1="44" x2="38" y2="44"/>
    <line x1="122" y1="44" x2="138" y2="44"/>`)
};

/**
 * Guide content. `body(touch)` returns trusted static HTML; `touch` swaps keyboard tips
 * for touch equivalents on phones/tablets.
 */
export const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Lined Notes',
    body: () => `
      <p>Take timestamped notes on any video or audio — lectures, interviews, podcasts, edits to review.</p>
      <p>Everything stays on your device: nothing is uploaded, and it works offline. This quick guide shows
      the workflow — skip it whenever you like.</p>`
  },
  {
    id: 'open',
    title: 'Open your media',
    body: (touch) => touch ? `
      <p>Tap the player area to choose a file, or paste a <b>YouTube</b> or direct video link into the box below it.</p>
      <p>Each file or link becomes a project that <b>saves automatically</b>. Find earlier ones in
      <b>⋮ → Saved Projects</b>.</p>` : `
      <p>Drop a file onto the player or click <b>Open Media</b> — MP4, WebM, MKV, MP3, WAV and more.
      Or use <b>Open URL</b> (or just paste) for a <b>YouTube</b> or direct video link.</p>
      <p>Each file or link becomes a project that <b>saves automatically</b>. Find earlier ones under
      <b>Saved Projects</b>.</p>`
  },
  {
    id: 'capture',
    title: 'Capture notes as you watch',
    body: (touch) => touch ? `
      <p>While it plays, tap the <b>clock</b> next to the note box — or just start typing — to lock the current time.
      Pick a tag, then tap <b>+ Add Note</b>.</p>
      <p>The tools button by the transport opens <b>A/B</b> to mark a range. In <b>Settings</b>, <i>Pause while typing</i>
      and <i>Stamp earlier</i> help you keep up.</p>` : `
      <p>While it plays, press <kbd>N</kbd> — or just start typing — to lock the current time.
      Pick a tag, then press <kbd>Enter</kbd> to save the note.</p>
      <p>Mark a range with <kbd>I</kbd> and <kbd>O</kbd>. In <b>Settings</b>, <i>Pause while typing</i> and
      <i>Stamp earlier</i> help you keep up.</p>`
  },
  {
    id: 'review',
    title: 'Review and refine',
    body: (touch) => touch ? `
      <p>Notes appear as markers on the timeline. Open the <b>Notes</b> tab and tap a note to jump to it;
      the pencil lets you fix its text, time or tag.</p>
      <p>Search and tag filters narrow long lists, and every change can be undone from the message that appears.</p>` : `
      <p>Notes appear as markers on the timeline — click it to seek, <kbd>Ctrl</kbd>+scroll to zoom.
      <kbd>,</kbd> / <kbd>.</kbd> jump between notes; click a note to jump, or edit its text, time and tag.</p>
      <p>Search and tag filters narrow long lists. Made a mistake? <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes,
      <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redoes.</p>`
  },
  {
    id: 'export',
    title: 'Export and keep it safe',
    body: () => `
      <p><b>Export</b> to Markdown, subtitles (SRT/VTT), CSV, a shareable HTML report or JSON.</p>
      <p>Your notes live only in this browser, so now and then use <b>Saved Projects → Back Up All</b>
      to keep a copy you can restore anywhere.</p>`
  },
  {
    id: 'ready',
    title: "You're ready",
    body: (touch) => touch ? `
      <p>Open a file or paste a link to start your first project.</p>
      <p>Everything else lives in the <b>⋮ menu</b> — including this guide, under <b>Getting Started</b>.</p>` : `
      <p>Open a file or paste a link to start your first project. Press <kbd>?</kbd> anytime for all keyboard shortcuts.</p>
      <p>Everything else lives in the <b>⋮ menu</b> — including this guide, under <b>Getting Started</b>.</p>`
  }
];

const REOPEN_HINT = 'reopen it anytime from the ⋮ menu → Getting Started';

export class OnboardingGuide {
  /**
   * @param {{ storageKey: string, hasSavedProjects: () => Promise<boolean>, notify: (msg: string) => void }} options
   */
  constructor({ storageKey, hasSavedProjects, notify }) {
    this.storageKey = storageKey;
    this.hasSavedProjects = hasSavedProjects;
    this.notify = notify;
    this.index = 0;
    this.isActive = false;
    this.finished = false;

    this.modal = document.getElementById('onboarding-modal');
    if (!this.modal) return;
    this.stepEl = this.modal.querySelector('#onboarding-step');
    this.dotsEl = this.modal.querySelector('#onboarding-dots');
    this.backBtn = this.modal.querySelector('#onboarding-back');
    this.nextBtn = this.modal.querySelector('#onboarding-next');
    this.skipBtn = this.modal.querySelector('#onboarding-skip');
    this.touchQuery = window.matchMedia ? window.matchMedia('(pointer: coarse), (max-width: 1024px)') : null;

    this.backBtn.addEventListener('click', () => this.back());
    this.nextBtn.addEventListener('click', () => this.next());
    this.skipBtn.addEventListener('click', () => this.modal.close());
    this.dotsEl.addEventListener('click', (e) => {
      const dot = e.target.closest('[data-step]');
      if (dot) this.goTo(Number(dot.dataset.step));
    });
    // Every way of closing (✕, Esc, backdrop, Skip, finishing) ends up here
    this.modal.addEventListener('modal-close', () => this.onClosed());
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    if (this.touchQuery && typeof this.touchQuery.addEventListener === 'function') {
      this.touchQuery.addEventListener('change', () => this.isActive && this.render());
    }
  }

  get isTouch() {
    return Boolean(this.touchQuery && this.touchQuery.matches);
  }

  open(index = 0) {
    if (!this.modal) return;
    this.index = Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, index));
    this.isActive = true;
    this.finished = false;
    this.render();
    this.modal.open();
    // <modal-dialog> focuses its close button first; land on the primary action instead
    setTimeout(() => this.nextBtn.focus(), 80);
  }

  goTo(index) {
    if (index < 0 || index >= ONBOARDING_STEPS.length || index === this.index) return;
    this.index = index;
    this.render();
    this.nextBtn.focus();
  }

  next() {
    if (this.index >= ONBOARDING_STEPS.length - 1) {
      this.finished = true;
      this.modal.close();
      return;
    }
    this.goTo(this.index + 1);
  }

  back() {
    this.goTo(this.index - 1);
  }

  render() {
    const step = ONBOARDING_STEPS[this.index];
    const isLast = this.index === ONBOARDING_STEPS.length - 1;
    this.stepEl.innerHTML = `
      <div class="onboarding-illustration">${ILLUSTRATIONS[step.id] || ''}</div>
      <div class="onboarding-step-count">Step ${this.index + 1} of ${ONBOARDING_STEPS.length}</div>
      <h2 class="onboarding-title" id="onboarding-title">${step.title}</h2>
      <div class="onboarding-body">${step.body(this.isTouch)}</div>`;
    // Restart the entrance animation on each step
    this.stepEl.classList.remove('onboarding-step-enter');
    void this.stepEl.offsetWidth;
    this.stepEl.classList.add('onboarding-step-enter');

    this.dotsEl.innerHTML = ONBOARDING_STEPS.map((s, i) => `
      <button type="button" class="onboarding-dot${i === this.index ? ' active' : ''}" data-step="${i}"
        aria-label="Step ${i + 1}: ${s.title}"${i === this.index ? ' aria-current="step"' : ''}></button>`).join('');

    this.backBtn.style.visibility = this.index === 0 ? 'hidden' : 'visible';
    this.nextBtn.textContent = isLast ? 'Start annotating' : 'Next →';
    this.skipBtn.style.visibility = isLast ? 'hidden' : 'visible';
  }

  onKeyDown(e) {
    if (!this.isActive || !this.modal.isOpen) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.back();
    } else if (e.key === 'Enter' && !(document.activeElement && this.modal.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON')) {
      // Buttons handle Enter natively; elsewhere Enter advances
      e.preventDefault();
      this.next();
    }
  }

  onClosed() {
    if (!this.isActive) return;
    this.isActive = false;
    this.notify(this.finished
      ? `You're all set — ${REOPEN_HINT}`
      : `Guide closed — ${REOPEN_HINT}`);
  }

  readSeen() {
    try {
      return localStorage.getItem(this.storageKey) === 'true';
    } catch (e) {
      return false;
    }
  }

  markSeen() {
    try {
      localStorage.setItem(this.storageKey, 'true');
    } catch (e) { }
  }

  /**
   * Opens the guide on a genuine first visit (see shouldAutoShowOnboarding), after a short
   * delay so the app has painted first.
   */
  async maybeAutoShow({ launchedWithMedia = false, shouldDefer = () => false } = {}) {
    if (!this.modal) return;
    const seen = this.readSeen();
    if (seen) return;
    let hasSavedProjects = false;
    try {
      hasSavedProjects = await this.hasSavedProjects();
    } catch (e) { }
    const decision = shouldAutoShowOnboarding({ seen, hasSavedProjects, launchedWithMedia });
    if (!decision.show) {
      if (decision.markSeen) this.markSeen();
      return;
    }
    setTimeout(() => {
      // Don't interrupt: media that arrived meanwhile (e.g. OS "Open with"), or another open dialog.
      // The flag stays unset, so the guide appears on the next plain visit instead.
      if (shouldDefer() || document.querySelector('modal-dialog.open')) return;
      this.markSeen();
      this.open(0);
    }, 600);
  }
}
