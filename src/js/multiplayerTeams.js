import i18next from "i18next";
import { CircleMarker, DivIcon, LayerGroup, Marker } from "leaflet";

// one color per team, in team order: mp.teamNames names them the same way. No red, blue or green: the own pin is red,
// the others' pins are blue and the solution is green
export const TEAM_COLORS = ["#facc15", "#a855f7", "#f97316", "#14b8a6", "#ec4899", "#1f2937", "#e5e5e5", "#92400e", "#a3e635", "#6b7280"];

/**
 * Light enough that white on it would vanish (yellow, white, lime)
 */
function isLight(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

const t = (key, options) => i18next.t(key, { ns: "common", ...options });

/**
 * "Team Blue": always put on the page with .text()
 */
export function teamName(team) {
    return t("mp.teamName", { name: t(`mp.teamNames.${team}`), interpolation: { escapeValue: false } });
}

/**
 * A round swatch in the team's color, in front of a name
 */
export function teamDot(team) {
    return $("<span class=\"team-dot\">").css("background", TEAM_COLORS[team]);
}

/**
 * Round points with their sign: "+12", "−23" (a real minus, as wide as the plus)
 */
export function formatPoints(points) {
    return points < 0 ? `\u2212${-points}` : `+${points}`;
}

/**
 * Team play on the client: the lobby's teams (and, from the game on, the teammates' guesses on the map)
 */
export class Teams {
    constructor(mp) {
        this.mp = mp;
        // teammates' guesses during a round: a layer of their own, so a new round or the reveal clears exactly these
        this.layer = new LayerGroup();
        this.guesses = [];
        // Leader: while the leader decides, a click on a teammate's guess selects it (selected), PICK sends it
        this.picking = false;
        this.selected = null;
    }

    /**
     * The lobby in team play: a block per team, empty ones too so anybody can join them. A click on a team's head
     * joins it; `item` draws a player like the plain list does
     */
    renderLobby(s, item) {
        const blocks = Array.from({ length: s.settings.teams }, (_, team) => {
            const members = s.players.filter(p => p.team === team);
            const $head = $("<button class=\"mp-team-head\">")
                .attr("data-team", team)
                .prop("disabled", s.phase !== "lobby" || this.mp.watching)
                .append(teamDot(team), $("<span>").text(`${teamName(team)} · ${members.length}`));
            return $("<div class=\"mp-team\">").append($head, $("<ul class=\"mp-players\">").append(members.map(item)));
        });
        $("#mpTeamList").empty().append(blocks);
    }

    /**
     * Teammates' guesses of the running round as the server sends them (positions only)
     */
    showGuesses(msg) {
        if (msg.index !== this.mp.roundIndex) return;
        this.guesses = msg.guesses;
        this.draw();
    }

    /**
     * A dot in the team's color per teammate; the own guess is the player's marker already
     */
    draw() {
        const mp = this.mp;
        const color = TEAM_COLORS[mp.myTeam()];
        this.layer.clearLayers().addTo(mp.app.minimap);
        // a leader who picks sees their own guess as a choice too (they may have guessed before they led)
        this.guesses.filter(g => this.picking || g.id !== mp.me).forEach(g => {
            const selected = g.id === this.selected;
            // an element, not a string: Leaflet would put a string in as HTML, and a name must never become HTML
            const label = document.createElement("span");
            label.textContent = g.name;
            const marker = new CircleMarker(mp.toMap(g), {
                radius: selected ? 13 : 8,
                color: selected ? "#ff4d4d" : "#fff",
                weight: selected ? 4 : 2,
                fillColor: color,
                fillOpacity: 1,
                // a click on a guess must not also reach the map
                bubblingMouseEvents: false,
            })
                .bindTooltip(label, { permanent: true, direction: "top", offset: [0, selected ? -13 : -8], className: "mpTooltip" })
                .addTo(this.layer);
            if (this.picking) marker.on("click", () => this.select(g.id));
        });
    }

    /**
     * Leader: whether this leader picks now; a new decision starts with nothing selected
     */
    startPicking(on) {
        this.picking = on;
        this.selected = null;
        this.draw();
    }

    select(id) {
        this.selected = id;
        this.draw();
        this.mp.app.BUTTON_GUESS.prop("disabled", false);
    }

    /**
     * The pick is sent: the selection stays on the map, nothing can be clicked any more
     */
    lock() {
        this.picking = false;
        this.draw();
    }

    clear() {
        this.guesses = [];
        this.picking = false;
        this.selected = null;
        this.layer.clearLayers();
    }

    /**
     * The point a team played at the reveal (Midpoint, Leader): a flagged disc in the team's color, bigger than a pin and
     * above every one of them (lobby.scss), with the team's name and points, and in Leader whose guess the leader picked
     */
    addTeamMarker(t, by) {
        const mm = this.mp.app.minimap;
        const label = document.createElement("span");
        label.textContent = `${teamName(t.id)} ${formatPoints(t.points)}${by ? ` · ${by}` : ""}`;
        label.prepend(teamDot(t.id)[0]);
        const point = document.createElement("div");
        point.className = "mp-team-point";
        point.classList.toggle("light", isLight(TEAM_COLORS[t.id]));
        point.style.setProperty("--team", TEAM_COLORS[t.id]);
        // fixed markup, nothing from a player in it
        point.innerHTML = "<span class=\"ring\"></span><span class=\"disc\">⚑</span>";
        // own class: Leaflet's default one would put a white box behind it
        const icon = new DivIcon({ html: point, className: "mp-team-marker", iconSize: [40, 40], iconAnchor: [20, 20] });
        return new Marker(this.mp.toMap(t), { icon, keyboard: false, zIndexOffset: 2000 })
            .addTo(mm.markersGroup)
            .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -22], className: "mpTooltip mp-team-tip" });
    }
}
