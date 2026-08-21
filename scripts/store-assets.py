"""Generate the Microsoft Store artwork from the app icon and brand palette.

    python scripts/store-assets.py logos   # logos, poster/box/hero art
    python scripts/store-assets.py shots   # wrap raw screenshots in captioned frames
    python scripts/store-assets.py all

`logos` needs nothing but app-icon.png. `shots` reads raw captures from
store-assets/raw/ (named 1-annotate.png, 2-whiteboard.png, ...) and composes
each onto a branded 1920x1080 frame with a caption, so the listing looks like
one set rather than five loose screen grabs.

Everything lands in store-assets/ - upload from there, keep it out of the app.
"""

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store-assets"
RAW = OUT / "raw"

# Palette taken from the app icon and the overlay toolbar, so the art matches
# the product exactly.
BG = (16, 16, 20)  # #101014  icon background / toolbar
ACCENT = (255, 213, 46)  # #FFD52E  the icon's ring
INK = (242, 242, 245)  # #F2F2F5  primary text
MUTED = (154, 154, 164)  # #9A9AA4 secondary text
STROKE = (47, 180, 246)  # #2FB4F6 Penlight's default drawing colour
LINE = (255, 255, 255)  # borders, used at low alpha

FONTS = Path("C:/Windows/Fonts")


def font(size, weight="regular"):
    names = {"regular": "segoeui.ttf", "semibold": "seguisb.ttf", "bold": "segoeuib.ttf"}
    path = FONTS / names[weight]
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()  # keeps the script runnable off-Windows


def backdrop(w, h, motif=True):
    """Brand background: near-black base, warm glow, and a faint ink stroke.

    The stroke is the product in one mark - a hand-drawn line over a dark
    screen - so the art reads as Penlight even at thumbnail size.
    """
    img = Image.new("RGB", (w, h), BG)

    # Soft radial glow a little above centre. Deliberately the ink blue, not the
    # icon's yellow: yellow is so light that at any usable strength it washes the
    # near-black base out to olive. Keep the yellow for the icon itself.
    glow = Image.new("L", (w, h), 0)
    gd = ImageDraw.Draw(glow)
    r = int(max(w, h) * 0.42)
    gd.ellipse(
        [w // 2 - r, int(h * 0.36) - r, w // 2 + r, int(h * 0.36) + r],
        fill=38,
    )
    glow = glow.filter(ImageFilter.GaussianBlur(max(w, h) * 0.18))
    img.paste(Image.new("RGB", (w, h), STROKE), (0, 0), glow)

    if motif:
        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(overlay)
        # A single sweeping stroke, tapering like a real pen stroke would.
        pts = []
        for i in range(0, 101):
            t = i / 100
            x = int(w * (-0.05 + 1.10 * t))
            y = int(h * (0.72 + 0.10 * math.sin(t * math.pi * 1.6)))
            pts.append((x, y))
        for i in range(len(pts) - 1):
            t = i / (len(pts) - 1)
            width = max(1, int((max(w, h) * 0.014) * math.sin(t * math.pi)))
            d.line([pts[i], pts[i + 1]], fill=(*STROKE, 90), width=width)
        overlay = overlay.filter(ImageFilter.GaussianBlur(max(1, int(max(w, h) * 0.004))))
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    return img


def place_icon(img, box_size, center):
    icon = Image.open(ROOT / "app-icon.png").convert("RGBA")
    icon = icon.resize((box_size, box_size), Image.LANCZOS)

    # Drop shadow so the tile reads as a raised object, not a sticker.
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    pad = int(box_size * 0.06)
    sd.rounded_rectangle(
        [center[0] - box_size // 2, center[1] - box_size // 2 + pad,
         center[0] + box_size // 2, center[1] + box_size // 2 + pad],
        radius=int(box_size * 0.22), fill=(0, 0, 0, 150),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(box_size * 0.06))
    img = Image.alpha_composite(img.convert("RGBA"), shadow)
    img.paste(icon, (center[0] - box_size // 2, center[1] - box_size // 2), icon)
    return img.convert("RGB")


def centered(draw, text, y, f, fill, width):
    w = draw.textbbox((0, 0), text, font=f)[2]
    draw.text(((width - w) // 2, y), text, font=f, fill=fill)


def art(w, h, with_text, path):
    img = backdrop(w, h)
    scale = min(w, h)
    if with_text:
        img = place_icon(img, int(scale * 0.34), (w // 2, int(h * 0.40)))
        d = ImageDraw.Draw(img)
        centered(d, "Penlight", int(h * 0.60), font(int(scale * 0.095), "semibold"), INK, w)
        centered(d, "Draw over anything, live.", int(h * 0.60) + int(scale * 0.125),
                 font(int(scale * 0.038)), MUTED, w)
    else:
        # Hero art must not carry the product title - icon only.
        img = place_icon(img, int(h * 0.42), (w // 2, h // 2))
    img.save(path)
    print(f"  {path.name}  {w}x{h}")


def logos():
    OUT.mkdir(exist_ok=True)
    print("Store logos:")
    icon = Image.open(ROOT / "app-icon.png").convert("RGBA")
    for size in (300, 150, 71):
        p = OUT / f"logo-{size}.png"
        icon.resize((size, size), Image.LANCZOS).save(p)
        print(f"  {p.name}  {size}x{size}")

    print("Poster art (9:16):")
    art(720, 1080, True, OUT / "poster-720x1080.png")
    art(1440, 2160, True, OUT / "poster-1440x2160.png")
    print("Box art (1:1):")
    art(1080, 1080, True, OUT / "box-1080x1080.png")
    art(2160, 2160, True, OUT / "box-2160x2160.png")
    print("Super hero art (16:9, no title text):")
    art(1920, 1080, False, OUT / "hero-1920x1080.png")


# Caption per raw screenshot. The number prefix decides the order in the listing.
CAPTIONS = {
    "1-annotate": ("Draw over anything, live",
                   "Video keeps playing and your webcam keeps running underneath."),
    "2-whiteboard": ("Infinite whiteboards that save themselves",
                     "Pan, zoom, and switch boards mid-presentation."),
    "3-halo": ("Let people follow your cursor",
               "A halo and click ripples, so nobody loses the pointer."),
    "4-spotlight": ("Spotlight what matters",
                    "Dim the rest of the screen and pull every eye to one place."),
    "5-zoom": ("Zoom in without losing the room",
               "A lens that follows your cursor - and shows up in recordings."),
}


def shots():
    if not RAW.exists() or not any(RAW.glob("*.png")):
        print(f"No raw screenshots found in {RAW}")
        print("Drop your captures there named 1-annotate.png, 2-whiteboard.png,")
        print("3-halo.png, 4-spotlight.png, 5-zoom.png - then re-run.")
        return

    W, H = 1920, 1080
    print("Screenshots:")
    for src in sorted(RAW.glob("*.png")):
        # Case-insensitive: captures come off Windows, where 5-Zoom.png and
        # 5-zoom.png are the same file to a human but not to dict lookup.
        title, sub = CAPTIONS.get(src.stem.lower(), (src.stem.replace("-", " ").title(), ""))
        img = backdrop(W, H)
        d = ImageDraw.Draw(img)
        centered(d, title, 62, font(52, "semibold"), INK, W)
        if sub:
            centered(d, sub, 132, font(28), MUTED, W)

        # Fit the capture below the caption. Never scale ABOVE 1.0 - enlarging a
        # UI screenshot softens the text, which is the one thing that has to stay
        # legible at Store thumbnail size.
        shot = Image.open(src).convert("RGB")
        top, bottom = 200, H - 56
        avail_w, avail_h = W - 160, bottom - top
        ratio = min(avail_w / shot.width, avail_h / shot.height, 1.0)
        if ratio < 1.0:
            shot = shot.resize((int(shot.width * ratio), int(shot.height * ratio)), Image.LANCZOS)
        x = (W - shot.width) // 2
        y = top + (avail_h - shot.height) // 2

        # Rounded corners + border, matching the app's own card radius.
        mask = Image.new("L", shot.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, shot.width, shot.height], radius=12, fill=255)
        shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            [x, y + 14, x + shot.width, y + shot.height + 14], radius=12, fill=(0, 0, 0, 170))
        img = Image.alpha_composite(img.convert("RGBA"),
                                    shadow.filter(ImageFilter.GaussianBlur(22))).convert("RGB")
        img.paste(shot, (x, y), mask)
        ImageDraw.Draw(img).rounded_rectangle(
            [x, y, x + shot.width, y + shot.height], radius=12, outline=(*LINE, 60), width=1)

        out = OUT / f"screenshot-{src.stem}.png"
        img.save(out)
        print(f"  {out.name}  {W}x{H}   <- {src.name}")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    OUT.mkdir(exist_ok=True)
    if what in ("logos", "all"):
        logos()
    if what in ("shots", "all"):
        shots()
    if what not in ("logos", "shots", "all"):
        print(__doc__)
