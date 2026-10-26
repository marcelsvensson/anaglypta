"""The living collage (video.py): which tile changes when, and to what. Pure and seeded, so it's tested without images.

Every step (10 s in the video) one tile changes to an item that isn't on screen; every centre_every-th step (60 s) the
centrepiece too. An item that leaves cools down for `cooldown` steps before it can come back, unless there's nothing
else left: then the one that has waited longest comes back. The next tile is random, but never one of the last few that
changed or a neighbour of them, so the changes wander over the grid.

The last step always brings the original centrepiece back (it's kept out of the grid for that). With rewind, the tiles
go back too: from as late as possible, every step puts back up to per_step changed tiles, in the order they first
changed, spread evenly - so the video ends where it started and its loop is seamless.
"""
import math
from collections import deque


def neighbours(cell):
    """The cell and the 8 around it."""
    col, row = cell
    return {(col + dc, row + dr) for dc in (-1, 0, 1) for dr in (-1, 0, 1)}


def rotate(tiles, centre, items, steps, rng, centre_every=6, cooldown=30, spread=3, rewind=False, per_step=9):
    """tiles = {cell: item id} on screen, centre = the centrepiece's item id (None: no centrepiece), items = every item id
    that may be shown. Yields one list of changes per step: ("tile", cell, old id, new id) and ("centre", None, old id, new id)."""
    tiles = dict(tiles)
    original, original_centre = dict(tiles), centre
    on_screen = set(tiles.values()) | ({centre} if centre is not None else set())
    # the original centrepiece is kept for the end, never a tile
    pool = [item for item in items if item not in on_screen and item != original_centre]
    cooling = deque()  # (item, the step it's free again), oldest first
    recent = deque(maxlen=spread)
    first_changed = []  # cells in the order of their first change, for the rewind
    been_centre = {centre}  # a centrepiece isn't repeated while there's another to choose
    rewinding = False

    def take(allowed=lambda item: True):
        """A random allowed item from the pool, else the allowed one that has cooled down longest, else None."""
        choices = [index for index, item in enumerate(pool) if allowed(item)]
        if choices:
            return pool.pop(rng.choice(choices))
        for index, (item, _free) in enumerate(cooling):
            if allowed(item):
                del cooling[index]
                return item
        return None

    def take_centre():
        """The next centrepiece: one that hasn't been the centrepiece yet if there is one (from the pool, else the cooldown),
        else any. While rewinding, not a tile's original (that tile wants it back)."""
        allowed = (lambda item: item not in original.values()) if rewinding else (lambda item: True)
        new = take(lambda item: allowed(item) and item not in been_centre)
        return new if new is not None else take(allowed)

    def claim(item):
        """item goes on screen: out of the pool or the cooldown."""
        if item in pool:
            pool.remove(item)
        for index, (waiting, _free) in enumerate(cooling):
            if waiting == item:
                del cooling[index]
                break

    def leave(item, step):
        if item is not None and item != original_centre:
            cooling.append((item, step + cooldown))

    def next_cell():
        blocked = set().union(*(neighbours(cell) for cell in recent)) if recent else set()
        for allowed in ([c for c in tiles if c not in blocked], [c for c in tiles if c not in recent], list(tiles)):
            if allowed:
                return rng.choice(sorted(allowed))
        return None

    def pending():
        return [cell for cell in first_changed if tiles[cell] != original[cell]]

    def holder(item):
        """Where item is on screen: a cell, "centre", or None."""
        if item == centre:
            return "centre"
        return next((cell for cell, shown in tiles.items() if shown == item), None)

    def rewind_cost(waiting):
        """Changes needed to put waiting back: one each, two where the original is in another tile (a swap)."""
        return sum(1 if holder(original[cell]) is None else 2 for cell in waiting)

    def rewind_batch(remaining):
        """The new contents of the cells changed this step ({cell: item}): back to their originals in first-changed order,
        as many as spreads the rest evenly (everything left on the last step). A cell whose original is in another tile
        swaps with it: it's back, the other takes its old item (and comes back later), so tiles holding each other's
        originals never block and nothing is ever on screen twice."""
        waiting = pending()
        budget = rewind_cost(waiting) if remaining == 1 else min(per_step, math.ceil(rewind_cost(waiting) / remaining))
        plan = dict(tiles)

        def changed():
            return sum(1 for cell in plan if plan[cell] != tiles[cell])

        for cell in waiting:
            if plan[cell] == original[cell]:
                continue
            if original[cell] == centre and remaining > 1:
                continue  # it's the centrepiece now: wait until the centre moves on (on the last step it goes back too)
            at = next((other for other, shown in plan.items() if shown == original[cell]), None)
            trial = dict(plan)
            if at is None:
                trial[cell] = original[cell]
            else:
                trial[cell], trial[at] = original[cell], plan[cell]
            if sum(1 for c in trial if trial[c] != tiles[c]) > budget and changed():
                continue
            plan = trial
            if changed() >= budget:
                break
        return {cell: item for cell, item in plan.items() if item != tiles[cell]}

    for step in range(1, steps + 1):
        while cooling and cooling[0][1] <= step:
            pool.append(cooling.popleft()[0])
        remaining = steps - step + 1
        changes = []
        # time to rewind when what's left to put back (plus this step's change, plus one step to spare) needs every step left
        if rewind and not rewinding and math.ceil((rewind_cost(pending()) + 2) / per_step) + 1 >= remaining:
            rewinding = True

        if rewinding:
            batch = rewind_batch(remaining)
            olds = {cell: tiles[cell] for cell in batch}
            for cell, item in batch.items():
                claim(item)
                changes.append(("tile", cell, olds[cell], item))
                tiles[cell] = item
            for item in set(olds.values()) - set(tiles.values()):
                leave(item, step)
        else:
            cell = next_cell()
            # with rewind, preferably an item that isn't some tile's original: fewer tiles holding each other's originals
            new = None
            if cell is not None:
                new = take(lambda item: item not in original.values()) if rewind else None
                new = new if new is not None else take()
            if new is not None:
                old, tiles[cell] = tiles[cell], new
                leave(old, step)
                recent.append(cell)
                if cell not in first_changed:
                    first_changed.append(cell)
                changes.append(("tile", cell, old, new))

        if centre is not None:
            if step == steps:
                new = original_centre if centre != original_centre else None
            elif step % centre_every == 0 and (centre != original_centre or len(pool) + len(cooling) > 1):
                # (the original centrepiece is kept for the end, so swapping it out mustn't take the tiles' last free item)
                new = take_centre()
            else:
                new = None
            if new is not None:
                old, centre = centre, new
                been_centre.add(new)
                leave(old, step)
                changes.append(("centre", None, old, new))
        yield changes
