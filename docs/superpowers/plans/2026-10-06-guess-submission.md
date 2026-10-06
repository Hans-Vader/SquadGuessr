# Guesses einreichen und sichten – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User reichen neue Guesses ohne Entwicklerwerkzeuge ein: Bild aus der Zwischenablage, Quadrat wählen, Punkt auf der Karte, Download als ZIP für Discord. Ein Admin sichtet die ZIPs auf `/?review` und exportiert die angenommenen als eine ZIP.

**Architecture:** Alles läuft im Browser, ohne Server und ohne Login.
- Ein DOM-freies Modul `src/js/guessPack.js` packt und liest die ZIPs mit `fflate` und validiert fremde Einträge über das bestehende `validGuess` aus `server/validate.js`.
- Zwei neue Ansichten der bestehenden SPA (`#submit`, `#review`) mit je einer Klasse (`src/js/submit.js`, `src/js/review.js`) nach dem Muster von `Multiplayer`: `constructor(app)` und `init()`, das Events bindet und den URL-Parameter prüft.
- Beide Ansichten nutzen je eine eigene `squadMinimap`-Instanz mit überschriebener Klick-Logik.

**Tech Stack:** Webpack 5, jQuery, Leaflet 2 alpha, i18next, `fflate` 0.8, Node 18 `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-06-guess-submission-design.md`

## Global Constraints

- Keine `Co-Authored-By`- oder andere AI-Attribution in Commit-Messages (globale Nutzer-Anweisung). Subagents ausdrücklich darauf hinweisen.
- Arbeiten auf dem Branch `feature/guess-submission`. Er existiert schon und enthält die Spec.
- Codestil wie im Repo:
  - 4 Spaces, doppelte Anführungszeichen, Semikolons, ESM.
  - Klassen ohne Klassenfelder und ohne `#private` (jshint `esversion: 11`).
  - Text aus fremden Quellen (ZIP-Inhalt, Dateinamen, Einreichername) nur per `.text()`/`textContent`/`.attr()`, nie per `.html()`. `openToast` setzt `innerHTML`: Dateinamen vorher escapen.
  - Kommentare auf Englisch, knapp, sie erklären das Warum.
- Konstanten exakt:
  - `IMAGE_SIZE = 900`, `WEBP_QUALITY = 0.85`, `KEY_STEP = 0.02` (`submit.js`)
  - `REVIEW_ZOOM = 4` (`review.js`)
  - `MAX_JSON = 1024 * 1024`, `MAX_IMAGE = 2 * 1024 * 1024`, Bild-ID 15 Zeichen aus `[A-Za-z0-9]` (`guessPack.js`)
- Format exakt (beim Einreichen und beim Export gleich):
  - `guesses.json`: JSON-Array, `JSON.stringify(list, null, 4)`, Schlüssel in der Reihenfolge `map`, `mode`, `url`, `lat`, `lng`, `submitter`. `submitter` fehlt, wenn leer.
  - Bilder unter `img/guesses/<id>.webp`, also `url` ohne den führenden `/`, gespeichert ohne Kompression (`level: 0`).
  - Dateinamen `squadguessr-<name>-<YYYY-MM-DD>.zip` (Name auf `[A-Za-z0-9_-]` reduziert, Ersatz `anonymous`) und `squadguessr-approved-<YYYY-MM-DD>.zip`.
  - Gründe für ungültige Einträge exakt: `invalid data`, `invalid mode`, `image missing`.
- `fflate` kommt als devDependency (wie alle Frontend-Bibliotheken hier): `npm install --save-dev fflate@^0.8.3`.
- Tests: `npm test` (läuft mit dem Node 18 dieses Rechners). Ausgangslage auf dem Branch: 68 Tests, alle grün. Nach Task 1: 77.
- Lint:
  - `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/` muss ohne Ausgabe durchlaufen.
  - `npx stylelint -c ./config/.stylelintrc.json src/components/submit/submit.scss src/components/review/review.scss` muss ohne Ausgabe durchlaufen. Nur die neuen Dateien prüfen, die alten SCSS-Dateien haben Altfehler.
  - `npx htmlhint --config ./config/.htmlhintrc.json --nocolor ./src/` meldet `no errors found`.
  - **Nie `npm run lint` und nie `--fix`:** jshint 0.5.9 stürzt ab, und `eslint --fix` stellt alle Dateien auf CRLF um.
  - Stylelint verlangt vor jeder Regel auf oberster Ebene eine Leerzeile, auch direkt nach einem `//`-Kommentar. Kommentare deshalb in den Block schreiben, wie im Plan.
- Build (braucht Node ≥ 20, der Rechner hat Node 18): `docker run --rm -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack -c ./config/webpack.config.js`. Die Ausgabe muss `compiled successfully` enthalten.
- Das Dockerfile bleibt unverändert.

## Review Focus

1. **Neu laden auf `/?submit` oder `/?review` zeigt nur diese Ansicht, nicht zusätzlich das Menü.** `init()` ruft erst `switchUI("menu")` und gleich danach `switchUI("submit")`. Ein Klick aufs Logo führt ins Menü und setzt die URL auf `/`, sodass ein Neuladen im Menü landet. Abgedeckt im Browser in Task 4, Step 2.
2. **Die eigene Minimap und die Spielkarte stören sich nicht.** Nach einem gespielten Spiel (der Spielzustand hat einen Lösungsmarker) setzt ein Klick im Einreichen trotzdem einen Marker. Nach dem Einreichen setzt ein Klick im Spiel weiter den Spielmarker. Abgedeckt im Browser in Task 4, Steps 3 und 9.
3. **Koordinaten stimmen absolut.** Ein echter Guess aus der API sitzt im Review an der Stelle, die das Spiel als Auflösung zeigt. Ein eingereichter Punkt landet im Review an derselben Stelle der Karte. Abgedeckt im Browser in Task 4, Steps 3, 6 und 7.
4. **Feindliche ZIP-Inhalte richten nichts an.** HTML in Einreichername und Dateiname erscheint als Text. Eine `url` wie `/__proto__` liefert kein Bild aus `Object.prototype`. Zu große Bilder werden nicht entpackt. Abgedeckt durch die Tests in Task 1, Step 2 und den Browser-Check in Task 4, Step 6.
5. **Doppelklick auf ADD fügt genau einen Guess hinzu, und die Warnung beim Verlassen greift genau dann, wenn etwas verloren ginge.** Abgedeckt im Browser in Task 4, Steps 4 und 5.

---

## File Structure

| Datei | Neu/Ändern | Verantwortung |
|---|---|---|
| `src/js/guessPack.js` | neu | ZIP packen/lesen, Validierung fremder Einträge, Bild-ID, Dateiname, Download |
| `server/guessPack.test.js` | neu | Tests für `guessPack.js` |
| `server/validate.js` | ändern | `validGuess` exportieren |
| `package.json`, `package-lock.json` | ändern | `fflate` |
| `src/js/submit.js` | neu | Einreichen-Ansicht |
| `src/components/submit/submit.html`, `submit.scss` | neu | Markup und Styles Einreichen, Styles des Menü-Buttons |
| `src/js/review.js` | neu | Review-Ansicht |
| `src/components/review/review.html`, `review.scss` | neu | Markup und Styles Review |
| `src/js/squadGuessr.js` | ändern | `Submit`/`Review` anlegen, `switchUI` mit abgeleiteter Ausblend-Liste, Logo setzt URL zurück |
| `src/components/menu/menu.html` | ändern | Button `BUTTON_SUBMIT` |
| `src/components/index.html`, `src/app.js` | ändern | Komponenten und Styles einbinden |
| `src/i18n/en.json`, `src/i18n/zh.json` | ändern | Texte `submit.*` (en, zh) und `review.*` (nur en) |
| `README.md`, `CHANGELOG.md` | ändern | Abschnitt „Submit a new guess“, Einträge unter 1.4.0 |

---

### Task 1: `guessPack` – ZIP packen und lesen

**Files:**
- Create: `src/js/guessPack.js`
- Create: `server/guessPack.test.js`
- Modify: `server/validate.js:32` (`function validGuess` → `export function validGuess`)
- Modify: `package.json`, `package-lock.json` (über `npm install`)

**Interfaces:**
- Consumes: `validGuess(g): boolean` aus `server/validate.js` (prüft Map aus `MAPS` ohne Rücksicht auf Groß- und Kleinschreibung, `url` unter `/img/` ohne gefährliche Zeichen und ohne `..`, endliche `lat`/`lng`, `submitter` fehlt/`null`/String ≤ 40).
- Produces (alle aus `src/js/guessPack.js`):
  - `newImageId(random?: (bytes: Uint8Array) => Uint8Array): string` – 15 Zeichen aus `[A-Za-z0-9]`. Ohne Argument nutzt es `crypto.getRandomValues` (im Browser vorhanden, in Node 18 nicht global, deshalb übergibt der Test eine Funktion).
  - `packGuesses(items: Array<{entry: Object, image: Uint8Array}>): Uint8Array` – ZIP im Format der Global Constraints. Nimmt aus `entry` nur die bekannten Felder.
  - `unpackGuesses(bytes: Uint8Array): Array<{entry: Object|null, image: Uint8Array|null, error: string|null}>` – wirft `Error` mit `not a ZIP file`, `guesses.json missing or too large`, `guesses.json is not valid JSON` oder `guesses.json is not a list`. Gültig: `entry` neu aufgebaut, `error: null`. Ungültig: `entry: null`, `error` ist der Grund, `image` ist das Bild, falls es unter einem eigenen Schlüssel liegt.
  - `zipFileName(name: string, date?: Date): string`
  - `downloadZip(bytes: Uint8Array, fileName: string): void` – nur im Browser, ohne Test.

- [ ] **Step 1: `fflate` installieren**

Run: `npm install --save-dev fflate@^0.8.3`
Expected: `package.json` hat unter `devDependencies` `"fflate": "^0.8.3"`.

- [ ] **Step 2: Failing Tests schreiben**

`server/guessPack.test.js` anlegen:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { newImageId, packGuesses, unpackGuesses, zipFileName } from "../src/js/guessPack.js";

const IMG = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
const URL_A = "/img/guesses/abcDEF123456789.webp";
const entry = (over = {}) => ({ map: "Sanxian", mode: "easy", url: URL_A, lat: -1166.9828731644454, lng: 859.1661270331499, ...over });

// a ZIP as someone else's tool (or a hand-edited one) would build it
const zipOf = (list, images = { [URL_A.slice(1)]: IMG }, level = 0) =>
    zipSync({ "guesses.json": strToU8(JSON.stringify(list)), ...images }, { level });

test("packGuesses and unpackGuesses round-trip entries and image bytes", () => {
    const b = { entry: entry({ url: "/img/guesses/zzzZZZ999999999.webp", map: "Narva", submitter: "Dan" }), image: new Uint8Array([9, 8, 7]) };
    const items = unpackGuesses(packGuesses([{ entry: entry(), image: IMG }, b]));
    assert.deepEqual(items, [
        { entry: entry(), image: IMG, error: null },
        { entry: b.entry, image: b.image, error: null },
    ]);
});

test("packGuesses writes the README layout: fixed key order, 4 spaces, no empty submitter", () => {
    const shuffled = { lng: 2, submitter: "", lat: 1, url: URL_A, mode: "easy", map: "Narva", extra: true };
    const files = unzipSync(packGuesses([{ entry: shuffled, image: IMG }]));
    const json = strFromU8(files["guesses.json"]);
    assert.equal(json, JSON.stringify([{ map: "Narva", mode: "easy", url: URL_A, lat: 1, lng: 2 }], null, 4));
    assert.deepEqual(files[URL_A.slice(1)], IMG);
});

test("unpackGuesses marks broken entries with a reason and keeps their image when there is one", () => {
    const items = unpackGuesses(zipOf([
        entry({ map: "Atlantis" }),
        entry({ lat: NaN }),
        entry({ submitter: "x".repeat(41) }),
        entry({ mode: "medium" }),
        entry({ url: "/img/guesses/missing.webp" }),
        5,
        null,
        entry({ url: "/__proto__" }),
    ]));
    assert.deepEqual(items.map(i => i.error), [
        "invalid data", "invalid data", "invalid data", "invalid mode", "image missing", "invalid data", "invalid data", "invalid data",
    ]);
    assert.ok(items.every(i => i.entry === null));
    assert.deepEqual(items[3].image, IMG);
    assert.equal(items[4].image, null);
    assert.equal(items[5].image, null);
    // a url naming an Object.prototype key must not hand that object out as image bytes
    assert.equal(items[7].image, null);
});

test("unpackGuesses drops unknown fields", () => {
    const [item] = unpackGuesses(zipOf([{ ...entry(), evil: "<img src=x>", points: 100 }]));
    assert.deepEqual(item.entry, entry());
});

test("unpackGuesses only reads images under img/guesses/ and up to 2 MB", () => {
    const big = "img/guesses/big.webp";
    const items = unpackGuesses(zipOf(
        [entry({ url: "/img/other/abc.webp" }), entry({ url: `/${big}` })],
        { "img/other/abc.webp": IMG, [big]: new Uint8Array(2 * 1024 * 1024 + 1), "readme.txt": IMG },
    ));
    assert.deepEqual(items.map(i => i.error), ["image missing", "image missing"]);
});

test("unpackGuesses reads a ZIP that was packed again with compression", () => {
    const items = unpackGuesses(zipOf([entry()], undefined, 6));
    assert.deepEqual(items, [{ entry: entry(), image: IMG, error: null }]);
});

test("unpackGuesses rejects files it cannot use as a whole", () => {
    assert.throws(() => unpackGuesses(new Uint8Array([1, 2, 3])), /not a ZIP file/);
    assert.throws(() => unpackGuesses(zipSync({ "other.json": strToU8("[]") })), /guesses\.json missing/);
    assert.throws(() => unpackGuesses(zipSync({ "guesses.json": strToU8("nope{") })), /not valid JSON/);
    assert.throws(() => unpackGuesses(zipSync({ "guesses.json": strToU8("{\"a\":1}") })), /not a list/);
});

test("newImageId gives 15 letters or digits", () => {
    assert.equal(newImageId(b => b.fill(0)), "AAAAAAAAAAAAAAA");
    assert.equal(newImageId(b => b.fill(61)), "999999999999999");
    assert.equal(newImageId(b => b.fill(62)), "AAAAAAAAAAAAAAA");
    assert.match(newImageId(b => webcrypto.getRandomValues(b)), /^[A-Za-z0-9]{15}$/);
});

test("zipFileName keeps safe characters and falls back to anonymous", () => {
    const day = new Date(2026, 9, 6);
    assert.equal(zipFileName("Dan the Man!", day), "squadguessr-DantheMan-2026-10-06.zip");
    assert.equal(zipFileName("approved", day), "squadguessr-approved-2026-10-06.zip");
    assert.equal(zipFileName("  ", day), "squadguessr-anonymous-2026-10-06.zip");
    assert.equal(zipFileName("测试", day), "squadguessr-anonymous-2026-10-06.zip");
    assert.equal(zipFileName("a_b-c", new Date(2027, 0, 9)), "squadguessr-a_b-c-2027-01-09.zip");
});
```

- [ ] **Step 3: Tests laufen lassen, sie müssen fehlschlagen**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|Cannot find"`
Expected: Fehler `Cannot find module '…/src/js/guessPack.js'`, `# fail 1`.

- [ ] **Step 4: `validGuess` exportieren**

In `server/validate.js` Zeile 32:

```js
function validGuess(g) {
```

ersetzen durch:

```js
export function validGuess(g) {
```

- [ ] **Step 5: `src/js/guessPack.js` anlegen**

```js
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { validGuess } from "../../server/validate.js";

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const MODES = ["easy", "hard"];
const MAX_JSON = 1024 * 1024;
const MAX_IMAGE = 2 * 1024 * 1024;
const IMAGE_PATH = /^img\/guesses\/[^/]+\.webp$/;

/**
 * Random image name like the existing ones ("PTWxNN2RRl9vC8G")
 * @param {function(Uint8Array): Uint8Array} [random] - fills the array with random bytes
 * @returns {string}
 */
export function newImageId(random = (bytes) => crypto.getRandomValues(bytes)) {
    // 256 % 62 favours the first 8 characters by a hair: irrelevant for a file name
    return Array.from(random(new Uint8Array(15)), b => ID_CHARS[b % ID_CHARS.length]).join("");
}

/**
 * A guess with exactly the fields the API knows, in the order of the README example
 */
function toEntry(g) {
    const entry = { map: g.map, mode: g.mode, url: g.url, lat: g.lat, lng: g.lng };
    if (g.submitter) entry.submitter = g.submitter;
    return entry;
}

/**
 * ZIP with guesses.json and every image at its url path
 * @param {Array<{entry: Object, image: Uint8Array}>} items
 * @returns {Uint8Array}
 */
export function packGuesses(items) {
    const files = { "guesses.json": strToU8(JSON.stringify(items.map(i => toEntry(i.entry)), null, 4)) };
    // webp is already compressed: storing it costs nothing in size
    items.forEach(i => { files[i.entry.url.slice(1)] = [i.image, { level: 0 }]; });
    return zipSync(files);
}

/**
 * Reads a submitted ZIP. It comes from a stranger: only known files are inflated, every entry is checked and rebuilt
 * @param {Uint8Array} bytes
 * @returns {Array<{entry: Object|null, image: Uint8Array|null, error: string|null}>}
 * @throws {Error} when the file as a whole is unusable
 */
export function unpackGuesses(bytes) {
    let files;
    try {
        files = unzipSync(bytes, {
            filter: f => (f.name === "guesses.json" && f.originalSize <= MAX_JSON)
                || (IMAGE_PATH.test(f.name) && f.originalSize <= MAX_IMAGE),
        });
    } catch {
        throw new Error("not a ZIP file");
    }
    if (!files["guesses.json"]) throw new Error("guesses.json missing or too large");
    let list;
    try {
        list = JSON.parse(strFromU8(files["guesses.json"]));
    } catch {
        throw new Error("guesses.json is not valid JSON");
    }
    if (!Array.isArray(list)) throw new Error("guesses.json is not a list");

    return list.map(g => {
        const path = typeof g?.url === "string" ? g.url.slice(1) : "";
        // own keys only: a url like "/__proto__" must not find Object.prototype
        const image = Object.hasOwn(files, path) ? files[path] : null;
        let error = null;
        if (!validGuess(g)) error = "invalid data";
        else if (!MODES.includes(g.mode)) error = "invalid mode";
        else if (!image) error = "image missing";
        return { entry: error ? null : toEntry(g), image, error };
    });
}

/**
 * "squadguessr-<name>-<YYYY-MM-DD>.zip" with the name cut down to safe file name characters
 * @param {string} name
 * @param {Date} [date]
 * @returns {string}
 */
export function zipFileName(name, date = new Date()) {
    const safe = String(name ?? "").replace(/[^A-Za-z0-9_-]/g, "") || "anonymous";
    const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(n => String(n).padStart(2, "0")).join("-");
    return `squadguessr-${safe}-${day}.zip`;
}

/**
 * Hands the bytes to the browser as a file download
 * @param {Uint8Array} bytes
 * @param {string} fileName
 */
export function downloadZip(bytes, fileName) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    // the download has started once click() returns; revoking a bit later keeps slow browsers safe
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
```

- [ ] **Step 6: Tests laufen lassen, sie müssen grün sein**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 77`, `# pass 77`, `# fail 0`

- [ ] **Step 7: Lint**

Run: `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/`
Expected: keine Ausgabe

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json server/validate.js server/guessPack.test.js src/js/guessPack.js
git commit -m "feat: pack and read guess submission ZIPs"
```

---

### Task 2: Einreichen-Ansicht

**Files:**
- Create: `src/js/submit.js`
- Create: `src/components/submit/submit.html`
- Create: `src/components/submit/submit.scss`
- Modify: `src/js/squadGuessr.js` (Imports Z. 10, Konstruktor Z. 39, `init` Z. 58–64, Logo Z. 152–156, `switchUI` Z. 517–555)
- Modify: `src/components/menu/menu.html:17-20`
- Modify: `src/components/index.html:48`
- Modify: `src/app.js:18`
- Modify: `src/i18n/en.json`, `src/i18n/zh.json`

**Interfaces:**
- Consumes:
  - Aus Task 1: `newImageId()`, `packGuesses(items)`, `zipFileName(name)`, `downloadZip(bytes, fileName)`.
  - Aus dem Bestand: `squadMinimap(id, pixelSize, defaultMap)` mit `clear()`, `draw()`, `activeMap`, `imageBounds`, `markersGroup`, `mapToGameScale`, `invalidateSize()`. Klicks laufen über `this._handleclick(e)` (Desktop-Klick) und `this._handleDoubleClick(e)` (Desktop-Doppelklick, Mobil-Klick), die Instanz darf beide überschreiben. Dazu `guessMarker(latlng, options, map)`, `app.openToast(type, title, text)`, `app.switchUI(page)`, `app.MAPSIZE`.
- Produces:
  - `Submit` (default export) mit `constructor(app)`, `init()`, `open()`.
  - `app.submit`.
  - `switchUI("submit")`.
  - In `switchUI` die Liste `parts`, die Task 3 um `"#review"` erweitert.

- [ ] **Step 1: Texte**

In `src/i18n/en.json` zwischen dem Block `"mp": { … },` und `"desc"` einfügen:

```json
    "submit": {
        "open": "SUBMIT A GUESS",
        "title": "Submit a guess",
        "steps": "Choose the map, paste your screenshot, drag the square onto the best part, then click on the map where the screenshot was taken.",
        "namePlaceholder": "Your name (optional)",
        "chooseMap": "Choose a map…",
        "pasteHint": "Paste a screenshot (Ctrl+V), drop it here or click to choose a file",
        "discordHint": "Upload the ZIP in the suggestions channel on",
        "remove": "Remove",
        "buttons": {
            "add": "ADD",
            "download": "DOWNLOAD ZIP"
        },
        "errors": {
            "notImage": "This file is not an image",
            "tooSmall": "Image too small: at least 900×900 px needed (yours: {{width}}×{{height}})",
            "noWebp": "Your browser cannot create WebP images. Please use Chrome, Edge or Firefox"
        }
    },
```

In `src/i18n/zh.json` an derselben Stelle einfügen:

```json
    "submit": {
        "open": "提交截图",
        "title": "提交猜测图",
        "steps": "选择地图，粘贴截图，把方框拖到最合适的位置，然后在地图上点击截图的拍摄位置。",
        "namePlaceholder": "你的名字（可选）",
        "chooseMap": "选择地图…",
        "pasteHint": "粘贴截图（Ctrl+V）、拖放到此处或点击选择文件",
        "discordHint": "请将 ZIP 文件上传到以下平台的建议频道：",
        "remove": "删除",
        "buttons": {
            "add": "添加",
            "download": "下载 ZIP"
        },
        "errors": {
            "notImage": "此文件不是图片",
            "tooSmall": "图片太小：至少需要 900×900 像素（当前：{{width}}×{{height}}）",
            "noWebp": "你的浏览器无法生成 WebP 图片，请使用 Chrome、Edge 或 Firefox"
        }
    },
```

Prüfen: `node -e 'for (const f of ["en", "zh"]) JSON.parse(require("fs").readFileSync(`src/i18n/${f}.json`))' && echo ok`
Expected: `ok`

- [ ] **Step 2: Markup**

`src/components/submit/submit.html` anlegen:

```html
<div id="submit">

    <h1 data-i18n="common:submit.title"></h1>
    <p class="submit-steps" data-i18n="common:submit.steps"></p>

    <div class="submit-fields">
        <input type="text" id="submitName" maxlength="40" autocomplete="off" data-i18n-placeholder="common:submit.namePlaceholder" />
        <select id="submitMapSelect">
            <option value="" disabled selected data-i18n="common:submit.chooseMap"></option>
        </select>
    </div>

    <div class="submit-work">
        <div id="submitImage" tabindex="0">
            <p class="submit-hint" data-i18n="common:submit.pasteHint"></p>
            <div class="submit-crop">
                <img id="submitPreview" alt="" draggable="false">
                <div id="submitFrame"></div>
            </div>
        </div>
        <div id="submitMinimap"></div>
    </div>
    <input type="file" id="submitFile" accept="image/*" hidden />

    <div class="button-container">
        <button id="BUTTON_SUBMIT_BACK" data-i18n="common:timer.buttons.back"></button>
        <button id="BUTTON_SUBMIT_ADD" data-i18n="common:submit.buttons.add" disabled></button>
    </div>

    <ul id="submitList"></ul>

    <button id="BUTTON_SUBMIT_DOWNLOAD" disabled></button>
    <p class="submit-discord">
        <span data-i18n="common:submit.discordHint"></span>
        <a href="https://discord.gg/BNPAc5kEJP" target="_blank" rel="noopener noreferrer">Discord</a>
    </p>

</div>
```

In `src/components/index.html` nach Zeile 48 (`lobby.html`) einfügen:

```html
                <%= require('html-loader!./submit/submit.html').default %>
```

In `src/components/menu/menu.html` direkt nach dem schließenden `</div>` von `<div class="menu-actions">` einfügen:

```html

    <button id="BUTTON_SUBMIT" data-i18n="common:submit.open"></button>
```

- [ ] **Step 3: Styles**

`src/components/submit/submit.scss` anlegen:

```scss
@use "../shared/variables";

#submit {
    height: 100%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 1em;
    // scroll instead of clipping under header/footer on small screens
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1em;
    [hidden] {
        display: none !important;
    }
    h1 {
        margin-bottom: 0;
    }
    input,
    select {
        padding: 0.8em;
        font-size: 1em;
        background: #1a1a1a;
        border: 2px solid #333;
        border-radius: 12px;
    }
    button {
        font-size: 1.1em;
        padding: 14px 28px;
    }
}

.submit-steps {
    max-width: 700px;
    opacity: 0.7;
}

.submit-fields {
    display: flex;
    gap: 1em;
    width: min(700px, 100%);
    > * {
        flex: 1;
        min-width: 0;
    }
}

.submit-work {
    // both boxes share one height; the image box uses it to fit the screenshot
    --h: min(60vh, 600px);
    display: flex;
    flex-shrink: 0;
    gap: 1em;
    width: 100%;
    > * {
        flex: 1;
        min-width: 0;
        height: var(--h);
        border-radius: 10px;
        background: #1a1a1a;
    }
}

#submitImage {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 2px dashed #333;
    cursor: pointer;
    &:focus-visible {
        outline: 2px solid variables.$mainColor;
    }
    .submit-hint {
        padding: 1em;
        opacity: 0.7;
    }
    // exactly the shown image: the frame's percentages refer to it
    .submit-crop {
        display: none;
        position: relative;
        width: min(100%, calc((var(--h) - 4px) * var(--ratio, 1)));
        aspect-ratio: var(--ratio, 1);
        overflow: hidden;
        // dragging the square must not scroll the page on touch screens
        touch-action: none;
        user-select: none;
        cursor: grab;
    }
    &.loaded {
        border-style: solid;
        cursor: default;
        .submit-hint {
            display: none;
        }
        .submit-crop {
            display: block;
        }
    }
}

#submitPreview {
    display: block;
    width: 100%;
    height: 100%;
}

#submitFrame {
    position: absolute;
    outline: 2px solid #fff;
    // everything outside the square is dimmed; the crop box clips the shadow
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
    pointer-events: none;
}

#submitMinimap {
    z-index: 0;
    background: #242424;
    cursor: crosshair;
}

#submitList {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.6em;
    li {
        display: flex;
        align-items: center;
        gap: 0.5em;
        padding: 0.3em;
        border-radius: 10px;
        background: #272727;
    }
    img {
        width: 48px;
        height: 48px;
        border-radius: 6px;
    }
    button {
        padding: 0.2em 0.6em;
        font-size: 1em;
        background: transparent;
    }
}

.submit-discord {
    opacity: 0.8;
    a {
        color: #aaa;
    }
}

#BUTTON_SUBMIT {
    // menu entry: secondary action, outlined instead of filled
    margin-top: 20px;
    padding: 12px 28px;
    font-size: 1em;
    background: transparent;
    border: 2px solid #333;
    &:hover {
        background: #272727;
    }
}

@media (width <= 768px) {
    .submit-fields {
        flex-direction: column;
    }
    .submit-work {
        --h: 40vh;
        flex-direction: column;
        > * {
            flex: none;
        }
    }
}
```

In `src/app.js` nach Zeile 18 (`lobby.scss`) einfügen:

```js
import "./components/submit/submit.scss";
```

- [ ] **Step 4: `src/js/submit.js` anlegen**

```js
import i18next from "i18next";
import { MAPS } from "./data/maps.js";
import { squadMinimap } from "./squadMinimap.js";
import { guessMarker } from "./guessMarker.js";
import { newImageId, packGuesses, zipFileName, downloadZip } from "./guessPack.js";

// every live hint image is exactly this size
const IMAGE_SIZE = 900;
const WEBP_QUALITY = 0.85;
// share of the long image side the square moves per arrow key press
const KEY_STEP = 0.02;

/**
 * "Submit a guess" view (?submit): paste a screenshot, choose its square, pin where it was taken
 * and download everything as one ZIP for Discord
 */
export default class Submit {
    constructor(app) {
        this.app = app;
        this.minimap = null;
        this.map = null;
        this.marker = null;
        this.bitmap = null;
        this.crop = null;
        this.previewUrl = null;
        this.drag = null;
        this.adding = false;
        this.guesses = [];
        this.dirty = false;
    }

    init() {
        MAPS.forEach(m => $("#submitMapSelect").append($("<option>").val(m.name).text(m.name)));

        $("#BUTTON_SUBMIT").on("click", () => this.open());
        $("#BUTTON_SUBMIT_BACK").on("click", () => {
            history.replaceState({}, "", "/");
            this.app.switchUI("menu");
        });
        $("#submitMapSelect").on("change", (e) => this.selectMap(e.target.value));
        $("#BUTTON_SUBMIT_ADD").on("click", () => this.add());
        $("#BUTTON_SUBMIT_DOWNLOAD").on("click", () => this.download());
        $("#submitFile").on("change", (e) => {
            if (e.target.files[0]) this.loadImage(e.target.files[0]);
            // choosing the same file again must fire change again
            e.target.value = "";
        });
        this.setupImageArea();

        document.addEventListener("paste", (e) => {
            if (!$("#submit").is(":visible")) return;
            const file = Array.from(e.clipboardData?.files ?? []).find(f => f.type.startsWith("image/"));
            if (!file) return;
            e.preventDefault();
            this.loadImage(file);
        });
        window.addEventListener("beforeunload", (e) => {
            if (!this.dirty || !this.guesses.length) return;
            e.preventDefault();
            // older browsers only ask when returnValue is set
            e.returnValue = true;
        });

        if (new URLSearchParams(location.search).has("submit")) this.open();
    }

    open() {
        history.replaceState({}, "", "/?submit");
        this.app.switchUI("submit");
        // leaflet measures its container: create the map once the view is shown
        if (!this.minimap) {
            this.minimap = new squadMinimap("submitMinimap", this.app.MAPSIZE, MAPS[0]);
            // the game's handlers look at the game's state (solution marker, mode): this view places its own marker
            this.minimap._handleclick = (e) => this.placeMarker(e.latlng);
            this.minimap._handleDoubleClick = (e) => this.placeMarker(e.latlng);
        }
        this.minimap.invalidateSize();
    }

    setupImageArea() {
        const area = document.getElementById("submitImage");

        area.addEventListener("click", () => {
            if (!this.bitmap) $("#submitFile").trigger("click");
        });
        // a file dropped anywhere on the view would otherwise make the browser leave the page to show it
        $("#submit").on("dragover", (e) => e.preventDefault());
        $("#submit").on("drop", (e) => {
            e.preventDefault();
            const file = Array.from(e.originalEvent.dataTransfer.files).find(f => f.type.startsWith("image/"));
            if (file) this.loadImage(file);
        });

        area.addEventListener("keydown", (e) => {
            const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
            if (!dir || !this.bitmap) return;
            e.preventDefault();
            const step = KEY_STEP * Math.max(this.bitmap.width, this.bitmap.height);
            this.moveCrop(this.crop.sx + dir[0] * step, this.crop.sy + dir[1] * step);
        });

        area.addEventListener("pointerdown", (e) => {
            if (!this.bitmap) return;
            area.setPointerCapture(e.pointerId);
            this.drag = { x: e.clientX, y: e.clientY, sx: this.crop.sx, sy: this.crop.sy };
        });
        area.addEventListener("pointermove", (e) => {
            if (!this.drag) return;
            // screen pixels to image pixels
            const scale = this.bitmap.width / document.getElementById("submitPreview").clientWidth;
            this.moveCrop(this.drag.sx + (e.clientX - this.drag.x) * scale, this.drag.sy + (e.clientY - this.drag.y) * scale);
        });
        const endDrag = () => { this.drag = null; };
        area.addEventListener("pointerup", endDrag);
        area.addEventListener("pointercancel", endDrag);
    }

    async loadImage(file) {
        let bitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch {
            return this.toast("submit.errors.notImage");
        }
        const { width, height } = bitmap;
        const size = Math.min(width, height);
        if (size < IMAGE_SIZE) {
            bitmap.close();
            return this.toast("submit.errors.tooSmall", { width, height });
        }
        this.clearImage();
        this.bitmap = bitmap;
        this.crop = { sx: 0, sy: 0, size };
        this.previewUrl = URL.createObjectURL(file);
        $("#submitPreview").attr("src", this.previewUrl);
        $(".submit-crop").css("--ratio", String(width / height));
        $("#submitImage").addClass("loaded");
        this.moveCrop((width - size) / 2, (height - size) / 2);
        this.updateButtons();
    }

    clearImage() {
        this.bitmap?.close();
        this.bitmap = null;
        this.drag = null;
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = null;
        $("#submitPreview").removeAttr("src");
        $("#submitImage").removeClass("loaded");
    }

    /**
     * Moves the square to the given top left corner (image pixels), kept inside the image
     */
    moveCrop(sx, sy) {
        const { width, height } = this.bitmap;
        const size = this.crop.size;
        this.crop.sx = Math.min(Math.max(sx, 0), width - size);
        this.crop.sy = Math.min(Math.max(sy, 0), height - size);
        $("#submitFrame").css({
            left: `${this.crop.sx / width * 100}%`,
            top: `${this.crop.sy / height * 100}%`,
            width: `${size / width * 100}%`,
            height: `${size / height * 100}%`,
        });
    }

    selectMap(name) {
        this.map = MAPS.find(m => m.name === name) ?? null;
        // the old marker's coordinates mean nothing on another map
        this.minimap.clear();
        this.marker = null;
        this.minimap.activeMap = this.map;
        this.minimap.draw();
        this.updateButtons();
    }

    placeMarker(latlng) {
        if (!this.map || !this.minimap.imageBounds.contains(latlng)) return;
        if (this.marker) this.marker.setLatLng(latlng);
        else this.marker = new guessMarker(latlng, {}, this.minimap).addTo(this.minimap.markersGroup);
        this.updateButtons();
    }

    async add() {
        if (this.adding) return;
        this.adding = true;
        this.updateButtons();
        // read everything before the await: the map, the marker or the image may change while the webp is encoded
        const { lat, lng } = this.marker.getLatLng();
        const scale = this.minimap.mapToGameScale;
        // the same numbers the debug helper logLatLng prints for this spot
        const entry = { map: this.map.name, mode: "easy", url: `/img/guesses/${newImageId()}.webp`, lat: lat * scale, lng: lng * scale };
        const blob = await this.encode();
        this.adding = false;
        if (blob?.type !== "image/webp") {
            this.updateButtons();
            return this.toast("submit.errors.noWebp");
        }
        this.guesses.push({ entry, blob, thumb: URL.createObjectURL(blob) });
        this.dirty = true;
        this.clearImage();
        this.marker?.remove();
        this.marker = null;
        this.renderList();
    }

    /**
     * The chosen square as a 900×900 webp
     * @returns {Promise<Blob|null>}
     */
    encode() {
        const { sx, sy, size } = this.crop;
        const canvas = document.createElement("canvas");
        canvas.width = IMAGE_SIZE;
        canvas.height = IMAGE_SIZE;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(this.bitmap, sx, sy, size, size, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
        // Safari cannot encode webp and silently hands back a png instead
        return new Promise(resolve => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
    }

    remove(index) {
        URL.revokeObjectURL(this.guesses[index].thumb);
        this.guesses.splice(index, 1);
        this.dirty = true;
        this.renderList();
    }

    renderList() {
        const $list = $("#submitList").empty();
        this.guesses.forEach((g, index) => {
            $("<li>").append(
                $("<img>").attr({ src: g.thumb, alt: "" }),
                $("<span>").text(g.entry.map),
                $("<button>").attr("aria-label", i18next.t("submit.remove", { ns: "common" })).text("✕").on("click", () => this.remove(index)),
            ).appendTo($list);
        });
        this.updateButtons();
    }

    updateButtons() {
        $("#BUTTON_SUBMIT_ADD").prop("disabled", this.adding || !(this.map && this.bitmap && this.marker));
        $("#BUTTON_SUBMIT_DOWNLOAD")
            .text(`${i18next.t("submit.buttons.download", { ns: "common" })} (${this.guesses.length})`)
            .prop("disabled", !this.guesses.length);
    }

    async download() {
        // the name is read only now and goes into every guess of this ZIP
        const name = $("#submitName").val().trim();
        const items = await Promise.all(this.guesses.map(async g => ({
            entry: { ...g.entry, submitter: name },
            image: new Uint8Array(await g.blob.arrayBuffer()),
        })));
        downloadZip(packGuesses(items), zipFileName(name));
        this.dirty = false;
    }

    toast(key, values = {}) {
        this.app.openToast("error", i18next.t(key, { ns: "common", ...values }), "");
    }
}
```

- [ ] **Step 5: In `squadGuessr.js` einhängen**

Nach Zeile 10 (`import Multiplayer from "./multiplayer.js";`) einfügen:

```js
import Submit from "./submit.js";
```

Im Konstruktor nach `this.mp = new Multiplayer(this);` einfügen:

```js
        this.submit = new Submit(this);
```

In `init()` nach `this.mp.init();` einfügen:

```js
        this.submit.init();
```

Den Logo-Handler in `setupNavigationButtons()` ersetzen. Bisher:

```js
        this.MAIN_LOGO.on("click", () => {
            this.stopTimer();
            if (this.mp.active) return this.mp.leave();
            this.switchUI("menu");
        });
```

Neu:

```js
        this.MAIN_LOGO.on("click", () => {
            this.stopTimer();
            if (this.mp.active) return this.mp.leave();
            // coming from ?submit or ?review: a reload must land on the menu too
            history.replaceState({}, "", "/");
            this.switchUI("menu");
        });
```

Die ganze Methode `switchUI(page)` ersetzen. Die Ausblend-Listen werden aus einer Liste aller Teile abgeleitet. Für die bestehenden Zustände ist das gleichwertig, denn jede alte `hide`-Liste war genau „alle anderen“.

```js
    switchUI(page) {

        // every page plus the footer logos: whatever a state does not show gets hidden
        const parts = ["#menu", "#timer_ui", "#map_ui", "#results", "#lobby", "#submit", "#footerLogos"];

        const uiStates = {
            menu: {
                show: ["#menu", "#footerLogos"],
                scoreHidden: true
            },
            timer: {
                show: ["#timer_ui", "#footerLogos"],
                scoreHidden: true
            },
            game: {
                show: ["#map_ui"],
                scoreHidden: false
            },
            results: {
                show: ["#results", "#footerLogos"],
                scoreHidden: true
            },
            lobby: {
                show: ["#lobby", "#footerLogos"],
                scoreHidden: true
            },
            submit: {
                show: ["#submit", "#footerLogos"],
                scoreHidden: true
            }
        };

        const state = uiStates[page];
        if (!state) return;

        state.show.forEach(selector => $(selector).fadeIn(400));
        parts.filter(selector => !state.show.includes(selector)).forEach(selector => $(selector).hide());
        $("#score").prop("hidden", state.scoreHidden);
        $("#mapName").hide();
        this.stopTimer();
    }
```

- [ ] **Step 6: Tests, Lint, Build**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# pass 77`, `# fail 0`

Run: `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/`
Expected: keine Ausgabe

Run: `npx stylelint -c ./config/.stylelintrc.json src/components/submit/submit.scss`
Expected: keine Ausgabe

Run: `npx htmlhint --config ./config/.htmlhintrc.json --nocolor ./src/ 2>&1 | tail -1`
Expected: `… no errors found …`

Run: `docker run --rm -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack -c ./config/webpack.config.js 2>&1 | grep -E "compiled|ERROR"`
Expected: `compiled successfully`, kein `ERROR`

- [ ] **Step 7: Commit**

```bash
git add src/js/submit.js src/components/submit/ src/js/squadGuessr.js src/components/menu/menu.html src/components/index.html src/app.js src/i18n/en.json src/i18n/zh.json
git commit -m "feat: submit guesses from the clipboard as a ZIP for Discord"
```

---

### Task 3: Review-Ansicht, README und Changelog

**Files:**
- Create: `src/js/review.js`
- Create: `src/components/review/review.html`
- Create: `src/components/review/review.scss`
- Modify: `src/js/squadGuessr.js` (Import, Konstruktor, `init`, `switchUI`)
- Modify: `src/components/index.html` (nach der `submit.html`-Zeile aus Task 2)
- Modify: `src/app.js` (nach der `submit.scss`-Zeile aus Task 2)
- Modify: `src/i18n/en.json`
- Modify: `README.md:17-56`, `CHANGELOG.md:6`

**Interfaces:**
- Consumes:
  - Aus Task 1: `packGuesses(items)` (nimmt Objekte mit zusätzlichen Feldern, liest nur `entry` und `image`), `unpackGuesses(bytes)`, `zipFileName(name)`, `downloadZip(bytes, fileName)`.
  - Aus Task 2: `switchUI` mit der Liste `parts`.
  - Aus dem Bestand: `squadMinimap` (wie in Task 2, zusätzlich `gameToMapScale`, `setView(latlng, zoom)`), `guessMarker` mit Option `{ draggable: false }`, `app.openToast("warning", title, html)`.
- Produces: `Review` (default export) mit `constructor(app)`, `init()`, `open()`, sowie `app.review` und `switchUI("review")`.

- [ ] **Step 1: Texte**

In `src/i18n/en.json` direkt nach dem `"submit"`-Block aus Task 2 einfügen (nur Englisch, `zh` fällt über `fallbackLng: "en"` darauf zurück):

```json
    "review": {
        "title": "Review guesses",
        "dropHint": "Drop ZIP files here or click to choose",
        "by": "by",
        "loadProblems": "Some guesses were not loaded",
        "duplicates": "{{n}} duplicate guesses skipped",
        "buttons": {
            "add": "ADD ZIP",
            "accept": "ACCEPT (A)",
            "reject": "REJECT (D)",
            "export": "EXPORT"
        }
    },
```

Prüfen: `node -e 'JSON.parse(require("fs").readFileSync("src/i18n/en.json"))' && echo ok`
Expected: `ok`

- [ ] **Step 2: Markup**

`src/components/review/review.html` anlegen:

```html
<div id="review">

    <div class="review-head">
        <button id="BUTTON_REVIEW_BACK" data-i18n="common:timer.buttons.back"></button>
        <h1 data-i18n="common:review.title"></h1>
        <button id="BUTTON_REVIEW_ADD" data-i18n="common:review.buttons.add"></button>
        <button id="BUTTON_REVIEW_EXPORT" disabled></button>
    </div>

    <div id="reviewDrop" data-i18n="common:review.dropHint"></div>

    <div id="reviewMain" hidden>
        <div class="review-info">
            <span id="reviewProgress"></span>
            <span id="reviewMap"></span>
            <span><span data-i18n="common:review.by"></span> <span id="reviewSubmitter"></span></span>
            <span id="reviewZip"></span>
        </div>
        <div class="review-work">
            <div class="review-image">
                <img id="reviewImage" alt="">
            </div>
            <div id="reviewMinimap"></div>
        </div>
        <p id="reviewError" hidden></p>
        <div id="reviewDecision">
            <button id="BUTTON_REVIEW_REJECT" data-i18n="common:review.buttons.reject"></button>
            <button id="BUTTON_REVIEW_ACCEPT" data-i18n="common:review.buttons.accept"></button>
        </div>
        <div id="reviewStrip"></div>
    </div>

    <input type="file" id="reviewFiles" accept=".zip,application/zip" multiple hidden />

</div>
```

In `src/components/index.html` nach der Zeile mit `submit.html` einfügen:

```html
                <%= require('html-loader!./review/review.html').default %>
```

- [ ] **Step 3: Styles**

`src/components/review/review.scss` anlegen:

```scss
#review {
    height: 100%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 1em;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1em;
    [hidden] {
        display: none !important;
    }
    h1 {
        flex: 1;
        margin: 0;
    }
    button {
        font-size: 1em;
        padding: 12px 24px;
    }
}

.review-head {
    display: flex;
    align-items: center;
    gap: 1em;
}

#reviewDrop {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    border: 2px dashed #333;
    border-radius: 10px;
    cursor: pointer;
}

#reviewMain {
    display: flex;
    flex-direction: column;
    gap: 1em;
}

.review-info {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 1.5em;
    #reviewZip {
        opacity: 0.6;
        word-break: break-all;
    }
}

.review-work {
    display: flex;
    flex-shrink: 0;
    gap: 1em;
    height: min(55vh, 600px);
    > * {
        flex: 1;
        min-width: 0;
        border-radius: 10px;
        background: #1a1a1a;
        overflow: hidden;
    }
}

#reviewImage {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
}

#reviewMinimap {
    z-index: 0;
    background: #242424;
}

#reviewError {
    color: #f88;
}

#reviewDecision {
    display: flex;
    justify-content: center;
    gap: 1em;
    #BUTTON_REVIEW_ACCEPT.chosen {
        background: #2e7d32;
    }
    #BUTTON_REVIEW_REJECT.chosen {
        background: #a33;
    }
}

#reviewStrip {
    display: flex;
    gap: 0.4em;
    overflow-x: auto;
    padding: 0.4em;
    .review-thumb {
        flex: 0 0 64px;
        height: 64px;
        padding: 0;
        font-size: 0.8em;
        border: 3px solid #333;
        border-radius: 6px;
        background: #1a1a1a;
        overflow: hidden;
        img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        &.accepted {
            border-color: #2e7d32;
        }
        &.rejected {
            border-color: #a33;
            opacity: 0.5;
        }
        &.invalid {
            opacity: 0.3;
        }
        &.current {
            outline: 3px solid #fff;
        }
    }
}

@media (width <= 768px) {
    .review-head {
        flex-wrap: wrap;
    }
    .review-work {
        flex-direction: column;
        height: auto;
        > * {
            flex: none;
            height: 40vh;
        }
    }
}
```

In `src/app.js` nach der Zeile mit `submit.scss` einfügen:

```js
import "./components/review/review.scss";
```

- [ ] **Step 4: `src/js/review.js` anlegen**

```js
import i18next from "i18next";
import { MAPS } from "./data/maps.js";
import { squadMinimap } from "./squadMinimap.js";
import { guessMarker } from "./guessMarker.js";
import { packGuesses, unpackGuesses, zipFileName, downloadZip } from "./guessPack.js";

const REVIEW_ZOOM = 4;

// the toast renders html, file names come from strangers
const escapeHtml = (text) => $("<div>").text(text).html();

/**
 * Admin view (?review): open submitted ZIPs, accept or reject every guess, export the accepted ones as one ZIP
 */
export default class Review {
    constructor(app) {
        this.app = app;
        this.minimap = null;
        this.drawnMap = null;
        this.items = [];
        this.index = 0;
        this.dirty = false;
    }

    init() {
        const $view = $("#review");

        $("#BUTTON_REVIEW_BACK").on("click", () => {
            history.replaceState({}, "", "/");
            this.app.switchUI("menu");
        });
        $("#reviewDrop, #BUTTON_REVIEW_ADD").on("click", () => $("#reviewFiles").trigger("click"));
        $("#reviewFiles").on("change", (e) => {
            this.addFiles(Array.from(e.target.files));
            // choosing the same file again must fire change again
            e.target.value = "";
        });
        $view.on("dragover", (e) => e.preventDefault());
        $view.on("drop", (e) => {
            e.preventDefault();
            this.addFiles(Array.from(e.originalEvent.dataTransfer.files));
        });
        $("#BUTTON_REVIEW_ACCEPT").on("click", () => this.decide("accepted"));
        $("#BUTTON_REVIEW_REJECT").on("click", () => this.decide("rejected"));
        $("#BUTTON_REVIEW_EXPORT").on("click", () => this.export());

        document.addEventListener("keydown", (e) => {
            if (!$view.is(":visible") || !this.items.length || e.ctrlKey || e.metaKey || e.altKey) return;
            const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            const action = {
                a: () => this.decide("accepted"),
                d: () => this.decide("rejected"),
                ArrowLeft: () => this.show(Math.max(this.index - 1, 0)),
                ArrowRight: () => this.show(Math.min(this.index + 1, this.items.length - 1)),
            }[key];
            if (!action) return;
            e.preventDefault();
            action();
        });
        window.addEventListener("beforeunload", (e) => {
            if (!this.dirty) return;
            e.preventDefault();
            // older browsers only ask when returnValue is set
            e.returnValue = true;
        });

        if (new URLSearchParams(location.search).has("review")) this.open();
    }

    open() {
        this.app.switchUI("review");
        if (!this.minimap) {
            this.minimap = new squadMinimap("reviewMinimap", this.app.MAPSIZE, MAPS[0]);
            // the review only looks: clicks place nothing
            this.minimap._handleclick = () => {};
            this.minimap._handleDoubleClick = () => {};
        }
    }

    async addFiles(files) {
        const wasEmpty = !this.items.length;
        const problems = [];
        let skipped = 0;
        for (const file of files) {
            let list;
            try {
                list = unpackGuesses(new Uint8Array(await file.arrayBuffer()));
            } catch (err) {
                problems.push(`${file.name}: ${err.message}`);
                continue;
            }
            list.forEach(g => {
                if (g.entry && this.items.some(i => i.entry?.url === g.entry.url)) {
                    skipped++;
                    return;
                }
                this.items.push({
                    ...g,
                    zip: file.name,
                    status: g.error ? "invalid" : "open",
                    src: g.image && URL.createObjectURL(new Blob([g.image], { type: "image/webp" })),
                });
            });
        }
        if (skipped) problems.push(i18next.t("review.duplicates", { ns: "common", n: skipped }));
        if (problems.length) {
            this.app.openToast("warning", i18next.t("review.loadProblems", { ns: "common" }), problems.map(escapeHtml).join("<br>"));
        }
        if (!this.items.length) return;
        this.show(wasEmpty ? Math.max(this.items.findIndex(i => i.status === "open"), 0) : this.index);
    }

    show(index) {
        this.index = index;
        const item = this.items[index];
        $("#reviewDrop").prop("hidden", true);
        $("#reviewMain").prop("hidden", false);

        if (item.src) $("#reviewImage").attr("src", item.src);
        else $("#reviewImage").removeAttr("src");
        $("#reviewImage").prop("hidden", !item.src);
        $("#reviewProgress").text(`${index + 1} / ${this.items.length}`);
        $("#reviewMap").text(item.entry?.map ?? "—");
        $("#reviewSubmitter").text(item.entry?.submitter ?? "—");
        $("#reviewZip").text(item.zip);
        $("#reviewError").text(item.error ?? "").prop("hidden", !item.error);
        $("#reviewDecision").prop("hidden", Boolean(item.error));
        $("#BUTTON_REVIEW_ACCEPT").toggleClass("chosen", item.status === "accepted");
        $("#BUTTON_REVIEW_REJECT").toggleClass("chosen", item.status === "rejected");

        this.showOnMap(item.entry);
        this.renderStrip();
    }

    showOnMap(entry) {
        // the map was hidden (size 0) until the first ZIP arrived
        this.minimap.invalidateSize();
        this.minimap.markersGroup.clearLayers();
        if (!entry) return;
        const map = MAPS.find(m => m.name.toLowerCase() === entry.map.toLowerCase());
        if (map !== this.drawnMap) {
            this.minimap.activeMap = map;
            this.minimap.draw();
            this.drawnMap = map;
        }
        // same conversion as the game's solution marker (getSolutionLatLng)
        const latlng = [entry.lat * this.minimap.gameToMapScale, entry.lng * this.minimap.gameToMapScale];
        new guessMarker(latlng, { draggable: false }, this.minimap).addTo(this.minimap.markersGroup);
        this.minimap.setView(latlng, REVIEW_ZOOM);
    }

    renderStrip() {
        const $strip = $("#reviewStrip").empty();
        this.items.forEach((item, index) => {
            const $thumb = $("<button>")
                .addClass(`review-thumb ${item.status}`)
                .toggleClass("current", index === this.index)
                .attr("title", item.error ?? item.status)
                .on("click", () => this.show(index));
            if (item.src) $thumb.append($("<img>").attr({ src: item.src, alt: "" }));
            else $thumb.text(index + 1);
            $strip.append($thumb);
        });
        $strip.children(".current")[0]?.scrollIntoView({ block: "nearest", inline: "nearest" });

        const accepted = this.items.filter(i => i.status === "accepted").length;
        $("#BUTTON_REVIEW_EXPORT")
            .text(`${i18next.t("review.buttons.export", { ns: "common" })} (${accepted})`)
            .prop("disabled", !accepted);
    }

    decide(status) {
        const item = this.items[this.index];
        if (!item || item.error) return;
        item.status = status;
        this.dirty = true;
        this.show(this.nextOpen() ?? this.index);
    }

    /**
     * The next undecided guess after the current one, else the first undecided one, else null
     */
    nextOpen() {
        const after = this.items.findIndex((item, index) => index > this.index && item.status === "open");
        if (after !== -1) return after;
        const first = this.items.findIndex(item => item.status === "open");
        return first === -1 ? null : first;
    }

    export() {
        const accepted = this.items.filter(i => i.status === "accepted");
        if (!accepted.length) return;
        downloadZip(packGuesses(accepted), zipFileName("approved"));
        this.dirty = false;
    }
}
```

- [ ] **Step 5: In `squadGuessr.js` einhängen**

Nach `import Submit from "./submit.js";` einfügen:

```js
import Review from "./review.js";
```

Im Konstruktor nach `this.submit = new Submit(this);` einfügen:

```js
        this.review = new Review(this);
```

In `init()` nach `this.submit.init();` einfügen:

```js
        this.review.init();
```

In `switchUI` die Liste `parts` ersetzen durch:

```js
        const parts = ["#menu", "#timer_ui", "#map_ui", "#results", "#lobby", "#submit", "#review", "#footerLogos"];
```

und in `uiStates` nach dem Zustand `submit` einfügen (Komma hinter dem schließenden `}` von `submit` nicht vergessen):

```js
            review: {
                show: ["#review", "#footerLogos"],
                scoreHidden: true
            }
```

- [ ] **Step 6: README**

In `README.md` den Abschnitt ab `# Submit a new guess` bis einschließlich der schließenden Zeile ` ``` ` des JSON-Beispiels (vor `</br></br></br>` und `# Multiplayer server`) ersetzen durch:

````markdown
# Submit a new guess 

</br>

1. Take your screenshot ingame (go into "screenshot mode" by clicking the eye icon at bottom of screen in main menu to remove compass, and Shift+P ingame for free camera). Its shorter side must be **at least 900px**. Please consider taking your screenshots at quite high graphics settings for best UX on squadguessr.
Using a screenshot tool like [GreenShot](https://getgreenshot.org/)/[ShareX](https://getsharex.com/) helps a lot.

2. Open SquadGuessr and click **SUBMIT A GUESS** in the menu (or go to `/?submit`).

3. Choose the map, paste your screenshot with Ctrl+V (or drop/choose the file), drag the square onto the part you want to show and click on the map where the screenshot was taken. Click **ADD** and repeat for more screenshots.

4. Click **DOWNLOAD ZIP** and upload the ZIP on [Discord](https://discord.gg/BNPAc5kEJP) (suggestion channel).

</br>

## Reviewing submissions

Open `/?review`, drop the ZIPs from Discord onto the page and accept (`A`) or reject (`D`) every guess. **EXPORT** downloads one ZIP with the accepted guesses: `guesses.json` and the 900×900 images under `img/guesses/`. Every entry looks like this:

```json
{
    "map": "Narva",
    "mode": "easy",
    "url": "/img/guesses/PTWxNN2RRl9vC8G.webp",
    "lat": -1402.4167693765319,
    "lng": 1438.0344360576973,
    "submitter": "your preferred nickname/ingame-nick here"
}
```
````

- [ ] **Step 7: Changelog**

In `CHANGELOG.md` unter `**1.4.0** *(unreleased)*` nach der Zeile `- Added Docker Compose hosting (frontend + multiplayer server)` einfügen:

```markdown
- Added "Submit a guess": paste a screenshot, choose its square, click where it was taken and download a ZIP to post on Discord
- Added a review page (`?review`) to check submitted ZIPs and export the accepted guesses
```

- [ ] **Step 8: Tests, Lint, Build**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# pass 77`, `# fail 0`

Run: `npx eslint -c config/.eslintrc.js --rule 'linebreak-style: off' src/ server/`
Expected: keine Ausgabe

Run: `npx stylelint -c ./config/.stylelintrc.json src/components/submit/submit.scss src/components/review/review.scss`
Expected: keine Ausgabe

Run: `npx htmlhint --config ./config/.htmlhintrc.json --nocolor ./src/ 2>&1 | tail -1`
Expected: `… no errors found …`

Run: `docker run --rm -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack -c ./config/webpack.config.js 2>&1 | grep -E "compiled|ERROR"`
Expected: `compiled successfully`, kein `ERROR`

- [ ] **Step 9: Commit**

```bash
git add src/js/review.js src/components/review/ src/js/squadGuessr.js src/components/index.html src/app.js src/i18n/en.json README.md CHANGELOG.md
git commit -m "feat: review submitted guess ZIPs and export the accepted ones"
```

---

### Task 4: Prüfung im Browser

**Files:**
- Create (nur Scratchpad, nicht committen): `<scratchpad>/fixtures.mjs`

Ohne Commit. Gefundene Fehler werden im zuständigen Task-Code behoben, mit eigenem Commit (`fix: …`), danach wird der betroffene Step wiederholt.

**Vorsicht beim Navigieren:** Hat die Seite ungespeicherte Guesses oder Entscheidungen, öffnet der Browser beim Verlassen einen `beforeunload`-Dialog. Der blockiert die Chrome-Erweiterung. Vor jedem `navigate` muss deshalb der Download bzw. Export erfolgt sein, wie in den Steps vorgesehen. Bleibt doch ein Dialog stehen, den Nutzer bitten, ihn zu schließen.

**Hilfen für die JS-Snippets** (`javascript_tool`, jeweils als `(async () => { … })()`):
- Sichtbarkeit: `const vis = (s) => getComputedStyle(document.querySelector(s)).display !== "none";`
- Toast: Titel in `document.querySelector("#toast h4").textContent`, Text in `document.querySelector("#toast p").innerHTML`.
- `$` und `App` sind auf der Seite nicht global. Alles läuft über DOM-Events, die die jQuery-Handler auslösen.

- [ ] **Step 1: Dev-Server und Fixtures**

```bash
docker run -d --rm --name sg-dev-test --network host -u 1000:1000 -v "$PWD":/app -w /app node:20-alpine npx webpack serve -c ./config/webpack.config.js
```

Warten, bis `docker logs sg-dev-test 2>&1 | grep -c "compiled successfully"` ≥ 1 ist. Der Multiplayer-Server wird nicht gebraucht.

`<scratchpad>/fixtures.mjs` anlegen:

```js
// Test ZIPs for the review check in the browser, printed as base64. Not part of the repo.
// Run from the repo root:
//   node fixtures.mjs hostile
//   node fixtures.mjs game '<guess JSON from the game>'
const root = process.cwd();
const { zipSync, strToU8 } = await import(`${root}/node_modules/fflate/esm/index.mjs`);
const { packGuesses } = await import(`${root}/src/js/guessPack.js`);

// 1×1 lossless webp: the review needs some image, not a real one
const IMG = new Uint8Array(Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64"));
const print = (bytes) => console.log(Buffer.from(bytes).toString("base64"));

if (process.argv[2] === "game") {
    print(packGuesses([{ entry: JSON.parse(process.argv[3]), image: IMG }]));
} else {
    const ok = { map: "Mutaha", mode: "easy", url: "/img/guesses/hostileOK000001.webp", lat: -1000, lng: 1000, submitter: "<b>bold</b>", extra: "<i>x</i>" };
    print(zipSync({
        "guesses.json": strToU8(JSON.stringify([
            ok,
            ok,
            { ...ok, url: "/__proto__" },
            { ...ok, url: "/img/guesses/hostileOK000002.webp", mode: "medium" },
            "text",
        ])),
        "img/guesses/hostileOK000001.webp": IMG,
        "img/guesses/hostileOK000002.webp": IMG,
        "../evil.txt": strToU8("x"),
    }));
}
```

Chrome-Tools laden: `tabs_context_mcp`, `tabs_create_mcp`, `navigate`, `computer`, `javascript_tool`, `read_page`. Einen neuen Tab öffnen.
Ist `localhost:3000` in der Erweiterung nicht erreichbar (`ERR_CONNECTION_REFUSED`), hängt die Erweiterung an einem anderen Rechner. Dann den Nutzer bitten, Chrome auf diesem Rechner zu öffnen, und `list_connected_browsers` + `select_browser` verwenden.

- [ ] **Step 2: Neu laden landet in der richtigen Ansicht** (Review Focus 1)

- `http://localhost:3000/?submit` öffnen, 3 s warten. JS:
  `["#menu", "#submit", "#review", "#lobby", "#map_ui"].map(s => [s, vis(s)])`
  Expected: nur `#submit` ist `true`.
- `http://localhost:3000/?review` öffnen, 3 s warten, gleicher Check.
  Expected: nur `#review` ist `true`.
- Auf das Logo klicken (`#MAINLOGO`, echter Klick).
  Expected: nur `#menu` sichtbar, `location.search === ""`.

- [ ] **Step 3: Erst ein Spiel, dann Einreichen** (Review Focus 2 und 3)

- Auf `http://localhost:3000/` vor dem Spiel diesen Hook setzen. Er merkt sich die Guesses der API:
  ```js
  const f = window.fetch;
  window.fetch = async (...a) => {
      const r = await f(...a);
      if (String(a[0]).includes("squadGuess")) r.clone().json().then(j => { window.__guesses = JSON.parse(atob(j.data)); });
      return r;
  };
  ```
- SINGLEPLAYER → PLAY. In Runde 1 echt auf die Karte klicken, dann GUESS. Die Auflösung zeigt den Lösungsmarker. **Screenshot A** machen und `JSON.stringify(window.__guesses[0])` notieren.
- Logo klicken, im Menü **SUBMIT A GUESS** klicken. Expected: `location.search === "?submit"`, `#submit` sichtbar.
- Zu kleines Bild einfügen:
  ```js
  const shot = async (w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const x = c.getContext("2d");
      x.fillStyle = "#f00";
      x.fillRect(0, 0, w / 2, h);
      x.fillStyle = "#00f";
      x.fillRect(w / 2, 0, w / 2, h);
      const blob = await new Promise(r => c.toBlob(r, "image/png"));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "shot.png", { type: "image/png" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  };
  window.__shot = shot;
  await shot(800, 600);
  ```
  Expected nach 500 ms: Toast-Titel `Image too small: at least 900×900 px needed (yours: 800×600)`, `#submitImage` hat keine Klasse `loaded`.
- `await window.__shot(1600, 1000)`. Expected: `#submitImage.loaded`. `#submitFrame` hat `style.left === "18.75%"` und `style.width === "62.5%"`.
- Rahmen nach rechts schieben: `#submitImage` fokussieren und 30-mal `keydown` mit `ArrowRight` darauf auslösen (`el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))`). Expected: `style.left === "37.5%"` (Anschlag rechts).
- Ziehen mit der Maus: mit `computer` `left_click_drag` von der Mitte des Rahmens 150 px nach links. Expected: `style.left` ist jetzt kleiner als `37.5%`. Danach wieder 30-mal `ArrowRight`, damit `left === "37.5%"`.
- Map wählen:
  ```js
  const s = document.querySelector("#submitMapSelect");
  s.value = "Narva";
  s.dispatchEvent(new Event("change", { bubbles: true }));
  ```
  Expected: `#BUTTON_SUBMIT_ADD` bleibt `disabled`, weil noch kein Marker gesetzt ist.
- Mit `computer` echt in die Mitte von `#submitMinimap` klicken (Mittelpunkt über `getBoundingClientRect()`). Expected: ein Marker erscheint, obwohl das Spiel gerade einen Lösungsmarker hatte, und `#BUTTON_SUBMIT_ADD` ist aktiv. **Screenshot B** machen.

- [ ] **Step 4: Hinzufügen, Zuschnitt, zweiter Guess** (Review Focus 5)

- Doppelklick auf ADD:
  ```js
  const b = document.querySelector("#BUTTON_SUBMIT_ADD");
  b.click();
  b.click();
  ```
  Expected nach 1 s: `document.querySelectorAll("#submitList li").length === 1`, `#submitImage` ohne `loaded`, ADD wieder `disabled`, DOWNLOAD heißt `DOWNLOAD ZIP (1)`.
- Zuschnitt prüfen (der Rahmen saß am rechten Rand, Quelle x = 600…1600):
  ```js
  const img = document.querySelector("#submitList img");
  const blob = await (await fetch(img.src)).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const x = c.getContext("2d");
  x.drawImage(bmp, 0, 0);
  const px = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data.slice(0, 3));
  ({ type: blob.type, w: bmp.width, h: bmp.height, left: px(5, 450), center: px(450, 450) });
  ```
  Expected: `type: "image/webp"`, `w: 900`, `h: 900`, `left` rot (R > 200, B < 50), `center` blau (B > 200, R < 50).
- Zweiter Guess: `await window.__shot(1600, 1000)`, Map `Sanxian` per `change` wählen, echt irgendwo in die Karte klicken, ADD. Expected: 2 Einträge, Map-Namen `Narva` und `Sanxian`.
- ✕ am zweiten Eintrag klicken. Expected: 1 Eintrag. Wieder einen Sanxian-Guess wie eben hinzufügen. Expected: 2 Einträge.

- [ ] **Step 5: Warnung beim Verlassen und Download** (Review Focus 5)

- `const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); e.defaultPrevented`
  Expected: `true`
- Name setzen: `document.querySelector("#submitName").value = "Tester <b>x</b>"`.
- Download abfangen, damit der Review ihn ohne Dateisystem bekommt:
  ```js
  const orig = URL.createObjectURL;
  URL.createObjectURL = (b) => {
      if (b.type === "application/zip") {
          b.arrayBuffer().then(buf => {
              const u = new Uint8Array(buf);
              let s = "";
              for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
              sessionStorage.setItem("submitted", btoa(s));
          });
      }
      return orig.call(URL, b);
  };
  ```
- `document.querySelector("#BUTTON_SUBMIT_DOWNLOAD").click()`, 1 s warten.
  Expected: `sessionStorage.getItem("submitted")` ist gesetzt. Eine Datei `squadguessr-Testerbx-<heute>.zip` wurde heruntergeladen (läuft Chrome auf diesem Rechner: `ls -t ~/Downloads | head -3`).
- Den `beforeunload`-Check wiederholen. Expected: `false`.

- [ ] **Step 6: Review – laden, feindliche Inhalte, Koordinaten** (Review Focus 3 und 4)

- In der Shell:
  ```bash
  node <scratchpad>/fixtures.mjs hostile > <scratchpad>/hostile.b64
  node <scratchpad>/fixtures.mjs game '<JSON aus Step 3>' > <scratchpad>/game.b64
  wc -c <scratchpad>/*.b64
  ```
  Beide sind unter 2 KB, weil die Fixtures ein 1×1-WebP nutzen.
- `http://localhost:3000/?review` im selben Tab öffnen (sessionStorage bleibt erhalten).
- Alle vier Dateien in einem Drop ablegen (`<hostile>` und `<game>` durch den Inhalt der `.b64`-Dateien ersetzen):
  ```js
  const file = (name, b64) => new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name, { type: "application/zip" });
  const dt = new DataTransfer();
  dt.items.add(file("submitted.zip", sessionStorage.getItem("submitted")));
  dt.items.add(file("<i>hostile</i>.zip", "<hostile>"));
  dt.items.add(new File([new TextEncoder().encode("not a zip")], "<b>broken</b>.zip"));
  dt.items.add(file("game.zip", "<game>"));
  document.querySelector("#review").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  ```
  Expected nach 1 s:
  - `#reviewProgress` zeigt `1 / 7`: 2 eingereicht + 4 aus `hostile` (der doppelte Eintrag fehlt) + 1 Spiel-Guess.
  - Toast-Titel `Some guesses were not loaded`. Toast-Text (`innerHTML`) enthält `&lt;b&gt;broken&lt;/b&gt;.zip: not a ZIP file` und `1 duplicate guesses skipped`.
  - `#reviewSubmitter.textContent === "Tester <b>x</b>"` und `#reviewSubmitter.children.length === 0`.
  - Die Karte zeigt Narva mit dem Marker in der Mitte. **Screenshot C** machen und mit **Screenshot B** vergleichen: Der Marker sitzt auf derselben Stelle der Karte.
- Durch `hostile` blättern (`→` per `document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))`):
  - Eintrag 3: `#reviewSubmitter.textContent === "<b>bold</b>"`, keine Kind-Elemente, Map `Mutaha`, Marker vorhanden.
  - Einträge 4–6: `#reviewError` zeigt `invalid data` (`/__proto__`), `invalid mode` und `invalid data` (`"text"`). `#reviewDecision` ist versteckt. Eintrag 4 hat kein Bild (`#reviewImage` hidden).
- Eintrag 7 (Spiel-Guess): **Screenshot D** machen. Der Marker sitzt auf derselben Stelle wie der Lösungsmarker in **Screenshot A**. Zum Vergleich die Umgebung (Straßen, Gebäude, Gelände) heranziehen.

- [ ] **Step 7: Entscheiden und exportieren**

- Mit `←` zu Eintrag 1. Dann per `keydown`: `a`, `d`, `a`. Expected nach jedem Schritt: Sprung zum nächsten offenen Guess, also 1 → 2 → 3 → 7.
  Danach `a` auf Eintrag 7. Expected: Die Ansicht bleibt auf Eintrag 7, `EXPORT (3)`. In der Leiste hat Eintrag 1 die Klasse `accepted`, Eintrag 2 `rejected`, die Einträge 4–6 `invalid`.
- Eintrag 2 per Klick in der Leiste öffnen, `a` drücken. Expected: `EXPORT (4)`. Dann `d` auf Eintrag 2. Expected: `EXPORT (3)`.
- Den `beforeunload`-Check aus Step 5 ausführen. Expected: `true`.
- Export abfangen wie in Step 5, aber unter dem Schlüssel `exported`. Dann `#BUTTON_REVIEW_EXPORT` klicken.
  Expected: Datei `squadguessr-approved-<heute>.zip`, `beforeunload`-Check `false`.
- Den Export auf dieselbe Seite fallen lassen (Drop wie in Step 6, nur `file("export.zip", sessionStorage.getItem("exported"))`).
  Expected: Toast-Text `3 duplicate guesses skipped`, weiterhin `… / 7`.
- `http://localhost:3000/?review` neu laden und den Export erneut ablegen.
  Expected: `1 / 3`, alle drei ohne `#reviewError`. Einreicher: `Tester <b>x</b>`, `<b>bold</b>` und beim Spiel-Guess der Name aus der API oder `—`.

- [ ] **Step 8: Schmale Bildschirme**

- `resize_window` auf 390×844. `/?submit` neu laden.
  Expected: Bild- und Kartenbereich stehen untereinander. `document.documentElement.scrollWidth <= innerWidth`.
- Dasselbe für `/?review` mit dem Export aus Step 7.
  Expected: Bild über Karte, Buttons erreichbar (Ansicht scrollt senkrecht).
- Fenster wieder auf die vorherige Größe setzen.

- [ ] **Step 9: Das Spiel funktioniert danach unverändert** (Review Focus 2)

- In `/?review` (nicht dirty, siehe Step 7) auf BACK klicken. Expected: Menü, `location.search === ""`.
- SINGLEPLAYER → PLAY, echt auf die Karte klicken. Expected: Ein Spielmarker erscheint, GUESS ist aktiv. GUESS klicken. Expected: Auflösung mit Distanz und Punkten wie gewohnt.

- [ ] **Step 10: Aufräumen**

```bash
docker stop sg-dev-test
```

Den Tab schließen. Die Scratchpad-Dateien bleiben liegen und werden nicht committet.
