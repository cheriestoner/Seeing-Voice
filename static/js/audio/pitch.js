// Fundamental-frequency (f0) estimation with YIN
// (de Cheveigné & Kawahara, 2002, JASA 111(4)).
//
// detectPitchYIN(buf, sampleRate, fmin, fmax, threshold)
//   buf        Float32Array of time-domain samples (AnalyserNode.getFloatTimeDomainData)
//   returns    { f0, aperiodicity, rms } — f0 is null when unvoiced
//
// The analysis window is the analyser's fftSize; YIN needs about two periods
// of the lowest f0, so FFT 2048 at 48 kHz (43 ms) covers fmin ≈ 50 Hz, while
// FFT 1024 (21 ms) only reaches ≈ 95 Hz.

const PITCH_DEFAULTS = {
    threshold: 0.15,       // YIN absolute threshold on the normalised difference
    maxAperiodicity: 0.35, // above this the best dip is not considered periodic
    minRmsDb: -55,         // below this (dBFS) the frame is treated as silence
};

let _yinScratch = null;
let _yinDecim = null;

function detectPitchYIN(input, sampleRate, fmin, fmax, threshold = PITCH_DEFAULTS.threshold) {
    // Above ~30 kHz, halve the rate first (pairwise average = gentle low-pass):
    // voice f0 needs nothing near that bandwidth and it cuts the cost by ~4×.
    let buf = input;
    if (sampleRate > 30000) {
        const m = input.length >> 1;
        if (!_yinDecim || _yinDecim.length !== m) _yinDecim = new Float32Array(m);
        for (let i = 0; i < m; i++) _yinDecim[i] = 0.5 * (input[2 * i] + input[2 * i + 1]);
        buf = _yinDecim;
        sampleRate /= 2;
    }
    const n = buf.length;

    // Level gate
    let sumSq = 0;
    for (let i = 0; i < n; i++) sumSq += buf[i] * buf[i];
    const rms = Math.sqrt(sumSq / n);
    const rmsDb = 20 * Math.log10(rms + 1e-12);
    if (rmsDb < PITCH_DEFAULTS.minRmsDb) return { f0: null, aperiodicity: 1, rms };

    const tauMin = Math.max(2, Math.floor(sampleRate / fmax));
    const tauMax = Math.min(Math.floor(sampleRate / fmin), Math.floor(n / 2));
    if (tauMax <= tauMin + 2) return { f0: null, aperiodicity: 1, rms };
    const w = n - tauMax;                       // integration window

    if (!_yinScratch || _yinScratch.length < tauMax + 1) _yinScratch = new Float32Array(tauMax + 1);
    const d = _yinScratch;

    // Step 2: difference function d(τ)
    d[0] = 0;
    for (let tau = 1; tau <= tauMax; tau++) {          // j + tau ≤ w − 1 + tauMax = n − 1
        let s = 0;
        for (let j = 0; j < w; j++) {
            const diff = buf[j] - buf[j + tau];
            s += diff * diff;
        }
        d[tau] = s;
    }

    // Step 3: cumulative mean normalised difference d'(τ)
    let running = 0;
    d[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
        running += d[tau];
        d[tau] = running > 0 ? d[tau] * tau / running : 1;
    }

    // Step 4: first dip below the threshold (then walk down to its minimum);
    // otherwise the global minimum, if it is periodic enough
    let tauEst = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
        if (d[tau] < threshold) {
            while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
            tauEst = tau;
            break;
        }
    }
    if (tauEst < 0) {
        let best = tauMin;
        for (let tau = tauMin + 1; tau <= tauMax; tau++) if (d[tau] < d[best]) best = tau;
        if (d[best] > PITCH_DEFAULTS.maxAperiodicity) return { f0: null, aperiodicity: d[best], rms };
        tauEst = best;
    }

    // Step 5: parabolic interpolation around the dip
    let betterTau = tauEst;
    if (tauEst > 1 && tauEst < tauMax) {
        const s0 = d[tauEst - 1], s1 = d[tauEst], s2 = d[tauEst + 1];
        const denom = s0 + s2 - 2 * s1;
        if (denom !== 0) betterTau = tauEst + (s0 - s2) / (2 * denom);
    }
    const f0 = sampleRate / betterTau;
    if (f0 < fmin || f0 > fmax) return { f0: null, aperiodicity: d[tauEst], rms };
    return { f0, aperiodicity: d[tauEst], rms };
}
