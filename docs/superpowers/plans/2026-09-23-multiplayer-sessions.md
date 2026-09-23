# Multiplayer-Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mehrere Spieler treten per Smartphone einer SquadGuessr-Session bei, spielen synchron eine vom Host festgelegte Anzahl Guesses und sehen am Ende einen Gewinner; optional schaut ein Beamer per `?watch=CODE` zu.

**Architecture:** Ein kleiner, autoritativer Node-WebSocket-Server (`server/`, Bibliothek `ws`) hält Sessions im Speicher und berechnet Punkte mit einem gemeinsamen Modul `src/js/scoring.js`, das auch der Browser nutzt. Im Client steuert `src/js/multiplayer.js` (als `App.mp`) Lobby, Runden, Auflösung und Endstand und verwendet dafür den vorhandenen Spiel-Screen mit wenigen Einhängepunkten in `squadGuessr.js`.

**Tech Stack:** Node ≥ 18 (ESM, `node:test`), `ws` 8, Webpack 5, jQuery, Leaflet 2 (alpha), i18next, `qrcode`; Hosting mit Docker Compose (`node:20-alpine`, `nginx:1.27-alpine`) hinter dem bestehenden TLS-Reverse-Proxy des VPS.

**Spec:** `docs/superpowers/specs/2026-09-23-multiplayer-session-design.md`

## Global Constraints

- Keine Co-Authored-By- oder andere AI-Attribution in Commit-Messages (globale Nutzer-Anweisung). Subagents ausdrücklich darauf hinweisen.
- WebSocket-Pfad `/mp`, Port aus `MP_PORT` (Default `3001`). Nicht `/ws` – den belegt der webpack-dev-server.
- Session-Code: 4 Zeichen aus `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- Erlaubte Settings: `mode` ∈ `classic | mapFinder`, `timer` ∈ `0 | 15 | 60` (Zahl, nicht String), `rounds` ∈ `3 | 5 | 10`.
- Grenzen: `maxPayload` 64 KB, Name 1–20 Zeichen, max. 12 Spieler, max. 20 Watcher, Submitter/MapName ≤ 40 Zeichen, URL ≤ 200 Zeichen und beginnt mit `/img/`.
- Rundenende-Puffer: `deadline + 1000 ms`. Sessions werden nach 30 min Inaktivität gelöscht. Heartbeat-Ping alle 30 s.
- Spielernamen und Submitter werden im Client **nur** per `.text()`/`textContent` ausgegeben, nie per `.html()`/`innerHTML`.
- Codestil wie im Repo: 4 Spaces, doppelte Anführungszeichen, Semikolons, ESM. Kein `??=` (jshint `esversion: 11` kennt es nicht), keine Regex-Unicode-Property-Escapes.
- Der Singleplayer muss sich unverändert verhalten.
- Neue Texte nur in `src/i18n/en.json` unter `mp`; `zh.json` bleibt unverändert (i18next `fallbackLng: "en"`).
- Docker: nur der `web`-Container veröffentlicht einen Port (`${WEB_BIND:-127.0.0.1}:${WEB_PORT:-8080}`); `mp` ist nur im Compose-Netz erreichbar und läuft als User `node`. TLS macht der bestehende Reverse-Proxy, nicht Compose.

## Review Focus

1. **Handy wird entsperrt, nachdem die Runde bereits aufgelöst wurde** → der Spieler sieht die Auflösung dieser Runde (Bild, Lösung, Rangliste), nicht die alte Runde und auch keinen leeren Screen. Getestet in Task 3 („reconnect during reveal gets reveal“), Client in Task 6 (`onReveal` mit `fresh`).
2. **Antwort trifft nach der Deadline, aber innerhalb des 1-s-Puffers ein** → sie zählt. **Antwort nach dem Reveal** → wird mit `INVALID` abgelehnt und nicht in die nächste Runde übernommen. Getestet in Task 3.
3. **Namen, die sich nur in Groß-/Kleinschreibung, Leerzeichen oder Steuerzeichen unterscheiden** („Max“ vs. „ max\u0007“) → `NAME_TAKEN`. **HTML im Namen** (`<img src=x onerror=alert(1)>`) erscheint als Text. Getestet in Task 2 und 3, manuell in Task 8.
4. **Host lädt die Seite mitten im Spiel neu (F5)** → er kommt über `?join=CODE` und den gespeicherten Token automatisch zurück, bleibt Host und behält seine Punkte. Getestet in Task 3 („host reconnect keeps host role“), manuell in Task 8.
5. **Server-Neustart während einer Session** → die Clients zeigen „Session not found“ und landen im Menü, statt endlos neu zu verbinden. Client-Logik in Task 5 (`onError`), manuell in Task 8.

---

## File Structure

| Datei | Neu/Ändern | Verantwortung |
|---|---|---|
| `src/js/scoring.js` | neu | Punkte, Distanz, Levenshtein, Kartengröße, `scoreAnswer` – geteilt von Client und Server |
| `server/validate.js` | neu | Validierung aller Client-Eingaben |
| `server/session.js` | neu | Session-Zustandsmaschine ohne Netzwerk |
| `server/index.js` | neu | `ws`-Server, Code-Vergabe, Tick, Heartbeat, Aufräumen |
| `server/scoring.test.js`, `server/validate.test.js`, `server/session.test.js`, `server/index.test.js` | neu | `node --test` |
| `src/js/multiplayer.js` | neu | Client: Verbindung, Reconnect, Lobby, Runde, Reveal, Final, Watch |
| `src/components/lobby/lobby.html`, `lobby.scss` | neu | Lobby-Screen, Reconnect-Banner, alle MP-Styles |
| `src/js/squadGuessr.js` | ändern | nutzt `scoring.js`; Einhängepunkte für `App.mp` |
| `src/components/menu/menu.html`, `game/game.html`, `results/results.html`, `index.html` | ändern | MP-Button, Status/Ranking-Elemente, Lobby einbinden |
| `src/app.js` | ändern | `lobby.scss` importieren |
| `src/i18n/en.json` | ändern | `mp`-Texte |
| `config/webpack.config.js` | ändern | Dev-Proxy `/mp`, `host: 0.0.0.0` |
| `package.json` | ändern | `ws`, `qrcode`, Scripts `server`, `test`, Lint auf `server/` |
| `Dockerfile`, `docker-compose.yml`, `docker/nginx.conf.template`, `.dockerignore` | neu | Hosting per Docker Compose |
| `README.md`, `CHANGELOG.md` | ändern | Betrieb und Deployment |

---

### Task 1: Gemeinsames Scoring-Modul

**Files:**
- Create: `src/js/scoring.js`
- Create: `server/scoring.test.js`
- Modify: `src/js/squadGuessr.js` (Import, `handleMapGuess`, `getPoints`, Methoden `levenshtein` und `interpolatePoints` entfernen)
- Modify: `package.json` (Script `test`)

**Interfaces:**
- Consumes: `MAPS`, `initMapsProperties` aus `src/js/data/maps.js`
- Produces:
  - `pointsForDistance(distance: number, size: number) → { points: number, icon: string }`
  - `levenshtein(a: string, b: string) → number`
  - `distance(a: {lat, lng}, b: {lat, lng}) → number`
  - `mapSize(mapName: string) → number | undefined`
  - `scoreAnswer(mode: "classic"|"mapFinder", guess: {map, lat, lng}, answer: {lat, lng} | {mapName}) → { distance: number|null, points: number }`

- [ ] **Step 1: Abhängigkeiten installieren und Lint-Baseline festhalten**

Run: `npm ci && npx eslint -c config/.eslintrc.js --rule "linebreak-style: off" src/js/squadGuessr.js; echo "exit $?"`

Das Ergebnis im Task-Report festhalten. Die Config verlangt `linebreak-style: windows`, das Repo nutzt aber LF. Deshalb prüft der Plan überall mit `--rule "linebreak-style: off"`. Falls die Config gar nicht lädt (z. B. weil das Paket `globals` fehlt), ist das ein bestehendes Problem: im Report vermerken und die Config nicht reparieren.

Für den Dev-Server wird eine `.env` im Repo-Root benötigt (`preChecks` bricht sonst ab). Falls sie fehlt: `printf 'DEV_SERVER_AUTO_OPEN=false\n' > .env` (die Datei ist gitignored).

- [ ] **Step 2: Failing test schreiben**

`server/scoring.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pointsForDistance, levenshtein, distance, mapSize, scoreAnswer } from "../src/js/scoring.js";
import { MAPS, initMapsProperties } from "../src/js/data/maps.js";

test("pointsForDistance on a 3000m map", () => {
    assert.deepEqual(pointsForDistance(0, 3000), { points: 100, icon: "! 💯" });
    assert.equal(pointsForDistance(20, 3000).points, 100);
    assert.deepEqual(pointsForDistance(35, 3000), { points: 90, icon: "! 🌟" });
    assert.equal(pointsForDistance(500, 3000).points, 10);
    assert.deepEqual(pointsForDistance(501, 3000), { points: 0, icon: "... ❌" });
});

test("pointsForDistance scales thresholds with map size", () => {
    assert.equal(pointsForDistance(40, 6000).points, 100);
    assert.equal(pointsForDistance(70, 6000).points, 90);
});

test("levenshtein tolerates case, spaces and small typos", () => {
    assert.equal(levenshtein("Al Basrah", "AlBasrah"), 0);
    assert.equal(levenshtein("narva", "Narva"), 0);
    assert.equal(levenshtein("narv", "Narva"), 1);
    assert.ok(levenshtein("kohat", "Narva") > 2);
});

test("distance is euclidean on lat/lng", () => {
    assert.equal(distance({ lat: 0, lng: 0 }, { lat: 3, lng: 4 }), 5);
});

test("mapSize matches initMapsProperties, case-insensitive", () => {
    initMapsProperties();
    const narva = MAPS.find(m => m.name === "Narva");
    assert.equal(mapSize("narva"), narva.size);
    assert.ok(narva.size > 0);
    assert.equal(mapSize("doesNotExist"), undefined);
});

test("scoreAnswer classic and mapFinder", () => {
    const guess = { map: "Narva", lat: 100, lng: 200 };
    assert.deepEqual(scoreAnswer("classic", guess, { lat: 100, lng: 200 }), { distance: 0, points: 100 });
    assert.equal(scoreAnswer("classic", guess, { lat: 100000, lng: 200 }).points, 0);
    assert.deepEqual(scoreAnswer("mapFinder", guess, { mapName: "narv" }), { distance: null, points: 100 });
    assert.equal(scoreAnswer("mapFinder", guess, { mapName: "gorodok" }).points, 0);
});
```

In `package.json` unter `scripts` ergänzen: `"test": "node --test server/"`.

- [ ] **Step 3: Test laufen lassen – muss fehlschlagen**

Run: `npm test`
Expected: FAIL mit `Cannot find module '.../src/js/scoring.js'`

- [ ] **Step 4: `src/js/scoring.js` implementieren**

```js
import { MAPS, initMapsProperties } from "./data/maps.js";

// base thresholds for a 3000x3000 map
const BASE_STEPS = [
    { maxDistance: 20, points: 100, icon: "! 💯" },
    { maxDistance: 50, points: 80, icon: "! 🌟" },
    { maxDistance: 100, points: 60, icon: "👏🏼" },
    { maxDistance: 200, points: 40, icon: "👍🏼" },
    { maxDistance: 300, points: 20, icon: "😐" },
    { maxDistance: 500, points: 10, icon: ".. 🤨" },
];

/**
 * Points (and display icon) for a guess `distance` meters away on a map `size` meters wide
 */
export function pointsForDistance(distance, size) {
    const scale = size / 3000; // 1 for base map, >1 for bigger maps, <1 for smaller
    const steps = BASE_STEPS.map(s => ({ ...s, maxDistance: s.maxDistance * scale }));

    if (distance <= steps[0].maxDistance) return { points: steps[0].points, icon: steps[0].icon };

    for (let i = 1; i < steps.length; i++) {
        if (distance <= steps[i].maxDistance) {
            const prev = steps[i - 1];
            const curr = steps[i];
            const ratio = (distance - prev.maxDistance) / (curr.maxDistance - prev.maxDistance);
            return { points: Math.round(prev.points + (curr.points - prev.points) * ratio), icon: curr.icon };
        }
    }

    return { points: 0, icon: "... ❌" };
}

/**
 * Smallest edit distance between `b` and the whole of `a` (spaces removed) or any single word of `a`
 */
export function levenshtein(a, b) {

    function normalize(str) { return str.toLowerCase().trim().replace(/\s+/g, " "); }

    a = normalize(a);
    b = normalize(b);

    // Direct compact match
    if (a.replace(/\s/g, "") === b) return 0;

    const words = a.split(" ");
    let best = Infinity;

    for (const word of words) {
        const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
        for (let j = 0; j <= word.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= word.length; j++) {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + (b[i - 1] === word[j - 1] ? 0 : 1)
                );
            }
        }
        best = Math.min(best, matrix[b.length][word.length]);
    }
    return best;
}

export function distance(a, b) {
    return Math.hypot(a.lat - b.lat, a.lng - b.lng);
}

export function mapSize(mapName) {
    const map = MAPS.find(m => m.name.toLowerCase() === mapName.toLowerCase());
    if (map && map.size === undefined) initMapsProperties();
    return map?.size;
}

/**
 * Score one answer against a guess, in game coordinates
 */
export function scoreAnswer(mode, guess, answer) {
    if (mode === "mapFinder") {
        return { distance: null, points: levenshtein(answer.mapName, guess.map) <= 2 ? 100 : 0 };
    }
    const d = distance(guess, answer);
    return { distance: d, points: pointsForDistance(d, mapSize(guess.map)).points };
}
```

- [ ] **Step 5: Test laufen lassen – muss grün sein**

Run: `npm test`
Expected: PASS, 6 Tests.

- [ ] **Step 6: Client auf `scoring.js` umstellen**

In `src/js/squadGuessr.js`:

Import am Dateianfang ergänzen (nach dem Import von `guessMarker.js`):
```js
import { pointsForDistance, levenshtein } from "./scoring.js";
```

In `handleMapGuess()` die Zeile
```js
        if (this.levenshtein(this.INPUT_GUESS.val(), this.currentGuess.map) <= 2) {
```
ersetzen durch
```js
        if (levenshtein(this.INPUT_GUESS.val(), this.currentGuess.map) <= 2) {
```

Die komplette Methode `levenshtein(a, b) { ... }` und die komplette Methode `interpolatePoints(distance, steps) { ... }` löschen.

Die komplette Methode `getPoints(distance) { ... }` ersetzen durch:
```js
    getPoints(distance) {
        const { points, icon } = pointsForDistance(distance, this.minimap.activeMap.size);
        this.gameData[this.gamePhase - 1].points = points;
        $("#mapName").html(`${points} ${i18next.t("shared.points", { ns: "common" })} ${icon}`).fadeIn();
        return points;
    }
```

Run: `grep -n "levenshtein\|interpolatePoints" src/js/squadGuessr.js`
Expected: nur die Import-Zeile und der Aufruf in `handleMapGuess`.

- [ ] **Step 7: Build und Singleplayer-Smoke-Test**

Run: `npm run build`
Expected: Build ohne Fehler.

Run: `npx eslint -c config/.eslintrc.js --rule "linebreak-style: off" src/js/scoring.js src/js/squadGuessr.js`
Expected: keine neuen Fehler gegenüber der Baseline aus Step 1.

Manuell: `npm start` und eine Classic-Partie spielen. Die Punkte für einen Tipp nahe an der Lösung und für einen weit entfernten Tipp müssen genauso aussehen wie vorher (Icon und Zahl erscheinen in `#mapName`). Danach eine MapFinder-Runde mit einem Tippfehler im Kartennamen (1 Buchstabe) spielen: sie muss ✅ zeigen.

- [ ] **Step 8: Commit**

```bash
git add src/js/scoring.js server/scoring.test.js src/js/squadGuessr.js package.json
git commit -m "refactor: extract shared scoring module"
```

---

### Task 2: Eingabe-Validierung

**Files:**
- Create: `server/validate.js`
- Test: `server/validate.test.js`

**Interfaces:**
- Consumes: `MAPS` aus `src/js/data/maps.js`
- Produces:
  - `cleanName(name: unknown) → string | null`: entfernt Steuerzeichen, trimmt, kürzt auf 20 Zeichen; `null` bei leer oder kein String
  - `validSettings(s: unknown) → boolean`
  - `validGuesses(guesses: unknown, rounds: number) → boolean`
  - `validAnswer(msg: object, mode: string) → boolean`

- [ ] **Step 1: Failing test schreiben**

`server/validate.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, validSettings, validGuesses, validAnswer } from "./validate.js";

const guess = (over = {}) => ({ map: "Narva", url: "/img/guesses/narva_1.webp", lat: 1.5, lng: -2, ...over });

test("cleanName trims, strips control chars and caps length", () => {
    assert.equal(cleanName("  Max "), "Max");
    assert.equal(cleanName(" max\u0007"), "max");
    assert.equal(cleanName("x".repeat(30)), "x".repeat(20));
    assert.equal(cleanName("<b>Hi</b>"), "<b>Hi</b>");
    assert.equal(cleanName("   "), null);
    assert.equal(cleanName(42), null);
    assert.equal(cleanName(undefined), null);
});

test("validSettings accepts only allowed values", () => {
    assert.equal(validSettings({ mode: "classic", timer: 0, rounds: 5 }), true);
    assert.equal(validSettings({ mode: "mapFinder", timer: 15, rounds: 10 }), true);
    assert.equal(validSettings({ mode: "classic", timer: "0", rounds: 5 }), false);
    assert.equal(validSettings({ mode: "hard", timer: 0, rounds: 5 }), false);
    assert.equal(validSettings({ mode: "classic", timer: 0, rounds: 7 }), false);
    assert.equal(validSettings(null), false);
});

test("validGuesses checks count and every field", () => {
    assert.equal(validGuesses([guess(), guess(), guess()], 3), true);
    assert.equal(validGuesses([guess({ submitter: "Dan" }), guess({ map: "narva" }), guess({ submitter: null })], 3), true);
    assert.equal(validGuesses([guess(), guess()], 3), false);
    assert.equal(validGuesses("nope", 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ map: "Atlantis" })], 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ url: "https://evil/x.webp" })], 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ url: "/img/../secret" })], 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ url: "/img/\"onerror=x" })], 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ lat: "1" })], 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ lng: Infinity })], 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ submitter: "x".repeat(41) })], 3), false);
    assert.equal(validGuesses([guess(), guess(), null], 3), false);
});

test("validAnswer per mode", () => {
    assert.equal(validAnswer({ lat: 1, lng: 2 }, "classic"), true);
    assert.equal(validAnswer({ lat: NaN, lng: 2 }, "classic"), false);
    assert.equal(validAnswer({ mapName: "narva" }, "classic"), false);
    assert.equal(validAnswer({ mapName: "narva" }, "mapFinder"), true);
    assert.equal(validAnswer({ mapName: "x".repeat(41) }, "mapFinder"), false);
    assert.equal(validAnswer({ lat: 1, lng: 2 }, "mapFinder"), false);
});
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node --test server/validate.test.js`
Expected: FAIL mit `Cannot find module '.../server/validate.js'`

- [ ] **Step 3: `server/validate.js` implementieren**

```js
import { MAPS } from "../src/js/data/maps.js";

const MODES = ["classic", "mapFinder"];
const TIMERS = [0, 15, 60];
const ROUNDS = [3, 5, 10];
const URL_PATTERN = /^\/img\/[\w\-/.]+$/;

/**
 * Player name as shown to others, or null if nothing usable is left
 */
export function cleanName(name) {
    if (typeof name !== "string") return null;
    const printable = [...name].filter(c => c >= " " && c !== "\u007f").join("");
    const clean = printable.trim().slice(0, 20).trim();
    return clean || null;
}

export function validSettings(s) {
    return Boolean(s) && MODES.includes(s.mode) && TIMERS.includes(s.timer) && ROUNDS.includes(s.rounds);
}

export function validGuesses(guesses, rounds) {
    return Array.isArray(guesses) && guesses.length === rounds && guesses.every(validGuess);
}

function validGuess(g) {
    return Boolean(g)
        && typeof g.map === "string" && MAPS.some(m => m.name.toLowerCase() === g.map.toLowerCase())
        && typeof g.url === "string" && g.url.length <= 200 && URL_PATTERN.test(g.url) && !g.url.includes("..")
        && Number.isFinite(g.lat) && Number.isFinite(g.lng)
        && (g.submitter === undefined || g.submitter === null || (typeof g.submitter === "string" && g.submitter.length <= 40));
}

export function validAnswer(msg, mode) {
    if (mode === "mapFinder") return typeof msg.mapName === "string" && msg.mapName.length <= 40;
    return Number.isFinite(msg.lat) && Number.isFinite(msg.lng);
}
```

- [ ] **Step 4: Test laufen lassen – muss grün sein**

Run: `npm test`
Expected: PASS (Scoring- und Validierungs-Tests).

- [ ] **Step 5: Commit**

```bash
git add server/validate.js server/validate.test.js
git commit -m "feat(server): validate multiplayer client input"
```

---

### Task 3: Session-Zustandsmaschine

**Files:**
- Create: `server/session.js`
- Test: `server/session.test.js`

**Interfaces:**
- Consumes: `scoreAnswer` (Task 1), `cleanName`, `validSettings`, `validGuesses`, `validAnswer` (Task 2)
- Produces: `class Session` mit
  - `constructor(code: string, { send: (conn, msg) => void, now?: () => number })`
  - `create(conn, { name, settings }) → boolean` (true = Session angelegt, conn gehört dazu)
  - `join(conn, { name, token? }) → boolean`
  - `watch(conn) → boolean`
  - `handle(conn, msg)`: für `answer | settings | start | endRound | next | lobby`
  - `disconnect(conn)`
  - `tick()`: prüft die Deadline
  - `isIdle(ms: number) → boolean`
  - Felder `code`, `phase`, `players`, `watchers`
- Exportiert außerdem `MAX_PLAYERS = 12`, `MAX_WATCHERS = 20`, `GRACE_MS = 1000`.
- Nachrichten-Reihenfolge (die der Client in Task 6 voraussetzt): bei jedem Phasenwechsel **zuerst `state`, dann** `round`/`reveal`/`final`. Bei einem Reconnect: `welcome`, `state`, dann die Phasen-Nachricht.

- [ ] **Step 1: Failing tests schreiben**

`server/session.test.js`:

```js
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
    s.handle(host, { type: "answer", lat: 100, lng: 200 });
    assert.equal(s.phase, "round");
    assert.equal(last(guest, "state").players.find(p => p.name === "Hans").answered, true);
    s.handle(guest, { type: "answer", lat: 100000, lng: 200 });
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
    s.handle(host, { type: "answer", lat: 100, lng: 200 });
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
    s.handle(guest, { type: "answer", lat: 100, lng: 200 });
    s.handle(host, { type: "answer", lat: 100, lng: 200 });
    assert.equal(s.phase, "reveal");
    assert.equal(last(guest, "reveal").results.find(r => r.name === "Max").points, 100);
    s.handle(guest, { type: "answer", lat: 100, lng: 200 });
    assert.equal(last(guest, "error").code, "INVALID");
    s.handle(host, { type: "next" });
    assert.equal(last(guest, "state").players.find(p => p.name === "Max").answered, false);
});

test("a second answer in the same round is rejected", () => {
    const { s, host, last } = started();
    s.handle(host, { type: "answer", lat: 1, lng: 1 });
    s.handle(host, { type: "answer", lat: 100, lng: 200 });
    assert.equal(last(host, "error").code, "INVALID");
});

test("host can end a round early", () => {
    const { s, host } = started();
    s.handle(host, { type: "endRound" });
    assert.equal(s.phase, "reveal");
});

test("mapFinder answers are scored by map name", () => {
    const { s, host, guest, last } = started({ mode: "mapFinder", timer: 0, rounds: 3 });
    s.handle(host, { type: "answer", mapName: "narv" });
    s.handle(guest, { type: "answer", mapName: "kohat" });
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
    s.handle(host, { type: "answer", lat: 100, lng: 200 });
    const phone = {};
    s.join(phone, { token });
    assert.equal(last(phone, "reveal").index, 0);
    assert.equal(last(phone, "round"), undefined);
});

test("host reconnect keeps host role and score", () => {
    const { s, host, guest, last } = started();
    s.handle(host, { type: "answer", lat: 100, lng: 200 });
    s.handle(guest, { type: "answer", lat: 100, lng: 200 });
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
        s.handle(host, { type: "answer", lat: GUESSES[i].lat, lng: GUESSES[i].lng });
        s.handle(guest, { type: "answer", lat: GUESSES[i].lat, lng: GUESSES[i].lng });
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
    s.handle(tv, { type: "answer", lat: 1, lng: 1 });
    assert.equal(last(tv, "error").code, "INVALID");
});

test("unknown message types are rejected", () => {
    const { s, host, last } = setup();
    s.handle(host, { type: "explode" });
    assert.equal(last(host, "error").code, "INVALID");
});

test("isIdle after inactivity", () => {
    const { s, advance } = setup();
    advance(1000);
    assert.equal(s.isIdle(5000), false);
    advance(5000);
    assert.equal(s.isIdle(5000), true);
});
```

- [ ] **Step 2: Tests laufen lassen – müssen fehlschlagen**

Run: `node --test server/session.test.js`
Expected: FAIL mit `Cannot find module '.../server/session.js'`

- [ ] **Step 3: `server/session.js` implementieren**

```js
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
        this.watchers.delete(conn);
        const player = this.playerByConn(conn);
        if (!player) return;
        player.conn = null;
        player.connected = false;
        this.broadcastState();
        this.checkRoundEnd();
    }

    // ===== ACTIONS =====

    handle(conn, msg) {
        const player = this.playerByConn(conn);
        if (!player) return this.error(conn, "INVALID");
        this.touch();
        if (msg.type === "answer") return this.answer(player, msg);
        if (!HOST_ACTIONS.includes(msg.type)) return this.error(conn, "INVALID");
        if (player.id !== this.hostId) return this.error(conn, "NOT_HOST");

        switch (msg.type) {
        case "settings": return this.updateSettings(conn, msg.settings);
        case "start": return this.start(conn, msg.guesses);
        case "endRound": return this.phase === "round" ? this.endRound() : this.error(conn, "INVALID");
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
        if (this.phase !== "round" || player.answers[this.round] || !validAnswer(msg, this.settings.mode)) {
            return this.error(player.conn, "INVALID");
        }
        const answer = this.settings.mode === "classic"
            ? { lat: msg.lat, lng: msg.lng, mapName: null }
            : { lat: null, lng: null, mapName: msg.mapName };
        player.answers[this.round] = { ...answer, ...scoreAnswer(this.settings.mode, this.guesses[this.round], answer) };
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

    isIdle(ms) {
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

function pickSettings({ mode, timer, rounds }) {
    return { mode, timer, rounds };
}
```

- [ ] **Step 4: Tests laufen lassen – müssen grün sein**

Run: `npm test`
Expected: PASS für alle Tests in `scoring`, `validate` und `session`.

- [ ] **Step 5: Lint**

Run: `npx eslint -c config/.eslintrc.js --rule "linebreak-style: off" server/ && npx jshint server/`
Expected: keine Fehler. Findet jshint die Konfiguration nicht, liegt sie in `package.json` unter `jshintConfig` und wird aus dem Repo-Root automatisch gefunden.

- [ ] **Step 6: Commit**

```bash
git add server/session.js server/session.test.js
git commit -m "feat(server): multiplayer session state machine"
```

---

### Task 4: WebSocket-Server und Dev-Proxy

**Files:**
- Create: `server/index.js`
- Test: `server/index.test.js`
- Modify: `package.json` (Dependency `ws`, Scripts `server` und `lint`)
- Modify: `config/webpack.config.js` (`devServer.proxy`, `devServer.host`, `devServer.allowedHosts`)

**Interfaces:**
- Consumes: `Session` (Task 3)
- Produces: `startServer({ port?: number, idleMs?: number }) → WebSocketServer` (Pfad `/mp`). Jede ausgehende Nachricht bekommt `serverNow: Date.now()`. Direkt gestartet (`node server/index.js`) lauscht der Server auf `MP_PORT || 3001`.

- [ ] **Step 1: `ws` installieren**

Run: `npm install ws@^8`
Das legt `"dependencies": { "ws": "^8.x" }` in `package.json` an. `ws` ist eine Laufzeit-Abhängigkeit des Servers und gehört daher **nicht** zu den devDependencies.

- [ ] **Step 2: Failing test schreiben**

`server/index.test.js`:

```js
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
```

- [ ] **Step 3: Test laufen lassen – muss fehlschlagen**

Run: `node --test server/index.test.js`
Expected: FAIL mit `Cannot find module '.../server/index.js'`

- [ ] **Step 4: `server/index.js` implementieren**

```js
import { WebSocketServer } from "ws";
import { randomInt } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Session } from "./session.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const IDLE_MS = 30 * 60 * 1000;
const TICK_MS = 500;
const HEARTBEAT_MS = 30 * 1000;

/**
 * Multiplayer session server: routes socket messages to Session instances
 */
export function startServer({ port = 3001, idleMs = IDLE_MS } = {}) {
    const wss = new WebSocketServer({ port, path: "/mp", maxPayload: 64 * 1024 });
    const sessions = new Map();
    const sessionOf = new Map();

    const send = (ws, msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ ...msg, serverNow: Date.now() }));
    };

    const newCode = () => {
        let code;
        do {
            code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
        } while (sessions.has(code));
        return code;
    };

    const leaveCurrent = (ws) => {
        sessionOf.get(ws)?.disconnect(ws);
        sessionOf.delete(ws);
    };

    const route = (ws, msg) => {
        if (msg.type === "create") {
            leaveCurrent(ws);
            const session = new Session(newCode(), { send });
            if (session.create(ws, msg)) {
                sessions.set(session.code, session);
                sessionOf.set(ws, session);
            }
            return;
        }
        if (msg.type === "join" || msg.type === "watch") {
            leaveCurrent(ws);
            const session = sessions.get(String(msg.code ?? "").toUpperCase());
            if (!session) return send(ws, { type: "error", code: "SESSION_NOT_FOUND" });
            const ok = msg.type === "join" ? session.join(ws, msg) : session.watch(ws);
            if (ok) sessionOf.set(ws, session);
            return;
        }
        const session = sessionOf.get(ws);
        if (!session) return send(ws, { type: "error", code: "INVALID" });
        session.handle(ws, msg);
    };

    wss.on("connection", (ws) => {
        ws.isAlive = true;
        ws.on("pong", () => { ws.isAlive = true; });
        ws.on("message", (data) => {
            let msg;
            try {
                msg = JSON.parse(data);
            } catch {
                return send(ws, { type: "error", code: "INVALID" });
            }
            if (!msg || typeof msg !== "object" || Array.isArray(msg)) return send(ws, { type: "error", code: "INVALID" });
            route(ws, msg);
        });
        ws.on("close", () => leaveCurrent(ws));
    });

    const ticker = setInterval(() => {
        for (const [code, session] of sessions) {
            if (session.isIdle(idleMs)) sessions.delete(code);
            else session.tick();
        }
    }, TICK_MS);

    const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
            if (!ws.isAlive) {
                ws.terminate();
                continue;
            }
            ws.isAlive = false;
            ws.ping();
        }
    }, HEARTBEAT_MS);

    wss.on("close", () => {
        clearInterval(ticker);
        clearInterval(heartbeat);
    });

    return wss;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.env.MP_PORT) || 3001;
    startServer({ port });
    console.log(`SquadGuessr multiplayer server listening on :${port}/mp`);
}
```

- [ ] **Step 5: Test laufen lassen – muss grün sein**

Run: `npm test`
Expected: PASS für alle Testdateien; der Prozess beendet sich von selbst (die Intervalle werden beim `close` des Servers gelöscht).

- [ ] **Step 6: Scripts ergänzen**

In `package.json` unter `scripts`:
- neu: `"server": "node server/index.js"`
- im `lint`-Script `jshint ./src/` durch `jshint ./src/ ./server/` ersetzen und `eslint --fix -c ./config/.eslintrc.js ./src/` durch `eslint --fix -c ./config/.eslintrc.js ./src/ ./server/`

- [ ] **Step 7: Dev-Proxy in `config/webpack.config.js`**

Im `devServer`-Objekt nach `port: ...` ergänzen:
```js
            host: "0.0.0.0",
            allowedHosts: "all",
```

Im `proxy`-Array nach dem bestehenden `/api/`-Eintrag einen zweiten Eintrag anfügen:
```js
                {
                    context: ["/mp"],
                    target: `http://localhost:${process.env.MP_PORT || 3001}`,
                    ws: true,
                },
```

- [ ] **Step 8: Smoke-Test über den Dev-Proxy**

In zwei Terminals: `npm run server` und `npm start`. Dann in der Browser-Konsole auf `http://localhost:3000`:
```js
const ws = new WebSocket(`ws://${location.host}/mp`);
ws.onmessage = e => console.log(e.data);
ws.onopen = () => ws.send(JSON.stringify({ type: "create", name: "Test", settings: { mode: "classic", timer: 0, rounds: 3 } }));
```
Expected: In der Konsole erscheinen eine `welcome`- und eine `state`-Nachricht. Hot Reload des Dev-Servers funktioniert weiterhin (eine Änderung an einer `.scss`-Datei lädt die Seite neu).

- [ ] **Step 9: Commit**

```bash
git add server/index.js server/index.test.js package.json package-lock.json config/webpack.config.js
git commit -m "feat(server): websocket session server and dev proxy"
```

---

### Task 5: Client – Verbindung und Lobby

**Files:**
- Create: `src/js/multiplayer.js`
- Create: `src/components/lobby/lobby.html`
- Create: `src/components/lobby/lobby.scss`
- Modify: `src/components/index.html` (Lobby einbinden)
- Modify: `src/app.js` (SCSS importieren)
- Modify: `src/components/menu/menu.html` (Button)
- Modify: `src/js/squadGuessr.js` (Import, `this.mp` im Konstruktor, `this.mp.init()` in `init()`, `switchUI` mit `lobby`)
- Modify: `src/i18n/en.json` (`mp`-Block)
- Modify: `package.json` (devDependency `qrcode`)

**Interfaces:**
- Consumes: Server-Protokoll aus Tasks 3/4; `app.switchUI(page)`, `app.openToast(type, title, text)`, `app.getGuess(n) → Promise<Array>`, `app.setButtonLoading($button, bool)`
- Produces: `class Multiplayer` (default export), die `SquadGuessr` als `this.mp` hält:
  - Felder: `active: boolean`, `watching: boolean`, `me: string|null`, `state: object|null`, `offset: number`
  - `init()`, `send(msg)`, `leave()`, `isHost() → boolean`
  - `onMessage(msg)` behandelt in diesem Task `welcome | state | error`; Task 6 ergänzt `round | reveal | final`
  - `renderState()` ruft `this.renderStatus()` auf; in diesem Task ist das ein No-op-Stub, Task 6 ersetzt ihn
  - `renderRanking($list, rows, winners = [])` (wird in Task 6 genutzt)
- CSS-Konventionen für Task 6 und 7: `body.mp-active` (in einer Session), `body.mp-host` (ich bin Host), `body.watch-mode`; `.host-only` und `.guest-only`.

- [ ] **Step 1: `qrcode` installieren**

Run: `npm install --save-dev qrcode@^1.5`
(Wie alle Browser-Bibliotheken dieses Repos wird sie gebündelt und gehört deshalb zu den devDependencies.)

- [ ] **Step 2: Texte in `src/i18n/en.json`**

Auf oberster Ebene nach `"shared": {...},` einfügen:
```json
    "mp": {
        "play": "PLAY WITH FRIENDS",
        "title": "Play with friends",
        "namePlaceholder": "Your name",
        "codePlaceholder": "CODE",
        "code": "Code",
        "rounds": "rounds",
        "waitingForHost": "Waiting for the host…",
        "waitingForPlayers": "Waiting for others ({{answered}}/{{total}})",
        "reconnecting": "Reconnecting…",
        "showOnScreen": "Show on a big screen",
        "enterName": "Enter your name first",
        "buttons": {
            "create": "CREATE SESSION",
            "join": "JOIN",
            "start": "START",
            "leave": "LEAVE",
            "endRound": "END ROUND"
        },
        "errors": {
            "SESSION_NOT_FOUND": "Session not found",
            "NAME_TAKEN": "This name is already taken",
            "GAME_RUNNING": "The game has already started",
            "SESSION_FULL": "The session is full",
            "NOT_HOST": "Only the host can do that",
            "INVALID": "Invalid request",
            "GUESSES": "Could not load guesses"
        }
    },
```

- [ ] **Step 3: `src/components/lobby/lobby.html`**

```html
<div id="lobby">

    <div id="mpEntry">
        <h1 data-i18n="common:mp.title"></h1>
        <input type="text" id="mpName" maxlength="20" autocomplete="off" data-i18n-placeholder="common:mp.namePlaceholder" />
        <button id="BUTTON_MP_CREATE" data-i18n="common:mp.buttons.create"></button>
        <div class="mp-join">
            <input type="text" id="mpCode" maxlength="4" autocomplete="off" data-i18n-placeholder="common:mp.codePlaceholder" />
            <button id="BUTTON_MP_JOIN" data-i18n="common:mp.buttons.join"></button>
        </div>
        <button id="BUTTON_MP_BACK" data-i18n="common:timer.buttons.back"></button>
    </div>

    <div id="mpRoom" hidden>
        <div class="mp-code">
            <span data-i18n="common:mp.code"></span>
            <strong id="mpRoomCode"></strong>
        </div>
        <canvas id="mpQr"></canvas>
        <p id="mpJoinUrl"></p>
        <ul id="mpPlayers" class="mp-players"></ul>
        <p id="mpSettingsSummary"></p>
        <div id="mpSettings" class="host-only">
            <select id="mpMode">
                <option value="classic" data-i18n="common:menu.classic"></option>
                <option value="mapFinder" data-i18n="common:menu.findMap"></option>
            </select>
            <select id="mpTimer">
                <option value="0" data-i18n="common:timer.chill"></option>
                <option value="60" data-i18n="common:timer.timed"></option>
                <option value="15" data-i18n="common:timer.rush"></option>
            </select>
            <select id="mpRounds">
                <option value="3">3</option>
                <option value="5" selected>5</option>
                <option value="10">10</option>
            </select>
        </div>
        <p class="guest-only" data-i18n="common:mp.waitingForHost"></p>
        <div class="button-container">
            <button id="BUTTON_MP_LEAVE" data-i18n="common:mp.buttons.leave"></button>
            <button id="BUTTON_MP_START" class="host-only" data-i18n="common:mp.buttons.start"></button>
        </div>
        <a id="mpWatchLink" class="host-only" target="_blank" rel="noopener noreferrer" data-i18n="common:mp.showOnScreen"></a>
    </div>

</div>

<div id="mpBanner" data-i18n="common:mp.reconnecting" hidden></div>
```

- [ ] **Step 4: `src/components/lobby/lobby.scss`**

```scss
@use "../shared/variables";

#lobby {
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 1em;

    #mpEntry,
    #mpRoom {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1em;
        width: min(420px, 100%);
    }

    input {
        width: 100%;
        padding: 0.8em;
        font-size: 1.1em;
        background: #1a1a1a;
        border: 2px solid #333;
        border-radius: 12px;
    }

    #mpCode {
        text-transform: uppercase;
    }

    .mp-join {
        display: flex;
        gap: 0.5em;
        width: 100%;
    }

    .mp-code strong {
        display: block;
        font-family: variables.$logoFont;
        font-size: 3em;
        letter-spacing: 0.2em;
    }

    #mpQr {
        background: #fff;
        border-radius: 8px;
        image-rendering: pixelated;
    }

    #mpJoinUrl {
        font-size: 0.8em;
        opacity: 0.7;
        word-break: break-all;
    }

    select {
        background: #272727;
        padding: 0.6em;
        border-radius: 10px;
        font-size: 1em;
    }

    #mpWatchLink {
        color: #aaa;
    }
}

#lobby [hidden],
#mpBanner[hidden],
#mpStatus[hidden],
#mpRanking[hidden],
#BUTTON_MP_ENDROUND[hidden] {
    display: none !important;
}

#mpBanner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10000;
    padding: 0.5em;
    background: #a33;
}

.mp-players {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5em;

    li {
        background: #272727;
        border-radius: 999px;
        padding: 0.3em 0.9em;

        &.me {
            border: 2px solid variables.$mainColor;
        }

        &.offline {
            opacity: 0.4;
        }
    }
}

.mp-ranking {
    list-style: none;
    width: min(420px, 100%);
    margin: 1em auto;

    li {
        display: grid;
        grid-template-columns: 2.5em 1fr auto auto;
        gap: 0.6em;
        padding: 0.4em 0.8em;
        border-bottom: 1px solid #333;

        &.me {
            background: rgb(17 68 126 / 30%);
        }
    }

    .points {
        color: #7c7;
    }
}

#mpChips,
#mpFinalRanking {
    display: none;
}

body.mp-active {
    #mpChips {
        display: flex;
        margin-top: 0.5em;
    }

    #mpFinalRanking {
        display: block;
    }

    .maps-container,
    #BUTTON_SHARE {
        display: none !important;
    }
}

body.mp-active:not(.mp-host) #BUTTON_PLAYAGAIN {
    display: none !important;
}

.host-only {
    display: none !important;
}

body.mp-host {
    .host-only {
        display: revert !important;
    }

    .guest-only {
        display: none !important;
    }
}
```

- [ ] **Step 5: Einbinden**

In `src/components/index.html` im `<main>` nach der Zeile mit `results.html`:
```html
                <%= require('html-loader!./lobby/lobby.html').default %>
```

In `src/app.js` nach `import "./components/game/mapLogo.scss";`:
```js
import "./components/lobby/lobby.scss";
```

In `src/components/menu/menu.html` nach dem `BUTTON_TIMER`-Button:
```html
    <button id="BUTTON_MP" data-i18n="common:mp.play"></button>
```

- [ ] **Step 6: `src/js/multiplayer.js`**

```js
import i18next from "i18next";
import QRCode from "qrcode";

const RETRY_DELAYS = [1000, 2000, 5000];

/**
 * Multiplayer session client
 * Talks to server/index.js over WebSocket and drives the lobby, game and results screens
 */
export default class Multiplayer {
    constructor(app) {
        this.app = app;
        this.active = false;
        this.watching = false;
        this.ws = null;
        this.hello = null;
        this.me = null;
        this.code = null;
        this.state = null;
        this.offset = 0;
        this.retry = 0;
        this.retryTimer = null;
        this.qrCode = null;
    }

    init() {
        $("#BUTTON_MP").on("click", () => this.showEntry());
        $("#BUTTON_MP_BACK").on("click", () => this.app.switchUI("menu"));
        $("#BUTTON_MP_CREATE").on("click", () => this.create());
        $("#BUTTON_MP_JOIN").on("click", () => this.join($("#mpCode").val()));
        $("#BUTTON_MP_LEAVE").on("click", () => this.leave());
        $("#BUTTON_MP_START").on("click", () => this.start());
        $("#mpSettings select").on("change", () => this.send({ type: "settings", settings: this.readSettings() }));
        document.addEventListener("visibilitychange", () => this.onVisible());

        $("#mpName").val(localStorage.getItem("mp:name") ?? "");

        const params = new URLSearchParams(location.search);
        const watch = params.get("watch");
        const join = params.get("join")?.toUpperCase();
        if (watch) return this.watch(watch);
        if (!join) return;
        $("#mpCode").val(join);
        // page reload during a game: rejoin silently with the stored token
        if (localStorage.getItem(`mp:${join}`) && $("#mpName").val()) return this.join(join);
        this.showEntry();
    }

    // ===== ENTRY =====

    readName() {
        const name = $("#mpName").val().trim();
        if (!name) {
            this.toast("warning", "mp.enterName");
            return null;
        }
        localStorage.setItem("mp:name", name);
        return name;
    }

    readSettings() {
        return {
            mode: $("#mpMode").val(),
            timer: Number($("#mpTimer").val()),
            rounds: Number($("#mpRounds").val()),
        };
    }

    create() {
        const name = this.readName();
        if (name) this.open({ type: "create", name, settings: this.readSettings() });
    }

    join(rawCode) {
        const code = String(rawCode).trim().toUpperCase();
        const name = this.readName();
        if (!name || code.length !== 4) return;
        this.open({ type: "join", code, name, token: localStorage.getItem(`mp:${code}`) ?? undefined });
    }

    watch(code) {
        this.watching = true;
        $("body").addClass("watch-mode");
        this.open({ type: "watch", code: code.toUpperCase() });
    }

    start() {
        const $button = $("#BUTTON_MP_START");
        this.app.setButtonLoading($button, true);
        this.app.getGuess(this.state.settings.rounds)
            .then(guesses => this.send({ type: "start", guesses }))
            .catch(() => this.toast("error", "mp.errors.GUESSES"))
            .finally(() => this.app.setButtonLoading($button, false));
    }

    // ===== CONNECTION =====

    open(hello) {
        this.hello = hello;
        this.active = true;
        this.retry = 0;
        $("body").addClass("mp-active");
        this.connect();
    }

    connect() {
        const protocol = location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${protocol}://${location.host}/mp`);
        this.ws = ws;
        ws.onopen = () => {
            this.retry = 0;
            $("#mpBanner").prop("hidden", true);
            this.send(this.hello);
        };
        ws.onmessage = (event) => this.onMessage(JSON.parse(event.data));
        ws.onclose = () => {
            if (!this.active || this.ws !== ws) return;
            $("#mpBanner").prop("hidden", false);
            clearTimeout(this.retryTimer);
            this.retryTimer = setTimeout(() => this.connect(), RETRY_DELAYS[this.retry++] ?? 5000);
        };
    }

    onVisible() {
        if (!this.active || document.visibilityState !== "visible") return;
        if (this.ws?.readyState !== WebSocket.CLOSED) return;
        clearTimeout(this.retryTimer);
        this.connect();
    }

    send(msg) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    }

    stop() {
        this.active = false;
        this.watching = false;
        clearTimeout(this.retryTimer);
        clearInterval(this.countdown);
        const ws = this.ws;
        this.ws = null;
        ws?.close();
        this.state = null;
        this.me = null;
        this.code = null;
        $("body").removeClass("mp-active mp-host watch-mode");
        $("#mpBanner").prop("hidden", true);
    }

    leave() {
        if (this.code) localStorage.removeItem(`mp:${this.code}`);
        this.stop();
        history.replaceState({}, "", "/");
        this.app.switchUI("menu");
    }

    // ===== MESSAGES =====

    onMessage(msg) {
        if (msg.serverNow) this.offset = msg.serverNow - Date.now();

        switch (msg.type) {
        case "welcome":
            this.me = msg.playerId;
            this.code = msg.code;
            localStorage.setItem(`mp:${msg.code}`, msg.token);
            this.hello = { type: "join", code: msg.code, name: this.hello.name, token: msg.token };
            history.replaceState({}, "", `/?join=${msg.code}`);
            break;
        case "state":
            this.state = msg;
            this.renderState();
            break;
        case "error":
            this.onError(msg.code);
            break;
        }
    }

    onError(code) {
        this.toast("error", `mp.errors.${code}`);
        if (code === "SESSION_NOT_FOUND") {
            localStorage.removeItem(`mp:${this.hello?.code}`);
            this.leave();
            return;
        }
        // rejected before we were ever in the session (name taken, game running, full): stay on the entry screen
        if (!this.state) this.stop();
    }

    // ===== RENDERING =====

    isHost() {
        return this.me !== null && this.state?.hostId === this.me;
    }

    renderState() {
        const s = this.state;
        this.code = s.code;
        $("body").toggleClass("mp-host", this.isHost());
        $("#mpRoomCode").text(s.code);
        $("#mpMode").val(s.settings.mode);
        $("#mpTimer").val(String(s.settings.timer));
        $("#mpRounds").val(String(s.settings.rounds));
        $("#mpSettingsSummary").text(this.describeSettings(s.settings));
        this.renderPlayers(s);

        const me = s.players.find(p => p.id === this.me);
        if (me) $("#totalPoints").text(me.score);

        this.renderStatus();
        if (s.phase === "lobby") this.showRoom();
    }

    // replaced in Task 6
    renderStatus() {}

    renderPlayers(s) {
        const items = s.players.map(p => $("<li>")
            .text(`${p.id === s.hostId ? "👑 " : ""}${p.name}${s.phase === "round" && p.answered ? " ✓" : ""}`)
            .toggleClass("offline", !p.connected)
            .toggleClass("me", p.id === this.me));
        $("#mpPlayers").empty().append(items);
        $("#mpChips").empty().append(items.map($li => $li.clone()));
    }

    renderRanking($list, rows, winners = []) {
        $list.empty();
        rows.forEach((row, i) => {
            $("<li>")
                .toggleClass("me", row.id === this.me)
                .append(
                    $("<span class=\"rank\">").text(winners.includes(row.id) ? "🏆" : `${i + 1}.`),
                    $("<span class=\"name\">").text(row.name),
                    $("<span class=\"points\">").text(row.points === undefined ? "" : `+${row.points}`),
                    $("<span class=\"score\">").text(row.score)
                )
                .appendTo($list);
        });
    }

    describeSettings({ mode, timer, rounds }) {
        const t = (key) => i18next.t(key, { ns: "common" });
        const modeLabel = mode === "classic" ? t("menu.classic") : t("menu.findMap");
        const timerLabel = { 0: t("timer.chill"), 60: t("timer.timed"), 15: t("timer.rush") }[timer];
        return `${modeLabel} · ${timerLabel} · ${rounds} ${t("mp.rounds")}`;
    }

    showEntry() {
        $("#mpEntry").prop("hidden", false);
        $("#mpRoom").prop("hidden", true);
        this.app.switchUI("lobby");
    }

    showRoom() {
        clearInterval(this.countdown);
        $("#mpEntry").prop("hidden", true);
        $("#mpRoom").prop("hidden", false);
        this.drawQr();
        if (!$("#lobby").is(":visible")) this.app.switchUI("lobby");
    }

    drawQr() {
        if (this.qrCode === this.code) return;
        this.qrCode = this.code;
        const url = `${location.origin}/?join=${this.code}`;
        QRCode.toCanvas(document.getElementById("mpQr"), url, { width: 220, margin: 1 });
        $("#mpJoinUrl").text(url);
        $("#mpWatchLink").attr("href", `/?watch=${this.code}`);
    }

    toast(type, key) {
        this.app.openToast(type, i18next.t(key, { ns: "common" }), "");
    }
}
```

- [ ] **Step 7: Einhängepunkte in `src/js/squadGuessr.js`**

Import nach dem `scoring.js`-Import:
```js
import Multiplayer from "./multiplayer.js";
```

Im Konstruktor nach `this.session = false;`:
```js
        this.mp = new Multiplayer(this);
```

In `init()` nach `this.switchUI("menu");`:
```js
        this.mp.init();
```

In `switchUI(page)` das Objekt `uiStates` ersetzen durch:
```js
        const uiStates = {
            menu: {
                show: ["#menu", "#footerLogos"],
                hide: ["#map_ui", "#timer_ui", "#results", "#lobby"],
                scoreHidden: true
            },
            timer: {
                show: ["#timer_ui", "#footerLogos"],
                hide: ["#menu", "#map_ui", "#results", "#lobby"],
                scoreHidden: true
            },
            game: {
                show: ["#map_ui"],
                hide: ["#menu", "#timer_ui", "#results", "#footerLogos", "#lobby"],
                scoreHidden: false
            },
            results: {
                show: ["#results", "#footerLogos"],
                hide: ["#map_ui", "#timer_ui", "#menu", "#lobby"],
                scoreHidden: true
            },
            lobby: {
                show: ["#lobby", "#footerLogos"],
                hide: ["#map_ui", "#timer_ui", "#menu", "#results"],
                scoreHidden: true
            }
        };
```

- [ ] **Step 8: Build und Lint**

Run: `npm run build && npx eslint -c config/.eslintrc.js --rule "linebreak-style: off" src/js/multiplayer.js src/js/squadGuessr.js && npx stylelint --fix -c ./config/.stylelintrc.json src/components/lobby/lobby.scss && npx htmlhint --config ./config/.htmlhintrc.json src/components/lobby/`
Expected: alles fehlerfrei (stylelint darf automatisch korrigieren).

- [ ] **Step 9: Manuelle Prüfung der Lobby**

`npm run server` und `npm start`. Tab A (`http://localhost:3000`): Menü → „PLAY WITH FRIENDS“ → Name „Hans“ → „CREATE SESSION“.
Expected:
- Tab A zeigt Code, QR-Code, Join-URL, „👑 Hans“, die drei Auswahlfelder, START und den Link „Show on a big screen“.
- Die URL ist jetzt `/?join=CODE`.

Tab B (Inkognito, damit ein eigener localStorage genutzt wird): die Join-URL öffnen → Name „Max“ → JOIN.
Expected:
- Beide Tabs zeigen „👑 Hans“ und „Max“.
- Tab B zeigt „Waiting for the host…“ statt der Auswahlfelder.

Tab A: Timer auf „Rush“ stellen → Tab B zeigt im Summary „Classic · Rush · 5 rounds“.

Tab C (Inkognito): Name „max“ → Code eingeben → JOIN → Fehler-Toast „This name is already taken“; Tab C bleibt auf dem Eingabeschirm, und es gibt keine Reconnect-Schleife (kein Banner).

Tab A neu laden (F5) → Tab A ist ohne Eingabe wieder in der Lobby und weiterhin Host.

Server stoppen → beide Tabs zeigen das Banner „Reconnecting…“. Server starten → die Tabs erhalten „Session not found“ und landen im Menü.

- [ ] **Step 10: Commit**

```bash
git add src/js/multiplayer.js src/components/lobby src/components/index.html src/app.js src/components/menu/menu.html src/js/squadGuessr.js src/i18n/en.json package.json package-lock.json
git commit -m "feat: multiplayer lobby with join code, QR and reconnect"
```

---

### Task 6: Client – Runde, Auflösung, Endstand

**Files:**
- Modify: `src/js/multiplayer.js` (Nachrichten `round | reveal | final`, Methoden unten, `renderStatus` ersetzen, Button `BUTTON_MP_ENDROUND`)
- Modify: `src/js/squadGuessr.js` (`handleGuess`, `setupGameButtons`, `setupNavigationButtons`, `setupHint`)
- Modify: `src/components/game/game.html` (Status, Chips, Ranking, End-Round-Button)
- Modify: `src/components/results/results.html` (Endstand-Rangliste)

**Interfaces:**
- Consumes: aus Task 5 `Multiplayer` mit `state`, `me`, `offset`, `watching`, `isHost()`, `send()`, `leave()`, `renderRanking()`; aus `SquadGuessr`: `minimap` (`clear()`, `guessMarker`, `gameToMapScale`, `mapToGameScale`, `activeMap`, `markersGroup`, `invalidateSize()`), `setupMap()`, `setupHint()`, `getSolutionLatLng()`, `createSolutionMarker(latLng)`, `drawSolutionDistance(latLng)`, `focusOnSolution(latLng, zoom)`, `formatDistance(m)`, `updateTimerDisplay(s)`, `stopTimer()`, `INPUT_GUESS`, `BUTTON_GUESS`, `BUTTON_NEXT`, `BUTTON_RESULTS`; aus `guessMarker.js` die Klasse `guessMarker`
- Produces: `Multiplayer.submitAnswer()`, `onRound(msg)`, `onReveal(msg)`, `onFinal(msg)`, `renderStatus()`, `startCountdown(deadline)`, `addOtherMarker(result)`

- [ ] **Step 1: HTML ergänzen**

In `src/components/game/game.html` direkt nach dem schließenden `</div>` von `<div id="text">`:
```html
            <p id="mpStatus" hidden></p>
            <ol id="mpRanking" class="mp-ranking" hidden></ol>
            <ul id="mpChips" class="mp-players"></ul>
```
Im `<div id="actions">` nach `BUTTON_RESULTS`:
```html
                <button id="BUTTON_MP_ENDROUND" data-i18n="common:mp.buttons.endRound" hidden></button>
```

In `src/components/results/results.html` nach dem schließenden `</div>` von `<div class="score-container">`:
```html
    <ol id="mpFinalRanking" class="mp-ranking"></ol>
```

- [ ] **Step 2: Einhängepunkte in `src/js/squadGuessr.js`**

`setupGameButtons()` ersetzen durch:
```js
    setupGameButtons() {

        this.BUTTON_NEWGAME.on("click", () => this.startNewGame());
        this.BUTTON_GUESS.on("click", () => this.handleGuess());
        this.BUTTON_NEXT.on("click", () => this.mp.active ? this.mp.send({ type: "next" }) : this.loadNextGuess());
        this.BUTTON_RESULTS.on("click", () => this.mp.active ? this.mp.send({ type: "next" }) : this.showResults());

    }
```

In `setupNavigationButtons()` diese drei Handler ersetzen:
```js
        this.BUTTON_MENU.on("click", () => { this.mp.active ? this.mp.leave() : this.switchUI("menu"); });
```
```js
        this.BUTTON_PLAYAGAIN.on("click", () => this.mp.active ? this.mp.send({ type: "lobby" }) : this.startNewGame());
```
```js
        this.MAIN_LOGO.on("click", () => {
            this.stopTimer();
            if (this.mp.active) return this.mp.leave();
            this.switchUI("menu");
        });
```

`handleGuess()` bekommt als erste Zeile:
```js
        if (this.mp.active) return this.mp.submitAnswer();
```

In `setupHint()` wird `#submitter` per Text statt HTML gesetzt. Die Zeile
```js
                $("#submitter").html(i18next.t("game.hintBy", { ns: "common" }) + " " + this.currentGuess.submitter);
```
ersetzen durch
```js
                $("#submitter").text(i18next.t("game.hintBy", { ns: "common" }) + " " + this.currentGuess.submitter);
```
und die Zeile `$("#submitter").html("");` durch `$("#submitter").text("");`.

- [ ] **Step 3: `src/js/multiplayer.js` erweitern**

Import ergänzen:
```js
import { guessMarker } from "./guessMarker.js";
```

Im Konstruktor ergänzen:
```js
        this.answered = false;
        this.countdown = null;
```

In `init()` nach der `BUTTON_MP_START`-Zeile:
```js
        $("#BUTTON_MP_ENDROUND").on("click", () => this.send({ type: "endRound" }));
```

In `onMessage()` im `switch` vor `case "error":`:
```js
        case "round":
            this.onRound(msg);
            break;
        case "reveal":
            this.onReveal(msg);
            break;
        case "final":
            this.onFinal(msg);
            break;
```

Den Stub `renderStatus() {}` (inklusive Kommentar `// replaced in Task 6`) ersetzen durch folgende Methoden:

```js
    renderStatus() {
        const s = this.state;
        if (!s || s.phase !== "round") return;
        const online = s.players.filter(p => p.connected);
        const text = i18next.t("mp.waitingForPlayers", {
            ns: "common",
            answered: online.filter(p => p.answered).length,
            total: online.length,
        });
        $("#mpStatus").text(text).prop("hidden", !this.answered && !this.watching);
    }

    // ===== GAME =====

    onRound(msg) {
        const app = this.app;
        const me = this.state.players.find(p => p.id === this.me);
        this.answered = Boolean(me?.answered);

        app.selectedMode = this.state.settings.mode;
        app.currentGuess = { map: msg.map, url: msg.url, submitter: msg.submitter };
        app.solutionMarker = null;
        if (msg.map) app.setupMap();
        else app.minimap.clear();

        $("#gameWrapper").toggleClass("no-map", !msg.map);
        $("#text").css("visibility", "hidden");
        $("#mpRanking").prop("hidden", true);
        $("#round").text(`${msg.index + 1}/${msg.total}`);
        app.INPUT_GUESS.val("").prop({ hidden: false, disabled: this.answered });
        app.BUTTON_GUESS.prop({ hidden: this.watching || this.answered, disabled: true });
        app.BUTTON_NEXT.prop("hidden", true);
        app.BUTTON_RESULTS.prop("hidden", true);
        $("#BUTTON_MP_ENDROUND").prop("hidden", !this.isHost());

        app.switchUI("game");
        app.setupHint();
        this.renderStatus();
        this.startCountdown(msg.deadline);
    }

    submitAnswer() {
        const app = this.app;
        if (this.answered || this.watching || this.state?.phase !== "round") return;

        let answer;
        if (app.selectedMode === "mapFinder") {
            const mapName = app.INPUT_GUESS.val().trim();
            if (!mapName) return;
            answer = { mapName };
            app.INPUT_GUESS.prop("disabled", true);
        } else {
            const marker = app.minimap.guessMarker;
            if (!marker) return;
            const { lat, lng } = marker.getLatLng();
            answer = { lat: lat * app.minimap.mapToGameScale, lng: lng * app.minimap.mapToGameScale };
            marker.dragging.disable();
        }

        this.answered = true;
        this.send({ type: "answer", ...answer });
        app.BUTTON_GUESS.prop({ hidden: true, disabled: true });
        this.renderStatus();
    }

    startCountdown(deadline) {
        clearInterval(this.countdown);
        $("#timerWrapper").prop("hidden", !deadline);
        if (!deadline) return;

        const tick = () => {
            const left = Math.max(0, Math.ceil((deadline - Date.now() - this.offset) / 1000));
            this.app.updateTimerDisplay(left);
            if (left > 0) return;
            clearInterval(this.countdown);
            // like singleplayer: a placed marker / typed name counts when time runs out
            this.submitAnswer();
        };
        tick();
        this.countdown = setInterval(tick, 250);
    }

    onReveal(msg) {
        const app = this.app;
        const mm = app.minimap;
        const { solution } = msg;

        clearInterval(this.countdown);
        app.stopTimer();
        app.selectedMode = this.state.settings.mode;

        // fresh = we missed the round (reconnect straight into reveal)
        const fresh = app.currentGuess?.url !== solution.url;
        const needsMap = fresh || !mm.activeMap || mm.activeMap.name.toLowerCase() !== solution.map.toLowerCase();
        app.currentGuess = { ...solution, submitter: fresh ? null : app.currentGuess.submitter };

        $("#gameWrapper").removeClass("no-map");
        if (needsMap) app.setupMap();
        if (fresh) {
            app.switchUI("game");
            app.setupHint();
        }
        mm.invalidateSize();
        mm.guessMarker?.dragging.disable();

        const latLng = app.getSolutionLatLng();
        app.createSolutionMarker(latLng);
        if (mm.guessMarker) app.drawSolutionDistance(latLng);
        msg.results
            .filter(r => r.lat !== null && (r.id !== this.me || !mm.guessMarker))
            .forEach(r => this.addOtherMarker(r));
        app.focusOnSolution(latLng, app.selectedMode === "mapFinder" ? 3 : 6);

        const mine = msg.results.find(r => r.id === this.me);
        if (mine) {
            $("#dist").text(mine.distance === null ? "—" : app.formatDistance(mine.distance));
            $("#points").text(mine.points);
            $("#text").css("visibility", "visible");
        }
        const mapLabel = solution.map.charAt(0).toUpperCase() + solution.map.slice(1);
        if (app.selectedMode === "mapFinder") {
            $("#mapName").text(`${mine ? (mine.points ? "✅ " : "❌ ") : ""}${mapLabel}`).fadeIn();
        } else if (mine) {
            $("#mapName").text(`${mine.points} ${i18next.t("shared.points", { ns: "common" })}`).fadeIn();
        }

        this.renderRanking($("#mpRanking"), msg.results);
        $("#mpRanking").prop("hidden", false);

        const last = msg.index + 1 === msg.total;
        app.INPUT_GUESS.prop("hidden", true);
        app.BUTTON_GUESS.prop("hidden", true);
        $("#BUTTON_MP_ENDROUND").prop("hidden", true);
        app.BUTTON_NEXT.prop({ hidden: !this.isHost() || last, disabled: false });
        app.BUTTON_RESULTS.prop({ hidden: !this.isHost() || !last, disabled: false });
        $("#mpStatus").text(i18next.t("mp.waitingForHost", { ns: "common" })).prop("hidden", this.isHost());
    }

    addOtherMarker(result) {
        const mm = this.app.minimap;
        const label = document.createElement("span");
        label.textContent = `${result.name} +${result.points}`;
        new guessMarker([result.lat * mm.gameToMapScale, result.lng * mm.gameToMapScale], { draggable: false }, mm)
            .addTo(mm.markersGroup)
            .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -45], className: "mpTooltip" });
    }

    onFinal(msg) {
        clearInterval(this.countdown);
        this.renderRanking($("#mpFinalRanking"), msg.ranking, msg.winners);
        const me = msg.ranking.find(r => r.id === this.me);
        $("#scoreValue").text(me ? me.score : msg.ranking[0]?.score ?? 0);
        this.app.switchUI("results");
    }
```

Außerdem in `stop()` nach `clearInterval(this.countdown);` ergänzen. `onRound` überschreibt `app.selectedMode`; beim Verlassen muss der Singleplayer wieder den Modus der ausgewählten Karte nutzen:
```js
        this.answered = false;
        this.app.selectMode($(".mode-card.selected").data("mode") || "classic");
```

- [ ] **Step 4: Build und Lint**

Run: `npm run build && npx eslint -c config/.eslintrc.js --rule "linebreak-style: off" src/js/multiplayer.js src/js/squadGuessr.js && npx htmlhint --config ./config/.htmlhintrc.json src/components/`
Expected: fehlerfrei.

- [ ] **Step 5: Manuelle Prüfung einer ganzen Partie**

Server und Dev-Server laufen; Tab A (Host „Hans“) und Tab B (Inkognito, „Max“) sind wie in Task 5 in der Lobby. Tab A stellt „Classic · Chill · 3 rounds“ ein und klickt START.

Expected, Schritt für Schritt:
1. Beide Tabs zeigen dasselbe Bild, `1/3`, die Karte und die Chips „👑 Hans“ und „Max“. In Tab A ist „END ROUND“ sichtbar, in Tab B nicht.
2. Tab A setzt einen Marker und klickt GUESS → „Waiting for others (1/2)“; in beiden Tabs bekommt „Hans“ im Chip ein ✓.
3. Tab B tippt → beide sehen die Lösung, ihren eigenen Marker mit Distanzlinie, den Marker des anderen mit Namen und Punkten und die Rangliste. Tab A zeigt NEXT, Tab B „Waiting for the host…“.
4. Tab A: NEXT → Runde 2. Tab B tippt nicht; Tab A klickt END ROUND → Auflösung, Max bekommt 0.
5. Runde 3: Tab B schließen, bevor getippt wird → Tab A tippt → die Auflösung kommt sofort (Max ist offline und blockiert nicht). Tab B wieder öffnen (gleiche URL im selben Inkognito-Fenster) → Tab B zeigt direkt die Auflösung von Runde 3 mit Bild.
6. Tab A: RESULTS → beide sehen die Endstand-Rangliste mit 🏆 beim Gewinner. Tab A hat PLAY AGAIN, Tab B nicht. Weder Bilder-Raster noch Teilen-Button sind sichtbar.
7. Tab A: PLAY AGAIN → beide sind zurück in der Lobby, die Punkte stehen auf 0.
8. Tab A: Modus „Find the Map“, Timer „Rush“ → START. Die Karte ist ausgeblendet, ein Eingabefeld und ein 15-s-Countdown sind sichtbar. Tab A tippt „narv“ ohne auf GUESS zu klicken, Tab B tippt nichts. Nach Ablauf wird Tab A automatisch abgeschickt, und die Auflösung zeigt Karte und Kartennamen.
9. MENU → Classic-Karte wählen → PLAY: das Singleplayer-Spiel verhält sich wie vor dem Feature und läuft im Classic-Modus, obwohl die letzte Multiplayer-Runde „Find the Map“ war.

- [ ] **Step 6: Commit**

```bash
git add src/js/multiplayer.js src/js/squadGuessr.js src/components/game/game.html src/components/results/results.html
git commit -m "feat: synchronized multiplayer rounds, reveal and final ranking"
```

---

### Task 7: Beamer-Ansicht

**Files:**
- Modify: `src/components/lobby/lobby.scss` (Watch-Mode-Styles)

**Interfaces:**
- Consumes: `body.watch-mode` (gesetzt von `Multiplayer.watch()` in Task 5), Elemente aus Task 5 und 6
- Produces: nur CSS

- [ ] **Step 1: Styles am Ende von `src/components/lobby/lobby.scss` anfügen**

```scss
// Big screen / projector view (?watch=CODE): nothing to click, everything larger
body.watch-mode {
    #actions,
    #score,
    #mpEntry {
        display: none !important;
    }

    #map {
        pointer-events: none;
    }

    #timerWrapper {
        font-size: 3em;
    }

    #lobby #mpQr {
        width: min(50vh, 90vw) !important;
        height: auto !important;
    }

    #mpRoomCode {
        font-size: 5em;
    }

    .mp-players li {
        font-size: 1.3em;
    }

    .mp-ranking {
        width: min(700px, 100%);
        font-size: 1.3em;
    }

    #mpFinalRanking li:nth-child(-n + 3) {
        font-size: 1.4em;
    }

    #mpFinalRanking li:first-child {
        font-size: 1.8em;
    }
}
```

- [ ] **Step 2: Build und Lint**

Run: `npx stylelint --fix -c ./config/.stylelintrc.json src/components/lobby/lobby.scss && npm run build`
Expected: fehlerfrei.

- [ ] **Step 3: Manuelle Prüfung**

Host-Tab: in der Lobby auf „Show on a big screen“ klicken → ein neuer Tab mit `/?watch=CODE` öffnet sich.
Expected:
- Der Watch-Tab zeigt einen großen QR-Code, den Code und die Spielerliste, aber keine Eingabefelder und keinen START-Button.
- Während einer Runde: Bild, Chips mit ✓, großer Countdown bei Timer-Modi, keine Buttons. Ein Klick auf die Karte setzt keinen Marker.
- In der Auflösung: alle Marker mit Namen und die Rangliste.
- Am Ende: die Rangliste mit größeren Top 3.
- Wird der Watch-Tab mitten im Spiel neu geladen, zeigt er sofort wieder die aktuelle Phase.

- [ ] **Step 4: Commit**

```bash
git add src/components/lobby/lobby.scss
git commit -m "feat: big-screen watch mode for multiplayer sessions"
```

---

### Task 8: Docker-Hosting

**Files:**
- Create: `.dockerignore`
- Create: `docker/nginx.conf.template`
- Create: `Dockerfile`
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: `npm run build` → `dist/` (Webpack), `node server/index.js` mit `MP_PORT` (Task 4), `ws` in `dependencies` (Task 4)
- Produces: `docker compose up -d --build` stellt die App unter `http://${WEB_BIND:-127.0.0.1}:${WEB_PORT:-8080}` bereit, mit `/mp` → `mp:3001` und `/api/` → `${API_URL}`. Konfiguration über `.env` neben `docker-compose.yml`: `WEB_BIND`, `WEB_PORT`, `API_URL`, `API_KEY`, `SEARCH_ENGINES`.

- [ ] **Step 1: `.dockerignore`**

```
node_modules
dist
.git
.github
.idea
.vscode
.env
docs
*.log
```

`.env` muss ausgeschlossen sein: Die lokale Datei enthält Dev-Einstellungen, und die Build-Stage schreibt ihre eigene.

- [ ] **Step 2: `docker/nginx.conf.template`**

Das offizielle nginx-Image rendert beim Start `/etc/nginx/templates/*.template` per `envsubst` nach `/etc/nginx/conf.d/`. Dabei werden **nur gesetzte** Umgebungsvariablen ersetzt; nginx-Variablen wie `$http_upgrade` bleiben erhalten. Deshalb setzt Compose `API_KEY` immer, notfalls leer. Ein leerer Header-Wert wird von nginx nicht gesendet.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # multiplayer websocket
    location = /mp {
        proxy_pass http://mp:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
    }

    # guesses and images come from the SquadCalc API (like the webpack dev proxy)
    location /api/ {
        proxy_pass ${API_URL};
        proxy_ssl_server_name on;
        proxy_set_header X-API-Key "${API_KEY}";
    }
}
```

`proxy_pass ${API_URL}` ohne Pfad reicht `/api/v2/...` unverändert durch, und der `Host`-Header ist standardmäßig der Ziel-Host (entspricht `changeOrigin: true` im Dev-Proxy).

- [ ] **Step 3: `Dockerfile`**

```dockerfile
# ---- build the static frontend ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG SEARCH_ENGINES=false
# webpack.config.js refuses to run without a .env file
RUN printf 'SEARCH_ENGINES=%s\nDEV_SERVER_AUTO_OPEN=false\n' "$SEARCH_ENGINES" > .env \
    && npm run build

# ---- static files + reverse proxy for /mp and /api ----
FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# ---- multiplayer websocket server ----
FROM node:20-alpine AS mp
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY src/js/scoring.js ./src/js/scoring.js
COPY src/js/data/maps.js ./src/js/data/maps.js
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]
```

- [ ] **Step 4: `docker-compose.yml`**

```yaml
services:
  web:
    build:
      context: .
      target: web
      args:
        SEARCH_ENGINES: ${SEARCH_ENGINES:-false}
    ports:
      - "${WEB_BIND:-127.0.0.1}:${WEB_PORT:-8080}:80"
    environment:
      API_URL: ${API_URL:-https://squadcalc.app}
      API_KEY: ${API_KEY:-}
    depends_on:
      - mp
    restart: unless-stopped

  mp:
    build:
      context: .
      target: mp
    environment:
      MP_PORT: "3001"
    restart: unless-stopped
```

- [ ] **Step 5: Bauen und starten**

Run: `docker compose up -d --build && docker compose ps`
Expected: `web` und `mp` haben den Status `running`; nur `web` zeigt einen Port (`127.0.0.1:8080->80/tcp`).

Run: `docker compose exec mp whoami`
Expected: `node`

Run: `docker compose logs mp`
Expected: `SquadGuessr multiplayer server listening on :3001/mp`

- [ ] **Step 6: Prüfen, dass alle drei Pfade funktionieren**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/ && curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8080/?join=ABCD"`
Expected: `200` und `200`

Run:
```bash
node --input-type=module -e '
import WebSocket from "ws";
const ws = new WebSocket("ws://127.0.0.1:8080/mp");
ws.on("open", () => ws.send(JSON.stringify({ type: "create", name: "Docker", settings: { mode: "classic", timer: 0, rounds: 3 } })));
ws.on("message", (d) => { console.log(String(d)); ws.close(); });
ws.on("error", (e) => { console.error(e.message); process.exit(1); });
'
```
Expected: eine Zeile mit `"type":"welcome"` und einem 4-stelligen `code`.

Run: `curl -s -o /dev/null -w "%{http_code}\n" -H "X-App-Version: 1.2.2" "http://127.0.0.1:8080/api/v2/get/squadGuess?nb=3"`
Expected: `200`. Bei `401`/`403` verlangt die API einen Key. Das ist dann **kein** Task-Fehler, sondern gehört in den Report (siehe Spec, Abschnitt „Risiko“): mit `API_KEY=... docker compose up -d` erneut prüfen, falls ein Key vorliegt.

Im Browser `http://127.0.0.1:8080` öffnen: Das Menü lädt, ein Singleplayer-Spiel zeigt Bilder (sofern die API mit 200 antwortet), und „PLAY WITH FRIENDS“ → „CREATE SESSION“ zeigt Code und QR-Code.

Run: `docker compose down`

- [ ] **Step 7: Commit**

```bash
git add .dockerignore docker/nginx.conf.template Dockerfile docker-compose.yml
git commit -m "feat: docker compose hosting for frontend and multiplayer server"
```

---

### Task 9: Betriebsdoku und End-to-End-Abnahme

**Files:**
- Modify: `README.md` (neuer Abschnitt)
- Modify: `CHANGELOG.md` (neuer Eintrag oben)
- Create: `.env.example`

**Interfaces:**
- Consumes: alles aus den Tasks 1–8
- Produces: Dokumentation

- [ ] **Step 1: Abschnitt in `README.md`**

Vor `# **Support the project**` einfügen:

````markdown
# Multiplayer server

Group sessions ("Play with friends") need the small WebSocket server in `server/`.

**Development**

```bash
npm run server   # ws server on :3001 (MP_PORT to change)
npm start        # dev server proxies /mp to it, reachable from phones on the LAN
npm test         # server + scoring tests
```

**Production (Docker Compose)**

Your existing reverse proxy terminates TLS and forwards the domain to the `web` container:

```bash
cp .env.example .env   # optional, see variables below
docker compose up -d --build
```

| Variable | Default | |
|---|---|---|
| `WEB_BIND` | `127.0.0.1` | use `0.0.0.0` if the reverse proxy runs on another host |
| `WEB_PORT` | `8080` | point your reverse proxy here |
| `API_URL` | `https://squadcalc.app` | upstream for `/api/` (guesses and images) |
| `API_KEY` | empty | sent as `X-API-Key` if set |
| `SEARCH_ENGINES` | `false` | allow indexing in `robots.txt` |

The reverse proxy must pass WebSocket upgrades for `/mp` (Caddy and Traefik do this automatically; plain nginx needs `proxy_http_version 1.1` plus `Upgrade`/`Connection` headers; Nginx Proxy Manager: enable "Websockets Support").

Sessions live in memory only; `docker compose up -d --build` after an update restarts the server and ends all running sessions.

</br></br>
````

- [ ] **Step 2: `.env.example`**

```
# docker compose
WEB_BIND=127.0.0.1
WEB_PORT=8080
API_URL=https://squadcalc.app
API_KEY=
SEARCH_ENGINES=false

# webpack dev server (npm start)
DEV_SERVER_AUTO_OPEN=true
```

`.env` selbst bleibt gitignored; `.env.example` wird committet. Compose und Webpack lesen beide dieselbe `.env`, die Variablennamen überschneiden sich nicht.

- [ ] **Step 3: Eintrag in `CHANGELOG.md`**

Ganz oben einfügen, im Stil der bestehenden Einträge:
```markdown
# <img src="https://img.shields.io/badge/-minor%20release-cd6f68?style=for-the-badge"> **1.4.0** *(unreleased)*

</br><img src="https://img.shields.io/badge/-new%20features-green">
- Added "Play with friends": join a session from your phone by code/QR, play synchronized rounds and find out who wins
- Added a big-screen view (`?watch=CODE`) for projectors/TVs
- Added Docker Compose hosting (frontend + multiplayer server)

</br></br><!-- CHANGELOG SPLIT MARKER -->


```

- [ ] **Step 4: Komplette Verifikation**

Run: `npm test && npm run build && docker compose build`
Expected: alle Tests grün, Build und Image-Build fehlerfrei.

Run: `npx eslint -c config/.eslintrc.js --rule "linebreak-style: off" src/js/multiplayer.js src/js/scoring.js src/js/squadGuessr.js server/`
Expected: keine Fehler.

- [ ] **Step 5: Abnahme mit echtem Handy**

Die App läuft per `WEB_BIND=0.0.0.0 docker compose up -d --build` (damit das Handy den Port erreicht). Der PC hat im LAN z. B. die IP `192.168.1.20`. Falls die API im Container nicht mit 200 antwortet (Task 8, Step 6), stattdessen `npm run server` und `npm start` nutzen und Port `3000` statt `8080`.
1. PC-Browser: `http://192.168.1.20:8080` → Session erstellen. Den QR-Code mit dem Handy scannen → Name eingeben → beitreten.
2. Einen Watch-Tab am PC öffnen.
3. Eine Partie Classic · Timed · 3 rounds spielen. Mitten in Runde 2 das Handy 10 s sperren und wieder entsperren → das Banner erscheint kurz, danach zeigt das Handy die aktuelle Phase, und die Punkte sind unverändert.
4. Ein zweiter Spieler mit dem Namen `<img src=x onerror=alert(1)>` tritt bei → der Name erscheint überall als Text, es gibt keinen Alert.
5. Host-Tab mitten in einer Runde mit F5 neu laden → er ist wieder Host (END ROUND sichtbar) und behält seine Punkte.
6. Während einer Session `docker compose restart mp` → alle Clients zeigen „Session not found“ und landen im Menü; es bleibt kein Reconnect-Banner stehen.

Ergebnisse (auch Abweichungen) im Task-Report festhalten.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md .env.example
git commit -m "docs: multiplayer server setup and changelog"
```
