// Usage: node generate-hash.js <path-to-installer>
// Example: node generate-hash.js ./make/Wave-0.0.1.dmg
// This script will generate a hash of the installer file, as defined by electron-builder.
// Courtesy of https://github.com/electron-userland/electron-builder/issues/3913#issuecomment-504698845

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

/**
 * Generate a hash of a file, as defined by electron-builder
 * @param {string} file - Path to the file
 * @param {string} algorithm - Hash algorithm to use
 * @param {string} encoding - Encoding to use
 * @returns {Promise<string>} - The hash of the file
 */
async function hashFile(file, algorithm = "sha512", encoding = "base64") {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash(algorithm);
        hash.on("error", reject).setEncoding(encoding);
        fs.createReadStream(file, {
            highWaterMark: 1024 * 1024,
            /* better to use more memory but hash faster */
        })
            .on("error", reject)
            .on("end", () => {
                hash.end();
                resolve(hash.read());
            })
            .pipe(hash, {
                end: false,
            });
    });
}

if (require.main === module) {
    const installerPath = path.resolve(process.cwd(), process.argv[2]);
    (async () => {
        const hash = await hashFile(installerPath);
        console.log(`hash of ${installerPath}: ${hash}`);
    })();
}

module.exports = {
    hashFile,
};
