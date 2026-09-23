import { test } from "node:test";
import assert from "node:assert/strict";
import { Session, MAX_PLAYERS } from "./session.js";

const CLASSIC = { mode: "classic", timer: 0, rounds: 3 };
const GUESSES = [
    { map: "Narva", url: "/img/guesses/a.webp", lat: 100, lng: 200, submitter: "Dan" },
    { map: "GooseBay", url: "/img/guesses/b.webp", lat: 300, lng: 400 },
    { map: "Kohat", url: "/img/guesses/c.webp", lat: 500, lng: 600 },
];

function setup(settings = CLASSIC) {
    let t = 1000;
    const sent = [];
    const s = new Session("ABCD", { send: (conn, msg) => sent.push({ conn, msg }), now: () => t });
    const all = (conn, type) => sent.filter(x => x.conn === conn && x.msg.type === type).map(x => x.msg);
    const last = (conn, type) => all(conn, type).at(-1);
    const host = { id: "host" };
    s.create(host, { name: "Hans", settings });
    return { s, sent, host, all, last, advance: (ms) => { t += ms; } };
}

function withGuest(settings) {
    const ctx = setup(settings);
    ctx.guest = { id: "guest" };
    ctx.s.join(ctx.guest, { name: "Max" });
    return ctx;
}

function started(settings) {
    const ctx = withGuest(settings);
    ctx.s.handle(ctx.host, { type: "start", guesses: GUESSES });
    return ctx;
}

test("create makes the creator host and player", () => {
    const { host, last } = setup();
    assert.equal(last(host, "welcome").isHost, true);
    assert.equal(last(host, "welcome").code, "ABCD");
    const state = last(host, "state");
    assert.equal(state.phase, "lobby");
    assert.deepEqual(state.players.map(p => p.name), ["Hans"]);
    assert.deepEqual(state.settings, CLASSIC);
});

test("create rejects invalid settings", () => {
    const sent = [];
    const s = new Session("ABCD", { send: (conn, msg) => sent.push(msg) });
    assert.equal(s.create({}, { name: "Hans", settings: { mode: "classic", timer: "0", rounds: 3 } }), false);
    assert.equal(sent[0].code, "INVALID");
});

test("join adds a player and broadcasts state", () => {
    const { host, guest, last } = withGuest();
    assert.equal(last(guest, "welcome").isHost, false);
    assert.deepEqual(last(host, "state").players.map(p => p.name), ["Hans", "Max"]);
});

test("names are unique ignoring case, spaces and control chars", () => {
    const { s, last } = withGuest();
    const other = {};
    assert.equal(s.join(other, { name: " max\u0007" }), false);
    assert.equal(s.join({}, { name: "Max\u200b" }), false);
    assert.equal(last(other, "error").code, "NAME_TAKEN");
});

test("session is capped at MAX_PLAYERS", () => {
    const { s, last } = setup();
    for (let i = 1; i < MAX_PLAYERS; i++) assert.equal(s.join({}, { name: `P${i}` }), true);
    const late = {};
    assert.equal(s.join(late, { name: "Late" }), false);
    assert.equal(last(late, "error").code, "SESSION_FULL");
});

test("new players cannot join a running game", () => {
    const { s, last } = started();
    const late = {};
    assert.equal(s.join(late, { name: "Late" }), false);
    assert.equal(last(late, "error").code, "GAME_RUNNING");
});

test("only the host may control the game", () => {
    const { s, guest, last } = withGuest();
    s.handle(guest, { type: "start", guesses: GUESSES });
    assert.equal(last(guest, "error").code, "NOT_HOST");
    assert.equal(s.phase, "lobby");
});

test("host can change settings in the lobby", () => {
    const { s, host, guest, last } = withGuest();
    s.handle(host, { type: "settings", settings: { mode: "mapFinder", timer: 15, rounds: 5 } });
    assert.deepEqual(last(guest, "state").settings, { mode: "mapFinder", timer: 15, rounds: 5 });
});

test("start rejects guesses that do not match settings.rounds", () => {
    const { s, host, last } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES.slice(0, 2) });
    assert.equal(last(host, "error").code, "INVALID");
    assert.equal(s.phase, "lobby");
});

test("round message never leaks the solution", () => {
    const { guest, last } = started();
    const round = last(guest, "round");
    assert.deepEqual(round, { type: "round", index: 0, total: 3, url: "/img/guesses/a.webp", submitter: "Dan", deadline: null, map: "Narva" });
});

test("mapFinder round hides the map name", () => {
    const { guest, last } = started({ mode: "mapFinder", timer: 0, rounds: 3 });
    assert.equal(last(guest, "round").map, null);
});

test("state is sent before round so clients know their answered flag", () => {
    const { sent, guest } = started();
    const types = sent.filter(x => x.conn === guest).map(x => x.msg.type);
    assert.deepEqual(types.slice(-2), ["state", "round"]);
});

test("round ends when every connected player answered", () => {
    const { s, host, guest, last } = started();
    s.handle(host, { type: "answer", index: s.round, lat: 100, lng: 200 });
    assert.equal(s.phase, "round");
    assert.equal(last(guest, "state").players.find(p => p.name === "Hans").answered, true);
    s.handle(guest, { type: "answer", index: s.round, lat: 100000, lng: 200 });
    assert.equal(s.phase, "reveal");
    const reveal = last(guest, "reveal");
    assert.deepEqual(reveal.solution, { map: "Narva", url: "/img/guesses/a.webp", lat: 100, lng: 200 });
    const hans = reveal.results.find(r => r.name === "Hans");
    const max = reveal.results.find(r => r.name === "Max");
    assert.equal(hans.points, 100);
    assert.equal(hans.score, 100);
    assert.equal(max.points, 0);
    assert.equal(reveal.results[0].name, "Hans");
});

test("a disconnected player does not block the round and scores 0", () => {
    const { s, host, guest, last } = started();
    s.disconnect(guest);
    s.handle(host, { type: "answer", index: s.round, lat: 100, lng: 200 });
    assert.equal(s.phase, "reveal");
    const max = last(host, "reveal").results.find(r => r.name === "Max");
    assert.deepEqual([max.points, max.lat, max.distance], [0, null, null]);
});

test("deadline plus grace ends the round via tick", () => {
    const { s, advance } = started({ mode: "classic", timer: 15, rounds: 3 });
    advance(15999);
    s.tick();
    assert.equal(s.phase, "round");
    advance(1);
    s.tick();
    assert.equal(s.phase, "reveal");
});

test("answer inside the grace period counts, answer after reveal is rejected", () => {
    const { s, host, guest, last, advance } = started({ mode: "classic", timer: 15, rounds: 3 });
    advance(15500);
    s.handle(guest, { type: "answer", index: s.round, lat: 100, lng: 200 });
    s.handle(host, { type: "answer", index: s.round, lat: 100, lng: 200 });
    assert.equal(s.phase, "reveal");
    assert.equal(last(guest, "reveal").results.find(r => r.name === "Max").points, 100);
    s.handle(guest, { type: "answer", index: s.round, lat: 100, lng: 200 });
    assert.equal(last(guest, "error").code, "INVALID");
    s.handle(host, { type: "next" });
    assert.equal(last(guest, "state").players.find(p => p.name === "Max").answered, false);
});

test("a second answer in the same round is rejected", () => {
    const { s, host, last } = started();
    s.handle(host, { type: "answer", index: s.round, lat: 1, lng: 1 });
    s.handle(host, { type: "answer", index: s.round, lat: 100, lng: 200 });
    assert.equal(last(host, "error").code, "INVALID");
});

test("host can end a round early", () => {
    const { s, host } = started();
    s.handle(host, { type: "endRound" });
    assert.equal(s.phase, "reveal");
});

test("host cannot end a timed round early; it ends when the timer runs out", () => {
    const { s, host, last, advance } = started({ mode: "classic", timer: 60, rounds: 3 });
    s.handle(host, { type: "endRound" });
    assert.equal(s.phase, "round");
    assert.equal(last(host, "error").code, "INVALID");
    advance(61_000);
    s.tick();
    assert.equal(s.phase, "reveal");
});

test("mapFinder answers are scored by map name", () => {
    const { s, host, guest, last } = started({ mode: "mapFinder", timer: 0, rounds: 3 });
    s.handle(host, { type: "answer", index: s.round, mapName: "narv" });
    s.handle(guest, { type: "answer", index: s.round, mapName: "kohat" });
    const results = last(host, "reveal").results;
    assert.equal(results.find(r => r.name === "Hans").points, 100);
    assert.equal(results.find(r => r.name === "Max").points, 0);
    assert.equal(results.find(r => r.name === "Hans").lat, null);
});

test("reconnect during a round restores the player and resends the round", () => {
    const { s, guest, last } = started();
    const token = last(guest, "welcome").token;
    s.disconnect(guest);
    const phone = { id: "phone" };
    assert.equal(s.join(phone, { name: "ignored", token }), true);
    assert.equal(last(phone, "welcome").playerId, last(guest, "welcome").playerId);
    assert.equal(last(phone, "round").index, 0);
    assert.equal(last(phone, "state").players.find(p => p.name === "Max").connected, true);
});

test("reconnect during reveal gets reveal", () => {
    const { s, host, guest, last } = started();
    const token = last(guest, "welcome").token;
    s.disconnect(guest);
    s.handle(host, { type: "answer", index: s.round, lat: 100, lng: 200 });
    const phone = {};
    s.join(phone, { token });
    assert.equal(last(phone, "reveal").index, 0);
    assert.equal(last(phone, "round"), undefined);
});

test("host reconnect keeps host role and score", () => {
    const { s, host, guest, last } = started();
    s.handle(host, { type: "answer", index: s.round, lat: 100, lng: 200 });
    s.handle(guest, { type: "answer", index: s.round, lat: 100, lng: 200 });
    const token = last(host, "welcome").token;
    s.disconnect(host);
    const reloaded = {};
    s.join(reloaded, { token });
    assert.equal(last(reloaded, "welcome").isHost, true);
    assert.equal(last(reloaded, "state").players.find(p => p.name === "Hans").score, 100);
    s.handle(reloaded, { type: "next" });
    assert.equal(s.phase, "round");
});

test("final ranking with a tie has two winners, lobby resets", () => {
    const { s, host, guest, last } = started();
    for (let i = 0; i < 3; i++) {
        s.handle(host, { type: "answer", index: s.round, lat: GUESSES[i].lat, lng: GUESSES[i].lng });
        s.handle(guest, { type: "answer", index: s.round, lat: GUESSES[i].lat, lng: GUESSES[i].lng });
        s.handle(host, { type: "next" });
    }
    assert.equal(s.phase, "final");
    const final = last(guest, "final");
    assert.deepEqual(final.ranking.map(r => r.score), [300, 300]);
    assert.equal(final.winners.length, 2);
    s.handle(host, { type: "lobby" });
    const state = last(guest, "state");
    assert.equal(state.phase, "lobby");
    assert.deepEqual(state.players.map(p => p.score), [0, 0]);
});

test("watchers receive state and rounds but cannot act", () => {
    const { s, host, last } = withGuest();
    const tv = {};
    assert.equal(s.watch(tv), true);
    assert.equal(last(tv, "state").phase, "lobby");
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(last(tv, "round").index, 0);
    s.handle(tv, { type: "answer", index: s.round, lat: 1, lng: 1 });
    assert.equal(last(tv, "error").code, "INVALID");
});

test("unknown message types are rejected", () => {
    const { s, host, last } = setup();
    s.handle(host, { type: "explode" });
    assert.equal(last(host, "error").code, "INVALID");
});

test("isIdle after inactivity", () => {
    const { s, host, advance } = setup();
    s.disconnect(host);
    advance(1000);
    assert.equal(s.isIdle(5000), false);
    advance(5000);
    assert.equal(s.isIdle(5000), true);
});

test("a late answer for the previous round is rejected and does not use up the next round", () => {
    const { s, host, guest, last } = started();
    s.handle(host, { type: "answer", index: 0, lat: 100, lng: 200 });
    s.handle(host, { type: "endRound" });
    s.handle(host, { type: "next" });
    s.handle(guest, { type: "answer", index: 0, lat: 300, lng: 400 });
    assert.equal(last(guest, "error").code, "INVALID");
    s.handle(guest, { type: "answer", index: 1, lat: 300, lng: 400 });
    s.handle(host, { type: "answer", index: 1, lat: 300, lng: 400 });
    assert.equal(last(guest, "reveal").results.find(r => r.name === "Max").points, 100);
});

test("an answer without a round index is rejected", () => {
    const { s, host, last } = started();
    s.handle(host, { type: "answer", lat: 100, lng: 200 });
    assert.equal(last(host, "error").code, "INVALID");
});

test("leaving the lobby frees the name and the slot", () => {
    const { s, host, guest, last } = withGuest();
    s.handle(guest, { type: "leave" });
    assert.deepEqual(last(host, "state").players.map(p => p.name), ["Hans"]);
    const again = {};
    assert.equal(s.join(again, { name: "Max" }), true);
});

test("leaving a running game keeps the player's score but marks them offline", () => {
    const { s, host, guest, last } = started();
    s.handle(guest, { type: "leave" });
    const max = last(host, "state").players.find(p => p.name === "Max");
    assert.equal(max.connected, false);
    s.handle(host, { type: "answer", index: 0, lat: 100, lng: 200 });
    assert.equal(s.phase, "reveal");
});

test("a host who leaves hands the host role to the next connected player", () => {
    const { s, host, guest, last } = withGuest();
    s.handle(host, { type: "leave" });
    const state = last(guest, "state");
    assert.equal(state.hostId, last(guest, "welcome").playerId);
    assert.deepEqual(state.players.map(p => p.name), ["Max"]);
    s.handle(guest, { type: "start", guesses: GUESSES });
    assert.equal(s.phase, "round");
});

test("a host who leaves mid-game hands over so the game can continue", () => {
    const { s, host, guest, last } = started();
    s.handle(host, { type: "leave" });
    s.handle(guest, { type: "answer", index: 0, lat: 100, lng: 200 });
    assert.equal(s.phase, "reveal");
    s.handle(guest, { type: "next" });
    assert.equal(s.phase, "round");
    assert.equal(last(guest, "state").players.find(p => p.name === "Hans").connected, false);
});

test("a host whose connection drops in the lobby stays host and can come back", () => {
    const { s, host, guest, last } = withGuest();
    const token = last(host, "welcome").token;
    s.disconnect(host);
    assert.notEqual(last(guest, "state").hostId, last(guest, "welcome").playerId);
    const back = {};
    s.join(back, { token });
    assert.equal(last(back, "welcome").isHost, true);
});

test("players whose connection drops in the lobby free their name and slot", () => {
    const { s, host, last } = setup();
    const guests = [];
    for (let i = 1; i < MAX_PLAYERS; i++) {
        const g = {};
        s.join(g, { name: `P${i}` });
        guests.push(g);
    }
    guests.forEach(g => s.disconnect(g));
    assert.deepEqual(last(host, "state").players.map(p => p.name), ["Hans"]);
    assert.equal(s.join({}, { name: "P1" }), true);
});

test("a session with connected players or watchers is never idle", () => {
    const { s, host, advance } = setup();
    const tv = {};
    s.watch(tv);
    advance(60 * 60 * 1000);
    assert.equal(s.isIdle(5000), false);
    s.disconnect(host);
    advance(60 * 60 * 1000);
    assert.equal(s.isIdle(5000), false);
    s.disconnect(tv);
    advance(4000);
    assert.equal(s.isIdle(5000), false);
    advance(2000);
    assert.equal(s.isIdle(5000), true);
});
