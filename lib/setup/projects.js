// pure: projects.json changes (add, remove, rename, default) and the crontab lines that run a project
const { parseProjectArgs } = require("../utils/cli");

// projects.json with id ("source/name") as the default, kept first in the file
const setDefault = (projects, id) => {
    const { default: _, ...rest } = projects;
    return { default: id, ...rest };
};

// projects.json with source/name added (replacing one with that name), the default when asked or when there's none yet
const addProject = (projects, source, name, entry, { makeDefault = false } = {}) => {
    const id = makeDefault || !projects.default ? `${source}/${name}` : projects.default;
    return setDefault({ ...projects, [source]: { ...projects[source], [name]: entry } }, id);
};

// projects.json without source/name (and without its source when that was its last project). When it was the default,
// the first project left is the new one
const removeProject = (projects, source, name) => {
    const { [name]: _, ...left } = projects[source] ?? {};
    const next = { ...projects, [source]: left };
    if (!Object.keys(left).length) {
        delete next[source];
    }
    if (next.default !== `${source}/${name}`) {
        return next;
    }
    const first = Object.entries(next)
        .filter(([key]) => key !== "default")
        .flatMap(([s, list]) => Object.keys(list).map((n) => `${s}/${n}`))[0];
    if (first) {
        return setDefault(next, first);
    }
    delete next.default;
    return next;
};

// projects.json with source/from renamed to source/to, in the same place in the file, the default following along
const renameProject = (projects, source, from, to) => {
    const renamed = Object.fromEntries(Object.entries(projects[source] ?? {}).map(([name, entry]) => [name === from ? to : name, entry]));
    const next = { ...projects, [source]: renamed };
    return next.default === `${source}/${from}` ? setDefault(next, `${source}/${to}`) : next;
};

// the cron.sh lines in a crontab (`crontab -l`) that run project id. before/after resolve a line's own -s/-p flags to a
// project id (null = an error) with the project still there and without it. -> [{ line, named, to }]: named = it has -p
// (it fails once the project is gone), else it ran id as a default and runs `to` from now on (null: fails too)
const cronLinesFor = (crontab, id, before, after) => String(crontab ?? "").split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && /cron\.sh(\s|$)/.test(line))
    .flatMap((line) => {
        // the options after `cron.sh <script>`, up to a redirect or the next command
        const options = line.split(/cron\.sh\s+\S+/)[1]?.split(/\s(?:>|>>|2>|2>&1|&&|\||;)/)[0] ?? "";
        let flags;
        try {
            flags = parseProjectArgs(options.split(/\s+/).filter(Boolean));
        } catch {
            return [];
        }
        if (before(flags) !== id) {
            return [];
        }
        return [{ line, named: Boolean(flags.project), to: flags.project ? null : after(flags) }];
    });

module.exports = { setDefault, addProject, removeProject, renameProject, cronLinesFor };
