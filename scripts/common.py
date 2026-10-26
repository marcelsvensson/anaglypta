"""Shared helpers for collage.py, cache.py and the local source: the project Node passes along, items.json and the
image cache (the cropped copies in images/)."""
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

try:  # HEIC/HEIF photos (iPhone), installed by `npm run setup:python`
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIF = True
except ImportError:
    HEIF = False

ROOT = Path(__file__).resolve().parent.parent
USER_AGENT = "anaglypta/1.0"


class Progress:
    """"12 / 200 images handled" on one line that updates itself, in a terminal. Elsewhere (cron logs) only the last
    count is written, by done()."""

    showing = None  # the Progress whose line is on screen, warn() clears it first

    def __init__(self, total, label="images handled", stream=None):
        self.total, self.label, self.count = total, label, 0
        self.stream = stream or sys.stdout
        self.live = self.stream.isatty()

    def text(self):
        return f"{self.count} / {self.total} {self.label}"

    def step(self):
        self.count += 1
        if self.live:
            self.stream.write(f"\r{self.text()}\033[K")
            self.stream.flush()
            Progress.showing = self

    def clear(self):
        if self.live:
            self.stream.write("\r\033[K")
            self.stream.flush()

    def done(self):
        """Leaves the final count on its own line (nothing when there was nothing to do)."""
        if Progress.showing is self:
            Progress.showing = None
        if self.count:
            if self.live:
                self.stream.write(f"\r{self.text()}\033[K\n")
            else:
                self.stream.write(f"{self.text()}\n")
            self.stream.flush()


def warn(message):
    if Progress.showing:
        Progress.showing.clear()  # the warning gets its own line, the count comes back with the next step
    sys.stdout.flush()  # keep warnings in order with the regular output
    print(f"⚠️  {message}", file=sys.stderr)


def read_json(path, fallback):
    if not path.exists():
        return fallback
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


# --- projects: resolved by Node (lib/utils/projects.js), passed along by scripts/python.js ---

def add_project_args(parser):
    parser.add_argument("--project-json", help="the project, as Node resolved it (npm passes it along)")


def load_project(project_json):
    """The project Node resolved (settings.json + projects.json + -s/-p, see lib/utils/projects.js), with dir as a Path.
    Exits with a hint when the script was run by hand instead of through npm."""
    if not project_json:
        sys.exit("❌ Run this through npm, like `npm run collage` - it passes the project along (--project-json)")
    project = json.loads(project_json)
    return {**project, "dir": Path(project["dir"])}


def items_path(project):
    return project["dir"] / "items.json"


def read_data(project):
    """items.json: { source, project, state, items }, empty when the project hasn't been fetched yet."""
    data = read_json(items_path(project), {})
    return {**data, "source": project["source"], "project": project["name"], "state": data.get("state", {}), "items": data.get("items", [])}


def write_data(project, data):
    write_json(items_path(project), data)


def read_items(project):
    """The project's items, oldest first, each id once (the first one wins)."""
    items = []
    seen = set()
    for item in read_data(project)["items"]:
        if item.get("id") and item["id"] not in seen:
            seen.add(item["id"])
            items.append(item)
    return items


# --- the square image cache: projects/<source>/<name>/images/<id>.jpg ---

def image_path(project, item):
    return project["dir"] / "images" / f"{item['id']}.jpg"


def label(item):
    return item.get("title") or item["id"]


def parse_aspect(text):
    """'2:3' -> (2, 3), also 2x3 and 2/3. ValueError for anything else."""
    match = re.fullmatch(r"\s*(\d+)\s*[:x/]\s*(\d+)\s*", str(text or "1:1"))
    if not match or not int(match[1]) or not int(match[2]):
        raise ValueError(f'aspect "{text}" should look like 1:1, 2:3 or 16:9')
    return int(match[1]), int(match[2])


def image_dimensions(project):
    """The size of the project's cached copies: its aspect ratio, imageSize on the long side."""
    aspect_width, aspect_height = parse_aspect(project.get("aspect"))
    size = project.get("imageSize", 640)
    if aspect_width >= aspect_height:
        return size, round(size * aspect_height / aspect_width)
    return round(size * aspect_width / aspect_height), size


def crop(image, dimensions):
    """Turned upright (EXIF), RGB, cropped around the centre to the ratio of dimensions and resized - never stretched."""
    image = ImageOps.exif_transpose(image)
    return ImageOps.fit(image.convert("RGB"), dimensions, Image.Resampling.LANCZOS)


def image_ready(project, item):
    """The cached copy exists with the project's current shape and size (aspect and imageSize can change)."""
    path = image_path(project, item)
    if not path.exists():
        return False
    try:
        with Image.open(path) as cached:
            return cached.size == image_dimensions(project)
    except Exception:  # a broken copy is made again
        return False


def download(url, retries=3):
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=15) as response:
                return response.read()
        except Exception:  # network and http errors alike
            if attempt == retries:
                raise
            time.sleep(attempt)


def open_source(source, retries=3):
    """The item's image: downloaded when source is a url, else read from the file."""
    if source.startswith(("http://", "https://")):
        image = Image.open(io.BytesIO(download(source, retries)))
    else:
        image = Image.open(source)
    image.load()
    return image


def ensure_image(project, item, retries=3):
    """Path to the item's cached copy, made first if needed (or when the project's shape or size changed - the old copy
    is used when that fails). None if the source can't be read."""
    path = image_path(project, item)
    if image_ready(project, item):
        return path
    fallback = path if path.exists() else None
    if fallback:
        retries = 1  # an old copy can stand in, no need to wait for retries (offline after an aspect change)

    source = item.get("source")
    if not source:
        warn(f"No image for {label(item)}")
        return fallback
    try:
        with open_source(source, retries) as image:
            cropped = crop(image, image_dimensions(project))
    except Exception as error:  # network errors and broken or unknown images alike
        hint = " (HEIC needs `npm run setup:python`)" if not HEIF and source.lower().endswith((".heic", ".heif")) else ""
        warn(f"Could not read the image for {label(item)}: {error}{hint}")
        return fallback

    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(".part")
    cropped.save(part, "JPEG", quality=90)
    part.replace(path)
    return path


def load_tile(path, width, height, scale):
    """The image cropped to width x height, then blown up x scale without smoothing (pixel art)."""
    with Image.open(path) as image:
        small = ImageOps.fit(image.convert("RGB"), (width, height), Image.Resampling.LANCZOS)
    return small.resize((width * scale, height * scale), Image.Resampling.NEAREST)


def canvas_size(col, row, cell_width, cell_height, gap):
    return (col * cell_width + (col + 1) * gap, row * cell_height + (row + 1) * gap)


def cell_xy(col_index, row_index, cell_width, cell_height, gap):
    """Top left pixel of a grid cell."""
    return (gap + (cell_width + gap) * col_index, gap + (cell_height + gap) * row_index)
