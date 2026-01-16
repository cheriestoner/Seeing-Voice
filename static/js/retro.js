/**
 * Seeing Sound - Retro-Futuristic Interface
 * Advanced acoustic visualization platform with xeno-inspired UI
 */

// Constants for visualization
const SCROLL_SPEEDS = {
    'slow': 1,
    'medium': 2,
    'fast': 3
};

// FFT sizes to match original implementation
const FFT_SIZES = {
    'low': 1024,
    'medium': 2048,
    'high': 4096
};

// Main application class
class SeeingSoundRetro {
    constructor() {
        // Visualization settings
        this.fftSize = FFT_SIZES.medium;
        this.minFreq = 0;
        this.maxFreq = 4000;
        this.noiseThreshold = 0; // Percentage (0-100) to match original
        this.scrollSpeed = 'medium';
        
        // Audio context
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.isCapturing = false;
        
        // DOM elements
        this.canvas = document.getElementById('spectrogramCanvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.scanButton = document.getElementById('scanButton');
        
        // Spectrogram data
        this.spectrogramHistory = [];
        this.historyLength = 1200; // Increased to ensure we have enough data for wider screens
        
        // System readouts
        this.timeReadout = document.querySelector('.time-readout');
        this.systemStatus = document.querySelector('.system-status');
        this.statusIndicator = document.querySelector('.status-indicator');
        this.processorReadout = document.querySelector('.processor-value');
        this.memoryReadout = document.querySelector('.memory-value');
        this.signalReadout = document.querySelector('.signal-value');
        this.noiseThresholdReadout = document.querySelector('.threshold-readout .readout-value');
        this.resolutionReadout = document.querySelector('.resolution-readout .readout-value');
        
        // Terminal effects
        this.terminalActive = false;
        
        // Initialize
        this.initialize();
    }
    
    initialize() {
        console.log('Initializing SeeingSoundRetro...');
        
        // Debug canvas element
        if (!this.canvas) {
            console.error('spectrogramCanvas element not found!');
            // Try to find by query selector
            this.canvas = document.querySelector('canvas#spectrogramCanvas');
            if (this.canvas) {
                console.log('Canvas found by querySelector');
                this.ctx = this.canvas.getContext('2d');
            } else {
                console.error('Canvas still not found by querySelector');
                alert('Error: Spectrogram canvas not found. Please check your HTML structure.');
            }
        } else {
            console.log('Canvas element found by ID');
        }
        
        // Set up the canvas for high DPI displays
        this.setupHighDpiCanvas();
        
        // Initialize system
        this.updateSystemReadouts();
        
        // Set up event listeners
        this.initEventListeners();
        
        // Setup grid overlay
        this.createGridOverlay();
        
        // Setup frequency scale
        this.updateFrequencyScale();
        
        // Setup terminal effects
        this.setupTerminalEffects();
        
        // Update UI to reflect correct default values
        this.updateDefaultValues();
        
        // Set default background color for the spectrogram
        if (this.ctx && this.canvas) {
            const dpr = window.devicePixelRatio || 1;
            const width = this.canvas.width / dpr;
            const height = this.canvas.height / dpr;
            this.ctx.fillStyle = 'rgba(4, 22, 37, 1)';
            this.ctx.fillRect(0, 0, width, height);
            console.log(`Set initial canvas background: ${width}x${height}`);
        }
    }
    
    updateDefaultValues() {
        // Ensure resolution readout shows correct initial value
        if (this.resolutionReadout) {
            this.resolutionReadout.textContent = `${this.fftSize} pt`;
        }
        
        // Ensure threshold readout shows 0%
        if (this.noiseThresholdReadout) {
            this.noiseThresholdReadout.textContent = `${this.noiseThreshold}%`;
        }
        
        // Make sure medium resolution is selected by default
        const mediumResolutionRadio = document.querySelector('input[name="resolution"][value="medium"]');
        if (mediumResolutionRadio) {
            mediumResolutionRadio.checked = true;
        }
        
        // Make sure threshold slider is set to 0
        const thresholdSlider = document.getElementById('noiseThreshold');
        if (thresholdSlider) {
            thresholdSlider.value = 0;
            
            // Update threshold line if it exists
            const thresholdLine = document.querySelector('.threshold-line');
            if (thresholdLine) {
                thresholdLine.style.left = '0%';
            }
        }
    }
    
    setupHighDpiCanvas() {
        if (!this.canvas) {
            console.error('Cannot set up high DPI canvas: canvas element not found');
            return;
        }
        
        console.log('Setting up high DPI canvas...');
        
        // Get the display pixel ratio
        const dpr = window.devicePixelRatio || 1;
        
        // Get the CSS size of the canvas
        const rect = this.canvas.getBoundingClientRect();
        
        // Log canvas dimensions
        console.log(`Canvas CSS dimensions: ${rect.width}x${rect.height}`);
        
        // Make sure the canvas fills its container
        // This ensures the canvas takes the full width of the spectrogram container
        const container = this.canvas.parentElement;
        if (container) {
            const containerRect = container.getBoundingClientRect();
            this.canvas.style.width = `${containerRect.width}px`;
            this.canvas.style.height = `${containerRect.height}px`;
            console.log(`Container dimensions: ${containerRect.width}x${containerRect.height}`);
            rect.width = containerRect.width;
            rect.height = containerRect.height;
            
            // Adjust history length based on the container width to ensure we fill the entire visible area
            this.historyLength = Math.max(1200, containerRect.width * 2);
            console.log(`Adjusted history length to ${this.historyLength}`);
        }
        
        // Set the canvas dimensions accounting for the device pixel ratio
        this.canvasWidth = rect.width * dpr;
        this.canvasHeight = rect.height * dpr;
        
        this.canvas.width = this.canvasWidth;
        this.canvas.height = this.canvasHeight;
        
        // Scale the context to ensure correct drawing operations
        this.ctx.scale(dpr, dpr);
        
        // Set the canvas backing store size to match CSS size
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        
        console.log(`Canvas set up with dimensions: ${this.canvasWidth}x${this.canvasHeight} (DPR: ${dpr})`);
    }
    
    setupTerminalEffects() {
        // Add random flicker effects for terminal components
        setInterval(() => {
            this.randomTerminalFlicker();
        }, 3000);
        
        // Initialize time readout with current time
        this.updateTimeReadout();
        setInterval(() => {
            this.updateTimeReadout();
        }, 1000);
        
        // Create random system status updates
        setInterval(() => {
            this.updateSystemReadouts();
        }, 5000);
    }
    
    updateTimeReadout() {
        if (!this.timeReadout) return;
        
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        this.timeReadout.textContent = `${hours}:${minutes}:${seconds}`;
    }
    
    updateSystemReadouts() {
        if (this.processorReadout) {
            const processorLoad = Math.floor(Math.random() * 25) + 5;
            this.processorReadout.textContent = `${processorLoad}%`;
            this.processorReadout.className = 'status-value ' + (processorLoad > 20 ? 'warning' : 'good');
        }
        
        if (this.memoryReadout) {
            const memoryUsage = Math.floor(Math.random() * 35) + 30;
            this.memoryReadout.textContent = `${memoryUsage}%`;
            this.memoryReadout.className = 'status-value ' + (memoryUsage > 60 ? 'warning' : 'good');
        }
        
        if (this.signalReadout) {
            let signalStatus = this.isCapturing ? 'ACTIVE' : 'IDLE';
            this.signalReadout.textContent = signalStatus;
            this.signalReadout.className = 'status-value ' + (this.isCapturing ? 'good' : '');
        }
    }
    
    randomTerminalFlicker() {
        // Randomly add or remove flicker classes to different elements
        const elements = [
            '.screen-dot',
            '.module-icon',
            '.screen-title',
            '.panel-title'
        ];
        
        const randomElement = elements[Math.floor(Math.random() * elements.length)];
        const el = document.querySelector(randomElement);
        
        if (el) {
            el.classList.add('flicker');
            setTimeout(() => {
                el.classList.remove('flicker');
            }, 500);
        }
    }
    
    createGridOverlay() {
        const gridOverlay = document.querySelector('.grid-overlay');
        if (!gridOverlay) return;
        
        // Create horizontal grid lines
        for (let i = 1; i <= 4; i++) {
            const line = document.createElement('div');
            line.className = 'grid-line horizontal';
            line.style.top = `${i * 20}%`;
            gridOverlay.appendChild(line);
        }
        
        // Create vertical grid lines
        for (let i = 1; i <= 5; i++) {
            const line = document.createElement('div');
            line.className = 'grid-line vertical';
            line.style.left = `${i * 20}%`;
            gridOverlay.appendChild(line);
        }
    }
    
    updateFrequencyScale() {
        const freqScale = document.querySelector('.frequency-scale');
        if (!freqScale) return;
        
        // Clear existing labels
        freqScale.innerHTML = '';
        
        const min = this.minFreq;
        const max = this.maxFreq;
        const range = max - min;
        
        // Create frequency labels based on current range
        let freqLabels = [];
        
        if (max <= 4000) {
            // Linear scale for lower frequencies
            freqLabels = [
                { freq: max, label: max >= 1000 ? `${max / 1000} kHz` : `${max} Hz` },
                { freq: max - range * 0.25, label: ((max - range * 0.25) >= 1000) ? `${(max - range * 0.25) / 1000} kHz` : `${Math.round(max - range * 0.25)} Hz` },
                { freq: max - range * 0.5, label: ((max - range * 0.5) >= 1000) ? `${(max - range * 0.5) / 1000} kHz` : `${Math.round(max - range * 0.5)} Hz` },
                { freq: max - range * 0.75, label: ((max - range * 0.75) >= 1000) ? `${(max - range * 0.75) / 1000} kHz` : `${Math.round(max - range * 0.75)} Hz` },
                { freq: min, label: min >= 1000 ? `${min / 1000} kHz` : `${min} Hz` }
            ];
        } else if (max <= 20000) {
            // Log scale for music range
            freqLabels = [
                { freq: max, label: `${max / 1000} kHz` },
                { freq: Math.round(max / 2), label: `${(max / 2) / 1000} kHz` },
                { freq: Math.round(max / 4), label: `${(max / 4) / 1000} kHz` },
                { freq: Math.round(max / 8), label: `${(max / 8) / 1000} kHz` },
                { freq: min, label: min >= 1000 ? `${min / 1000} kHz` : `${min} Hz` }
            ];
        } else {
            // Ultra high range
            freqLabels = [
                { freq: max, label: `${max / 1000} kHz` },
                { freq: Math.round(max * 0.75), label: `${(max * 0.75) / 1000} kHz` },
                { freq: Math.round(max * 0.5), label: `${(max * 0.5) / 1000} kHz` },
                { freq: Math.round(max * 0.25), label: `${(max * 0.25) / 1000} kHz` },
                { freq: min, label: min >= 1000 ? `${min / 1000} kHz` : `${min} Hz` }
            ];
        }
        
        freqLabels.forEach(item => {
            const label = document.createElement('div');
            label.className = 'scale-label';
            label.textContent = item.label;
            freqScale.appendChild(label);
            
            // Highlight the key quarter-point frequency
            if (item.freq >= min + range * 0.24 && item.freq <= min + range * 0.26) {
                label.classList.add('highlight');
            }
        });
    }
    
    initEventListeners() {
        // Listen for window resize
        window.addEventListener('resize', () => {
            this.setupHighDpiCanvas();
            this.renderSpectrogramHistory();
        });
        
        // Button listeners
        if (this.scanButton) {
            this.scanButton.addEventListener('click', () => {
                if (this.isCapturing) {
                    this.stopCapture();
                } else {
                    this.startCapture();
                }
            });
        }
        
        // Initialize segmented controls
        this.setupSegmentedControls();
        
        // Initialize range sliders
        this.setupRangeSliders();
        
        // Initialize threshold control
        this.setupThresholdControl();
    }
    
    setupSegmentedControls() {
        // Resolution (FFT Size) control
        document.querySelectorAll('input[name="resolution"]').forEach(input => {
            input.addEventListener('change', (e) => {
                const value = e.target.value;
                
                // Update FFT size based on selection
                if (FFT_SIZES[value]) {
                    this.fftSize = FFT_SIZES[value];
                    
                    if (this.analyser) {
                        this.analyser.fftSize = this.fftSize;
                    }
                    
                    // Update readout
                    if (this.resolutionReadout) {
                        this.resolutionReadout.textContent = `${this.fftSize} pt`;
                    }
                    
                    console.log(`Resolution changed to ${value}: ${this.fftSize} points`);
                }
            });
        });
        
        // Set default selection
        const mediumResolution = document.querySelector('input[name="resolution"][value="medium"]');
        if (mediumResolution) {
            mediumResolution.checked = true;
            // Trigger change event
            mediumResolution.dispatchEvent(new Event('change'));
        }
        
        // Scan rate (Scroll Speed) control
        document.querySelectorAll('input[name="scan-rate"]').forEach(input => {
            input.addEventListener('change', (e) => {
                const value = e.target.value;
                this.scrollSpeed = value;
                
                // Clear history when scroll speed changes to avoid visual artifacts
                this.spectrogramHistory = [];
                
                console.log(`Scroll speed changed to ${value}: ${SCROLL_SPEEDS[value]}`);
            });
        });
        
        // Set default scan rate
        const mediumSpeed = document.querySelector('input[name="scan-rate"][value="medium"]');
        if (mediumSpeed) {
            mediumSpeed.checked = true;
            // Trigger change event
            mediumSpeed.dispatchEvent(new Event('change'));
        }
    }
    
    setupRangeSliders() {
        // Frequency spectrum sliders
        const minFreqSlider = document.getElementById('minFreq');
        const maxFreqSlider = document.getElementById('maxFreq');
        const freqRange = document.querySelector('.freq-range');
        
        if (minFreqSlider && maxFreqSlider) {
            const updateFrequencyRange = () => {
                this.minFreq = Number(minFreqSlider.value);
                this.maxFreq = Number(maxFreqSlider.value);
                
                // Make sure min is less than max
                if (this.minFreq >= this.maxFreq) {
                    this.minFreq = this.maxFreq - 100;
                    minFreqSlider.value = this.minFreq;
                }
                
                // Update sliders visually
                const min = Number(minFreqSlider.min);
                const max = Number(maxFreqSlider.max);
                const range = max - min;
                
                const minPercent = ((this.minFreq - min) / range) * 100;
                const maxPercent = ((this.maxFreq - min) / range) * 100;
                
                if (freqRange) {
                    freqRange.style.left = `${minPercent}%`;
                    freqRange.style.width = `${maxPercent - minPercent}%`;
                }
                
                // Update scale
                this.updateFrequencyScale();
                
                // Update readout
                const readout = document.querySelector('.freq-range-readout .readout-value');
                if (readout) {
                    readout.textContent = `${this.minFreq} - ${this.maxFreq} Hz`;
                }
            };
            
            minFreqSlider.addEventListener('input', updateFrequencyRange);
            maxFreqSlider.addEventListener('input', updateFrequencyRange);
            
            // Preset buttons
            document.querySelectorAll('.neo-preset-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const minFreq = parseInt(e.currentTarget.dataset.min);
                    const maxFreq = parseInt(e.currentTarget.dataset.max);
                    
                    // Add animation class
                    e.currentTarget.classList.add('active');
                    setTimeout(() => {
                        e.currentTarget.classList.remove('active');
                    }, 300);
                    
                    this.minFreq = minFreq;
                    this.maxFreq = maxFreq;
                    
                    // Update slider values
                    minFreqSlider.value = minFreq;
                    maxFreqSlider.value = maxFreq;
                    
                    // Update UI
                    updateFrequencyRange();
                });
            });
            
            // Set initial values
            updateFrequencyRange();
        }
    }
    
    setupThresholdControl() {
        const thresholdSlider = document.getElementById('noiseThreshold');
        const thresholdLine = document.querySelector('.threshold-line');
        
        if (thresholdSlider) {
            thresholdSlider.addEventListener('input', () => {
                // Get the raw value from the slider (now 0-100)
                const rawValue = Number(thresholdSlider.value);
                
                // Store the raw percentage value
                this.noiseThreshold = rawValue;
                
                // Update threshold line position (if it exists)
                if (thresholdLine) {
                    thresholdLine.style.left = `${rawValue}%`;
                }
                
                // Update readout
                if (this.noiseThresholdReadout) {
                    this.noiseThresholdReadout.textContent = `${this.noiseThreshold}%`;
                }
                
                // Update noise visualization
                this.updateNoiseVisualization();
            });
            
            // Ensure slider starts at 0
            thresholdSlider.value = 0;
            // Trigger input event to update UI
            thresholdSlider.dispatchEvent(new Event('input'));
        } else {
            console.warn('Threshold slider element not found');
        }
    }
    
    updateNoiseVisualization() {
        const noiseBars = document.querySelectorAll('.noise-bar');
        const threshold = this.noiseThreshold;
        
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
    
    animateNoiseBars() {
        const noiseBars = document.querySelectorAll('.noise-bar');
        
        // Function to update bars with real data when available
        const updateBars = () => {
            if (this.isCapturing && this.analyser) {
                // Get frequency data
                const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                this.analyser.getByteFrequencyData(dataArray);
                
                // Calculate average levels for visual representation
                const barCount = noiseBars.length;
                const samplesPerBar = Math.floor(dataArray.length / barCount);
                
                noiseBars.forEach((bar, index) => {
                    // Get slice of data for this bar
                    const start = index * samplesPerBar;
                    const end = start + samplesPerBar;
                    let sum = 0;
                    
                    for (let i = start; i < end; i++) {
                        sum += dataArray[i];
                    }
                    
                    // Calculate average and set height
                    const average = sum / samplesPerBar;
                    const height = (average / 255) * 100;
                    
                    // Apply threshold - directly use percentage value
                    const thresholdValue = (this.noiseThreshold / 100) * 255;
                    const scaledHeight = average < thresholdValue ? 10 : height;
                    
                    // Remove animation when real data is used
                    bar.style.animation = 'none';
                    bar.style.height = `${scaledHeight}%`;
                    bar.style.opacity = average < thresholdValue ? '0.3' : '1';
                });
            } else {
                // When not capturing, restore animations
                noiseBars.forEach(bar => {
                    bar.style.animation = 'noise-animation 2s ease-in-out infinite';
                });
            }
            
            requestAnimationFrame(updateBars);
        };
        
        updateBars();
    }
    
    startCapture() {
        if (this.isCapturing) return;
        
        try {
            console.log('Starting audio capture...');
            
            // Create audio context if it doesn't exist
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                console.log('Created new audio context');
            }
            
            // Make sure audio context is running
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
                console.log('Resumed audio context');
            }
            
            // Promise chain to handle microphone access
            navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            })
            .then(stream => {
                // Create microphone source
                this.microphone = this.audioContext.createMediaStreamSource(stream);
                console.log('Microphone source created');
                
                // Create analyzer
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = this.fftSize;
                this.analyser.smoothingTimeConstant = 0.2; // Match original for smoother visualization
                console.log(`Analyzer created with FFT size: ${this.fftSize}`);
                
                // Connect microphone to analyzer
                this.microphone.connect(this.analyser);
                console.log('Microphone connected to analyzer');
                
                // Start visualization
                this.isCapturing = true;
                this.updateUI();
                this.visualize();
                console.log('Audio capture started, visualization running');
                
                // Show startup message
                this.showTerminalMessage('ACOUSTIC INPUT DETECTED', 'info');
                this.showTerminalMessage('SPECTRAL ANALYSIS INITIATED', 'info');
            })
            .catch(err => {
                console.error('Error accessing microphone:', err);
                this.showTerminalMessage('ERROR: Microphone access denied', 'error');
                this.showTerminalMessage('CHECK BROWSER PERMISSIONS', 'error');
            });
        } catch (err) {
            console.error('Error starting audio capture:', err);
            this.showTerminalMessage('ERROR: Could not initialize audio system', 'error');
        }
    }
    
    stopCapture() {
        if (!this.isCapturing) return;
        
        // Disconnect and cleanup
        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone = null;
        }
        
        // Update UI state
        this.isCapturing = false;
        this.updateUI();
        console.log('Audio capture stopped');
        
        // Show message
        this.showTerminalMessage('ACOUSTIC MONITORING TERMINATED', 'info');
    }
    
    updateUI() {
        // Update scan button state
        if (this.scanButton) {
            if (this.isCapturing) {
                this.scanButton.classList.add('active');
                this.scanButton.querySelector('.button-text').textContent = 'STOP SCAN';
            } else {
                this.scanButton.classList.remove('active');
                this.scanButton.querySelector('.button-text').textContent = 'INITIATE SCAN';
            }
        }
        
        // Update status indicator
        if (this.statusIndicator) {
            if (this.isCapturing) {
                this.statusIndicator.classList.add('online');
            } else {
                this.statusIndicator.classList.remove('online');
            }
        }
        
        // Update system status
        if (this.systemStatus) {
            this.systemStatus.textContent = this.isCapturing ? 'RECORDING' : 'STANDBY';
        }
        
        // Update footer status readouts
        this.updateSystemReadouts();
    }
    
    showTerminalMessage(message, type = 'info') {
        // Create terminal message container if it doesn't exist
        let messageContainer = document.querySelector('.terminal-messages');
        if (!messageContainer) {
            messageContainer = document.createElement('div');
            messageContainer.className = 'terminal-messages';
            messageContainer.style.position = 'absolute';
            messageContainer.style.top = '10px';
            messageContainer.style.left = '10px';
            messageContainer.style.color = 'var(--primary)';
            messageContainer.style.fontFamily = 'Share Tech Mono, monospace';
            messageContainer.style.fontSize = '0.8rem';
            messageContainer.style.zIndex = '10';
            messageContainer.style.pointerEvents = 'none';
            messageContainer.style.maxHeight = '150px';
            messageContainer.style.overflow = 'hidden';
            document.querySelector('.screen-content').appendChild(messageContainer);
        }
        
        // Create message element
        const msgElement = document.createElement('div');
        msgElement.className = `terminal-message ${type}`;
        msgElement.style.marginBottom = '5px';
        msgElement.style.opacity = '0';
        msgElement.style.transition = 'opacity 0.5s ease';
        
        if (type === 'error') {
            msgElement.style.color = 'var(--secondary)';
        }
        
        const timestamp = document.createElement('span');
        timestamp.className = 'message-timestamp';
        timestamp.style.marginRight = '8px';
        timestamp.style.opacity = '0.7';
        const now = new Date();
        timestamp.textContent = `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
        
        const content = document.createElement('span');
        content.className = 'message-content';
        content.textContent = message;
        
        msgElement.appendChild(timestamp);
        msgElement.appendChild(content);
        messageContainer.appendChild(msgElement);
        
        // Animate in
        setTimeout(() => {
            msgElement.style.opacity = '1';
        }, 10);
        
        // Auto scroll to bottom
        messageContainer.scrollTop = messageContainer.scrollHeight;
        
        // Remove old messages if too many
        const messages = messageContainer.querySelectorAll('.terminal-message');
        if (messages.length > 10) {
            messageContainer.removeChild(messages[0]);
        }
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            msgElement.style.opacity = '0';
            setTimeout(() => {
                if (messageContainer.contains(msgElement)) {
                    messageContainer.removeChild(msgElement);
                }
            }, 500);
        }, 5000);
    }
    
    visualize() {
        if (!this.isCapturing || !this.analyser || !this.ctx) {
            console.log('Cannot visualize: missing required components');
            if (!this.isCapturing) console.log('Not capturing');
            if (!this.analyser) console.log('No analyzer');
            if (!this.ctx) console.log('No canvas context');
            return;
        }
        
        // Get frequency data
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);
        
        // Debug the data
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const avg = sum / bufferLength;
        if (avg > 0) {
            console.log(`Receiving audio data. Average amplitude: ${avg.toFixed(2)}`);
        }
        
        // Update spectrogram history
        this.updateSpectrogramHistory(dataArray);
        
        // Render the spectrogram
        this.renderSpectrogramHistory();
        
        // Continue animation
        requestAnimationFrame(() => this.visualize());
    }
    
    updateSpectrogramHistory(dataArray) {
        if (!this.analyser || !this.audioContext) {
            console.log('Cannot update spectrogram history: missing audio components');
            return;
        }
        
        try {
            // Sample rate (normally 44100 Hz)
            const sampleRate = this.audioContext.sampleRate;
            
            // Calculate which bins correspond to our min and max frequencies
            const frequencyBinCount = this.analyser.frequencyBinCount;
            const nyquistFrequency = sampleRate / 2;
            
            // Calculate frequency bin width
            const binWidth = nyquistFrequency / frequencyBinCount;
            
            // Find indexes corresponding to min/max frequency
            const minIndex = Math.floor(this.minFreq / binWidth);
            const maxIndex = Math.ceil(this.maxFreq / binWidth);
            
            // Make sure we have valid indexes
            if (minIndex >= maxIndex || minIndex < 0 || maxIndex >= frequencyBinCount) {
                console.warn('Invalid frequency range indexes', {
                    minIndex,
                    maxIndex,
                    binWidth,
                    frequencyBinCount
                });
                return;
            }
            
            // Extract the frequency range we're interested in
            const relevantData = Array.from(dataArray.slice(minIndex, maxIndex + 1));
            
            // Apply noise threshold (directly use percentage value)
            const threshold = (this.noiseThreshold / 100) * 255;
            const processedData = relevantData.map(value => value < threshold ? 0 : value);
            
            // Add to history
            this.spectrogramHistory.unshift(processedData);
            
            // Limit history length
            if (this.spectrogramHistory.length > this.historyLength) {
                this.spectrogramHistory.pop();
            }
        } catch (error) {
            console.error('Error updating spectrogram history:', error);
        }
    }
    
    renderSpectrogramHistory() {
        if (!this.ctx || !this.canvas) {
            console.log('Cannot render spectrogram: canvas context or element missing');
            return;
        }
        
        const dpr = window.devicePixelRatio || 1;
        
        // Clear canvas
        const width = this.canvas.width / dpr;
        const height = this.canvas.height / dpr;
        
        this.ctx.fillStyle = 'rgba(4, 22, 37, 1)';
        this.ctx.fillRect(0, 0, width, height);
        
        // If no data, stop here
        if (this.spectrogramHistory.length === 0) {
            console.log('No spectrogram history to render');
            return;
        }
        
        // Calculate the visible width for the visualization
        const visibleWidth = width;
        
        // Calculate how many columns we can fit in the visible area
        // Divide by the scroll speed multiplier to account for different scroll speeds
        const speedValue = this.scrollSpeed;
        const multiplier = SCROLL_SPEEDS[speedValue] || 1;
        const columnsToDisplay = Math.floor(visibleWidth / multiplier);
        
        // Calculate column width based on the visible width and number of columns
        const columnWidth = visibleWidth / columnsToDisplay;
        
        console.log(`Rendering spectrogram with ${columnsToDisplay} columns, width=${width}, columnWidth=${columnWidth}`);
        
        // Draw each column of history
        for (let i = 0; i < Math.min(this.spectrogramHistory.length, columnsToDisplay); i++) {
            // Calculate x position from right edge
            const x = width - (i * columnWidth) - columnWidth;
            
            // Skip if we're out of bounds
            if (x < 0) continue;
            
            // Get the frequency data for this time slice
            // Account for scroll speed by skipping entries based on multiplier
            const historyIndex = i * multiplier;
            if (historyIndex >= this.spectrogramHistory.length) continue;
            
            const freqData = this.spectrogramHistory[historyIndex];
            
            // Check if freqData exists and has length
            if (!freqData || freqData.length === 0) {
                console.log(`Invalid frequency data at index ${historyIndex}`);
                continue;
            }
            
            // Calculate the height of each frequency bin
            const binHeight = height / freqData.length;
            
            // Draw each frequency bin as a colored rectangle
            for (let j = 0; j < freqData.length; j++) {
                const amplitude = freqData[j];
                
                // Skip drawing if amplitude is 0 (below threshold)
                if (amplitude === 0) continue;
                
                // Calculate y-position (invert to put higher frequencies at the top)
                const y = height - (j + 1) * binHeight;
                
                // Calculate the actual frequency this bin represents
                const frequency = this.minFreq + (j / freqData.length) * (this.maxFreq - this.minFreq);
                
                // Set color based on frequency and use amplitude to control brightness
                this.ctx.fillStyle = this.getColorForFrequency(frequency, amplitude);
                
                // Draw the rectangle - ensure we fill the entire column width
                this.ctx.fillRect(x, y, columnWidth, binHeight + 0.5); // +0.5 to avoid gaps
            }
        }
        
        // Apply CRT scanline effect
        this.applyScanlineEffect();
    }
    
    applyScanlineEffect() {
        const dpr = window.devicePixelRatio || 1;
        const width = this.canvas.width / dpr;
        const height = this.canvas.height / dpr;
        
        // Apply subtle scanline effect to canvas
        const scanlineHeight = 2;
        const scanlineOpacity = 0.1;
        
        this.ctx.fillStyle = `rgba(0, 0, 0, ${scanlineOpacity})`;
        
        for (let y = 0; y < height; y += scanlineHeight * 2) {
            this.ctx.fillRect(0, y, width, scanlineHeight);
        }
    }
    
    getColorForFrequency(frequency, amplitude) {
        // Normalize frequency to 0-1 range
        const normalizedFreq = (frequency - this.minFreq) / (this.maxFreq - this.minFreq);
        const normalizedAmplitude = amplitude / 255;
        
        // Calculate position relative to the quarter point for color transition
        const totalRange = this.maxFreq - this.minFreq;
        const quarterPoint = this.minFreq + (totalRange / 4);
        const halfPoint = this.minFreq + (totalRange / 2);
        const threeQuarterPoint = this.minFreq + (3 * totalRange / 4);
        
        // Non-linear color transition
        // We want a sci-fi look with cyan to purple to pink
        let r, g, b;
        
        if (frequency < quarterPoint) {
            // Lower frequencies: cyan to teal
            r = 0;
            g = Math.round(255 * (1 - (frequency - this.minFreq) / (quarterPoint - this.minFreq) * 0.3));
            b = Math.round(255);
        } else if (frequency < halfPoint) {
            // Mid-low frequencies: teal to blue
            const t = (frequency - quarterPoint) / (halfPoint - quarterPoint);
            r = 0;
            g = Math.round(255 * 0.7 * (1 - t));
            b = Math.round(255);
        } else if (frequency < threeQuarterPoint) {
            // Mid-high frequencies: blue to magenta
            const t = (frequency - halfPoint) / (threeQuarterPoint - halfPoint);
            r = Math.round(255 * t);
            g = 0;
            b = 255;
        } else {
            // High frequencies: magenta to bright white-pink
            const t = (frequency - threeQuarterPoint) / (this.maxFreq - threeQuarterPoint);
            r = 255;
            g = Math.round(255 * t * 0.7);
            b = Math.round(255 * (1 - t * 0.2));
        }
        
        // Apply non-linear amplitude mapping for better visibility
        let brightnessMultiplier;
        
        if (normalizedAmplitude < 0.3) {
            // Very low amplitudes (0-0.3) - keep them very dim
            brightnessMultiplier = Math.max(0.1, normalizedAmplitude * 0.4);
        } else if (normalizedAmplitude < 0.6) {
            // Medium-low amplitudes (0.3-0.6) - transition to brighter
            const t = (normalizedAmplitude - 0.3) / 0.3;
            brightnessMultiplier = 0.4 + (t * 0.3); // 0.4 to 0.7
        } else {
            // Higher amplitudes (0.6-1.0) - bright
            const t = (normalizedAmplitude - 0.6) / 0.4;
            brightnessMultiplier = 0.7 + (t * 0.3); // 0.7 to 1.0
        }
        
        // Add glow effect for higher amplitudes
        if (normalizedAmplitude > 0.7) {
            const boost = (normalizedAmplitude - 0.7) / 0.3;
            r = Math.min(255, r + Math.round(70 * boost));
            g = Math.min(255, g + Math.round(70 * boost));
            b = Math.min(255, b + Math.round(70 * boost));
        }
        
        r = Math.floor(r * brightnessMultiplier);
        g = Math.floor(g * brightnessMultiplier);
        b = Math.floor(b * brightnessMultiplier);
        
        return `rgb(${r}, ${g}, ${b})`;
    }
}

// Initialize the application when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing retro interface...');
    
    // Check for necessary browser support
    if (!window.AudioContext && !window.webkitAudioContext) {
        alert('Your browser does not support the Web Audio API. Please try using a modern browser like Chrome, Firefox, or Edge.');
        return;
    }
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support accessing the microphone. Please try using a modern browser like Chrome, Firefox, or Edge.');
        return;
    }
    
    // Initialize current time in status bar
    const updateClock = () => {
        const now = new Date();
        const timeElement = document.querySelector('.time-readout');
        if (timeElement) {
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            timeElement.textContent = `${hours}:${minutes}:${seconds}`;
        }
        
        setTimeout(updateClock, 1000);
    };
    
    updateClock();
    
    // Log HTML structure - to debug missing elements
    console.log('Canvas element:', document.getElementById('spectrogramCanvas'));
    console.log('Scan button:', document.getElementById('scanButton'));
    
    // Initialize the app
    window.retroApp = new SeeingSoundRetro();
    console.log('Retro interface initialized');
    
    // Add glitch effect to title
    const glitchTitle = document.querySelector('.glitch');
    if (glitchTitle) {
        glitchTitle.setAttribute('data-text', glitchTitle.textContent);
    }
    
    // Create random serial number for footer badge
    const serialElement = document.querySelector('.badge-serial');
    if (serialElement) {
        const randomSerial = `XA-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}-${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`;
        serialElement.textContent = randomSerial;
    }
    
    // Add CSS for terminal messages
    const style = document.createElement('style');
    style.textContent = `
        .terminal-messages {
            position: absolute;
            top: 10px;
            left: 10px;
            color: var(--primary);
            font-family: 'Share Tech Mono', monospace;
            font-size: 0.8rem;
            z-index: 10;
            pointer-events: none;
            max-height: 150px;
            overflow: hidden;
        }
        
        .terminal-message {
            margin-bottom: 5px;
            opacity: 0;
            transition: opacity 0.5s ease;
        }
        
        .terminal-message.error {
            color: var(--secondary);
        }
        
        .terminal-message .message-timestamp {
            margin-right: 8px;
            opacity: 0.7;
        }
    `;
    document.head.appendChild(style);
}); 