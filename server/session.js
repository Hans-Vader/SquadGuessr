import { randomUUID, randomInt } from "node:crypto";
import { scoreAnswer, mapSize, penaltyPoints, MAX_PENALTY, centroid } from "../src/js/scoring.js";
import { cleanName, validSettings, validGuesses, validAnswer } from "./validate.js";

export const MAX_PLAYERS = 30;
export const MAX_WATCHERS = 20;
export const GRACE_MS = 1000;
export const RECONNECT_MS = 30 * 1000;
// how long a round waits for slow devices to load its images: the first one cold, later ones were preloaded
export const LOAD_FIRST_MS = 10 * 1000;
export const LOAD_MS = 5 * 1000;
// every start counts down so all devices load round 1 meanwhile; longer when not every guest is ready yet
export const COUNTDOWN_READY_MS = 5 * 1000;
export const COUNTDOWN_FORCED_MS = 15 * 1000;
// how long players back in the lobby wait for a host still on the results before one of them takes over
export const HANDOVER_MS = 30 * 1000;

const HOST_ACTIONS = ["settings", "start", "cancelStart", "endRound", "next", "kick", "promote", "shuffle"];

/**
 * One multiplayer session: lobby → loading → round → reveal → loading → … → final
 * The first loading is also the start countdown: round 1 never begins before `startsAt`.
 * Knows nothing about sockets: `send(conn, msg)` is injected and `conn` is opaque.
 * On every phase change `state` is sent before `prepare`/`round`/`reveal`/`final`.
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
        // with settings.next: when the reveal moves on by itself
        this.nextAt = null;
        this.loadUntil = null;
        this.startsAt = null;
        this.players = new Map();
        this.watchers = new Set();
        this.kicked = new Set();
        // team play: the score per team (index = team), and every round's team results (index = round)
        this.teamScores = [];
        this.teamRounds = [];
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
        if (token && this.kicked.has(token)) return this.error(conn, "KICKED");
        const known = token ? this.findPlayer(p => p.token === token) : null;
        if (known) return this.reconnect(known, conn);
        if (!this.joinable()) return this.error(conn, "GAME_RUNNING");
        const clean = cleanName(name);
        if (!clean) return this.error(conn, "INVALID");
        const same = this.findPlayer(p => p.name.toLowerCase() === clean.toLowerCase());
        if (same?.connected) return this.error(conn, "NAME_TAKEN");
        // someone who dropped out of the lobby may come back without their token (other device, other tab): same name, their place
        if (same) this.players.delete(same.id);
        if (this.players.size >= MAX_PLAYERS) return this.error(conn, "SESSION_FULL");
        const player = this.addPlayer(conn, clean);
        this.freshWait();
        if (same?.id === this.hostId) this.hostId = player.id;
        this.welcome(player);
        this.broadcastState();
        // joined during the countdown: round 1's images to load
        this.sendPhase(conn);
        return true;
    }

    watch(conn) {
        if (this.watchers.size >= MAX_WATCHERS) return this.error(conn, "SESSION_FULL");
        this.watchers.add(conn);
        this.send(conn, this.stateMsg());
        this.sendPhase(conn);
        return true;
    }

    /**
     * Tells a page whether its stored token still belongs to a game it can go back to (the REJOIN hint).
     * Connects nobody and changes nothing: the way back in is join with that token
     */
    check(conn, token) {
        const player = this.findPlayer(p => p.token === token);
        if (!player || this.over()) return this.error(conn, "SESSION_NOT_FOUND");
        this.send(conn, { type: "resumable", code: this.code, phase: this.phase, round: this.round, total: this.guesses.length || this.settings.rounds });
    }

    disconnect(conn) {
        this.touch();
        this.watchers.delete(conn);
        const player = this.playerByConn(conn);
        if (!player) return;
        // a dropped connection is mostly a reload, a locked phone or a network switch: the player keeps their place
        // (and for a moment still counts for the round and the host role) so they can come back with their token
        player.conn = null;
        player.connected = false;
        player.awayUntil = this.now() + RECONNECT_MS;
        this.broadcastState();
    }

    // ===== ACTIONS =====

    handle(conn, msg) {
        const player = this.playerByConn(conn);
        if (!player) return this.error(conn, "INVALID");
        this.touch();
        if (msg.type === "answer") return this.answer(player, msg);
        if (msg.type === "ready") return this.ready(player, msg.index);
        if (msg.type === "lobbyReady") return this.lobbyReady(player, msg.ready);
        if (msg.type === "team") return this.switchTeam(player, msg.team);
        if (msg.type === "leave") return this.leave(player);
        // after a game everyone leaves their results on their own
        if (msg.type === "lobby") return this.toLobby(player);
        if (!HOST_ACTIONS.includes(msg.type)) return this.error(conn, "INVALID");
        if (player.id !== this.hostId) return this.error(conn, "NOT_HOST");

        switch (msg.type) {
        case "settings": return this.updateSettings(conn, msg.settings);
        case "start": return this.start(conn, msg.guesses);
        case "cancelStart": return this.cancelStart(conn);
        case "endRound": return this.phase === "round" && this.deadline === null ? this.endRound() : this.error(conn, "INVALID");
        // with settings.next the countdown alone moves on
        case "next": return this.settings.next ? this.error(conn, "INVALID") : this.next(conn);
        case "kick": return this.kick(conn, msg.playerId);
        case "promote": return this.promote(conn, msg.playerId);
        case "shuffle": return this.shuffle(conn);
        }
    }

    /**
     * Lobby only, and no ban: whoever is kicked can come back through the invite link, just not with their old token
     */
    kick(conn, playerId) {
        if (this.phase !== "lobby" || playerId === this.hostId) return this.error(conn, "INVALID");
        const player = this.players.get(playerId);
        // already gone (double click, left at the same moment): nothing to do
        if (!player) return;
        // someone offline right now never gets the message: their reconnect with the old token is turned away instead
        this.kicked.add(player.token);
        this.error(player.conn, "KICKED");
        this.leave(player);
    }

    /**
     * Lobby only: the host hands the role to someone who is there, and is a guest from then on
     */
    promote(conn, playerId) {
        if (this.phase !== "lobby" || playerId === this.hostId) return this.error(conn, "INVALID");
        const player = this.players.get(playerId);
        // gone, offline or still on the results (left or dropped out while the host confirmed): nothing to do,
        // the role would only move on again at once
        if (!player?.connected || player.backAt === null) return;
        this.hostId = player.id;
        this.broadcastState();
    }

    /**
     * A player moves to another team. Ignored silently outside the lobby: a click just as the host starts is normal
     */
    switchTeam(player, team) {
        if (this.phase !== "lobby") return;
        if (!Number.isInteger(team) || team < 0 || team >= this.teamSizes().length) return this.error(player.conn, "INVALID");
        if (player.team === team) return;
        player.team = team;
        this.broadcastState();
    }

    /**
     * Lobby only: the host deals everyone out at random, one after another to each team, so the teams differ by one at most
     */
    shuffle(conn) {
        if (this.phase !== "lobby" || !this.settings.team) return this.error(conn, "INVALID");
        const players = [...this.players.values()];
        for (let i = players.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [players[i], players[j]] = [players[j], players[i]];
        }
        players.forEach((p, i) => { p.team = i % this.settings.teams; });
        this.broadcastState();
    }

    updateSettings(conn, settings) {
        if (this.phase !== "lobby" || !validSettings(settings)) return this.error(conn, "INVALID");
        const before = JSON.stringify(this.settings);
        this.settings = pickSettings(settings);
        // fewer teams: the players of the dropped ones go to the smallest teams left
        if (this.settings.team) this.players.forEach(p => { if (p.team >= this.settings.teams) p.team = this.smallestTeam(); });
        // a ready was for the old settings: the guests confirm the new ones again
        const unready = JSON.stringify(this.settings) === before ? [] : [...this.players.values()].filter(p => p.lobbyReady);
        unready.forEach(p => { p.lobbyReady = false; });
        this.broadcastState();
        unready.forEach(p => { if (p.conn) this.send(p.conn, { type: "unready" }); });
    }

    start(conn, guesses) {
        if (this.phase !== "lobby" || !validGuesses(guesses, this.settings.rounds)) {
            return this.error(conn, "INVALID");
        }
        if (!this.canStart()) return this.error(conn, "NO_PLAYERS");
        this.guesses = guesses.map(g => ({ map: g.map, url: g.url, lat: g.lat, lng: g.lng, submitter: g.submitter ?? null }));
        this.resetScores();
        this.round = 0;
        // whoever was still on the results is taken along: a start called off brings them to the lobby too
        this.players.forEach(p => { p.backAt ??= this.now(); });
        this.startsAt = this.now() + (this.allReady() ? COUNTDOWN_READY_MS : COUNTDOWN_FORCED_MS);
        this.load();
    }

    /**
     * Calls a start off as long as round 1 has not begun: back to the lobby, who was ready stays ready
     */
    cancelStart(conn) {
        if (this.phase !== "loading" || this.round !== 0) return this.error(conn, "INVALID");
        this.phase = "lobby";
        this.guesses = [];
        this.startsAt = null;
        this.loadUntil = null;
        this.resetScores();
        this.broadcastState();
    }

    /**
     * Holds the round back until every connected player has its images (or the time is up), so all see it at once
     */
    load() {
        this.phase = "loading";
        // round 1 loads cold, and not before its countdown ends; later rounds were preloaded during the previous one
        this.loadUntil = this.round === 0 ? Math.max(this.startsAt, this.now() + LOAD_FIRST_MS) : this.now() + LOAD_MS;
        // the usual case from the second round on: everyone preloaded it during the previous round
        if (this.startsAt === null && this.lateLoaders().length === 0) return this.startRound();
        this.broadcastState();
        this.broadcast(this.prepareMsg(this.round));
    }

    /**
     * Who the loading round waits for: watchers never count, nor does a player whose connection is gone
     */
    lateLoaders() {
        return [...this.players.values()].filter(p => p.connected && !p.stalled && p.ready < this.round);
    }

    /**
     * Every connected guest said they are ready; the host's START is their ready
     */
    allReady() {
        return [...this.players.values()].every(p => !p.connected || p.id === this.hostId || p.lobbyReady);
    }

    /**
     * Round 1 has not begun (lobby or its start countdown): players come and go like in the lobby
     */
    joinable() {
        return this.phase === "lobby" || (this.phase === "loading" && this.round === 0);
    }

    /**
     * The final, or already the last reveal: players see their results there without waiting for the host's "next"
     */
    over() {
        return this.phase === "final" || (this.phase === "reveal" && this.round + 1 === this.guesses.length);
    }

    /**
     * Somebody to play against: at least one other player is connected (a watcher does not count), and in team play
     * at least two teams have somebody there
     */
    canStart() {
        const others = Boolean(this.findPlayer(p => p.connected && p.id !== this.hostId));
        return others && (!this.settings.team || this.teamSizes(p => p.connected).filter(n => n > 0).length >= 2);
    }

    checkLoaded() {
        // the countdown runs out first, however early everyone has their images
        if (this.startsAt !== null && this.now() < this.startsAt) return;
        // with nobody connected the clock must not start: whoever comes back is waited for until loadUntil
        if (!this.findPlayer(p => p.connected)) return;
        const late = this.lateLoaders();
        if (late.length > 0 && this.now() < this.loadUntil) return;
        // a phone locked with its socket still open would hold up every round: not waited for until it reports back
        late.forEach(p => { p.stalled = true; });
        this.startRound();
    }

    /**
     * A client has the images of round `index`. Never answered with an error: duplicates and late ones are normal
     */
    ready(player, index) {
        if (!["loading", "round", "reveal"].includes(this.phase) || !Number.isInteger(index)) return;
        // while loading only the waited-for round, otherwise the running one or the announced next one: a ready
        // left over from an earlier game falls outside and cannot mark a whole new game as loaded
        const newest = this.phase === "loading" ? this.round : this.round + 1;
        if (index < this.round || index > newest || index >= this.guesses.length) return;
        const changed = player.stalled || player.ready < index;
        player.ready = Math.max(player.ready, index);
        player.stalled = false;
        if (this.phase !== "loading" || !changed) return;
        this.checkLoaded();
        if (this.phase === "loading") this.broadcastState();
    }

    /**
     * A guest is ready (or not any more). Ignored silently outside the lobby: a click just as the host starts is normal
     */
    lobbyReady(player, ready) {
        if (this.phase !== "lobby" || typeof ready !== "boolean" || player.lobbyReady === ready) return;
        player.lobbyReady = ready;
        this.broadcastState();
    }

    startRound() {
        this.startsAt = null;
        this.phase = "round";
        this.deadline = this.settings.timer > 0 ? this.now() + this.settings.timer * 1000 : null;
        this.broadcastState();
        this.broadcast(this.roundMsg());
        // the next round's images load while this one is played
        if (this.round + 1 < this.guesses.length) this.broadcast(this.prepareMsg(this.round + 1));
    }

    answer(player, msg) {
        // the index pins a late answer to its own round instead of the one currently running
        if (this.phase !== "round" || msg.index !== this.round || player.answers[this.round] || !validAnswer(msg, this.settings.mode)) {
            return this.error(player.conn, "INVALID");
        }
        const size = mapSize(this.guesses[this.round].map);
        // kept on the map like the client's marker: absurd coordinates would break the reveal on every screen
        const answer = this.settings.mode === "classic"
            ? { lat: clamp(msg.lat, -size, 0), lng: clamp(msg.lng, 0, size), mapName: null }
            : { lat: null, lng: null, mapName: msg.mapName };
        const scored = scoreAnswer(this.settings.mode, this.guesses[this.round], answer);
        // Average with minus points: beyond the last scoring step a guess costs the team points
        if (this.settings.team === "average" && this.settings.penalty) scored.points += penaltyPoints(scored.distance, size);
        player.answers[this.round] = { ...answer, ...scored };
        this.broadcastState();
        this.sendTeamGuesses(player.team);
        this.checkRoundEnd();
    }

    /**
     * Explicit "leave": in the lobby it frees name and slot for good, and the others are told who left. From the start
     * countdown on the player stays in the ranking, offline, and can come back with their token (the REJOIN hint).
     * Unlike a dropped connection it takes effect at once: a leaving host hands the role over right away.
     */
    leave(player) {
        if (this.phase === "lobby") {
            this.players.delete(player.id);
            // a kick is the host's own doing (kick() bans the token before it gets here): no notice for that
            if (!this.kicked.has(player.token)) this.broadcast({ type: "left", name: player.name });
        } else {
            player.conn = null;
            player.connected = false;
            player.awayUntil = 0;
        }
        this.fixHost();
        this.broadcastState();
        this.checkRoundEnd();
    }

    checkRoundEnd() {
        if (this.phase === "loading") return this.checkLoaded();
        if (this.phase !== "round") return;
        const waiting = [...this.players.values()].some(p => this.isPresent(p) && !p.answers[this.round]);
        if (!waiting) this.endRound();
    }

    endRound() {
        // with minus points giving no answer must never beat a bad guess; whoever is gone for good is not counted (teamResult)
        const missed = this.settings.team === "average" && this.settings.penalty ? -MAX_PENALTY : 0;
        this.players.forEach(p => {
            if (!p.answers[this.round]) p.answers[this.round] = { lat: null, lng: null, mapName: null, distance: null, points: this.isPresent(p) ? missed : 0 };
        });
        this.reveal();
    }

    reveal() {
        this.phase = "reveal";
        this.deadline = null;
        this.nextAt = this.settings.next ? this.now() + this.settings.next * 1000 : null;
        this.players.forEach(p => { p.score += p.answers[this.round].points; });
        if (this.settings.team) {
            this.teamRounds[this.round] = this.teamsInPlay().map(team => this.teamResult(team));
            this.teamRounds[this.round].forEach(r => { this.teamScores[r.id] = (this.teamScores[r.id] ?? 0) + r.points; });
        }
        this.broadcastState();
        this.broadcast(this.revealMsg());
    }

    /**
     * A team's result this round: its points, and the point it played (none in Average)
     */
    teamResult(team) {
        const members = this.members(team);
        if (this.settings.team === "average") {
            // whoever is gone for good does not drag the team down; whoever is there and gave no answer does
            const counted = members.filter(p => this.guessOf(p) || this.isPresent(p));
            const sum = counted.reduce((total, p) => total + p.answers[this.round].points, 0);
            // || 0: an average just below 0 would round to -0
            const points = counted.length ? Math.round(sum / counted.length) || 0 : 0;
            return { id: team, points, lat: null, lng: null, picked: null };
        }
        const at = this.teamPoint(members);
        const points = at ? scoreAnswer("classic", this.guesses[this.round], at).points : 0;
        return { id: team, points, lat: at?.lat ?? null, lng: at?.lng ?? null, picked: null };
    }

    /**
     * The point a team plays: the midpoint of its guesses, null without one
     */
    teamPoint(members) {
        const guesses = members.map(p => this.guessOf(p)).filter(Boolean);
        return guesses.length ? centroid(guesses) : null;
    }

    next(conn) {
        if (this.phase !== "reveal") return this.error(conn, "INVALID");
        this.nextAt = null;
        if (this.round + 1 < this.guesses.length) {
            this.round++;
            return this.load();
        }
        this.phase = "final";
        this.broadcastState();
        this.broadcast(this.finalMsg());
    }

    /**
     * The first player done with the results takes the session back to the lobby; the others follow when they are done
     */
    toLobby(player) {
        if (this.phase === "lobby") {
            // a double click is normal
            if (player.backAt !== null) return;
            player.backAt = this.now();
            return this.broadcastState();
        }
        // also from the last reveal: players see their results there without waiting for the host's "next"
        if (!this.over()) return this.error(player.conn, "INVALID");
        this.phase = "lobby";
        this.guesses = [];
        this.round = 0;
        this.nextAt = null;
        // whoever left or dropped out during the game does not haunt the next one (coming back simply joins again)
        this.players.forEach(p => { if (!p.connected) this.players.delete(p.id); });
        // the next game asks everyone again
        this.players.forEach(p => { p.lobbyReady = false; p.backAt = null; });
        player.backAt = this.now();
        this.resetScores();
        this.broadcastState();
    }

    tick() {
        if (this.fixHost()) this.broadcastState();
        if (this.phase === "round" && this.deadline !== null && this.now() >= this.deadline + GRACE_MS) return this.endRound();
        if (this.phase === "reveal" && this.nextAt !== null && this.now() >= this.nextAt) return this.next();
        // someone who dropped out and did not come back in time stops holding up the round
        this.checkRoundEnd();
    }

    /**
     * Once the host left, has been gone for longer than a reload takes, or is still on the results while somebody has
     * waited in the lobby for HANDOVER_MS, a connected player takes over: whoever came back to the lobby first;
     * with nobody connected the role waits for whoever comes (back) first. True if the host changed.
     */
    fixHost() {
        const host = this.players.get(this.hostId);
        const waited = p => p.connected && p.backAt !== null && this.now() - p.backAt >= HANDOVER_MS;
        const late = this.phase === "lobby" && host?.backAt === null && Boolean(this.findPlayer(waited));
        if (host && this.isPresent(host) && !late) return false;
        const connected = [...this.players.values()].filter(p => p.connected);
        const next = connected.filter(p => p.backAt !== null).sort((a, b) => a.backAt - b.backAt)[0] ?? connected[0];
        if (!next) return false;
        this.hostId = next.id;
        return true;
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
            startsAt: this.startsAt,
            nextAt: this.nextAt,
            // the host's START: green once everyone is ready, locked while nobody else is there
            allReady: this.allReady(),
            canStart: this.canStart(),
            // team play: the score in the corner is the team's
            ...(this.settings.team && { teamScores: this.teamScores }),
            players: [...this.players.values()].map(p => ({
                id: p.id,
                name: p.name,
                connected: p.connected,
                score: p.score,
                answered: this.phase === "round" && Boolean(p.answers[this.round]),
                ready: this.phase === "loading" && p.ready >= this.round,
                stalled: p.stalled,
                lobbyReady: p.lobbyReady,
                // false while still on the results of the last game
                back: p.backAt !== null,
                team: p.team,
            })),
        };
    }

    /**
     * What a client needs to show or preload round i: never the solution, and in mapFinder not the map (it is the answer)
     */
    assets(i) {
        const g = this.guesses[i];
        return { index: i, url: g.url, map: this.settings.mode === "classic" ? g.map : null };
    }

    roundMsg() {
        const g = this.guesses[this.round];
        return { type: "round", ...this.assets(this.round), total: this.guesses.length, submitter: g.submitter, deadline: this.deadline };
    }

    prepareMsg(i) {
        return { type: "prepare", ...this.assets(i) };
    }

    revealMsg() {
        const g = this.guesses[this.round];
        const results = [...this.players.values()]
            .map(p => ({ id: p.id, name: p.name, score: p.score, ...(this.settings.team && { team: p.team }), ...p.answers[this.round] }))
            .sort((a, b) => b.score - a.score);
        const msg = {
            type: "reveal",
            index: this.round,
            total: this.guesses.length,
            solution: { map: g.map, url: g.url, lat: g.lat, lng: g.lng },
            results,
        };
        if (!this.settings.team) return msg;
        const teams = this.teamRounds[this.round].map(r => ({ ...r, score: this.teamScores[r.id] })).sort((a, b) => b.score - a.score);
        return { ...msg, teams };
    }

    finalMsg() {
        // team play ranks the teams, with who played in them
        const rows = this.settings.team
            ? this.teamsInPlay().map(team => ({ id: team, score: this.teamScores[team] ?? 0, members: this.members(team).map(p => p.name) }))
            : [...this.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score }));
        const ranking = rows.sort((a, b) => b.score - a.score);
        const top = ranking[0]?.score;
        return { type: "final", ranking, winners: ranking.filter(r => r.score === top).map(r => r.id) };
    }

    /**
     * Shows a team its own guesses of the running round, to whoever of it may see them (seesTeam): positions only,
     * since points or a distance would give the solution away. Never to other teams or watchers
     */
    sendTeamGuesses(team) {
        if (!this.settings.team || this.phase !== "round") return;
        const members = this.members(team);
        const guesses = members.filter(p => this.guessOf(p)).map(p => ({ id: p.id, name: p.name, lat: p.answers[this.round].lat, lng: p.answers[this.round].lng }));
        const msg = { type: "teamGuesses", index: this.round, guesses };
        members.filter(p => p.conn && this.seesTeam(p)).forEach(p => this.send(p.conn, msg));
    }

    /**
     * Who of a team sees its guesses: whoever answered already, so nobody copies
     */
    seesTeam(p) {
        return Boolean(p.answers[this.round]);
    }

    // ===== HELPERS =====

    /**
     * A player's guess on the map this round, null without one (no answer yet, none in time)
     */
    guessOf(p) {
        const answer = p.answers[this.round];
        return answer && answer.lat !== null ? answer : null;
    }

    /**
     * A team's players, in the order they joined
     */
    members(team) {
        return [...this.players.values()].filter(p => p.team === team);
    }

    /**
     * The teams that have players, in team order
     */
    teamsInPlay() {
        return [...new Set([...this.players.values()].map(p => p.team))].sort((a, b) => a - b);
    }

    /**
     * Players per team (index = team), counting only those `counted` accepts. Without team play there are 2 teams:
     * everybody still has one, so switching team play on finds them dealt out already
     */
    teamSizes(counted = () => true) {
        const sizes = Array(this.settings.teams ?? 2).fill(0);
        this.players.forEach(p => { if (counted(p) && p.team < sizes.length) sizes[p.team]++; });
        return sizes;
    }

    /**
     * Where a newcomer goes: the team with the fewest players, the lowest one on a tie. Once START was pressed only
     * teams that already have players are filled up, so nobody ends up alone in a team of their own
     */
    smallestTeam() {
        const sizes = this.teamSizes();
        const open = sizes.map((n, team) => team).filter(team => this.phase === "lobby" || sizes[team] > 0);
        return open.reduce((best, team) => (sizes[team] < sizes[best] ? team : best), open[0] ?? 0);
    }

    addPlayer(conn, name) {
        const player = { id: randomUUID(), token: randomUUID(), name, conn, connected: true, awayUntil: 0, score: 0, answers: [], ready: -1, stalled: false, lobbyReady: false, backAt: this.now(), team: this.smallestTeam() };
        this.players.set(player.id, player);
        return player;
    }

    reconnect(player, conn) {
        // same token from another tab or device: the old connection is told instead of silently going deaf
        if (player.conn && player.conn !== conn) this.error(player.conn, "REPLACED");
        player.conn = conn;
        player.connected = true;
        // a reload loses the preloaded images: the client reports them again for the prepare that sendPhase resends
        player.ready = Math.min(player.ready, this.round - 1);
        player.stalled = false;
        this.freshWait();
        this.welcome(player);
        this.broadcastState();
        this.sendPhase(conn);
        this.sendTeamGuesses(player.team);
        return true;
    }

    /**
     * Everyone was away when loadUntil passed: whoever comes (back) first gets a fresh wait, not a clock that starts at once
     */
    freshWait() {
        if (this.phase === "loading" && this.now() >= this.loadUntil) this.loadUntil = this.now() + LOAD_MS;
    }

    sendPhase(conn) {
        if (this.phase === "loading") this.send(conn, this.prepareMsg(this.round));
        if (this.phase === "round") this.send(conn, this.roundMsg());
        if (this.phase === "reveal") this.send(conn, this.revealMsg());
        if (this.phase === "final") this.send(conn, this.finalMsg());
        if (["round", "reveal"].includes(this.phase) && this.round + 1 < this.guesses.length) {
            this.send(conn, this.prepareMsg(this.round + 1));
        }
    }

    welcome(player) {
        this.send(player.conn, { type: "welcome", playerId: player.id, token: player.token, code: this.code, isHost: player.id === this.hostId });
    }

    resetScores() {
        this.players.forEach(p => { p.score = 0; p.answers = []; p.ready = -1; p.stalled = false; });
        this.teamScores = [];
        this.teamRounds = [];
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

    /**
     * Connected, or dropped a moment ago and probably reconnecting
     */
    isPresent(player) {
        return player.connected || this.now() < player.awayUntil;
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

function pickSettings({ mode, timer, rounds, next = 0, team = "off", teams = 2, penalty = false }) {
    // without teams the settings stay what they were before team play: older clients and the plain game see no change
    if (team === "off") return { mode, timer, rounds, next };
    return { mode, timer, rounds, next, team, teams, penalty };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
