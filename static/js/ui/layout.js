// Layout: icon rail ↔ settings panel, stage resizing, and the status strip
// (a one-line summary of the current visualisation settings on the stage).

const COLORMAP_NAMES = { reversed_greyscale: 'Ink', viridis: 'Viridis', experimental: 'Crossmodal', greyscale: 'Greyscale' };
const GROUND_NAMES = { white: 'Paper', dark: 'Night', transparent: 'Clear' };
const MAPPING_NAMES = { spec2d: '2D spectrogram', spec3d: '3D spectrogram', pitch: 'Pitch × k' };

class LayoutMethods {
    initLayout() {
        const app = document.querySelector('.app');
        const railButtons = [...document.querySelectorAll('.rail-btn[data-panel]')];
        const sections = [...document.querySelectorAll('.panel-section[data-section]')];

        // Rail: clicking a section opens it; clicking the open one closes the panel
        railButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.panel;
                const isOpen = !app.classList.contains('panel-closed');
                if (isOpen && btn.classList.contains('is-active')) {
                    app.classList.add('panel-closed');
                    btn.classList.remove('is-active');
                    btn.setAttribute('aria-expanded', 'false');
                    return;
                }
                app.classList.remove('panel-closed');
                railButtons.forEach(b => {
                    const on = b === btn;
                    b.classList.toggle('is-active', on);
                    b.setAttribute('aria-expanded', String(on));
                });
                sections.forEach(s => s.classList.toggle('is-active', s.dataset.section === name));
                try { localStorage.setItem('seeing_sound_panel', name); } catch (e) { /* ignore */ }
            });
        });

        // Small screens: start with the panel closed so the stage is visible
        const small = !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
        if (small) {
            app.classList.add('panel-closed');
            railButtons.forEach(b => b.classList.remove('is-active'));
        }

        // Restore the last open section
        let last = null;
        try { last = localStorage.getItem('seeing_sound_panel'); } catch (e) { /* ignore */ }
        if (['mapping', 'frequency', 'motion', 'detail'].includes(last)) last = 'vis';
        const lastBtn = railButtons.find(b => b.dataset.panel === last);
        if (!small && lastBtn && !lastBtn.classList.contains('is-active')) lastBtn.click();

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
        // Accordion groups in the Visualisation panel (open state remembered)
        let openSet = null;
        try { openSet = JSON.parse(localStorage.getItem('seeing_sound_acc') || 'null'); } catch (e) { /* ignore */ }
        if (!Array.isArray(openSet)) openSet = ['view', 'freq', 'contour'];
        document.querySelectorAll('.acc').forEach(acc => {
            const head = acc.querySelector('.acc-head');
            const setOpen = (on) => {
                acc.classList.toggle('is-open', on);
                head.setAttribute('aria-expanded', String(on));
            };
            setOpen(openSet.includes(acc.dataset.acc));
            head.addEventListener('click', () => {
                setOpen(!acc.classList.contains('is-open'));
                const now = [...document.querySelectorAll('.acc.is-open')].map(a => a.dataset.acc);
                try { localStorage.setItem('seeing_sound_acc', JSON.stringify(now)); } catch (e) { /* ignore */ }
                this.updateSegmentedControlIndicators();
            });
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

        const radio = document.querySelector(`input[name="mapping-radio"][value="${mapping}"]`);
        if (radio) radio.checked = true;
        // Visualisation panel: only this mapping's own groups
        document.querySelectorAll('.acc[data-for]').forEach(el => {
            el.hidden = !el.dataset.for.split(/\s+/).includes(mapping);
        });
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

        // one-line summaries on the accordion headers
        const summaries = {
            view: `${s.spec3dCamera} · ${s.spec3dStyle}${s.spec3dStyle === 'surface' && s.spec3dLighting ? ' · lit' : ''}`,
            freq: `${s.scale === 'log' ? 'Log' : 'Lin'} ${s.minFreq}–${s.maxFreq} Hz`,
            contour: `${{ line: 'Line', ribbon: 'Ribbon', plume: 'Plume', flight: 'Flight' }[s.pitchStyle]} · k ${(+s.pitchK).toFixed(2)} · ${s.pitchRef === 'moving' ? 'ref ' + s.pitchRefMs + ' ms' : 'utterance'}`,
            paxis: `${s.pitchMin}–${s.pitchMax} Hz`,
            layers: s.pitchStyle === 'flight' ? 'no time axis' : [s.pitchShowRaw && 'raw f₀', s.pitchUnderlay && 'underlay'].filter(Boolean).join(' · ') || 'pitch only',
        };
        document.querySelectorAll('[data-summary]').forEach(el => { el.textContent = summaries[el.dataset.summary] || ''; });

        const strip = document.getElementById('statusStrip');
        if (!strip) return;
        const parts = [
            MAPPING_NAMES[s.mapping] + (s.mapping === 'spec3d' ? ` (${s.spec3dStyle}, ${s.spec3dCamera}, fade ${s.spec3dFade})`
                : s.mapping === 'pitch' ? ` (${s.pitchStyle}${s.pitchTimeMode === 'sweep' ? `, sweep ${(+s.pitchSweepS).toFixed(1)} s` : ''}, k ${(+s.pitchK).toFixed(2)}, ref ${s.pitchRef === 'moving' ? s.pitchRefMs + ' ms' : 'utterance'})` : ''),
            `FFT ${s.fftSize}`,
            s.mapping === 'pitch' ? `Log ${s.pitchMin}–${s.pitchMax} Hz` : `${s.scale === 'log' ? 'Log' : 'Lin'} ${s.minFreq}–${s.maxFreq} Hz`,
            `${s.minDb}…${s.maxDb} dB`,
            `${COLORMAP_NAMES[s.colormap] || s.colormap} on ${GROUND_NAMES[s.backgroundStyle] || s.backgroundStyle}`,
            s.mapping === 'pitch' && s.pitchTimeMode === 'sweep' ? 'sweep →' : `${s.scrollSpeed} ${s.scrollDirection === 'right' ? '→' : '←'}`,
            `smooth ${s.smoothingMs} ms · persist ${persistenceSeconds(s.trailLength).toFixed(1)} s`,
        ];
        if (s.noiseThreshold > 0) parts.push(`threshold ${s.noiseThreshold}%`);
        if (this._activePresetName) parts.push(`preset “${this._activePresetName}”`);
        strip.textContent = parts.join('  ·  ');
    }
}

mixin(SeeingSound, LayoutMethods);
