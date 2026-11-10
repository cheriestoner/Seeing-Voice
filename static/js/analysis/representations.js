// Spectral pipeline, stage A (representation) and the glue to stage B (axis).
//
// The Spectral mapping is built as four stages, each with one home:
//   A  representation — how energy is computed, one column per hop
//                       (this file: REPRESENTATIONS + readRepresentation())
//   B  axis mapping   — where a frequency sits on screen
//                       (FREQ_SCALES / displayedRange() in config.js,
//                        FREQ_GLSL in gl/glsl.js; spectralAxis() below)
//   C  level mapping  — dB range, noise threshold, smoothing, colormap
//                       (analyser dB range today; COLORMAP_GLSL in gl/glsl.js)
//   D  rendering      — history texture → 2D quad or 3D mesh
//                       (render/spectrogram2d.js, render/spectrogram3d.js)
//
// A representation writes a column of byte levels whose row i sits at
// i · binHz Hz, so stages B–D do not care how the column was made. Methods
// with their own frequency spacing (CQT, cochleagram) declare it as
// `nativeScale`; the axis is then fixed to that scale. Methods without a
// frequency axis (correlogram, cepstrogram) declare `axis: 'lag'`.

const REPRESENTATIONS = {
    stft:       { label: 'STFT',          tag: 'Hz',             axis: 'freq', nativeScale: null,  implemented: true,
                  hint: 'Short-time Fourier transform: the standard spectrogram. Window length sets what it can resolve — pulses or harmonics.' },
    reassigned: { label: 'Reassigned',    tag: 'Hz · sharpened', axis: 'freq', nativeScale: null,  implemented: false,
                  hint: 'Each bin’s energy moved to its centre of gravity, so harmonics become thin lines. Planned.' },
    cqt:        { label: 'CQT / Wavelet', tag: 'log Hz',         axis: 'freq', nativeScale: 'log', implemented: false,
                  hint: 'Constant-Q: long windows for low frequencies, short for high. Planned.' },
    cochlea:    { label: 'Cochleagram',   tag: 'ERB · gammatone', axis: 'freq', nativeScale: 'erb', implemented: false,
                  hint: 'Gammatone filterbank in an AudioWorklet. Planned.' },
    correlo:    { label: 'Correlogram',   tag: 'lag · researcher', axis: 'lag', nativeScale: null, implemented: false,
                  hint: 'Autocorrelation per cochlear channel: periodicity rather than frequency. Planned.' },
    cepstro:    { label: 'Cepstrogram',   tag: 'quefrency · researcher', axis: 'lag', nativeScale: null, implemented: false,
                  hint: 'Spectrum of the log spectrum: f₀ as one line at 1/f₀. Planned.' },
};

class RepresentationMethods {
    /** Current representation entry (falls back to STFT for unknown / unimplemented ids). */
    representation() {
        const r = REPRESENTATIONS[this.settings.analysis];
        return r && r.implemented ? r : REPRESENTATIONS.stft;
    }

    /** FFT bin width in Hz (row spacing of the history texture). */
    binHz() {
        return stftPlan(this.settings.sampleRate, this.settings.windowMs).binHz;
    }

    /**
     * Stage A: compute this frame's column.
     * Returns { data: Uint8Array (row i = i · binHz Hz), bins, binHz }.
     */
    readRepresentation() {
        switch (this.settings.analysis) {
            case 'stft':
            default:
                return this._readStft();
        }
    }

    _readStft() {
        // Smoothing is applied once per read, i.e. per animation frame. Derive
        // it from the real time since the last read so the smoothing time
        // constant is the same at any refresh rate.
        const now = performance.now() / 1000;
        const dt = this._lastRead == null ? 1 / 60 : Math.min(now - this._lastRead, 0.25);
        this._lastRead = now;
        const tauS = this.settings.smoothingMs / 1000;
        const smoothing = tauS > 0 ? Math.exp(-dt / tauS) : 0;
        const s = this.settings, st = this._stft;
        st.configure(s.sampleRate, s.windowMs, s.windowType);   // no-op unless the plan changed
        this.frequencyData = st.process(this._tap, smoothing, s.minDb, s.maxDb);
        return { data: this.frequencyData, bins: st.bins, binHz: st.binHz };
    }

    /**
     * Stage B for the Spectral mapping: scale (the representation's native one
     * if it has one) and the frequency span actually drawn.
     */
    spectralAxis() {
        const scale = this.representation().nativeScale || this.settings.scale;
        const { lo, hi } = displayedRange(this.settings.minFreq, this.settings.maxFreq, scale, this.binHz());
        return { scale, lo, hi };
    }
}

mixin(SeeingSound, RepresentationMethods);
