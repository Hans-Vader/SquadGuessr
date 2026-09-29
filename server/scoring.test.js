import { test } from "node:test";
import assert from "node:assert/strict";
import { pointsForDistance, editDistance, mapNameMatches, distance, mapSize, scoreAnswer } from "../src/js/scoring.js";
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

test("editDistance counts a missing, extra, wrong or swapped letter as one edit", () => {
    assert.equal(editDistance("narva", "narva"), 0);
    assert.equal(editDistance("narv", "narva"), 1);
    assert.equal(editDistance("kohat", "narva"), 5);
    assert.equal(editDistance("khoat", "kohat"), 1);
    assert.equal(editDistance("ab", "ba"), 1);
});

test("mapNameMatches tolerates case, spaces and small typos", () => {
    assert.equal(mapNameMatches("Al Basrah", "AlBasrah"), true);
    assert.equal(mapNameMatches("goose bay", "GooseBay"), true);
    assert.equal(mapNameMatches("narv", "Narva"), true);
    assert.equal(mapNameMatches("narva", "Narva_f"), true);
    assert.equal(mapNameMatches("kohat", "Narva"), false);
});

test("mapNameMatches accepts the full official map names", () => {
    const official = [["Kohat Toi", "Kohat"], ["Kamdesh Highlands", "Kamdesh"], ["Sumari Bala", "Sumari"], ["Tallil Outskirts", "Tallil"],
        ["Fallujah City", "Fallujah"], ["Narva (Flooded)", "Narva_f"], ["Fool's Road", "FoolsRoad"], ["Jensen's Range", "Jensen"],
        ["Pacific Proving Grounds", "Pacific"], ["Kohta Toi", "Kohat"]];
    official.forEach(([answer, map]) => assert.equal(mapNameMatches(answer, map), true, answer));
});

test("mapNameMatches does not hand the points to a map a few typos away from the one typed", () => {
    assert.equal(mapNameMatches("Kokan", "Kohat"), false);
    assert.equal(mapNameMatches("Kohat", "Kokan"), false);
    assert.equal(mapNameMatches("Kohat Toi", "Kokan"), false);
    assert.equal(mapNameMatches("Kokan", "Kokan"), true);
});

test("mapNameMatches gives no points for an answer that fits two maps equally well", () => {
    // one typo from Kohat and from Kokan: hedging between two maps must not score for either
    assert.equal(mapNameMatches("Kokat", "Kohat"), false);
    assert.equal(mapNameMatches("Kokat", "Kokan"), false);
    assert.equal(mapNameMatches("sugar", "Logar"), false);
    assert.equal(mapNameMatches("Na Anvil", "Narva"), false);
});

test("mapNameMatches forgives swapped letters without handing the points to the map next to them", () => {
    // as plain edits these were 2 typos from their map and from another one, so they scored for neither
    const swapped = [["Khoat", "Kohat", "Chora"], ["Koaht", "Kohat", "Kokan"], ["Hraju", "Harju", "Chora"],
        ["Navil", "Anvil", "Narva"], ["Ogrodok", "Gorodok", "Logar"], ["Koakn", "Kokan", "Kohat"]];
    swapped.forEach(([answer, map, other]) => {
        assert.equal(mapNameMatches(answer, map), true, `${answer} -> ${map}`);
        assert.equal(mapNameMatches(answer, other), false, `${answer} -> ${other}`);
    });
});

test("mapNameMatches cannot be gamed by listing several maps", () => {
    assert.equal(mapNameMatches("kohat gorodok anvil belaya chora narva", "Narva"), false);
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
    assert.equal(scoreAnswer("mapFinder", guess, { mapName: "kohat gorodok anvil belaya chora narva" }).points, 0);
});
