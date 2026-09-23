import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startServer } from "./index.js";

/**
 * Server on a random port; the server and every client are closed after the test even when an assertion fails
 */
async function serve(t, options = {}) {
    const wss = startServer({ port: 0, ...options });
    const clients = [];
    t.after(() => {
        clients.forEach(c => c.terminate());
        wss.close();
    });
    await once(wss, "listening");
    const port = wss.address().port;
    return async function client() {
        const ws = new WebSocket(`ws://localhost:${port}/mp`);
        clients.push(ws);
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
        await once(ws, "open");
        return ws;
    };
}

const CREATE = { type: "create", name: "Hans", settings: { mode: "classic", timer: 0, rounds: 3 } };

test("create, join by lowercase code, reject garbage", { timeout: 5000 }, async (t) => {
    const client = await serve(t);

    const host = await client();
    host.sendJson(CREATE);
    const welcome = await host.next("welcome");
    assert.match(welcome.code, /^[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(typeof welcome.serverNow, "number");

    const guest = await client();
    guest.sendJson({ type: "join", code: welcome.code.toLowerCase(), name: "Max" });
    await guest.next("welcome");
    const state = await guest.next("state");
    assert.deepEqual(state.players.map(p => p.name), ["Hans", "Max"]);

    guest.send("not json");
    assert.equal((await guest.next("error")).code, "INVALID");

    const stranger = await client();
    stranger.sendJson({ type: "join", code: "ZZZZ", name: "Eve" });
    assert.equal((await stranger.next("error")).code, "SESSION_NOT_FOUND");

    stranger.sendJson({ type: "next" });
    assert.equal((await stranger.next("error")).code, "INVALID");

    // drain the host's older states up to the one that lists Max
    while (!(await host.next("state")).players.some(p => p.name === "Max"));
    guest.close();
    const afterLeave = await host.next("state");
    assert.deepEqual(afterLeave.players.map(p => p.name), ["Hans"], "lobby drops a guest whose connection closed");
});

test("an oversized frame does not crash the server", { timeout: 5000 }, async (t) => {
    const client = await serve(t);

    const attacker = await client();
    attacker.send("x".repeat(70000));
    await once(attacker, "close");

    const host = await client();
    host.sendJson(CREATE);
    assert.equal((await host.next("welcome")).code.length, 4);
});

test("session creation is capped", { timeout: 5000 }, async (t) => {
    const client = await serve(t, { maxSessions: 2 });
    for (let i = 0; i < 2; i++) {
        const host = await client();
        host.sendJson(CREATE);
        await host.next("welcome");
    }
    const late = await client();
    late.sendJson(CREATE);
    assert.equal((await late.next("error")).code, "SERVER_BUSY");
});
