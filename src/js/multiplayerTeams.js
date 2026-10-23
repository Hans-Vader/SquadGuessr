import i18next from "i18next";

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
 * Team play on the client: the lobby's teams (and, from the game on, the teammates' guesses on the map)
 */
export class Teams {
    constructor(mp) {
        this.mp = mp;
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
}
