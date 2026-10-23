import { test } from "node:test";
import assert from "node:assert/strict";
import { Session, MAX_PLAYERS, RECONNECT_MS, LOAD_FIRST_MS, LOAD_MS, COUNTDOWN_READY_MS, COUNTDOWN_FORCED_MS, HANDOVER_MS, GRACE_MS } from "./session.js";
import { mapSize } from "../src/js/scoring.js";

const CLASSIC = { mode: "classic", timer: 0, rounds: 3, next: 0 };
const GUESSES = [
    { map: "Narva", url: "/img/guesses/a.webp", lat: -100, lng: 200, submitter: "Dan" },
    { map: "GooseBay", url: "/img/guesses/b.webp", lat: -300, lng: 400 },
    { map: "Kohat", url: "/img/guesses/c.webp", lat: -500, lng: 600 },
];

function setup(settings = CLASSIC) {
    let t = 1000;
    const sent = [];
    const s = new Session("ABCD", { send: (conn, msg) => sent.push({ conn, msg }), now: () => t });
    const all = (conn, type) => sent.filter(x => x.conn === conn && x.msg.type === type).map(x => x.msg);
    const last = (conn, type) => all(conn, type).at(-1);
    const host = { id: "host" };
    s.create(host, { name: "Hans", settings });
    const advance = (ms) => { t += ms; };
    // a started game reaches round 1: every device has its images and the countdown (at most the long one) ran out
    const begin = (conn = host) => {
        s.handle(conn, { type: "start", guesses: GUESSES });
        readyAll(s, 0);
        advance(COUNTDOWN_FORCED_MS);
        s.tick();
    };
    return { s, sent, host, all, last, advance, begin };
}

function withGuest(settings) {
    const ctx = setup(settings);
    ctx.guest = { id: "guest" };
    ctx.s.join(ctx.guest, { name: "Max" });
    return ctx;
}

// every connected player reports that round i's images are loaded
function readyAll(s, i) {
    s.players.forEach(p => { if (p.connected) s.handle(p.conn, { type: "ready", index: i }); });
}

function started(settings) {
    const ctx = withGuest(settings);
    ctx.begin();
    return ctx;
}

// the host plays the game through to the final ranking
function finish(s, host) {
    for (let i = 0; i < 3; i++) {
        s.handle(host, { type: "endRound" });
        readyAll(s, s.round + 1);
        s.handle(host, { type: "next" });
    }
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

test("until round 1 runs, players can join like in the lobby; who left during the countdown keeps their place, offline", () => {
    const { s, host, guest, last, advance } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(guest, { type: "leave" });
    assert.deepEqual(last(host, "state").players.map(p => [p.name, p.connected]), [["Hans", true], ["Max", false]]);
    // back under the same name without the token (another device) takes the place over, and someone new joins:
    // both get round 1's images to load
    const again = {};
    const late = {};
    assert.equal(s.join(again, { name: "Max" }), true);
    assert.equal(s.join(late, { name: "Late" }), true);
    assert.deepEqual([last(again, "prepare").index, last(late, "prepare").index], [0, 0]);
    readyAll(s, 0);
    advance(COUNTDOWN_FORCED_MS);
    s.tick();
    assert.equal(s.phase, "round");
    assert.equal(last(again, "round").index, 0);
    assert.deepEqual(last(host, "state").players.map(p => [p.name, p.connected]), [["Hans", true], ["Max", true], ["Late", true]]);
});

test("only the host may control the game", () => {
    const { s, guest, last } = withGuest();
    s.handle(guest, { type: "start", guesses: GUESSES });
    assert.equal(last(guest, "error").code, "NOT_HOST");
    assert.equal(s.phase, "lobby");
});

test("host can change settings in the lobby", () => {
    const { s, host, guest, last } = withGuest();
    s.handle(host, { type: "settings", settings: { mode: "mapFinder", timer: 20, rounds: 5, next: 15 } });
    assert.deepEqual(last(guest, "state").settings, { mode: "mapFinder", timer: 20, rounds: 5, next: 15 });
});

test("settings without next (an older cached client) leave the next round to the host", () => {
    const { last, host } = setup({ mode: "classic", timer: 0, rounds: 3 });
    assert.equal(last(host, "state").settings.next, 0);
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

test("state is sent before round so clients know their answered flag, and the next round is announced after it", () => {
    const { sent, guest } = started();
    const types = sent.filter(x => x.conn === guest).map(x => x.msg.type);
    assert.deepEqual(types.slice(-3), ["state", "round", "prepare"]);
});

test("round ends when every connected player answered", () => {
    const { s, host, guest, last } = started();
    s.handle(host, { type: "answer", index: s.round, lat: -100, lng: 200 });
    assert.equal(s.phase, "round");
    assert.equal(last(guest, "state").players.find(p => p.name === "Hans").answered, true);
    s.handle(guest, { type: "answer", index: s.round, lat: -2800, lng: 2800 });
    assert.equal(s.phase, "reveal");
    const reveal = last(guest, "reveal");
    assert.deepEqual(reveal.solution, { map: "Narva", url: "/img/guesses/a.webp", lat: -100, lng: 200 });
    const hans = reveal.results.find(r => r.name === "Hans");
    const max = reveal.results.find(r => r.name === "Max");
    assert.equal(hans.points, 100);
    assert.equal(hans.score, 100);
    assert.equal(max.points, 0);
    assert.equal(reveal.results[0].name, "Hans");
});

test("a disconnected player stops blocking the round once the reconnect window passed, and scores 0", () => {
    const { s, host, guest, last, advance } = started();
    s.disconnect(guest);
    s.handle(host, { type: "answer", index: s.round, lat: -100, lng: 200 });
    advance(RECONNECT_MS - 1);
    s.tick();
    assert.equal(s.phase, "round");
    advance(1);
    s.tick();
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
    s.handle(guest, { type: "answer", index: s.round, lat: -100, lng: 200 });
    s.handle(host, { type: "answer", index: s.round, lat: -100, lng: 200 });
    assert.equal(s.phase, "reveal");
    assert.equal(last(guest, "reveal").results.find(r => r.name === "Max").points, 100);
    s.handle(guest, { type: "answer", index: s.round, lat: -100, lng: 200 });
    assert.equal(last(guest, "error").code, "INVALID");
    s.handle(host, { type: "next" });
    assert.equal(last(guest, "state").players.find(p => p.name === "Max").answered, false);
});

test("a second answer in the same round is rejected", () => {
    const { s, host, last } = started();
    s.handle(host, { type: "answer", index: s.round, lat: 1, lng: 1 });
    s.handle(host, { type: "answer", index: s.round, lat: -100, lng: 200 });
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
    s.handle(host, { type: "endRound" });
    const phone = {};
    s.join(phone, { token });
    assert.equal(last(phone, "reveal").index, 0);
    assert.equal(last(phone, "round"), undefined);
});

test("host reconnect keeps host role and score", () => {
    const { s, host, guest, last } = started();
    s.handle(host, { type: "answer", index: s.round, lat: -100, lng: 200 });
    s.handle(guest, { type: "answer", index: s.round, lat: -100, lng: 200 });
    const token = last(host, "welcome").token;
    s.disconnect(host);
    const reloaded = {};
    s.join(reloaded, { token });
    assert.equal(last(reloaded, "welcome").isHost, true);
    assert.equal(last(reloaded, "state").players.find(p => p.name === "Hans").score, 100);
    readyAll(s, 1);
    s.handle(reloaded, { type: "next" });
    assert.equal(s.phase, "round");
});

test("final ranking with a tie has two winners, lobby resets", () => {
    const { s, host, guest, last } = started();
    for (let i = 0; i < 3; i++) {
        s.handle(host, { type: "answer", index: s.round, lat: GUESSES[i].lat, lng: GUESSES[i].lng });
        s.handle(guest, { type: "answer", index: s.round, lat: GUESSES[i].lat, lng: GUESSES[i].lng });
        readyAll(s, s.round + 1);
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

test("by default the reveal waits for the host's NEXT, however long it takes", () => {
    const { s, host, last, advance } = started();
    s.handle(host, { type: "endRound" });
    assert.equal(last(host, "state").nextAt, null);
    advance(10 * 60_000);
    s.tick();
    assert.equal(s.phase, "reveal");
});

test("with auto next the reveal moves on by itself after next seconds, and the host cannot skip it", () => {
    const { s, host, guest, last, advance } = started({ mode: "classic", timer: 0, rounds: 3, next: 15 });
    s.handle(host, { type: "endRound" });
    assert.equal(last(guest, "state").nextAt, s.now() + 15_000);
    s.handle(host, { type: "next" });
    assert.equal(last(host, "error").code, "INVALID");
    readyAll(s, 1);
    advance(14_999);
    s.tick();
    assert.equal(s.phase, "reveal");
    advance(1);
    s.tick();
    assert.equal(s.phase, "round");
    assert.equal(s.round, 1);
    assert.equal(last(guest, "state").nextAt, null);
});

test("with auto next the last reveal moves everyone on to the final ranking", () => {
    const { s, host, guest, last, advance } = started({ mode: "classic", timer: 0, rounds: 3, next: 5 });
    for (let i = 0; i < 3; i++) {
        readyAll(s, s.round + 1);
        s.handle(host, { type: "endRound" });
        advance(5_000);
        s.tick();
    }
    assert.equal(s.phase, "final");
    assert.ok(last(guest, "final"));
});

test("back to the lobby is allowed from the last reveal (players may already be on their results), not earlier", () => {
    const { s, host } = started();
    s.handle(host, { type: "endRound" });
    s.handle(host, { type: "lobby" });
    assert.equal(s.phase, "reveal");
    for (let i = 0; i < 2; i++) {
        readyAll(s, s.round + 1);
        s.handle(host, { type: "next" });
        s.handle(host, { type: "endRound" });
    }
    s.handle(host, { type: "lobby" });
    assert.equal(s.phase, "lobby");
});

test("any player goes back to the lobby on their own: the others stay on their results until they follow", () => {
    const { s, host, guest, last } = started();
    finish(s, host);
    s.handle(guest, { type: "lobby" });
    assert.equal(s.phase, "lobby");
    assert.deepEqual(last(host, "state").players.map(p => [p.name, p.back]), [["Hans", false], ["Max", true]]);
    s.handle(guest, { type: "lobbyReady", ready: true });
    s.handle(host, { type: "lobby" });
    // following does not start the lobby over: the guest stays ready
    assert.deepEqual(last(host, "state").players.map(p => [p.name, p.back, p.lobbyReady]), [["Hans", true, false], ["Max", true, true]]);
});

test("going back to the lobby mid-game is refused for guests as for the host", () => {
    const { s, guest, last } = started();
    s.handle(guest, { type: "lobby" });
    assert.equal(last(guest, "error").code, "INVALID");
    assert.equal(s.phase, "round");
});

test("whoever joins the lobby after a game is in it, not on any results", () => {
    const { s, host, guest, last } = started();
    finish(s, host);
    s.handle(guest, { type: "lobby" });
    s.join({}, { name: "Ana" });
    assert.equal(last(host, "state").players.find(p => p.name === "Ana").back, true);
});

test("a host still on the results HANDOVER_MS after the first player came back hands over to whoever came back first", () => {
    const { s, host, guest, last, advance, begin } = withGuest();
    const ana = {};
    s.join(ana, { name: "Ana" });
    begin();
    finish(s, host);
    s.handle(ana, { type: "lobby" });
    advance(5_000);
    s.handle(guest, { type: "lobby" });
    advance(HANDOVER_MS - 5_001);
    s.tick();
    assert.equal(last(guest, "state").hostId, last(host, "welcome").playerId);
    advance(1);
    s.tick();
    assert.equal(last(guest, "state").hostId, last(ana, "welcome").playerId);
    // coming back later, the old host is a guest like the others
    s.handle(host, { type: "lobby" });
    assert.equal(last(host, "state").hostId, last(ana, "welcome").playerId);
});

test("a host back in the lobby in time keeps the role, however long the others waited", () => {
    const { s, host, guest, last, advance } = started();
    finish(s, host);
    s.handle(guest, { type: "lobby" });
    advance(HANDOVER_MS - 1);
    s.handle(host, { type: "lobby" });
    advance(10 * 60_000);
    s.tick();
    assert.equal(s.hostId, last(host, "welcome").playerId);
});

test("a called-off start leaves nobody on the results: the start took everyone along", () => {
    const { s, host, last } = started();
    finish(s, host);
    s.handle(host, { type: "lobby" });
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "cancelStart" });
    assert.equal(last(host, "state").players.find(p => p.name === "Max").back, true);
});

test("watchers receive state and rounds but cannot act", () => {
    const { s, last, begin } = withGuest();
    const tv = {};
    assert.equal(s.watch(tv), true);
    assert.equal(last(tv, "state").phase, "lobby");
    begin();
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
    s.handle(host, { type: "answer", index: 0, lat: -100, lng: 200 });
    s.handle(host, { type: "endRound" });
    readyAll(s, 1);
    s.handle(host, { type: "next" });
    s.handle(guest, { type: "answer", index: 0, lat: -300, lng: 400 });
    assert.equal(last(guest, "error").code, "INVALID");
    s.handle(guest, { type: "answer", index: 1, lat: -300, lng: 400 });
    s.handle(host, { type: "answer", index: 1, lat: -300, lng: 400 });
    assert.equal(last(guest, "reveal").results.find(r => r.name === "Max").points, 100);
});

test("an answer without a round index is rejected", () => {
    const { s, host, last } = started();
    s.handle(host, { type: "answer", lat: -100, lng: 200 });
    assert.equal(last(host, "error").code, "INVALID");
});

test("leaving the lobby frees the name and the slot", () => {
    const { s, host, guest, last } = withGuest();
    s.handle(guest, { type: "leave" });
    assert.deepEqual(last(host, "state").players.map(p => p.name), ["Hans"]);
    const again = {};
    assert.equal(s.join(again, { name: "Max" }), true);
});

test("the host can kick a player from the lobby: they are told, their old token stays out, name and slot are free", () => {
    const { s, host, guest, last } = withGuest();
    const { playerId, token } = last(guest, "welcome");
    s.handle(host, { type: "kick", playerId });
    assert.equal(last(guest, "error").code, "KICKED");
    assert.deepEqual(last(host, "state").players.map(p => p.name), ["Hans"]);
    // offline at the kick, they never got the message: their reconnect must not quietly undo it
    const back = {};
    assert.equal(s.join(back, { name: "Max", token }), false);
    assert.equal(last(back, "error").code, "KICKED");
    assert.equal(s.join({}, { name: "Max" }), true);
});

test("only the host kicks, never themselves, and only in the lobby", () => {
    const { s, host, guest, last } = withGuest();
    const hostId = last(host, "welcome").playerId;
    const guestId = last(guest, "welcome").playerId;
    s.handle(guest, { type: "kick", playerId: hostId });
    assert.equal(last(guest, "error").code, "NOT_HOST");
    s.handle(host, { type: "kick", playerId: hostId });
    assert.equal(last(host, "error").code, "INVALID");
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "kick", playerId: guestId });
    assert.equal(last(host, "error").code, "INVALID");
    assert.equal(s.players.size, 2);
});

test("the host can make a guest in the lobby host and is a guest then", () => {
    const { s, host, guest, last } = withGuest();
    const guestId = last(guest, "welcome").playerId;
    s.handle(host, { type: "promote", playerId: guestId });
    assert.equal(last(host, "state").hostId, guestId);
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(last(host, "error").code, "NOT_HOST");
    s.handle(guest, { type: "start", guesses: GUESSES });
    assert.equal(s.phase, "loading");
});

test("only the host promotes, never themselves, and only in the lobby", () => {
    const { s, host, guest, last } = withGuest();
    const hostId = last(host, "welcome").playerId;
    const guestId = last(guest, "welcome").playerId;
    s.handle(guest, { type: "promote", playerId: guestId });
    assert.equal(last(guest, "error").code, "NOT_HOST");
    s.handle(host, { type: "promote", playerId: hostId });
    assert.equal(last(host, "error").code, "INVALID");
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "promote", playerId: guestId });
    assert.equal(last(host, "error").code, "INVALID");
    assert.equal(s.hostId, hostId);
});

test("promoting someone gone, offline or still on the results does nothing: they may have left during the question", () => {
    const { s, host, guest, last, all } = started();
    const hostId = last(host, "welcome").playerId;
    const ana = {};
    finish(s, host);
    s.handle(host, { type: "lobby" });
    s.join(ana, { name: "Ana" });
    const anaId = last(ana, "welcome").playerId;
    s.disconnect(ana);
    const before = all(host, "error").length;
    s.handle(host, { type: "promote", playerId: last(guest, "welcome").playerId });
    s.handle(host, { type: "promote", playerId: anaId });
    s.handle(host, { type: "promote", playerId: "nobody" });
    assert.equal(s.hostId, hostId);
    assert.equal(all(host, "error").length, before);
});

test("leaving a running game keeps the player's score but marks them offline", () => {
    const { s, host, guest, last } = started();
    s.handle(guest, { type: "leave" });
    const max = last(host, "state").players.find(p => p.name === "Max");
    assert.equal(max.connected, false);
    s.handle(host, { type: "answer", index: 0, lat: -100, lng: 200 });
    assert.equal(s.phase, "reveal");
});

test("a host who leaves hands the host role to the next connected player", () => {
    const { s, host, guest, last, begin } = withGuest();
    s.handle(host, { type: "leave" });
    const state = last(guest, "state");
    assert.equal(state.hostId, last(guest, "welcome").playerId);
    assert.deepEqual(state.players.map(p => p.name), ["Max"]);
    s.join({}, { name: "Ana" });
    begin(guest);
    assert.equal(s.phase, "round");
});

test("a host who leaves mid-game hands over so the game can continue", () => {
    const { s, host, guest, last } = started();
    s.handle(host, { type: "leave" });
    s.handle(guest, { type: "answer", index: 0, lat: -100, lng: 200 });
    assert.equal(s.phase, "reveal");
    readyAll(s, 1);
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

test("a lobby guest whose connection drops keeps their place and can still get into the game", () => {
    const { s, host, guest, last, begin } = withGuest();
    const token = last(guest, "welcome").token;
    s.disconnect(guest);
    assert.deepEqual(last(host, "state").players.map(p => [p.name, p.connected]), [["Hans", true], ["Max", false]]);
    s.join({}, { name: "Ana" });
    begin();
    const phone = {};
    assert.equal(s.join(phone, { name: "Max", token }), true);
    assert.equal(last(phone, "round").index, 0);
});

test("joining the lobby with the name of a player who dropped out takes over their place", () => {
    const { s, host, last } = setup();
    for (let i = 1; i < MAX_PLAYERS; i++) s.join({ id: i }, { name: `P${i}` });
    s.disconnect(s.findPlayer(p => p.name === "P1").conn);
    const again = {};
    assert.equal(s.join(again, { name: "p1" }), true);
    assert.deepEqual(last(host, "state").players.map(p => p.name).filter(n => n.toLowerCase() === "p1"), ["p1"]);
    assert.equal(s.join({}, { name: "P2" }), false);
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

test("absurd answer coordinates are clamped to the map", () => {
    const { s, host, guest, last } = started();
    s.handle(host, { type: "answer", index: 0, lat: 1e200, lng: -1e200 });
    s.handle(guest, { type: "answer", index: 0, lat: -1e200, lng: 1e200 });
    const size = mapSize("Narva");
    const [hans, max] = ["Hans", "Max"].map(n => last(host, "reveal").results.find(r => r.name === n));
    assert.deepEqual([hans.lat, hans.lng, max.lat, max.lng], [0, 0, -size, size]);
});

test("a player whose connection drops for a moment does not end the round", () => {
    const { s, host, guest, last, advance } = started();
    const token = last(guest, "welcome").token;
    s.handle(host, { type: "answer", index: 0, lat: -100, lng: 200 });
    s.disconnect(guest);
    advance(1000);
    s.tick();
    assert.equal(s.phase, "round");
    const phone = {};
    s.join(phone, { token });
    s.handle(phone, { type: "answer", index: 0, lat: -100, lng: 200 });
    assert.equal(last(phone, "reveal").results.find(r => r.name === "Max").points, 100);
});

test("a host who is gone longer than a reload hands the host role to a connected player", () => {
    const { s, host, guest, last, advance } = started();
    s.disconnect(host);
    advance(RECONNECT_MS - 1);
    s.tick();
    assert.notEqual(last(guest, "state").hostId, last(guest, "welcome").playerId);
    advance(1);
    s.tick();
    assert.equal(last(guest, "state").hostId, last(guest, "welcome").playerId);
    s.handle(guest, { type: "endRound" });
    assert.equal(s.phase, "reveal");
});

test("when nobody connected holds the host role, the next player who is there gets it", () => {
    const { s, host, last, begin } = setup();
    const tv = {};
    s.watch(tv);
    s.handle(host, { type: "leave" });
    const phone = {};
    s.join(phone, { name: "Hans" });
    s.tick();
    assert.equal(last(tv, "state").hostId, last(phone, "welcome").playerId);
    s.join({}, { name: "Max" });
    begin(phone);
    assert.equal(s.phase, "round");
});

test("a second connection with the same token takes over, and the first one is told", () => {
    const { s, guest, last } = withGuest();
    const tab = {};
    s.join(tab, { token: last(guest, "welcome").token });
    assert.equal(last(guest, "error").code, "REPLACED");
    assert.equal(last(tab, "welcome").playerId, last(guest, "welcome").playerId);
});

test("back in the lobby, players who left or dropped out during the game are gone", () => {
    const { s, host, guest, last } = started();
    s.handle(guest, { type: "leave" });
    for (let i = 0; i < 3; i++) {
        s.handle(host, { type: "endRound" });
        readyAll(s, s.round + 1);
        s.handle(host, { type: "next" });
    }
    assert.equal(s.phase, "final");
    s.handle(host, { type: "lobby" });
    assert.deepEqual(last(host, "state").players.map(p => p.name), ["Hans"]);
    assert.equal(s.join({}, { name: "Max" }), true);
});

// ===== LOADING: everyone sees a round at the same moment =====

test("a round is held back until every connected player has its images, and its clock starts only then", () => {
    const { s, host, guest, last, advance } = withGuest({ mode: "classic", timer: 15, rounds: 3 });
    s.handle(guest, { type: "lobbyReady", ready: true });
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(last(guest, "state").phase, "loading");
    assert.deepEqual(last(guest, "prepare"), { type: "prepare", index: 0, url: "/img/guesses/a.webp", map: "Narva" });
    assert.equal(last(guest, "round"), undefined);
    s.handle(host, { type: "answer", index: 0, lat: -100, lng: 200 });
    assert.equal(last(host, "error").code, "INVALID");
    advance(COUNTDOWN_READY_MS);
    s.handle(host, { type: "ready", index: 0 });
    assert.deepEqual(last(guest, "state").players.map(p => [p.name, p.ready, p.stalled]), [["Hans", true, false], ["Max", false, false]]);
    advance(3000);
    s.handle(guest, { type: "ready", index: 0 });
    assert.equal(s.phase, "round");
    assert.equal(last(guest, "round").deadline, 1000 + COUNTDOWN_READY_MS + 3000 + 15000);
});

test("loading waits at most LOAD_FIRST_MS, then LOAD_MS; who missed it is not waited for until they report back", () => {
    const { s, host, guest, last, advance } = withGuest();
    const max = () => s.findPlayer(p => p.name === "Max");
    const skip = (i) => { s.handle(host, { type: "endRound" }); s.handle(host, { type: "ready", index: i }); s.handle(host, { type: "next" }); };
    s.handle(guest, { type: "lobbyReady", ready: true });
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "ready", index: 0 });
    advance(LOAD_FIRST_MS - 1);
    s.tick();
    assert.equal(s.phase, "loading");
    advance(1);
    s.tick();
    assert.equal(s.phase, "round");
    assert.equal(max().stalled, true);
    // the locked phone does not hold up the next round; a ready, even a late one, brings Max back into the waiting
    skip(1);
    assert.equal(s.phase, "round");
    s.handle(guest, { type: "ready", index: 1 });
    skip(2);
    assert.equal(s.phase, "loading");
    advance(LOAD_MS - 1);
    s.tick();
    assert.equal(s.phase, "loading");
    advance(1);
    s.tick();
    assert.equal(max().stalled, true);
    // coming back counts as reporting back too
    s.disconnect(guest);
    s.join({}, { token: last(guest, "welcome").token });
    assert.equal(max().stalled, false);
});

test("preloaded rounds start at once and announce the next; a new game waits for everyone again", () => {
    const { s, host, guest, sent, all } = started();
    s.handle(host, { type: "endRound" });
    readyAll(s, 1);
    const before = sent.length;
    s.handle(host, { type: "next" });
    const mine = sent.slice(before).filter(x => x.conn === guest).map(x => x.msg);
    assert.deepEqual(mine.map(m => m.type), ["state", "round", "prepare"]);
    assert.equal(mine[0].phase, "round");
    s.handle(host, { type: "endRound" });
    readyAll(s, 2);
    s.handle(host, { type: "next" });
    s.handle(host, { type: "endRound" });
    s.handle(host, { type: "next" });
    assert.equal(s.phase, "final");
    // the last round announces nothing; a ready after the game is ignored without an error
    assert.deepEqual(all(guest, "prepare").map(m => m.index), [0, 1, 2]);
    s.handle(guest, { type: "ready", index: 2 });
    assert.deepEqual(all(guest, "error"), []);
    s.handle(host, { type: "lobby" });
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(s.phase, "loading");
});

test("a player who drops or leaves while loading is not waited for", () => {
    const { s, host, guest, advance } = withGuest();
    const ida = {};
    s.join(ida, { name: "Ida" });
    s.handle(guest, { type: "lobbyReady", ready: true });
    s.handle(ida, { type: "lobbyReady", ready: true });
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "ready", index: 0 });
    advance(COUNTDOWN_READY_MS);
    s.disconnect(guest);
    s.tick();
    assert.equal(s.phase, "loading");
    s.handle(ida, { type: "leave" });
    assert.equal(s.phase, "round");
});

test("with everyone away, loading waits; the first one back gets a fresh wait that still ends after LOAD_MS", () => {
    const { s, host, guest, last, advance } = withGuest();
    s.handle(guest, { type: "lobbyReady", ready: true });
    s.handle(host, { type: "start", guesses: GUESSES });
    s.disconnect(host);
    s.disconnect(guest);
    advance(LOAD_FIRST_MS + 1000);
    s.tick();
    assert.equal(s.phase, "loading");
    s.join({}, { token: last(host, "welcome").token });
    s.tick();
    assert.equal(s.phase, "loading");
    assert.equal(s.findPlayer(p => p.name === "Hans").stalled, false);
    advance(LOAD_MS - 1);
    s.tick();
    assert.equal(s.phase, "loading");
    advance(1);
    s.tick();
    assert.equal(s.phase, "round");
});

test("a player who reconnects gets the images again: while loading without extending the time, later for the next round", () => {
    const { s, host, guest, last, advance } = withGuest();
    const back = () => { const conn = {}; s.disconnect(s.findPlayer(p => p.name === "Max").conn); s.join(conn, { token: last(guest, "welcome").token }); return conn; };
    s.handle(guest, { type: "lobbyReady", ready: true });
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "ready", index: 0 });
    advance(5000);
    let phone = back();
    assert.equal(last(phone, "prepare").index, 0);
    advance(LOAD_FIRST_MS - 5000 - 1);
    s.tick();
    assert.equal(s.phase, "loading");
    advance(1);
    s.tick();
    assert.equal(s.phase, "round");
    phone = back();
    assert.deepEqual([last(phone, "round").index, last(phone, "prepare").index], [0, 1]);
    s.handle(phone, { type: "ready", index: 1 });
    s.handle(host, { type: "endRound" });
    phone = back();
    assert.deepEqual([last(phone, "reveal").index, last(phone, "prepare").index], [0, 1]);
    // a reloaded page lost its preloaded images, so the next round waits for it again
    s.handle(host, { type: "ready", index: 1 });
    s.handle(host, { type: "next" });
    assert.equal(s.phase, "loading");
    s.handle(phone, { type: "ready", index: 1 });
    assert.equal(s.phase, "round");
});

test("odd ready messages are ignored silently: outside a game, not announced, stale, not a whole number, duplicate", () => {
    const { s, host, guest, sent, all } = withGuest();
    s.handle(guest, { type: "ready", index: 0 });
    s.handle(host, { type: "start", guesses: GUESSES });
    const before = sent.length;
    s.handle(guest, { type: "ready", index: 1 });
    s.handle(guest, { type: "ready", index: 2 });
    s.handle(guest, { type: "ready", index: "0" });
    s.handle(guest, { type: "ready", index: 0.5 });
    s.handle(guest, { type: "ready" });
    assert.equal(sent.length, before);
    assert.equal(s.findPlayer(p => p.name === "Max").ready, -1);
    s.handle(guest, { type: "ready", index: 0 });
    const counted = sent.length;
    s.handle(guest, { type: "ready", index: 0 });
    assert.equal(sent.length, counted);
    assert.deepEqual(all(guest, "error"), []);
});

test("watchers get the images to preload but are never waited for", () => {
    const { s, host, last, advance } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    const tv = {};
    s.watch(tv);
    assert.deepEqual([last(tv, "state").phase, last(tv, "prepare").index], ["loading", 0]);
    readyAll(s, 0);
    advance(COUNTDOWN_FORCED_MS);
    s.tick();
    assert.equal(s.phase, "round");
    assert.equal(last(tv, "prepare").index, 1);
});

test("mapFinder never sends the map ahead, not even for preloading", () => {
    const { guest, all } = started({ mode: "mapFinder", timer: 0, rounds: 3 });
    assert.deepEqual(all(guest, "prepare").map(m => m.map), [null, null]);
});

// ===== LOBBY READY AND START COUNTDOWN =====

test("guests mark themselves ready in the lobby; odd marks and marks outside the lobby are ignored silently", () => {
    const { s, host, guest, sent, all, last } = withGuest();
    s.handle(guest, { type: "lobbyReady", ready: true });
    assert.deepEqual(last(host, "state").players.map(p => [p.name, p.lobbyReady]), [["Hans", false], ["Max", true]]);
    const before = sent.length;
    s.handle(guest, { type: "lobbyReady", ready: true });
    s.handle(guest, { type: "lobbyReady", ready: "false" });
    s.handle(guest, { type: "lobbyReady" });
    assert.equal(sent.length, before);
    s.handle(guest, { type: "lobbyReady", ready: false });
    assert.equal(last(host, "state").players.find(p => p.name === "Max").lobbyReady, false);
    s.handle(host, { type: "start", guesses: GUESSES });
    const starting = sent.length;
    s.handle(guest, { type: "lobbyReady", ready: true });
    assert.equal(sent.length, starting);
    assert.deepEqual(all(guest, "error"), []);
});

test("changed settings take every ready back and tell those guests; the same settings again change nothing", () => {
    const { s, host, guest, all, last } = withGuest();
    const ida = { id: "ida" };
    s.join(ida, { name: "Ida" });
    s.handle(guest, { type: "lobbyReady", ready: true });
    s.handle(host, { type: "settings", settings: CLASSIC });
    assert.equal(last(host, "state").players.find(p => p.name === "Max").lobbyReady, true);
    assert.deepEqual(all(guest, "unready"), []);
    s.handle(host, { type: "settings", settings: { ...CLASSIC, rounds: 5 } });
    assert.deepEqual(last(host, "state").players.map(p => [p.name, p.lobbyReady]), [["Hans", false], ["Max", false], ["Ida", false]]);
    assert.equal(all(guest, "unready").length, 1);
    assert.deepEqual(all(ida, "unready"), []);
});

test("every start counts down: 5 s when every connected guest is ready, otherwise 15 s", () => {
    const countdown = (prepare) => {
        const ctx = withGuest();
        prepare(ctx);
        ctx.s.handle(ctx.host, { type: "start", guesses: GUESSES });
        return ctx.last(ctx.host, "state").startsAt - 1000;
    };
    assert.equal(countdown(() => {}), COUNTDOWN_FORCED_MS);
    assert.equal(countdown(({ s, guest }) => s.handle(guest, { type: "lobbyReady", ready: true })), COUNTDOWN_READY_MS);
    // a guest whose connection dropped is not waited for; the host's START is their ready
    assert.equal(countdown(({ s, guest }) => {
        const ana = {};
        s.join(ana, { name: "Ana" });
        s.handle(ana, { type: "lobbyReady", ready: true });
        s.disconnect(guest);
    }), COUNTDOWN_READY_MS);
});

test("the host cannot start alone: at least one other player has to be connected, a watcher does not count", () => {
    const { s, host, guest, last } = withGuest();
    const token = last(guest, "welcome").token;
    s.watch({});
    s.disconnect(guest);
    assert.equal(last(host, "state").canStart, false);
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(last(host, "error").code, "NO_PLAYERS");
    assert.equal(s.phase, "lobby");
    s.join({}, { name: "Max", token });
    assert.equal(last(host, "state").canStart, true);
    assert.equal(last(host, "state").allReady, false);
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(s.phase, "loading");
});

test("round 1 never starts before the countdown ends, even with every image there", () => {
    const { s, host, guest, last, advance } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    readyAll(s, 0);
    assert.equal(s.phase, "loading");
    advance(COUNTDOWN_FORCED_MS - 1);
    s.tick();
    assert.equal(s.phase, "loading");
    advance(1);
    s.tick();
    assert.equal(s.phase, "round");
    assert.equal(last(guest, "state").startsAt, null);
});

test("the long countdown is the whole wait for round 1: who still loads when it ends is not waited for", () => {
    const { s, host, advance } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "ready", index: 0 });
    advance(COUNTDOWN_FORCED_MS - 1);
    s.tick();
    assert.equal(s.phase, "loading");
    advance(1);
    s.tick();
    assert.equal(s.phase, "round");
    assert.equal(s.findPlayer(p => p.name === "Max").stalled, true);
});

test("after a game nobody is ready any more, and the next game starts from the lobby only", () => {
    const { s, host, guest, last, begin } = withGuest();
    s.handle(guest, { type: "lobbyReady", ready: true });
    begin();
    for (let i = 0; i < 3; i++) {
        s.handle(host, { type: "endRound" });
        readyAll(s, s.round + 1);
        s.handle(host, { type: "next" });
    }
    assert.equal(s.phase, "final");
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(last(host, "error").code, "INVALID");
    assert.equal(s.phase, "final");
    s.handle(host, { type: "lobby" });
    assert.equal(last(guest, "state").players.find(p => p.name === "Max").lobbyReady, false);
});

test("the host can call the start off until round 1 runs: back to the lobby, ready marks stay, who left stays offline", () => {
    const { s, host, guest, last, advance } = withGuest();
    const ida = {};
    s.join(ida, { name: "Ida" });
    s.handle(guest, { type: "lobbyReady", ready: true });
    s.handle(ida, { type: "lobbyReady", ready: true });
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(guest, { type: "cancelStart" });
    assert.equal(last(guest, "error").code, "NOT_HOST");
    s.handle(ida, { type: "leave" });
    // the countdown is over, but a slow device is still waited for: that can be called off too
    s.handle(host, { type: "ready", index: 0 });
    advance(COUNTDOWN_READY_MS);
    s.tick();
    assert.equal(s.phase, "loading");
    s.handle(host, { type: "cancelStart" });
    const state = last(guest, "state");
    assert.deepEqual([state.phase, state.startsAt], ["lobby", null]);
    // Ida left during the countdown: offline like a dropped connection, she can come back with her token
    assert.deepEqual(state.players.map(p => [p.name, p.connected, p.lobbyReady]), [["Hans", true, false], ["Max", true, true], ["Ida", false, true]]);
    assert.deepEqual([...s.players.values()].map(p => [p.ready, p.stalled]), [[-1, false], [-1, false], [-1, false]]);
    // nothing keeps running in the lobby
    advance(LOAD_FIRST_MS);
    s.tick();
    assert.equal(s.phase, "lobby");
    // a new start counts down again; once round 1 runs, there is nothing left to call off
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.deepEqual([s.phase, last(guest, "prepare").index], ["loading", 0]);
    readyAll(s, 0);
    advance(COUNTDOWN_READY_MS);
    s.tick();
    assert.equal(s.phase, "round");
    s.handle(host, { type: "cancelStart" });
    assert.equal(last(host, "error").code, "INVALID");
    assert.equal(s.phase, "round");
});

test("a guest whose connection dropped in the lobby keeps their place through a called-off start", () => {
    const { s, host, guest, last, advance } = withGuest();
    const token = last(guest, "welcome").token;
    s.handle(guest, { type: "lobbyReady", ready: true });
    s.disconnect(guest);
    advance(RECONNECT_MS + 60 * 1000);
    s.tick();
    // the host is not alone, so the start goes through
    s.join({}, { name: "Ana" });
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(s.phase, "loading");
    s.handle(host, { type: "cancelStart" });
    assert.deepEqual(last(host, "state").players.map(p => [p.name, p.connected, p.lobbyReady]), [["Hans", true, false], ["Max", false, true], ["Ana", true, false]]);
    // back with their token, even once the next start is running
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(s.phase, "loading");
    const phone = {};
    assert.equal(s.join(phone, { token }), true);
    assert.equal(last(phone, "welcome").playerId, last(guest, "welcome").playerId);
});

test("check tells a token that can come back where the game is, and changes nothing", () => {
    const { s, sent, host, guest, last, advance } = withGuest();
    s.join({}, { name: "Ida" });
    const { playerId, token } = last(guest, "welcome");
    s.disconnect(guest);
    // only the probe hears back: no broadcast, and the player stays offline
    const check = () => {
        const conn = {};
        const before = sent.length;
        s.check(conn, token);
        assert.equal(sent.length, before + 1);
        assert.equal(s.players.get(playerId).connected, false);
        return sent.at(-1).msg;
    };
    assert.deepEqual(check(), { type: "resumable", code: "ABCD", phase: "lobby", round: 0, total: 3 });
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.deepEqual(check(), { type: "resumable", code: "ABCD", phase: "loading", round: 0, total: 3 });
    readyAll(s, 0);
    advance(COUNTDOWN_FORCED_MS);
    s.tick();
    assert.deepEqual(check(), { type: "resumable", code: "ABCD", phase: "round", round: 0, total: 3 });
    s.handle(host, { type: "endRound" });
    assert.deepEqual(check(), { type: "resumable", code: "ABCD", phase: "reveal", round: 0, total: 3 });
});

test("check turns away an unknown or odd token, a kicked player, who left the lobby, and a game that is over", () => {
    const { s, host, guest, last, begin } = withGuest();
    const answer = (token) => {
        const conn = {};
        s.check(conn, token);
        return last(conn, "resumable") ? "resumable" : last(conn, "error").code;
    };
    assert.equal(answer("nope"), "SESSION_NOT_FOUND");
    assert.equal(answer(undefined), "SESSION_NOT_FOUND");
    assert.equal(answer({ toString: 1 }), "SESSION_NOT_FOUND");
    const ida = {};
    s.join(ida, { name: "Ida" });
    s.handle(host, { type: "kick", playerId: last(ida, "welcome").playerId });
    assert.equal(answer(last(ida, "welcome").token), "SESSION_NOT_FOUND");
    const ana = {};
    s.join(ana, { name: "Ana" });
    s.handle(ana, { type: "leave" });
    assert.equal(answer(last(ana, "welcome").token), "SESSION_NOT_FOUND");
    // the last round is still worth coming back for, its reveal and the final are not
    const token = last(guest, "welcome").token;
    begin();
    for (let i = 0; i < 2; i++) {
        s.handle(host, { type: "endRound" });
        readyAll(s, s.round + 1);
        s.handle(host, { type: "next" });
    }
    assert.equal(answer(token), "resumable");
    s.handle(host, { type: "endRound" });
    assert.equal(s.phase, "reveal");
    assert.equal(answer(token), "SESSION_NOT_FOUND");
    s.handle(host, { type: "next" });
    assert.equal(s.phase, "final");
    assert.equal(answer(token), "SESSION_NOT_FOUND");
});

test("who left during the countdown comes back with their token, even once round 1 runs", () => {
    const { s, host, guest, last, advance } = withGuest();
    const { playerId, token } = last(guest, "welcome");
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(guest, { type: "leave" });
    readyAll(s, 0);
    advance(COUNTDOWN_FORCED_MS);
    s.tick();
    assert.equal(s.phase, "round");
    const phone = {};
    assert.equal(s.join(phone, { token }), true);
    assert.equal(last(phone, "welcome").playerId, playerId);
    assert.equal(last(phone, "round").index, 0);
});

test("leaving the lobby tells everyone else who left; a kick, a dropped connection and leaving later do not", () => {
    const { s, host, guest, all, last, advance } = withGuest();
    const tv = {};
    s.watch(tv);
    const join = (name) => {
        const conn = {};
        s.join(conn, { name });
        return conn;
    };
    const ida = join("Ida");
    s.handle(ida, { type: "leave" });
    const left = [{ type: "left", name: "Ida" }];
    assert.deepEqual([all(host, "left"), all(guest, "left"), all(tv, "left"), all(ida, "left")], [left, left, left, []]);
    const eve = join("Eve");
    s.handle(host, { type: "kick", playerId: last(eve, "welcome").playerId });
    s.disconnect(join("Ana"));
    const bob = join("Bob");
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(guest, { type: "leave" });
    readyAll(s, 0);
    advance(COUNTDOWN_FORCED_MS);
    s.tick();
    assert.equal(s.phase, "round");
    s.handle(bob, { type: "leave" });
    assert.deepEqual(all(host, "left"), left);
});

test("the reconnect window is 30 s: long enough for a quick app switch or a trip to another page and back", () => {
    const { s, host, guest, advance } = started();
    s.disconnect(guest);
    s.handle(host, { type: "answer", index: s.round, lat: -100, lng: 200 });
    advance(29 * 1000);
    s.tick();
    assert.equal(s.phase, "round");
    advance(1000);
    s.tick();
    assert.equal(s.phase, "reveal");
});

test("someone new who joins the countdown after everyone left still gets the time to load round 1", () => {
    const { s, host, guest, advance } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    s.disconnect(host);
    s.disconnect(guest);
    advance(COUNTDOWN_FORCED_MS + LOAD_FIRST_MS);
    s.tick();
    assert.equal(s.phase, "loading");
    const late = {};
    assert.equal(s.join(late, { name: "Late" }), true);
    s.tick();
    assert.equal(s.phase, "loading");
    s.handle(late, { type: "ready", index: 0 });
    assert.equal(s.phase, "round");
});

// ===== TEAM PLAY =====

const SUM = { ...CLASSIC, team: "sum", teams: 2, penalty: false, decide: 20 };

// a team lobby: Hans (host) and Ida in team 0, Max and Eve in team 1, since every newcomer goes to the smallest team
function teamLobby(settings = SUM) {
    const ctx = setup(settings);
    const [max, ida, eve] = ["Max", "Ida", "Eve"].map(name => {
        const conn = { id: name };
        ctx.s.join(conn, { name });
        return conn;
    });
    const teamOf = (name) => ctx.s.findPlayer(p => p.name === name).team;
    return { ...ctx, max, ida, eve, teamOf };
}

function teamGame(settings) {
    const ctx = teamLobby(settings);
    ctx.begin();
    return ctx;
}

test("a session holds up to 30 players", () => {
    assert.equal(MAX_PLAYERS, 30);
});

test("team play: the settings carry the team fields; without teams they stay what they were", () => {
    const { host, last } = setup(SUM);
    assert.deepEqual(last(host, "state").settings, SUM);
    const plain = setup({ ...CLASSIC, team: "off", teams: 4, penalty: true });
    assert.deepEqual(plain.last(plain.host, "state").settings, CLASSIC);
});

test("team play: every newcomer goes to the smallest team, the lowest one on a tie", () => {
    const { host, last } = teamLobby();
    assert.deepEqual(last(host, "state").players.map(p => [p.name, p.team]), [["Hans", 0], ["Max", 1], ["Ida", 0], ["Eve", 1]]);
});

test("team play: once START was pressed, newcomers only fill teams that already play", () => {
    // Midpoint: in Sum nobody new joins the countdown (see below)
    const { s, host, last } = setup({ ...SUM, team: "centroid", teams: 4 });
    s.join({}, { name: "Max" });
    s.join({}, { name: "Ida" });
    s.handle(host, { type: "start", guesses: GUESSES });
    s.join({}, { name: "Late" });
    // teams 0–2 have one player each, team 3 none: the late one joins team 0, not a team of their own
    assert.equal(last(host, "state").players.find(p => p.name === "Late").team, 0);
});

test("team play: a player switches teams in the lobby; a bad team is refused, a click after START is ignored", () => {
    // Midpoint: in Sum the uneven teams would hold START back
    const { s, host, max, last, all, teamOf } = teamLobby({ ...SUM, team: "centroid" });
    s.handle(max, { type: "team", team: 0 });
    assert.equal(teamOf("Max"), 0);
    assert.equal(last(host, "state").players.find(p => p.name === "Max").team, 0);
    for (const team of [2, -1, 0.5, "1"]) {
        s.handle(max, { type: "team", team });
        assert.equal(last(max, "error").code, "INVALID", `team ${team}`);
    }
    s.handle(host, { type: "start", guesses: GUESSES });
    const errors = all(max, "error").length;
    s.handle(max, { type: "team", team: 1 });
    assert.equal(all(max, "error").length, errors);
    assert.equal(teamOf("Max"), 0);
});

test("team play: the host shuffles everyone into teams that differ by one at most", () => {
    const { s, host, max, last } = teamLobby({ ...SUM, teams: 3 });
    s.join({}, { name: "Ana" });
    s.handle(max, { type: "shuffle" });
    assert.equal(last(max, "error").code, "NOT_HOST");
    s.handle(host, { type: "shuffle" });
    const sizes = [0, 1, 2].map(team => last(host, "state").players.filter(p => p.team === team).length);
    assert.deepEqual(sizes.sort(), [1, 2, 2]);
});

test("team play: a shuffle is announced to everyone right before the state with the new teams", () => {
    const { s, sent, host, max, ida } = teamLobby();
    s.handle(host, { type: "shuffle" });
    // the page tells its player the new team (and lead) from that state, not from a switch of their own
    [host, max, ida].forEach(conn => {
        const mine = sent.filter(x => x.conn === conn).map(x => x.msg.type);
        assert.deepEqual(mine.slice(-2), ["shuffled", "state"], conn.id);
    });
});

test("Leader: after a shuffle the first player dealt to a team leads it, not whoever joined first", () => {
    const { s, host } = teamLobby(LEADER);
    // one clock tick for the whole shuffle: only the deal may order the players. The host is the first to join, so
    // led every time with the join order; with the deal they lead about every other time (all 20 by chance: 1 in 10^6)
    const id = s.findPlayer(p => p.conn === host).id;
    const led = Array.from({ length: 20 }, () => {
        s.handle(host, { type: "shuffle" });
        return s.leaders.includes(id);
    });
    assert.ok(led.includes(false));
});

test("team play: shuffling needs team play", () => {
    const { s, host, last } = withGuest();
    s.handle(host, { type: "shuffle" });
    assert.equal(last(host, "error").code, "INVALID");
});

test("team play: with fewer teams, the players of the dropped ones go to the smallest teams left", () => {
    const { s, host, teamOf } = teamLobby({ ...SUM, teams: 4 });
    assert.deepEqual(["Hans", "Max", "Ida", "Eve"].map(teamOf), [0, 1, 2, 3]);
    s.handle(host, { type: "settings", settings: SUM });
    assert.deepEqual(["Hans", "Max", "Ida", "Eve"].map(teamOf), [0, 1, 0, 1]);
});

test("team play: START needs players in two teams at least", () => {
    const { s, host, max, eve, last } = teamLobby();
    s.handle(max, { type: "team", team: 0 });
    s.handle(eve, { type: "team", team: 0 });
    assert.equal(last(host, "state").canStart, false);
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(last(host, "error").code, "NO_PLAYERS");
    s.handle(eve, { type: "team", team: 1 });
    s.handle(max, { type: "team", team: 1 });
    assert.equal(last(host, "state").canStart, true);
});

test("team play: who comes back under their name without the token takes their old place, team included", () => {
    const { s, max, teamOf } = teamLobby();
    // team 0: Hans, Ida, Max; team 1: Eve, the smallest one
    s.handle(max, { type: "team", team: 0 });
    s.disconnect(max);
    s.join({}, { name: "Max" });
    assert.equal(teamOf("Max"), 0);
});

test("team play sum: START needs teams of the same size", () => {
    const { s, host, last } = teamLobby();
    s.join({}, { name: "Ana" });
    assert.equal(last(host, "state").canStart, false);
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(last(host, "error").code, "NO_PLAYERS");
    s.join({}, { name: "Bob" });
    assert.equal(last(host, "state").canStart, true);
});

test("team play sum: nobody new joins the countdown, a team would grow; who comes back keeps their place", () => {
    const { s, host, ida, last } = teamLobby();
    s.handle(host, { type: "start", guesses: GUESSES });
    const late = {};
    assert.equal(s.join(late, { name: "Late" }), false);
    assert.equal(last(late, "error").code, "GAME_RUNNING");
    s.disconnect(ida);
    assert.equal(s.join({}, { token: last(ida, "welcome").token }), true);
    s.disconnect(s.findPlayer(p => p.name === "Ida").conn);
    assert.equal(s.join({}, { name: "Ida" }), true);
});

// an answer for round 1 that lies `d` meters straight south of its solution (Narva, lat -100, lng 200)
const south = (d) => ({ type: "answer", index: 0, lat: -100 - d, lng: 200 });
// on Narva: the last scoring step, beyond which a guess scores 0
const ZONE = 500 * mapSize("Narva") / 3000;

test("team play: a player sees their team's guesses once they answered, positions only; other teams and watchers never", () => {
    const { s, host, max, ida, eve, all, last } = teamGame();
    const tv = {};
    s.watch(tv);
    s.handle(host, south(0));
    const hans = last(host, "welcome").playerId;
    assert.deepEqual(last(host, "teamGuesses"), { type: "teamGuesses", index: 0, guesses: [{ id: hans, name: "Hans", lat: -100, lng: 200 }] });
    assert.deepEqual([all(ida, "teamGuesses"), all(max, "teamGuesses"), all(eve, "teamGuesses"), all(tv, "teamGuesses")], [[], [], [], []]);
    s.handle(ida, south(100));
    assert.deepEqual(last(host, "teamGuesses").guesses.map(g => g.name), ["Hans", "Ida"]);
    assert.deepEqual(last(ida, "teamGuesses").guesses.map(g => g.name), ["Hans", "Ida"]);
    assert.deepEqual([all(max, "teamGuesses"), all(eve, "teamGuesses"), all(tv, "teamGuesses")], [[], [], []]);
});

test("team play: without teams nobody gets team guesses", () => {
    const { s, host, guest, all } = started();
    s.handle(host, { type: "answer", index: 0, lat: -100, lng: 200 });
    assert.deepEqual([all(host, "teamGuesses"), all(guest, "teamGuesses")], [[], []]);
});

test("team play: a player who reconnects during the round gets their team's guesses again", () => {
    const { s, host, ida, last } = teamGame();
    s.handle(host, south(0));
    s.handle(ida, south(100));
    s.disconnect(ida);
    const phone = {};
    s.join(phone, { token: last(ida, "welcome").token });
    assert.deepEqual(last(phone, "teamGuesses").guesses.map(g => g.name), ["Hans", "Ida"]);
});

test("team play sum: a team scores the sum of its players' points", () => {
    const { s, host, max, ida, eve, last } = teamGame();
    s.handle(host, south(0));
    s.handle(ida, south(2 * ZONE));
    s.handle(max, south(0));
    s.handle(eve, south(0));
    const reveal = last(host, "reveal");
    assert.deepEqual(reveal.teams, [
        { id: 1, points: 200, lat: null, lng: null, picked: null, score: 200 },
        { id: 0, points: 100, lat: null, lng: null, picked: null, score: 100 },
    ]);
    assert.deepEqual(reveal.results.map(r => [r.name, r.team]).sort(), [["Eve", 1], ["Hans", 0], ["Ida", 0], ["Max", 1]]);
});

test("team play sum with minus points: a far guess costs up to 50, and so does giving no answer", () => {
    const { s, host, ida, eve, last } = teamGame({ ...SUM, penalty: true });
    s.handle(host, south(0));
    // halfway from the last scoring step to three times its distance: −25
    s.handle(ida, south(2 * ZONE));
    s.handle(eve, south(0));
    // Max gives no answer: −50
    s.handle(host, { type: "endRound" });
    const reveal = last(host, "reveal");
    assert.deepEqual(reveal.results.map(r => [r.name, r.points]).sort(), [["Eve", 100], ["Hans", 100], ["Ida", -25], ["Max", -50]]);
    // 100 − 25 and 100 − 50
    assert.deepEqual(reveal.teams.map(t => [t.id, t.points]), [[0, 75], [1, 50]]);
});

test("team play sum with minus points: a player gone for good adds nothing, not even minus points", () => {
    const { s, host, max, ida, eve, last, advance } = teamGame({ ...SUM, penalty: true });
    s.disconnect(eve);
    s.handle(host, south(0));
    s.handle(ida, south(0));
    s.handle(max, south(0));
    advance(RECONNECT_MS);
    s.tick();
    assert.deepEqual(last(host, "reveal").teams.map(t => [t.id, t.points]), [[0, 200], [1, 100]]);
});

test("team play: a team whose players all left stays in the ranking and scores 0 from then on", () => {
    const { s, host, max, ida, eve, last } = teamGame();
    s.handle(max, { type: "leave" });
    s.handle(eve, { type: "leave" });
    s.handle(host, south(0));
    s.handle(ida, south(0));
    assert.deepEqual(last(host, "reveal").teams.map(t => [t.id, t.points, t.score]), [[0, 200, 200], [1, 0, 0]]);
});

test("team play: the final ranks the teams with their players, a tie has two winners; the teams stay for the next game", () => {
    const { s, host, max, ida, eve, last, begin, teamOf } = teamGame();
    for (let i = 0; i < 3; i++) {
        [host, max, ida, eve].forEach(conn => s.handle(conn, { type: "answer", index: i, lat: GUESSES[i].lat, lng: GUESSES[i].lng }));
        readyAll(s, s.round + 1);
        s.handle(host, { type: "next" });
    }
    const final = last(eve, "final");
    assert.deepEqual(final.ranking, [{ id: 0, score: 600, members: ["Hans", "Ida"] }, { id: 1, score: 600, members: ["Max", "Eve"] }]);
    assert.deepEqual(final.winners, [0, 1]);
    s.handle(host, { type: "lobby" });
    assert.deepEqual(["Hans", "Max", "Ida", "Eve"].map(teamOf), [0, 1, 0, 1]);
    // the next game starts every team at 0 again
    begin();
    s.handle(host, { type: "endRound" });
    assert.deepEqual(last(host, "reveal").teams.map(t => t.score), [0, 0]);
});

test("team play: without teams the reveal carries nothing about teams", () => {
    const { s, host, guest, last } = started();
    s.handle(host, { type: "endRound" });
    const reveal = last(guest, "reveal");
    assert.equal("teams" in reveal, false);
    assert.equal("team" in reveal.results[0], false);
});

test("team play: the state carries the team scores for the score in the corner; without teams it does not", () => {
    const { s, host, ida, last } = teamGame();
    s.handle(host, south(0));
    s.handle(ida, south(0));
    // Max and Eve gave no answer: 0
    s.handle(host, { type: "endRound" });
    assert.deepEqual(last(host, "state").teamScores, [200, 0]);
    const plain = started();
    assert.equal("teamScores" in plain.last(plain.host, "state"), false);
});

const CENTROID = { ...SUM, team: "centroid" };

test("team play midpoint: a team plays the midpoint of its guesses, scored like any guess", () => {
    const { s, host, max, ida, last } = teamGame(CENTROID);
    s.handle(host, { type: "answer", index: 0, lat: -100, lng: 50 });
    s.handle(ida, { type: "answer", index: 0, lat: -100, lng: 350 });
    s.handle(max, south(2 * ZONE));
    // Eve gives no answer: she is left out of her team's midpoint
    s.handle(host, { type: "endRound" });
    const reveal = last(host, "reveal");
    assert.deepEqual(reveal.teams, [
        { id: 0, points: 100, lat: -100, lng: 200, picked: null, score: 100 },
        { id: 1, points: 0, lat: -100 - 2 * ZONE, lng: 200, picked: null, score: 0 },
    ]);
    // the players' own points are only shown: Hans was 150 m off
    assert.ok(reveal.results.find(r => r.name === "Hans").points < 100);
});

test("team play midpoint: a team without a single guess scores 0 and has no point on the map", () => {
    const { s, host, last } = teamGame(CENTROID);
    s.handle(host, south(0));
    s.handle(host, { type: "endRound" });
    assert.deepEqual(last(host, "reveal").teams.find(t => t.id === 1), { id: 1, points: 0, lat: null, lng: null, picked: null, score: 0 });
});

test("team play: whoever is first in a team leads it, and can hand the role to a teammate in the lobby", () => {
    const { s, host, max, eve, last } = teamLobby();
    const id = (conn) => last(conn, "welcome").playerId;
    const leaders = () => last(host, "state").players.filter(p => p.leader).map(p => p.name);
    assert.deepEqual(leaders(), ["Hans", "Max"]);
    s.handle(max, { type: "lead", playerId: id(eve) });
    assert.deepEqual(leaders(), ["Hans", "Eve"]);
    // only the leader, and only to someone in their own team
    s.handle(max, { type: "lead", playerId: id(max) });
    assert.equal(last(max, "error").code, "INVALID");
    s.handle(host, { type: "lead", playerId: id(eve) });
    assert.equal(last(host, "error").code, "INVALID");
    assert.deepEqual(leaders(), ["Hans", "Eve"]);
});

test("team play: when a leader leaves or switches teams, whoever has been in the team longest leads it", () => {
    const { s, host, max, ida, last, advance } = teamLobby();
    const leaders = () => last(ida, "state").players.filter(p => p.leader).map(p => p.name);
    advance(1000);
    s.handle(max, { type: "team", team: 0 });
    // team 0: Hans, Ida, then Max; team 1: Eve alone now
    assert.deepEqual(leaders(), ["Hans", "Eve"]);
    s.handle(host, { type: "leave" });
    assert.deepEqual(leaders(), ["Ida", "Eve"]);
});

test("team play: a leader gone longer than a reload hands the team to a connected teammate", () => {
    const { s, max, eve, last, advance } = teamGame();
    const leads = (name) => last(eve, "state").players.find(p => p.name === name).leader;
    s.disconnect(max);
    advance(RECONNECT_MS - 1);
    s.tick();
    assert.equal(leads("Max"), true);
    advance(1);
    s.tick();
    assert.deepEqual([leads("Max"), leads("Eve")], [false, true]);
});

test("team play: after shuffling, every team has a leader of its own", () => {
    const { s, host, last } = teamLobby();
    s.handle(host, { type: "shuffle" });
    const players = last(host, "state").players;
    assert.deepEqual([0, 1].map(team => players.filter(p => p.team === team && p.leader).length), [1, 1]);
});

const LEADER = { ...SUM, team: "leader" };

// Leader needs three players per team: Ana joins Hans and Ida in team 0, Bob joins Max and Eve in team 1
function leaderLobby(settings = LEADER) {
    const ctx = teamLobby(settings);
    const [ana, bob] = ["Ana", "Bob"].map(name => {
        const conn = { id: name };
        ctx.s.join(conn, { name });
        return conn;
    });
    return { ...ctx, ana, bob };
}

function leaderGame(settings) {
    const ctx = leaderLobby(settings);
    ctx.begin();
    return ctx;
}

test("team play leader: START needs three players in every team that plays, so every leader has a choice", () => {
    const { s, host, bob, last } = leaderLobby();
    assert.equal(last(host, "state").canStart, true);
    // Bob moves over: Red keeps two, so its leader would have a single guess to pick
    s.handle(bob, { type: "team", team: 0 });
    assert.equal(last(host, "state").canStart, false);
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(last(host, "error").code, "NO_PLAYERS");
});

test("team play leader: the leader cannot guess; once the others answered, the leaders decide", () => {
    const { s, host, ida, eve, ana, bob, last } = leaderGame();
    s.handle(host, south(0));
    assert.equal(last(host, "error").code, "INVALID");
    [ida, ana, eve].forEach(conn => s.handle(conn, south(0)));
    assert.equal(s.phase, "round");
    s.handle(bob, south(0));
    assert.equal(last(host, "state").phase, "decide");
    assert.deepEqual(last(host, "decide"), { type: "decide", index: 0, deadline: s.now() + 20_000, teams: [0, 1] });
});

test("team play leader: the leader sees the team's guesses at once, and the whole team does while the leader decides", () => {
    const { s, host, max, ida, eve, all, last } = leaderGame();
    s.handle(ida, south(0));
    assert.deepEqual(last(host, "teamGuesses").guesses.map(g => g.name), ["Ida"]);
    assert.deepEqual([all(max, "teamGuesses"), all(eve, "teamGuesses")], [[], []]);
    s.handle(host, { type: "endRound" });
    // nobody in Red answered: the team has nothing to pick from, so only Hans decides
    assert.deepEqual(last(eve, "teamGuesses"), { type: "teamGuesses", index: 0, guesses: [] });
    assert.deepEqual(last(host, "decide").teams, [0]);
});

test("team play leader: each leader picks one guess of their own team; once all have, the reveal shows the picks", () => {
    const { s, host, max, ida, eve, all, last } = leaderGame();
    const id = (conn) => last(conn, "welcome").playerId;
    s.handle(ida, south(0));
    s.handle(eve, south(2 * ZONE));
    s.handle(host, { type: "endRound" });
    // not of the own team, not a leader, not this round
    s.handle(host, { type: "pick", index: 0, playerId: id(eve) });
    s.handle(ida, { type: "pick", index: 0, playerId: id(ida) });
    s.handle(host, { type: "pick", index: 1, playerId: id(ida) });
    assert.deepEqual([all(host, "error").length, all(ida, "error").length], [2, 1]);
    s.handle(host, { type: "pick", index: 0, playerId: id(ida) });
    assert.equal(last(eve, "state").players.find(p => p.name === "Hans").picked, true);
    // one pick per team
    s.handle(host, { type: "pick", index: 0, playerId: id(ida) });
    assert.equal(all(host, "error").length, 3);
    assert.equal(s.phase, "decide");
    s.handle(max, { type: "pick", index: 0, playerId: id(eve) });
    assert.deepEqual(last(eve, "reveal").teams, [
        { id: 0, points: 100, lat: -100, lng: 200, picked: id(ida), score: 100 },
        { id: 1, points: 0, lat: -100 - 2 * ZONE, lng: 200, picked: id(eve), score: 0 },
    ]);
});

test("team play leader: the decision ends after decide seconds; a team whose leader did not pick scores 0", () => {
    const { s, host, ida, eve, last, advance } = leaderGame();
    const idaId = last(ida, "welcome").playerId;
    s.handle(ida, south(0));
    s.handle(eve, south(0));
    s.handle(host, { type: "endRound" });
    s.handle(host, { type: "pick", index: 0, playerId: idaId });
    advance(20_000 + GRACE_MS - 1);
    s.tick();
    assert.equal(s.phase, "decide");
    advance(1);
    s.tick();
    assert.deepEqual(last(host, "reveal").teams.map(t => [t.id, t.points, t.lat, t.picked]), [[0, 100, -100, idaId], [1, 0, null, null]]);
});

test("team play leader: with no guess in any team there is nothing to decide", () => {
    const { s, host, last } = leaderGame();
    s.handle(host, { type: "endRound" });
    assert.equal(s.phase, "reveal");
    assert.equal(last(host, "decide"), undefined);
});

test("team play leader: a leader gone during the decision hands it to a teammate, who may pick their own guess", () => {
    const { s, host, max, ida, eve, all, last, advance } = leaderGame({ ...LEADER, decide: 60 });
    const id = (conn) => last(conn, "welcome").playerId;
    s.handle(ida, south(0));
    s.handle(eve, south(0));
    s.handle(host, { type: "endRound" });
    s.disconnect(max);
    advance(RECONNECT_MS);
    s.tick();
    assert.equal(s.phase, "decide");
    // Eve's page has to offer her the pick: she gets the decision again, after the state that makes her leader
    assert.equal(all(eve, "decide").length, 2);
    s.handle(eve, { type: "pick", index: 0, playerId: id(eve) });
    s.handle(host, { type: "pick", index: 0, playerId: id(ida) });
    assert.deepEqual(last(host, "reveal").teams.map(t => [t.id, t.picked]), [[0, id(ida)], [1, id(eve)]]);
});

test("team play leader: who comes back during the decision gets the round, the decision and the team's guesses", () => {
    const { s, host, ida, eve, last } = leaderGame();
    s.handle(ida, south(0));
    s.handle(eve, south(0));
    s.handle(host, { type: "endRound" });
    s.disconnect(ida);
    const phone = {};
    s.join(phone, { token: last(ida, "welcome").token });
    assert.equal(last(phone, "state").phase, "decide");
    assert.deepEqual([last(phone, "round").index, last(phone, "round").deadline], [0, null]);
    assert.equal(last(phone, "decide").index, 0);
    assert.deepEqual(last(phone, "teamGuesses").guesses.map(g => g.name), ["Ida"]);
});

test("team play leader: a leader who reloads before picking can still pick; one who picked cannot again", () => {
    const { s, host, ida, eve, all, last } = leaderGame();
    const idaId = last(ida, "welcome").playerId;
    s.handle(ida, south(0));
    s.handle(eve, south(0));
    s.handle(host, { type: "endRound" });
    s.disconnect(host);
    const reloaded = {};
    s.join(reloaded, { token: last(host, "welcome").token });
    s.handle(reloaded, { type: "pick", index: 0, playerId: idaId });
    assert.deepEqual(all(reloaded, "error"), []);
    s.handle(reloaded, { type: "pick", index: 0, playerId: idaId });
    assert.equal(last(reloaded, "error").code, "INVALID");
});

test("team play leader: images reported during the decision count for the next round", () => {
    const { s, host, max, ida, eve, last } = leaderGame();
    const id = (conn) => last(conn, "welcome").playerId;
    s.handle(ida, south(0));
    s.handle(eve, south(0));
    s.handle(host, { type: "endRound" });
    readyAll(s, 1);
    s.handle(host, { type: "pick", index: 0, playerId: id(ida) });
    s.handle(max, { type: "pick", index: 0, playerId: id(eve) });
    s.handle(host, { type: "next" });
    // nobody is waited for: everyone had round 2's images already
    assert.equal(s.phase, "round");
});

test("team play leader: who takes a team over because its leader left during the decision gets the decision, nobody else does again", () => {
    const { s, sent, host, max, ida, eve, all } = leaderGame({ ...LEADER, decide: 60 });
    s.handle(ida, south(0));
    s.handle(eve, south(0));
    s.handle(host, { type: "endRound" });
    s.handle(max, { type: "leave" });
    assert.deepEqual(sent.filter(x => x.conn === eve).slice(-3).map(x => x.msg.type), ["state", "teamGuesses", "decide"]);
    // Hans leads already and may be picking: a second decision would wipe his selection
    assert.equal(all(host, "decide").length, 1);
});
