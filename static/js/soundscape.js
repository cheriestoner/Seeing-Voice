class SoundScape {
    constructor() {
        console.log('SoundScape initializing...');
        
        // Audio Context and Analysis
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.source = null;
        this.isInitialized = false;
        this.isRecording = false;

        // Canvas Elements
        this.centralCanvas = document.getElementById('particleSystemCanvas');
        this.pitchCanvas = document.getElementById('pitchCanvas');
        this.intensityCanvas = document.getElementById('intensityCanvas');
        this.timbreCanvas = document.getElementById('timbreCanvas');
        this.rhythmCanvas = document.getElementById('rhythmCanvas');
        this.harmonicsCanvas = document.getElementById('harmonicsCanvas');
        this.speechCanvas = document.getElementById('speechCanvas');

        console.log('Canvas elements:', {
            centralCanvas: this.centralCanvas,
            pitchCanvas: this.pitchCanvas,
            intensityCanvas: this.intensityCanvas,
            timbreCanvas: this.timbreCanvas,
            rhythmCanvas: this.rhythmCanvas,
            harmonicsCanvas: this.harmonicsCanvas,
            speechCanvas: this.speechCanvas
        });

        // Analysis Parameters
        this.fftSize = 2048;
        this.smoothingTimeConstant = 0.8;
        
        // Particle System
        this.particles = [];
        this.maxParticles = 1000;
        
        // Pattern Recognition
        this.patterns = new Map();
        this.currentPattern = [];
        
        // Speech Detection
        this.speechRecognition = null;
        if ('webkitSpeechRecognition' in window) {
            this.speechRecognition = new webkitSpeechRecognition();
            this.setupSpeechRecognition();
        }

        // Accessibility Settings
        this.accessibilitySettings = {
            highContrast: false,
            reducedMotion: false,
            colorblindMode: false
        };

        // Bind methods
        this.animate = this.animate.bind(this);
        this.handleResize = this.handleResize.bind(this);
        
        // Initialize
        this.setupEventListeners();
        this.initializeCanvases();
        
        console.log('SoundScape initialized');
    }

    async initialize() {
        console.log('Starting audio initialization...');
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('AudioContext created:', this.audioContext);
            
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = this.fftSize;
            this.analyser.smoothingTimeConstant = this.smoothingTimeConstant;
            console.log('Analyser created:', this.analyser);
            
            this.dataArray = new Float32Array(this.analyser.frequencyBinCount);
            console.log('Data array created, length:', this.dataArray.length);
            
            console.log('Requesting microphone access...');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('Microphone access granted, stream:', stream);
            
            this.source = this.audioContext.createMediaStreamSource(stream);
            console.log('Media stream source created:', this.source);
            
            this.source.connect(this.analyser);
            console.log('Source connected to analyser');
            
            this.isInitialized = true;
            console.log('Audio system initialized, starting visualization');
            
            this.startVisualization();
            
            // Update UI to show recording is active
            const sourceIndicator = document.querySelector('.source-indicator');
            const sourceText = document.querySelector('.source-text');
            if (sourceIndicator) {
                sourceIndicator.classList.add('active');
            }
            if (sourceText) {
                sourceText.textContent = 'Sound Detected';
            }
            
        } catch (error) {
            console.error('Error initializing audio:', error);
            this.showError('Could not access microphone. Please check permissions.');
        }
    }

    setupSpeechRecognition() {
        this.speechRecognition.continuous = true;
        this.speechRecognition.interimResults = true;
        
        this.speechRecognition.onresult = (event) => {
            const results = Array.from(event.results).map(result => ({
                transcript: result[0].transcript,
                confidence: result[0].confidence
            }));
            this.updateSpeechVisualization(results);
        };
    }

    startVisualization() {
        if (!this.isInitialized) return;
        requestAnimationFrame(this.animate);
    }

    animate() {
        this.analyser.getFloatFrequencyData(this.dataArray);
        
        this.updateParticleSystem();
        this.renderPitch();
        this.renderIntensity();
        this.renderTimbre();
        this.renderRhythm();
        this.renderHarmonics();
        this.detectPatterns();
        
        requestAnimationFrame(this.animate);
    }

    updateParticleSystem() {
        const ctx = this.centralCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.centralCanvas.width, this.centralCanvas.height);

        // Create new particles based on audio data
        if (this.particles.length < this.maxParticles) {
            const intensity = this.calculateAverageIntensity();
            if (intensity > -50) { // Threshold for particle creation
                this.particles.push(this.createParticle(intensity));
            }
        }

        // Update and render particles
        this.particles = this.particles.filter(particle => {
            particle.update();
            particle.render(ctx);
            return particle.life > 0;
        });
    }

    createParticle(intensity) {
        return {
            x: this.centralCanvas.width / 2,
            y: this.centralCanvas.height / 2,
            size: Math.random() * 5 + 2,
            life: 1.0,
            color: this.getColorFromIntensity(intensity),
            velocity: {
                x: (Math.random() - 0.5) * 3,
                y: (Math.random() - 0.5) * 3
            },
            update() {
                this.x += this.velocity.x;
                this.y += this.velocity.y;
                this.life -= 0.01;
            },
            render(ctx) {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fillStyle = `${this.color}${Math.floor(this.life * 255).toString(16).padStart(2, '0')}`;
                ctx.fill();
            }
        };
    }

    renderPitch() {
        const ctx = this.pitchCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.pitchCanvas.width, this.pitchCanvas.height);
        
        // Implement pitch detection using autocorrelation
        const pitchData = this.detectPitch();
        this.visualizePitch(ctx, pitchData);
    }

    renderIntensity() {
        const ctx = this.intensityCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.intensityCanvas.width, this.intensityCanvas.height);
        
        const intensity = this.calculateAverageIntensity();
        this.visualizeIntensity(ctx, intensity);
    }

    renderTimbre() {
        const ctx = this.timbreCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.timbreCanvas.width, this.timbreCanvas.height);
        
        const spectralCentroid = this.calculateSpectralCentroid();
        const spectralSpread = this.calculateSpectralSpread();
        this.visualizeTimbre(ctx, spectralCentroid, spectralSpread);
    }

    renderRhythm() {
        const ctx = this.rhythmCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.rhythmCanvas.width, this.rhythmCanvas.height);
        
        const onsets = this.detectOnsets();
        const tempo = this.estimateTempo(onsets);
        this.visualizeRhythm(ctx, onsets, tempo);
    }

    renderHarmonics() {
        const ctx = this.harmonicsCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.harmonicsCanvas.width, this.harmonicsCanvas.height);
        
        const harmonics = this.detectHarmonics();
        this.visualizeHarmonics(ctx, harmonics);
    }

    detectPitch() {
        // Implement YIN pitch detection algorithm
        const buffer = new Float32Array(this.analyser.frequencyBinCount);
        this.analyser.getFloatTimeDomainData(buffer);
        
        const threshold = 0.1;
        let minIndex = 0;
        let minValue = Infinity;
        
        for (let tau = 0; tau < buffer.length / 2; tau++) {
            let difference = 0;
            for (let i = 0; i < buffer.length - tau; i++) {
                difference += Math.pow(buffer[i] - buffer[i + tau], 2);
            }
            if (difference < minValue) {
                minValue = difference;
                minIndex = tau;
            }
            if (difference < threshold) {
                break;
            }
        }
        
        return this.audioContext.sampleRate / minIndex;
    }

    calculateAverageIntensity() {
        return this.dataArray.reduce((sum, value) => sum + value, 0) / this.dataArray.length;
    }

    calculateSpectralCentroid() {
        let numerator = 0;
        let denominator = 0;
        
        for (let i = 0; i < this.dataArray.length; i++) {
            const amplitude = Math.pow(10, this.dataArray[i] / 20);
            numerator += (i + 1) * amplitude;
            denominator += amplitude;
        }
        
        return numerator / denominator;
    }

    detectOnsets() {
        // Implement onset detection using energy flux
        const buffer = new Float32Array(this.analyser.frequencyBinCount);
        this.analyser.getFloatTimeDomainData(buffer);
        
        const onsets = [];
        let previousEnergy = 0;
        
        for (let i = 0; i < buffer.length - 1024; i += 1024) {
            const energy = buffer.slice(i, i + 1024).reduce((sum, value) => sum + value * value, 0);
            if (energy > previousEnergy * 1.5) {
                onsets.push(i / this.audioContext.sampleRate);
            }
            previousEnergy = energy;
        }
        
        return onsets;
    }

    detectHarmonics() {
        // Implement harmonic detection using peak picking
        const harmonics = [];
        const fundamentalFreq = this.detectPitch();
        
        for (let i = 1; i <= 8; i++) {
            const expectedFreq = fundamentalFreq * i;
            const index = Math.round(expectedFreq * this.fftSize / this.audioContext.sampleRate);
            
            if (index < this.dataArray.length) {
                harmonics.push({
                    frequency: expectedFreq,
                    magnitude: this.dataArray[index]
                });
            }
        }
        
        return harmonics;
    }

    detectPatterns() {
        // Implement pattern detection using dynamic time warping
        const currentFrame = Array.from(this.dataArray);
        this.currentPattern.push(currentFrame);
        
        if (this.currentPattern.length > 50) {
            this.currentPattern.shift();
        }
        
        this.patterns.forEach((pattern, name) => {
            const distance = this.calculateDTWDistance(this.currentPattern, pattern);
            if (distance < 10) {
                this.onPatternDetected(name);
            }
        });
    }

    calculateDTWDistance(pattern1, pattern2) {
        const m = pattern1.length;
        const n = pattern2.length;
        const dtw = Array(m + 1).fill().map(() => Array(n + 1).fill(Infinity));
        dtw[0][0] = 0;
        
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = Math.abs(pattern1[i-1] - pattern2[j-1]);
                dtw[i][j] = cost + Math.min(dtw[i-1][j], dtw[i][j-1], dtw[i-1][j-1]);
            }
        }
        
        return dtw[m][n];
    }

    onPatternDetected(patternName) {
        const event = new CustomEvent('patternDetected', {
            detail: { pattern: patternName }
        });
        window.dispatchEvent(event);
    }

    setupEventListeners() {
        console.log('Setting up event listeners');
        window.addEventListener('resize', this.handleResize);
        
        // Session Controls
        const startButton = document.getElementById('startButton');
        console.log('Start button element:', startButton);
        
        if (startButton) {
            startButton.addEventListener('click', () => {
                console.log('Start button clicked');
                
                // Toggle recording state
                if (!this.isRecording) {
                    console.log('Starting recording...');
                    this.initialize();
                    startButton.classList.add('active');
                    startButton.querySelector('.button-text').textContent = 'Stop Listening';
                    this.isRecording = true;
                } else {
                    console.log('Stopping recording...');
                    this.stop();
                    startButton.classList.remove('active');
                    startButton.querySelector('.button-text').textContent = 'Start Listening';
                    this.isRecording = false;
                    
                    // Update UI to show recording is stopped
                    const sourceIndicator = document.querySelector('.source-indicator');
                    const sourceText = document.querySelector('.source-text');
                    if (sourceIndicator) {
                        sourceIndicator.classList.remove('active');
                    }
                    if (sourceText) {
                        sourceText.textContent = 'No Sound Detected';
                    }
                }
            });
        } else {
            console.error('Start button not found in the DOM');
        }
        
        // Modal Controls
        const infoButton = document.getElementById('infoButton');
        const accessibilityButton = document.getElementById('accessibilityButton');
        
        if (infoButton) {
            infoButton.addEventListener('click', () => {
                console.log('Info button clicked');
                document.querySelector('.info-modal').style.display = 'flex';
            });
        }
        
        if (accessibilityButton) {
            accessibilityButton.addEventListener('click', () => {
                console.log('Accessibility button clicked');
                document.querySelector('.accessibility-modal').style.display = 'flex';
            });
        }
        
        // Close modals
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => {
                console.log('Close modal button clicked');
                document.querySelectorAll('.modal').forEach(modal => {
                    modal.style.display = 'none';
                });
            });
        });
        
        // Accessibility Controls
        const highContrastToggle = document.getElementById('highContrast');
        const reduceMotionToggle = document.getElementById('reduceMotion');
        const colorSchemeSelect = document.getElementById('colorScheme');
        
        if (highContrastToggle) {
            highContrastToggle.addEventListener('change', (e) => {
                console.log('High contrast toggled:', e.target.checked);
                this.accessibilitySettings.highContrast = e.target.checked;
                this.applyAccessibilitySettings();
            });
        }
        
        if (reduceMotionToggle) {
            reduceMotionToggle.addEventListener('change', (e) => {
                console.log('Reduce motion toggled:', e.target.checked);
                this.accessibilitySettings.reducedMotion = e.target.checked;
                this.applyAccessibilitySettings();
            });
        }
        
        if (colorSchemeSelect) {
            colorSchemeSelect.addEventListener('change', (e) => {
                console.log('Color scheme changed:', e.target.value);
                document.body.dataset.colorScheme = e.target.value;
            });
        }
    }

    handleResize() {
        this.initializeCanvases();
    }

    initializeCanvases() {
        console.log('Initializing canvases');
        const canvases = [
            this.centralCanvas,
            this.pitchCanvas,
            this.intensityCanvas,
            this.timbreCanvas,
            this.rhythmCanvas,
            this.harmonicsCanvas,
            this.speechCanvas
        ];
        
        canvases.forEach(canvas => {
            if (!canvas) {
                console.warn('Canvas element not found in DOM');
                return;
            }
            console.log(`Initializing canvas: ${canvas.id}, parent:`, canvas.parentElement);
            try {
                const container = canvas.parentElement;
                canvas.width = container.clientWidth || 300;
                canvas.height = container.clientHeight || 150;
                console.log(`Canvas ${canvas.id} dimensions set to: ${canvas.width}x${canvas.height}`);
                
                // Draw an initial blank state with a border to show the canvas is working
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.textAlign = 'center';
                ctx.font = '12px Arial';
                ctx.fillText('Waiting for audio...', canvas.width / 2, canvas.height / 2);
            } catch (error) {
                console.error(`Error initializing canvas ${canvas.id}:`, error);
            }
        });
    }

    applyAccessibilitySettings() {
        document.body.classList.toggle('high-contrast', this.accessibilitySettings.highContrast);
        document.body.classList.toggle('reduced-motion', this.accessibilitySettings.reducedMotion);
        document.body.classList.toggle('colorblind-mode', this.accessibilitySettings.colorblindMode);
    }

    stop() {
        if (this.source) {
            this.source.disconnect();
        }
        if (this.audioContext) {
            this.audioContext.close();
        }
        this.isInitialized = false;
        this.isRecording = false;
    }

    showError(message) {
        const errorModal = document.getElementById('errorModal');
        const errorMessage = document.getElementById('errorMessage');
        errorMessage.textContent = message;
        errorModal.style.display = 'block';
    }

    getColorFromIntensity(intensity) {
        // Map intensity to color using HSL
        const hue = Math.max(0, Math.min(240, (intensity + 100) * 2.4));
        return `hsl(${hue}, 100%, 50%)`;
    }

    visualizePitch(ctx, pitch) {
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        
        // Clear previous frame with a fade effect
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(0, 0, width, height);
        
        // Map pitch to visual height (logarithmic scale)
        const minPitch = 20; // Hz
        const maxPitch = 2000; // Hz
        const normalizedPitch = (Math.log(pitch) - Math.log(minPitch)) / (Math.log(maxPitch) - Math.log(minPitch));
        const y = height - (normalizedPitch * height);
        
        // Draw pitch line
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.strokeStyle = this.accessibilitySettings.colorblindMode ? '#FFB800' : '#3a86ff';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Add pitch value label
        ctx.fillStyle = '#fff';
        ctx.font = '16px monospace';
        ctx.fillText(`${Math.round(pitch)}Hz`, 10, 20);
    }

    visualizeIntensity(ctx, intensity) {
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        
        // Map intensity to height (dB scale)
        const normalizedIntensity = (intensity + 100) / 100; // Normalize from typical dB range
        const barHeight = height * normalizedIntensity;
        
        // Draw intensity bar
        const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
        gradient.addColorStop(0, this.accessibilitySettings.colorblindMode ? '#FFB800' : '#ff006e');
        gradient.addColorStop(1, this.accessibilitySettings.colorblindMode ? '#FF8300' : '#ff758f');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, height - barHeight, width, barHeight);
        
        // Add intensity value label
        ctx.fillStyle = '#fff';
        ctx.font = '16px monospace';
        ctx.fillText(`${Math.round(intensity)}dB`, 10, 20);
    }

    visualizeTimbre(ctx, centroid, spread) {
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        
        // Create a circular visualization
        const centerX = width / 2;
        const centerY = height / 2;
        const maxRadius = Math.min(width, height) / 3;
        
        // Map centroid and spread to visual properties
        const angle = (centroid / 1000) * Math.PI * 2;
        const radius = (spread / 1000) * maxRadius;
        
        // Draw background circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Draw timbre point
        ctx.beginPath();
        ctx.arc(
            centerX + Math.cos(angle) * radius,
            centerY + Math.sin(angle) * radius,
            5, 0, Math.PI * 2
        );
        ctx.fillStyle = this.accessibilitySettings.colorblindMode ? '#FFB800' : '#8338ec';
        ctx.fill();
        
        // Connect to center with line
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
        ctx.strokeStyle = this.accessibilitySettings.colorblindMode ? '#FF8300' : '#8338ec';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    visualizeRhythm(ctx, onsets, tempo) {
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        
        // Clear with fade effect
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(0, 0, width, height);
        
        // Draw tempo indicator
        const tempoX = (tempo / 200) * width; // Map tempo up to 200 BPM
        ctx.beginPath();
        ctx.moveTo(tempoX, 0);
        ctx.lineTo(tempoX, height);
        ctx.strokeStyle = this.accessibilitySettings.colorblindMode ? '#FFB800' : '#fb5607';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Draw onset markers
        onsets.forEach(onset => {
            const x = (onset % 2) * width; // Loop every 2 seconds
            ctx.beginPath();
            ctx.arc(x, height/2, 5, 0, Math.PI * 2);
            ctx.fillStyle = this.accessibilitySettings.colorblindMode ? '#FF8300' : '#fb5607';
            ctx.fill();
        });
        
        // Add tempo label
        ctx.fillStyle = '#fff';
        ctx.font = '16px monospace';
        ctx.fillText(`${Math.round(tempo)} BPM`, 10, 20);
    }

    visualizeHarmonics(ctx, harmonics) {
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        // Draw frequency spectrum
        const barWidth = width / harmonics.length;
        const baseColor = this.accessibilitySettings.colorblindMode ? '#FFB800' : '#ffbe0b';
        
        harmonics.forEach((harmonic, i) => {
            // Normalize magnitude to height
            const normalizedMagnitude = (harmonic.magnitude + 100) / 100;
            const barHeight = height * normalizedMagnitude;
            
            // Create gradient for each bar
            const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
            gradient.addColorStop(0, baseColor);
            gradient.addColorStop(1, this.accessibilitySettings.colorblindMode ? '#FF8300' : '#ffd60a');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(i * barWidth, height - barHeight, barWidth * 0.8, barHeight);
            
            // Add frequency label
            if (i === 0) {
                ctx.fillStyle = '#fff';
                ctx.font = '12px monospace';
                ctx.fillText(`${Math.round(harmonic.frequency)}Hz`, i * barWidth, height - barHeight - 5);
            }
        });
    }

    estimateTempo(onsets) {
        if (onsets.length < 2) return 0;
        
        // Calculate intervals between onsets
        const intervals = [];
        for (let i = 1; i < onsets.length; i++) {
            intervals.push(onsets[i] - onsets[i-1]);
        }
        
        // Find the most common interval (tempo)
        const averageInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
        return Math.round(60 / averageInterval); // Convert to BPM
    }

    calculateSpectralSpread() {
        const centroid = this.calculateSpectralCentroid();
        let numerator = 0;
        let denominator = 0;
        
        for (let i = 0; i < this.dataArray.length; i++) {
            const amplitude = Math.pow(10, this.dataArray[i] / 20);
            numerator += Math.pow((i + 1) - centroid, 2) * amplitude;
            denominator += amplitude;
        }
        
        return Math.sqrt(numerator / denominator);
    }

    updateSpeechVisualization(results) {
        // Update UI with speech recognition results
        const speechContainer = document.getElementById('speechRecognition');
        if (!speechContainer) return;
        
        speechContainer.innerHTML = results
            .map(result => `
                <div class="speech-result" style="opacity: ${result.confidence}">
                    ${result.transcript}
                </div>
            `)
            .join('');
    }
}

// Initialize SoundScape when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.soundscape = new SoundScape();
}); 