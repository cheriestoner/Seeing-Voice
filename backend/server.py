"""Local WebSocket backend: spectrogram frame in -> diffusion frame out.

    python server.py            # SD-Turbo on MPS (Apple Silicon)
    python server.py --dummy    # no model; returns a processed copy (tests the pipeline)
    python server.py --log runs/session1   # also save every input/output pair + params

Protocol (ws://localhost:8765):
  client -> server  binary : JPEG/PNG frame
  client -> server  text   : JSON params {"prompt", "strength", "steps", "seed", "size"}
  server -> client  binary : JPEG result
  server -> client  text   : JSON status {"type": "ready"|"params"|"error", ...}
"""
import argparse, asyncio, io, json, os, time
from PIL import Image, ImageFilter, ImageOps
import websockets

DEFAULTS = {"prompt": "flowing ink and light, abstract, organic, soft glow",
            "strength": 0.5, "steps": 2, "seed": 42, "size": 384}


class DummyGen:
    def __init__(self):
        self.params = dict(DEFAULTS)

    def set_params(self, **kw):
        self.params.update({k: v for k, v in kw.items() if v is not None})

    def __call__(self, img):
        time.sleep(0.03)
        return ImageOps.invert(img.filter(ImageFilter.GaussianBlur(4)))


def build_generator(dummy):
    if dummy:
        return DummyGen(), "dummy"
    from common import load_pipe, Img2Img
    pipe, device, _ = load_pipe()
    g = Img2Img(pipe, device, DEFAULTS["prompt"], DEFAULTS["strength"], DEFAULTS["steps"], DEFAULTS["seed"])
    from PIL import Image as _I
    for _ in range(3):  # warm-up
        g(_I.new("RGB", (DEFAULTS["size"],) * 2))
    return g, device


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--dummy", action="store_true")
    ap.add_argument("--log", help="folder to save input/output frames and params")
    args = ap.parse_args()

    print("loading model..." if not args.dummy else "dummy mode")
    gen, device = build_generator(args.dummy)
    params = dict(DEFAULTS)
    lock = asyncio.Lock()  # one GPU job at a time
    if args.log:
        os.makedirs(args.log, exist_ok=True)
        logf = open(os.path.join(args.log, "frames.jsonl"), "a")
    counter = [0]

    async def handle(ws):
        await ws.send(json.dumps({"type": "ready", "device": device, "params": params}))
        async for msg in ws:
            if isinstance(msg, str):
                try:
                    p = json.loads(msg)
                    p = {k: p[k] for k in DEFAULTS if k in p}
                    params.update(p)
                    gen.set_params(**{k: p.get(k) for k in ("prompt", "strength", "steps", "seed")})
                    await ws.send(json.dumps({"type": "params", "params": params}))
                except Exception as e:
                    await ws.send(json.dumps({"type": "error", "message": str(e)}))
                continue
            t0 = time.perf_counter()
            img = Image.open(io.BytesIO(msg)).convert("RGB")
            s = int(params["size"])
            if img.size != (s, s):
                img = img.resize((s, s), Image.BILINEAR)
            async with lock:
                out = await asyncio.to_thread(gen, img)
            buf = io.BytesIO()
            out.save(buf, format="JPEG", quality=85)
            await ws.send(buf.getvalue())
            dt = (time.perf_counter() - t0) * 1000
            if args.log:
                i = counter[0]; counter[0] += 1
                img.save(os.path.join(args.log, f"{i:06d}_in.png"))
                out.save(os.path.join(args.log, f"{i:06d}_out.png"))
                logf.write(json.dumps({"i": i, "t": time.time(), "ms": round(dt, 1), **params}) + "\n")
                logf.flush()

    async with websockets.serve(handle, args.host, args.port, max_size=8 * 2**20):
        print(f"listening on ws://{args.host}:{args.port}  (device={device})")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
