"""Builds projects/<source>/<name>/collage.mp4, a video background: a living collage by default (10 minutes, one tile
crossfades to another image every 10 s, the centrepiece every 60 s, see rotation.py). --slideshow: random collages, each
shown for a while (20 x 30 s). --still: collage.jpg as collage_still.mp4, a one-frame video (the Meet background is a
video, meet.js puts either in).

The collages are padded to 1920x1080 on black (never cropped) and encoded with PyAV (H.264, its own bundled FFmpeg), at
a low constant frame rate: an unchanged frame costs next to nothing, so the file stays small.
"""
import argparse
import random
import sys
from fractions import Fraction

from PIL import Image

from collage import add_centre_args, centre_image, centre_mode, centre_xy, grid_cells, load_grid, pick, render, tile_image, tile_xy
from common import Progress, add_project_args, ensure_image, load_project
from rotation import rotate

SIZE = (1920, 1080)
FPS = 2
LIVING_FPS = 10  # for the crossfades: the frames in between are the same, so they cost next to nothing


def fit_frame(image, size=SIZE):
    """The image scaled to fit size (never cropped, never enlarged past it), centred on black."""
    scale = min(size[0] / image.width, size[1] / image.height)
    fitted = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    frame = Image.new("RGB", size, "black")
    frame.paste(fitted, ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2))
    return frame


def write_video(path, frames, fps=FPS, keyframes=True):
    """frames = (image, seconds) pairs (a list or a generator), all of SIZE -> an H.264 mp4 at path. keyframes: each image
    starts with a key frame, so the switch (and the loop back to the start) is clean - off for the living collage, where
    a key frame per crossfade step would cost a lot. Written next to it first, so a failed run leaves the old video alone."""
    try:
        import av  # only the video needs it, collage.py works without
    except ImportError:
        sys.exit("❌ PyAV is missing - run `npm run setup:python`")

    part = path.with_suffix(".part.mp4")
    with av.open(str(part), "w", options={"movflags": "+faststart"}) as output:
        stream = output.add_stream("libx264", rate=fps)
        stream.width, stream.height, stream.pix_fmt = SIZE[0], SIZE[1], "yuv420p"
        stream.options = {"crf": "28", "tune": "stillimage"}
        if not keyframes:
            # only the first frame needs to be a full picture (the loop starts there), x264 would add one every 250 frames
            stream.codec_context.gop_size = 1_000_000
        pts = 0
        for image, seconds in frames:
            frame = av.VideoFrame.from_image(image).reformat(format="yuv420p")
            frame.time_base = Fraction(1, fps)
            for repeat in range(max(1, round(seconds * fps))):
                frame.pts = pts
                key = repeat == 0 and (keyframes or pts == 0)
                frame.pict_type = av.video.frame.PictureType.I if key else av.video.frame.PictureType.NONE
                output.mux(stream.encode(frame))
                pts += 1
        output.mux(stream.encode())
    part.replace(path)


def duration(seconds):
    return f"{int(seconds // 60)}:{int(seconds % 60):02d}"


def still(project):
    """collage.jpg as collage_still.mp4: the Meet background only takes a video, this one just doesn't move."""
    collage = project["dir"] / "collage.jpg"
    if not collage.exists():
        sys.exit(f"❌ {project['folder']}/collage.jpg is missing - run `npm run collage -- -p {project['id']}` first")
    with Image.open(collage) as image:
        frame = fit_frame(image.convert("RGB"))
    write_video(project["dir"] / "collage_still.mp4", [(frame, 1)], fps=1)


def living(project, items, grid, cells, args, rng=random):
    """The living collage's frames, (image, seconds) for write_video: the first collage, then per step a hold and a
    crossfade to the next state (one tile, and every centre_every seconds the centrepiece). Returns (frames, steps)."""
    usable = [item for item in items if ensure_image(project, item)]
    by_id = {item["id"]: item for item in usable}
    picked = pick(usable, cells, centre_mode(args))
    canvas, _drawn = render(project, grid, picked)
    steps = max(1, round(args.minutes * 60 / args.every))
    fade = min(args.fade, args.every)
    changes = rotate({cell: item["id"] for cell, item in picked["tiles"]}, picked["centre"] and picked["centre"]["id"],
                     list(by_id), steps, rng, centre_every=max(1, round(args.centre_every / args.every)),
                     cooldown=max(1, round(args.cooldown / args.every)))
    progress = Progress(steps, "changes drawn")

    def apply(base, step_changes):
        result = base.copy()
        for kind, cell, _old, new in step_changes:
            path = ensure_image(project, by_id[new])
            if kind == "tile":
                result.paste(tile_image(grid, path), tile_xy(grid, cell))
            else:
                result.paste(centre_image(grid, path), centre_xy(grid))
        return result

    def frames():
        nonlocal canvas
        fade_frames = round(fade * LIVING_FPS)
        for step_changes in changes:
            progress.step()
            yield fit_frame(canvas), args.every - fade
            following = apply(canvas, step_changes)
            for k in range(1, fade_frames + 1):
                yield fit_frame(Image.blend(canvas, following, k / fade_frames)), 1 / LIVING_FPS
            canvas = following
        progress.done()

    return frames(), steps


def slideshow(project, items, grid, cells, args):
    progress = Progress(args.segments, "collages drawn")

    def frames():  # one at a time, drawn while the video is written
        for _ in range(args.segments):
            progress.step()
            canvas, _drawn = render(project, grid, pick(items, cells, centre_mode(args)))
            yield fit_frame(canvas), args.seconds
        progress.done()

    return frames()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_project_args(parser)
    add_centre_args(parser)
    parser.add_argument("--minutes", type=float, default=10, help="living collage: how long (default 10)")
    parser.add_argument("--every", type=float, default=10, help="living collage: seconds between tile changes (default 10)")
    parser.add_argument("--centre-every", type=float, default=60, help="living collage: seconds between centrepiece changes (default 60)")
    parser.add_argument("--fade", type=float, default=1, help="living collage: seconds of crossfade, 0 for a cut (default 1)")
    parser.add_argument("--cooldown", type=float, default=300, help="living collage: seconds before an image can come back (default 300)")
    parser.add_argument("--slideshow", action="store_true", help="random collages one after another instead")
    parser.add_argument("--segments", type=int, default=20, help="slideshow: how many collages (default 20)")
    parser.add_argument("--seconds", type=float, default=30, help="slideshow: how long each is shown (default 30)")
    parser.add_argument("--still", action="store_true", help="only the project's collage.jpg as a one-frame video (collage_still.mp4)")
    args = parser.parse_args()
    if min(args.segments, args.seconds, args.minutes, args.every, args.centre_every, args.cooldown) <= 0 or args.fade < 0:
        sys.exit("❌ the lengths need to be above 0, like --minutes 10 --every 10 (or --segments 20 --seconds 30)")

    project = load_project(args.project_json)
    if args.still:
        still(project)
        return
    items, grid = load_grid(project, args.layout)
    cells = grid_cells(grid, project["collage"].get("skip", []), args.fill)

    output = project["dir"] / "collage.mp4"
    if args.slideshow:
        write_video(output, slideshow(project, items, grid, cells, args))
        what = f"{args.segments} x {args.seconds:g} s = {duration(args.segments * args.seconds)}"
    else:
        frames, steps = living(project, items, grid, cells, args)
        write_video(output, frames, fps=LIVING_FPS, keyframes=False)
        what = f"living, {duration(steps * args.every)}, a change every {args.every:g} s"
    size = output.stat().st_size / 1e6
    print(f"Saved {project['folder']}/collage.mp4 ({what}, layout {grid['layout']}, {size:.1f} MB)")


if __name__ == "__main__":
    main()
