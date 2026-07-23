const BATCH_SAMPLES = 2048;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.epoch = options.processorOptions.epoch;
    this.firstSampleIndex = 0;
    this.pending = new Float32Array(BATCH_SAMPLES);
    this.pendingLength = 0;
    this.discontinuity = false;
  }

  process(inputs) {
    const input = inputs[0];
    const mono = input && input[0];
    if (!mono) {
      this.discontinuity = true;
      return true;
    }
    let offset = 0;
    while (offset < mono.length) {
      const take = Math.min(BATCH_SAMPLES - this.pendingLength, mono.length - offset);
      this.pending.set(mono.subarray(offset, offset + take), this.pendingLength);
      this.pendingLength += take;
      offset += take;
      if (this.pendingLength === BATCH_SAMPLES) {
        const samples = this.pending.slice();
        this.port.postMessage({
          type: 'PCM_CAPTURE', epoch: this.epoch, firstSampleIndex: this.firstSampleIndex,
          sampleRate, channelCount: 1, encoding: 'Float32LE', discontinuity: this.discontinuity, samples,
        }, [samples.buffer]);
        this.firstSampleIndex += BATCH_SAMPLES;
        this.pendingLength = 0;
        this.discontinuity = false;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
