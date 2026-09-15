/**
 * Seeing Sound - A high-performance spectrogram visualization app
 * 
 * This application provides a real-time, high-resolution visualization of audio 
 * captured through the device's microphone, with a focus on performance, 
 * smoothness, and visual appeal.
 */

// Constants for visualization
const MIN_THRESHOLD = 3e-3; // Minimum shader threshold — prevents near-silent pixels from showing palette color
const CURSOR_X = 0.67;      // Horizontal position of the newest-data cursor (0 = left, 1 = right)

const SCROLL_SPEEDS = {
    'slow': 3,
    'medium': 6,
    'fast': 12
};

const PRESETS = {
  default: { scale: 'linear', ceiling: 4000,  minFreq: 0,  maxFreq: 4000  },
  music:   { scale: 'log',    ceiling: 22050, minFreq: 20, maxFreq: 20000 },
};

// Frequency slider helpers — slider internal range is always 0–SLIDER_STEPS (1000)
// Hz ceiling lives in maxFreqInput; scale comes from the Lin/Log switch
const SLIDER_STEPS = 1000;

function sliderToFreq(pos, ceiling, scale) {
    if (scale === 'log')
        return Math.round(Math.expm1(pos / SLIDER_STEPS * Math.log1p(ceiling)));
    return Math.round(pos / SLIDER_STEPS * ceiling);
}
function freqToSlider(freq, ceiling, scale) {
    if (freq <= 0 || ceiling <= 0) return 0;
    if (scale === 'log')
        return Math.round(Math.log1p(Math.min(freq, ceiling)) / Math.log1p(ceiling) * SLIDER_STEPS);
    return Math.round(Math.min(freq, ceiling) / ceiling * SLIDER_STEPS);
}
function getCeiling() {
    return parseInt(document.getElementById('maxFreqInput').value) || 4000;
}

// ── 3D spectrogram ────────────────────────────────────────────────────────
// Mesh resolution for the 3D surface/wireframe (time columns × frequency rows)
const GRID_COLS = 220;
const GRID_ROWS = 140;

// Shared GLSL: frequency param [0,1] → texture Y, matching the 2D shader.
// Needs uniforms u_scale_mode, u_min_freq_ratio, u_max_freq_ratio in scope.
const FREQ_GLSL = `
    float freqTexY(float t) {
        if (u_scale_mode == 1) {
            float safeMin = max(u_min_freq_ratio, 0.001);
            float logMin = log(safeMin);
            float logMax = log(u_max_freq_ratio);
            float logY = logMin + t * (logMax - logMin);
            return exp(logY);
        }
        return u_min_freq_ratio + t * (u_max_freq_ratio - u_min_freq_ratio);
    }
`;

// Shared GLSL: colormap palette. Needs uniforms u_threshold, u_colormap in scope.
const COLORMAP_GLSL = `
    vec3 viridis(float t) {
        const vec3 c0 = vec3(0.2777273272234177, 0.005407344544966578, 0.3340998053353061);
        const vec3 c1 = vec3(0.1050930431085774, 1.404613529898575, 1.384590162594685);
        const vec3 c2 = vec3(-0.3308618287255563, 0.214847559468213, 0.09509516302823659);
        const vec3 c3 = vec3(-4.634230498983486, -5.799100973351585, -19.33244095627987);
        const vec3 c4 = vec3(6.228269936347081, 14.17993336680509, 56.69055260068105);
        const vec3 c5 = vec3(4.776384997670288, -13.74514537774601, -65.35303263337234);
        const vec3 c6 = vec3(-5.435455855934631, 4.645852612178535, 26.3124352495832);
        return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
    }

    vec3 getColorExperimental(float freqRatio, float amplitude) {
        vec3 c0 = vec3(0.39, 0.0, 0.0);
        vec3 c1 = vec3(1.0, 0.0, 0.0);
        vec3 c2 = vec3(1.0, 0.39, 0.0);
        vec3 c3 = vec3(1.0, 0.78, 0.0);
        vec3 c4 = vec3(1.0, 1.0, 0.2);

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

        if (amplitude < u_threshold) return vec3(0.027, 0.027, 0.067);

        float brightness = pow(amplitude, 0.5);
        brightness = max(brightness, 0.05);
        return color * brightness;
    }

    vec3 getColorViridis(float freqRatio, float amplitude) {
        if (amplitude < u_threshold) return vec3(0.027, 0.027, 0.067);
        float brightness = pow(amplitude, 0.5);
        brightness = max(brightness, 0.05);
        return viridis(amplitude) * brightness;
    }

    vec3 getColorGreyscale(float freqRatio, float amplitude) {
        if (amplitude < u_threshold) return vec3(0.027, 0.027, 0.067);
        float brightness = pow(amplitude, 0.5);
        brightness = max(brightness, 0.05);
        return vec3(brightness);
    }

    vec3 getColorReversedGreyscale(float freqRatio, float amplitude) {
        if (amplitude < u_threshold) return vec3(1.0);
        float brightness = pow(amplitude, 0.5);
        brightness = max(brightness, 0.05);
        return vec3(1.0 - brightness);
    }

    vec3 getColor(float freqRatio, float amplitude) {
        if (u_colormap == 0) {
            return getColorExperimental(freqRatio, amplitude);
        } else if (u_colormap == 1) {
            return getColorViridis(freqRatio, amplitude);
        } else if (u_colormap == 2) {
            return getColorGreyscale(freqRatio, amplitude);
        } else {
            return getColorReversedGreyscale(freqRatio, amplitude);
        }
    }
`;

// Minimal column-major 4×4 matrix helpers (no dependency). Each writes into `out`.
const Mat4 = {
    perspective(out, fovy, aspect, near, far) {
        const f = 1.0 / Math.tan(fovy / 2);
        const nf = 1 / (near - far);
        out[0] = f / aspect; out[1] = 0; out[2] = 0;  out[3] = 0;
        out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
        out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
        return out;
    },
    lookAt(out, eye, center, up) {
        let x0, x1, x2, y0, y1, y2, z0, z1, z2, len;
        z0 = eye[0] - center[0]; z1 = eye[1] - center[1]; z2 = eye[2] - center[2];
        len = 1 / Math.hypot(z0, z1, z2); z0 *= len; z1 *= len; z2 *= len;
        x0 = up[1] * z2 - up[2] * z1;
        x1 = up[2] * z0 - up[0] * z2;
        x2 = up[0] * z1 - up[1] * z0;
        len = Math.hypot(x0, x1, x2);
        if (!len) { x0 = 0; x1 = 0; x2 = 0; } else { len = 1 / len; x0 *= len; x1 *= len; x2 *= len; }
        y0 = z1 * x2 - z2 * x1;
        y1 = z2 * x0 - z0 * x2;
        y2 = z0 * x1 - z1 * x0;
        out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
        out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
        out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
        out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
        out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
        out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
        out[15] = 1;
        return out;
    },
    multiply(out, a, b) {
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
              a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
              a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
              a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
        for (let i = 0; i < 4; i++) {
            const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
            out[i * 4]     = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
            out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
            out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
            out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
        }
        return out;
    }
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
    
    initWebGL() {
        this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
        if (!this.gl) {
            console.error('WebGL not supported');
            return;
        }
        const gl = this.gl;

        // Set unpack alignment to 1 for 1-byte width texture uploads
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

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
            uniform int u_scale_mode; // 0 = linear, 1 = log
            uniform int u_colormap; // 0 = experimental, 1 = viridis, 2 = greyscale, 3 = reversed greyscale
            uniform int u_flip;    // 0 = scroll left (←), 1 = scroll right (→)
            uniform int u_bg_mode; // 0 = dark, 1 = transparent, 2 = white
            uniform int u_soft_edge;      // 0 = hard, 1 = soft (only used when transparent)
            uniform float u_trail_length;    // 0 = short, 1 = long
            uniform float u_boost_intensity; // flash brightness at cursor edge
            varying vec2 v_uv;

            ${FREQ_GLSL}
            ${COLORMAP_GLSL}

            void main() {
                vec3 backgroundColor = u_bg_mode == 2 ? vec3(1.0) : vec3(0.027, 0.027, 0.067);

                // Flip x-axis for right-scrolling direction
                float uvx = u_flip == 1 ? (1.0 - v_uv.x) : v_uv.x;

                // Right portion is empty — cursor position controlled by CURSOR_X
                if (uvx > ${CURSOR_X}) {
                    if (u_bg_mode == 1) gl_FragColor = vec4(0.0);
                    else gl_FragColor = vec4(backgroundColor, 1.0);
                    return;
                }

                // X mapping: cursor (uvx=CURSOR_X) = newest, left edge = oldest
                float x = u_offset + (uvx / ${CURSOR_X} - 1.0) * u_visible_width;
                x = fract(x);

                // Y mapping (Frequency Zoom) — shared helper
                float y = freqTexY(v_uv.y);

                float amp = texture2D(u_texture, vec2(x, y)).r;
                vec3 color = getColor(v_uv.y, amp);

                // Spawn flash — brighten or darken at the newest data edge depending on colormap
                if (amp >= u_threshold) {
                    float distFromEdge = ${CURSOR_X} - uvx;
                    float boostFactor = u_boost_intensity * exp(-distFromEdge * 40.0);
                    if (u_colormap == 3) {
                        color *= 1.0 / (1.0 + boostFactor); // darken for Ink (reversed_greyscale)
                    } else {
                        color *= 1.0 + boostFactor;          // brighten for all others
                    }
                }

                // Fade out on the far left (oldest data)
                float fadeAlpha = 1.0;
                float fadeOutWidth = mix(${CURSOR_X} - 0.005, 0.05, u_trail_length);
                if (uvx < fadeOutWidth) {
                    float t = uvx / fadeOutWidth;
                    float k = mix(10.0, 3.0, u_trail_length);
                    fadeAlpha *= exp(k * (t - 1.0));
                }

                // Tiny blur at the right edge (newest data) — softens without visible lag
                float edgeBlur = 0.02;
                if (uvx > (${CURSOR_X} - edgeBlur)) {
                    fadeAlpha *= smoothstep(${CURSOR_X}, ${CURSOR_X} - edgeBlur, uvx);
                }

                if (u_bg_mode == 1 || (u_bg_mode == 0 && u_colormap == 3)) {
                    float dataAlpha = (u_soft_edge == 1 || u_colormap == 3)
                        ? smoothstep(u_threshold, u_threshold + 0.06, amp) * fadeAlpha
                        : step(u_threshold, amp) * fadeAlpha;
                    gl_FragColor = vec4(color, dataAlpha);
                } else {
                    color = mix(backgroundColor, color, fadeAlpha);
                    gl_FragColor = vec4(color, 1.0);
                }
            }
        `;

        // Compile Shaders
        const vs = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        // Buffers — full-screen quad for the 2D view
        const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        this.quadBuffer = buffer;

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

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        this.gl = gl;

        // 3D program + geometry (shares this.texture as the height source)
        this.initWebGL3D(gl);
    }

    /**
     * Build the second WebGL program that renders the history texture as a
     * displaced vertex grid (3D surface / wireframe). Reuses this.texture and
     * the shared colormap / frequency GLSL.
     */
    initWebGL3D(gl) {
        if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 1) {
            this._webgl3dOK = false;
            console.warn('Vertex texture fetch unsupported — 3D spectrogram disabled');
            return;
        }

        const vsSource = `
            precision mediump float;
            precision mediump int;
            attribute vec2 a_grid;                // parametric coords in [0,1]
            uniform sampler2D u_texture;
            uniform float u_offset;
            uniform float u_min_freq_ratio;
            uniform float u_max_freq_ratio;
            uniform float u_threshold;
            uniform float u_visible_width;
            uniform int u_scale_mode;
            uniform mat4 u_mvp;
            uniform float u_height_scale;
            uniform int u_lighting;
            varying float v_amp;
            varying float v_freq;
            varying vec3 v_normal;

            ${FREQ_GLSL}

            float sampleAmp(vec2 g) {
                float x = fract(u_offset + (g.x - 1.0) * u_visible_width);
                float y = freqTexY(clamp(g.y, 0.0, 1.0));
                return texture2D(u_texture, vec2(x, y)).r;
            }

            float heightAt(vec2 g) {
                float a = sampleAmp(g);
                if (a < u_threshold) return 0.0;
                return pow(a, 0.5) * u_height_scale;
            }

            void main() {
                float h = heightAt(a_grid);
                v_amp = sampleAmp(a_grid);
                v_freq = a_grid.y;

                // Plane: x = time [-1,1], z = frequency [-1,1], y = amplitude
                vec3 pos = vec3(a_grid.x * 2.0 - 1.0, h, a_grid.y * 2.0 - 1.0);

                if (u_lighting == 1) {
                    float du = 1.0 / float(${GRID_COLS});
                    float dv = 1.0 / float(${GRID_ROWS});
                    float hL = heightAt(a_grid + vec2(-du, 0.0));
                    float hR = heightAt(a_grid + vec2( du, 0.0));
                    float hD = heightAt(a_grid + vec2(0.0, -dv));
                    float hU = heightAt(a_grid + vec2(0.0,  dv));
                    float sx = (hR - hL) / (4.0 * du);   // world dx per grid step = 2*du
                    float sz = (hU - hD) / (4.0 * dv);
                    v_normal = normalize(vec3(-sx, 1.0, -sz));
                } else {
                    v_normal = vec3(0.0, 1.0, 0.0);
                }

                gl_Position = u_mvp * vec4(pos, 1.0);
            }
        `;

        const fsSource = `
            precision mediump float;
            precision mediump int;
            uniform float u_threshold;
            uniform int u_colormap;
            uniform int u_lighting;
            varying float v_amp;
            varying float v_freq;
            varying vec3 v_normal;

            ${COLORMAP_GLSL}

            void main() {
                vec3 color = getColor(v_freq, v_amp);
                if (u_lighting == 1) {
                    vec3 L = normalize(vec3(0.4, 0.85, 0.45));
                    float diff = max(dot(normalize(v_normal), L), 0.0);
                    color *= (0.4 + 0.6 * diff);
                }
                gl_FragColor = vec4(color, 1.0);
            }
        `;

        const vs = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) { this._webgl3dOK = false; return; }
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error(gl.getProgramInfoLog(prog));
            this._webgl3dOK = false;
            return;
        }
        this.program3d = prog;

        // Grid vertices (parametric)
        const verts = [];
        for (let j = 0; j < GRID_ROWS; j++) {
            for (let i = 0; i < GRID_COLS; i++) {
                verts.push(i / (GRID_COLS - 1), j / (GRID_ROWS - 1));
            }
        }
        this.gridBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);

        const at = (i, j) => j * GRID_COLS + i;

        // Triangle indices (surface)
        const tris = [];
        for (let j = 0; j < GRID_ROWS - 1; j++) {
            for (let i = 0; i < GRID_COLS - 1; i++) {
                tris.push(at(i, j), at(i + 1, j), at(i, j + 1));
                tris.push(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
            }
        }
        this.triIndexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(tris), gl.STATIC_DRAW);
        this.triIndexCount = tris.length;

        // Line indices (wireframe): row edges + column edges
        const lines = [];
        for (let j = 0; j < GRID_ROWS; j++) {
            for (let i = 0; i < GRID_COLS - 1; i++) lines.push(at(i, j), at(i + 1, j));
        }
        for (let i = 0; i < GRID_COLS; i++) {
            for (let j = 0; j < GRID_ROWS - 1; j++) lines.push(at(i, j), at(i, j + 1));
        }
        this.lineIndexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(lines), gl.STATIC_DRAW);
        this.lineIndexCount = lines.length;

        // Restore array-buffer binding expected by the 2D setup
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
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
                e.currentTarget.classList.add('active');
                setTimeout(() => {
                    e.currentTarget.classList.remove('active');
                }, 300);

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
            document.getElementById('trailLengthValue').textContent = Math.round(e.target.value * 100) + '%';
        });

        // Flash boost intensity control
        document.getElementById('boostIntensity').addEventListener('input', (e) => {
            this.settings.boostIntensity = parseFloat(e.target.value);
            document.getElementById('boostIntensityValue').textContent = parseFloat(e.target.value).toFixed(1);
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

        // View mode: 2D / 3D surface / 3D wireframe
        const spectrogramContainerEl = document.querySelector('.spectrogram-container');
        const heightRow = document.getElementById('heightScale3dRow');
        document.querySelectorAll('input[name="view-radio"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const mode = e.target.value;
                if (mode !== '2d' && !this._webgl3dOK) {
                    this.showNotification('3D view is not supported on this device.', 'error');
                    document.querySelector('input[name="view-radio"][value="2d"]').checked = true;
                    this.updateSegmentedControlIndicators();
                    return;
                }
                this.settings.viewMode = mode;
                const is3d = mode !== '2d';
                spectrogramContainerEl.classList.toggle('view-3d', is3d);
                if (heightRow) heightRow.style.display = is3d ? '' : 'none';
                this.updateSegmentedControlIndicators();
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

        // Fullscreen toggle
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        const spectrogramContainer = document.querySelector('.spectrogram-container');
        if (fullscreenBtn && spectrogramContainer) {
            const iconExpand = fullscreenBtn.querySelector('.icon-expand');
            const iconCollapse = fullscreenBtn.querySelector('.icon-collapse');

            fullscreenBtn.style.opacity = '0';
            fullscreenBtn.style.transition = 'opacity 0.2s ease, background 0.2s ease';
            if (iconExpand) iconExpand.style.display = 'block';
            if (iconCollapse) iconCollapse.style.display = 'none';

            // JS-driven hover visibility — CSS parent-hover chain is unreliable in Safari
            spectrogramContainer.addEventListener('mouseenter', () => {
                fullscreenBtn.style.opacity = '1';
            });
            spectrogramContainer.addEventListener('mouseleave', () => {
                if (!spectrogramContainer.classList.contains('expanded')) {
                    fullscreenBtn.style.opacity = '0';
                }
            });

            fullscreenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const expanded = spectrogramContainer.classList.toggle('expanded');
                if (iconExpand) iconExpand.style.display = expanded ? 'none' : 'block';
                if (iconCollapse) iconCollapse.style.display = expanded ? 'block' : 'none';
                fullscreenBtn.style.opacity = '1';
                requestAnimationFrame(() => this.setupHighDpiCanvas());
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
        update('view-radio', this.settings.viewMode);
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
        const min = this.settings.minFreq;
        const max = this.settings.maxFreq;
        
        // Create logarithmic scale points
        const scalePoints = [];
        const count = 9;
        
        if (this.settings.scale === 'log') {
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

        // 1. Upload the new frequency column at the current write head
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        const bins = this.analyser.frequencyBinCount;
        gl.texSubImage2D(gl.TEXTURE_2D, 0, this.writeHead, 0, 1, bins, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.frequencyData);

        // 2. Shared uniform inputs (used by both the 2D and 3D draw paths)
        const nyquist = this.settings.sampleRate / 2;
        const heightScale = bins / this.texHeight;   // portion of the texture in use
        const scrollSpeed = SCROLL_SPEEDS[this.settings.scrollSpeed];
        const canvasWidth = this.canvas.width / window.devicePixelRatio;
        const shared = {
            offset: this.writeHead / this.texWidth,
            minRatio: (this.settings.minFreq / nyquist) * heightScale,
            maxRatio: (this.settings.maxFreq / nyquist) * heightScale,
            threshold: Math.max(this.settings.noiseThreshold / 100.0, MIN_THRESHOLD),
            visibleWidthRatio: (canvasWidth / scrollSpeed) / this.texWidth,
            scaleMode: this.settings.scale === 'log' ? 1 : 0,
            colormapMode: { experimental: 0, viridis: 1, greyscale: 2, reversed_greyscale: 3 }[this.settings.colormap] ?? 1,
        };

        // 3. Draw with the selected view mode
        if (this.settings.viewMode !== '2d' && this.program3d) {
            this.renderWebGL3D(shared);
        } else {
            this.renderWebGL2D(shared);
        }

        // 4. Advance write head
        this.writeHead = (this.writeHead + 1) % this.texWidth;
    }

    /** 2D scrolling spectrogram — full-screen quad + fragment shader */
    renderWebGL2D(s) {
        const gl = this.gl;
        const p = this.program;

        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(p);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        const posLoc = gl.getAttribLocation(p, 'a_position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.uniform1i(gl.getUniformLocation(p, 'u_texture'), 0);
        gl.uniform1f(gl.getUniformLocation(p, 'u_offset'), s.offset);
        gl.uniform1f(gl.getUniformLocation(p, 'u_min_freq_ratio'), s.minRatio);
        gl.uniform1f(gl.getUniformLocation(p, 'u_max_freq_ratio'), s.maxRatio);
        gl.uniform1f(gl.getUniformLocation(p, 'u_threshold'), s.threshold);
        gl.uniform1f(gl.getUniformLocation(p, 'u_visible_width'), s.visibleWidthRatio);
        gl.uniform1i(gl.getUniformLocation(p, 'u_scale_mode'), s.scaleMode);
        gl.uniform1i(gl.getUniformLocation(p, 'u_colormap'), s.colormapMode);
        gl.uniform1i(gl.getUniformLocation(p, 'u_flip'), this.settings.scrollDirection === 'right' ? 1 : 0);
        const bgMode = { dark: 0, transparent: 1, white: 2 }[this.settings.backgroundStyle] ?? 0;
        gl.uniform1i(gl.getUniformLocation(p, 'u_bg_mode'), bgMode);
        gl.uniform1i(gl.getUniformLocation(p, 'u_soft_edge'), this.settings.softEdge ? 1 : 0);
        gl.uniform1f(gl.getUniformLocation(p, 'u_trail_length'), this.settings.trailLength);
        gl.uniform1f(gl.getUniformLocation(p, 'u_boost_intensity'), this.settings.boostIntensity);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /** 3D view — history texture as a displaced vertex grid (surface or wireframe) */
    renderWebGL3D(s) {
        const gl = this.gl;
        const p = this.program3d;

        gl.enable(gl.DEPTH_TEST);

        // Clear with the chosen background
        const bg = this.settings.backgroundStyle;
        if (bg === 'white') gl.clearColor(1, 1, 1, 1);
        else if (bg === 'transparent') gl.clearColor(0, 0, 0, 0);
        else gl.clearColor(0.027, 0.027, 0.067, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Orbit camera → MVP (aspect read every frame, so resize/fullscreen just works)
        const aspect = (this.canvas.width / this.canvas.height) || 1;
        const { az, el, dist } = this._cam;
        const target = [0, 0.2, 0];
        const eye = [
            target[0] + dist * Math.cos(el) * Math.sin(az),
            target[1] + dist * Math.sin(el),
            target[2] + dist * Math.cos(el) * Math.cos(az),
        ];
        Mat4.perspective(this._proj, 50 * Math.PI / 180, aspect, 0.1, 100);
        Mat4.lookAt(this._view, eye, target, [0, 1, 0]);
        Mat4.multiply(this._mvp, this._proj, this._view);

        gl.useProgram(p);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
        const gridLoc = gl.getAttribLocation(p, 'a_grid');
        gl.enableVertexAttribArray(gridLoc);
        gl.vertexAttribPointer(gridLoc, 2, gl.FLOAT, false, 0, 0);

        gl.uniform1i(gl.getUniformLocation(p, 'u_texture'), 0);
        gl.uniform1f(gl.getUniformLocation(p, 'u_offset'), s.offset);
        gl.uniform1f(gl.getUniformLocation(p, 'u_min_freq_ratio'), s.minRatio);
        gl.uniform1f(gl.getUniformLocation(p, 'u_max_freq_ratio'), s.maxRatio);
        gl.uniform1f(gl.getUniformLocation(p, 'u_threshold'), s.threshold);
        gl.uniform1f(gl.getUniformLocation(p, 'u_visible_width'), s.visibleWidthRatio);
        gl.uniform1i(gl.getUniformLocation(p, 'u_scale_mode'), s.scaleMode);
        gl.uniform1i(gl.getUniformLocation(p, 'u_colormap'), s.colormapMode);
        gl.uniformMatrix4fv(gl.getUniformLocation(p, 'u_mvp'), false, this._mvp);
        gl.uniform1f(gl.getUniformLocation(p, 'u_height_scale'), this.settings.heightScale3d);
        gl.uniform1i(gl.getUniformLocation(p, 'u_lighting'), this.settings.viewMode === 'surface' ? 1 : 0);

        if (this.settings.viewMode === 'wireframe') {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIndexBuffer);
            gl.drawElements(gl.LINES, this.lineIndexCount, gl.UNSIGNED_SHORT, 0);
        } else {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triIndexBuffer);
            gl.drawElements(gl.TRIANGLES, this.triIndexCount, gl.UNSIGNED_SHORT, 0);
        }
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
    
    // ── Custom Preset persistence ──────────────────────────────────────────

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
        if (!this.settings.viewMode) this.settings.viewMode = '2d';
        if (this.settings.heightScale3d == null) this.settings.heightScale3d = 0.6;
        if (this.settings.viewMode !== '2d' && !this._webgl3dOK) this.settings.viewMode = '2d';

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
        setRadio('view-radio', this.settings.viewMode);

        const is3d = this.settings.viewMode !== '2d';
        document.querySelector('.spectrogram-container').classList.toggle('view-3d', is3d);
        const heightRow = document.getElementById('heightScale3dRow');
        if (heightRow) heightRow.style.display = is3d ? '' : 'none';
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
        document.querySelector('.threshold-indicator').style.left = `${s.noiseThreshold}%`;
        document.querySelector('.threshold-value').textContent = `${s.noiseThreshold}%`;
        this.updateNoiseVisualization();

        document.getElementById('trailLength').value = s.trailLength;
        document.getElementById('trailLengthValue').textContent = Math.round(s.trailLength * 100) + '%';

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