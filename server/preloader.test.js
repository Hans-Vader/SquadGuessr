import { test } from "node:test";
import assert from "node:assert/strict";
import Preloader from "../src/js/preloader.js";

// fake images record each download attempt when their src is set; fake timers fire on demand
function setup() {
    const images = [];
    const timers = [];
    const preloader = new Preloader({
        createImage: () => ({
            set src(url) {
                this.url = url;
                this.priorityAtStart = this.fetchPriority;
                images.push(this);
            },
        }),
        setTimer: (fn, ms) => timers.push({ fn, ms, cleared: false }) - 1,
        clearTimer: (id) => { if (timers[id]) timers[id].cleared = true; },
    });
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const fire = () => timers.splice(0).filter(t => !t.cleared).forEach(t => t.fn());
    return { preloader, images, timers, flush, fire };
}

test("resolves once the image loaded, and the same url is not downloaded twice", async () => {
    const { preloader, images, flush } = setup();
    let done = false;
    preloader.load(["/a"]).then(() => { done = true; });
    await flush();
    assert.deepEqual(images.map(i => i.url), ["/a"]);
    assert.equal(done, false);
    images[0].onload();
    await flush();
    assert.equal(done, true);
    await preloader.load(["/a"]);
    assert.equal(images.length, 1);
});

test("a failed image is retried every second until it loads, and only then counts as loaded", async () => {
    const { preloader, images, timers, flush, fire } = setup();
    let done = false;
    preloader.load(["/a"]).then(() => { done = true; });
    await flush();
    images[0].onerror();
    await flush();
    assert.equal(done, false);
    assert.equal(timers[0].ms, 1000);
    fire();
    assert.equal(images.length, 2);
    images[1].onerror();
    fire();
    images[2].onload();
    await flush();
    assert.equal(done, true);
});

test("images load one after another: the map starts after the hint's first attempt", async () => {
    const { preloader, images, flush } = setup();
    preloader.load(["/hint", "/map"]);
    await flush();
    assert.deepEqual(images.map(i => i.url), ["/hint"]);
    images[0].onload();
    await flush();
    assert.deepEqual(images.map(i => i.url), ["/hint", "/map"]);
});

test("an image that keeps failing does not hold up the next one", async () => {
    const { preloader, images, flush } = setup();
    preloader.load(["/broken", "/map"]);
    await flush();
    images[0].onerror();
    await flush();
    assert.deepEqual(images.map(i => i.url), ["/broken", "/map"]);
});

test("low priority is set before the download starts", async () => {
    const { preloader, images, flush } = setup();
    preloader.load(["/next"], { low: true });
    await flush();
    images[0].onload();
    preloader.load(["/now"]);
    await flush();
    assert.deepEqual(images.map(i => i.priorityAtStart), ["low", undefined]);
});

test("keep drops every other image: no more retries, and a late load no longer counts", async () => {
    const { preloader, images, flush, fire } = setup();
    let failedDone = false;
    let pendingDone = false;
    preloader.load(["/failed"]).then(() => { failedDone = true; });
    await flush();
    images[0].onerror();
    preloader.load(["/pending"]).then(() => { pendingDone = true; });
    await flush();
    preloader.load(["/kept"]);
    preloader.keep(["/kept"]);
    fire();
    assert.equal(images.filter(i => i.url === "/failed").length, 1);
    images.find(i => i.url === "/pending").onload();
    await flush();
    assert.deepEqual([failedDone, pendingDone], [false, false]);
    await flush();
    preloader.load(["/kept"]);
    assert.equal(images.filter(i => i.url === "/kept").length, 1);
});
