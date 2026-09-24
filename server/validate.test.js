import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, validSettings, validGuesses, validAnswer } from "./validate.js";
import { MAPS } from "../src/js/data/maps.js";

const guess = (over = {}) => ({ map: "Narva", url: "/img/guesses/narva_1.webp", lat: 1.5, lng: -2, ...over });

test("cleanName trims, strips control chars and caps length", () => {
    assert.equal(cleanName("  Max "), "Max");
    assert.equal(cleanName(" max\u0007"), "max");
    assert.equal(cleanName("x".repeat(30)), "x".repeat(20));
    assert.equal(cleanName("<b>Hi</b>"), "<b>Hi</b>");
    assert.equal(cleanName("   "), null);
    assert.equal(cleanName(42), null);
    assert.equal(cleanName(undefined), null);
});

test("cleanName removes invisible characters and collapses inner whitespace", () => {
    assert.equal(cleanName("Bob\u0085"), "Bob");
    assert.equal(cleanName("Bob\u200b"), "Bob");
    assert.equal(cleanName("B\u202eob"), "Bob");
    assert.equal(cleanName("Bo  b"), "Bo b");
    assert.equal(cleanName("\uff22ob"), "Bob");
    assert.equal(cleanName("\u200b\u200b"), null);
});

test("cleanName never splits an emoji when truncating", () => {
    assert.equal(cleanName("ABCDEFGHIJKLMNOPQRS😀"), "ABCDEFGHIJKLMNOPQRS😀");
    assert.equal(cleanName("ABCDEFGHIJKLMNOPQRST😀"), "ABCDEFGHIJKLMNOPQRST");
});

test("validSettings accepts only allowed values", () => {
    assert.equal(validSettings({ mode: "classic", timer: 0, rounds: 5 }), true);
    assert.equal(validSettings({ mode: "mapFinder", timer: 15, rounds: 10 }), true);
    assert.equal(validSettings({ mode: "classic", timer: "0", rounds: 5 }), false);
    assert.equal(validSettings({ mode: "hard", timer: 0, rounds: 5 }), false);
    assert.equal(validSettings({ mode: "classic", timer: 0, rounds: 7 }), false);
    assert.equal(validSettings(null), false);
});

test("validSettings accepts known excluded maps as long as one stays", () => {
    const base = { mode: "classic", timer: 0, rounds: 5 };
    assert.equal(validSettings({ ...base, excluded: [] }), true);
    assert.equal(validSettings({ ...base, excluded: ["Narva", "Kohat"] }), true);
    assert.equal(validSettings({ ...base, excluded: ["Atlantis"] }), false);
    assert.equal(validSettings({ ...base, excluded: "Narva" }), false);
    assert.equal(validSettings({ ...base, excluded: null }), false);
    assert.equal(validSettings({ ...base, excluded: MAPS.map(m => m.name) }), false);
});

test("validGuesses checks count and every field", () => {
    assert.equal(validGuesses([guess(), guess(), guess()], 3), true);
    assert.equal(validGuesses([guess({ submitter: "Dan" }), guess({ map: "narva" }), guess({ submitter: null })], 3), true);
    assert.equal(validGuesses([guess(), guess()], 3), false);
    assert.equal(validGuesses("nope", 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ map: "Atlantis" })], 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ url: "https://evil/x.webp" })], 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ url: "/img/../secret" })], 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ url: "/img/\"onerror=x" })], 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ lat: "1" })], 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ lng: Infinity })], 3), false);
    assert.equal(validGuesses([guess(), guess(), guess({ submitter: "x".repeat(41) })], 3), false);
    assert.equal(validGuesses([guess(), guess(), null], 3), false);
});

test("validAnswer per mode", () => {
    assert.equal(validAnswer({ lat: 1, lng: 2 }, "classic"), true);
    assert.equal(validAnswer({ lat: NaN, lng: 2 }, "classic"), false);
    assert.equal(validAnswer({ mapName: "narva" }, "classic"), false);
    assert.equal(validAnswer({ mapName: "narva" }, "mapFinder"), true);
    assert.equal(validAnswer({ mapName: "x".repeat(41) }, "mapFinder"), false);
    assert.equal(validAnswer({ lat: 1, lng: 2 }, "mapFinder"), false);
});
