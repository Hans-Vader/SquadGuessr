import { randomUUID } from "node:crypto";
import { scoreAnswer } from "../src/js/scoring.js";
import { cleanName, validSettings, validGuesses, validAnswer } from "./validate.js";

export const MAX_PLAYERS = 12;
export const MAX_WATCHERS = 20;
export const GRACE_MS = 1000;

const HOST_ACTIONS = ["settings", "start", "endRound", "next", "lobby"];

/**
 * One multiplayer session: lobby → round → reveal → … → final
 * Knows nothing about sockets: `send(conn, msg)` is injected and `conn` is opaque.
 * On every phase change `state` is sent before `round`/`reveal`/`final`.
 */
export class Session {
    constructor(code, { send, now = Date.now }) {
        this.code = code;
        this.send = send;
        this.now = now;
        this.hostId = null;
        this.settings = null;
        this.guesses = [];
        this.phase = "lobby";
        this.round = 0;
        this.deadline = null;
        this.players = new Map();
        this.watchers = new Set();
        this.lastActivity = now();
    }

    // ===== ENTRY =====

    create(conn, { name, settings }) {
        const clean = cleanName(name);
        if (!clean || !validSettings(settings)) return this.error(conn, "INVALID");
        this.settings = pickSettings(settings);
        const player = this.addPlayer(conn, clean);
        this.hostId = player.id;
        this.welcome(player);
        this.broadcastState();
        return true;
    }

    join(conn, { name, token }) {
        this.touch();
        const known = token ? this.findPlayer(p => p.token === token) : null;
        if (known) return this.reconnect(known, conn);
        if (this.phase !== "lobby") return this.error(conn, "GAME_RUNNING");
        if (this.players.size >= MAX_PLAYERS) return this.error(conn, "SESSION_FULL");
        const clean = cleanName(name);
        if (!clean) return this.error(conn, "INVALID");
        if (this.findPlayer(p => p.name.toLowerCase() === clean.toLowerCase())) return this.error(conn, "NAME_TAKEN");
        const player = this.addPlayer(conn, clean);
        this.welcome(player);
        this.broadcastState();
        return true;
    }

    watch(conn) {
        if (this.watchers.size >= MAX_WATCHERS) return this.error(conn, "SESSION_FULL");
        this.watchers.add(conn);
        this.send(conn, this.stateMsg());
        this.sendPhase(conn);
        return true;
    }

    disconnect(conn) {
        this.touch();
        this.watchers.delete(conn);
        const player = this.playerByConn(conn);
        if (!player) return;
        // in the lobby a vanished guest just frees name and slot (they can simply join again);
        // the host and anyone in a running game stay, so they can come back with their token
        if (this.phase === "lobby" && player.id !== this.hostId) {
            this.players.delete(player.id);
        } else {
            player.conn = null;
            player.connected = false;
        }
        this.broadcastState();
        this.checkRoundEnd();
    }

    // ===== ACTIONS =====

    handle(conn, msg) {
        const player = this.playerByConn(conn);
        if (!player) return this.error(conn, "INVALID");
        this.touch();
        if (msg.type === "answer") return this.answer(player, msg);
        if (msg.type === "leave") return this.leave(player);
        if (!HOST_ACTIONS.includes(msg.type)) return this.error(conn, "INVALID");
        if (player.id !== this.hostId) return this.error(conn, "NOT_HOST");

        switch (msg.type) {
        case "settings": return this.updateSettings(conn, msg.settings);
        case "start": return this.start(conn, msg.guesses);
        case "endRound": return this.phase === "round" && this.deadline === null ? this.endRound() : this.error(conn, "INVALID");
        case "next": return this.next(conn);
        case "lobby": return this.toLobby(conn);
        }
    }

    updateSettings(conn, settings) {
        if (this.phase !== "lobby" || !validSettings(settings)) return this.error(conn, "INVALID");
        this.settings = pickSettings(settings);
        this.broadcastState();
    }

    start(conn, guesses) {
        if (!["lobby", "final"].includes(this.phase) || !validGuesses(guesses, this.settings.rounds)) {
            return this.error(conn, "INVALID");
        }
        this.guesses = guesses.map(g => ({ map: g.map, url: g.url, lat: g.lat, lng: g.lng, submitter: g.submitter ?? null }));
        this.resetScores();
        this.round = 0;
        this.startRound();
    }

    startRound() {
        this.phase = "round";
        this.deadline = this.settings.timer > 0 ? this.now() + this.settings.timer * 1000 : null;
        this.broadcastState();
        this.broadcast(this.roundMsg());
    }

    answer(player, msg) {
        // the index pins a late answer to its own round instead of the one currently running
        if (this.phase !== "round" || msg.index !== this.round || player.answers[this.round] || !validAnswer(msg, this.settings.mode)) {
            return this.error(player.conn, "INVALID");
        }
        const answer = this.settings.mode === "classic"
            ? { lat: msg.lat, lng: msg.lng, mapName: null }
            : { lat: null, lng: null, mapName: msg.mapName };
        player.answers[this.round] = { ...answer, ...scoreAnswer(this.settings.mode, this.guesses[this.round], answer) };
        this.broadcastState();
        this.checkRoundEnd();
    }

    /**
     * Explicit "leave": frees name and slot in the lobby; during a game the player stays in the ranking, offline.
     * A leaving host hands the role to the next connected player, otherwise nobody could continue the game.
     */
    leave(player) {
        if (player.id === this.hostId) {
            this.hostId = this.findPlayer(p => p.connected && p.id !== player.id)?.id ?? null;
        }
        if (this.phase === "lobby") {
            this.players.delete(player.id);
        } else {
            player.conn = null;
            player.connected = false;
        }
        this.broadcastState();
        this.checkRoundEnd();
    }

    checkRoundEnd() {
        if (this.phase !== "round") return;
        const waiting = [...this.players.values()].some(p => p.connected && !p.answers[this.round]);
        if (!waiting) this.endRound();
    }

    endRound() {
        this.phase = "reveal";
        this.deadline = null;
        this.players.forEach(p => {
            if (!p.answers[this.round]) p.answers[this.round] = { lat: null, lng: null, mapName: null, distance: null, points: 0 };
            p.score += p.answers[this.round].points;
        });
        this.broadcastState();
        this.broadcast(this.revealMsg());
    }

    next(conn) {
        if (this.phase !== "reveal") return this.error(conn, "INVALID");
        if (this.round + 1 < this.guesses.length) {
            this.round++;
            return this.startRound();
        }
        this.phase = "final";
        this.broadcastState();
        this.broadcast(this.finalMsg());
    }

    toLobby(conn) {
        if (this.phase !== "final") return this.error(conn, "INVALID");
        this.phase = "lobby";
        this.guesses = [];
        this.round = 0;
        this.resetScores();
        this.broadcastState();
    }

    tick() {
        if (this.phase === "round" && this.deadline !== null && this.now() >= this.deadline + GRACE_MS) this.endRound();
    }

    /**
     * Only a session nobody is connected to can go idle
     */
    isIdle(ms) {
        if (this.watchers.size > 0 || this.findPlayer(p => p.connected)) return false;
        return this.now() - this.lastActivity > ms;
    }

    // ===== MESSAGES =====

    stateMsg() {
        return {
            type: "state",
            code: this.code,
            phase: this.phase,
            settings: this.settings,
            hostId: this.hostId,
            round: this.round,
            total: this.guesses.length || this.settings.rounds,
            players: [...this.players.values()].map(p => ({
                id: p.id,
                name: p.name,
                connected: p.connected,
                score: p.score,
                answered: this.phase === "round" && Boolean(p.answers[this.round]),
            })),
        };
    }

    roundMsg() {
        const g = this.guesses[this.round];
        return {
            type: "round",
            index: this.round,
            total: this.guesses.length,
            url: g.url,
            submitter: g.submitter,
            deadline: this.deadline,
            map: this.settings.mode === "classic" ? g.map : null,
        };
    }

    revealMsg() {
        const g = this.guesses[this.round];
        const results = [...this.players.values()]
            .map(p => ({ id: p.id, name: p.name, score: p.score, ...p.answers[this.round] }))
            .sort((a, b) => b.score - a.score);
        return {
            type: "reveal",
            index: this.round,
            total: this.guesses.length,
            solution: { map: g.map, url: g.url, lat: g.lat, lng: g.lng },
            results,
        };
    }

    finalMsg() {
        const ranking = [...this.players.values()]
            .map(p => ({ id: p.id, name: p.name, score: p.score }))
            .sort((a, b) => b.score - a.score);
        const top = ranking[0]?.score;
        return { type: "final", ranking, winners: ranking.filter(r => r.score === top).map(r => r.id) };
    }

    // ===== HELPERS =====

    addPlayer(conn, name) {
        const player = { id: randomUUID(), token: randomUUID(), name, conn, connected: true, score: 0, answers: [] };
        this.players.set(player.id, player);
        return player;
    }

    reconnect(player, conn) {
        player.conn = conn;
        player.connected = true;
        this.welcome(player);
        this.broadcastState();
        this.sendPhase(conn);
        return true;
    }

    sendPhase(conn) {
        if (this.phase === "round") this.send(conn, this.roundMsg());
        if (this.phase === "reveal") this.send(conn, this.revealMsg());
        if (this.phase === "final") this.send(conn, this.finalMsg());
    }

    welcome(player) {
        this.send(player.conn, { type: "welcome", playerId: player.id, token: player.token, code: this.code, isHost: player.id === this.hostId });
    }

    resetScores() {
        this.players.forEach(p => { p.score = 0; p.answers = []; });
    }

    broadcastState() {
        this.broadcast(this.stateMsg());
    }

    broadcast(msg) {
        this.players.forEach(p => { if (p.conn) this.send(p.conn, msg); });
        this.watchers.forEach(conn => this.send(conn, msg));
    }

    error(conn, code) {
        if (conn) this.send(conn, { type: "error", code });
        return false;
    }

    playerByConn(conn) {
        return this.findPlayer(p => p.conn === conn);
    }

    findPlayer(predicate) {
        return [...this.players.values()].find(predicate);
    }

    touch() {
        this.lastActivity = this.now();
    }
}

// clients from before map exclusion send no `excluded`
function pickSettings({ mode, timer, rounds, excluded = [] }) {
    return { mode, timer, rounds, excluded };
}
