import { test } from "node:test";
import assert from "node:assert/strict";
import { updateOffset } from "../src/js/clock.js";

test("updateOffset keeps the sample with the least latency", () => {
    // true offset +1000ms; samples arrive 300ms, 50ms and 500ms after the server stamped them
    let offset = updateOffset(null, 10000, 9300);
    assert.equal(offset, 700);
    offset = updateOffset(offset, 11000, 10050);
    assert.equal(offset, 950);
    offset = updateOffset(offset, 12000, 11500);
    assert.equal(offset, 950);
});
