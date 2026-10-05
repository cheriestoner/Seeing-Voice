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
            trailLength: 0.33,   // 0 = short trail, 1 = long trail
            boostIntensity: 2.5, // flash brightness at cursor edge (0 = off)
            viewMode: '2d',      // '2d' | 'surface' | 'wireframe'
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
            this.analyser.smoothingTimeConstant = 0.2;
            
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
            this.analyser.getByteFrequencyData(this.frequencyData);
            this.analyser.getByteTimeDomainData(this.timeData);
            
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

        // 1. Upload the new frequency column at the current write head
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        const bins = this.analyser.frequencyBinCount;
        gl.texSubImage2D(gl.TEXTURE_2D, 0, this.writeHead, 0, 1, bins, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.frequencyData);

        // 2. Visual scroll offset: data still arrives exactly one column per
        // frame (unchanged, above), but the ON-SCREEN scroll position is
        // driven by its own accumulator with a slow, naturally-varying speed
        // instead of a metronome-perfect +1 texel every single frame. A
        // constant, frame-locked advance reads as machine-clocked motion,
        // since real sound has no such perfectly regular time base. A gentle
        // pull-back term keeps this from drifting away from the actual write
        // position over time, so it stays visually in sync with the data.
        const nowSec = performance.now() / 1000;
        const speedNoise = this._organicNoise(nowSec, 0.4); // slow ~0.4s wiggle, range [-1, 1]
        const speedMul = 1.0 + speedNoise * 0.08;           // +/-8% speed variation
        const drift = this._writeCount - this._visualOffsetTexels;
        this._visualOffsetTexels += speedMul + drift * 0.02; // small correction keeps it synced
        this._writeCount += 1;
        this.writeHead = this._writeCount % this.texWidth;

        let visualOffsetNorm = (this._visualOffsetTexels % this.texWidth) / this.texWidth;
        if (visualOffsetNorm < 0) visualOffsetNorm += 1;

        // 3. Shared uniform inputs (used by both the 2D and 3D draw paths)
        const nyquist = this.settings.sampleRate / 2;
        const heightScale = bins / this.texHeight;   // portion of the texture in use
        const scrollSpeed = SCROLL_SPEEDS[this.settings.scrollSpeed];
        const canvasWidth = this.canvas.width / window.devicePixelRatio;
        const shared = {
            offset: visualOffsetNorm,
            minRatio: (this.settings.minFreq / nyquist) * heightScale,
            maxRatio: (this.settings.maxFreq / nyquist) * heightScale,
            threshold: Math.max(this.settings.noiseThreshold / 100.0, MIN_THRESHOLD),
            visibleWidthRatio: (canvasWidth / scrollSpeed) / this.texWidth,
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

    /**
     * Smoothly-interpolated 1D value noise (not per-call random — adjacent
     * samples in time are correlated), used to give the scroll speed a slow,
     * organic "breathing" variation instead of a perfectly constant rate.
     * Returns a value in [-1, 1]. `period` is the wiggle period in seconds.
     */
    _organicNoise(tSeconds, period) {
        const idx = tSeconds / period;
        const i0 = Math.floor(idx);
        const i1 = i0 + 1;
        const f = idx - i0;
        const s = f * f * (3 - 2 * f); // smoothstep easing between keyframes
        const rand = (i) => {
            const x = Math.sin(i * 12.9898) * 43758.5453;
            return (x - Math.floor(x)) * 2 - 1;
        };
        return rand(i0) + (rand(i1) - rand(i0)) * s;
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
}
