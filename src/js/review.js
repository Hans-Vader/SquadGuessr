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

        $("#BUTTON_REVIEW_GO").on("click", () => this.open());
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
        // the EXPORT count is not covered by data-i18n
        i18next.on("languageChanged", () => this.renderExport());
        this.renderExport();

        if (new URLSearchParams(location.search).has("review")) this.open();
    }

    open() {
        history.replaceState({}, "", "/?review");
        // the queue stays in memory: coming back from the menu continues where the admin left off
        this.app.switchUI("review");
        if (!this.minimap) {
            this.minimap = new squadMinimap("reviewMinimap", this.app.MAPSIZE, MAPS[0]);
            // the review only looks: clicks place nothing
            this.minimap._handleclick = () => {};
            this.minimap._handleDoubleClick = () => {};
        }
        // the window may have changed size while the view was hidden
        this.minimap.invalidateSize();
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
        // scroll only the strip, centred on the current guess: scrollIntoView would also scroll the whole view down to it
        const strip = $strip[0];
        const current = $strip.children(".current")[0];
        if (current) strip.scrollLeft += current.getBoundingClientRect().left - strip.getBoundingClientRect().left - (strip.clientWidth - current.offsetWidth) / 2;
        this.renderExport();
    }

    renderExport() {
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
