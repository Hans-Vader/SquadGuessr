import i18next from "i18next";
import { CircleMarker, LayerGroup } from "leaflet";

// one color per team, in team order: mp.teamNames names them the same way
export const TEAM_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#eab308", "#a855f7", "#f97316", "#14b8a6", "#ec4899", "#e5e5e5", "#92400e"];

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
        this.guesses.filter(g => g.id !== mp.me).forEach(g => {
            // an element, not a string: Leaflet would put a string in as HTML, and a name must never become HTML
            const label = document.createElement("span");
            label.textContent = g.name;
            new CircleMarker(mp.toMap(g), { radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 })
                .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -8], className: "mpTooltip" })
                .addTo(this.layer);
        });
    }

    clear() {
        this.guesses = [];
        this.layer.clearLayers();
    }
}
