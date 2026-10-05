// 3D spectrogram: history texture rendered as a displaced vertex grid (surface / wireframe).

// ── 3D spectrogram ────────────────────────────────────────────────────────
// Mesh: one vertex column per spectrogram column (up to GRID_COLS_MAX, i.e.
// 8 s at 60 columns/s) × GRID_ROWS frequency rows. Each vertex samples the
// CENTRE of one texture column and the mesh slides by the fractional part, so
// peaks never "swim" between vertices (Chrome Music Lab does the same by
// snapping its texture offset to whole rows). 480 × 128 < 65 536 (Uint16 indices).
const GRID_COLS_MAX = 480;
const GRID_ROWS = 128;

// Camera presets (orbit around `target`; az 0 = looking along −z, +π/2 = looking from the newest edge)
const CAMERA_PRESETS_3D = {
    // Chrome Music Lab–like: low, from the newest edge, history recedes into the distance
    front:   { az:  Math.PI / 2, el: 0.42, dist: 3.3,  target: [-0.3, 0.0, 0] },
    // Waterfall: time runs left → right like the 2D view, frequency goes into depth
    side:    { az: 0,            el: 0.75, dist: 2.9,  target: [0, 0.0, 0] },
    oblique: { az:  0.75,        el: 0.50, dist: 2.7,  target: [0, 0.1, 0] },
    top:     { az: 0,            el: 1.45, dist: 2.6,  target: [0, 0, 0] },
};

class Spectrogram3DMethods {
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
            precision highp float;             // column indices up to 2048 need highp
            precision mediump int;
            attribute vec2 a_grid;                // x = column index (0 = oldest), y = frequency param [0,1]
            uniform float u_tex_width;            // history texture width (columns)
            uniform float u_newest_col;           // texture column holding the newest spectrum
            uniform float u_frac;                 // [0,1): time since that column, in columns
            uniform float u_ncols;                // columns shown
            uniform sampler2D u_texture;
            uniform float u_min_freq_ratio;
            uniform float u_max_freq_ratio;
            uniform mediump float u_threshold;   // shared with the fragment shader: precisions must match
            uniform float u_persistence;
            uniform float u_ref_level;     // recent peak level the fade is measured against
            uniform int u_fade_mode;       // 0 = persistence (level ageing, shared with 2D), 1 = distance
            uniform int u_scale_mode;
            uniform mat4 u_mvp;
            uniform float u_height_scale;
            uniform int u_lighting;
            varying float v_amp;
            varying float v_freq;
            varying float v_time;          // 1 = newest edge, 0 = oldest
            varying vec3 v_normal;

            ${FREQ_GLSL}

            // Raw level at mesh column i (exactly one texture column) — drives the HEIGHT
            float sampleAmp(vec2 g) {
                float col = mod(u_newest_col - (u_ncols - 1.0 - g.x), u_tex_width);
                float x = (col + 0.5) / u_tex_width;
                float y = freqTexY(clamp(g.y, 0.0, 1.0));
                return texture2D(u_texture, vec2(x, y)).r;
            }

            // Age in seconds of mesh column i
            float ageOf(float i) { return (u_ncols - 1.0 - i + u_frac) / ${COLUMN_RATE}.0; }

            // Aged level: drives the COLOUR only (same ageing as 2D). Applying it
            // to the height made the whole surface slope down toward the past.
            float agedAmp(vec2 g) {
                return sampleAmp(g) - ageOf(g.x) / u_persistence * u_ref_level * (1.0 - u_threshold);
            }

            float heightAt(vec2 g) {
                float a = sampleAmp(g);
                if (a < u_threshold) return 0.0;
                return pow(a, 0.5) * u_height_scale;
            }

            void main() {
                float h = heightAt(a_grid);
                v_amp = u_fade_mode == 1 ? sampleAmp(a_grid) : agedAmp(a_grid);
                v_freq = a_grid.y;
                // Mesh slides toward the past by the fractional column → smooth motion
                float t = (a_grid.x - u_frac) / (u_ncols - 1.0);
                v_time = t;

                // Plane: x = time [-1 old, +1 new], y = amplitude,
                // z = frequency [+1 low, -1 high] so that, seen from the newest
                // edge (Front camera), low frequencies are on the left
                vec3 pos = vec3(t * 2.0 - 1.0, h, 1.0 - a_grid.y * 2.0);

                if (u_lighting == 1) {
                    float dv = 1.0 / float(${GRID_ROWS - 1});
                    float hL = heightAt(a_grid + vec2(-1.0, 0.0));
                    float hR = heightAt(a_grid + vec2( 1.0, 0.0));
                    float hD = heightAt(a_grid + vec2(0.0, -dv));
                    float hU = heightAt(a_grid + vec2(0.0,  dv));
                    float sx = (hR - hL) * (u_ncols - 1.0) / 4.0;   // world dx per column = 2/(N-1)
                    float sz = (hU - hD) / (4.0 * dv);
                    v_normal = normalize(vec3(-sx, 1.0, sz));   // z is flipped
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
            uniform int u_fade_mode;
            uniform vec3 u_ground;
            varying float v_amp;
            varying float v_freq;
            varying float v_time;
            varying vec3 v_normal;

            ${COLORMAP_GLSL}

            void main() {
                vec3 color = getColor(v_freq, v_amp);
                if (u_lighting == 1) {
                    vec3 L = normalize(vec3(0.45, 0.85, -0.3));
                    float diff = max(dot(normalize(v_normal), L), 0.0);
                    color *= (0.4 + 0.6 * diff);
                }
                if (u_fade_mode == 1) {
                    // Distance fade: ~full brightness over most of the history,
                    // falling off only toward the far end. Shape is untouched.
                    float fade = pow(max(cos((1.0 - v_time) * 1.5707963), 0.0), 0.5);
                    color = mix(u_ground, color, fade);
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

        // Grid vertices: (column index, frequency param)
        const verts = [];
        for (let j = 0; j < GRID_ROWS; j++) {
            for (let i = 0; i < GRID_COLS_MAX; i++) {
                verts.push(i, j / (GRID_ROWS - 1));
            }
        }
        this.gridBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);

        const at = (i, j) => j * GRID_COLS_MAX + i;

        // Indices are grouped per time segment (column i → i+1), oldest first,
        // so drawing the first N−1 segments shows exactly N columns.
        const tris = [];
        for (let i = 0; i < GRID_COLS_MAX - 1; i++) {
            for (let j = 0; j < GRID_ROWS - 1; j++) {
                tris.push(at(i, j), at(i + 1, j), at(i, j + 1));
                tris.push(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
            }
        }
        this.triIndexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(tris), gl.STATIC_DRAW);
        this.trisPerSegment = (GRID_ROWS - 1) * 6;

        const lines = [];
        for (let i = 0; i < GRID_COLS_MAX - 1; i++) {
            for (let j = 0; j < GRID_ROWS; j++) lines.push(at(i, j), at(i + 1, j));          // along time
            for (let j = 0; j < GRID_ROWS - 1; j++) lines.push(at(i, j), at(i, j + 1));      // along frequency
        }
        this.lineIndexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(lines), gl.STATIC_DRAW);
        this.linesPerSegment = (GRID_ROWS + GRID_ROWS - 1) * 2;

        // Restore array-buffer binding expected by the 2D setup
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
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
        const { az, el, dist, target } = this._cam;
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
        gl.uniform1f(gl.getUniformLocation(p, 'u_min_freq_ratio'), s.minRatio);
        gl.uniform1f(gl.getUniformLocation(p, 'u_max_freq_ratio'), s.maxRatio);
        gl.uniform1f(gl.getUniformLocation(p, 'u_threshold'), s.threshold);
        const n = s.cols3d;
        gl.uniform1f(gl.getUniformLocation(p, 'u_tex_width'), this.texWidth);
        gl.uniform1f(gl.getUniformLocation(p, 'u_newest_col'), s.newestCol);
        gl.uniform1f(gl.getUniformLocation(p, 'u_frac'), s.colFrac);
        gl.uniform1f(gl.getUniformLocation(p, 'u_ncols'), n);
        gl.uniform1f(gl.getUniformLocation(p, 'u_persistence'), s.persistence);
        gl.uniform1f(gl.getUniformLocation(p, 'u_ref_level'), s.refLevel);
        gl.uniform1i(gl.getUniformLocation(p, 'u_scale_mode'), s.scaleMode);
        gl.uniform1i(gl.getUniformLocation(p, 'u_colormap'), s.colormapMode);
        gl.uniformMatrix4fv(gl.getUniformLocation(p, 'u_mvp'), false, this._mvp);
        gl.uniform1f(gl.getUniformLocation(p, 'u_height_scale'), this.settings.heightScale3d);
        gl.uniform1i(gl.getUniformLocation(p, 'u_lighting'), (this.settings.viewMode === 'surface' && this.settings.spec3dLighting) ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(p, 'u_fade_mode'), this.settings.spec3dFade === 'distance' ? 1 : 0);
        const ground = bg === 'white' ? [1, 1, 1] : [0.027, 0.027, 0.067];
        gl.uniform3f(gl.getUniformLocation(p, 'u_ground'), ground[0], ground[1], ground[2]);

        if (this.settings.viewMode === 'wireframe') {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIndexBuffer);
            gl.drawElements(gl.LINES, (n - 1) * this.linesPerSegment, gl.UNSIGNED_SHORT, 0);
        } else {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triIndexBuffer);
            gl.drawElements(gl.TRIANGLES, (n - 1) * this.trisPerSegment, gl.UNSIGNED_SHORT, 0);
        }
    }

    /** Move the orbit camera to a named preset (CAMERA_PRESETS_3D). */
    applyCameraPreset(name) {
        const c = CAMERA_PRESETS_3D[name] || CAMERA_PRESETS_3D.front;
        this._cam = { az: c.az, el: c.el, dist: c.dist, target: c.target.slice() };
        this.settings.spec3dCamera = name;
    }
}

mixin(SeeingSound, Spectrogram3DMethods);
