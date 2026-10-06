import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { validGuess } from "../../server/validate.js";

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const MODES = ["easy", "hard"];
const MAX_JSON = 1024 * 1024;
const MAX_IMAGE = 2 * 1024 * 1024;
// compressing the unpacked folder again puts everything one level deeper ("squadguessr-Dan-2026-10-06/guesses.json")
const JSON_PATH = /^(?:[^/]+\/)?guesses\.json$/;
const IMAGE_PATH = /^(?:[^/]+\/)?img\/guesses\/[^/]+\.webp$/;

/**
 * Random image name like the existing ones ("PTWxNN2RRl9vC8G")
 * @param {function(Uint8Array): Uint8Array} [random] - fills the array with random bytes
 * @returns {string}
 */
export function newImageId(random = (bytes) => crypto.getRandomValues(bytes)) {
    // 256 % 62 favours the first 8 characters by a hair: irrelevant for a file name
    return Array.from(random(new Uint8Array(15)), b => ID_CHARS[b % ID_CHARS.length]).join("");
}

/**
 * A guess with exactly the fields the API knows, in the order of the README example
 */
function toEntry(g) {
    const entry = { map: g.map, mode: g.mode, url: g.url, lat: g.lat, lng: g.lng };
    if (g.submitter) entry.submitter = g.submitter;
    return entry;
}

/**
 * ZIP with guesses.json and every image at its url path
 * @param {Array<{entry: Object, image: Uint8Array}>} items
 * @returns {Uint8Array}
 */
export function packGuesses(items) {
    const files = { "guesses.json": strToU8(JSON.stringify(items.map(i => toEntry(i.entry)), null, 4)) };
    // webp is already compressed: storing it costs nothing in size
    items.forEach(i => { files[i.entry.url.slice(1)] = [i.image, { level: 0 }]; });
    return zipSync(files);
}

/**
 * Reads a submitted ZIP. It comes from a stranger: only known files are inflated, every entry is checked and rebuilt
 * @param {Uint8Array} bytes
 * @returns {Array<{entry: Object|null, image: Uint8Array|null, error: string|null}>}
 * @throws {Error} when the file as a whole is unusable
 */
export function unpackGuesses(bytes) {
    let files;
    try {
        files = unzipSync(bytes, {
            filter: f => (JSON_PATH.test(f.name) && f.originalSize <= MAX_JSON)
                || (IMAGE_PATH.test(f.name) && f.originalSize <= MAX_IMAGE),
        });
    } catch {
        throw new Error("not a ZIP file");
    }
    // the shortest path wins, so a guesses.json at the top level beats one in a folder
    const jsonPath = Object.keys(files).filter(name => JSON_PATH.test(name)).sort((a, b) => a.length - b.length)[0];
    if (!jsonPath) throw new Error("guesses.json missing or too large");
    // images are looked up next to the guesses.json that was read
    const dir = jsonPath.slice(0, -"guesses.json".length);
    let list;
    try {
        list = JSON.parse(strFromU8(files[jsonPath]));
    } catch {
        throw new Error("guesses.json is not valid JSON");
    }
    if (!Array.isArray(list)) throw new Error("guesses.json is not a list");

    return list.map(g => {
        const path = typeof g?.url === "string" ? dir + g.url.slice(1) : "";
        // own keys only: a url like "/__proto__" must not find Object.prototype
        const image = Object.hasOwn(files, path) ? files[path] : null;
        let error = null;
        if (!validGuess(g)) error = "invalid data";
        else if (!MODES.includes(g.mode)) error = "invalid mode";
        else if (!image) error = "image missing";
        return { entry: error ? null : toEntry(g), image, error };
    });
}

/**
 * "squadguessr-<name>-<YYYY-MM-DD>.zip" with the name cut down to safe file name characters
 * @param {string} name
 * @param {Date} [date]
 * @returns {string}
 */
export function zipFileName(name, date = new Date()) {
    const safe = String(name ?? "").replace(/[^A-Za-z0-9_-]/g, "") || "anonymous";
    const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(n => String(n).padStart(2, "0")).join("-");
    return `squadguessr-${safe}-${day}.zip`;
}

/**
 * Hands the bytes to the browser as a file download
 * @param {Uint8Array} bytes
 * @param {string} fileName
 */
export function downloadZip(bytes, fileName) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    // the download has started once click() returns; revoking a bit later keeps slow browsers safe
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
