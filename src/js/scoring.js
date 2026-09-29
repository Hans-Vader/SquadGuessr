import { MAPS, initMapsProperties } from "./data/maps.js";

// base thresholds for a 3000x3000 map
const BASE_STEPS = [
    { maxDistance: 20, points: 100, icon: "! 💯" },
    { maxDistance: 50, points: 80, icon: "! 🌟" },
    { maxDistance: 100, points: 60, icon: "👏🏼" },
    { maxDistance: 200, points: 40, icon: "👍🏼" },
    { maxDistance: 300, points: 20, icon: "😐" },
    { maxDistance: 500, points: 10, icon: ".. 🤨" },
];

/**
 * Points (and display icon) for a guess `distance` meters away on a map `size` meters wide
 */
export function pointsForDistance(distance, size) {
    const scale = size / 3000; // 1 for base map, >1 for bigger maps, <1 for smaller
    const steps = BASE_STEPS.map(s => ({ ...s, maxDistance: s.maxDistance * scale }));

    if (distance <= steps[0].maxDistance) return { points: steps[0].points, icon: steps[0].icon };

    for (let i = 1; i < steps.length; i++) {
        if (distance <= steps[i].maxDistance) {
            const prev = steps[i - 1];
            const curr = steps[i];
            const ratio = (distance - prev.maxDistance) / (curr.maxDistance - prev.maxDistance);
            return { points: Math.round(prev.points + (curr.points - prev.points) * ratio), icon: curr.icon };
        }
    }

    return { points: 0, icon: "... ❌" };
}

/**
 * Edits between two strings: a missing, extra or wrong letter, or two neighbouring letters swapped, is one edit each
 * (optimal string alignment distance)
 */
export function editDistance(a, b) {
    let twoUp = [];
    let above = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(above[j] + 1, row[j - 1] + 1, above[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], twoUp[j - 2] + 1);
        }
        twoUp = above;
        above = row;
    }
    return above[b.length];
}

const compact = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, "");
const MAP_NAMES = MAPS.map(m => compact(m.name));

/**
 * Fewest typos between the start of a (compact) answer and a (compact) map name
 */
function typos(typed, name) {
    return Math.min(...Array.from({ length: typed.length + 1 }, (_, i) => editDistance(typed.slice(0, i), name)));
}

/**
 * Does a typed answer name this map? Case, spaces, "_" and up to 2 typos are forgiven.
 * Official names go on after the map id ("Kohat Toi", "Narva Flooded"), so the answer may too; but only its start counts,
 * so listing several maps in one answer matches the first of them at most.
 * The answer must fit this map better than any other ("Kokan" is 2 typos from Kohat, "Kokat" 1 from both);
 * layers of one map ("Narva" / "Narva_f") count as the same map.
 */
export function mapNameMatches(answer, mapName) {
    const typed = compact(answer);
    const name = compact(mapName);
    const own = typos(typed, name);
    return own <= 2 && MAP_NAMES
        .filter(other => !other.startsWith(name) && !name.startsWith(other))
        .every(other => typos(typed, other) > own);
}

export function distance(a, b) {
    return Math.hypot(a.lat - b.lat, a.lng - b.lng);
}

export function mapSize(mapName) {
    const map = MAPS.find(m => m.name.toLowerCase() === mapName.toLowerCase());
    if (map && map.size === undefined) initMapsProperties();
    return map?.size;
}

/**
 * Score one answer against a guess, in game coordinates
 */
export function scoreAnswer(mode, guess, answer) {
    if (mode === "mapFinder") {
        return { distance: null, points: mapNameMatches(answer.mapName, guess.map) ? 100 : 0 };
    }
    const d = distance(guess, answer);
    return { distance: d, points: pointsForDistance(d, mapSize(guess.map)).points };
}
