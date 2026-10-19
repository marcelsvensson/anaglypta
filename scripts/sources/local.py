"""The local source: images from a folder on this computer -> projects/local/<name>/items.json + square copies in images/.

Reads the images in the project's folder - only that folder, never its subfolders (a path like ~ would otherwise
walk your whole home folder) - hidden files skipped. New images are
added oldest first (the EXIF date taken, else the file's modification time), up to maxItems (--limit n: at most n per
run). Images that are gone (or changed, they come back as new) are dropped. The square copies are made right away,
so broken files show up now and not in the collage - once: state.unreadable remembers them until they change.

--count <folder>: prints {"images": n, "others": n} for `npm run setup`.
"""
import argparse
import hashlib
import json
import sys
from datetime import date, datetime
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from common import HEIF, add_project_args, ensure_image, image_path, load_project, read_data, warn, write_data  # noqa: E402

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif"}
EXIF_IFD = 0x8769
DATE_TAKEN = 0x9003  # DateTimeOriginal, in the EXIF IFD
DATE_TIME = 0x0132  # DateTime, when the file was last edited by a camera or app


def scan(folder):
    """(image files sorted by path, number of other files) directly in folder: no subfolders, no hidden files."""
    images, others = [], 0
    for path in Path(folder).iterdir():
        if path.name.startswith(".") or not path.is_file():
            continue
        if path.suffix.lower() in EXTENSIONS:
            images.append(path)
        else:
            others += 1
    return sorted(images), others


def item_id(path):
    """The same file gives the same id, an edited (or replaced) file a new one, so its square copy is made again."""
    stat = path.stat()
    return hashlib.sha1(f"{path.resolve()}\0{stat.st_size}\0{stat.st_mtime_ns}".encode()).hexdigest()[:16]


def date_taken(image, path):
    """When the photo was taken (EXIF), else the file's modification time, as 2026-01-31T12:00:00."""
    exif = image.getexif()
    value = exif.get_ifd(EXIF_IFD).get(DATE_TAKEN) or exif.get(DATE_TIME)
    try:
        return datetime.strptime(str(value).strip("\0 "), "%Y:%m:%d %H:%M:%S").isoformat()
    except ValueError:
        return datetime.fromtimestamp(path.stat().st_mtime).replace(microsecond=0).isoformat()


def fetch(project, limit=None):
    """Brings items.json in line with the folder, returns (added, dropped, skipped) counts."""
    folder = project.get("path")
    if not folder:
        sys.exit(f"❌ local.{project['name']}.path is missing in projects.json")
    folder = Path(folder)
    if not folder.is_dir():
        sys.exit(f"❌ {folder} isn't a folder (local.{project['name']}.path in projects.json)")

    data = read_data(project)
    files, others = scan(folder)
    current = {item_id(path): path for path in files}

    kept = [item for item in data["items"] if item["id"] in current]
    dropped = [item for item in data["items"] if item["id"] not in current]
    for item in dropped:
        image_path(project, item).unlink(missing_ok=True)

    known = {item["id"] for item in kept}
    # files that couldn't be read before are skipped quietly (an edited file gets a new id and is tried again)
    unreadable = {id_ for id_ in data["state"].get("unreadable", []) if id_ in current}
    free = max(0, project.get("maxItems", 200) - len(kept))
    wanted = min(free, limit) if limit else free
    skipped = 0

    def skip(id_, path, error):
        nonlocal skipped
        hint = " (HEIC needs `npm run setup:python`)" if not HEIF and path.suffix.lower() in (".heic", ".heif") else ""
        warn(f"Skipped {path.name}: {error}{hint}")
        unreadable.add(id_)
        skipped += 1

    candidates = []
    if wanted:
        for id_, path in current.items():
            if id_ in known or id_ in unreadable:
                continue
            try:
                with Image.open(path) as image:
                    candidates.append((date_taken(image, path), str(path), id_))
            except Exception as error:  # not an image after all, or a format Pillow can't read
                skip(id_, path, error)

    added = []
    for taken, path, id_ in sorted(candidates):
        if len(added) >= wanted:
            break
        path = Path(path)
        item = {"id": id_, "title": path.stem, "subtitle": folder.name, "addedAt": taken, "source": str(path)}
        if ensure_image(project, item) is None:
            unreadable.add(id_)
            skipped += 1
            continue
        added.append(item)
        print(f"Added {path.name}")

    data["items"] = kept + added
    data["state"] = {**data["state"], "path": str(folder), "unreadable": sorted(unreadable)}
    if added:
        data["state"]["lastFetched"] = date.today().isoformat()
    write_data(project, data)

    if dropped:
        print(f"Dropped {len(dropped)} image(s) that are gone from {folder} (or changed, they're added again)")
    if others:
        print(f"Ignored {others} file(s) that aren't images")
    if not free:
        print(f"{project['id']} already has {len(kept)} images (maxItems) - nothing added")
    elif not added:
        print(f"No new images in {folder}")
    print(f"{len(added)} new image(s), {len(data['items'])} images in {project['id']}")
    return len(added), len(dropped), skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_project_args(parser)
    parser.add_argument("--limit", type=int, help="the most new images one run adds")
    parser.add_argument("--count", metavar="FOLDER", help="only count the images in FOLDER (for npm run setup)")
    args = parser.parse_args()

    if args.count:
        folder = Path(args.count).expanduser()
        if not folder.is_dir():
            sys.exit(f"❌ {folder} isn't a folder")
        images, others = scan(folder)
        print(json.dumps({"images": len(images), "others": others}))
        return

    if args.limit is not None and args.limit < 1:
        sys.exit("❌ --limit needs a whole number of images, like --limit 1")
    project = load_project(args.source or "local", args.project)
    if project["source"] != "local":
        sys.exit(f"❌ {project['id']} isn't a local project")
    fetch(project, args.limit)


if __name__ == "__main__":
    main()
