# Diffusion backend (local)

Turns the live spectrogram into a StreamDiffusion-style animation (SD-Turbo,
single-step img2img) on the same Mac. Run these in **macOS Terminal**.

```bash
cd backend
uv venv && source .venv/bin/activate
uv pip install -r requirements.txt

python bench.py            # 1) speed test at 256/384/512 -> prints fps, saves bench_*.png
python server.py --dummy   # 2) test the browser <-> backend link without the model
python server.py           # 3) real model (first run downloads ~2.5 GB from Hugging Face)
```

Then open the app with `?diffusion=1` added to the URL (e.g. `index.html?diffusion=1`).
A panel appears bottom-right: prompt, strength, seed, size, fps and latency.

`python server.py --log runs/p01` saves every input/output pair plus the params
(`frames.jsonl`) — useful for checking reproducibility of stimuli.

Notes
- Fixed seed = same noise every frame: less flicker, and the same spectrogram
  gives the same image.
- strength × steps = actual denoising steps (default 0.5 × 2 = 1 step).
- Lower `size` (256/384) is the main lever for frame rate.
