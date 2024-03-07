// Updates the latest-mac.yml file with the signed and notarized version of the latest installer
// Usage: node update-latest.js <path-to-installer>

const path = require("path");
const fs = require("fs");
const { hashFile } = require("./generate-hash");
const yaml = require("yaml");

/**
 * Updates the latest-mac.yml file with the signed and notarized version of the latest installer
 * @param {string} installerPath - Path to the installer
 * @param {string} ymlPath - Path to the latest-mac.yml file
 * @returns {Promise<void>}
 */
async function updateLatestMac(installerPath, ymlPath) {
    const hash = (await hashFile(installerPath)).trim();
    const size = fs.statSync(installerPath).size;
    const yml = yaml.parse(fs.readFileSync(ymlPath, "utf8"));
    for (const file of yml.files) {
        if (file.url === path.basename(installerPath)) {
            file.sha512 = hash;
            file.size = size;
        }
    }
    yml.sha512 = hash;
    fs.writeFileSync(ymlPath, yaml.stringify(yml));
}

if (require.main === module) {
    const installerPath = path.resolve(process.cwd(), process.argv[2]);
    const ymlPath = path.resolve(process.cwd(), process.argv[3]);
    (async () => {
        await updateLatestMac(installerPath, ymlPath);
        console.log("latest-mac.yml updated");
    })();
}

module.exports = {
    updateLatestMac,
};
