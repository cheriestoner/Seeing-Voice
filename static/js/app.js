/**
 * Seeing Sound - A high-performance spectrogram visualization app
 * 
 * This application provides a real-time, high-resolution visualization of audio 
 * captured through the device's microphone, with a focus on performance, 
 * smoothness, and visual appeal.
 */

// Constants for visualization
const SCROLL_SPEEDS = {
    'slow': 1,
    'medium': 2,
    'fast': 3
};

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
            sampleRate: 44100 // Will be updated with actual sample rate
        };
        
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
        
        // Start ambient animations
        this.startAmbientAnimations();
    }
    
    initWebGL() {
        this.gl = this.canvas.getContext('webgl');
        if (!this.gl) {
            console.error('WebGL not supported');
            return;
        }
        const gl = this.gl;

        // Vertex Shader
        const vsSource = `
            attribute vec2 a_position;
            varying vec2 v_uv;
            void main() {
                v_uv = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0, 1);
            }
        `;

        // Fragment Shader
        const fsSource = `
            precision mediump float;
            uniform sampler2D u_texture;
            uniform float u_offset;
            uniform float u_min_freq_ratio;
            uniform float u_max_freq_ratio;
            uniform float u_threshold;
            uniform float u_visible_width;
            varying vec2 v_uv;

            vec3 getColor(float freqRatio, float amplitude) {
                // Replicate JS gradient: Deep Red -> Bright Red -> Orange -> Yellow
                vec3 c0 = vec3(0.39, 0.0, 0.0); // 100,0,0
                vec3 c1 = vec3(1.0, 0.0, 0.0);  // 255,0,0
                vec3 c2 = vec3(1.0, 0.39, 0.0); // 255,100,0
                vec3 c3 = vec3(1.0, 0.78, 0.0); // 255,200,0
                vec3 c4 = vec3(1.0, 1.0, 0.2);  // 255,255,50
                
                vec3 color;
                if (freqRatio < 0.25) {
                    color = mix(c0, c1, freqRatio * 4.0);
                } else if (freqRatio < 0.5) {
                    color = mix(c1, c2, (freqRatio - 0.25) * 4.0);
                } else if (freqRatio < 0.75) {
                    color = mix(c2, c3, (freqRatio - 0.5) * 4.0);
                } else {
                    color = mix(c3, c4, (freqRatio - 0.75) * 4.0);
                }
                
                // Amplitude brightness & Threshold
                if (amplitude < u_threshold) return vec3(0.027, 0.027, 0.067); // #070711
                
                float brightness = pow(amplitude, 0.5); // Gamma
                brightness = max(brightness, 0.05);
                
                return color * brightness;
            }

            void main() {
                // X mapping (Time Ring Buffer)
                // u_offset is the write head. We want right edge (1.0) to be u_offset.
                float x = u_offset - (1.0 - v_uv.x) * u_visible_width;
                x = fract(x);
                
                // Y mapping (Frequency Zoom)
                float y = u_min_freq_ratio + v_uv.y * (u_max_freq_ratio - u_min_freq_ratio);
                
                float amp = texture2D(u_texture, vec2(x, y)).r;
                vec3 color = getColor(v_uv.y, amp);
                
                // Simple Grid Lines
                if (mod(v_uv.y * 8.0, 1.0) < 0.02 || mod(v_uv.x * 10.0, 1.0) < 0.02) {
                    color += vec3(0.1);
                }
                
                gl_FragColor = vec4(color, 1.0);
            }
        `;

        // Compile Shaders
        const vs = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        // Buffers
        const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        
        const posLoc = gl.getAttribLocation(this.program, 'a_position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        // Texture
        this.texWidth = 2048;
        this.texHeight = 4096; // Max supported bins
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.texWidth, this.texHeight, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
        
        this.writeHead = 0;
        this.gl = gl;
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
            this.settings.minFreq = parseInt(e.target.value);
            document.getElementById('minFreqLabel').textContent = `${this.settings.minFreq} Hz`;
            this.updateRangeSliderTrack();
        });
        
        document.getElementById('maxFreq').addEventListener('input', (e) => {
            this.settings.maxFreq = parseInt(e.target.value);
            document.getElementById('maxFreqLabel').textContent = `${this.settings.maxFreq} Hz`;
            this.updateRangeSliderTrack();
        });
        
        // Frequency preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const minFreq = parseInt(e.currentTarget.dataset.min);
                const maxFreq = parseInt(e.currentTarget.dataset.max);
                
                // Add animation class
                e.currentTarget.classList.add('active');
                setTimeout(() => {
                    e.currentTarget.classList.remove('active');
                }, 300);
                
                this.settings.minFreq = minFreq;
                this.settings.maxFreq = maxFreq;
                
                // Update slider values and labels
                document.getElementById('minFreq').value = minFreq;
                document.getElementById('maxFreq').value = maxFreq;
                document.getElementById('minFreqLabel').textContent = `${minFreq} Hz`;
                document.getElementById('maxFreqLabel').textContent = `${maxFreq} Hz`;
                this.updateRangeSliderTrack();
                
                // Update the frequency scale
                this.updateFrequencyScale();
            });
        });
        
        // Noise threshold control
        document.getElementById('noiseThreshold').addEventListener('input', (e) => {
            this.settings.noiseThreshold = parseInt(e.target.value);
            const thresholdIndicator = document.querySelector('.threshold-indicator');
            thresholdIndicator.style.left = `${this.settings.noiseThreshold}%`;
            document.querySelector('.threshold-value').textContent = `${this.settings.noiseThreshold}%`;
            
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
        
        // Handle window resize
        window.addEventListener('resize', () => {
            this.setupHighDpiCanvas();
            this.updateSegmentedControlIndicators();
            this.updateRangeSliderTrack();
        });
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
        // FFT size indicator
        const fftRadio = document.querySelector(`input[name="fft-radio"][value="${this.settings.fftSize}"]:checked`);
        if (fftRadio) {
            const fftLabel = fftRadio.nextElementSibling;
            const fftIndicator = fftRadio.closest('.segmented-control').querySelector('.selection-indicator');
            
            // Position and size the indicator
            fftIndicator.style.width = `${fftLabel.offsetWidth}px`;
            fftIndicator.style.transform = `translateX(${fftLabel.offsetLeft}px)`;
        }
        
        // Scroll speed indicator
        const speedRadio = document.querySelector(`input[name="speed-radio"][value="${this.settings.scrollSpeed}"]:checked`);
        if (speedRadio) {
            const speedLabel = speedRadio.nextElementSibling;
            const speedIndicator = speedRadio.closest('.speed-control').querySelector('.selection-indicator');
            
            // Position and size the indicator
            speedIndicator.style.width = `${speedLabel.offsetWidth}px`;
            speedIndicator.style.transform = `translateX(${speedLabel.offsetLeft}px)`;
        }
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
        const minFreqInput = document.getElementById('minFreq');
        const maxFreqInput = document.getElementById('maxFreq');
        const sliderRange = document.querySelector('.slider-range');
        
        // Calculate min and max as percentages
        const max = parseInt(maxFreqInput.max);
        const minPercent = (this.settings.minFreq / max) * 100;
        const maxPercent = (this.settings.maxFreq / max) * 100;
        
        // Set the range track position and width
        sliderRange.style.left = `${minPercent}%`;
        sliderRange.style.width = `${maxPercent - minPercent}%`;
    }
    
    /**
     * Update the frequency scale labels
     */
    updateFrequencyScale() {
        const scaleLabels = document.querySelectorAll('.frequency-scale .scale-label');
        const min = this.settings.minFreq;
        const max = this.settings.maxFreq;
        const range = max - min;
        
        // Create logarithmic scale points
        const scalePoints = [];
        if (max <= 4000) {
            // Linear scale for lower frequencies
            scalePoints.push(
                max,
                max - range * 0.125,
                max - range * 0.25,
                max - range * 0.375,
                max - range * 0.5,
                max - range * 0.625,
                max - range * 0.75,
                min
            );
        } else if (max <= 20000) {
            // Log scale for music range
            scalePoints.push(
                max,
                Math.round(max / 2),
                Math.round(max / 4),
                Math.round(max / 8),
                Math.round(max / 16),
                Math.round(max / 32),
                Math.round(max / 64),
                min
            );
        } else {
            // Ultra high range
            scalePoints.push(
                max,
                Math.round(max * 0.75),
                Math.round(max * 0.5),
                Math.round(max * 0.25),
                20000,
                10000,
                5000,
                min
            );
        }
        
        // Update labels
        scaleLabels.forEach((label, i) => {
            const value = scalePoints[i];
            if (value >= 1000) {
                label.textContent = `${value / 1000} kHz`;
            } else {
                label.textContent = `${value} Hz`;
            }
            
            // Add special highlighting for the 1/4 point
            if (value >= min + range * 0.24 && value <= min + range * 0.26) {
                label.classList.add('highlight');
            } else {
                label.classList.remove('highlight');
            }
        });
    }
    
    /**
     * Update the noise visualization
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
        
        // Get the CSS size of the canvas
        const rect = this.canvas.getBoundingClientRect();
        
        // Set the canvas dimensions accounting for the device pixel ratio
        this.canvasWidth = rect.width * dpr;
        this.canvasHeight = rect.height * dpr;
        
        this.canvas.width = this.canvasWidth;
        this.canvas.height = this.canvasHeight;
        
        // Update WebGL viewport
        if (this.gl) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // Set the canvas backing store size to match CSS size
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
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
     * Get color based on frequency and amplitude
     * @param {number} freqIndex - Index of the frequency bin
     * @param {number} totalBins - Total number of frequency bins
     * @param {number} amplitude - Amplitude value (0-255) to control brightness
     * @param {number} minFreq - Minimum frequency of the current range
     * @param {number} maxFreq - Maximum frequency of the current range
     * @returns {string} - RGB color string
     */
    getColorForFrequency(freqIndex, totalBins, amplitude, minFreq, maxFreq) {
        // Calculate the actual frequency this bin represents
        const binWidth = (maxFreq - minFreq) / totalBins;
        const frequency = minFreq + (freqIndex * binWidth);
        
        // Calculate the frequency position relative to the full range
        const totalRange = maxFreq - minFreq;
        const quarterPoint = minFreq + (totalRange / 4);
        const halfPoint = minFreq + (totalRange / 2);
        const threeQuarterPoint = minFreq + (3 * totalRange / 4);
        
        // Base colors for the gradient (deep red to bright yellow)
        let r, g, b;
        
        if (frequency < quarterPoint) {
            // Deep red to bright red (increase red)
            const t = (frequency - minFreq) / (quarterPoint - minFreq);
            r = 100 + t * 155; // 100 to 255
            g = 0;
            b = 0;
        } else if (frequency < halfPoint) {
            // Bright red to red-orange (increase green)
            const t = (frequency - quarterPoint) / (halfPoint - quarterPoint);
            r = 255;
            g = t * 100; // 0 to 100
            b = 0;
        } else if (frequency < threeQuarterPoint) {
            // Red-orange to orange (increase green more)
            const t = (frequency - halfPoint) / (threeQuarterPoint - halfPoint);
            r = 255;
            g = 100 + t * 100; // 100 to 200
            b = 0;
        } else {
            // Orange to bright yellow (increase green to max)
            const t = (frequency - threeQuarterPoint) / (maxFreq - threeQuarterPoint);
            r = 255;
            g = 200 + t * 55; // 200 to 255
            b = t * 50; // 0 to 50
        }
        
        // Adjust brightness based on amplitude (0-255)
        // Apply a more dramatic curve to amplitudes to make the visualization more sensitive
        // and reduce low-amplitude visibility
        
        // Apply a quadratic curve to make medium amplitudes brighter
        // and low amplitudes even dimmer
        // let brightnessMultiplier;
        
        // if (amplitude < 80) {
        //     // Very low amplitudes (0-80) - keep them very dim
        //     brightnessMultiplier = Math.max(0.05, (amplitude / 80) * 0.3);
        // } else if (amplitude < 160) {
        //     // Medium-low amplitudes (80-160) - transition to brighter
        //     const t = (amplitude - 80) / 80;
        //     brightnessMultiplier = 0.3 + (t * 0.4); // 0.3 to 0.7
        // } else {
        //     // Higher amplitudes (160-255) - bright
        //     const t = (amplitude - 160) / 95;
        //     brightnessMultiplier = 0.7 + (t * 0.3); // 0.7 to 1.0
        // }
        
        // r = Math.floor(r * brightnessMultiplier);
        // g = Math.floor(g * brightnessMultiplier);
        // b = Math.floor(b * brightnessMultiplier);
        
        // return `rgb(${r}, ${g}, ${b})`;

        // Gamma correction approach
        // Normalize amplitude (0-255) to 0-1
        let normAmp = amplitude / 255;

        // Optional: apply a gamma curve for perceptual brightness
        const gamma = 0.5; // tweak 0.4-0.6
        let brightnessMultiplier = Math.pow(normAmp, gamma);

        // Minimum brightness to avoid full black
        brightnessMultiplier = Math.max(brightnessMultiplier, 0.05);

        r = Math.floor(r * brightnessMultiplier);
        g = Math.floor(g * brightnessMultiplier);
        b = Math.floor(b * brightnessMultiplier);

        return `rgb(${r}, ${g}, ${b})`;
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
     * Show notification
     */
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-icon">
                    ${type === 'error' ? '⚠️' : 'ℹ️'}
                </span>
                <span class="notification-message">${message}</span>
            </div>
            <button class="notification-close">✕</button>
        `;
        
        // Add to page
        document.body.appendChild(notification);
        
        // Setup close button
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.classList.add('notification-hiding');
            setTimeout(() => {
                notification.remove();
            }, 300);
        });
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (document.body.contains(notification)) {
                notification.classList.add('notification-hiding');
                setTimeout(() => {
                    if (document.body.contains(notification)) {
                        notification.remove();
                    }
                }, 300);
            }
        }, 5000);
        
        // Animate in
        setTimeout(() => {
            notification.classList.add('notification-visible');
        }, 10);
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

        // 1. Update Texture with new frequency data
        // We upload the full frequency data column to the current write head position
        // Note: frequencyData is Uint8Array
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        
        // We only upload the valid bins (fftSize / 2)
        const bins = this.analyser.frequencyBinCount;
        
        // Upload column. xoffset = writeHead, yoffset = 0, width = 1, height = bins
        // We need to ensure frequencyData is treated as a column. 
        // texSubImage2D expects data to match dimensions. 
        // For 1xHeight, the Uint8Array is fine.
        gl.texSubImage2D(gl.TEXTURE_2D, 0, this.writeHead, 0, 1, bins, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.frequencyData);

        // 2. Draw Quad
        gl.useProgram(this.program);
        
        // Calculate Uniforms
        const nyquist = this.settings.sampleRate / 2;
        const minRatio = this.settings.minFreq / nyquist;
        const maxRatio = this.settings.maxFreq / nyquist;
        const threshold = this.settings.noiseThreshold / 100.0;
        
        const scrollSpeed = SCROLL_SPEEDS[this.settings.scrollSpeed];
        const canvasWidth = this.canvas.width / window.devicePixelRatio;
        
        // Calculate how much of the texture width is visible on screen
        // If scrollSpeed is 1, we show canvasWidth amount of history.
        // If scrollSpeed is 2, we show canvasWidth/2 amount of history (zoomed in time).
        const visibleHistory = canvasWidth / scrollSpeed;
        const visibleWidthRatio = visibleHistory / this.texWidth;

        gl.uniform1i(gl.getUniformLocation(this.program, 'u_texture'), 0);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_offset'), this.writeHead / this.texWidth);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_min_freq_ratio'), minRatio);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_max_freq_ratio'), maxRatio);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_threshold'), threshold);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_visible_width'), visibleWidthRatio);
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // 3. Advance Write Head
        this.writeHead = (this.writeHead + 1) % this.texWidth;
    }
    
    /**
     * Draw subtle grid lines on the spectrogram
     */
    drawGridLines(width, height) {
        // Set line style
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        this.ctx.lineWidth = 1;
        
        // Draw horizontal frequency lines
        const freqDivisions = 8;
        this.ctx.beginPath();
        for (let i = 1; i < freqDivisions; i++) {
            const y = (i / freqDivisions) * height;
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(width, y);
        }
        
        // Draw vertical time lines
        const timeDivisions = 10;
        for (let i = 1; i < timeDivisions; i++) {
            const x = (i / timeDivisions) * width;
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, height);
        }
        
        this.ctx.stroke();
    }
    
    /**
     * Update UI elements based on current settings
     */
    updateUI() {
        // Update FFT size radio buttons
        document.querySelector(`input[name="fft-radio"][value="${this.settings.fftSize}"]`).checked = true;
        
        // Update frequency range
        document.getElementById('minFreq').value = this.settings.minFreq;
        document.getElementById('maxFreq').value = this.settings.maxFreq;
        document.getElementById('minFreqLabel').textContent = `${this.settings.minFreq} Hz`;
        document.getElementById('maxFreqLabel').textContent = `${this.settings.maxFreq} Hz`;
        
        // Update noise threshold
        document.getElementById('noiseThreshold').value = this.settings.noiseThreshold;
        document.querySelector('.threshold-indicator').style.left = `${this.settings.noiseThreshold}%`;
        document.querySelector('.threshold-value').textContent = `${this.settings.noiseThreshold}%`;
        
        // Update scroll speed
        document.querySelector(`input[name="speed-radio"][value="${this.settings.scrollSpeed}"]`).checked = true;
        
        // Update various UI elements
        this.updateSegmentedControlIndicators();
        this.updateRangeSliderTrack();
        this.updateFrequencyScale();
    }
}

// Initialize the app when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Check for necessary browser support
    if (!window.AudioContext && !window.webkitAudioContext) {
        alert('Your browser does not support the Web Audio API. Please try using a modern browser like Chrome, Firefox, or Edge.');
        return;
    }
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support accessing the microphone. Please try using a modern browser like Chrome, Firefox, or Edge.');
        return;
    }
    
    // Add CSS for notifications
    const style = document.createElement('style');
    style.textContent = `
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            backdrop-filter: blur(10px);
            border-left: 4px solid #ff3c00;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: space-between;
            max-width: 400px;
            transform: translateX(120%);
            opacity: 0;
            transition: transform 0.3s ease, opacity 0.3s ease;
        }
        
        .notification.notification-visible {
            transform: translateX(0);
            opacity: 1;
        }
        
        .notification.notification-hiding {
            transform: translateX(120%);
            opacity: 0;
        }
        
        .notification-content {
            display: flex;
            align-items: center;
        }
        
        .notification-icon {
            margin-right: 12px;
        }
        
        .notification-close {
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.7);
            cursor: pointer;
            font-size: 14px;
            padding: 4px 8px;
            margin-left: 12px;
            transition: color 0.2s ease;
        }
        
        .notification-close:hover {
            color: white;
        }
        
        .notification.error {
            border-left-color: #ff3333;
        }
        
        .spectrogram-container.listening {
            border-color: rgba(255, 60, 0, 0.3);
            box-shadow: 0 10px 40px rgba(255, 60, 0, 0.2);
        }
        
        .preset-btn.active {
            transform: scale(0.95);
            background-color: rgba(255, 255, 255, 0.15);
        }
        
        .scale-label.highlight {
            color: #ff3c00;
            font-weight: 600;
        }
    `;
    document.head.appendChild(style);
    
    // Create and initialize the application
    const app = new SeeingSound();
}); 