import i18next from "i18next";
import { LatLngBounds } from "leaflet";
import QRCode from "qrcode";
import { guessMarker } from "./guessMarker.js";
import { updateOffset } from "./clock.js";
import { collectGuesses } from "./guesses.js";
import { MAPS } from "./data/maps.js";

const RETRY_DELAYS = [1000, 2000, 5000];

/**
 * Multiplayer session client
 * Talks to server/index.js over WebSocket and drives the lobby, game and results screens
 */
export default class Multiplayer {
    constructor(app) {
        this.app = app;
        this.active = false;
        this.watching = false;
        this.ws = null;
        this.hello = null;
        this.me = null;
        this.code = null;
        this.state = null;
        this.offset = null;
        this.retry = 0;
        this.retryTimer = null;
        this.qrCode = null;
        this.answered = false;
        this.countdown = null;
    }

    init() {
        $("#BUTTON_MP").on("click", () => {
            $("#mpEntry").removeClass("invite running");
            this.showEntry();
        });
        // Enter joins: always from the code field, from the name field only on an invite link (no create choice there)
        $("#mpCode").on("keydown", (e) => { if (e.key === "Enter") this.join($("#mpCode").val()); });
        $("#mpName").on("keydown", (e) => {
            if (e.key === "Enter" && $("#mpEntry").hasClass("invite")) this.join($("#mpCode").val());
        });
        $("#BUTTON_MP_BACK").on("click", () => {
            // a connection attempt may still be retrying (e.g. server unreachable): abandon it
            if (this.active) this.stop();
            history.replaceState({}, "", "/");
            this.app.switchUI("menu");
        });
        $("#BUTTON_MP_CREATE").on("click", () => this.create());
        $("#BUTTON_MP_JOIN").on("click", () => this.join($("#mpCode").val()));
        $("#BUTTON_MP_LEAVE").on("click", () => this.leave());
        $("#BUTTON_MP_START").on("click", () => this.start());
        $("#BUTTON_MP_WATCH").on("click", () => this.watchRunning());
        $("#BUTTON_MP_ENDROUND").on("click", () => this.send({ type: "endRound" }));
        $("#mpSettings").on("change", (e) => {
            // at least one map has to stay in the game
            if (!$("#mpMaps input:checked").length) e.target.checked = true;
            const settings = this.readSettings();
            localStorage.setItem("mp:excluded", settings.excluded.join(","));
            this.send({ type: "settings", settings });
        });
        document.addEventListener("visibilitychange", () => this.onVisible());

        $("#mpName").val(localStorage.getItem("mp:name") ?? "");
        const excluded = localStorage.getItem("mp:excluded")?.split(",") ?? [];
        $("#mpMaps .mp-maps").append(MAPS.map(m => $("<label>").append(
            $("<input type=\"checkbox\">").val(m.name).prop("checked", !excluded.includes(m.name)),
            $("<span>").text(m.name)
        )));

        const params = new URLSearchParams(location.search);
        const watch = params.get("watch");
        const join = params.get("join")?.toUpperCase();
        if (watch) return this.watch(watch);
        if (!join) return;
        $("#mpCode").val(join);
        // invite link: only ask for the name, no "create session" and no code field
        $("#mpEntry").addClass("invite");
        // page reload during a game: rejoin silently with the stored token
        if (localStorage.getItem(`mp:${join}`) && $("#mpName").val()) return this.join(join);
        this.showEntry();
    }

    // ===== ENTRY =====

    readName() {
        const name = $("#mpName").val().trim();
        if (!name) {
            this.toast("warning", "mp.enterName");
            return null;
        }
        localStorage.setItem("mp:name", name);
        return name;
    }

    readSettings() {
        return {
            mode: $("#mpMode").val(),
            timer: Number($("#mpTimer").val()),
            rounds: Number($("#mpRounds").val()),
            excluded: $("#mpMaps input:not(:checked)").map((_, el) => el.value).get(),
        };
    }

    create() {
        const name = this.readName();
        if (name) this.open({ type: "create", name, settings: this.readSettings() });
    }

    join(rawCode) {
        const code = String(rawCode).trim().toUpperCase();
        const name = this.readName();
        if (!name) return;
        if (code.length !== 4) return this.toast("warning", "mp.errors.CODE");
        this.open({ type: "join", code, name, token: localStorage.getItem(`mp:${code}`) ?? undefined });
    }

    // too late to play: switch the same page to the watch view of that session
    watchRunning() {
        const code = this.runningCode;
        $("#mpEntry").removeClass("running");
        history.replaceState({}, "", `/?watch=${code}`);
        this.watch(code);
    }

    watch(code) {
        this.watching = true;
        $("body").addClass("watch-mode");
        this.open({ type: "watch", code: code.toUpperCase() });
    }

    start() {
        const $button = $("#BUTTON_MP_START");
        this.app.setButtonLoading($button, true);
        const { rounds, excluded } = this.state.settings;
        collectGuesses(() => this.app.getGuess(10), rounds, excluded)
            .then(guesses => this.send({ type: "start", guesses }))
            .catch(() => this.toast("error", "mp.errors.GUESSES"))
            .finally(() => this.app.setButtonLoading($button, false));
    }

    // ===== CONNECTION =====

    open(hello) {
        // a second click (or a click while reconnecting) replaces the previous attempt instead of adding a socket
        clearTimeout(this.retryTimer);
        const previous = this.ws;
        this.ws = null;
        previous?.close();
        this.hello = hello;
        this.active = true;
        this.retry = 0;
        $("body").addClass("mp-active");
        this.connect();
    }

    connect() {
        const protocol = location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${protocol}://${location.host}/mp`);
        this.ws = ws;
        this.offset = null;
        ws.onopen = () => {
            if (this.ws !== ws) return;
            this.retry = 0;
            $("#mpBanner").prop("hidden", true);
            this.send(this.hello);
        };
        ws.onmessage = (event) => { if (this.ws === ws) this.onMessage(JSON.parse(event.data)); };
        ws.onclose = () => {
            if (!this.active || this.ws !== ws) return;
            $("#mpBanner").prop("hidden", false);
            clearTimeout(this.retryTimer);
            this.retryTimer = setTimeout(() => this.connect(), RETRY_DELAYS[this.retry++] ?? 5000);
        };
    }

    onVisible() {
        if (!this.active || document.visibilityState !== "visible") return;
        if (this.ws?.readyState !== WebSocket.CLOSED) return;
        clearTimeout(this.retryTimer);
        this.connect();
    }

    send(msg) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    }

    stop() {
        this.active = false;
        this.watching = false;
        clearTimeout(this.retryTimer);
        clearInterval(this.countdown);
        this.answered = false;
        this.app.selectMode($(".mode-card.selected").data("mode") || "classic");
        const ws = this.ws;
        this.ws = null;
        ws?.close();
        this.state = null;
        this.me = null;
        this.code = null;
        $("body").removeClass("mp-active mp-host watch-mode mp-reveal");
        $("#mpBanner, #mpStatus, #mpRanking, #BUTTON_MP_ENDROUND").prop("hidden", true);
        this.app.INPUT_GUESS.prop("disabled", false);
    }

    leave() {
        this.send({ type: "leave" });
        if (this.code) localStorage.removeItem(`mp:${this.code}`);
        this.stop();
        history.replaceState({}, "", "/");
        this.app.switchUI("menu");
    }

    // ===== MESSAGES =====

    onMessage(msg) {
        if (msg.serverNow) this.offset = updateOffset(this.offset, msg.serverNow, Date.now());

        switch (msg.type) {
        case "welcome":
            this.me = msg.playerId;
            this.code = msg.code;
            localStorage.setItem(`mp:${msg.code}`, msg.token);
            this.hello = { type: "join", code: msg.code, name: this.hello.name, token: msg.token };
            history.replaceState({}, "", `/?join=${msg.code}`);
            break;
        case "state":
            this.state = msg;
            this.renderState();
            break;
        case "round":
            this.onRound(msg);
            break;
        case "reveal":
            this.onReveal(msg);
            break;
        case "final":
            this.onFinal(msg);
            break;
        case "error":
            this.onError(msg.code);
            break;
        }
    }

    onError(code) {
        if (code === "GAME_RUNNING") {
            // no toast: the entry form now explains it and offers to watch instead
            this.runningCode = this.hello?.code;
            this.stop();
            $("#mpEntry").addClass("running");
            return this.showEntry();
        }
        this.toast("error", `mp.errors.${code}`);
        if (code === "SESSION_NOT_FOUND") localStorage.removeItem(`mp:${this.hello?.code}`);
        const rejected = ["SESSION_NOT_FOUND", "NAME_TAKEN", "SESSION_FULL", "SERVER_BUSY"].includes(code);
        if (!rejected) return;
        // were in the session (server restart, dropped from the lobby) or came via a dead invite link: back to the menu
        if (this.state || $("#mpEntry").hasClass("invite")) return this.leave();
        // typed a wrong code / taken name on the entry screen: stay there to correct it
        this.stop();
    }

    // ===== RENDERING =====

    isHost() {
        return this.me !== null && this.state?.hostId === this.me;
    }

    renderState() {
        const s = this.state;
        this.code = s.code;
        $("body").toggleClass("mp-host", this.isHost());
        $("#mpRoomCode").text(s.code);
        $("#mpMode").val(s.settings.mode);
        $("#mpTimer").val(String(s.settings.timer));
        $("#mpRounds").val(String(s.settings.rounds));
        $("#mpMaps input").each((_, el) => { el.checked = !s.settings.excluded.includes(el.value); });
        $("#mpMapsCount").text(`${MAPS.length - s.settings.excluded.length}/${MAPS.length}`);
        $("#mpSettingsSummary").text(this.describeSettings(s.settings));
        this.renderPlayers(s);

        const me = s.players.find(p => p.id === this.me);
        if (me) $("#totalPoints").text(me.score);

        this.renderStatus();
        if (s.phase === "lobby") this.showRoom();
    }

    renderStatus() {
        const s = this.state;
        if (!s || s.phase !== "round") return;
        const online = s.players.filter(p => p.connected);
        const text = i18next.t("mp.waitingForPlayers", {
            ns: "common",
            answered: online.filter(p => p.answered).length,
            total: online.length,
        });
        $("#mpStatus").text(text).prop("hidden", !this.answered && !this.watching);
    }

    // ===== GAME =====

    onRound(msg) {
        const app = this.app;
        const me = this.state.players.find(p => p.id === this.me);
        this.answered = Boolean(me?.answered);
        this.roundIndex = msg.index;

        app.selectedMode = this.state.settings.mode;
        $("body").removeClass("mp-reveal");
        app.currentGuess = { map: msg.map, url: msg.url, submitter: msg.submitter };
        app.solutionMarker = null;
        if (msg.map) app.setupMap();
        else app.minimap.clear();

        $("#gameWrapper").toggleClass("no-map", !msg.map);
        $("#text").css("visibility", "hidden");
        $("#mpRanking").prop("hidden", true);
        $("#round").text(`${msg.index + 1}/${msg.total}`);
        app.INPUT_GUESS.val("").prop({ hidden: false, disabled: this.answered });
        app.BUTTON_GUESS.prop({ hidden: this.watching || this.answered, disabled: true });
        app.BUTTON_NEXT.prop("hidden", true);
        app.BUTTON_RESULTS.prop("hidden", true);
        $("#BUTTON_MP_ENDROUND").prop("hidden", !this.isHost() || Boolean(msg.deadline));

        app.switchUI("game");
        app.minimap.invalidateSize();
        app.setupHint();
        this.renderStatus();
        this.startCountdown(msg.deadline);
    }

    submitAnswer() {
        const app = this.app;
        if (this.answered || this.watching || this.state?.phase !== "round") return;

        let answer;
        if (app.selectedMode === "mapFinder") {
            const mapName = app.INPUT_GUESS.val().trim();
            if (!mapName) return;
            answer = { mapName };
            app.INPUT_GUESS.prop("disabled", true);
        } else {
            const marker = app.minimap.guessMarker;
            if (!marker) return;
            const { lat, lng } = marker.getLatLng();
            answer = { lat: lat * app.minimap.mapToGameScale, lng: lng * app.minimap.mapToGameScale };
            marker.dragging.disable();
        }

        this.answered = true;
        this.send({ type: "answer", index: this.roundIndex, ...answer });
        app.BUTTON_GUESS.prop({ hidden: true, disabled: true });
        this.renderStatus();
    }

    startCountdown(deadline) {
        clearInterval(this.countdown);
        $("#timerWrapper").prop("hidden", !deadline);
        if (!deadline) return;

        const tick = () => {
            const left = Math.max(0, Math.ceil((deadline - Date.now() - (this.offset ?? 0)) / 1000));
            this.app.updateTimerDisplay(left);
            if (left > 0) return;
            clearInterval(this.countdown);
            // like singleplayer: a placed marker / typed name counts when time runs out
            this.submitAnswer();
        };
        tick();
        this.countdown = setInterval(tick, 250);
    }

    onReveal(msg) {
        const app = this.app;
        const mm = app.minimap;
        const { solution } = msg;

        clearInterval(this.countdown);
        app.stopTimer();
        app.selectedMode = this.state.settings.mode;
        // before any map sizing: on the big screen the reveal gives the map most of the width
        $("body").addClass("mp-reveal");

        // fresh = we missed the round (reconnect straight into reveal)
        const fresh = app.currentGuess?.url !== solution.url;
        // mapFinder never drew the map during the round (even if activeMap happens to be the right one)
        const needsMap = fresh || app.selectedMode === "mapFinder" || !mm.activeMap
            || mm.activeMap.name.toLowerCase() !== solution.map.toLowerCase();
        app.currentGuess = { ...solution, submitter: fresh ? null : app.currentGuess.submitter };

        $("#gameWrapper").removeClass("no-map");
        if (needsMap) app.setupMap();
        if (fresh) {
            app.switchUI("game");
            app.setupHint();
        }
        mm.invalidateSize();

        const mine = msg.results.find(r => r.id === this.me);
        const latLng = app.getSolutionLatLng();
        app.createSolutionMarker(latLng);
        // show my guess as the server scored it; a marker placed but never sent must not look scored
        mm.guessMarker?.remove();
        mm.guessMarker = null;
        if (mine && mine.lat !== null) {
            mm.guessMarker = new guessMarker(this.toMap(mine), { draggable: false }, mm).addTo(mm.markersGroup);
            app.drawSolutionDistance(latLng);
        }
        msg.results
            .filter(r => r.lat !== null && r.id !== this.me)
            .forEach(r => {
                this.addOtherMarker(r);
                // the big screen shows how far off everyone was
                if (this.watching) app.drawSolutionDistance(latLng, this.toMap(r));
            });
        this.focusReveal(latLng, msg.results);

        if (mine) {
            $("#dist").text(mine.distance === null ? "—" : app.formatDistance(mine.distance));
            $("#points").text(mine.points);
            $("#text").css("visibility", "visible");
        }
        const mapLabel = solution.map.charAt(0).toUpperCase() + solution.map.slice(1);
        if (app.selectedMode === "mapFinder") {
            $("#mapName").text(`${mine ? (mine.points ? "✅ " : "❌ ") : ""}${mapLabel}`).fadeIn();
        } else if (mine) {
            $("#mapName").text(`${mine.points} ${i18next.t("shared.points", { ns: "common" })}`).fadeIn();
        }

        this.renderRanking($("#mpRanking"), msg.results);
        $("#mpRanking").prop("hidden", false);

        const last = msg.index + 1 === msg.total;
        app.INPUT_GUESS.prop("hidden", true);
        app.BUTTON_GUESS.prop("hidden", true);
        $("#BUTTON_MP_ENDROUND").prop("hidden", true);
        app.BUTTON_NEXT.prop({ hidden: !this.isHost() || last, disabled: false });
        app.BUTTON_RESULTS.prop({ hidden: !this.isHost() || !last, disabled: false });
        $("#mpStatus").text(i18next.t("mp.waitingForHost", { ns: "common" })).prop("hidden", this.isHost());
    }

    /**
     * Fit the solution and every submitted guess into view (the own guess alone is not enough, and a watcher has none)
     */
    focusReveal(solution, results) {
        const mm = this.app.minimap;
        const points = [solution, ...results.filter(r => r.lat !== null).map(r => this.toMap(r))];
        if (points.length === 1) {
            mm.flyTo(solution, this.app.selectedMode === "mapFinder" ? 3 : 6, { duration: 1.5 });
            return;
        }
        // extra room on top for the name tooltips above the markers
        mm.flyToBounds(new LatLngBounds(points), { paddingTopLeft: [60, 110], paddingBottomRight: [60, 40], maxZoom: 6, duration: 1.5 });
    }

    toMap({ lat, lng }) {
        const mm = this.app.minimap;
        return [lat * mm.gameToMapScale, lng * mm.gameToMapScale];
    }

    addOtherMarker(result) {
        const mm = this.app.minimap;
        const label = document.createElement("span");
        label.textContent = `${result.name} +${result.points}`;
        new guessMarker(this.toMap(result), { draggable: false }, mm)
            .addTo(mm.markersGroup)
            .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -45], className: "mpTooltip" });
    }

    onFinal(msg) {
        clearInterval(this.countdown);
        this.renderRanking($("#mpFinalRanking"), msg.ranking, msg.winners);
        const me = msg.ranking.find(r => r.id === this.me);
        $("#scoreValue").text(me ? me.score : msg.ranking[0]?.score ?? 0);
        this.app.switchUI("results");
    }

    renderPlayers(s) {
        const items = s.players.map(p => $("<li>")
            .text(`${p.id === s.hostId ? "👑 " : ""}${p.name}${s.phase === "round" && p.answered ? " ✓" : ""}`)
            .toggleClass("offline", !p.connected)
            .toggleClass("me", p.id === this.me));
        $("#mpPlayers").empty().append(items);
        $("#mpChips").empty().append(items.map($li => $li.clone()));
    }

    renderRanking($list, rows, winners = []) {
        $list.empty();
        rows.forEach((row, i) => {
            $("<li>")
                .toggleClass("me", row.id === this.me)
                .append(
                    $("<span class=\"rank\">").text(winners.includes(row.id) ? "🏆" : `${i + 1}.`),
                    $("<span class=\"name\">").text(row.name),
                    $("<span class=\"points\">").text(row.points === undefined ? "" : `+${row.points}`),
                    $("<span class=\"score\">").text(row.score)
                )
                .appendTo($list);
        });
    }

    describeSettings({ mode, timer, rounds, excluded }) {
        const t = (key) => i18next.t(key, { ns: "common" });
        const modeLabel = mode === "classic" ? t("menu.classic") : t("menu.findMap");
        const timerLabel = { 0: t("timer.chill"), 60: t("timer.timed"), 15: t("timer.rush") }[timer];
        const maps = excluded.length ? ` · ${MAPS.length - excluded.length}/${MAPS.length} ${t("mp.maps")}` : "";
        return `${modeLabel} · ${timerLabel} · ${rounds} ${t("mp.rounds")}${maps}`;
    }

    showEntry() {
        $("#mpEntry").prop("hidden", false);
        $("#mpRoom").prop("hidden", true);
        this.app.switchUI("lobby");
    }

    showRoom() {
        clearInterval(this.countdown);
        $("#mpEntry").prop("hidden", true);
        $("#mpRoom").prop("hidden", false);
        this.drawQr();
        if (!$("#lobby").is(":visible")) this.app.switchUI("lobby");
    }

    drawQr() {
        if (this.qrCode === this.code) return;
        this.qrCode = this.code;
        const url = `${location.origin}/?join=${this.code}`;
        QRCode.toCanvas(document.getElementById("mpQr"), url, { width: 220, margin: 1 });
        $("#mpJoinUrl").text(url);
        $("#mpWatchLink").attr("href", `/?watch=${this.code}`);
    }

    toast(type, key) {
        this.app.openToast(type, i18next.t(key, { ns: "common" }), "");
    }
}
