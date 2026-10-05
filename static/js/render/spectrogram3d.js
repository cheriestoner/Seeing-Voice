// 3D spectrogram: history texture rendered as a displaced vertex grid (surface / wireframe).

// ── 3D spectrogram ────────────────────────────────────────────────────────
// Mesh resolution for the 3D surface/wireframe (time columns × frequency rows)
const GRID_COLS = 220;
const GRID_ROWS = 140;

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
            precision mediump float;
            precision mediump int;
            attribute vec2 a_grid;                // parametric coords in [0,1]
            uniform sampler2D u_texture;
            uniform float u_offset;
            uniform float u_min_freq_ratio;
            uniform float u_max_freq_ratio;
            uniform float u_threshold;
            uniform float u_visible_width;
            uniform float u_visible_seconds;
            uniform float u_persistence;
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
                float age = (1.0 - g.x) * u_visible_seconds;   // same ageing as 2D
                return texture2D(u_texture, vec2(x, y)).r - age / u_persistence * (1.0 - u_threshold);
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
        gl.uniform1f(gl.getUniformLocation(p, 'u_visible_seconds'), s.visibleSeconds);
        gl.uniform1f(gl.getUniformLocation(p, 'u_persistence'), s.persistence);
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
}

mixin(SeeingSound, Spectrogram3DMethods);
