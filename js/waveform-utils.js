/* ==========================================================================
   Waveform & Audio Demuxing Utilities
   Shared between Main Thread and Web Worker
   ========================================================================== */

/**
 * Fast, adaptive downsampled peak extraction from raw Float32 audio samples.
 * Optimized for long audio/video files (1-3+ hours) to compute visual peaks
 * in milliseconds without blocking the main browser thread.
 *
 * @param {Float32Array} channelData - Audio PCM samples (channel 0)
 * @param {number} sampleCount - Target number of waveform points (default 1600)
 * @returns {Float32Array} Normalized peaks array (0.0 to 1.0)
 */
export function calculateWaveformPeaks(channelData, sampleCount = 1600) {
  const len = channelData ? channelData.length : 0;
  if (!len) return new Float32Array(sampleCount);

  const peaks = new Float32Array(sampleCount);
  const blockSize = len / sampleCount;

  // Adaptive sampling stride:
  // For long files (e.g. 100M+ samples, blockSize > 50,000), sampling every
  // sample is redundant and computationally expensive for a 1-pixel display bar.
  // Evaluating up to 128 distributed samples per block captures transients,
  // speech clarity, and dynamic range accurately in a fraction of a millisecond.
  const maxSamplesPerBlock = 128;
  const stride = blockSize > maxSamplesPerBlock
    ? Math.max(1, Math.floor(blockSize / maxSamplesPerBlock))
    : 1;

  let globalMax = 0;

  for (let i = 0; i < sampleCount; i++) {
    const start = Math.floor(i * blockSize);
    const end = Math.min(len, Math.floor((i + 1) * blockSize));
    let peak = 0;
    let sum = 0;
    let count = 0;

    for (let j = start; j < end; j += stride) {
      const val = Math.abs(channelData[j]);
      if (val > peak) peak = val;
      sum += val;
      count++;
    }

    // Blend: 70% peak amplitude + 30% RMS/mean amplitude
    // This highlights acoustic transients and percussive hits while
    // maintaining natural fullness during dialogue or steady tones.
    const avg = count > 0 ? (sum / count) : 0;
    const combined = (peak * 0.7) + (avg * 0.3);
    peaks[i] = combined;

    if (combined > globalMax) {
      globalMax = combined;
    }
  }

  // Normalize peaks so the waveform utilizes the full visual track height
  if (globalMax > 0.0001) {
    const invMax = 1 / globalMax;
    for (let i = 0; i < sampleCount; i++) {
      peaks[i] = Math.min(1, peaks[i] * invMax);
    }
  }

  return peaks;
}

/**
 * Demuxes audio streams from WebM and Matroska (.mkv) video files into a pure audio/webm
 * container that AudioContext.decodeAudioData can decode without video overhead or failure.
 *
 * @param {ArrayBuffer} arrayBuffer - Raw WebM / MKV file bytes
 * @returns {ArrayBuffer|{noAudioTrack: boolean}|null} Demuxed audio/webm ArrayBuffer or status object
 */
export function extractAudioFromWebM(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const len = data.length;

  function readVint(offset, raw = false) {
    if (offset >= len) return null;
    const first = data[offset];
    if (first === 0) return null;
    let mask = 0x80;
    let width = 1;
    while ((first & mask) === 0 && width <= 8) {
      mask >>= 1;
      width++;
    }
    if (offset + width > len) return null;
    let val = raw ? 0 : (first & (mask - 1));
    for (let i = (raw ? 0 : 1); i < width; i++) {
      val = (val * 256) + data[offset + i];
    }
    return { val, width };
  }

  function isUnknownSize(width, val) {
    if (width >= 1 && width <= 8) {
      return val === (Math.pow(2, 7 * width) - 1);
    }
    return false;
  }

  function readElement(offset) {
    if (offset >= len) return null;
    const idInfo = readVint(offset, true);
    if (!idInfo) return null;
    const sizeOffset = offset + idInfo.width;
    const sizeInfo = readVint(sizeOffset, false);
    if (!sizeInfo) return null;
    const dataOffset = sizeOffset + sizeInfo.width;
    const unknown = isUnknownSize(sizeInfo.width, sizeInfo.val);
    const size = unknown ? (len - dataOffset) : sizeInfo.val;
    return {
      id: idInfo.val,
      idWidth: idInfo.width,
      sizeWidth: sizeInfo.width,
      headerSize: idInfo.width + sizeInfo.width,
      size,
      unknownSize: unknown,
      dataOffset,
      end: dataOffset + size
    };
  }

  function encodeVint(val, fixedWidth = 0) {
    let width = 1;
    if (fixedWidth > 0) {
      width = fixedWidth;
    } else {
      while (val >= (1 << (7 * width)) - 1 && width < 8) {
        width++;
      }
    }
    const bytes = new Uint8Array(width);
    let v = val;
    for (let i = width - 1; i >= 0; i--) {
      bytes[i] = v & 0xff;
      v = Math.floor(v / 256);
    }
    bytes[0] |= (1 << (8 - width));
    return bytes;
  }

  // 1. Verify EBML Header (0x1A45DFA3)
  const ebmlHeader = readElement(0);
  if (!ebmlHeader || ebmlHeader.id !== 0x1A45DFA3) return null;

  // 2. Segment (0x18538067)
  const segment = readElement(ebmlHeader.end);
  if (!segment || segment.id !== 0x18538067) return null;

  let pos = segment.dataOffset;
  const segEnd = segment.end <= len ? segment.end : len;

  let segmentInfoBuf = null;
  let audioTrackNumber = null;
  let audioTrackEntryBuf = null;
  const audioClusters = [];

  while (pos < segEnd) {
    const el = readElement(pos);
    if (!el || el.end > len || el.headerSize === 0) break;

    if (el.id === 0x1549A966) { // Segment Info
      segmentInfoBuf = data.slice(pos, el.end);
    } else if (el.id === 0x1654AE6B) { // Tracks
      let trackPos = el.dataOffset;
      while (trackPos < el.end) {
        const tEntry = readElement(trackPos);
        if (!tEntry || tEntry.headerSize === 0) break;
        if (tEntry.id === 0xAE) { // TrackEntry
          let childPos = tEntry.dataOffset;
          let trackNum = null;
          let trackType = null;
          while (childPos < tEntry.end) {
            const child = readElement(childPos);
            if (!child || child.headerSize === 0) break;
            if (child.id === 0xD7) { // TrackNumber
              let n = 0;
              for (let i = 0; i < child.size; i++) n = (n * 256) + data[child.dataOffset + i];
              trackNum = n;
            } else if (child.id === 0x83) { // TrackType
              let t = 0;
              for (let i = 0; i < child.size; i++) t = (t * 256) + data[child.dataOffset + i];
              trackType = t; // 1 = Video, 2 = Audio
            }
            childPos = child.end;
          }
          if (trackType === 2 && audioTrackNumber === null) {
            audioTrackNumber = trackNum;
            audioTrackEntryBuf = data.slice(trackPos, tEntry.end);
          }
        }
        trackPos = tEntry.end;
      }
    } else if (el.id === 0x1F43B675) { // Cluster
      if (audioTrackNumber !== null) {
        let clusterChild = el.dataOffset;
        let timecodeBuf = null;
        const clusterAudioBlocks = [];
        while (clusterChild < el.end) {
          const blockEl = readElement(clusterChild);
          if (!blockEl || blockEl.headerSize === 0) break;
          if (blockEl.id === 0xE7) { // Timestamp/Timecode
            timecodeBuf = data.slice(clusterChild, blockEl.end);
          } else if (blockEl.id === 0xA3 || blockEl.id === 0xA1) { // SimpleBlock or Block
            const blockTrack = readVint(blockEl.dataOffset, false);
            if (blockTrack && blockTrack.val === audioTrackNumber) {
              clusterAudioBlocks.push(data.slice(clusterChild, blockEl.end));
            }
          }
          clusterChild = blockEl.end;
        }
        if (clusterAudioBlocks.length > 0) {
          let totalClusterPayload = (timecodeBuf ? timecodeBuf.length : 0);
          for (const b of clusterAudioBlocks) totalClusterPayload += b.length;
          const clusterIdBytes = new Uint8Array([0x1F, 0x43, 0xB6, 0x75]);
          const clusterSizeBytes = encodeVint(totalClusterPayload, 4);
          const clusterTotalLen = clusterIdBytes.length + clusterSizeBytes.length + totalClusterPayload;
          const newCluster = new Uint8Array(clusterTotalLen);
          let off = 0;
          newCluster.set(clusterIdBytes, off); off += clusterIdBytes.length;
          newCluster.set(clusterSizeBytes, off); off += clusterSizeBytes.length;
          if (timecodeBuf) {
            newCluster.set(timecodeBuf, off); off += timecodeBuf.length;
          }
          for (const b of clusterAudioBlocks) {
            newCluster.set(b, off); off += b.length;
          }
          audioClusters.push(newCluster);
        }
      }
    }
    pos = el.end;
  }

  if (audioTrackNumber === null || !audioTrackEntryBuf) {
    return { noAudioTrack: true };
  }

  // Assemble new Tracks element containing only the audio TrackEntry
  const tracksIdBytes = new Uint8Array([0x16, 0x54, 0xAE, 0x6B]);
  const tracksSizeBytes = encodeVint(audioTrackEntryBuf.length, 4);
  const newTracks = new Uint8Array(tracksIdBytes.length + tracksSizeBytes.length + audioTrackEntryBuf.length);
  let off = 0;
  newTracks.set(tracksIdBytes, off); off += tracksIdBytes.length;
  newTracks.set(tracksSizeBytes, off); off += tracksSizeBytes.length;
  newTracks.set(audioTrackEntryBuf, off);

  // Calculate segment size
  let segmentPayloadSize = (segmentInfoBuf ? segmentInfoBuf.length : 0) + newTracks.length;
  for (const c of audioClusters) segmentPayloadSize += c.length;

  const segmentIdBytes = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  const segmentSizeBytes = encodeVint(segmentPayloadSize, 8);

  const ebmlHeaderBuf = data.slice(0, ebmlHeader.end);
  const totalFileSize = ebmlHeaderBuf.length + segmentIdBytes.length + segmentSizeBytes.length + segmentPayloadSize;

  const finalBuffer = new Uint8Array(totalFileSize);
  let finalOffset = 0;
  finalBuffer.set(ebmlHeaderBuf, finalOffset); finalOffset += ebmlHeaderBuf.length;
  finalBuffer.set(segmentIdBytes, finalOffset); finalOffset += segmentIdBytes.length;
  finalBuffer.set(segmentSizeBytes, finalOffset); finalOffset += segmentSizeBytes.length;
  if (segmentInfoBuf) {
    finalBuffer.set(segmentInfoBuf, finalOffset); finalOffset += segmentInfoBuf.length;
  }
  finalBuffer.set(newTracks, finalOffset); finalOffset += newTracks.length;
  for (const c of audioClusters) {
    finalBuffer.set(c, finalOffset); finalOffset += c.length;
  }

  return finalBuffer.buffer;
}
