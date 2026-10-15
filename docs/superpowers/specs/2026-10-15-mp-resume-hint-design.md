# Wiederbeitreten nach Rausfliegen – Design

## Ziel

Wer aus einem laufenden Multiplayer-Spiel fliegt, findet mit einem Klick zurück. Typische Fälle: neuer Tab auf `/`, Lesezeichen, Homescreen-Verknüpfung, Link aus Discord/WhatsApp nach einem App-Wechsel oder ein Klick aufs Logo. Solange der gespeicherte Token auf dem Server noch einem Spieler einer nicht beendeten Session gehört, zeigen das Menü und das Multiplayer-Formular einen Hinweis mit **REJOIN**.

Erfolg:
- Ein Klick bringt den Spieler zurück ins Spiel, mit Punkten und Platz in der Rangliste.
- Kein Hinweis bei toter Session, beendetem Spiel, Kick oder ausdrücklichem Verlassen der Lobby.
- Versehentliches Verlassen der Lobby braucht eine Bestätigung. Die anderen sehen, wer die Lobby verlassen hat.

## Ausgangslage

- Der Token liegt im `localStorage` als `mp:<CODE>`. Ein Cookie gibt es nicht. Der Name liegt in `mp:name`.
- Ein Reload auf `/?join=CODE` tritt schon still wieder bei (`multiplayer.js` `init()`). Daran ändert sich nichts.
- Der automatische Reconnect (Retries, `visibilitychange`, `RECONNECT_MS`) funktioniert und bleibt, wie er ist.
- Heute ist der Klick aufs Logo im Spiel ein endgültiges `leave()` und löscht den Token. Danach ist nur noch Zuschauen möglich.
- Tokens beendeter Spiele werden nie aufgeräumt. Ein Hinweis allein aus dem Client würde deshalb falsch anschlagen. Der Server muss gefragt werden.

## Verhalten nach Phase

| Phase | LEAVE / Logo | Server | Token im Client | Bestätigung | `left` an die anderen | Wiederbeitritts-Hinweis |
|---|---|---|---|---|---|---|
| Lobby | endgültig | Spieler entfernt | gelöscht | ja (`confirm`) | ja | nein |
| Lobby, Verbindung weg | – | offline in der Liste | bleibt | – | nein | ja |
| Start-Countdown (`loading`, Runde 0) | umkehrbar | offline in der Liste | bleibt | nein | nein | ja |
| Laden, Runde, Auflösung (nicht die letzte) | umkehrbar | offline in der Liste | bleibt | nein | nein | ja |
| Letzte Auflösung, `final` | umkehrbar | offline in der Liste | bleibt, wird bei der nächsten Prüfung gelöscht | nein | nein | nein |

Bricht der Host den Start ab, bleibt jemand, der im Countdown gegangen ist, offline in der Lobby, wie bei einer abgebrochenen Verbindung. Der Host kann ihn entfernen, und er selbst kann über den Hinweis zurückkommen.

## Server

### `server/index.js`

- `"check"` kommt zu den Begrüßungsnachrichten (`create`, `join`, `watch`). Damit gilt auch hier eine Nachricht pro Socket.
- `check` mit unbekanntem Code bekommt `SESSION_NOT_FOUND`, wie `join` und `watch`.
- `check` setzt **kein** `sessionOf`. Das Schließen des Prüf-Sockets löst also kein `disconnect()` und kein `touch()` aus und hält keine leere Session am Leben. Weitere Nachrichten auf diesem Socket bekommen `INVALID`.

### `server/session.js`

- **`check(conn, token)`:** Gehört `token` einem Spieler und gilt `!this.over()`, antwortet der Server `{ type: "resumable", code, phase, round, total }`. `total` wird wie in `stateMsg()` berechnet. Sonst kommt `SESSION_NOT_FOUND`. Die Prüfung ändert nichts: kein Broadcast, keine Verbindung, kein `touch()`. Ein nicht passender Typ von `token` (z. B. kein String) bekommt dieselbe Ablehnung.
- **`over()`:** wahr bei `phase === "final"` oder bei `phase === "reveal"` in der letzten Runde (`round + 1 === guesses.length`). `toLobby()` nutzt `over()` statt seines lokalen `lastReveal`.
- **`leave(player)`:** Endgültig nur noch bei `phase === "lobby"`. Dort wird der Spieler entfernt, sonst bleibt er offline mit `awayUntil = 0`. Damit wird die noch nicht committete Änderung zurückgenommen, die hier `joinable()` prüft. `joinable()` bleibt für `join()`, neue Spieler können also weiter während des Countdowns beitreten.
- **Hinweis `left`:** Verlässt jemand die Lobby endgültig, schickt `leave()` danach `{ type: "left", name }` an alle. Der Gehende ist schon entfernt und bekommt die Nachricht nicht. Bei einem Kick gibt es keinen Hinweis: `kick()` legt den Token vor dem Aufruf von `leave()` in `kicked` ab, und `leave()` prüft genau das.

Unverändert bleiben `disconnect()`, `reconnect()`, `RECONNECT_MS`, `fixHost()` und die Idle-Logik.

## Client

### Speicher (`src/js/multiplayer.js`)

- `welcome` setzt zusätzlich `mp:last = code`. Zuschauer bekommen kein `welcome` und setzen deshalb nichts.
- `forget(code)` löscht `mp:<code>` und, falls er auf `code` zeigt, auch `mp:last`. Aufgerufen wird es:
  - von `leave()` in der Lobby-Phase,
  - von `onError` bei `SESSION_NOT_FOUND` und `NAME_TAKEN` (ersetzt das bisherige `removeItem`),
  - bei einer negativen Prüfung,
  - beim Verwerfen des Hinweises (✕).

### Verlassen

- `leave()` löscht den Token nur noch, wenn `state.phase === "lobby"` gilt und der Client nicht zuschaut. Sonst bleibt der Token erhalten.
- `confirmLeave()` gibt `true` zurück, außer in der Lobby-Phase als Spieler. Dort fragt es `confirm(t("mp.confirmLeave"))`.
- Die Bestätigung steht **nur** in den Klick-Handlern von `BUTTON_MP_LEAVE` und `MAIN_LOGO` (`squadGuessr.js`). `onError` ruft `leave()` auch nach Kick oder toter Session auf, dort darf keine Rückfrage kommen.

### Prüfung `checkResume()`

- Liest `mp:last` und den Token dazu. Fehlt einer davon, ist der Hinweis versteckt, und es gibt keine Prüfung.
- Öffnet einen eigenen Wegwerf-Socket und schickt `{ type: "check", code, token }`. Nach der ersten Antwort wird der Socket geschlossen. Es gibt keine Wiederholung. Eine noch laufende ältere Prüfung wird geschlossen.
  - Bei `resumable` erscheint der Hinweis, aber nur, wenn `this.active` dann noch falsch ist. So blitzt er beim stillen Rejoin über `?join=` nicht kurz auf.
  - Bei jeder anderen Antwort: `forget(code)`, kein Hinweis.
  - Bei einem Socket-Fehler: kein Hinweis, der Token bleibt.
- Ausgelöst wird die Prüfung zentral in `switchUI()` für `menu` und `lobby`, solange `mp.active` falsch ist. Das deckt alle Wege ab: das Laden der Seite, Logo, Zurück, Menü-Button, MULTIPLAYER und das Formular nach einem Fehler.
- `open()` versteckt den Hinweis und schließt eine laufende Prüfung.
- Die WebSocket-URL baut ein gemeinsamer Helfer `socketUrl()`, den auch `connect()` nutzt.

### Hinweis-UI

- Das Element `.mp-resume` steht oben in `#menu` (`menu.html`) und oben in `#mpEntry` (`lobby.html`, unter der Überschrift). Es ist standardmäßig `hidden`, und dieselbe Funktion füllt beide.
- Text:
  - Lobby: `mp.resume.lobby`, z. B. "You are still in lobby {{code}}".
  - Sonst: `mp.resume.game`, z. B. "Game {{code}} is still running · Round {{round}}/{{total}}" mit `round + 1`.
- Buttons:
  - **REJOIN** (`mp.buttons.rejoin`) ruft `this.join(code)` auf. Name und Token liegen schon im Speicher.
  - **✕** (`aria-label` und `title` aus `mp.dismissResume`) ruft `forget(code)` auf und versteckt den Hinweis. Der Server erfährt davon nichts.
- Der Hinweis erscheint auch, wenn das Spiel gerade in einem anderen Tab verbunden ist. REJOIN holt es dann in diesen Tab, und der andere bekommt die bekannte `REPLACED`-Meldung.
- Der Hinweis wird nicht live aktualisiert. Die Rundenzahl gilt für den Moment der Prüfung.

### Hinweis `left`

- `onMessage` behandelt `"left"` mit `toast("info", "mp.left", { name })`.
- `toast(type, key, options)` reicht `options` an `i18next.t` weiter.
- i18next maskiert Einsetzwerte standardmäßig. Das ist nötig, weil `openToast` `innerHTML` setzt. Hier also **kein** `escapeValue: false`.
- Auch Zuschauer (die große Anzeige) sehen den Toast.

### Texte

Neu in `src/i18n/en.json` und `src/i18n/zh.json` unter `common.mp`: `resume.lobby`, `resume.game`, `buttons.rejoin`, `dismissResume`, `confirmLeave`, `left`.

## Fehlerfälle

- **Session tot**, z. B. nach einem Server-Neustart: Die Prüfung bekommt `SESSION_NOT_FOUND`, der Client ruft `forget` auf, kein Hinweis.
- **Server nicht erreichbar:** kein Hinweis, der Token bleibt. Beim nächsten Aufruf des Menüs wird erneut geprüft.
- **Zwischen Hinweis und Klick hat sich etwas geändert.** Keiner dieser Fälle braucht eigenen Code:
  - Das Spiel ist inzwischen `final`: Der Spieler landet beim Endergebnis.
  - Der Host hat schon "nochmal spielen" gedrückt, der Token ist also ungültig: Der normale `join` tritt mit dem gespeicherten Namen der neuen Lobby bei, oder es kommt `NAME_TAKEN`.
  - Die Session ist tot: Es kommt der bekannte Fehler-Toast, und das Formular erscheint.
- **Alte Tokens von vor diesem Feature** (ohne `mp:last`) werden nie geprüft. Sie schaden nicht.

## Tests

### `server/session.test.js`

- `check` antwortet mit `resumable` (Phase, Runde, Rundenzahl) für einen bekannten Token:
  - in der Lobby nach abgebrochener Verbindung,
  - im Countdown,
  - in der Runde,
  - in einer Auflösung, die nicht die letzte ist.
- `check` antwortet mit `SESSION_NOT_FOUND`:
  - bei unbekanntem Token oder einem Token, der kein String ist,
  - nach einem Kick,
  - nach ausdrücklichem Verlassen der Lobby,
  - in der letzten Auflösung,
  - in `final`.
- `check` schickt keinen Broadcast und ändert nichts am Spieler.
- `leave` im Countdown: Der Spieler bleibt offline in der Liste, und sein Token holt ihn zurück, auch wenn Runde 1 schon läuft. Der noch nicht committete Test "who left during the countdown can play again" wird entsprechend angepasst.
- `left`: Verlassen der Lobby schickt `{ type: "left", name }` an die anderen. Kein `left` bei Kick, im Countdown, im laufenden Spiel und bei abgebrochener Verbindung.

### `server/index.test.js`

- `check` über den echten Server: Antwort `resumable` für einen gültigen Token, `SESSION_NOT_FOUND` für einen unbekannten Code.
- `check` zählt als Begrüßung: Eine zweite Begrüßung auf demselben Socket bekommt `INVALID`.
- Der Prüf-Socket bindet nichts: Eine Aktion danach auf demselben Socket bekommt `INVALID`.

### Manuell im Browser

Lokaler Dev-Server, ein Origin pro Spieler. `window.confirm` wird per Skript ersetzt, damit der Dialog die Steuerung nicht blockiert.

1. Reload im Spiel: weiterhin stiller Rejoin, kein aufblitzender Hinweis.
2. Neuer Tab auf `/` während eines Spiels: Hinweis im Menü und nach MULTIPLAYER, REJOIN führt zurück, der alte Tab zeigt `REPLACED`.
3. Logo mitten im Spiel: Menü mit Hinweis, REJOIN führt zurück, Punkte bleiben.
4. LEAVE oder Logo in der Lobby: Rückfrage. Abbrechen lässt den Spieler drin. Bestätigen entfernt ihn, die anderen sehen den Toast, und es erscheint kein Hinweis.
5. ✕ verwirft den Hinweis, auch nach einem Reload des Menüs.
6. Nach Spielende (`final`, über den Menü-Button): kein Hinweis.

## Nicht-Ziele

- Keine Änderung am automatischen Reconnect, an `RECONNECT_MS` oder am Heartbeat.
- Keine Live-Aktualisierung des Hinweises.
- Keine Server-Nachricht beim Verwerfen.
- Kein Hinweis für Zuschauer.
- Keine Verwaltung mehrerer gleichzeitiger Sessions pro Browser: Es zählt nur `mp:last`.
- Keine deutsche Locale.
