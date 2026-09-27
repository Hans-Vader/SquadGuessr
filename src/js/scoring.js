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
 * Plain edit distance between two strings
 */
export function levenshtein(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let diagonal = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const above = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
            diagonal = above;
        }
    }
    return row[b.length];
}

/**
 * Does a typed answer name this map? Case, spaces, "_" and up to 2 typos are forgiven.
 * Official names go on after the map id ("Kohat Toi", "Narva Flooded"), so the answer may too; but only its start counts,
 * so listing several maps in one answer matches the first of them at most.
 */
export function mapNameMatches(answer, mapName) {
    const compact = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, "");
    const typed = compact(answer);
    const name = compact(mapName);
    return Array.from({ length: typed.length + 1 }, (_, i) => typed.slice(0, i)).some(start => levenshtein(start, name) <= 2);
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
