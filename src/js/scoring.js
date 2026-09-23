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
 * Smallest edit distance between `b` and the whole of `a` (spaces removed) or any single word of `a`
 */
export function levenshtein(a, b) {

    function normalize(str) { return str.toLowerCase().trim().replace(/\s+/g, " "); }

    a = normalize(a);
    b = normalize(b);

    // Direct compact match
    if (a.replace(/\s/g, "") === b) return 0;

    const words = a.split(" ");
    let best = Infinity;

    for (const word of words) {
        const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
        for (let j = 0; j <= word.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= word.length; j++) {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + (b[i - 1] === word[j - 1] ? 0 : 1)
                );
            }
        }
        best = Math.min(best, matrix[b.length][word.length]);
    }
    return best;
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
        return { distance: null, points: levenshtein(answer.mapName, guess.map) <= 2 ? 100 : 0 };
    }
    const d = distance(guess, answer);
    return { distance: d, points: pointsForDistance(d, mapSize(guess.map)).points };
}
