# Multiplayer: Team-Modus

**Status:** Entwurf zur Freigabe
**Basis:** `master` (a1071fc)

## Problem

Im Multiplayer spielt heute jeder gegen jeden. Clans, Communities und Freundesgruppen wollen aber in Teams gegeneinander antreten, mit Rollen und Absprachen innerhalb des Teams.

## Ziel

Für Classic gibt es einen Team-Modus mit drei Varianten. Der Host wählt die Variante in der Lobby:

1. **Leader:** Jedes Team hat einen Leader. Er setzt selbst keinen Punkt. Die Mitglieder tippen, und in einer eigenen Entscheidungsphase wählt der Leader einen ihrer Guesses als Team-Antwort.
2. **Durchschnitt:** Alle tippen. Die Rundenpunkte des Teams sind der Durchschnitt der Einzelpunkte. Optional gibt es Minuspunkte für Guesses außerhalb der Punktezone.
3. **Mittelpunkt:** Alle tippen. Der Team-Punkt ist der Mittelpunkt aller Guesses des Teams und wird wie ein normaler Guess gewertet.

### Rahmen

Gespielt wird in sehr unterschiedlichen Konstellationen:
- jedes Team in einem eigenen Voice-Channel,
- alle zusammen in einem Call,
- vor Ort in einem Raum,
- oder nur über einen Link, der in einem Text-Channel geteilt wurde.

Das Spiel darf sich deshalb nicht auf Voice verlassen. Abstimmen kann sich ein Team über die Marker der Teammitglieder, die im Spiel sichtbar sind.

### Erfolgskriterien

- Der Host schaltet in der Lobby den Team-Modus ein und wählt die Variante sowie 2 bis 10 Teams. Die Spieler wählen ihr Team selbst, und der Host kann mischen.
- Ein Spieler sieht die Marker seines Teams erst, nachdem er selbst abgegeben hat. Der Leader sieht sie sofort. Andere Teams und Zuschauer sehen sie erst im Reveal. Punkte oder Distanzen bekommt vor dem Reveal niemand zu sehen.
- **Durchschnitt:** Die Rundenpunkte des Teams sind der gerundete Durchschnitt der Einzelpunkte. Mit Minuspunkten fällt der Wert außerhalb der Zone gestaffelt bis −50.
- **Mittelpunkt:** Gewertet wird der Mittelpunkt der Guesses des Teams.
- **Leader:** Der Leader tippt nicht und sieht die Marker seines Teams live. In einer Entscheidungsphase, deren Dauer der Host einstellt, wählt er einen der Guesses.
- Reveal und Endstand zeigen eine Rangliste der Teams. Auf der Karte erscheinen die Marker in Teamfarben, dazu die Team-Punkte.
- Ohne Team-Modus verhält sich alles wie heute. Die bestehenden Tests bleiben unverändert grün.
- Eine Session fasst bis zu 30 Spieler.

### Nicht-Ziele

- Ein Team-Modus für „Find the Map“.
- Eigene Teamnamen, ein Team-Chat oder eine Einzelwertung bzw. ein MVP im Team-Modus.
- Teamwechsel nach START.
- Minuspunkte in den Varianten Leader und Mittelpunkt.
- Dass die Mitglieder die Auswahl ihres Leaders vor dem Reveal sehen.
- Eine vollständige Team-Darstellung für ältere, gecachte Clients. Server und Client werden gemeinsam deployt.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Modi | Nur Classic |
| Varianten | `leader`, `average`, `centroid` |
| Teamanzahl | 2 bis 10, legt der Host fest |
| Spielerlimit | `MAX_PLAYERS` steigt von 12 auf 30, für alle Modi. Ein Limit pro Modus würde beim Zurückschalten eine übervolle Lobby erzeugen |
| Teambildung | Spieler wählen selbst und landen beim Beitritt im kleinsten Team. Der Host kann mischen. Ungleich große Teams sind erlaubt |
| Sichtbarkeit | Eigene Team-Marker nach der eigenen Abgabe. Der Leader sieht sie sofort, in `decide` das ganze Team. Andere sehen sie erst im Reveal |
| Summen-Variante | Durchschnitt statt Summe, weil das bei ungleich großen Teams fair ist |
| Minuspunkte | Schalter, nur bei `average`. Linear von 0 am Zonenrand bis −50 bei 3× Zonenabstand. Wer nichts abgibt, bekommt −50 |
| Triangulieren | Arithmetischer Mittelpunkt |
| Leader-Bestimmung | Fest: Wer zuerst im Team ist, wird Leader. Übergabe in der Lobby |
| Leader-Entscheidung | Eigene Phase `decide`, Dauer vom Host (10 bis 60 s) |
| Fallback | Der ausgewählte, aber unbestätigte Marker zählt. Ist nichts ausgewählt, gibt es 0 Punkte |
| Architektur | Teams direkt in `Session`, reine Wertungsfunktionen in `scoring.js`, Client-Teil in einem eigenen Modul `multiplayerTeams.js` |

## Einstellungen (`server/validate.js`, `pickSettings`)

| Feld | Werte | Default |
|---|---|---|
| `team` | `"off"`, `"leader"`, `"average"`, `"centroid"` | `"off"` |
| `teams` | ganze Zahl von 2 bis 10 | `2` |
| `penalty` | `true` / `false` | `false` |
| `decide` | Sekunden: 10, 15, 20, 30, 45, 60 | `20` |

- `validSettings` erlaubt fehlende Team-Felder, weil ein älterer Client sie nicht schickt. `pickSettings` setzt dann die Defaults.
- `team !== "off"` ist nur mit `mode === "classic"` gültig.
- Alle Felder bleiben gespeichert, auch bei `team === "off"`. So bleibt die Wahl beim Zurückschalten erhalten.
- Wie heute nimmt jede Änderung den Gästen ihr READY.

## Server (`server/session.js`)

### Felder

- **Spieler:**
  - `team`: Teamnummer von 0 bis `teams − 1`. Jeder Spieler hat immer eine, auch bei `team === "off"`.
  - `teamSince`: Zeitpunkt des letzten Teambeitritts. Er bestimmt, wer als Nächstes Leader wird.
- **Session:**
  - `leaders`: Index ist das Team, der Wert die Spieler-ID oder `null`. Wird immer geführt.
  - `teamScores`: Index ist das Team, der Wert der Punktestand.
  - `picks`: Index ist das Team, der Wert die Spieler-ID des gewählten Guesses. Wird zu Beginn jeder Entscheidungsphase geleert.
- `MAX_PLAYERS = 30`.

### Nachrichten

| Richtung | Typ | Inhalt | Gültig in |
|---|---|---|---|
| Spieler → Server | `team` | `{ team }` | `lobby` |
| Host → Server | `shuffle` | `{}` | `lobby` |
| Leader → Server | `lead` | `{ playerId }` | `lobby` |
| Leader → Server | `pick` | `{ index, playerId }` | `decide` |
| Server → einzelne Spieler | `teamGuesses` | `{ index, guesses: [{ id, name, lat, lng }] }` | `round`, `decide` |
| Server → alle | `decide` | `{ index, deadline, teams }` | Beginn von `decide`, Reconnect |

- `shuffle` kommt zu `HOST_ACTIONS`.
- Ein `team` außerhalb der Lobby wird still ignoriert, wie `lobbyReady`: Ein Klick genau beim START ist normal. Eine ungültige Teamnummer beantwortet der Server mit `INVALID`.
- In `decide` listet `teams` die Teams auf, die wählen müssen, also die mit mindestens einem Guess. Daraus zählt die Statuszeile.

### `stateMsg`

- `settings` enthält die neuen Felder.
- `players[]` bekommt:
  - `team`,
  - `leader` (`leaders[team] === id`),
  - `picked` (in `decide`: der Leader, dessen Team schon gewählt hat).

### Teamzuordnung

- **Beitritt** (`create`, `join`):
  - Der Spieler kommt ins kleinste Team, bei Gleichstand ins Team mit dem kleinsten Index.
  - Während des Start-Countdowns (`phase === "loading" && round === 0`) ist es das kleinste Team, das schon Spieler hat. So entsteht nach START kein neues Ein-Mann-Team.
  - `teamSince = now`.
- **`team`:**
  - Gültig ist eine ganze Zahl von 0 bis `teams − 1`. Ist es das eigene Team, passiert nichts.
  - Sonst: `team` und `teamSince` setzen, `fixLeaders()`, `broadcastState()`.
  - Das READY bleibt erhalten.
- **`shuffle`:**
  - Alle Spieler werden zufällig gemischt und reihum auf die Teams 0 bis `teams − 1` verteilt.
  - `teamSince` folgt der Verteilreihenfolge.
  - `leaders` wird geleert, `fixLeaders()` bestimmt dann pro Team den Ersten als Leader.
- **Weniger Teams** (`updateSettings`): Die Spieler mit `team >= teams` kommen nacheinander ins jeweils kleinste verbleibende Team.

### Leader

- **`fixLeaders()`**, analog zu `fixHost()`. Für jedes Team mit Spielern gilt:
  - Der Leader bleibt, solange er im Team ist und `isPresent`.
  - Sonst wird das verbundene Mitglied mit dem kleinsten `teamSince` Leader. Ist keins verbunden, wird es das Mitglied mit dem kleinsten `teamSince`.
  - Ein Team ohne Spieler bekommt `null`.
  - Die Funktion gibt `true` zurück, wenn sich etwas geändert hat.
- `fixLeaders()` wird aufgerufen:
  - nach `join`, `leave`, `kick`, `team`, `shuffle` und `updateSettings`,
  - in `tick()`, dort mit `broadcastState()`, wenn sich etwas geändert hat.
  - In `round` und `decide` bekommt ein neuer Leader sofort `teamGuesses`.
- **`lead`:**
  - Nur in der Lobby, und der Absender muss Leader seines Teams sein. Ein Ziel außerhalb des eigenen Teams ergibt `INVALID`.
  - Ist das Ziel weg oder offline, passiert nichts, wie bei `promote`.
  - Sonst: `leaders[team] = playerId`, `broadcastState()`.

### Start

- **`canStart()`:** Im Team-Modus gilt zusätzlich:
  - Mindestens 2 Teams haben verbundene Spieler.
  - Bei `leader` hat jedes Team mit verbundenen Spielern mindestens 2 davon.
- `resetScores()` setzt auch `teamScores` zurück. Teams und Leader bleiben über `cancelStart` und `toLobby` hinweg bestehen.

### Runde

- **`answer()`:**
  - Bei `leader` beantwortet der Server die Antwort eines Leaders mit `INVALID`.
  - Bei `average` mit `penalty`: `points += penaltyPoints(distance, size)`.
  - Im Team-Modus folgt danach `sendTeamGuesses(player.team)`.
- **`checkRoundEnd()`** (Phase `round`): Gewartet wird auf anwesende Spieler ohne Antwort. Bei `leader` zählen die Leader nicht dazu.
- **`endRound()`:**
  - Fehlende Antworten werden aufgefüllt mit `{ lat: null, lng: null, mapName: null, distance: null, points, absent }`.
    - `absent = !isPresent(p)`.
    - `points` ist −50 bei `average` mit `penalty`, wenn der Spieler anwesend ist. Sonst ist es 0.
  - Danach geht es bei `leader` weiter mit `startDecide()`, sonst mit `reveal()`.
  - `reveal()` übernimmt den bisherigen zweiten Teil von `endRound()`: Punkte aufaddieren, Phase setzen, `nextAt` setzen, `state` und `reveal` senden.

### Entscheidungsphase `decide` (nur `leader`)

- **`startDecide()`:**
  - `phase = "decide"`, `deadline = now + decide · 1000`, `picks = []`.
  - Danach `broadcastState()`, `decide` an alle und `sendTeamGuesses(t)` für jedes Team.
  - Hat kein Team einen Guess, geht es sofort zu `reveal()`.
- **`pick(player, { index, playerId })`** ist gültig, wenn:
  - die Phase `decide` läuft,
  - `index === round` ist,
  - der Absender Leader seines Teams ist,
  - `picks[team]` noch leer ist,
  - und das Ziel im selben Team ist und in dieser Runde einen Guess mit `lat !== null` hat.
  - Sonst antwortet der Server mit `INVALID`.
  - Ist der Pick gültig: `picks[team] = playerId`, `broadcastState()`, `checkDecideEnd()`.
- **`checkDecideEnd()`:** Haben alle Teams mit mindestens einem Guess gewählt, folgt `reveal()`.
- **`tick()`:** Bei `decide` und `now >= deadline + GRACE_MS` folgt `reveal()`.
- **`ready()`:** Akzeptiert auch `decide`, mit derselben Indexregel wie in `round` (neuester Index ist `round + 1`).
- **`sendPhase()`:** Schickt in `decide` die `decide`-Nachricht und den `prepare` der nächsten Runde.
- **`reconnect()`:** Schickt dem Zurückkehrenden zusätzlich `teamGuesses`, wenn er berechtigt ist.

### Sichtbarkeit: `sendTeamGuesses(team)`

- **Inhalt:** Alle Mitglieder des Teams, die in dieser Runde einen Guess mit `lat !== null` abgegeben haben, als `{ id, name, lat, lng }`. **Keine `points` und keine `distance`**, sonst ließe sich die Lösung zurückrechnen.
- **Empfänger:** Verbundene Mitglieder desselben Teams, die mindestens eine dieser Bedingungen erfüllen:
  - Sie haben in dieser Runde abgegeben.
  - Sie sind Leader (nur bei `leader`).
  - Die Phase ist `decide`.
- Die Nachricht geht nur im Team-Modus raus und nie an Zuschauer.
- **Zeitpunkte:**
  - nach jeder Antwort im Team,
  - zu Beginn von `decide`,
  - beim Reconnect,
  - beim Leaderwechsel in `round` und `decide`, jeweils nur an die betroffene Person.

### Wertung in `reveal()`

Für jedes Team `t` mit Spielern:

| Variante | Team-Punkt (`lat`, `lng`) | Rundenpunkte |
|---|---|---|
| `average` | `null` | `Math.round(Summe / Anzahl)` über alle Mitglieder mit `!absent`. Ohne solche Mitglieder 0 |
| `centroid` | `centroid()` der Guesses mit `lat !== null` | `pointsForDistance(distance(Team-Punkt, Lösung), size).points`. Ohne Guess 0 und `null` |
| `leader` | Guess von `picks[t]` | Punkte dieses Guesses. Ohne Pick 0 und `null` |

- `teamScores[t] += points`.
- Die Einzelpunkte und `p.score` laufen weiter wie heute. Sie werden nur angezeigt und nicht in die Teamwertung eingerechnet.

### `revealMsg()` und `finalMsg()` im Team-Modus

- **`revealMsg()`:**
  - `results[]` bekommt das Feld `team`.
  - Neu ist `teams: [{ id, score, points, lat, lng, picked }]`. Es enthält nur Teams mit Spielern, absteigend nach `score` sortiert.
  - `picked` ist die Spieler-ID (nur bei `leader`), sonst `null`.
- **`finalMsg()`:**
  - `ranking: [{ id, score, members: [name, …] }]`, sortiert wie oben.
  - `winners`: die IDs aller Teams mit dem höchsten Stand.
- Ohne Team-Modus bleiben beide Nachrichten unverändert.

## Wertungsfunktionen (`src/js/scoring.js`)

```js
/**
 * Minus points for a guess beyond the last scoring step: 0 at its edge, down to −50 at three times its distance
 */
export function penaltyPoints(distance, size) { … }

/**
 * Plain average position of some guesses, in game coordinates
 */
export function centroid(points) { … }
```

- Die Zonengrenze ist `BASE_STEPS.at(-1).maxDistance · size / 3000`. Das ist dieselbe Grenze, ab der `pointsForDistance` 0 liefert. Sie wird nicht als eigene Konstante dupliziert.
- `penaltyPoints` liefert innerhalb der Zone `0` und nicht `-0`. `assert.equal` vergleicht mit `Object.is`, und `-0` wäre dort ungleich `0`.
- `pointsForDistance` und `scoreAnswer` bleiben unverändert, Singleplayer ist nicht betroffen.

## Client

### Neues Modul `src/js/multiplayerTeams.js`

`multiplayer.js` hat schon rund 960 Zeilen. Der Team-Teil kommt deshalb in ein eigenes Modul, das `multiplayer.js` aufruft:
- Teamfarben und Teamnamen über i18n: Blau, Rot, Grün, Gelb, Lila, Orange, Türkis, Pink, Weiß und Braun,
- die Team-Blöcke in der Lobby,
- die Team-Marker während `round` und `decide` sowie die Auswahl durch den Leader,
- die Team-Marker und die Team-Rangliste im Reveal,
- die Team-Rangliste im Endstand.

### Lobby (`lobby.html`, `lobby.scss`, `multiplayer.js`)

- **Neue Selects in `#mpSettings`:**
  - `#mpTeam`: Aus, Leader, Durchschnitt, Mittelpunkt.
  - `#mpTeams`: 2 bis 10.
  - `#mpPenalty`: Aus oder An, sichtbar nur bei Durchschnitt.
  - `#mpDecide`: 10 bis 60 s, sichtbar nur bei Leader.
- Steht `#mpMode` auf „Find the Map“, ist `#mpTeam` gesperrt. Ein Wechsel dorthin schickt `team: "off"` mit.
- `readSettings`, `renderState` und `describeSettings` berücksichtigen die neuen Felder. Beispiel für die Zusammenfassung: „Teams: Leader · 4 Teams · Entscheidung 20 s“.
- **`#mpPlayers` im Team-Modus:**
  - Es gibt einen Block pro Team von 0 bis `teams − 1`, auch für leere Teams, damit man beitreten kann.
  - Der Kopf zeigt Farbe, Name und Anzahl. Ein Klick darauf schickt `team`.
  - Die Chips bleiben wie heute. Im Leader-Modus kommt ⭐ für den Leader dazu.
  - Im Leader-Modus sieht der Leader bei seinen Teammitgliedern 🎖️. Das schickt nach einer Rückfrage `lead`, analog zu 🔑 beim Host.
  - Der Host behält 🔑 und ✕.
- **`#BUTTON_MP_SHUFFLE`:** Nur für den Host und nur im Team-Modus der Lobby sichtbar.
- **START-Tooltip:** Im Team-Modus erscheint `mp.needTeams`, wenn `!canStart` gilt und schon jemand anderes da ist.
- **`#mpChips` im Spiel:** ein Farbpunkt pro Spieler.
- Bei 30 Spielern scrollt die Lobby-Liste (`max-height` mit `overflow-y: auto`), wie es die Reveal-Rangliste bereits tut.

### Runde

- **Leader im Leader-Modus:**
  - `createGuessMarker` (`squadMinimap.js`) setzt keinen Marker. Die Bedingung kommt aus einer Abfrage an `App.mp`.
  - GUESS ist ausgeblendet.
  - Die Statuszeile zeigt „Dein Team tippt …“.
- **`teamGuesses`:**
  - Die Teammitglieder werden in Teamfarbe mit Namen und ohne Punkte in einer eigenen Layer-Gruppe gezeichnet.
  - Jede neue Nachricht ersetzt die Gruppe.
  - Bei einer neuen Runde und im Reveal wird die Gruppe geleert.

### Entscheidungsphase

- Die Nachricht `decide` startet den Countdown (`startCountdown(deadline)`). Die Statuszeile zeigt „Leader entscheiden … x/y“, gezählt wird aus `picked` im State und `teams` aus `decide`.
- **Leader:**
  - Ein Klick auf einen Teammitglied-Marker wählt ihn aus und hebt ihn hervor.
  - GUESS heißt hier AUSWÄHLEN und ist aktiv, sobald etwas ausgewählt ist. Ein Klick schickt `pick` und sperrt die Auswahl.
  - Läuft die Zeit ab, wird die aktuelle Auswahl automatisch geschickt.
- Mitglieder und Zuschauer sehen Timer und Statuszeile.

### Reveal

- **Spieler-Marker:**
  - In Teamfarbe mit „Name +12“ bzw. „Name −23“. Minuspunkte bekommen kein vorangestelltes „+“, anders als heute bei `+${points}`.
  - Der eigene Marker bleibt hervorgehoben.
- **Team-Marker** bei `centroid` und `leader`, sofern `lat !== null`:
  - größer als die Spieler-Marker,
  - beschriftet mit „Team Blau +60“,
  - mit Distanzlinie zur Lösung.
- **Distanzlinien:**
  - Bei `average` bekommt jeder Spieler eine Linie, wie heute.
  - Bei `centroid` und `leader` bekommt nur der Team-Marker eine Linie.
- `focusReveal` bezieht die Team-Marker mit ein.
- **`#mpRanking`:**
  - Team-Zeilen mit Rang, ↑↓ (`rankMoves` mit Team-IDs), Farbpunkt und Name, +Punkte und Stand.
  - Das eigene Team ist mit `.me` markiert.
- `#points` und `#mapName` zeigen die Rundenpunkte des eigenen Teams, `#dist` die eigene Distanz („—“ ohne Guess).

### Endstand

- **`#mpFinalRanking`:**
  - Team-Zeilen mit 🏆 für die Sieger, Farbe und Name sowie Stand.
  - Darunter klein die Namen der Mitglieder.
  - Das eigene Team ist hervorgehoben.
- `#scoreValue` zeigt den Stand des eigenen Teams. Zuschauer sehen den höchsten Stand.
- `finalFromReveal` baut die Rangliste aus `lastReveal.teams` und den Namen aus dem State.

### Übersetzungen (`src/i18n/en.json`, `src/i18n/zh.json`)

- die 10 Teamnamen,
- Labels und Optionen der neuen Einstellungen,
- `mp.needTeams`,
- die Statuszeilen „Dein Team tippt“ und „Leader entscheiden“,
- AUSWÄHLEN, MISCHEN,
- „Zum Leader machen“ samt Rückfrage,
- die Bausteine der Zusammenfassung.

## Randfälle

- **Host schaltet auf „Find the Map“, während Teams an sind:** Der Client schickt `team: "off"` mit. Jede andere Kombination lehnt der Server mit `INVALID` ab.
- **Kick oder Leave eines Leaders in der Lobby:** `fixLeaders()` bestimmt einen Nachfolger.
- **Leader fällt in `round` oder `decide` weg:** Nach dem Reconnect-Fenster übernimmt ein verbundenes Mitglied, über `tick()` und `fixLeaders()`. Hat der neue Leader schon getippt, bleibt sein Guess wählbar.
- **Ein gewähltes Mitglied trennt die Verbindung:** Der Pick bleibt gültig, denn die Antwort ist gespeichert.
- **Verspäteter, doppelter oder fremder Pick:** `INVALID`.
- **Ein Team hat niemanden mehr:** Es bleibt im Ranking und bekommt ab dann 0 Punkte.
- **END ROUND im Chill-Modus bei `leader`:** Es folgt `decide`. Die Phase `decide` hat immer ein Zeitlimit.
- **Nochmal spielen:** Teams und Leader bleiben bestehen, `teamScores` wird zurückgesetzt.
- **Ein älterer Client ohne Team-Felder:** Er bekommt `off`. Eine Team-Lobby stellt er nicht korrekt dar (siehe Nicht-Ziele).

## Tests (`node --test server/`)

- **`scoring.test.js`:**
  - `penaltyPoints`: in der Zone `0`, am Zonenrand `0`, beim 3-fachen Abstand −50, darüber −50, auf einer skalierten Karte.
  - `centroid`: ein Punkt und mehrere Punkte.
- **`validate.test.js`:**
  - die erlaubten Werte für `team`, `teams`, `penalty` und `decide`,
  - Teams nur mit `classic`,
  - Einstellungen ohne Team-Felder sind gültig.
- **`session.test.js`:**
  - **Zuordnung:**
    - beim Join ins kleinste Team,
    - im Countdown ins kleinste besetzte Team,
    - Wechsel per `team`, ungültige Teamnummer,
    - `shuffle` nur durch den Host,
    - Verringern der Teamanzahl.
  - **Leader:**
    - der Erste im Team wird Leader,
    - Übergabe mit `lead`, wobei ein fremdes Team `INVALID` ergibt,
    - Nachfolge bei Leave und bei Abwesenheit über `tick()`.
  - **`canStart`:** nur 1 besetztes Team; Leader-Modus mit einem Ein-Mann-Team.
  - **`teamGuesses`:**
    - nur an Teammitglieder mit Abgabe und an den Leader,
    - in `decide` an das ganze Team,
    - nie an andere Teams oder Zuschauer,
    - ohne `points` und ohne `distance`.
  - **`average`:**
    - mit und ohne `penalty`,
    - keine Abgabe ergibt −50 bzw. 0,
    - abwesende Spieler zählen nicht mit.
  - **`centroid`:** Team-Punkt und Rundenpunkte; ein Team ohne Guess bekommt 0.
  - **`leader`:**
    - ein Leader kann nicht `answer` senden,
    - Übergang von `round` nach `decide` mit Deadline,
    - Prüfung des Picks,
    - vorzeitiges Ende, wenn alle gewählt haben,
    - Timeout über `tick()`,
    - kein Pick ergibt 0,
    - ohne Guesses direkt in den Reveal,
    - Leaderwechsel während `decide`,
    - Reconnect in `decide`.
  - **Reveal und Endstand:** `teams` sortiert, Gleichstand ergibt mehrere Sieger.
- Die bestehenden Tests bleiben unverändert grün.

## Manuelle Prüfung

Für den Client gibt es kein Test-Setup. Geprüft wird mit dem Dev-Build: Dev-Server und Multiplayer-Server, mehrere Tabs und ein Zuschauer-Tab.
- Jede Variante spielen, mit 2 und mit 3 Teams.
- Mit und ohne Minuspunkte.
- Den Leader während `decide` neu laden.
- Ein Spiel ohne Teams spielen, als Regressionstest.

## Umsetzungsreihenfolge

Die Varianten bauen auf einer gemeinsamen Basis auf und können getrennt umgesetzt und gemergt werden:

1. **Basis und Durchschnitt:** Einstellungen, Limit 30, Teamzuordnung und Leader-Führung im Server, Team-Lobby, `teamGuesses`, Team-Wertung, Reveal, Endstand und Minuspunkte.
2. **Mittelpunkt:** `centroid()`, Team-Marker im Reveal.
3. **Leader:** Phase `decide`, `pick`, `lead`, Auswahl-UI.
