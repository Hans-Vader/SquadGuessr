import { test } from "node:test";
import assert from "node:assert/strict";
import { collectGuesses } from "../src/js/guesses.js";

const g = (map, n) => ({ map, url: `/img/guesses/${map}_${n}.webp`, lat: 0, lng: 0 });
const from = (batches) => async () => batches.shift() ?? [];

test("collectGuesses skips excluded maps ignoring case and repeated guesses", async () => {
    const fetchBatch = from([[g("narva", 1), g("kohat", 1)], [g("narva", 1), g("anvil", 1), g("narva", 2)]]);
    const guesses = await collectGuesses(fetchBatch, 3, ["Kohat"]);
    assert.deepEqual(guesses.map(x => x.url), ["/img/guesses/narva_1.webp", "/img/guesses/anvil_1.webp", "/img/guesses/narva_2.webp"]);
});

test("collectGuesses returns exactly the requested count", async () => {
    const fetchBatch = from([[g("narva", 1), g("narva", 2), g("narva", 3), g("narva", 4)]]);
    assert.equal((await collectGuesses(fetchBatch, 3, [])).length, 3);
});

test("collectGuesses gives up after 5 batches", async () => {
    let calls = 0;
    const fetchBatch = async () => [g("kohat", ++calls)];
    await assert.rejects(collectGuesses(fetchBatch, 3, ["Kohat"]));
    assert.equal(calls, 5);
});
