# Wiederbeitreten nach Rausfliegen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wer aus einem laufenden Multiplayer-Spiel fliegt, sieht im Menü und im Multiplayer-Formular einen Hinweis mit REJOIN, solange der Server den gespeicherten Token noch einem Spieler eines nicht beendeten Spiels zuordnet. Wer die Lobby verlässt, muss das bestätigen, und die anderen bekommen einen Hinweis.

**Architecture:**
- Der Server bekommt eine nebenwirkungsfreie Begrüßungsnachricht `check`. `Session.check()` beantwortet sie mit `resumable` oder `SESSION_NOT_FOUND`.
- `leave()` ist nur noch in der Lobby endgültig und meldet dort `left` an alle.
- Der Client merkt sich `mp:last`. Er prüft beim Anzeigen von Menü oder Formular über einen Wegwerf-Socket und zeigt dann `.mp-resume`.
- Der Token bleibt beim Verlassen erhalten, außer in der Lobby. Dort fragt der Client vorher mit `confirm()` nach.

**Tech Stack:** Node 18 + `ws` (Server, `node:test`), Webpack 5, jQuery, i18next, SCSS.

**Spec:** `docs/superpowers/specs/2026-10-15-mp-resume-hint-design.md`

## Global Constraints

- Keine `Co-Authored-By`- oder andere AI-Attribution in Commit-Messages (globale Nutzer-Anweisung). Subagents ausdrücklich darauf hinweisen.
- Arbeiten auf dem Branch `feature/mp-resume-hint`. Er existiert schon und enthält die Spec. Nicht pushen, das macht der Nutzer aus PhpStorm.
- Codestil wie im Repo:
  - 4 Spaces, doppelte Anführungszeichen, Semikolons, ESM.
  - Klassen ohne Klassenfelder und ohne `#private` (jshint `esversion: 11`).
  - Kommentare auf Englisch, knapp, sie erklären das Warum.
- Nachrichten exakt:
  - Client → Server: `{ type: "check", code, token }`
  - Server → Client: `{ type: "resumable", code, phase, round, total }`, `{ type: "left", name }`, Ablehnung `{ type: "error", code: "SESSION_NOT_FOUND" }`
- localStorage-Schlüssel exakt: `mp:<CODE>` (Token), `mp:last` (Code der zuletzt per `welcome` betretenen Session), `mp:name`.
- i18n-Schlüssel exakt, unter `mp` in `src/i18n/en.json` und `src/i18n/zh.json`: `confirmLeave`, `left`, `resume.lobby`, `resume.game`, `dismissResume`, `buttons.rejoin`.
- Spielernamen sind Nutzereingaben:
  - Ins DOM nur per `.text()` oder `textContent`.
  - `openToast` setzt `innerHTML`, deshalb Namen nur über i18next mit Standard-Maskierung einsetzen. Für Toasts nie `escapeValue: false`.
- Tests: `npm test` (= `node --test server/`, läuft auf Node 18).
- Lint nur für geänderte Dateien. **Nicht** `npm run lint`, das führt `--fix` im ganzen Repo aus.
  - `npx eslint -c ./config/.eslintrc.js --rule 'linebreak-style: off' <dateien>`
  - `npx stylelint -c ./config/.stylelintrc.json <scss>`
  - `npx htmlhint --config ./config/.htmlhintrc.json --nocolor <html>`
  - jshint 0.5.9 stürzt ab, auch auf unverändertem master. Weglassen.

## Review Focus

Diese Fälle verlangt die Spec indirekt, aber kein automatischer Test deckt sie ab. Jeder ist als Prüfung in Task 5 eingetragen:

1. **Reload auf `/?join=CODE` im laufenden Spiel:** Der Hinweis darf nicht kurz aufblitzen. Die Prüfung aus `switchUI("menu")` läuft schon, bevor `mp.init()` still wieder beitritt.
2. **Spielername mit HTML** (z. B. `<i>Eve</i>`) verlässt die Lobby: Der Toast zeigt den Namen wörtlich, nichts wird kursiv.
3. **Zuschauer (große Anzeige) klickt in der Lobby aufs Logo:** keine Rückfrage. Er war nie Spieler, und auch der Token des Spieler-Tabs daneben bleibt.
4. **Rückfrage abgebrochen:** Es geht kein `leave` raus, der Spieler bleibt verbunden in der Lobby, die Seite bleibt, wo sie ist.
5. **REJOIN, nachdem das Spiel weitergelaufen ist:** Ist das Spiel inzwischen `final`, landet der Spieler beim Endergebnis. Ist der Host schon zurück in der Lobby, tritt er ihr als neuer Spieler bei. In keinem Fall hängt die Seite.

---

### Task 0: Noch nicht committete Änderungen des Nutzers sichern

Auf dem Branch liegen zwei fremde, noch nicht committete Änderungen:
- `join` während des Start-Countdowns (`server/session.js`, `server/session.test.js`)
- Ein Button zum Zurücksetzen der Ansicht in der Zoom-Leiste (`src/components/game/game.scss`, `src/js/squadMinimap.js`)

Sie werden unverändert in zwei eigenen Commits gesichert, damit die Feature-Commits sauber bleiben.

**Files:**
- Commit: `server/session.js`, `server/session.test.js`, `src/components/game/game.scss`, `src/js/squadMinimap.js`

- [ ] **Step 1: Prüfen, dass die Tests mit den Änderungen grün sind**

Run: `npm test`
Expected: `# pass 115`, `# fail 0`

- [ ] **Step 2: Zwei Commits**

```bash
git add server/session.js server/session.test.js
git commit -m "feat(mp): let players join during the start countdown"
git add src/components/game/game.scss src/js/squadMinimap.js
git commit -m "feat(map): add a reset view button to the zoom bar"
git status --short
```
Expected: Danach ist nur noch `?? hw_squadguesser_tallil.zip` offen. Diese Datei nicht anfassen.

---

### Task 1: Server – `check` und `over()`

**Files:**
- Modify: `server/session.js` (neue Methoden `check()` hinter `watch()` und `over()` hinter `joinable()`, `toLobby()`)
- Modify: `server/index.js` (`route()`)
- Test: `server/session.test.js`, `server/index.test.js`

**Interfaces:**
- Produces:
  - `Session.check(conn, token)`: schickt `conn` genau eine Nachricht, `{ type: "resumable", code, phase, round, total }` oder `{ type: "error", code: "SESSION_NOT_FOUND" }`. Ändert keinen Zustand, kein Broadcast, kein `touch()`.
  - `Session.over()`: `boolean`.
  - `index.js` routet `{ type: "check", code, token }` als Begrüßung, ohne `sessionOf`.

- [ ] **Step 1: Failing tests in `server/session.test.js`**

Am Ende der Datei anhängen:

```js
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
```

- [ ] **Step 2: Failing test in `server/index.test.js`**

Am Ende der Datei anhängen:

```js
test("check answers on its own socket, counts as its one greeting and makes it nobody in the session", { timeout: 5000 }, async (t) => {
    const client = await serve(t);
    const host = await client();
    host.sendJson(CREATE);
    const { code, token } = await host.next("welcome");

    const probe = await client();
    probe.sendJson({ type: "check", code: code.toLowerCase(), token });
    const answer = await probe.next("resumable");
    assert.deepEqual([answer.code, answer.phase, answer.round, answer.total], [code, "lobby", 0, 3]);
    probe.sendJson({ type: "join", code, name: "Eve" });
    assert.equal((await probe.next("error")).code, "INVALID");
    probe.sendJson({ type: "lobbyReady", ready: true });
    assert.equal((await probe.next("error")).code, "INVALID");

    const stranger = await client();
    stranger.sendJson({ type: "check", code: "ZZZZ", token });
    assert.equal((await stranger.next("error")).code, "SESSION_NOT_FOUND");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: Die drei neuen Tests schlagen fehl. Die beiden aus `session.test.js` mit `TypeError: s.check is not a function`. Der aus `index.test.js` läuft in sein Timeout, weil der Server `check` heute mit `INVALID` beantwortet und `next("resumable")` nie auflöst. Alle anderen bleiben grün.

- [ ] **Step 4: `check()` in `server/session.js`**

Direkt hinter der Methode `watch(conn)` (Abschnitt `// ===== ENTRY =====`) einfügen:

```js
    /**
     * Tells a page whether its stored token still belongs to a game it can go back to (the REJOIN hint).
     * Connects nobody and changes nothing: the way back in is join with that token
     */
    check(conn, token) {
        const player = this.findPlayer(p => p.token === token);
        if (!player || this.over()) return this.error(conn, "SESSION_NOT_FOUND");
        this.send(conn, { type: "resumable", code: this.code, phase: this.phase, round: this.round, total: this.guesses.length || this.settings.rounds });
    }
```

- [ ] **Step 5: `over()` und `toLobby()` in `server/session.js`**

Direkt hinter der Methode `joinable()` einfügen:

```js
    /**
     * The final, or already the last reveal: players see their results there without waiting for the host's "next"
     */
    over() {
        return this.phase === "final" || (this.phase === "reveal" && this.round + 1 === this.guesses.length);
    }
```

In `toLobby(conn)` ersetzen:

```js
        // the last reveal counts as over: players see their results without waiting for the host's "next",
        // and one of them may have become host there
        const lastReveal = this.phase === "reveal" && this.round + 1 === this.guesses.length;
        if (this.phase !== "final" && !lastReveal) return this.error(conn, "INVALID");
```

durch:

```js
        // also from the last reveal: one of the players on their results may have become host there
        if (!this.over()) return this.error(conn, "INVALID");
```

- [ ] **Step 6: `route()` in `server/index.js`**

Ersetzen:

```js
        if (["create", "join", "watch"].includes(msg.type)) {
```

durch:

```js
        if (["create", "join", "watch", "check"].includes(msg.type)) {
```

und ersetzen:

```js
        if (msg.type === "join" || msg.type === "watch") {
            const session = typeof msg.code === "string" && sessions.get(msg.code.toUpperCase());
            if (!session) return send(ws, { type: "error", code: "SESSION_NOT_FOUND" });
            const ok = msg.type === "join" ? session.join(ws, msg) : session.watch(ws);
```

durch:

```js
        if (["join", "watch", "check"].includes(msg.type)) {
            const session = typeof msg.code === "string" && sessions.get(msg.code.toUpperCase());
            if (!session) return send(ws, { type: "error", code: "SESSION_NOT_FOUND" });
            // a check binds nothing: its close is no player leaving and no activity that keeps an orphaned session alive
            if (msg.type === "check") return session.check(ws, msg.token);
            const ok = msg.type === "join" ? session.join(ws, msg) : session.watch(ws);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: `# pass 118`, `# fail 0`

- [ ] **Step 8: Lint**

Run: `npx eslint -c ./config/.eslintrc.js --rule 'linebreak-style: off' server/session.js server/index.js server/session.test.js server/index.test.js`
Expected: keine Ausgabe

- [ ] **Step 9: Commit**

```bash
git add server/session.js server/index.js server/session.test.js server/index.test.js
git commit -m "feat(mp): let a page check whether its stored token can rejoin a game"
```

---

### Task 2: Server – Verlassen im Countdown umkehrbar, `left` in der Lobby

**Files:**
- Modify: `server/session.js` (`leave()`)
- Test: `server/session.test.js`

**Interfaces:**
- Consumes: nichts aus Task 1.
- Produces: Broadcast `{ type: "left", name }`, wenn ein Spieler die Lobby-Phase selbst verlässt. Nicht bei einem Kick. Im Countdown bleibt ein gehender Spieler offline in `players`.

- [ ] **Step 1: Bestehende Tests an das neue Verhalten anpassen**

In `server/session.test.js` den Test `"until round 1 runs, players come and go like in the lobby: who left during the countdown can play again"` komplett ersetzen durch:

```js
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
```

Im Test `"the host can call the start off until round 1 runs: back to the lobby, ready marks stay, who left is gone"`:
- den Titel ersetzen durch `"the host can call the start off until round 1 runs: back to the lobby, ready marks stay, who left stays offline"`
- ersetzen:

```js
    assert.deepEqual(state.players.map(p => [p.name, p.lobbyReady]), [["Hans", false], ["Max", true]]);
    assert.deepEqual([...s.players.values()].map(p => [p.ready, p.stalled]), [[-1, false], [-1, false]]);
```

durch:

```js
    // Ida left during the countdown: offline like a dropped connection, she can come back with her token
    assert.deepEqual(state.players.map(p => [p.name, p.connected, p.lobbyReady]), [["Hans", true, false], ["Max", true, true], ["Ida", false, true]]);
    assert.deepEqual([...s.players.values()].map(p => [p.ready, p.stalled]), [[-1, false], [-1, false], [-1, false]]);
```

- [ ] **Step 2: Neue failing tests**

Am Ende von `server/session.test.js` anhängen:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: vier Tests schlagen fehl, nämlich die beiden angepassten und die beiden neuen. Max bzw. Ida fehlen in der Liste, `join` mit Token gibt `false` zurück, `all(host, "left")` ist `[]`.

- [ ] **Step 4: `leave()` in `server/session.js`**

Den Doc-Kommentar und den Anfang von `leave(player)` ersetzen:

```js
    /**
     * Explicit "leave": frees name and slot until round 1 runs; during a game the player stays in the ranking, offline.
     * Unlike a dropped connection it takes effect at once: a leaving host hands the role over right away.
     */
    leave(player) {
        if (this.joinable()) {
            this.players.delete(player.id);
        } else {
```

durch:

```js
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
```

Der `else`-Zweig und der Rest der Methode bleiben unverändert. `joinable()` wird weiterhin von `join()` benutzt.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: `# pass 120`, `# fail 0`

- [ ] **Step 6: Lint**

Run: `npx eslint -c ./config/.eslintrc.js --rule 'linebreak-style: off' server/session.js server/session.test.js`
Expected: keine Ausgabe

- [ ] **Step 7: Commit**

```bash
git add server/session.js server/session.test.js
git commit -m "feat(mp): keep who leaves during the start countdown, tell the lobby who left"
```

---

### Task 3: Client – Token behalten, Rückfrage in der Lobby, Toast `left`

**Files:**
- Modify: `src/js/multiplayer.js` (`init()`, `leave()`, `onMessage()`, `onError()`, `toast()`, neu `forget()` und `confirmLeave()`)
- Modify: `src/js/squadGuessr.js` (`setupNavigationButtons()`, Handler von `MAIN_LOGO`)
- Modify: `src/i18n/en.json`, `src/i18n/zh.json`

**Interfaces:**
- Consumes: Server-Broadcast `{ type: "left", name }` (Task 2).
- Produces:
  - `Multiplayer.forget(code)`: löscht `mp:<code>` und `mp:last`, wenn er auf `code` zeigt.
  - `Multiplayer.confirmLeave()`: `boolean`.
  - `toast(type, key, options = {})`.
  - Bei `welcome` steht `mp:last` im localStorage.

Für `multiplayer.js` gibt es keine automatischen Tests. Geprüft wird per Lint hier und im Browser in Task 5.

- [ ] **Step 1: `mp:last` beim `welcome` und `forget()`**

In `onMessage(msg)`, `case "welcome":`, ersetzen:

```js
            localStorage.setItem(`mp:${msg.code}`, msg.token);
```

durch:

```js
            localStorage.setItem(`mp:${msg.code}`, msg.token);
            // the session the REJOIN hint asks about (see checkResume)
            localStorage.setItem("mp:last", msg.code);
```

In `onError(code)` ersetzen:

```js
        if (code === "SESSION_NOT_FOUND" || code === "NAME_TAKEN") localStorage.removeItem(`mp:${this.hello?.code}`);
```

durch:

```js
        if (code === "SESSION_NOT_FOUND" || code === "NAME_TAKEN") this.forget(this.hello?.code);
```

Direkt hinter der Methode `leave()` einfügen:

```js
    /**
     * Drops a stored token that cannot get us back in any more, and the REJOIN pointer to it
     */
    forget(code) {
        localStorage.removeItem(`mp:${code}`);
        if (localStorage.getItem("mp:last") === code) localStorage.removeItem("mp:last");
    }
```

- [ ] **Step 2: Token nur in der Lobby löschen, `confirmLeave()`**

`leave()` ersetzen:

```js
    leave() {
        this.send({ type: "leave" });
        // a big-screen tab never held a player token: it must not drop the one the player tab next to it uses
        if (this.code && !this.watching) localStorage.removeItem(`mp:${this.code}`);
        this.stop();
        this.app.toMenu();
    }
```

durch:

```js
    leave() {
        this.send({ type: "leave" });
        // only the lobby drops the player for good; from the countdown on the token is the way back (REJOIN hint).
        // A big-screen tab never held a player token: it must not drop the one the player tab next to it uses
        if (this.state?.phase === "lobby" && !this.watching) this.forget(this.code);
        this.stop();
        this.app.toMenu();
    }

    /**
     * Leaving the lobby is final (the server drops the player, the token dies): asked first. Anywhere else the REJOIN
     * hint brings the player back, and a big screen never was one. Only for clicks: onError leaves without asking
     */
    confirmLeave() {
        if (this.watching || this.state?.phase !== "lobby") return true;
        return confirm(i18next.t("mp.confirmLeave", { ns: "common" }));
    }
```

In `init()` ersetzen:

```js
        $("#BUTTON_MP_LEAVE").on("click", () => this.leave());
```

durch:

```js
        $("#BUTTON_MP_LEAVE").on("click", () => { if (this.confirmLeave()) this.leave(); });
```

In `src/js/squadGuessr.js`, `setupNavigationButtons()`, ersetzen:

```js
        this.MAIN_LOGO.on("click", () => {
            this.stopTimer();
            if (this.mp.active) return this.mp.leave();
            this.toMenu();
        });
```

durch:

```js
        this.MAIN_LOGO.on("click", () => {
            // a "no" to leaving the lobby changes nothing at all
            if (this.mp.active && !this.mp.confirmLeave()) return;
            this.stopTimer();
            if (this.mp.active) return this.mp.leave();
            this.toMenu();
        });
```

`BUTTON_MENU` (Ergebnis-Seite, Phase `final`) bleibt ohne Rückfrage.

- [ ] **Step 3: Toast `left`**

In `onMessage(msg)` vor `case "error":` einfügen:

```js
        case "left":
            this.toast("info", "mp.left", { name: msg.name });
            break;
```

`toast()` ersetzen:

```js
    toast(type, key) {
        this.app.openToast(type, i18next.t(key, { ns: "common" }), "");
    }
```

durch:

```js
    toast(type, key, options = {}) {
        // openToast sets innerHTML: values (a player name is user input) go through i18next, which escapes them
        this.app.openToast(type, i18next.t(key, { ns: "common", ...options }), "");
    }
```

- [ ] **Step 4: Texte**

`src/i18n/en.json`, im Objekt `mp` hinter `"kick": "Remove {{name}}",` einfügen:

```json
        "confirmLeave": "Leave the lobby? You will need the code to come back.",
        "left": "{{name}} left the lobby",
```

`src/i18n/zh.json`, im Objekt `mp` hinter `"kick": "移除 {{name}}",` einfügen:

```json
        "confirmLeave": "确定离开房间吗？之后需要房间码才能重新加入。",
        "left": "{{name}} 离开了房间",
```

- [ ] **Step 5: Lint und JSON prüfen**

Run: `npx eslint -c ./config/.eslintrc.js --rule 'linebreak-style: off' src/js/multiplayer.js src/js/squadGuessr.js && node -e 'for (const f of ["src/i18n/en.json", "src/i18n/zh.json"]) { const m = JSON.parse(require("fs").readFileSync(f)).mp; if (!m.confirmLeave || !m.left) throw f; } console.log("ok")'`
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add src/js/multiplayer.js src/js/squadGuessr.js src/i18n/en.json src/i18n/zh.json
git commit -m "feat(mp): keep the token when leaving a game, confirm leaving the lobby, show who left"
```

---

### Task 4: Client – Prüfung und Hinweis zum Wiederbeitreten

**Files:**
- Modify: `src/js/multiplayer.js` (`constructor()`, `init()`, `open()`, `connect()`, neu `socketUrl()`, `checkResume()`, `showResume()`, `closeResume()`)
- Modify: `src/js/squadGuessr.js` (`switchUI()`)
- Modify: `src/components/menu/menu.html`, `src/components/lobby/lobby.html`, `src/components/lobby/lobby.scss`
- Modify: `src/i18n/en.json`, `src/i18n/zh.json`

**Interfaces:**
- Consumes:
  - Server `check` → `resumable` oder `SESSION_NOT_FOUND` (Task 1).
  - `Multiplayer.forget(code)` und `mp:last` (Task 3).
  - Das bestehende `Multiplayer.join(rawCode)`.
- Produces:
  - `Multiplayer.checkResume()`: wird von `switchUI()` aufgerufen.
  - `Multiplayer.closeResume()`.
  - `Multiplayer.socketUrl()`: `string`.

- [ ] **Step 1: Markup**

`src/components/menu/menu.html`: direkt nach `<div id="menu">` (vor `<h1 data-i18n="common:menu.gameMode">`) einfügen:

```html
    <div class="mp-resume" hidden>
        <span class="mp-resume-text"></span>
        <button class="mp-resume-join" data-i18n="common:mp.buttons.rejoin"></button>
        <button class="mp-resume-dismiss" data-i18n-title="common:mp.dismissResume" data-i18n-aria-label="common:mp.dismissResume">✕</button>
    </div>
```

`src/components/lobby/lobby.html`: in `#mpEntry` direkt nach `<h1 data-i18n="common:mp.title"></h1>` einfügen:

```html
        <div class="mp-resume" hidden>
            <span class="mp-resume-text"></span>
            <button class="mp-resume-join" data-i18n="common:mp.buttons.rejoin"></button>
            <button class="mp-resume-dismiss" data-i18n-title="common:mp.dismissResume" data-i18n-aria-label="common:mp.dismissResume">✕</button>
        </div>
```

- [ ] **Step 2: Styles**

Am Ende von `src/components/lobby/lobby.scss` anhängen:

```scss
// "still in a game": on the menu and on top of the multiplayer entry form

.mp-resume {
    display: flex;
    align-items: center;
    gap: 0.6em;
    width: min(360px, 100%);
    padding: 0.5em 0.5em 0.5em 1em;
    border: 2px solid variables.$mainColor;
    border-radius: 12px;
    background: rgba(17, 68, 126, 0.15);
    text-align: left;
    &[hidden] {
        display: none !important;
    }
    .mp-resume-text {
        flex: 1;
    }
    button {
        height: 40px;
        padding: 0 1em;
        border-radius: 8px;
    }
    .mp-resume-dismiss {
        padding: 0 0.6em;
        background: transparent;
    }
}

#menu .mp-resume {
    margin-bottom: 2em;
}

// the entry form makes every button full width and 52px high: the hint keeps its own
#lobby #mpEntry .mp-resume button {
    width: auto;
    height: 40px;
}
```

- [ ] **Step 3: JS in `src/js/multiplayer.js`**

Im `constructor`, hinter `this.startTimer = null;`, einfügen:

```js
        // the socket of a REJOIN check that is still waiting for its answer, null otherwise
        this.resumeCheck = null;
        // the session the REJOIN hint on screen offers
        this.resumeCode = null;
```

In `init()`, hinter der Zeile mit `$("#mpPlayers").on("click", ".mp-kick", …)`, einfügen:

```js
        $(".mp-resume-join").on("click", () => this.join(this.resumeCode));
        $(".mp-resume-dismiss").on("click", () => {
            this.forget(this.resumeCode);
            this.closeResume();
        });
```

In `open(hello)` hinter `this.hello = hello;` einfügen:

```js
        // on the way into a session: no hint, and a check still running must not bring it back
        this.closeResume();
```

In `connect()` ersetzen:

```js
        const protocol = location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${protocol}://${location.host}/mp`);
```

durch:

```js
        const ws = new WebSocket(this.socketUrl());
```

Direkt hinter der Methode `connect()` einfügen:

```js
    socketUrl() {
        const protocol = location.protocol === "https:" ? "wss" : "ws";
        return `${protocol}://${location.host}/mp`;
    }

    /**
     * Asks the server whether the last session we played in still knows our token, and offers the way back.
     * On a socket of its own: a check is nobody in the session. No retry: without an answer there is no hint
     */
    checkResume() {
        this.closeResume();
        const code = localStorage.getItem("mp:last");
        const token = code && localStorage.getItem(`mp:${code}`);
        if (!token) return;
        const ws = new WebSocket(this.socketUrl());
        this.resumeCheck = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: "check", code, token }));
        ws.onmessage = (event) => {
            ws.close();
            // a newer check took over, or we are in a session again by now (e.g. the silent rejoin after a reload)
            if (this.resumeCheck !== ws || this.active) return;
            this.resumeCheck = null;
            const msg = JSON.parse(event.data);
            if (msg.type !== "resumable") return this.forget(code);
            this.showResume(msg);
        };
    }

    showResume({ code, phase, round, total }) {
        this.resumeCode = code;
        const text = phase === "lobby"
            ? i18next.t("mp.resume.lobby", { ns: "common", code })
            : i18next.t("mp.resume.game", { ns: "common", code, round: round + 1, total });
        $(".mp-resume-text").text(text);
        $(".mp-resume").prop("hidden", false);
    }

    closeResume() {
        this.resumeCheck?.close();
        this.resumeCheck = null;
        $(".mp-resume").prop("hidden", true);
    }
```

- [ ] **Step 4: Auslöser in `src/js/squadGuessr.js`**

In `switchUI(page)` als erste Zeile des Methodenrumpfs einfügen (vor `// every page plus the footer logos: …`):

```js
        // the menu and the multiplayer entry form offer the way back into a game this browser dropped out of
        if (!this.mp.active && (page === "menu" || page === "lobby")) this.mp.checkResume();
```

- [ ] **Step 5: Texte**

`src/i18n/en.json`, im Objekt `mp` hinter `"left": "{{name}} left the lobby",` einfügen:

```json
        "resume": {
            "lobby": "You are still in lobby {{code}}",
            "game": "Game {{code}} is still running · round {{round}}/{{total}}"
        },
        "dismissResume": "Dismiss",
```

und in `mp.buttons` hinter `"watch": "WATCH"` (Komma davor ergänzen):

```json
            "rejoin": "REJOIN"
```

`src/i18n/zh.json`, im Objekt `mp` hinter `"left": "{{name}} 离开了房间",` einfügen:

```json
        "resume": {
            "lobby": "你仍在房间 {{code}} 中",
            "game": "游戏 {{code}} 仍在进行 · 第 {{round}}/{{total}} 轮"
        },
        "dismissResume": "忽略",
```

und in `mp.buttons` hinter `"watch": "观看"` (Komma davor ergänzen):

```json
            "rejoin": "重新加入"
```

- [ ] **Step 6: Lint und JSON prüfen**

Run:
```bash
npx eslint -c ./config/.eslintrc.js --rule 'linebreak-style: off' src/js/multiplayer.js src/js/squadGuessr.js
npx stylelint -c ./config/.stylelintrc.json src/components/lobby/lobby.scss
npx htmlhint --config ./config/.htmlhintrc.json --nocolor src/components/menu/menu.html src/components/lobby/lobby.html
node -e 'for (const f of ["src/i18n/en.json", "src/i18n/zh.json"]) { const m = JSON.parse(require("fs").readFileSync(f)).mp; if (!m.resume.lobby || !m.resume.game || !m.dismissResume || !m.buttons.rejoin) throw f; } console.log("ok")'
```
Expected: eslint und stylelint ohne Ausgabe, htmlhint `no errors`, zum Schluss `ok`.

- [ ] **Step 7: Commit**

```bash
git add src/js/multiplayer.js src/js/squadGuessr.js src/components/menu/menu.html src/components/lobby/lobby.html src/components/lobby/lobby.scss src/i18n/en.json src/i18n/zh.json
git commit -m "feat(mp): offer to rejoin a game this browser dropped out of"
```

---

### Task 5: Im Browser prüfen

Kein Code, außer eine Prüfung schlägt fehl. Dann den Fehler mit superpowers:systematic-debugging im zuständigen Task beheben, `npm test` und Lint erneut laufen lassen und einen eigenen `fix(mp): …`-Commit machen.

**Setup** (siehe Memory `local-mp-browser-testing`):
- MP-Server: `node ./server/index.js` per Bash `run_in_background`.
  - Stoppen nur mit `pkill -f '[n]ode \./server/index\.js'`. Ein breiteres Muster trifft den Container `squadguessr-mp-1` des Nutzers.
- Dev-Server: `docker run -d --rm --name sg-dev-test --network host -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack serve -c ./config/webpack.config.js`.
  - Warten, bis `docker logs sg-dev-test` "compiled successfully" zeigt. Das ist zugleich die Build-Prüfung.
- Spieler A auf `http://localhost:3000`, Spieler B auf `http://127.0.0.1:3000`. Getrennte Origins bedeuten getrennten localStorage.
- Tabs im Hintergrund per JS steuern.
- Toasts liest man über `#toast h4`.
- Vor jedem Klick, der `confirm()` auslösen kann, im Tab `window.confirm = () => true` setzen (oder `() => false` für Abbrechen). Ein echter Dialog blockiert die Browser-Steuerung.
- Den Docker-Stack `squadguessr-web-1` des Nutzers nicht anfassen.

- [ ] **Prüfung 1 – Reload (Review Focus 1):** A erstellt, B tritt bei, das Spiel startet, Runde 1 läuft. B lädt neu. Erwartet:
  - B ist wieder in Runde 1.
  - Direkt nach dem Laden gilt 20-mal im Abstand von 50 ms `$(".mp-resume:visible").length === 0`. Die Prüfung aus `switchUI("menu")` wird von `open()` geschlossen, bevor sie antwortet.
- [ ] **Prüfung 2 – Neuer Tab:** Während Runde 1 öffnet B einen zweiten Tab auf `http://127.0.0.1:3000/`. Erwartet:
  - Im Menü steht "Game XXXX is still running · round 1/N" mit REJOIN.
  - Nach Klick auf MULTIPLAYER steht derselbe Hinweis über dem Formular.
  - REJOIN führt den neuen Tab ins Spiel. Der alte Tab zeigt den Toast `REPLACED`, landet im Menü und zeigt dort selbst wieder den Hinweis (gewollt).
- [ ] **Prüfung 3 – Logo im Spiel:** B klickt mitten im Spiel aufs Logo. Erwartet:
  - Es gibt keine Rückfrage.
  - B landet im Menü mit dem Hinweis.
  - REJOIN bringt B zurück, und die Punkte in `#totalPoints` sind unverändert.
- [ ] **Prüfung 4 – Lobby verlassen:** neue Session, B ist in der Lobby.
  - Mit `window.confirm = () => false` auf LEAVE: B bleibt in der Lobby und verbunden, A sieht keinen Toast (Review Focus 4).
  - Das Gleiche beim Logo.
  - Mit `window.confirm = () => true` auf LEAVE: B landet im Menü ohne Hinweis, `localStorage.getItem("mp:last") === null`, A sieht den Toast "Max left the lobby".
- [ ] **Prüfung 5 – Name mit HTML (Review Focus 2):** B tritt als `<i>Eve</i>` bei und verlässt die Lobby mit Bestätigung. Erwartet: In A ergibt `$("#toast h4").text()` den Text `<i>Eve</i> left the lobby`, und `$("#toast h4 i").length === 0`.
- [ ] **Prüfung 6 – Zuschauer (Review Focus 3):** Ein Zuschauer-Tab (`?watch=CODE`) auf `localhost:3000` neben dem Spieler-Tab von A, in der Lobby. Vorher `window.confirm = () => { throw new Error("asked"); }` setzen, dann Logo-Klick im Zuschauer-Tab. Erwartet:
  - Es kommt kein Fehler.
  - Der Zuschauer landet im Menü.
  - `localStorage.getItem("mp:" + code)` von A ist unverändert.
- [ ] **Prüfung 7 – ✕ verwerfen:** Hinweis wie in Prüfung 3 herbeiführen und ✕ klicken. Erwartet:
  - Der Hinweis verschwindet.
  - `mp:last` und `mp:<CODE>` sind gelöscht.
  - Auch nach einem Reload von `/` erscheint kein Hinweis.
- [ ] **Prüfung 8 – Nach Spielende und REJOIN zu spät (Review Focus 5):**
  - B klickt in Runde N aufs Logo, der Hinweis erscheint. A spielt bis `final`. B klickt REJOIN und landet beim Endergebnis.
  - A drückt "nochmal spielen". B lädt `/` neu: kein Hinweis mehr, denn die Prüfung verneint, und `mp:last` ist gelöscht.
  - Variante: Hinweis sichtbar lassen, A geht zurück in die Lobby, dann klickt B REJOIN. B tritt der neuen Lobby bei, die Seite hängt nicht.
- [ ] **Prüfung 9 – Countdown:** B verlässt die Session während des Start-Countdowns (LEAVE). Erwartet:
  - Es gibt keine Rückfrage.
  - A sieht B grau in der Liste und bekommt keinen Toast.
  - B sieht im Menü den Hinweis, und REJOIN bringt B ins Spiel, auch wenn Runde 1 schon läuft.
- [ ] **Aufräumen:** `docker stop sg-dev-test` und `pkill -f '[n]ode \./server/index\.js'`.
- [ ] **Abschluss:**
  - `npm test` → alle grün.
  - `git status --short` → nur `?? hw_squadguesser_tallil.zip`.
  - Dem Nutzer berichten, welche Prüfungen gelaufen sind und mit welchem Ergebnis.
