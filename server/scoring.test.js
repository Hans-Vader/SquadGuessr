import { test } from "node:test";
import assert from "node:assert/strict";
import { pointsForDistance, levenshtein, mapNameMatches, distance, mapSize, scoreAnswer } from "../src/js/scoring.js";
import { MAPS, initMapsProperties } from "../src/js/data/maps.js";

test("pointsForDistance on a 3000m map", () => {
    assert.deepEqual(pointsForDistance(0, 3000), { points: 100, icon: "! 💯" });
    assert.equal(pointsForDistance(20, 3000).points, 100);
    assert.deepEqual(pointsForDistance(35, 3000), { points: 90, icon: "! 🌟" });
    assert.equal(pointsForDistance(500, 3000).points, 10);
    assert.deepEqual(pointsForDistance(501, 3000), { points: 0, icon: "... ❌" });
});

test("pointsForDistance scales thresholds with map size", () => {
    assert.equal(pointsForDistance(40, 6000).points, 100);
    assert.equal(pointsForDistance(70, 6000).points, 90);
});

test("levenshtein is the plain edit distance", () => {
    assert.equal(levenshtein("narva", "narva"), 0);
    assert.equal(levenshtein("narv", "narva"), 1);
    assert.equal(levenshtein("kohat", "narva"), 5);
});

test("mapNameMatches tolerates case, spaces and small typos", () => {
    assert.equal(mapNameMatches("Al Basrah", "AlBasrah"), true);
    assert.equal(mapNameMatches("goose bay", "GooseBay"), true);
    assert.equal(mapNameMatches("narv", "Narva"), true);
    assert.equal(mapNameMatches("narva", "Narva_f"), true);
    assert.equal(mapNameMatches("kohat", "Narva"), false);
});

test("mapNameMatches cannot be gamed by listing several maps", () => {
    assert.equal(mapNameMatches("narva kohat gorodok anvil belaya chora", "Narva"), false);
    assert.equal(mapNameMatches("narva kohat", "Kohat"), false);
});

test("distance is euclidean on lat/lng", () => {
    assert.equal(distance({ lat: 0, lng: 0 }, { lat: 3, lng: 4 }), 5);
});

test("mapSize matches initMapsProperties, case-insensitive", () => {
    initMapsProperties();
    const narva = MAPS.find(m => m.name === "Narva");
    assert.equal(mapSize("narva"), narva.size);
    assert.ok(narva.size > 0);
    assert.equal(mapSize("doesNotExist"), undefined);
});

test("scoreAnswer classic and mapFinder", () => {
    const guess = { map: "Narva", lat: 100, lng: 200 };
    assert.deepEqual(scoreAnswer("classic", guess, { lat: 100, lng: 200 }), { distance: 0, points: 100 });
    assert.equal(scoreAnswer("classic", guess, { lat: 100000, lng: 200 }).points, 0);
    assert.deepEqual(scoreAnswer("mapFinder", guess, { mapName: "narv" }), { distance: null, points: 100 });
    assert.equal(scoreAnswer("mapFinder", guess, { mapName: "gorodok" }).points, 0);
    assert.equal(scoreAnswer("mapFinder", guess, { mapName: "narva kohat gorodok anvil belaya chora" }).points, 0);
});
