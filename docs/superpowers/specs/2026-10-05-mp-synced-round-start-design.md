# Multiplayer: synchroner Rundenstart mit Vorladen – Design

**Datum:** 2026-10-05
**Status:** Entwurf zur Freigabe

## Problem

Beim Playtest des Multiplayers haben manche Spieler das Hinweisbild einer Runde deutlich später gesehen als andere, weil ihr Netz es langsamer geladen hat. Da die Deadline einer Runde auf dem Server ab dem Rundenstart läuft, verlieren langsame Geräte Spielzeit – bei „Rush“ (15 s) schnell einen großen Teil der Runde.

Gemessen am 2026-10-05 gegen squadguessr.app:

| Ressource | Größe | Wann geladen |
|---|---|---|
| Hinweisbild (`/api/v2/img/guesses/<zufälliger Name>.webp`) | 45–320 KB, meist ~150 KB | beim Rundenstart (`setupHint`) |
| Kartenbild Classic (`/api/v2/img/maps/<karte>/basemap.webp`) | 2,3–3,6 MB | beim Rundenstart (`setupMap`), **gleichzeitig** mit dem Hint |

Beide werden mit `cache-control: public, max-age=0` + ETag ausgeliefert. In Classic ist die Karte der größere Brocken; ohne sie kann man nicht tippen, und sie nimmt dem Hint Bandbreite weg.

## Ziel

Alle Spieler sehen das Bild einer Runde zur selben Zeit, und die Uhr läuft erst ab diesem Moment – ohne dass das Spiel spürbar langsamer wird.

### Erfolgskriterien

- Ist ein Spieler gedrosselt, erscheint das Bild trotzdem auf allen Geräten (inkl. Big-Screen) gleichzeitig, und der Countdown beginnt erst dann.
- Ab Runde 2 macht der Rundenstart im Normalfall **keine** Bildanfrage mehr, und „Weiter“ startet die nächste Runde ohne sichtbare Wartezeit.
- Gewartet wird höchstens 12 s (Runde 1) bzw. 5 s (ab Runde 2), plus bis zu 0,5 s Tick-Auflösung. Ein gesperrtes Handy kostet die Gruppe höchstens einmal diese Frist.
- Keine neuen Fehler-Toasts durch das neue Protokoll.

### Nicht-Ziele

- Kein Vorladen von Runde 1 schon in der Lobby (möglicher späterer Schritt).
- Kein „Jetzt starten“-Button für den Host.
- Kein Ausgleich der Nachrichtenlatenz (50–300 ms) zwischen Geräten.
- Keine Cache-Header-Änderungen in nginx oder an der API.
- Kein Schutz gegen Spicken über die DevTools (siehe Vertrauensmodell).
- Die 1,2-s-Einblendung des Hints bleibt (für alle gleich, also fair).

## Lösung im Überblick

Zwei Schichten, verschmolzen zu einem Mechanismus:

1. **Vorladen meldet früh „ready“.** Sobald Runde N startet, kündigt der Server Runde N+1 per `prepare` an. Jeder Client lädt deren Bilder im Hintergrund und meldet `ready`. Drückt der Host „Weiter“, sind im Normalfall alle bereit, und die Runde startet sofort.
2. **Warten als Sicherheitsnetz.** Ist noch jemand nicht bereit (immer in Runde 1, sonst nur bei Ausreißern), geht der Server in die neue Phase `loading` und startet die Runde, sobald alle abzuwartenden Spieler bereit sind – spätestens nach der Frist. Erst dann sehen alle das Bild, und die Deadline wird gesetzt.

Zahlen in Klammern sind Rundenindizes (Index 0 = erste Runde):

```
Host  start ─────────► Server: Phase loading, state, prepare(0)
Clients  laden Hint (+ Karte in Classic) ─► ready{0}
Server  alle bereit oder 12 s ─► state(round), round(0), prepare(1)
Clients  zeigen Bild; sobald die sichtbaren Bilder einen ersten Ladeversuch hinter sich haben:
         Bilder von Index 1 vorladen (niedrige Priorität) ─► ready{1}
Host  next ──────────► Server: alle bereit? ─ ja ─► state(round), round(1), prepare(2)   (kein loading)
                                             └ nein ─► state(loading), prepare(1) … ready / 5 s
```

## Entscheidungen

| # | Frage | Entscheidung |
|---|---|---|
| | Grundansatz | Vorladen mit frühem `ready` + Warten mit Frist (statt fester Countdown oder Timer pro Spieler) |
| | Frist | 12 s für Runde 1, 5 s ab Runde 2, gemessen ab Beginn von `loading` |
| | Anzeige beim Warten | Man bleibt, wo man ist (Lobby bzw. Auflösung); ⏳ bei Namen + Statuszeile |
| | Host-Button „Jetzt starten“ | Nein |
| | Modi | Gleiche Regel in allen Modi und Timer-Einstellungen, auch Chill |
| 1 | Alle schon bereit | Sofort starten, ohne `loading`-Zustand zu senden |
| 2 | Gesperrtes Handy (Socket noch offen) | Einmal bis zur Frist warten, dann `stalled`; nicht mehr abwarten, bis es per `ready` oder Reconnect zurückkommt |
| 3 | Verbindung bricht während `loading` ab | Nicht mehr warten (nur verbundene Spieler zählen) |
| 4 | Reconnect während `loading` | Wieder abwarten, die Frist verlängert sich nicht |
| 5 | Seite neu geladen während `round`/`reveal` | `ready` zurücksetzen, `prepare` erneut schicken, wieder abwarten |
| 6 | Host geht während `loading` | Läuft automatisch weiter (Host-Übergabe wie bisher) |
| 7 | Bild schlägt fehl | Jede Sekunde erneut versuchen; `ready` erst nach Erfolg; die Server-Frist begrenzt das Warten; nach Rundenstart versuchen Hint und Karte es weiter |
| 8 | Anzeige für `stalled` | 💤 statt ⏳, zählt nicht im Zähler |
| 9 | Ungültiges `ready` | Still ignorieren, nie mit Fehler antworten |
| 10 | Verspätetes `ready` aus dem vorigen Spiel | `ready` nur für die laufende oder die nächste Runde annehmen |
| 11 | Find the Map | Karte nie vorab senden oder vorladen; sie lädt bei der Auflösung wie heute |
| 12 | Big-Screen | Lädt vor, zeigt Status, wird nie abgewartet, schickt kein `ready` |
| 13 | Runde 1 | Kalt laden mit 12-s-Frist |
| 14 | Beitreten während `loading` | Ablehnen mit `GAME_RUNNING`, Zuschauen anbieten (wie heute) |
| 15 | „Weiter“/„Ergebnisse“ doppelt | Button beim Klick sperren; nach 5 s ohne Antwort wieder freigeben |
| 16 | Latenz zwischen Geräten | Kein Ausgleich |
| 17 | DevTools zeigen das nächste Bild früher | Akzeptiert |

### Vertrauensmodell

Der Browser des Hosts bekommt schon heute alle Lösungen (lat/lng) aus der API. Das Spiel setzt also faires Spiel unter Freunden voraus. Dass das Bild der nächsten Runde eine Runde früher in den DevTools sichtbar ist, ändert daran nichts. Einzige harte Regel: In Find the Map wird die Karte (= Antwort) nie vor der Auflösung gesendet.

## Server (`server/session.js`)

### Phasen

`lobby → loading → round → reveal → loading → round → … → final`

`loading` ist eine eigene Phase (kein Flag auf `round`). Dadurch sind Antworten, „Runde beenden“ und „Weiter“ während des Wartens schon durch die bestehenden Phasenprüfungen blockiert, und der Client erkennt den echten Rundenstart weiterhin an der `round`-Nachricht.

### Konstanten

```js
export const LOAD_FIRST_MS = 12 * 1000;  // Runde 1: nichts vorgeladen
export const LOAD_MS = 5 * 1000;         // ab Runde 2: normalerweise schon vorgeladen
```

### Neue Spielerfelder

| Feld | Start | Bedeutung |
|---|---|---|
| `ready` | `-1` | höchster Rundenindex, dessen Bilder das Gerät geladen hat |
| `stalled` | `false` | Gerät hat zuletzt die Frist gerissen und wird nicht mehr abgewartet |

`addPlayer` und `resetScores` setzen beide Felder zurück (also auch bei jedem neuen Spiel).

### Nachrichten

| Richtung | Typ | Inhalt |
|---|---|---|
| Server → Spieler + Zuschauer | `prepare` | `{ index, url, map }` – `map` ist in Find the Map immer `null` |
| Spieler → Server | `ready` | `{ index }` |

`roundMsg` und `prepareMsg` holen `url` und `map` aus einem gemeinsamen Helfer, damit die Regel „keine Karte in Find the Map“ nur an einer Stelle steht. `roundMsg` bekommt kein neues Feld.

`stateMsg` bekommt pro Spieler zusätzlich:
- `ready`: `phase === "loading" && p.ready >= round`
- `stalled`: `p.stalled`

### Ablauf

- **`start()`** und **`next()`** (wenn es noch eine Runde gibt) rufen statt `startRound()` das neue **`load()`** auf.
- **`load()`**: Phase `loading`, `loadUntil = now + (round === 0 ? LOAD_FIRST_MS : LOAD_MS)`. Wartet niemand mehr (`lateLoaders()` leer), direkt `startRound()` – ohne `loading`-State zu senden (Fall 1). Sonst `broadcastState()` und `broadcast(prepareMsg(round))`.
- **`lateLoaders()`**: Spieler mit `connected && !stalled && ready < round`. Zuschauer zählen nie; getrennte Spieler (auch innerhalb der 15-s-Reconnect-Kulanz) zählen nicht.
- **`checkLoaded()`**: Ist niemand verbunden, bleibt die Phase `loading` (sonst liefe die Uhr ohne Spieler; Rückkehrer werden nach Fall 4 behandelt, die Frist läuft weiter). Gibt es späte Spieler und `now < loadUntil`, weiter warten. Sonst alle späten Spieler auf `stalled = true` setzen und `startRound()`.
- **`checkRoundEnd()`** ruft in Phase `loading` stattdessen `checkLoaded()` auf. Damit decken `tick()` (alle 500 ms) und `leave()` die Frist und ausgestiegene Spieler ohne neue Aufrufe ab. Ein Verbindungsabbruch wird spätestens beim nächsten Tick berücksichtigt. Die Frist kann dadurch um bis zu 500 ms überschritten werden.
- **`startRound()`** bleibt wie bisher (Deadline erst jetzt) und schickt danach zusätzlich `prepareMsg(round + 1)`, falls es eine nächste Runde gibt.
- **`ready(player, index)`** (in `handle()` neben `answer`/`leave`, also **vor** der `HOST_ACTIONS`-Prüfung; antwortet nie mit einem Fehler): ignoriert, wenn die Phase nicht `loading`, `round` oder `reveal` ist, `index` keine ganze Zahl ist oder außerhalb der Guesses liegt, oder wenn `index` nicht passt – in `loading` nur `round`, in `round`/`reveal` nur `round` oder `round + 1`. Sonst `ready = max(ready, index)` und `stalled = false`. In Phase `loading` danach `broadcastState()` und `checkLoaded()`, aber nur wenn sich dadurch etwas geändert hat (`ready` erstmals ≥ `round` oder `stalled` weggefallen); ein doppeltes `ready` löst also keinen State aus.
- **`reconnect()`**: `stalled = false`, `ready = min(ready, round - 1)` (nach einem Neuladen sind die Bilder nicht mehr im Speicher) – beides **vor** dem bestehenden `broadcastState()`.
- **`sendPhase()`** (Reconnect und neue Zuschauer):
  - `loading` → `prepareMsg(round)`
  - `round` → `roundMsg` + `prepareMsg(round + 1)` (falls vorhanden)
  - `reveal` → `revealMsg` + `prepareMsg(round + 1)` (falls vorhanden)
  - `final` → unverändert
- `join()`, `answer()`, `updateSettings()`, `endRound`, `toLobby` und `next()` (bis auf den Aufruf von `load()`) bleiben unverändert; ihre Phasenprüfungen schließen `loading` bereits aus.
- Kommentar am Klassenkopf auf die neue Phase anpassen.

## Client

### Vorlader (`src/js/preloader.js`, neu)

Kleines Modul ohne DOM-Abhängigkeit; `Image`-Fabrik und Timer werden injiziert, damit es mit `node:test` testbar ist.

- Pro URL ein losgelöstes `new Image()` – ohne `crossOrigin`, mit exakt derselben URL wie später `#hint` bzw. Leaflets `ImageOverlay`. Solange der Vorlader die Referenz hält, verwendet der Browser das Bild ohne neue Anfrage wieder (HTML „list of available images“); ohne Referenz würde Chrome wegen `max-age=0` neu nachfragen.
- `load(urls, { low })`: lädt die URLs nacheinander (Hint vor Karte); die nächste URL startet, sobald die vorige einen ersten Versuch hinter sich hat (Erfolg oder Fehler). Bei `low` wird `fetchPriority = "low"` vor `src` gesetzt. Rückgabe: ein Promise, das sich erfüllt, wenn **alle** URLs erfolgreich geladen sind.
- Schlägt ein Bild fehl, wird es jede Sekunde mit einem neuen `Image` erneut versucht – im Hintergrund, damit ein dauerhaft kaputtes Bild die Warteschlange nicht blockiert.
- Wird dieselbe URL erneut angefordert (wiederholtes `prepare`), wird der bestehende Eintrag wiederverwendet.
- `keep(urls)`: verwirft alle anderen Einträge, stoppt deren Wiederholungen und gibt die Referenzen frei.
- Kein `decode()`: eine dekodierte Karte belegt ~64 MB.

### `src/js/multiplayer.js`

- **`prepare`**:
  1. URLs bilden: Hint über denselben Helfer wie `setupHint()` (`/api/v2${url}`), in Classic die Karte über denselben Helfer wie `squadMinimap.changeLayer()`.
  2. `preloader.keep(urls)` – die Bilder der laufenden Runde hält danach der DOM.
  3. Nach `this.visible` (siehe unten) `preloader.load(urls, { low })`; `low`, wenn das `prepare` während `round`/`reveal` kommt (= nächste Runde).
  4. Danach direkt im Callback `send({ type: "ready", index })`, ohne Timer (Timer werden in Hintergrund-Tabs gedrosselt). Ob gesendet wird, wird **erst beim Senden** geprüft: `this.active && !this.watching` – sonst könnte ein `ready` aus einem verlassenen Spiel über einen späteren Zuschauer-Socket gehen (Server: `INVALID`-Toast).
  - Jedes `prepare` wird beantwortet, auch ein wiederholtes nach einem Reconnect; liegen die Bilder schon vor, sofort. Ein `ready`, das `send()` bei geschlossenem Socket verwirft, wird so nach dem Reconnect nachgeholt.
  - `prepare` fasst `currentGuess`, `roundIndex`, `#hint` und die Karte **nicht** an. Sonst hielte `onRound()` den echten Rundenstart für eine Wiederholung (`resent`) und würde das Bild nie zeigen.
- **`stop()`** ruft `preloader.keep([])` auf (keine Wiederholungen und Referenzen über das Spiel hinaus).
- **`this.visible`**: Promise, das sich erfüllt, wenn Hint und Karte (Classic) der angezeigten Runde einen ersten Ladeversuch hinter sich haben. Startwert `Promise.resolve()`. Gesetzt von `onRound()` und von `onReveal()`, wenn es selbst `setupHint()`/`setupMap()` aufruft (Einstieg direkt in die Auflösung). So nimmt das Vorladen der nächsten Runde einem langsamen Gerät keine Bandbreite für die laufende weg. `onRound()` bleibt sonst in der Logik unverändert (die Bilder kommen aus dem Speicher).
- **`renderState()`**: Ist in Phase `loading` der Spielbildschirm (`#map_ui`) nicht sichtbar – Seite neu geladen, Big-Screen frisch geöffnet –, ruft es `showRoom()` auf; dort stehen Spielerliste mit ⏳/💤 und die Statuszeile. Wer gerade die Auflösung sieht, bleibt dort.
- **⏳/💤** für verbundene Spieler in Phase `loading`: ⏳ wenn `!ready && !stalled`, 💤 wenn `stalled`.
  - `renderPlayers()` setzt sie in Lobby-Liste und Spieler-Chips.
  - Auf dem Auflösungsbildschirm sind die Chips ausgeblendet, solange die Rangliste sichtbar ist (`lobby.scss:176`). Deshalb bekommen dort die Zeilen von `#mpRanking` dieselben Markierungen (Zeilen tragen dafür die Spieler-ID); die Rangliste bleibt sichtbar. Gilt auch für den Big-Screen.
- **`renderStatus()`** in Phase `loading`: `mp.loadingImages` mit `total` = abzuwartende Spieler (verbunden, nicht `stalled`) und `ready` = davon die bereiten – so kann der Zähler weder über `total` steigen noch `2/2` zeigen, während noch gewartet wird. Auf dem Spielbildschirm in `#mpStatus` (für alle, auch den Host), in der Lobby in einer neuen Zeile; „Waiting for the host …“ ist währenddessen ausgeblendet.
- **Lobby-Bedienung des Hosts** in Phase `loading`:
  - Der Ladezustand des Start-Buttons wird in `renderStatus()` aus `phase === "loading"` abgeleitet – damit gilt er auch für einen Host, der die Rolle während des Wartens übernimmt. `setButtonLoading()` wird nur beim Wechsel in bzw. aus `loading` aufgerufen, denn ein zweites `setButtonLoading(true)` speichert den Spinner als Originaltext. `start()` gibt den Button nur im Fehlerfall frei, nicht mehr im `finally`.
  - Die Einstellungs-Selects (`#mpSettings select`) sind gesperrt (der Server lehnt `settings` außerhalb der Lobby mit `INVALID` ab).
- **„Weiter“/„Ergebnisse“** (Fall 15): beim Klick sofort `disabled` und ein Fallback-Timer gestartet, der sie nach 5 s wieder freigibt, falls keine Antwort kam (macht sie nur aktiv, nicht sichtbar). `renderStatus()` löscht den Timer und gibt die Buttons mit dem nächsten State wie bisher frei. Deckt auch die Leertaste ab, da der Shortcut `disabled` prüft.

### `src/js/squadGuessr.js` und `src/js/squadMinimap.js`

- Ein Helfer für die Hint-URL, ein Helfer für die Karten-URL (`basemap.webp`), jeweils von Vorlader und Anzeige benutzt.
- **`setupHint()`**: `#hint-wrapper` zeigt einen Spinner, bis das Bild geladen ist. Bei einem Fehler nach 1 s erneut versuchen – nur solange es noch derselbe Guess ist und der Spielbildschirm (`#map_ui`) sichtbar ist. Es gibt höchstens einen Wiederholungs-Timer; ein neuer Aufruf löscht den alten. Das zurückgegebene Promise erfüllt sich beim ersten Erfolg **oder** ersten Fehler.
- **`changeLayer()`**: bei einem Fehler nach 1 s erneut `changeLayer()` aufrufen – nur solange `this.activeLayer` noch der fehlgeschlagene Layer ist und der Spielbildschirm sichtbar ist (verhindert parallele Schleifen, wenn dieselbe Karte erneut aufgebaut wird). Liefert ein Promise für den ersten Ladeversuch, das `draw()` und `setupMap()` zurückgeben (für `this.visible`).
- Bewusste Änderung am Singleplayer: Spinner im Hint-Bereich, Wiederholung bei Ladefehlern, und der Timer startet auch, wenn das Bild fehlschlägt (heute startet er dann nie). Sonst verhält sich der Singleplayer unverändert.

### Texte

`mp.loadingImages` in `src/i18n/en.json` und `src/i18n/zh.json`:

- en: `Loading images… ({{ready}}/{{total}})`
- zh: `图片加载中…（{{ready}}/{{total}}）`

Namen werden nicht in Texte interpoliert (sie erscheinen über ⏳/💤 an den Spielernamen), damit i18next-Escaping keine Rolle spielt.

## Randfälle (Verhalten)

| Fall | Verhalten |
|---|---|
| Alle schon bereit | `next()` startet die Runde im selben Aufruf, kein `loading`-State |
| Gesperrtes Handy | Einmal bis zur Frist, danach 💤 und nicht mehr abgewartet bis `ready`/Reconnect |
| Verbindungsabbruch während `loading` | Zählt sofort nicht mehr; Start spätestens beim nächsten Tick (≤ 0,5 s) |
| Alle Verbindungen weg während `loading` | Phase bleibt `loading`, bis wieder jemand verbunden ist; die Frist läuft weiter |
| Reconnect während `loading` | Bekommt `prepare`, wird wieder abgewartet, Frist bleibt |
| Neu geladen während `round`/`reveal` | `ready` sinkt, `prepare(next)` kommt mit, wird wieder abgewartet |
| Host geht während `loading` | Host-Übergabe wie bisher; Laden läuft weiter |
| Bild schlägt fehl | Wiederholung jede Sekunde; ohne Erfolg startet die Runde zur Frist, das Gerät wird `stalled`; Hint und Karte versuchen es in der Runde weiter |
| Ungültiges / doppeltes / altes `ready` | Still ignoriert, kein State-Broadcast |
| Find the Map | `prepare.map` ist `null`; Karte lädt erst zur Auflösung |
| Big-Screen | Bekommt `prepare` (auch beim Öffnen während `loading`, dann mit der Lobby-Ansicht), lädt vor, zeigt Status; zählt nie |
| Seite neu geladen während `loading` | Lobby-Ansicht mit ⏳/💤 und Statuszeile statt Hauptmenü; wird abgewartet (Fall 4) |
| Host ändert Einstellungen während Runde 1 lädt | Nicht möglich: Selects und Start-Button gesperrt |
| Letzte Runde | Kein `prepare` für eine weitere Runde |
| Beitreten während `loading` | `GAME_RUNNING`, Zuschauen wird angeboten |
| Doppelklick auf „Weiter“ | Button gesperrt bis zur Antwort, höchstens 5 s |
| Chill (Timer 0) | Gleiche Regel; Punkte hängen nicht von der Zeit ab, aber alle sehen das Bild gleichzeitig |

## Code-Stil

Wie im Repo: 4 Spaces, doppelte Anführungszeichen, Semikolons, ESM, Klassen ohne Klassenfelder und ohne `#private` (jshint `esversion: 11`). Spielernamen nur per `.text()`/`textContent`.

## Tests

### Server (`server/session.test.js`, `node:test`, eingespeiste Uhr)

Bestehende Tests: neuer Helfer `readyAll(index)`, den `started()`, die Tests mit `next()` und die vier Tests mit direktem `start` nutzen (Zuschauer, Host verlässt die Lobby, niemand hält die Host-Rolle, Lobby-Gast trennt sich). Der Reihenfolge-Test prüft künftig `state` → `round` → `prepare`. Erwartet werden etwa 10 angepasste Tests; der `deepEqual`-Test der Rundennachricht bleibt unverändert.

Neue Tests:

1. `start` → Phase `loading` und `prepare(0)`; eine Antwort während `loading` wird abgelehnt.
2. Alle verbundenen Spieler bereit → Runde startet, Deadline = Freigabezeitpunkt + Timer.
3. Frist per `tick()`: 12 s in Runde 1, 5 s danach; Späte werden `stalled`, in der nächsten Runde nicht abgewartet; `stalled` verschwindet durch `ready` und durch Reconnect.
4. Alle melden während der Runde `ready` für die nächste → `next()` startet sofort, ohne `loading`-State.
5. Nach jedem Rundenstart kommt `prepare(next)`, nach der letzten Runde nicht.
6. Verbindungsabbruch während `loading` → nicht mehr abgewartet; sind alle getrennt, bleibt `loading` bestehen.
7. Reconnect während `loading` → bekommt `prepare`, wird abgewartet, Frist unverändert.
8. Reconnect während `round` und `reveal` → `ready` gesenkt, `prepare(next)` kommt mit.
9. `ready` doppelt, mit falschem Index, außerhalb des Fensters (altes Spiel, `round + 1` während `loading`), kein Integer, in `lobby`/`final` → kein Fehler, keine Änderung, kein State-Broadcast.
10. Zuschauer bekommen `prepare`, zählen nie.
11. Find the Map: `prepare.map` ist `null`.
12. `state` enthält `ready` und `stalled` pro Spieler.
13. Beitreten während `loading` → `GAME_RUNNING`.

### Vorlader (`server/preloader.test.js`, Fake-`Image`, Fake-Timer)

- Erfolg erfüllt das Promise; wiederholtes Anfordern derselben URL erzeugt kein neues `Image`.
- Fehler → nach 1 s neuer Versuch, bis Erfolg; erst dann erfüllt sich das Promise.
- Reihenfolge: die zweite URL startet erst nach dem ersten Versuch der ersten.
- Ein dauerhaft fehlschlagendes Bild blockiert die nächste URL nicht.
- `low` setzt `fetchPriority = "low"` vor `src`.
- `keep()` verwirft andere Einträge und stoppt deren Wiederholungen.

### Manuell im Browser

Lokaler Docker-Dev-Server, ein Origin pro Spieler, Big-Screen in einem weiteren Tab. DevTools-„Disable cache“ muss **aus** sein (sonst umgeht Chrome den Speicher-Cache, und das Vorladen sieht kaputt aus).

- Ein Spieler gedrosselt („Slow 3G“): die anderen warten mit ⏳, das Bild erscheint überall gleichzeitig, der Countdown startet erst dann.
- Ab Runde 2: beim Rundenstart keine Bildanfrage im Netzwerk-Tab; „Weiter“ startet ohne sichtbare Wartezeit.
- Bild per „Request blocking“ sperren: Wiederholung im Sekundentakt, Start zur Frist; nach dem Entsperren erscheint das Bild noch in der Runde.
- Ein Gerät, das nie `ready` schickt: einmal Warten bis zur Frist, danach 💤, in der nächsten Runde kein Warten.
- Find the Map: keine Kartenanfrage vor der Auflösung.
- Doppelklick und gehaltene Leertaste auf „Weiter“: kein Fehler-Toast.
- `npm test` grün und `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/` ohne Fehler. Nicht `npm run lint`: jshint 0.5.9 stürzt ab, und `eslint --fix` würde alle Dateien auf CRLF umstellen (Config verlangt `windows`, die Dateien sind LF).

## Betroffene Dateien

| Datei | Änderung |
|---|---|
| `server/session.js` | Phase `loading`, `prepare`/`ready`, Frist, `stalled`, `sendPhase` |
| `server/session.test.js` | Helfer `readyAll`, angepasste und neue Tests |
| `src/js/preloader.js` | neu: Vorlader |
| `server/preloader.test.js` | neu: Tests für den Vorlader |
| `src/js/multiplayer.js` | `prepare`-Handler, `ready`, `this.visible`, ⏳/💤, Statuszeile, Button-Sperre |
| `src/js/squadGuessr.js` | Hint-URL-Helfer, `setupHint()` mit Spinner, Wiederholung, Fehlerpfad |
| `src/js/squadMinimap.js` | Karten-URL-Helfer, Wiederholung, Promise für ersten Ladeversuch |
| `src/components/lobby/lobby.html` | Statuszeile in der Lobby |
| `src/components/lobby/lobby.scss` | ⏳/💤 in den Ranglisten-Zeilen, falls nötig |
| `src/components/game/game.scss` | Spinner im Hint-Bereich |
| `src/i18n/en.json`, `src/i18n/zh.json` | `mp.loadingImages` |
| `CHANGELOG.md` | Eintrag unter 1.4.0 |
