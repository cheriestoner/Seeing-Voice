// Custom presets: save / load / delete / export (localStorage), plus the fullscreen preset switcher.

class PresetsMethods {
    _getCustomPresets() {
        try {
            return JSON.parse(localStorage.getItem('seeing_sound_presets') || '{}');
        } catch {
            return {};
        }
    }

    _saveCustomPreset(name) {
        const presets = this._getCustomPresets();
        const { sampleRate, ...saveable } = this.settings;
        const participantId = document.getElementById('participant-id-input').value.trim();
        presets[name] = { ...saveable, participantId };
        localStorage.setItem('seeing_sound_presets', JSON.stringify(presets));
        this._renderCustomPresets();
    }

    _deleteCustomPreset(name) {
        const presets = this._getCustomPresets();
        delete presets[name];
        localStorage.setItem('seeing_sound_presets', JSON.stringify(presets));
        this._renderCustomPresets();
    }

    _applySettingsToUI(s) {
        Object.assign(this.settings, s);

        // Defaults for presets saved before these fields existed
        // Presets from before 'mapping' existed stored only viewMode
        if (!s.mapping) {
            const vm = s.viewMode || '2d';
            this.settings.mapping = vm === '2d' ? 'spec2d' : 'spec3d';
            this.settings.spec3dStyle = vm === '2d' ? (this.settings.spec3dStyle || 'surface') : vm;
        }
        if (this.settings.heightScale3d == null) this.settings.heightScale3d = 0.6;
        if (s.minDb == null) this.settings.minDb = -100;
        if (s.smoothingMs == null) this.settings.smoothingMs = 10;
        if (s.maxDb == null) this.settings.maxDb = -30;

        const setRadio = (name, value) => {
            const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
            if (el) el.checked = true;
        };

        setRadio('fft-radio', s.fftSize);
        setRadio('scale-radio', s.scale);
        setRadio('colormap-radio', s.colormap);
        setRadio('speed-radio', s.scrollSpeed);
        setRadio('direction-radio', s.scrollDirection);
        setRadio('background-radio', s.backgroundStyle);
        if (!s.spec3dCamera) this.settings.spec3dCamera = 'front';
        if (!s.spec3dFade) this.settings.spec3dFade = 'distance';
        if (s.spec3dLighting == null) this.settings.spec3dLighting = false;
        setRadio('style3d-radio', this.settings.spec3dStyle);
        setRadio('camera3d-radio', this.settings.spec3dCamera);
        setRadio('fade3d-radio', this.settings.spec3dFade);
        document.getElementById('lighting3dCheck').checked = this.settings.spec3dLighting;
        this.applyCameraPreset(this.settings.spec3dCamera);
        this.setMapping(this.settings.mapping, { silent: true });
        document.getElementById('heightScale3d').value = this.settings.heightScale3d;
        document.getElementById('heightScale3dValue').textContent = this.settings.heightScale3d.toFixed(2);

        const softEdgeCheck = document.getElementById('softEdgeCheck');
        const softEdgeOption = document.getElementById('softEdgeOption');
        softEdgeCheck.checked = s.softEdge;
        softEdgeOption.style.display = s.backgroundStyle === 'transparent' ? 'flex' : 'none';

        const ceiling = s.maxFreq;
        document.getElementById('maxFreqInput').value = ceiling;
        document.getElementById('minFreq').value = freqToSlider(s.minFreq, ceiling, s.scale);
        document.getElementById('maxFreq').value = freqToSlider(s.maxFreq, ceiling, s.scale);
        document.getElementById('minFreqLabel').textContent = `${s.minFreq} Hz`;
        document.getElementById('maxFreqLabel').textContent = `${s.maxFreq} Hz`;

        document.getElementById('noiseThreshold').value = s.noiseThreshold;
        document.getElementById('noiseThresholdValue').textContent = `${s.noiseThreshold}%`;
        this.updateNoiseVisualization();

        document.getElementById('trailLength').value = s.trailLength;
        document.getElementById('trailLengthValue').textContent = persistenceSeconds(s.trailLength).toFixed(1) + ' s';
        document.getElementById('smoothingMs').value = this.settings.smoothingMs;
        document.getElementById('smoothingMsValue').textContent = `${this.settings.smoothingMs} ms`;

        if (this.syncDbUI) this.syncDbUI();

        document.getElementById('boostIntensity').value = s.boostIntensity;
        document.getElementById('boostIntensityValue').textContent = parseFloat(s.boostIntensity).toFixed(1);

        this.updateSegmentedControlIndicators();
        this.updateRangeSliderTrack();
        this.updateFrequencyScale();
    }

    _exportPresets() {
        const presets = this._getCustomPresets();
        const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'seeing_sound_presets.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    _renderCustomPresets() {
        const list = document.getElementById('custom-presets-list');
        const switcher = document.getElementById('fullscreen-preset-switcher');
        if (!list) return;
        list.innerHTML = '';
        if (switcher) switcher.innerHTML = '';
        const presets = this._getCustomPresets();
        Object.entries(presets).forEach(([name, settings]) => {
            // Card list item
            const item = document.createElement('div');
            item.className = 'custom-preset-item';

            const label = document.createElement('span');
            label.className = 'preset-item-name';
            label.textContent = name;
            if (settings.participantId) {
                const pid = document.createElement('span');
                pid.className = 'preset-item-pid';
                pid.textContent = ` · ${settings.participantId}`;
                label.appendChild(pid);
            }

            const loadBtn = document.createElement('button');
            loadBtn.className = 'preset-item-load';
            loadBtn.textContent = 'Load';
            loadBtn.addEventListener('click', () => {
                this._applySettingsToUI(settings);
                this._activePresetName = name;
                this._renderCustomPresets();
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'preset-item-delete';
            deleteBtn.textContent = '✕';
            deleteBtn.addEventListener('click', () => this._deleteCustomPreset(name));

            item.appendChild(label);
            item.appendChild(loadBtn);
            item.appendChild(deleteBtn);
            list.appendChild(item);

            // Fullscreen pill
            if (switcher) {
                const pill = document.createElement('button');
                pill.className = 'fullscreen-preset-pill' + (name === this._activePresetName ? ' active' : '');
                pill.textContent = name;
                pill.addEventListener('click', () => {
                    this._applySettingsToUI(settings);
                    this._activePresetName = name;
                    switcher.querySelectorAll('.fullscreen-preset-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    // also refresh card list active states
                    this._renderCustomPresets();
                });
                switcher.appendChild(pill);
            }
        });
    }
}

mixin(SeeingSound, PresetsMethods);
