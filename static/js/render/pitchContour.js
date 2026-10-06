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
// Drawn with Canvas 2D on #overlayCanvas, in one of four styles
// (settings.pitchStyle):
//   line   — the contour as a line, on the 2D spectrogram's time axis
//   ribbon — comet: a glowing head (size/heat = loudness) and the recent
//            trajectory as a tail that tapers and cools with age
//   plume  — comet: the head sheds sparks in proportion to loudness, which
//            drift back with the scroll and diffuse
//   flight — comet in a pitch × loudness plane (no time axis); the tail is
//            the head's own recent path
// The tail lasts the shared Persistence time. The time-axis styles can sit
// over a dimmed spectrogram of the same pitch range.

const PITCH_GAP_RESET_S = 0.25;   // an unvoiced gap longer than this starts a new utterance
const PITCH_HEAD_HOLD_S = 0.15;   // the comet head fades out over this after voicing stops
const PITCH_LOUD_RANGE_DB = 40;   // loudness 0…1 spans voicing level … +40 dB
const PITCH_MAX_SPARKS = 6000;
const PITCH_STYLE_HINTS = {
    line: 'The shown f₀ as a line on the time axis.',
    ribbon: 'Comet: the head is the voice now (size and heat = loudness); the tail is the recent pitch, tapering and cooling over the Persistence time.',
    plume: 'Comet: the head sheds sparks in proportion to loudness; they drift back and diffuse, so vibrato fans out into a wavy plume.',
    flight: 'Comet in a pitch × loudness plane (up = higher, across = louder), with no time axis; the tail is the head’s own recent path.',
};
// comet heat ramps, hottest first: on dark grounds white-hot → amber → ember → violet,
// on paper the reverse lightness (deep → pale) so the head stays the strongest mark
const PITCH_RAMP_NIGHT = [[255, 250, 235], [255, 196, 90], [255, 106, 61], [190, 40, 70], [70, 20, 90]];
const PITCH_RAMP_PAPER = [[60, 20, 10], [150, 40, 14], [214, 90, 30], [236, 150, 90], [242, 205, 175]];

class PitchMethods {
    /** (Re)allocate per-column pitch history; called on Start. */
    resetPitchHistory() {
        const n = this.texWidth;
        this._pitch = {
            lf: new Float32Array(n).fill(NaN),    // log2 f0 per column (NaN = unvoiced)
            ref: new Float32Array(n).fill(NaN),   // log2 reference per column
            amp: new Float32Array(n),             // loudness 0…1 per column
            frameAmp: 0,
            sparks: [], spawnedCol: -1, lastDrawT: 0,
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
        // loudness 0…1 from the frame's RMS, lightly smoothed
        const rmsDb = 20 * Math.log10((r.rms || 0) + 1e-12);
        const amp = Math.max(0, Math.min(1, (rmsDb - s.pitchVoicingDb) / PITCH_LOUD_RANGE_DB));
        P.frameAmp += 0.5 * (amp - P.frameAmp);
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
        P.amp[i] = P.frameAmp;
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

    /** Show the controls and hint that fit the current pitch style. */
    syncPitchStyleUI() {
        const st = this.settings.pitchStyle || 'line';
        const hint = document.getElementById('pitchStyleHint');
        if (hint) hint.textContent = PITCH_STYLE_HINTS[st] || '';
        const flight = st === 'flight';
        const show = (id, on) => { const el = document.getElementById(id); if (el) el.hidden = !on; };
        show('pitchShowRawRow', !flight);
        show('pitchUnderlayRow', !flight);
        show('pitchColorRow', st === 'line');
        show('pitchLayersHint', flight);
        if (st !== 'plume' && this._pitch) this._pitch.sparks.length = 0;
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

        const style = s.pitchStyle || 'line';
        const flip = s.scrollDirection === 'right';
        // data area in screen px; newest at `x0`, older toward `dir`
        // full data area (clip) and the time axis inside it (newest at x0)
        const cLo = sh.clipLo ?? sh.dataLo, cHi = sh.clipHi ?? sh.dataHi;
        const loPx = (flip ? 1 - cHi : cLo) * W;
        const hiPx = (flip ? 1 - cLo : cHi) * W;
        const axLo = (flip ? 1 - sh.dataHi : sh.dataLo) * W;
        const axHi = (flip ? 1 - sh.dataLo : sh.dataHi) * W;
        const ground = s.backgroundStyle === 'white' ? [255, 255, 255] : [7, 7, 15];
        const lmin = Math.log2(s.pitchMin), lmax = Math.log2(s.pitchMax);
        const g = {
            ctx, W, H, loPx, hiPx, flip,
            x0: flip ? axLo : axHi,
            dir: flip ? 1 : -1,
            pxPerCol: SCROLL_SPEEDS[s.scrollSpeed],
            yOf: (l) => H * (1 - (l - lmin) / (lmax - lmin)),
            persist: sh.persistence,
            newest: this._writeCount - 1,
            pos: sh.pos,
            paper: s.backgroundStyle === 'white',
        };
        g.nVis = Math.ceil((axHi - axLo) / g.pxPerCol) + 2;
        const k = s.pitchK;
        g.shown = (i) => {
            const lf = P.lf[i], ref = P.ref[i];
            return Number.isFinite(lf) && Number.isFinite(ref) ? ref + k * (lf - ref) : NaN;
        };

        // dim the spectrogram underneath so the pitch reads first
        // (Free flight has no time axis, so the spectrogram is not drawn under it)
        if (style !== 'flight' && s.pitchUnderlay && s.backgroundStyle !== 'transparent') {
            ctx.fillStyle = `rgba(${ground[0]},${ground[1]},${ground[2]},0.45)`;
            ctx.fillRect(loPx, 0, hiPx - loPx, H);
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(loPx, 0, hiPx - loPx, H);
        ctx.clip();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        if (s.pitchShowRaw && style !== 'flight') {
            ctx.setLineDash([2, 4]);
            ctx.lineWidth = 1.25;
            ctx.strokeStyle = g.paper ? 'rgba(28,28,26,0.55)' : 'rgba(255,255,255,0.55)';
            this._pitchTrack(g, (i) => P.lf[i], (a, b, al) => { ctx.globalAlpha = al; this._pitchSeg(ctx, a, b); });
            ctx.setLineDash([]);
        }

        if (style === 'ribbon') this._drawPitchRibbon(g);
        else if (style === 'plume') this._drawPitchPlume(g);
        else if (style === 'flight') this._drawPitchFlight(g);
        else {
            ctx.strokeStyle = s.pitchColor;
            ctx.lineWidth = 9;      // soft halo
            this._pitchTrack(g, g.shown, (a, b, al) => { ctx.globalAlpha = al * 0.22; this._pitchSeg(ctx, a, b); });
            ctx.lineWidth = 2.75;   // core line
            this._pitchTrack(g, g.shown, (a, b, al) => { ctx.globalAlpha = al; this._pitchSeg(ctx, a, b); });
        }

        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    // ── helpers shared by the styles ─────────────────────────────────────

    /** x of column `c` on the scrolling time axis. */
    _pitchX(g, c) { return g.x0 + g.dir * (g.pos - 1 - c) * g.pxPerCol; }

    _pitchSeg(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }

    /**
     * Walk the visible columns newest → oldest, one callback per voiced
     * segment, with its age-based opacity. valueOf(i) → log2 frequency or NaN.
     */
    _pitchTrack(g, valueOf, style) {
        let prev = null;
        for (let c = g.newest; c > g.newest - g.nVis && c >= 0; c--) {
            const i = c % this.texWidth;
            const v = valueOf(i);
            if (!Number.isFinite(v)) { prev = null; continue; }
            const p = { x: this._pitchX(g, c), y: g.yOf(v), c, i };
            if (prev) {
                const ageS = (g.pos - 1 - c) / COLUMN_RATE;
                const alpha = Math.max(0, 1 - ageS / g.persist);
                if (alpha > 0.01) style(prev, p, alpha);
                else break;
            }
            prev = p;
        }
    }

    /** Heat ramp for the comet styles; a = 0 hottest (the head) … 1 coolest. */
    _pitchHeat(a, paper) {
        const R = paper ? PITCH_RAMP_PAPER : PITCH_RAMP_NIGHT;
        const x = Math.max(0, Math.min(1, a)) * (R.length - 1);
        const i = Math.min(Math.floor(x), R.length - 2), f = x - i;
        return R[i].map((v, j) => Math.round(v + (R[i + 1][j] - v) * f));
    }

    /** The newest voiced column, if it is recent enough to carry a head. */
    _pitchHeadCol(g) {
        const P = this._pitch;
        for (let c = g.newest; c >= 0 && c > g.newest - PITCH_HEAD_HOLD_S * COLUMN_RATE; c--) {
            const i = c % this.texWidth;
            if (Number.isFinite(g.shown(i))) {
                const ageS = (g.pos - 1 - c) / COLUMN_RATE;
                return { c, i, amp: P.amp[i], fade: Math.max(0, 1 - ageS / PITCH_HEAD_HOLD_S) };
            }
        }
        return null;
    }

    /** Glowing head: size and brightness follow loudness. */
    _pitchHead(g, x, y, amp, alpha) {
        if (alpha <= 0.01) return;
        const ctx = g.ctx;
        const r = (5 + 16 * amp) * 3.2;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        if (g.paper) {
            grad.addColorStop(0, `rgba(40,16,8,${alpha})`);
            grad.addColorStop(0.16, `rgba(150,40,14,${0.9 * alpha})`);
            grad.addColorStop(0.45, `rgba(214,90,30,${0.3 * alpha})`);
            grad.addColorStop(1, 'rgba(214,90,30,0)');
        } else {
            grad.addColorStop(0, `rgba(255,252,240,${alpha})`);
            grad.addColorStop(0.18, `rgba(255,210,120,${0.9 * alpha})`);
            grad.addColorStop(0.45, `rgba(255,106,61,${0.35 * alpha})`);
            grad.addColorStop(1, 'rgba(255,106,61,0)');
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }

    _pitchBlend(g) { g.ctx.globalCompositeOperation = g.paper ? 'source-over' : 'lighter'; }

    // ── A · Ember ribbon: the recent trajectory, tapering and cooling ──────
    _drawPitchRibbon(g) {
        const ctx = g.ctx, P = this._pitch;
        this._pitchBlend(g);
        for (let pass = 0; pass < 2; pass++) {
            this._pitchTrack(g, g.shown, (a, b, al) => {
                const age = 1 - al;
                const fade = Math.pow(al, 1.6);
                const w = (1.5 + 13 * P.amp[a.i]) * fade;
                const col = this._pitchHeat(age * 1.1, g.paper);
                ctx.globalAlpha = 1;
                ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${pass === 0 ? 0.10 * fade : 0.85 * fade})`;
                ctx.lineWidth = pass === 0 ? w * 3.2 : Math.max(0.6, w);
                this._pitchSeg(ctx, a, b);
            });
        }
        const h = this._pitchHeadCol(g);
        if (h) this._pitchHead(g, this._pitchX(g, h.c), g.yOf(g.shown(h.i)), h.amp, Math.min(1, h.amp * 1.8) * h.fade);
    }

    // ── B · Particle plume: the head sheds sparks that drift back ─────────
    _drawPitchPlume(g) {
        const ctx = g.ctx, P = this._pitch;
        const now = performance.now() / 1000;
        const dt = Math.min(0.05, Math.max(0, now - (P.lastDrawT || now)));
        P.lastDrawT = now;
        const sparks = P.sparks;
        const rand = Math.random;

        // spawn for the columns written since the last frame
        const from = Math.max(P.spawnedCol + 1, g.newest - 8);
        for (let c = from; c <= g.newest; c++) {
            const i = c % this.texWidth;
            const l = g.shown(i);
            if (!Number.isFinite(l)) continue;
            const amp = P.amp[i];
            const lp = g.shown((c - 1 + this.texWidth) % this.texWidth);
            const slopePx = Number.isFinite(lp) ? (g.yOf(l) - g.yOf(lp)) * COLUMN_RATE : 0;   // px/s
            const n = Math.round(amp * 9 + rand() * 0.6);
            for (let j = 0; j < n && sparks.length < PITCH_MAX_SPARKS; j++) {
                sparks.push({
                    c: c + rand() - 0.5,                       // birth column (sets x)
                    speed: 0.75 + 0.5 * rand(),                // relative to the scroll
                    l, dy: (rand() - 0.5) * 4,
                    vy: -slopePx * 0.25 + (rand() - 0.5) * 26,
                    max: g.persist * (0.6 + 0.6 * rand()),
                    size: 0.8 + 2.2 * amp * rand(),
                });
            }
        }
        P.spawnedCol = g.newest;

        this._pitchBlend(g);
        ctx.globalAlpha = 1;
        let w = 0;
        for (let n = 0; n < sparks.length; n++) {
            const p = sparks[n];
            const lifeS = (g.pos - 1 - p.c) / COLUMN_RATE;
            if (lifeS > p.max) continue;                         // dropped below
            p.dy += p.vy * dt;
            p.vy = p.vy * Math.exp(-dt * 1.2) + (rand() - 0.5) * 30 * dt;
            sparks[w++] = p;
            if (lifeS < 0) continue;
            const a = lifeS / p.max;
            const x = g.x0 + g.dir * lifeS * COLUMN_RATE * g.pxPerCol * p.speed;
            const y = g.yOf(p.l) + p.dy;
            const col = this._pitchHeat(a, g.paper);
            ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${(g.paper ? 0.85 : 0.75) * (1 - a)})`;
            ctx.beginPath(); ctx.arc(x, y, p.size * (1 - 0.5 * a), 0, Math.PI * 2); ctx.fill();
        }
        sparks.length = w;

        const h = this._pitchHeadCol(g);
        if (h) this._pitchHead(g, this._pitchX(g, h.c), g.yOf(g.shown(h.i)), h.amp, Math.min(1, h.amp * 1.8) * h.fade);
    }

    // ── C · Free flight: pitch × loudness plane, no time axis ─────────────
    _drawPitchFlight(g) {
        const ctx = g.ctx, P = this._pitch;
        const span = g.hiPx - g.loPx;
        // louder → away from the frequency labels' side, like the time axis
        const xOfAmp = (amp) => g.flip ? g.hiPx - span * (0.10 + 0.74 * amp) : g.loPx + span * (0.10 + 0.74 * amp);

        ctx.save();
        ctx.font = '11px ui-monospace, "SF Mono", Menlo, monospace';
        ctx.fillStyle = g.paper ? 'rgba(28,28,26,0.45)' : 'rgba(255,255,255,0.45)';
        ctx.textAlign = g.flip ? 'left' : 'right';
        ctx.fillText(g.flip ? '← louder' : 'louder →', g.flip ? g.loPx + 10 : g.hiPx - 10, g.H - 10);
        ctx.restore();

        this._pitchBlend(g);
        const pts = [];
        const maxCols = Math.ceil(g.persist * COLUMN_RATE) + 1;
        for (let c = g.newest; c > g.newest - maxCols && c >= 0; c--) {
            const i = c % this.texWidth;
            const l = g.shown(i);
            pts.push(Number.isFinite(l) ? { x: xOfAmp(P.amp[i]), y: g.yOf(l), c, i } : null);
        }
        for (let pass = 0; pass < 2; pass++) {
            for (let n = 0; n + 1 < pts.length; n++) {
                const a = pts[n], b = pts[n + 1];
                if (!a || !b) continue;
                const age = ((g.pos - 1 - a.c) / COLUMN_RATE) / g.persist;
                if (age >= 1) break;
                const fade = Math.pow(1 - age, 1.4);
                const col = this._pitchHeat(age * 1.1, g.paper);
                const w = (1.2 + 7 * P.amp[a.i]) * fade;
                ctx.globalAlpha = 1;
                ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${pass === 0 ? 0.10 * fade : 0.85 * fade})`;
                ctx.lineWidth = pass === 0 ? w * 3 : Math.max(0.6, w);
                this._pitchSeg(ctx, a, b);
            }
        }
        const h = this._pitchHeadCol(g);
        if (h) this._pitchHead(g, xOfAmp(h.amp), g.yOf(g.shown(h.i)), h.amp, Math.min(1, h.amp * 1.8) * h.fade);
    }
}

mixin(SeeingSound, PitchMethods);
