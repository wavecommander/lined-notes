/* ==========================================================================
   Export Suite
   Generates JSON, Markdown, SubRip, WebVTT, CSV & HTML Standalone Reports
   ========================================================================== */

import { state } from './state.js';
import { formatTime, formatSRTTime, formatVTTTime, calculateSubtitleCueEnd, escapeHtml, copyText, showToast } from './utils.js';

export class ExportManager {
  constructor() {
    this.exportModal = document.getElementById('export-modal');
    this.shareBtn = document.getElementById('share-export-btn');

    this.init();
  }

  init() {
    state.on('requestexport', () => this.openExportModal());
  }

  openExportModal() {
    if (state.notes.length === 0) {
      showToast('No notes to export');
      return;
    }
    if (this.shareBtn) {
      this.shareBtn.style.display = (typeof navigator.share === 'function') ? 'inline-flex' : 'none';
    }
    if (this.exportModal) {
      if (typeof this.exportModal.open === 'function') this.exportModal.open();
      else this.exportModal.classList.add('open');
    }
  }

  closeExportModal() {
    if (this.exportModal) {
      if (typeof this.exportModal.close === 'function') this.exportModal.close();
      else this.exportModal.classList.remove('open');
    }
  }

  selectExportFmt(el) {
    document.querySelectorAll('.export-fmt-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    state.selectedExportFmt = el.dataset.fmt;
  }

  generateExportContent() {
    const fileName = state.mediaTitle || (state.mediaFile ? state.mediaFile.name : (state.detachedSessionName || 'Annotations'));
    const baseName = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    let content = '', ext = state.selectedExportFmt, mime = 'text/plain';

    switch (state.selectedExportFmt) {
      case 'json':
        content = JSON.stringify({
          app: 'Lined Notes',
          version: '1.2.0',
          fileName: fileName,
          sourceType: state.mediaSourceType || (state.mediaFile ? 'file' : 'detached'),
          url: state.externalUrl || null,
          youtubeVideoId: state.youtubeVideoId || null,
          duration: state.duration,
          exportedAt: new Date().toISOString(),
          tags: state.tags,
          notes: state.notes
        }, null, 2);
        mime = 'application/json';
        ext = 'json';
        break;

      case 'md':
        content = `# Annotations: ${fileName}\n\n`;
        content += `> Exported from **Lined Notes** on ${new Date().toLocaleString()}  \n`;
        if (state.externalUrl) {
          content += `> Media Source: <${state.externalUrl}>  \n`;
        }
        content += `> Duration: ${formatTime(state.duration)} | Total Annotations: ${state.notes.length}\n\n`;
        content += `---\n\n`;
        state.notes.forEach(n => {
          const tagObj = state.tags.find(t => t.id === n.tag) || state.tags[0];
          const rangeStr = n.end ? ` - \`${formatTime(n.end)}\`` : '';
          content += `### \`${formatTime(n.start)}\`${rangeStr} [${tagObj.label}]\n\n`;
          content += `${n.text}\n\n`;
        });
        mime = 'text/markdown';
        ext = 'md';
        break;

      case 'srt':
        state.notes.forEach((n, idx) => {
          const cueStart = formatSRTTime(n.start);
          const endTime = calculateSubtitleCueEnd(n, state.notes[idx + 1]);
          const cueEnd = formatSRTTime(endTime);
          content += `${idx + 1}\n${cueStart} --> ${cueEnd}\n${n.text}\n\n`;
        });
        mime = 'text/srt';
        ext = 'srt';
        break;

      case 'vtt':
        content = 'WEBVTT\n\n';
        state.notes.forEach((n, idx) => {
          const cueStart = formatVTTTime(n.start);
          const endTime = calculateSubtitleCueEnd(n, state.notes[idx + 1]);
          const cueEnd = formatVTTTime(endTime);
          content += `${idx + 1}\n${cueStart} --> ${cueEnd}\n${n.text}\n\n`;
        });
        mime = 'text/vtt';
        ext = 'vtt';
        break;

      case 'csv':
        content = 'Start Time,Start Seconds,End Time,End Seconds,Tag,Note\n';
        state.notes.forEach(n => {
          const tagObj = state.tags.find(t => t.id === n.tag) || state.tags[0];
          const endStr = n.end ? formatTime(n.end) : '';
          const endSec = n.end ? n.end.toFixed(3) : '';
          const escapedText = n.text.replace(/"/g, '""');
          content += `"${formatTime(n.start)}",${n.start.toFixed(3)},"${endStr}","${endSec}","${tagObj.label}","${escapedText}"\n`;
        });
        mime = 'text/csv';
        ext = 'csv';
        break;

      case 'html':
        content = this.generateHtmlReport(fileName);
        mime = 'text/html';
        ext = 'html';
        break;
    }

    return { content, ext, mime, baseName };
  }

  generateHtmlReport(fileName) {
    let rows = '';
    state.notes.forEach(n => {
      const tagObj = state.tags.find(t => t.id === n.tag) || state.tags[0];
      const rangeStr = n.end ? ` → ${formatTime(n.end)}` : '';
      const timeDisplay = `${formatTime(n.start)}${rangeStr}`;
      const timeCell = (state.mediaSourceType === 'youtube' && state.youtubeVideoId)
        ? `<a href="https://www.youtube.com/watch?v=${state.youtubeVideoId}&t=${Math.floor(n.start)}s" target="_blank" style="color:#d97742;text-decoration:none;" title="Open on YouTube">${timeDisplay} ↗</a>`
        : timeDisplay;

      rows += `
        <tr>
          <td style="font-family:monospace;white-space:nowrap;">${timeCell}</td>
          <td><span style="background:${tagObj.color};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;">${escapeHtml(tagObj.label)}</span></td>
          <td style="white-space:pre-wrap;">${escapeHtml(n.text)}</td>
        </tr>`;
    });

    const sourceMeta = state.externalUrl
      ? `<div style="margin-bottom:8px;">Source: <a href="${escapeHtml(state.externalUrl)}" target="_blank" style="color:#d97742;">${escapeHtml(state.externalUrl)}</a></div>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Annotations — ${escapeHtml(fileName)}</title>
<style>
  body { background:#141210; color:#f5f2eb; font-family:system-ui,-apple-system,sans-serif; padding:40px; margin:0; }
  .card { max-width:900px; margin:0 auto; background:#1b1815; border:1px solid #38312b; border-radius:12px; padding:32px; box-shadow:0 12px 36px rgba(0,0,0,0.5); }
  h1 { margin:0 0 8px; font-size:22px; color:#f5f2eb; }
  .meta { color:#a89f91; font-size:13px; margin-bottom:24px; font-family:monospace; }
  table { width:100%; border-collapse:collapse; margin-top:16px; }
  th { text-align:left; padding:10px; border-bottom:2px solid #38312b; color:#a89f91; font-size:12px; text-transform:uppercase; }
  td { padding:12px 10px; border-bottom:1px solid #2b2520; font-size:13px; vertical-align:top; }
  tr:hover { background:#231f1b; }
</style>
</head>
<body>
<div class="card">
  <h1>${escapeHtml(fileName)}</h1>
  <div class="meta">
    ${sourceMeta}
    Exported from Lined Notes · ${new Date().toLocaleString()} · ${state.notes.length} Annotations
  </div>
  <table>
    <thead><tr><th>Timestamp</th><th>Tag</th><th>Note</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
</body>
</html>`;
  }

  doExportDownload() {
    const { content, ext, mime, baseName } = this.generateExportContent();
    const isAndroid = /Android/i.test(navigator.userAgent);
    let exportMime = mime;
    if (isAndroid) {
      exportMime = (ext === 'html' || ext === 'json' || ext === 'csv') ? mime : 'application/octet-stream';
    }

    const blob = new Blob([content], { type: exportMime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `${baseName}_annotations.${ext}`;

    document.body.appendChild(a);
    try {
      a.click();
    } catch (err) {
      window.open(url, '_blank');
    }

    setTimeout(() => {
      try {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) { }
    }, 4000);

    this.closeExportModal();
    showToast(`Exported as .${ext}`);
  }

  copyExportToClipboard() {
    const { content, ext } = this.generateExportContent();
    copyText(content, `Copied ${ext.toUpperCase()} to clipboard`);
    this.closeExportModal();
  }

  async shareExport() {
    if (state.notes.length === 0) {
      showToast('No notes to share');
      return;
    }
    const { content, ext, baseName } = this.generateExportContent();
    const fileName = `${baseName}_annotations.${ext}`;
    const title = `Lined Notes — ${baseName}`;

    if (navigator.share) {
      try {
        const file = new File([content], fileName, { type: 'text/plain;charset=utf-8' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: title,
            text: `Annotations for ${baseName}`,
            files: [file]
          });
          this.closeExportModal();
          showToast('Shared successfully!');
          return;
        } else {
          await navigator.share({
            title: title,
            text: content
          });
          this.closeExportModal();
          showToast('Shared successfully!');
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('Native share error, falling back:', err);
      }
    }
    this.copyExportToClipboard();
  }
}
