"""Generate the patient portraits the board shows, with Gemini on Vertex, into web/public/faces/.

Every face is of a person who does not exist: the board's patients are synthetic, and these portraits are
generated for them. Run once; the files are committed so the demo never fetches anything at run time.

    .venv/bin/python tools/make_faces.py            # the whole set
    .venv/bin/python tools/make_faces.py 4          # just four, to try it out
"""
from __future__ import annotations

import io
import os
import sys
import time

from google import genai
from google.genai import types

OUT = os.path.join(os.path.dirname(__file__), "..", "web", "public", "faces")
MODEL = "gemini-2.5-flash-image"
SIZE = 256  # the board draws them at 36px; 256 covers retina and keeps the repo small

# Age band, apparent gender, and a look. Kept deliberately varied: a hospital ward is not one kind of person.
PEOPLE = [
    ("a man in his 20s", "short dark curly hair, light brown skin"),
    ("a woman in her 30s", "long black hair, east asian features"),
    ("a man in his 70s", "white hair, balding, pale skin, reading glasses"),
    ("a woman in her 60s", "short grey bob, freckles, fair skin"),
    ("a man in his 40s", "black skin, close-cropped hair, short beard"),
    ("a woman in her 20s", "auburn hair in a bun, fair skin"),
    ("a man in his 50s", "south asian features, greying temples, glasses"),
    ("a woman in her 80s", "thin white hair, deep wrinkles, brown skin"),
    ("a man in his 30s", "blond hair, stubble, light skin"),
    ("a woman in her 50s", "dark skin, braided hair tied back"),
    ("a man in his 60s", "latino features, grey moustache, olive skin"),
    ("a woman in her 40s", "shoulder-length brown hair, light olive skin, glasses"),
    ("a teenage boy", "messy dark hair, light brown skin"),
    ("a teenage girl", "long straight brown hair, fair skin, braces"),
    ("a man in his 80s", "bald, white beard, pale skin"),
    ("a woman in her 70s", "silver hair pinned up, east asian features"),
    ("a man in his 20s", "middle eastern features, black hair, clean shaven"),
    ("a woman in her 30s", "red hair, very fair skin, freckles"),
    ("a man in his 50s", "heavyset, brown hair thinning, ruddy skin"),
    ("a woman in her 60s", "afro-caribbean features, grey natural hair"),
    ("a man in his 40s", "east asian features, short black hair, glasses"),
    ("a woman in her 20s", "black skin, short bleached hair"),
    ("a man in his 70s", "south asian features, white beard, turban"),
    ("a woman in her 40s", "hijab, warm brown skin, dark eyes"),
]

PROMPT = (
    "A photorealistic head-and-shoulders portrait of {who}, {look}. "
    "This is a synthetic portrait of a person who does not exist. "
    "Neutral calm expression, looking at the camera, soft even studio lighting, "
    "plain light grey background, sharp focus, no text, no watermark, no medical setting, no uniform."
)


def main() -> None:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(PEOPLE)
    os.makedirs(OUT, exist_ok=True)
    client = genai.Client(vertexai=True, project=os.environ.get("GOOGLE_CLOUD_PROJECT", "hop-hacks-509103"),
                          location="global")
    from PIL import Image  # pillow shrinks them; the model returns ~1MP images

    made = 0
    for i, (who, look) in enumerate(PEOPLE[:limit], start=1):
        path = os.path.join(OUT, f"p{i:02d}.jpg")
        if os.path.exists(path):
            print(f"p{i:02d}: already there")
            continue
        data = None
        for attempt in range(6):  # image quota is thin: wait and try again rather than give up
            try:
                r = client.models.generate_content(
                    model=MODEL, contents=PROMPT.format(who=who, look=look),
                    config=types.GenerateContentConfig(response_modalities=["IMAGE"]))
                data = next(p.inline_data.data for c in r.candidates for p in c.content.parts if getattr(p, "inline_data", None))
                break
            except Exception as exc:
                wait = 15 * (attempt + 1)
                print(f"p{i:02d}: {type(exc).__name__} ({str(exc)[:60]}); retrying in {wait}s")
                time.sleep(wait)
        if data is None:  # the board falls back to a drawn face for this one
            print(f"p{i:02d}: gave up")
            continue
        img = Image.open(io.BytesIO(data)).convert("RGB")
        side = min(img.size)
        img = img.crop(((img.width - side) // 2, 0, (img.width + side) // 2, side)).resize((SIZE, SIZE), Image.LANCZOS)
        img.save(path, "JPEG", quality=82, optimize=True)
        made += 1
        print(f"p{i:02d}: {who}, {look} -> {os.path.getsize(path) // 1024} KB")
        time.sleep(8)  # stay under the image quota
    print(f"done: {made} new portrait(s) in web/public/faces/")


if __name__ == "__main__":
    main()
