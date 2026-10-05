/**
 * SeeingSound core: app state, audio lifecycle and the per-frame loop.
 *
 * Feature-specific methods (renderers, UI, presets) live in their own files and
 * are attached to SeeingSound.prototype with mixin() — each of those files
 * defines a plain class of methods and calls mixin(SeeingSound, ThatClass).
 */

function mixin(target, source) {
    for (const name of Object.getOwnPropertyNames(source.prototype)) {
        if (name === 'constructor') continue;
        if (Object.prototype.hasOwnProperty.call(target.prototype, name)) {
            throw new Error(`mixin: SeeingSound.${name} is already defined`);
        }
        Object.defineProperty(target.prototype, name,
            Object.getOwnPropertyDescriptor(source.prototype, name));
    }
}

// Main application class
class SeeingSound {
    constructor() {
        this.isRunning = false;
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.canvas = document.getElementById('spectrogramCanvas');
        
        // Visualization settings
        this.settings = {
            fftSize: 2048, // Default is medium (2048)
            minDb: -100,   // analyser level range: below → 0, above → 255 (clipped)
            maxDb: -30,
            minFreq: 0,
            maxFreq: 4000,
            noiseThreshold: 0,
            scrollSpeed: 'medium',
            scrollDirection: 'left',
            sampleRate: 44100, // Will be updated with actual sample rate
            scale: 'linear', // 'linear' or 'log'
            colormap: 'viridis', // 'experimental' or 'viridis'
            backgroundStyle: 'dark', // 'dark' | 'transparent'
            softEdge: true,
            trailLength: 0.5,    // persistence, see persistenceSeconds() (0.5 = 2 s)
            smoothingMs: 10,     // spectral smoothing time constant (≈ the old 0.2 per frame at 60 Hz)
            boostIntensity: 2.5, // flash brightness at cursor edge (0 = off)
            mapping: 'spec2d',   // 'spec2d' | 'spec3d' | 'pitch'
            spec3dStyle: 'surface', // 'surface' | 'wireframe'
            viewMode: '2d',      // derived from mapping + spec3dStyle (used by the renderers)
            heightScale3d: 0.6   // vertical exaggeration for the 3D surface
        };

        // Active preset tracking for fullscreen switcher
        this._activePresetName = null;

        // 3D orbit camera + reusable matrices
        this._cam = { az: -0.6, el: 0.42, dist: 2.3 }; // azimuth, elevation (rad), distance
        this._proj = new Float32Array(16);
        this._view = new Float32Array(16);
        this._mvp = new Float32Array(16);
        this._webgl3dOK = true;   // set false if vertex texture fetch is unsupported
        this._dragging = false;
        this._lastPointer = { x: 0, y: 0 };

        // Buffers for audio data
        this.frequencyData = null;
        this.timeData = null;
        
        // Rendering variables
        this.requestId = null;
        
        // Canvas sizing
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        
        // Initialize event listeners
        this.initEventListeners();

        // Initialize WebGL
        this.initWebGL();
        
        // Set up the canvas for high DPI displays
        this.setupHighDpiCanvas();
        
        // Set up segmented controls
        this.setupSegmentedControls();
        
        // Set up advanced range sliders
        this.setupRangeSliders();
        
        // Initial UI update
        this.updateUI();

        // Restore participant ID and render saved custom presets from localStorage
        const savedPid = localStorage.getItem('seeing_sound_participant_id');
        if (savedPid) document.getElementById('participant-id-input').value = savedPid;
        this._renderCustomPresets();

        // Rail + panel layout, stage resizing, status strip
        this.initLayout();

        // Start ambient animations
        this.startAmbientAnimations();
    }

    /**
     * Start audio capture and visualization
     */
    async start() {
        try {
            // Create audio context first - this must happen in response to a user gesture
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.settings.sampleRate = this.audioContext.sampleRate;
            
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            // Create analyser node
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = this.settings.fftSize;
            this._lastRead = null;   // smoothing is set per read in render()
            this.applyDbRange();
            
            // Create buffers for frequency data
            this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
            this.timeData = new Uint8Array(this.analyser.fftSize);
            
            // Connect microphone to analyser
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);
            
            // Resume audio context if it's suspended (needed for Chrome's autoplay policy)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            // Fresh history on the audio clock
            this.resetHistory();

            // Start visualization loop
            this.isRunning = true;
            
            // Update UI
            document.getElementById('startButton').classList.add('active');
            document.querySelector('.btn-text').textContent = 'Stop Listening';
            
            // Add "listening" class to spectrogram container
            document.querySelector('.spectrogram-container').classList.add('listening');
            
            // Start the render loop
            this.render();
            
        } catch (error) {
            console.error('Error accessing microphone:', error);
            
            // Clean up any partially initialized audio components
            if (this.microphone) {
                this.microphone.disconnect();
                this.microphone = null;
            }
            
            if (this.audioContext) {
                this.audioContext.close().catch(e => console.error('Error closing audio context:', e));
                this.audioContext = null;
            }
            
            this.analyser = null;
            
            // Show more detailed error in UI
            let errorMessage = 'Unable to access the microphone. Please ensure microphone permissions are granted.';
            
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorMessage = 'Microphone access denied. Please allow microphone access in your browser settings.';
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                errorMessage = 'No microphone detected. Please connect a microphone and try again.';
            } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
                errorMessage = 'Unable to read from microphone. The device might be in use by another application.';
            } else if (error.name === 'AbortError') {
                errorMessage = 'Microphone initialization was aborted. Please try again.';
            }
            
            this.showNotification(errorMessage, 'error');
            console.log('Detailed error info:', error.name, error.message);
        }
    }

    /**
     * Stop audio capture and visualization
     */
    stop() {
        if (this.isRunning) {
            // Stop the render loop
            if (this.requestId) {
                cancelAnimationFrame(this.requestId);
                this.requestId = null;
            }
            
            // Disconnect and close audio sources
            if (this.microphone) {
                this.microphone.disconnect();
                this.microphone = null;
            }
            
            if (this.audioContext) {
                this.audioContext.close().catch(e => console.error('Error closing audio context:', e));
                this.audioContext = null;
            }
            
            this.analyser = null;
            this.isRunning = false;
            
            // Update UI
            document.getElementById('startButton').classList.remove('active');
            document.querySelector('.btn-text').textContent = 'Start Listening';
            
            // Remove "listening" class from spectrogram container
            document.querySelector('.spectrogram-container').classList.remove('listening');
            
            // Restart ambient animations
            this.startAmbientAnimations();
        }
    }

    /**
     * Main render loop - gets audio data and draws spectrogram
     */
    render() {
        // Safety check
        if (!this.analyser || !this.frequencyData || !this.isRunning) {
            console.warn('Cannot render: audio analyser not initialized or not running');
            return;
        }
        
        try {
            // Process audio data
            // AnalyserNode smoothing is applied once per read, i.e. per animation
            // frame. Derive it from the real time since the last read so the
            // smoothing time constant is the same at any refresh rate.
            const now = performance.now() / 1000;
            const dt = this._lastRead == null ? 1 / 60 : Math.min(now - this._lastRead, 0.25);
            this._lastRead = now;
            const tauS = this.settings.smoothingMs / 1000;
            this.analyser.smoothingTimeConstant = tauS > 0 ? Math.exp(-dt / tauS) : 0;
            this.analyser.getByteFrequencyData(this.frequencyData);
            this.analyser.getByteTimeDomainData(this.timeData);
            this.trackClipping();
            
            // Render using WebGL
            this.renderWebGL();
            
            // Continue the render loop
            this.requestId = requestAnimationFrame(() => this.render());
        } catch (error) {
            console.error('Error in render loop:', error);
            // Attempt to recover by stopping and showing error
            this.stop();
            this.showNotification('Visualization error. Please try again.', 'error');
        }
    }

    renderWebGL() {
        const gl = this.gl;
        if (!gl || !this.program) return;

        // 1. Time base: columns are tied to the AUDIO clock, not to animation
        //    frames, so the time axis is the same on 60 Hz and 120 Hz screens
        //    and does not stretch when frames are dropped. One column per hop
        //    (COLUMN_RATE per second); a frame writes as many columns as are
        //    due — zero on fast screens, several after a hiccup (the current
        //    spectrum is repeated, which keeps the timing exact).
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        const bins = this.analyser.frequencyBinCount;
        const pos = (performance.now() / 1000 - this._t0) * COLUMN_RATE; // in columns, fractional
        let due = Math.floor(pos) + 1 - this._writeCount;
        if (due > this.texWidth) {                     // e.g. tab was hidden: skip ahead
            this._writeCount += due - this.texWidth;
            due = this.texWidth;
        }
        for (let k = 0; k < due; k++) {
            this.writeColumn(this._writeCount % this.texWidth, bins);
            this._writeCount++;
        }
        this.writeHead = this._writeCount % this.texWidth;

        // 2. Scroll position follows the same clock, with sub-column precision,
        //    so motion is smooth at any refresh rate. The cursor samples the
        //    centre of the column one hop back (both neighbours are written).
        let visualOffsetNorm = ((pos - 0.5) % this.texWidth) / this.texWidth;
        if (visualOffsetNorm < 0) visualOffsetNorm += 1;

        // 3. Shared uniform inputs (used by both the 2D and 3D draw paths)
        const nyquist = this.settings.sampleRate / 2;
        const heightScale = bins / this.texHeight;   // portion of the texture in use
        const scrollSpeed = SCROLL_SPEEDS[this.settings.scrollSpeed];
        const canvasWidth = this.canvas.width / window.devicePixelRatio;
        // Newest data at the edge the scroll comes from; with leftward scroll
        // that is the right edge, so stop short of the Hz label column.
        const gutter = Math.min(this._labelGutterPx || 0, canvasWidth * 0.5);
        const flip = this.settings.scrollDirection === 'right';
        const dataLo = flip ? gutter / canvasWidth : 0;          // in shader (flipped) coords
        const dataHi = flip ? 1 : 1 - gutter / canvasWidth;
        const dataPx = (dataHi - dataLo) * canvasWidth;
        const shared = {
            offset: visualOffsetNorm,
            minRatio: (this.settings.minFreq / nyquist) * heightScale,
            maxRatio: (this.settings.maxFreq / nyquist) * heightScale,
            threshold: Math.max(this.settings.noiseThreshold / 100.0, MIN_THRESHOLD),
            // 2D: data spans [dataLo, dataHi] of the width; newest at dataHi
            dataLo: dataLo,
            dataHi: dataHi,
            visibleWidthRatio: (dataPx / scrollSpeed) / this.texWidth,
            visibleSeconds: (dataPx / scrollSpeed) / COLUMN_RATE,        // age at the oldest end
            // 3D: unchanged history length
            visibleWidthRatio3d: (canvasWidth / (SCROLL_3D_FACTOR * scrollSpeed)) / this.texWidth,
            visibleSeconds3d: (canvasWidth / (SCROLL_3D_FACTOR * scrollSpeed)) / COLUMN_RATE,
            persistence: persistenceSeconds(this.settings.trailLength),
            refLevel: Math.max(this._refLevel || 0, MIN_REF_LEVEL),
            scaleMode: this.settings.scale === 'log' ? 1 : 0,
            colormapMode: { experimental: 0, viridis: 1, greyscale: 2, reversed_greyscale: 3 }[this.settings.colormap] ?? 1,
        };

        // 4. Draw with the selected view mode
        if (this.settings.viewMode !== '2d' && this.program3d) {
            this.renderWebGL3D(shared);
        } else {
            this.renderWebGL2D(shared);
        }
    }

    /** Upload one spectrum column into the history texture. */
    writeColumn(col, bins) {
        const gl = this.gl;
        const hop = 1 / COLUMN_RATE;
        const env = this.frequencyData;
        gl.texSubImage2D(gl.TEXTURE_2D, 0, col, 0, 1, bins, gl.LUMINANCE, gl.UNSIGNED_BYTE, env);

        // Reference level for ageing: the recent peak within the displayed
        // band (~0.5 s rise, ~3 s fall). Fading is measured against it, so
        // the loudest current sound lasts `persistence` seconds whatever the
        // input gain; a fixed full-scale reference made quiet voices vanish
        // within a few hundred ms, which looked like the image had stopped.
        const nyq = this.settings.sampleRate / 2;
        const i0 = Math.max(0, Math.floor(this.settings.minFreq / nyq * bins));
        const i1 = Math.min(bins, Math.ceil(this.settings.maxFreq / nyq * bins));
        let peak = 0;
        for (let i = i0; i < i1; i++) if (env[i] > peak) peak = env[i];
        const th = Math.max(this.settings.noiseThreshold / 100.0, MIN_THRESHOLD);
        const level = Math.max(0, (peak / 255 - th) / (1 - th));
        // Rise is smoothed too: an instant jump would make every older trace
        // fade faster all at once (visible "pumping")
        const r = this._refLevel == null ? level : this._refLevel;
        const tau = level > r ? PEAK_RISE_SECONDS : PEAK_RELEASE_SECONDS;
        this._refLevel = r + (1 - Math.exp(-hop / tau)) * (level - r);
    }

    /** Clear the history texture and restart the column clock (called on Start). */
    resetHistory() {
        const gl = this.gl;
        if (!gl || !this.texture) return;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.texWidth, this.texHeight, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
        this._t0 = performance.now() / 1000;
        this._writeCount = 0;
        this._refLevel = null;
        this.writeHead = 0;
    }

    createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(shader));
            return null;
        }
        return shader;
    }

    /** Push settings.minDb / maxDb to the analyser (order matters: min must stay < max). */
    applyDbRange() {
        const a = this.analyser;
        if (!a) return;
        const lo = this.settings.minDb, hi = this.settings.maxDb;
        if (lo >= a.maxDecibels) { a.maxDecibels = hi; a.minDecibels = lo; }
        else { a.minDecibels = lo; a.maxDecibels = hi; }
    }

    /**
     * Share of displayed bins sitting at 255 (i.e. louder than maxDb) over the
     * last ~0.5 s. Clipped bins all render as the same flat maximum colour.
     */
    trackClipping() {
        const d = this.frequencyData, nyq = this.settings.sampleRate / 2;
        const i0 = Math.max(0, Math.floor(this.settings.minFreq / nyq * d.length));
        const i1 = Math.min(d.length, Math.ceil(this.settings.maxFreq / nyq * d.length));
        let n = 0, active = 0;
        for (let i = i0; i < i1; i++) { if (d[i] === 255) n++; if (d[i] > 0) active++; }
        this._clipN = (this._clipN || 0) + n;
        this._clipActive = (this._clipActive || 0) + active;
        this._clipFrames = (this._clipFrames || 0) + 1;
        if (this._clipFrames >= 30) {
            const el = document.getElementById('clipReadout');
            if (el) {
                const pct = this._clipActive ? 100 * this._clipN / this._clipActive : 0;
                el.textContent = pct < 0.05 ? 'none' : `${pct.toFixed(1)}% of active bins`;
                el.classList.toggle('is-warn', pct >= 1);
            }
            this._clipN = this._clipActive = this._clipFrames = 0;
        }
    }

}
