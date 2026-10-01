/* ==========================================================================
   Waveform Web Worker
   Off-thread audio demuxing, peak analysis & waveform calculation
   ========================================================================== */

import {
  calculateWaveformPeaks,
  extractAudioFromWebM,
  generateSyntheticWaveform
} from './waveform-utils.js';

// Worker message dispatcher
self.onmessage = function (e) {
  const { type, taskId } = e.data;

  try {
    if (type === 'CALCULATE_PEAKS') {
      const { buffer, samples } = e.data;
      const channelData = new Float32Array(buffer);
      const peaks = calculateWaveformPeaks(channelData, samples || 1600);

      // Transfer the computed peaks buffer back to the main thread with zero copy
      self.postMessage({
        type: 'PEAKS_COMPLETED',
        taskId,
        peaksBuffer: peaks.buffer
      }, [peaks.buffer]);
    } else if (type === 'DEMUX_WEBM') {
      const { arrayBuffer } = e.data;
      const result = extractAudioFromWebM(arrayBuffer);

      if (!result) {
        self.postMessage({ type: 'DEMUX_FAILED', taskId });
      } else if (result.noAudioTrack) {
        self.postMessage({ type: 'DEMUX_COMPLETED', taskId, noAudioTrack: true });
      } else {
        self.postMessage({
          type: 'DEMUX_COMPLETED',
          taskId,
          audioBuffer: result
        }, [result]);
      }
    } else if (type === 'GENERATE_SYNTHETIC') {
      const { fileName, fileSize, duration, samples } = e.data;
      const peaks = generateSyntheticWaveform(fileName, fileSize, duration, samples || 1600);

      self.postMessage({
        type: 'SYNTHETIC_COMPLETED',
        taskId,
        peaksBuffer: peaks.buffer
      }, [peaks.buffer]);
    }
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      taskId,
      error: err && err.message ? err.message : String(err)
    });
  }
};
