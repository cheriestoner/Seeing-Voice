// Layout: icon rail ↔ settings panel, stage resizing, and the status strip
// (a one-line summary of the current visualisation settings on the stage).

const COLORMAP_NAMES = { reversed_greyscale: 'Ink', viridis: 'Viridis', experimental: 'Crossmodal', greyscale: 'Greyscale' };
const GROUND_NAMES = { white: 'Paper', dark: 'Night', transparent: 'Clear' };
const MAPPING_NAMES = { spec2d: '2D Spectral', spec3d: '3D Spectral', pitch: 'Features · Pitch × k' };
const SWATCH_CLASSES = { reversed_greyscale: 'swatch-ink', viridis: 'swatch-viridis', experimental: 'swatch-crossmodal', greyscale: 'swatch-grey' };

class LayoutMethods {
    initLayout() {
        const app = document.querySelector('.app');
        const railButtons = [...document.querySelectorAll('.rail-btn[data-panel]')];
        const sections = [...document.querySelectorAll('.panel-section[data-section]')];

        // Rail. The "Show" buttons (Spectral / Features) also choose what is on
        // stage; the shared panels (Colour, Time, Presets) only open their panel.
        // Clicking the button of the open panel again closes the panel.
        this._lastSpecMapping = this.settings.mapping === 'spec3d' ? 'spec3d' : 'spec2d';
        this.openPanel = (name) => {
            app.classList.remove('panel-closed');
            railButtons.forEach(b => {
                const on = b.dataset.panel === name;
                b.classList.toggle('is-active', on);
                b.setAttribute('aria-expanded', String(on));
            });
            sections.forEach(s => s.classList.toggle('is-active', s.dataset.section === name));
            try { localStorage.setItem('seeing_sound_panel', name); } catch (e) { /* ignore */ }
            requestAnimationFrame(() => this.updateSegmentedControlIndicators());
        };
        railButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.panel;
                const isOpen = !app.classList.contains('panel-closed');
                if (name === 'spectral' && this.settings.mapping === 'pitch') {
                    this.setMapping(this._lastSpecMapping);
                } else if (name === 'features' && this.settings.mapping !== 'pitch') {
                    this.setMapping('pitch');
                } else if (isOpen && btn.classList.contains('is-active')) {
                    app.classList.add('panel-closed');
                    btn.classList.remove('is-active');
                    btn.setAttribute('aria-expanded', 'false');
                    return;
                }
                this.openPanel(name);
            });
        });

        // Small screens: start with the panel closed so the stage is visible
        const small = !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
        if (small) {
            app.classList.add('panel-closed');
            railButtons.forEach(b => b.classList.remove('is-active'));
        }

        // Restore the last open panel. The mapping panels follow the mapping
        // actually on stage; panels from older layouts map onto it too.
        let last = null;
        try { last = localStorage.getItem('seeing_sound_panel'); } catch (e) { /* ignore */ }
        if (!['colour', 'time', 'presets'].includes(last)) last = this.settings.mapping === 'pitch' ? 'features' : 'spectral';
        if (!small) this.openPanel(last);

        // Close-panel chevron (rail stays)
        const collapseBtn = document.getElementById('panelCollapseBtn');
        if (collapseBtn) collapseBtn.addEventListener('click', () => {
            app.classList.add('panel-closed');
            railButtons.forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-expanded', 'false'); });
        });

        // Hide / show the whole sidebar (rail + panel); remembered across reloads
        const setSidebarHidden = (hidden) => {
            app.classList.toggle('sidebar-hidden', hidden);
            try { localStorage.setItem('seeing_sound_sidebar_hidden', hidden ? '1' : '0'); } catch (e) { /* ignore */ }
        };
        this.setSidebarHidden = setSidebarHidden;
        const hideBtn = document.getElementById('sidebarHideBtn');
        const showBtn = document.getElementById('sidebarShowBtn');
        if (hideBtn) hideBtn.addEventListener('click', () => setSidebarHidden(true));
        if (showBtn) showBtn.addEventListener('click', () => setSidebarHidden(false));
        try { if (localStorage.getItem('seeing_sound_sidebar_hidden') === '1') setSidebarHidden(true); } catch (e) { /* ignore */ }

        // Cmd/Ctrl+B toggles the sidebar (as in VS Code; ignored in participant view)
        document.addEventListener('keydown', (e) => {
            if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || (e.key || '').toLowerCase() !== 'b') return;
            if (document.querySelector('.spectrogram-container.expanded')) return;
            e.preventDefault();
            setSidebarHidden(!app.classList.contains('sidebar-hidden'));
        });

        // Keep the WebGL drawing buffer matched to the stage size (panel open/close, window resize)
        const container = document.querySelector('.spectrogram-container');
        if (window.ResizeObserver && container) {
            let pending = false;
            new ResizeObserver(() => {
                if (pending) return;
                pending = true;
                requestAnimationFrame(() => { pending = false; this.setupHighDpiCanvas(); });
            }).observe(container);
        }

        // Any control change → refresh the summary (runs after the controls' own handlers)
        const panel = document.getElementById('settingsPanel');
        if (panel) {
            panel.addEventListener('input', () => this.updateStatusSummary());
            panel.addEventListener('change', () => this.updateStatusSummary());
        }
        // Jump bars: scroll the open panel to a section (panels stay flat)
        document.querySelectorAll('.jump-bar [data-jump]').forEach(btn => {
            btn.addEventListener('click', () => {
                const el = document.getElementById(btn.dataset.jump);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
        // Rows that open another panel (Colormap → Colour, underlay → Spectral)
        document.querySelectorAll('[data-goto-panel]').forEach(btn => {
            btn.addEventListener('click', () => this.openPanel(btn.dataset.gotoPanel));
        });

        this.syncPitchStyleUI();
        this.setMapping(this.settings.mapping, { silent: true });
        this.updateStatusSummary();
    }

    /**
     * Switch mapping: shows that mapping's own parameters in the Mapping panel,
     * greys out shared controls it does not use (data-applies="…"), and sets
     * the renderer's viewMode. opts.silent skips the summary refresh.
     */
    setMapping(mapping, opts = {}) {
        if (mapping === 'spec3d' && !this._webgl3dOK) {
            this.showNotification('3D spectrogram is not supported on this device.', 'error');
            mapping = 'spec2d';
        }
        const s = this.settings;
        s.mapping = mapping;
        s.viewMode = mapping === 'spec3d' ? s.spec3dStyle : '2d';

        if (mapping !== 'pitch') {
            this._lastSpecMapping = mapping;
            const dim = document.querySelector(`input[name="dim-radio"][value="${mapping}"]`);
            if (dim) dim.checked = true;
        }
        // The rail marks which "Show" button is on stage
        const current = mapping === 'pitch' ? 'features' : 'spectral';
        document.querySelectorAll('.rail-mapping').forEach(b => b.classList.toggle('is-current', b.dataset.panel === current));
        // Shared panels: a control listed for other mappings only is hidden.
        // data-applies holds mapping ids or finer keys ('spec3d-persistence' =
        // 3D with persistence fading).
        const keys = [mapping];
        if (mapping === 'spec3d') keys.push(`spec3d-${s.spec3dFade}`);
        document.querySelectorAll('[data-applies]').forEach(el => {
            el.hidden = !el.dataset.applies.split(/\s+/).some(a => keys.includes(a));
        });
        document.querySelectorAll('.scope-name').forEach(el => { el.textContent = MAPPING_NAMES[mapping]; });

        this.syncTimeModeUI();

        const lightRow = document.getElementById('lighting3dRow');
        if (lightRow) lightRow.hidden = s.spec3dStyle !== 'surface';

        const container = document.querySelector('.spectrogram-container');
        if (container) container.classList.toggle('view-3d', mapping === 'spec3d');
        if (mapping !== 'pitch' && this.clearOverlay) this.clearOverlay();
        this.updateFrequencyScale();   // the pitch mapping has its own axis
        this.updateSegmentedControlIndicators();
        if (!opts.silent) this.updateStatusSummary();
        requestAnimationFrame(() => this.updateLabelGutter && this.updateLabelGutter());
    }

    /**
     * Pitch × k time mode: Sweep replaces Speed and Direction with a sweep
     * time (runs after the data-applies pass in setMapping).
     */
    syncTimeModeUI() {
        const s = this.settings;
        const sweep = s.mapping === 'pitch' && s.pitchTimeMode === 'sweep';
        const flight = s.pitchStyle === 'flight';
        const sweepRow = document.getElementById('sweepTimeRow');
        if (sweepRow) sweepRow.hidden = !sweep;
        const speed = document.getElementById('speedField');
        if (speed) speed.hidden = sweep;
        const dirEl = document.getElementById('directionField');
        if (dirEl && sweep) dirEl.hidden = true;
        else if (dirEl) dirEl.hidden = !['spec2d', 'pitch'].includes(s.mapping);
        const hint = document.getElementById('timeModeHint');
        if (hint) hint.textContent = flight && s.mapping === 'pitch'
            ? 'Free flight has no time axis, so Scroll / Sweep does not change it.'
            : 'Scroll moves the history across the screen. Sweep keeps the screen still, like a heart monitor: new pitch and spectrum are written left to right and wrap round over the last pass.';
    }

    updateStatusSummary() {
        const s = this.settings;
        const container = document.querySelector('.spectrogram-container');
        if (container) container.dataset.ground = s.backgroundStyle;

        const rep = this.representation();
        const ax = this.spectralAxis();
        const S = freqScale(ax.scale);
        const kHz = (v) => v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
        const dbRange = `${s.minDb}…${s.maxDb} dB`;
        const colormap = COLORMAP_NAMES[s.colormap] || s.colormap;

        // one-line summaries on the section headers
        const summaries = {
            view: `${s.spec3dCamera} · ${s.spec3dStyle}${s.spec3dStyle === 'surface' && s.spec3dLighting ? ' · lit' : ''}`,
            analysis: `${rep.label} · ${Math.round(s.windowMs)} ms`,
            freq: `${S.label}${rep.nativeScale ? ' (native)' : ''} · ${kHz(ax.lo)}–${kHz(ax.hi)} Hz`,
            level: `${dbRange}${s.noiseThreshold > 0 ? ` · thr ${s.noiseThreshold}%` : ''}`,
            contour: `${{ line: 'Line', ribbon: 'Ribbon', plume: 'Plume', flight: 'Flight' }[s.pitchStyle]} · k ${(+s.pitchK).toFixed(2)} · ${s.pitchRef === 'moving' ? 'ref ' + s.pitchRefMs + ' ms' : 'utterance'}`,
            paxis: `${s.pitchScale === 'linear' ? 'Lin' : 'Log'} ${s.pitchMin}–${s.pitchMax} Hz`,
            layers: s.pitchStyle === 'flight' ? 'no time axis' : [s.pitchShowRaw && 'raw f₀', s.pitchUnderlay && 'underlay'].filter(Boolean).join(' · ') || 'pitch only',
            tracking: `YIN ${(+s.pitchThreshold).toFixed(2)} · ${s.pitchVoicingDb} dBFS`,
            underlay: `${rep.label} ${Math.round(s.windowMs)} ms, ${dbRange}`,
        };
        document.querySelectorAll('[data-summary]').forEach(el => { el.textContent = summaries[el.dataset.summary] || ''; });

        // Spectral › C: the colormap row mirrors the Colour panel
        const cmName = document.getElementById('colormapLinkName');
        if (cmName) cmName.textContent = colormap;
        const cmSw = document.getElementById('colormapLinkSwatch');
        if (cmSw) cmSw.className = `swatch ${SWATCH_CLASSES[s.colormap] || ''}`;
        const aHint = document.getElementById('analysisHint');
        if (aHint) aHint.textContent = rep.hint;
        const sHint = document.getElementById('scaleHint');
        if (sHint) sHint.textContent = S.hint;

        const strip = document.getElementById('statusStrip');
        if (!strip) return;
        const pitch = s.mapping === 'pitch';
        const parts = [
            MAPPING_NAMES[s.mapping] + (s.mapping === 'spec3d' ? ` (${s.spec3dStyle}, ${s.spec3dCamera}, fade ${s.spec3dFade})`
                : pitch ? ` (${s.pitchStyle}${s.pitchTimeMode === 'sweep' ? `, sweep ${(+s.pitchSweepS).toFixed(1)} s` : ''}, k ${(+s.pitchK).toFixed(2)}, ref ${s.pitchRef === 'moving' ? s.pitchRefMs + ' ms' : 'utterance'})` : ''),
            `A ${rep.label} ${Math.round(s.windowMs)} ms`,
            pitch ? `${s.pitchScale === 'linear' ? 'Lin' : 'Log'} ${s.pitchMin}–${s.pitchMax} Hz` : `B ${S.label} ${Math.round(ax.lo)}–${Math.round(ax.hi)} Hz`,
            `C ${dbRange}`,
            `${colormap} on ${GROUND_NAMES[s.backgroundStyle] || s.backgroundStyle}`,
            pitch && s.pitchTimeMode === 'sweep' ? 'sweep →' : `${s.scrollSpeed} ${s.scrollDirection === 'right' ? '→' : '←'}`,
            `smooth ${s.smoothingMs} ms · persist ${persistenceSeconds(s.trailLength).toFixed(1)} s`,
        ];
        if (s.noiseThreshold > 0) parts.push(`threshold ${s.noiseThreshold}%`);
        if (this._activePresetName) parts.push(`preset “${this._activePresetName}”`);
        strip.textContent = parts.join('  ·  ');
    }
}

mixin(SeeingSound, LayoutMethods);
