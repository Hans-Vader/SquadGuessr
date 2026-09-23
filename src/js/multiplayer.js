import i18next from "i18next";
import QRCode from "qrcode";
import { guessMarker } from "./guessMarker.js";

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
        this.offset = 0;
        this.retry = 0;
        this.retryTimer = null;
        this.qrCode = null;
        this.answered = false;
        this.countdown = null;
    }

    init() {
        $("#BUTTON_MP").on("click", () => this.showEntry());
        $("#BUTTON_MP_BACK").on("click", () => this.app.switchUI("menu"));
        $("#BUTTON_MP_CREATE").on("click", () => this.create());
        $("#BUTTON_MP_JOIN").on("click", () => this.join($("#mpCode").val()));
        $("#BUTTON_MP_LEAVE").on("click", () => this.leave());
        $("#BUTTON_MP_START").on("click", () => this.start());
        $("#BUTTON_MP_ENDROUND").on("click", () => this.send({ type: "endRound" }));
        $("#mpSettings select").on("change", () => this.send({ type: "settings", settings: this.readSettings() }));
        document.addEventListener("visibilitychange", () => this.onVisible());

        $("#mpName").val(localStorage.getItem("mp:name") ?? "");

        const params = new URLSearchParams(location.search);
        const watch = params.get("watch");
        const join = params.get("join")?.toUpperCase();
        if (watch) return this.watch(watch);
        if (!join) return;
        $("#mpCode").val(join);
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
        };
    }

    create() {
        const name = this.readName();
        if (name) this.open({ type: "create", name, settings: this.readSettings() });
    }

    join(rawCode) {
        const code = String(rawCode).trim().toUpperCase();
        const name = this.readName();
        if (!name || code.length !== 4) return;
        this.open({ type: "join", code, name, token: localStorage.getItem(`mp:${code}`) ?? undefined });
    }

    watch(code) {
        this.watching = true;
        $("body").addClass("watch-mode");
        this.open({ type: "watch", code: code.toUpperCase() });
    }

    start() {
        const $button = $("#BUTTON_MP_START");
        this.app.setButtonLoading($button, true);
        this.app.getGuess(this.state.settings.rounds)
            .then(guesses => this.send({ type: "start", guesses }))
            .catch(() => this.toast("error", "mp.errors.GUESSES"))
            .finally(() => this.app.setButtonLoading($button, false));
    }

    // ===== CONNECTION =====

    open(hello) {
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
        ws.onopen = () => {
            this.retry = 0;
            $("#mpBanner").prop("hidden", true);
            this.send(this.hello);
        };
        ws.onmessage = (event) => this.onMessage(JSON.parse(event.data));
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
        $("body").removeClass("mp-active mp-host watch-mode");
        $("#mpBanner").prop("hidden", true);
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
        if (msg.serverNow) this.offset = msg.serverNow - Date.now();

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
        this.toast("error", `mp.errors.${code}`);
        if (code === "SESSION_NOT_FOUND") {
            localStorage.removeItem(`mp:${this.hello?.code}`);
            this.leave();
            return;
        }
        // rejected before we were ever in the session (name taken, game running, full): stay on the entry screen
        if (!this.state) this.stop();
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
        $("#BUTTON_MP_ENDROUND").prop("hidden", !this.isHost());

        app.switchUI("game");
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
            const left = Math.max(0, Math.ceil((deadline - Date.now() - this.offset) / 1000));
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

        // fresh = we missed the round (reconnect straight into reveal)
        const fresh = app.currentGuess?.url !== solution.url;
        const needsMap = fresh || !mm.activeMap || mm.activeMap.name.toLowerCase() !== solution.map.toLowerCase();
        app.currentGuess = { ...solution, submitter: fresh ? null : app.currentGuess.submitter };

        $("#gameWrapper").removeClass("no-map");
        if (needsMap) app.setupMap();
        if (fresh) {
            app.switchUI("game");
            app.setupHint();
        }
        mm.invalidateSize();
        mm.guessMarker?.dragging.disable();

        const latLng = app.getSolutionLatLng();
        app.createSolutionMarker(latLng);
        if (mm.guessMarker) app.drawSolutionDistance(latLng);
        msg.results
            .filter(r => r.lat !== null && (r.id !== this.me || !mm.guessMarker))
            .forEach(r => this.addOtherMarker(r));
        app.focusOnSolution(latLng, app.selectedMode === "mapFinder" ? 3 : 6);

        const mine = msg.results.find(r => r.id === this.me);
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

    addOtherMarker(result) {
        const mm = this.app.minimap;
        const label = document.createElement("span");
        label.textContent = `${result.name} +${result.points}`;
        new guessMarker([result.lat * mm.gameToMapScale, result.lng * mm.gameToMapScale], { draggable: false }, mm)
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

    describeSettings({ mode, timer, rounds }) {
        const t = (key) => i18next.t(key, { ns: "common" });
        const modeLabel = mode === "classic" ? t("menu.classic") : t("menu.findMap");
        const timerLabel = { 0: t("timer.chill"), 60: t("timer.timed"), 15: t("timer.rush") }[timer];
        return `${modeLabel} · ${timerLabel} · ${rounds} ${t("mp.rounds")}`;
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
