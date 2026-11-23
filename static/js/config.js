/**
 * Seeing Sound — shared constants and frequency-slider helpers.
 *
 * Script load order (see index.html): config → gl/* → core → render/* → ui/* → main.
 * All files are classic scripts sharing the global scope, so the page still
 * works when opened directly from disk (file://).
 */

// Constants for visualization
const MIN_THRESHOLD = 3e-3; // Minimum shader threshold — prevents near-silent pixels from showing palette color

// Spectrogram columns per second (wall clock ≡ audio time for live input). One column used to be written per
// animation frame; 60/s keeps the old on-screen speeds on 60 Hz displays while
// making them identical on 120 Hz (ProMotion) displays.
const COLUMN_RATE = 60;

// Persistence: seconds for a full-scale component to fade out completely.
// Every component loses level at the same rate (like the dB-linear decay of a
// reverberant sound), so quiet parts disappear first and loud parts linger.
// Measured against the recent peak level, not full scale.
// trailLength slider 0..1 → 0.5 s .. 8 s (log scale).
// Ageing reference (see writeColumn): peak tracker fall time, and a floor so
// that in silence the noise floor still fades within `persistence`.
const PEAK_RISE_SECONDS = 0.5;
const PEAK_RELEASE_SECONDS = 3.0;
const MIN_REF_LEVEL = 0.15;

function persistenceSeconds(trail) { return 0.5 * Math.pow(16, trail); }

// On-screen px per column in the 2D view (px/s = value × COLUMN_RATE).
// Same on-screen speeds as before, when the data area was 0.67 of the width.
const SCROLL_SPEEDS = {
    'slow': 2,
    'medium': 4,
    'fast': 8
};
// The 3D grid keeps its previous history length: canvas width / (1.5 × speed) columns
const SCROLL_3D_FACTOR = 1.5;

// ── Time layout: where "now" sits on the canvas ──────────────────────────
// `id` is passed to the shaders as u_layout. The centred layouts keep the
// eye on the middle of the canvas instead of an edge.
const TIME_LAYOUTS = {
    edge:   { id: 0, label: 'Edge',   hint: 'Classic: the newest data enters at one side edge and scrolls across the screen.' },
    mirror: { id: 1, label: 'Mirror', hint: 'Now is the vertical centre line; the same history flows out to both sides, symmetrically.' },
    head:   { id: 2, label: 'Centre', hint: 'Now is the vertical centre line; history flows to one side only (set by Direction), like a playhead.' },
    radial: { id: 3, label: 'Radial', hint: 'Now is a small ring at the centre and history expands outward like a ripple. Frequency (or pitch) becomes the angle: low at the bottom, high at the top, mirrored left and right.' },
};
// Radial layout geometry, as fractions of the canvas height / outer radius
const RADIAL_OUTER = 0.48;   // outer radius (oldest data) = 0.48 × canvas height
const RADIAL_INNER = 0.12;   // inner ring ("now") = 0.12 × outer radius

// ── Frequency axis scales (pipeline stage B) ─────────────────────────────
// Each scale is a monotonic warp f (Hz) → u and its inverse. The display axis
// is linear in u, so everything that maps frequency to screen position (the
// shaders, the Hz labels, the range slider) goes through these functions.
// `id` is the integer passed to the shaders as u_scale_mode; FREQ_GLSL in
// gl/glsl.js implements the same inverses.
//   mel  — O'Shaughnessy: 2595·log10(1 + f/700)
//   bark — Traunmüller (1990): 26.81·f/(1960 + f) − 0.53
//   erb  — ERB-rate, Glasberg & Moore (1990): 21.4·log10(1 + 0.00437·f)
const FREQ_SCALES = {
    linear: { id: 0, label: 'Linear', short: 'Lin',
              warp: f => f, unwarp: u => u,
              hint: 'Harmonics are evenly spaced: the k-th harmonic moves k times as far as f₀, so modulation is amplified toward the top.' },
    log:    { id: 1, label: 'Log', short: 'Log',
              warp: f => Math.log(f), unwarp: u => Math.exp(u),
              hint: 'Equal pitch steps are equal heights, so every harmonic moves by the same amount. Low frequencies have few FFT bins and look blocky.' },
    mel:    { id: 2, label: 'Mel', short: 'Mel',
              warp: f => 2595 * Math.log10(1 + f / 700), unwarp: m => 700 * (Math.pow(10, m / 2595) - 1),
              hint: 'Roughly linear below 1 kHz, logarithmic above: a perceptual pitch scale.' },
    bark:   { id: 3, label: 'Bark', short: 'Bark',
              warp: f => 26.81 * f / (1960 + f) - 0.53, unwarp: z => 1960 * (z + 0.53) / (26.28 - z),
              hint: 'Critical-band rate (about 24 bands up to 15 kHz). Similar in shape to Mel, coarser at the top.' },
    erb:    { id: 4, label: 'ERB', short: 'ERB',
              warp: f => 21.4 * Math.log10(1 + 0.00437 * f), unwarp: e => (Math.pow(10, e / 21.4) - 1) / 0.00437,
              hint: 'Auditory-filter (ERB-rate) spacing, between linear and log; the spacing a cochleagram’s channels will use.' },
};
function freqScale(name) { return FREQ_SCALES[name] || FREQ_SCALES.linear; }

/**
 * The frequency span actually drawn for [minHz, maxHz] on `scale`. A log axis
 * cannot reach 0 Hz, and below half an FFT bin there is only DC, so its bottom
 * is raised to binHz / 2 — the shaders, labels and pitch overlay all use this.
 */
function displayedRange(minHz, maxHz, scale, binHz) {
    let lo = Math.max(0, minHz), hi = Math.max(maxHz, lo + 1);
    if (scale === 'log') lo = Math.max(lo, (binHz || 1) / 2, 1);
    return { lo, hi };
}

/** Frequency at fraction t ∈ [0,1] up a display axis (0 = bottom). */
function freqAtAxisFraction(t, lo, hi, scale) {
    const S = freqScale(scale);
    const a = S.warp(lo), b = S.warp(hi);
    return S.unwarp(a + t * (b - a));
}

const PRESETS = {
  default: { scale: 'linear', ceiling: 4000,  minFreq: 0,  maxFreq: 4000  },
  music:   { scale: 'log',    ceiling: 22050, minFreq: 20, maxFreq: 20000 },
};

// Frequency slider helpers — slider internal range is always 0–SLIDER_STEPS (1000).
// The Hz ceiling lives in maxFreqInput; the slider follows the axis scale so a
// given slider travel covers the same share of the axis (log uses log1p so the
// slider can still reach 0 Hz).
const SLIDER_STEPS = 1000;

function _sliderWarp(scale) {
    if (scale === 'log') return { warp: Math.log1p, unwarp: Math.expm1 };
    return freqScale(scale);
}
function sliderToFreq(pos, ceiling, scale) {
    const S = _sliderWarp(scale);
    const a = S.warp(0), b = S.warp(ceiling);
    return Math.max(0, Math.round(S.unwarp(a + pos / SLIDER_STEPS * (b - a))));
}
function freqToSlider(freq, ceiling, scale) {
    if (freq <= 0 || ceiling <= 0) return 0;
    const S = _sliderWarp(scale);
    const a = S.warp(0), b = S.warp(ceiling);
    return Math.round((S.warp(Math.min(freq, ceiling)) - a) / (b - a) * SLIDER_STEPS);
}
function getCeiling() {
    return parseInt(document.getElementById('maxFreqInput').value) || 4000;
}
