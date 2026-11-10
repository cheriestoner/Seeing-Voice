"""Measure SD-Turbo img2img speed on this machine at several resolutions.

    python bench.py                 # synthetic spectrogram-like input
    python bench.py --image my.png  # use a saved spectrogram screenshot
"""
import argparse, time
import numpy as np
from PIL import Image
import torch
from common import load_pipe, Img2Img


def synthetic(size):
    """Harmonic stripes with a vibrato, roughly like a voiced spectrogram."""
    w = h = size
    x = np.linspace(0, 1, w)[None, :]
    y = np.linspace(1, 0, h)[:, None]
    f0 = 0.08 + 0.01 * np.sin(2 * np.pi * 4 * x)
    img = np.zeros((h, w))
    for k in range(1, 10):
        img += np.exp(-((y - k * f0) ** 2) / 2e-5) / k
    img = np.clip(img / img.max(), 0, 1)
    rgb = np.stack([img ** 0.5, img, 0.3 + 0.4 * img], -1)
    return Image.fromarray((rgb * 255).astype(np.uint8))


def sync(device):
    if device == "mps":
        torch.mps.synchronize()
    elif device == "cuda":
        torch.cuda.synchronize()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image")
    ap.add_argument("--sizes", default="256,384,512")
    ap.add_argument("--strength", type=float, default=0.5)
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--prompt", default="flowing ink and light, abstract, organic, soft glow")
    args = ap.parse_args()

    t = time.time()
    pipe, device, dtype = load_pipe()
    print(f"device={device} dtype={dtype}  load {time.time() - t:.1f}s")
    gen = Img2Img(pipe, device, args.prompt, strength=args.strength)

    for size in [int(s) for s in args.sizes.split(",")]:
        src = Image.open(args.image).convert("RGB").resize((size, size)) if args.image else synthetic(size)
        for _ in range(3):  # warm-up (first MPS calls compile kernels)
            gen(src)
        sync(device)
        times = []
        for _ in range(args.n):
            t = time.perf_counter()
            out = gen(src)
            sync(device)
            times.append(time.perf_counter() - t)
        ms = np.median(times) * 1000
        print(f"{size}x{size}: median {ms:6.1f} ms  ->  {1000 / ms:5.1f} fps   (p90 {np.percentile(times, 90) * 1000:.1f} ms)")
        out.save(f"bench_out_{size}.png")
        src.save(f"bench_in_{size}.png")
    print("Saved bench_in_*.png / bench_out_*.png for a visual check.")


if __name__ == "__main__":
    main()
