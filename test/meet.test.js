const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { KEY, MODES, padTo, copyToBlob, planCopy, isMp4, expandHome } = require("../scripts/meet");

// a fake file system: the card's blob Chrome made (an mp4), an image blob from an older setup, and a folder
const mp4 = Buffer.from("\0\0\0\x20ftypisom", "latin1");
const fakeFs = {
    isFile: (file) => ["/meet/1/v", "/meet/1/old"].includes(file),
    head: (file) => (file === "/meet/1/v" ? mp4 : Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
};

test("planCopy skips when Google Meet isn't configured", () => {
    assert.equal(planCopy({}, fakeFs, "/x"), null);
    assert.equal(planCopy({ [KEY]: "" }, fakeFs, "/x"), null);
});

test("planCopy puts the collage in as a one-frame video, or the video", () => {
    assert.deepEqual(planCopy({ [KEY]: "/meet/1/v" }, fakeFs, "/projects/local/cats"), { source: "/projects/local/cats/collage_still.mp4", target: "/meet/1/v" });
    assert.deepEqual(planCopy({ [KEY]: "/meet/1/v" }, fakeFs, "/projects/local/cats", MODES.video), { source: "/projects/local/cats/collage.mp4", target: "/meet/1/v" });
});

test("planCopy refuses a missing blob, and an image blob from an older setup", () => {
    assert.throws(() => planCopy({ [KEY]: "/meet/1" }, fakeFs, "/x"), /isn't an existing file/);
    assert.throws(() => planCopy({ [KEY]: "/meet/1/old" }, fakeFs, "/x"), /isn't the uploaded Anaglypta video card/);
});

test("isMp4 looks for ftyp", () => {
    assert.equal(isMp4(mp4), true);
    assert.equal(isMp4(Buffer.from("RIFF\0\0\0\0WEBP")), false);
    assert.equal(isMp4(Buffer.alloc(0)), false);
});

test("padTo pads an mp4 with a free box to exactly the size", () => {
    const padded = padTo(Buffer.from("....ftyp"), 24);
    assert.equal(padded.length, 24);
    assert.equal(padded.readUInt32BE(8), 16, "the box's size covers itself");
    assert.equal(padded.toString("latin1", 12, 16), "free");
    assert.equal(padTo(Buffer.from("abc"), 3).length, 3);
    assert.throws(() => padTo(Buffer.alloc(11), 10), /more than/);
    assert.throws(() => padTo(Buffer.alloc(5), 10), /too few to pad/);
});

test("copyToBlob writes at the blob's size and keeps its times", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anaglypta-test-"));
    try {
        const source = path.join(dir, "collage.mp4");
        const target = path.join(dir, "14");
        fs.writeFileSync(source, mp4);
        fs.writeFileSync(target, Buffer.alloc(100));
        const stamp = new Date("2026-10-20T08:15:00Z");
        fs.utimesSync(target, stamp, stamp);
        copyToBlob(source, target);
        const written = fs.readFileSync(target);
        assert.equal(written.length, 100);
        assert.ok(isMp4(written));
        assert.equal(fs.statSync(target).mtimeMs, stamp.getTime());
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("expandHome expands ~", () => {
    assert.equal(expandHome("~/Library/x"), path.join(os.homedir(), "Library/x"));
    assert.equal(expandHome("/abs/~x"), "/abs/~x");
});
