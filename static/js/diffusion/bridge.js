// Diffusion bridge: sends spectrogram frames to the local backend
// (backend/server.py) and shows the generated animation.
// Inactive unless the URL contains ?diffusion=1 — the normal app is untouched.
(function () {
    const params = new URLSearchParams(location.search);
    if (!params.has('diffusion')) return;
    const WS_URL = params.get('ws') || 'ws://127.0.0.1:8765';

    const state = {
        ws: null, connected: false, inFlight: false, wantFrame: false, sentAt: 0,
        size: 384, frames: 0, fpsT0: performance.now(), fps: 0, latency: 0,
    };
    const grab = document.createElement('canvas');
    const grabCtx = grab.getContext('2d');

    // ── UI ────────────────────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.id = 'diffusionPanel';
    panel.innerHTML = `
      <style>
        #diffusionPanel{position:fixed;right:16px;bottom:16px;z-index:9999;width:340px;
          background:#fff;color:#222;border:1px solid #ddd;border-radius:10px;
          box-shadow:0 6px 24px rgba(0,0,0,.12);font:12px/1.4 system-ui,sans-serif;overflow:hidden}
        #diffusionPanel.full{inset:0;width:auto;border-radius:0;background:#000}
        #diffusionPanel.full .dp-ctl{position:absolute;right:12px;top:12px;width:300px;background:rgba(255,255,255,.92);border-radius:8px}
        #dpOut{display:block;width:100%;aspect-ratio:1;background:#111;object-fit:contain}
        #diffusionPanel.full #dpOut{width:100%;height:100%;aspect-ratio:auto}
        .dp-ctl{padding:8px 10px;display:grid;gap:6px}
        .dp-row{display:flex;gap:6px;align-items:center}
        .dp-row label{width:58px;color:#666}
        .dp-row input[type=range]{flex:1}
        #dpPrompt{flex:1;font:inherit;padding:3px 5px;border:1px solid #ccc;border-radius:4px}
        .dp-stat{font-family:ui-monospace,monospace;color:#555}
        .dp-btn{font:inherit;padding:3px 8px;border:1px solid #ccc;border-radius:4px;background:#f6f6f6;cursor:pointer}
      </style>
      <canvas id="dpOut" width="384" height="384"></canvas>
      <div class="dp-ctl">
        <div class="dp-row"><span class="dp-stat" id="dpStatus">connecting…</span>
          <span style="flex:1"></span>
          <button class="dp-btn" id="dpPause">Pause</button>
          <button class="dp-btn" id="dpFull">Full</button></div>
        <div class="dp-row"><label>Prompt</label><input id="dpPrompt"></div>
        <div class="dp-row"><label>Strength</label><input type="range" id="dpStrength" min="0.2" max="1" step="0.05"><span class="dp-stat" id="dpStrengthV"></span></div>
        <div class="dp-row"><label>Seed</label><input type="number" id="dpSeed" style="width:80px">
          <label style="width:auto;margin-left:8px">Size</label>
          <select id="dpSize"><option>256</option><option selected>384</option><option>512</option></select></div>
      </div>`;
    document.body.appendChild(panel);
    const $ = (id) => panel.querySelector('#' + id);
    const out = $('dpOut'), outCtx = out.getContext('2d');
    let paused = false;

    function sendParams(p) {
        if (state.connected) state.ws.send(JSON.stringify(p));
    }
    $('dpPrompt').addEventListener('change', (e) => sendParams({ prompt: e.target.value }));
    $('dpStrength').addEventListener('input', (e) => { $('dpStrengthV').textContent = (+e.target.value).toFixed(2); });
    $('dpStrength').addEventListener('change', (e) => sendParams({ strength: +e.target.value }));
    $('dpSeed').addEventListener('change', (e) => sendParams({ seed: +e.target.value }));
    $('dpSize').addEventListener('change', (e) => { state.size = +e.target.value; sendParams({ size: state.size }); });
    $('dpPause').addEventListener('click', (e) => { paused = !paused; e.target.textContent = paused ? 'Resume' : 'Pause'; });
    $('dpFull').addEventListener('click', () => panel.classList.toggle('full'));

    function showParams(p) {
        $('dpPrompt').value = p.prompt; $('dpStrength').value = p.strength;
        $('dpStrengthV').textContent = (+p.strength).toFixed(2); $('dpSeed').value = p.seed;
        $('dpSize').value = String(p.size); state.size = +p.size;
    }

    // ── WebSocket ─────────────────────────────────────────────────────────
    function connect() {
        const ws = new WebSocket(WS_URL);
        ws.binaryType = 'blob';
        state.ws = ws;
        ws.onopen = () => { state.connected = true; state.inFlight = false; };
        ws.onclose = () => {
            state.connected = false;
            $('dpStatus').textContent = 'backend not running — retrying…';
            setTimeout(connect, 1500);
        };
        ws.onmessage = async (ev) => {
            if (typeof ev.data === 'string') {
                const m = JSON.parse(ev.data);
                if (m.params) showParams(m.params);
                if (m.type === 'ready') $('dpStatus').textContent = `ready (${m.device})`;
                if (m.type === 'error') console.warn('[diffusion]', m.message);
                return;
            }
            const bmp = await createImageBitmap(ev.data);
            if (out.width !== bmp.width) { out.width = bmp.width; out.height = bmp.height; }
            outCtx.drawImage(bmp, 0, 0);
            bmp.close();
            state.inFlight = false;
            state.latency = 0.8 * state.latency + 0.2 * (performance.now() - state.sentAt);
            state.frames++;
            const now = performance.now();
            if (now - state.fpsT0 > 1000) {
                state.fps = state.frames * 1000 / (now - state.fpsT0);
                state.frames = 0; state.fpsT0 = now;
                $('dpStatus').textContent = `${state.fps.toFixed(1)} fps · ${state.latency.toFixed(0)} ms`;
            }
        };
    }

    // ── Frame capture ────────────────────────────────────────────────────
    // The spectrogram is WebGL without preserveDrawingBuffer, so its pixels
    // are only readable right after drawing. We wrap renderWebGL and copy the
    // canvas in the same call. Only one frame is in flight at a time, so the
    // backend always works on the newest spectrogram (no queue build-up).
    function capture(app) {
        const s = state.size;
        if (grab.width !== s) { grab.width = s; grab.height = s; }
        grabCtx.drawImage(app.canvas, 0, 0, s, s);
        state.inFlight = true; state.sentAt = performance.now();
        grab.toBlob((b) => { if (b && state.connected) state.ws.send(b); else state.inFlight = false; },
            'image/jpeg', 0.9);
    }

    function hook() {
        const app = window.__seeingSound;
        if (!app || typeof app.renderWebGL !== 'function') return setTimeout(hook, 200);
        const orig = app.renderWebGL.bind(app);
        app.renderWebGL = function (...a) {
            const r = orig(...a);
            if (!paused && state.connected && !state.inFlight) {
                try { capture(app); } catch (e) { console.warn('[diffusion] capture failed', e); state.inFlight = false; }
            }
            return r;
        };
        connect();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
    else hook();
})();
