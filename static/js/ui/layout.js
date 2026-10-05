// Layout: icon rail ↔ settings panel, stage resizing, and the status strip
// (a one-line summary of the current visualisation settings on the stage).

const COLORMAP_NAMES = { reversed_greyscale: 'Ink', viridis: 'Viridis', experimental: 'Crossmodal', greyscale: 'Greyscale' };
const GROUND_NAMES = { white: 'Paper', dark: 'Night', transparent: 'Clear' };

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
        this.updateStatusSummary();
    }

    updateStatusSummary() {
        const s = this.settings;
        const container = document.querySelector('.spectrogram-container');
        if (container) container.dataset.ground = s.backgroundStyle;

        const strip = document.getElementById('statusStrip');
        if (!strip) return;
        const parts = [
            `FFT ${s.fftSize}`,
            `${s.scale === 'log' ? 'Log' : 'Lin'} ${s.minFreq}–${s.maxFreq} Hz`,
            `${COLORMAP_NAMES[s.colormap] || s.colormap} on ${GROUND_NAMES[s.backgroundStyle] || s.backgroundStyle}`,
            `${s.scrollSpeed} ${s.scrollDirection === 'right' ? '→' : '←'}`,
            s.viewMode === '2d' ? '2D' : `3D ${s.viewMode}`,
        ];
        if (s.noiseThreshold > 0) parts.push(`threshold ${s.noiseThreshold}%`);
        if (this._activePresetName) parts.push(`preset “${this._activePresetName}”`);
        strip.textContent = parts.join('  ·  ');
    }
}

mixin(SeeingSound, LayoutMethods);
