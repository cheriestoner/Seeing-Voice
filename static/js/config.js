/**
 * Seeing Sound — shared constants and frequency-slider helpers.
 *
 * Script load order (see index.html): config → gl/* → core → render/* → ui/* → main.
 * All files are classic scripts sharing the global scope, so the page still
 * works when opened directly from disk (file://).
 */

// Constants for visualization
const MIN_THRESHOLD = 3e-3; // Minimum shader threshold — prevents near-silent pixels from showing palette color
const CURSOR_X = 0.67;      // Horizontal position of the newest-data cursor (0 = left, 1 = right)

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

// On-screen px per column (so px/s = value × COLUMN_RATE)
const SCROLL_SPEEDS = {
    'slow': 3,
    'medium': 6,
    'fast': 12
};

const PRESETS = {
  default: { scale: 'linear', ceiling: 4000,  minFreq: 0,  maxFreq: 4000  },
  music:   { scale: 'log',    ceiling: 22050, minFreq: 20, maxFreq: 20000 },
};

// Frequency slider helpers — slider internal range is always 0–SLIDER_STEPS (1000)
// Hz ceiling lives in maxFreqInput; scale comes from the Lin/Log switch
const SLIDER_STEPS = 1000;

function sliderToFreq(pos, ceiling, scale) {
    if (scale === 'log')
        return Math.round(Math.expm1(pos / SLIDER_STEPS * Math.log1p(ceiling)));
    return Math.round(pos / SLIDER_STEPS * ceiling);
}
function freqToSlider(freq, ceiling, scale) {
    if (freq <= 0 || ceiling <= 0) return 0;
    if (scale === 'log')
        return Math.round(Math.log1p(Math.min(freq, ceiling)) / Math.log1p(ceiling) * SLIDER_STEPS);
    return Math.round(Math.min(freq, ceiling) / ceiling * SLIDER_STEPS);
}
function getCeiling() {
    return parseInt(document.getElementById('maxFreqInput').value) || 4000;
}
