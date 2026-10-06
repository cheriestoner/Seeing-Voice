// Pitch contour × k: f0 track whose deviation from a reference is scaled by k.
//
//   shown = ref · (f0 / ref)^k        (in log-frequency: ref + k·(f0 − ref))
//
// Working in log-frequency means k scales deviations in cents, so a vibrato
// of ±50 cents becomes ±50·k cents at any register. k = 1 is the raw contour.
//
// The reference is either a moving average of log-f0 (removes the slow trend,
// so mainly modulation is exaggerated) or the mean of the current utterance
// (the whole intonation contour is exaggerated around it).
//
// The contour is drawn with Canvas 2D on #overlayCanvas, on the same time
// axis as the 2D spectrogram, optionally over a dimmed spectrogram of the
// same pitch range.

const PITCH_GAP_RESET_S = 0.25;   // an unvoiced gap longer than this starts a new utterance

class PitchMethods {
    /** (Re)allocate per-column pitch history; called on Start. */
    resetPitchHistory() {
        const n = this.texWidth;
        this._pitch = {
            lf: new Float32Array(n).fill(NaN),    // log2 f0 per column (NaN = unvoiced)
            ref: new Float32Array(n).fill(NaN),   // log2 reference per column
            frameLf: NaN,                          // this frame's estimate
            recent: [],                            // last raw voiced estimates (median of 3)
            refState: NaN,
            utterSum: 0, utterN: 0,
            lastVoicedCol: -1e9,
        };
        this.floatTime = null;
    }

    /** Estimate f0 once per animation frame (only while the pitch mapping is shown). */
    trackPitchFrame() {
        if (!this._pitch) this.resetPitchHistory();
        const a = this.analyser;
        if (!this.floatTime || this.floatTime.length !== a.fftSize) this.floatTime = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(this.floatTime);
        const s = this.settings;
        const r = detectPitchYIN(this.floatTime, this.audioContext.sampleRate, s.pitchMin * 0.8, s.pitchMax * 1.25,
                                 s.pitchThreshold, s.pitchVoicingDb);
        const P = this._pitch;
        if (r.f0 == null) {
            P.frameLf = NaN;
            P.recent.length = 0;
            return;
        }
        const lf = Math.log2(r.f0);
        // median of the last 3 voiced estimates suppresses isolated octave errors
        P.recent.push(lf);
        if (P.recent.length > 3) P.recent.shift();
        P.frameLf = P.recent.length < 3 ? lf : P.recent.slice().sort((x, y) => x - y)[1];
    }

    /** Store this frame's estimate (and the running reference) in column `colAbs`. */
    writePitchColumn(colAbs) {
        const P = this._pitch;
        if (!P) return;
        const i = colAbs % this.texWidth;
        const s = this.settings;
        const lf = P.frameLf;
        const hop = 1 / COLUMN_RATE;
        if (!Number.isFinite(lf)) {
            P.lf[i] = NaN;
            P.ref[i] = P.refState;
            return;
        }
        const newUtterance = (colAbs - P.lastVoicedCol) * hop > PITCH_GAP_RESET_S || !Number.isFinite(P.refState);
        P.lastVoicedCol = colAbs;
        if (s.pitchRef === 'utterance') {
            if (newUtterance) { P.utterSum = 0; P.utterN = 0; }
            P.utterSum += lf; P.utterN += 1;
            P.refState = P.utterSum / P.utterN;
        } else {
            if (newUtterance) P.refState = lf;
            else P.refState += (1 - Math.exp(-hop / (s.pitchRefMs / 1000))) * (lf - P.refState);
        }
        P.lf[i] = lf;
        P.ref[i] = P.refState;
    }

    /** Size the overlay canvas with the WebGL canvas (called from setupHighDpiCanvas). */
    sizeOverlay() {
        const c = document.getElementById('overlayCanvas');
        if (!c) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        c.width = Math.round(rect.width * dpr);
        c.height = Math.round(rect.height * dpr);
        c.style.width = `${rect.width}px`;
        c.style.height = `${rect.height}px`;
        this._overlayCtx = c.getContext('2d');
        this._overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    clearOverlay() {
        const c = document.getElementById('overlayCanvas');
        if (c && this._overlayCtx) this._overlayCtx.clearRect(0, 0, c.width, c.height);
    }

    /** Pitch axis (Hz) used by the overlay, the dimmed spectrogram and the labels. */
    pitchAxis() {
        return { min: this.settings.pitchMin, max: this.settings.pitchMax, scale: 'log' };
    }

    drawPitchOverlay(sh) {
        const ctx = this._overlayCtx;
        const P = this._pitch;
        if (!ctx || !P) return;
        const s = this.settings;
        const W = this.canvas.width / (window.devicePixelRatio || 1);
        const H = this.canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, W, H);

        const flip = s.scrollDirection === 'right';
        // data area in screen px; newest at `x0`, older toward `dir`
        const loPx = (flip ? 1 - sh.dataHi : sh.dataLo) * W;
        const hiPx = (flip ? 1 - sh.dataLo : sh.dataHi) * W;
        const x0 = flip ? loPx : hiPx;
        const dir = flip ? 1 : -1;
        const pxPerCol = SCROLL_SPEEDS[s.scrollSpeed];
        const ground = s.backgroundStyle === 'white' ? [255, 255, 255] : [7, 7, 15];

        // dim the spectrogram underneath so the contour reads first
        if (s.pitchUnderlay && s.backgroundStyle !== 'transparent') {
            ctx.fillStyle = `rgba(${ground[0]},${ground[1]},${ground[2]},0.45)`;
            ctx.fillRect(loPx, 0, hiPx - loPx, H);
        }

        const lmin = Math.log2(s.pitchMin), lmax = Math.log2(s.pitchMax);
        const yOf = (l) => H * (1 - (l - lmin) / (lmax - lmin));
        const k = s.pitchK;
        const persist = sh.persistence;
        const nVis = Math.ceil((hiPx - loPx) / pxPerCol) + 2;
        const newest = this._writeCount - 1;

        ctx.save();
        ctx.beginPath();
        ctx.rect(loPx, 0, hiPx - loPx, H);
        ctx.clip();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // Draws one polyline per voiced run, segment by segment so each can
        // carry its own age-based opacity. valueOf(i) → log2 frequency or NaN.
        const drawTrack = (valueOf, style) => {
            let prev = null;
            for (let c = newest; c > newest - nVis && c >= 0; c--) {
                const i = c % this.texWidth;
                const v = valueOf(i);
                const ageCols = sh.pos - 1 - c;
                const x = x0 + dir * ageCols * pxPerCol;
                if (!Number.isFinite(v)) { prev = null; continue; }
                const y = yOf(v);
                if (prev) {
                    const ageS = ageCols / COLUMN_RATE;
                    const alpha = Math.max(0, 1 - ageS / persist);
                    if (alpha > 0.01) style(prev, { x, y }, alpha);
                }
                prev = { x, y };
            }
        };
        const seg = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };

        if (s.pitchShowRaw) {
            ctx.setLineDash([2, 4]);
            ctx.lineWidth = 1.25;
            ctx.strokeStyle = s.backgroundStyle === 'white' ? 'rgba(28,28,26,0.55)' : 'rgba(255,255,255,0.55)';
            drawTrack((i) => P.lf[i], (a, b, al) => { ctx.globalAlpha = al; seg(a, b); });
            ctx.setLineDash([]);
        }

        const shown = (i) => {
            const lf = P.lf[i], ref = P.ref[i];
            return Number.isFinite(lf) && Number.isFinite(ref) ? ref + k * (lf - ref) : NaN;
        };
        ctx.strokeStyle = s.pitchColor;
        ctx.lineWidth = 9;      // soft halo
        drawTrack(shown, (a, b, al) => { ctx.globalAlpha = al * 0.22; seg(a, b); });
        ctx.lineWidth = 2.75;   // core line
        drawTrack(shown, (a, b, al) => { ctx.globalAlpha = al; seg(a, b); });

        ctx.restore();
        ctx.globalAlpha = 1;
    }
}

mixin(SeeingSound, PitchMethods);
