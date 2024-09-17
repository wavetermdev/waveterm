/**
 * Script to get the current package version and bump the version, if specified.
 *
 * If no arguments are present, the current version will returned.
 * If only a single argument is given, the following are valid inputs:
 *      - `none`: No-op.
 *      - `patch`: Bumps the patch version.
 *      - `minor`: Bumps the minor version.
 *      - `major`: Bumps the major version.
 *      - '1', 'true': Bumps the prerelease version.
 * If two arguments are given, the first argument must be either `none`, `patch`, `minor`, or `major`. The second argument must be `1` or `true` to bump the prerelease version.
 */

const path = require("path");
const packageJsonPath = path.resolve(__dirname, "package.json");
const packageJson = require(packageJsonPath);

const VERSION = `${packageJson.version}`;
module.exports = VERSION;

if (typeof require !== "undefined" && require.main === module) {
    if (process.argv.length > 2) {
        const fs = require("fs");
        const semver = require("semver");

        const action = process.argv[2];
        const isPrerelease =
            process.argv.length > 3
                ? process.argv[3] === "true" || process.argv[3] === "1"
                : action === "true" || action === "1";
        let newVersion = packageJson.version;
        switch (action) {
            case "major":
            case "minor":
            case "patch":
                newVersion = semver.inc(
                    VERSION,
                    `${isPrerelease ? "pre" : ""}${action}`,
                    null,
                    isPrerelease ? "beta" : null
                );
                break;
            case "none":
            case "true":
            case "1":
                if (isPrerelease) newVersion = semver.inc(VERSION, "prerelease", null, "beta");
                break;
            default:
                throw new Error(`Unknown action ${action}`);
        }
        packageJson.version = newVersion;
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 4) + "\n");
        console.log(newVersion);
    } else {
        console.log(VERSION);
    }
}
