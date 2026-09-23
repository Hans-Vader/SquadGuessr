import i18next from "i18next";
import QRCode from "qrcode";

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
    }

    init() {
        $("#BUTTON_MP").on("click", () => this.showEntry());
        $("#BUTTON_MP_BACK").on("click", () => this.app.switchUI("menu"));
        $("#BUTTON_MP_CREATE").on("click", () => this.create());
        $("#BUTTON_MP_JOIN").on("click", () => this.join($("#mpCode").val()));
        $("#BUTTON_MP_LEAVE").on("click", () => this.leave());
        $("#BUTTON_MP_START").on("click", () => this.start());
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

    // replaced in Task 6
    renderStatus() {}

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
