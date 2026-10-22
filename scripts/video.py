"""Builds projects/<source>/<name>/collage.mp4: a video background of random collages, each shown for a while (20 x 30 s
by default, 10 minutes). Experimental: upload it in Google Meet as a background by hand.

The collages are padded to 1920x1080 on black (never cropped) and encoded with PyAV (H.264, its own bundled FFmpeg), at
a low constant frame rate: an unchanged frame costs next to nothing, so the file stays small.
"""
import argparse
import sys
from fractions import Fraction

from PIL import Image

from collage import add_centre_args, centre_mode, grid_cells, load_grid, pick, render
from common import Progress, add_project_args, load_project

SIZE = (1920, 1080)
FPS = 2


def fit_frame(image, size=SIZE):
    """The image scaled to fit size (never cropped, never enlarged past it), centred on black."""
    scale = min(size[0] / image.width, size[1] / image.height)
    fitted = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    frame = Image.new("RGB", size, "black")
    frame.paste(fitted, ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2))
    return frame


def write_video(path, frames, fps=FPS):
    """frames = (image, seconds) pairs (a list or a generator), all of SIZE -> an H.264 mp4 at path. Each image starts with a key frame, so the switch
    (and the loop back to the start) is clean. Written next to it first, so a failed run leaves the old video alone."""
    try:
        import av  # only the video needs it, collage.py works without
    except ImportError:
        sys.exit("❌ PyAV is missing - run `npm run setup:python`")

    part = path.with_suffix(".part.mp4")
    with av.open(str(part), "w", options={"movflags": "+faststart"}) as output:
        stream = output.add_stream("libx264", rate=fps)
        stream.width, stream.height, stream.pix_fmt = SIZE[0], SIZE[1], "yuv420p"
        stream.options = {"crf": "28", "tune": "stillimage"}
        pts = 0
        for image, seconds in frames:
            frame = av.VideoFrame.from_image(image).reformat(format="yuv420p")
            frame.time_base = Fraction(1, fps)
            for repeat in range(max(1, round(seconds * fps))):
                frame.pts = pts
                frame.pict_type = av.video.frame.PictureType.I if repeat == 0 else av.video.frame.PictureType.NONE
                output.mux(stream.encode(frame))
                pts += 1
        output.mux(stream.encode())
    part.replace(path)


def duration(seconds):
    return f"{int(seconds // 60)}:{int(seconds % 60):02d}"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_project_args(parser)
    add_centre_args(parser)
    parser.add_argument("--segments", type=int, default=20, help="how many collages (default 20)")
    parser.add_argument("--seconds", type=float, default=30, help="how long each is shown (default 30)")
    args = parser.parse_args()
    if args.segments < 1 or args.seconds <= 0:
        sys.exit("❌ --segments and --seconds need to be above 0, like --segments 20 --seconds 30")

    project = load_project(args.project_json)
    items, grid = load_grid(project, args.layout)
    cells = grid_cells(grid, project["collage"].get("skip", []), args.fill)

    progress = Progress(args.segments, "collages drawn")

    def frames():  # one at a time, drawn while the video is written
        for _ in range(args.segments):
            progress.step()
            canvas, _drawn = render(project, grid, pick(items, cells, centre_mode(args)))
            yield fit_frame(canvas), args.seconds

    output = project["dir"] / "collage.mp4"
    write_video(output, frames())
    progress.done()
    size = output.stat().st_size / 1e6
    print(f"Saved {project['folder']}/collage.mp4 ({args.segments} x {args.seconds:g} s = {duration(args.segments * args.seconds)}, "
          f"layout {grid['layout']}, {size:.1f} MB)")


if __name__ == "__main__":
    main()
