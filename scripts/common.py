"""Shared helpers for bitmapper.py and bitmapper_collage.py."""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TMP = ROOT / "tmp"
USER_AGENT = "anaglypta/1.0"

ALBUM_FILE = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.md$")


def warn(message):
    sys.stdout.flush()  # keep warnings in order with the regular output
    print(f"⚠️  {message}", file=sys.stderr)


def load_settings(provider):
    with open(ROOT / "settings.json", encoding="utf-8") as f:
        settings = json.load(f)
    if provider not in settings:
        sys.exit(f"Unknown provider '{provider}' - expected one of: {', '.join(settings)} (see settings.json)")
    return settings[provider]


def album_sort_key(file_name):
    """<date>.md, then <date>-0.md, <date>-1.md ... (a plain string sort puts -0 first)"""
    match = ALBUM_FILE.match(file_name)
    if not match:
        return (file_name, -1)
    date, suffix = match.groups()
    return (date, -1 if suffix is None else int(suffix))


def parse_frontmatter(text):
    """Reads the flat `key: value` lines written by generate.js, list items (tags) are skipped."""
    data = {}
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return data
    for line in lines[1:]:
        stripped = line.strip()
        if stripped == "---":
            break
        key, separator, value = stripped.partition(":")
        if not separator or stripped.startswith("-"):
            continue
        value = value.strip()
        if value.startswith('"'):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                value = value.strip('"')
        data[key] = value
    return data


def album_key(album):
    """Albums are unique by albumId (older files without one fall back to the track id)."""
    return album.get("albumId") or album.get("id") or album["file"]


def read_albums(project):
    """All albums in <project>/*.md, oldest first, one per album (the first song added wins)."""
    folder = ROOT / project
    if not folder.is_dir():
        return []
    files = sorted((f for f in folder.iterdir() if f.suffix == ".md"), key=lambda f: album_sort_key(f.name))
    albums = []
    seen = set()
    for file in files:
        album = parse_frontmatter(file.read_text(encoding="utf-8"))
        album["file"] = file.name
        if album_key(album) in seen:
            continue
        seen.add(album_key(album))
        albums.append(album)
    return albums


def cover_path(project, album):
    """One cached cover per album, shared by every project."""
    return TMP / "covers" / f"{album_key(album)}.jpeg"


def ensure_cover(project, album, retries=3):
    """Path to the cached cover, downloading it first if needed. None if it can't be fetched."""
    path = cover_path(project, album)
    if path.exists():
        return path

    url = album.get("images")
    if not url:
        warn(f"No image url in {album['file']}")
        return None

    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(".part")
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=15) as response, open(part, "wb") as f:
                f.write(response.read())
            with Image.open(part) as image:
                image.verify()
            part.replace(path)
            return path
        except Exception as error:  # network/http errors and broken images alike
            part.unlink(missing_ok=True)
            if attempt == retries:
                warn(f"Could not download the cover for {album['file']}: {error}")
                return None
            time.sleep(attempt)


def load_cover(path, width, height, scale):
    """The cover shrunk to width x height, then blown up x scale without smoothing (pixel art)."""
    with Image.open(path) as image:
        small = image.convert("RGB").resize((width, height))
    return small.resize((width * scale, height * scale), Image.Resampling.NEAREST)


def canvas_size(col, row, cell_width, cell_height, gap):
    return (col * cell_width + (col + 1) * gap, row * cell_height + (row + 1) * gap)


def cell_xy(col_index, row_index, cell_width, cell_height, gap):
    """Top left pixel of a grid cell."""
    return (gap + (cell_width + gap) * col_index, gap + (cell_height + gap) * row_index)
