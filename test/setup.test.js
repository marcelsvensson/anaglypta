const { test } = require("node:test");
const assert = require("node:assert/strict");

const os = require("node:os");
const path = require("node:path");

const { resolveProject } = require("../scripts/project");
const { parsePlaylistId, isClientId, isTmdbToken, parseEnv, setEnvValue, parseFolderInput, setDefault, addProject, removeProject, renameProject, cronLinesFor, pickBlobs } = require("../scripts/setup");

const ID = "37i9dQZF1DXcBWIGoYBM5M";

test("parsePlaylistId accepts links, uris and bare ids", () => {
    assert.equal(parsePlaylistId(`https://open.spotify.com/playlist/${ID}?si=abc123`), ID);
    assert.equal(parsePlaylistId(`https://open.spotify.com/intl-sv/playlist/${ID}`), ID);
    assert.equal(parsePlaylistId(`spotify:playlist:${ID}`), ID);
    assert.equal(parsePlaylistId(`  ${ID}\n`), ID);
});

test("parsePlaylistId rejects everything else", () => {
    for (const input of [`https://open.spotify.com/album/${ID}`, "hello", `${ID}X`, "", null]) {
        assert.equal(parsePlaylistId(input), null, String(input));
    }
});

test("isClientId wants 32 hex characters", () => {
    assert.equal(isClientId("0123456789abcdef0123456789ABCDEF"), true);
    assert.equal(isClientId("0123456789abcdef"), false);
    assert.equal(isClientId("g123456789abcdef0123456789abcdef"), false);
});

test("parseEnv reads KEY=value lines and skips comments", () => {
    const text = "# comment\nCLIENT_ID=\nPLAYLIST_ID=\"quoted\"\n  SPACED = value  \nnot a line\n";
    assert.deepEqual(parseEnv(text), { CLIENT_ID: "", PLAYLIST_ID: "quoted", SPACED: "value" });
});

test("setEnvValue replaces a line in place and keeps the rest", () => {
    const text = "# comment\nCLIENT_ID=\n# other\nPLAYLIST_ID=\n";
    assert.equal(setEnvValue(text, "CLIENT_ID", "abc"), "# comment\nCLIENT_ID=abc\n# other\nPLAYLIST_ID=\n");
});

test("setEnvValue only matches the exact key and appends missing keys", () => {
    assert.equal(setEnvValue("SFTP_HOST=x\nHOST=y\n", "HOST", "z"), "SFTP_HOST=x\nHOST=z\n");
    assert.equal(setEnvValue("A=1", "B", "2"), "A=1\nB=2\n");
});

test("pickBlobs finds the uploaded image and thumbnail among the files changed since the upload started", () => {
    const files = [
        { path: "/old/a", size: 900000, mtimeMs: 100 },
        { path: "/new/c", size: 450000, mtimeMs: 2000 },
        { path: "/new/d", size: 3000, mtimeMs: 2001 },
    ];
    assert.deepEqual(pickBlobs(files, 1000), { image: "/new/c", thumbnail: "/new/d", count: 2 });
});

test("pickBlobs needs two new files", () => {
    assert.equal(pickBlobs([{ path: "/new/c", size: 1, mtimeMs: 2000 }, { path: "/old/a", size: 1, mtimeMs: 100 }], 1000), null);
    assert.equal(pickBlobs([], 1000), null);
});

test("parseFolderInput reads typed, quoted and dragged folders", () => {
    assert.equal(parseFolderInput("  /My Photos "), "/My Photos");
    assert.equal(parseFolderInput("'/My Photos'"), "/My Photos");
    assert.equal(parseFolderInput("\"/My Photos\""), "/My Photos");
    assert.equal(parseFolderInput("/My\\ Photos/Cats\\ \\(2024\\)"), "/My Photos/Cats (2024)");
    assert.equal(parseFolderInput("~/Pictures"), path.join(os.homedir(), "Pictures"));
});

test("addProject adds or replaces a project and sets the default when there's none", () => {
    const first = addProject({}, "local", "cats", { path: "~/cats" });
    assert.deepEqual(first, { local: { cats: { path: "~/cats" } }, default: "local/cats" });
    const second = addProject(first, "spotify", "album", { playlist: "x" });
    assert.equal(second.default, "local/cats");
    assert.deepEqual(second.local, first.local);
    assert.equal(addProject(second, "spotify", "chill", {}, { makeDefault: true }).default, "spotify/chill");
    assert.deepEqual(addProject(second, "local", "cats", { path: "~/new" }).local, { cats: { path: "~/new" } });
});

test("setDefault changes the default and keeps it first", () => {
    const projects = { default: "local/cats", spotify: { album: {} }, local: { cats: {} } };
    const changed = setDefault(projects, "spotify/album");
    assert.equal(changed.default, "spotify/album");
    assert.deepEqual(Object.keys(changed), ["default", "spotify", "local"]);
    assert.deepEqual(changed.local, projects.local);
});

test("removeProject removes the project, an empty source and moves the default", () => {
    const projects = { default: "local/cats", spotify: { album: {} }, local: { cats: {} } };
    assert.deepEqual(removeProject(projects, "local", "cats"), { default: "spotify/album", spotify: { album: {} } });
    assert.deepEqual(removeProject(projects, "spotify", "album"), { default: "local/cats", local: { cats: {} } });
    assert.deepEqual(removeProject({ default: "local/cats", local: { cats: {} } }, "local", "cats"), {});
});

test("cronLinesFor sorts the cron.sh lines of a project into failing and moving ones", () => {
    const crontab = [
        "MAILTO=me",
        "0 8 * * * /a/cron.sh daily-new -p local/cats >> /a/daily.log 2>&1",
        "# 0 9 * * * /a/cron.sh collage -p cats",
        "0 * * * * /a/cron.sh random-meet --fill >> /a/meet.log 2>&1",
        "5 * * * * /a/cron.sh collage -s spotify",
        "6 * * * * /a/cron.sh collage -s local",
        "1 1 * * * /a/cron.sh full -p catsy",
        "2 2 * * * /a/cron.sh collage --project=cats",
        "3 3 * * * cd /x && npm run collage -- -p cats",
        "4 4 * * * /usr/bin/backup cats",
    ].join("\n");
    const settings = { default: "local/cats", sources: { spotify: {}, local: {} } };
    const projects = { default: "local/cats", spotify: { album: {} }, local: { cats: {}, dogs: {} } };
    const resolveWith = (list) => (flags) => {
        try {
            return resolveProject(settings, list, flags).id;
        } catch {
            return null;
        }
    };
    const lines = cronLinesFor(crontab, "local/cats", resolveWith(projects), resolveWith(removeProject(projects, "local", "cats")));
    assert.deepEqual(lines.map(({ line, named, to }) => [line.split(" ").slice(5, 9).join(" "), named, to]), [
        ["/a/cron.sh daily-new -p local/cats", true, null],
        ["/a/cron.sh random-meet --fill >>", false, "spotify/album"],
        ["/a/cron.sh collage -s local", false, "local/dogs"],
        ["/a/cron.sh collage --project=cats", true, null],
    ]);
    assert.deepEqual(cronLinesFor("", "local/cats", () => "local/cats", () => null), []);
    assert.deepEqual(cronLinesFor(null, "local/cats", () => "local/cats", () => null), []);
});

test("renameProject keeps the project's place and moves the default along", () => {
    const projects = { default: "spotify/https-open", spotify: { a: { playlist: "x" }, "https-open": { playlist: "y" }, z: {} } };
    const renamed = renameProject(projects, "spotify", "https-open", "daily-mix");
    assert.deepEqual(Object.keys(renamed.spotify), ["a", "daily-mix", "z"]);
    assert.deepEqual(renamed.spotify["daily-mix"], { playlist: "y" });
    assert.equal(renamed.default, "spotify/daily-mix");
    assert.equal(renameProject(projects, "spotify", "a", "b").default, "spotify/https-open");
});

test("isTmdbToken accepts the Read Access Token, not the API key", () => {
    assert.ok(isTmdbToken(" eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2lnbmF0dXJl-_x "));
    assert.ok(!isTmdbToken("0123456789abcdef0123456789abcdef"), "the API key");
    assert.ok(!isTmdbToken("eyJ.only-two"));
    assert.ok(!isTmdbToken(""));
});
