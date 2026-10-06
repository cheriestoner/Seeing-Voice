// Control panel: event listeners, segmented controls, frequency range sliders and scale labels.

class ControlsMethods {
    /**
     * Initialize event listeners for user interactions
     */
    initEventListeners() {
        // Start/stop audio processing
        document.getElementById('startButton').addEventListener('click', () => {
            if (this.isRunning) {
                this.stop();
            } else {
                this.start();
            }
        });
        
        // FFT size control (radio buttons)
        document.querySelectorAll('input[name="fft-radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.settings.fftSize = parseInt(e.target.value);
                this.updateSegmentedControlIndicators();
                if (this.analyser) {
                    this.analyser.fftSize = this.settings.fftSize;
                    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
                    this.timeData = new Uint8Array(this.analyser.fftSize);
                }
            });
        });
        
        // Frequency range controls
        document.getElementById('minFreq').addEventListener('input', (e) => {
            this.settings.minFreq = sliderToFreq(parseInt(e.target.value), getCeiling(), this.settings.scale);
            document.getElementById('minFreqLabel').textContent = `${this.settings.minFreq} Hz`;
            this.updateRangeSliderTrack();
            this.updateFrequencyScale();
        });

        document.getElementById('maxFreq').addEventListener('input', (e) => {
            this.settings.maxFreq = sliderToFreq(parseInt(e.target.value), getCeiling(), this.settings.scale);
            document.getElementById('maxFreqLabel').textContent = `${this.settings.maxFreq} Hz`;
            this.updateRangeSliderTrack();
            this.updateFrequencyScale();
        });

        // maxFreqInput sets the Hz ceiling; slider max stays at SLIDER_STEPS always
        document.getElementById('maxFreqInput').addEventListener('change', (e) => {
            const ceiling = Math.max(1, Math.min(22050, parseInt(e.target.value) || 4000));
            e.target.value = ceiling;
            if (this.settings.maxFreq > ceiling) {
                this.settings.maxFreq = ceiling;
                document.getElementById('maxFreqLabel').textContent = `${ceiling} Hz`;
            }
            if (this.settings.minFreq > ceiling) {
                this.settings.minFreq = ceiling;
                document.getElementById('minFreqLabel').textContent = `${ceiling} Hz`;
            }
            document.getElementById('minFreq').value = freqToSlider(this.settings.minFreq, ceiling, this.settings.scale);
            document.getElementById('maxFreq').value = freqToSlider(this.settings.maxFreq, ceiling, this.settings.scale);
            this.updateRangeSliderTrack();
            this.updateFrequencyScale();
        });

        // Scale segmented control — also re-snaps slider positions to same Hz in new mapping
        document.querySelectorAll('input[name="scale-radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.settings.scale = e.target.value;
                const ceiling = getCeiling();
                document.getElementById('minFreq').value = freqToSlider(this.settings.minFreq, ceiling, this.settings.scale);
                document.getElementById('maxFreq').value = freqToSlider(this.settings.maxFreq, ceiling, this.settings.scale);
                this.updateSegmentedControlIndicators();
                this.updateRangeSliderTrack();
                this.updateFrequencyScale();
            });
        });
        
        // Frequency preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const presetName = e.currentTarget.dataset.preset;
                const preset = PRESETS[presetName];

                if (!preset) {
                    console.error(`Preset "${presetName}" not found`);
                    return;
                }

                // Add animation class
                // (capture the button: e.currentTarget is null once the handler returns)
                const btn = e.currentTarget;
                btn.classList.add('active');
                setTimeout(() => btn.classList.remove('active'), 300);

                this.settings.minFreq = preset.minFreq;
                this.settings.maxFreq = preset.maxFreq;
                this.settings.scale = preset.scale;

                // Update ceiling input and slider positions using preset's scale
                document.getElementById('maxFreqInput').value = preset.ceiling;
                document.getElementById('minFreq').value = freqToSlider(preset.minFreq, preset.ceiling, preset.scale);
                document.getElementById('maxFreq').value = freqToSlider(preset.maxFreq, preset.ceiling, preset.scale);
                document.getElementById('minFreqLabel').textContent = `${preset.minFreq} Hz`;
                document.getElementById('maxFreqLabel').textContent = `${preset.maxFreq} Hz`;

                // Update scale radio
                const scaleRadio = document.querySelector(`input[name="scale-radio"][value="${preset.scale}"]`);
                if (scaleRadio) scaleRadio.checked = true;
                this.updateSegmentedControlIndicators();

                this.updateRangeSliderTrack();

                // Update the frequency scale
                this.updateFrequencyScale();
            });
        });

        // Colormap radio buttons
        document.querySelectorAll('input[name="colormap-radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.settings.colormap = e.target.value;
                if (e.target.value === 'reversed_greyscale') {
                    this.settings.backgroundStyle = 'white';
                    document.getElementById('bg-white').checked = true;
                } else {
                    this.settings.backgroundStyle = 'dark';
                    document.getElementById('bg-dark').checked = true;
                }
                this.updateSegmentedControlIndicators();
            });
        });

        // Trail length control
        document.getElementById('trailLength').addEventListener('input', (e) => {
            this.settings.trailLength = parseFloat(e.target.value);
            document.getElementById('trailLengthValue').textContent = persistenceSeconds(this.settings.trailLength).toFixed(1) + ' s';
        });

        // Flash boost intensity control
        document.getElementById('boostIntensity').addEventListener('input', (e) => {
            this.settings.boostIntensity = parseFloat(e.target.value);
            document.getElementById('boostIntensityValue').textContent = parseFloat(e.target.value).toFixed(1);
        });

        // Spectral smoothing time constant
        document.getElementById('smoothingMs').addEventListener('input', (e) => {
            this.settings.smoothingMs = parseInt(e.target.value);
            document.getElementById('smoothingMsValue').textContent = `${this.settings.smoothingMs} ms`;
        });

        // Analyser level range (dB). Keep at least 10 dB between floor and ceiling.
        const fmtDb = (v) => `${v < 0 ? '−' : ''}${Math.abs(v)} dB`;
        const minDbEl = document.getElementById('minDb'), maxDbEl = document.getElementById('maxDb');
        const syncDb = (changed) => {
            let lo = parseInt(minDbEl.value), hi = parseInt(maxDbEl.value);
            if (hi - lo < 10) {
                if (changed === 'min') { hi = lo + 10; maxDbEl.value = hi; }
                else { lo = hi - 10; minDbEl.value = lo; }
            }
            this.settings.minDb = parseInt(minDbEl.value);
            this.settings.maxDb = parseInt(maxDbEl.value);
            document.getElementById('minDbValue').textContent = fmtDb(this.settings.minDb);
            document.getElementById('maxDbValue').textContent = fmtDb(this.settings.maxDb);
            this.applyDbRange();
        };
        this.syncDbUI = () => {
            minDbEl.value = this.settings.minDb; maxDbEl.value = this.settings.maxDb;
            document.getElementById('minDbValue').textContent = fmtDb(this.settings.minDb);
            document.getElementById('maxDbValue').textContent = fmtDb(this.settings.maxDb);
            this.applyDbRange();
        };
        minDbEl.addEventListener('input', () => syncDb('min'));
        maxDbEl.addEventListener('input', () => syncDb('max'));

        // Noise threshold control
        document.getElementById('noiseThreshold').addEventListener('input', (e) => {
            this.settings.noiseThreshold = parseInt(e.target.value);
            document.getElementById('noiseThresholdValue').textContent = `${this.settings.noiseThreshold}%`;
            
            // Update noise bars to visualize threshold
            this.updateNoiseVisualization();
        });
        
        // Scroll speed control (radio buttons)
        document.querySelectorAll('input[name="speed-radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.settings.scrollSpeed = e.target.value;
                this.updateSegmentedControlIndicators();
            });
        });

        // Scroll direction control
        document.querySelectorAll('input[name="direction-radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.settings.scrollDirection = e.target.value;
                this.updateSegmentedControlIndicators();
            });
        });

        // Background style control
        document.querySelectorAll('input[name="background-radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.settings.backgroundStyle = e.target.value;
                const isTransparent = e.target.value === 'transparent';
                document.getElementById('softEdgeOption').style.display = isTransparent ? 'flex' : 'none';
                this.updateSegmentedControlIndicators();
            });
        });

        document.getElementById('softEdgeCheck').addEventListener('change', (e) => {
            this.settings.softEdge = e.target.checked;
        });

        // Mapping (2D / 3D spectrogram / …) and the 3D style
        document.querySelectorAll('input[name="mapping-radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.setMapping(e.target.value));
        });
        // Pitch contour × k
        const bindRange = (id, key, fmt, after) => {
            const el = document.getElementById(id);
            el.addEventListener('input', () => {
                this.settings[key] = parseFloat(el.value);
                document.getElementById(id + 'Value').textContent = fmt(this.settings[key]);
                if (after) after();
            });
        };
        const keepRange = () => {   // keep at least an octave between the pitch limits
            const s = this.settings;
            if (s.pitchMax < s.pitchMin * 2) {
                s.pitchMax = Math.min(1500, s.pitchMin * 2);
                document.getElementById('pitchMax').value = s.pitchMax;
                document.getElementById('pitchMaxValue').textContent = `${Math.round(s.pitchMax)} Hz`;
            }
            this.updateFrequencyScale();
        };
        bindRange('pitchK', 'pitchK', v => `×${v.toFixed(2)}`);
        bindRange('pitchVoicingDb', 'pitchVoicingDb', v => `−${Math.abs(v)} dBFS`);
        bindRange('pitchThreshold', 'pitchThreshold', v => v.toFixed(2));
        bindRange('pitchRefMs', 'pitchRefMs', v => `${v} ms`);
        bindRange('pitchMin', 'pitchMin', v => `${v} Hz`, keepRange);
        bindRange('pitchMax', 'pitchMax', v => `${v} Hz`, () => {
            const s = this.settings;
            if (s.pitchMin > s.pitchMax / 2) {
                s.pitchMin = Math.max(40, s.pitchMax / 2);
                document.getElementById('pitchMin').value = s.pitchMin;
                document.getElementById('pitchMinValue').textContent = `${Math.round(s.pitchMin)} Hz`;
            }
            this.updateFrequencyScale();
        });
        document.querySelectorAll('input[name="pitchref-radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.settings.pitchRef = e.target.value;
                document.getElementById('pitchRefMsRow').hidden = e.target.value !== 'moving';
                if (this._pitch) this._pitch.refState = NaN;   // restart the reference
                this.updateSegmentedControlIndicators();
            });
        });
        document.getElementById('pitchShowRaw').addEventListener('change', (e) => { this.settings.pitchShowRaw = e.target.checked; });
        document.getElementById('pitchUnderlay').addEventListener('change', (e) => { this.settings.pitchUnderlay = e.target.checked; });
        document.getElementById('pitchColor').addEventListener('input', (e) => { this.settings.pitchColor = e.target.value; });

        document.querySelectorAll('input[name="camera3d-radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => { this.applyCameraPreset(e.target.value); this.updateSegmentedControlIndicators(); });
            // clicking the already-selected preset resets a dragged camera
            radio.nextElementSibling.addEventListener('click', () => { if (radio.checked) this.applyCameraPreset(radio.value); });
        });
        document.querySelectorAll('input[name="fade3d-radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.settings.spec3dFade = e.target.value;
                this.setMapping(this.settings.mapping);
            });
        });
        document.getElementById('lighting3dCheck').addEventListener('change', (e) => {
            this.settings.spec3dLighting = e.target.checked;
        });
        document.querySelectorAll('input[name="style3d-radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.settings.spec3dStyle = e.target.value;
                this.setMapping(this.settings.mapping);
            });
        });

        // 3D vertical exaggeration
        document.getElementById('heightScale3d').addEventListener('input', (e) => {
            this.settings.heightScale3d = parseFloat(e.target.value);
            document.getElementById('heightScale3dValue').textContent = this.settings.heightScale3d.toFixed(2);
        });

        // 3D orbit + zoom (canvas only receives pointer events while .view-3d)
        const canvas = this.canvas;
        canvas.addEventListener('pointerdown', (e) => {
            if (this.settings.viewMode === '2d') return;
            this._dragging = true;
            this._lastPointer = { x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId);
            canvas.style.cursor = 'grabbing';
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!this._dragging) return;
            const dx = e.clientX - this._lastPointer.x;
            const dy = e.clientY - this._lastPointer.y;
            this._lastPointer = { x: e.clientX, y: e.clientY };
            this._cam.az -= dx * 0.01;
            this._cam.el = Math.max(0.05, Math.min(1.5, this._cam.el + dy * 0.01));
        });
        const endDrag = (e) => {
            this._dragging = false;
            if (e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
                canvas.releasePointerCapture(e.pointerId);
            }
            canvas.style.cursor = 'grab';
        };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('wheel', (e) => {
            if (this.settings.viewMode === '2d') return;
            e.preventDefault();
            this._cam.dist = Math.max(1.5, Math.min(8, this._cam.dist * (1 + e.deltaY * 0.001)));
        }, { passive: false });

        // Custom preset save
        const presetNameInput = document.getElementById('preset-name-input');
        const savePresetBtn = document.getElementById('save-preset-btn');
        const doSave = () => {
            const name = presetNameInput.value.trim();
            if (name) {
                this._saveCustomPreset(name);
                presetNameInput.value = '';
            }
        };
        savePresetBtn.addEventListener('click', doSave);
        presetNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doSave();
        });

        // Participant ID persistence
        const participantIdInput = document.getElementById('participant-id-input');
        participantIdInput.addEventListener('input', () => {
            localStorage.setItem('seeing_sound_participant_id', participantIdInput.value.trim());
        });

        // Export presets
        document.getElementById('export-presets-btn').addEventListener('click', () => this._exportPresets());

        // Handle window resize
        window.addEventListener('resize', () => {
            this.setupHighDpiCanvas();
            this.updateSegmentedControlIndicators();
            this.updateRangeSliderTrack();
        });

        // Participant view: the stage takes over the whole window (Esc to leave)
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        const spectrogramContainer = document.querySelector('.spectrogram-container');
        if (fullscreenBtn && spectrogramContainer) {
            const iconExpand = fullscreenBtn.querySelector('.icon-expand');
            const iconCollapse = fullscreenBtn.querySelector('.icon-collapse');
            this.setParticipantView = (on) => {
                const expanded = spectrogramContainer.classList.toggle('expanded', on);
                if (iconExpand) iconExpand.style.display = expanded ? 'none' : 'block';
                if (iconCollapse) iconCollapse.style.display = expanded ? 'block' : 'none';
                fullscreenBtn.setAttribute('aria-label', expanded ? 'Leave participant view' : 'Participant view');
                requestAnimationFrame(() => this.setupHighDpiCanvas());
            };
            fullscreenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setParticipantView(!spectrogramContainer.classList.contains('expanded'));
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && spectrogramContainer.classList.contains('expanded')) {
                    this.setParticipantView(false);
                }
            });
        }
    }

    /**
     * Set up segmented controls
     */
    setupSegmentedControls() {
        // Set up FFT size segmented control
        this.updateSegmentedControlIndicators();
    }

    /**
     * Update segmented control indicators
     */
    updateSegmentedControlIndicators() {
        const update = (name, value) => {
            const radios = [...document.querySelectorAll(`input[name="${name}"]`)];
            const checked = document.querySelector(`input[name="${name}"][value="${value}"]:checked`);
            if (!checked) return;
            const index = radios.indexOf(checked);
            const indicator = checked.closest('.segmented-control').querySelector('.selection-indicator');
            indicator.style.transform = `translateX(calc(${index} * 100%))`;
        };

        update('fft-radio', this.settings.fftSize);
        update('speed-radio', this.settings.scrollSpeed);
        update('direction-radio', this.settings.scrollDirection);
        update('scale-radio', this.settings.scale);
        update('background-radio', this.settings.backgroundStyle);
        update('style3d-radio', this.settings.spec3dStyle);
        update('camera3d-radio', this.settings.spec3dCamera);
        update('fade3d-radio', this.settings.spec3dFade);
        update('pitchref-radio', this.settings.pitchRef);

        if (this.updateStatusSummary) this.updateStatusSummary();
    }

    /**
     * Set up advanced range sliders
     */
    setupRangeSliders() {
        // Initialize the range slider track
        this.updateRangeSliderTrack();
        
        // Set up initial frequency scale
        this.updateFrequencyScale();
        
        // Set up initial noise visualization
        this.updateNoiseVisualization();
    }

    /**
     * Update the range slider track
     */
    updateRangeSliderTrack() {
        const sliderRange = document.querySelector('.slider-range');
        const ceiling = getCeiling();
        const minPercent = freqToSlider(this.settings.minFreq, ceiling, this.settings.scale) / SLIDER_STEPS * 100;
        const maxPercent = freqToSlider(this.settings.maxFreq, ceiling, this.settings.scale) / SLIDER_STEPS * 100;
        sliderRange.style.left = `${minPercent}%`;
        sliderRange.style.width = `${maxPercent - minPercent}%`;
    }

    /**
     * Update the frequency scale labels
     */
    updateFrequencyScale() {
        const scaleLabels = document.querySelectorAll('.frequency-scale .scale-label');
        // The pitch mapping has its own (log) axis
        const axis = this.settings.mapping === 'pitch'
            ? this.pitchAxis()
            : { min: this.settings.minFreq, max: this.settings.maxFreq, scale: this.settings.scale };
        const min = axis.min;
        const max = axis.max;
        
        // Create logarithmic scale points
        const scalePoints = [];
        const count = 9;
        
        if (axis.scale === 'log') {
            // Logarithmic scale
            // Ensure min is positive for log scale calculation
            const safeMin = Math.max(min, 1);
            const logMin = Math.log(safeMin);
            const logMax = Math.log(max);
            const logRange = logMax - logMin;
            
            for (let i = 0; i < count; i++) {
                const t = i / (count - 1);
                const logValue = logMax - t * logRange;
                scalePoints.push(Math.exp(logValue));
            }
        } else {
            // Linear scale
            const range = max - min;
            for (let i = 0; i < count; i++) {
                const t = i / (count - 1);
                scalePoints.push(max - t * range);
            }
        }
        
        // Update labels
        scaleLabels.forEach((label, i) => {
            const value = scalePoints[i];
            if (value >= 1000) {
                label.textContent = `${(value / 1000).toLocaleString('en-US', {maximumFractionDigits: 1})} kHz`;
            } else {
                label.textContent = `${Math.round(value)} Hz`;
            }
            
            // Add special highlighting for the 1/4 point
            label.classList.remove('highlight');
        });

        // Label widths may have changed
        if (this.updateLabelGutter) this.updateLabelGutter();
    }

    /**
     * Update noise clip below threshold
     */
    updateNoiseVisualization() {
        const noiseBars = document.querySelectorAll('.noise-bar');
        const threshold = this.settings.noiseThreshold;
        
        noiseBars.forEach((bar, i) => {
            // Simulate different noise levels
            const noiseLevel = 10 + (i * 10); // 10, 20, 30, etc.
            
            // Apply threshold clipping
            if (noiseLevel < threshold) {
                bar.style.opacity = '0.3';
            } else {
                bar.style.opacity = '1';
            }
        });
    }

    /**
     * Set up the canvas for high DPI displays
     */
    setupHighDpiCanvas() {
        // Get the display pixel ratio
        const dpr = window.devicePixelRatio || 1;

        // Clear any inline sizes so the canvas re-fits its container (CSS 100%)
        this.canvas.style.width = '';
        this.canvas.style.height = '';

        // Get canvas size in CSS pixels
        const rect = this.canvas.getBoundingClientRect();
        
        // Set the canvas dimensions accounting for the device pixel ratio
        this.canvasWidth = rect.width * dpr;
        this.canvasHeight = rect.height * dpr;
        
        // Set the actual drawing buffer size
        this.canvas.width = this.canvasWidth;
        this.canvas.height = this.canvasHeight;
        
        // Tell WebGL to render into the full buffer
        if (this.gl) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // Keep the CSS size unchanged
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;

        this.updateLabelGutter();
        if (this.sizeOverlay) this.sizeOverlay();
    }

    /** Width (CSS px) the 2D data must leave free for the Hz labels on the right. */
    updateLabelGutter() {
        const scale = document.querySelector('.frequency-scale');
        if (!scale || !this.canvas) { this._labelGutterPx = 0; return; }
        const visible = scale.offsetParent !== null && getComputedStyle(scale).display !== 'none';
        if (!visible) { this._labelGutterPx = 0; return; }
        const c = this.canvas.getBoundingClientRect(), s = scale.getBoundingClientRect();
        this._labelGutterPx = Math.max(0, c.right - s.left) + 10;   // + a little air
    }

    /**
     * Start ambient animations
     */
    startAmbientAnimations() {
        // Animate noise bars when not running
        if (!this.isRunning) {
            this.animateNoiseBars();
        }
    }

    /**
     * Animate noise bars when not active
     */
    animateNoiseBars() {
        if (!this.isRunning) {
            const noiseBars = document.querySelectorAll('.noise-bar');
            
            noiseBars.forEach(bar => {
                const randomHeight = 5 + Math.random() * 15;
                bar.style.height = `${randomHeight}%`;
            });
            
            setTimeout(() => this.animateNoiseBars(), 800);
        }
    }

    /**
     * Update UI elements based on current settings
     */
    updateUI() {
        // Update FFT size radio buttons
        document.querySelector(`input[name="fft-radio"][value="${this.settings.fftSize}"]`).checked = true;
        
        // Update frequency range — ceiling from maxFreqInput, slider values from settings
        const ceiling = getCeiling();
        document.getElementById('minFreq').value = freqToSlider(this.settings.minFreq, ceiling, this.settings.scale);
        document.getElementById('maxFreq').value = freqToSlider(this.settings.maxFreq, ceiling, this.settings.scale);
        document.getElementById('minFreqLabel').textContent = `${this.settings.minFreq} Hz`;
        document.getElementById('maxFreqLabel').textContent = `${this.settings.maxFreq} Hz`;
        
        // Update noise threshold
        document.getElementById('noiseThreshold').value = this.settings.noiseThreshold;
        document.getElementById('noiseThresholdValue').textContent = `${this.settings.noiseThreshold}%`;
        
        // Update scroll speed
        document.querySelector(`input[name="speed-radio"][value="${this.settings.scrollSpeed}"]`).checked = true;
        
        // Update various UI elements
        this.updateSegmentedControlIndicators();
        this.updateRangeSliderTrack();
        this.updateFrequencyScale();
    }
}

mixin(SeeingSound, ControlsMethods);
