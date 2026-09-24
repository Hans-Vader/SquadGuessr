// ponytail: 5 batches of 10 cover a few excluded maps; playing only a handful of maps needs a map filter in the API
const MAX_BATCHES = 5;

/**
 * Collects `rounds` guesses from batches of random guesses, skipping excluded maps and repeats
 * @param {function(): Promise<Array>} fetchBatch - resolves with a batch of random guesses
 * @param {number} rounds - number of guesses needed
 * @param {string[]} excluded - map names that must not come up
 * @returns {Promise<Array>} exactly `rounds` guesses
 * @throws {Error} if the batches did not yield enough guesses
 */
export async function collectGuesses(fetchBatch, rounds, excluded) {
    const skip = new Set(excluded.map(name => name.toLowerCase()));
    const picked = new Map();
    for (let i = 0; i < MAX_BATCHES && picked.size < rounds; i++) {
        (await fetchBatch())
            .filter(g => !skip.has(g.map.toLowerCase()))
            .forEach(g => picked.set(g.url, g));
    }
    if (picked.size < rounds) throw new Error("Not enough guesses for the selected maps");
    return [...picked.values()].slice(0, rounds);
}
