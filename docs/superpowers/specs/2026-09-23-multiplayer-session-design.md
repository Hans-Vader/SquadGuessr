# Multiplayer-Sessions – Design

**Datum:** 2026-09-23
**Status:** Entwurf zur Freigabe

## Ziel

Mehrere Freunde im selben Raum spielen SquadGuessr zusammen, jeder auf seinem eigenen Smartphone. Ein Spieler erstellt eine Session, die anderen treten per Code/Link/QR bei. Alle spielen synchron dieselben Guesses; am Ende wird ein Gewinner ermittelt. Optional zeigt ein PC/TV/Beamer die laufende Session als Zuschauer-Bildschirm an.

### Erfolgskriterien

- 2–12 Spieler können einer Session beitreten und eine komplette Partie (Host wählt 3/5/10 Runden) bis zum Endstand spielen.
- Alle sehen pro Runde dasselbe Bild zur selben Zeit; die Auflösung zeigt die Tipps aller Spieler.
- Ein kurz gesperrtes Handy / WLAN-Aussetzer führt nicht zum Verlust des Spielstands.
- Ein Beamer kann per `?watch=CODE` zuschauen, ohne mitzuspielen.
- Der Singleplayer verhält sich unverändert.

### Nicht-Ziele

- Keine Accounts, keine Persistenz über einen Server-Neustart hinaus, keine globale Bestenliste.
- Kein Host-Wechsel, kein Beitritt neuer Spieler während einer laufenden Partie.
- Kein asynchroner Modus.

## Rahmenbedingungen

- Das Repo ist ein reines statisches Frontend (Webpack, jQuery, Leaflet). Guess-Daten und Bilder kommen von der externen API `/api/v2/...` (squadcalc.app), die wir nicht kontrollieren.
- Für den Echtzeit-Teil läuft ein eigener Node-WebSocket-Server auf dem VPS des Betreibers.
- `src/js/data/maps.js` hat keine Imports und kann vom Server direkt importiert werden (Root-`package.json` hat `"type": "module"`).
- `squadMinimap.js` greift auf das globale `App` zu (`App.solutionMarker`, `App.BUTTON_GUESS`, `App.selectedMode`). Der Multiplayer nutzt daher den vorhandenen Spiel-Screen statt eines eigenen.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Spielaufbau | Jeder spielt auf dem eigenen Handy; Beamer optional als Zuschauer |
| Backend | Eigener Node-Server mit `ws`, autoritativ |
| Rundenablauf | Synchron; Host legt Modus, Timer, Rundenzahl fest und gibt den Takt vor |
| Client-Integration | Eigenes Modul `multiplayer.js` + gemeinsames `scoring.js`, wenige Hooks in `squadGuessr.js` |
| Guess-Daten | Host-Client holt sie wie bisher über die API und schickt sie an den Server |
| Punkte | Berechnet ausschließlich der Server mit `scoring.js` |

## Architektur

```
Handy (Host)  ─┐
Handy (Spieler)├── wss://<domain>/mp ──► nginx ──► server/index.js (:3001)
Beamer (watch) ┘                                     │
                                                     ├─ server/session.js  (reine Zustandsmaschine)
                                                     └─ src/js/scoring.js  (geteilt mit Client)
                                                          └─ src/js/data/maps.js
```

### Dateien

| Datei | Zweck |
|---|---|
| `src/js/scoring.js` | Reine Funktionen: `pointsForDistance(distance, size)`, `levenshtein(a, b)`, `distance(a, b)`, `mapSize(mapName)`, `scoreAnswer(mode, guess, answer)`. Genutzt von Client und Server. |
| `server/session.js` | Session-Zustand und -Übergänge als Klasse ohne Netzwerk; Senden über eine injizierte `send(conn, msg)`-Funktion, Zeit über injiziertes `now()`. |
| `server/validate.js` | Validierung aller Client-Eingaben (Name, Settings, Guesses, Antworten). |
| `server/index.js` | `ws`-Server, Verbindungs-Handling, Code-Vergabe, Timer, Aufräumen. Ruft `session.js` auf. |
| `server/*.test.js` | `node --test` für `scoring.js` und `session.js`. |
| `src/js/multiplayer.js` | Klasse `Multiplayer` (`App.mp`): WebSocket, Reconnect, Lobby, Runden-/Reveal-/Final-Rendering, Watch-Modus. |
| `src/components/lobby/lobby.html`, `lobby.scss` | Namenseingabe, Erstellen/Beitreten, Lobby mit Code, QR, Spielerliste, Host-Einstellungen. |
| `src/i18n/en.json` | Neue Texte unter `mp`. `zh.json` bleibt unverändert – i18next fällt per `fallbackLng: "en"` auf Englisch zurück. |

## Server

### Laufzeit

- Node (ESM), neue Abhängigkeit `ws`. Start: `npm run server` (`node server/index.js`).
- Lauscht auf `MP_PORT` (Default `3001`), Pfad `/mp`. (Nicht `/ws`: den Pfad belegt der webpack-dev-server für Hot Reload.)
- Dev: `webpack.config.js` bekommt einen zusätzlichen Proxy-Eintrag `{ context: ["/mp"], target: "http://localhost:3001", ws: true }`; Dev-Server mit `host: "0.0.0.0"` für Tests mit Handys im LAN.

### Zustand (nur im Speicher)

```
Session {
  code,                 // 4 Zeichen aus "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  hostId,
  settings: { mode: "classic"|"mapFinder", timer: 0|15|60, rounds: 3|5|10 },
  guesses: [ { map, url, lat, lng, submitter } ],   // inkl. Lösung, verlässt den Server nie vor dem Reveal
  phase: "lobby"|"round"|"reveal"|"final",
  round,                // 0-basiert
  deadline,             // ms epoch oder null (timer = 0)
  players: Map<id, { name, token, score, connected, answers[] }>,
  watchers: Set<ws>,
  lastActivity
}
```

### Nachrichten

JSON-Objekte der Form `{ type, ... }`.

**Client → Server**

| type | Absender | Felder | Erlaubt in Phase |
|---|---|---|---|
| `create` | jeder | `name, settings` | – |
| `join` | jeder | `code, name, token?` | `lobby`; mit gültigem `token` in jeder Phase (Reconnect) |
| `watch` | Beamer | `code` | jede |
| `settings` | Host | `settings` | `lobby` |
| `start` | Host | `guesses[]` | `lobby`, `final` (Nochmal) |
| `answer` | Spieler | `lat, lng` (Spielkoordinaten) **oder** `mapName` | `round`, einmal pro Runde |
| `endRound` | Host | – | `round` |
| `next` | Host | – | `reveal` |
| `lobby` | Host | – | `final` (zurück in die Lobby, Scores zurücksetzen) |

**Server → Client** (jede Nachricht enthält `serverNow` für den Uhrzeit-Offset)

| type | Felder |
|---|---|
| `welcome` | `playerId, token, code, isHost` |
| `state` | `phase, settings, players: [{id, name, connected, score, answered}], round, total` |
| `round` | `index, total, url, submitter, deadline, map` (`map` nur im Modus `classic`) |
| `reveal` | `index, total, solution: {map, url, lat, lng}, results: [{id, name, lat?, lng?, mapName?, distance, points, score}]` |
| `final` | `ranking: [{id, name, score}]`, `winners: [id]` (mehrere bei Gleichstand) |
| `error` | `code`: `SESSION_NOT_FOUND`, `NAME_TAKEN`, `GAME_RUNNING`, `SESSION_FULL`, `NOT_HOST`, `INVALID` |

### Regeln

- Neue Spieler treten nur in der Phase `lobby` bei. Namen sind innerhalb einer Session eindeutig (Groß-/Kleinschreibung egal).
- Der Ersteller ist Host und zugleich Spieler.
- Eine Runde endet, sobald (a) alle **verbundenen** Spieler geantwortet haben, (b) `deadline + 1000 ms` erreicht ist oder (c) der Host `endRound` sendet. Fehlende Antworten zählen 0 Punkte.
- Punkte: Classic → `pointsForDistance(distance, mapSize(solution.map))`; MapFinder → 100, wenn `levenshtein(mapName, solution.map) <= 2`, sonst 0. Identisch zur heutigen Singleplayer-Logik.
- Nach der letzten Runde führt `next` in die Phase `final`. Gewinner sind alle Spieler mit der höchsten Gesamtpunktzahl.
- Reconnect: `join` mit gültigem `token` übernimmt den bestehenden Spieler (inkl. Host-Rolle), setzt `connected = true` und schickt `welcome`, `state` und je nach Phase die aktuelle `round`- bzw. `reveal`- oder `final`-Nachricht.
- Verbindungsabbruch setzt `connected = false`; der Spieler bleibt in der Session. Auch der Host – es gibt keinen Host-Wechsel.
- Aufräumen: Sessions ohne Aktivität seit 30 Minuten werden gelöscht (geprüft im 500-ms-Tick des Servers, der auch die Deadlines prüft).

### Validierung (Vertrauensgrenze)

- `maxPayload: 64 * 1024`.
- `name`: String, getrimmt, 1–20 Zeichen.
- `settings`: nur die erlaubten Werte oben.
- `guesses[]`: 1–10 Einträge, jeweils `map` (bekannt in `MAPS`), `url` (String, beginnt mit `/img/`), `lat`/`lng` endliche Zahlen, `submitter` optionaler String ≤ 40 Zeichen; Länge muss `settings.rounds` entsprechen.
- `answer`: `lat`/`lng` endliche Zahlen oder `mapName` String ≤ 40 Zeichen.
- Maximal 12 Spieler pro Session, maximal 20 Watcher.
- Nicht parsebares JSON oder unbekannter `type` → `error INVALID`, Verbindung bleibt offen.
- Host-Aktionen von Nicht-Hosts → `error NOT_HOST`.

## Client

### Hooks in `squadGuessr.js`

1. `handleGuess()`: ist `this.mp?.active`, übergibt die Methode an `this.mp.submitAnswer()` und kehrt zurück.
2. `switchUI()`: neuer Zustand `lobby` (`#lobby` sichtbar, Rest versteckt).
3. `init()`: `?join=CODE` öffnet die Namenseingabe mit vorausgefülltem Code; `?watch=CODE` startet den Watch-Modus.
4. `getPoints()` nutzt intern `scoring.js`; das Setzen von `#mapName` mit Icon bleibt im Client.
5. Menü: neuer Button „Mit Freunden spielen“ → `switchUI("lobby")`.
6. `BUTTON_NEXT`/`BUTTON_RESULTS` senden im Multiplayer `next`; `BUTTON_PLAYAGAIN` sendet `lobby`; `BUTTON_MENU` und das Logo verlassen die Session.
7. `setupHint()` setzt `#submitter` per `.text()` statt `.html()` (der Submitter kommt im Multiplayer vom Host).

### Ablauf Handy

1. **Namenseingabe:** Name (in `localStorage` gemerkt), Buttons „Session erstellen“ und „Beitreten“ + Code-Feld.
2. **Lobby:** Code groß, QR-Code (Link `https://<host>/?join=CODE`), Spielerliste mit Verbindungsstatus. Nur der Host sieht drei native Auswahlfelder (Modus, Timer, Runden 3/5/10), „Starten“ und den Link „Auf Bildschirm anzeigen“ (`?watch=CODE`). Beim Start ruft der Host-Client `getGuess(rounds)` auf und sendet `start`.
3. **Runde:** Auf `round` setzt der Client `currentGuess = { map, url, submitter }` und nutzt `setupMap()`/`setupHint()`. Im MapFinder-Modus wird die Karte erst beim Reveal mit `solution.map` gezeichnet. Nach dem Tipp sind Marker und Button gesperrt, Anzeige „Warte auf andere (x/y)“. Der Countdown in `#timerWrapper` rechnet mit `deadline - (Date.now() + offset)`, wobei `offset = serverNow - Date.now()` beim Empfang jeder Nachricht aktualisiert wird. Bei Ablauf schickt der Client einen bereits gesetzten Marker bzw. eingegebenen Kartennamen automatisch ab (wie im Singleplayer; der Server akzeptiert bis `deadline + 1000 ms`). Das Rundenende bestimmt der Server.
4. **Reveal:** Lösungsmarker und eigener Tipp mit Distanzlinie (bestehende Methoden), dazu Marker aller anderen Spieler mit permanentem Namens-Tooltip. Rangliste der Runde (Punkte dieser Runde, Gesamtpunkte). Host: Button „Nächste Runde“ bzw. in der letzten Runde „Endstand“. Die anderen sehen „Warte auf Host“.
5. **Final:** `#results` zeigt eine Rangliste mit 🏆 für die Gewinner statt des Bilder-Rasters. Buttons: „Menü“ (verlässt die Session) und für den Host „Nochmal“ (zurück in die Lobby mit denselben Spielern).

Alle Spielernamen werden ausschließlich über `.text()`/`textContent` gerendert, nie über `.html()`.

### Beamer (`?watch=CODE`)

Derselbe Client mit `body.watch-mode`, ohne Eingaben:

- **Lobby:** großer QR-Code und Code, Spielerliste.
- **Runde:** großes Hinweisbild, Spieler-Chips mit ✓ für „hat getippt“, großer Countdown.
- **Reveal:** Karte mit allen Markern und die Rangliste.
- **Final:** Podium (Top 3).

### Wiederverbindung

- `localStorage["mp:" + code] = { playerId, token }`.
- Bei `close` automatischer Neuaufbau nach 1 s, 2 s, 5 s, danach alle 5 s. Währenddessen erscheint das Banner „Verbinde neu…“.
- `visibilitychange` → `visible` bei geschlossener Verbindung → sofortiger Versuch.
- Bei `error SESSION_NOT_FOUND` (Server-Neustart oder abgelaufene Session): Eintrag löschen, Toast anzeigen, zurück ins Menü.

### Neue Abhängigkeiten

- `qrcode` (Client, Rendering in ein `<canvas>`)
- `ws` (Server)

## Deployment

- nginx, im bestehenden `server`-Block der Domain:

```nginx
location = /mp {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

- Prozess: `pm2 start server/index.js --name squadguessr-ws` (oder eine systemd-Unit).
- Wie im Dev-Proxy braucht auch der eigene Host ein Reverse-Proxy für `/api/v2/` auf squadcalc.app, damit Bilder und Guesses laden. Das ist Voraussetzung für den Fork-Betrieb überhaupt und nicht Teil dieses Features.
- Der Server sendet alle 30 s Pings (`ws`-Heartbeat), damit tote Verbindungen erkannt und nginx-Timeouts vermieden werden.

## Tests

- `node --test server/`:
  - `scoring.test.js`: Punkte-Schwellen und Interpolation, Skalierung nach Kartengröße, Levenshtein-Toleranz (≤ 2).
  - `session.test.js`: Erstellen/Beitreten, doppelter Name, Beitritt nach Start abgelehnt, Nicht-Host-Aktionen abgelehnt, Rundenende bei allen Antworten, Rundenende per Deadline, `endRound`, Reconnect per Token mit Zustand, Final mit Gleichstand, Validierung ungültiger `guesses`.
- Neues Script `npm test`.
- Manuell: zwei Browser-Tabs + ein echtes Handy im WLAN + ein `?watch=`-Tab; Handy während einer Runde sperren und entsperren; Server während einer Session neu starten.
- `npm run lint` fehlerfrei (inklusive `server/`).
