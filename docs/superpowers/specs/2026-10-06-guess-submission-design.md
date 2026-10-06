# Guesses einreichen und sichten – Design

**Datum:** 2026-10-06
**Status:** Entwurf zur Freigabe
**Branch:** `feature/guess-submission`

## Problem

Wer heute einen neuen Guess einreichen will, folgt der README:

1. Screenshot machen.
2. F12 öffnen und Debug-Logging einschalten.
3. Ein Spiel starten und `debugChangeMap('narva')` in die Konsole tippen.
4. Auf die Karte klicken und die JSON-Zeile aus der Konsole kopieren.
5. Bild und JSON in Discord posten.

Danach schneidet der Maintainer das Bild zu, wandelt es in WebP um und trägt die Daten ein. Das ist umständlich, und es gehen leicht Fehler durch: falsche Map, vertippte Koordinaten, Bild nicht quadratisch.

Guesses und Bilder liegen nicht in diesem Repo. Sie kommen von der Upstream-API `squadguessr.app/api/v2/`. Dieser Fork hat als eigenes Backend nur den Multiplayer-Server, ohne Speicher.

## Ziel

SquadGuessr bekommt ein Werkzeug, das zwei Dinge leistet:

- **User** legen Bild und Position fest und bekommen eine ZIP im fertigen Format. Die laden sie wie bisher in Discord hoch.
- Ein **Admin** zieht die ZIPs aus Discord in eine Review-Seite. Dort sichtet er jeden Guess, nimmt ihn an oder lehnt ihn ab und exportiert die angenommenen als eine ZIP.

Alles läuft im Browser. Es gibt keinen Server-Speicher und keinen Login.

### Erfolgskriterien

- Ein User reicht einen Guess ohne Entwicklerwerkzeuge ein: Map wählen, Bild mit Strg+V einfügen, Quadrat verschieben, Punkt setzen, „Hinzufügen“, ZIP herunterladen.
- Mehrere Guesses passen in eine ZIP. Die gewählte Map bleibt zwischen den Guesses stehen.
- Jedes Bild in der ZIP ist ein WebP mit genau 900×900 px. Ein Bild, dessen kürzere Seite unter 900 px liegt, wird abgelehnt.
- Die Koordinaten in der ZIP sind dieselben, die der bisherige Debug-Weg (`logLatLng`) für denselben Klick liefert.
- Die Review-Seite öffnet mehrere ZIPs auf einmal, zeigt pro Guess Bild und Marker an der eingereichten Stelle und exportiert die angenommenen im selben Format.
- Eine manipulierte ZIP kann im Review weder HTML einschleusen noch fremde Felder in den Export bringen.

### Nicht-Ziele

- Kein Upload auf einen Server und keine Anbindung an die Upstream-API.
- Keine Korrektur durch den Admin (Marker verschieben, Map oder Namen ändern).
- Keine Ablehngründe und kein Export der abgelehnten Guesses.
- Keine Speicherung über ein Neuladen hinweg, weder beim Einreichen noch im Review.
- Kein Rahmen, dessen Größe man ändern kann. Der Rahmen ist immer so groß wie die kürzere Bildseite.
- Den Namen merkt sich der Browser nicht.
- Keine Unterstützung für Safari beim Einreichen: Safari kann kein WebP erzeugen.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Wo landet ein angenommener Guess? | In einer Export-ZIP für den Maintainer. Im Spiel ändert sich nichts |
| Umsetzung | Zwei neue Ansichten in der bestehenden App, kein zweiter Webpack-Entry |
| Einstieg Einreichen | Button „SUBMIT A GUESS“ im Menü, darunter Auswahl SUBMIT, und `/?submit` |
| Einstieg Review | Dieselbe Auswahl im Menü (REVIEW) und `/?review`, kein Login |
| ZIP-Bibliothek | `fflate` (devDependency wie alle Frontend-Bibliotheken) |
| Bild | Quadrat wählbar, 900×900, WebP mit Qualität 0.85 |
| Menge | Beliebig viele Guesses pro ZIP |
| `mode` | Beim Einreichen immer `"easy"`. Im Review gelten `easy` und `hard` |
| Map-Name | Der `name` aus `MAPS` (z. B. `"Sanxian"`, `"AlBasrah"`) |
| Bild-ID | 15 zufällige Zeichen aus `[A-Za-z0-9]`, wie die bestehenden |
| Validierung | `validGuess` aus `server/validate.js` wird exportiert und wiederverwendet |
| Karte | Je Ansicht eine eigene `squadMinimap`-Instanz mit eigener Klick-Logik |
| Sprache | Einreichen in en und zh. Review nur en (zh fällt per `fallbackLng` auf en zurück) |

## Datenformat

Die ZIP sieht beim Einreichen und beim Export gleich aus:

```
guesses.json
img/guesses/<id>.webp
img/guesses/<id>.webp
…
```

`guesses.json` ist ein JSON-Array, eingerückt mit 4 Leerzeichen wie das Beispiel in der README:

```json
[
    {
        "map": "Sanxian",
        "mode": "easy",
        "url": "/img/guesses/PTWxNN2RRl9vC8G.webp",
        "lat": -1166.9828731644454,
        "lng": 859.1661270331499,
        "submitter": "Dan"
    }
]
```

- Die Schlüssel stehen immer in dieser Reihenfolge.
- `submitter` fehlt, wenn der Name leer ist.
- Der ZIP-Pfad eines Bildes ist `url` ohne den führenden `/`.
- `lat`/`lng` sind Spielkoordinaten in voller Genauigkeit, wie in den bestehenden Daten.
- Dateiname beim Einreichen: `squadguessr-<name>-<YYYY-MM-DD>.zip`. `<name>` ist der Name, reduziert auf `[A-Za-z0-9_-]`. Bleibt nichts übrig, steht dort `anonymous`.
- Dateiname beim Export: `squadguessr-approved-<YYYY-MM-DD>.zip`.

## Einreichen (`/?submit`)

### Einstieg

- Unter den beiden Spiel-Buttons im Menü steht ein schlichter, umrandeter Button **SUBMIT A GUESS**.
- Ein Klick darauf klappt darunter die Auswahl **SUBMIT** und **REVIEW** auf (ein weiterer Klick klappt sie wieder zu).
- **SUBMIT** öffnet die Ansicht und setzt die URL auf `/?submit`. Neu laden öffnet also wieder die Ansicht.
- **BACK** führt ins Menü und setzt die URL auf `/` zurück. Die gesammelten Guesses bleiben im Speicher. Wer wiederkommt, findet die Liste unverändert vor.

### Aufbau

- Oben stehen ein Namensfeld (optional, `maxlength="40"`) und die Map-Auswahl (ein natives `<select>` mit dem Platzhalter „Choose a map…“ und allen `MAPS`).
- Links ist der Bildbereich, rechts die Minimap.
- Darunter folgen **ADD**, die Liste der gesammelten Guesses, **DOWNLOAD ZIP (n)** und der Hinweis mit dem Discord-Link `https://discord.gg/BNPAc5kEJP`.
- Auf schmalen Bildschirmen (≤ 768 px) stehen Bild und Karte untereinander.

### Map

- Ohne gewählte Map bleibt die Minimap leer und nimmt keine Klicks an.
- Ein Wechsel der Map lädt die Karte neu und entfernt den Marker, weil die alten Koordinaten nicht zur neuen Map passen.

### Bild

- Strg+V fügt ein Bild ein, solange die Ansicht sichtbar ist. Das Tool reagiert nur, wenn `clipboardData.files` eine Datei mit `image/*`-Typ enthält. Text landet weiter normal im Namensfeld.
- Ein Klick in den leeren Bildbereich öffnet die Dateiauswahl (`<input type="file" accept="image/*">`). Drag & Drop einer Bilddatei auf den Bildbereich geht auch.
- Dekodiert wird mit `createImageBitmap(file)`. Schlägt das fehl, kommt der Toast „This file is not an image“.
- Ist die kürzere Seite kleiner als 900 px, kommt der Toast „Image too small: at least 900×900 px needed (yours: W×H)“, und das Bild wird verworfen.
- Ein neues Bild ersetzt das bisherige. Der Marker bleibt stehen.
- Solange ein Bild geladen ist, entfernt ein runder **✕**-Button oben rechts im Bildbereich („Remove image“) das Bild. Danach öffnet ein Klick auf die Fläche wieder die Dateiauswahl. Map und Marker bleiben, ADD ist ausgegraut, bis wieder ein Bild da ist. Der Button fängt `pointerdown` und `click` ab, damit weder das Ziehen des Quadrats startet noch die Dateiauswahl aufgeht.

### Quadrat

- Über dem Bild liegt ein quadratischer Rahmen, so groß wie die kürzere Seite. Außerhalb ist das Bild abgedunkelt.
- Zu Beginn sitzt der Rahmen mittig.
- Auf der langen Achse lässt er sich mit der Maus oder dem Finger verschieben (Pointer Events). Bei fokussiertem Bildbereich verschieben ihn auch die Pfeiltasten, um je 2 % der Bildbreite bzw. -höhe.
- Bei einem quadratischen Bild bewegt sich nichts.

### Punkt

- Ein Klick oder Tipp auf die Karte setzt den Marker (`guessMarker`). Weitere Klicks versetzen ihn, außerdem lässt er sich ziehen.
- Gespeichert wird `latlng × minimap.mapToGameScale`, wie in `logLatLng`.

### Hinzufügen

- **ADD** ist nur aktiv, wenn Map, Bild und Marker vorhanden sind.
- Beim Klick zeichnet das Tool das gewählte Quadrat auf ein 900×900-Canvas (`imageSmoothingQuality = "high"`) und erzeugt mit `toBlob(…, "image/webp", 0.85)` das Bild.
- Ist `blob` leer oder `blob.type` nicht `image/webp` (Safari), kommt der Toast „Your browser cannot create WebP images. Please use Chrome, Edge or Firefox“, und nichts wird hinzugefügt.
- Der Eintrag kommt in die Liste:
  - Vorschaubild, Map-Name und ✕ zum Entfernen.
  - Danach werden Bild und Marker zurückgesetzt. Map und Name bleiben.
  - Im Speicher bleiben der WebP-Blob, der Eintrag, das Originalbild und das gewählte Quadrat, damit sich der Guess später korrigieren lässt.

### Korrigieren

- Ein Klick auf Vorschaubild oder Map-Namen eines Guess in der Liste lädt ihn zurück in den Editor: Map, Marker an der gespeicherten Stelle, Originalbild mit dem damals gewählten Quadrat. Der Eintrag bekommt einen blauen Rand.
- Dann lassen sich Marker, Map, Quadrat und Bild ändern wie beim Erfassen. Ein Map-Wechsel entfernt den Marker.
- **ADD** heißt dann **SAVE** und überschreibt den Eintrag an seiner Stelle in der Liste. `url` (also die Bild-ID) bleibt gleich.
- **CANCEL** erscheint nur während einer Korrektur. Es verwirft sie und leert den Editor.
- Ein Bild, das im Editor lag, aber noch nicht hinzugefügt war, wird beim Klick auf einen Guess ersetzt.
- ✕ an einem Guess während einer Korrektur beendet die Korrektur zuerst.

### Herunterladen

- **DOWNLOAD ZIP (n)** ist nur aktiv, wenn die Liste nicht leer ist.
- Der Name wird erst beim Herunterladen gelesen und gilt für alle Einträge der ZIP.
- Ein Klick packt die ZIP und startet den Download über `<a download>` mit einer Objekt-URL.
- Die Liste bleibt danach stehen, damit man die ZIP erneut laden kann.

### Warnung beim Verlassen

- Gibt es Einträge, die seit dem letzten Download hinzugekommen oder entfernt worden sind, warnt der Browser beim Verlassen der Seite (`beforeunload`).

## Review (`/?review`)

### Einstieg

- Über **SUBMIT A GUESS** → **REVIEW** im Menü oder direkt über `/?review`. Die URL wird auf `/?review` gesetzt.
- **BACK** führt ins Menü und setzt die URL auf `/`. Die Warteschlange samt Entscheidungen bleibt im Speicher. Über REVIEW geht es an derselben Stelle weiter.

### ZIPs laden

- Ist die Warteschlange leer, füllt eine Ablagefläche („Drop ZIP files here or click to choose“) die Ansicht.
- Danach kann man weitere ZIPs auf die ganze Ansicht ziehen oder über **ADD ZIP** wählen. Die Dateiauswahl erlaubt mehrere Dateien (`multiple`, `accept=".zip"`).
- Alle Guesses landen in einer Warteschlange, in der Reihenfolge der Dateien und der Einträge.
- Eine Datei, die sich nicht lesen lässt, meldet ein Toast mit dem Dateinamen und dem Grund. Gemeint sind: keine ZIP, keine oder mehrere `.json`-Dateien, `.json`-Datei zu groß, kein JSON-Array. Die übrigen Dateien laden trotzdem.
- Ein Guess, dessen `url` schon in der Warteschlange steht, wird übersprungen. Die Zahl der übersprungenen Guesses zeigt ein Toast.

### Sichten

- Links das Bild als mittiges Quadrat (`object-fit: cover`), also genau der Ausschnitt, den der Export behält. Rechts die Minimap.
- Die Karte lädt die Map des Guesses, setzt einen festen Marker auf `lat × gameToMapScale`, `lng × gameToMapScale` und zentriert mit Zoom 4 darauf.
- Darüber stehen Map, Einreicher (oder „—“), ZIP-Name und der Fortschritt „3 / 23“.
- **ACCEPT** (`A`) und **REJECT** (`D`) entscheiden. Nach einer Entscheidung springt die Ansicht zum nächsten offenen Guess hinter dem aktuellen, sonst zum ersten offenen. Gibt es keinen offenen mehr, bleibt sie stehen.
- `←`/`→` blättern.
- Unten zeigt eine Leiste aus Vorschaubildern den Status jedes Guess: offen, angenommen (grüner Rand), abgelehnt (roter Rand, blass), ungültig (sehr blass). Ein Klick springt dorthin. Jede Entscheidung lässt sich jederzeit ändern.

### Ungültige Einträge

- Sie erscheinen in der Leiste und lassen sich anzeigen, aber nicht annehmen. Statt ACCEPT/REJECT steht dort der Grund.
- Liegt ihr Bild in der ZIP, wird es angezeigt. Sonst bleibt der Bildbereich leer.
- Map und Einreicher zeigen „—“. Die Karte zeigt keinen Marker und bleibt auf der zuletzt geladenen Map.

### Leeren

- **CLEAR** im Kopf der Ansicht leert die Warteschlange: Die Vorschaubilder werden freigegeben, die Ablagefläche erscheint wieder, EXPORT steht auf 0.
- Bei leerer Warteschlange ist CLEAR ausgegraut.
- Gibt es Entscheidungen, die seit dem letzten Export geändert wurden, fragt ein `confirm()` vorher nach („Clear the review? Decisions that were not exported will be lost.“). Ohne solche Entscheidungen leert CLEAR sofort.

### Export

- **EXPORT (n)** ist nur aktiv, wenn mindestens ein Guess angenommen ist.
- Der Export enthält die angenommenen Guesses in der Reihenfolge der Warteschlange.
- Jedes Bild im Export ist ein WebP mit 900×900. Ein Bild, das das noch nicht ist (PNG, JPEG, WebP in anderer Größe), wird umgewandelt: mittiges Quadrat, skaliert auf 900×900 (auch hoch), WebP mit Qualität 0.85. Die `url` bekommt die Endung `.webp`. Ein fertiges 900×900-WebP bleibt Byte für Byte unverändert.
- Die Bilder werden nacheinander umgewandelt, damit nicht alle großen Screenshots gleichzeitig im Speicher liegen.
- Der Export bricht mit dem Toast „Export failed“ und dem Grund ab, ohne ZIP und ohne die Entscheidungen zu verlieren, wenn ein Bild sich nicht lesen lässt, der Browser kein WebP erzeugen kann (Safari) oder zwei Einträge denselben Bildpfad bekämen (z. B. `x.png` und `x.webp`).
- Gibt es Entscheidungen, die seit dem letzten Export geändert worden sind, warnt der Browser beim Verlassen der Seite.

## Validierung beim Lesen einer ZIP

Die ZIPs kommen von Fremden. Sie sind eine Vertrauensgrenze.

1. **Entpacken:**
   - `unzipSync(bytes, { filter })` entpackt nur `.json`-Dateien beliebigen Namens mit `originalSize` ≤ 1 MB und Dateien unter `img/guesses/` mit der Endung `.webp`, `.png`, `.jpg` oder `.jpeg` (Groß- und Kleinschreibung egal) und `originalSize` ≤ 32 MB, damit auch volle PNG-Screenshots passen.
   - Beides darf zusätzlich in genau einem Ordner liegen (`squadguessr-Dan-2026-10-06/guesses.json`). So sieht eine ZIP aus, deren entpackter Ordner neu komprimiert wurde. Die Bilder werden neben der `.json`-Datei gesucht.
   - Was macOS beim Komprimieren hinzufügt (`__MACOSX/…`, Dateien mit `._` am Namensanfang), wird nie entpackt und zählt nicht als `.json`-Datei.
   - Alles andere wird gar nicht erst entpackt.
   - Wirft `unzipSync`, ist die ganze Datei unlesbar.
2. **Die `.json`-Datei:**
   - Es muss genau eine geben. Keine ergibt „no .json file“, mehrere ergeben „more than one .json file“ mit ihren Namen.
   - Sie muss sich als JSON parsen lassen und ein Array sein. Sonst ist die ganze Datei unlesbar.
3. **Jeder Eintrag:**
   - Er muss ein Objekt sein und `validGuess` bestehen: bekannte Map ohne Rücksicht auf Groß- und Kleinschreibung, sicherer `url`-Pfad unter `/img/`, endliche `lat`/`lng`, `submitter` fehlt oder ist ein String mit höchstens 40 Zeichen.
   - `mode` muss `"easy"` oder `"hard"` sein.
   - Unter `url` ohne führenden `/` muss ein entpacktes Bild liegen.
   - Der Grund für „ungültig“ ist der erste verletzte Punkt: `invalid data` (`validGuess` schlägt fehl), `invalid mode` oder `image missing`.
   - Das Bild eines ungültigen Eintrags wird nur über einen eigenen Schlüssel der entpackten Dateien gesucht (`Object.hasOwn`), damit eine `url` wie `/__proto__` nicht `Object.prototype` liefert.
4. **Neu aufbauen:** Ein gültiger Eintrag wird aus genau `map`, `mode`, `url`, `lat`, `lng` und gegebenenfalls `submitter` neu zusammengesetzt. Fremde Felder kommen nie in den Export.

### Anzeige

- Bilder laufen über `URL.createObjectURL(new Blob([bytes], { type: "image/webp" }))`.
- Alle Texte aus der ZIP (Map, Einreicher, ZIP-Name, Grund) laufen über `.text()`, nie über `.html()`. Dasselbe gilt für Toasts, die Dateinamen zeigen: `openToast` setzt `innerHTML`, deshalb wird der Dateiname vorher escaped.

### Restrisiko

- Eine bösartige ZIP kann höchstens den Review-Tab des Admins zum Absturz bringen.

## Aufteilung des Codes

| Datei | Verantwortung |
|---|---|
| `src/js/guessPack.js` | Reine Logik ohne DOM: `newImageId`, `packGuesses`, `unpackGuesses`, `zipFileName` |
| `src/js/submit.js` | Einreichen-Ansicht: Einfügen, Quadrat, Karte, Liste, Download |
| `src/js/review.js` | Review-Ansicht: Laden, Warteschlange, Entscheidungen, Export |
| `src/components/submit/submit.html`, `submit.scss` | Markup und Styles Einreichen |
| `src/components/review/review.html`, `review.scss` | Markup und Styles Review |
| `server/validate.js` | `validGuess` wird exportiert, sonst unverändert |
| `src/js/squadGuessr.js` | `switchUI`-Zustände `submit` und `review`, Routing für `?submit`/`?review`, Menü-Button |
| `src/components/menu/menu.html`, `index.html`, `src/app.js` | Button, Einbindung der Komponenten und Styles |
| `src/i18n/en.json`, `zh.json` | Texte |
| `README.md`, `CHANGELOG.md` | Abschnitt „Submit a new guess“ neu, Eintrag unter 1.4.0 |

Das Dockerfile bleibt unverändert. Der Build kopiert ohnehin das ganze Repo, und der Multiplayer-Server importiert nichts davon.

## Tests

`npm test` (`node --test server/`) bekommt `server/guessPack.test.js`. Vorbild ist `server/scoring.test.js`, das Code aus `src/js/` testet. Diese Fälle müssen abgedeckt sein:

- Packen und Entpacken ergibt dieselben Einträge und dieselben Bild-Bytes.
- `submitter` fehlt im Eintrag, wenn der Name leer ist.
- Ungültig mit Grund werden: unbekannte Map, `lat` als `NaN` bzw. `null` nach JSON, Name über 40 Zeichen, `mode: "medium"`, fehlendes Bild, Eintrag ist kein Objekt.
- Fremde Felder fehlen nach dem Entpacken.
- Andere Dateien in der ZIP werden ignoriert, auch `.gif`. Ein Bild über 32 MB gilt als fehlend.
- PNG- und JPEG-Bilder (auch `.JPG`) werden gelesen.
- `packGuesses` lehnt zwei Einträge mit demselben Bildpfad ab.
- `isWebp` erkennt den RIFF/WEBP-Kopf, `webpUrl` tauscht die Endung gegen `.webp`.
- Bytes, die keine ZIP sind, eine ZIP ohne `.json`-Datei, eine mit zwei `.json`-Dateien und eine `.json`-Datei, die kein Array ist, ergeben jeweils einen Fehler mit Meldung.
- Eine `.json`-Datei mit anderem Namen (auch `.JSON`) wird gelesen. `._`-Dateien und `__MACOSX/` zählen nicht.
- Eine ZIP mit Kompression (Stufe 6) lässt sich lesen. Das ist der Fall, in dem macOS die ZIP entpackt und der User sie neu packt.
- Eine ZIP, deren Dateien in einem Ordner liegen (neu komprimierter Ordner, samt `__MACOSX/`-Einträgen), lässt sich lesen.
- `newImageId` liefert 15 Zeichen aus `[A-Za-z0-9]`.
- `zipFileName` reduziert den Namen und nutzt `anonymous` als Ersatz.

Im Browser auf dem Dev-Server wird geprüft:

- Zwei Guesses auf verschiedenen Maps einfügen, zuschneiden, setzen, herunterladen.
- Die ZIP zusammen mit einer manipulierten ZIP in `/?review` öffnen, annehmen und ablehnen, exportieren und den Export wieder öffnen.
- **Koordinaten-Gegenprobe:** Ein echter Guess aus der API, als ZIP verpackt, muss im Review an derselben Stelle sitzen, die das Spiel als Auflösung zeigt.
- Die Koordinaten beim Einreichen müssen mit `logLatLng` in der Konsole übereinstimmen.
