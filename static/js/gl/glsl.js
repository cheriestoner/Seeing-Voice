// Shared GLSL snippets used by both the 2D and 3D spectrogram shaders.

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

    // ── Shared intensity curve ───────────────────────────────────────────
    // Every colormap goes through the same curve, so changing the colormap
    // changes hue / polarity only, never how strongly a given level shows.
    //   a = amplitude above the noise threshold, rescaled to [0,1]
    //       (continuous at the threshold, so no hard-edged blobs)
    //   v = a^1.23 — the effective lightness curve viridis has always had
    //       (L* ≈ 91·v); the old sqrt() curve for grey / ink lifted the
    //       8-bit noise floor ~10× more, which is what made them grainy.
    float levelAbove(float amplitude) {
        return clamp((amplitude - u_threshold) / max(1.0 - u_threshold, 1e-3), 0.0, 1.0);
    }
    float shapedLevel(float a) { return pow(a, 1.23); }

    // CIE L* in [0,100] → sRGB-encoded grey in [0,1]
    float greyFromLstar(float L) {
        float Y = L > 8.0 ? pow((L + 16.0) / 116.0, 3.0) : L / 903.3;
        return Y <= 0.0031308 ? 12.92 * Y : 1.055 * pow(Y, 1.0 / 2.4) - 0.055;
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
        // hue from frequency, value from the shared curve
        float v = shapedLevel(levelAbove(amplitude));
        return color * greyFromLstar(100.0 * v);
    }

    vec3 getColorViridis(float freqRatio, float amplitude) {
        if (amplitude < u_threshold) return vec3(0.027, 0.027, 0.067);
        // unchanged look at threshold 0: viridis(a)·sqrt(a) ≈ L* 91·a^1.23
        float a = levelAbove(amplitude);
        return viridis(a) * sqrt(a);
    }

    // Night ground is L* ≈ 2, paper is L* 100: start exactly at the ground
    vec3 getColorGreyscale(float freqRatio, float amplitude) {
        if (amplitude < u_threshold) return vec3(0.027, 0.027, 0.067);
        float v = shapedLevel(levelAbove(amplitude));
        return vec3(greyFromLstar(2.0 + 98.0 * v));
    }

    vec3 getColorReversedGreyscale(float freqRatio, float amplitude) {
        if (amplitude < u_threshold) return vec3(1.0);
        float v = shapedLevel(levelAbove(amplitude));
        return vec3(greyFromLstar(100.0 - 100.0 * v));
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
