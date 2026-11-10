"""Shared model loading for the StreamDiffusion-style img2img backend (Apple Silicon / MPS)."""
import torch
from diffusers import AutoPipelineForImage2Image

MODEL_ID = "stabilityai/sd-turbo"


def pick_device():
    if torch.backends.mps.is_available():
        return "mps", torch.float16
    if torch.cuda.is_available():
        return "cuda", torch.float16
    return "cpu", torch.float32


def load_pipe(model_id=MODEL_ID):
    device, dtype = pick_device()
    pipe = AutoPipelineForImage2Image.from_pretrained(model_id, torch_dtype=dtype, variant="fp16" if dtype == torch.float16 else None)
    pipe = pipe.to(device)
    pipe.set_progress_bar_config(disable=True)
    return pipe, device, dtype


class Img2Img:
    """Single-step SD-Turbo img2img with cached prompt embeddings and a fixed seed.

    Fixed seed per frame = same noise every frame, which greatly reduces flicker
    and makes the output for a given input image reproducible (important when
    the images are experimental stimuli).
    """

    def __init__(self, pipe, device, prompt, strength=0.5, steps=2, seed=42):
        self.pipe, self.device = pipe, device
        self.seed = seed
        self.set_params(prompt=prompt, strength=strength, steps=steps)

    def set_params(self, prompt=None, strength=None, steps=None, seed=None):
        if seed is not None:
            self.seed = int(seed)
        if strength is not None:
            self.strength = float(strength)
        if steps is not None:
            self.steps = int(steps)
        if prompt is not None:
            self.prompt = prompt
            with torch.no_grad():
                self.prompt_embeds, _ = self.pipe.encode_prompt(
                    prompt, device=self.device, num_images_per_prompt=1, do_classifier_free_guidance=False)
        # SD-Turbo img2img runs int(steps * strength) denoising steps; keep at least 1
        if self.steps * self.strength < 1:
            self.steps = int(1 / self.strength + 0.999)

    @torch.no_grad()
    def __call__(self, image):
        gen = torch.Generator(device="cpu").manual_seed(self.seed)
        out = self.pipe(
            prompt_embeds=self.prompt_embeds,
            image=image,
            num_inference_steps=self.steps,
            strength=self.strength,
            guidance_scale=0.0,
            generator=gen,
        ).images[0]
        return out
