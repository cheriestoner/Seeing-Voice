/**
 * Seeing Sound — our own short-time Fourier transform (pipeline stage A).
 *
 * Why not AnalyserNode's spectrum: it forces window length = FFT size = a
 * power of two (32…32768) and always uses a Blackman window. Here the two are
 * separate parameters:
 *   window length L  — any number of samples, set in ms. This alone sets the
 *                      time–frequency trade-off (short = pulses / formants,
 *                      long = resolved harmonics).
 *   FFT size N       — next power of two ≥ max(L, STFT_MIN_FFT). The extra
 *                      samples are zero padding: it interpolates the spectrum
 *                      (smoother rows for short windows) but adds no resolution.
 * The AnalyserNode is still used, but only as a tap for raw samples
 * (getFloatTimeDomainData), shared with the pitch tracker.
 *
 * Levels are calibrated to match AnalyserNode.getByteFrequencyData: a sine
 * shows the same dB peak for any window shape or length, so minDb / maxDb keep
 * their meaning. Smoothing is the same one-pole average on magnitudes.
 */

const STFT_MIN_FFT = 1024;     // floor on N: zero-pad short windows so rows are ≤ ~47 Hz apart
const STFT_MAX_FFT = 8192;     // = 2 × HISTORY_TEX_HEIGHT (rows available in the history texture)
const STFT_TAP_SIZE = 8192;    // analyser tap length (samples kept for STFT + pitch)
const WINDOW_MS_MIN = 3;
const WINDOW_MS_MAX = 100;
const WINDOW_MS_DEFAULT = 46;  // ≈ the old FFT 2048 at 44.1 kHz, so the default look is unchanged
const BLACKMAN_COHERENT_GAIN = 0.42;   // mean of the analyser's Blackman window (level reference)

// Window shapes, periodic form (as the Web Audio spec's Blackman), n = 0…L−1
const STFT_WINDOWS = {
    blackman: { label: 'Blackman', fn: (n, L) => { const a = 2 * Math.PI * n / L; return 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a); } },
    hann:     { label: 'Hann',     fn: (n, L) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / L) },
    // Gaussian, α = 2.5 (σ = L / 5): the window reassignment and Gabor analysis assume
    gauss:    { label: 'Gauss',    fn: (n, L) => { const x = (n - L / 2) / (L / 5); return Math.exp(-0.5 * x * x); } },
};

function _nextPow2(x) { let p = 1; while (p < x) p <<= 1; return p; }

/** Window length (samples) and FFT size for a window in ms — pure, used by UI and analyser alike. */
function stftPlan(sampleRate, windowMs) {
    const ms = Math.min(WINDOW_MS_MAX, Math.max(WINDOW_MS_MIN, windowMs || WINDOW_MS_DEFAULT));
    const L = Math.max(32, Math.min(STFT_MAX_FFT, Math.round(ms / 1000 * sampleRate)));
    const N = Math.min(STFT_MAX_FFT, _nextPow2(Math.max(L, STFT_MIN_FFT)));
    return { L, N, bins: N / 2, binHz: sampleRate / N };
}

/** Effective (noise-equivalent) bandwidth in Hz of a window shape at length L. */
function windowBandwidthHz(sampleRate, windowMs, type) {
    const { L } = stftPlan(sampleRate, windowMs);
    const f = (STFT_WINDOWS[type] || STFT_WINDOWS.blackman).fn;
    let s = 0, s2 = 0;
    for (let n = 0; n < L; n++) { const w = f(n, L); s += w; s2 += w * w; }
    return sampleRate * s2 / (s * s);
}

// slider position 0…1000 ↔ window ms (log: equal travel = equal ratio)
function windowMsFromSlider(pos) {
    return WINDOW_MS_MIN * Math.pow(WINDOW_MS_MAX / WINDOW_MS_MIN, pos / 1000);
}
function sliderFromWindowMs(ms) {
    return Math.round(1000 * Math.log(ms / WINDOW_MS_MIN) / Math.log(WINDOW_MS_MAX / WINDOW_MS_MIN));
}

class StftAnalyzer {
    constructor() { this.key = ''; }

    /** (Re)build tables when the plan changes. Returns true if anything changed. */
    configure(sampleRate, windowMs, windowType) {
        const type = STFT_WINDOWS[windowType] ? windowType : 'blackman';
        const { L, N } = stftPlan(sampleRate, windowMs);
        const key = `${sampleRate}|${L}|${N}|${type}`;
        if (key === this.key) return false;
        this.key = key;
        const keepMag = this.N === N ? this.mag : null;   // keep smoothing state across window-shape changes
        this.sampleRate = sampleRate; this.L = L; this.N = N; this.type = type;
        this.bins = N / 2;
        this.binHz = sampleRate / N;

        const f = STFT_WINDOWS[type].fn;
        this.win = new Float32Array(L);
        let sum = 0;
        for (let n = 0; n < L; n++) { this.win[n] = f(n, L); sum += this.win[n]; }
        // |X|·scale: same dB for a sine as the analyser's |X|/N with its Blackman window
        this.scale = BLACKMAN_COHERENT_GAIN / sum;

        if (this.re?.length !== N) {
            this.re = new Float64Array(N);
            this.im = new Float64Array(N);
            this.cos = new Float64Array(N / 2);
            this.sin = new Float64Array(N / 2);
            for (let k = 0; k < N / 2; k++) { this.cos[k] = Math.cos(2 * Math.PI * k / N); this.sin[k] = Math.sin(2 * Math.PI * k / N); }
            this.rev = new Uint32Array(N);
            const bitsN = Math.log2(N);
            for (let i = 0; i < N; i++) {
                let r = 0;
                for (let b = 0; b < bitsN; b++) r |= ((i >> b) & 1) << (bitsN - 1 - b);
                this.rev[i] = r;
            }
        }
        this.mag = keepMag || new Float32Array(this.bins);
        this.bytes = new Uint8Array(this.bins);
        return true;
    }

    /**
     * Analyse the newest L samples of `samples` (newest at the end).
     * smoothing: one-pole factor 0…1 (as AnalyserNode.smoothingTimeConstant).
     * Returns a Uint8Array of `bins` levels, 0 at minDb … 255 at maxDb.
     */
    process(samples, smoothing, minDb, maxDb) {
        const { L, N, re, im, win } = this;
        const off = samples.length - L;
        for (let n = 0; n < L; n++) { re[n] = samples[off + n] * win[n]; im[n] = 0; }
        for (let n = L; n < N; n++) { re[n] = 0; im[n] = 0; }
        this._fft();

        const mag = this.mag, out = this.bytes, scale = this.scale;
        const k1 = Math.min(Math.max(smoothing, 0), 1), k0 = 1 - k1;
        const range = maxDb > minDb ? 255 / (maxDb - minDb) : 0;
        for (let k = 0; k < this.bins; k++) {
            const r = re[k], i = im[k];
            const m = k1 * mag[k] + k0 * Math.sqrt(r * r + i * i) * scale;
            mag[k] = m;
            const db = 20 * Math.log10(m);                  // −Infinity for silence → 0
            const v = (db - minDb) * range;
            out[k] = v <= 0 ? 0 : v >= 255 ? 255 : v | 0;  // truncation, like the analyser
        }
        return out;
    }

    /** In-place iterative radix-2 complex FFT on this.re / this.im. */
    _fft() {
        const N = this.N, re = this.re, im = this.im, rev = this.rev, C = this.cos, S = this.sin;
        for (let i = 0; i < N; i++) {
            const j = rev[i];
            if (j > i) {
                let t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (let size = 2; size <= N; size <<= 1) {
            const half = size >> 1, step = N / size;
            for (let i = 0; i < N; i += size) {
                for (let j = 0, t = 0; j < half; j++, t += step) {
                    const wr = C[t], wi = -S[t];             // e^(−2πi·t/N)
                    const a = i + j, b = a + half;
                    const xr = wr * re[b] - wi * im[b];
                    const xi = wr * im[b] + wi * re[b];
                    re[b] = re[a] - xr; im[b] = im[a] - xi;
                    re[a] += xr; im[a] += xi;
                }
            }
        }
    }
}
