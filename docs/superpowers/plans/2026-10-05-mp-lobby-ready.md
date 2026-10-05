# Ready-Button und Start-Countdown – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gäste melden sich in der Multiplayer-Lobby bereit. Jeder Start beginnt mit einem Countdown, den alle sehen: 5 s, wenn alle bereit sind, sonst 15 s. Währenddessen laden alle Geräte die Bilder von Runde 1. Der Host kann den Start abbrechen, solange Runde 1 noch nicht läuft.

**Architecture:** Der Countdown ist eine Mindestdauer der bestehenden Phase `loading` von Runde 1. Dafür bekommt der Server (`server/session.js`) das Feld `startsAt` und eine angepasste Frist `loadUntil`. Dazu kommen die Spielernachricht `lobbyReady`, das Spielerfeld `lobbyReady` und die Host-Aktion `cancelStart`. Der Client (`src/js/multiplayer.js`) rendert Ready-Button, ✓, START/START ANYWAY, CANCEL und den Countdown nur aus dem State. Die Sekunden rechnet ein kleiner, getesteter Helfer in `src/js/clock.js` aus.

**Tech Stack:** Node ≥ 18 (ESM, `node:test`), `ws` 8, Webpack 5, jQuery, i18next.

**Spec:** `docs/superpowers/specs/2026-10-05-mp-lobby-ready-design.md`

## Global Constraints

- Keine `Co-Authored-By`- oder andere AI-Attribution in Commit-Messages (globale Nutzer-Anweisung). Subagents ausdrücklich darauf hinweisen.
- Arbeiten auf dem Branch `feature/mp-lobby-ready`. Er zweigt von `feature/mp-synced-round-start` ab, auf dem Phase `loading`, `prepare`/`ready`, `stalled` und der Vorlader schon existieren.
- Codestil wie im Repo:
  - 4 Spaces, doppelte Anführungszeichen, Semikolons, ESM.
  - Klassen ohne Klassenfelder und ohne `#private` (jshint `esversion: 11`).
  - Spielernamen nur per `.text()`/`textContent`, nie per `.html()`.
  - Kommentare auf Englisch, knapp, sie erklären das Warum.
- Konstanten exakt: `COUNTDOWN_READY_MS = 5 * 1000` und `COUNTDOWN_FORCED_MS = 15 * 1000`. `LOAD_FIRST_MS` (10 s) und `LOAD_MS` (5 s) bleiben unverändert.
- Protokoll exakt:
  - Spieler → Server: `{ type: "lobbyReady", ready: <boolean> }`
  - Host → Server: `{ type: "cancelStart" }`
  - `state` bekommt oben `startsAt` (Serverzeit in ms oder `null`) und pro Spieler `lobbyReady`.
- Texte exakt:
  - `mp.buttons.ready`: en `READY`, zh `准备`
  - `mp.buttons.forceStart`: en `START ANYWAY`, zh `强制开始`
  - `mp.buttons.cancel`: en `CANCEL`, zh `取消`
  - `mp.startingIn`: en `Starting in {{seconds}} s…`, zh `{{seconds}} 秒后开始…`
- Tests: `npm test` (läuft mit dem Node 18 dieses Rechners). Ausgangslage auf dem Branch: 82 Tests, alle grün.
- Lint:
  - `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/` muss ohne Ausgabe durchlaufen.
  - `npx stylelint -c ./config/.stylelintrc.json src/components/lobby/lobby.scss` muss ohne Ausgabe durchlaufen. Nur diese Datei prüfen, die anderen SCSS-Dateien haben 126 Altfehler.
  - `npx htmlhint --config ./config/.htmlhintrc.json --nocolor ./src/` meldet `no errors found`.
  - **Nie `npm run lint` und nie `--fix`:** jshint 0.5.9 stürzt ab, und `eslint --fix` stellt alle Dateien auf CRLF um.
- Build (braucht Node ≥ 20, der Rechner hat Node 18): `docker run --rm -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack -c ./config/webpack.config.js`. Die Ausgabe muss `compiled successfully` enthalten.

## Review Focus

1. **Der Countdown zeigt auf allen Geräten dieselben Sekunden, auch bei falsch gehender Geräteuhr.** Er rechnet mit dem Uhr-Offset des Servers, nicht mit der lokalen Uhr allein. Abgedeckt durch den Test von `secondsUntil` mit Offset (Task 3, Step 1) und den Synchron-Check im Browser (Task 4, Step 4).
2. **Ein Doppelklick auf CANCEL zeigt keinen Toast „Invalid request“.** Der zweite Klick käme sonst erst nach dem Abbruch an. Abgedeckt durch den Button-Lock (Task 3, Step 8) und den Browser-Check (Task 4, Step 6).
3. **Wer während des Countdowns geht, steht nach CANCEL nicht als grauer Geist in der Lobby.** Abgedeckt durch den Servertest in Task 2, Step 1.
4. **Der START-Button zeigt in der Lobby immer den richtigen Text.** Gemeint sind „START“ oder „START ANYWAY“ nach Abbrechen, nach einem Spiel und nach einem fehlgeschlagenen Laden der Guesses, kein hängender Spinner. Abgedeckt im Browser in Task 4, Steps 3, 6 und 9.
5. **Wer während des Countdowns neu lädt oder den Big Screen öffnet, sieht die Lobby mit Countdown, nicht das Hauptmenü.** Abgedeckt im Browser in Task 4, Step 7.

---

## File Structure

| Datei | Neu/Ändern | Verantwortung |
|---|---|---|
| `server/session.js` | ändern | `lobbyReady`, `allReady()`, `startsAt`, Frist für Runde 1, `cancelStart`, `start` nur aus der Lobby |
| `server/session.test.js` | ändern | Helfer `begin`, angepasste Lade-Tests, neue Tests für Ready, Countdown und Abbrechen |
| `src/js/clock.js` | ändern | `secondsUntil(at, offset, now)` |
| `server/clock.test.js` | ändern | Test für `secondsUntil` |
| `src/js/multiplayer.js` | ändern | Ready-Button, ✓, START-Text, CANCEL, Countdown-Anzeige |
| `src/components/lobby/lobby.html` | ändern | `BUTTON_MP_READY`, `BUTTON_MP_CANCEL` |
| `src/components/lobby/lobby.scss` | ändern | grüner Ready-Button, große Countdown-Zeile, kein Ready-Button auf dem Big Screen |
| `src/i18n/en.json`, `src/i18n/zh.json` | ändern | vier neue Texte |
| `CHANGELOG.md` | ändern | Eintrag unter 1.4.0 |

---

### Task 1: Server – `lobbyReady` und Start-Countdown

**Files:**
- Modify: `server/session.js` (Konstanten Z. 9–11, Konstruktor Z. 21–35, `handle` Z. 91, `start` Z. 116, `load` Z. 129, `checkLoaded` Z. 145, `ready` Z. 158, `startRound` Z. 172, `toLobby` Z. 242, `stateMsg` Z. 283, `addPlayer` Z. 345)
- Test: `server/session.test.js`

**Interfaces:**
- Consumes: aus dem Branch `load()`, `lateLoaders()`, `checkLoaded()`, `startRound()`, `resetScores()` (setzt `ready = -1`, `stalled = false`), `isPresent(p)`, Test-Helfer `readyAll(s, i)`.
- Produces:
  - `export const COUNTDOWN_READY_MS`, `export const COUNTDOWN_FORCED_MS`
  - `Session#startsAt: number | null`
  - Spielerfeld `lobbyReady: boolean`
  - `Session#lobbyReady(player, ready)`, `Session#allReady(): boolean`
  - `state.startsAt`, `state.players[].lobbyReady`
  - Test-Helfer `begin(conn = host)` im Rückgabewert von `setup()`

- [ ] **Step 1: Test-Helfer auf den Countdown umstellen**

In `server/session.test.js` die Import-Zeile ersetzen:

```js
import { Session, MAX_PLAYERS, RECONNECT_MS, LOAD_FIRST_MS, LOAD_MS, COUNTDOWN_READY_MS, COUNTDOWN_FORCED_MS } from "./session.js";
```

`setup()` und `started()` ersetzen (`withGuest()` und `readyAll()` bleiben):

```js
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
```

```js
function started(settings) {
    const ctx = withGuest(settings);
    ctx.begin();
    return ctx;
}
```

- [ ] **Step 2: Bestehende Tests mit direktem `start` auf `begin` umstellen**

In diesen vier Tests wird das Paar `s.handle(X, { type: "start", guesses: GUESSES });` + `readyAll(s, 0);` durch `begin(X)` ersetzt (bzw. `begin()` bei `X = host`), und `begin` kommt in die Destrukturierung:

```js
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
```

```js
test("a host who leaves hands the host role to the next connected player", () => {
    const { s, host, guest, last, begin } = withGuest();
    s.handle(host, { type: "leave" });
    const state = last(guest, "state");
    assert.equal(state.hostId, last(guest, "welcome").playerId);
    assert.deepEqual(state.players.map(p => p.name), ["Max"]);
    begin(guest);
    assert.equal(s.phase, "round");
});
```

```js
test("a lobby guest whose connection drops keeps their place and can still get into the game", () => {
    const { s, host, guest, last, begin } = withGuest();
    const token = last(guest, "welcome").token;
    s.disconnect(guest);
    assert.deepEqual(last(host, "state").players.map(p => [p.name, p.connected]), [["Hans", true], ["Max", false]]);
    begin();
    const phone = {};
    assert.equal(s.join(phone, { name: "Max", token }), true);
    assert.equal(last(phone, "round").index, 0);
});
```

```js
test("when nobody connected holds the host role, the next player who is there gets it", () => {
    const { s, host, last, begin } = setup();
    const tv = {};
    s.watch(tv);
    s.handle(host, { type: "leave" });
    const phone = {};
    s.join(phone, { name: "Hans" });
    s.tick();
    assert.equal(last(tv, "state").hostId, last(phone, "welcome").playerId);
    begin(phone);
    assert.equal(s.phase, "round");
});
```

- [ ] **Step 3: Lade-Tests für Runde 1 an den Countdown anpassen**

Diese Tests prüfen das Warten auf Bilder in Runde 1. Mit dem langen Countdown wäre die Frist gleich das Countdown-Ende. Deshalb melden sich die Gäste vorher bereit (kurzer Countdown, Frist 10 s), und gewartet wird erst nach dem Countdown.

Ersetzen:

```js
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
```

```js
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
```

```js
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
```

In diesen drei Tests jeweils **eine Zeile** direkt vor dem ersten `s.handle(host, { type: "start", guesses: GUESSES });` einfügen, sonst bleiben sie unverändert:

```js
    s.handle(guest, { type: "lobbyReady", ready: true });
```

- `"loading waits at most LOAD_FIRST_MS, then LOAD_MS; who missed it is not waited for until they report back"`
- `"with everyone away, loading waits; the first one back gets a fresh wait that still ends after LOAD_MS"`
- `"a player who reconnects gets the images again: while loading without extending the time, later for the next round"`

- [ ] **Step 4: Neue Tests ans Dateiende anhängen**

```js
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
    assert.equal(countdown(({ s, guest }) => s.disconnect(guest)), COUNTDOWN_READY_MS);
    const alone = setup();
    alone.s.handle(alone.host, { type: "start", guesses: GUESSES });
    assert.equal(alone.last(alone.host, "state").startsAt, 1000 + COUNTDOWN_READY_MS);
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
```

- [ ] **Step 5: Tests laufen lassen, sie müssen fehlschlagen**

Run: `npm test 2>&1 | tail -12`
Expected: FAIL. Unter anderem schlagen die neuen Tests fehl (`lobbyReady` fehlt im State, `startsAt` ist `undefined`), außerdem die Tests mit `begin`/`advance(COUNTDOWN_…)`, weil die Konstanten noch nicht exportiert sind (`advance(undefined)` ergibt `NaN`).

- [ ] **Step 6: Server implementieren**

In `server/session.js`:

Unter `LOAD_MS` (Z. 11) die Konstanten einfügen:

```js
// every start counts down so all devices load round 1 meanwhile; longer when not every guest is ready yet
export const COUNTDOWN_READY_MS = 5 * 1000;
export const COUNTDOWN_FORCED_MS = 15 * 1000;
```

Klassenkommentar ersetzen:

```js
/**
 * One multiplayer session: lobby → loading → round → reveal → loading → … → final
 * The first loading is also the start countdown: round 1 never begins before `startsAt`.
 * Knows nothing about sockets: `send(conn, msg)` is injected and `conn` is opaque.
 * On every phase change `state` is sent before `prepare`/`round`/`reveal`/`final`.
 */
```

Im Konstruktor direkt unter `this.loadUntil = null;`:

```js
        this.startsAt = null;
```

In `handle()` direkt unter der `ready`-Zeile:

```js
        if (msg.type === "lobbyReady") return this.lobbyReady(player, msg.ready);
```

`start()` ersetzen:

```js
    start(conn, guesses) {
        if (this.phase !== "lobby" || !validGuesses(guesses, this.settings.rounds)) {
            return this.error(conn, "INVALID");
        }
        this.guesses = guesses.map(g => ({ map: g.map, url: g.url, lat: g.lat, lng: g.lng, submitter: g.submitter ?? null }));
        this.resetScores();
        this.round = 0;
        this.startsAt = this.now() + (this.allReady() ? COUNTDOWN_READY_MS : COUNTDOWN_FORCED_MS);
        this.load();
    }
```

`load()` ersetzen:

```js
    load() {
        this.phase = "loading";
        // round 1 loads cold, and not before its countdown ends; later rounds were preloaded during the previous one
        this.loadUntil = this.round === 0 ? Math.max(this.startsAt, this.now() + LOAD_FIRST_MS) : this.now() + LOAD_MS;
        // the usual case from the second round on: everyone preloaded it during the previous round
        if (this.startsAt === null && this.lateLoaders().length === 0) return this.startRound();
        this.broadcastState();
        this.broadcast(this.prepareMsg(this.round));
    }
```

Direkt unter `lateLoaders()` einfügen:

```js
    /**
     * Every connected guest said they are ready; the host's START is their ready
     */
    allReady() {
        return [...this.players.values()].every(p => !p.connected || p.id === this.hostId || p.lobbyReady);
    }
```

In `checkLoaded()` als erste Zeile des Rumpfs:

```js
        // the countdown runs out first, however early everyone has their images
        if (this.startsAt !== null && this.now() < this.startsAt) return;
```

Direkt unter `ready()` einfügen:

```js
    /**
     * A guest is ready (or not any more). Ignored silently outside the lobby: a click just as the host starts is normal
     */
    lobbyReady(player, ready) {
        if (this.phase !== "lobby" || typeof ready !== "boolean" || player.lobbyReady === ready) return;
        player.lobbyReady = ready;
        this.broadcastState();
    }
```

In `startRound()` als erste Zeile des Rumpfs:

```js
        this.startsAt = null;
```

In `toLobby()` zwischen der Zeile, die getrennte Spieler löscht, und `this.resetScores();`:

```js
        // the next game asks everyone again
        this.players.forEach(p => { p.lobbyReady = false; });
```

In `stateMsg()` unter `total: …`:

```js
            startsAt: this.startsAt,
```

und pro Spieler unter `stalled: p.stalled,`:

```js
                lobbyReady: p.lobbyReady,
```

In `addPlayer()` das Objekt um `lobbyReady: false` ergänzen:

```js
        const player = { id: randomUUID(), token: randomUUID(), name, conn, connected: true, awayUntil: 0, score: 0, answers: [], ready: -1, stalled: false, lobbyReady: false };
```

- [ ] **Step 7: Tests laufen lassen, sie müssen grün sein**

Run: `npm test 2>&1 | tail -12`
Expected: PASS, `# tests 87`, `# fail 0`.

- [ ] **Step 8: Lint**

Run: `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/`
Expected: keine Ausgabe.

- [ ] **Step 9: Commit**

```bash
git add server/session.js server/session.test.js
git commit -m "feat(mp): let guests mark themselves ready and count every start down before round 1"
```

---

### Task 2: Server – `cancelStart`

**Files:**
- Modify: `server/session.js` (`HOST_ACTIONS` Z. 13, `switch` in `handle`, neue Methode unter `start()`)
- Test: `server/session.test.js`

**Interfaces:**
- Consumes: aus Task 1 `startsAt`, `lobbyReady`, `allReady()`, `COUNTDOWN_READY_MS`, `begin`. Aus dem Branch `resetScores()` und `isPresent(p)`.
- Produces: Host-Aktion `{ type: "cancelStart" }`, `Session#cancelStart(conn)`.

- [ ] **Step 1: Failing Test ans Dateiende anhängen**

```js
test("the host can call the start off until round 1 runs: back to the lobby, ready marks stay, who left is gone", () => {
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
    assert.deepEqual(state.players.map(p => [p.name, p.lobbyReady]), [["Hans", false], ["Max", true]]);
    assert.deepEqual([...s.players.values()].map(p => [p.ready, p.stalled]), [[-1, false], [-1, false]]);
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
```

- [ ] **Step 2: Test laufen lassen, er muss fehlschlagen**

Run: `npm test 2>&1 | tail -12`
Expected: FAIL in `the host can call the start off …`. `cancelStart` steht nicht in `HOST_ACTIONS`, deshalb bekommt der Gast `INVALID` statt `NOT_HOST`.

- [ ] **Step 3: Implementieren**

`HOST_ACTIONS` ersetzen:

```js
const HOST_ACTIONS = ["settings", "start", "cancelStart", "endRound", "next", "lobby"];
```

Im `switch` von `handle()` unter dem `start`-Fall:

```js
        case "cancelStart": return this.cancelStart(conn);
```

Direkt unter `start()` einfügen:

```js
    /**
     * Calls a start off as long as round 1 has not begun: back to the lobby, who was ready stays ready
     */
    cancelStart(conn) {
        if (this.phase !== "loading" || this.round !== 0) return this.error(conn, "INVALID");
        this.phase = "lobby";
        this.guesses = [];
        this.startsAt = null;
        this.loadUntil = null;
        // like leaving the lobby: who left during the countdown is gone, a reload in progress keeps its place
        this.players.forEach(p => { if (!this.isPresent(p)) this.players.delete(p.id); });
        this.resetScores();
        this.broadcastState();
    }
```

- [ ] **Step 4: Tests laufen lassen, sie müssen grün sein**

Run: `npm test 2>&1 | tail -12`
Expected: PASS, `# tests 88`, `# fail 0`.

- [ ] **Step 5: Lint**

Run: `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/`
Expected: keine Ausgabe.

- [ ] **Step 6: Commit**

```bash
git add server/session.js server/session.test.js
git commit -m "feat(mp): let the host call a start off until round 1 runs"
```

---

### Task 3: Client – Ready-Button, ✓, START/START ANYWAY, CANCEL und Countdown

**Files:**
- Modify: `src/js/clock.js`, `server/clock.test.js`
- Modify: `src/js/multiplayer.js` (Imports Z. 5, Konstruktor Z. 18–39, `init` Z. 41, `stop` Z. 208, `renderState` Z. 321, `renderStatus` Z. 344, `startCountdown` Z. 466, `renderPlayers` Z. 604)
- Modify: `src/components/lobby/lobby.html`, `src/components/lobby/lobby.scss`
- Modify: `src/i18n/en.json`, `src/i18n/zh.json`, `CHANGELOG.md`

**Interfaces:**
- Consumes: aus Task 1 und 2 `state.startsAt`, `state.players[].lobbyReady` und die Nachrichten `lobbyReady`/`cancelStart`. Aus dem Branch `this.offset`, `this.guessFetch`, `this.preloader.keep(urls)`, `loadMark(s, p)`, `app.setButtonLoading($button, bool)`, die Statuszeile `#mpLobbyStatus` und `#mpWaitingForHost`.
- Produces: `secondsUntil(at, offset, now)` in `src/js/clock.js`, die Buttons `#BUTTON_MP_READY` und `#BUTTON_MP_CANCEL`, die Methoden `renderLobbyButtons(s, starting)`, `renderLoadingStatus()` und `doneMark(s, p)`, das Feld `this.startTimer`.

- [ ] **Step 1: Failing Test für `secondsUntil`**

`server/clock.test.js`: Import ersetzen und Test anhängen:

```js
import { updateOffset, secondsUntil } from "../src/js/clock.js";
```

```js
test("secondsUntil counts whole seconds down to a server time on the local clock, never below 0", () => {
    // the server clock is 2000ms ahead: server time 15000 is local 13000
    assert.equal(secondsUntil(15000, 2000, 10000), 3);
    assert.equal(secondsUntil(15000, 2000, 10001), 3);
    assert.equal(secondsUntil(15000, 2000, 12001), 1);
    assert.equal(secondsUntil(15000, 2000, 13000), 0);
    assert.equal(secondsUntil(15000, 2000, 20000), 0);
    // no message with a server time yet
    assert.equal(secondsUntil(15000, null, 10000), 5);
});
```

- [ ] **Step 2: Test laufen lassen, er muss fehlschlagen**

Run: `npm test 2>&1 | tail -12`
Expected: FAIL. `secondsUntil` ist kein Export von `clock.js` (SyntaxError beim Import).

- [ ] **Step 3: `secondsUntil` implementieren und im Runden-Countdown nutzen**

An `src/js/clock.js` anhängen:

```js
/**
 * Whole seconds left until a server time (e.g. a deadline), as the local clock sees it; never below 0
 */
export function secondsUntil(at, offset, now) {
    return Math.max(0, Math.ceil((at - now - (offset ?? 0)) / 1000));
}
```

In `src/js/multiplayer.js` den Import ersetzen:

```js
import { updateOffset, secondsUntil } from "./clock.js";
```

In `startCountdown()` die Zeile mit `Math.ceil` ersetzen:

```js
            const left = secondsUntil(deadline, this.offset, Date.now());
```

- [ ] **Step 4: Tests laufen lassen, sie müssen grün sein**

Run: `npm test 2>&1 | tail -12`
Expected: PASS, `# tests 89`, `# fail 0`.

- [ ] **Step 5: Buttons in der Lobby**

In `src/components/lobby/lobby.html` die `.button-container` im `#mpRoom` ersetzen:

```html
        <div class="button-container">
            <button id="BUTTON_MP_LEAVE" data-i18n="common:mp.buttons.leave"></button>
            <button id="BUTTON_MP_READY" class="guest-only" aria-pressed="false" data-i18n="common:mp.buttons.ready"></button>
            <button id="BUTTON_MP_START" class="host-only" data-i18n="common:mp.buttons.start"></button>
            <button id="BUTTON_MP_CANCEL" class="host-only" data-i18n="common:mp.buttons.cancel" hidden></button>
        </div>
```

- [ ] **Step 6: Texte**

`src/i18n/en.json`, im Objekt `mp`: unter `"loadingImages"` einfügen:

```json
        "startingIn": "Starting in {{seconds}} s…",
```

und in `mp.buttons` unter `"start": "START",`:

```json
            "forceStart": "START ANYWAY",
            "ready": "READY",
            "cancel": "CANCEL",
```

`src/i18n/zh.json`, im Objekt `mp`: unter `"loadingImages"` einfügen:

```json
        "startingIn": "{{seconds}} 秒后开始…",
```

und in `mp.buttons` unter `"start": "开始",`:

```json
            "forceStart": "强制开始",
            "ready": "准备",
            "cancel": "取消",
```

Prüfen, dass beide Dateien gültiges JSON sind:

Run: `node -e "for (const f of ['en', 'zh']) JSON.parse(require('fs').readFileSync('src/i18n/' + f + '.json', 'utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 7: Styles**

In `src/components/lobby/lobby.scss` im Block `#lobby { … }` direkt unter dem Block `#mpWatchLink { … }` einfügen:

```scss
    // a ready guest's button turns green and gets a tick
    #BUTTON_MP_READY[aria-pressed="true"] {
        background: variables.$newColor;
        &::before {
            content: "✓ ";
        }
    }
    // the start countdown: what everyone in the room looks at
    #mpLobbyStatus {
        font-size: 1.5em;
        font-weight: bold;
    }
```

Im Block `body.watch-mode` die erste Selektorliste ersetzen. Zuschauer sind kein Host, also wäre `guest-only` dort sichtbar:

```scss
    #actions,
    #score,
    #mpEntry,
    #BUTTON_MP_READY {
        display: none !important;
    }
```

- [ ] **Step 8: `multiplayer.js` – Zustand, Klicks, Aufräumen**

Im Konstruktor unter `this.guessFetch = null;`:

```js
        // ticks the start countdown on between two states, null when none runs
        this.startTimer = null;
```

In `init()` unter der Zeile mit `BUTTON_MP_START`:

```js
        $("#BUTTON_MP_READY").on("click", () => {
            const me = this.state?.players.find(p => p.id === this.me);
            if (me) this.send({ type: "lobbyReady", ready: !me.lobbyReady });
        });
        $("#BUTTON_MP_CANCEL").on("click", () => {
            // one click is enough: a second one would only arrive after the start is off (INVALID); renderLobbyButtons unlocks
            $("#BUTTON_MP_CANCEL").prop("disabled", true);
            this.send({ type: "cancelStart" });
        });
```

In `stop()` unter `clearInterval(this.countdown);`:

```js
        clearInterval(this.startTimer);
```

In `renderState()` die Zeile `if (s.phase === "lobby") this.showRoom();` ersetzen:

```js
        if (s.phase === "lobby") {
            // a start that was called off leaves nothing loading or retrying behind
            this.preloader.keep([]);
            this.showRoom();
        }
```

- [ ] **Step 9: `multiplayer.js` – Statuszeile, Buttons, ✓**

`renderStatus()` vollständig ersetzen:

```js
    renderStatus() {
        const s = this.state;
        if (!s) return;
        const host = this.isHost();
        const last = s.round + 1 === s.total;
        const loading = s.phase === "loading";
        // round 1 is on its way (countdown, then maybe slow devices): the host can still call it off
        const starting = loading && s.round === 0;
        $("#BUTTON_MP_ENDROUND").prop("hidden", s.phase !== "round" || !host || s.settings.timer > 0);
        // any answer from the server unlocks NEXT / RESULTS (see next())
        clearTimeout(this.nextTimer);
        this.app.BUTTON_NEXT.prop({ hidden: s.phase !== "reveal" || !host || last, disabled: false });
        this.app.BUTTON_RESULTS.prop({ hidden: s.phase !== "reveal" || !host || !last, disabled: false });
        this.renderLobbyButtons(s, starting);
        // the lobby stays on screen while the first round loads: the start went through, the settings are fixed
        $("#mpSettings select").prop("disabled", s.phase !== "lobby");
        $("#mpWaitingForHost").prop("hidden", loading);
        $("#mpLobbyStatus").prop("hidden", !loading);
        clearInterval(this.startTimer);
        if (loading) {
            this.renderLoadingStatus();
            if (s.startsAt !== null) this.startTimer = setInterval(() => this.renderLoadingStatus(), 250);
            $("#mpStatus").prop("hidden", false);
            return;
        }
        if (s.phase === "reveal") $("#mpStatus").text(i18next.t("mp.waitingForHost", { ns: "common" })).prop("hidden", host);
        if (s.phase !== "round") return;
        const online = s.players.filter(p => p.connected);
        const text = i18next.t("mp.waitingForPlayers", {
            ns: "common",
            answered: online.filter(p => p.answered).length,
            total: online.length,
        });
        $("#mpStatus").text(text).prop("hidden", !this.answered && !this.watching);
    }

    /**
     * READY for guests, START / START ANYWAY and CANCEL for the host
     */
    renderLobbyButtons(s, starting) {
        const me = s.players.find(p => p.id === this.me);
        $("#BUTTON_MP_READY").prop("hidden", s.phase !== "lobby").attr("aria-pressed", String(Boolean(me?.lobbyReady)));
        const $start = $("#BUTTON_MP_START");
        this.app.setButtonLoading($start, Boolean(this.guessFetch));
        $start.prop("hidden", starting);
        // not while it spins: setButtonLoading puts back the text it saved when the spinning began
        if (!this.guessFetch) {
            // the server's rule (Session.allReady): every connected guest is ready, the host's START is their ready
            const allReady = s.players.every(p => !p.connected || p.id === s.hostId || p.lobbyReady);
            const key = allReady ? "mp.buttons.start" : "mp.buttons.forceStart";
            // through data-i18n, so a language switch keeps the right label
            $start.attr("data-i18n", `common:${key}`).text(i18next.t(key, { ns: "common" }));
        }
        $("#BUTTON_MP_CANCEL").prop("hidden", !starting);
        // a clicked CANCEL stays locked until the start is off or round 1 runs
        if (!starting) $("#BUTTON_MP_CANCEL").prop("disabled", false);
    }

    /**
     * Status line while a round waits: before round 1 the countdown, then how many have their images (startTimer ticks it)
     */
    renderLoadingStatus() {
        const s = this.state;
        const left = s.startsAt === null ? 0 : secondsUntil(s.startsAt, this.offset, Date.now());
        if (left === 0) clearInterval(this.startTimer);
        const waited = s.players.filter(p => p.connected && !p.stalled);
        const text = left > 0
            ? i18next.t("mp.startingIn", { ns: "common", seconds: left })
            : i18next.t("mp.loadingImages", { ns: "common", ready: waited.filter(p => p.ready).length, total: waited.length });
        $("#mpStatus, #mpLobbyStatus").text(text);
    }
```

In `renderPlayers()` die `.text(…)`-Zeile ersetzen:

```js
            .text([`${p.id === s.hostId ? "👑 " : ""}${p.name}${this.doneMark(s, p) ? " ✓" : ""}`, this.loadMark(s, p)].filter(Boolean).join(" "))
```

Direkt über `loadMark()` einfügen:

```js
    /**
     * ✓ for whoever answered the running round, and in the lobby for a guest who is ready (the host never needs to be)
     */
    doneMark(s, p) {
        if (s.phase === "round") return p.answered;
        return s.phase === "lobby" && p.lobbyReady && p.id !== s.hostId;
    }
```

- [ ] **Step 10: Changelog**

In `CHANGELOG.md` unter 1.4.0, „new features“, nach der Zeile „Multiplayer rounds start for everyone at the same moment …“:

```markdown
- Multiplayer guests can mark themselves ready; every start counts down (5 s when everyone is ready, 15 s when the host starts anyway) while all phones load the first round, and the host can call it off
```

- [ ] **Step 11: Tests, Lint, Build**

Run: `npm test 2>&1 | tail -12`
Expected: PASS, `# tests 89`, `# fail 0`.

Run: `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/`
Expected: keine Ausgabe.

Run: `npx stylelint -c ./config/.stylelintrc.json src/components/lobby/lobby.scss`
Expected: keine Ausgabe.

Run: `npx htmlhint --config ./config/.htmlhintrc.json --nocolor ./src/`
Expected: `Scanned … files, no errors found`.

Run: `docker run --rm -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack -c ./config/webpack.config.js 2>&1 | grep -E "compiled|ERROR"`
Expected: `… compiled successfully …`, kein `ERROR`.

- [ ] **Step 12: Commit**

```bash
git add src/js/clock.js server/clock.test.js src/js/multiplayer.js src/components/lobby/lobby.html src/components/lobby/lobby.scss src/i18n/en.json src/i18n/zh.json CHANGELOG.md
git commit -m "feat(mp): ready button, start countdown and cancel in the lobby"
```

---

### Task 4: Prüfung im Browser

**Files:** keine Änderungen, außer ein Check deckt einen Fehler auf. Dann wird er in der Datei behoben, die ihn verursacht, mit eigenem Commit `fix(mp): …`.

**Interfaces:**
- Consumes: alles aus Task 1–3.
- Produces: nichts, nur der Prüfbericht.

Ablauf wie im Repo üblich: Chrome-Erweiterung, ein Origin pro Spieler (jeder hat sein eigenes `localStorage`). Hintergrund-Tabs drosseln Timer: Zustand per `javascript_tool` auslesen statt per Screenshot.

- [ ] **Step 1: Server starten**

MP-Server mit Bash `run_in_background`: `node server/index.js`

Dev-Server:

```bash
docker run -d --rm --name sg-dev-test --network host -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack serve -c ./config/webpack.config.js
```

Warten, bis `docker logs sg-dev-test 2>&1 | grep -c "compiled successfully"` ≥ 1 ist.
Ist `localhost:3000` in der Erweiterung nicht erreichbar (`ERR_CONNECTION_REFUSED`), hängt die Erweiterung an einem anderen Rechner. Dann den Nutzer bitten, Chrome auf diesem Rechner zu öffnen, und `list_connected_browsers` + `select_browser` verwenden.

- [ ] **Step 2: Lobby aufbauen**

- Host: `http://localhost:3000`, Multiplayer, Name „Host“, CREATE SESSION.
- Prüfen, dass auf dem START-Button „START“ steht (Host allein).
- Gast A: `http://127.0.0.1:3000/?join=CODE`, Name „A“.
- Gast B: `http://192.168.178.40:3000/?join=CODE`, Name „B“.
- Big Screen: `http://localhost:3000/?watch=CODE` in einem weiteren Tab.

Erwartet:
- Beim Host steht auf dem Button jetzt „START ANYWAY“.
- Beide Gäste haben einen READY-Button.
- Der Big Screen hat **keinen** READY-Button: `$("#BUTTON_MP_READY").is(":visible") === false`.

- [ ] **Step 3: Ready umschalten**

- A klickt READY. Erwartet:
  - Bei Host, B und Big Screen steht „A ✓“ in `#mpPlayers`.
  - Bei A ist der Button grün, „✓ READY“, `aria-pressed="true"`.
  - Beim Host steht weiter „START ANYWAY“.
- B klickt READY. Erwartet: Beim Host steht „START“.
- B klickt noch einmal. Erwartet: Das ✓ von B ist weg, beim Host steht „START ANYWAY“.

- [ ] **Step 4: Erzwungener Start, synchron**

B ist nicht bereit. Der Host klickt „START ANYWAY“. Erwartet:
- Auf allen vier Tabs zeigt `#mpLobbyStatus` „Starting in N s…“, N beginnt bei 15 und zählt herunter.
- Liest man die Zeile auf allen Tabs im selben Moment aus, ist N überall gleich (±1).
- Beim Host ist START ausgeblendet und CANCEL sichtbar.
- Bei den Gästen ist READY ausgeblendet. Die Selects beim Host sind gesperrt.
- Nach etwa 15 s erscheint Runde 1 auf allen Bildschirmen, ohne ⏳-Wartezeit danach (die Bilder sind vorgeladen). Prüfen mit `performance.getEntriesByType("resource")`: Hint und Karte von Runde 1 wurden **vor** dem Rundenstart geladen.

- [ ] **Step 5: Kurzer Countdown**

Das Spiel bis zum Ende spielen (Host: Runde beenden, Weiter, Ergebnisse) und „Play again“ klicken. Erwartet: Zurück in der Lobby sind alle ✓ weg (Spec: Ready wird nach einem Spiel zurückgesetzt).

A und B klicken READY, der Host klickt START. Erwartet: Der Countdown beginnt bei 5.

- [ ] **Step 6: Abbrechen**

Nach Runde 1 wieder „Play again“, dann der Host „START ANYWAY“ (A bereit, B nicht). Bei etwa 10 s Restzeit klickt der Host CANCEL **zweimal schnell hintereinander**. Erwartet:
- Alle Tabs sind wieder in der normalen Lobby.
- Das ✓ von A steht noch.
- „Waiting for the host…“ ist bei den Gästen wieder sichtbar.
- START steht wieder da, mit „START ANYWAY“ und ohne Spinner.
- Es gibt **keinen** Toast „Invalid request“.

Danach startet der Host erneut. Erwartet: Der Countdown läuft wieder.

- [ ] **Step 7: Neu laden und Big Screen während des Countdowns**

Während eines laufenden 15-s-Countdowns:
- Den Tab von Gast A neu laden. Erwartet: Lobby mit laufendem Countdown, nicht das Hauptmenü.
- Den Big Screen neu laden. Erwartet: ebenso.

- [ ] **Step 8: Host geht während des Countdowns**

Während eines Countdowns klickt der Host LEAVE. Erwartet: Einer der Gäste wird Host, das 👑 wandert, und er sieht CANCEL. Der Countdown läuft weiter, und Runde 1 startet.

- [ ] **Step 9: START nach fehlgeschlagenem Laden der Guesses**

In einer frischen Lobby (Host + ein Gast, nicht bereit) im Host-Tab per `javascript_tool` die Guess-Anfrage scheitern lassen:

```js
window.__fetch = window.fetch; window.fetch = () => Promise.reject(new TypeError("blocked"));
```

Der Host klickt „START ANYWAY“. Erwartet: Fehler-Toast „Could not load guesses“, danach steht auf dem Button wieder „START ANYWAY“, ohne Spinner und klickbar. Anschließend `window.fetch = window.__fetch;`.

(`getGuess` in `src/js/squadGuessr.js` lädt per `fetch`; der Vorlader nutzt `Image` und ist davon nicht betroffen.)

- [ ] **Step 10: Aufräumen**

```bash
docker stop sg-dev-test
pkill -f '[n]ode server/index.js'
```

Ergebnis jedes Steps im Bericht festhalten: bestanden oder nicht, und bei Fehlern was genau.
