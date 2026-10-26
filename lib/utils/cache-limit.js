// a source's cache limit (maxCacheDays in settings.json, TMDb's terms: 180 days): what's older is renewed by a fetch or
// removed. Sources without the setting are never touched
const fs = require("node:fs");
const path = require("node:path");

const { readData, writeData } = require("./items");

// a source's cache limit (maxCacheDays, tmdb: 180) is renewed this long before it runs out
const REFRESH_BEFORE_DAYS = 30;

// the project's cached images older than days, oldest first: [{ id, file, days }]
const oldImages = (dir, items, days, now = Date.now()) => items
    .map((item) => ({ id: item.id, file: path.join(dir, "images", `${item.id}.jpg`) }))
    .filter(({ file }) => fs.existsSync(file))
    .map((image) => ({ ...image, days: (now - fs.statSync(image.file).mtimeMs) / 86400000 }))
    .filter((image) => image.days > days)
    .sort((a, b) => b.days - a.days);

// for the project list in setup: "", or a note when images are close to (or past) the source's cache limit
const cacheNote = (project, now = Date.now()) => {
    if (!project.maxCacheDays) {
        return "";
    }
    const old = oldImages(project.dir, readData(project).items, project.maxCacheDays - REFRESH_BEFORE_DAYS, now);
    if (!old.length) {
        return "";
    }
    const expired = old.filter((image) => image.days > project.maxCacheDays).length;
    return expired
        ? ` - ${expired} image(s) past the ${project.maxCacheDays}-day limit, run \`npm run full -- -p ${project.id}\``
        : ` - ${old.length} image(s) expire within ${REFRESH_BEFORE_DAYS} days, run \`npm run full -- -p ${project.id}\``;
};

// removes what's older than the source allows (maxCacheDays): items whose data wasn't confirmed by a fetch (fetchedAt,
// else addedAt) and images downloaded (file date) that long ago. returns { items, images, soon } counts, soon = images
// that expire within REFRESH_BEFORE_DAYS. does nothing for sources without a limit
const expireCache = (project, now = Date.now()) => {
    const counts = { items: 0, images: 0, soon: 0 };
    const maxDays = project.maxCacheDays;
    if (!maxDays) {
        return counts;
    }
    const daysAgo = (ms) => (now - ms) / 86400000;
    const imageFile = (item) => path.join(project.dir, "images", `${item.id}.jpg`);
    const data = readData(project);
    const kept = data.items.filter((item) => {
        const fetched = Date.parse(item.fetchedAt || item.addedAt || "");
        if (daysAgo(fetched) > maxDays) { // NaN (no or a broken date) is never past it
            fs.rmSync(imageFile(item), { force: true });
            counts.items++;
            return false;
        }
        const image = fs.statSync(imageFile(item), { throwIfNoEntry: false });
        if (image && daysAgo(image.mtimeMs) > maxDays) {
            fs.rmSync(imageFile(item));
            counts.images++;
        } else if (image && daysAgo(image.mtimeMs) > maxDays - REFRESH_BEFORE_DAYS) {
            counts.soon++;
        }
        return true;
    });
    if (counts.items) {
        writeData(project, { ...data, items: kept });
    }
    return counts;
};

// the warnings for expireCache's counts
const reportExpired = (project, counts) => {
    const full = `\`npm run full -- -p ${project.id}\``;
    if (counts.items) {
        console.error(`⚠️  ${counts.items} item(s) of ${project.id} were last fetched over ${project.maxCacheDays} days ago and were removed (the source's terms) - ${full} fetches them again`);
    }
    if (counts.images) {
        console.error(`⚠️  ${counts.images} image(s) of ${project.id} were older than ${project.maxCacheDays} days and were removed (the source's terms) - ${full} downloads them again`);
    }
    if (counts.soon) {
        console.log(`Heads-up: ${counts.soon} image(s) of ${project.id} expire within ${REFRESH_BEFORE_DAYS} days - ${full} renews them`);
    }
};

module.exports = { REFRESH_BEFORE_DAYS, oldImages, cacheNote, expireCache, reportExpired };
