"""Makes assets/anaglypta.mp4, committed to the repo: the Anaglypta card you upload in Google Meet once (`npm run setup:meet`
pads it and shows you how). Meet makes its background thumbnail from it, so that's what you see in Meet's list from then on.
Run it again only to change how it looks:

    node scripts/python.js scripts/brand.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from video import SIZE, write_video

ASSETS = Path(__file__).resolve().parent.parent / "assets"
CARD = ASSETS / "anaglypta.mp4"
GREEN = (57, 255, 20)
# Meet crops its background thumbnails to about the middle, so the name stays inside the centre this wide
TEXT_WIDTH = 0.45


def fitting_font(draw, text, width, height):
    """Pillow's built-in font at the largest size where text's ink fits in width x height."""
    def fits(size):
        box = draw.textbbox((0, 0), text, font=ImageFont.load_default(size=size))
        return box[2] - box[0] <= width and box[3] - box[1] <= height

    size = 4
    while fits(size + 1):
        size += 1
    return ImageFont.load_default(size=size)


def card(size=SIZE):
    """Black, "Anaglypta" in green, in the middle and no wider than the part Meet's thumbnail keeps."""
    width, height = size
    image = Image.new("RGB", size, "black")
    draw = ImageDraw.Draw(image)
    font = fitting_font(draw, "Anaglypta", width * TEXT_WIDTH, height * 0.4)
    box = draw.textbbox((0, 0), "Anaglypta", font=font)
    # the box's own offset (box[0], box[1]) is taken off, so the ink itself is centred
    draw.text(((width - (box[2] - box[0])) / 2 - box[0], (height - (box[3] - box[1])) / 2 - box[1]), "Anaglypta", font=font, fill=GREEN)
    return image


def main():
    ASSETS.mkdir(exist_ok=True)
    write_video(CARD, [(card(), 1)], fps=1)
    print(f"Saved assets/{CARD.name} ({CARD.stat().st_size / 1000:.0f} KB)")


if __name__ == "__main__":
    main()
