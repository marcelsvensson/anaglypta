// npm run setup: gets a fresh clone ready to run and adds projects to projects.json - safe to re-run, every step skips
// what's already done (lib/setup/)
// npm run setup:python (--python): only the python part
// npm run setup:meet (--meet) [-- -p <project>]: the Google Meet background
// uses node built-ins only, so it works before `npm ci`
const { main } = require("../lib/setup");

if (require.main === module) {
    main().catch((error) => {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    });
}
