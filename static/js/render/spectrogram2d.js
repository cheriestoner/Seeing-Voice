// 2D scrolling spectrogram: WebGL setup (shared history texture) + full-screen quad shader.

class Spectrogram2DMethods {
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
        this._writeCount = 0;          // monotonic (never wraps) — index of the next column to write
        this._visualOffsetTexels = 0;  // monotonic float driving the on-screen scroll position

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        this.gl = gl;

        // 3D program + geometry (shares this.texture as the height source)
        this.initWebGL3D(gl);
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
}

mixin(SeeingSound, Spectrogram2DMethods);
