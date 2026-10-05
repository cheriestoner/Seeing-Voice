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
        document.querySelectorAll('.mapping-params').forEach(el => { el.hidden = el.dataset.for !== mapping; });
        // data-applies lists where a shared control is used: a mapping id, or a
        // finer key such as 'spec3d-persistence' (3D with persistence fading)
        const keys = [mapping];
        if (mapping === 'spec3d') keys.push(`spec3d-${s.spec3dFade}`);
        document.querySelectorAll('[data-applies]').forEach(el => {
            const applies = el.dataset.applies.split(/\s+/);
            const na = !applies.some(a => keys.includes(a));
            el.classList.toggle('is-na', na);
            el.querySelectorAll('input').forEach(i => { i.disabled = na; });
            let note = el.querySelector(':scope > .na-note');
            if (na) {
                if (!note) { note = document.createElement('span'); note.className = 'na-note'; el.appendChild(note); }
                note.textContent = mapping === 'spec3d' && applies.some(a => a.startsWith('spec3d'))
                    ? 'Not used while Fade (3D) is “By distance” — switch it above'
                    : `Not used by the ${MAPPING_NAMES[mapping]}`;
            } else if (note) {
                note.remove();
            }
        });

        const fadeRow = document.getElementById('fade3dRow');
        if (fadeRow) fadeRow.hidden = mapping !== 'spec3d';

        const lightRow = document.getElementById('lighting3dRow');
        if (lightRow) lightRow.hidden = s.spec3dStyle !== 'surface';

        const container = document.querySelector('.spectrogram-container');
        if (container) container.classList.toggle('view-3d', mapping === 'spec3d');
        this.updateSegmentedControlIndicators();
        if (!opts.silent) this.updateStatusSummary();
        requestAnimationFrame(() => this.updateLabelGutter && this.updateLabelGutter());
    }

    updateStatusSummary() {
        const s = this.settings;
        const container = document.querySelector('.spectrogram-container');
        if (container) container.dataset.ground = s.backgroundStyle;

        const strip = document.getElementById('statusStrip');
        if (!strip) return;
        const parts = [
            MAPPING_NAMES[s.mapping] + (s.mapping === 'spec3d' ? ` (${s.spec3dStyle}, ${s.spec3dCamera}, fade ${s.spec3dFade})` : ''),
            `FFT ${s.fftSize}`,
            `${s.scale === 'log' ? 'Log' : 'Lin'} ${s.minFreq}–${s.maxFreq} Hz`,
            `${s.minDb}…${s.maxDb} dB`,
            `${COLORMAP_NAMES[s.colormap] || s.colormap} on ${GROUND_NAMES[s.backgroundStyle] || s.backgroundStyle}`,
            `${s.scrollSpeed} ${s.scrollDirection === 'right' ? '→' : '←'}`,
            `smooth ${s.smoothingMs} ms · persist ${persistenceSeconds(s.trailLength).toFixed(1)} s`,
        ];
        if (s.noiseThreshold > 0) parts.push(`threshold ${s.noiseThreshold}%`);
        if (this._activePresetName) parts.push(`preset “${this._activePresetName}”`);
        strip.textContent = parts.join('  ·  ');
    }
}

mixin(SeeingSound, LayoutMethods);
