# Multiplayer-Team-Modus: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team-Modus für den Classic-Multiplayer mit den drei Varianten Durchschnitt, Mittelpunkt und Leader.

**Architecture:** Der Server (`server/session.js`) führt Teamnummer, Leader und Team-Punktestände direkt in `Session`. Die Varianten unterscheiden sich in wenigen Methoden: `teamResult`, `teamPoint` und der Phase `decide` für Leader. Reine Wertungsfunktionen (`penaltyPoints`, `centroid`) liegen in `src/js/scoring.js`, das Server und Client gemeinsam nutzen. Der Client bekommt den Team-Teil in einem eigenen Modul `src/js/multiplayerTeams.js`, das `src/js/multiplayer.js` aufruft.

**Tech Stack:**
- Node (ESM), `ws` und `node:test` auf dem Server.
- jQuery, Leaflet und i18next im Client.
- Webpack für den Build.
- Keine neuen Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-10-23-multiplayer-team-mode-design.md`

## Global Constraints

- Gearbeitet wird auf dem Branch `feature/mp-team-mode`, er existiert schon.
- Tests laufen mit `npm test` (`node --test server/`). Das funktioniert mit dem Host-Node 18.
- Builds laufen nur in Docker: `docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -w /app node:20 npm run build`. Mit dem Host-Node 18 schlägt `npm run build` fehl. Eine `.env` liegt im Repo-Root, in einem Worktree muss sie aus dem Hauptcheckout kopiert werden.
- `npm run lint` ist schon vorher kaputt: jshint stürzt ab, eslint meldet CRLF in jeder Zeile. Nicht als Fehler dieses Plans werten. Falls `stylelint --fix` `src/components/index.scss` umschreibt, die Änderung zurücknehmen.
- Ohne Team-Modus bleiben `settings`, `state`, `reveal` und `final` wie heute. **Die bestehenden Tests werden nicht geändert und bleiben grün.**
- Den Team-Modus gibt es nur in `classic`.
- `teamGuesses` enthält nur `{ id, name, lat, lng }` und **nie `points` oder `distance`**.
- Spielernamen kommen nur als Text ins DOM: `.text()`, `textContent` oder ein Element als Leaflet-Tooltip-Inhalt. **Nie** als HTML-String, also auch nicht als String an `bindTooltip`.
- Übersetzungen gibt es in `src/i18n/en.json` und `src/i18n/zh.json`. Neue Texte enthalten **keinen Apostroph**, weil das Merge-Skript sie in einfache Anführungszeichen setzt.
- Code-Stil: 4 Leerzeichen, doppelte Anführungszeichen, Semikolons. Kommentare kurz, auf Englisch und mit dem Warum.
- Commit-Messages haben die Form `feat(multiplayer): …` und enden mit der Zeile `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Feste Werte:
  - `MAX_PLAYERS = 30`
  - Teamanzahl 2 bis 10
  - Varianten `off`, `average`, `centroid`, `leader`
  - `decide` ∈ {10, 15, 20, 30, 45, 60}, Default 20
  - Minuspunkte bis höchstens −50 (`MAX_PENALTY`)
  - Teamfarben in dieser Reihenfolge: Blau, Rot, Grün, Gelb, Lila, Orange, Türkis, Pink, Weiß, Braun

## Review Focus

1. **Host schaltet auf „Find the Map“, während Teams an sind.** Der Client muss `team: "off"` mitschicken, sonst lehnt der Server mit `INVALID` ab und das Select hängt. Wird in Task 6, Schritt „Manuell prüfen“, geprüft.
2. **Ein Spielername mit HTML** (`<img src=x onerror=alert(1)>`) erscheint im Teammitglied-Marker, im Reveal und in der Lobby nur als Text. Wird in Task 7, Schritt „Manuell prüfen“, geprüft.
3. **Alle Spieler eines Teams verlassen mitten im Spiel.** Das Team bleibt im Ranking und bekommt ab dann 0 Punkte, der Server stürzt nicht ab. Abgedeckt durch den Test in Task 5.
4. **Negative Team-Rundenpunkte und ein negativer Endstand** werden als „−12“ mit echtem Minus angezeigt, in Rot und nie als „+-12“. Wird in Task 7, Schritt „Manuell prüfen“, geprüft.
5. **Der Leader lädt während `decide` neu.** Hatte er noch nicht bestätigt, kann er danach wieder auswählen und bestätigen. Hatte er schon bestätigt, ist das Auswählen gesperrt. Server-Test in Task 12, manuelle Prüfung in Task 14.

---

# Teil A: Basis und Durchschnitt

Nach Teil A lässt sich der Modus „Durchschnitt“ vollständig spielen.

### Task 1: Minuspunkte in `scoring.js`

**Files:**
- Modify: `src/js/scoring.js` (nach `pointsForDistance`)
- Test: `server/scoring.test.js`

**Interfaces:**
- Produces:
  - `export const MAX_PENALTY = 50`
  - `export function penaltyPoints(distance: number, size: number): number`. Liefert 0 bis −50, nie `-0`.

- [ ] **Step 1: Failing test schreiben**

In `server/scoring.test.js` die Import-Zeile erweitern:

```js
import { pointsForDistance, levenshtein, mapNameMatches, distance, mapSize, scoreAnswer, rankMoves, penaltyPoints, MAX_PENALTY } from "../src/js/scoring.js";
```

Am Dateiende anhängen:

```js
test("penaltyPoints: 0 up to the last scoring step, then down to −50 at three times its distance", () => {
    // on a 3000m map the last step is 500m
    assert.equal(penaltyPoints(0, 3000), 0);
    // 0, not -0: assert.equal compares with Object.is
    assert.equal(penaltyPoints(500, 3000), 0);
    assert.equal(penaltyPoints(1000, 3000), -25);
    assert.equal(penaltyPoints(1500, 3000), -50);
    assert.equal(penaltyPoints(5000, 3000), -50);
    // the step scales with the map like the points do
    assert.equal(penaltyPoints(2000, 6000), -25);
    assert.equal(MAX_PENALTY, 50);
});
```

- [ ] **Step 2: Test laufen lassen, er muss fehlschlagen**

Run: `npm test 2>&1 | grep -E "penaltyPoints|^# (pass|fail)"`
Expected: Der Test schlägt fehl (`penaltyPoints is not a function` bzw. SyntaxError beim Import).

- [ ] **Step 3: Implementieren**

In `src/js/scoring.js` direkt nach der Funktion `pointsForDistance` einfügen:

```js
// team play's minus points: the most a far guess (or giving no answer) can cost
export const MAX_PENALTY = 50;

/**
 * Minus points for a guess beyond the last scoring step: 0 at its edge, down to −MAX_PENALTY at three times its distance
 */
export function penaltyPoints(distance, size) {
    const zone = BASE_STEPS.at(-1).maxDistance * size / 3000;
    const points = Math.round(MAX_PENALTY * Math.min(1, Math.max(0, distance - zone) / (2 * zone)));
    // inside the zone 0, not -0
    return points ? -points : 0;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/js/scoring.js server/scoring.test.js
git commit -m "feat(multiplayer): minus points for guesses beyond the last scoring step

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Team-Einstellungen validieren

**Files:**
- Modify: `server/validate.js:3-33`
- Test: `server/validate.test.js`

**Interfaces:**
- Produces: `validSettings(s)` akzeptiert zusätzlich die Felder `team` (`"off"`, `"average"`), `teams` (ganze Zahl von 2 bis 10) und `penalty` (boolean).
  - Alle drei dürfen fehlen. Dann gelten `"off"`, `2` und `false`.
  - `team ≠ "off"` ist nur mit `mode === "classic"` gültig.
  - Teil B und Teil C erweitern `TEAM_MODES`.

- [ ] **Step 1: Failing test schreiben**

In `server/validate.test.js` nach dem Test `"validSettings: rush takes 5–30 s …"` einfügen:

```js
test("validSettings: team play takes Average with 2–10 teams and minus points on or off, in classic only", () => {
    const settings = (over) => validSettings({ mode: "classic", timer: 0, rounds: 5, ...over });
    assert.equal(settings({ team: "off" }), true);
    assert.equal(settings({ team: "average", teams: 2, penalty: false }), true);
    assert.equal(settings({ team: "average", teams: 10, penalty: true }), true);
    [1, 11, 2.5, "2", null].forEach(teams => assert.equal(settings({ team: "average", teams, penalty: false }), false, `teams ${teams}`));
    ["yes", 1, null].forEach(penalty => assert.equal(settings({ team: "average", teams: 2, penalty }), false, `penalty ${penalty}`));
    assert.equal(settings({ team: "solo" }), false);
    // a team guesses points on the map: never in Find the Map
    assert.equal(validSettings({ mode: "mapFinder", timer: 0, rounds: 5, team: "average", teams: 2, penalty: false }), false);
    assert.equal(validSettings({ mode: "mapFinder", timer: 0, rounds: 5, team: "off" }), true);
    // an older cached client knows nothing of teams
    assert.equal(settings({}), true);
});
```

- [ ] **Step 2: Test laufen lassen, er muss fehlschlagen**

Run: `npm test 2>&1 | grep -E "team play takes|^# (pass|fail)"`
Expected: Der neue Test schlägt fehl, weil `team: "solo"` bzw. `teams: 11` noch als gültig durchgehen.

- [ ] **Step 3: Implementieren**

In `server/validate.js` nach `const ROUNDS = [3, 5, 10];` einfügen:

```js
// team play: "off" is everyone for themselves
const TEAM_MODES = ["off", "average"];
const MAX_TEAMS = 10;
```

`validSettings` ersetzen durch:

```js
export function validSettings(s) {
    // an older cached client sends no next and nothing about teams
    return Boolean(s) && MODES.includes(s.mode) && TIMERS.includes(s.timer) && ROUNDS.includes(s.rounds)
        && (s.next === undefined || NEXTS.includes(s.next))
        && validTeamSettings(s);
}

/**
 * Team play is classic only: what a team plays is a point on the map. A missing field takes its default, null does not
 */
function validTeamSettings({ mode, team = "off", teams = 2, penalty = false }) {
    return TEAM_MODES.includes(team) && (team === "off" || mode === "classic")
        && Number.isInteger(teams) && teams >= 2 && teams <= MAX_TEAMS
        && typeof penalty === "boolean";
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add server/validate.js server/validate.test.js
git commit -m "feat(multiplayer): validate the team play settings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Teams in der Session: Einstellungen, Zuordnung, Mischen, START-Regel und Limit 30

**Files:**
- Modify: `server/session.js`
- Test: `server/session.test.js` (neuer Abschnitt am Dateiende)

**Interfaces:**
- Consumes: `validSettings` mit Team-Feldern (Task 2).
- Produces:
  - `MAX_PLAYERS = 30`.
  - `settings` enthält bei `team !== "off"` zusätzlich `{ team, teams, penalty }`. Bei `off` enthält es keine Team-Felder.
  - Spieler-Feld `team: number`. `state.players[]` enthält `team`.
  - Nachricht Spieler → Server `{ type: "team", team }`. Außerhalb der Lobby wird sie still ignoriert, eine ungültige Teamnummer ergibt `INVALID`.
  - Host-Aktion `{ type: "shuffle" }`. Nur in der Lobby und nur im Team-Modus, sonst `INVALID`.
  - Methoden `teamSizes(counted?)` gibt `number[]` zurück, `smallestTeam()` gibt `number` zurück.
  - `canStart()` verlangt im Team-Modus mindestens 2 Teams mit verbundenen Spielern.
  - Test-Helfer `AVERAGE`, `teamLobby(settings)`, `teamGame(settings)` und `teamOf(name)`, die die folgenden Tasks weiterverwenden.

- [ ] **Step 1: Failing tests schreiben**

Am Ende von `server/session.test.js` anhängen:

```js
// ===== TEAM PLAY =====

const AVERAGE = { ...CLASSIC, team: "average", teams: 2, penalty: false };

// a team lobby: Hans (host) and Ida in team 0, Max and Eve in team 1, since every newcomer goes to the smallest team
function teamLobby(settings = AVERAGE) {
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
    const { host, last } = setup(AVERAGE);
    assert.deepEqual(last(host, "state").settings, AVERAGE);
    const plain = setup({ ...CLASSIC, team: "off", teams: 4, penalty: true });
    assert.deepEqual(plain.last(plain.host, "state").settings, CLASSIC);
});

test("team play: every newcomer goes to the smallest team, the lowest one on a tie", () => {
    const { host, last } = teamLobby();
    assert.deepEqual(last(host, "state").players.map(p => [p.name, p.team]), [["Hans", 0], ["Max", 1], ["Ida", 0], ["Eve", 1]]);
});

test("team play: once START was pressed, newcomers only fill teams that already play", () => {
    const { s, host, last } = setup({ ...AVERAGE, teams: 4 });
    s.join({}, { name: "Max" });
    s.join({}, { name: "Ida" });
    s.handle(host, { type: "start", guesses: GUESSES });
    s.join({}, { name: "Late" });
    // teams 0–2 have one player each, team 3 none: the late one joins team 0, not a team of their own
    assert.equal(last(host, "state").players.find(p => p.name === "Late").team, 0);
});

test("team play: a player switches teams in the lobby; a bad team is refused, a click after START is ignored", () => {
    const { s, host, max, last, all, teamOf } = teamLobby();
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
    const { s, host, max, last } = teamLobby({ ...AVERAGE, teams: 3 });
    s.join({}, { name: "Ana" });
    s.handle(max, { type: "shuffle" });
    assert.equal(last(max, "error").code, "NOT_HOST");
    s.handle(host, { type: "shuffle" });
    const sizes = [0, 1, 2].map(team => last(host, "state").players.filter(p => p.team === team).length);
    assert.deepEqual(sizes.sort(), [1, 2, 2]);
});

test("team play: shuffling needs team play", () => {
    const { s, host, last } = withGuest();
    s.handle(host, { type: "shuffle" });
    assert.equal(last(host, "error").code, "INVALID");
});

test("team play: with fewer teams, the players of the dropped ones go to the smallest teams left", () => {
    const { s, host, teamOf } = teamLobby({ ...AVERAGE, teams: 4 });
    assert.deepEqual(["Hans", "Max", "Ida", "Eve"].map(teamOf), [0, 1, 2, 3]);
    s.handle(host, { type: "settings", settings: AVERAGE });
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
    assert.equal(last(host, "state").canStart, true);
});
```

- [ ] **Step 2: Tests laufen lassen, sie müssen fehlschlagen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: Die neuen Tests `team play: …` und `a session holds up to 30 players` schlagen fehl. Alle anderen Tests bleiben grün.

- [ ] **Step 3: Implementieren**

In `server/session.js`:

1. Import und Limit:

```js
import { randomUUID, randomInt } from "node:crypto";
```

```js
export const MAX_PLAYERS = 30;
```

2. `HOST_ACTIONS` erweitern:

```js
const HOST_ACTIONS = ["settings", "start", "cancelStart", "endRound", "next", "kick", "promote", "shuffle"];
```

3. In `handle()` nach der Zeile `if (msg.type === "lobbyReady") return this.lobbyReady(player, msg.ready);` einfügen:

```js
        if (msg.type === "team") return this.switchTeam(player, msg.team);
```

Im `switch` nach `case "promote": return this.promote(conn, msg.playerId);` einfügen:

```js
        case "shuffle": return this.shuffle(conn);
```

4. Nach der Methode `promote()` einfügen:

```js
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
```

5. In `updateSettings()` direkt nach `this.settings = pickSettings(settings);` einfügen:

```js
        // fewer teams: the players of the dropped ones go to the smallest teams left
        if (this.settings.team) this.players.forEach(p => { if (p.team >= this.settings.teams) p.team = this.smallestTeam(); });
```

6. `canStart()` samt Kommentar ersetzen durch:

```js
    /**
     * Somebody to play against: at least one other player is connected (a watcher does not count), and in team play
     * at least two teams have somebody there
     */
    canStart() {
        const others = Boolean(this.findPlayer(p => p.connected && p.id !== this.hostId));
        return others && (!this.settings.team || this.teamSizes(p => p.connected).filter(n => n > 0).length >= 2);
    }
```

7. In `stateMsg()` in der `players`-Abbildung nach `back: p.backAt !== null,` einfügen:

```js
                team: p.team,
```

8. In `addPlayer()` das Objekt um `team` erweitern. `smallestTeam()` zählt dabei vor dem Hinzufügen des Spielers:

```js
        const player = { id: randomUUID(), token: randomUUID(), name, conn, connected: true, awayUntil: 0, score: 0, answers: [], ready: -1, stalled: false, lobbyReady: false, backAt: this.now(), team: this.smallestTeam() };
```

9. Im Abschnitt `// ===== HELPERS =====` vor `addPlayer` einfügen:

```js
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
```

10. `pickSettings` am Dateiende ersetzen durch:

```js
function pickSettings({ mode, timer, rounds, next = 0, team = "off", teams = 2, penalty = false }) {
    // without teams the settings stay what they were before team play: older clients and the plain game see no change
    if (team === "off") return { mode, timer, rounds, next };
    return { mode, timer, rounds, next, team, teams, penalty };
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add server/session.js server/session.test.js
git commit -m "feat(multiplayer): teams in the lobby: team settings, joining, switching, shuffling, up to 30 players

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Sichtbarkeit: `teamGuesses`

**Files:**
- Modify: `server/session.js` (`answer`, `reconnect` und neue Methoden)
- Test: `server/session.test.js`

**Interfaces:**
- Consumes: `teamLobby`/`teamGame` und `AVERAGE` (Task 3).
- Produces:
  - Nachricht Server → Spieler `{ type: "teamGuesses", index, guesses: [{ id, name, lat, lng }] }`, nur im Team-Modus und nur in der Phase `round`. Teil C erweitert sie auf `decide`.
  - Methoden `guessOf(p)` gibt die Antwort mit `lat !== null` zurück oder `null`, `members(team)` gibt `player[]` in Beitrittsreihenfolge zurück, `sendTeamGuesses(team)` und `seesTeam(p)` geben `boolean` zurück.
  - Test-Helfer `south(d)` und `ZONE`.

- [ ] **Step 1: Failing tests schreiben**

Am Ende von `server/session.test.js` anhängen:

```js
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
```

- [ ] **Step 2: Tests laufen lassen, sie müssen fehlschlagen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: Der erste und der dritte neue Test schlagen fehl, weil noch kein `teamGuesses` gesendet wird. Der zweite besteht schon.

- [ ] **Step 3: Implementieren**

In `server/session.js`:

1. In `answer()` die letzten drei Zeilen ersetzen:

```js
        player.answers[this.round] = { ...answer, ...scoreAnswer(this.settings.mode, this.guesses[this.round], answer) };
        this.broadcastState();
        this.sendTeamGuesses(player.team);
        this.checkRoundEnd();
```

2. In `reconnect()` den Schluss ersetzen:

```js
        this.welcome(player);
        this.broadcastState();
        this.sendPhase(conn);
        this.sendTeamGuesses(player.team);
        return true;
    }
```

3. Im Abschnitt `// ===== MESSAGES =====` nach `finalMsg()` einfügen:

```js
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
```

4. Im Abschnitt `// ===== HELPERS =====` vor `teamSizes` einfügen:

```js
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
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add server/session.js server/session.test.js
git commit -m "feat(multiplayer): show a team its own guesses once a player answered

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Durchschnitt werten, Reveal und Endstand pro Team

**Files:**
- Modify: `server/session.js` (`constructor`, `answer`, `endRound`, neu `reveal`, `teamsInPlay`, `teamResult`, `revealMsg`, `finalMsg`, `resetScores`)
- Test: `server/session.test.js`

**Interfaces:**
- Consumes:
  - `penaltyPoints` und `MAX_PENALTY` (Task 1),
  - `guessOf`, `members` (Task 4),
  - `south` und `ZONE` (Task 4).
- Produces:
  - `reveal` enthält im Team-Modus `results[].team` und `teams: [{ id, points, lat, lng, picked, score }]`. Das Array umfasst nur Teams mit Spielern und ist nach `score` absteigend sortiert, bei Gleichstand in Teamreihenfolge.
  - `final` enthält im Team-Modus `ranking: [{ id, score, members: string[] }]` und `winners: number[]`.
  - Neue Methode `reveal()`. Sie ersetzt den zweiten Teil von `endRound()`; Teil C ruft sie auch nach `decide` auf.
  - `teamsInPlay()` gibt `number[]` zurück.
  - `teamResult(team)` gibt `{ id, points, lat, lng, picked }` zurück. Teil B und C ersetzen den Rumpf.
  - Felder `teamScores` (Index ist das Team) und `teamRounds` (Index ist die Runde, Wert ist `teamResult[]`).

- [ ] **Step 1: Failing tests schreiben**

Am Ende von `server/session.test.js` anhängen:

```js
test("team play average: a team scores the rounded average of its players' points", () => {
    const { s, host, max, ida, eve, last } = teamGame();
    s.handle(host, south(0));
    s.handle(ida, south(2 * ZONE));
    s.handle(max, south(0));
    s.handle(eve, south(0));
    const reveal = last(host, "reveal");
    assert.deepEqual(reveal.teams, [
        { id: 1, points: 100, lat: null, lng: null, picked: null, score: 100 },
        { id: 0, points: 50, lat: null, lng: null, picked: null, score: 50 },
    ]);
    assert.deepEqual(reveal.results.map(r => [r.name, r.team]).sort(), [["Eve", 1], ["Hans", 0], ["Ida", 0], ["Max", 1]]);
});

test("team play average with minus points: a far guess costs up to 50, and so does giving no answer", () => {
    const { s, host, ida, eve, last } = teamGame({ ...AVERAGE, penalty: true });
    s.handle(host, south(0));
    // halfway from the last scoring step to three times its distance: −25
    s.handle(ida, south(2 * ZONE));
    s.handle(eve, south(0));
    // Max gives no answer: −50
    s.handle(host, { type: "endRound" });
    const reveal = last(host, "reveal");
    assert.deepEqual(reveal.results.map(r => [r.name, r.points]).sort(), [["Eve", 100], ["Hans", 100], ["Ida", -25], ["Max", -50]]);
    // (100 − 25) / 2 = 37.5 → 38 and (100 − 50) / 2 = 25
    assert.deepEqual(reveal.teams.map(t => [t.id, t.points]), [[0, 38], [1, 25]]);
});

test("team play average: a player gone for good does not drag the team down", () => {
    const { s, host, max, ida, eve, last, advance } = teamGame();
    s.disconnect(eve);
    s.handle(host, south(0));
    s.handle(ida, south(0));
    s.handle(max, south(0));
    advance(RECONNECT_MS);
    s.tick();
    assert.deepEqual(last(host, "reveal").teams.map(t => [t.id, t.points]), [[0, 100], [1, 100]]);
});

test("team play: a team whose players all left stays in the ranking and scores 0 from then on", () => {
    const { s, host, max, ida, eve, last } = teamGame();
    s.handle(max, { type: "leave" });
    s.handle(eve, { type: "leave" });
    s.handle(host, south(0));
    s.handle(ida, south(0));
    assert.deepEqual(last(host, "reveal").teams.map(t => [t.id, t.points, t.score]), [[0, 100, 100], [1, 0, 0]]);
});

test("team play: the final ranks the teams with their players, a tie has two winners; the teams stay for the next game", () => {
    const { s, host, max, ida, eve, last, begin, teamOf } = teamGame();
    for (let i = 0; i < 3; i++) {
        [host, max, ida, eve].forEach(conn => s.handle(conn, { type: "answer", index: i, lat: GUESSES[i].lat, lng: GUESSES[i].lng }));
        readyAll(s, s.round + 1);
        s.handle(host, { type: "next" });
    }
    const final = last(eve, "final");
    assert.deepEqual(final.ranking, [{ id: 0, score: 300, members: ["Hans", "Ida"] }, { id: 1, score: 300, members: ["Max", "Eve"] }]);
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
```

- [ ] **Step 2: Tests laufen lassen, sie müssen fehlschlagen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: Die neuen Tests zu Durchschnitt, „all left“ und Endstand schlagen fehl, weil `teams` fehlt und `ranking` die Spieler enthält. Der Test „without teams“ besteht.

- [ ] **Step 3: Implementieren**

In `server/session.js`:

1. Import erweitern:

```js
import { scoreAnswer, mapSize, penaltyPoints, MAX_PENALTY } from "../src/js/scoring.js";
```

2. Im `constructor` nach `this.kicked = new Set();` einfügen:

```js
        // team play: the score per team (index = team), and every round's team results (index = round)
        this.teamScores = [];
        this.teamRounds = [];
```

3. In `answer()` die Zeile `player.answers[this.round] = { ...answer, ...scoreAnswer(…) };` ersetzen durch:

```js
        const scored = scoreAnswer(this.settings.mode, this.guesses[this.round], answer);
        // Average with minus points: beyond the last scoring step a guess costs the team points
        if (this.settings.team === "average" && this.settings.penalty) scored.points += penaltyPoints(scored.distance, size);
        player.answers[this.round] = { ...answer, ...scored };
```

`size` ist in `answer()` schon definiert (`const size = mapSize(…)`).

4. `endRound()` komplett ersetzen durch `endRound()` und `reveal()`:

```js
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
        // whoever is gone for good does not drag the team down; whoever is there and gave no answer does
        const counted = this.members(team).filter(p => this.guessOf(p) || this.isPresent(p));
        const sum = counted.reduce((total, p) => total + p.answers[this.round].points, 0);
        // || 0: an average just below 0 would round to -0
        const points = counted.length ? Math.round(sum / counted.length) || 0 : 0;
        return { id: team, points, lat: null, lng: null, picked: null };
    }
```

5. `revealMsg()` ersetzen durch:

```js
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
```

6. `finalMsg()` ersetzen durch:

```js
    finalMsg() {
        // team play ranks the teams, with who played in them
        const rows = this.settings.team
            ? this.teamsInPlay().map(team => ({ id: team, score: this.teamScores[team] ?? 0, members: this.members(team).map(p => p.name) }))
            : [...this.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score }));
        const ranking = rows.sort((a, b) => b.score - a.score);
        const top = ranking[0]?.score;
        return { type: "final", ranking, winners: ranking.filter(r => r.score === top).map(r => r.id) };
    }
```

7. `resetScores()` ersetzen durch:

```js
    resetScores() {
        this.players.forEach(p => { p.score = 0; p.answers = []; p.ready = -1; p.stalled = false; });
        this.teamScores = [];
        this.teamRounds = [];
    }
```

8. Im Abschnitt `// ===== HELPERS =====` nach `members()` einfügen:

```js
    /**
     * The teams that have players, in team order
     */
    teamsInPlay() {
        return [...new Set([...this.players.values()].map(p => p.team))].sort((a, b) => a - b);
    }
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`. Auch alle bestehenden Tests zu `reveal` und `final` bleiben grün.

- [ ] **Step 5: Commit**

```bash
git add server/session.js server/session.test.js
git commit -m "feat(multiplayer): score teams by the average of their players, with optional minus points

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Client: Team-Lobby und Einstellungen

**Files:**
- Create: `src/js/multiplayerTeams.js`
- Modify:
  - `src/js/multiplayer.js` (Import, `constructor`, `init`, `readSettings`, `renderState`, `renderStatus`, `renderLobbyButtons`, `renderPlayers`, `describeSettings`)
  - `src/components/lobby/lobby.html`
  - `src/components/lobby/lobby.scss`
  - `src/i18n/en.json`, `src/i18n/zh.json`

**Interfaces:**
- Consumes: `settings.team`, `teams` und `penalty`; `state.players[].team`; die Nachrichten `team` und `shuffle` (Task 3).
- Produces (`multiplayerTeams.js`):
  - `TEAM_COLORS: string[10]`
  - `teamName(team) → string`
  - `teamDot(team) → jQuery`
  - Klasse `Teams` mit `constructor(mp)` und `renderLobby(s, item)`. Task 7 ergänzt `formatPoints`, `showGuesses`, `draw` und `clear`.
- DOM-IDs: `#mpTeam` (Variante), `#mpTeamCount` (Anzahl), `#mpPenalty` (Minuspunkte), `#mpTeamList` (Team-Blöcke), `#BUTTON_MP_SHUFFLE`.

- [ ] **Step 1: Neues Modul `src/js/multiplayerTeams.js` anlegen**

```js
import i18next from "i18next";

// one color per team, in team order: mp.teamNames names them the same way
export const TEAM_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#eab308", "#a855f7", "#f97316", "#14b8a6", "#ec4899", "#e5e5e5", "#92400e"];

const t = (key, options) => i18next.t(key, { ns: "common", ...options });

/**
 * "Team Blue": always put on the page with .text()
 */
export function teamName(team) {
    return t("mp.teamName", { name: t(`mp.teamNames.${team}`), interpolation: { escapeValue: false } });
}

/**
 * A round swatch in the team's color, in front of a name
 */
export function teamDot(team) {
    return $("<span class=\"team-dot\">").css("background", TEAM_COLORS[team]);
}

/**
 * Team play on the client: the lobby's teams (and, from the game on, the teammates' guesses on the map)
 */
export class Teams {
    constructor(mp) {
        this.mp = mp;
    }

    /**
     * The lobby in team play: a block per team, empty ones too so anybody can join them. A click on a team's head
     * joins it; `item` draws a player like the plain list does
     */
    renderLobby(s, item) {
        const blocks = Array.from({ length: s.settings.teams }, (_, team) => {
            const members = s.players.filter(p => p.team === team);
            const $head = $("<button class=\"mp-team-head\">")
                .attr("data-team", team)
                .prop("disabled", s.phase !== "lobby" || this.mp.watching)
                .append(teamDot(team), $("<span>").text(`${teamName(team)} · ${members.length}`));
            return $("<div class=\"mp-team\">").append($head, $("<ul class=\"mp-players\">").append(members.map(item)));
        });
        $("#mpTeamList").empty().append(blocks);
    }
}
```

- [ ] **Step 2: Lobby-HTML erweitern**

In `src/components/lobby/lobby.html` in `#mpSettings` direkt nach dem `</div>` der `mp-pair` mit `#mpNext` und `#mpNextDelay`, also vor dem `</div>`, das `#mpSettings` schließt, einfügen:

```html
            <label for="mpTeam" data-i18n="common:mp.settings.team" data-i18n-title="common:mp.settings.teamHint"></label>
            <div class="mp-pair" data-i18n-title="common:mp.settings.teamHint">
                <select id="mpTeam">
                    <option value="off" data-i18n="common:mp.teamModes.off"></option>
                    <option value="average" data-i18n="common:mp.teamModes.average"></option>
                </select>
                <select id="mpTeamCount" data-i18n-aria-label="common:mp.settings.teams" hidden>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                    <option value="6">6</option>
                    <option value="7">7</option>
                    <option value="8">8</option>
                    <option value="9">9</option>
                    <option value="10">10</option>
                </select>
            </div>
            <label for="mpPenalty" class="mp-penalty" data-i18n="common:mp.settings.penalty" data-i18n-title="common:mp.settings.penaltyHint" hidden></label>
            <select id="mpPenalty" class="mp-penalty" hidden>
                <option value="off" data-i18n="common:mp.off"></option>
                <option value="on" data-i18n="common:mp.on"></option>
            </select>
```

Direkt nach `<ul id="mpPlayers" class="mp-players"></ul>` einfügen:

```html
        <div id="mpTeamList" hidden></div>
        <button id="BUTTON_MP_SHUFFLE" class="host-only" data-i18n="common:mp.buttons.shuffle" hidden></button>
```

- [ ] **Step 3: `multiplayer.js` anpassen**

1. Import nach `import { rankMoves } from "./scoring.js";`:

```js
import { Teams, teamDot } from "./multiplayerTeams.js";
```

2. Im `constructor` nach `this.resumeCode = null;`:

```js
        // team play: the lobby's teams, the teammates' guesses
        this.teams = new Teams(this);
```

3. In `init()`:
   - Die Zeile `$("#mpPlayers").on("click", ".mp-promote, .mp-kick", (e) => {` ersetzen durch `$("#mpPlayers, #mpTeamList").on("click", ".mp-promote, .mp-kick", (e) => {`.
   - Nach `$("#BUTTON_MP_COPY_WATCH").on(…);` einfügen:

```js
        $("#mpTeamList").on("click", ".mp-team-head", (e) => this.send({ type: "team", team: Number(e.currentTarget.dataset.team) }));
        $("#BUTTON_MP_SHUFFLE").on("click", () => this.send({ type: "shuffle" }));
```

4. `readSettings()` ersetzen durch:

```js
    readSettings() {
        const rush = $("#mpTimer").val() === "rush";
        const mode = $("#mpMode").val();
        return {
            mode,
            timer: Number(rush ? $("#mpRush").val() : $("#mpTimer").val()),
            rounds: Number($("#mpRounds").val()),
            // 0: the host moves on with NEXT
            next: $("#mpNext").val() === "auto" ? Number($("#mpNextDelay").val()) : 0,
            // team play is classic only: switching to Find the Map turns it off
            team: mode === "classic" ? $("#mpTeam").val() : "off",
            teams: Number($("#mpTeamCount").val()),
            penalty: $("#mpPenalty").val() === "on",
        };
    }
```

5. In `renderState()` nach `if (next) $("#mpNextDelay").val(String(next));` einfügen:

```js
        const team = s.settings.team ?? "off";
        $("#mpTeam").val(team);
        $("#mpTeamCount").prop("hidden", team === "off");
        $(".mp-penalty").prop("hidden", team !== "average");
        // without teams the settings carry no team fields: the hidden selects keep their last choice for switching back
        if (s.settings.team) {
            $("#mpTeamCount").val(String(s.settings.teams));
            $("#mpPenalty").val(s.settings.penalty ? "on" : "off");
        }
```

6. In `renderStatus()` nach `$("#mpSettings select").prop("disabled", s.phase !== "lobby");` einfügen:

```js
        // team play is classic only
        $("#mpTeam").prop("disabled", s.phase !== "lobby" || s.settings.mode !== "classic");
```

7. In `renderLobbyButtons()`:
   - Den Block
     ```js
                 if (s.canStart) $start.removeAttr("title data-i18n-title");
                 else $start.attr({ "data-i18n-title": "common:mp.needPlayers", title: i18next.t("mp.needPlayers", { ns: "common" }) });
     ```
     ersetzen durch:

```js
            // in team play with somebody else there, what is missing is a second team
            const key = s.settings.team && s.players.some(p => p.connected && p.id !== s.hostId) ? "mp.needTeams" : "mp.needPlayers";
            if (s.canStart) $start.removeAttr("title data-i18n-title");
            else $start.attr({ "data-i18n-title": `common:${key}`, title: i18next.t(key, { ns: "common" }) });
```

   - Am Ende der Methode einfügen:

```js
        $("#BUTTON_MP_SHUFFLE").prop("hidden", s.phase !== "lobby" || !s.settings.team);
```

8. In `renderPlayers()`:
   - Die Zeile `$("#mpChips").empty().append(s.players.map(chip));` ersetzen durch:

```js
        const teamPlay = Boolean(s.settings.team);
        // in-game chips: team play shows each player's team in front of the name
        $("#mpChips").empty().append(s.players.map(p => chip(p).prepend(teamPlay ? teamDot(p.team) : null)));
```

   - Den Block `$("#mpPlayers").empty().append(s.players.map(p => { … }));` in eine Funktion `item` umbauen. Der Rumpf bleibt unverändert, nur der Aufruf ändert sich:

```js
        const item = p => {
            const $li = chip(p);
            if (!kickable || p.id === this.me) return $li;
            const button = (action, icon, key) => {
                // set as an attribute, not HTML: the name must not come out escaped
                const label = i18next.t(key, { ns: "common", name: p.name, interpolation: { escapeValue: false } });
                return $(`<button class="mp-${action}">`).text(icon).attr({ "data-id": p.id, "data-action": action, "aria-label": label, title: label });
            };
            // only to someone who is there: the role would move on again at once (see fixHost on the server)
            if (p.connected && p.back !== false) $li.append(button("promote", "🔑", "mp.makeHost"));
            return $li.append(button("kick", "✕", "mp.kick"));
        };
        // team play: a block per team instead of the one list
        if (teamPlay) this.teams.renderLobby(s, item);
        else $("#mpPlayers").empty().append(s.players.map(item));
        $("#mpPlayers").prop("hidden", teamPlay);
        $("#mpTeamList").prop("hidden", !teamPlay);
```

   - Die Zeile `const kickable = s.phase === "lobby" && this.isHost();` mit ihrem Kommentar bleibt davor stehen. Die Schleife über `#mpRanking li` am Ende bleibt unverändert.

9. `describeSettings()` ersetzen durch:

```js
    describeSettings({ mode, timer, rounds, next, team, teams, penalty }) {
        const t = (key, options) => i18next.t(key, { ns: "common", ...options });
        const modeLabel = mode === "classic" ? t("menu.classic") : t("menu.findMap");
        const timerLabel = { 0: t("timer.chill"), 60: t("timer.timedOption") }[timer] ?? `${t("timer.rush")} ${timer} s`;
        // a no-break space keeps "10 s" together when the summary wraps
        const nextLabel = next ? ` · ${t("mp.settings.next")}: ${t("mp.nextAuto")} ${next} s` : "";
        const penaltyLabel = team === "average" && penalty ? ` · ${t("mp.settings.penalty")}` : "";
        const teamLabel = team ? ` · ${t(`mp.teamModes.${team}`)} · ${t("mp.teamCount", { n: teams })}${penaltyLabel}` : "";
        return `${modeLabel} · ${timerLabel} · ${rounds} ${t("mp.rounds")}${nextLabel}${teamLabel}`;
    }
```

- [ ] **Step 4: Styles**

Am Ende von `src/components/lobby/lobby.scss` anhängen:

```scss
// team play: a round swatch in the team's color in front of a team's or a player's name

.team-dot {
    display: inline-block;
    width: 0.7em;
    height: 0.7em;
    margin-right: 0.4em;
    border-radius: 50%;
}

// team play lobby: a block per team; a click on its head joins it

#mpTeamList {
    display: flex;
    flex-direction: column;
    gap: 0.6em;
    width: 100%;
}

.mp-team {
    display: flex;
    flex-direction: column;
    gap: 0.4em;
    padding: 0.5em;
    border: 2px solid #333;
    border-radius: 12px;
}

.mp-team-head {
    align-self: flex-start;
    padding: 0.3em 0.6em;
    font-size: 0.95em;
    background: transparent;
    &:hover:not(:disabled) {
        background: #272727;
    }
}
```

- [ ] **Step 5: Übersetzungen ergänzen**

```bash
node -e '
const fs = require("fs");
const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === "object" ? merge(a[k] ?? {}, v) : v; return a; };
for (const [file, keys] of Object.entries(JSON.parse(process.argv[1]))) {
    fs.writeFileSync(file, JSON.stringify(merge(JSON.parse(fs.readFileSync(file, "utf8")), keys), null, 4) + "\n");
}
' '{
"src/i18n/en.json": { "mp": {
    "settings": { "team": "Teams", "teamHint": "Play in teams. Average: everyone guesses, a team scores the average of its players.", "teams": "Number of teams", "penalty": "Minus points", "penaltyHint": "Guesses that would score nothing cost up to 50 points (the further off, the more), and so does giving no answer." },
    "teamModes": { "off": "Off", "average": "Average" },
    "on": "On", "off": "Off",
    "teamCount": "{{n}} teams",
    "teamName": "Team {{name}}",
    "teamNames": { "0": "Blue", "1": "Red", "2": "Green", "3": "Yellow", "4": "Purple", "5": "Orange", "6": "Teal", "7": "Pink", "8": "White", "9": "Brown" },
    "needTeams": "At least two teams need players",
    "buttons": { "shuffle": "SHUFFLE" } } },
"src/i18n/zh.json": { "mp": {
    "settings": { "team": "组队", "teamHint": "分队游戏。平均分：每人都猜，队伍得分为队员得分的平均值。", "teams": "队伍数量", "penalty": "负分", "penaltyHint": "本应得零分的猜测最多扣 50 分（越远扣得越多），不作答同样扣分。" },
    "teamModes": { "off": "关闭", "average": "平均分" },
    "on": "开", "off": "关",
    "teamCount": "{{n}} 支队伍",
    "teamName": "{{name}}队",
    "teamNames": { "0": "蓝", "1": "红", "2": "绿", "3": "黄", "4": "紫", "5": "橙", "6": "青", "7": "粉", "8": "白", "9": "棕" },
    "needTeams": "至少需要两支有玩家的队伍",
    "buttons": { "shuffle": "随机分队" } } }
}'
git diff --stat src/i18n/
```

Expected: Beide Dateien sind geändert, und nur im Abschnitt `mp` sind Zeilen hinzugekommen. Prüfen mit `git diff src/i18n/en.json | grep "^-" | grep -v "^---"`: Es dürfen nur die schließenden Klammern bzw. Kommas betroffen sein.

- [ ] **Step 6: Build und Tests**

Run: `docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -w /app node:20 npm run build 2>&1 | tail -5`
Expected: `webpack … compiled successfully` (Warnungen zur Bundle-Größe sind bekannt).

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 7: Manuell prüfen**

Dev-Umgebung starten: `docker compose -f docker-compose.dev.yml up` (beim ersten Mal vorher `docker compose -f docker-compose.dev.yml run --rm dev npm ci`) und `http://localhost:3000` öffnen. Jeder Spieler braucht ein **eigenes Browserprofil**, weil der Token im `localStorage` liegt: zum Beispiel Chrome, ein Chrome-Inkognitofenster, Firefox und ein privates Firefox-Fenster.

- Host: MULTIPLAYER → Session erstellen. Unter „Teams“ „Average“ wählen. Daneben erscheint die Anzahl, darunter „Minus points“.
- Drei weitere Spieler treten bei und landen abwechselnd in Team Blau und Team Rot.
- Ein Klick auf den Kopf von Team Rot verschiebt den Spieler, und alle Lobbys aktualisieren sich.
- Anzahl auf 4 stellen: Zwei leere Blöcke erscheinen. Zurück auf 2 stellen: Spieler aus Team 3 und 4 landen in Blau oder Rot.
- MISCHEN (nur beim Host sichtbar) verteilt die Spieler neu.
- Alle Spieler in ein Team schieben: START ist gesperrt, der Tooltip zeigt „At least two teams need players“.
- **Review Focus 1:** Bei aktivem „Average“ den Modus auf „Find the Map“ stellen. „Teams“ springt auf „Off“ und ist gesperrt, eine Fehlermeldung „Invalid request“ erscheint **nicht**. Zurück auf Classic stellen: „Teams“ ist wieder wählbar.
- Die Zusammenfassung der Gäste zeigt zum Beispiel „Classic · Chill · 5 rounds · Average · 2 teams“.

- [ ] **Step 8: Commit**

```bash
git add src/js/multiplayerTeams.js src/js/multiplayer.js src/components/lobby/lobby.html src/components/lobby/lobby.scss src/i18n/en.json src/i18n/zh.json
git commit -m "feat(multiplayer): team play lobby: pick a variant, join a team, shuffle

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Client: Team-Guesses, Reveal und Endstand

**Files:**
- Modify:
  - `src/js/multiplayerTeams.js`
  - `src/js/multiplayer.js` (`onMessage`, `onRound`, `onReveal`, `addPlayerMarker`, `renderRanking`, `finalFromReveal`, `onFinal`, `stop`, neu `myTeam`)
  - `src/components/lobby/lobby.scss`

**Interfaces:**
- Consumes: `teamGuesses` (Task 4); `reveal.teams` und `results[].team`, `final.ranking[].members` (Task 5).
- Produces:
  - `formatPoints(points) → string`, also „+12“ bzw. „−23“ mit U+2212.
  - `Teams.showGuesses(msg)`, `Teams.draw()` und `Teams.clear()`; die Felder `Teams.layer` (`LayerGroup`) und `Teams.guesses`.
  - `Multiplayer.myTeam()` gibt `number|undefined` zurück.
  - `renderRanking($list, rows, winners, moves, mine)`. Die Zeilen dürfen `team` und `members` haben.

- [ ] **Step 1: `multiplayerTeams.js` erweitern**

Den Import oben ergänzen:

```js
import { CircleMarker, LayerGroup } from "leaflet";
```

Nach `teamDot` einfügen:

```js
/**
 * Round points with their sign: "+12", "−23" (a real minus, as wide as the plus)
 */
export function formatPoints(points) {
    return points < 0 ? `−${-points}` : `+${points}`;
}
```

In der Klasse `Teams` den `constructor` ersetzen und die Methoden ergänzen:

```js
    constructor(mp) {
        this.mp = mp;
        // teammates' guesses during a round: a layer of their own, so a new round or the reveal clears exactly these
        this.layer = new LayerGroup();
        this.guesses = [];
    }

    /**
     * Teammates' guesses of the running round as the server sends them (positions only)
     */
    showGuesses(msg) {
        if (msg.index !== this.mp.roundIndex) return;
        this.guesses = msg.guesses;
        this.draw();
    }

    /**
     * A dot in the team's color per teammate; the own guess is the player's marker already
     */
    draw() {
        const mp = this.mp;
        const color = TEAM_COLORS[mp.myTeam()];
        this.layer.clearLayers().addTo(mp.app.minimap);
        this.guesses.filter(g => g.id !== mp.me).forEach(g => {
            // an element, not a string: Leaflet would put a string in as HTML, and a name must never become HTML
            const label = document.createElement("span");
            label.textContent = g.name;
            new CircleMarker(mp.toMap(g), { radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 })
                .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -8], className: "mpTooltip" })
                .addTo(this.layer);
        });
    }

    clear() {
        this.guesses = [];
        this.layer.clearLayers();
    }
```

- [ ] **Step 2: `multiplayer.js` anpassen**

1. Den Import ersetzen durch:

```js
import { Teams, TEAM_COLORS, teamDot, teamName, formatPoints } from "./multiplayerTeams.js";
```

2. In `onMessage()` nach dem `case "final": … break;`:

```js
        case "teamGuesses":
            this.teams.showGuesses(msg);
            break;
```

3. In `stop()` nach `this.answered = false;`:

```js
        this.teams.clear();
```

4. In `onRound()` im Block `if (!resent) {` als erste Zeile:

```js
            this.teams.clear();
```

5. In `onReveal()`:
   - Nach `clearInterval(this.countdown);` einfügen:

```js
        // the reveal shows everyone's guesses as markers of their own
        this.teams.clear();
```

   - Den Block
     ```js
             const othersStyle = this.watching ? {} : { color: "#33d6ff", opacity: 0.5 };
             msg.results
                 .filter(r => r.lat !== null && r.id !== this.me)
                 .forEach(r => {
                     this.addPlayerMarker(r);
                     app.drawSolutionDistance(latLng, this.toMap(r), othersStyle);
                 });
     ```
     ersetzen durch:

```js
        const othersStyle = this.watching ? {} : { color: "#33d6ff", opacity: 0.5 };
        // team play: every line in its team's color
        const lineStyle = r => (msg.teams ? { color: TEAM_COLORS[r.team], opacity: 0.8 } : othersStyle);
        msg.results
            .filter(r => r.lat !== null && r.id !== this.me)
            .forEach(r => {
                this.addPlayerMarker(r);
                app.drawSolutionDistance(latLng, this.toMap(r), lineStyle(r));
            });
```

   - Den Block
     ```js
             if (mine) {
                 $("#dist").text(mine.distance === null ? "—" : app.formatDistance(mine.distance));
                 $("#points").text(mine.points);
     ```
     ersetzen durch:

```js
        // team play: the round counts for the team, so the team's points are the ones shown
        const points = msg.teams?.find(t => t.id === this.myTeam())?.points ?? mine?.points;
        if (mine) {
            $("#dist").text(mine.distance === null ? "—" : app.formatDistance(mine.distance));
            $("#points").text(points);
```

   - In `$("#mapName").text(`${mine.points} ${i18next.t("shared.points", { ns: "common" })}`).fadeIn();` `mine.points` durch `points` ersetzen.
   - Den Block
     ```js
             // round 1 has no places to leave: everybody started at 0
             this.renderRanking($("#mpRanking"), msg.results, [], msg.index > 0 ? rankMoves(msg.results) : {});
     ```
     ersetzen durch:

```js
        // team play ranks the teams; round 1 has no places to leave: everybody started at 0
        const rows = msg.teams ? msg.teams.map(t => ({ ...t, team: t.id, name: teamName(t.id) })) : msg.results;
        this.renderRanking($("#mpRanking"), rows, [], msg.index > 0 ? rankMoves(rows) : {}, msg.teams ? this.myTeam() : this.me);
```

6. `addPlayerMarker()` ersetzen durch:

```js
    addPlayerMarker(result, options = {}) {
        const mm = this.app.minimap;
        const label = document.createElement("span");
        label.textContent = `${result.name} ${formatPoints(result.points)}`;
        // team play: the team's color in front of the name
        if (result.team !== undefined) label.prepend(teamDot(result.team)[0]);
        return new guessMarker(this.toMap(result), { draggable: false, ...options }, mm)
            .addTo(mm.markersGroup)
            .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -45], className: "mpTooltip" });
    }
```

7. `finalFromReveal()` ersetzen durch:

```js
    finalFromReveal() {
        const { results, teams } = this.lastReveal;
        // team play ranks the teams, with who played in them
        const ranking = teams
            ? teams.map(t => ({ id: t.id, score: t.score, members: this.state.players.filter(p => p.team === t.id).map(p => p.name) }))
            : results.map(r => ({ id: r.id, name: r.name, score: r.score }));
        const top = ranking[0]?.score;
        this.onFinal({ ranking, winners: ranking.filter(r => r.score === top).map(r => r.id) });
    }
```

8. `onFinal()` ersetzen durch:

```js
    onFinal(msg) {
        clearInterval(this.countdown);
        // no prepare follows the last round, so its preloaded images (and their retries) would outlive the game
        this.preloader.keep([]);
        const teamPlay = Boolean(this.state?.settings.team);
        const rows = teamPlay ? msg.ranking.map(r => ({ ...r, team: r.id, name: teamName(r.id) })) : msg.ranking;
        const mine = teamPlay ? this.myTeam() : this.me;
        this.renderRanking($("#mpFinalRanking"), rows, msg.winners, {}, mine);
        const me = rows.find(r => r.id === mine);
        $("#scoreValue").text(me ? me.score : rows[0]?.score ?? 0);
        this.app.switchUI("results");
    }
```

9. `renderRanking()` ersetzen durch:

```js
    renderRanking($list, rows, winners = [], moves = {}, mine = this.me) {
        $list.empty();
        rows.forEach((row, i) => {
            const move = moves[row.id];
            // always there, empty without a move: the columns of every ranking line up
            const $move = $("<span class=\"move\">");
            if (move) $move.addClass(move).attr({ role: "img", "aria-label": i18next.t(`mp.${move}`, { ns: "common" }) });
            $("<li>")
                .attr("data-id", row.id)
                .toggleClass("me", row.id === mine)
                .append(
                    $("<span class=\"rank\">").text(winners.includes(row.id) ? "🏆" : `${i + 1}.`),
                    $move,
                    // team play: the team's color in front of its name
                    $("<span class=\"name\">").text(row.name).prepend(row.team === undefined ? null : teamDot(row.team)),
                    $("<span class=\"points\">").text(row.points === undefined ? "" : formatPoints(row.points)).toggleClass("negative", row.points < 0),
                    $("<span class=\"score\">").text(row.score),
                    // team play's final: who played in the team
                    row.members ? $("<span class=\"members\">").text(row.members.join(", ")) : null
                )
                .appendTo($list);
        });
    }
```

10. Nach `isHost()` einfügen:

```js
    /**
     * This player's team in team play (undefined on the big screen)
     */
    myTeam() {
        return this.state?.players.find(p => p.id === this.me)?.team;
    }
```

- [ ] **Step 3: Styles**

In `src/components/lobby/lobby.scss` im Block `.mp-ranking { … }` nach dem Block `.down { color: #e66; }` einfügen:

```scss
    .points.negative {
        color: #e66;
    }
    // team play's final: who played in the team, on a line of its own
    .members {
        grid-column: 1 / -1;
        font-size: 0.75em;
        color: #aaa;
    }
```

- [ ] **Step 4: Build und Tests**

Run: `docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -w /app node:20 npm run build 2>&1 | tail -5`
Expected: `compiled successfully`

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 5: Manuell prüfen**

Dev-Umgebung wie in Task 6, vier Spieler, „Average“, 2 Teams. Zusätzlich ein Zuschauer-Tab mit `?watch=CODE`.

- Runde 1: Spieler A (Blau) setzt einen Marker und tippt. Danach ist nichts von anderen Teams zu sehen.
- Spieler B (Blau) tippt. Jetzt sehen A und B den Guess des jeweils anderen als blauen Punkt mit Namen. Team Rot und der Zuschauer sehen ihn nicht.
- Reveal: Alle Pins haben einen Farbpunkt vor „Name +Punkte“, die Linien sind in Teamfarbe. Die Rangliste zeigt zwei Team-Zeilen, die eigene ist hervorgehoben. `#points` zeigt die Team-Punkte.
- Endstand: Team-Zeilen mit 🏆, darunter die Mitgliedernamen. Der große Score zeigt den Stand des eigenen Teams, der Zuschauer sieht den höchsten.
- **Review Focus 4:** Neues Spiel mit „Minus points: On“. Ein Team tippt bewusst weit daneben (andere Kartenecke), das andere gibt nichts ab. Die Rangliste zeigt rote „−…“-Punkte mit echtem Minus, ohne „+“. Die Pins zeigen „Name −50“.
- **Review Focus 2:** Ein Spieler tritt mit dem Namen `<img src=x onerror=alert(1)>` bei. In der Lobby, im Teammitglied-Punkt, im Reveal-Pin, in der Rangliste und im Endstand steht der Name als Text. Es erscheint kein Alert und kein kaputtes Bild.
- Ein Spiel ohne Teams läuft wie vorher: cyanfarbene Linien, Spieler-Rangliste.

- [ ] **Step 6: Commit**

```bash
git add src/js/multiplayerTeams.js src/js/multiplayer.js src/components/lobby/lobby.scss
git commit -m "feat(multiplayer): team play in the game: teammates' guesses, team ranking, team final

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Teil A abschließen

**Files:** keine Codeänderung.

- [ ] **Step 1: Komplette Testsuite**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 2: Regression ohne Teams**

In der Dev-Umgebung ein Spiel **ohne** Teams mit 2 Spielern durchspielen: Lobby, READY, START, 3 Runden, Reveal, Endstand und Nochmal spielen. Erwartet wird kein Unterschied zu `master`. Die Liste `#mpPlayers` ist sichtbar, `#mpTeamList` und MISCHEN sind ausgeblendet.

- [ ] **Step 3: Teil A ist mergebar**

Teil A ist für sich spielbar. Ob der Branch hier schon als PR rausgeht oder erst nach Teil C, entscheidet der Mensch. Dafür nichts committen.

---

# Teil B: Mittelpunkt

### Task 9: Server: Variante Mittelpunkt

**Files:**
- Modify: `src/js/scoring.js`, `server/validate.js`, `server/session.js`
- Test: `server/scoring.test.js`, `server/validate.test.js`, `server/session.test.js`

**Interfaces:**
- Consumes: `teamResult` und `guessOf` (Task 5, Task 4).
- Produces:
  - `export function centroid(points: {lat, lng}[]): {lat, lng}`.
  - `TEAM_MODES` enthält `"centroid"`.
  - `teamResult` liefert bei `centroid` den Team-Punkt (`lat`, `lng`) und `pointsForDistance` zu diesem Punkt.
  - Neue Methode `teamPoint(members)` gibt `{lat, lng}|null` zurück. Teil C erweitert sie um `picked`.

- [ ] **Step 1: Failing tests schreiben**

`server/scoring.test.js`: `centroid` zum Import hinzufügen und anhängen:

```js
test("centroid is the plain average position", () => {
    assert.deepEqual(centroid([{ lat: -100, lng: 50 }]), { lat: -100, lng: 50 });
    assert.deepEqual(centroid([{ lat: 0, lng: 0 }, { lat: -100, lng: 300 }, { lat: -200, lng: 0 }]), { lat: -100, lng: 100 });
});
```

`server/validate.test.js`: anhängen:

```js
test("validSettings: team play also takes Midpoint", () => {
    assert.equal(validSettings({ mode: "classic", timer: 0, rounds: 5, team: "centroid", teams: 3, penalty: false }), true);
    assert.equal(validSettings({ mode: "mapFinder", timer: 0, rounds: 5, team: "centroid", teams: 3, penalty: false }), false);
});
```

`server/session.test.js`: anhängen:

```js
const CENTROID = { ...AVERAGE, team: "centroid" };

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
```

- [ ] **Step 2: Tests laufen lassen, sie müssen fehlschlagen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: Die vier neuen Tests schlagen fehl (`centroid` fehlt, `centroid` ist als Variante ungültig).

- [ ] **Step 3: Implementieren**

1. In `src/js/scoring.js` nach `distance()` einfügen:

```js
/**
 * The plain average position of some guesses, in game coordinates
 */
export function centroid(points) {
    const mean = key => points.reduce((sum, p) => sum + p[key], 0) / points.length;
    return { lat: mean("lat"), lng: mean("lng") };
}
```

2. In `server/validate.js`:

```js
// team play: "off" is everyone for themselves
const TEAM_MODES = ["off", "average", "centroid"];
```

3. In `server/session.js` den Import erweitern:

```js
import { scoreAnswer, mapSize, penaltyPoints, MAX_PENALTY, centroid } from "../src/js/scoring.js";
```

`teamResult()` samt Kommentar ersetzen durch:

```js
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
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/js/scoring.js server/validate.js server/session.js server/scoring.test.js server/validate.test.js server/session.test.js
git commit -m "feat(multiplayer): Midpoint team play: a team plays the midpoint of its guesses

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Client: Mittelpunkt und Team-Marker im Reveal

**Files:**
- Modify: `src/components/lobby/lobby.html`, `src/js/multiplayerTeams.js`, `src/js/multiplayer.js` (`onReveal`), `src/i18n/en.json`, `src/i18n/zh.json`

**Interfaces:**
- Consumes: `reveal.teams[].lat` und `lng` (Task 9), `TEAM_COLORS`, `teamName`, `formatPoints` (Task 6 und 7).
- Produces: `Teams.addTeamMarker(t)` gibt einen `CircleMarker` in `minimap.markersGroup` zurück.

- [ ] **Step 1: Option in der Lobby**

In `src/components/lobby/lobby.html` in `#mpTeam` nach der Option `average`:

```html
                    <option value="centroid" data-i18n="common:mp.teamModes.centroid"></option>
```

- [ ] **Step 2: Team-Marker**

In `src/js/multiplayerTeams.js` in der Klasse `Teams` nach `clear()` einfügen:

```js
    /**
     * The point a team played at the reveal (Midpoint, Leader): bigger than a player's, with the team's name and points
     */
    addTeamMarker(t) {
        const mm = this.mp.app.minimap;
        const label = document.createElement("span");
        label.textContent = `${teamName(t.id)} ${formatPoints(t.points)}`;
        return new CircleMarker(this.mp.toMap(t), { radius: 13, color: "#fff", weight: 3, fillColor: TEAM_COLORS[t.id], fillOpacity: 1 })
            .addTo(mm.markersGroup)
            .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -13], className: "mpTooltip" });
    }
```

- [ ] **Step 3: Reveal anpassen**

In `src/js/multiplayer.js` in `onReveal()`:

- Den in Task 7 eingesetzten Block ab `const othersStyle` bis zum Ende des `if (mine && mine.lat !== null) { … }` ersetzen durch:

```js
        const othersStyle = this.watching ? {} : { color: "#33d6ff", opacity: 0.5 };
        // team play: every line in its team's color
        const lineStyle = r => (msg.teams ? { color: TEAM_COLORS[r.team], opacity: 0.8 } : othersStyle);
        // Midpoint and Leader play one point per team: only that point gets a line to the solution
        const lines = !msg.teams || this.state.settings.team === "average";
        msg.results
            .filter(r => r.lat !== null && r.id !== this.me)
            .forEach(r => {
                this.addPlayerMarker(r);
                if (lines) app.drawSolutionDistance(latLng, this.toMap(r), lineStyle(r));
            });
        if (mine && mine.lat !== null) {
            const you = { ...mine, name: i18next.t("mp.you", { ns: "common" }) };
            mm.guessMarker = this.addPlayerMarker(you, { iconClass: "mp-own", zIndexOffset: 1000 });
            if (lines) app.drawSolutionDistance(latLng);
        }
        (msg.teams ?? []).filter(t => t.lat !== null).forEach(t => {
            this.teams.addTeamMarker(t);
            app.drawSolutionDistance(latLng, this.toMap(t), { color: TEAM_COLORS[t.id], opacity: 1 });
        });
```

- Die Zeile `this.focusReveal(latLng, msg.results);` ersetzen durch:

```js
        this.focusReveal(latLng, [...msg.results, ...(msg.teams ?? [])]);
```

- [ ] **Step 4: Übersetzungen**

```bash
node -e '
const fs = require("fs");
const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === "object" ? merge(a[k] ?? {}, v) : v; return a; };
for (const [file, keys] of Object.entries(JSON.parse(process.argv[1]))) {
    fs.writeFileSync(file, JSON.stringify(merge(JSON.parse(fs.readFileSync(file, "utf8")), keys), null, 4) + "\n");
}
' '{
"src/i18n/en.json": { "mp": {
    "settings": { "teamHint": "Play in teams. Average: everyone guesses, a team scores the average of its players. Midpoint: everyone guesses, a team plays the midpoint of its guesses." },
    "teamModes": { "centroid": "Midpoint" } } },
"src/i18n/zh.json": { "mp": {
    "settings": { "teamHint": "分队游戏。平均分：每人都猜，队伍得分为队员得分的平均值。中点：每人都猜，队伍以所有猜测的中点计分。" },
    "teamModes": { "centroid": "中点" } } }
}'
```

- [ ] **Step 5: Build und Tests**

Run: `docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -w /app node:20 npm run build 2>&1 | tail -5`
Expected: `compiled successfully`

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 6: Manuell prüfen**

Vier Spieler, „Midpoint“, 2 Teams.
- Zwei Spieler eines Teams tippen bewusst links und rechts neben die richtige Stelle.
- Im Reveal sitzt der große Team-Punkt in der Mitte zwischen den beiden, beschriftet mit „Team Blue +…“. Nur er hat eine Linie zur Lösung, die Spieler-Pins haben keine.
- Die Ansicht zoomt so, dass Team-Punkte und Pins sichtbar sind.
- Ein Team, das nichts abgibt, hat keinen Team-Punkt und 0 Punkte.
- Gegenprobe mit „Average“: Dort haben weiterhin alle Pins Linien, und es gibt keinen Team-Punkt.

- [ ] **Step 7: Commit**

```bash
git add src/components/lobby/lobby.html src/js/multiplayerTeams.js src/js/multiplayer.js src/i18n/en.json src/i18n/zh.json
git commit -m "feat(multiplayer): Midpoint in the lobby and a team marker at the reveal

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

# Teil C: Leader

### Task 11: Server: Leader führen und übergeben

**Files:**
- Modify: `server/session.js`
- Test: `server/session.test.js`

**Interfaces:**
- Consumes: `members`, `teamsInPlay` (Task 4 und 5), `isPresent`.
- Produces:
  - Spieler-Feld `teamSince: number`.
  - Session-Feld `leaders` (Index ist das Team, Wert die Spieler-ID).
  - `fixLeaders()` gibt `boolean` zurück.
  - Nachricht `{ type: "lead", playerId }`: nur in der Lobby und nur vom Leader. Ein fremdes Team ergibt `INVALID`, ein Ziel, das weg oder offline ist, wird still ignoriert.
  - `state.players[].leader: boolean`.
  - Leader werden immer geführt, auch bei `average` und `centroid`.

- [ ] **Step 1: Failing tests schreiben**

Am Ende von `server/session.test.js` anhängen:

```js
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
```

- [ ] **Step 2: Tests laufen lassen, sie müssen fehlschlagen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: Die vier neuen Tests schlagen fehl, weil `leader` fehlt und `lead` mit `INVALID` beantwortet wird.

- [ ] **Step 3: Implementieren**

In `server/session.js`:

1. Im `constructor` nach `this.teamRounds = [];` einfügen:

```js
        // team play: who leads each team (index = team), kept for every variant; only Leader gives it a meaning
        this.leaders = [];
```

2. In `addPlayer()` im Objekt nach `team: this.smallestTeam()` ergänzen: `, teamSince: this.now()`.

3. In `create()` nach `this.hostId = player.id;` einfügen:

```js
        this.fixLeaders();
```

In `join()` nach `if (same?.id === this.hostId) this.hostId = player.id;` einfügen:

```js
        this.fixLeaders();
```

4. In `handle()` nach der Zeile mit `"team"` einfügen:

```js
        if (msg.type === "lead") return this.lead(player, msg.playerId);
```

5. `switchTeam()`: Die Zeile `player.team = team;` ersetzen durch:

```js
        player.team = team;
        player.teamSince = this.now();
        this.fixLeaders();
```

6. `shuffle()`: Die Zeile `players.forEach((p, i) => { p.team = i % this.settings.teams; });` ersetzen durch:

```js
        players.forEach((p, i) => {
            p.team = i % this.settings.teams;
            p.teamSince = this.now();
        });
        // new teams: their first player leads each
        this.leaders = [];
        this.fixLeaders();
```

7. `updateSettings()`: Die in Task 3 eingefügte Zeile ersetzen durch:

```js
        // fewer teams: the players of the dropped ones go to the smallest teams left
        if (this.settings.team) {
            this.players.forEach(p => {
                if (p.team < this.settings.teams) return;
                p.team = this.smallestTeam();
                p.teamSince = this.now();
            });
        }
        this.fixLeaders();
```

8. `leave()`: Nach `this.fixHost();` einfügen:

```js
        this.fixLeaders();
```

9. `toLobby()`: Nach der Zeile `this.players.forEach(p => { if (!p.connected) this.players.delete(p.id); });` einfügen:

```js
        this.fixLeaders();
```

10. `tick()`: Die erste Zeile `if (this.fixHost()) this.broadcastState();` ersetzen durch:

```js
        const host = this.fixHost();
        const leaders = this.fixLeaders();
        if (host || leaders) this.broadcastState();
```

11. Nach `fixHost()` einfügen:

```js
    /**
     * Every team with players has a leader: whoever leads stays while they are in the team and there (like the host,
     * see fixHost); otherwise the connected player who has been in the team longest takes over, and with nobody
     * connected whoever has been in it longest. True if a leader changed
     */
    fixLeaders() {
        const leaders = [];
        this.teamsInPlay().forEach(team => {
            const members = this.members(team).sort((a, b) => a.teamSince - b.teamSince);
            const current = this.players.get(this.leaders[team]);
            if (current?.team === team && this.isPresent(current)) leaders[team] = current.id;
            else leaders[team] = (members.find(p => p.connected) ?? (current?.team === team ? current : members[0])).id;
        });
        const changed = JSON.stringify(leaders) !== JSON.stringify(this.leaders);
        this.leaders = leaders;
        return changed;
    }
```

12. Nach `shuffle()` einfügen:

```js
    /**
     * Lobby only: a leader hands the role to someone in their own team who is there
     */
    lead(player, playerId) {
        if (this.phase !== "lobby" || this.leaders[player.team] !== player.id) return this.error(player.conn, "INVALID");
        const target = this.players.get(playerId);
        // gone or offline (left while the leader confirmed): nothing to do, the role would only move on again at once
        if (!target?.connected) return;
        if (target.team !== player.team) return this.error(player.conn, "INVALID");
        this.leaders[player.team] = target.id;
        this.broadcastState();
    }
```

13. In `stateMsg()` nach `team: p.team,`:

```js
                leader: this.leaders[p.team] === p.id,
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add server/session.js server/session.test.js
git commit -m "feat(multiplayer): every team has a leader who can hand the role over

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Server: Variante Leader mit Entscheidungsphase

**Files:**
- Modify: `server/validate.js`, `server/session.js`
- Test: `server/validate.test.js`, `server/session.test.js`

**Interfaces:**
- Consumes: `leaders`/`fixLeaders` (Task 11), `reveal()`/`teamResult`/`teamPoint` (Task 5 und 9), `sendTeamGuesses`/`seesTeam` (Task 4).
- Produces:
  - `TEAM_MODES` enthält `"leader"`. Neues Feld `decide` ∈ {10, 15, 20, 30, 45, 60} mit Default 20, das bei `team ≠ off` immer in `settings` steht.
  - Phase `decide` und Nachricht Server → alle `{ type: "decide", index, deadline, teams: number[] }`.
  - Nachricht Leader → Server `{ type: "pick", index, playerId }`.
  - `state.players[].picked: boolean`.
  - `teamGuesses` auch in `decide`.
  - `roundMsg().deadline` ist außerhalb von `round` `null`.
  - Methoden `leads(p)`, `startDecide()`, `deciding()`, `decideMsg()`, `pick()`, `checkDecideEnd()` und `sendAllTeamGuesses()`.

- [ ] **Step 1: Failing tests schreiben**

`server/validate.test.js` anhängen:

```js
test("validSettings: team play also takes Leader, whose leaders get 10–60 s to decide", () => {
    const settings = (over) => validSettings({ mode: "classic", timer: 0, rounds: 5, team: "leader", teams: 2, penalty: false, ...over });
    [10, 15, 20, 30, 45, 60].forEach(decide => assert.equal(settings({ decide }), true, `decide ${decide}`));
    [0, 5, 25, 90, "20", null].forEach(decide => assert.equal(settings({ decide }), false, `decide ${decide}`));
    assert.equal(settings({}), true);
});
```

`server/session.test.js`:

- Den Import oben um `GRACE_MS` erweitern:

```js
import { Session, MAX_PLAYERS, RECONNECT_MS, LOAD_FIRST_MS, LOAD_MS, COUNTDOWN_READY_MS, COUNTDOWN_FORCED_MS, HANDOVER_MS, GRACE_MS } from "./session.js";
```

- Die Fixture `AVERAGE` (Task 3) ersetzen. Der Server behält `decide` jetzt in jeder Team-Einstellung, so bleibt der Settings-Test aus Task 3 gültig:

```js
const AVERAGE = { ...CLASSIC, team: "average", teams: 2, penalty: false, decide: 20 };
```

- Am Ende anhängen:

```js
const LEADER = { ...AVERAGE, team: "leader" };

test("team play leader: START needs two players in every team that plays", () => {
    const { s, host, eve, last } = teamLobby(LEADER);
    s.handle(eve, { type: "team", team: 0 });
    assert.equal(last(host, "state").canStart, false);
    s.handle(eve, { type: "team", team: 1 });
    assert.equal(last(host, "state").canStart, true);
});

test("team play leader: the leader cannot guess; once the others answered, the leaders decide", () => {
    const { s, host, ida, eve, last } = teamGame(LEADER);
    s.handle(host, south(0));
    assert.equal(last(host, "error").code, "INVALID");
    s.handle(ida, south(0));
    assert.equal(s.phase, "round");
    s.handle(eve, south(0));
    assert.equal(last(host, "state").phase, "decide");
    assert.deepEqual(last(host, "decide"), { type: "decide", index: 0, deadline: s.now() + 20_000, teams: [0, 1] });
});

test("team play leader: the leader sees the team's guesses at once, and the whole team does while the leader decides", () => {
    const { s, host, max, ida, eve, all, last } = teamGame(LEADER);
    s.handle(ida, south(0));
    assert.deepEqual(last(host, "teamGuesses").guesses.map(g => g.name), ["Ida"]);
    assert.deepEqual([all(max, "teamGuesses"), all(eve, "teamGuesses")], [[], []]);
    s.handle(host, { type: "endRound" });
    // Eve gave no answer: her team has nothing to pick from, so only Hans decides
    assert.deepEqual(last(eve, "teamGuesses"), { type: "teamGuesses", index: 0, guesses: [] });
    assert.deepEqual(last(host, "decide").teams, [0]);
});

test("team play leader: each leader picks one guess of their own team; once all have, the reveal shows the picks", () => {
    const { s, host, max, ida, eve, all, last } = teamGame(LEADER);
    const id = (conn) => last(conn, "welcome").playerId;
    s.handle(ida, south(0));
    s.handle(eve, south(2 * ZONE));
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
    const { s, host, ida, eve, last, advance } = teamGame(LEADER);
    const idaId = last(ida, "welcome").playerId;
    s.handle(ida, south(0));
    s.handle(eve, south(0));
    s.handle(host, { type: "pick", index: 0, playerId: idaId });
    advance(20_000 + GRACE_MS - 1);
    s.tick();
    assert.equal(s.phase, "decide");
    advance(1);
    s.tick();
    assert.deepEqual(last(host, "reveal").teams.map(t => [t.id, t.points, t.lat, t.picked]), [[0, 100, -100, idaId], [1, 0, null, null]]);
});

test("team play leader: with no guess in any team there is nothing to decide", () => {
    const { s, host, last } = teamGame(LEADER);
    s.handle(host, { type: "endRound" });
    assert.equal(s.phase, "reveal");
    assert.equal(last(host, "decide"), undefined);
});

test("team play leader: a leader gone during the decision hands it to a teammate, who may pick their own guess", () => {
    const { s, host, max, ida, eve, last, advance } = teamGame({ ...LEADER, decide: 60 });
    const id = (conn) => last(conn, "welcome").playerId;
    s.handle(ida, south(0));
    s.handle(eve, south(0));
    s.disconnect(max);
    advance(RECONNECT_MS);
    s.tick();
    assert.equal(s.phase, "decide");
    s.handle(eve, { type: "pick", index: 0, playerId: id(eve) });
    s.handle(host, { type: "pick", index: 0, playerId: id(ida) });
    assert.deepEqual(last(host, "reveal").teams.map(t => [t.id, t.picked]), [[0, id(ida)], [1, id(eve)]]);
});

test("team play leader: who comes back during the decision gets the round, the decision and the team's guesses", () => {
    const { s, ida, eve, last } = teamGame(LEADER);
    s.handle(ida, south(0));
    s.handle(eve, south(0));
    s.disconnect(ida);
    const phone = {};
    s.join(phone, { token: last(ida, "welcome").token });
    assert.equal(last(phone, "state").phase, "decide");
    assert.deepEqual([last(phone, "round").index, last(phone, "round").deadline], [0, null]);
    assert.equal(last(phone, "decide").index, 0);
    assert.deepEqual(last(phone, "teamGuesses").guesses.map(g => g.name), ["Ida"]);
});

test("team play leader: a leader who reloads before picking can still pick; one who picked cannot again", () => {
    const { s, host, ida, eve, all, last } = teamGame(LEADER);
    const idaId = last(ida, "welcome").playerId;
    s.handle(ida, south(0));
    s.handle(eve, south(0));
    s.disconnect(host);
    const reloaded = {};
    s.join(reloaded, { token: last(host, "welcome").token });
    s.handle(reloaded, { type: "pick", index: 0, playerId: idaId });
    assert.deepEqual(all(reloaded, "error"), []);
    s.handle(reloaded, { type: "pick", index: 0, playerId: idaId });
    assert.equal(last(reloaded, "error").code, "INVALID");
});

test("team play leader: images reported during the decision count for the next round", () => {
    const { s, host, max, ida, eve, last } = teamGame(LEADER);
    const id = (conn) => last(conn, "welcome").playerId;
    s.handle(ida, south(0));
    s.handle(eve, south(0));
    readyAll(s, 1);
    s.handle(host, { type: "pick", index: 0, playerId: id(ida) });
    s.handle(max, { type: "pick", index: 0, playerId: id(eve) });
    s.handle(host, { type: "next" });
    // nobody is waited for: everyone had round 2's images already
    assert.equal(s.phase, "round");
});
```

- [ ] **Step 2: Tests laufen lassen, sie müssen fehlschlagen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: Der neue Validierungstest und alle `team play leader:`-Tests schlagen fehl, weil `leader` als Variante ungültig ist. Auch `team play: the settings carry the team fields …` schlägt jetzt fehl, weil `decide` in der Fixture steht, der Server es aber noch nicht behält.

- [ ] **Step 3: Validierung**

In `server/validate.js`:

```js
// team play: "off" is everyone for themselves
const TEAM_MODES = ["off", "average", "centroid", "leader"];
const MAX_TEAMS = 10;
// Leader: how long the leaders have to pick their team's guess
const DECIDES = [10, 15, 20, 30, 45, 60];
```

`validTeamSettings` ersetzen durch:

```js
function validTeamSettings({ mode, team = "off", teams = 2, penalty = false, decide = 20 }) {
    return TEAM_MODES.includes(team) && (team === "off" || mode === "classic")
        && Number.isInteger(teams) && teams >= 2 && teams <= MAX_TEAMS
        && typeof penalty === "boolean"
        && DECIDES.includes(decide);
}
```

- [ ] **Step 4: Session**

In `server/session.js`:

1. `pickSettings` ersetzen durch:

```js
function pickSettings({ mode, timer, rounds, next = 0, team = "off", teams = 2, penalty = false, decide = 20 }) {
    // without teams the settings stay what they were before team play: older clients and the plain game see no change
    if (team === "off") return { mode, timer, rounds, next };
    return { mode, timer, rounds, next, team, teams, penalty, decide };
}
```

2. Im `constructor` nach `this.leaders = [];`:

```js
        // Leader: the guess each team's leader picked this round (index = team)
        this.picks = [];
```

3. In `handle()` nach der Zeile mit `"lead"`:

```js
        if (msg.type === "pick") return this.pick(player, msg);
```

4. `answer()`: Die Bedingung der ersten Zeile um `this.leads(player)` erweitern:

```js
        if (this.phase !== "round" || msg.index !== this.round || player.answers[this.round] || this.leads(player) || !validAnswer(msg, this.settings.mode)) {
```

5. `checkRoundEnd()` ersetzen durch:

```js
    checkRoundEnd() {
        if (this.phase === "loading") return this.checkLoaded();
        if (this.phase === "decide") return this.checkDecideEnd();
        if (this.phase !== "round") return;
        // a leader guesses nothing
        const waiting = [...this.players.values()].some(p => this.isPresent(p) && !p.answers[this.round] && !this.leads(p));
        if (!waiting) this.endRound();
    }
```

6. In `endRound()` die letzte Zeile `this.reveal();` ersetzen durch:

```js
        if (this.settings.team === "leader") return this.startDecide();
        this.reveal();
```

7. Nach `endRound()` einfügen:

```js
    /**
     * Leader: the round is over for the players, now each leader picks one of their team's guesses
     */
    startDecide() {
        this.phase = "decide";
        this.deadline = this.now() + this.settings.decide * 1000;
        this.picks = [];
        if (this.deciding().length === 0) return this.reveal();
        this.broadcastState();
        this.broadcast(this.decideMsg());
        this.sendAllTeamGuesses();
    }

    /**
     * The teams whose leader has something to pick from: at least one guess on the map this round
     */
    deciding() {
        return this.teamsInPlay().filter(team => this.members(team).some(p => this.guessOf(p)));
    }

    /**
     * A leader picks the guess their team plays this round: one of their own team's, once
     */
    pick(player, { index, playerId }) {
        const target = this.players.get(playerId);
        if (this.phase !== "decide" || index !== this.round || !this.leads(player) || this.picks[player.team] !== undefined
            || target?.team !== player.team || !this.guessOf(target)) {
            return this.error(player.conn, "INVALID");
        }
        this.picks[player.team] = target.id;
        this.broadcastState();
        this.checkDecideEnd();
    }

    checkDecideEnd() {
        if (this.deciding().every(team => this.picks[team] !== undefined)) this.reveal();
    }
```

8. `teamResult()`: Die letzten drei Zeilen (ab `const at = this.teamPoint(members);`) ersetzen durch:

```js
        const picked = this.settings.team === "leader" ? this.picks[team] ?? null : null;
        const at = this.teamPoint(members, picked);
        const points = at ? scoreAnswer("classic", this.guesses[this.round], at).points : 0;
        return { id: team, points, lat: at?.lat ?? null, lng: at?.lng ?? null, picked };
```

`teamPoint()` ersetzen durch:

```js
    /**
     * The point a team plays: its leader's pick, or the midpoint of its guesses; null without one
     */
    teamPoint(members, picked) {
        if (this.settings.team === "leader") return picked ? this.guessOf(this.players.get(picked)) : null;
        const guesses = members.map(p => this.guessOf(p)).filter(Boolean);
        return guesses.length ? centroid(guesses) : null;
    }
```

9. `canStart()` ersetzen durch:

```js
    /**
     * Somebody to play against: at least one other player is connected (a watcher does not count), and in team play
     * at least two teams have somebody there; in Leader every one of them two, since the leader guesses nothing
     */
    canStart() {
        const others = Boolean(this.findPlayer(p => p.connected && p.id !== this.hostId));
        if (!others || !this.settings.team) return others;
        const playing = this.teamSizes(p => p.connected).filter(n => n > 0);
        const least = this.settings.team === "leader" ? 2 : 1;
        return playing.length >= 2 && playing.every(n => n >= least);
    }
```

10. `leave()`: Die in Task 11 eingefügte Zeile `this.fixLeaders();` ersetzen durch:

```js
        // a new leader sees the team's guesses at once
        if (this.fixLeaders()) this.sendAllTeamGuesses();
```

11. `tick()`: Nach `if (host || leaders) this.broadcastState();` einfügen:

```js
        // a new leader sees the team's guesses at once
        if (leaders) this.sendAllTeamGuesses();
```

Nach der Zeile `if (this.phase === "round" && this.deadline !== null && …) return this.endRound();` einfügen:

```js
        if (this.phase === "decide" && this.now() >= this.deadline + GRACE_MS) return this.reveal();
```

12. `ready()`: In der ersten Zeile `["loading", "round", "reveal"]` durch `["loading", "round", "decide", "reveal"]` ersetzen.

13. In `stateMsg()` nach `leader: …,`:

```js
                picked: this.phase === "decide" && this.leads(p) && this.picks[p.team] !== undefined,
```

14. `roundMsg()` ersetzen durch:

```js
    roundMsg() {
        const g = this.guesses[this.round];
        // resent in decide (a reconnect): the round's clock is over then, the leaders' runs (decideMsg)
        const deadline = this.phase === "round" ? this.deadline : null;
        return { type: "round", ...this.assets(this.round), total: this.guesses.length, submitter: g.submitter, deadline };
    }

    decideMsg() {
        return { type: "decide", index: this.round, deadline: this.deadline, teams: this.deciding() };
    }
```

15. `sendPhase()` ersetzen durch:

```js
    sendPhase(conn) {
        if (this.phase === "loading") this.send(conn, this.prepareMsg(this.round));
        // in decide the round stays on screen: its images first, then what the leaders do
        if (["round", "decide"].includes(this.phase)) this.send(conn, this.roundMsg());
        if (this.phase === "decide") this.send(conn, this.decideMsg());
        if (this.phase === "reveal") this.send(conn, this.revealMsg());
        if (this.phase === "final") this.send(conn, this.finalMsg());
        if (["round", "decide", "reveal"].includes(this.phase) && this.round + 1 < this.guesses.length) {
            this.send(conn, this.prepareMsg(this.round + 1));
        }
    }
```

16. In `sendTeamGuesses()` die erste Zeile ersetzen:

```js
        if (!this.settings.team || !["round", "decide"].includes(this.phase)) return;
```

`seesTeam()` ersetzen und danach `sendAllTeamGuesses()` und `leads()` einfügen:

```js
    /**
     * Who of a team sees its guesses: whoever answered already (so nobody copies), its leader (who guesses nothing),
     * and everyone while the leader decides
     */
    seesTeam(p) {
        return this.phase === "decide" || Boolean(p.answers[this.round]) || this.leads(p);
    }

    sendAllTeamGuesses() {
        this.teamsInPlay().forEach(team => this.sendTeamGuesses(team));
    }
```

Im Abschnitt `// ===== HELPERS =====` vor `guessOf` einfügen:

```js
    /**
     * Leader: this player leads their team, so guesses nothing and picks the team's guess instead
     */
    leads(p) {
        return this.settings.team === "leader" && this.leaders[p.team] === p.id;
    }
```

17. `resetScores()`: Nach `this.teamRounds = [];` einfügen:

```js
        this.picks = [];
```

- [ ] **Step 5: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add server/validate.js server/session.js server/validate.test.js server/session.test.js
git commit -m "feat(multiplayer): Leader team play: the leaders pick their team's guess after the round

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Client: Leader in der Lobby

**Files:**
- Modify: `src/components/lobby/lobby.html`, `src/components/lobby/lobby.scss`, `src/js/multiplayer.js` (`init`, `readSettings`, `renderState`, `renderPlayers`, `describeSettings`), `src/i18n/en.json`, `src/i18n/zh.json`

**Interfaces:**
- Consumes: `settings.decide`, `state.players[].leader`, Nachricht `lead` (Task 11 und 12).
- Produces: DOM `#mpDecide` (Klasse `mp-decide`); Button `.mp-lead` mit `data-action="lead"`.

- [ ] **Step 1: HTML**

In `#mpTeam` nach der Option `centroid`:

```html
                    <option value="leader" data-i18n="common:mp.teamModes.leader"></option>
```

Nach `<select id="mpPenalty" …>…</select>` einfügen:

```html
            <label for="mpDecide" class="mp-decide" data-i18n="common:mp.settings.decide" data-i18n-title="common:mp.settings.decideHint" hidden></label>
            <select id="mpDecide" class="mp-decide" hidden>
                <option value="10">10 s</option>
                <option value="15">15 s</option>
                <option value="20" selected>20 s</option>
                <option value="30">30 s</option>
                <option value="45">45 s</option>
                <option value="60">60 s</option>
            </select>
```

- [ ] **Step 2: `multiplayer.js`**

1. `init()`: Den Klick-Handler für die Spielerliste auf `.mp-lead` erweitern. Die Zeile `$("#mpPlayers, #mpTeamList").on("click", ".mp-promote, .mp-kick", (e) => {` ersetzen durch:

```js
        $("#mpPlayers, #mpTeamList").on("click", ".mp-promote, .mp-kick, .mp-lead", (e) => {
```

Der Rumpf schickt bereits `{ type: action, playerId: id }` und fragt `mp.confirm.${action}`, deshalb funktioniert `lead` ohne weitere Änderung.

2. `readSettings()`: Nach `penalty: …,` einfügen:

```js
            decide: Number($("#mpDecide").val()),
```

3. `renderState()`: Im Team-Block nach `$(".mp-penalty").prop("hidden", team !== "average");`:

```js
        $(".mp-decide").prop("hidden", team !== "leader");
```

Im `if (s.settings.team) { … }` ergänzen:

```js
            $("#mpDecide").val(String(s.settings.decide));
```

4. `renderPlayers()`:
   - In `chip` den Text-Ausdruck `${p.id === s.hostId ? "👑 " : ""}${p.name}` ersetzen durch `${p.id === s.hostId ? "👑 " : ""}${s.settings.team === "leader" && p.leader ? "⭐ " : ""}${p.name}`.
   - Vor `const item = p => {` einfügen:

```js
        // Leader: in the lobby a leader may hand the role to a teammate who is there
        const me = s.players.find(p => p.id === this.me);
        const leadable = p => s.phase === "lobby" && s.settings.team === "leader" && me?.leader && p.team === me.team && p.id !== this.me && p.connected;
```

   - `item` so umbauen, dass `button` vor dem frühen `return` steht und 🎖️ für alle gilt, die übergeben dürfen:

```js
        const item = p => {
            const $li = chip(p);
            const button = (action, icon, key) => {
                // set as an attribute, not HTML: the name must not come out escaped
                const label = i18next.t(key, { ns: "common", name: p.name, interpolation: { escapeValue: false } });
                return $(`<button class="mp-${action}">`).text(icon).attr({ "data-id": p.id, "data-action": action, "aria-label": label, title: label });
            };
            if (leadable(p)) $li.append(button("lead", "🎖️", "mp.makeLeader"));
            if (!kickable || p.id === this.me) return $li;
            // only to someone who is there: the role would move on again at once (see fixHost on the server)
            if (p.connected && p.back !== false) $li.append(button("promote", "🔑", "mp.makeHost"));
            return $li.append(button("kick", "✕", "mp.kick"));
        };
```

5. `describeSettings()`: Signatur und Team-Text ersetzen:

```js
    describeSettings({ mode, timer, rounds, next, team, teams, penalty, decide }) {
```

```js
        const penaltyLabel = team === "average" && penalty ? ` · ${t("mp.settings.penalty")}` : "";
        const decideLabel = team === "leader" ? ` · ${t("mp.settings.decide")} ${decide} s` : "";
        const teamLabel = team ? ` · ${t(`mp.teamModes.${team}`)} · ${t("mp.teamCount", { n: teams })}${penaltyLabel}${decideLabel}` : "";
```

- [ ] **Step 3: Styles**

In `src/components/lobby/lobby.scss` den Selektor

```scss
    .mp-promote,
    .mp-kick {
```

ersetzen durch:

```scss
    .mp-promote,
    .mp-kick,
    .mp-lead {
```

- [ ] **Step 4: Übersetzungen**

```bash
node -e '
const fs = require("fs");
const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === "object" ? merge(a[k] ?? {}, v) : v; return a; };
for (const [file, keys] of Object.entries(JSON.parse(process.argv[1]))) {
    fs.writeFileSync(file, JSON.stringify(merge(JSON.parse(fs.readFileSync(file, "utf8")), keys), null, 4) + "\n");
}
' '{
"src/i18n/en.json": { "mp": {
    "settings": { "teamHint": "Play in teams. Average: everyone guesses, a team scores the average of its players. Midpoint: everyone guesses, a team plays the midpoint of its guesses. Leader: the members guess, the leader picks one of their guesses for the team.", "decide": "Decision time", "decideHint": "How long the leaders have after the round to pick one of their team guesses." },
    "teamModes": { "leader": "Leader" },
    "makeLeader": "Make {{name}} leader",
    "confirm": { "lead": "Make {{name}} the leader of your team? You will guess yourself then." },
    "needTeams": "At least two teams need players, and in Leader mode two in every team" } },
"src/i18n/zh.json": { "mp": {
    "settings": { "teamHint": "分队游戏。平均分：每人都猜，队伍得分为队员得分的平均值。中点：每人都猜，队伍以所有猜测的中点计分。队长：队员猜测，队长从中选出一个作为队伍的答案。", "decide": "队长决定时间", "decideHint": "回合结束后，队长从队员的猜测中选出一个的时间。" },
    "teamModes": { "leader": "队长" },
    "makeLeader": "让 {{name}} 担任队长",
    "confirm": { "lead": "让 {{name}} 担任队长？之后你将自己猜测。" },
    "needTeams": "至少需要两支有玩家的队伍；队长模式下每队至少两人" } }
}'
```

- [ ] **Step 5: Build und Tests**

Run: `docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -w /app node:20 npm run build 2>&1 | tail -5`
Expected: `compiled successfully`

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 6: Manuell prüfen**

- „Leader“ wählen: „Decision time“ erscheint und „Minus points“ verschwindet. Die Zusammenfassung zeigt „… · Leader · 2 teams · Decision time 20 s“.
- Pro Team ist der Erste mit ⭐ markiert. Der Leader sieht bei seinen Teammitgliedern 🎖️, andere sehen es nicht.
- 🎖️ öffnet eine Rückfrage. Nach der Bestätigung trägt das Teammitglied den ⭐.
- Ein Team hat nur einen Spieler: START ist gesperrt, der Tooltip nennt die Leader-Regel.

- [ ] **Step 7: Commit**

```bash
git add src/components/lobby/lobby.html src/components/lobby/lobby.scss src/js/multiplayer.js src/i18n/en.json src/i18n/zh.json
git commit -m "feat(multiplayer): Leader in the lobby: decision time, leader marks, handing the role over

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Client: Leader in Runde und Entscheidungsphase

**Files:**
- Modify:
  - `src/js/multiplayerTeams.js`
  - `src/js/multiplayer.js` (`onMessage`, `onRound`, `submitAnswer`, `renderStatus`, neu `isLeading`, `mayGuess`, `onDecide`, `submitPick`)
  - `src/js/squadMinimap.js` (`createGuessMarker`)
  - `src/i18n/en.json`, `src/i18n/zh.json`

**Interfaces:**
- Consumes: Nachrichten `decide` und `teamGuesses` in `decide`, `state.players[].picked`, Nachricht `pick` (Task 12); `Teams.draw()` (Task 7); Team-Marker im Reveal (Task 10).
- Produces:
  - `Teams.picking: boolean`, `Teams.selected: string|null`, `Teams.startPicking(on)`, `Teams.select(id)` und `Teams.lock()`.
  - `Multiplayer.isLeading()`, `mayGuess()`, `onDecide(msg)` und `submitPick()`.

- [ ] **Step 1: Auswahl in `multiplayerTeams.js`**

Im `constructor` von `Teams` nach `this.guesses = [];`:

```js
        // Leader: while the leader decides, a click on a teammate's guess selects it (selected), PICK sends it
        this.picking = false;
        this.selected = null;
```

`draw()` ersetzen durch:

```js
    draw() {
        const mp = this.mp;
        const color = TEAM_COLORS[mp.myTeam()];
        this.layer.clearLayers().addTo(mp.app.minimap);
        // a leader who picks sees their own guess as a choice too (they may have guessed before they led)
        this.guesses.filter(g => this.picking || g.id !== mp.me).forEach(g => {
            const selected = g.id === this.selected;
            // an element, not a string: Leaflet would put a string in as HTML, and a name must never become HTML
            const label = document.createElement("span");
            label.textContent = g.name;
            const marker = new CircleMarker(mp.toMap(g), {
                radius: selected ? 13 : 8,
                color: selected ? "#ff4d4d" : "#fff",
                weight: selected ? 4 : 2,
                fillColor: color,
                fillOpacity: 1,
                // a click on a guess must not also reach the map
                bubblingMouseEvents: false,
            })
                .bindTooltip(label, { permanent: true, direction: "top", offset: [0, selected ? -13 : -8], className: "mpTooltip" })
                .addTo(this.layer);
            if (this.picking) marker.on("click", () => this.select(g.id));
        });
    }

    /**
     * Leader: whether this leader picks now; a new decision starts with nothing selected
     */
    startPicking(on) {
        this.picking = on;
        this.selected = null;
        this.draw();
    }

    select(id) {
        this.selected = id;
        this.draw();
        this.mp.app.BUTTON_GUESS.prop("disabled", false);
    }

    /**
     * The pick is sent: the selection stays on the map, nothing can be clicked any more
     */
    lock() {
        this.picking = false;
        this.draw();
    }
```

`clear()` ersetzen durch:

```js
    clear() {
        this.guesses = [];
        this.picking = false;
        this.selected = null;
        this.layer.clearLayers();
    }
```

- [ ] **Step 2: Kein Marker für den Leader**

In `src/js/squadMinimap.js` in `createGuessMarker(latlng)` nach `if (App.solutionMarker) return;` einfügen:

```js
        // Leader: the leader guesses nothing, and nobody guesses while the leaders decide
        if (App.mp.active && !App.mp.mayGuess()) return;
```

- [ ] **Step 3: `multiplayer.js`**

1. Nach `myTeam()` einfügen:

```js
    /**
     * Leader: this player leads their team, so guesses nothing and picks the team's guess instead
     */
    isLeading() {
        return this.state?.settings.team === "leader" && Boolean(this.state.players.find(p => p.id === this.me)?.leader);
    }

    /**
     * May this player place a guess marker now: not as a leader, and not while the leaders decide
     */
    mayGuess() {
        return this.state?.phase !== "decide" && !this.isLeading();
    }
```

2. `onMessage()`: Nach `case "teamGuesses": … break;`:

```js
        case "decide":
            this.onDecide(msg);
            break;
```

3. `onRound()`:
   - Die Zeile `app.BUTTON_GUESS.prop({ hidden: this.watching || this.answered, disabled: !unsent });` ersetzen durch:

```js
        // a decision before (Leader) renamed the button
        app.BUTTON_GUESS.attr("data-i18n", "common:game.buttons.guess").text(i18next.t("game.buttons.guess", { ns: "common" }));
        app.BUTTON_GUESS.prop({ hidden: this.watching || this.answered || this.isLeading(), disabled: !unsent });
```

4. Nach `onRound()` einfügen:

```js
    /**
     * Leader: the round is over for the players, the leaders pick their team's guess before the reveal. Nobody
     * guesses any more; a leader who picked already (and reloaded) does not pick again
     */
    onDecide(msg) {
        const app = this.app;
        this.decideTeams = msg.teams;
        this.answered = true;
        const me = this.state.players.find(p => p.id === this.me);
        const picking = this.isLeading() && !me?.picked && msg.teams.includes(this.myTeam());
        this.teams.startPicking(picking);
        app.BUTTON_GUESS.attr("data-i18n", "common:mp.buttons.pick").text(i18next.t("mp.buttons.pick", { ns: "common" }));
        app.BUTTON_GUESS.prop({ hidden: !picking, disabled: true });
        this.renderStatus();
        this.startCountdown(msg.deadline);
    }

    /**
     * Leader: sends the selected guess as the team's, also when the time runs out (like an answer)
     */
    submitPick() {
        if (!this.teams.picking || !this.teams.selected) return;
        this.send({ type: "pick", index: this.roundIndex, playerId: this.teams.selected });
        this.teams.lock();
        this.app.BUTTON_GUESS.prop({ hidden: true, disabled: true });
        this.renderStatus();
    }
```

5. `submitAnswer()`: Als erste Zeile einfügen:

```js
        // GUESS is PICK while the leaders decide, and the countdown's end sends the selection
        if (this.state?.phase === "decide") return this.submitPick();
```

6. `renderStatus()`: Vor der Zeile `if (s.phase !== "round") return;` einfügen:

```js
        if (s.phase === "decide") {
            const picked = s.players.filter(p => p.picked).length;
            const text = this.teams.picking
                ? i18next.t("mp.pickGuess", { ns: "common" })
                : i18next.t("mp.leadersDeciding", { ns: "common", picked, total: this.decideTeams?.length ?? 0 });
            $("#mpStatus").text(text).prop("hidden", false);
            return;
        }
        // Leader: the leader waits for the team, and sees how far it is
        if (s.phase === "round" && this.isLeading()) {
            const team = s.players.filter(p => p.connected && p.team === this.myTeam() && p.id !== this.me);
            $("#mpStatus").text(i18next.t("mp.teamGuessing", { ns: "common", answered: team.filter(p => p.answered).length, total: team.length })).prop("hidden", false);
            return;
        }
```

- [ ] **Step 4: Übersetzungen**

```bash
node -e '
const fs = require("fs");
const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === "object" ? merge(a[k] ?? {}, v) : v; return a; };
for (const [file, keys] of Object.entries(JSON.parse(process.argv[1]))) {
    fs.writeFileSync(file, JSON.stringify(merge(JSON.parse(fs.readFileSync(file, "utf8")), keys), null, 4) + "\n");
}
' '{
"src/i18n/en.json": { "mp": {
    "teamGuessing": "Your team is guessing ({{answered}}/{{total}})",
    "pickGuess": "Pick the guess for your team",
    "leadersDeciding": "Leaders are deciding ({{picked}}/{{total}})",
    "buttons": { "pick": "PICK" } } },
"src/i18n/zh.json": { "mp": {
    "teamGuessing": "队员正在猜测（{{answered}}/{{total}}）",
    "pickGuess": "为你的队伍选择一个猜测",
    "leadersDeciding": "队长正在决定（{{picked}}/{{total}}）",
    "buttons": { "pick": "选择" } } }
}'
```

- [ ] **Step 5: Build und Tests**

Run: `docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -w /app node:20 npm run build 2>&1 | tail -5`
Expected: `compiled successfully`

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 6: Manuell prüfen**

Vier Spieler (zwei pro Team), „Leader“, „Decision time 20 s“, Timer „Chill“, dazu ein Zuschauer-Tab.

- **Runde, Leader:**
  - Ein Klick auf die Karte setzt keinen Marker, und GUESS fehlt.
  - Die Statuszeile zeigt „Your team is guessing (0/1)“.
  - Sobald das Mitglied tippt, erscheint dessen Punkt sofort beim Leader, und der Status wechselt auf 1/1.
- **Entscheidung:**
  - Wenn alle Mitglieder getippt haben, startet der 20-s-Timer bei allen.
  - Der Leader sieht „Pick the guess for your team“.
  - Ein Klick auf einen Teammitglied-Punkt vergrößert ihn mit rotem Rand, und PICK wird aktiv. PICK (oder die Leertaste) schickt die Auswahl. Danach ist nichts mehr klickbar, und der Status zeigt „Leaders are deciding (1/2)“.
  - Mitglieder sehen jetzt alle Punkte ihres Teams. Der Zuschauer sieht nur Timer und Status.
- **Timeout:** Ein Leader wählt aus, ohne zu bestätigen. Nach Ablauf zählt die Auswahl. Ein Leader, der gar nichts wählt, bringt seinem Team 0 Punkte.
- **Reveal:** Der Team-Marker sitzt auf dem gewählten Guess, beschriftet mit „Team Blue +…“. Nur er hat eine Linie zur Lösung. Beim Leader zeigt `#dist` „—“ und `#points` die Team-Punkte.
- **Review Focus 5:**
  - Der Leader wählt in `decide` aus, bestätigt aber nicht, und lädt neu. Danach ist er wieder in der Entscheidung, kann erneut auswählen und mit PICK bestätigen.
  - Der Leader bestätigt und lädt neu. PICK ist danach ausgeblendet, und ein Klick auf einen Punkt wählt nichts aus.
- **Nächste Runde:** Der Button heißt wieder GUESS, und für Mitglieder funktioniert das Tippen wie gewohnt.
- **Regression:** Ein Spiel ohne Teams und je eine Runde „Average“ und „Midpoint“ laufen unverändert.

- [ ] **Step 7: Commit**

```bash
git add src/js/multiplayerTeams.js src/js/multiplayer.js src/js/squadMinimap.js src/i18n/en.json src/i18n/zh.json
git commit -m "feat(multiplayer): Leader in the game: the leader watches the team guess, then picks one

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
