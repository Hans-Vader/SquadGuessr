import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startServer } from "./index.js";

function client(port) {
    const ws = new WebSocket(`ws://localhost:${port}/mp`);
    const inbox = [];
    const waiters = [];
    ws.on("message", (data) => {
        const msg = JSON.parse(data);
        const i = waiters.findIndex(w => w.type === msg.type);
        if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
        else inbox.push(msg);
    });
    ws.next = (type) => {
        const i = inbox.findIndex(m => m.type === type);
        if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
        return new Promise(resolve => waiters.push({ type, resolve }));
    };
    ws.sendJson = (msg) => ws.send(JSON.stringify(msg));
    return ws;
}

test("create, join by lowercase code, reject garbage", { timeout: 5000 }, async () => {
    const wss = startServer({ port: 0 });
    await once(wss, "listening");
    const port = wss.address().port;

    const host = client(port);
    await once(host, "open");
    host.sendJson({ type: "create", name: "Hans", settings: { mode: "classic", timer: 0, rounds: 3 } });
    const welcome = await host.next("welcome");
    assert.match(welcome.code, /^[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(typeof welcome.serverNow, "number");

    const guest = client(port);
    await once(guest, "open");
    guest.sendJson({ type: "join", code: welcome.code.toLowerCase(), name: "Max" });
    await guest.next("welcome");
    const state = await guest.next("state");
    assert.deepEqual(state.players.map(p => p.name), ["Hans", "Max"]);

    guest.send("not json");
    assert.equal((await guest.next("error")).code, "INVALID");

    const stranger = client(port);
    await once(stranger, "open");
    stranger.sendJson({ type: "join", code: "ZZZZ", name: "Eve" });
    assert.equal((await stranger.next("error")).code, "SESSION_NOT_FOUND");

    stranger.sendJson({ type: "next" });
    assert.equal((await stranger.next("error")).code, "INVALID");

    guest.close();
    // the host's inbox still holds older state messages; wait for the one showing Max offline
    let afterLeave;
    do {
        afterLeave = await host.next("state");
    } while (afterLeave.players.find(p => p.name === "Max")?.connected !== false);

    host.close();
    stranger.close();
    wss.close();
});

test("an oversized frame does not crash the server", { timeout: 5000 }, async () => {
    const wss = startServer({ port: 0 });
    await once(wss, "listening");
    const port = wss.address().port;

    const attacker = client(port);
    await once(attacker, "open");
    attacker.send("x".repeat(70000));
    await once(attacker, "close");

    const host = client(port);
    await once(host, "open");
    host.sendJson({ type: "create", name: "Hans", settings: { mode: "classic", timer: 0, rounds: 3 } });
    assert.equal((await host.next("welcome")).code.length, 4);

    host.close();
    wss.close();
});
