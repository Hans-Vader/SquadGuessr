# Multiplayer: Ready-Button und Start-Countdown – Design

**Datum:** 2026-10-05
**Status:** Entwurf zur Freigabe
**Basis:** `feature/mp-synced-round-start` (wird vorher gemergt)

## Problem

Heute startet der Host das Spiel, wann er will. Wer gerade nicht hinschaut, verpasst den Anfang von Runde 1. Gleichzeitig darf ein abwesender Spieler das Spiel nicht blockieren.

## Ziel

Die Spieler zeigen in der Lobby an, dass sie bereit sind. Jeder Start beginnt mit einem Countdown, den alle sehen. In dieser Zeit laden alle Geräte schon die Bilder von Runde 1. Sind alle bereit, ist der Countdown kurz. Erzwingt der Host den Start, ist er lang.

### Erfolgskriterien

- Gäste können sich in der Lobby bereit und wieder nicht bereit melden. Alle sehen ein ✓ an deren Namen, auch auf dem Big Screen.
- Sind alle verbundenen Gäste bereit, startet der Host mit „START“, und es läuft ein Countdown von 5 s. Sonst steht auf dem Button „START ANYWAY“, und der Countdown dauert 15 s.
- Der Countdown ist auf allen Geräten und dem Big Screen synchron.
- Runde 1 startet nie vor dem Ende des Countdowns. Bei 15 s startet sie pünktlich. Bei 5 s wartet sie höchstens bis 10 s nach dem Start auf langsame Geräte, wie bisher.
- Der Host kann den Start abbrechen, solange Runde 1 noch nicht läuft. Dann sind alle wieder in der normalen Lobby, und die ✓ bleiben stehen.

### Nicht-Ziele

- Der Countdown wird nicht kürzer, wenn während des Countdowns alle bereit werden.
- Während des Countdowns kann niemand beitreten. Es gilt `GAME_RUNNING` mit dem Angebot zum Zuschauen, wie im Branch.
- Der Host meldet sich nicht selbst bereit. Er zählt immer als bereit.
- Kein Schutz gegen ein veraltetes `ready{0}` nach Abbrechen und sofortigem Neustart (siehe Randfälle).

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Basis | Auf `feature/mp-synced-round-start` |
| Countdown | Immer. 5 s, wenn alle bereit sind, sonst 15 s |
| Umsetzung | Mindestdauer der bestehenden Phase `loading` von Runde 1 (Feld `startsAt`), keine eigene Phase |
| Frist für Runde 1 | `loadUntil = max(startsAt, Start + LOAD_FIRST_MS)` |
| Wer zählt für „alle bereit“ | Verbundene Spieler ohne den Host. Getrennte Spieler und Zuschauer zählen nie |
| Abbrechen | Host-Aktion `cancelStart`, solange Runde 1 noch nicht läuft |
| Ready nach Abbrechen | Bleibt stehen. Wer während des Countdowns gegangen ist, ist danach weg wie in der normalen Lobby |
| Ready nach einem Spiel | `toLobby()` setzt es zurück |
| Start aus `final` | Nicht mehr erlaubt. Kein Client nutzt das, und die ✓ wären veraltet |
| Name im Protokoll | `lobbyReady`, weil `ready` im Branch schon „Bilder geladen“ heißt |

## Server (`server/session.js`)

### Konstanten

```js
// every start counts down so all devices can load round 1 first; longer when someone is not ready yet
export const COUNTDOWN_READY_MS = 5 * 1000;
export const COUNTDOWN_FORCED_MS = 15 * 1000;
```

### Felder

- **Spieler `lobbyReady`:**
  - Startet mit `false` (`addPlayer`).
  - `toLobby()` setzt es für alle auf `false`.
  - Reconnect und `cancelStart` lassen es unverändert.
- **Session `startsAt`:** Ende des Countdowns in Serverzeit, sonst `null`.

### Nachrichten

| Richtung | Typ | Inhalt |
|---|---|---|
| Spieler → Server | `lobbyReady` | `{ ready: boolean }` |
| Host → Server | `cancelStart` | `{}` |

`stateMsg()` bekommt zusätzlich:
- oben `startsAt`
- pro Spieler `lobbyReady`

### Ablauf

- **`handle()`:**
  - Behandelt `lobbyReady` neben `answer`/`ready`/`leave`, also vor der Host-Prüfung.
  - `"cancelStart"` kommt zu `HOST_ACTIONS`.
- **`lobbyReady(player, ready)`:**
  - Ignoriert still, wenn die Phase nicht `lobby` ist, `ready` kein Boolean ist oder sich nichts ändert. Ein Klick genau beim Start ist normal und soll keinen Fehler-Toast bringen.
  - Sonst setzen und `broadcastState()`.
- **`allReady()`:** Liefert `true`, wenn alle verbundenen Spieler außer dem Host `lobbyReady` sind. Ist der Host allein, ist das Ergebnis also `true`.
- **`start()`:**
  - Nur noch aus der Phase `lobby`, sonst `INVALID`.
  - Nach dem Übernehmen der Guesses: `startsAt = now + (allReady() ? COUNTDOWN_READY_MS : COUNTDOWN_FORCED_MS)`, danach `load()`.
- **`load()`:**
  - Für Runde 0 gilt `loadUntil = Math.max(startsAt, now + LOAD_FIRST_MS)`. Ab Runde 1 bleibt alles unverändert (`now + LOAD_MS`).
  - Der Kurzweg „niemand muss mehr laden → sofort `startRound()`“ gilt nur, wenn `startsAt === null`.
- **`checkLoaded()`:** Neue erste Regel: `if (this.startsAt !== null && this.now() < this.startsAt) return;`. Den Rest decken `tick()` (alle 500 ms) und die Regeln aus dem Branch ab.
- **`startRound()`:** setzt `startsAt = null`.
- **`cancelStart(conn)`:**
  - Nur in Phase `loading` mit `round === 0`, sonst `INVALID`.
  - Setzt `phase = "lobby"`, `guesses = []`, `startsAt = null`, `loadUntil = null`.
  - Entfernt Spieler, die nicht mehr da sind (`!isPresent(p)`): Wer während des Countdowns gegangen ist, ist wie in der Lobby weg. Wer gerade neu lädt, behält seinen Platz.
  - Ruft `resetScores()` auf (setzt `ready`/`stalled` zurück). Danach `broadcastState()`.
- Den Kommentar am Klassenkopf anpassen: Runde 1 wartet mindestens bis zum Ende des Countdowns.

Ohne Änderung, weil der Branch es schon abdeckt:
- Beitreten während des Countdowns ergibt `GAME_RUNNING`.
- Einstellungen werden außerhalb der Lobby abgelehnt.
- Geht der Host, übernimmt ein anderer, und das Laden läuft weiter.
- Wer reconnectet, bekommt den State mit `startsAt` und `prepare(0)`.
- Sind alle Verbindungen weg, bleibt die Phase `loading`.

## Client

### `src/components/lobby/lobby.html`

In `.button-container` kommen dazu:
- `BUTTON_MP_READY` (`guest-only`, `aria-pressed="false"`, `data-i18n="common:mp.buttons.ready"`)
- `BUTTON_MP_CANCEL` (`host-only`, `hidden`, `data-i18n="common:mp.buttons.cancel"`)

### `src/js/multiplayer.js`

- **Ready-Button:**
  - Ein Klick schickt `{ type: "lobbyReady", ready: !mine.lobbyReady }`.
  - Gerendert wird nur aus dem State: `aria-pressed` gleich dem eigenen `lobbyReady`. Ein Doppelklick schickt zweimal denselben Wert, und der Server ignoriert den zweiten.
  - Er ist nur in Phase `lobby` sichtbar.
- **`renderPlayers()`:** In Phase `lobby` steht ` ✓` hinter jedem Namen mit `lobbyReady`. Der Host trägt 👑 und kein ✓. In `loading` gelten wie bisher ⏳/💤.
- **`renderStatus()`:**
  - `starting = phase === "loading" && round === 0`
  - START: Ausgeblendet, solange `starting` gilt. Sonst steht darauf „START“ oder „START ANYWAY“, je nach derselben Regel wie `allReady()` am Server. Der Text wird über das `data-i18n`-Attribut gesetzt, damit ein Sprachwechsel ihn nicht zurücksetzt, und nicht, solange der Spinner läuft. Sonst stellt `setButtonLoading()` den alten Text wieder her.
  - Der Spinner auf START läuft nur noch, solange die Guesses geladen werden (`Boolean(this.guessFetch)`), nicht mehr während `loading`.
  - CANCEL ist nur sichtbar, solange `starting` gilt. Der Klick schickt `{ type: "cancelStart" }`.
- **Countdown:**
  - Eine eigene kleine Funktion schreibt nur die Statuszeile `#mpLobbyStatus`: Solange `startsAt` mehr als 0 s entfernt ist, steht dort `mp.startingIn` mit den restlichen Sekunden (aufgerundet, mit `this.offset` wie bei der Runden-`deadline`). Danach steht dort der bestehende Text `mp.loadingImages`.
  - `this.startTimer` ruft sie alle 250 ms auf, solange `startsAt` gesetzt ist. Der Timer wird gestoppt, wenn `startsAt` wegfällt, und in `stop()`.
- **Zurück in der Lobby** (z. B. nach `cancelStart`): `preloader.keep([])`, damit vorgeladene Bilder und ihre Wiederholungen nicht in der Lobby weiterlaufen.

### `src/components/lobby/lobby.scss`

- `#BUTTON_MP_READY[aria-pressed="true"]` wird grün (`variables.$newColor`, Buttons sind sonst `$mainColor`) und bekommt per `::before` ein „✓ “.
- `#mpLobbyStatus` bekommt eine große Schrift, sie ist nur während des Startens sichtbar.
- `body.watch-mode`: `#BUTTON_MP_READY` ausblenden. Zuschauer sind kein Host, also wäre `guest-only` sonst sichtbar.

### Texte (`src/i18n/en.json`, `src/i18n/zh.json`)

| Schlüssel | en | zh |
|---|---|---|
| `mp.buttons.ready` | `READY` | `准备` |
| `mp.buttons.forceStart` | `START ANYWAY` | `强制开始` |
| `mp.buttons.cancel` | `CANCEL` | `取消` |
| `mp.startingIn` | `Starting in {{seconds}} s…` | `{{seconds}} 秒后开始…` |

`CHANGELOG.md`: Ein Eintrag unter 1.4.0, neue Features.

## Randfälle

| Fall | Verhalten |
|---|---|
| Host allein | „START“, 5 s Countdown |
| Gast trennt sich in der Lobby | Zählt nicht für „alle bereit“, sein ✓ bleibt für die Rückkehr stehen |
| Gast meldet sich während des Countdowns um | Ignoriert, der Button ist dann ohnehin ausgeblendet |
| Alle haben geladen, bevor der Countdown endet | Runde 1 startet trotzdem erst nach dem Countdown (höchstens 0,5 s später) |
| 5-s-Countdown, ein Gerät lädt noch | ⏳ bis höchstens 10 s nach dem Start, danach 💤 |
| 15-s-Countdown, ein Gerät lädt noch | Start nach 15 s, das Gerät bekommt 💤 |
| Host geht während des Countdowns | Ein anderer wird Host und sieht CANCEL. Der Countdown läuft weiter |
| Reconnect / Big Screen öffnet während des Countdowns | Lobby-Ansicht mit Countdown (`startsAt` im State) |
| CANCEL nach dem Countdown, während noch geladen wird | Erlaubt (`round === 0`) |
| CANCEL während einer Runde | `INVALID` |
| Gast verlässt während des Countdowns, dann CANCEL | Er ist aus der Lobby verschwunden, wie bei LEAVE in der Lobby |
| Abbrechen und sofort neu starten | Ein verspätetes `ready{0}` aus dem ersten Versuch kann mitzählen. Dieser Spieler sieht das Bild dann einen Moment später. Akzeptiert |
| Nach einem Spiel zurück in die Lobby | Alle ✓ sind weg |

## Code-Stil

Wie im Repo: 4 Spaces, doppelte Anführungszeichen, Semikolons, ESM, Klassen ohne Klassenfelder und ohne `#private` (jshint `esversion: 11`). Spielernamen nur per `.text()`/`textContent`.

## Tests

### Server (`server/session.test.js`)

Die bestehenden Helfer (`started()`, `readyAll`) und die Tests mit direktem `start` springen über den Countdown (`advance()` + `tick()`).

Neue Tests:

1. `lobbyReady`:
   - Schaltet um und steht im State.
   - Wird ignoriert außerhalb der Lobby und ohne Boolean.
   - Ohne Änderung wird kein State geschickt, und es kommt nie ein Fehler.
2. Länge des Countdowns:
   - Alle Gäste bereit: `startsAt = Start + 5 s`. Einer nicht bereit: `+ 15 s`. Host allein: `+ 5 s`.
   - Getrennte Gäste und der Host zählen nicht.
3. Runde 1 startet nicht vor `startsAt`, auch wenn alle geladen haben. Mit `tick()` nach `startsAt` startet sie.
4. Frist:
   - Bei 5 s wird auf Spätlader bis 10 s nach dem Start gewartet, dann `stalled`.
   - Bei 15 s startet die Runde bei 15 s.
5. `cancelStart`:
   - Ein Gast bekommt `NOT_HOST`, in einer laufenden Runde gibt es `INVALID`.
   - Danach: Phase `lobby`, `startsAt` ist `null`, `lobbyReady` bleibt, `ready`/`stalled` sind zurückgesetzt, wer während des Countdowns gegangen ist, ist weg, und ein neuer `start` funktioniert.
6. `toLobby` setzt `lobbyReady` zurück. `start` aus `final` ergibt `INVALID`.
7. `state` enthält `startsAt` und `lobbyReady`.

### Manuell im Browser

Lokaler Docker-Dev-Server, ein Origin pro Spieler, Big Screen in einem weiteren Tab:

- Ready umschalten: ✓ erscheint und verschwindet überall, auch auf dem Big Screen. Der Big Screen hat keinen Ready-Button.
- Der Host-Button wechselt zwischen „START“ und „START ANYWAY“.
- Erzwungener Start: 15 s Countdown, synchron auf allen Bildschirmen. Danach startet Runde 1 ohne sichtbare Ladezeit.
- CANCEL: alle wieder in der Lobby, die ✓ stehen noch, ein neuer Start funktioniert.
- Alle bereit sowie Host allein: 5 s Countdown.
- Ab Runde 2 verhält sich alles wie im Branch.
- `npm test` grün und `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/` ohne Fehler.

## Betroffene Dateien

| Datei | Änderung |
|---|---|
| `server/session.js` | `lobbyReady`, `startsAt`, Countdown, `cancelStart`, `start` nur aus der Lobby |
| `server/session.test.js` | Helfer über den Countdown, neue Tests |
| `src/js/multiplayer.js` | Ready-Button, ✓, START-Text, CANCEL, Countdown-Anzeige |
| `src/components/lobby/lobby.html` | `BUTTON_MP_READY`, `BUTTON_MP_CANCEL` |
| `src/components/lobby/lobby.scss` | Ready-Hervorhebung, Countdown-Schrift, Big Screen |
| `src/i18n/en.json`, `src/i18n/zh.json` | vier neue Texte |
| `CHANGELOG.md` | Eintrag unter 1.4.0 |
