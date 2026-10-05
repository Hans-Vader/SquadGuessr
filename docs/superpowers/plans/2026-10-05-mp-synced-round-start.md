# Synchroner Rundenstart mit Vorladen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Im Multiplayer sehen alle Spieler das Bild einer Runde zur selben Zeit, und die Uhr läuft erst ab dann; die Bilder der nächsten Runde laden im Hintergrund vor, damit das im Normalfall keine Wartezeit kostet.

**Architecture:** Der Server (`server/session.js`) bekommt eine Phase `loading` vor jeder Runde, die Nachrichten `prepare` (Server → Clients: „lade diese Bilder“) und `ready` (Client → Server: „habe sie“) sowie eine Frist (12 s / 5 s) mit `stalled`-Merker. Der Client lädt mit einem kleinen, testbaren Modul `src/js/preloader.js` vor und hält die Bilder referenziert, damit `#hint` und Leaflet sie ohne neue Anfrage bekommen. Hint und Karte zeigen einen Spinner bzw. versuchen fehlgeschlagene Bilder jede Sekunde erneut.

**Tech Stack:** Node ≥ 18 (ESM, `node:test`), `ws` 8, Webpack 5, jQuery, Leaflet 2 (alpha), i18next.

**Spec:** `docs/superpowers/specs/2026-10-05-mp-synced-round-start-design.md`

## Global Constraints

- Keine `Co-Authored-By`- oder andere AI-Attribution in Commit-Messages (globale Nutzer-Anweisung). Subagents ausdrücklich darauf hinweisen.
- Arbeiten auf dem Branch `feature/mp-synced-round-start`.
- Codestil wie im Repo: 4 Spaces, doppelte Anführungszeichen, Semikolons, ESM. Klassen ohne Klassenfelder und ohne `#private` (jshint `esversion: 11`). Spielernamen nur per `.text()`/`textContent`, nie per `.html()`.
- Konstanten exakt: `LOAD_FIRST_MS = 12 * 1000`, `LOAD_MS = 5 * 1000` (Server), `RETRY_MS = 1000` (Client), `NEXT_UNLOCK_MS = 5000` (Client).
- Texte exakt: `mp.loadingImages` = en `Loading images… ({{ready}}/{{total}})`, zh `图片加载中…（{{ready}}/{{total}}）`.
- In Find the Map wird die Karte nie vor der Auflösung gesendet oder geladen (`map` in `prepare`/`round` ist `null`).
- Tests: `npm test` (läuft mit dem Node 18 dieses Rechners).
- Lint: `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/` muss ohne Ausgabe durchlaufen. **Nie `npm run lint`**: jshint 0.5.9 stürzt ab, und `eslint --fix` stellt alle Dateien auf CRLF um.
- Build (Node ≥ 20 nötig, der Rechner hat Node 18): `docker run --rm -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack -c ./config/webpack.config.js` – die Ausgabe muss `webpack … compiled successfully` enthalten (npm-Hinweiszeilen danach sind egal). Voraussetzung: eine `.env` im Repo-Root (existiert lokal).
- Browser-Prüfungen werden per Chrome-Erweiterung und Konsole gefahren, ohne DevTools: Anfragen beobachten per `performance.getEntriesByType("resource")` bzw. `read_network_requests`, Bilder sperren per Konsolen-Patch (in Task 3 und 5 angegeben). Dev-Server und MP-Server werden im Hintergrund gestartet, damit der Shell-Aufruf nicht hängt.
- Der Singleplayer verhält sich unverändert – bis auf Spinner im Hint-Bereich, Wiederholung fehlgeschlagener Bilder und dass sein Timer auch startet, wenn das Hint-Bild fehlschlägt.

## Review Focus

1. **Ab Runde 2 macht der Rundenstart keine Bildanfrage** – sonst ist das Vorladen wirkungslos (z. B. weil die Referenz verloren ging oder die URL nicht exakt übereinstimmt). Geprüft in Task 5, Step 4 („Kein Netzwerk beim Rundenstart“).
2. **Eine Seite, die während des Wartens neu geladen oder als Big-Screen geöffnet wird, zeigt die Lobby mit ⏳ und Statuszeile**, nicht das Hauptmenü. Geprüft in Task 5, Step 5.
3. **Der Start-Button des Hosts zeigt nach einem Spiel wieder „START“** (kein hängender Spinner, kein „Loading…“ als Dauertext) und die Einstellungen sind in der Lobby wieder bedienbar. Geprüft in Task 5, Step 7.
4. **Find the Map lädt die Karte nie vor der Auflösung.** Geprüft in Task 1 (Servertest `prepare.map` ist `null`) und Task 5, Step 8 (keine `basemap`-Anfrage vor der Auflösung).
5. **Singleplayer:** Der Timer startet nach dem Laden des Hints; ein fehlschlagendes Hint-Bild zeigt den Spinner, wird jede Sekunde neu versucht, der Timer startet trotzdem, und auf dem Ergebnis-Bildschirm hören die Versuche auf. Geprüft in Task 3, Step 6.

---

## File Structure

| Datei | Neu/Ändern | Verantwortung |
|---|---|---|
| `server/session.js` | ändern | Phase `loading`, `prepare`/`ready`, Frist, `stalled`, `sendPhase` |
| `server/session.test.js` | ändern | Helfer `readyAll`, 10 angepasste und 18 neue Tests |
| `src/js/preloader.js` | neu | Vorlader: Bilder nacheinander laden, referenziert halten, Fehlschläge wiederholen; exportiert `RETRY_MS` |
| `server/preloader.test.js` | neu | Tests für den Vorlader mit Fake-`Image` und Fake-Timern |
| `src/js/data/maps.js` | ändern | `basemapUrl(map)` |
| `src/js/squadMinimap.js` | ändern | Karten-URL über `basemapUrl`, Wiederholung, Promise für den ersten Ladeversuch |
| `src/js/squadGuessr.js` | ändern | `hintUrl()`, `setupHint()` mit Spinner/Wiederholung/Fehlerpfad, `setupMap()` gibt Promise zurück, Weiter/Ergebnisse über `mp.next()` |
| `src/components/game/game.scss` | ändern | Spinner im Hint-Bereich |
| `src/js/multiplayer.js` | ändern | `prepare`-Handler, `ready`, `this.visible`, ⏳/💤, Statuszeile, Start-Button, Settings-Sperre, `next()` |
| `src/components/lobby/lobby.html` | ändern | Statuszeile in der Lobby, id für „Waiting for the host …“ |
| `src/i18n/en.json`, `src/i18n/zh.json` | ändern | `mp.loadingImages` |
| `CHANGELOG.md` | ändern | Eintrag unter 1.4.0 |

---

### Task 1: Server – Phase `loading`, `prepare`/`ready`, Frist und `stalled`

**Files:**
- Modify: `server/session.js`
- Test: `server/session.test.js`

**Interfaces:**
- Consumes: nichts aus anderen Tasks.
- Produces (für Task 4, den Client):
  - Server → Client `{ type: "prepare", index: number, url: string, map: string | null }`. `map` ist in Find the Map immer `null`.
  - Client → Server `{ type: "ready", index: number }`, wird nie mit einem Fehler beantwortet.
  - `state.phase` kann zusätzlich `"loading"` sein; `state.players[]` hat zusätzlich `ready: boolean` (nur in `loading` je true) und `stalled: boolean`.
  - Reihenfolge beim Rundenstart: `state` → `round` → `prepare(round + 1)`.
  - Exporte `LOAD_FIRST_MS`, `LOAD_MS`.

- [ ] **Step 1: Test-Helfer einführen und bestehende Tests anpassen**

In `server/session.test.js` den Import erweitern:

```js
import { Session, MAX_PLAYERS, RECONNECT_MS, LOAD_FIRST_MS, LOAD_MS } from "./session.js";
```

`started()` ersetzen durch:

```js
// every connected player reports that round i's images are loaded
function readyAll(s, i) {
    s.players.forEach(p => { if (p.connected) s.handle(p.conn, { type: "ready", index: i }); });
}

function started(settings) {
    const ctx = withGuest(settings);
    ctx.s.handle(ctx.host, { type: "start", guesses: GUESSES });
    readyAll(ctx.s, 0);
    return ctx;
}
```

Den Reihenfolge-Test ersetzen (der Rundenstart kündigt jetzt die nächste Runde an):

```js
test("state is sent before round so clients know their answered flag, and the next round is announced after it", () => {
    const { sent, guest } = started();
    const types = sent.filter(x => x.conn === guest).map(x => x.msg.type);
    assert.deepEqual(types.slice(-3), ["state", "round", "prepare"]);
});
```

In diesen neun Tests vor dem jeweiligen `next` bzw. nach dem jeweiligen `start` ein `readyAll(...)` einfügen (sonst bleiben sie in `loading` hängen):

1. `"host reconnect keeps host role and score"` – vor `s.handle(reloaded, { type: "next" });`:
   ```js
       readyAll(s, 1);
   ```
2. `"final ranking with a tie has two winners, lobby resets"` – in der Schleife vor `s.handle(host, { type: "next" });`:
   ```js
           readyAll(s, s.round + 1);
   ```
3. `"watchers receive state and rounds but cannot act"` – nach `s.handle(host, { type: "start", guesses: GUESSES });`:
   ```js
       readyAll(s, 0);
   ```
4. `"a late answer for the previous round is rejected and does not use up the next round"` – vor `s.handle(host, { type: "next" });`:
   ```js
       readyAll(s, 1);
   ```
5. `"a host who leaves hands the host role to the next connected player"` – nach `s.handle(guest, { type: "start", guesses: GUESSES });`:
   ```js
       readyAll(s, 0);
   ```
6. `"a host who leaves mid-game hands over so the game can continue"` – vor `s.handle(guest, { type: "next" });`:
   ```js
       readyAll(s, 1);
   ```
7. `"a lobby guest whose connection drops keeps their place and can still get into the game"` – nach `s.handle(host, { type: "start", guesses: GUESSES });`:
   ```js
       readyAll(s, 0);
   ```
8. `"when nobody connected holds the host role, the next player who is there gets it"` – nach `s.handle(phone, { type: "start", guesses: GUESSES });`:
   ```js
       readyAll(s, 0);
   ```
9. `"back in the lobby, players who left or dropped out during the game are gone"` – in der Schleife vor `s.handle(host, { type: "next" });`:
   ```js
           readyAll(s, s.round + 1);
   ```

Alle anderen bestehenden Tests bleiben unverändert (auch der `deepEqual`-Test der Rundennachricht).

- [ ] **Step 2: Neue Tests ans Ende von `server/session.test.js` anhängen**

```js

// ===== LOADING: everyone sees a round at the same moment =====

test("start loads the first round before anyone sees it, and answers wait for it", () => {
    const { s, host, guest, last } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(s.phase, "loading");
    assert.equal(last(guest, "state").phase, "loading");
    assert.deepEqual(last(guest, "prepare"), { type: "prepare", index: 0, url: "/img/guesses/a.webp", map: "Narva" });
    assert.equal(last(guest, "round"), undefined);
    s.handle(host, { type: "answer", index: 0, lat: -100, lng: 200 });
    assert.equal(last(host, "error").code, "INVALID");
});

test("the round starts once every connected player has the images, and its clock starts only then", () => {
    const { s, host, guest, last, advance } = withGuest({ mode: "classic", timer: 15, rounds: 3 });
    s.handle(host, { type: "start", guesses: GUESSES });
    advance(3000);
    s.handle(host, { type: "ready", index: 0 });
    assert.equal(s.phase, "loading");
    assert.deepEqual(last(guest, "state").players.map(p => [p.name, p.ready, p.stalled]), [["Hans", true, false], ["Max", false, false]]);
    s.handle(guest, { type: "ready", index: 0 });
    assert.equal(s.phase, "round");
    assert.equal(last(guest, "round").deadline, 1000 + 3000 + 15000);
});

test("loading waits at most LOAD_FIRST_MS for the first round and LOAD_MS for later ones", () => {
    const { s, host, guest, advance } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "ready", index: 0 });
    advance(LOAD_FIRST_MS - 1);
    s.tick();
    assert.equal(s.phase, "loading");
    advance(1);
    s.tick();
    assert.equal(s.phase, "round");
    // a late ready brings Max back into the waiting
    s.handle(guest, { type: "ready", index: 0 });
    s.handle(host, { type: "endRound" });
    s.handle(host, { type: "ready", index: 1 });
    s.handle(host, { type: "next" });
    assert.equal(s.phase, "loading");
    advance(LOAD_MS - 1);
    s.tick();
    assert.equal(s.phase, "loading");
    advance(1);
    s.tick();
    assert.equal(s.phase, "round");
});

test("a player who missed the loading time is not waited for again until they report back", () => {
    const { s, host, guest, last, advance } = withGuest();
    const token = last(guest, "welcome").token;
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "ready", index: 0 });
    advance(LOAD_FIRST_MS);
    s.tick();
    assert.equal(last(host, "state").players.find(p => p.name === "Max").stalled, true);
    // the locked phone does not hold up the next round
    s.handle(host, { type: "endRound" });
    s.handle(host, { type: "ready", index: 1 });
    s.handle(host, { type: "next" });
    assert.equal(s.phase, "round");
    // coming back counts as reporting back: the round after waits for Max again
    s.disconnect(guest);
    const phone = {};
    s.join(phone, { token });
    assert.equal(last(host, "state").players.find(p => p.name === "Max").stalled, false);
    s.handle(host, { type: "endRound" });
    s.handle(host, { type: "ready", index: 2 });
    s.handle(host, { type: "next" });
    assert.equal(s.phase, "loading");
    s.handle(phone, { type: "ready", index: 2 });
    assert.equal(s.phase, "round");
});

test("when everyone preloaded the next round, next starts it at once without a loading state", () => {
    const { s, host, guest, sent } = started();
    s.handle(host, { type: "endRound" });
    readyAll(s, 1);
    const before = sent.length;
    s.handle(host, { type: "next" });
    assert.equal(s.phase, "round");
    const mine = sent.slice(before).filter(x => x.conn === guest).map(x => x.msg);
    assert.deepEqual(mine.map(m => m.type), ["state", "round", "prepare"]);
    assert.equal(mine[0].phase, "round");
});

test("every round start announces the next round, the last one announces nothing", () => {
    const { s, host, guest, all } = started();
    assert.deepEqual(all(guest, "prepare").map(m => m.index), [0, 1]);
    for (let i = 1; i < 3; i++) {
        s.handle(host, { type: "endRound" });
        readyAll(s, i);
        s.handle(host, { type: "next" });
    }
    assert.equal(s.round, 2);
    assert.deepEqual(all(guest, "prepare").map(m => m.index), [0, 1, 2]);
});

test("a player whose connection drops while loading is not waited for", () => {
    const { s, host, guest } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "ready", index: 0 });
    s.disconnect(guest);
    s.tick();
    assert.equal(s.phase, "round");
});

test("when the only player still loading leaves, the round starts at once", () => {
    const { s, host, guest } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "ready", index: 0 });
    s.handle(guest, { type: "leave" });
    assert.equal(s.phase, "round");
});

test("with every player disconnected, loading waits instead of starting the clock", () => {
    const { s, host, guest, advance } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    s.disconnect(host);
    s.disconnect(guest);
    advance(LOAD_FIRST_MS);
    s.tick();
    assert.equal(s.phase, "loading");
});

test("a player who reconnects while loading gets the images again and is waited for, without extending the time", () => {
    const { s, host, guest, last, advance } = withGuest();
    const token = last(guest, "welcome").token;
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "ready", index: 0 });
    advance(5000);
    s.disconnect(guest);
    const phone = {};
    s.join(phone, { token });
    assert.equal(last(phone, "prepare").index, 0);
    advance(LOAD_FIRST_MS - 5000 - 1);
    s.tick();
    assert.equal(s.phase, "loading");
    advance(1);
    s.tick();
    assert.equal(s.phase, "round");
});

test("a player who reloads during a round gets the next round's images again and is waited for", () => {
    const { s, host, guest, last } = started();
    readyAll(s, 1);
    const token = last(guest, "welcome").token;
    s.disconnect(guest);
    const phone = {};
    s.join(phone, { token });
    assert.equal(last(phone, "round").index, 0);
    assert.equal(last(phone, "prepare").index, 1);
    s.handle(host, { type: "endRound" });
    s.handle(host, { type: "next" });
    // the reloaded page lost its preloaded images
    assert.equal(s.phase, "loading");
    s.handle(phone, { type: "ready", index: 1 });
    assert.equal(s.phase, "round");
});

test("a player who reconnects during the reveal gets the next round's images too", () => {
    const { s, host, guest, last } = started();
    const token = last(guest, "welcome").token;
    s.handle(host, { type: "endRound" });
    s.disconnect(guest);
    const phone = {};
    s.join(phone, { token });
    assert.equal(last(phone, "reveal").index, 0);
    assert.equal(last(phone, "prepare").index, 1);
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
    assert.equal(s.phase, "loading");
    assert.deepEqual(all(guest, "error"), []);
});

test("watchers get the images to preload but are never waited for", () => {
    const { s, host, last } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    const tv = {};
    s.watch(tv);
    assert.equal(last(tv, "state").phase, "loading");
    assert.equal(last(tv, "prepare").index, 0);
    readyAll(s, 0);
    assert.equal(s.phase, "round");
    assert.equal(last(tv, "prepare").index, 1);
});

test("mapFinder never sends the map ahead, not even for preloading", () => {
    const { guest, all } = started({ mode: "mapFinder", timer: 0, rounds: 3 });
    assert.deepEqual(all(guest, "prepare").map(m => m.map), [null, null]);
});

test("nobody can join while the first round is loading", () => {
    const { s, host, last } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    const late = {};
    assert.equal(s.join(late, { name: "Late" }), false);
    assert.equal(last(late, "error").code, "GAME_RUNNING");
});

test("a new game waits for everyone's images again", () => {
    const { s, host } = started();
    for (let i = 0; i < 3; i++) {
        s.handle(host, { type: "endRound" });
        readyAll(s, s.round + 1);
        s.handle(host, { type: "next" });
    }
    s.handle(host, { type: "lobby" });
    s.handle(host, { type: "start", guesses: GUESSES });
    assert.equal(s.phase, "loading");
});

test("a ready for a round that is over, or after the game, changes nothing", () => {
    const { s, host, guest, all, advance } = withGuest();
    s.handle(host, { type: "start", guesses: GUESSES });
    s.handle(host, { type: "ready", index: 0 });
    advance(LOAD_FIRST_MS);
    s.tick();
    s.handle(host, { type: "endRound" });
    s.handle(host, { type: "ready", index: 1 });
    s.handle(host, { type: "next" });
    assert.equal(s.round, 1);
    s.handle(guest, { type: "ready", index: 0 });
    assert.equal(s.findPlayer(p => p.name === "Max").stalled, true);
    s.handle(host, { type: "ready", index: 2 });
    s.handle(host, { type: "endRound" });
    s.handle(host, { type: "next" });
    s.handle(host, { type: "endRound" });
    s.handle(host, { type: "next" });
    assert.equal(s.phase, "final");
    s.handle(guest, { type: "ready", index: 2 });
    assert.deepEqual(all(guest, "error"), []);
});
```

- [ ] **Step 3: Tests laufen lassen – sie müssen fehlschlagen**

Run: `npm test`
Expected: FAIL – `session.test.js` lädt nicht: `SyntaxError: The requested module './session.js' does not provide an export named 'LOAD_FIRST_MS'`.

- [ ] **Step 4: `server/session.js` umsetzen**

Nach `export const RECONNECT_MS = 15 * 1000;` einfügen:

```js
// how long a round waits for slow devices to load its images: the first one cold, later ones were preloaded
export const LOAD_FIRST_MS = 12 * 1000;
export const LOAD_MS = 5 * 1000;
```

Den Klassenkommentar ersetzen durch:

```js
/**
 * One multiplayer session: lobby → loading → round → reveal → loading → … → final
 * Knows nothing about sockets: `send(conn, msg)` is injected and `conn` is opaque.
 * On every phase change `state` is sent before `prepare`/`round`/`reveal`/`final`.
 */
```

Im Konstruktor nach `this.deadline = null;`:

```js
        this.loadUntil = null;
```

In `handle()` zwischen der `answer`- und der `leave`-Zeile (also **vor** der `HOST_ACTIONS`-Prüfung):

```js
        if (msg.type === "ready") return this.ready(player, msg.index);
```

In `start()` die letzte Zeile `this.startRound();` durch `this.load();` ersetzen, und zwischen `start()` und `startRound()` einfügen:

```js
    /**
     * Holds the round back until every connected player has its images (or the time is up), so all see it at once
     */
    load() {
        this.phase = "loading";
        this.loadUntil = this.now() + (this.round === 0 ? LOAD_FIRST_MS : LOAD_MS);
        // the usual case from the second round on: everyone preloaded it during the previous round
        if (this.lateLoaders().length === 0) return this.startRound();
        this.broadcastState();
        this.broadcast(this.prepareMsg(this.round));
    }

    /**
     * Who the loading round waits for: watchers never count, nor does a player whose connection is gone
     */
    lateLoaders() {
        return [...this.players.values()].filter(p => p.connected && !p.stalled && p.ready < this.round);
    }

    checkLoaded() {
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
```

`startRound()` am Ende ergänzen:

```js
    startRound() {
        this.phase = "round";
        this.deadline = this.settings.timer > 0 ? this.now() + this.settings.timer * 1000 : null;
        this.broadcastState();
        this.broadcast(this.roundMsg());
        // the next round's images load while this one is played
        if (this.round + 1 < this.guesses.length) this.broadcast(this.prepareMsg(this.round + 1));
    }
```

`checkRoundEnd()` bekommt als erste Zeile:

```js
        if (this.phase === "loading") return this.checkLoaded();
```

In `next()` `return this.startRound();` durch `return this.load();` ersetzen.

In `stateMsg()` nach der `answered`-Zeile:

```js
                ready: this.phase === "loading" && p.ready >= this.round,
                stalled: p.stalled,
```

`roundMsg()` ersetzen durch:

```js
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
```

In `addPlayer()` das Spielerobjekt um `ready: -1, stalled: false` erweitern:

```js
        const player = { id: randomUUID(), token: randomUUID(), name, conn, connected: true, awayUntil: 0, score: 0, answers: [], ready: -1, stalled: false };
```

In `reconnect()` nach `player.connected = true;` (also **vor** `this.broadcastState()`):

```js
        // a reload loses the preloaded images: the client reports them again for the prepare that sendPhase resends
        player.ready = Math.min(player.ready, this.round - 1);
        player.stalled = false;
```

`sendPhase()` ersetzen durch:

```js
    sendPhase(conn) {
        if (this.phase === "loading") this.send(conn, this.prepareMsg(this.round));
        if (this.phase === "round") this.send(conn, this.roundMsg());
        if (this.phase === "reveal") this.send(conn, this.revealMsg());
        if (this.phase === "final") this.send(conn, this.finalMsg());
        if (["round", "reveal"].includes(this.phase) && this.round + 1 < this.guesses.length) {
            this.send(conn, this.prepareMsg(this.round + 1));
        }
    }
```

`resetScores()` ersetzen durch:

```js
    resetScores() {
        this.players.forEach(p => { p.score = 0; p.answers = []; p.ready = -1; p.stalled = false; });
    }
```

- [ ] **Step 5: Tests laufen lassen – alle grün**

Run: `npm test`
Expected: PASS, `# pass 86`, `# fail 0` (68 bisherige + 18 neue).

- [ ] **Step 6: Lint**

Run: `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/`
Expected: keine Ausgabe.

- [ ] **Step 7: Commit**

```bash
git add server/session.js server/session.test.js
git commit -m "feat(mp): start each round only once every player has its images"
```

---

### Task 2: Vorlader-Modul

**Files:**
- Create: `src/js/preloader.js`
- Test: `server/preloader.test.js` (liegt in `server/`, weil `npm test` = `node --test server/`; `server/scoring.test.js` importiert ebenso aus `src/js`)

**Interfaces:**
- Consumes: nichts.
- Produces (für Task 3 und 4):
  - `export const RETRY_MS = 1000;`
  - `export default class Preloader` mit
    - `constructor({ createImage, retryMs, setTimer, clearTimer } = {})` – alle optional, Defaults für den Browser.
    - `load(urls: string[], { low = false } = {}): Promise<unknown[]>` – erfüllt sich, wenn **alle** URLs geladen sind (nie bei Fehlschlag; dann wird im Hintergrund wiederholt).
    - `keep(urls: string[]): void` – verwirft alle anderen Einträge.

- [ ] **Step 1: Tests schreiben**

`server/preloader.test.js`:

```js
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
```

- [ ] **Step 2: Tests laufen lassen – sie müssen fehlschlagen**

Run: `npm test`
Expected: FAIL – `preloader.test.js`: `Cannot find module '…/src/js/preloader.js'`.

- [ ] **Step 3: `src/js/preloader.js` schreiben**

```js
// how often a failed image is tried again, here and for the images on screen
export const RETRY_MS = 1000;

/**
 * Loads images ahead of time and keeps them referenced, so the <img> that shows them later gets them without a
 * request: the API sends max-age=0, and without a live reference Chrome would ask the server again
 */
export default class Preloader {
    constructor({
        createImage = () => new Image(),
        retryMs = RETRY_MS,
        // wrapped: browsers throw "Illegal invocation" when setTimeout is called as a method of another object
        setTimer = (fn, ms) => setTimeout(fn, ms),
        clearTimer = (id) => clearTimeout(id),
    } = {}) {
        this.createImage = createImage;
        this.retryMs = retryMs;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.entries = new Map();
        this.queue = Promise.resolve();
    }

    /**
     * Loads the urls one after another (each starts after the previous one's first attempt, so they do not share
     * the bandwidth) and resolves once all of them loaded. A failed one is retried every retryMs in the background.
     */
    load(urls, { low = false } = {}) {
        return Promise.all(urls.map((url) => {
            let entry = this.entries.get(url);
            if (!entry) {
                entry = { url, low, img: null, timer: null, dropped: false };
                entry.loaded = new Promise((resolve) => { entry.resolve = resolve; });
                this.entries.set(url, entry);
                this.queue = this.queue.then(() => this.attempt(entry));
            }
            return entry.loaded;
        }));
    }

    /**
     * Forgets every image but these: their retries stop and their downloads no longer count
     */
    keep(urls) {
        this.entries.forEach((entry, url) => {
            if (urls.includes(url)) return;
            entry.dropped = true;
            this.clearTimer(entry.timer);
            this.entries.delete(url);
        });
    }

    /**
     * One download attempt; resolves once it settled (loaded or failed) so the queue can move on
     */
    attempt(entry) {
        return new Promise((settled) => {
            if (entry.dropped) return settled();
            const img = this.createImage();
            entry.img = img;
            // before src: the priority only applies to a download that has not started yet
            if (entry.low) img.fetchPriority = "low";
            img.onload = () => {
                if (!entry.dropped) entry.resolve();
                settled();
            };
            img.onerror = () => {
                settled();
                if (!entry.dropped) entry.timer = this.setTimer(() => this.attempt(entry), this.retryMs);
            };
            img.src = entry.url;
        });
    }
}
```

- [ ] **Step 4: Tests laufen lassen – alle grün**

Run: `npm test`
Expected: PASS, `# pass 92`, `# fail 0` (86 aus Task 1 + 6 neue).

- [ ] **Step 5: Lint**

Run: `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/`
Expected: keine Ausgabe.

- [ ] **Step 6: Commit**

```bash
git add src/js/preloader.js server/preloader.test.js
git commit -m "feat(mp): add an image preloader that keeps images referenced and retries failures"
```

---

### Task 3: Hint und Karte – gemeinsame URLs, Spinner, Wiederholung, Promise für den ersten Ladeversuch

**Files:**
- Modify: `src/js/data/maps.js`
- Modify: `src/js/squadMinimap.js` (`draw`, `changeLayer`, Imports)
- Modify: `src/js/squadGuessr.js` (Import, `setupMap`, `setupHint`, neues `hintUrl`)
- Modify: `src/components/game/game.scss` (`#hint-wrapper`)

**Interfaces:**
- Consumes: `RETRY_MS` aus `src/js/preloader.js` (Task 2).
- Produces (für Task 4):
  - `basemapUrl(map)` aus `src/js/data/maps.js` – `map` ist ein Objekt aus `MAPS`, Rückgabe `` `${map.mapURL}basemap.webp` ``.
  - `app.hintUrl(url: string): string` – `` `/api/v2${url}` ``.
  - `app.setupMap(): Promise<void>` und `minimap.draw(): Promise<void>` – erfüllt nach dem ersten Ladeversuch der Karte (Erfolg oder Fehler).
  - `app.setupHint(): Promise<void>` – erfüllt nach dem ersten Ladeversuch des Hints (Erfolg **oder** Fehler).

Hier gibt es keine Unit-Tests (DOM, Leaflet); geprüft wird per Build und im Browser.

- [ ] **Step 1: `basemapUrl` in `src/js/data/maps.js`**

Direkt vor dem Kommentar `// Compute size in meters and z-scaling from SDK data for each map` einfügen:

```js
/**
 * The map image Leaflet shows; the multiplayer preloads exactly this URL
 */
export function basemapUrl(map) {
    return `${map.mapURL}basemap.webp`;
}

```

- [ ] **Step 2: `src/js/squadMinimap.js`**

Nach `import { guessMarker } from "./guessMarker.js";` einfügen:

```js
import { basemapUrl } from "./data/maps.js";
import { RETRY_MS } from "./preloader.js";
```

In `draw` die Zeile `this.changeLayer(true);` ersetzen durch:

```js
        return this.changeLayer(true);
```

`changeLayer` (inkl. Kommentar darüber) komplett ersetzen durch:

```js
    /**
     * remove existing layer and replace it; resolves after the first attempt (loaded or failed).
     * A map image that failed is retried every second while it is still the one on screen
     */
    changeLayer: function() {
        const OLDLAYER = this.activeLayer;

        // Show spinner
        this.spin(true, this.spinOptions);

        const layer = new ImageOverlay(basemapUrl(this.activeMap), this.imageBounds);
        this.activeLayer = layer;
        layer.addTo(this.layerGroup);
        $(layer.getElement()).css("opacity", 0);

        return new Promise((resolve) => {
            layer.once("load", () => {
                resolve();
                // Animate the opacity of the new layer
                $(layer.getElement()).fadeTo(700, 1, () => {
                    if (OLDLAYER) OLDLAYER.remove();
                    this.spin(false);
                });
            });

            layer.once("error", (e) => {
                console.error("Error loading", e.sourceTarget._url);
                if (OLDLAYER) OLDLAYER.remove();
                this.spin(false);
                resolve();
                // a newer changeLayer (next round, another map) replaces this layer and so ends the retries
                setTimeout(() => {
                    if (this.activeLayer === layer && $("#map_ui").is(":visible")) this.changeLayer();
                }, RETRY_MS);
            });
        });
    },
```

- [ ] **Step 3: `src/js/squadGuessr.js`**

Nach `import Multiplayer from "./multiplayer.js";` einfügen:

```js
import { RETRY_MS } from "./preloader.js";
```

In `setupMap()` (nicht in `debugChangeMap()`, wo dieselbe Zeile auch vorkommt) die drei letzten Zeilen

```js
        this.minimap.clear();
        this.minimap.activeMap = map;
        this.minimap.draw(true);
    }

    setupHint() {
```

so ändern, dass `draw` zurückgegeben wird (der Anfang von `setupHint()` wird im nächsten Absatz ohnehin ersetzt):

```js
        this.minimap.clear();
        this.minimap.activeMap = map;
        return this.minimap.draw(true);
    }

    setupHint() {
```

`setupHint()` komplett (inkl. der auskommentierten Blöcke darin) ersetzen durch:

```js
    /**
     * The hint image's URL; the multiplayer preloads exactly this one
     */
    hintUrl(url) {
        return `/api/v2${url}`;
    }

    /**
     * Shows the current guess's hint image; resolves after the first attempt (loaded or failed), so a timer waiting
     * for it always starts. A failed image is retried every second while this guess is still on the game screen
     */
    setupHint() {
        const $hint = $("#hint");
        const $wrapper = $("#hint-wrapper");
        const guess = this.currentGuess;
        const url = this.hintUrl(guess.url);

        clearTimeout(this.hintRetry);
        $hint.off("load error");
        $hint.hide();
        $wrapper.addClass("loading");
        $hint.attr("src", "");
        $hint.attr("src", url);

        if (guess.submitter) {
            $("#submitter").text(i18next.t("game.hintBy", { ns: "common" }) + " " + guess.submitter);
        }
        else {
            $("#submitter").text("");
        }

        return new Promise((resolve) => {
            $hint.on("load", () => {
                $wrapper.removeClass("loading");
                $hint.fadeIn(1200);
                resolve();
            });

            $hint.on("error", () => {
                resolve();
                this.hintRetry = setTimeout(() => {
                    // by URL: the multiplayer reveal swaps currentGuess for a new object of the same round
                    if (this.currentGuess?.url !== guess.url || !$("#map_ui").is(":visible")) return;
                    $hint.attr("src", "");
                    $hint.attr("src", url);
                }, RETRY_MS);
            });
        });
    }
```

- [ ] **Step 4: Spinner in `src/components/game/game.scss`**

Den Block `#hint-wrapper { … }` innerhalb von `#preview` (mit `aspect-ratio: 1 / 1;` und `overflow: hidden;`) ersetzen durch:

```scss
        #hint-wrapper {
            max-width: 100%;
            width: 100%;
            aspect-ratio: 1 / 1;
            border-radius: 10px;
            background-color: rgba(73, 73, 73, 0.842);
            overflow: hidden;

            // until the hint image is there (slow connection, or a failed image being retried)
            &.loading::after {
                content: "";
                position: absolute;
                top: 50%;
                left: 50%;
                width: 32px;
                height: 32px;
                margin: -16px 0 0 -16px;
                border: 3px solid rgba(255, 255, 255, 0.3);
                border-top-color: #fff;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
        }
```

(`@keyframes spin` existiert global in `src/components/menu/menu.scss`.)

- [ ] **Step 5: Tests, Lint, Build**

Run: `npm test` → Expected: `# pass 92`, `# fail 0`.
Run: `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/` → Expected: keine Ausgabe.
Run: `docker run --rm -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack -c ./config/webpack.config.js` → Expected: `compiled successfully`.

- [ ] **Step 6: Singleplayer im Browser prüfen (Review Focus 5)**

Dev-Server im Hintergrund starten (der Rechner hat Node 18, der Dev-Server braucht Node 20) und warten, bis er fertig gebaut hat:

```bash
docker run -d --rm --name sg-dev-test --network host -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack serve -c ./config/webpack.config.js
until docker logs sg-dev-test 2>&1 | grep -q "compiled successfully"; do sleep 2; done
```

Zum Sperren von Bildern diesen Patch in der Konsole des Tabs ausführen (wirkt auf `img.src` und auf jQuerys `.attr("src")`; `window.block = false` hebt die Sperre auf):

```js
window.block = true;
const bad = v => window.block && /\/img\/guesses\/|basemap\.webp/.test(v) ? v.replace(/\.webp$/, ".blocked") : v;
const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
Object.defineProperty(HTMLImageElement.prototype, "src", { ...d, set(v) { d.set.call(this, bad(String(v))); } });
const sa = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (n, v) {
    return sa.call(this, n, this instanceof HTMLImageElement && n === "src" ? bad(String(v)) : v);
};
```

Versuche zählen: `performance.getEntriesByType("resource").filter(e => e.name.endsWith(".blocked")).length` (oder `read_network_requests`).

Auf http://localhost:3000 prüfen:
1. Classic, Timer „Timed“ (60 s): Bis der Hint da ist, dreht im Hint-Bereich ein Spinner; der Timer startet erst danach; die Karte lädt.
2. Patch ausführen, dann „Next“: Der Spinner bleibt, die Zahl der `.blocked`-Einträge steigt jede Sekunde, der Timer startet trotzdem. `window.block = false`: Innerhalb einer Sekunde erscheint das Bild.
3. Mit `window.block = true` bis zum Ergebnis-Bildschirm spielen: Dort hören die sekündlichen Versuche auf (die Zahl steigt nicht mehr; das Ergebnisraster fordert jedes Vorschaubild nur einmal an).
4. Eine Runde mit gesperrter Karte: In der Konsole erscheint jede Sekunde `Error loading …basemap.blocked`, die Kartenfläche bleibt leer; nach `window.block = false` blendet die Karte ein.

Dev-Server danach stoppen: `docker stop sg-dev-test`.

- [ ] **Step 7: Commit**

```bash
git add src/js/data/maps.js src/js/squadMinimap.js src/js/squadGuessr.js src/components/game/game.scss
git commit -m "feat: show a spinner until the hint is there and retry failed hint and map images"
```

---

### Task 4: Multiplayer-Client – Vorladen, `ready`, Warte-Anzeige, Button-Sperren

**Files:**
- Modify: `src/js/multiplayer.js`
- Modify: `src/js/squadGuessr.js` (`setupGameButtons`)
- Modify: `src/components/lobby/lobby.html`
- Modify: `src/i18n/en.json`, `src/i18n/zh.json`

**Interfaces:**
- Consumes: `Preloader` (Task 2), `basemapUrl` + `MAPS` aus `src/js/data/maps.js`, `app.hintUrl()`, `app.setupMap()`/`app.setupHint()` als Promises (Task 3), das Protokoll aus Task 1 (`prepare`, `ready`, `state.players[].ready/stalled`, Phase `loading`).
- Produces: `mp.next()` (von `squadGuessr.js` für Weiter/Ergebnisse aufgerufen).

Hier gibt es keine Unit-Tests (DOM, WebSocket); geprüft wird per Build und in Task 5 im Browser.

- [ ] **Step 1: Texte**

In `src/i18n/en.json` unter `mp` direkt nach der Zeile `"waitingForPlayers": …` einfügen:

```json
        "loadingImages": "Loading images… ({{ready}}/{{total}})",
```

In `src/i18n/zh.json` unter `mp` direkt nach der Zeile `"waitingForPlayers": …` einfügen:

```json
        "loadingImages": "图片加载中…（{{ready}}/{{total}}）",
```

- [ ] **Step 2: Lobby-Markup**

In `src/components/lobby/lobby.html` die Zeile

```html
        <p class="guest-only" data-i18n="common:mp.waitingForHost"></p>
```

ersetzen durch:

```html
        <p id="mpWaitingForHost" class="guest-only" data-i18n="common:mp.waitingForHost"></p>
        <p id="mpLobbyStatus" hidden></p>
```

(`#lobby [hidden]` blendet beide per CSS zuverlässig aus.)

- [ ] **Step 3: Weiter/Ergebnisse in `src/js/squadGuessr.js` über `mp.next()`**

In `setupGameButtons()` die beiden Zeilen

```js
        this.BUTTON_NEXT.on("click", () => this.mp.active ? this.mp.send({ type: "next" }) : this.loadNextGuess());
        this.BUTTON_RESULTS.on("click", () => this.mp.active ? this.mp.send({ type: "next" }) : this.showResults());
```

ersetzen durch:

```js
        this.BUTTON_NEXT.on("click", () => this.mp.active ? this.mp.next() : this.loadNextGuess());
        this.BUTTON_RESULTS.on("click", () => this.mp.active ? this.mp.next() : this.showResults());
```

- [ ] **Step 4: `src/js/multiplayer.js` – Imports, Konstante, Konstruktor**

Nach `import { updateOffset } from "./clock.js";` einfügen:

```js
import Preloader from "./preloader.js";
import { MAPS, basemapUrl } from "./data/maps.js";
```

Nach `const RETRY_DELAYS = [1000, 2000, 5000];` einfügen:

```js
// NEXT / RESULTS stay locked until the server answers, or at most this long (e.g. the connection just dropped)
const NEXT_UNLOCK_MS = 5000;
```

Im Konstruktor nach `this.countdown = null;` einfügen:

```js
        this.preloader = new Preloader();
        // the images of the round on screen, once they had their first try: preloading the next round waits for it
        this.visible = Promise.resolve();
        this.nextTimer = null;
        this.startLoading = false;
```

- [ ] **Step 5: `start()` ersetzen, `setStartLoading()` und `next()` hinzufügen**

`start()` ersetzen durch:

```js
    start() {
        // spins on through the loading phase (renderStatus) until the first round starts
        this.setStartLoading(true);
        this.app.getGuess(this.state.settings.rounds)
            .then(guesses => this.send({ type: "start", guesses }))
            .catch(() => {
                this.setStartLoading(false);
                this.toast("error", "mp.errors.GUESSES");
            });
    }

    /**
     * setButtonLoading stores the button's content on every call, so a second "on" would keep the spinner for good
     */
    setStartLoading(on) {
        if (on === this.startLoading) return;
        this.startLoading = on;
        this.app.setButtonLoading($("#BUTTON_MP_START"), on);
    }

    /**
     * NEXT / RESULTS: locked until the server answers, so a double click or a held space bar sends only one
     */
    next() {
        this.app.BUTTON_NEXT.prop("disabled", true);
        this.app.BUTTON_RESULTS.prop("disabled", true);
        clearTimeout(this.nextTimer);
        this.nextTimer = setTimeout(() => {
            this.app.BUTTON_NEXT.prop("disabled", false);
            this.app.BUTTON_RESULTS.prop("disabled", false);
        }, NEXT_UNLOCK_MS);
        this.send({ type: "next" });
    }
```

- [ ] **Step 6: `stop()` räumt auf**

In `stop()` direkt nach `clearInterval(this.countdown);` einfügen:

```js
        clearTimeout(this.nextTimer);
        // no retries or held images beyond the game; a preload still waiting to start sees the new preloader and stops
        this.preloader.keep([]);
        this.preloader = new Preloader();
        this.visible = Promise.resolve();
```

- [ ] **Step 7: Abgelehnter Start gibt den START-Button frei**

In `onError(code)` als erste Zeilen einfügen:

```js
        // a rejected start brings no new state, so the START spinner would stay
        if (this.state?.phase === "lobby") this.setStartLoading(false);
```

- [ ] **Step 8: `prepare` empfangen**

In `onMessage()` vor `case "round":` einfügen:

```js
        case "prepare":
            this.onPrepare(msg);
            break;
```

Unter `// ===== GAME =====` vor `onRound(msg) {` einfügen:

```js
    /**
     * A round is announced: the next one while this one runs, or the one everybody waits for. Its images load in
     * the background and get reported; nothing on screen changes, so a fast device gets no head start
     */
    onPrepare(msg) {
        const urls = [this.app.hintUrl(msg.url)];
        // classic only: in Find the Map the map is the answer and never comes ahead (msg.map is null)
        if (msg.map) urls.push(basemapUrl(MAPS.find(m => m.name.toLowerCase() === msg.map.toLowerCase())));
        // the round on screen keeps its images in the DOM, so only the announced ones need holding
        this.preloader.keep(urls);
        // the next round: low priority, and not before the images on screen had their first try
        const low = this.state?.phase !== "loading";
        const preloader = this.preloader;
        this.visible
            .then(() => preloader === this.preloader && preloader.load(urls, { low }))
            .then((loaded) => {
                // checked now, not when prepare came: the page may have left the game or turned into a big screen
                if (loaded && this.active && !this.watching) this.send({ type: "ready", index: msg.index });
            });
    }

```

- [ ] **Step 9: `onRound()` und `onReveal()` setzen `this.visible`**

In `onRound()` den Block

```js
        $("body").removeClass("mp-reveal");
        if (!resent) {
            app.currentGuess = { map: msg.map, url: msg.url, submitter: msg.submitter };
            app.solutionMarker = null;
            if (msg.map) app.setupMap();
            else app.minimap.clear();
            app.INPUT_GUESS.val("");
        }
```

ersetzen durch:

```js
        $("body").removeClass("mp-reveal");
        let mapShown = Promise.resolve();
        if (!resent) {
            app.currentGuess = { map: msg.map, url: msg.url, submitter: msg.submitter };
            app.solutionMarker = null;
            if (msg.map) mapShown = app.setupMap();
            else app.minimap.clear();
            app.INPUT_GUESS.val("");
        }
```

und in `onRound()` die Zeile `if (!resent) app.setupHint();` ersetzen durch:

```js
        if (!resent) this.visible = Promise.all([mapShown, app.setupHint()]);
```

In `onReveal()` den Block

```js
        $("#gameWrapper").removeClass("no-map");
        if (needsMap) app.setupMap();
        if (fresh) {
            app.switchUI("game");
            app.setupHint();
        }
```

ersetzen durch:

```js
        $("#gameWrapper").removeClass("no-map");
        const mapShown = needsMap ? app.setupMap() : Promise.resolve();
        let hintShown = Promise.resolve();
        if (fresh) {
            app.switchUI("game");
            hintShown = app.setupHint();
        }
        // a next round announced from now on waits for these (fresh implies needsMap)
        if (needsMap) this.visible = Promise.all([mapShown, hintShown]);
```

- [ ] **Step 10: `renderState()` – neu geöffnete Seiten während `loading`**

In `renderState()` die letzte Zeile `if (s.phase === "lobby") this.showRoom();` ergänzen, sodass das Ende lautet:

```js
        this.renderStatus();
        if (s.phase === "lobby") this.showRoom();
        // a page that (re)opened while everyone waits for the images: the room shows who is loading, not the menu
        if (s.phase === "loading" && !$("#map_ui").is(":visible")) this.showRoom();
    }
```

- [ ] **Step 11: `renderStatus()` – Statuszeile, Start-Button, Einstellungen, Weiter-Sperre**

In `renderStatus()` den Anfang

```js
        const host = this.isHost();
        const last = s.round + 1 === s.total;
        $("#BUTTON_MP_ENDROUND").prop("hidden", s.phase !== "round" || !host || s.settings.timer > 0);
        this.app.BUTTON_NEXT.prop({ hidden: s.phase !== "reveal" || !host || last, disabled: false });
        this.app.BUTTON_RESULTS.prop({ hidden: s.phase !== "reveal" || !host || !last, disabled: false });
```

ersetzen durch:

```js
        const host = this.isHost();
        const last = s.round + 1 === s.total;
        const loading = s.phase === "loading";
        $("#BUTTON_MP_ENDROUND").prop("hidden", s.phase !== "round" || !host || s.settings.timer > 0);
        // any answer from the server unlocks NEXT / RESULTS (see next())
        clearTimeout(this.nextTimer);
        this.app.BUTTON_NEXT.prop({ hidden: s.phase !== "reveal" || !host || last, disabled: false });
        this.app.BUTTON_RESULTS.prop({ hidden: s.phase !== "reveal" || !host || !last, disabled: false });
        // the lobby stays on screen while the first round loads: the start went through, the settings are fixed
        this.setStartLoading(loading);
        $("#mpSettings select").prop("disabled", s.phase !== "lobby");
        $("#mpWaitingForHost").prop("hidden", loading);
        $("#mpLobbyStatus").prop("hidden", !loading);
        if (loading) {
            const waited = s.players.filter(p => p.connected && !p.stalled);
            const text = i18next.t("mp.loadingImages", {
                ns: "common",
                ready: waited.filter(p => p.ready).length,
                total: waited.length,
            });
            $("#mpStatus, #mpLobbyStatus").text(text);
            $("#mpStatus").prop("hidden", false);
            return;
        }
```

(Die übrigen Zeilen von `renderStatus()` ab `if (s.phase === "reveal")` bleiben unverändert.)

- [ ] **Step 12: ⏳/💤 an Spielernamen und in der Rangliste**

`renderPlayers()` ersetzen durch:

```js
    renderPlayers(s) {
        const items = s.players.map(p => $("<li>")
            .text(`${p.id === s.hostId ? "👑 " : ""}${p.name}${s.phase === "round" && p.answered ? " ✓" : ""}${this.loadMark(s, p)}`)
            .toggleClass("offline", !p.connected)
            .toggleClass("me", p.id === this.me));
        $("#mpPlayers").empty().append(items);
        $("#mpChips").empty().append(items.map($li => $li.clone()));
        // the reveal ranking hides the chips (lobby.scss), so while the next round loads it carries the marks itself
        $("#mpRanking li").each((_, li) => {
            const p = s.players.find(x => x.id === li.dataset.id);
            if (p) $(li).find(".name").text(p.name + this.loadMark(s, p));
        });
    }

    /**
     * While everyone waits for the images: ⏳ still loading, 💤 missed the last loading time and is not waited for
     */
    loadMark(s, p) {
        if (s.phase !== "loading" || !p.connected) return "";
        if (p.stalled) return " 💤";
        return p.ready ? "" : " ⏳";
    }
```

In `renderRanking()` den Zeilen eine Spieler-ID geben – nach `$("<li>")` einfügen:

```js
                .attr("data-id", row.id)
```

sodass der Anfang lautet:

```js
            $("<li>")
                .attr("data-id", row.id)
                .toggleClass("me", row.id === this.me)
```

- [ ] **Step 13: Tests, Lint, Build**

Run: `npm test` → Expected: `# pass 92`, `# fail 0`.
Run: `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/` → Expected: keine Ausgabe.
Run: `docker run --rm -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack -c ./config/webpack.config.js` → Expected: `compiled successfully`.

- [ ] **Step 14: Commit**

```bash
git add src/js/multiplayer.js src/js/squadGuessr.js src/components/lobby/lobby.html src/i18n/en.json src/i18n/zh.json
git commit -m "feat(mp): preload the next round, report it ready and show who everyone waits for"
```

---

### Task 5: Ende-zu-Ende im Browser prüfen und CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: alles aus Task 1–4.
- Produces: nichts.

Aufbau wie bei den bisherigen Multiplayer-Tests: Jeder Spieler braucht einen eigenen Origin (eigener `localStorage`), also `http://localhost:3000`, `http://127.0.0.1:3000` und `http://192.168.178.40:3000`; der Big-Screen öffnet `?watch=CODE` in einem weiteren Tab. Geprüft wird per Chrome-Erweiterung und Konsole (siehe Global Constraints). Wer stattdessen von Hand mit offenen DevTools prüft: „Disable cache“ muss **aus** sein – sonst umgeht Chrome den Speicher-Cache, und das Vorladen sieht kaputt aus.

Die Konsolen-Patches unten wirken nur bis zum Neuladen des Tabs.

- [ ] **Step 1: Server starten**

MP-Server im Hintergrund starten (in Claude Code: Bash mit `run_in_background`), Dev-Server als Container im Hintergrund, dann warten, bis er gebaut hat:

```bash
node server/index.js
```

```bash
docker run -d --rm --name sg-dev-test --network host -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack serve -c ./config/webpack.config.js
until docker logs sg-dev-test 2>&1 | grep -q "compiled successfully"; do sleep 2; done
```

- [ ] **Step 2: Langsames Gerät – alle warten, alle sehen das Bild gleichzeitig**

Session mit 3 Spielern erstellen (Classic, Timed 60 s, 3 Runden), Big-Screen dazu. Im Tab von Spieler 3 **vor** dem Start den Download der Hint-Bilder um 6 s verzögern (prüft, dass der Client `ready` erst nach dem Laden schickt):

```js
const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
Object.defineProperty(HTMLImageElement.prototype, "src", { ...d, set(v) {
    if (/\/img\/guesses\//.test(v)) setTimeout(() => d.set.call(this, v), 6000);
    else d.set.call(this, v);
} });
```

Start drücken. Erwartet:
- Alle bleiben in der Lobby; Spieler 3 hat ⏳; Statuszeile „Loading images… (2/3)“; der Start-Button des Hosts dreht sich; die Einstellungs-Selects sind gesperrt; kein Fehler-Toast.
- Runde 1 startet **nicht vor** ~6 s (sonst schickt der Client `ready` zu früh) und spätestens nach 12 s – auf allen drei Geräten und dem Big-Screen im selben Moment; der Countdown zeigt überall 60.

- [ ] **Step 3: Geräte, die nie melden – 💤 und kein zweites Warten**

Spiel bis zum Endstand spielen, „Play again“, alle Tabs neu laden (entfernt den Patch aus Step 2). Vor dem nächsten Start:

Im Tab von Spieler 3 – verwirft **jedes** `ready`:

```js
const send = WebSocket.prototype.send;
WebSocket.prototype.send = function (data) {
    if (String(data).includes('"type":"ready"')) return;
    return send.call(this, data);
};
```

Im Tab von Spieler 2 – verwirft `ready` ab der zweiten Runde (Index ≥ 1):

```js
const send = WebSocket.prototype.send;
WebSocket.prototype.send = function (data) {
    if (/"type":"ready","index":[1-9]/.test(String(data))) return;
    return send.call(this, data);
};
```

Start drücken. Erwartet:
- Lobby: ⏳ bei Spieler 3, „Loading images… (2/3)“; nach 12 s startet Runde 1 auf allen Geräten.
- Runde 1 beenden (alle antworten), Host drückt „Next“: Die Auflösung bleibt stehen; in der Rangliste ⏳ bei Spieler 2 und 💤 bei Spieler 3; Statuszeile „Loading images… (1/2)“ (Spieler 3 zählt nicht mehr); nach 5 s startet Runde 2.
- Runde 2 beenden, „Next“: Runde 3 startet sofort – auf keins der beiden Geräte wird mehr gewartet.

- [ ] **Step 4: Kein Netzwerk beim Rundenstart (Review Focus 1)**

Neues Spiel („Play again“, alle Tabs neu laden, keine Patches). Im Tab von Spieler 1 während der Auflösung von Runde 1 – kurz bevor der Host „Next“ drückt – in der Konsole ausführen:

```js
performance.clearResourceTimings();
```

Sobald Runde 2 zu sehen ist:

```js
const shown = [document.getElementById("hint").src, ...[...document.querySelectorAll(".leaflet-image-layer")].map(i => i.src)];
performance.getEntriesByType("resource").filter(e => shown.includes(e.name) && e.transferSize > 0).map(e => e.name);
```

Expected: `[]` – Hint und Karte der angezeigten Runde kamen aus dem Speicher, ohne Anfrage (auch ohne 304-Rückfrage). Anfragen mit niedriger Priorität direkt nach „Next“ sind das Vorladen der **übernächsten** Runde und erwartet; nach der letzten Runde gibt es keine.

- [ ] **Step 5: Neu laden und Big-Screen während des Wartens (Review Focus 2)**

Zurück in die Lobby („Play again“, alle Tabs neu laden). Im Tab von Spieler 3 den Verwirf-alles-Patch aus Step 3 ausführen. Start drücken, etwa 5 s später den Tab von Spieler 2 neu laden und einen neuen Tab `?watch=CODE` öffnen. Erwartet:
- Beide zeigen die Lobby mit ⏳ und „Loading images…“, nicht das Hauptmenü.
- Runde 1 startet 12 s nach dem Klick auf Start – nicht 12 s nach dem Neuladen (die Frist wird nicht verlängert) – auch auf dem neu geladenen Tab und dem neuen Big-Screen.

- [ ] **Step 6: Bild schlägt im Multiplayer fehl**

Zurück in die Lobby, alle Tabs neu laden. Im Tab von Spieler 3 den Sperr-Patch aus Task 3 Step 6 ausführen (`window.block = true`). Start drücken. Erwartet:
- Lobby: ⏳ bei Spieler 3; `performance.getEntriesByType("resource").filter(e => e.name.endsWith(".blocked")).length` steigt im Tab von Spieler 3 jede Sekunde.
- Nach 12 s startet Runde 1 überall; bei Spieler 3 dreht im Hint-Bereich der Spinner, die Kartenfläche ist leer.
- `window.block = false` im Tab von Spieler 3: Innerhalb von etwa einer Sekunde erscheinen dort Hint und Karte, noch in derselben Runde.
- Runde beenden, „Next“: Runde 2 startet ohne Wartezeit (Spieler 3 hat die nächste Runde inzwischen geladen und gemeldet).

- [ ] **Step 7: Start-Button und Einstellungen nach einem Spiel (Review Focus 3)**

Spiel bis zum Endstand spielen, „Play again“. Erwartet: In der Lobby steht auf dem Start-Button wieder „START“ (kein Spinner, kein „Loading…“), die Einstellungs-Selects sind bedienbar; ein weiteres Spiel startet normal.

- [ ] **Step 8: Find the Map (Review Focus 4)**

Neue Session in Find the Map; im Tab eines Spielers in der Lobby `performance.clearResourceTimings()` ausführen. Start drücken und eine Runde spielen. Vor der Auflösung:

```js
performance.getEntriesByType("resource").filter(e => e.name.includes("basemap")).map(e => e.name);
```

Expected: `[]` (die Karte ist die Antwort und wird nicht vorgeladen). Nach der Auflösung: genau ein Eintrag, die Karte der Lösung.

- [ ] **Step 9: Doppelklick und gehaltene Leertaste**

In der Auflösung im Tab des Hosts:

```js
document.getElementById("BUTTON_NEXT").click();
document.getElementById("BUTTON_NEXT").click();
```

Erwartet: genau eine nächste Runde, kein „Invalid request“-Toast. In der nächsten Auflösung die gehaltene Leertaste nachstellen:

```js
for (let i = 0; i < 5; i++) document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
```

Erwartet: wieder genau eine nächste Runde, kein Toast.

- [ ] **Step 10: Server stoppen**

```bash
pkill -f '[n]ode server/index.js'
docker stop sg-dev-test
```

(Das Muster `[n]ode` trifft nicht die eigene Shell.)

- [ ] **Step 11: CHANGELOG**

In `CHANGELOG.md` im Abschnitt **1.4.0** unter den bestehenden „new features“-Zeilen ergänzen:

```markdown
- Multiplayer rounds start for everyone at the same moment, once every phone has loaded the images; the next round's images load in the background while you play
```

und direkt danach (noch vor `</br></br><!-- CHANGELOG SPLIT MARKER -->`) einen Bugfix-Block einfügen:

```markdown

</br><img src="https://img.shields.io/badge/-bug%20fix-firebrick">
- Fixed the timer never starting when a hint image fails to load; failed hint and map images are now retried
```

- [ ] **Step 12: Abschluss-Prüfung und Commit**

Run: `npm test` → Expected: `# pass 92`, `# fail 0`.
Run: `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/` → Expected: keine Ausgabe.

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for the synced multiplayer round start"
```
